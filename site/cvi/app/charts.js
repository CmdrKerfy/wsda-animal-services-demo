/* Chart data for the CVI page's charts: CVI's Maps-tab chart rules (shiny/R/charts.R, and the two heatmaps of
 * mod_maps.R .write_export_charts) with deliberate changes: one chart design for the screen and the export, and five
 * changes: top premises as premises, empty periods shown, a Measure picker (animals, CVI records or unique CVIs),
 * exact values on hover, and "Emerging vs cooling" against the same quarter last year. Pure functions: the input
 * is the rows the map draws (and, on County Focus, its premises); the output is what each chart shows, top to
 * bottom, with its text. Drawing is in chartsvg.js. */
(function (root) {
  'use strict';
  const S = () => root.CVIWA.scaling;
  const SUM = () => root.CVIWA.summary;
  const collate = (a, b) => a.localeCompare(b, 'en');          // R's sort() and aggregate() order
  const cmpC = (a, b) => (a < b ? -1 : a > b ? 1 : 0);          // dplyr's group order (C locale)

  // CVI's chart colors (charts.R): Inbound and Outbound as the map's default circles, teal for one series, green
  // and red for change. Species bars take CVI's species colors (SPECIES_COLORS, the Flow map's default palette);
  // a group no palette names is gray, as in CVI's export chart.
  const COLORS = { Inbound: '#1C9CD9', Outbound: '#F0A06E', single: '#245566', up: '#2e7d4f', down: '#a23b3b',
    otherSpecies: '#999999' };
  // A species group's color in the WSDA Default palette; gray for a group the palette does not name.
  function speciesColor(group) {
    const p = root.CVIWA.palettes.SPECIES_PALETTES['WSDA Default'];
    return Object.prototype.hasOwnProperty.call(p, group) ? p[group] : COLORS.otherSpecies;
  }

  // Which charts each Map View shows (CVI's drawer, with top premises in place of top counties on County Focus).
  const CHARTS = {
    wa: ['species', 'top_places', 'over_time', 'emerging'],
    flow: ['species', 'top_places', 'over_time', 'corridors'],
    focus: ['species', 'top_premises', 'corridors', 'emerging']
  };
  const N = 12;           // bars per chart (CVI's drawer)
  const N_HEATMAP = 10;   // rows per heatmap (CVI's export)

  // ── Measures ───────────────────────────────────────────────────────────────────────────────────────────────
  // Animals: CVI's rule, a missing count is 0. CVI records: each row counts once. Unique CVIs: distinct nonblank
  // CVI numbers, as the "Unique CVIs" value box counts them; not offered without a CVI column.
  // option: its name in the page's "Show charts by:" picker.
  const MEASURES = {
    animals: { title: 'Animals', option: 'Animals moved', lower: 'animals', one: 'animal', many: 'animals' },
    records: { title: 'CVI records', option: 'CVI records', lower: 'CVI records', one: 'CVI record', many: 'CVI records' },
    cvis: { title: 'Unique CVIs', option: 'Unique CVIs', lower: 'unique CVIs', one: 'unique CVI', many: 'unique CVIs' }
  };
  // Whether a measure can be charted for the loaded file (Unique CVIs needs a CVI column), with the reason if not.
  function measureAvailable(loaded, measure) {
    if (measure !== 'cvis') return { ok: true };
    return loaded && loaded.header.indexOf('CVI') >= 0 ? { ok: true } : { ok: false, reason: SUM().NO_CVI_REASON };
  }
  // The total of a set of rows for a measure.
  function total(rows, measure) {
    if (measure === 'records') return rows.length;
    if (measure === 'cvis') return SUM().uniqueCvis(rows);
    let t = 0;
    rows.forEach(r => { const a = r['Total.Animals']; if (a !== null && a !== undefined && !Number.isNaN(a)) t += a; });
    return t;
  }
  // Rows grouped by a key (keys left out when null), each group's total; groups in R's sorted order.
  function byGroup(rows, keyOf, measure) {
    const groups = new Map();
    rows.forEach(r => {
      const k = keyOf(r);
      if (k === null) return;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    });
    return [...groups.keys()].sort(collate).map(k => ({ key: k, value: total(groups.get(k), measure) }));
  }
  // The n largest, ties in the order given (R's order(-x) is stable).
  const largest = (list, n) => list.slice().sort((a, b) => b.value - a.value).slice(0, n);

  // ── Shared row rules (charts.R) ────────────────────────────────────────────────────────────────────────────
  const text = v => (v === null || v === undefined ? null : String(v));
  const blank = v => v === null || v.trim() === '';
  // The out-of-state county placeholder ("N/A" or "NA") reads "Non-WA"; a missing county stays missing.
  function countyLabel(v) {
    if (text(v) === null) return null;
    const t = text(v).trim();
    return t.toUpperCase() === 'N/A' || t.toUpperCase() === 'NA' ? 'Non-WA' : t;
  }
  // The place a row counts at: Inbound at its destination, otherwise (Outbound, or no direction) at its origin; on
  // National Flow the partner state. Null when missing or blank.
  function placeOf(r, view) {
    if (view === 'flow') {
      const os = text(r['Origin.State']), ds = text(r['Dest.State']);
      if (ds === null) return null;   // R: ifelse(NA == "WA", ...) is NA
      const p = ds.trim().toUpperCase() === 'WA' ? os : ds;
      return p === null || blank(p) ? null : p.trim().toUpperCase();
    }
    const label = countyLabel(r.Movement === 'Inbound' ? r['Dest.County'] : r['Origin.County']);
    return label === null || blank(label) ? null : label;
  }
  // A row's period: label "2024 Q3" and a sortable key (year * 10 + quarter number, 0 when the quarter has none).
  function periodOf(r) {
    const y = r['Reporting.Year'];
    const q = text(r['Reporting.Quarter']) === null ? 'NA' : text(r['Reporting.Quarter']).trim().toUpperCase();
    const qn = /^Q?\d+$/.test(q) ? parseInt(q.replace(/^Q/, ''), 10) : 0;
    return { label: (y === null ? 'NA' : String(y)) + ' ' + q, key: y === null ? null : y * 10 + qn };
  }
  const hasDirection = r => r.Movement !== null && r.Movement !== undefined && r.Movement !== '';

  // ── Text ───────────────────────────────────────────────────────────────────────────────────────────────────
  // An exact number for hover text: thousands separators, no rounding beyond floating-point noise.
  function exact(x) {
    const s = String(Number(x.toFixed(10)));
    return s.replace(/^(-?)(\d+)/, (m, sg, int) => sg + int.replace(/\B(?=(\d{3})+(?!\d))/g, ','));
  }
  const unit = (x, measure) => (x === 1 || x === -1 ? MEASURES[measure].one : MEASURES[measure].many);
  const valueText = (x, measure) => exact(x) + ' ' + unit(x, measure);
  // A change with its sign and unit, as "+12 animals" or "−3 records".
  function changeText(x, measure) {
    return (x > 0 ? '+' : x < 0 ? '−' : '') + exact(Math.abs(x)) + ' ' + unit(x, measure);
  }

  // scales::precision(): the accuracy CVI's number labels round to.
  function precision(xs) {
    const u = [...new Set(xs.filter(Number.isFinite))].sort((a, b) => a - b);
    if (u.length <= 1) return 1;
    let smallest = Infinity;
    for (let i = 1; i < u.length; i++) smallest = Math.min(smallest, u[i] - u[i - 1]);
    if (smallest < Math.sqrt(Number.EPSILON)) return 1;
    let p = Math.pow(10, Math.floor(Math.log10(smallest)) - 1);
    if (u.every(x => ((S().rRound(x / p) % 10) + 10) % 10 === 0)) p *= 10;
    return Math.min(p, 1);
  }
  // The decimals R's format() shows for a number with 7 significant digits.
  function rDecimals(x) {
    if (x === 0 || !Number.isFinite(x)) return 0;
    const ax = Math.abs(x);
    let kp = Math.floor(Math.log10(ax));
    let m = Math.round((ax / Math.pow(10, kp)) * 1e6) / 1e6;
    if (m >= 10) { kp += 1; m /= 10; }
    const sig = Math.max(1, m.toFixed(6).replace('.', '').replace(/0+$/, '').length);
    return Math.max(0, sig - kp - 1);
  }
  const marks = (s, mark) => s.replace(/^(\d+)/, int => int.replace(/\B(?=(\d{3})+(?!\d))/g, mark));
  // scales::number() for a vector: values rounded to their accuracy, formatted together per number of decimals.
  function numberLabels(xs, scales, accuracies, suffixes, mark) {
    const nsmall = accuracies.map(a => Math.min(Math.max(-Math.floor(Math.log10(a)), 0), 20));
    const rounded = xs.map((x, i) => S().rRound(x / (accuracies[i] / scales[i])) * (accuracies[i] / scales[i]));
    const out = new Array(xs.length);
    [...new Set(nsmall)].forEach(ns => {
      const idx = xs.map((x, i) => i).filter(i => nsmall[i] === ns);
      const scaled = idx.map(i => Math.abs(rounded[i]) * scales[i]);
      const rgt = Math.max(ns, ...scaled.map(rDecimals));
      idx.forEach((i, k) => {
        const sign = rounded[i] < 0 ? '-' : '';
        out[i] = sign + marks(scaled[k].toFixed(rgt), mark) + suffixes[i];
      });
    });
    return out;
  }
  // scales::comma(): CVI's bar value labels.
  function commaLabels(xs) {
    const acc = precision(xs);
    return numberLabels(xs, xs.map(() => 1), xs.map(() => acc), xs.map(() => ''), ',');
  }
  // scales::label_number(scale_cut = cut_short_scale()): CVI's heatmap cell labels ("1.2K", "3.5M").
  const SHORT = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  function shortLabels(xs) {
    const cut = xs.map(x => {
      const s = SHORT.find(([b]) => Math.abs(x) >= b);
      return x === 0 || !s ? { scale: 1, suffix: '' } : { scale: 1 / s[0], suffix: s[1] };
    });
    const groups = new Map();
    xs.forEach((x, i) => {
      const k = cut[i].scale;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(x * k);
    });
    const acc = new Map([...groups].map(([k, v]) => [k, precision(v)]));
    return numberLabels(xs, cut.map(c => c.scale), cut.map(c => acc.get(c.scale)), cut.map(c => c.suffix), ' ');
  }

  // ── Charts ─────────────────────────────────────────────────────────────────────────────────────────────────
  // Each chart: { id, kind, title, subtitle, empty (CVI's gray message, or null) } plus its marks. Bars are listed
  // top to bottom, each with its label, value, color, value label and hover text.
  const NO_RECORDS = 'No records for the current filters';
  const emptyChart = (id, kind, title, message) => ({ id, kind, title, subtitle: null, empty: message });

  // Animals by species group: the 12 largest groups, each in its species color.
  function species(rows, opts) {
    const m = opts.measure || 'animals';
    const title = MEASURES[m].title + ' by species group';
    if (!rows.length) return emptyChart('species', 'bars', title, NO_RECORDS);
    const g = r => (text(r['Species.Group']) === null || blank(text(r['Species.Group'])) ? null : r['Species.Group']);
    const ok = rows.filter(r => g(r) !== null);
    if (!ok.length) return emptyChart('species', 'bars', title, 'No species data');
    const top = largest(byGroup(ok, g, m), N);
    const labels = commaLabels(top.map(t => t.value));
    return { id: 'species', kind: 'bars', title, subtitle: null, empty: null,
      bars: top.map((t, i) => ({ label: t.key, value: t.value, color: speciesColor(t.key), valueLabel: labels[i],
        hover: t.key + ': ' + valueText(t.value, m) })) };
  }

  // Top counties (WA State) or states (National Flow): the 12 places with the most in both directions together,
  // one bar per direction present, Inbound above Outbound.
  function topPlaces(rows, opts) {
    const m = opts.measure || 'animals', flow = opts.view === 'flow';
    const title = 'Top ' + (flow ? 'states' : 'counties') + ' by ' + (m === 'animals' ? 'animal volume' : MEASURES[m].lower);
    if (!rows.length) return emptyChart('top_places', 'bars_by_direction', title, NO_RECORDS);
    const ok = rows.filter(r => placeOf(r, opts.view) !== null && hasDirection(r));
    if (!ok.length) return emptyChart('top_places', 'bars_by_direction', title, 'No geographic data');
    const top = largest(byGroup(ok, r => placeOf(r, opts.view), m), N);
    const groups = top.map(t => {
      const bars = ['Inbound', 'Outbound'].map(dir => {
        const s = ok.filter(r => placeOf(r, opts.view) === t.key && r.Movement === dir);
        if (!s.length) return null;
        const v = total(s, m);
        return { series: dir, value: v, color: COLORS[dir], hover: t.key + ' — ' + dir + ': ' + valueText(v, m) };
      }).filter(Boolean);
      return { label: t.key, total: t.value, bars };
    });
    return { id: 'top_places', kind: 'bars_by_direction', title, subtitle: null, empty: null, groups,
      clickable: opts.view === 'wa' };
  }

  // Top premises (County Focus): one bar per premises, labeled as the map labels its circles,
  // the 12 largest importers and the 12 largest exporters. Input: the premises the map draws (focus.js build()), and
  // the premises coordinate columns the table lacks: then the chart is grayed with that reason, as the Premises box.
  const PREMISES_MEASURE = { animals: 'total_animals', records: 'n_shipments', cvis: 'n_cvis' };
  function topPremises(premises, opts, missingCoordinates) {
    const m = opts.measure || 'animals';
    const title = 'Top premises by ' + (m === 'animals' ? 'animal volume' : MEASURES[m].lower);
    if (missingCoordinates && missingCoordinates.length) {
      return emptyChart('top_premises', 'bars_by_panel', title, 'Needs premises coordinates (' + missingCoordinates.join(', ') + ')');
    }
    if (!premises || !premises.length) return emptyChart('top_premises', 'bars_by_panel', title, NO_RECORDS);
    const panels = ['Inbound', 'Outbound'].map(dir => {
      // premises: the premises' identity for a chart filter (focus.js premisesKey), as its label can change.
      const list = premises.filter(p => p.direction === dir)
        .map(p => ({ key: p.premises_id, value: p[PREMISES_MEASURE[m]] === null ? 0 : p[PREMISES_MEASURE[m]],
          premises: p.direction + '\r' + p.group_key }));
      const top = largest(list, N);
      const name = dir === 'Inbound' ? 'Importers (Inbound)' : 'Exporters (Outbound)';
      return { name, series: dir, bars: top.map(t => ({ label: t.key, value: t.value, color: COLORS[dir], premises: t.premises,
        hover: t.key + ' — ' + (dir === 'Inbound' ? 'Importer' : 'Exporter') + ': ' + valueText(t.value, m) })) };
    }).filter(p => p.bars.length);
    return { id: 'top_premises', kind: 'bars_by_panel', title, subtitle: null, empty: null, panels };
  }

  // Top movement corridors (National Flow and County Focus): origin → destination pairs (states, or counties with
  // "Non-WA"), the 12 largest, teal. On the WA State map while its movement view is on (MC), the same chart of the
  // movement between two WA counties (movement.js betweenRows), titled so.
  function corridors(rows, opts) {
    const m = opts.measure || 'animals', flow = opts.view === 'flow';
    const title = 'Top movement corridors' + (opts.view === 'wa' ? ' within Washington' : '')
      + (m === 'animals' ? '' : ' by ' + MEASURES[m].lower);
    if (!rows.length) return emptyChart('corridors', 'bars', title, NO_RECORDS);
    const end = (r, side) => {
      if (flow) { const s = text(r[side + '.State']); return s === null ? null : s.trim().toUpperCase(); }
      return countyLabel(r[side + '.County']);
    };
    const pair = r => {
      const o = end(r, 'Origin'), p = end(r, 'Dest');
      return o === null || o === '' || p === null || p === '' ? null : o + '  →  ' + p;
    };
    const ok = rows.filter(r => pair(r) !== null);
    if (!ok.length) return emptyChart('corridors', 'bars', title, 'No corridor data');
    const top = largest(byGroup(ok, pair, m), N);
    const labels = commaLabels(top.map(t => t.value));
    return { id: 'corridors', kind: 'bars', title, subtitle: null, empty: null,
      bars: top.map((t, i) => ({ label: t.key, value: t.value, color: COLORS.single, valueLabel: labels[i],
        hover: t.key.replace('  →  ', ' → ') + ': ' + valueText(t.value, m) })) };
  }

  // Animal volume over time (WA State and National Flow): one line per direction with data. Every selected
  // quarter between the first and the last period with data is on the axis, an empty one at zero.
  // opts.years and opts.quarters are the selected years and quarters.
  function overTime(rows, opts) {
    const m = opts.measure || 'animals';
    const title = (m === 'animals' ? 'Animal volume' : MEASURES[m].title) + ' over time';
    if (!rows.length) return emptyChart('over_time', 'lines', title, NO_RECORDS);
    const ok = rows.filter(r => periodOf(r).key !== null && hasDirection(r));
    if (!ok.length) return emptyChart('over_time', 'lines', title, 'No dated records');
    const periods = new Map();
    ok.forEach(r => { const p = periodOf(r); if (!periods.has(p.key)) periods.set(p.key, p.label); });
    const keys = [...periods.keys()];
    const lo = Math.min(...keys), hi = Math.max(...keys);
    (opts.years || []).forEach(y => (opts.quarters || []).forEach(q => {
      const qn = /^Q[1-4]$/.test(q) ? Number(q.slice(1)) : null;
      const k = Number(y) * 10 + qn;
      if (qn !== null && k > lo && k < hi && !periods.has(k)) periods.set(k, y + ' ' + q);
    }));
    const axis = [...periods.keys()].sort((a, b) => a - b);
    const series = ['Inbound', 'Outbound'].filter(dir => ok.some(r => r.Movement === dir)).map(dir => {
      const values = axis.map(k => total(ok.filter(r => r.Movement === dir && periodOf(r).key === k), m));
      return { name: dir, color: COLORS[dir], values,
        hover: values.map((v, i) => periods.get(axis[i]) + ' — ' + dir + ': ' + valueText(v, m)) };
    });
    return { id: 'over_time', kind: 'lines', title, subtitle: null, empty: null,
      periods: axis.map(k => periods.get(k)), series, pointsOnly: axis.length < 2 };
  }

  // Emerging vs cooling (WA State and County Focus): the change per place between two periods, zero changes left
  // out, the 12 largest by size, listed from the largest rise to the largest fall. opts.compare: 'previous' (CVI's:
  // the two latest periods with data) or 'last_year' (the latest period and the same quarter one year earlier,
  // which must be among the selected years).
  function emerging(rows, opts) {
    const m = opts.measure || 'animals', title = 'Emerging vs cooling';
    if (!rows.length) return emptyChart('emerging', 'change', title, NO_RECORDS);
    const ok = rows.filter(r => placeOf(r, opts.view) !== null && periodOf(r).key !== null);
    if (!ok.length) return emptyChart('emerging', 'change', title, 'No dated geographic data');
    const keys = [...new Set(ok.map(r => periodOf(r).key))].sort((a, b) => a - b);
    const labelOf = k => periodOf(ok.find(r => periodOf(r).key === k)).label;
    const curr = keys[keys.length - 1];
    let prev, prevLabel;
    if ((opts.compare || 'previous') === 'previous') {
      if (keys.length < 2) return emptyChart('emerging', 'change', title, 'Select 2+ quarters to compare change');
      prev = keys[keys.length - 2];
      prevLabel = labelOf(prev);
    } else {
      prev = curr - 10;
      prevLabel = Math.floor(prev / 10) + ' ' + labelOf(curr).replace(/^\S+ /, '');
      if (!(opts.years || []).map(String).includes(String(Math.floor(prev / 10)))) {
        return emptyChart('emerging', 'change', title,
          'Same quarter last year (' + prevLabel + ') is not in the selected years');
      }
    }
    const subtitle = 'Change in ' + MEASURES[m].lower + ': ' + prevLabel + '  →  ' + labelOf(curr);
    const placesIn = k => [...new Set(ok.filter(r => periodOf(r).key === k).map(r => placeOf(r, opts.view)))].sort(collate);
    const places = [...new Set(placesIn(prev).concat(placesIn(curr)))];
    const at = (p, k) => total(ok.filter(r => placeOf(r, opts.view) === p && periodOf(r).key === k), m);
    let change = places.map(p => ({ key: p, value: at(p, curr) - at(p, prev) })).filter(c => c.value !== 0);
    if (!change.length) return Object.assign(emptyChart('emerging', 'change', title, 'No change between quarters'), { subtitle });
    change = change.slice().sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, N)
      .sort((a, b) => a.value - b.value).reverse();
    return { id: 'emerging', kind: 'change', title, subtitle, empty: null, from: prevLabel, to: labelOf(curr),
      clickable: opts.view === 'wa',
      bars: change.map(c => ({ label: c.key, value: c.value, color: c.value >= 0 ? COLORS.up : COLORS.down,
        series: c.value >= 0 ? 'Emerging' : 'Cooling', hover: c.key + ': ' + changeText(c.value, m) })) };
  }

  // ── Heatmaps (export and Preview Charts only; CVI's export rules) ──────────────────────────────────────────
  // Periods as CVI's export writes them: year, a space and the quarter as in the file; rows whose period text
  // contains "NA" are left out. Drawn only with two or more such periods in the rows.
  const exportPeriod = r => (r['Reporting.Year'] === null ? 'NA' : String(r['Reporting.Year'])) + ' '
    + (r['Reporting.Quarter'] === null ? 'NA' : String(r['Reporting.Quarter']));
  // How many periods with a year and a quarter the rows hold (the export keeps the over-time chart only with two).
  function exportPeriodCount(rows) {
    const s = new Set(rows.map(r => exportPeriod(r).replace(' ', '-')).filter(p => p.indexOf('NA') < 0));
    return s.size;
  }
  // A heatmap chart of the rows' totals: the keys with the largest totals as its rows, the periods as its columns.
  function heatmap(id, title, rows, keyOf, measure) {
    const ok = rows.filter(r => exportPeriod(r).indexOf('NA') < 0 && keyOf(r) !== null);
    const groups = new Map();
    ok.forEach(r => {
      const k = keyOf(r);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    });
    // dplyr: groups in C-locale order, then the largest totals first (ties keep that order).
    const totals = [...groups.keys()].sort(cmpC).map(k => ({ key: k, value: total(groups.get(k), measure) }));
    const top = largest(totals, N_HEATMAP).map(t => t.key);
    const periods = [...new Set(ok.map(exportPeriod))].sort(collate);
    const cells = [];
    top.forEach(k => periods.forEach(p => {
      const s = groups.get(k).filter(r => exportPeriod(r) === p);
      if (s.length) cells.push({ row: k, column: p, value: total(s, measure) });
    }));
    const labels = shortLabels(cells.map(c => c.value));
    cells.forEach((c, i) => { c.label = labels[i]; c.hover = c.row + ', ' + c.column + ': ' + valueText(c.value, measure); });
    return { id, kind: 'heatmap', title, subtitle: null, empty: null, rows: top, columns: periods, cells };
  }
  // Species by period: the 10 groups with the most, from the merged rows.
  function speciesHeatmap(rows, opts) {
    const m = opts.measure || 'animals';
    const merged = SUM().dedupeVolume(rows);
    const g = r => (text(r['Species.Group']) === null ? null : r['Species.Group']);
    return heatmap('species_heatmap', MEASURES[m].title + ' by Species × Period', merged, g, m);
  }
  // Places by period (WA State and National Flow): the 10 counties or states with the most, from the rows as drawn
  // (both copies of a WA-to-WA movement), each row at its county or state by direction.
  function placeHeatmap(rows, opts) {
    const m = opts.measure || 'animals', flow = opts.view === 'flow';
    const keyOf = r => {
      const v = text(r.Movement === 'Inbound' ? (flow ? r['Origin.State'] : r['Dest.County'])
        : (flow ? r['Dest.State'] : r['Origin.County']));
      return v === null || v.trim() === '' || r.Movement === null ? null : v;
    };
    return heatmap('place_heatmap', 'Top ' + (flow ? 'States' : 'Counties') + ' by Period', rows, keyOf, m);
  }

  // ── All charts of a view ───────────────────────────────────────────────────────────────────────────────────
  // input: { rows (the rows the map draws), premises and missingCoordinates (County Focus) };
  // opts: { view, measure, compare, years,
  // quarters }. Totals across directions (species, corridors) use the rows with the loader's two copies of a
  // WA-to-WA movement merged (CVI's .chart_inputs), so a movement counts once. The charts by
  // direction (top places, over time, emerging vs cooling) use the rows as the map draws them, both copies, so a
  // WA-to-WA movement counts as Outbound at its origin and as Inbound at its destination, as on the map (CVI's own
  // planned fix P1-12; a deliberate difference from CVI's current code, which merges them too).
  // forExport is the export's set, as CVI's export chooses: the heatmaps are added and the over-time chart kept only
  // with two or more periods, and a chart that would show only its gray message is left out.
  function build(id, input, opts) {
    const drawn = input.rows || [];
    const merged = SUM().dedupeVolume(drawn);
    if (id === 'species') return species(merged, opts);
    if (id === 'top_places') return topPlaces(drawn, opts);
    if (id === 'top_premises') return topPremises(input.premises, opts, input.missingCoordinates);
    if (id === 'corridors') return corridors(merged, opts);
    if (id === 'over_time') return overTime(drawn, opts);
    if (id === 'emerging') return emerging(drawn, opts);
    if (id === 'species_heatmap') return speciesHeatmap(input.rows || [], opts);
    if (id === 'place_heatmap') return placeHeatmap(input.rows || [], opts);
    throw new Error('Unknown chart ' + id);
  }
  function chartsFor(view, input, opts, forExport) {
    const o = Object.assign({}, opts, { view });
    const ids = CHARTS[view].slice();
    if (!forExport) return ids.map(id => build(id, input, o));
    const periods = exportPeriodCount(input.rows || []);
    const exported = periods < 2 ? ids.filter(id => id !== 'over_time')
      : ids.concat(view === 'focus' ? ['species_heatmap'] : ['species_heatmap', 'place_heatmap']);
    return exported.map(id => build(id, input, o)).filter(c => !c.empty && !(c.cells && !c.cells.length));
  }

  // ── "Show as table" ─────────────────────────────────────────────────────────────────────────────────────────
  // A chart's numbers as a table, exactly the values it draws, in its order (a text equivalent for each chart). The
  // first column names what the bars or points are; measure: the "Show charts by:" choice. Returns { caption, head,
  // rows (text cells; numbers exact, with thousands separators), numeric (which columns are numbers), empty (the
  // chart's gray message, then no rows) }.
  function table(chart, measure, view) {
    const m = MEASURES[measure] ? measure : 'animals';
    const caption = chart.title + (chart.subtitle ? ' (' + chart.subtitle.replace(/ {2}→ {2}/g, ' → ') + ')' : '');
    const place = view === 'flow' ? 'State' : 'County';
    const first = { species: 'Species group', top_places: place, top_premises: 'Premises', corridors: 'Corridor',
      over_time: 'Period', emerging: place }[chart.id] || 'Item';
    const out = { caption, head: [], rows: [], numeric: [], empty: chart.empty || null };
    if (chart.empty) return out;
    const cell = v => (v === null || v === undefined ? '—' : exact(v));
    const signed = v => (v > 0 ? '+' : v < 0 ? '−' : '') + exact(Math.abs(v));
    if (chart.kind === 'bars') {
      out.head = [first, MEASURES[m].title];
      out.rows = chart.bars.map(b => [b.label.replace(/ {2}→ {2}/g, ' → '), cell(b.value)]);
    } else if (chart.kind === 'bars_by_direction') {
      out.head = [first, 'Inbound', 'Outbound', 'Total'];
      out.rows = chart.groups.map(g => {
        const of = dir => g.bars.find(b => b.series === dir);
        return [g.label, cell(of('Inbound') ? of('Inbound').value : null),
          cell(of('Outbound') ? of('Outbound').value : null), cell(g.total)];
      });
    } else if (chart.kind === 'bars_by_panel') {
      out.head = ['Role', first, MEASURES[m].title];
      out.rows = chart.panels.flatMap(p => p.bars.map(b => [p.name, b.label, cell(b.value)]));
    } else if (chart.kind === 'lines') {
      out.head = [first].concat(chart.series.map(s => s.name));
      out.rows = chart.periods.map((label, i) => [label].concat(chart.series.map(s => cell(s.values[i]))));
    } else if (chart.kind === 'change') {
      out.head = [first, 'Change in ' + MEASURES[m].lower];
      out.rows = chart.bars.map(b => [b.label, signed(b.value)]);
    }
    out.numeric = out.head.map((h, i) => out.rows.length > 0 && out.rows.every(r => /^[+−-]?[\d,.]+$|^—$/.test(r[i])));
    return out;
  }

  // The export file name of each chart (CVI's names where the chart is the same kind).
  const FILE_NAMES = { species: 'species_breakdown.png', corridors: 'corridors.png', over_time: 'volume_over_time.png',
    emerging: 'emerging_cooling.png', top_premises: 'top_premises.png', species_heatmap: 'temporal_heatmap.png',
    place_heatmap: 'entity_heatmap.png' };
  function fileName(id, view) {
    if (id === 'top_places') return view === 'flow' ? 'top_states.png' : 'top_counties.png';
    return FILE_NAMES[id];
  }

  root.CVIWA = root.CVIWA || {};
  root.CVIWA.charts = { CHARTS, COLORS, MEASURES, speciesColor, measureAvailable, total, placeOf, periodOf,
    countyLabel, species, topPlaces, topPremises, corridors, overTime, emerging, speciesHeatmap, placeHeatmap,
    exportPeriodCount, build, chartsFor, fileName, precision, commaLabels, shortLabels, exact, table };
})(typeof window !== 'undefined' ? window : globalThis);
