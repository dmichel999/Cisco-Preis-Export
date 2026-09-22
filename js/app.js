// thought up by human, coded by ai
'use strict';

const APP_VERSION = '0.20.0';

const HEADER_TEXT_CREDITS = 'Credits';
const HEADER_TEXT_CUSTOM_NAME = 'Custom Name';
const HEADER_TEXT_SOURCE_PRICE = 'Unit Net Price Before Credits';
const HEADER_TEXT_PART_NUMBER = 'Part Number';
const HEADER_TEXT_PRICING_TERM = 'Pricing Term (in Months)';
const HEADER_TEXT_QUOTE_TOTAL_LABEL = 'Quote Total';
const HEADER_TEXT_SPECIAL_ITEMS_TOTAL = 'Special Items Total';
const NEW_COLUMN_HEADER = 'Price EUR';
const SUBSCRIPTION_NOTE_HEADER = 'Preishinweis';
const QUOTE_TOTAL_EUR_HEADER = 'Quote Total (EUR)';
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

// Separate from resolveCellText on purpose: "Pricing Term (in Months)" shows up in
// real exports both as a shared string (often an *empty* string — "no term set")
// and as a plain number (no `t` attribute at all, unlike the text columns this tool
// otherwise reads, which are always shared strings). A dedicated reader keeps that
// quirk local to the subscription-note feature instead of changing how every other
// column's text is resolved.
function resolvePricingTermMonths(cellEl, sharedStrings) {
  if (!cellEl) return 0;
  const t = cellEl.getAttribute('t');
  let text = '';
  if (t === 's') {
    const vEl = cellEl.getElementsByTagName('v')[0];
    text = vEl ? sharedStrings[parseInt(vEl.textContent, 10)] ?? '' : '';
  } else if (t === 'str') {
    const vEl = cellEl.getElementsByTagName('v')[0];
    text = vEl ? vEl.textContent : '';
  } else if (t === 'inlineStr') {
    const isEl = cellEl.getElementsByTagName('is')[0];
    if (isEl) {
      for (const tEl of isEl.getElementsByTagName('t')) text += tEl.textContent || '';
    }
  } else if (!t) {
    const vEl = cellEl.getElementsByTagName('v')[0];
    text = vEl ? vEl.textContent : '';
  }
  const parsed = parseFloat(text);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function bumpRowSpans(rowEl, newColIndex) {
  const spans = rowEl.getAttribute('spans');
  if (!spans) return;
  const m = spans.match(/^(\d+):(\d+)$/);
  if (!m) return;
  const end = Math.max(parseInt(m[2], 10), newColIndex);
  rowEl.setAttribute('spans', `${m[1]}:${end}`);
}

function isColumnOccupied(rowEl, colIndex) {
  if (!rowEl) return false;
  for (const c of rowEl.getElementsByTagName('c')) {
    const ref = parseCellRef(c.getAttribute('r'));
    if (ref && ref.colIndex === colIndex) return true;
  }
  return false;
}

// Cisco can add extra columns between portal versions without changing the header
// texts we key off of (e.g. a "BPA No Subscription Line" column right after "Custom
// Name" that didn't exist before) — probing for a column that's free across every
// row we're about to touch avoids silently colliding with existing data there.
function findFirstFreeColumn(startCol, rowEls) {
  let col = startCol;
  while (rowEls.some((rowEl) => isColumnOccupied(rowEl, col))) col++;
  return col;
}

function roundToCents(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatDateDE(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${date.getFullYear()}`;
}

// EZB-Referenzkurs (kostenlos, kein API-Key, CORS-offen) — nicht finanzen.net:
// das blockt automatisierte Zugriffe hart per Akamai-Bot-Schutz (403 "Access
// Denied", auch mit regulärem Browser-User-Agent). Nur ein GET auf eine
// öffentliche Kurs-API, keine Quote-/Kundendaten verlassen dabei den Browser.
const FX_API_URL = 'https://api.frankfurter.dev/v1/latest?from=EUR&to=USD';

async function fetchEurUsdRate() {
  let res;
  try {
    res = await fetch(FX_API_URL);
  } catch (err) {
    throw new Error('Kurs-API nicht erreichbar (kein Netzwerk?).');
  }
  if (!res.ok) throw new Error(`Kurs-API antwortete mit Status ${res.status}.`);
  const data = await res.json();
  const rate = data && data.rates && data.rates.USD;
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
    throw new Error('Kurs-API lieferte keinen gültigen Kurs.');
  }
  const m = typeof data.date === 'string' ? data.date.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  const date = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  return { rate, date };
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
  let partNumberCol = null;
  let pricingTermCol = null;
  for (const c of headerRow.getElementsByTagName('c')) {
    const text = resolveCellText(c, sharedStrings);
    const ref = parseCellRef(c.getAttribute('r'));
    if (!ref) continue;
    if (text === HEADER_TEXT_CREDITS) creditsCol = ref.colIndex;
    else if (text === HEADER_TEXT_CUSTOM_NAME) customNameCol = ref.colIndex;
    else if (text === HEADER_TEXT_SOURCE_PRICE) sourceCol = ref.colIndex;
    else if (text === HEADER_TEXT_PART_NUMBER) partNumberCol = ref.colIndex;
    else if (text === HEADER_TEXT_PRICING_TERM) pricingTermCol = ref.colIndex;
  }
  if (creditsCol == null || customNameCol == null || sourceCol == null || partNumberCol == null) {
    throw new Error(
      `Erwartete Spalten ("${HEADER_TEXT_CREDITS}", "${HEADER_TEXT_CUSTOM_NAME}", "${HEADER_TEXT_SOURCE_PRICE}", "${HEADER_TEXT_PART_NUMBER}") nicht vollständig gefunden.`
    );
  }
  // "Pricing Term (in Months)" is optional — without it, no row can be identified
  // as a subscription line, and the note column below stays a no-op.
  const pricingTermLetters = pricingTermCol != null ? colIndexToLetters(pricingTermCol) : null;

  const sourceLetters = colIndexToLetters(sourceCol);
  const partNumberLetters = colIndexToLetters(partNumberCol);
  const headerIndex = rows.indexOf(headerRow);
  const dataRows = [];
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    let sourceCell = null;
    let partNumberCell = null;
    for (const c of row.getElementsByTagName('c')) {
      const ref = parseCellRef(c.getAttribute('r'));
      if (!ref) continue;
      if (ref.letters === sourceLetters) sourceCell = c;
      else if (ref.letters === partNumberLetters) partNumberCell = c;
    }
    // "Part Number" is the reliable per-row anchor for "this is still an item
    // row" — unlike the source price, which Cisco writes as a text placeholder
    // ("--") rather than a number for lines with no allocable price of their
    // own (e.g. EA/Subscription-Quotes, where every item row shows "--" and
    // the real total lives in the separate "Quote Total" summary, see below).
    const partNumberText = partNumberCell ? resolveCellText(partNumberCell, sharedStrings) : null;
    if (!partNumberText) break;

    // "Unit Net Price Before Credits" computation itself is untouched: a plain
    // number cell is read exactly as before. A missing/textual/zero source
    // price (e.g. the "--" placeholder) just means 0 here, not "end of table".
    let value = 0;
    if (sourceCell && !sourceCell.getAttribute('t')) {
      const vEl = sourceCell.getElementsByTagName('v')[0];
      if (vEl) {
        const parsed = parseFloat(vEl.textContent);
        if (!Number.isNaN(parsed)) value = parsed;
      }
    }
    dataRows.push({ row, value, sourceCell });
  }
  if (dataRows.length === 0) {
    throw new Error('Keine Artikelzeilen unterhalb der Kopfzeile gefunden.');
  }

  // Subscription-Hinweis-Feature: separater, additiver Durchlauf über die bereits
  // feststehenden dataRows (Erkennung/Endekriterium oben bleibt unangetastet). Jede
  // Zeile bekommt zusätzlich ihren "Pricing Term (in Months)"-Wert, falls die Spalte
  // im Export vorhanden ist.
  if (pricingTermLetters) {
    for (const dataRow of dataRows) {
      let pricingTermCell = null;
      for (const c of dataRow.row.getElementsByTagName('c')) {
        const ref = parseCellRef(c.getAttribute('r'));
        if (ref && ref.letters === pricingTermLetters) {
          pricingTermCell = c;
          break;
        }
      }
      dataRow.pricingTermMonths = resolvePricingTermMonths(pricingTermCell, sharedStrings);
    }
  }

  return { headerRow, creditsCol, customNameCol, sourceCol, dataRows };
}

// Manche Quotes (z. B. EA-/Subscription-Quotes wie ISE-Lizenzen) haben in JEDER
// Artikelzeile "--"/0 in "Unit Net Price Before Credits" — der reale Gesamtpreis
// steht dort nicht pro Zeile, sondern separat im "Financial Summary"-Block weiter
// oben im Blatt, in einer Zeile mit Label "Quote Total". Komplett eigenständig von
// findQuoteTable: sucht zwei Text-Anker über das ganze Blatt (wie "Credits" oben),
// no-op statt Fehler, wenn eine der beiden Ankertexte fehlt (normale Quotes ohne
// diesen Block bleiben unberührt).
function findQuoteTotalCell(sheetDoc, sharedStrings) {
  const sheetDataEl = sheetDoc.getElementsByTagName('sheetData')[0];
  if (!sheetDataEl) return null;
  const rows = Array.from(sheetDataEl.getElementsByTagName('row'));

  let totalLabelRow = null;
  let totalValueCol = null;
  for (const row of rows) {
    for (const c of row.getElementsByTagName('c')) {
      if (resolveCellText(c, sharedStrings) === HEADER_TEXT_QUOTE_TOTAL_LABEL) {
        totalLabelRow = row;
        break;
      }
    }
    if (totalLabelRow) break;
  }
  for (const row of rows) {
    for (const c of row.getElementsByTagName('c')) {
      if (resolveCellText(c, sharedStrings) === HEADER_TEXT_SPECIAL_ITEMS_TOTAL) {
        const ref = parseCellRef(c.getAttribute('r'));
        if (ref) totalValueCol = ref.colIndex;
        break;
      }
    }
    if (totalValueCol != null) break;
  }
  if (!totalLabelRow || totalValueCol == null) return null;

  const totalValueLetters = colIndexToLetters(totalValueCol);
  let sourceCell = null;
  for (const c of totalLabelRow.getElementsByTagName('c')) {
    const ref = parseCellRef(c.getAttribute('r'));
    if (ref && ref.letters === totalValueLetters) {
      sourceCell = c;
      break;
    }
  }
  // Nur eine plain-numerische Zelle taugt als Quelle — sonst bleibt das Feature
  // stiller No-op statt eines falschen/geratenen Werts.
  if (!sourceCell || sourceCell.getAttribute('t')) return null;
  const vEl = sourceCell.getElementsByTagName('v')[0];
  if (!vEl) return null;
  const value = parseFloat(vEl.textContent);
  if (Number.isNaN(value)) return null;

  return { row: totalLabelRow, sourceCell, value };
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
  const sheetDataEl = sheetDoc.getElementsByTagName('sheetData')[0];

  // Rate row directly above the header row (e.g. row 39 when the header is row 40).
  const rateRow =
    headerRow.previousElementSibling && headerRow.previousElementSibling.tagName === 'row'
      ? headerRow.previousElementSibling
      : null;
  const dateRowNum = rateRow ? parseInt(rateRow.getAttribute('r'), 10) - 1 : null;
  // Sparse XML omits empty rows, so this row (e.g. the date note row) may not exist yet.
  const existingDateRow =
    dateRowNum == null
      ? null
      : Array.from(sheetDataEl.getElementsByTagName('row')).find(
          (row) => parseInt(row.getAttribute('r'), 10) === dateRowNum
        );

  const newColIndex = findFirstFreeColumn(customNameCol + 1, [
    headerRow,
    rateRow,
    existingDateRow,
    ...dataRows.map((d) => d.row),
  ]);
  const newColLetters = colIndexToLetters(newColIndex);

  const creditsHeaderCell = Array.from(headerRow.getElementsByTagName('c')).find(
    (c) => resolveCellText(c, sharedStrings) === HEADER_TEXT_CREDITS
  );
  const headerStyle = creditsHeaderCell ? creditsHeaderCell.getAttribute('s') : null;
  // Not necessarily dataRows[0] — a row can lack a source cell entirely (e.g. a
  // "Requested Start Date" sub-line with no price column at all), so find the
  // first row that actually has one to base the highlighted style on.
  const styleSourceCell = dataRows.find((d) => d.sourceCell)?.sourceCell;
  const dataStyle = styleSourceCell ? styleSourceCell.getAttribute('s') : null;

  const {
    headerStyleId: yellowHeaderStyle,
    dataStyleId: yellowDataStyle,
    rateStyleId,
  } = await addHighlightStyles(zip, headerStyle, dataStyle);

  // Rate cell directly above the header row (e.g. AF39 when the header is row 40).
  // Stored as a plain number (custom number format only adds a display label) so
  // it can be edited in Excel and referenced by the price formulas below — editing
  // it there recalculates every price automatically, no re-upload needed.
  let rateCellRef = null;
  if (rateRow) {
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

  // Date note two rows above the header (e.g. AF38) so it's clear how current the
  // rate is. That row is often entirely empty in the source file (sparse XML omits
  // empty rows), so it may need to be created rather than just appended to.
  if (rateRow) {
    let dateRow = existingDateRow;
    if (!dateRow) {
      dateRow = sheetDoc.createElementNS(NS, 'row');
      dateRow.setAttribute('r', String(dateRowNum));
      dateRow.setAttribute('spans', `${newColIndex}:${newColIndex}`);
      sheetDataEl.insertBefore(dateRow, rateRow);
    } else {
      bumpRowSpans(dateRow, newColIndex);
    }
    const dateCell = sheetDoc.createElementNS(NS, 'c');
    dateCell.setAttribute('r', `${newColLetters}${dateRowNum}`);
    dateCell.setAttribute('s', rateStyleId);
    dateCell.setAttribute('t', 'inlineStr');
    const dateIsEl = sheetDoc.createElementNS(NS, 'is');
    const dateTextEl = sheetDoc.createElementNS(NS, 't');
    dateTextEl.textContent = formatDateDE(new Date());
    dateIsEl.appendChild(dateTextEl);
    dateCell.appendChild(dateIsEl);
    dateRow.appendChild(dateCell);
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
  // so changing the rate in Excel recalculates every price automatically. A
  // formula is only added when there's an actual source cell to reference; rows
  // without one (e.g. a "Requested Start Date" sub-line with no price column at
  // all — possible again now that the table end is anchored on "Part Number"
  // instead of the source cell, see findQuoteTable) get the plain value.
  for (const { row, value, sourceCell } of dataRows) {
    const eur = roundToCents(value / rate);
    const cell = sheetDoc.createElementNS(NS, 'c');
    cell.setAttribute('r', `${newColLetters}${row.getAttribute('r')}`);
    cell.setAttribute('s', yellowDataStyle);
    if (rateCellRef && sourceCell) {
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

  // Subscription-Hinweis-Spalte — rein additiv, direkt hinter "Price EUR". Baut auf
  // der obigen, unveränderten Preis-Schleife auf, verändert aber keine ihrer Zellen:
  // "Price EUR" bleibt eine echte Formel, der Hinweistext lebt in einer eigenen
  // Spalte. Y wird hier unabhängig mit exakt derselben Formel (roundToCents(value /
  // rate)) neu berechnet, damit die obige Schleife unangetastet bleibt.
  const subscriptionRows = dataRows.filter((d) => (d.pricingTermMonths || 0) > 0);
  let noteColIndex = null;
  if (subscriptionRows.length > 0) {
    noteColIndex = findFirstFreeColumn(newColIndex + 1, [
      headerRow,
      rateRow,
      existingDateRow,
      ...dataRows.map((d) => d.row),
    ]);
    const noteColLetters = colIndexToLetters(noteColIndex);

    const noteHeaderCell = sheetDoc.createElementNS(NS, 'c');
    noteHeaderCell.setAttribute('r', `${noteColLetters}${headerRow.getAttribute('r')}`);
    noteHeaderCell.setAttribute('s', yellowHeaderStyle);
    noteHeaderCell.setAttribute('t', 'inlineStr');
    const noteHeaderIsEl = sheetDoc.createElementNS(NS, 'is');
    const noteHeaderTextEl = sheetDoc.createElementNS(NS, 't');
    noteHeaderTextEl.textContent = SUBSCRIPTION_NOTE_HEADER;
    noteHeaderIsEl.appendChild(noteHeaderTextEl);
    noteHeaderCell.appendChild(noteHeaderIsEl);
    headerRow.appendChild(noteHeaderCell);
    bumpRowSpans(headerRow, noteColIndex);

    for (const { row, value, pricingTermMonths } of subscriptionRows) {
      const months = Math.round(pricingTermMonths);
      const eur = roundToCents(value / rate);
      const eurFormatted = `${eur.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
      const noteCell = sheetDoc.createElementNS(NS, 'c');
      noteCell.setAttribute('r', `${noteColLetters}${row.getAttribute('r')}`);
      noteCell.setAttribute('s', rateStyleId);
      noteCell.setAttribute('t', 'inlineStr');
      const noteIsEl = sheetDoc.createElementNS(NS, 'is');
      const noteTextEl = sheetDoc.createElementNS(NS, 't');
      noteTextEl.textContent = `Der Einzelpreis pro ${months} Monate = ${eurFormatted}`;
      noteIsEl.appendChild(noteTextEl);
      noteCell.appendChild(noteIsEl);
      row.appendChild(noteCell);
      bumpRowSpans(row, noteColIndex);
    }
  }

  // Quote-Total-Umrechnung — komplett eigenständig von der Artikeltabelle oben,
  // rein additiv. Manche Quotes (z. B. EA-/Subscription-Quotes) haben in JEDER
  // Artikelzeile "--"/0 in "Unit Net Price Before Credits"; der reale Gesamtpreis
  // steht dort separat im "Financial Summary"-Block ("Quote Total"-Zeile). Nutzt
  // dieselbe Kurs-Zelle/Formel wie "Price EUR" oben, no-op wenn keine der beiden
  // Textanker (siehe findQuoteTotalCell) gefunden wird.
  const quoteTotalCell = findQuoteTotalCell(sheetDoc, sharedStrings);
  if (quoteTotalCell) {
    const { row: totalRow, sourceCell: totalSourceCell, value: totalValue } = quoteTotalCell;
    let totalHeaderRow = null;
    for (const row of Array.from(sheetDataEl.getElementsByTagName('row'))) {
      for (const c of row.getElementsByTagName('c')) {
        if (resolveCellText(c, sharedStrings) === HEADER_TEXT_SPECIAL_ITEMS_TOTAL) {
          totalHeaderRow = row;
          break;
        }
      }
      if (totalHeaderRow) break;
    }
    const totalRowsToCheck = totalHeaderRow ? [totalHeaderRow, totalRow] : [totalRow];
    const totalSourceColIndex = parseCellRef(totalSourceCell.getAttribute('r')).colIndex;
    const totalColIndex = findFirstFreeColumn(totalSourceColIndex + 1, totalRowsToCheck);
    const totalColLetters = colIndexToLetters(totalColIndex);

    if (totalHeaderRow) {
      const totalHeaderCell = sheetDoc.createElementNS(NS, 'c');
      totalHeaderCell.setAttribute('r', `${totalColLetters}${totalHeaderRow.getAttribute('r')}`);
      totalHeaderCell.setAttribute('s', yellowHeaderStyle);
      totalHeaderCell.setAttribute('t', 'inlineStr');
      const totalHeaderIsEl = sheetDoc.createElementNS(NS, 'is');
      const totalHeaderTextEl = sheetDoc.createElementNS(NS, 't');
      totalHeaderTextEl.textContent = QUOTE_TOTAL_EUR_HEADER;
      totalHeaderIsEl.appendChild(totalHeaderTextEl);
      totalHeaderCell.appendChild(totalHeaderIsEl);
      totalHeaderRow.appendChild(totalHeaderCell);
      bumpRowSpans(totalHeaderRow, totalColIndex);
    }

    const totalEurCell = sheetDoc.createElementNS(NS, 'c');
    totalEurCell.setAttribute('r', `${totalColLetters}${totalRow.getAttribute('r')}`);
    totalEurCell.setAttribute('s', yellowDataStyle);
    if (rateCellRef) {
      const fEl = sheetDoc.createElementNS(NS, 'f');
      fEl.textContent = `ROUND(${totalSourceCell.getAttribute('r')}/${rateCellRef},2)`;
      totalEurCell.appendChild(fEl);
    }
    const totalVEl = sheetDoc.createElementNS(NS, 'v');
    totalVEl.textContent = String(roundToCents(totalValue / rate));
    totalEurCell.appendChild(totalVEl);
    totalRow.appendChild(totalEurCell);
    bumpRowSpans(totalRow, totalColIndex);
  }

  // Hide every column between "Credits" and the new "Price EUR" column — not just
  // up to "Custom Name" — so any extra columns Cisco has inserted in between (e.g.
  // "BPA No Subscription Line", which is why newColIndex may sit past customNameCol
  // + 1 in the first place, see findFirstFreeColumn) disappear too and the EUR price
  // visually follows right after the USD price column.
  let colsEl = sheetDoc.getElementsByTagName('cols')[0];
  if (!colsEl) {
    colsEl = sheetDoc.createElementNS(NS, 'cols');
    sheetDataEl.parentNode.insertBefore(colsEl, sheetDataEl);
  }
  const hideCol = sheetDoc.createElementNS(NS, 'col');
  hideCol.setAttribute('min', String(creditsCol));
  hideCol.setAttribute('max', String(newColIndex - 1));
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

  if (noteColIndex != null) {
    const noteColWidth = sheetDoc.createElementNS(NS, 'col');
    noteColWidth.setAttribute('min', String(noteColIndex));
    noteColWidth.setAttribute('max', String(noteColIndex));
    noteColWidth.setAttribute('width', '32');
    noteColWidth.setAttribute('customWidth', '1');
    colsEl.appendChild(noteColWidth);
  }

  // Extend dimension reference
  const dimEl = sheetDoc.getElementsByTagName('dimension')[0];
  if (dimEl) {
    const lastColIndex = noteColIndex != null ? noteColIndex : newColIndex;
    const lastColLetters = noteColIndex != null ? colIndexToLetters(noteColIndex) : newColLetters;
    const m = dimEl.getAttribute('ref').match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
    if (m && colLettersToIndex(m[3]) < lastColIndex) {
      dimEl.setAttribute('ref', `${m[1]}${m[2]}:${lastColLetters}${m[4]}`);
    }
  }

  // createFolders:false avoids JSZip adding synthetic 'xl/' / 'xl/worksheets/'
  // directory entries that aren't present in the original file.
  zip.file(sheetPath, serializeWithDeclaration(sheetDoc), { createFolders: false });

  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    compression: 'DEFLATE',
  });
  return { blob, rateCellRef, subscriptionNoteCount: subscriptionRows.length, quoteTotalConverted: !!quoteTotalCell };
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
  const rateRefreshButton = document.getElementById('rate-refresh-button');
  const rateFetchStatus = document.getElementById('rate-fetch-status');
  const processButton = document.getElementById('process-button');
  const status = document.getElementById('status');
  const footerVersionEl = document.getElementById('app-footer-version');
  const headerVersionEl = document.getElementById('app-header-version');

  footerVersionEl.textContent = `Version ${APP_VERSION}`;
  if (headerVersionEl) headerVersionEl.textContent = `v${APP_VERSION}`;

  bindThemeToggle();
  bindRateAutoFetch(rateInput, rateRefreshButton, rateFetchStatus);

  let selectedFile = null;

  function setStatus(message, state) {
    status.textContent = '';
    if (state) status.setAttribute('data-state', state);
    else status.removeAttribute('data-state');
    if (!message) return;
    if (state === 'error' || state === 'success') {
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('class', 'i');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', 'icons/icon-sprite.svg#' + (state === 'success' ? 'ic-check-circle' : 'ic-error'));
      icon.appendChild(use);
      status.appendChild(icon);
    }
    const span = document.createElement('span');
    span.textContent = message;
    status.appendChild(span);
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
      const { blob, rateCellRef, subscriptionNoteCount, quoteTotalConverted } = await processFile(selectedFile, rate);
      setStatus('Speichere Datei…', null);
      const result = await downloadResult(blob, selectedFile.name);
      if (result === 'cancelled') {
        setStatus('Speichern abgebrochen.', null);
      } else {
        const rateHint = rateCellRef
          ? ` Kurs in ${rateCellRef.replace(/\$/g, '')} anpassen berechnet alle Preise in Excel automatisch neu.`
          : '';
        const noteHint =
          subscriptionNoteCount > 0 ? ` ${subscriptionNoteCount} Subscription-Zeile(n) mit Hinweis versehen.` : '';
        const totalHint = quoteTotalConverted ? ` "${QUOTE_TOTAL_EUR_HEADER}" ergänzt.` : '';
        setStatus(`Fertig — Spalte "${NEW_COLUMN_HEADER}" mit Kurs ${rate} ergänzt.${rateHint}${noteHint}${totalHint}`, 'success');
      }
    } catch (err) {
      console.error(err);
      setStatus(`Fehler: ${err.message}`, 'error');
    } finally {
      processButton.disabled = false;
    }
  });
}

// ─── Automatischer EZB-Kurs (EUR/USD) ─────────────────────────────────────
// Lädt beim Start still einen Vorschlagswert in rate-input, ohne die Feld-
// Freigabe-Logik in initUI zu berühren (Feld bleibt bis zur Dateiauswahl
// disabled, zeigt den Wert aber schon an). Rein additiv, jederzeit von Hand
// überschreibbar — auch bei Fetch-Fehler bleibt manuelle Eingabe möglich.
function bindRateAutoFetch(rateInput, rateRefreshButton, rateFetchStatus) {
  if (!rateInput || !rateRefreshButton || !rateFetchStatus) return;

  function setRateFetchStatus(message, state) {
    rateFetchStatus.textContent = '';
    if (state) rateFetchStatus.setAttribute('data-state', state);
    else rateFetchStatus.removeAttribute('data-state');
    if (!message) return;
    if (state === 'error' || state === 'success') {
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('class', 'i');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', 'icons/icon-sprite.svg#' + (state === 'success' ? 'ic-check-circle' : 'ic-error'));
      icon.appendChild(use);
      rateFetchStatus.appendChild(icon);
    }
    const span = document.createElement('span');
    span.textContent = message;
    rateFetchStatus.appendChild(span);
  }

  async function loadRate() {
    rateRefreshButton.disabled = true;
    setRateFetchStatus('Kurs wird geladen…', null);
    try {
      const { rate, date } = await fetchEurUsdRate();
      rateInput.value = rate.toFixed(4).replace('.', ',');
      const dateHint = date ? ` (EZB-Referenzkurs vom ${formatDateDE(date)})` : '';
      setRateFetchStatus(`Kurs automatisch geladen${dateHint} — bei Bedarf überschreiben.`, 'success');
    } catch (err) {
      console.error(err);
      setRateFetchStatus('Kurs konnte nicht automatisch geladen werden — bitte manuell eingeben.', 'error');
    } finally {
      rateRefreshButton.disabled = false;
    }
  }

  rateRefreshButton.addEventListener('click', loadRate);
  loadRate();
}

// ─── Theme toggle (Hell/Automatisch/Dunkel, wie im Bechtle Design System
//      vorgesehen — siehe design-system/README.md "Theme-Toggle") ───────
function bindThemeToggle() {
  const container = document.getElementById('theme-toggle');
  if (!container) return;
  const buttons = container.querySelectorAll('[data-theme]');

  function applyTheme(theme) {
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.theme === theme)));
    if (theme === 'auto') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }

  const saved = localStorage.getItem('cpe-ui-theme') || 'auto';
  applyTheme(saved);

  container.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-theme]');
    if (!btn) return;
    const theme = btn.dataset.theme;
    applyTheme(theme);
    localStorage.setItem('cpe-ui-theme', theme);
  });
}

document.addEventListener('DOMContentLoaded', initUI);
