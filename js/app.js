// thought up by human, coded by ai
'use strict';

const APP_VERSION = '0.15.0';

const HEADER_TEXT_CREDITS = 'Credits';
const HEADER_TEXT_CUSTOM_NAME = 'Custom Name';
const HEADER_TEXT_SOURCE_PRICE = 'Unit Net Price Before Credits';
const HEADER_TEXT_PART_NUMBER = 'Part Number';
const HEADER_TEXT_PRICING_TERM = 'Pricing Term (in Months)';
const HEADER_TEXT_LIST_PRICE = 'Unit List Price';
const NEW_COLUMN_HEADER = 'Price EUR';
const SUBSCRIPTION_NOTE_HEADER = 'Preishinweis';
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
  // No `t` attribute means a plain number (OOXML default) — e.g. "Pricing Term
  // (in Months)" is written as a real number in some quotes and as an (often
  // empty) shared string in others, so this has to resolve both the same way.
  const vEl = cellEl.getElementsByTagName('v')[0];
  return vEl ? vEl.textContent : null;
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

// OOXML requires <c> elements within a <row> to appear in ascending column order.
// Our new columns aren't always the last one in the row — some real exports have
// further columns after "Custom Name" (see findFirstFreeColumn) — so a plain
// appendChild would put the new cell after those, producing a file Excel flags
// as needing "repair". This inserts it at the correct sorted position instead.
function insertCellInOrder(rowEl, cellEl, colIndex) {
  const nextCell = Array.from(rowEl.getElementsByTagName('c')).find((c) => {
    const ref = parseCellRef(c.getAttribute('r'));
    return ref && ref.colIndex > colIndex;
  });
  if (nextCell) rowEl.insertBefore(cellEl, nextCell);
  else rowEl.appendChild(cellEl);
}

function roundToCents(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatDateDE(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${date.getFullYear()}`;
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
  let listPriceCol = null;
  let alreadyProcessed = false;
  for (const c of headerRow.getElementsByTagName('c')) {
    const text = resolveCellText(c, sharedStrings);
    const ref = parseCellRef(c.getAttribute('r'));
    if (!ref) continue;
    if (text === HEADER_TEXT_CREDITS) creditsCol = ref.colIndex;
    else if (text === HEADER_TEXT_CUSTOM_NAME) customNameCol = ref.colIndex;
    else if (text === HEADER_TEXT_SOURCE_PRICE) sourceCol = ref.colIndex;
    else if (text === HEADER_TEXT_PART_NUMBER) partNumberCol = ref.colIndex;
    else if (text === HEADER_TEXT_PRICING_TERM) pricingTermCol = ref.colIndex;
    else if (text === HEADER_TEXT_LIST_PRICE) listPriceCol = ref.colIndex;
    else if (text === NEW_COLUMN_HEADER) alreadyProcessed = true;
  }
  // Feeding an already-processed file (with its own "Price EUR" column) back in
  // would otherwise silently add a second, colliding "Price EUR" column next to
  // the first — always process the original Cisco export, never a previous
  // output of this tool.
  if (alreadyProcessed) {
    throw new Error(
      `Diese Datei enthält bereits eine Spalte "${NEW_COLUMN_HEADER}" — sie wurde offenbar schon einmal verarbeitet. Bitte die ursprüngliche, unveränderte Cisco-Quote verwenden.`
    );
  }
  if (creditsCol == null || customNameCol == null || sourceCol == null || partNumberCol == null) {
    throw new Error(
      `Erwartete Spalten ("${HEADER_TEXT_CREDITS}", "${HEADER_TEXT_CUSTOM_NAME}", "${HEADER_TEXT_SOURCE_PRICE}", "${HEADER_TEXT_PART_NUMBER}") nicht vollständig gefunden.`
    );
  }
  // "Pricing Term (in Months)" and "Unit List Price" are optional — older/other
  // export variants may not have them. Without "Pricing Term", no row can be
  // identified as a subscription line (note column stays a no-op, and the
  // source-price swap below never triggers). Without "Unit List Price", a
  // subscription row just falls back to the normal source price column.
  const pricingTermLetters = pricingTermCol != null ? colIndexToLetters(pricingTermCol) : null;
  const listPriceLetters = listPriceCol != null ? colIndexToLetters(listPriceCol) : null;

  const sourceLetters = colIndexToLetters(sourceCol);
  const partNumberLetters = colIndexToLetters(partNumberCol);
  const headerIndex = rows.indexOf(headerRow);
  const dataRows = [];
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    let sourceCell = null;
    let partNumberCell = null;
    let pricingTermCell = null;
    let listPriceCell = null;
    for (const c of row.getElementsByTagName('c')) {
      const ref = parseCellRef(c.getAttribute('r'));
      if (!ref) continue;
      if (ref.letters === sourceLetters) sourceCell = c;
      else if (ref.letters === partNumberLetters) partNumberCell = c;
      else if (pricingTermLetters && ref.letters === pricingTermLetters) pricingTermCell = c;
      else if (listPriceLetters && ref.letters === listPriceLetters) listPriceCell = c;
    }
    // "Part Number" is the reliable per-row anchor for "this is still an item
    // row" — unlike the source price, which Cisco writes as a text placeholder
    // ("--") rather than a number for lines with no price of their own (e.g.
    // bundle child/sub-lines), so it can't double as an end-of-table signal.
    const partNumberText = partNumberCell ? resolveCellText(partNumberCell, sharedStrings) : null;
    if (!partNumberText) break;

    // Pricing Term is sometimes a shared-string cell with an *empty* string
    // (no term set) rather than a plain number — reading its raw <v> text
    // directly would misread the shared-string index as the month count, so
    // this has to go through resolveCellText to actually dereference it.
    const pricingTermText = pricingTermCell ? resolveCellText(pricingTermCell, sharedStrings) : null;
    const parsedTerm = pricingTermText ? parseFloat(pricingTermText) : NaN;
    const pricingTermMonths = Number.isNaN(parsedTerm) ? 0 : parsedTerm;

    // Subscription lines carry their real price in "Unit List Price", not
    // "Unit Net Price Before Credits" (which Cisco leaves as "--" for them —
    // that price is a per-transaction net price, not meaningful per license).
    const priceCell = pricingTermMonths > 0 && listPriceCell ? listPriceCell : sourceCell;

    // Every item row gets a Price EUR value, even 0,00 — a missing/textual
    // source price (e.g. Cisco's "--" placeholder) just defaults to 0.
    let value = 0;
    if (priceCell && !priceCell.getAttribute('t')) {
      const vEl = priceCell.getElementsByTagName('v')[0];
      if (vEl) {
        const parsed = parseFloat(vEl.textContent);
        if (!Number.isNaN(parsed)) value = parsed;
      }
    }

    dataRows.push({ row, value, sourceCell: priceCell, pricingTermMonths });
  }
  if (dataRows.length === 0) {
    throw new Error('Keine Artikelzeilen unterhalb der Kopfzeile gefunden.');
  }

  return { headerRow, creditsCol, customNameCol, sourceCol, pricingTermCol, dataRows };
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
    insertCellInOrder(rateRow, rateCell, newColIndex);
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
    insertCellInOrder(dateRow, dateCell, newColIndex);
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
  insertCellInOrder(headerRow, headerCell, newColIndex);
  bumpRowSpans(headerRow, newColIndex);

  // New data cells — a real formula referencing the rate cell when available,
  // so changing the rate in Excel recalculates every price automatically.
  // Every item row gets a cell, even one showing 0,00 (no usable source price
  // just means a plain 0 value — see the "Every item row gets a Price EUR
  // value" comment in findQuoteTable). A formula is only added when there's
  // an actual source cell to reference; rows without one (e.g. a "Requested
  // Start Date" sub-line with no price column at all) get the plain value.
  for (const dataRow of dataRows) {
    const { row, value, sourceCell } = dataRow;
    const eur = roundToCents(value / rate);
    dataRow.eur = eur; // reused below for the subscription note column
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
    insertCellInOrder(row, cell, newColIndex);
    bumpRowSpans(row, newColIndex);
  }

  // Subscription note column — "Pricing Term (in Months)" > 0 marks a subscription
  // line. The note has to live in its own column rather than inside the "Price EUR"
  // cell itself: that cell holds a live formula (see above), and turning it into a
  // text string there would silently kill the auto-recalculation on rate changes.
  const subscriptionRows = dataRows.filter((d) => d.pricingTermMonths > 0 && d.eur != null);
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
    insertCellInOrder(headerRow, noteHeaderCell, noteColIndex);
    bumpRowSpans(headerRow, noteColIndex);

    for (const { row, eur, pricingTermMonths } of subscriptionRows) {
      const months = Math.round(pricingTermMonths);
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
      insertCellInOrder(row, noteCell, noteColIndex);
      bumpRowSpans(row, noteColIndex);
    }
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
  return { blob, rateCellRef, subscriptionNoteCount: subscriptionRows.length };
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
  const footerVersionEl = document.getElementById('app-footer-version');
  const headerVersionEl = document.getElementById('app-header-version');

  footerVersionEl.textContent = `Version ${APP_VERSION}`;
  if (headerVersionEl) headerVersionEl.textContent = `v${APP_VERSION}`;

  bindThemeToggle();

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
      const { blob, rateCellRef, subscriptionNoteCount } = await processFile(selectedFile, rate);
      setStatus('Speichere Datei…', null);
      const result = await downloadResult(blob, selectedFile.name);
      if (result === 'cancelled') {
        setStatus('Speichern abgebrochen.', null);
      } else {
        const rateHint = rateCellRef
          ? ` Kurs in ${rateCellRef.replace(/\$/g, '')} anpassen berechnet alle Preise in Excel automatisch neu.`
          : '';
        const noteHint = subscriptionNoteCount > 0 ? ` ${subscriptionNoteCount} Subscription-Zeile(n) mit Hinweis versehen.` : '';
        setStatus(`Fertig — Spalte "${NEW_COLUMN_HEADER}" mit Kurs ${rate} ergänzt.${rateHint}${noteHint}`, 'success');
      }
    } catch (err) {
      console.error(err);
      setStatus(`Fehler: ${err.message}`, 'error');
    } finally {
      processButton.disabled = false;
    }
  });
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
