/* Export and preview rules for the CVI page: CVI's Export & Preview section (mod_maps.R: the Export button,
 * .build_summary_lines, Preview Map Data, Preview Stats and Preview Charts) with these deliberate differences: one
 * ZIP download per export, holding CVI's folder and files; the rows the map draws used everywhere ("Refine by
 * species" applied, National Flow Combined without WA-to-WA rows); summary_table.csv without line_width_px; CSV text
 * written exactly as CVI's writer (data.table::fwrite) writes it. Pure functions: no page, file or download code. */
(function (root) {
  'use strict';
  const S = () => root.CVIWA.scaling;
  const SUM = () => root.CVIWA.summary;
  const CH = () => root.CVIWA.charts;
  const collate = (a, b) => a.localeCompare(b, 'en');          // R's sort()
  const cmpC = (a, b) => (a < b ? -1 : a > b ? 1 : 0);          // dplyr's group order (C locale)
  const text = v => (v === null || v === undefined ? null : String(v));

  // ── Numbers as CVI's CSV writer writes them ────────────────────────────────────────────────────────────────
  // data.table::fwrite writes a double with up to 15 significant digits, trailing zeros dropped, in scientific
  // form only when that is shorter (100000 is "1e+05", 1500000 stays "1500000"); a missing value or NaN is an
  // empty field. Its digits come from its own method, not from correct rounding: the binary fraction is summed
  // from the smallest part up, scaled by the power of two over a power of ten, and the 16th digit rounds the 15th.
  // On this platform (64-bit long double, as on Apple silicon) that differs from correct rounding in the 15th
  // digit for a few values with 16 or more digits; the reference checks it on 2,939 numbers.
  const bits = new DataView(new ArrayBuffer(8));
  // A positive number's significant digits (trailing zeros dropped) and its power of ten, by fwrite's method.
  function fwriteDigits(x) {
    bits.setFloat64(0, x);
    const hi = bits.getUint32(0);
    const exponent = (hi >>> 20) & 0x7ff;
    let fraction = (BigInt(hi & 0xfffff) << 32n) | BigInt(bits.getUint32(4));
    let acc = 0;
    let i = 52;
    if (fraction) {
      while ((fraction & 0xffn) === 0n) { fraction >>= 8n; i -= 8; }
      while (fraction) {
        if (fraction & 1n) acc += Math.pow(2, -i);
        i--;
        fraction >>= 1n;
      }
    }
    const p2 = Math.pow(2, exponent - 1023);
    let e10 = Math.floor(Math.log10(p2));
    // The power of two over the power of ten; below 1 multiplied by the (exact) inverse power of ten.
    const scale = e10 < 0 ? p2 * Math.pow(10, -e10) : p2 / Math.pow(10, e10);
    let y = (1 + acc) * scale;
    if (y >= 10) { y /= 10; e10++; }
    let l = BigInt(Math.floor(y * 1e15));
    if (l % 10n >= 5n) l += 10n;
    l /= 10n;
    let digits = l.toString();
    if (digits.length > 15) { digits = digits.slice(0, 15); e10++; }   // rounded up to a power of ten
    return { digits: digits.replace(/0+$/, '') || '0', e: e10 };
  }
  // A number as fwrite writes it: fixed or scientific form, whichever is shorter; Inf and -Inf by name.
  function fwriteNumber(x) {
    if (x === null || x === undefined || Number.isNaN(x)) return '';
    if (x === Infinity) return 'Inf';
    if (x === -Infinity) return '-Inf';
    if (x === 0) return '0';
    const sign = x < 0 ? '-' : '';
    const { digits, e } = fwriteDigits(Math.abs(x));
    const sci = digits[0] + (digits.length > 1 ? '.' + digits.slice(1) : '') + 'e'
      + (e < 0 ? '-' : '+') + String(Math.abs(e)).padStart(2, '0');
    let fixed;
    if (e < 0) {
      fixed = '0.' + '0'.repeat(-e - 1) + digits;
    } else if (digits.length <= e + 1) {
      fixed = digits + '0'.repeat(e + 1 - digits.length);
    } else {
      fixed = digits.slice(0, e + 1) + '.' + digits.slice(e + 1);
    }
    return sign + (fixed.length <= sci.length ? fixed : sci);
  }
  // A text field: quoted, with quotes doubled, when it holds a comma, a quote or a line break; an empty text is "".
  function csvText(s) {
    if (s === null || s === undefined) return '';
    if (s === '') return '""';
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // ── Column types as CVI reads the master ───────────────────────────────────────────────────────────────────
  // CVI's loader reads the file with data.table::fread, which gives each column one type from all its values:
  // true/false text (TRUE, True, true and the FALSE forms) is logical; whole numbers are integers (leading zeros
  // dropped: ZIP 01234 becomes 1234), larger ones 64-bit integers; other numbers doubles; ISO dates (2024-1-5
  // included) dates; ISO date-times UTC times; anything else, or a mix, text. A column with no value is logical.
  // The loader then makes Reporting.Year an integer, Total.Animals a double, and Reporting.Quarter, Movement and the
  // two county names text. Approved limit: the four county coordinate columns are read by the page as numbers, so a
  // coordinate that is not a number is written empty (CVI's file keeps the text).
  const LADDER = ['logical', 'integer', 'integer64', 'double', 'date', 'datetime', 'character'];
  const LOADER_TYPES = { 'Reporting.Year': 'integer', 'Total.Animals': 'double', 'Reporting.Quarter': 'character',
    Movement: 'character', 'Origin.County': 'character', 'Dest.County': 'character', 'Origin.County.Lat': 'double',
    'Origin.County.Long': 'double', 'Dest.County.Lat': 'double', 'Dest.County.Long': 'double' };
  const LOGICAL = /^(TRUE|True|true|FALSE|False|false)$/;
  const INTEGER = /^[+-]?\d+$/;
  const DOUBLE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$|^[+-]?Inf$|^NaN$/;
  const DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
  const DATETIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d+)?Z?$/;
  // Whether year y, month m and day d make a real calendar date (no February 30).
  function validDate(y, m, d) {
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  }
  // The types one value can be read as.
  function typesOf(v) {
    if (LOGICAL.test(v)) return ['logical', 'character'];
    if (INTEGER.test(v)) {
      const n = BigInt(v);
      if (n >= -2147483647n && n <= 2147483647n) return ['integer', 'integer64', 'double', 'character'];
      if (n >= -9223372036854775807n && n <= 9223372036854775807n) return ['integer64', 'double', 'character'];
      return ['double', 'character'];
    }
    if (DOUBLE.test(v)) return ['double', 'character'];
    let m = DATE.exec(v);
    if (m && validDate(+m[1], +m[2], +m[3])) return ['date', 'character'];
    m = DATETIME.exec(v);
    if (m && validDate(+m[1], +m[2], +m[3]) && +m[4] < 24 && +m[5] < 60 && +m[6] < 60) return ['datetime', 'character'];
    return ['character'];
  }
  // The type each column of the loaded master is read as: the loader's own types for its columns, else the first
  // type on the ladder that every nonblank value in the column can be read as.
  function columnTypes(loaded) {
    const types = Object.create(null);   // keyed by the file's column names
    loaded.header.forEach(h => {
      if (Object.prototype.hasOwnProperty.call(LOADER_TYPES, h)) { types[h] = LOADER_TYPES[h]; return; }
      let allowed = new Set(LADDER);
      for (const r of loaded.rows) {
        const v = r[h];
        if (v === null || v === undefined || v === '') continue;
        const can = new Set(typesOf(v));
        allowed = new Set([...allowed].filter(t => can.has(t)));
        if (allowed.size === 1) break;
      }
      types[h] = LADDER.find(t => allowed.has(t));
    });
    return types;
  }
  // One value written as CVI writes a value of that type.
  function fieldText(v, type) {
    if (v === null || v === undefined) return '';
    if (type === 'character') return csvText(String(v));
    if (v === '') return '';
    if (type === 'double') return fwriteNumber(typeof v === 'number' ? v : Number(String(v).replace(/^\+/, '')));
    if (type === 'integer' || type === 'integer64') return typeof v === 'number' ? String(v) : BigInt(v).toString();
    if (type === 'logical') return /^t/i.test(v) ? 'TRUE' : 'FALSE';
    if (type === 'date') {
      const m = DATE.exec(v);
      return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
    }
    const m = DATETIME.exec(v);   // datetime: ISO with T and Z; fractions as milliseconds
    const ms = m[7] ? '.' + (m[7].slice(1) + '000').slice(0, 3) : '';
    return m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6] + ms + 'Z';
  }
  // A table as CVI's writer writes it: a header line, one line per row, each line ending in a line feed.
  function csv(columns, rows, types) {
    const lines = [columns.map(csvText).join(',')];
    rows.forEach(r => lines.push(columns.map(c => fieldText(r[c], types[c])).join(',')));
    return lines.join('\n') + '\n';
  }

  // ── The files ──────────────────────────────────────────────────────────────────────────────────────────────
  // filtered_rows.csv: the rows the map draws, with the loader's two copies of a WA-to-WA row merged (CVI's export
  // merges them), every master column in the file's order.
  function filteredRowsCsv(loaded, mapRows, types) {
    const rows = SUM().dedupeVolume(mapRows);
    return { text: csv(loaded.header, rows, types || columnTypes(loaded)), rows: rows.length };
  }

  // The aggregated rows behind the map (one per circle, line or premises), with CVI's columns in CVI's order.
  // CVI's preview and summary_table.csv leave out the drawing columns; line_width_px is left out of both here
  // (by design; CVI's summary_table.csv keeps it).
  const TABLE_COLUMNS = {
    wa: [['county', 'character'], ['lat', 'double'], ['lon', 'double'], ['total_animals', 'double'],
      ['direction', 'character'], ['stroke_color', 'character']],
    flow: [['state', 'character'], ['species_group', 'character'], ['total_animals', 'double'],
      ['species_breakdown', 'character'], ['dest_lat', 'double'], ['dest_lon', 'double']],
    // With "Combine species" CVI's builder puts the total before the group.
    flowCombined: [['state', 'character'], ['total_animals', 'double'], ['species_group', 'character'],
      ['species_breakdown', 'character'], ['dest_lat', 'double'], ['dest_lon', 'double']],
    focus: [['lon', 'double'], ['lat', 'double'], ['total_animals', 'double'], ['n_shipments', 'integer'],
      ['n_cvis', 'integer'], ['city', 'character'], ['state', 'character'], ['county', 'character'],
      ['direction', 'character'], ['premises_id', 'character']]
  };
  // The summary table's columns and their types for a view (National Flow with directions combined has its own).
  function tableColumns(view, combine) {
    return TABLE_COLUMNS[view === 'flow' && combine ? 'flowCombined' : view];
  }
  // summary_table.csv from the page's own rows (aggregate.build, flow.lines or focus.build().premises).
  function summaryTableCsv(view, aggRows, combine) {
    if (!aggRows || !aggRows.length) return null;
    const cols = tableColumns(view, combine);
    const types = {};
    cols.forEach(([c, t]) => { types[c] = t; });
    return csv(cols.map(c => c[0]), aggRows, types);
  }

  // x with d decimals as R prints it (sprintf): from the number's exact binary value, an exact half going to the
  // even neighbor (JavaScript's toFixed takes the larger one).
  function fixedR(x, d) {
    const exact = Math.abs(x).toFixed(100);
    const cut = exact.indexOf('.') + 1 + d;
    if (!/^50*$/.test(exact.slice(cut))) return x.toFixed(d);
    const kept = exact.slice(0, cut).replace(/\.$/, '');   // the digits before the half
    const even = Number(kept[kept.length - 1]) % 2 === 0;
    const rounded = even ? kept : (Number(kept) + Math.pow(10, -d)).toFixed(d);
    return (x < 0 ? '-' : '') + rounded;
  }
  // R's round(x, d) (R 4, src/nmath/fround.c): the two candidates below and above x with d decimals, the closer
  // one as measured in double arithmetic, the even one on a tie. Not the same as rounding the exact value:
  // 46.9645 gives 46.964 and 46.9835 gives 46.984.
  function roundR(x, d) {
    if (!Number.isFinite(x) || x === 0) return x;
    const sign = x < 0 ? -1 : 1;
    const ax = Math.abs(x);
    if (Math.log10(ax) + d > 15) return x;
    const p = Math.pow(10, d);
    const x10 = p * ax;
    const i10 = Math.floor(x10);
    const down = i10 / p;
    const up = Math.ceil(x10) / p;
    const du = up - ax;
    const dd = ax - down;
    return sign * (du < dd || (du === dd && i10 % 2 === 1) ? up : down);
  }
  const round3 = x => roundR(x, 3);
  // Preview Map Data: the same rows and columns; in a number column that is not all whole numbers, values are
  // rounded to 3 decimals. Title and footer as CVI's dialog.
  function mapDataPreview(view, aggRows, combine) {
    const cols = tableColumns(view, combine);
    const rows = aggRows.map(r => cols.map(([c]) => (r[c] === undefined ? null : r[c])));
    cols.forEach(([c, t], j) => {
      if (t === 'character') return;
      const whole = rows.every(r => r[j] === null || Number.isInteger(r[j]));
      if (!whole) rows.forEach(r => { if (r[j] !== null) r[j] = round3(r[j]); });
    });
    return { title: 'Map data preview — ' + S().comma(rows.length) + ' rows', columns: cols.map(c => c[0]), rows,
      footer: 'One row per circle/line on the map. Same as the Aggregated totals (.csv) export.' };
  }

  // ── The Stats text (CVI's .build_summary_lines) ────────────────────────────────────────────────────────────
  // format(x, big.mark = ",") for one value: R's layout (7 significant digits, fixed or scientific) and its digits.
  function fmt(x) {
    const s = S().formatR([x])[0].trim();
    if (!Number.isFinite(x) || /e/.test(s)) return s;
    const decimals = s.indexOf('.') < 0 ? 0 : s.length - s.indexOf('.') - 1;
    return fixedR(x, decimals).replace(/^(-?)(\d+)/, (m, sg, int) => sg + int.replace(/\B(?=(\d{3})+(?!\d))/g, ','));
  }
  const twoDigits = n => String(n).padStart(2, '0');
  // format(Sys.time()): local date and time, "YYYY-MM-DD HH:MM:SS".
  function localTime(d) {
    return d.getFullYear() + '-' + twoDigits(d.getMonth() + 1) + '-' + twoDigits(d.getDate()) + ' '
      + twoDigits(d.getHours()) + ':' + twoDigits(d.getMinutes()) + ':' + twoDigits(d.getSeconds());
  }
  const localDate = d => localTime(d).slice(0, 10);
  // The year label of the stats and export names: one year, or "first-last".
  function yearLabel(years) {
    const y = years.map(Number);
    const lo = Math.min(...y), hi = Math.max(...y);
    return lo === hi ? String(lo) : lo + '-' + hi;
  }
  // The quarters in the Stats text, "Q1, Q2, Q3, Q4" (CVI writes them run together, "Q1Q2Q3Q4").
  const quarterLabel = quarters => quarters.slice().sort(collate).join(', ');
  // The direction as CVI's export names it: the WA map's picks, Flow's choice, County Focus's word as Inbound,
  // Outbound or both.
  function directionRaw(view, f) {
    if (view === 'wa') return f.direction.slice();
    if (view === 'flow') return [f.direction];
    return f.direction === 'inbound' ? ['Inbound'] : f.direction === 'outbound' ? ['Outbound'] : ['Inbound', 'Outbound'];
  }
  const MAP_TAG = { wa: 'County', flow: 'Flow', focus: 'Focus' };

  // Unique CVIs as the value box counts them (distinct nonblank CVI numbers), or why there is no number.
  const hasCviColumn = rows => !rows.length || rows.some(r => Object.prototype.hasOwnProperty.call(r, 'CVI'));
  function uniqueCvisText(rows) {
    return hasCviColumn(rows) ? S().comma(SUM().uniqueCvis(rows)) : 'none (the file has no CVI column)';
  }
  // The change between two quarters, as the "Emerging vs cooling" chart picks them (its "Compare with" choice;
  // National Flow, which has no such chart, uses the previous quarter): the animals (WA-to-WA movements once) and
  // Unique CVIs in each, with the difference and the percentage.
  function changeLines(rows, f, animalsLabel) {
    const dated = rows.filter(r => CH().periodOf(r).key !== null);
    const keys = [...new Set(dated.map(r => CH().periodOf(r).key))].sort((a, b) => a - b);
    const labelOf = k => CH().periodOf(dated.find(r => CH().periodOf(r).key === k)).label;
    const lastYear = f.compare === 'last_year';
    const head = lastYear ? 'CHANGE FROM THE SAME QUARTER LAST YEAR' : 'CHANGE FROM THE PREVIOUS QUARTER';
    if (!keys.length) return [head, '  No rows with a year to compare.'];
    const curr = keys[keys.length - 1];
    let prev, prevLabel;
    if (!lastYear) {
      if (keys.length < 2) return [head, '  Needs two or more quarters with data.'];
      prev = keys[keys.length - 2];
      prevLabel = labelOf(prev);
    } else {
      prev = curr - 10;
      prevLabel = Math.floor(prev / 10) + ' ' + labelOf(curr).replace(/^\S+ /, '');
      if (!(f.years || []).map(String).includes(String(Math.floor(prev / 10)))) {
        return [head, '  ' + prevLabel + ' is not in the selected years.'];
      }
    }
    const inPeriod = k => dated.filter(r => CH().periodOf(r).key === k);
    const animals = k => SUM().dedupeVolume(inPeriod(k))
      .reduce((t, r) => (r['Total.Animals'] === null || Number.isNaN(r['Total.Animals']) ? t : t + r['Total.Animals']), 0);
    // One line, "<label>  a to b (+d, +p%)"; when that is wider than the summary's 64 characters (large counts on
    // County Focus), the "(+d, +p%)" goes on a second line under the counts.
    const change = (lead, a, b) => {
      const d = b - a;
      const signed = (d > 0 ? '+' : d < 0 ? '-' : '') + S().comma(Math.abs(d));
      const pct = a > 0 ? ', ' + (d > 0 ? '+' : d < 0 ? '-' : '') + (Math.abs(d) / a * 100).toFixed(1) + '%' : '';
      const counts = lead + S().comma(a) + ' to ' + S().comma(b), diff = '(' + signed + pct + ')';
      if (counts.length + 1 + diff.length <= 64) return [counts + ' ' + diff];
      return [counts, ' '.repeat(lead.length) + diff];
    };
    const out = [head + ' (' + prevLabel + ' to ' + labelOf(curr) + ')']
      .concat(change('  ' + animalsLabel + ':    ', animals(prev), animals(curr)));
    if (hasCviColumn(rows)) {
      out.push(...change('  Unique CVIs:      ', SUM().uniqueCvis(inPeriod(prev)), SUM().uniqueCvis(inPeriod(curr))));
    }
    return out;
  }

  // f: the view's filters { species, years, quarters, direction, counties (Focus), chartFilters (MC: the chip bar's
  // texts), compare (the charts' "Compare with" choice) }; rows: the rows the map draws (both copies of a WA-to-WA
  // movement); aggRows: the map's aggregated rows; now: the time shown.
  function statsLines(view, f, rows, aggRows, now) {
    const dir = directionRaw(view, f), focus = view === 'focus';
    const vol = SUM().dedupeVolume(rows);
    const sum = list => list.reduce((t, r) => (r['Total.Animals'] === null || Number.isNaN(r['Total.Animals'])
      ? t : t + r['Total.Animals']), 0);
    const lines = [
      '================================================================',
      'CVI MAP EXPORT SUMMARY',
      'Generated: ' + localTime(now),
      'Map:       ' + MAP_TAG[view],
      '================================================================',
      '',
      'FILTERS APPLIED',
      '  Species:   ' + f.species.join(', '),
      '  Years:     ' + yearLabel(f.years),
      '  Quarters:  ' + quarterLabel(f.quarters)];
    if (focus) lines.push('  Focus counties: ' + f.counties.join(', '));
    lines.push('  Direction: ' + dir.join(', '));
    // MC: the chart filters on, after CVI's lines (a deliberate addition; none, none written).
    if (f.chartFilters && f.chartFilters.length) lines.push('  Chart filters: ' + f.chartFilters.join('; '));
    const animalsLabel = focus ? 'Total animal activity' : 'Total animals';
    lines.push('', 'SUMMARY',
      '  Total records:    ' + fmt(rows.length),
      '  ' + animalsLabel + ':    ' + fmt(sum(vol)));
    // Added: Unique CVIs, a note when WA-to-WA movements are counted at both ends, and the change from the previous
    // quarter. Not in CVI's text.
    lines.push('  Unique CVIs:      ' + uniqueCvisText(rows));
    // On WA State's shaded map, the animals in counties the map does not have (choropleth.unplacedLines).
    // Lines of at most 64 characters, as the change lines.
    if (f.unplaced) {
      let cur = ' ';
      for (const word of f.unplaced.join(' ').split(' ')) {
        if ((cur + ' ' + word).length > 64 && cur.trim()) { lines.push(cur); cur = ' '; }
        cur += ' ' + word;
      }
      lines.push(cur);
    }
    const twice = rows.length - vol.length;
    if (twice > 0) {
      lines.push('  Total records counts each WA-to-WA movement twice, once at',
        '  each end (Inbound and Outbound): ' + S().comma(twice) + ' ' + (twice === 1 ? 'movement' : 'movements') + ' here.',
        '  ' + animalsLabel + ' counts ' + (twice === 1 ? 'it' : 'them') + ' once.');
    }
    lines.push('');
    if (rows.length) lines.push(...changeLines(rows, f, animalsLabel), '');
    if (rows.length) {
      // tapply groups in sorted order, then sort(decreasing = TRUE), which keeps that order for ties.
      const groups = new Map();
      vol.forEach(r => {
        const g = r['Species.Group'];
        if (g === null) return;
        groups.set(g, (groups.get(g) || 0)
          + (r['Total.Animals'] === null || Number.isNaN(r['Total.Animals']) ? 0 : r['Total.Animals']));
      });
      const ordered = [...groups.keys()].sort(collate).map(k => [k, groups.get(k)]).sort((a, b) => b[1] - a[1]);
      lines.push('ANIMALS BY SPECIES');
      ordered.forEach(([k, v]) => lines.push('  ' + k + ': ' + fmt(v)));
      lines.push('');
    }
    if (!aggRows || !aggRows.length) return lines;
    if (view === 'wa' || view === 'flow') {
      const key = view === 'wa' ? 'county' : 'state';
      const totals = new Map();
      aggRows.forEach(r => totals.set(r[key], (totals.get(r[key]) || 0) + (r.total_animals === null ? 0 : r.total_animals)));
      const top = [...totals.keys()].sort(cmpC).map(k => [k, totals.get(k)]).sort((a, b) => b[1] - a[1]).slice(0, 10);
      lines.push(view === 'wa' ? 'TOP COUNTIES (by total animals)' : 'TOP STATES (by total animals)');
      top.forEach(([k, v]) => lines.push('  ' + k + ': ' + fmt(v)));
      return lines;
    }
    lines.push('NOTE: Counts are activity at each premises. A WA-to-WA shipment',
      'between two focus counties is counted at BOTH its exporter (origin)',
      'and importer (destination) premises, so these totals are not a',
      'deduplicated shipment volume.', '');
    ['Inbound', 'Outbound'].forEach(d => {
      const list = aggRows.filter(p => p.direction === d).slice().sort((a, b) => b.total_animals - a.total_animals).slice(0, 5);
      if (!list.length) return;
      lines.push(d === 'Inbound' ? 'TOP IMPORTER PREMISES (received animals into focus counties)'
        : 'TOP EXPORTER PREMISES (sent animals out of focus counties)');
      list.forEach(p => {
        const blank = v => v === null || v === undefined || v === '';
        const label = !blank(p.premises_id) ? p.premises_id : blank(p.city) ? '(unknown city)' : p.city;
        const place = (blank(p.state) ? '' : ', ' + p.state) + (blank(p.county) ? '' : ' — ' + p.county + ' County');
        const cvis = p.n_cvis === null || p.n_cvis === undefined ? '' : ' | ' + fmt(p.n_cvis) + ' CVIs';
        lines.push('  ' + label + place + ': ' + fmt(p.total_animals) + ' animals' + cvis + ' (' + p.n_shipments + ' shipments)');
      });
      lines.push('');
    });
    return lines;
  }
  // The Summary stats preview dialog: its title, the stats lines as one text, and its footer note.
  function statsPreview(view, f, rows, aggRows, now) {
    return { title: 'Summary stats preview', text: statsLines(view, f, rows, aggRows, now).join('\n'),
      footer: 'Quick in-app rollup. For tabular export, use Aggregated totals (.csv).' };
  }

  // ── Folder name (CVI's export) ─────────────────────────────────────────────────────────────────────────────
  // "YYYY-MM-DD_MapType_Area_Species_Direction": AllSpecies when every species group in the file is picked;
  // County Focus adds its counties (in pick order) and, after the direction, the sorted counties or "<n>Counties".
  // With an Optional Filename: the date and the label, every character other than letters, digits, "_" and "-"
  // made "_".
  // A deliberate difference: above 3 counties the area part is "<n>Counties" too.
  // CVI lists every county there, and with many counties its folder name passes the 255-byte limit and the export
  // fails.
  const alnum = s => s.replace(/[^A-Za-z0-9]/g, '');
  function folderName(view, f, allSpecies, label, now) {
    const date = localDate(now), lab = (label || '').trim();
    if (lab) return date + '_' + lab.replace(/[^A-Za-z0-9_-]/g, '_');
    const picks = f.species.slice().sort(collate);
    const all = allSpecies.filter(s => s !== null && s !== '').slice().sort(collate);
    const isAll = all.length > 0 && new Set(picks).size === new Set(all).size && all.every(s => picks.includes(s));
    let spp = isAll ? 'AllSpecies' : alnum(picks.join('-'));
    if (!spp) spp = 'AllSpecies';
    const dirPart = alnum(directionRaw(view, f).slice().sort(collate).join('-'));
    let dir = dirPart;
    if (view === 'focus') {
      const ctys = f.counties.length <= 3 ? alnum(f.counties.slice().sort(collate).join('-')) : f.counties.length + 'Counties';
      dir = dirPart + '_' + ctys;
    }
    if (!dir) dir = 'Dir';
    const mapType = { wa: 'WAState', flow: 'NationalFlow', focus: 'CountyFocus' }[view];
    let area = '';
    if (view === 'focus' && f.counties.length) {
      area = f.counties.length <= 3 ? f.counties.map(alnum).join('-') : f.counties.length + 'Counties';
    }
    return [date, mapType, area, spp, dir].filter(t => t !== '' && t !== 'Dir').join('_');
  }

  // ── export_params.json (jsonlite::write_json, pretty, auto_unbox) ──────────────────────────────────────────
  // A value of one element is written plain, an empty list as [] and an absent one (R's NULL) as {}; arrays of
  // plain values on one line; two spaces of indent; a line feed at the end.
  function jsonValue(v) {
    if (v === null) return '{}';
    if (Array.isArray(v)) return v.length === 1 ? jsonValue(v[0]) : '[' + v.map(jsonValue).join(', ') + ']';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    return JSON.stringify(String(v));
  }
  // An object written as export_params.json: one key per line, in the object's key order.
  function jsonObject(o) {
    const keys = Object.keys(o);
    return '{\n' + keys.map((k, i) => '  ' + JSON.stringify(k) + ': ' + jsonValue(o[k])
      + (i < keys.length - 1 ? ',' : '')).join('\n') + '\n}\n';
  }
  // The parameters CVI writes, in its order. formats: what was exported ('csv', 'summary_csv', 'charts');
  // layersOn (County Focus): every facility layer switched on, manifest layers included; nameLayers
  // (S9): the layers picked under "Name markers in PNG", joined by ", " as CVI writes them. MC: with chart
  // filters on, "chart_filters" lists them (the chip bar's texts) before "exported_at" (a deliberate addition). S9:
  // with the branded map exported, its choices (opts.png: background, quality, resolution), and with only charts
  // at High resolution "png_resolution": "high", also before "exported_at" (deliberate additions; an export of CVI's
  // formats at Standard keeps CVI's file exactly). S10: with the GIF, its frame interval ("gif_frame_interval").
  // PC: with a population layer drawn on the map (opts.population: population.js exportParams), the layers drawn
  // ("population_layers") and each one's source with its date ("population_sources"), before "exported_at"
  // (deliberate additions; nothing is added while every layer is off).
  function exportParams(view, f, opts, now) {
    const years = f.years.map(Number);
    const common = { species: f.species, years, year_min: Math.min(...years), year_max: Math.max(...years),
      quarters: f.quarters };
    const tail = { export_label: (opts.label || '').trim(), formats: opts.formats, append_accumulator: false };
    let p;
    if (view === 'wa') p = Object.assign({ map: 'county' }, common, { direction: f.direction }, tail);
    else if (view === 'flow') p = Object.assign({ map: 'flow' }, common, { direction: f.direction }, tail);
    else {
      p = Object.assign({ map: 'county_focus' }, common, { focus_counties: f.counties, direction: f.direction }, tail,
        { overlays_active: opts.layersOn && opts.layersOn.length ? opts.layersOn : null,
          overlay_labels_on_png: (opts.nameLayers || []).join(', ') });
    }
    if (f.chartFilters && f.chartFilters.length) p.chart_filters = f.chartFilters;
    const formats = opts.formats || [];
    if (opts.png && formats.includes('branded_png')) {
      p.png_background = opts.png.background;
      p.export_quality = opts.png.quality;
    }
    if (opts.png && (formats.includes('branded_png') || (formats.includes('charts') && opts.png.resolution === 'high'))) {
      p.png_resolution = opts.png.resolution;
    }
    if (formats.includes('branded_gif')) p.gif_frame_interval = opts.gifBy || 'quarter';
    shadeParams(p, opts.shade, formats);
    // PC: the population layers only when the export holds the branded map that draws them.
    populationParams(p, formats.includes('branded_png') ? opts.population : null);
    p.exported_at = localTime(now);
    return jsonObject(p);
  }

  // CH: the shaded map ("map_style": "shaded", its measure, classes and breaks); nothing while the map draws circles
  // or lines, so CVI's file is unchanged then (deliberate additions, as the PNG's). sh: { measure, method, nBins,
  // cls (choropleth.classify's: the view's, which the PNG draws), gifCls (the GIF's, shared by its frames) }, or null.
  // The GIF's frames take their classes from every frame's own values, not the view's, so an export
  // with the GIF also writes "gif_shade_class_count" and "gif_shade_breaks"; with the GIF and no PNG, "shade_class_count"
  // and "shade_breaks" are the GIF's (the only shaded picture in the ZIP).
  function shadeParams(p, sh, formats) {
    if (!sh) return;
    const breaks = cls => (cls ? cls.breaks.map(b => Number(Number(b).toPrecision(6))) : []);
    const gif = sh.gifCls && formats.indexOf('branded_gif') >= 0 ? sh.gifCls : null;
    const gifOnly = gif && formats.indexOf('branded_png') < 0;
    const cls = gifOnly ? gif : sh.cls;
    p.map_style = 'shaded';
    p.shade_measure = sh.measure === 'per_sq_mi' ? 'animals_per_sq_mi' : 'total_animals';
    p.shade_classes = sh.method === 'quantile' ? 'quantile' : 'natural_breaks';
    p.shade_class_count = cls ? cls.n : 0;
    p.shade_breaks = breaks(cls);
    if (gif && !gifOnly) {
      p.gif_shade_class_count = gif.n;
      p.gif_shade_breaks = breaks(gif);
    }
  }

  // PC: the population layers drawn ("population_layers") and each one's source with its date ("population_sources");
  // nothing while every layer is off. pop: population.js exportParams, or null. Shared with Premise Lookup (S11).
  function populationParams(p, pop) {
    if (!pop || !(pop.city_limits || pop.population_centers || pop.population_density)) return;
    p.population_layers = ['city_limits', 'population_centers', 'population_density'].filter(k => pop[k]);
    const src = pop.sources;
    const lines = [];
    if (src.city_limits) {
      lines.push(src.city_limits.source + ', downloaded ' + src.city_limits.downloaded + ' (' + src.city_limits.quarter +
        '); ' + src.city_limits.population_year + ' population: U.S. Census Bureau');
    }
    for (const k of ['population_centers', 'population_density']) {
      const line = src[k] && src[k].source + ' (' + src[k].year + ')';
      if (line && lines.indexOf(line) < 0) lines.push(line);
    }
    p.population_sources = lines;
  }

  // ── Messages ───────────────────────────────────────────────────────────────────────────────────────────────
  const MESSAGES = {
    noFormat: 'Select at least one export format.',
    focusCountyExport: 'Select at least one focus county before exporting.',
    focusCountyPreview: 'Select at least one focus county before previewing.',
    noRowsExport: 'No rows match current filters — export cancelled.',
    noDataTable: 'No data matches current filters — nothing to preview.',
    noRowsStats: 'No rows match current filters — nothing to preview.',
    noRowsCharts: 'No rows match current filters — nothing to chart.',
    chartsFooter: 'These are the charts that get written to charts/ on export.'
  };
  // The message when County Focus has no premises coordinates (CVI's build_county_focus_data condition), in plain
  // words in place of CVI's steps of its own R pipeline, which users of these pages do not have.
  function focusCoordinatesMessage(missing) {
    return 'County Focus export needs premises coordinates (' + missing.join(', ') + '), which this master file '
      + 'does not have. Ask for a CVI master table that includes them, then load it again.';
  }
  const chartsPreviewTitle = n => 'Charts preview (' + n + ')';

  // ── The ZIP ────────────────────────────────────────────────────────────────────────────────────────────────
  // The files of one export inside a folder of the export's name, in the order CVI writes them, and the lines of
  // the result: each file written, as CVI lists them. parts: { filteredRows ({ text, rows }), summaryTable (text),
  // charts ([{ name, bytes }]), branded ([{ name, bytes }]: the branded map PNG, two in Compare; S9), gif ({ name,
  // bytes }: the time-series GIF; S10), params (text) };
  // any part may be missing. errors: what failed, as "<file>: <reason>".
  // The folder and charts/ are written as entries of their own, so every unzip tool makes them even when empty.
  function zipEntries(folder, parts) {
    const entries = [{ name: folder + '/', dir: true }], written = [];
    const add = (name, data) => entries.push({ name: folder + '/' + name, data });
    if (parts.charts && parts.charts.length) entries.push({ name: folder + '/charts/', dir: true });
    if (parts.filteredRows) {
      add('filtered_rows.csv', parts.filteredRows.text);
      written.push('filtered_rows.csv (' + S().comma(parts.filteredRows.rows) + ' rows)');
    }
    if (parts.summaryTable) { add('summary_table.csv', parts.summaryTable); written.push('summary_table.csv'); }
    (parts.charts || []).forEach(c => { add('charts/' + c.name, c.bytes); written.push('charts/' + c.name); });
    (parts.branded || []).forEach(b => { add(b.name, b.bytes); written.push(b.name); });
    if (parts.gif) { add(parts.gif.name, parts.gif.bytes); written.push(parts.gif.name); }
    if (parts.params) { add('export_params.json', parts.params); written.push('export_params.json'); }
    return { entries, written };
  }
  // The result shown under the Export button: where the file went and what is in it (CVI names the
  // folder it wrote), or the partial result with what failed (CVI's wording).
  // notices (S9): what was drawn differently from the choices (a PNG background that could not be loaded), after
  // the other lines.
  function exportResult(zipName, written, errors, notices) {
    const extra = notices || [];
    if (!errors || !errors.length) {
      return { ok: true, lines: ['Exported ' + zipName + ': handed to your browser to save, usually your Downloads folder.']
        .concat(written, extra) };
    }
    return { ok: false, lines: ['Partial export: ' + zipName, 'Written: ' + written.join(', '), 'Errors: ' + errors.join('; ')]
      .concat(extra) };
  }
  // "Exports this session": the last five ZIP names with their times, newest first.
  function addToHistory(history, zipName, now) {
    return [{ name: zipName, time: now }].concat(history || []).slice(0, 5);
  }
  // One line of the list, as CVI's "Recent exports" shows a folder: the time as "Oct 11 14:05", the name cut to 30
  // characters with "…" (the whole name in the hover text).
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function historyLine(item) {
    const t = item.time;
    const time = MONTHS[t.getMonth()] + ' ' + twoDigits(t.getDate()) + ' ' + twoDigits(t.getHours()) + ':'
      + twoDigits(t.getMinutes());
    const name = item.name.length > 30 ? item.name.slice(0, 30) + '\u2026' : item.name;
    return { time, name, full: item.name };
  }

  // ── Lines on an exported chart ─────────────────────────────────────────────────────────────────────────────
  // The caption under the title names the view, the filters and the periods, so a PNG pasted on its own explains
  // itself; the footer gives the export date. allSpecies: every species group in the file.
  const VIEW_NAMES = { wa: 'WA State', flow: 'National Flow', focus: 'County Focus' };
  const FLOW_DIRECTIONS = { inbound: 'Inbound', outbound: 'Outbound', combined: 'Combined' };
  function chartCaption(view, f, allSpecies) {
    const all = allSpecies.filter(x => x !== null && x !== '');
    const everyGroup = all.length > 0 && all.every(x => f.species.includes(x));
    let species = everyGroup ? 'All species' : f.species.slice().sort(collate).join(', ');
    const refined = view === 'flow' ? f.speciesSub : f.rawSpecies;
    if (refined && refined.length) species += ' (refined: ' + refined.slice().sort(collate).join(', ') + ')';
    const direction = view === 'flow' ? FLOW_DIRECTIONS[f.direction] : directionRaw(view, f).join(' + ');
    const parts = [VIEW_NAMES[view]];
    if (view === 'focus') {
      parts.push(f.counties.length <= 3 ? f.counties.join(', ') : f.counties.length + ' counties');
    }
    parts.push(species, yearLabel(f.years) + ', ' + f.quarters.slice().sort(collate).join(' '), direction);
    if (f.chartFilters && f.chartFilters.length) parts.push('Chart filters: ' + f.chartFilters.join('; '));
    return parts.join(' | ');
  }
  const chartFooter = now => 'Exported ' + localTime(now).slice(0, 16) + ' from the CVI Traceability page';

  // ── Premise Lookup's files ─────────────────────────────────────────────────────────────────────────────────
  // CVI's "Export CSV" (mod_premise_lookup.R) writes the matched rows with utils::write.csv, not fwrite: every
  // column name and every text value in double quotes (quotes doubled), a missing value as NA, TRUE and FALSE
  // unquoted, dates unquoted, and each number on its own with up to 15 significant digits, fixed or scientific,
  // whichever is narrower (R's formatReal at DBL_DIG: 100000 is "1e+05", 123456 stays "123456"). Known limit: a
  // date-time column is written as its text (CVI writes it in the computer's time zone).
  function writeNumber(x) {
    if (x === null || x === undefined || Number.isNaN(x)) return 'NA';   // R's write.csv writes NaN as NA too
    if (x === Infinity) return 'Inf';
    if (x === -Infinity) return '-Inf';
    if (x === 0) return '0';
    const exp = Math.abs(x).toExponential(14);   // 15 significant digits
    const digits = exp.slice(0, exp.indexOf('e')).replace('.', '').replace(/0+$/, '') || '0';
    const kp = Number(exp.slice(exp.indexOf('e') + 1));
    const sign = x < 0 ? '-' : '';
    const rgt = Math.max(0, digits.length - kp - 1);
    const widthFixed = sign.length + (kp >= 0 ? kp + 1 : 1) + (rgt ? rgt + 1 : 0);
    const widthSci = sign.length + (digits.length > 1 ? digits.length + 1 : 1) + (Math.abs(kp) >= 100 ? 5 : 4);
    // Fixed: the value itself with that many decimals (R's sprintf("%.*f"), so a whole number over 15 digits is
    // printed in full).
    if (widthFixed <= widthSci) return x.toFixed(rgt);
    return sign + digits[0] + (digits.length > 1 ? '.' + digits.slice(1) : '') + 'e' + (kp < 0 ? '-' : '+') +
      String(Math.abs(kp)).padStart(2, '0');
  }
  // One value as write.csv writes a column of that type (the types of columnTypes; 'logical' also for true/false).
  function writeField(v, type) {
    if (v === null || v === undefined || (v === '' && type !== 'character')) return 'NA';
    if (type === 'character') return '"' + String(v).replace(/"/g, '""') + '"';
    if (type === 'double') {
      // R reads "Inf" and "-Inf" as numbers and writes them so; "NaN" it writes as NA (checked with
      // R's write.csv).
      const t = String(v).trim();
      const x = typeof v === 'number' ? v : /^\+?Inf$/.test(t) ? Infinity : t === '-Inf' ? -Infinity : t === 'NaN' ? NaN
        : Number(t.replace(/^\+/, ''));
      return writeNumber(x);
    }
    if (type === 'integer' || type === 'integer64') return typeof v === 'number' ? String(v) : BigInt(v).toString();
    if (type === 'logical') return v === true || /^t/i.test(String(v)) ? 'TRUE' : 'FALSE';
    if (type === 'date') {
      const m = DATE.exec(v);
      return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
    }
    return String(v);
  }
  // A table as write.csv(row.names = FALSE) writes it; rows are lists of values in the columns' order.
  function writeCsv(columns, rows, types) {
    const lines = [columns.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')];
    rows.forEach(r => lines.push(r.map((v, j) => writeField(v, types[j])).join(',')));
    return lines.join('\n') + '\n';
  }
  const NOTE_CSV = note => writeCsv(['Note'], [[note]], ['character']);

  // The matched rows (CVI's file, premise_lookup_matches_<date>.csv): the master's columns in its order (with CVI's
  // record numbers last when the file has no CVI column), then the five columns the engine adds. res: lookup.query's
  // result; master: the loaded master. With no matched row, CVI's one-cell note.
  const LOOKUP_ADDED = [['.hit_origin', 'hitOrigin', 'logical'], ['.hit_dest', 'hitDest', 'logical'],
    ['matched_sites', 'matchedSites', 'character'], ['nearest_site_km', 'nearestSiteKm', 'double'],
    ['nearest_band_km', 'nearestBandKm', 'double']];
  function lookupMatchesCsv(master, res) {
    const rows = (res && res.matched) || [];
    if (!rows.length) return { text: NOTE_CSV('No matches.'), rows: 0 };
    const types = columnTypes(master);
    const own = master.header.concat(res.hasCvi === false ? ['CVI'] : []);
    const columns = own.concat(LOOKUP_ADDED.map(a => a[0]));
    const colTypes = own.map(c => types[c] || 'character').concat(LOOKUP_ADDED.map(a => a[2]));
    const out = rows.map(r => own.map(c => r[c]).concat(LOOKUP_ADDED.map(a => r[a[1]])));
    return { text: writeCsv(columns, out, colTypes), rows: rows.length };
  }

  // The facilities inside each buffer (new, premise_lookup_facilities_<date>.csv), as lookup.facilitiesInside lists
  // them: one row per site and facility inside its buffer or zone, written the same way. With none, a note.
  const FACILITY_COLUMNS = [['site', 'character'], ['site_lat', 'double'], ['site_long', 'double'],
    ['layer', 'character'], ['facility', 'character'], ['facility_lat', 'double'], ['facility_long', 'double'],
    ['distance_km', 'double'], ['band_km', 'double'], ['county', 'character'], ['town', 'character']];
  // Text a spreadsheet would read as a formula (starting with =, +, -, @, a tab or a carriage return) gets an
  // apostrophe in front, so it opens as text. This file is the page's own; the matched-rows CSV stays
  // exactly as CVI's Export CSV writes it.
  const asText = v => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? "'" + v : v);
  function lookupFacilitiesCsv(rows) {
    if (!rows || !rows.length) return { text: NOTE_CSV('No facilities inside the buffers.'), rows: 0 };
    const out = rows.map(r => [asText(r.siteName), r.siteLat, r.siteLon, asText(r.layerLabel), asText(r.name), r.lat,
      r.lon, r.km, r.bandKm, asText(r.county), asText(r.town)]);
    return { text: writeCsv(FACILITY_COLUMNS.map(c => c[0]), out, FACILITY_COLUMNS.map(c => c[1])), rows: rows.length };
  }

  // export_params.json for a Premise Lookup export (the page's addition; CVI writes none for this tab), in the
  // style of the Maps side's file. p: { masterFile, mode, defaultKm, bands, endpoint, years, quarters, species,
  // sites: [{ name, lat, long, buffer_km, bands_csv, zoneFile }], layers (the facility layers checked), formats,
  // counts: { cvis, facilities }, png: { background, quality, resolution, labels } and population
  // (population.js exportParams, or null) for the branded PNG, countyPages (the counties given a page of their own) }.
  function lookupParams(p, now) {
    // In Bands mode a site's own buffer is not used (the global bands are), so it is not written.
    const siteText = s => (s.name === null || s.name === undefined ? '' : s.name) + ' (' + s.lat + ', ' + s.long + '; ' +
      (s.zoneFile ? 'zone from ' + s.zoneFile
        : p.mode === 'bands' ? (s.bands_csv ? 'bands ' + s.bands_csv + ' km' : 'global bands')
          : s.buffer_km !== null && s.buffer_km !== undefined ? s.buffer_km + ' km' : 'default buffer') + ')';
    const o = {
      tool: 'premise_lookup',
      master_file: p.masterFile || '',
      buffer_style: p.mode === 'bands' ? 'concentric_bands' : 'single_buffer',
      default_buffer_km: p.mode === 'bands' ? null : p.defaultKm,
      band_radii_km: p.mode === 'bands' ? p.bands : null,
      endpoint: p.endpoint,
      years: p.years.length ? p.years.map(Number) : null,
      quarters: p.quarters.length ? p.quarters : null,
      species: p.species.length ? p.species : null,
      sites: p.sites.map(siteText),
      facility_layers: p.layers.length ? p.layers : null,
      formats: p.formats,
      cvis_matched: p.counts.cvis === null ? null : p.counts.cvis,
      facilities_inside: p.counts.facilities === null ? null : p.counts.facilities
    };
    // jsonValue writes null as {} (CVI's empty list); a missing count is left out instead.
    Object.keys(o).forEach(k => { if (o[k] === null && (k === 'cvis_matched' || k === 'facilities_inside')) delete o[k]; });
    // With the branded PNG, its choices and the population layers it draws (as the Maps side writes them).
    if (p.png && p.formats.indexOf('branded_png') >= 0) {
      o.png_background = p.png.background;
      if (p.png.background !== 'standard' && p.png.background !== 'vector:streets') o.export_quality = p.png.quality;
      o.png_resolution = p.png.resolution;
      o.facility_labels_on_png = !!p.png.labels;
      if (p.countyPages && p.countyPages.length) o.county_pngs = p.countyPages;   // the counties given a page of their own
      populationParams(o, p.population || null);
    }
    o.exported_at = localTime(now);
    return jsonObject(o);
  }

  root.CVIWA = root.CVIWA || {};
  root.CVIWA.exports = { fwriteNumber, csvText, columnTypes, fieldText, csv, filteredRowsCsv, tableColumns,
    summaryTableCsv, fixedR, roundR, round3, fmt, mapDataPreview, localTime, localDate, yearLabel, quarterLabel,
    directionRaw, statsLines,
    statsPreview, folderName, jsonValue, jsonObject, exportParams, MESSAGES, focusCoordinatesMessage,
    chartsPreviewTitle, zipEntries, exportResult, addToHistory, historyLine, chartCaption, chartFooter,
    writeNumber, writeField, writeCsv, lookupMatchesCsv, lookupFacilitiesCsv, FACILITY_COLUMNS, lookupParams,
    populationParams };
})(typeof window !== 'undefined' ? window : globalThis);
