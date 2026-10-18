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
  root.CVIWA = root.CVIWA || {};
  root.CVIWA.csv = { parse };
})(typeof window !== 'undefined' ? window : globalThis);
