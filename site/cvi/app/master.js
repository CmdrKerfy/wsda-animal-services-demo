/* Master load + normalization: port of CVI shiny/R/master_loader.R load_master_csv().
 * Rows become objects keyed by the original header names. Missing values are null. */
(function (root) {
  'use strict';
  const REQUIRED = ['Species.Group', 'Reporting.Year', 'Reporting.Quarter', 'Movement', 'Total.Animals',
    'Origin.State', 'Dest.State', 'Origin.County', 'Origin.County.Lat', 'Origin.County.Long',
    'Dest.County', 'Dest.County.Lat', 'Dest.County.Long'];
  const NUMERIC = ['Origin.County.Lat', 'Origin.County.Long', 'Dest.County.Lat', 'Dest.County.Long'];

  // R as.numeric() on a character value: surrounding white space allowed; decimal/exponent/hex/Inf forms; else NA.
  function asNumeric(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return Number.isNaN(v) ? null : v;
    const s = String(v).trim();
    if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return Number(s);
    if (/^[+-]?0[xX][0-9a-fA-F]+$/.test(s)) return (s[0] === '-' ? -1 : 1) * parseInt(s.replace(/^[+-]/, ''), 16);
    if (/^[+-]?(inf|infinity)$/i.test(s)) return s[0] === '-' ? -Infinity : Infinity;
    return null;
  }
  // R as.integer(): as.numeric then truncation toward zero (|x| >= 2^31 -> NA).
  function asInteger(v) {
    const x = asNumeric(v);
    if (x === null || !Number.isFinite(x) || Math.abs(x) >= 2147483648) return null;
    return Math.trunc(x);
  }

  // CVI's movement names: the import, export and intrastate spellings (trimmed, any case) become Inbound, Outbound
  // and Intrastate; any other value is kept as written.
  function normalizeMovement(m) {
    if (m === null) return null;
    const t = m.trim().toLowerCase();
    if (t === 'import' || t === 'imports' || t === 'inbound') return 'Inbound';
    if (t === 'export' || t === 'exports' || t === 'outbound') return 'Outbound';
    if (t === 'intrastate') return 'Intrastate';
    return m;
  }
  const stripCounty = c => c === null ? null : c.replace(/\s+County$/i, '');
  const SOURCE_ROW = Symbol('source row');

  // Reads a master CSV's text: its rows as objects (an intrastate row as an Inbound and an Outbound copy) with the
  // picker choices and counts the page shows, or an error naming the required columns it lacks.
  function load(text) {
    const parsed = root.CVIWA.csv.parse(text);
    // A column named "__proto__" cannot be a key of a row object (setting it changes the object instead), so it is
    // left out; every other name is kept.
    const header = parsed.header.filter(h => h !== '__proto__');
    const missing = REQUIRED.filter(c => header.indexOf(c) < 0);
    if (missing.length) {
      // Plain words in place of CVI's "Re-run Steps 3-5 on this data first", a step of CVI's own R pipeline that
      // users of these pages do not have (docs/DELIBERATE_DIFFERENCES.md).
      return { ok: false, error: 'Master CSV missing ' + (missing.length === 1 ? 'the column ' : 'the columns ') +
        missing.join(', ') + '. Ask for a CVI master table with all ' + REQUIRED.length + ' required columns ' +
        '(listed under "What data does this need?" on the landing page).' };
    }
    const physical = parsed.rows.length;
    let nonNumericAnimals = 0;
    const base = parsed.rows.map((r, i) => {
      const o = {};
      Object.defineProperty(o, SOURCE_ROW, { value: i });
      parsed.header.forEach((h, k) => { if (h !== '__proto__') o[h] = r[k] === undefined ? null : r[k]; });
      o['Reporting.Year'] = asInteger(o['Reporting.Year']);
      const rawAnimals = o['Total.Animals'];
      o['Total.Animals'] = asNumeric(rawAnimals);
      if (o['Total.Animals'] === null) nonNumericAnimals++;
      const q = o['Reporting.Quarter'];
      o['Reporting.Quarter'] = q !== null && /^[1-4]$/.test(q) ? 'Q' + q : q;
      o.Movement = normalizeMovement(o.Movement);
      NUMERIC.forEach(c => { o[c] = asNumeric(o[c]); });
      o['Origin.County'] = stripCounty(o['Origin.County']);
      o['Dest.County'] = stripCounty(o['Dest.County']);
      return o;
    });
    // Intrastate (WA->WA) rows count as BOTH inbound (at destination) and outbound (at origin): rbind order is
    // non-intrastate rows, then the Inbound copies, then the Outbound copies (master_loader.R).
    const intra = base.filter(o => o.Movement === 'Intrastate');
    // Each copy keeps the number of the file row it came from (SOURCE_ROW, hidden: not a column, not enumerated).
    const copy = (o, movement) => Object.defineProperty(Object.assign({}, o, { Movement: movement }), SOURCE_ROW,
      { value: o[SOURCE_ROW] });
    const rows = base.filter(o => o.Movement !== 'Intrastate')
      .concat(intra.map(o => copy(o, 'Inbound')))
      .concat(intra.map(o => copy(o, 'Outbound')));
    const species = [...new Set(rows.map(o => o['Species.Group']).filter(s => s !== null && s !== ''))].sort(collate);
    const years = [...new Set(rows.map(o => o['Reporting.Year']).filter(y => y !== null))].sort((a, b) => a - b);
    return { ok: true, rows, header, hasSpecies: header.indexOf('Species') >= 0,
      physicalRows: physical, mapRows: rows.length, intrastateRows: intra.length,
      missingAnimalCells: nonNumericAnimals, speciesChoices: species, yearChoices: years };
  }
  const collate = (a, b) => a.localeCompare(b, 'en');
  root.CVIWA = root.CVIWA || {};
  root.CVIWA.master = { load, asNumeric, asInteger, normalizeMovement, REQUIRED, collate, SOURCE_ROW };
})(typeof window !== 'undefined' ? window : globalThis);
