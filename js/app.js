// thought up by human, coded by ai
'use strict';

const APP_VERSION = '0.5.0';

const HEADER_TEXT_CREDITS = 'Credits';
const HEADER_TEXT_CUSTOM_NAME = 'Custom Name';
const HEADER_TEXT_SOURCE_PRICE = 'Unit Net Price Before Credits';
const NEW_COLUMN_HEADER = 'Price EUR';
const HIGHLIGHT_FILL_ARGB = 'FFFFFF01';
const EUR_NUM_FMT_CODE = '#,##0.00" €"';
const CUSTOM_NUM_FMT_ID_BASE = 164; // custom number format IDs conventionally start at 164

function colLettersToIndex(letters) {
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return idx;
}

function colIndexToLetters(index) {
  let letters = '';
  let idx = index;
  while (idx > 0) {
    const rem = (idx - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    idx = Math.floor((idx - 1) / 26);
  }
  return letters;
}

function parseCellRef(ref) {
  const m = ref.match(/^([A-Z]+)(\d+)$/);
  if (!m) return null;
  return { letters: m[1], colIndex: colLettersToIndex(m[1]), row: parseInt(m[2], 10) };
}

function assertNoParserError(doc, context) {
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error(`${context} konnte nicht als XML gelesen werden — Datei möglicherweise beschädigt.`);
  }
}

function resolveCellText(cellEl, sharedStrings) {
  const t = cellEl.getAttribute('t');
  if (t === 's') {
    const vEl = cellEl.getElementsByTagName('v')[0];
    if (!vEl) return null;
    return sharedStrings[parseInt(vEl.textContent, 10)] ?? null;
  }
  if (t === 'str') {
    const vEl = cellEl.getElementsByTagName('v')[0];
    return vEl ? vEl.textContent : null;
  }
  if (t === 'inlineStr') {
    const isEl = cellEl.getElementsByTagName('is')[0];
    if (!isEl) return null;
    let text = '';
    for (const tEl of isEl.getElementsByTagName('t')) text += tEl.textContent || '';
    return text;
  }
  return null;
}

function bumpRowSpans(rowEl, newColIndex) {
  const spans = rowEl.getAttribute('spans');
  if (!spans) return;
  const m = spans.match(/^(\d+):(\d+)$/);
  if (!m) return;
  const end = Math.max(parseInt(m[2], 10), newColIndex);
  rowEl.setAttribute('spans', `${m[1]}:${end}`);
}

function roundToCents(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function serializeWithDeclaration(doc) {
  // Some engines (e.g. WebKit) already include the XML declaration in
  // serializeToString output, others (e.g. Chromium) never do — only add
  // ours if it's missing, otherwise the file ends up with two declarations
  // (invalid XML, triggers Excel's "repair" prompt).
  const serialized = new XMLSerializer().serializeToString(doc);
  return serialized.startsWith('<?xml')
    ? serialized
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n${serialized}`;
}

async function findFirstSheetPath(zip) {
  const workbookXml = await zip.file('xl/workbook.xml').async('string');
  const workbookDoc = new DOMParser().parseFromString(workbookXml, 'application/xml');
  assertNoParserError(workbookDoc, 'xl/workbook.xml');

  const sheetEl = workbookDoc.getElementsByTagName('sheet')[0];
  if (!sheetEl) throw new Error('Kein Tabellenblatt in der Datei gefunden.');

  const RELS_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const rId = sheetEl.getAttributeNS(RELS_NS, 'id') || sheetEl.getAttribute('r:id');
  if (!rId) throw new Error('Verknüpfung zum Tabellenblatt konnte nicht gelesen werden.');

  const relsFile = zip.file('xl/_rels/workbook.xml.rels');
  if (!relsFile) throw new Error('xl/_rels/workbook.xml.rels fehlt in der Datei.');
  const relsXml = await relsFile.async('string');
  const relsDoc = new DOMParser().parseFromString(relsXml, 'application/xml');
  assertNoParserError(relsDoc, 'xl/_rels/workbook.xml.rels');

  let target = null;
  for (const relEl of relsDoc.getElementsByTagName('Relationship')) {
    if (relEl.getAttribute('Id') === rId) {
      target = relEl.getAttribute('Target');
      break;
    }
  }
  if (!target) throw new Error('Pfad zum Tabellenblatt konnte nicht aufgelöst werden.');

  return target.startsWith('/') ? target.slice(1) : `xl/${target}`;
}

async function loadSharedStrings(zip) {
  const sstFile = zip.file('xl/sharedStrings.xml');
  if (!sstFile) return [];
  const sstXml = await sstFile.async('string');
  const sstDoc = new DOMParser().parseFromString(sstXml, 'application/xml');
  assertNoParserError(sstDoc, 'xl/sharedStrings.xml');

  const strings = [];
  for (const siEl of sstDoc.getElementsByTagName('si')) {
    let text = '';
    for (const tEl of siEl.getElementsByTagName('t')) text += tEl.textContent || '';
    strings.push(text);
  }
  return strings;
}

function findQuoteTable(sheetDoc, sharedStrings) {
  const sheetDataEl = sheetDoc.getElementsByTagName('sheetData')[0];
  if (!sheetDataEl) throw new Error('Keine Tabellendaten (sheetData) im Tabellenblatt gefunden.');

  const rows = Array.from(sheetDataEl.getElementsByTagName('row'));

  let headerRow = null;
  for (const row of rows) {
    for (const c of row.getElementsByTagName('c')) {
      if (resolveCellText(c, sharedStrings) === HEADER_TEXT_CREDITS) {
        headerRow = row;
        break;
      }
    }
    if (headerRow) break;
  }
  if (!headerRow) {
    throw new Error(`Kopfzeile mit Spalte "${HEADER_TEXT_CREDITS}" nicht gefunden — unerwartetes Dateiformat.`);
  }

  let creditsCol = null;
  let customNameCol = null;
  let sourceCol = null;
  for (const c of headerRow.getElementsByTagName('c')) {
    const text = resolveCellText(c, sharedStrings);
    const ref = parseCellRef(c.getAttribute('r'));
    if (!ref) continue;
    if (text === HEADER_TEXT_CREDITS) creditsCol = ref.colIndex;
    else if (text === HEADER_TEXT_CUSTOM_NAME) customNameCol = ref.colIndex;
    else if (text === HEADER_TEXT_SOURCE_PRICE) sourceCol = ref.colIndex;
  }
  if (creditsCol == null || customNameCol == null || sourceCol == null) {
    throw new Error(
      `Erwartete Spalten ("${HEADER_TEXT_CREDITS}", "${HEADER_TEXT_CUSTOM_NAME}", "${HEADER_TEXT_SOURCE_PRICE}") nicht vollständig gefunden.`
    );
  }

  const sourceLetters = colIndexToLetters(sourceCol);
  const headerIndex = rows.indexOf(headerRow);
  const dataRows = [];
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    let sourceCell = null;
    for (const c of row.getElementsByTagName('c')) {
      const ref = parseCellRef(c.getAttribute('r'));
      if (ref && ref.letters === sourceLetters) {
        sourceCell = c;
        break;
      }
    }
    if (!sourceCell || sourceCell.getAttribute('t')) break;
    const vEl = sourceCell.getElementsByTagName('v')[0];
    if (!vEl) break;
    const value = parseFloat(vEl.textContent);
    if (Number.isNaN(value)) break;
    dataRows.push({ row, value, sourceCell });
  }
  if (dataRows.length === 0) {
    throw new Error('Keine Artikelzeilen unterhalb der Kopfzeile gefunden.');
  }

  return { headerRow, creditsCol, customNameCol, sourceCol, dataRows };
}

async function addHighlightStyles(zip, baseHeaderStyleId, baseDataStyleId) {
  const stylesFile = zip.file('xl/styles.xml');
  if (!stylesFile) throw new Error('xl/styles.xml fehlt in der Datei.');
  const stylesXml = await stylesFile.async('string');
  const stylesDoc = new DOMParser().parseFromString(stylesXml, 'application/xml');
  assertNoParserError(stylesDoc, 'xl/styles.xml');
  const NS = stylesDoc.documentElement.namespaceURI;

  const fillsEl = stylesDoc.getElementsByTagName('fills')[0];
  const cellXfsEl = stylesDoc.getElementsByTagName('cellXfs')[0];
  if (!fillsEl || !cellXfsEl) {
    throw new Error('Unerwartete Struktur in xl/styles.xml (fills/cellXfs fehlen).');
  }

  const fillIndex = fillsEl.getElementsByTagName('fill').length;
  const fillEl = stylesDoc.createElementNS(NS, 'fill');
  const patternFillEl = stylesDoc.createElementNS(NS, 'patternFill');
  patternFillEl.setAttribute('patternType', 'solid');
  const fgColorEl = stylesDoc.createElementNS(NS, 'fgColor');
  fgColorEl.setAttribute('rgb', HIGHLIGHT_FILL_ARGB);
  const bgColorEl = stylesDoc.createElementNS(NS, 'bgColor');
  bgColorEl.setAttribute('indexed', '64');
  patternFillEl.appendChild(fgColorEl);
  patternFillEl.appendChild(bgColorEl);
  fillEl.appendChild(patternFillEl);
  fillsEl.appendChild(fillEl);
  fillsEl.setAttribute('count', String(fillsEl.getElementsByTagName('fill').length));

  // Custom number format so the computed prices display with a Euro sign
  // (e.g. "6.924,42 €") while remaining plain, formula-usable numbers.
  let numFmtsEl = stylesDoc.getElementsByTagName('numFmts')[0];
  if (!numFmtsEl) {
    numFmtsEl = stylesDoc.createElementNS(NS, 'numFmts');
    numFmtsEl.setAttribute('count', '0');
    stylesDoc.documentElement.insertBefore(numFmtsEl, stylesDoc.documentElement.firstElementChild);
  }
  const usedNumFmtIds = Array.from(numFmtsEl.getElementsByTagName('numFmt')).map((el) =>
    parseInt(el.getAttribute('numFmtId'), 10)
  );
  let eurNumFmtId = CUSTOM_NUM_FMT_ID_BASE;
  while (usedNumFmtIds.includes(eurNumFmtId)) eurNumFmtId++;
  const numFmtEl = stylesDoc.createElementNS(NS, 'numFmt');
  numFmtEl.setAttribute('numFmtId', String(eurNumFmtId));
  numFmtEl.setAttribute('formatCode', EUR_NUM_FMT_CODE);
  numFmtsEl.appendChild(numFmtEl);
  numFmtsEl.setAttribute('count', String(numFmtsEl.getElementsByTagName('numFmt').length));

  function addFillVariant(baseStyleId, extraNumFmtId) {
    const xfs = cellXfsEl.getElementsByTagName('xf');
    const base = xfs[parseInt(baseStyleId, 10)];
    if (!base) throw new Error(`Basis-Style "${baseStyleId}" für die Spaltenfarbe nicht gefunden.`);
    const clone = base.cloneNode(true);
    clone.setAttribute('fillId', String(fillIndex));
    clone.setAttribute('applyFill', '1');
    if (extraNumFmtId != null) {
      clone.setAttribute('numFmtId', String(extraNumFmtId));
      clone.setAttribute('applyNumberFormat', '1');
    }
    const newIndex = xfs.length;
    cellXfsEl.appendChild(clone);
    return String(newIndex);
  }

  const headerStyleId = addFillVariant(baseHeaderStyleId || '0');
  const dataStyleId = addFillVariant(baseDataStyleId || '0', eurNumFmtId);
  // Rate cell keeps the base (General) number format — plain number, no label.
  const rateStyleId = addFillVariant(baseHeaderStyleId || '0');
  cellXfsEl.setAttribute('count', String(cellXfsEl.getElementsByTagName('xf').length));

  zip.file('xl/styles.xml', serializeWithDeclaration(stylesDoc), { createFolders: false });
  return { headerStyleId, dataStyleId, rateStyleId };
}

async function processFile(file, rate) {
  const buffer = await file.arrayBuffer();
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (err) {
    throw new Error('Datei konnte nicht gelesen werden — ist es eine gültige .xlsx-Datei?');
  }

  const sheetPath = await findFirstSheetPath(zip);
  const sheetFile = zip.file(sheetPath);
  if (!sheetFile) throw new Error(`Tabellenblatt-Datei ${sheetPath} fehlt im Archiv.`);
  const sheetXml = await sheetFile.async('string');
  const sheetDoc = new DOMParser().parseFromString(sheetXml, 'application/xml');
  assertNoParserError(sheetDoc, sheetPath);

  const sharedStrings = await loadSharedStrings(zip);
  const { headerRow, creditsCol, customNameCol, dataRows } = findQuoteTable(sheetDoc, sharedStrings);

  const NS = sheetDoc.documentElement.namespaceURI;
  const newColIndex = customNameCol + 1;
  const newColLetters = colIndexToLetters(newColIndex);

  const creditsHeaderCell = Array.from(headerRow.getElementsByTagName('c')).find(
    (c) => resolveCellText(c, sharedStrings) === HEADER_TEXT_CREDITS
  );
  const headerStyle = creditsHeaderCell ? creditsHeaderCell.getAttribute('s') : null;
  const dataStyle = dataRows[0].sourceCell.getAttribute('s');

  const {
    headerStyleId: yellowHeaderStyle,
    dataStyleId: yellowDataStyle,
    rateStyleId,
  } = await addHighlightStyles(zip, headerStyle, dataStyle);

  // Rate cell directly above the header row (e.g. AF39 when the header is row 40).
  // Stored as a plain number (custom number format only adds a display label) so
  // it can be edited in Excel and referenced by the price formulas below — editing
  // it there recalculates every price automatically, no re-upload needed.
  const rateRow = headerRow.previousElementSibling;
  let rateCellRef = null;
  if (rateRow && rateRow.tagName === 'row') {
    const rateRowNum = rateRow.getAttribute('r');
    rateCellRef = `$${newColLetters}$${rateRowNum}`;
    const rateCell = sheetDoc.createElementNS(NS, 'c');
    rateCell.setAttribute('r', `${newColLetters}${rateRowNum}`);
    rateCell.setAttribute('s', rateStyleId);
    const rateValueEl = sheetDoc.createElementNS(NS, 'v');
    rateValueEl.textContent = String(rate);
    rateCell.appendChild(rateValueEl);
    rateRow.appendChild(rateCell);
    bumpRowSpans(rateRow, newColIndex);
  }

  // New header cell
  const headerCell = sheetDoc.createElementNS(NS, 'c');
  headerCell.setAttribute('r', `${newColLetters}${headerRow.getAttribute('r')}`);
  headerCell.setAttribute('s', yellowHeaderStyle);
  headerCell.setAttribute('t', 'inlineStr');
  const isEl = sheetDoc.createElementNS(NS, 'is');
  const headerTextEl = sheetDoc.createElementNS(NS, 't');
  headerTextEl.textContent = NEW_COLUMN_HEADER;
  isEl.appendChild(headerTextEl);
  headerCell.appendChild(isEl);
  headerRow.appendChild(headerCell);
  bumpRowSpans(headerRow, newColIndex);

  // New data cells — a real formula referencing the rate cell when available,
  // so changing the rate in Excel recalculates every price automatically.
  for (const { row, value, sourceCell } of dataRows) {
    const eur = roundToCents(value / rate);
    const cell = sheetDoc.createElementNS(NS, 'c');
    cell.setAttribute('r', `${newColLetters}${row.getAttribute('r')}`);
    cell.setAttribute('s', yellowDataStyle);
    if (rateCellRef) {
      const fEl = sheetDoc.createElementNS(NS, 'f');
      fEl.textContent = `ROUND(${sourceCell.getAttribute('r')}/${rateCellRef},2)`;
      cell.appendChild(fEl);
    }
    const vEl = sheetDoc.createElementNS(NS, 'v');
    vEl.textContent = String(eur);
    cell.appendChild(vEl);
    row.appendChild(cell);
    bumpRowSpans(row, newColIndex);
  }

  // Hide Credits..Custom Name columns
  let colsEl = sheetDoc.getElementsByTagName('cols')[0];
  const sheetDataEl = sheetDoc.getElementsByTagName('sheetData')[0];
  if (!colsEl) {
    colsEl = sheetDoc.createElementNS(NS, 'cols');
    sheetDataEl.parentNode.insertBefore(colsEl, sheetDataEl);
  }
  const hideCol = sheetDoc.createElementNS(NS, 'col');
  hideCol.setAttribute('min', String(creditsCol));
  hideCol.setAttribute('max', String(customNameCol));
  hideCol.setAttribute('width', '9.140625');
  hideCol.setAttribute('customWidth', '1');
  hideCol.setAttribute('hidden', '1');
  colsEl.appendChild(hideCol);

  const newColWidth = sheetDoc.createElementNS(NS, 'col');
  newColWidth.setAttribute('min', String(newColIndex));
  newColWidth.setAttribute('max', String(newColIndex));
  newColWidth.setAttribute('width', '14.7109375');
  newColWidth.setAttribute('customWidth', '1');
  colsEl.appendChild(newColWidth);

  // Extend dimension reference
  const dimEl = sheetDoc.getElementsByTagName('dimension')[0];
  if (dimEl) {
    const m = dimEl.getAttribute('ref').match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
    if (m && colLettersToIndex(m[3]) < newColIndex) {
      dimEl.setAttribute('ref', `${m[1]}${m[2]}:${newColLetters}${m[4]}`);
    }
  }

  // createFolders:false avoids JSZip adding synthetic 'xl/' / 'xl/worksheets/'
  // directory entries that aren't present in the original file.
  zip.file(sheetPath, serializeWithDeclaration(sheetDoc), { createFolders: false });

  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    compression: 'DEFLATE',
  });
}

async function downloadResult(blob, filename) {
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: 'Excel-Datei',
            accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'saved';
    } catch (err) {
      if (err.name === 'AbortError') return 'cancelled';
      // fall through to classic download on any other error (e.g. permission issue)
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'downloaded';
}

function initUI() {
  const dropZone = document.getElementById('drop-zone');
  const dropZoneText = document.getElementById('drop-zone-text');
  const fileInput = document.getElementById('file-input');
  const rateInput = document.getElementById('rate-input');
  const processButton = document.getElementById('process-button');
  const status = document.getElementById('status');
  const versionEl = document.getElementById('app-footer-version');

  versionEl.textContent = `v${APP_VERSION}`;

  let selectedFile = null;

  function setStatus(message, state) {
    status.textContent = message;
    if (state) status.setAttribute('data-state', state);
    else status.removeAttribute('data-state');
  }

  function handleFileSelected(file) {
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) {
      setStatus('Nur .xlsx-Dateien werden unterstützt.', 'error');
      return;
    }
    selectedFile = file;
    dropZoneText.textContent = file.name;
    rateInput.disabled = false;
    processButton.disabled = false;
    setStatus('', null);
  }

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    handleFileSelected(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', () => handleFileSelected(fileInput.files[0]));

  processButton.addEventListener('click', async () => {
    processButton.disabled = true;
    try {
      const rateRaw = rateInput.value.trim().replace(',', '.');
      const rate = parseFloat(rateRaw);
      if (!rateRaw || !Number.isFinite(rate) || rate <= 0) {
        throw new Error('Bitte einen gültigen, positiven Umrechnungskurs eingeben.');
      }
      setStatus('Verarbeite Datei…', null);
      const blob = await processFile(selectedFile, rate);
      setStatus('Speichere Datei…', null);
      const result = await downloadResult(blob, selectedFile.name);
      if (result === 'cancelled') {
        setStatus('Speichern abgebrochen.', null);
      } else {
        setStatus(
          `Fertig — Spalte "${NEW_COLUMN_HEADER}" mit Kurs ${rate} ergänzt. Kurs in AF39 anpassen berechnet alle Preise in Excel automatisch neu.`,
          'success'
        );
      }
    } catch (err) {
      console.error(err);
      setStatus(`Fehler: ${err.message}`, 'error');
    } finally {
      processButton.disabled = false;
    }
  });
}

document.addEventListener('DOMContentLoaded', initUI);
