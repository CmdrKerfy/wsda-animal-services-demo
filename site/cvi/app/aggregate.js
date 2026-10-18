/* WA State circle data: port of CVI shiny/R/map_helpers.R build_county_circle_data() and
 * .species_breakdown_by_key(), plus the tooltip the live map actually shows (mod_maps.R .build_county_map
 * replaces the builder tooltip). */
(function (root) {
  'use strict';
  const S = () => root.CVIWA.scaling;
  const COLORS = { Inbound: '#1C9CD9', Outbound: '#F0A06E', Total: '#245566' };
  const nonblank = s => s !== null && s !== undefined && String(s).trim().length > 0;
  const cmpC = (a, b) => (a < b ? -1 : a > b ? 1 : 0);          // dplyr group_by / data.table setorder: C locale

  // The sum of the numbers, missing ones skipped (R's sum(na.rm = TRUE)).
  function sumNaRm(xs) { let t = 0; for (const x of xs) if (x !== null && !Number.isNaN(x)) t += x; return t; }

  // Per-direction aggregate: rows with that movement, county coordinates present and a nonblank county.
  // Anchor = coordinates of the first row after a stable sort by Reporting.Year descending (NA last).
  function directionAgg(df, movement, countyCol, latCol, lonCol) {
    const groups = new Map();
    df.forEach((r, idx) => {
      if (r.Movement !== movement || r[latCol] === null || r[lonCol] === null || !nonblank(r[countyCol])) return;
      const k = r[countyCol];
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push({ r, idx });
    });
    const out = [];
    for (const [county, items] of groups) {
      const sorted = items.slice().sort((a, b) => {
        const ya = a.r['Reporting.Year'], yb = b.r['Reporting.Year'];
        if (ya === yb) return a.idx - b.idx;
        if (ya === null) return 1; if (yb === null) return -1;
        return yb - ya || a.idx - b.idx;
      });
      out.push({ county, lat: sorted[0].r[latCol], lon: sorted[0].r[lonCol],
        total_animals: sumNaRm(items.map(x => x.r['Total.Animals'])) });
    }
    return out.sort((a, b) => cmpC(a.county, b.county));
  }

  // For each key, the hover's species lines: the labels by animals, the most first, the first maxN (6 unless given)
  // and "Other" for the rest; an empty text for a key with fewer than two labels.
  function speciesBreakdownByKey(keys, labels, animals, maxN) {
    maxN = maxN || 6;
    const order = [], sums = new Map();
    keys.forEach((k, i) => {
      const l = labels[i];
      if (k === null || l === null || !nonblank(l)) return;
      const lt = String(l).trim(), id = k + '\u0000' + lt;
      if (!sums.has(id)) { sums.set(id, { k, l: lt, a: 0, first: order.length }); order.push(id); }
      const a = animals[i]; if (a !== null && !Number.isNaN(a)) sums.get(id).a += a;
    });
    const byKey = new Map();
    order.forEach(id => { const g = sums.get(id); if (!byKey.has(g.k)) byKey.set(g.k, []); byKey.get(g.k).push(g); });
    const out = new Map();
    for (const [k, list] of byKey) {
      list.sort((p, q) => q.a - p.a || p.first - q.first);
      const nlab = list.length;
      if (nlab < 2) { out.set(k, ''); continue; }
      const fmt = S().formatR, rr = S().rRound;
      let parts;
      if (nlab > maxN) {
        const head = list.slice(0, maxN), oth = list.slice(maxN).reduce((s, g) => s + g.a, 0);
        const f = fmt(head.map(g => rr(g.a)));
        parts = head.map((g, i) => g.l + ': ' + f[i]).concat(['Other: ' + fmt([rr(oth)])[0]]);
      } else {
        const f = fmt(list.map(g => rr(g.a)));
        parts = list.map((g, i) => g.l + ': ' + f[i]);
      }
      out.set(k, '<br/>' + parts.join('<br/>'));
    }
    return out;
  }

  // opts: species, years, quarters, direction (array), mode, scaling, nBins, rawSpecies (array), hasSpecies, and keep
  // (optional: a further row rule, the chart filters of crossfilter.js; without it the result is unchanged)
  function build(rows, opts) {
    const dir = opts.direction, sp = new Set(opts.species), yr = new Set(opts.years), qt = new Set(opts.quarters),
      dset = new Set(dir);
    let df = rows.filter(r => r['Species.Group'] !== null && sp.has(r['Species.Group'])
      && r['Reporting.Year'] !== null && yr.has(r['Reporting.Year'])
      && r['Reporting.Quarter'] !== null && qt.has(r['Reporting.Quarter']) && r.Movement !== null && dset.has(r.Movement));
    if (opts.rawSpecies && opts.rawSpecies.length && opts.hasSpecies) {
      const raw = new Set(opts.rawSpecies); df = df.filter(r => r.Species !== null && raw.has(r.Species));
    }
    if (opts.keep) df = df.filter(opts.keep);
    if (!df.length) return [];
    const useRaw = opts.species.length === 1 && opts.hasSpecies;
    const lab = df.map(r => useRaw ? r.Species : r['Species.Group']);
    const rowCounty = df.map(r => r.Movement === 'Inbound' ? r['Dest.County'] : r['Origin.County']);
    const animals = df.map(r => r['Total.Animals']);
    const fmt = S().formatR, rr = S().rRound;
    const tip = (rowsOut, bd, keyOf) => {
      const f = fmt(rowsOut.map(r => rr(r.total_animals)));
      rowsOut.forEach((r, i) => {
        const b = bd.get(keyOf(r));
        r.builder_tooltip = '<strong>' + r.county + ' County</strong><br/>' + r.direction + ': ' + f[i] + ' animals'
          + (b === undefined ? '' : b);
      });
    };

    if (opts.mode === 'total' && dir.length > 1) {
      const inb = directionAgg(df, 'Inbound', 'Dest.County', 'Dest.County.Lat', 'Dest.County.Long');
      const outb = directionAgg(df, 'Outbound', 'Origin.County', 'Origin.County.Lat', 'Origin.County.Long');
      const comb = new Map();
      inb.concat(outb).forEach(r => {
        if (!comb.has(r.county)) comb.set(r.county, { county: r.county, lat: r.lat, lon: r.lon, total_animals: 0 });
        comb.get(r.county).total_animals += r.total_animals;
      });
      const out = [...comb.values()].sort((a, b) => cmpC(a.county, b.county))
        .map(r => Object.assign(r, { direction: 'Total', color: COLORS.Total }));
      if (!out.length) return [];
      const radii = S().computeRadius(out.map(r => r.total_animals), opts.scaling, 4, 48, opts.nBins);
      out.forEach((r, i) => { r.radius_px = radii[i]; r.stroke_color = '#ffffff'; });
      tip(out, speciesBreakdownByKey(rowCounty, lab, animals), r => r.county);
      return out;
    }

    const offset = dir.length > 1 ? 0.20 : 0;
    const parts = [];
    if (dset.has('Inbound')) parts.push(directionAgg(df, 'Inbound', 'Dest.County', 'Dest.County.Lat', 'Dest.County.Long').map(r => Object.assign(r, { lon: r.lon - offset, direction: 'Inbound', color: COLORS.Inbound })));
    if (dset.has('Outbound')) parts.push(directionAgg(df, 'Outbound', 'Origin.County', 'Origin.County.Lat', 'Origin.County.Long').map(r => Object.assign(r, { lon: r.lon + offset, direction: 'Outbound', color: COLORS.Outbound })));
    if (!parts.length) return [];
    // Each direction scaled independently.
    parts.forEach(p => {
      const rad = S().computeRadius(p.map(r => r.total_animals), opts.scaling, 4, 48, opts.nBins);
      p.forEach((r, i) => { r.radius_px = rad[i]; });
    });
    const out = [].concat(...parts);
    if (!out.length) return [];
    out.forEach(r => { r.stroke_color = '#ffffff'; });
    const keys = rowCounty.map((c, i) => c === null ? null : c + '\r' + df[i].Movement);
    tip(out, speciesBreakdownByKey(keys, lab, animals), r => r.county + '\r' + r.direction);
    return out;
  }

  // What the live WA State map shows on hover (mod_maps.R .build_county_map); format() spans all circles.
  function liveTooltips(d) {
    const f = S().formatR(d.map(r => S().rRound(r.total_animals)));
    return d.map((r, i) => '<strong>' + r.county + '</strong><br/>' + r.direction + ': ' + f[i] + ' animals');
  }

  root.CVIWA = root.CVIWA || {};
  root.CVIWA.aggregate = { build, liveTooltips, speciesBreakdownByKey, directionAgg, COLORS };
})(typeof window !== 'undefined' ? window : globalThis);
