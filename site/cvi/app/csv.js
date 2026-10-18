/* RFC 4180 CSV parser for master-shaped tables. Mirrors the parts of data.table::fread that CVI's
 * load_master_csv() relies on: UTF-8 BOM dropped, CRLF or LF rows, quoted fields with embedded commas,
 * quotes and newlines, white space trimmed on UNquoted fields (strip.white), and na.strings c("", "NA")
 * applied to unquoted cells (returned as null). */
(function (root) {
  'use strict';
  // A CSV text as its header (the first row; a missing name as "") and its other rows, each a list of cells.
  function parse(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const rows = [];
    let row = [], i = 0;
    const n = text.length;
    while (i <= n) {
      let cell, quoted = false;
      if (text[i] === '"') {
        quoted = true; i++;
        let buf = '';
        for (;;) {
          if (i >= n) break;
          const c = text[i];
          if (c === '"') { if (text[i + 1] === '"') { buf += '"'; i += 2; continue; } i++; break; }
          buf += c; i++;
        }
        // tolerate stray characters between the closing quote and the delimiter
        while (i < n && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') buf += text[i++];
        cell = buf;
      } else {
        let j = i;
        while (j < n && text[j] !== ',' && text[j] !== '\n' && text[j] !== '\r') j++;
        cell = text.slice(i, j).trim();
        i = j;
      }
      row.push(quoted ? cell : (cell === '' || cell === 'NA' ? null : cell));
      if (i >= n) { rows.push(row); break; }
      const c = text[i];
      if (c === ',') { i++; continue; }
      if (c === '\r' && text[i + 1] === '\n') i++;
      i++;
      rows.push(row); row = [];
      if (i >= n) break;
    }
    // drop trailing blank lines
    while (rows.length && rows[rows.length - 1].every(v => v === null)) rows.pop();
    const header = rows.length ? rows[0].map(h => h === null ? '' : h) : [];
    return { header, rows: rows.slice(1) };
  }
  // A file read as UTF-8 holds the replacement character U+FFFD where its bytes were not UTF-8 (Excel's plain "CSV"
  // is Windows-1252), so its accented letters show as "\uFFFD". The load statuses then add NOT_UTF8_ADVICE.
  const notUtf8 = text => String(text).indexOf('\uFFFD') >= 0;
  const NOT_UTF8_ADVICE = 'in Excel, use Save As, then CSV UTF-8.';
  // The note for one named file (facility files, listed under their layers).
  const notUtf8Note = name => name + ' may not be UTF-8: ' + NOT_UTF8_ADVICE;
  root.CVIWA = root.CVIWA || {};
  root.CVIWA.csv = { parse, notUtf8, NOT_UTF8_ADVICE, notUtf8Note };
})(typeof window !== 'undefined' ? window : globalThis);
