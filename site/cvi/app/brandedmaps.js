/* Branded map PNGs of the CVI page (S9): what each map shows on the shared branded page (site/shared/branded.js).
 * Structural parity with CVI's renderers in shiny/R/static_map_renderer.R ("SMR"): the same title,
 * rows, boxes, legend, marks and colors, computed from the numbers the page already shows on screen.
 *
 * The WA State map (render_branded_county_map, SMR 2838-3220) on the Default background. wa() returns the
 * page's model (every string, number and color, for the tests) and its SVG parts; branded.svg() and branded.png()
 * turn them into the picture. Deliberate differences: Web Mercator, the brand options (branded.js),
 * the page's direction palettes and Combined color (S1.1, as on screen), the page's own label placement. */
(function (root) {
  'use strict';
  const B = () => root.WSDA.branded;
  // The longest prefix, of n characters at most, for which fits(k) holds (0 when none does). fits must hold for every
  // shorter prefix once it holds for a longer one, as text widths only grow; then this is the same answer as taking off
  // one character at a time, found by halving (a 50,000-character name took minutes the old way).
  function longestFitting(n, fits) {
    if (fits(n)) return n;
    let lo = 0, hi = n - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fits(mid)) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
  const S = () => root.CVIWA.scaling;
  const SUM = () => root.CVIWA.summary;
  const PAL = () => root.CVIWA.palettes;

  const MIN_PT = 3.0;   // the smallest circle (SMR 127)
  // WA State's limits, widened as coord_sf(expand = TRUE) does: 5% of each range on each side (SMR 3054-3061).
  const WA_LIMITS = { west: -124.85, east: -116.85, south: 45.4, north: 49.10 };
  function expand(l) {
    const dx = (l.east - l.west) * 0.05;
    const dy = (l.north - l.south) * 0.05;
    return { west: l.west - dx, east: l.east + dx, south: l.south - dy, north: l.north + dy };
  }
  const QUARTER_MONTHS = { Q1: 'Jan – Mar', Q2: 'Apr – Jun', Q3: 'Jul – Sep', Q4: 'Oct – Dec' };
  const cmpC = (a, b) => (a < b ? -1 : a > b ? 1 : 0);   // dplyr group_by: the C locale
  const cmpR = (a, b) => String(a).localeCompare(String(b), 'en');   // R's sort() of species names

  // ── Strings ─────────────────────────────────────────────────────────────────────────────────────────────────
  // "ALL SPECIES" when every species of the master is picked, one species in capitals, else the sorted list
  // (SMR 2924-2929).
  function speciesLabel(species, universe) {
    const a = species.slice().sort(cmpR);
    const u = universe.slice().sort(cmpR);
    const same = a.length === u.length && a.every((s, i) => s === u[i]);
    if (same) return 'ALL SPECIES';
    if (species.length === 1) return String(species[0]).toUpperCase();
    return a.map(s => String(s).toUpperCase()).join(', ');
  }
  const directionLabel = direction => (direction.length > 1 ? 'IMPORTS + EXPORTS'
    : direction[0] === 'Inbound' ? 'IMPORTS' : 'EXPORTS');
  // "CY 2025:" and "Full Year", "Jul – Sep" or "Q1 – Q3" (.period_parts, SMR 1503-1513). Ticks that skip a year or
  // quarter are listed as runs, "CY 2023, 2025:" and "Q1, Q3" (a deliberate difference: CVI writes "CY 2023–2025:"
  // and "Q1 – Q3", as if the ones between were in). yearChoices: the master's years (a year with no records is no
  // gap); without them, the years as CVI writes them.
  const quarterNumber = q => (/^Q[1-4]$/.test(q) ? Number(q[1]) : NaN);
  function periodParts(quarters, years, yearChoices) {
    const lo = Math.min(...years);
    const hi = Math.max(...years);
    const qs = quarters.slice().sort(cmpC);
    const value = qs.length === 4 ? 'Full Year'
      : qs.length === 1 ? (QUARTER_MONTHS[qs[0]] || qs[0])
        : SUM().gapRuns(qs.map(quarterNumber), n => 'Q' + n, ' – ') || qs[0] + ' – ' + qs[qs.length - 1];
    const yearText = (yearChoices && SUM().gapRuns(years, String, '–', yearChoices)) || (lo === hi ? lo : lo + '–' + hi);
    return { prefix: 'CY ' + yearText + ':', value };
  }
  // A trimmed custom title wins, cut to 79 characters and "…" past 80; blank uses the auto title (SMR 1518-1524).
  function resolveTitle(custom, auto) {
    const t = String(custom === null || custom === undefined ? '' : custom).trim();
    if (!t) return auto;
    const chars = Array.from(t);
    return chars.length > 80 ? chars.slice(0, 79).join('') + '…' : t;
  }

  // ── The legend's tiers (.county_legend_spec, SMR 2646-2690) ────────────────────────────────────────────────
  const uniqueNum = a => a.filter((v, i) => a.indexOf(v) === i);
  // Breaks for "quantile" and "natural" (.county_legend_breaks, SMR 2606-2644); null when there are none.
  function legendBreaks(values, scaling, nBins) {
    if (values.length < 2) return null;
    const n = Math.max(2, nBins);
    const quantiles = () => S().quantile7(values, S().seqProbs(n + 1));
    let brks;
    if (scaling === 'quantile') {
      brks = quantiles();
    } else {
      try {
        brks = S().fisherBreaks(values, n);
      } catch (e) {
        brks = null;
      }
      if (!brks || uniqueNum(brks).length < 2) brks = quantiles();
    }
    brks = uniqueNum(brks);
    return brks.length < 2 ? null : brks;
  }
  // "0 – 12", "13 – 70": the first interval from its lower break, the others from one above (SMR 2590-2604).
  function intervalLabels(brks) {
    const c = x => S().comma(S().rRound(x));
    const out = [];
    for (let i = 0; i + 1 < brks.length; i++) {
      out.push((i === 0 ? c(brks[i]) : c(brks[i] + 1)) + ' – ' + c(brks[i + 1]));
    }
    return out;
  }
  // The legend's labels and circle sizes (ggplot2 size units) for a set of circle values; null when CVI falls back
  // to its fixed tiers. toSize turns the map's pixel radius into the PNG's size, as the circles.
  function countyLegendSpec(values, scaling, nBins, toSize) {
    const v = values.filter(x => x !== null && !Number.isNaN(x) && x > 0);
    if (!v.length) return null;
    const minPx = 4;
    const maxPx = 48;
    if (scaling === 'quantile' || scaling === 'natural') {
      const brks = legendBreaks(v, scaling, nBins);
      if (!brks) return null;
      const bins = S().bincode(v, brks).map(b => (b === null ? 1 : b));
      const maxBin = Math.max(...bins);
      if (maxBin < 2) return null;
      const radii = [];
      for (let i = 1; i <= maxBin; i++) radii.push(toSize(minPx + ((i - 1) / (maxBin - 1)) * (maxPx - minPx)));
      return { labels: intervalLabels(brks).slice(0, maxBin), sizes: radii };
    }
    const vals = uniqueNum(S().quantile7(v, [0.1, 0.5, 0.9]));
    const vmax = Math.max(...v);
    const norm = x => (scaling === 'sqrt' ? Math.sqrt(x) / Math.sqrt(vmax)
      : scaling === 'linear' ? x / vmax : Math.log1p(x) / Math.log1p(vmax));
    return {
      labels: vals.map(x => S().comma(S().rRound(x))),
      sizes: vals.map(x => toSize(minPx + norm(x) * (maxPx - minPx)))
    };
  }
  // CVI's fixed tiers, used when no tiers can be computed (SMR 2530-2532).
  const FIXED_TIERS = { labels: ['< 100', '101 – 1,000', '1,001 – 10,000', '> 10,000'], sizes: [2.0, 4.0, 6.5, 9.5] };

  // ── Top 3 counties (.build_top3_county_split, SMR 2752-2823) ───────────────────────────────────────────────
  // The n counties with the most animals (one direction, or all), ties in county order; CVI's top 3 is n = 3.
  function topN(rows, direction, n) {
    const sums = new Map();
    for (const r of rows) {
      if (direction && r.direction !== direction) continue;
      const a = r.total_animals;
      sums.set(r.county, (sums.get(r.county) || 0) + (a === null || Number.isNaN(a) ? 0 : a));
    }
    const groups = [...sums].map(([county, animals]) => ({ county, animals })).sort((a, b) => cmpC(a.county, b.county));
    return groups.map((g, i) => Object.assign(g, { i }))
      .sort((a, b) => b.animals - a.animals || a.i - b.i).slice(0, n);
  }
  const top3 = (rows, direction) => topN(rows, direction, 3);
  // The shaded map's Top 5 (one list with in and out, expanded from Top 3 to Top 5,
  // without a note under it): ranked by the measure the map is shaded by, the Combined value with both directions
  // ticked, as the map's colors, ties in county order. With both directions each county's Total first, then its In and
  // Out (the column that sets the order first); with one direction its value only. Animals per square mile:
  // the values as the legend writes them and no total row (they are rates); Total animals: a Total row.
  const SHADE_TOP = 5;
  function topShaded(rows, perSqMi, both, title) {
    const valuesOf = rs => CP().countyValues(rs, perSqMi ? 'per_sq_mi' : 'total');
    const all = valuesOf(rows);
    const list = [...all].map(([county, v]) => ({ county, v })).sort((a, b) => cmpC(a.county, b.county))
      .map((g, i) => Object.assign(g, { i })).sort((a, b) => b.v - a.v || a.i - b.i).slice(0, SHADE_TOP);
    const fmt = v => (v === undefined || v === null ? '–' : perSqMi ? CP().format(v, 'per_sq_mi') : S().comma(v));
    if (!both) {
      return { title, color: '#1c5a83', top: 1.00, height: 1.00, rows: list.map(g => ({ label: g.county, value: fmt(g.v) })),
        total: perSqMi ? null : S().comma(list.reduce((t, g) => t + g.v, 0)) };
    }
    const inb = valuesOf(rows.filter(r => r.direction === 'Inbound'));
    const outb = valuesOf(rows.filter(r => r.direction === 'Outbound'));
    const sum = m => list.reduce((t, g) => t + (m.get(g.county) || 0), 0);
    return { title, color: '#1c5a83', columns: ['Total', 'In', 'Out'],
      rows: list.map(g => ({ label: g.county, values: [fmt(g.v), fmt(inb.get(g.county)), fmt(outb.get(g.county))] })),
      total: perSqMi ? null : [S().comma(sum(all)), S().comma(sum(inb)), S().comma(sum(outb))] };
  }
  // A Top box with columns (topShaded with both directions): the title bar, a row of column names, a row per county
  // (the first value bold), then the Total row unless the values are rates.
  function topColumns(p, s) {
    const BR = B();
    const n = s.rows.length + 2 + (s.total ? 1 : 0);
    const rh = 1 / n;
    const pt = BR.textPt(2.9);
    const parts = [BR.rect(p.u(0), p.v(1), p.u(1) - p.u(0), p.v(1 - rh) - p.v(1), s.color)];
    parts.push(BR.text(s.title, p.u(0.5), p.v(1 - rh / 2), { pt: BR.textPt(3.4), color: '#ffffff', bold: true,
      anchor: 'middle' }));
    const cols = [0.53, 0.75, 0.95];
    s.columns.forEach((h, i) => parts.push(BR.text(h, p.u(cols[i]), p.v(1 - 1.5 * rh), { pt: BR.textPt(2.5),
      color: '#555555', bold: true, anchor: 'end' })));
    s.rows.forEach((r, i) => {
      const y = p.v(1 - 2 * rh - (i + 0.5) * rh);
      parts.push(BR.text(r.label, p.u(0.05), y, { pt, color: '#222222' }));
      r.values.forEach((v, k) => parts.push(BR.text(v, p.u(cols[k]), y, { pt, color: '#222222', anchor: 'end',
        bold: k === 0 })));
    });
    if (s.total) {
      const d = 1 - 2 * rh - s.rows.length * rh;
      parts.push(BR.line(p.u(0.04), p.v(d), p.u(0.96), p.v(d), '#bbbbbb', BR.linePt(0.3)));
      parts.push(BR.text('Total', p.u(0.05), p.v(d - rh / 2), { pt, color: '#222222', bold: true }));
      s.total.forEach((v, k) => parts.push(BR.text(v, p.u(cols[k]), p.v(d - rh / 2), { pt, color: '#222222', bold: true,
        anchor: 'end' })));
    }
    return parts.join('');
  }
  // A list with no county (a GIF frame without that direction) keeps three rows' layout and says so.
  function topSection(list, title, color, top, height) {
    const rows = list.length ? list.map(g => ({ label: g.county, value: S().comma(g.animals) }))
      : [{ label: 'No movements', value: '' }, { label: '', value: '' }, { label: '', value: '' }];
    return { title, color, top, height, rows, total: S().comma(list.reduce((s, g) => s + g.animals, 0)) };
  }

  // ── County names on the map (the page's own placement) ─────────────────────────────────────────────────────
  // CVI names every county that has a circle (SMR 2979-2995) and places each name off its circles and inside its
  // county (.place_county_labels). The page does the same with its own rule (a deliberate difference): around the
  // box of the county's circles, eight places next to it, then more rings of eight, each about one name-height
  // farther out, then five places over the county's own circles (the box's middle, a name-height above and below it,
  // a quarter of the name to its left and right), then a grid of places across the county itself (at most about 20
  // by 20, nearest first). A place is free when it touches no circle and no name placed before and stays inside `area`
  // (the map below the stat row). A name stays in its county when it can, so each name takes, in this order:
  //   (a) the first free place with the whole name inside its county (its middle and both ends);
  //   (b) a place with the whole name inside its county that touches no name, over circles (over: the caller draws it
  //       on top of the circles, with its halo): the first touching only its own circles; when there is none (a
  //       county filled by its own circles beside a neighbor's, as Walla Walla), the one covering the least of the
  //       other counties' circles (overOthers);
  //   (c) the first free place partly or wholly outside its county, those with the name's middle in the county first
  //       (small counties such as San Juan);
  //   (d) when no place is free, the one covering the least, as before.
  // items: { name, box } largest first, or { name, at: [x, y] } for a name with a preferred place (tried first; the
  // rings then go around it); circles: { x, y, r, county } in points, where county names the circle's county, or is
  // null for a mark of no county (the movement view's badges), or is left out to count a circle as the county's when
  // its center lies in it; rings: how many rings (3 by default). Returns { name, x, y, box, free, over, overOthers,
  // step } per item, step 'a' to 'd'.
  function placeLabels(items, circles, features, project, pt, area, rings) {
    const norm = v => String(v).trim().toLowerCase();
    const byName = new Map(features.map(f => [norm(f.properties.name), f]));
    const placed = [];
    const overlap = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) *
      Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
    // Does a circle touch a box (the nearest point of the box within the radius)?
    const touches = (c, b) => {
      const dx = c.x - Math.max(b.x0, Math.min(c.x, b.x1));
      const dy = c.y - Math.max(b.y0, Math.min(c.y, b.y1));
      return dx * dx + dy * dy < c.r * c.r;
    };
    const circleBox = c => ({ x0: c.x - c.r, x1: c.x + c.r, y0: c.y - c.r, y1: c.y + c.r });
    // Each county's rings in page points, projected once; a point is inside by the even-odd rule over every ring
    // (branded.js insideGeometry's rule).
    const projected = new Map();
    const ringsOf = f => {
      if (!projected.has(f)) {
        const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
        projected.set(f, [].concat(...polys.map(poly => poly.map(ring => ring.map(c => project(c[0], c[1]))))));
      }
      return projected.get(f);
    };
    const inside = (f, x, y) => {
      let hit = false;
      for (const pts of ringsOf(f)) {
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const [xi, yi] = pts[i];
          const [xj, yj] = pts[j];
          if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
        }
      }
      return hit;
    };
    const out = [];
    for (const it of items) {
      const w = B().textWidth(it.name, pt) + 2;
      const h = pt * 0.95;
      const o = it.at ? { x0: it.at[0], x1: it.at[0], y0: it.at[1], y1: it.at[1] } : it.box;
      const cx = (o.x0 + o.x1) / 2;
      const cy = (o.y0 + o.y1) / 2;
      const spots = it.at ? [it.at.slice()] : [];
      for (let ring = 0; ring < (rings || 3); ring++) {
        const g = 2 + ring * h * 1.2;
        spots.push([cx, o.y1 + g + h / 2], [cx, o.y0 - g - h / 2], [o.x1 + g + w / 2, cy],
          [o.x0 - g - w / 2, cy], [o.x1 + g / 2 + w / 2, o.y1 + g / 2 + h / 2],
          [o.x0 - g / 2 - w / 2, o.y1 + g / 2 + h / 2], [o.x1 + g / 2 + w / 2, o.y0 - g / 2 - h / 2],
          [o.x0 - g / 2 - w / 2, o.y0 - g / 2 - h / 2]);
      }
      spots.push([cx, cy], [cx, cy - h * 1.1], [cx, cy + h * 1.1], [cx - w / 4, cy], [cx + w / 4, cy]);
      const feature = byName.get(norm(it.name));
      if (feature) {
        const pts = [].concat(...ringsOf(feature));
        const x0 = Math.min(...pts.map(q => q[0]));
        const x1 = Math.max(...pts.map(q => q[0]));
        const y0 = Math.min(...pts.map(q => q[1]));
        const y1 = Math.max(...pts.map(q => q[1]));
        const sx = Math.max(w / 4, (x1 - x0) / 20);
        const sy = Math.max(h, (y1 - y0) / 20);
        const grid = [];
        for (let y = y0 + sy / 2; y < y1; y += sy) {
          for (let x = x0 + sx / 2; x < x1; x += sx) {
            if (inside(feature, x, y)) grid.push([x, y]);
          }
        }
        grid.sort((p, q) => Math.hypot(p[0] - cx, p[1] - cy) - Math.hypot(q[0] - cx, q[1] - cy));
        spots.push(...grid);
      }
      const own = c => (c.county === undefined ? !!feature && inside(feature, c.x, c.y)
        : c.county !== null && norm(c.county) === norm(it.name));
      let best = null;
      spots.forEach(([x, y], k) => {
        const b = { x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2 };
        const hit = circles.filter(c => touches(c, b));
        const onName = placed.some(p => overlap(b, p) > 0);
        const offArea = b.x0 < area.x0 || b.x1 > area.x1 || b.y0 < area.y0 || b.y1 > area.y1;
        const free = !hit.length && !onName && !offArea;
        const middleIn = !feature || inside(feature, x, y);
        const wholeIn = !feature || (middleIn && inside(feature, b.x0, y) && inside(feature, b.x1, y));
        let score;
        let step;
        if (free && wholeIn) {
          score = k;
          step = 'a';
        } else if (!free && !onName && !offArea && wholeIn && !hit.some(c => c.badge)) {
          // Over its own circles only first; else the least of the other counties' circles covered.
          const others = hit.filter(c => !own(c)).reduce((t, c) => t + overlap(b, circleBox(c)), 0);
          score = hit.every(own) ? 1000 + k : 1300 + Math.min(600, others / 10) + k * 0.01;
          step = 'b';
        } else if (free) {
          score = 2000 + (middleIn ? 0 : 500) + k;
          step = 'c';
        } else {
          score = 1e6 + (offArea ? 1e5 : 0) + (middleIn ? 0 : 50) + k * 0.01;
          for (const p of placed) score += overlap(b, p) * 10;
          for (const c of hit) score += overlap(b, circleBox(c));
          step = 'd';
        }
        if (!best || score < best.score) best = { x, y, score, b, free, step, overOthers: step === 'b' && score >= 1300 };
      });
      placed.push(best.b);
      out.push({ name: it.name, x: best.x, y: best.y, box: best.b, free: best.free, over: best.step === 'b',
        overOthers: best.overOthers, step: best.step });
    }
    return out;
  }

  // ── The legend line naming the sizing ───────────────────────────────────────────────────────────────────────
  // "Circle size: log scale", "Circle size: natural breaks, 5 classes". classes: the number of classes in each
  // legend section (natural breaks and quantiles), or null when the legend shows CVI's fixed tiers.
  const SCALE_WORDS = { log: 'log scale', sqrt: 'square-root scale', linear: 'linear scale',
    quantile: 'quantiles', natural: 'natural breaks' };
  function sizingLine(what, scaling, classes) {
    const words = SCALE_WORDS[scaling] || scaling;
    if ((scaling !== 'quantile' && scaling !== 'natural') || !classes || !classes.length) {
      return what + ': ' + words;
    }
    const lo = Math.min(...classes);
    const hi = Math.max(...classes);
    return what + ': ' + words + ', ' + (lo === hi ? hi + ' classes' : lo + ' to ' + hi + ' classes');
  }
  const SOURCE_COUNTIES = 'Data: WSDA Animal Services CVI records · County boundaries: U.S. Census Bureau';

  // ── Tile backgrounds (tiles.js) ─────────────────────────────────────────────────────────────────────────────
  const backgroundOf = input => (input.background && root.WSDA.tiles && root.WSDA.tiles.BACKGROUNDS[input.background]) ||
    null;
  // Where the picture goes under the page: the map's panel, cut to the given counties, and that panel's box in
  // longitude/latitude for the request; CVI's base zoom for the tiles.
  function underlayOf(input, panel, fit, maskFeatures, zoom) {
    if (!backgroundOf(input)) return null;
    const BR = B();
    const [west, north] = fit.unproject(panel.left, panel.top);
    const [east, south] = fit.unproject(panel.left + panel.width, panel.top + panel.height);
    return { key: input.background, box: { left: panel.left, top: panel.top, width: panel.width, height: panel.height },
      extent: { west, east, south, north }, mask: maskFeatures.map(f => BR.pathData(f.geometry, fit.project)), zoom };
  }

  // ── Neighboring regions (NR) on WA State, as on screen ──────────────────────────────────────────────────────
  // regions: [{ id, outline (a GeoJSON feature), counties (a FeatureCollection, or null when its county lines are
  // off), credit, statement }]. While one is drawn, the neighbors take Washington's usual gray and Washington turns white with
  // light gray county lines (the screen's rule); the regions' credits join the source line.
  function regionParts(regions, project) {
    const BR = B();
    const parts = [];
    for (const r of regions || []) {
      parts.push('<path d="' + BR.pathData(r.outline.geometry, project) + '" fill="#e8e8e8" stroke="#8a8a8a" ' +
        'stroke-width="' + BR.num(BR.linePt(0.4)) + '" stroke-linejoin="round"/>');
      for (const c of (r.counties && r.counties.features) || []) {
        parts.push('<path d="' + BR.pathData(c.geometry, project) + '" fill="none" stroke="#ffffff" stroke-width="' +
          BR.num(BR.linePt(0.4)) + '"/>');
      }
    }
    return parts.join('');
  }
  // Washington's land and line colors: white land with gray lines beside neighboring regions, else gray with white.
  const waLand = regions => (regions && regions.length ? { fill: '#ffffff', line: '#c8c8c8' }
    : { fill: '#e8e8e8', line: '#ffffff' });

  // ── Population context (PC, shared/population.js) ─────────────────────────────────────────────────────────────
  // input.population: { on: { cities, places, density }, ramp, names } (names false: the layers' names left out, as
  // with Streets). Null while every layer is off, so nothing is added. The names are drawn over the circles, a name
  // going on top of a circle only when it has no spot clear of them.
  function populationOf(input) {
    const p = input.population;
    const on = p && p.on;
    return on && (on.cities || on.places || on.density) && root.WSDA.population ? p : null;
  }
  // The layers' SVG for a map: density, then the outlines, then the county lines drawn again over them (the land
  // paths draw the lines under the layers). clip: county features to cut to; null for the whole state.
  function populationLayers(pop, features, project, o) {
    const BR = B();
    const svg = root.WSDA.population.svgParts(pop.on, project, { ramp: pop.ramp, extent: o.extent, clip: o.clip,
      id: o.id });
    const lines = features.map(f => '<path d="' + BR.pathData(f.geometry, project) + '" fill="none" stroke="' + o.line +
      '" stroke-width="' + BR.num(BR.linePt(o.width)) + '" stroke-linejoin="round"/>').join('');
    return svg.density + svg.outlines + lines;
  }
  // The layers' names, clear of the boxes taken, and of the marks where they can be; { markup, placed, dropped }.
  function populationNames(pop, project, area, taken, marks, o) {
    const PN = root.WSDA.population;
    if (pop.names === false) return { markup: '', placed: [], dropped: [] };
    const pt = B().textPt(2.5);
    const r = PN.placeNames(PN.names(pop.on, { min: o.min, counties: o.counties }), project, pt, area, taken, marks);
    return { markup: PN.nameMarkup(r.placed, pt), placed: r.placed, dropped: r.dropped };
  }
  // The layers' legend rows (under "POPULATION CONTEXT") and the source line with their credits; nothing
  // added while every layer is off. s: the page's legend scale; width: the legend column's inner width in points
  // (WA State's gutter by default).
  function populationLegend(pop, s, width) {
    const BR = B();
    const k = s || 1;
    return pop ? root.WSDA.population.pngLegend(pop.on, { ramp: pop.ramp, pt: BR.textPt(2.6 * k),
      titlePt: BR.textPt(3.0 * k), width: width || BR.px(BR.LAYOUT.gutterW) - 10 }) : [];
  }
  // ── The WA inset's corner (Premise Lookup and County Focus) ────────────────────────────────────────────────
  // The inset's size and CVI's place (branded.js inset(), SMR 4452-4456), in page fractions.
  const INSET = { w: 0.130, h: 0.0715, gap: 0.008, y: 0.030 };
  // The four corners in the order tried: the bottom right (CVI's), bottom left, top left, top right. mapH: the map's
  // top, a page fraction.
  function insetCorners(mapH) {
    const L = B().LAYOUT;
    const right = L.mapW - INSET.w - INSET.gap;
    const top = mapH - INSET.h - INSET.gap;
    return [{ corner: 'bottom right', x: right, y: INSET.y }, { corner: 'bottom left', x: INSET.gap, y: INSET.y },
      { corner: 'top left', x: INSET.gap, y: top }, { corner: 'top right', x: right, y: top }];
  }
  // The inset's box in points: { x0, x1, y0, y1 }.
  function insetBox(at) {
    const BR = B();
    return { x0: BR.px(at.x), x1: BR.px(at.x + INSET.w), y0: BR.py(at.y + INSET.h), y1: BR.py(at.y) };
  }
  // A circle { x, y, r } touching a box; two boxes meeting.
  const touchesBox = (c, b) => {
    const dx = c.x - Math.max(b.x0, Math.min(c.x, b.x1));
    const dy = c.y - Math.max(b.y0, Math.min(c.y, b.y1));
    return dx * dx + dy * dy < c.r * c.r;
  };
  // Whether two boxes ({ x0, x1, y0, y1 }) overlap.
  const boxesMeet = (a, b) => Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) && Math.min(a.y1, b.y1) > Math.max(a.y0, b.y0);
  // The share of a box that lies on land: rings (projected, in points) tested at the centers of a 26 x 14 grid, by
  // the even-odd rule (holes and islands as drawn). Land too thin for the grid still counts when one of its corners
  // lies in the box, so a clear box (0) has no land in it at all.
  const LAND_GRID = [26, 14];
  function landShare(b, rings) {
    const [nx, ny] = LAND_GRID;
    const inside = (x, y) => {
      let odd = false;
      for (const ring of rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, yi] = ring[i];
          const [xj, yj] = ring[j];
          if ((yi > y) !== (yj > y) && x < xj + (y - yj) * (xi - xj) / (yi - yj)) odd = !odd;
        }
      }
      return odd;
    };
    let on = 0;
    for (let i = 0; i < nx; i++) {
      for (let k = 0; k < ny; k++) {
        if (inside(b.x0 + (i + 0.5) * (b.x1 - b.x0) / nx, b.y0 + (k + 0.5) * (b.y1 - b.y0) / ny)) on++;
      }
    }
    if (on > 0) return on / (nx * ny);
    const vertexIn = rings.some(ring => ring.some(([x, y]) => x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1));
    return vertexIn ? 1 / (nx * ny) : 0;
  }
  // County Focus's corner (so that the inset does not cover part of a county such as Asotin): the first
  // corner that covers no focus-county land, circle, marker or name; with none clear, the one covering the fewest
  // circles, markers and names, then the least land (ties in the order tried). CVI's style keeps the bottom right.
  // land: the focus counties' features; P: the map's projection; marks: { x, y, r }; names: boxes, in points.
  // Returns { corner, x, y, covers, land, scores }.
  function focusInsetCorner(mapH, land, P, marks, names, style) {
    const corners = insetCorners(mapH);
    if (!style.insetCorner) return Object.assign({}, corners[0], { covers: null, land: null, scores: null });
    const rings = [];
    for (const c of land) {
      const g = c.geometry;
      const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
      for (const poly of polygons) for (const ring of poly) rings.push(ring.map(([lon, lat]) => P(lon, lat)));
    }
    const scored = corners.map(c => {
      const b = insetBox(c);
      return Object.assign({}, c, { covers: marks.filter(m => touchesBox(m, b)).length +
        names.filter(n => boxesMeet(n, b)).length, land: landShare(b, rings) });
    });
    const pick = scored.find(c => c.covers === 0 && c.land === 0) ||
      scored.slice().sort((a, b) => a.covers - b.covers || a.land - b.land)[0];
    return Object.assign({}, pick, { scores: scored.map(c => ({ corner: c.corner, covers: c.covers, land: c.land })) });
  }

  // When the legend column cannot hold the population rows without drawing its rows closer, the rows go into a
  // box of their own over a corner of the map, as County Focus's inset sits over its bottom right: the first of the
  // bottom left, top left and top right corners that covers no circle, marker or name, else the bottom left. marks:
  // { x, y, r } in points; names: boxes { x0, x1, y0, y1 }; floor: the lowest the box may sit (a page fraction, above
  // the source line). keepOff: the WA inset's box, when it may have left the bottom right: it counts as a name, and
  // with no corner clear the box goes to the first corner off the inset. Returns { parts, box, corner, fallback }
  // (fallback: no corner was clear).
  function populationCorner(rows, mapPanel, marks, names, floor, keepOff) {
    const BR = B();
    const w = BR.LAYOUT.gutterW;
    const pageW = BR.px(1);
    const pageH = BR.py(0);
    const entries = rows[0] && rows[0].rule ? rows.slice(1) : rows;
    const left = mapPanel.left / pageW + 0.006;
    const right = (mapPanel.left + mapPanel.width) / pageW - w - 0.006;
    const low = Math.max(floor, 1 - (mapPanel.top + mapPanel.height) / pageH + 0.006);
    const high = 1 - mapPanel.top / pageH - 0.006;
    const at = (x, bottom) => BR.legendColumn(entries, { bottom, minH: 0, maxH: 0.5, x, width: w });
    const first = at(left, low);
    const h = first.height;
    const avoid = keepOff ? names.concat([keepOff]) : names;
    const tried = [];
    for (const [corner, x, bottom] of [['bottom left', left, low], ['top left', left, high - h],
      ['top right', right, high - h]]) {
      const col = corner === 'bottom left' ? first : at(x, bottom);
      const b = { x0: col.box.left, x1: col.box.left + col.box.width, y0: col.box.top, y1: col.box.top + col.box.height };
      if (!marks.some(c => touchesBox(c, b))
        && !avoid.some(n => boxesMeet(n, b))) return { parts: col.parts, box: col.box, corner };
      tried.push({ corner, col, b });
    }
    // No corner was clear: the bottom left, or the first corner off the inset.
    const off = tried.find(t => !keepOff || !boxesMeet(keepOff, t.b)) || tried[0];
    return { parts: off.col.parts, box: off.col.box, corner: off.corner, fallback: true };
  }
  // The source line with the population layers' credits added when they are drawn.
  const withPopulation = (source, pop) => (pop ? [source].concat(root.WSDA.population.credits(pop.on)).join(' · ')
    : source);
  // The box a name centered at (x, y) covers, in points.
  const nameBox = (name, x, y, pt) => {
    const w = B().textWidth(name, pt) + 2;
    return { x0: x - w / 2, x1: x + w / 2, y0: y - pt * 0.475, y1: y + pt * 0.475 };
  };
  // The counties' source line with the neighboring regions' own credits added (each once).
  function sourceWithRegions(regions) {
    const credits = (regions || []).map(r => r.credit).filter(c => c && SOURCE_COUNTIES.indexOf(c) < 0);
    return SOURCE_COUNTIES + (credits.length ? ' · ' + [...new Set(credits)].join(' · ') : '');
  }
  // A region's required statement (Statistics Canada's for British Columbia), in small lines just above the source
  // line, as the page's footer carries it.
  function regionStatements(regions, style) {
    const BR = B();
    const lines = [];
    for (const r of regions || []) {
      if (r.statement) lines.push(...BR.wrapText(r.statement, 6.5, BR.px(BR.LAYOUT.mapW - 0.01)));
    }
    return lines.reverse().map((t, k) => BR.text(t, BR.px(0.005), BR.py(0.008) - 8 * (k + 1), { pt: 6.5,
      italic: true, color: style.darkerGrays ? '#666666' : '#888888' })).join('');
  }

  // ── WA State's legend ───────────────────────────────────────────────────────────────────────────────────────
  // CVI's layout (SMR 3080-3121): one or two sections in a box of CVI's height, rows spaced evenly.
  function legendEven(legend, legendH, style) {
    const BR = B();
    const L = BR.LAYOUT;
    const lg = BR.panel(L.gutterX, 0.045, L.gutterW, legendH, 5);
    const parts = [BR.box(lg)];
    const circles = [];
    const swatch = (color, y, size, label, labelSize) => {
      parts.push(BR.circle(lg.u(0.22), lg.v(y), size, 0.6, color, 0.4, '#ffffff'));
      parts.push(BR.text(label, lg.u(0.42), lg.v(y), { pt: BR.textPt(labelSize), color: '#444444' }));
      circles.push({ y: lg.v(y), r: BR.pointRadius(size, 0.6), label });
    };
    const spread = (n, lo, hi) => (n === 1 ? [lo] : Array.from({ length: n }, (_, i) => lo + (i * (hi - lo)) / (n - 1)))
      .reverse();
    if (legend.kind === 'split') {
      parts.push(BR.text('TOTAL ANIMALS', lg.u(0.5), lg.v(0.955), { pt: BR.textPt(3.2), color: '#222222',
        bold: true, anchor: 'middle' }));
      [[0.88, 0.52], [0.46, 0.08]].forEach(([yTop, yBottom], k) => {
        const s = legend.sections[k];
        parts.push(BR.text(s.title, lg.u(0.5), lg.v(yTop - 0.035), { pt: BR.textPt(3.0), color: s.color,
          bold: true, anchor: 'middle' }));
        const ys = spread(s.labels.length, yBottom + 0.085, yTop - 0.12);
        s.labels.forEach((label, i) => swatch(s.color, ys[i], s.sizes[i], label, 2.65));
      });
      parts.push(BR.line(lg.u(0.08), lg.v(0.5), lg.u(0.92), lg.v(0.5), '#dddddd', BR.linePt(0.4)));
    } else {
      parts.push(BR.text('TOTAL ANIMALS', lg.u(0.5), lg.v(0.92), { pt: BR.textPt(3.8), color: '#222222',
        bold: true, anchor: 'middle' }));
      parts.push(BR.text('(' + legend.title + ')', lg.u(0.5), lg.v(0.81), { pt: BR.textPt(3.3),
        color: '#444444', bold: true, anchor: 'middle' }));
      const ys = spread(legend.labels.length, 0.10, 0.62);
      legend.labels.forEach((label, i) => swatch(legend.color, ys[i], legend.sizes[i], label, 3.2));
    }
    if (style.sizingLine) {
      parts.push(BR.text(legend.sizing, lg.u(0.5), lg.v(0.02), { pt: BR.textPt(2.5), color: '#444444',
        italic: true, anchor: 'middle' }));
    }
    return { height: legendH, parts: parts.join(''), circles, overlap: null };
  }
  // The same texts and circles, each row as tall as its circle (branded.legendColumn); the box keeps at least
  // CVI's height and grows up to maxH; the sizing line at the bottom. extra: the population layers' rows, at the
  // foot. When they make the column too tall for the circles to stay apart, each section's size samples go side by
  // side in one row instead (County Focus's rule), if every row fits the box's width; with no extra rows the
  // legend is S9's.
  function legendBySize(legend, legendH, maxH, style, extra) {
    const BR = B();
    const row = (color, size, label, labelSize) => ({ circle: { size, stroke: 0.6, fill: color, opacity: 0.4 },
      label, labelPt: BR.textPt(labelSize) });
    const sizes = (color, labels, list, labelSize, across) => (across
      ? [{ across: labels.map((label, i) => ({ label, size: list[i], stroke: 0.6, fill: color, opacity: 0.4 })),
        labelPt: BR.textPt(2.6) }]
      : labels.map((label, i) => row(color, list[i], label, labelSize)));
    const build = across => {
      const entries = [];
      if (legend.kind === 'split') {
        entries.push({ text: 'TOTAL ANIMALS', pt: BR.textPt(3.2), color: '#222222', bold: true });
        legend.sections.forEach((s, k) => {
          if (k) entries.push({ rule: true });
          entries.push({ text: s.title, pt: BR.textPt(3.0), color: s.color, bold: true }, { flex: true });
          entries.push(...sizes(s.color, s.labels, s.sizes, 2.65, across));
          entries.push({ flex: true });
        });
      } else {
        entries.push({ text: 'TOTAL ANIMALS', pt: BR.textPt(3.8), color: '#222222', bold: true },
          { text: '(' + legend.title + ')', pt: BR.textPt(3.3), color: '#444444', bold: true }, { flex: true });
        entries.push(...sizes(legend.color, legend.labels, legend.sizes, 3.2, across));
        entries.push({ flex: true });
      }
      if (style.sizingLine) entries.push({ text: legend.sizing, pt: BR.textPt(2.5), color: '#444444', italic: true });
      entries.push(...(extra || []));   // the population layers' rows
      return BR.legendColumn(entries, { bottom: 0.045, minH: legendH, maxH });
    };
    const column = build(false);
    if (column.fits || !extra || !extra.length) return column;
    const across = build(true);
    const xs = across.circles.filter(c => c.across);
    const inside = xs.every(c => c.x - c.r >= across.box.left + 4 && c.x + c.r <= across.box.left + across.box.width - 4);
    return inside && !across.overlap ? Object.assign(across, { across: true }) : column;
  }

  // ── WA State ────────────────────────────────────────────────────────────────────────────────────────────────
  // input: rows (aggregate.build's circles, as on screen), f (the map's filters: species, years, quarters,
  // direction, scaling, nBins), universe (the master's species), yearChoices (its years, for periodParts), palette and
  // opacity (the screen's), title (the
  // custom title, may be blank), date (Last Updated), counties (GeoJSON features). style: branded.js options.
  // ── The time-series GIF's map band ───────────────────────────────────────────────────────────────────────────────
  // A map fitted into its panel; with band (a fraction of the page from the bottom, given for the GIF's period strip)
  // and the fitted map reaching into it, fitted again above the band, so the strip never covers the map. Returns
  // { mapPanel, fit, raised }.
  function fitAboveBand(x, y, width, height, extent, band) {
    const BR = B();
    const panel = BR.panel(x, y, width, height, 0);
    const fit = BR.fitMercator(extent, panel);
    if (!band || band <= y || fit.box.top + fit.box.height <= BR.py(band)) return { mapPanel: panel, fit, raised: false };
    const above = BR.panel(x, band, width, height - (band - y), 0);
    return { mapPanel: above, fit: BR.fitMercator(extent, above), raised: true };
  }
  // The names' area kept above the band too.
  const areaAboveBand = (area, band) => (band ? Object.assign({}, area, { y1: Math.min(area.y1, B().py(band) - 2) })
    : area);

  // ── WA State's circles (shared by the page and the GIF's frames) ────────────────────────────────────────────
  // The circles' sizes: the map's pixel radii mapped onto 3 to 19.5 (SMR 2932-2944), largest drawn first; each
  // placed on the page. input.scale (the GIF's shared scale): the smallest and largest radius of every frame, so a
  // radius gives the same size in every frame. Returns { bg, opacity, toSize, circles, mapPanel, fit, drawn }.
  function waLayout(input) {
    const BR = B();
    const L = BR.LAYOUT;
    const rows = input.rows;
    const palette = input.palette || 'WSDA Default';
    // A tile background (tiles.js): circles at 85% of their opacity, no land fill, the picture masked to Washington
    // (SMR 2905-2906, 2996-3005).
    const bg = backgroundOf(input);
    const opacity = Math.max(0.1, Math.min(1, Number(input.opacity === undefined ? 0.6 : input.opacity)) * (bg ? 0.85 : 1));
    const px = rows.map(r => r.radius_px).filter(x => x !== null && !Number.isNaN(x));
    const rMin = input.scale ? input.scale.rMin : Math.min(...px);
    let rMax = input.scale ? input.scale.rMax : Math.max(...px);
    if (rMax === rMin) rMax = rMin + 1;
    const toSize = r => MIN_PT + ((r - rMin) / (rMax - rMin)) * 16.5;
    const circles = rows.map((r, i) => {
      const size = toSize(r.radius_px);
      return {
        county: r.county, direction: r.direction, lon: r.lon, lat: r.lat, total: r.total_animals, size,
        stroke: Math.max(0.15, Math.min(1.0, size * 0.06)), fill: PAL().circleColor(palette, r.direction),
        opacity, i
      };
    }).sort((a, b) => b.size - a.size || a.i - b.i);
    const { mapPanel, fit } = fitAboveBand(0, 0, L.mapW, 1 - L.headerH, expand(WA_LIMITS), input.band);
    // Spotlight (S2a, as on screen): the other counties' circles at 10% opacity under the spotlit ones.
    const spot = new Set(input.spotlight || []);
    const drawn = circles.map(c => {
      const [x, y] = fit.project(c.lon, c.lat);
      const lit = !spot.size || spot.has(c.county);
      return Object.assign({}, c, { x, y, r: BR.pointRadius(c.size, c.stroke), spot: spot.size ? lit : null,
        opacity: lit ? c.opacity : root.CVIWA.summary.DIM_OPACITY });
    });
    if (spot.size) drawn.sort((a, b) => (a.spot === b.spot ? 0 : a.spot ? 1 : -1) || b.size - a.size || a.i - b.i);
    return { bg, opacity, toSize, circles, mapPanel, fit, drawn };
  }
  // One name per county with a circle, around the box of that county's circles (largest first).
  function waNameItems(drawn) {
    const items = [];
    for (const c of drawn) {
      if (c.county === null || !String(c.county).length || c.lon === null || c.lat === null) continue;
      let it = items.find(x => x.name === c.county);
      if (!it) {
        it = { name: c.county, box: { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity } };
        items.push(it);
      }
      it.box.x0 = Math.min(it.box.x0, c.x - c.r);
      it.box.x1 = Math.max(it.box.x1, c.x + c.r);
      it.box.y0 = Math.min(it.box.y0, c.y - c.r);
      it.box.y1 = Math.max(it.box.y1, c.y + c.r);
    }
    return items;
  }

  // ── CH: WA State's shaded counties (choropleth.js) ──────────────────────────────────────────────────────────────────
  // input.shade: { measure, method, nBins, opacity, cls (optional: the classes shared by Compare's maps or the GIF's
  // frames; else this map's own) }. Returns { cls, counties (one per county: name, value, cls, color, none), legend }.
  const CP = () => root.CVIWA.choropleth;
  function waShade(input) {
    const sh = input.shade;
    const values = CP().countyValues(input.rows, sh.measure);
    const names = input.counties.map(feat => feat.properties.name);
    const key = CP().rampKey(input.f.direction);
    const cls = sh.cls || CP().classify(names.filter(n => values.has(n)).map(n => values.get(n)), sh.method, sh.nBins,
      key, sh.measure);
    const counties = CP().shade(names, values, cls);
    const legend = CP().legend(cls, sh.measure, key, true);
    // The animals in counties the map does not have, under the legend.
    legend.unplaced = CP().unplacedLines(CP().unplaced(input.rows));
    return { cls, counties, legend };
  }
  // The shaded counties' map parts: each county in its class's color at the fill opacity (a tile background shows
  // through), "No movements" hatched, white lines; outside a spotlight dimmed, the spotlit counties outlined.
  const SHADE_DIM = 0.2;
  function waShadeParts(shaded, features, project, opacity, spotlight) {
    const BR = B();
    const spot = new Set(spotlight || []);
    const parts = ['<defs>' + CP().hatchPattern('ch-hatch-wa') + '</defs>'];
    const byName = new Map(shaded.counties.map(c => [c.name, c]));
    for (const feat of features) {
      const c = byName.get(feat.properties.name);
      const dim = spot.size > 0 && !spot.has(feat.properties.name);
      const fill = c && !c.none ? c.color : 'url(#ch-hatch-wa)';
      const op = c && !c.none ? (dim ? SHADE_DIM : opacity) : (dim ? SHADE_DIM : 1);
      parts.push('<path d="' + BR.pathData(feat.geometry, project) + '" fill="' + fill + '" fill-opacity="' +
        BR.num(op) + '" stroke="' + CP().LINE + '" stroke-width="' + BR.num(BR.linePt(0.5)) +
        '" stroke-linejoin="round"/>');
    }
    for (const feat of features.filter(x => spot.has(x.properties.name))) {
      parts.push('<path d="' + BR.pathData(feat.geometry, project) + '" fill="none" stroke="' + CP().OUTLINE.color +
        '" stroke-width="' + BR.num(BR.linePt(CP().OUTLINE.png)) + '" stroke-linejoin="round"/>');
    }
    return parts.join('');
  }
  // The shading legend as legendColumn's entries: the measure, the direction, a swatch per class (at the fill
  // opacity over the land's white page), "No movements" with the hatch, and the classes' line.
  function shadeLegendEntries(legend, opacity, hatchId, style, noneFill) {
    const BR = B();
    const swatch = (fill, op) => ({ height: 9, draw: (cx, cy) => '<rect x="' + BR.num(cx - 9) + '" y="' +
      BR.num(cy - 4.5) + '" width="18" height="9" fill="' + fill + '" fill-opacity="' + BR.num(op) +
      '" stroke="#ffffff" stroke-width="' + BR.num(BR.linePt(0.4)) + '"/>' });
    const entries = [{ text: legend.title, pt: BR.textPt(3.8), color: '#222222', bold: true },
      { text: '(' + legend.subtitle + ')', pt: BR.textPt(3.3), color: '#444444', bold: true }, { flex: true }];
    legend.rows.slice().reverse().forEach(r => entries.push({ sample: swatch(r.color, opacity), label: r.label,
      labelPt: BR.textPt(3.0), x: 0.18, labelX: 0.32 }));
    // "No movements": the hatch (WA counties), or a plain swatch of noneFill (National Flow's land).
    if (legend.none && noneFill) {
      entries.push({ sample: swatch(noneFill, 1), label: legend.none, labelPt: BR.textPt(3.0), x: 0.18, labelX: 0.32 });
    } else if (legend.none) {
      entries.push({ sample: { height: 9, draw: (cx, cy) => '<defs>' + CP().hatchPattern(hatchId) + '</defs>' +
        swatch('url(#' + hatchId + ')', 1).draw(cx, cy) }, label: legend.none, labelPt: BR.textPt(3.0), x: 0.18,
      labelX: 0.32 });
    }
    entries.push({ flex: true });
    if (style.sizingLine) entries.push({ text: legend.sizing, pt: BR.textPt(2.5), color: '#444444', italic: true });
    (legend.unplaced || []).forEach(t => entries.push({ text: t, pt: BR.textPt(2.5), color: '#444444', italic: true }));
    return entries;
  }

  // The WA State map's branded page: { model (every text, number and color, for the tests), parts (its SVG), style };
  // with the movement view on, waMovement() builds it.
  function wa(input, styleOpts) {
    const BR = B();
    const style = BR.styleOf(styleOpts);
    const L = BR.LAYOUT;
    const f = input.f;
    const rows = input.rows;
    const palette = input.palette || 'WSDA Default';
    const { bg, toSize, mapPanel, fit, drawn } = waLayout(input);
    // CH: shaded counties in place of the circles (not with the movement view, which takes over as on screen).
    const shaded = input.shade && !input.movement ? waShade(input) : null;
    // The GIF's shared scale: the legend from every frame's values (input.scale.values: all, Inbound, Outbound).
    const values = input.scale ? input.scale.values : null;

    // Strings and numbers.
    const dirLabel = directionLabel(f.direction);
    // CH: on the shaded map by Animals per square mile the title names that measure, as its legend does:
    // "ANIMAL IMPORTS PER SQ MI – …".
    const perSqMi = !!shaded && input.shade.measure === 'per_sq_mi';
    const auto = (perSqMi ? 'ANIMAL ' + dirLabel + ' PER SQ MI' : 'TOTAL ANIMAL ' + dirLabel) + ' – ' +
      speciesLabel(f.species, input.universe) + ' – COUNTY DETAIL';
    const title = resolveTitle(input.title, auto);
    const period = periodParts(f.quarters, f.years, input.yearChoices);
    const counties = new Set(rows.map(r => r.county).filter(c => c !== null && String(c).length));
    const total = rows.reduce((s, r) => s + (r.total_animals === null || Number.isNaN(r.total_animals) ? 0
      : r.total_animals), 0);
    const meta = {
      left: 'Data Range: Jan ' + Math.min(...f.years) + ' – Dec ' + Math.max(...f.years),
      right: BR.updated(input.date)
    };
    const stats = {
      left: [period],
      right: [{ prefix: 'Counties:', value: S().comma(counties.size) },
        { prefix: 'Total Animals:', value: S().comma(total) }]
    };

    // The Top 3 box: both directions split in two, one direction or Combined as one list. A GIF decides once for
    // every frame (input.topSplit), so the box keeps its size and titles from frame to frame.
    // On the shaded map one list, as the map shows one value per county whatever Display Mode says
    // (grayed then), ranked by the measure shown (animals per square mile: their values, no total).
    const dirs = [...new Set(rows.map(r => r.direction))];
    const both = f.direction.length > 1;
    const split = !shaded && (input.topSplit !== undefined ? input.topSplit : dirs.length === 2 && dirs.indexOf('Total') < 0);
    const oneTitle = (shaded && both) || dirs.indexOf('Total') >= 0 ? ' (Combined)' : ' — ' + (dirs[0] || f.direction[0]);
    let top;
    if (split) {
      top = [topSection(top3(rows, 'Inbound'), 'Top 3 Inbound', '#1C9CD9', 1.00, 0.50),
        topSection(top3(rows, 'Outbound'), 'Top 3 Outbound', '#F0A06E', 0.50, 0.50)];
    } else if (shaded) {
      top = [topShaded(rows, perSqMi, both, 'Top ' + SHADE_TOP + (perSqMi ? ' per Sq Mi' : ' Counties') + oneTitle)];
    } else {
      top = [topSection(top3(rows, null), 'Top 3 Counties' + oneTitle, '#1c5a83', 1.00, 1.00)];
    }

    // The legend: two sections when both directions are drawn apart, else one (SMR 3080-3121).
    const splitLegend = f.direction.length > 1 && dirs.indexOf('Total') < 0;
    let legend;
    if (splitLegend) {
      const specs = [];
      for (const d of ['Inbound', 'Outbound']) {
        // With the GIF's shared scale, a direction any frame draws keeps its section in every frame.
        const own = values ? values[d] || [] : rows.filter(r => r.direction === d).map(r => r.total_animals);
        if (!own.length) continue;
        const spec = countyLegendSpec(own, f.scaling, f.nBins, toSize);
        if (spec) specs.push(Object.assign(spec, { title: d + ' animals', color: PAL().legendColor(palette, d) }));
      }
      legend = specs.length === 2 ? { kind: 'split', sections: specs }
        : specs.length === 1 ? { kind: 'single', title: specs[0].title, color: specs[0].color, labels: specs[0].labels,
          sizes: specs[0].sizes }
          : Object.assign({ kind: 'single', title: 'COUNTY TOTALS', color: '#245566', fixed: true }, FIXED_TIERS);
    } else {
      const spec = countyLegendSpec(values ? values.all : rows.map(r => r.total_animals), f.scaling, f.nBins, toSize);
      legend = { kind: 'single', title: dirLabel, color: PAL().legendColor(palette, f.direction[0]),
        labels: (spec || FIXED_TIERS).labels, sizes: (spec || FIXED_TIERS).sizes, fixed: !spec };
    }
    // The line naming the sizing.
    const classes = legend.fixed ? null
      : legend.kind === 'split' ? legend.sections.map(s => s.labels.length) : [legend.labels.length];
    legend.sizing = sizingLine('Circle size', f.scaling, classes);

    // ── Drawing ──
    const features = input.counties;
    const mapParts = [regionParts(input.regions, fit.project)];
    const land = bg ? { fill: 'none', line: '#ffffff' } : waLand(input.regions);
    if (shaded) {
      const op = Math.max(0.1, Math.min(1, Number(input.shade.opacity === undefined ? CP().FILL_OPACITY
        : input.shade.opacity)));
      mapParts.push(waShadeParts(shaded, features, fit.project, op, input.spotlight));
    } else {
      for (const feat of features) {
        mapParts.push('<path d="' + BR.pathData(feat.geometry, fit.project) + '" fill="' + land.fill + '" stroke="' +
          land.line + '" stroke-width="' + BR.num(BR.linePt(0.5)) + '"/>');
      }
    }
    const pop = populationOf(input);
    if (pop) {
      mapParts.push(populationLayers(pop, features, fit.project, { extent: expand(WA_LIMITS), clip: null, id: 'wa',
        line: land.line, width: 0.5 }));
    }
    // Names: one per county with a circle, placed around the box of that county's circles (largest first).
    // The GIF: input.obstacles, every frame's circles together, so the names are placed the same in
    // every frame (around all of them), and a frame draws only its own counties' names.
    const labelPt = BR.textPt(3.2);
    // CH: on the shaded map every county is named, each tried first at its label point (the live map's), with no
    // circles to go around; the same in every GIF frame.
    const around = shaded ? [] : input.obstacles || drawn;
    const geoLabels = (root.CVIWA_GEO && root.CVIWA_GEO.labels) || [];
    const items = shaded ? features.map(feat => {
      const at = geoLabels.find(l => l.name === feat.properties.name);
      const [lon, lat] = at ? [at.lon, at.lat] : planarCentroid(feat.geometry);
      return { name: feat.properties.name, at: fit.project(lon, lat) };
    }) : waNameItems(around);
    // Names stay on the map, below the stat row (and above the GIF's band).
    const area = areaAboveBand({ x0: mapPanel.left + 2, x1: mapPanel.left + mapPanel.width - 2,
      y0: BR.py(L.statY) + 9, y1: mapPanel.top + mapPanel.height - 2 }, input.band);
    const placedAll = placeLabels(items, around, features, fit.project, labelPt, area);
    const own = new Set(drawn.map(c => c.county));
    const labels = input.obstacles && !shaded ? placedAll.filter(l => own.has(l.name)) : placedAll;
    const countyName = lb => BR.text(lb.name, lb.x, lb.y, { pt: labelPt, color: BR.nameColor(style), anchor: 'middle',
      halo: { color: '#ffffff', opacity: 0.78, width: 0.22 * labelPt * 2 } });
    for (const lb of labels.filter(l => !l.over)) mapParts.push(countyName(lb));
    // The population layers' names: places of 10,000 people or more, clear of the county names, over the circles.
    const popNames = pop ? populationNames(pop, fit.project, area, placedAll.map(lb => nameBox(lb.name, lb.x, lb.y,
      labelPt)), around, { min: 10000 }) : null;
    if (!shaded) for (const c of drawn) mapParts.push(BR.circle(c.x, c.y, c.size, c.stroke, c.fill, c.opacity, '#ffffff'));
    // County names placed over their own circles (step b above) go on top of the circles.
    for (const lb of labels.filter(l => l.over)) mapParts.push(countyName(lb));
    if (popNames) mapParts.push(popNames.markup);

    // MC's movement view in place of the circles, as on screen.
    if (input.movement) {
      // The Top 3 Movements box holds one list: half as tall in the page's style.
      return waMovement(input, style, { title, meta, stats, mapPanel, fit, features,
        topH: style.compactTop ? 0.1425 : 0.285, pop });
    }
    // The Top 3 box: CVI's height; one list (one direction or Combined) in a box half as tall in the page's style
    // (so the rows are not too spaced out), so its rows sit as close as the two-direction box's.
    // The shaded Top 5 keeps the rows' spacing of the half-height Top 3 box (0.0285 of the page per row).
    const shadeRows = !shaded ? 0 : top[0].columns ? top[0].rows.length + 2 + (top[0].total ? 1 : 0)
      : top[0].rows.length + 2;   // rankSection keeps a row for the total
    const topH = shaded ? 0.0285 * shadeRows : !split && style.compactTop ? 0.1425 : 0.285;
    const topPanel = BR.panel(L.gutterX, 1 - L.headerH - 0.020 - topH, L.gutterW, topH, 0);
    const topParts = [BR.box(topPanel)];
    top.forEach((s, i) => {
      topParts.push(s.columns ? topColumns(topPanel, s) : BR.rankSection(topPanel, s));
      if (split && i === 0) {
        topParts.push(BR.line(topPanel.u(0), topPanel.v(0.5), topPanel.u(1), topPanel.v(0.5), '#bbbbbb',
          BR.linePt(0.6)));
      }
    });

    // The legend: CVI's evenly spaced rows in CVI's style, else rows spaced by size with the sizing line.
    const legendH = splitLegend ? 0.455 : 0.265;
    let legendBox;
    const popRows = populationLegend(pop);
    let popCorner = null;
    if (shaded) {
      const maxH = 1 - L.headerH - 0.020 - topH - 0.008 - 0.045;
      const op = Math.max(0.1, Math.min(1, Number(input.shade.opacity === undefined ? CP().FILL_OPACITY
        : input.shade.opacity)));
      // As tall as its rows, so the swatches sit closer together.
      legendBox = BR.legendColumn(shadeLegendEntries(shaded.legend, op, 'ch-hatch-wa-key', style)
        .concat(popRows), { bottom: 0.045, minH: 0, maxH });
    } else if (style.legendBySize) {
      const maxH = 1 - L.headerH - 0.020 - topH - 0.008 - 0.045;
      legendBox = legendBySize(legend, legendH, maxH, style, popRows);
      if (popRows.length && !legendBox.fits) {
        legendBox = legendBySize(legend, legendH, maxH, style);
        popCorner = populationCorner(popRows, mapPanel, around, placedAll.map(lb => nameBox(lb.name, lb.x, lb.y,
          labelPt)).concat(popNames ? popNames.placed.map(n => n.box) : []), Math.max(0.03, input.band || 0));
      }
    } else {
      legendBox = legendEven(legend, legendH, style);
    }

    const parts = [
      BR.clipped('wa-map', mapPanel, mapParts.join('')),
      BR.header(title, style),
      BR.metaRow(meta.left, meta.right, style),
      BR.statRow(stats.left, stats.right),
      topParts.join(''),
      legendBox.parts,
      popCorner ? popCorner.parts : '',
      BR.highlightLine(input.highlights),
      BR.footnote(withPopulation(sourceWithRegions(input.regions), pop), bg ? bg.attribution : null, style,
        input.synthetic),
      regionStatements(input.regions, style),
      BR.logo()
    ];
    const model = {
      view: 'wa', title, titleSize: BR.titleSize(title), meta, stats, top, topSplit: split, topHeight: topH, legend,
      highlights: input.highlights || [],
      legendHeight: legendBox.height, legendCircles: legendBox.circles, legendOverlap: legendBox.overlap,
      circles: shaded ? [] : drawn, labels: labels.map(l => l.name), labelPlaces: labels, labelArea: area,
      shade: shaded ? { measure: input.shade.measure, method: shaded.cls.method, breaks: shaded.cls.breaks,
        n: shaded.cls.n, colors: shaded.cls.colors, legend: shaded.legend, counties: shaded.counties } : null,
      regions: (input.regions || []).map(r => r.id), background: bg ? input.background : 'standard',
      basemap: bg ? bg.attribution : null,
      underlay: underlayOf(input, mapPanel, fit, features, 10),
      source: style.sourceLine ? withPopulation(sourceWithRegions(input.regions), pop) : null, extent: expand(WA_LIMITS),
      fileName: fileNameWa(f)
    };
    if (pop) {
      model.population = { on: pop.on, ramp: pop.ramp, names: popNames.placed, dropped: popNames.dropped,
        legend: popCorner ? popCorner.corner : 'legend', corner: popCorner ? popCorner.box : null,
        cornerFallback: !!(popCorner && popCorner.fallback) };
    }
    return { model, parts, style };
  }

  // ── WA State's movement view (MC) ───────────────────────────────────────────────────────────────────────────
  // What the screen draws (movement.mapView): lines by rank group with arrowheads, rings for movement within a
  // county, the corridor chart's badges 1 to 3, faded lines and rings outside a picked corridor (with a spotlight
  // alone, only the pairs and rings touching it).
  // Screen pixels become points at 96 per inch, so a line is as wide on paper as on screen. The gutter box shows the
  // top 3 movements and the legend the rank groups, as the screen's legend.
  const PX_PT = 0.75;
  const MC_TEAL = '#245566';
  const MC_RING = '#7a3e9d';
  const ARROW_HALF = 13.8 / 22.8;   // the arrowhead's half base over its length (map.js's picture)
  // A filled arrowhead as SVG: its base centered at (x, y), pointing along the bearing (degrees clockwise from up).
  function arrowHead(x, y, bearing, length, color, opacity) {
    const a = bearing * Math.PI / 180;
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    const half = length * ARROW_HALF;
    const pts = [[x + dx * length, y + dy * length], [x - dy * half, y + dx * half], [x + dy * half, y - dx * half]];
    return '<polygon points="' + pts.map(q => B().num(q[0]) + ',' + B().num(q[1])).join(' ') + '" fill="' + color +
      '" fill-opacity="' + B().num(opacity) + '"/>';
  }
  // A rank badge as SVG: the number n in white on a white-edged teal disc.
  function badgeMark(x, y, n) {
    const BR = B();
    return '<circle cx="' + BR.num(x) + '" cy="' + BR.num(y) + '" r="7.5" fill="' + MC_TEAL +
      '" stroke="#ffffff" stroke-width="1.1"/>' + BR.text(String(n), x, y, { pt: 7.5, color: '#ffffff', bold: true,
      anchor: 'middle' });
  }
  // The WA State movement view's branded page, from the parts wa() has already worked out (ctx); returns as wa().
  function waMovement(input, style, ctx) {
    const BR = B();
    const L = BR.LAYOUT;
    const v = input.movement.view;
    const words = (root.CVIWA.charts && root.CVIWA.charts.MEASURES[v.measure]) || { lower: 'animals', one: 'animal',
      many: 'animals', title: 'Animals' };
    const P = (lon, lat) => ctx.fit.project(lon, lat);
    const mapParts = [];
    mapParts.push(regionParts(input.regions, ctx.fit.project));
    const land = backgroundOf(input) ? { fill: 'none', line: '#ffffff' } : waLand(input.regions);
    for (const feat of ctx.features) {
      mapParts.push('<path d="' + BR.pathData(feat.geometry, ctx.fit.project) + '" fill="' + land.fill + '" stroke="' +
        land.line + '" stroke-width="' + BR.num(BR.linePt(0.5)) + '"/>');
    }
    // Population context under the lines, as on the screen.
    if (ctx.pop) {
      mapParts.push(populationLayers(ctx.pop, ctx.features, ctx.fit.project, { extent: expand(WA_LIMITS), clip: null,
        id: 'wa', line: land.line, width: 0.5 }));
    }
    const lines = v.lines.map(l => {
      const d = l.line.map((c, k) => {
        const q = P(c[0], c[1]);
        return (k ? 'L' : 'M') + BR.num(q[0]) + ' ' + BR.num(q[1]);
      }).join('');
      const head = P(l.head.at[0], l.head.at[1]);
      const mid = P(l.middle[0], l.middle[1]);
      return Object.assign({}, l, { d, headX: head[0], headY: head[1], midX: mid[0], midY: mid[1] });
    });
    for (const l of lines) {
      mapParts.push('<path d="' + l.d + '" fill="none" stroke="' + l.color + '" stroke-opacity="' + BR.num(l.opacity) +
        '" stroke-width="' + BR.num(l.width_px * PX_PT) + '" stroke-linecap="round" stroke-linejoin="round"/>');
      mapParts.push(arrowHead(l.headX, l.headY, l.head.bearing, l.arrow_px * PX_PT, l.color, l.opacity));
    }
    const rings = v.rings.map(r => {
      const [x, y] = P(r.lon, r.lat);
      return Object.assign({}, r, { x, y, r: r.radius_px * PX_PT });
    });
    for (const r of rings) {
      mapParts.push('<circle cx="' + BR.num(r.x) + '" cy="' + BR.num(r.y) + '" r="' + BR.num(r.r) +
        '" fill="none" stroke="' + MC_RING + '" stroke-width="' + BR.num(2.5 * PX_PT) + '" stroke-opacity="' +
        BR.num(r.opacity) + '"/>');
    }
    const badges = lines.filter(l => l.badge).map(l => ({ n: l.badge, x: l.midX, y: l.midY }));
    // County names next to each county with movement, off the rings and badges.
    const labelPt = BR.textPt(3.2);
    const area = { x0: ctx.mapPanel.left + 2, x1: ctx.mapPanel.left + ctx.mapPanel.width - 2, y0: BR.py(L.statY) + 9,
      y1: ctx.mapPanel.top + ctx.mapPanel.height - 2 };
    // A ring is its county's own (the name may go over it); a badge belongs to no county and is never covered.
    const obstacles = rings.map(r => ({ x: r.x, y: r.y, r: r.r + 1, county: r.county }))
      .concat(badges.map(b => ({ x: b.x, y: b.y, r: 8, county: null, badge: true })));
    const items = v.counties.map(c => {
      const [x, y] = P(c.lon, c.lat);
      const ring = rings.find(r => r.county === c.county);
      const h = ring ? ring.r + 1 : 3;
      return { name: c.county, box: { x0: x - h, x1: x + h, y0: y - h, y1: y + h } };
    });
    const names = placeLabels(items, obstacles, ctx.features, ctx.fit.project, labelPt, area);
    for (const n of names) {
      mapParts.push(BR.text(n.name, n.x, n.y, { pt: labelPt, color: BR.nameColor(style), anchor: 'middle',
        halo: { color: '#ffffff', opacity: 0.78, width: 0.22 * labelPt * 2 } }));
    }
    for (const b of badges) mapParts.push(badgeMark(b.x, b.y, b.n));
    // The population layers' names: places of 10,000 or more, clear of the county names and the badges (never
    // covered), over the lines and rings when no clear spot is left.
    const badgeBoxes = badges.map(b => ({ x0: b.x - 9, x1: b.x + 9, y0: b.y - 9, y1: b.y + 9 }));
    const popNames = ctx.pop ? populationNames(ctx.pop, P, area, names.map(n => nameBox(n.name, n.x, n.y, labelPt))
      .concat(badgeBoxes), obstacles.filter(o => !o.badge), { min: 10000 }) : null;
    if (popNames) mapParts.push(popNames.markup);

    // Top 3 movements: the three best-ranked county pairs.
    const top = v.lines.slice().sort((a, b) => a.rank - b.rank).slice(0, 3);
    const topBox = {
      title: 'Top 3 Movements' + (v.measure && v.measure !== 'animals' ? ' (' + words.title + ')' : ''),
      color: '#1c5a83', top: 1, height: 1, rowSize: 2.8,
      rows: top.map(l => ({ label: l.origin + ' → ' + l.dest, value: S().comma(l.value) })),
      total: S().comma(top.reduce((t, l) => t + l.value, 0))
    };
    const topPanel = BR.panel(L.gutterX, 1 - L.headerH - 0.020 - ctx.topH, L.gutterW, ctx.topH, 0);
    const topParts = BR.box(topPanel) + BR.rankSection(topPanel, topBox);

    // The legend: one sample per rank group drawn, the ring, the badges, and the screen legend's note.
    const labelPtL = BR.textPt(2.5);
    const unit = n => S().comma(n) + ' ' + (n === 1 ? words.one : words.many);
    const entries = [{ text: 'MOVEMENT BETWEEN', pt: BR.textPt(3.2), color: '#222222', bold: true },
      { text: 'WA COUNTIES', pt: BR.textPt(3.2), color: '#222222', bold: true }, { flex: true }];
    const tiers = root.CVIWA.movement.TIER_WIDTH;
    tiers.forEach((width, tier) => {
      const inTier = v.lines.filter(l => l.tier === tier);
      if (!inTier.length) return;
      const ranks = inTier.map(l => l.rank);
      const values = inTier.map(l => l.value);
      const first = Math.min(...ranks);
      const last = Math.max(...ranks);
      const lo = Math.min(...values);
      const hi = Math.max(...values);
      const l = inTier[0];
      const w = l.width_px * PX_PT;
      const len = l.arrow_px * PX_PT;
      entries.push({ sample: { height: Math.max(w, 2 * len * ARROW_HALF), draw: (x, y) =>
        '<line x1="' + BR.num(x - 18) + '" y1="' + BR.num(y) + '" x2="' + BR.num(x + 18 - len) + '" y2="' + BR.num(y) +
        '" stroke="' + l.color + '" stroke-width="' + BR.num(w) + '"/>' + arrowHead(x + 18 - len, y, 90, len, l.color, 1) },
      label: [root.CVIWA.movement.busiestLabel(first, last),
        lo === hi ? unit(hi) : S().comma(lo) + '–' + unit(hi)], labelPt: labelPtL, x: 0.18, labelX: 0.40 });
    });
    if (rings.length) {
      entries.push({ sample: { height: 14, draw: (x, y) => '<circle cx="' + BR.num(x) + '" cy="' + BR.num(y) +
        '" r="6" fill="none" stroke="' + MC_RING + '" stroke-width="1.9"/>' },
      label: ['Ring: animals moved', 'within the county'], labelPt: labelPtL, x: 0.18, labelX: 0.40 });
    }
    if (badges.length) {
      entries.push({ sample: { height: 16, draw: (x, y) => badgeMark(x, y, 1) },
        label: ['The busiest corridors in', 'the corridor chart (1 to 3)'], labelPt: labelPtL, x: 0.18, labelX: 0.40 });
    }
    entries.push({ flex: true });
    const note = 'Lines join county centers; they are not travel routes. Ranked by ' + words.lower + '.';
    for (const t of BR.wrapText(note, labelPtL, BR.px(L.gutterW) - 16)) {
      entries.push({ text: t, pt: labelPtL, color: '#444444', italic: true });
    }
    entries.push(...populationLegend(ctx.pop));
    const legendBox = BR.legendColumn(entries, { bottom: 0.045, minH: 0.265,
      maxH: 1 - L.headerH - 0.020 - ctx.topH - 0.008 - 0.045 });

    const parts = [
      BR.clipped('wa-map', ctx.mapPanel, mapParts.join('')),
      BR.header(ctx.title, style),
      BR.metaRow(ctx.meta.left, ctx.meta.right, style),
      BR.statRow(ctx.stats.left, ctx.stats.right),
      topParts,
      legendBox.parts,
      BR.highlightLine(input.highlights),
      BR.footnote(withPopulation(sourceWithRegions(input.regions), ctx.pop), backgroundOf(input) ?
        backgroundOf(input).attribution : null, style, input.synthetic),
      regionStatements(input.regions, style),
      BR.logo()
    ];
    const model = {
      view: 'wa', movement: true, underlay: underlayOf(input, ctx.mapPanel, ctx.fit, ctx.features, 10),
      title: ctx.title, meta: ctx.meta, stats: ctx.stats, top: topBox,
      topHeight: ctx.topH, legendLabels: entries.filter(e => e.label).map(e => [].concat(e.label).join(' ')),
      lines: lines.map(l => ({ key: l.key, rank: l.rank, color: l.color, opacity: l.opacity, width: l.width_px * PX_PT })),
      rings: rings.map(r => ({ county: r.county, r: r.r, opacity: r.opacity })), badges, names,
      legendHeight: legendBox.height, legendOverlap: legendBox.overlap, highlights: input.highlights || [],
      source: style.sourceLine ? withPopulation(sourceWithRegions(input.regions), ctx.pop) : null,
      fileName: fileNameWa(input.f)
    };
    if (ctx.pop) model.population = { on: ctx.pop.on, ramp: ctx.pop.ramp, names: popNames.placed, dropped: popNames.dropped };
    return { model, parts, style };
  }

  // ── National Flow (render_branded_flow_map, SMR 1813-2390) ──────────────────────────────────────────────────
  // Line widths in ggplot2 units (SMR 223-224): the fixed tiers' range, also the scaled widths' range.
  const TIER_LW = [0.30, 0.65, 1.20, 2.10, 3.40];
  const TIER_LABELS = ['< 100', '101 – 1,000', '1,001 – 5,000', '5,001 – 20,000', '> 20,000'];
  const FLOW_LIMITS = { west: -128, east: -65, south: 24, north: 53 };   // coord_sf, expand = FALSE (SMR 2190-2196)
  const WA_ANCHOR = [-120.5, 47.5];
  // CVI's state labels sit at R's state centers (datasets::state.center), not at the lines' end points; AK, HI and
  // WA are not named (SMR 2018-2028). The eight small northeastern states get a smaller label, nudged (SMR 2030-2050).
  const STATE_CENTERS = {
    AL: [-86.7509, 32.5901], AZ: [-111.6250, 34.2192], AR: [-92.2992, 34.7336], CA: [-119.7730, 36.5341],
    CO: [-105.5130, 38.6777], CT: [-72.3573, 41.5928], DE: [-74.9841, 38.6777], FL: [-81.6850, 27.8744],
    GA: [-83.3736, 32.3329], ID: [-113.9300, 43.5648], IL: [-89.3776, 40.0495], IN: [-86.0808, 40.0495],
    IA: [-93.3714, 41.9358], KS: [-98.1156, 38.4204], KY: [-84.7674, 37.3915], LA: [-92.2724, 30.6181],
    ME: [-68.9801, 45.6226], MD: [-76.6459, 39.2778], MA: [-71.5800, 42.3645], MI: [-84.6870, 43.1361],
    MN: [-94.6043, 46.3943], MS: [-89.8065, 32.6758], MO: [-92.5137, 38.3347], MT: [-109.3200, 46.8230],
    NE: [-99.5898, 41.3356], NV: [-116.8510, 39.1063], NH: [-71.3924, 43.3934], NJ: [-74.2336, 39.9637],
    NM: [-105.9420, 34.4764], NY: [-75.1449, 43.1361], NC: [-78.4686, 35.4195], ND: [-100.0990, 47.2517],
    OH: [-82.5963, 40.2210], OK: [-97.1239, 35.5053], OR: [-120.0680, 43.9078], PA: [-77.4500, 40.9069],
    RI: [-71.1244, 41.5928], SC: [-80.5056, 33.6190], SD: [-99.7238, 44.3365], TN: [-86.4560, 35.6767],
    TX: [-98.7857, 31.3897], UT: [-111.3300, 39.1063], VT: [-72.5450, 44.2508], VA: [-78.2005, 37.5630],
    WV: [-80.6665, 38.4204], WI: [-89.9941, 44.5937], WY: [-107.2560, 43.0504]
  };
  const NE_NUDGE = { RI: [1.4, -0.2], DE: [1.0, -0.4], NJ: [0.6, 0.0], CT: [0.0, -0.4], MA: [0.0, 0.0],
    NH: [0.4, 0.2], VT: [-0.2, 0.3], MD: [0.0, -0.4] };
  const SOURCE_STATES = 'Data: WSDA Animal Services CVI records · State boundaries: U.S. Census Bureau';
  // CVI's Flow theme (.static_basemap_theme "standard" with the Flow map's "auto" overrides, SMR 1526-1545,
  // 1868-1876).
  const FLOW_THEME = { land: '#e8e8e8', boundary: '#ffffff', label: '#787878', glowOuter: '#9ec9dc',
    glowInner: '#4ea2c4', waFill: '#dbeaf2', waOutline: '#1c5a83', waHub: '#ffffff' };
  const FLOW_DIRECTION = { inbound: 'IMPORTS', outbound: 'EXPORTS', combined: 'IMPORTS + EXPORTS' };

  // The state labels as CVI places them: { abbr, lon, lat, small } (the main tier, then the small tier).
  function stateLabelPlaces() {
    const out = [];
    for (const [abbr, c] of Object.entries(STATE_CENTERS)) {
      if (!NE_NUDGE[abbr]) out.push({ abbr, lon: c[0], lat: c[1], small: false });
    }
    for (const [abbr, c] of Object.entries(STATE_CENTERS)) {
      const n = NE_NUDGE[abbr];
      if (n) out.push({ abbr, lon: c[0] + n[0], lat: c[1] + n[1], small: true });
    }
    return out;
  }

  // The width rule and legend tiers of a set of line totals (the basis), worked out once: widthOf(v) is the width the
  // map draws for a value among the basis (log, square root and linear: computeRadius's formula with the value
  // added, the largest unchanged when the value is one of the basis or a quantile of it; quantiles and natural breaks:
  // the width of the value's class under the basis's breaks); tiers are CVI's legend tiers on the basis. Used
  // per page, and once per export for the GIF's shared scale (worked out per line it took seconds to minutes).
  function flowScale(basis, f) {
    const lo = Math.min(...TIER_LW);
    const hi = Math.max(...TIER_LW);
    const mid = (lo + hi) / 2;
    const tiers = S().legendTiers(basis, f.scaling, f.nBins, lo, hi);
    if (f.scaling === 'quantile' || f.scaling === 'natural') {
      const g = S().binsOf(basis, f.scaling, f.nBins);
      return { basis, tiers, widthOf: v => (g ? lo + (g.binOf(v) - 1) / (g.maxBin - 1) * (hi - lo) : mid) };
    }
    if (['log', 'linear', 'sqrt'].indexOf(f.scaling || 'log') < 0) {
      throw new Error("'arg' should be one of log, linear, sqrt, quantile, natural");
    }
    // computeRadius's rule, its basis read once: values below zero, missing or not numbers count as zero; the middle
    // width when the largest is zero or every value is equal.
    const clean = x => (x === null || Number.isNaN(x) || x < 0 ? 0 : x);
    const b = basis.map(clean);
    const bmax = b.length ? Math.max(...b) : 0;
    const allEqual = b.every(x => x === b[0]);
    const norm = t => lo + t * (hi - lo);
    const widthOf = v => {
      const x = clean(v);
      const vmax = Math.max(bmax, x);
      if (vmax === 0 || (allEqual && (!b.length || x === b[0]))) return mid;
      if ((f.scaling || 'log') === 'log') return norm(Math.log1p(x) / Math.log1p(vmax));
      if (f.scaling === 'linear') return norm(x / vmax);
      return norm(Math.sqrt(x) / Math.sqrt(vmax));
    };
    return { basis, tiers, widthOf };
  }

  // input: lines (flow.lines: CVI's rows, each with state, species_group, total_animals and coords), f (direction,
  // species, years, quarters, combine, scaling, nBins, palette, multiplier, opacity, lines = state lines on),
  // universe, yearChoices, title, date, states (us-states.js features). Returns null when there is no line (CVI: "no data
  // matches current filters").
  // CH: input.shade ({ method, nBins, opacity, cls: the classes shared by the GIF's frames, else this page's own }):
  // shaded states in place of the lines: each state with movements in its class's color at the fill opacity, the
  // others plain land, white state lines, Washington white with its dark outline (the hub); while states are picked
  // in a chart the others dimmed and the picked ones outlined; the legend shows the classes.
  function flowShadeParts(input, P) {
    const BR = B();
    const sh = input.shade;
    const sv = CP().stateValues(input.lines);
    const cls = sh.cls || CP().classify([...sv.values.values()], sh.method, sh.nBins, CP().rampKey(input.f.direction),
      'total');
    const op = Math.max(0.1, Math.min(1, Number(sh.opacity === undefined ? CP().FILL_OPACITY : sh.opacity)));
    const lit = new Set(input.highlight || []);
    const parts = [];
    const states = [];
    for (const s of input.states) {
      const code = s.properties.code;
      const v = sv.values.has(code) ? sv.values.get(code) : null;
      const c = code === 'WA' ? null : cls.classOf(v);
      const dim = lit.size > 0 && !lit.has(code);
      const fill = code === 'WA' ? FLOW_THEME.waHub : c ? cls.colors[c - 1] : FLOW_THEME.land;
      const fop = c ? (dim ? SHADE_DIM : op) : 1;
      parts.push('<path d="' + BR.pathData(s.geometry, P) + '" fill="' + fill + '" fill-opacity="' + BR.num(fop) + '"' +
        (input.f.lines ? ' stroke="' + CP().LINE + '" stroke-width="' + BR.num(BR.linePt(0.25)) + '"' : '') +
        ' stroke-linejoin="round"/>');
      if (code !== 'WA' && v !== null) states.push({ code, value: v, cls: c, color: c ? cls.colors[c - 1] : null });
    }
    for (const s of input.states.filter(x => lit.has(x.properties.code))) {
      parts.push('<path d="' + BR.pathData(s.geometry, P) + '" fill="none" stroke="' + CP().OUTLINE.color +
        '" stroke-width="' + BR.num(BR.linePt(CP().OUTLINE.png)) + '" stroke-linejoin="round"/>');
    }
    const wa = input.states.find(s => s.properties.code === 'WA');
    if (wa) {
      parts.push('<path d="' + BR.pathData(wa.geometry, P) + '" fill="none" stroke="' + FLOW_THEME.waOutline +
        '" stroke-width="' + BR.num(BR.linePt(0.9)) + '" stroke-linejoin="round"/>');
    }
    const legend = CP().legend(cls, 'total', CP().rampKey(input.f.direction), states.length < input.states.length - 1);
    return { cls, states, legend, opacity: op, parts: parts.join('') };
  }

  // Alaska and Hawaii in inset boxes at the map's top left, under the stat row and the "Highlighted:" line's
  // place (flowinsets.js, the outlines of
  // geo/us-insets.js): codes (input.insets, the GIF's states across every frame; else those with a line here), each
  // box with the state's name and animals, its outline shaded in its class's color (dimmed or outlined while states are
  // picked in a chart) or plain land on the Lines map. Returns { boxes, parts, anchors: Map of code to the [x, y] where
  // its lines end }. Empty without the outlines file (loaded with the National Flow map).
  const INSET_PAGE = { gapPt: 6, heightPt: 62, titlePt: 11, padPt: 3, textPt: 7.5 };
  function flowInsetParts(input, shaded, lit) {
    const BR = B();
    const IN = root.CVIWA.flowinsets;
    const data = root.WSDA_US_INSETS;
    const out = { boxes: [], parts: '', anchors: new Map() };
    if (!IN || !data) return out;
    const codes = input.insets || IN.present(input.lines.map(a => a.state));
    const L = BR.LAYOUT;
    const o = INSET_PAGE;
    const boxes = IN.layout(data, codes, { x: BR.px(0.010), y: BR.py(L.statY - 0.034) + 9, height: o.heightPt, gap: o.gapPt,
      title: o.titlePt, pad: o.padPt });
    const parts = [];
    for (const b of boxes) {
      const value = IN.totalOf(input.lines, b.code);
      const c = shaded && value !== null ? shaded.cls.classOf(value) : null;
      const dim = lit.size > 0 && !lit.has(b.code);
      const fill = c ? shaded.cls.colors[c - 1] : FLOW_THEME.land;
      const fop = c ? (dim ? SHADE_DIM : shaded.opacity) : 1;
      parts.push(BR.rect(b.x, b.y, b.w, b.h, '#ffffff', '#bbbbbb', BR.linePt(0.4)));
      parts.push('<path d="' + b.d + '" fill="' + fill + '" fill-opacity="' + BR.num(fop) + '"' +
        (input.f.lines || shaded ? ' stroke="' + (shaded ? CP().LINE : FLOW_THEME.boundary) + '" stroke-width="' +
        BR.num(BR.linePt(0.25)) + '"' : '') + ' stroke-linejoin="round"/>');
      if (shaded && lit.has(b.code)) {
        parts.push('<path d="' + b.d + '" fill="none" stroke="' + CP().OUTLINE.color + '" stroke-width="' +
          BR.num(BR.linePt(CP().OUTLINE.png)) + '" stroke-linejoin="round"/>');
      }
      const ty = b.y + o.titlePt / 2 + 1;
      parts.push(BR.text(b.name, b.x + o.padPt + 1, ty, { pt: o.textPt, bold: true, color: '#222222' }));
      if (value !== null) {
        parts.push(BR.text(S().comma(S().rRound(value)), b.x + b.w - o.padPt - 1, ty, { pt: o.textPt,
          color: '#222222', anchor: 'end' }));
      }
      out.anchors.set(b.code, b.anchor);
      out.boxes.push({ code: b.code, x: b.x, y: b.y, w: b.w, h: b.h, anchor: b.anchor, value, fill: c || !shaded ?
        fill : null, cls: c });
    }
    out.parts = parts.join('');
    return out;
  }

  // The National Flow map's branded page: { model, parts, style } as wa(), or null with no lines to draw.
  function flow(input, styleOpts) {
    const BR = B();
    const style = BR.styleOf(styleOpts);
    const L = BR.LAYOUT;
    const f = input.f;
    if (!input.lines || !input.lines.length) return null;
    const F = root.CVIWA.flow;
    const opacity = Math.max(0.1, Math.min(1, Number(f.opacity)));
    const mult = Math.max(0.15, Math.min(3.0, Number(f.multiplier)));

    // Lines: widths from the scaling over the ggplot2 range of the fixed tiers, times the multiplier; colors by
    // species group (Combine species: the palette's one color); drawn smallest first (SMR 1937-1971).
    const totals = input.lines.map(a => a.total_animals);
    const lo = Math.min(...TIER_LW);
    const hi = Math.max(...TIER_LW);
    // The time-series GIF: input.scale (flowScale over every frame's line totals) gives the widths and the
    // legend, so a width means the same animals in every frame. Without it, the frame's own totals (CVI's rule).
    const own = input.scale ? null : flowScale(totals, f);
    const scale = input.scale || own;
    const asMap = scale.widthOf;
    const widths = input.scale ? totals.map(asMap) : S().computeRadius(totals, f.scaling, lo, hi, f.nBins);
    const lines = input.lines.map((a, i) => ({
      state: a.state, species_group: a.species_group, total: a.total_animals, coords: a.coords, i,
      linewidth: widths[i] * mult,
      color: f.combine ? F.singleColor(f.palette) : F.lineColor(f.palette, a.species_group)
    })).sort((a, b) => cmpNum(a.total, b.total) || a.i - b.i);

    // Strings and numbers.
    const dirLabel = FLOW_DIRECTION[f.direction];
    const title = resolveTitle(input.title, 'TOTAL ANIMAL ' + dirLabel + ' – ' +
      speciesLabel(f.species, input.universe));
    const total = totals.reduce((s, x) => s + (x === null || Number.isNaN(x) ? 0 : x), 0);
    const states = new Set(input.lines.map(a => a.state).filter(s => s !== null && String(s).toUpperCase() !== 'WA'));
    const meta = {
      left: 'Data Range: Jan ' + Math.min(...f.years) + ' – Dec ' + Math.max(...f.years),
      right: BR.updated(input.date)
    };
    const stats = {
      left: [periodParts(f.quarters, f.years, input.yearChoices), { prefix: 'Total Animals:', value: S().comma(total) },
        { prefix: 'States:', value: String(states.size) }],
      right: []
    };
    // Top 3 States: partner states by animals, ties in state order (SMR 1922-1926). Page style flowTop: the top 3 or
    // 5 in a box sized to its rows, as close as WA State's; unset, CVI's top 3 over its full box.
    const topN = style.flowTop === 5 ? 5 : 3;
    const sums = new Map();
    for (const a of input.lines) {
      const x = a.total_animals;
      sums.set(a.state, (sums.get(a.state) || 0) + (x === null || Number.isNaN(x) ? 0 : x));
    }
    const top = [...sums].map(([state, animals]) => ({ state, animals })).sort((a, b) => cmpC(a.state, b.state))
      .map((g, i) => Object.assign(g, { i })).sort((a, b) => b.animals - a.animals || a.i - b.i).slice(0, topN);
    const topBox = {
      title: 'Top ' + topN + ' States', color: '#1c5a83', top: 1, height: 1, titleSize: 3.6, rowSize: 3.2,
      rows: top.map(g => ({ label: g.state, value: S().comma(g.animals) })),
      total: S().comma(top.reduce((s, g) => s + g.animals, 0))
    };

    // The legend: CVI's tiers on the lines' totals (labels rounded, widths against each other, times the
    // multiplier), else CVI's fixed tiers (not multiplied) (SMR 2213-2229, 1745-1795). The GIF: on every frame's totals.
    // Each tier's width as the map draws that value (asMap above; S1.1's rule for the live legends).
    const tiers = scale.tiers;
    const fixed = !tiers || !tiers.values.length;
    const legend = {
      title: dirLabel, fixed,
      labels: fixed ? TIER_LABELS.slice() : tiers.values.map(v => S().comma(S().rRound(v))),
      widths: fixed ? TIER_LW.slice() : style.flowLegendAsMap ? tiers.values.map(v => asMap(v) * mult)
        : tiers.radii.map(r => r * mult),
      sizing: sizingLine('Line width', f.scaling, fixed ? null : [tiers.values.length])
    };
    // The species key, the groups in the lines' order (as the live legend), or the one color with Combine species.
    const groups = [];
    input.lines.forEach(a => { if (groups.indexOf(a.species_group) < 0) groups.push(a.species_group); });
    legend.species = f.combine ? [{ label: 'All species', color: F.singleColor(f.palette) }]
      : groups.map(g => ({ label: g, color: F.lineColor(f.palette, g) }));

    // ── Drawing ──
    const mapPanel = BR.panel(0, 0, L.mapW, 1 - L.headerH, 0);
    const fit = BR.fitMercator(FLOW_LIMITS, mapPanel);
    const P = (lon, lat) => fit.project(lon, lat);
    const mapParts = [];
    const wa = input.states.find(s => s.properties.code === 'WA');
    const shaded = input.shade ? flowShadeParts(input, P) : null;
    if (shaded) mapParts.push(shaded.parts);
    for (const s of shaded ? [] : input.states) {
      mapParts.push('<path d="' + BR.pathData(s.geometry, P) + '" fill="' + FLOW_THEME.land + '"' +
        (f.lines ? ' stroke="' + FLOW_THEME.boundary + '" stroke-width="' + BR.num(BR.linePt(0.25)) + '"' : '') +
        ' stroke-linejoin="round"/>');
    }
    if (wa && !shaded) {
      const d = BR.pathData(wa.geometry, P);
      // Polygon outlines are drawn without the layer's alpha (ggplot2 applies alpha to the fill only).
      mapParts.push('<path d="' + d + '" fill="none" stroke="' + FLOW_THEME.glowOuter + '" stroke-width="' +
        BR.num(BR.linePt(3.0)) + '" stroke-linejoin="round"/>');
      mapParts.push('<path d="' + d + '" fill="none" stroke="' + FLOW_THEME.glowInner + '" stroke-width="' +
        BR.num(BR.linePt(1.5)) + '" stroke-linejoin="round"/>');
      mapParts.push('<path d="' + d + '" fill="' + FLOW_THEME.waFill + '" fill-opacity="0.7" stroke="' +
        FLOW_THEME.waOutline + '" stroke-width="' + BR.num(BR.linePt(0.55)) + '" stroke-linejoin="round"/>');
    }
    // MC: while states are picked in a chart, the other states' lines at 10% opacity, as on screen.
    const lit = new Set(input.highlight || []);
    for (const ln of lines) ln.opacity = !lit.size || lit.has(ln.state) ? opacity : 0.10;
    // The insets under the lines; a line to Alaska or Hawaii runs straight from Washington's anchor to the
    // state's center in its box.
    const insets = flowInsetParts(input, shaded, lit);
    mapParts.push(insets.parts);
    const hub = P(WA_ANCHOR[0], WA_ANCHOR[1]);
    for (const ln of shaded ? [] : lines) {
      const end = insets.anchors.get(String(ln.state).toUpperCase());
      const d = end ? 'M' + BR.num(hub[0]) + ' ' + BR.num(hub[1]) + 'L' + BR.num(end[0]) + ' ' + BR.num(end[1])
        : ln.coords.map((c, k) => {
          const p = P(c[0], c[1]);
          return (k ? 'L' : 'M') + BR.num(p[0]) + ' ' + BR.num(p[1]);
        }).join('');
      mapParts.push('<path d="' + d + '" fill="none" stroke="' + ln.color + '" stroke-opacity="' + BR.num(ln.opacity) +
        '" stroke-width="' + BR.num(BR.linePt(ln.linewidth)) + '" stroke-linecap="round" stroke-linejoin="round"/>');
    }
    // Top 3 badges, then the labels: others with a halo (near-black), the top 3 in white bold; main tier, then
    // the small tier; then the WA anchor (SMR 2104-2180).
    const topSet = new Set(top.map(g => g.state));
    const places = stateLabelPlaces().map(pl => {
      const [x, y] = P(pl.lon, pl.lat);
      return Object.assign(pl, { x, y, top: topSet.has(pl.abbr) });
    });
    const badges = [];
    for (const small of [false, true]) {
      for (const pl of places.filter(q => q.small === small && q.top)) {
        const size = small ? 5.5 : 9;
        const stroke = small ? 1.0 : 1.2;
        mapParts.push(BR.circle(pl.x, pl.y, size, stroke, '#ee7e2c', 1, '#ffffff'));
        badges.push({ abbr: pl.abbr, x: pl.x, y: pl.y, size, stroke });
      }
    }
    for (const small of [false, true]) {
      const pt = BR.textPt(small ? 2.0 : 3.0);
      for (const pl of places.filter(q => q.small === small && !q.top)) {
        mapParts.push(BR.text(pl.abbr, pl.x, pl.y, { pt, bold: true, anchor: 'middle',
          color: style.darkNames ? BR.nameColor(style) : FLOW_THEME.label,
          halo: { color: '#ffffff', opacity: 0.78, width: 2 * 0.30 * pt } }));
      }
      for (const pl of places.filter(q => q.small === small && q.top)) {
        mapParts.push(BR.text(pl.abbr, pl.x, pl.y, { pt, bold: true, anchor: 'middle', color: '#ffffff' }));
      }
    }
    // A Top 3 badge on an inset state's center, as on the other states.
    for (const [code, at] of insets.anchors) {
      if (!topSet.has(code)) continue;
      mapParts.push(BR.circle(at[0], at[1], 9, 1.2, '#ee7e2c', 1, '#ffffff'));
      mapParts.push(BR.text(code, at[0], at[1], { pt: BR.textPt(3.0), bold: true, anchor: 'middle', color: '#ffffff' }));
      badges.push({ abbr: code, x: at[0], y: at[1], size: 9, stroke: 1.2, inset: true });
    }
    const anchor = P(WA_ANCHOR[0], WA_ANCHOR[1]);
    mapParts.push(BR.circle(anchor[0], anchor[1], 3, 0.8, FLOW_THEME.waOutline, 1, '#ffffff'));

    // The Top 3 box: 65% of the gutter's width, centered (SMR 2361-2367); 0.21 of the page tall, or in the page's
    // style 0.0285 per row (the title, each state and the total), as WA State's compact box.
    const topH = style.flowTop ? 0.0285 * (topN + 2) : 0.21;
    const topPanel = BR.panel(L.gutterX + L.gutterW * 0.175, 1 - L.headerH - 0.020 - topH, L.gutterW * 0.65, topH, 0);
    const topParts = BR.box(topPanel) + BR.rankSection(topPanel, topBox);

    // The legend: CVI's evenly spaced rows in CVI's style, else rows spaced by width with the sizing line.
    const legendH = 0.265;
    let legendBox;
    const titlePt = BR.textPt(3.0);
    const subPt = BR.textPt(2.6);
    const labelPt = BR.textPt(2.5);
    if (shaded) {
      const entries = shadeLegendEntries(shaded.legend, shaded.opacity, 'ch-hatch-flow-key', style, FLOW_THEME.land);
      if (f.species.length > 1) {
        entries.splice(entries.length - (style.sizingLine ? 1 : 0), 0, { text: 'Species added together', pt: subPt,
          color: '#444444', italic: true });
      }
      legendBox = BR.legendColumn(entries, { bottom: 0.045, minH: 0,
        maxH: 1 - L.headerH - 0.020 - topH - 0.008 - 0.045 });
    } else if (style.legendBySize) {
      const entries = [];
      if (style.speciesKey) {
        entries.push({ text: f.combine ? 'LINE COLOR' : 'SPECIES', pt: titlePt, color: '#222222', bold: true });
        legend.species.forEach(sp => entries.push({ bar: { width: 3, color: sp.color }, label: sp.label, labelPt }));
        entries.push({ rule: { color: '#bbbbbb', width: 0.3, x0: 0.06, x1: 0.94 } });
      }
      entries.push({ text: 'TOTAL ANIMALS', pt: titlePt, color: '#222222', bold: true },
        { text: '(' + legend.title + ')', pt: subPt, color: '#444444', bold: true }, { flex: true });
      legend.labels.forEach((label, i) => entries.push({ bar: { width: BR.linePt(legend.widths[i]), color: '#888888' },
        label, labelPt }));
      entries.push({ flex: true });
      if (style.sizingLine) entries.push({ text: legend.sizing, pt: labelPt, color: '#444444', italic: true });
      legendBox = BR.legendColumn(entries, { bottom: 0.045, minH: legendH,
        maxH: 1 - L.headerH - 0.020 - topH - 0.008 - 0.045 });
    } else {
      const lg = BR.panel(L.gutterX, 0.045, L.gutterW, legendH, 5);
      const parts = [BR.box(lg)];
      const placed = [];
      parts.push(BR.text('TOTAL ANIMALS', lg.u(0.5), lg.v(0.92), { pt: titlePt, color: '#222222', bold: true,
        anchor: 'middle' }));
      parts.push(BR.text('(' + legend.title + ')', lg.u(0.5), lg.v(0.81), { pt: subPt, color: '#444444', bold: true,
        anchor: 'middle' }));
      const n = legend.labels.length;
      legend.labels.forEach((label, i) => {
        const y = lg.v(n === 1 ? 0.10 : 0.62 - (i * (0.62 - 0.10)) / (n - 1));
        const w = BR.linePt(legend.widths[i]);
        parts.push('<line x1="' + BR.num(lg.u(0.06)) + '" y1="' + BR.num(y) + '" x2="' + BR.num(lg.u(0.40)) +
          '" y2="' + BR.num(y) + '" stroke="#888888" stroke-width="' + BR.num(w) + '" stroke-linecap="round"/>');
        parts.push(BR.text(label, lg.u(0.46), y, { pt: labelPt, color: '#444444' }));
        placed.push({ y, r: w / 2, label });
      });
      legendBox = { height: legendH, parts: parts.join(''), circles: placed, overlap: null };
    }

    const parts = [
      BR.clipped('flow-map', mapPanel, mapParts.join('')),
      BR.header(title, style),
      BR.metaRow(meta.left, meta.right, style),
      BR.statRow(stats.left, stats.right, { same: 0.010, next: 0.035 }),
      topParts,
      legendBox.parts,
      BR.highlightLine(input.highlights),
      BR.footnote(SOURCE_STATES, null, style, input.synthetic),
      BR.logo()
    ];
    const model = {
      view: 'flow', title, titleSize: BR.titleSize(title), meta, stats, top: topBox, legend,
      legendHeight: legendBox.height, legendSamples: legendBox.circles, legendOverlap: legendBox.overlap,
      lines: shaded ? [] : lines.map(l => ({ state: l.state, species_group: l.species_group, total: l.total,
        linewidth: l.linewidth, color: l.color, opacity: l.opacity })),
      shade: shaded ? { method: shaded.cls.method, breaks: shaded.cls.breaks, n: shaded.cls.n, colors: shaded.cls.colors,
        legend: shaded.legend, states: shaded.states } : null,
      highlights: input.highlights || [], labels: places.filter(q => !q.top), badges, anchor: WA_ANCHOR, extent: FLOW_LIMITS,
      insets: insets.boxes,
      source: style.sourceLine ? SOURCE_STATES : null, fileName: fileNameFlow(f)
    };
    return { model, parts, style };
  }
  const cmpNum = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  // CVI's year label: one year, or "first-last" (mod_maps.R 6347-6350).
  function yearLabel(years) {
    const ys = years.map(Number);
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    return lo === hi ? String(lo) : lo + '-' + hi;
  }
  // CVI_Flow_Map_{years}_{quarters}_{DIRECTION}.png (mod_maps.R 6887-6889).
  const fileNameFlow = f => 'CVI_Flow_Map_' + yearLabel(f.years) + '_' + f.quarters.slice().sort(cmpC).join('') + '_' +
    String(f.direction).toUpperCase() + '.png';

  // ── County Focus (render_branded_county_focus_map, SMR 4584-5130) ──────────────────────────────────────────
  // CVI's County Focus layout (.branded_layout, SMR 4444-4461): the map stops BAND_PAD below the stat row.
  const BAND_PAD = 0.030;
  const ROLE_COLORS = { Inbound: '#1C9CD9', Outbound: '#F0A06E' };
  // CVI's name colors for its five built-in facility layers (map_helpers.R 888-916); another layer's is its color
  // darkened to 65%, as CVI's .darken_hex does for a manifest row without one.
  const FACILITY_NAME_COLORS = { slaughterhouses: '#382513', fairgrounds: '#3d1a36', markets: '#b1521a',
    feedlots: '#00606e', restricted: '#8f2010' };
  function darkenHex(hex, f) {
    const c = [1, 3, 5].map(i => parseInt(String(hex).slice(i, i + 2), 16));
    if (c.some(Number.isNaN)) return '#3c3c3c';
    return '#' + c.map(v => Math.floor(v * f + 0.5).toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  const facilityNameColor = l => FACILITY_NAME_COLORS[l.key] || darkenHex(l.color, 0.65);
  const GROUP_NOTE_Y = 0.420;

  // Nearby premises of one direction grouped into one circle (SMR 4643-4683): biggest first, every premises not yet
  // used within the threshold joins it; the circle sits at the animal-weighted center and carries the sum. The
  // threshold is 0.06 degrees or 4% of the premises' larger span, whichever is larger; longitude distances are
  // shortened by the cosine of the mean latitude. Directions in order (Inbound, then Outbound). Radii are then
  // recomputed on the grouped totals (4 to 24 px, as the live map's). A single premises is kept as it is.
  // The grouping distance in degrees: 0.06, or 4% of the premises' spread when that is larger.
  function groupDistance(premises) {
    const range = k => Math.max(...premises.map(p => p[k])) - Math.min(...premises.map(p => p[k]));
    const span = Math.max(range('lon'), range('lat'), 0);
    return Math.max(0.06, 0.04 * span);
  }
  // thr: the grouping distance (the GIF's, from every frame's premises, so "grouped" means the same distance in
  // every frame); by default the premises' own.
  function groupPremises(premises, scaling, nBins, thr) {
    if (premises.length <= 1) {
      return premises.map(p => Object.assign({}, p, { n_premises: 1, seedLon: p.lon, seedLat: p.lat,
        members: [p.direction + '\r' + p.group_key] }));
    }
    if (thr === undefined) thr = groupDistance(premises);
    const coslat = Math.cos(premises.reduce((s, p) => s + p.lat, 0) / premises.length * Math.PI / 180);
    const out = [];
    const dirs = [...new Set(premises.map(p => p.direction))].sort(cmpC);
    for (const dir of dirs) {
      const d = premises.filter(p => p.direction === dir).map((p, i) => ({ p, i }))
        .sort((a, b) => b.p.total_animals - a.p.total_animals || a.i - b.i).map(x => x.p);
      const used = d.map(() => false);
      d.forEach((seed, i) => {
        if (used[i]) return;
        const grp = [];
        d.forEach((q, j) => {
          const dx = (q.lon - seed.lon) * coslat;
          const dy = q.lat - seed.lat;
          if (!used[j] && Math.sqrt(dx * dx + dy * dy) <= thr) grp.push(j);
        });
        grp.forEach(j => { used[j] = true; });
        const w = grp.map(j => d[j].total_animals);
        const sum = w.reduce((s, x) => s + x, 0);
        const wn = sum > 0 ? w : w.map(() => 1);
        const wsum = wn.reduce((s, x) => s + x, 0);
        out.push(Object.assign({}, seed, {
          seedLon: seed.lon, seedLat: seed.lat, members: grp.map(j => d[j].direction + '\r' + d[j].group_key),
          lon: grp.reduce((s, j, k) => s + d[j].lon * wn[k], 0) / wsum,
          lat: grp.reduce((s, j, k) => s + d[j].lat * wn[k], 0) / wsum,
          total_animals: sum, n_premises: grp.length
        }));
      });
    }
    const radii = S().computeRadius(out.map(c => c.total_animals), scaling || 'log', 4, 24, nBins);
    out.forEach((c, i) => { c.radius_px = radii[i]; });
    return out;
  }

  // CVI's aspect correction (.aspect_correct_extent, SMR 4467-4488): the longitude/latitude box widened on the
  // short side to the map panel's shape. The page draws in Web Mercator; the corrected box sets the name lift.
  function aspectCorrect(b, mapW, mapH) {
    const target = (mapW * 11) / (mapH * 8.5);
    const coslat = Math.cos((b.south + b.north) / 2 * Math.PI / 180);
    const lonSpan = b.east - b.west;
    const latSpan = b.north - b.south;
    const visW = lonSpan * coslat;
    const ratio = latSpan > 0 ? visW / latSpan : target;
    const out = Object.assign({}, b);
    if (ratio < target) {
      const extra = ((target * latSpan) / Math.max(coslat, 1e-6) - lonSpan) / 2;
      out.west -= extra;
      out.east += extra;
    } else {
      const extra = (visW / target - latSpan) / 2;
      out.south -= extra;
      out.north += extra;
    }
    return out;
  }

  // A polygon's planar center in longitude/latitude (sf::st_centroid with spherical geometry off, as CVI's
  // renderer runs): every part weighted by its area, holes subtracted.
  function planarCentroid(geometry) {
    const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    let a = 0;
    let cx = 0;
    let cy = 0;
    for (const poly of polys) {
      poly.forEach((ring, k) => {
        let ra = 0;
        let rx = 0;
        let ry = 0;
        for (let i = 0; i + 1 < ring.length; i++) {
          const [x0, y0] = ring[i];
          const [x1, y1] = ring[i + 1];
          const c = x0 * y1 - x1 * y0;
          ra += c;
          rx += (x0 + x1) * c;
          ry += (y0 + y1) * c;
        }
        // The outer ring counts positive and holes negative, whatever their winding.
        const sign = (k === 0) === (ra >= 0) ? 1 : -1;
        a += sign * ra / 2;
        cx += sign * rx / 6;
        cy += sign * ry / 6;
      });
    }
    return [cx / a, cy / a];
  }

  // The Top Importers / Top Exporters box (.build_focus_top, SMR 4177-4258): up to five premises each, biggest first,
  // each section as tall as its rows; "place, ST" cut to 29 characters and "…" past 30. The box's height follows the
  // rows drawn (SMR 5015-5018). Returns the sections and the height (page fraction).
  function focusTop(premises) {
    const topN = dir => premises.map((p, i) => ({ p, i })).filter(x => x.p.direction === dir)
      .sort((a, b) => b.p.total_animals - a.p.total_animals || a.i - b.i).slice(0, 5).map(x => x.p);
    const label = p => {
      const id = p.premises_id === null || p.premises_id === undefined ? '' : String(p.premises_id);
      const base = id ? id : p.city ? p.city : '(unknown)';
      const l = base + (p.state ? ', ' + p.state : '');
      const chars = Array.from(l);
      return chars.length > 30 ? chars.slice(0, 29).join('') + '…' : l;
    };
    const imp = topN('Inbound');
    const exp = topN('Outbound');
    const section = (list, title, color, top, height) => ({ title, color, top, height,
      rows: list.map(p => ({ label: label(p), value: S().comma(S().rRound(p.total_animals)) })) });
    let sections;
    let units;
    if (imp.length && exp.length) {
      units = imp.length + exp.length + 2;
      const fi = (imp.length + 1) / units;
      sections = [section(imp, 'Top Importers', ROLE_COLORS.Inbound, 1, fi),
        section(exp, 'Top Exporters', ROLE_COLORS.Outbound, 1 - fi, 1 - fi)];
    } else if (imp.length || exp.length) {
      const one = imp.length ? imp : exp;
      units = one.length + 1;
      sections = [imp.length ? section(imp, 'Top Importers', ROLE_COLORS.Inbound, 1, 1)
        : section(exp, 'Top Exporters', ROLE_COLORS.Outbound, 1, 1)];
    } else {
      units = 2;
      sections = [];
    }
    return { sections, height: Math.max(0.12, 0.42 * units / 12) };
  }
  // The box drawn: each section a header row and its rows (rh = h / (n + 1)), a divider between two sections.
  function focusTopParts(p, top) {
    const BR = B();
    const parts = [BR.box(p)];
    if (!top.sections.length) {
      parts.push(BR.text('No premises match filters', p.u(0.5), p.v(0.5), { pt: BR.textPt(3.2), color: '#888888',
        anchor: 'middle' }));
    }
    top.sections.forEach((s, k) => {
      const rh = s.height / (s.rows.length + 1);
      if (k) parts.push(BR.line(p.u(0), p.v(s.top), p.u(1), p.v(s.top), '#bbbbbb', BR.linePt(0.4)));
      parts.push(BR.rect(p.u(0), p.v(s.top), p.u(1) - p.u(0), p.v(s.top - rh) - p.v(s.top), s.color));
      parts.push(BR.text(s.title, p.u(0.5), p.v(s.top - rh / 2), { pt: BR.textPt(3.2), color: '#ffffff', bold: true,
        anchor: 'middle' }));
      s.rows.forEach((r, i) => {
        const y = p.v(s.top - rh - (i + 0.5) * rh);
        parts.push(BR.text(r.label, p.u(0.07), y, { pt: BR.textPt(3.0), color: '#222222' }));
        parts.push(BR.text(r.value, p.u(0.93), y, { pt: BR.textPt(3.0), color: '#222222', anchor: 'end' }));
      });
    });
    return parts.join('');
  }

  // ── The Streets background (County Focus; .vector_streets_layers, SMR 879-1060) ──────────────────────────────
  // geo/streets-wa.js (build/derive_streets.R, from CVI's own files). Every layer is cut to the focus counties, in
  // CVI's order, colors and widths: urban areas, lakes, wide rivers, the coast (a faint halo under a dashed line),
  // secondary then primary roads; over the county names, place names (the largest first, kept apart, at most 22 for
  // one county and 14 for more; CVI's priority is the place's land area) and the major rivers' names.
  const STREETS_CREDIT = 'Streets: U.S. Census Bureau TIGER/Line, USGS NHD, Natural Earth';
  function streetsParts(data, project, focusSub, extent, pad, style) {
    const BR = B();
    const near = parts => parts.some(part => part.some(c => c[0] >= extent.west - pad && c[0] <= extent.east + pad &&
      c[1] >= extent.south - pad && c[1] <= extent.north + pad));
    const areaPath = polys => polys.map(poly => poly.map(ring => ring.map((c, i) => {
      const q = project(c[0], c[1]);
      return (i ? 'L' : 'M') + BR.num(q[0]) + ' ' + BR.num(q[1]);
    }).join('') + 'Z').join('')).join('');
    const areas = (list, fill, stroke, lw) => list.filter(polys => near(polys.flat())).map(polys => '<path d="' +
      areaPath(polys) + '" fill="' + fill + '"' + (stroke ? ' stroke="' + stroke + '" stroke-width="' +
      BR.num(BR.linePt(lw)) + '"' : '') + ' fill-rule="evenodd"/>').join('');
    const lines = (list, color, lw, extra) => list.filter(near).map(parts => '<path d="' + BR.lineData(parts, project) +
      '" fill="none" stroke="' + color + '" stroke-width="' + BR.num(BR.linePt(lw)) + '"' + (extra || '') + '/>').join('');
    const under = [
      areas(data.urban, '#e6e6e6', null, 0),
      areas(data.lakes, '#cfe4ee', '#5b8aa6', 0.25),
      areas(data.riversPoly, '#d4e6ef', '#9cc0d4', 0.12),
      lines(data.coast, '#7fb0cc', 2.6, ' stroke-opacity="0.16" stroke-linecap="round"'),
      lines(data.coast, '#5b8aa6', 0.45, ' stroke-dasharray="' + BR.num(4 * BR.linePt(0.45)) + ' ' +
        BR.num(4 * BR.linePt(0.45)) + '"'),
      lines(data.secondary, '#a89070', 0.2),
      lines(data.primary, '#ead7c2', 0.3)
    ].join('');
    return under;
  }
  // Place and river names inside the focus counties; taken: boxes already used (the county names).
  function streetsNames(data, project, focusSub, taken, area) {
    const BR = B();
    const inside = (lon, lat) => focusSub.some(f => {
      const [x, y] = project(lon, lat);
      return BR.insideGeometry(f.geometry, project, x, y);
    });
    const pt = BR.textPt(2.5);
    const placed = taken.slice();
    const meet = (a, b) => Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) && Math.min(a.y1, b.y1) > Math.max(a.y0, b.y0);
    const cap = focusSub.length <= 1 ? 22 : 14;
    const out = [];
    const places = data.places.filter(q => inside(q.lon, q.lat)).sort((a, b) => b.aland - a.aland);
    for (const q of places) {
      if (out.filter(x => x.kind === 'place').length >= cap) break;
      const [x, y] = project(q.lon, q.lat);
      const w = BR.textWidth(q.name, pt) + 2;
      const b = { x0: x - w / 2, x1: x + w / 2, y0: y - pt * 0.5, y1: y + pt * 0.5 };
      if (b.x0 < area.x0 || b.x1 > area.x1 || b.y0 < area.y0 || b.y1 > area.y1) continue;
      if (placed.some(o => meet(o, b))) continue;
      placed.push(b);
      out.push({ kind: 'place', name: q.name, x, y, box: b });
    }
    for (const r of data.rivers.filter(x => x.name)) {
      const pts = r.lines.flat().filter(c => inside(c[0], c[1]));
      if (!pts.length) continue;
      const c = pts[Math.floor(pts.length / 2)];
      const [x, y] = project(c[0], c[1]);
      out.push({ kind: 'river', name: r.name, x, y });
    }
    return out.map(n => Object.assign(n, { markup: BR.text(n.name, n.x, n.y, { pt, anchor: 'middle',
      color: n.kind === 'place' ? '#2c2c2c' : '#2c6b8a', italic: n.kind === 'river',
      halo: { color: '#ffffff', opacity: n.kind === 'place' ? 0.9 : 0.85,
        width: 2 * (n.kind === 'place' ? 0.28 : 0.25) * pt } }) }));
  }

  // input: premises (focus.build's, as on screen), f (counties, species, years, quarters, direction, scaling, nBins,
  // opacity, hideCircles), universe, yearChoices, title, date, counties (GeoJSON features). Returns null without premises (CVI:
  // "no data matches current filters").
  // ── County Focus's circles and map box (shared by the page and the GIF's frames) ──────────────────────────
  // The grouped circles, sized and placed on the page. The GIF's shared scale: input.grouped (each frame's groups,
  // made with one grouping distance and sized over every frame) and input.scale (the smallest and largest radius of
  // every frame, and every frame's group totals for the legend). Returns what focus() draws with.
  function focusLayout(input, style) {
    const BR = B();
    const L = BR.LAYOUT;
    const f = input.f;
    const plain = input.premises || [];
    const showCircles = !f.hideCircles;
    // A tile background: CVI's theme, circles at 85% (capped at 80%), the picture masked to the focus counties
    // (.branded_underlay, SMR 4520-4560).
    const bg = backgroundOf(input);
    const theme = root.WSDA.tiles ? root.WSDA.tiles.THEMES[bg ? bg.theme : 'standard'] : null;
    const streets = input.background === 'vector:streets' && input.streets ? input.streets : null;
    const opacity = Math.max(0.1, Math.min(0.80, Number(f.opacity === undefined ? 0.8 : f.opacity)) * (bg ? 0.85 : 1));

    // Circles: grouped, nudged apart by direction when both are drawn, sized as WA State's (3 to 19.5), smaller
    // ones on top (SMR 4685-4710).
    // CVI computes each group's weighted center and a 0.015-degree nudge by direction, but its PNG draws every
    // circle at its biggest premises' own point (the premises table keeps its point geometry, which st_as_sf()
    // does not replace), so neither shows. The page draws them as CVI's code intends;
    // CVI's style draws them as CVI's PNG does.
    const grouped = input.grouped ? input.grouped.map(c => Object.assign({}, c))
      : groupPremises(plain, f.scaling, f.nBins);
    const nGroupedAway = plain.length - grouped.length;
    const bothDirs = grouped.some(c => c.direction === 'Inbound') && grouped.some(c => c.direction === 'Outbound');
    if (style.groupedAtCenter) {
      if (bothDirs) grouped.forEach(c => { c.lon += c.direction === 'Inbound' ? -0.015 : 0.015; });
    } else {
      grouped.forEach(c => Object.assign(c, { lon: c.seedLon, lat: c.seedLat }));
    }
    const rMin = input.scale ? input.scale.rMin : Math.min(...grouped.map(c => c.radius_px));
    let rMax = input.scale ? input.scale.rMax : Math.max(...grouped.map(c => c.radius_px));
    if (rMax === rMin) rMax = rMin + 1;
    const toSize = r => MIN_PT + ((r - rMin) / (rMax - rMin)) * 16.5;
    const circles = grouped.map((c, i) => Object.assign(c, { size: toSize(c.radius_px), i }))
      .sort((a, b) => b.size - a.size || a.i - b.i)
      .map(c => Object.assign(c, { stroke: Math.max(0.35, Math.min(1.6, c.size * 0.10)), opacity }));
    // MC: while premises are picked in a chart (a premises, county or corridor), a circle holding none of them is
    // drawn at 10% opacity, as on screen.
    if (input.highlight) {
      circles.forEach(c => { c.lit = c.members.some(k => input.highlight.has(k)); if (!c.lit) c.opacity = 0.10; });
    }


    // The map's box: the focus counties' box widened 3% on each side (SMR 4762-4776).
    const want = new Set(f.counties);
    const focusSub = input.counties.filter(c => want.has(c.properties.name));
    const bb = focusSub.length ? BR.bounds(focusSub) : {
      west: Math.min(...plain.map(p => p.lon)), east: Math.max(...plain.map(p => p.lon)),
      south: Math.min(...plain.map(p => p.lat)), north: Math.max(...plain.map(p => p.lat)) };
    const padX = (bb.east - bb.west) * 0.03;
    const padY = (bb.north - bb.south) * 0.03;
    const extent = { west: bb.west - padX, east: bb.east + padX, south: bb.south - padY, north: bb.north + padY };
    const mapH = L.statY - BAND_PAD;
    const corrected = aspectCorrect(extent, L.mapW, mapH);
    const { mapPanel, fit } = fitAboveBand(0, 0, L.mapW, mapH, extent, input.band);
    const P = (lon, lat) => fit.project(lon, lat);
    const drawn = showCircles ? circles.map(c => {
      const [x, y] = P(c.lon, c.lat);
      return Object.assign({}, c, { x, y, r: BR.pointRadius(c.size, c.stroke) });
    }) : [];
    return { bg, theme, streets, opacity, showCircles, grouped, nGroupedAway, circles, rMin, rMax, toSize, focusSub,
      extent, mapH, corrected, mapPanel, fit, P, drawn };
  }

  // The County Focus map's branded page: { model, parts, style } as wa(), or null with no premises to draw.
  function focus(input, styleOpts) {
    const BR = B();
    const style = BR.styleOf(styleOpts);
    const L = BR.LAYOUT;
    const f = input.f;
    const plain = input.premises || [];
    if (!plain.length) return null;
    const { bg, theme, streets, showCircles, grouped, nGroupedAway, rMin, rMax, focusSub, extent, corrected,
      mapPanel, fit, P, drawn } = focusLayout(input, style);

    // Strings and numbers (SMR 4712-4750).
    const counties = f.counties.slice();
    const focusLabel = counties.length <= 3 ? counties.slice().sort(cmpR).join(', ').toUpperCase()
      : counties.length + ' COUNTIES';
    const title = resolveTitle(input.title, 'PREMISES-LEVEL MOVEMENT – ' + speciesLabel(f.species, input.universe) +
      ' – ' + focusLabel + ' FOCUS');
    const meta = {
      left: 'Data Range: Jan ' + Math.min(...f.years) + ' – Dec ' + Math.max(...f.years),
      right: BR.updated(input.date)
    };
    const stats = { left: [periodParts(f.quarters, f.years, input.yearChoices)], right: [] };
    const cities = new Set(plain.map(p => p.city).filter(c => c !== null && c !== undefined && String(c).length));
    const places = new Set(plain.map(p => p.lat + ',' + p.lon));
    const total = plain.reduce((s, p) => s + (p.total_animals === null || Number.isNaN(p.total_animals) ? 0
      : p.total_animals), 0);
    const boxes = [
      { label: 'Cities', value: S().comma(cities.size), color: '#245566' },
      { label: 'Premises', value: S().comma(places.size), color: '#1c5a83' },
      { label: 'Total Animals', value: S().comma(total), color: '#c8842c' }];
    const top = focusTop(plain);

    // The legend's tiers (SMR 4960-4976): CVI's tiers on the grouped totals, sized as the circles; or CVI's
    // "low, mid, high" when there are none.
    let legend = { labels: ['low', 'mid', 'high'], sizes: [5, 10, 16], fixed: true };
    if (showCircles) {
      // The GIF's shared scale: the tiers from every frame's group totals.
      const tiers = S().legendTiers(input.scale ? input.scale.values : grouped.map(c => c.total_animals), f.scaling,
        f.nBins, 4, 24);
      if (tiers && tiers.values.length) {
        legend = {
          labels: tiers.values.map(v => S().comma(S().rRound(v))),
          sizes: tiers.radii.map(r => MIN_PT + Math.min(1, Math.max(0, (r - rMin) / (rMax - rMin))) * 16.5),
          fixed: false
        };
      }
    }
    legend.sizing = sizingLine('Circle size', f.scaling, legend.fixed ? null : [legend.labels.length]);

    // ── Drawing ──
    // White map lines on the Default background (as the WA State, National Flow and Infrastructure
    // PNGs), around the land and between the focus counties; Streets keeps gray, since white would vanish on its
    // near-white land.
    const plainLine = streets ? '#8a8a8a' : '#ffffff';
    const mapParts = [];
    for (const c of focusSub) {
      const fill = bg ? '" fill="' + theme.outline + '" fill-opacity="0.08' : streets ? '" fill="#f5f5f5' : '" fill="#e8e8e8';
      mapParts.push('<path d="' + BR.pathData(c.geometry, P) + fill + '" stroke="' + (bg ? theme.boundary : plainLine) +
        '" stroke-width="' + BR.num(BR.linePt(0.5)) + '" stroke-linejoin="round"/>');
    }
    // Population context, cut to the focus counties as Streets is.
    const pop = populationOf(input);
    if (pop) {
      mapParts.push(populationLayers(pop, focusSub, P, { extent, clip: focusSub, id: 'focus',
        line: bg ? theme.boundary : plainLine, width: 0.5 }));
    }
    const outline = focusSub.length > 1 && streets ? '#d0d0d0' : '#ffffff';
    for (const c of focusSub) {
      mapParts.push('<path d="' + BR.pathData(c.geometry, P) + '" fill="none" stroke="' + outline +
        '" stroke-width="' + BR.num(BR.linePt(0.9)) + '" stroke-linejoin="round"/>');
    }
    // Streets: water and roads over the outline (CVI's admin_below_water), cut to the focus counties.
    if (streets) {
      const clip = '<clipPath id="focus-streets">' + focusSub.map(c => '<path d="' + BR.pathData(c.geometry, P) +
        '"/>').join('') + '</clipPath>';
      mapParts.push(clip + '<g clip-path="url(#focus-streets)">' +
        streetsParts(streets, P, focusSub, extent, 0.05, style) + '</g>');
    }
    // The GIF: input.obstacles, every frame's circles together, so the names are placed the same in
    // every frame.
    const around = input.obstacles || drawn;
    // County names: CVI's place (each county's center lifted by 5% of the map's height), moved by the page's placement
    // when a circle covers it (SMR 4881-4893).
    const lift = (corrected.north - corrected.south) * 0.05;
    const namePt = BR.textPt(3.8);
    const area = areaAboveBand({ x0: mapPanel.left + 2, x1: mapPanel.left + mapPanel.width - 2, y0: mapPanel.top + 2,
      y1: mapPanel.top + mapPanel.height - 2 }, input.band);
    const nameItems = focusSub.map(c => {
      const [lon, lat] = planarCentroid(c.geometry);
      return { name: c.properties.name, lon, lat: lat + lift, at: P(lon, lat + lift) };
    });
    // Facility markers (CVI's .add_overlay_layers, County Focus's circle style, SMR 1077-1262): each layer that is
    // on, in the registry's order, a filled circle (size 3) in its color with a thin white edge, over the circles.
    const facilities = (input.facilities || []).map(l => Object.assign({}, l, {
      points: l.points.map(q => {
        const [x, y] = P(q.lon, q.lat);
        return Object.assign({}, q, { x, y, r: BR.pointRadius(3.0, 0.5) });
      })
    }));
    const markers = facilities.flatMap(l => l.points.map(q => ({ x: q.x, y: q.y, r: q.r })));
    const names = placeLabels(nameItems, around.concat(markers), focusSub, P, namePt, area, 6);
    names.forEach((n, i) => Object.assign(n, { cviLon: nameItems[i].lon, cviLat: nameItems[i].lat,
      moved: n.x !== nameItems[i].at[0] || n.y !== nameItems[i].at[1] }));
    // On Satellite CVI's theme writes light names on a dark halo; the page darkens names only on the light themes.
    const lightNames = bg && bg.theme === 'satellite';
    const nameStyle = { pt: namePt, anchor: 'middle',
      color: lightNames ? theme.label : style.darkNames ? BR.nameColor(style) : bg ? theme.label : '#333333',
      halo: { color: lightNames ? theme.labelFill : '#ffffff', opacity: lightNames ? theme.labelFillAlpha
        : bg ? theme.labelFillAlpha : 0.78, width: 2 * 0.30 * namePt } };
    // In CVI's style the names stay at CVI's place.
    for (const [i, n] of names.entries()) {
      if (style.darkNames && n.over) continue;   // drawn over the circles below
      const at = style.darkNames ? [n.x, n.y] : nameItems[i].at;
      mapParts.push(BR.text(n.name, at[0], at[1], nameStyle));
    }
    const streetNames = streets ? streetsNames(streets, P, focusSub, names.map((n, i) => {
      const at = style.darkNames ? [n.x, n.y] : nameItems[i].at;
      const w = BR.textWidth(n.name, namePt) + 2;
      return { x0: at[0] - w / 2, x1: at[0] + w / 2, y0: at[1] - namePt * 0.475, y1: at[1] + namePt * 0.475 };
    }), area) : [];
    streetNames.forEach(n => mapParts.push(n.markup));
    // The population layers' names: every city and place in the focus counties, skipped with Streets (which names
    // places already), clear of the county names, over the circles.
    const popNames = pop && !streets ? populationNames(pop, P, area, names.map((n, i) => {
      const at = style.darkNames ? [n.x, n.y] : nameItems[i].at;
      return nameBox(n.name, at[0], at[1], namePt);
    }), around.concat(markers), { min: 0, counties: focusSub }) : null;
    for (const c of drawn) {
      mapParts.push(BR.circle(c.x, c.y, c.size, c.stroke, ROLE_COLORS[c.direction] || c.color, c.opacity, '#ffffff'));
    }
    for (const l of facilities) {
      for (const q of l.points) mapParts.push(BR.circle(q.x, q.y, 3.0, 0.5, l.color, 1, '#ffffff', l.shape));
    }
    // County names placed over their own circles (step b; the page's style only) go on top of the circles.
    for (const n of names) {
      if (style.darkNames && n.over) mapParts.push(BR.text(n.name, n.x, n.y, nameStyle));
    }
    if (popNames) mapParts.push(popNames.markup);
    // Name markers ("Name markers in PNG"): the picked layers' names, wrapped as CVI's, placed apart (labels.js).
    const LB = root.WSDA.labels;
    const namePtF = BR.textPt(2.6);
    const wanted = new Set(input.nameLayers || []);
    const facilityNames = [];
    for (const l of facilities.filter(x => wanted.has(x.key))) {
      for (const q of l.points) {
        const lines = LB.wrapName(q.name);
        if (lines.length) facilityNames.push({ lines, x: q.x, y: q.y, r: q.r, color: facilityNameColor(l), layer: l.key });
      }
    }
    const nameArea = areaAboveBand({ x0: mapPanel.left + 2, x1: mapPanel.left + mapPanel.width - 2,
      y0: mapPanel.top + 2, y1: mapPanel.top + mapPanel.height - 2 }, input.band);
    // County names keep their places; facility names go around them.
    const countyBoxes = names.map((n, i) => {
      const at = style.darkNames ? [n.x, n.y] : nameItems[i].at;
      const w = BR.textWidth(n.name, namePt) + 2;
      return { x0: at[0] - w / 2, x1: at[0] + w / 2, y0: at[1] - namePt * 0.475, y1: at[1] + namePt * 0.475 };
    });
    const facilityPlaces = LB.place(facilityNames, markers, around, nameArea, namePtF,
      countyBoxes.concat(streetNames.filter(n => n.box).map(n => n.box), popNames ? popNames.placed.map(n => n.box) : []));
    facilityNames.forEach((n, i) => mapParts.push(LB.markup(n, facilityPlaces[i], namePtF, n.color)));
    // Every name on the map, the facility names included.
    const mapNameBoxes = names.map(n => n.box).concat(popNames ? popNames.placed.map(n => n.box) : [],
      streetNames.filter(n => n.box).map(n => n.box), facilityPlaces.filter(q => q && q.box).map(q => q.box));
    // The WA inset's corner, clear of the land, circles, markers and names where one is (focusInsetCorner). In the
    // GIF every frame goes around the same circles (input.obstacles) and names, so the corner holds still.
    const insetAt = focusInsetCorner(L.statY - BAND_PAD, focusSub, P, around.concat(markers), mapNameBoxes, style);
    const insetAtBox = insetBox(insetAt);

    // The scale bar: the gutter box's width at the map's scale, from the page's own projection.
    const midLat = (extent.south + extent.north) / 2;
    const panelLonDeg = (mapPanel.width / fit.scale) * 180 / Math.PI;
    const mapKm = panelLonDeg * 111.320 * Math.cos(midLat * Math.PI / 180);
    const scale = BR.scaleBarSpec((L.gutterW / L.mapW) * mapKm);
    const SB_H = 0.058;
    const SB_GAP = 0.012;
    const lgY = scale ? 0.045 + SB_H + SB_GAP : 0.045;
    const lgH = scale ? 0.34 - SB_H - SB_GAP : 0.34;

    // The Top box, top-anchored.
    const topY = 1 - L.headerH - 0.020 - top.height;
    const topPanel = BR.panel(L.gutterX, topY, L.gutterW, top.height, 0);
    // The legend's room reaches up to the Top box; in the GIF (input.legendTop), to the lowest Top box of every frame,
    // so the legend is laid out the same in every frame.
    const legendTop = input.legendTop === undefined ? topY : Math.min(input.legendTop, topY);

    // The legend: CVI's evenly spaced layout in CVI's style, with the grouping note between the legend and the Top
    // box (SMR 5096-5105); else rows spaced by size, the sizing line and the grouping note as the box's
    // last lines, the box free to grow up to the Top box.
    // The GIF (input.notePad: some frame groups premises): a frame that groups none keeps the note's room with blank
    // lines, so the legend box does not change height from frame to frame.
    let noteLines = nGroupedAway > 0 ? [S().comma(plain.length) + ' premises grouped into',
      S().comma(grouped.length) + ' nearby-location circles', '(full list in export)'] : input.notePad ? ['', '', ''] : [];
    let legendBox;
    let noteY = null;
    let noteParts = [];
    const popRows = populationLegend(pop);
    let popCorner = null;
    if (style.legendBySize) {
      legendBox = focusLegendBySize(legend, showCircles, facilities, lgY, lgH, legendTop - 0.008 - lgY, style, noteLines,
        popRows);
      // A box too short for everything (a size circle would reach into its heading): the
      // grouping note in one line, when that lets the legend fit.
      const shortNote = nGroupedAway > 0
        ? [S().comma(plain.length) + ' premises in ' + S().comma(grouped.length) + ' grouped circles'] : [''];
      if (!legendBox.fits && noteLines.length) {
        const shorter = focusLegendBySize(legend, showCircles, facilities, lgY, lgH, legendTop - 0.008 - lgY, style,
          shortNote, popRows);
        if (shorter.fits) {
          legendBox = shorter;
          noteLines = shortNote;
        }
      }
      if (popRows.length && !legendBox.fits) {
        legendBox = focusLegendBySize(legend, showCircles, facilities, lgY, lgH, legendTop - 0.008 - lgY, style, noteLines);
        popCorner = populationCorner(popRows, mapPanel, around.concat(markers), mapNameBoxes,
          Math.max(0.03, input.band || 0), insetAtBox);
      }
      // Still short of room with the facility layers on (2.2): their text smaller, each size tried with the
      // grouping note as it is, then in one line; then the last layers named as "and N more layers (see the CSV
      // export)", as many listed as fit at the smallest text with the note in one line.
      if (!legendBox.fits && facilities.length) {
        const again = (fo, note) => focusLegendBySize(legend, showCircles, facilities, lgY, lgH, legendTop - 0.008 - lgY,
          style, note, popCorner ? null : popRows, fo);
        const notes = noteLines.length && nGroupedAway > 0 ? [noteLines, shortNote] : [noteLines];
        let found = null;
        for (const scale of FOCUS_KEY_TEXT) {
          for (const note of notes) {
            const key = found ? null : again({ scale }, note);
            if (key && key.fits) found = { key, note };
          }
        }
        if (!found) {
          const scale = FOCUS_KEY_TEXT[FOCUS_KEY_TEXT.length - 1], note = notes[notes.length - 1];
          const k = longestFitting(facilities.length - 1, j => again({ scale, shown: j }, note).fits);
          found = { key: again({ scale, shown: k }, note), note };
        }
        legendBox = found.key;
        noteLines = found.note;
      }
    } else {
      legendBox = focusLegendEven(legend, showCircles, facilities, lgY, lgH, style);
      noteY = GROUP_NOTE_Y;
      noteParts = noteLines.map((t, k) => BR.text(t, BR.px(L.gutterX + L.gutterW / 2),
        BR.py(noteY) + (k - 1) * 9.6, { pt: 8, color: '#666666', italic: true, anchor: 'middle' }));
    }

    const parts = [
      BR.clipped('focus-map', mapPanel, mapParts.join('')),
      BR.header(title, style),
      BR.metaRow(meta.left, meta.right, style),
      BR.statRow(stats.left, stats.right),
      BR.valueBoxes(boxes, 0.46, L.statY - 0.024, L.mapW - 0.46, 0.044),
      focusTopParts(topPanel, top),
      legendBox.parts,
      BR.inset(input.counties, counties, style, insetAt),
      popCorner ? popCorner.parts : '',
      scale ? BR.scaleBar(scale, L.gutterX, 0.045, L.gutterW, SB_H) : '',
      BR.logo(),
      noteParts.join(''),
      BR.highlightLine(input.highlights),
      BR.footnote(withPopulation(streets ? SOURCE_COUNTIES + ' · ' + STREETS_CREDIT : SOURCE_COUNTIES, pop),
        bg ? bg.attribution : null, style, input.synthetic)
    ];
    const model = {
      view: 'focus', title, titleSize: BR.titleSize(title), meta, stats, boxes, top, legend,
      legendY: lgY, legendHeight: legendBox.height, legendCircles: legendBox.circles, legendOverlap: legendBox.overlap,
      legendAcross: !!legendBox.across, legendAcrossRows: legendBox.acrossRows || 0, legendSqueezed: !!legendBox.squeezed,
      // The key's facility rows (each row's layer names), their text size and the layers named only in a count (2.2).
      legendFacilityRows: legendBox.facilityRows || null, legendFacilityScale: legendBox.facilityScale || 1,
      legendFacilitiesLeftOut: legendBox.facilitiesLeftOut || 0, legendFits: legendBox.fits === undefined ? null : legendBox.fits,
      circles: drawn, grouped: { premises: plain.length, circles: grouped.length, note: noteLines, noteY },
      names, nameArea: area, extent, corrected, scale, mapKm, topY, highlights: input.highlights || [],
      mapPanel: { left: mapPanel.left, top: mapPanel.top, width: mapPanel.width, height: mapPanel.height },
      facilities: facilities.map(l => ({ key: l.key, label: l.label, color: l.color, shape: l.shape,
        points: l.points.map(q => ({ name: q.name, lon: q.lon, lat: q.lat, x: q.x, y: q.y })) })),
      facilityNames: facilityNames.map((n, i) => ({ lines: n.lines, color: n.color, layer: n.layer, x: n.x, y: n.y,
        r: n.r, at: facilityPlaces[i] })), countyNameBoxes: countyBoxes,
      inset: { corner: insetAt.corner, x: insetAt.x, y: insetAt.y, w: INSET.w, h: INSET.h, box: insetAtBox,
        covers: insetAt.covers, land: insetAt.land, scores: insetAt.scores },
      background: bg || streets ? input.background : 'standard', underlay: underlayOf(input, mapPanel, fit, focusSub, 11),
      streetNames: streetNames.map(n => ({ kind: n.kind, name: n.name, x: n.x, y: n.y, box: n.box || null })),
      basemap: bg ? bg.attribution : null, theme: bg ? bg.theme : 'standard', nameColor: nameStyle.color,
      source: style.sourceLine ? withPopulation(SOURCE_COUNTIES, pop) : null, fileName: fileNameFocus(f)
    };
    if (pop) {
      model.population = { on: pop.on, ramp: pop.ramp, names: popNames ? popNames.placed : [],
        dropped: popNames ? popNames.dropped : [], namesSkipped: !!streets,
        legend: popCorner ? popCorner.corner : 'legend', corner: popCorner ? popCorner.box : null,
        cornerFallback: !!(popCorner && popCorner.fallback) };
    }
    return { model, parts, style };
  }

  // The County Focus key in the page's style (2.2: CVI's order, .build_focus_legend SMR 4261-4430,
  // ran the facility rows into the premises rows once the box was short): CVI PREMISES first (the two roles, then
  // "Animals per premises" with the size tiers and the sizing line), then FACILITY LOCATIONS (each layer's mark and
  // label, the registry's order), two layers to a row when both names fit their half. The role and facility rows are
  // never drawn closer than their text (keep). With the circles hidden, only the facility layers. fo: { scale (the
  // facility rows' text, a share of the key's), shown (how many layers are listed; the rest named in one line) }.
  // CVI's own style keeps CVI's order and places (focusLegendEven).
  function focusLegendEntries(legend, showCircles, facilities, style, fo) {
    const BR = B();
    const o = fo || {};
    const pt = BR.textPt(3.0);
    const shown = o.shown === undefined ? facilities.length : o.shown;
    const heading = t => ({ text: t, pt: BR.textPt(3.2), color: '#222222', bold: true });
    const entries = [];
    if (showCircles) {
      entries.push(heading('CVI PREMISES'));
      for (const [dir, label] of [['Inbound', 'Importer (received)'], ['Outbound', 'Exporter (sent)']]) {
        entries.push({ keep: true, circle: { size: 5, stroke: 0.8, fill: ROLE_COLORS[dir], opacity: 0.85 }, x: 0.14,
          labelX: 0.26, label, labelPt: pt });
      }
      entries.push({ text: 'Animals per premises', pt: BR.textPt(2.8), color: '#444444', bold: true }, { flex: true });
      legend.labels.forEach((label, i) => entries.push({ circle: { size: legend.sizes[i], stroke: 1.0,
        fill: '#888888', opacity: 0.5 }, x: 0.18, labelX: 0.40, label, labelPt: pt }));
      entries.push({ flex: true });
      if (style.sizingLine) {
        entries.push({ text: legend.sizing, pt: BR.textPt(2.5), color: '#444444', italic: true });
      }
    }
    if (facilities.length) {
      if (showCircles) entries.push({ rule: { color: '#bbbbbb', width: 0.3, x0: 0.06, x1: 0.94 } });
      entries.push(heading('FACILITY LOCATIONS'));
      entries.push(...facilityKeyRows(facilities.slice(0, shown), pt * (o.scale || 1)));
      const more = facilities.length - shown;
      if (more > 0) {
        entries.push({ text: 'and ' + S().comma(more) + ' more layer' + (more === 1 ? '' : 's'), pt: 7.5, color: '#666666',
          italic: true }, { text: '(see the CSV export)', pt: 7.5, color: '#666666', italic: true });
      }
    }
    return entries;
  }
  // The facility layers' rows of County Focus's key: two layers to a row (the second at the box's middle) when both
  // labels fit their half, else one layer to a row as before; each row at least as tall as its text (keep).
  // Each row's entry carries its layers' labels (names) for the model.
  const FACILITY_MARK = { size: 4, stroke: 0.8, opacity: 1 };
  function facilityKeyRows(layers, pt) {
    const BR = B();
    const MARK = FACILITY_MARK;
    // The row's sample is drawn from x (the key's u(0.08)): each layer's mark, then its name gap points after it.
    const inner = BR.px(BR.LAYOUT.gutterW) - 10;   // the key's inner width (legendColumn's margin: 5 points)
    const x0 = 0.08 * inner, gap = 9;               // the mark's place, and its label's distance from the mark
    const room = 0.5 * inner - x0 - gap - 4;        // a label's width in its half
    const reach = l => (root.WSDA.facilities ? root.WSDA.facilities.MARK_EXTENT[l.shape] || 1 : 1);
    const markH = l => 2 * BR.pointRadius(MARK.size, MARK.stroke) * reach(l);
    const mark = (l, x, y) => BR.circle(x, y, MARK.size, MARK.stroke, l.color, MARK.opacity, '#ffffff', l.shape);
    const rows = [];
    for (let i = 0; i < layers.length; i++) {
      const a = layers[i], b = layers[i + 1];
      // Both in one row, or this one alone, its mark and name where the left column's are.
      const row = b && BR.textWidth(a.label, pt) <= room && BR.textWidth(b.label, pt) <= room ? [a, b] : [a];
      if (row.length === 2) {
        i++;
      }
      rows.push({ keep: true, x: 0.08, label: '', labelPt: pt, names: row.map(l => l.label),
        sample: { height: Math.max(...row.map(markH)), draw: (x, y) => row.map((l, k) =>
          mark(l, x + k * 0.5 * inner, y) + BR.text(l.label, x + k * 0.5 * inner + gap, y, { pt, color: '#444444' })).join('') } });
    }
    return rows;
  }
  // The facility rows' text sizes tried, as shares of the key's, before fewer layers are listed (as Emergency's key).
  const FOCUS_KEY_TEXT = [1, 0.9, 0.8];
  // When the stacked column does not fit, the size samples go side by side in one row (sizes unchanged and
  // never touching), if that row fits the box's width; when one row is too wide, in two or three rows, the smaller
  // samples first (so natural breaks' circles are not drawn over each other).
  // fo: the facility rows' text size and how many layers are listed (focusLegendEntries).
  function focusLegendBySize(legend, showCircles, facilities, y, minH, maxH, style, noteLines, extra, fo) {
    const BR = B();
    // nRows: 0 for the stacked column, else the number of side-by-side rows.
    const build = nRows => {
      let entries = focusLegendEntries(legend, showCircles, facilities, style, fo);
      if (nRows) {
        const rows = entries.filter(e => e.circle && e.x === 0.18);
        const at = entries.indexOf(rows[0]);
        entries = entries.filter(e => rows.indexOf(e) < 0);
        entries.splice(at, 0, ...groupsOf(rows, nRows).map(g => ({ across: g.map(e => Object.assign({ label: e.label },
          e.circle)), labelPt: BR.textPt(2.6) })));
      }
      entries.push(...(extra || []));   // the population layers' rows
      if (noteLines && noteLines.length) {
        entries.push({ rule: { color: '#bbbbbb', width: 0.3, x0: 0.06, x1: 0.94 } });
        noteLines.forEach(t => entries.push({ text: t, pt: 7.5, color: '#666666', italic: true }));
      }
      // The facility rows as drawn (each row's layer names), the text size and the layers left out, for the model.
      return Object.assign(BR.legendColumn(entries, { bottom: y, minH, maxH: Math.max(minH, maxH) }), {
        facilityRows: entries.filter(e => e.names).map(e => e.names), facilityScale: (fo && fo.scale) || 1,
        facilitiesLeftOut: facilities.length - entries.filter(e => e.names).reduce((t, e) => t + e.names.length, 0) });
    };
    const column = build(0);
    if (column.fits || !showCircles) return column;
    // Does each side-by-side row's span of circles fit the box's inner width?
    const inner = BR.px(BR.LAYOUT.gutterW) - 10;
    const wide = (built, nRows) => {
      const xs = built.circles.filter(c => c.across);
      return xs.length > 0 && groupsOf(xs, nRows).every(g => Math.max(...g.map(c => c.x + c.r)) -
        Math.min(...g.map(c => c.x - c.r)) <= inner);
    };
    const tries = [1, 2, 3].filter(k => k <= legend.labels.length).map(k => ({ k, built: build(k) }));
    const fit = tries.find(t => t.built.fits && wide(t.built, t.k));
    if (fit) return Object.assign(fit.built, { across: true, acrossRows: fit.k });
    const row = tries[0];
    return row && wide(row.built, 1) && !row.built.overlap ? Object.assign(row.built, { across: true, acrossRows: 1 })
      : column;
  }
  // A list cut into n consecutive groups, the earlier groups as long as the later ones or one longer.
  function groupsOf(list, n) {
    const out = [];
    let start = 0;
    for (let g = 0; g < n; g++) {
      const len = Math.ceil((list.length - start) / (n - g));
      out.push(list.slice(start, start + len));
      start += len;
    }
    return out.filter(g => g.length);
  }
  // CVI's layout: fixed places in a box of CVI's height (.build_focus_legend's places, SMR 4290-4352, with its
  // squeeze into 0.03 to 0.97 when the facility rows overflow).
  function focusLegendEven(legend, showCircles, facilities, y, h, style) {
    const BR = B();
    const lg = BR.panel(BR.LAYOUT.gutterX, y, BR.LAYOUT.gutterW, h, 5);
    const parts = [BR.box(lg)];
    const placed = [];
    const n = legend.labels.length;
    const nOv = facilities.length;
    const seq = (a, b, k) => (k === 1 ? [a] : Array.from({ length: k }, (_, i) => a + (i * (b - a)) / (k - 1))).reverse();
    let Y;
    if (!showCircles) {
      Y = { ovHdr: 0.92, ovFirst: 0.92 - 0.08 - (Math.max(nOv, 1) - 1) * 0.085, ovStep: 0.085, ovDiv: null };
    } else if (nOv > 0) {
      Y = { sz: seq(0.04, 0.28, n), apHdr: 0.34, apDiv: 0.40, ovFirst: 0.49, ovStep: 0.07 };
      Y.ovHdr = Y.ovFirst + nOv * Y.ovStep + 0.03;
      Y.ovDiv = Y.ovHdr + 0.05;
      Y.role2 = Y.ovDiv + 0.07;
      Y.role1 = Y.role2 + 0.07;
      Y.roleHdr = Y.role1 + 0.06;
      const lo = Math.min(...Y.sz);
      if (Y.roleHdr > 0.97 || lo < 0.03) {
        const a = (0.97 - 0.03) / (Y.roleHdr - lo);
        const b = 0.03 - a * lo;
        const f = v => a * v + b;
        Y = { sz: Y.sz.map(f), apHdr: f(Y.apHdr), apDiv: f(Y.apDiv), ovFirst: f(Y.ovFirst), ovStep: a * Y.ovStep,
          ovHdr: f(Y.ovHdr), ovDiv: f(Y.ovDiv), role2: f(Y.role2), role1: f(Y.role1), roleHdr: f(Y.roleHdr) };
      }
    } else {
      Y = { sz: seq(0.08, 0.42, n), apHdr: 0.49, apDiv: 0.55, role2: 0.68, role1: 0.80, roleHdr: 0.93 };
    }
    const header = (t, yy) => parts.push(BR.text(t, lg.u(0.5), lg.v(yy), { pt: BR.textPt(3.2), color: '#222222', bold: true,
      anchor: 'middle' }));
    const divider = yy => parts.push(BR.line(lg.u(0.06), lg.v(yy), lg.u(0.94), lg.v(yy), '#bbbbbb', BR.linePt(0.3)));
    if (showCircles) {
      header('PREMISES ROLE', Y.roleHdr);
      [['Inbound', 'Importer (received)', Y.role1], ['Outbound', 'Exporter (sent)', Y.role2]].forEach(([dir, label, yy]) => {
        parts.push(BR.circle(lg.u(0.14), lg.v(yy), 5, 0.8, ROLE_COLORS[dir], 0.85, '#ffffff'));
        parts.push(BR.text(label, lg.u(0.26), lg.v(yy), { pt: BR.textPt(3.0), color: '#444444' }));
      });
    }
    if (nOv > 0) {
      if (Y.ovDiv !== null && Y.ovDiv !== undefined) divider(Y.ovDiv);
      header('FACILITY LOCATIONS', Y.ovHdr);
      facilities.forEach((l, i) => {
        const yy = Y.ovFirst + (nOv - 1 - i) * Y.ovStep;
        parts.push(BR.circle(lg.u(0.14), lg.v(yy), 4, 0.8, l.color, 1, '#ffffff', l.shape));
        parts.push(BR.text(l.label, lg.u(0.26), lg.v(yy), { pt: BR.textPt(3.0), color: '#444444' }));
      });
    }
    if (showCircles) {
      divider(Y.apDiv);
      header('ANIMALS / PREMISES', Y.apHdr);
      legend.labels.forEach((label, i) => {
        const yy = lg.v(Y.sz[i]);
        parts.push(BR.circle(lg.u(0.18), yy, legend.sizes[i], 1.0, '#888888', 0.5, '#ffffff'));
        parts.push(BR.text(label, lg.u(0.40), yy, { pt: BR.textPt(3.0), color: '#444444' }));
        placed.push({ y: yy, r: BR.pointRadius(legend.sizes[i], 1.0), label });
      });
      if (style.sizingLine) {
        parts.push(BR.text(legend.sizing, lg.u(0.5), lg.v(0.0), { pt: BR.textPt(2.5), color: '#444444',
          italic: true, anchor: 'middle' }));
      }
    }
    return { height: h, parts: parts.join(''), circles: placed, overlap: null };
  }

  // CVI_CountyFocus_{directions}_{counties}_{years}_{quarters}.png (mod_maps.R 6397-6410, 6778-6780): directions and
  // up to three counties sorted and joined, letters and digits only; more counties as "4Counties".
  function fileNameFocus(f) {
    const dirs = f.direction === 'inbound' ? ['Inbound'] : f.direction === 'outbound' ? ['Outbound']
      : ['Inbound', 'Outbound'];
    const clean = s => s.replace(/[^A-Za-z0-9]/g, '');
    const cty = f.counties.length <= 3 ? clean(f.counties.slice().sort(cmpR).join('-')) : f.counties.length + 'Counties';
    const dirPart = clean(dirs.slice().sort(cmpR).join('-'));
    return 'CVI_CountyFocus_' + (dirPart + '_' + cty || 'Dir') + '_' + yearLabel(f.years) + '_' +
      f.quarters.slice().sort(cmpC).join('') + '.png';
  }

  // CVI's file name: CVI_County_Map_{years}_{quarters}_{INB+OUT}.png (mod_maps.R 6839-6841). The year and quarter
  // parts are the export's own (exports.js gives them for the ZIP); here: years joined by "-" when a range.
  function fileNameWa(f) {
    const ys = f.years.slice().sort((a, b) => a - b);
    const yr = ys.length > 1 ? ys[0] + '-' + ys[ys.length - 1] : String(ys[0]);
    const qtr = f.quarters.slice().sort(cmpC).join('');
    return 'CVI_County_Map_' + yr + '_' + qtr + '_' + f.direction.map(d => d.slice(0, 3).toUpperCase()).join('+') +
      '.png';
  }

  // ── Premise Lookup's branded proximity map (S11; render_branded_proximity_map, SMR 5509-5923) ────────────────────
  // CVI's page: the header, "Endpoint: …" and Last Updated, the period with the Sites / CVIs / Animals boxes, the
  // map of the sites, their buffers and the matched origins and destinations, the QUERY SITES panel (.build_
  // proximity_panel, SMR 5140-5330), the MAP KEY (.build_proximity_legend, SMR 5355-5507) over the scale bar, and the
  // WA inset with the sites. Deliberate differences: the rings in the page's ring colors, as on the live map (CVI:
  // three grays); the facility layers ticked under "Facilities inside", only the facilities inside the buffers, drawn
  // as County Focus's circles with their counts inside in the key (CVI: its own layer list, every facility in view, as
  // shapes); a facilities-only page when there is no CVI match; the population layers when Premise Lookup's own
  // switches are on. Also: zones drawn as their polygons in the inner color ("Zone" in the panel, "Zone (from file)"
  // in the key), the site names beside their markers (CVI centers them on the marker) and, where CVI's key colors
  // would not match the rings drawn (several single buffers, or sites with different bands), one key row per ring
  // radius.
  const PROX_RING = ['#fcb614', '#8fc965', '#a7d7e2'];   // the page's ring colors, inner to outer (lookup.js)
  const PROX_RING_OPACITY = 0.35;
  const PROX = { site: '#c0392b', origin: '#F0A06E', dest: '#1C9CD9', teal: '#245566', blue: '#1c5a83',
    gold: '#c8842c' };
  const PROX_PANEL_H = 0.46;
  const PROX_NAMES_KM = 100;   // narrower maps name every city and place in view
  const SOURCE_FACILITIES = 'facility layers as loaded';
  const STREETS_NOTE = STREETS_CREDIT;

  // R's filled point shapes 22 (square), 23 (diamond) and 24 (triangle) as grid draws them (R's engine.c: the
  // square's half side is 0.375 * sqrt(pi / 4) of the font size, the diamond's 0.375 * sqrt(pi / 2), the triangle
  // has the circle's area), the font size being ggplot2's size * .pt + stroke * .stroke / 2.
  function shapeMark(shape, x, y, size, stroke, fill, fillOpacity, border) {
    const BR = B();
    const fs = size * BR.textPt(1) + stroke * (96 / 25.4) / 2;
    const r = 0.375 * fs;
    let d;
    if (shape === 22) {
      const h = r * 0.886226925452758;
      d = 'M' + BR.num(x - h) + ' ' + BR.num(y - h) + 'H' + BR.num(x + h) + 'V' + BR.num(y + h) + 'H' + BR.num(x - h) + 'Z';
    } else if (shape === 23) {
      const h = r * 1.2533141373155;
      d = 'M' + BR.num(x - h) + ' ' + BR.num(y) + 'L' + BR.num(x) + ' ' + BR.num(y - h) + 'L' + BR.num(x + h) + ' ' +
        BR.num(y) + 'L' + BR.num(x) + ' ' + BR.num(y + h) + 'Z';
    } else {
      const top = r * 1.55512030155621;
      const xc = r * 1.34677368708860;
      const yc = r * 0.77756015077811;
      d = 'M' + BR.num(x) + ' ' + BR.num(y - top) + 'L' + BR.num(x + xc) + ' ' + BR.num(y + yc) + 'L' + BR.num(x - xc) +
        ' ' + BR.num(y + yc) + 'Z';
    }
    return '<path d="' + d + '" fill="' + BR.esc(fill) + '" fill-opacity="' + BR.num(fillOpacity) + '" stroke="' +
      BR.esc(border) + '" stroke-width="' + BR.num(BR.pointBorder(stroke)) + '" stroke-linejoin="round"/>';
  }
  // The triangle's reach above its center (for a name placed over it), and each shape's full height (for the key's
  // rows): the circle 2r, the square and diamond their sides' and diagonal's extent, the triangle apex to base.
  const shapeFs = (size, stroke) => size * B().textPt(1) + stroke * (96 / 25.4) / 2;
  const triangleTop = (size, stroke) => 0.375 * shapeFs(size, stroke) * 1.55512030155621;
  const shapeHeight = (shape, size, stroke) => (shape === 'bullseye' ? 2 * bullseyeReach(size, stroke)
    : 0.375 * shapeFs(size, stroke) * (shape === 22 ? 2 * 0.886226925452758 : shape === 23 ? 2 * 1.2533141373155
      : shape === 24 ? 1.55512030155621 + 0.77756015077811 : 2));
  // The query site's bullseye (in place of CVI's triangle, shape 24, which looked like Restricted
  // Holding Facilities' mark): a red ring with a white middle and a red dot, about the triangle's size for the same
  // ggplot2 size and stroke. Its reach is the ring's outer edge.
  const bullseyeR = (size, stroke) => 0.375 * shapeFs(size, stroke) * 1.1;
  const bullseyeReach = (size, stroke) => 1.16 * bullseyeR(size, stroke);
  function siteMark(x, y, size, stroke) {
    const BR = B(), r = bullseyeR(size, stroke);
    return '<circle cx="' + BR.num(x) + '" cy="' + BR.num(y) + '" r="' + BR.num(r) + '" fill="#ffffff" stroke="' +
      PROX.site + '" stroke-width="' + BR.num(0.32 * r) + '"/><circle cx="' + BR.num(x) + '" cy="' + BR.num(y) +
      '" r="' + BR.num(0.34 * r) + '" fill="' + PROX.site + '"/>';
  }

  // A site's ring radii as CVI's .band_key writes them ("3/10/20"), and R's formatC(x, format = "fg") (4 significant
  // digits) for a site's own buffer.
  const bandKey = radii => radii.filter(r => r > 0).map(String).join('/');
  const fg = x => String(Number(Number(x).toPrecision(4)));

  // The rings drawn: each site's bands (proximity.bandShapes, CVI's geodesic disks and annuli), colored by their
  // radius among all radii drawn, as the live map (lookup.mapData); a zone's polygon in the inner color.
  function proximityShapes(sites) {
    const PX = root.WSDA.proximity;
    const bands = [].concat(...sites.map(s => PX.bandShapes(s)));
    const levels = [...new Set(bands.map(f => f.properties.bandKm))].sort((a, b) => a - b);
    const colorOf = km => PROX_RING[Math.min(levels.indexOf(km), PROX_RING.length - 1)];
    bands.forEach(f => { f.properties.color = colorOf(f.properties.bandKm); });
    const zones = sites.filter(s => s.zone).map(s => ({ type: 'Feature', geometry: s.zone,
      properties: { site: s.id, zone: true, color: PROX_RING[0] } }));
    return { bands, zones, levels, colorOf };
  }

  // The map's box (SMR 5734-5742): the buffers' box widened 10% on each side, at least 0.15 degrees each way.
  function proximityExtent(shapes, sites) {
    const b = { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity };
    const add = (lon, lat) => {
      b.west = Math.min(b.west, lon); b.east = Math.max(b.east, lon);
      b.south = Math.min(b.south, lat); b.north = Math.max(b.north, lat);
    };
    const all = shapes.bands.concat(shapes.zones);
    if (all.length) {
      for (const f of all) {
        const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
        for (const poly of polys) for (const c of poly[0]) add(c[0], c[1]);
      }
    } else {
      sites.forEach(s => add(s.lon, s.lat));
    }
    const padX = (b.east - b.west) * 0.10;
    const padY = (b.north - b.south) * 0.10;
    const e = { west: b.west - padX, east: b.east + padX, south: b.south - padY, north: b.north + padY };
    const MIN_SPAN = 0.15;
    if (e.east - e.west < MIN_SPAN) {
      const c = (e.west + e.east) / 2;
      e.west = c - MIN_SPAN / 2;
      e.east = c + MIN_SPAN / 2;
    }
    if (e.north - e.south < MIN_SPAN) {
      const c = (e.south + e.north) / 2;
      e.south = c - MIN_SPAN / 2;
      e.north = c + MIN_SPAN / 2;
    }
    return e;
  }

  // The county holding each site (SMR 5726-5731: the first county the point falls in), for the panel's subline.
  function siteCounty(site, counties) {
    const PX = root.WSDA.proximity;
    const hit = counties.find(f => PX.inZone(site.lon, site.lat, f.geometry));
    return hit ? hit.properties.name : null;
  }

  // The QUERY SITES panel's rows (.build_proximity_panel): CVI's sizes, places and cuts. rows: [{ name, count, county,
  // label (a radius, a band list or "Zone"), orig, dest }]; counts: the column's numbers (CVIs, or facilities on a
  // facilities-only page). o.sitesPanel (the page's style): at most 8 rows, the sites with the
  // most matches first (ties in table order), every name at the row's size, a name too wide for the column cut with
  // "…" (o.width: the panel's width in points), and a note of the sites not listed; else CVI's: up to 12 rows (9 with a
  // radius line) in table order, a long name shrunk (to half) before it is cut. Returns { rows (with their texts, sizes
  // and places as panel fractions), order (the sites listed, as indexes), more, empty, threeLine, rowH, scl }.
  const PANEL_ROWS = 8;
  function proximityPanelRows(rows, hasOd, o) {
    const page = !!(o && o.sitesPanel);
    const hdrH = 0.085;
    const colKeyY = 1 - hdrH - 0.018;
    const footTop = 0.24;
    const rowsTop = colKeyY - 0.03;
    const order = rows.map((r, i) => i);
    if (page) order.sort((a, b) => (rows[b].count || 0) - (rows[a].count || 0) || a - b);
    const maxRows = page ? PANEL_ROWS : rows.some(r => r.label) ? 9 : 12;
    const n = rows.length;
    const showN = Math.min(n, maxRows);
    const listed = order.slice(0, showN);
    const threeLine = (page ? listed.map(i => rows[i]) : rows).some(r => r.label);
    const left = n - showN;
    // "ranked by": the sites left out may tie with listed ones (so "fewer matches" would be untrue).
    const more = !left ? null : page ? left + ' more site' + (left === 1 ? '' : 's') + ' not listed (ranked by ' +
      (hasOd ? 'matches' : 'facilities inside') + ')' : '+' + left + ' more sites';
    const out = { rows: [], order: listed, more, empty: n === 0, threeLine, hdrH, colKeyY, footTop, rowsTop };
    if (!showN) return out;
    // The page keeps the note's own line clear of the last row (CVI writes it over the bottom of the rows).
    const avail = rowsTop - footTop - (page && more ? 0.045 : 0);
    const rowH = page ? Math.min(threeLine ? 0.150 : 0.130, avail / showN)
      : threeLine ? Math.max(0.078, Math.min(0.150, avail / showN)) : Math.max(0.050, Math.min(0.130, avail / showN));
    const scl = Math.max(0.72, Math.min(1.50, rowH / 0.085));
    const maxCty = Math.max(6, Math.floor(14 / scl));
    const maxNm = Math.max(9, Math.floor(18 / scl));
    Object.assign(out, { rowH, scl });
    const BR = B();
    listed.forEach((idx, i) => {
      const r = rows[idx];
      const topY = rowsTop - i * rowH;
      let nm = r.name === null || r.name === undefined || !String(r.name).length ? 'Site ' + (idx + 1) : String(r.name);
      let nmSize = 3.1 * scl;
      const count = S().comma(r.count || 0);
      const chars = Array.from(nm);
      if (page) {
        // The column: from the name's start (0.05) to the count's left edge, 6 points apart.
        const room = (0.96 - 0.05) * o.width - BR.textWidth(count, BR.textPt(3.2 * scl), true) - 6;
        const pt = BR.textPt(nmSize);
        if (BR.textWidth(nm, pt, true) > room) {
          const k = longestFitting(chars.length, j => BR.textWidth(chars.slice(0, j).join('') + '…', pt, true) <= room);
          nm = chars.slice(0, k).join('') + '…';
        }
      } else if (chars.length > maxNm) {
        nmSize = 3.1 * scl * Math.max(0.50, maxNm / chars.length);
        const hardCap = Math.floor(maxNm / 0.50);
        if (chars.length > hardCap) nm = chars.slice(0, hardCap - 2).join('') + '..';
      }
      let cty = r.county ? String(r.county) : null;
      if (!page && cty && Array.from(cty).length > maxCty) cty = Array.from(cty).slice(0, maxCty - 2).join('') + '..';
      const km = !!r.label;
      const nameY = km ? topY - rowH * 0.18 : topY - rowH * 0.24;
      const subY = km ? nameY - rowH * 0.30 : nameY - rowH * 0.40;
      const thirdY = km ? subY - rowH * 0.30 : null;
      const od = hasOd ? (r.orig || 0) + ' orig / ' + (r.dest || 0) + ' dest' : null;
      const subOf = c => (c && km ? c + '  ·  ' + r.label : c || (km ? r.label : ''));
      if (page && cty) {
        // The page cuts a county name only when the line runs into the counts on its right (not
        // "Walla W.." where "Walla Walla" fits), measured as the site names are.
        const subPt = BR.textPt(2.5 * scl);
        const room = (0.96 - 0.05) * o.width - (od && !km ? BR.textWidth(od, subPt) + 6 : 0);
        if (BR.textWidth(subOf(cty), subPt) > room) {
          const ch = Array.from(cty);
          const k = longestFitting(ch.length, j => BR.textWidth(subOf(ch.slice(0, j).join('') + '…'), subPt) <= room);
          cty = ch.slice(0, k).join('') + '…';
        }
      }
      const subLeft = subOf(cty);
      out.rows.push({ site: idx, name: nm, nameSize: nmSize, nameY, count, countSize: 3.2 * scl, subLeft,
        subSize: 2.5 * scl, subY, od, odY: od === null ? null : km ? thirdY : subY, odRight: !km });
    });
    return out;
  }
  // The panel drawn (CVI's places; vjust = 1 for the column key, so its capitals hang from its line).
  function proximityPanelParts(p, panel, keyLabel, footer) {
    const BR = B();
    const parts = [BR.box(p)];
    const hang = pt => 0.358 * pt;
    parts.push(BR.rect(p.u(0), p.v(1), p.u(1) - p.u(0), p.v(1 - panel.hdrH) - p.v(1), PROX.teal));
    parts.push(BR.text('QUERY SITES', p.u(0.5), p.v(1 - panel.hdrH / 2), { pt: BR.textPt(3.4), color: '#ffffff',
      bold: true, anchor: 'middle' }));
    const keyPt = BR.textPt(2.5);
    parts.push(BR.text('Site', p.u(0.05), p.v(panel.colKeyY) + hang(keyPt), { pt: keyPt, color: '#999999' }));
    parts.push(BR.text(keyLabel, p.u(0.96), p.v(panel.colKeyY) + hang(keyPt), { pt: keyPt, color: '#999999',
      anchor: 'end' }));
    for (const r of panel.rows) {
      parts.push(BR.text(r.name, p.u(0.05), p.v(r.nameY), { pt: BR.textPt(r.nameSize), color: '#1f2933', bold: true }));
      parts.push(BR.text(r.count, p.u(0.96), p.v(r.nameY), { pt: BR.textPt(r.countSize), color: '#1c5a83', bold: true,
        anchor: 'end' }));
      if (r.subLeft) parts.push(BR.text(r.subLeft, p.u(0.05), p.v(r.subY), { pt: BR.textPt(r.subSize), color: '#7a8691' }));
      if (r.od) {
        parts.push(BR.text(r.od, p.u(r.odRight ? 0.96 : 0.05), p.v(r.odY), { pt: BR.textPt(r.subSize), color: '#7a8691',
          anchor: r.odRight ? 'end' : 'start' }));
      }
    }
    if (panel.more) {
      parts.push(BR.text(panel.more, p.u(0.5), p.v(panel.footTop + 0.02), { pt: BR.textPt(2.7), color: '#888888',
        italic: true, anchor: 'middle' }));
    }
    if (panel.empty) {
      parts.push(BR.text('No sites', p.u(0.5), p.v((panel.rowsTop + panel.footTop) / 2), { pt: BR.textPt(3.0),
        color: '#888888', anchor: 'middle' }));
    }
    parts.push(BR.line(p.u(0.06), p.v(panel.footTop - 0.005), p.u(0.94), p.v(panel.footTop - 0.005), '#bbbbbb',
      BR.linePt(0.3)));
    footer.forEach(([label, value], i) => {
      const y = p.v(panel.footTop - 0.050 - i * 0.064);
      parts.push(BR.text(label, p.u(0.06), y, { pt: BR.textPt(3.4), color: '#555555' }));
      parts.push(BR.text(value, p.u(0.94), y, { pt: BR.textPt(3.9), color: '#1f2933', bold: true, anchor: 'end' }));
    });
    return parts.join('');
  }

  // CVI's generic ring names when sites use different bands (.generic_zone_labels, SMR 5345-5352).
  function genericZoneLabels(n) {
    if (n < 1) return [];
    if (n === 1) return ['Search zone'];
    if (n === 2) return ['Inner zone', 'Outer zone'];
    if (n === 3) return ['Inner zone', 'Middle zone', 'Outer zone'];
    return ['Zone 1 (inner)'].concat(Array.from({ length: n - 2 }, (_, i) => 'Zone ' + (i + 2)), ['Zone ' + n + ' (outer)']);
  }
  // The MAP KEY's items, top to bottom: { type: 'header' | 'subheader' | 'row', glyph, label }. CVI's labels and
  // order; the ring rows' colors are the colors drawn. rings: { mode ('search' one CVI "Search buffer" row, 'bands' CVI's
  // "Zone a–b km" rows, 'generic' CVI's position names, 'radius' one row per radius drawn), levels, colorOf }.
  function proximityKeyItems(o) {
    const items = [{ type: 'header', label: 'MAP KEY' }, { type: 'row', glyph: { shape: 'bullseye', size: 4.5, stroke: 0.9,
      fill: PROX.site, opacity: 1, border: '#ffffff' }, label: 'Query site' }];
    const ring = (color, label) => items.push({ type: 'row', glyph: { shape: 22, size: 6, stroke: 0.9, fill: color,
      opacity: PROX_RING_OPACITY, border: color }, label });
    const rg = o.rings;
    if (rg.mode === 'bands') {
      rg.levels.forEach((km, i) => ring(rg.colorOf(km), 'Zone ' + (i === 0 ? 0 : rg.levels[i - 1]) + '-' + km + ' km'));
    } else if (rg.mode === 'generic') {
      genericZoneLabels(rg.nZones).forEach((label, i) => ring(PROX_RING[Math.min(i, PROX_RING.length - 1)], label));
    } else if (rg.mode === 'radius') {
      rg.levels.forEach(km => ring(rg.colorOf(km), 'Within ' + S().comma(km) + ' km'));
    } else if (rg.levels.length) {
      ring(rg.colorOf(rg.levels[0]), 'Search buffer');
    }
    if (o.zones) ring(PROX_RING[0], 'Zone (from file)');
    if (o.origins !== null) {
      items.push({ type: 'row', glyph: { shape: 21, size: 4.5, stroke: 0.8, fill: PROX.origin, opacity: 0.9,
        border: '#ffffff' }, label: 'Matched origins: ' + S().comma(o.origins) });
    }
    if (o.dests !== null) {
      items.push({ type: 'row', glyph: { shape: 21, size: 4.5, stroke: 0.8, fill: PROX.dest, opacity: 0.9,
        border: '#ffffff' }, label: 'Matched destinations: ' + S().comma(o.dests) });
    }
    if (o.facilities.length) {
      items.push({ type: 'subheader', label: 'FACILITY LOCATIONS' });
      o.facilities.forEach(l => items.push({ type: 'row', glyph: { shape: 21, size: 4, stroke: 0.8, fill: l.color,
        opacity: 1, border: '#ffffff', mark: l.shape }, label: l.label + ': ' + S().comma(l.n) + ' inside',
      facility: { label: l.label, n: l.n } }));
    }
    return items;
  }
  // A key row's mark as SVG: a circle, the site's bullseye, or another ggplot2 shape.
  const drawGlyph = (g, x, y) => (g.shape === 21 ? B().circle(x, y, g.size, g.stroke, g.fill, g.opacity, g.border, g.mark)
    : g.shape === 'bullseye' ? siteMark(x, y, g.size, g.stroke)
      : shapeMark(g.shape, x, y, g.size, g.stroke, g.fill, g.opacity, g.border));
  // CVI's layout (SMR 5446-5466): items 0.135 apart from 0.95 down, 0.06 more above a subheader, the whole stack
  // fitted into 0.03 to 0.97 when it does not fit; a divider 0.05 above a subheader.
  function proximityKeyEven(items, y, h) {
    const BR = B();
    const lg = BR.panel(BR.LAYOUT.gutterX, y, BR.LAYOUT.gutterW, h, 5);
    const ys = [];
    let at = 0.95;
    items.forEach((it, i) => {
      if (i > 0) at -= 0.135 + (it.type === 'subheader' ? 0.06 : 0);
      ys.push(at);
    });
    const hi = Math.max(...ys);
    const lo = Math.min(...ys);
    if (hi > 0.97 || lo < 0.03) {
      const a = (0.97 - 0.03) / (hi - lo);
      const b = 0.03 - a * lo;
      ys.forEach((v, i) => { ys[i] = a * v + b; });
    }
    const parts = [BR.box(lg)];
    const placed = [];
    items.forEach((it, i) => {
      const yy = lg.v(ys[i]);
      if (it.type !== 'row') {
        if (it.type === 'subheader') {
          parts.push(BR.line(lg.u(0.06), lg.v(ys[i] + 0.05), lg.u(0.94), lg.v(ys[i] + 0.05), '#bbbbbb', BR.linePt(0.3)));
        }
        parts.push(BR.text(it.label, lg.u(0.5), yy, { pt: BR.textPt(3.2), color: '#222222', bold: true, anchor: 'middle' }));
        return;
      }
      parts.push(drawGlyph(it.glyph, lg.u(0.14), yy));
      parts.push(BR.text(it.label, lg.u(0.28), yy, { pt: BR.textPt(3.0), color: '#444444' }));
      placed.push({ label: it.label, y: yy, frac: ys[i] });
    });
    return { parts: parts.join(''), height: h, rows: placed, fits: true };
  }
  // A key label as one line, or as words wrapped onto up to three lines that fit the box beside the mark (so a
  // long facility layer name does not run past the box); a word too long for a line, or a fourth line, is cut
  // with "…".
  function keyLines(label, pt) {
    const BR = B();
    const room = (BR.px(BR.LAYOUT.gutterW) - 10) * (1 - 0.28) - 4;
    if (BR.textWidth(label, pt) <= room) return label;
    const cut = t => {
      const ch = Array.from(t);
      const k = longestFitting(ch.length, j => BR.textWidth(ch.slice(0, j).join('') + '…', pt) <= room);
      return ch.slice(0, k).join('') + '…';
    };
    const lines = [];
    let cur = '';
    for (const word of label.split(/\s+/)) {
      const next = cur ? cur + ' ' + word : word;
      if (BR.textWidth(next, pt) <= room) cur = next;
      else {
        if (cur) lines.push(cur);
        cur = BR.textWidth(word, pt) <= room ? word : cut(word);
      }
    }
    if (cur) lines.push(cur);
    return lines.length > 3 ? lines.slice(0, 2).concat([cut(lines.slice(2).join(' '))]) : lines;
  }
  // The page's layout (the legend column by size): each row as tall as its mark, the box growing up to maxH; the
  // population rows after the key. The facility layers stay in one column while their rows can be drawn at
  // MIN_KEY_SQUEEZE of their height or more, and never closer than their label's lines (2.2: CVI's
  // 0.6 alone let a name on two lines run into the next row; Emergency's key fixed it first); before listing fewer
  // layers, their rows are tried in smaller text (KEY_TEXT_STEPS of the key's text size); else the key lists the
  // layers with the most facilities, as many as fit at the smallest text, and "and N more layers (see the
  // facilities CSV)" (at 25 layers every row was drawn over the next). The rows above the facility layers keep their
  // height and text size. mode: 'one' or 'top'; shown: the facility layers in the key; textScale: their text size.
  // Readable: 13 layers with every row at 0.69 read well, 25 at 0.39 did not; with the rows above them kept whole,
  // 13 layers' facility rows are at 0.64.
  const MIN_KEY_SQUEEZE = 0.6;
  const KEY_TEXT_STEPS = [1, 0.9, 0.8];
  // legendColumn's label lines are labelPt * 1.15 apart; its rows are max(mark, lines * labelPt * 1.2) + 2 points tall.
  const KEY_LINE_STEP = 1.15, KEY_ROW_LINE = 1.2, KEY_ROW_GAP = 2;
  function proximityKeyColumn(items, y, minH, maxH, extra) {
    const BR = B();
    const labelPt = BR.textPt(3.0);
    const markHeight = g => {
      const reach = g.mark ? root.WSDA.facilities.MARK_EXTENT[g.mark] || 1 : 1;
      return g.shape === 21 ? 2 * BR.pointRadius(g.size, g.stroke) * reach : shapeHeight(g.shape, g.size, g.stroke);
    };
    // A row at its text size (pt: the key's, or smaller for the layers when the key is crowded).
    const rowOf = (it, pt) => ({ sample: { height: markHeight(it.glyph), draw: (x, yy) => drawGlyph(it.glyph, x, yy) },
      x: 0.14, labelX: 0.28, label: keyLines(it.label, pt), labelPt: pt });
    const head = it => (it.type === 'header' ? [{ text: it.label, pt: BR.textPt(3.2), color: '#222222', bold: true }]
      // Room above the divider for the row over it (so "Search buffer" does not sit close to the line).
      : [{ gap: 3 }, { rule: { color: '#bbbbbb', width: 0.3, x0: 0.06, x1: 0.94 } },
        { text: it.label, pt: BR.textPt(3.2), color: '#222222', bold: true }]);
    const facilities = items.filter(it => it.facility);
    const lineCount = label => (Array.isArray(label) ? label.length : 1);
    // The least a facility row may be drawn at: its label's lines, as a share of its full height.
    const textShare = (it, pt) => {
      const r = rowOf(it, pt), n = lineCount(r.label);
      return n * KEY_LINE_STEP * pt / (Math.max(r.sample.height, n * KEY_ROW_LINE * pt) + KEY_ROW_GAP);
    };
    const readable = c => c.fits || c.squeeze >= c.least;
    const build = (mode, shownFacilities, scale) => {
      const pt = labelPt * (scale || 1), entries = [];
      items.forEach(it => {
        if (it.type !== 'row') entries.push(...head(it));
        // The rows above the facility layers (query site, buffers, matched ends) keep their height.
        else if (!it.facility) entries.push(Object.assign(rowOf(it, labelPt), { keep: true }));
      });
      shownFacilities.forEach(it => entries.push(rowOf(it, pt)));
      const more = facilities.length - shownFacilities.length;
      if (more > 0) {
        entries.push({ text: 'and ' + S().comma(more) + ' more layer' + (more === 1 ? '' : 's'), pt: 7.5, color: '#666666',
          italic: true }, { text: '(see the facilities CSV)', pt: 7.5, color: '#666666', italic: true });
      }
      entries.push(...(extra || []));
      const col = BR.legendColumn(entries, { bottom: y, minH, maxH: Math.max(minH, maxH) });
      return { parts: col.parts, height: col.height, rows: col.circles, fits: col.fits, box: col.box, mode,
        shown: shownFacilities.map(it => it.facility.label), squeeze: col.squeeze, overlap: col.overlap,
        textScale: scale || 1, least: Math.max(MIN_KEY_SQUEEZE, ...shownFacilities.map(it => textShare(it, pt))) };
    };
    const key = build('one', facilities);
    // With the population rows asked for, a key that does not fit goes back to the caller as it is: the population rows
    // move to a corner of the map first, and the key is laid out again without them.
    if (readable(key) || !facilities.length || (extra && extra.length)) return key;
    for (const scale of KEY_TEXT_STEPS.slice(1)) {
      const smaller = build('one', facilities, scale);
      if (readable(smaller)) return smaller;
    }
    // The most facilities first (the registry's order among equals), as many as fit, at the smallest text.
    const least = KEY_TEXT_STEPS[KEY_TEXT_STEPS.length - 1];
    const ranked = facilities.slice().sort((a, b) => b.facility.n - a.facility.n
      || facilities.indexOf(a) - facilities.indexOf(b));
    const k = longestFitting(ranked.length - 1, j => readable(build('top', ranked.slice(0, j), least)));
    return build('top', ranked.slice(0, k), least);
  }

  // The WA inset with the sites (SMR 5768-5779): every county light gray with white lines, the sites inside its frame as
  // small red triangles, in a white box with a #aab4bb border.
  // at: { x, y } (page fractions), CVI's bottom right by default.
  function proximityInset(counties, sites, at, focus) {
    const BR = B();
    const pos = at || { x: BR.LAYOUT.mapW - INSET.w - INSET.gap, y: INSET.y };
    const p = BR.panel(pos.x, pos.y, INSET.w, INSET.h, 0);
    const pad = 2;
    const fit = BR.fitMercator(BR.bounds(counties), { left: p.left + pad, top: p.top + pad, width: p.width - 2 * pad,
      height: p.height - 2 * pad });
    const parts = [BR.rect(p.left, p.top, p.width, p.height, '#ffffff', '#aab4bb', BR.linePt(0.5))];
    for (const f of counties) {
      const on = focus && focus.color && focus.names.has(f.properties.name);
      parts.push('<path d="' + BR.pathData(f.geometry, fit.project) + '" fill="' + (on ? focus.color : '#e8eaed') +
        '" stroke="#ffffff" stroke-width="' + BR.num(BR.linePt(0.25)) + '"/>');
    }
    // Only the sites inside the inset's Washington frame, as CVI's frame shows them (a site in
    // Oregon would fall below the box, onto the source line).
    const inside = ([x, y]) => x >= p.left && x <= p.left + p.width && y >= p.top && y <= p.top + p.height;
    const marks = sites.map(s => fit.project(s.lon, s.lat)).filter(inside);
    marks.forEach(([x, y]) => parts.push(siteMark(x, y, 1.6, 0.4)));
    return { parts: parts.join(''), marks };
  }

  // input: sites (proximity.prepareSites's, as the run used them), bandsMode, endpoint, summary, siteCvis, siteOrigins,
  // siteDests, matched (the matched rows, with hitOrigin and hitDest), filters { year, quarter, species }, universe
  // (the master's species groups), yearChoices (its years), facilitiesOnly (no CVI match: the page counts the facilities inside), fac
  // (lookup.facilitiesInside's result, or null), labels (Show facility labels), counties (GeoJSON features), date,
  // background, streets, population. Returns { model, parts, style }.
  function proximity(input, styleOpts) {
    const BR = B();
    const PX = root.WSDA.proximity;
    const style = BR.styleOf(styleOpts);
    const L = BR.LAYOUT;
    const sites = input.sites || [];
    const fac = input.fac || null;
    const only = !!input.facilitiesOnly;
    const bg = backgroundOf(input);
    const theme = root.WSDA.tiles ? root.WSDA.tiles.THEMES[bg ? bg.theme : 'standard'] : null;
    const streets = input.background === 'vector:streets' && input.streets ? input.streets : null;

    // The rings and the key's ring rows (SMR 5596-5633). In Bands mode CVI labels "Zone a–b km" when every site has
    // the same bands, else names by position, with each site's radii in the panel.
    const shapes = proximityShapes(sites);
    const ringSites = sites.filter(s => !s.zone);
    const keys = ringSites.map(s => bandKey(s.radii));
    const heterogeneous = !!input.bandsMode && new Set(keys.filter(k => k)).size > 1;
    let ringMode = 'search';
    if (input.bandsMode && heterogeneous) ringMode = 'generic';
    else if (input.bandsMode && shapes.levels.length > 1) ringMode = 'bands';
    else if (!input.bandsMode && shapes.levels.length > 1) ringMode = 'radius';
    // CVI colors a generic row by its position, the rings by their radius among all radii: where those differ, the
    // key lists the radii drawn instead.
    const nZones = Math.max(0, ...ringSites.map(s => s.radii.length));
    if (ringMode === 'generic' && shapes.levels.length !== nZones) ringMode = 'radius';
    const rings = { mode: ringMode, levels: shapes.levels, colorOf: shapes.colorOf, nZones };

    // Strings (SMR 5698-5717).
    const f = input.filters || { year: [], quarter: [], species: [] };
    const nSites = sites.length;
    const sitesWord = nSites + (nSites === 1 ? ' SITE' : ' SITES');
    const spp = f.species && f.species.length ? speciesLabel(f.species, input.universe || []) : 'ALL SPECIES';
    const areaWord = input.area && input.area.title ? ' - ' + input.area.title : '';
    const title = (only ? 'FACILITY PROXIMITY ASSESSMENT - ' + sitesWord
      : 'PREMISE PROXIMITY ASSESSMENT - ' + spp + ' - ' + sitesWord) + areaWord;
    const period = only ? { prefix: 'Data:', value: 'Facility files as loaded' }
      : f.year && f.year.length ? periodParts(f.quarter && f.quarter.length ? f.quarter : ['Q1', 'Q2', 'Q3', 'Q4'], f.year,
        input.yearChoices)
        : { prefix: 'Data:', value: 'All available periods' };
    const endpointLabel = only ? 'Facilities: inside a buffer or zone'
      : input.endpoint === 'origin' ? 'Endpoint: origin within buffer'
        : input.endpoint === 'dest' ? 'Endpoint: destination within buffer'
          : 'Endpoint: origin or destination within buffer';
    const meta = { left: endpointLabel, right: BR.updated(input.date) };

    // Facilities inside: one per layer, place and name (however many buffers hold it), in the registry's order.
    const facLayers = [];
    if (fac) {
      for (const l of fac.layers) {
        const seen = new Set();
        const points = [];
        fac.rows.filter(r => r.layer === l.key).forEach(r => {
          const k = r.lat + ',' + r.lon + ',' + r.name;
          if (seen.has(k)) return;
          seen.add(k);
          points.push({ name: r.name, lat: r.lat, lon: r.lon });
        });
        if (points.length) facLayers.push({ key: l.key, label: l.pngLabel || l.label, color: l.color, shape: l.shape, points });
      }
    }
    const facTotal = facLayers.reduce((n, l) => n + l.points.length, 0);
    const boxes = only ? [
      { label: 'Sites', value: S().comma(nSites), color: PROX.teal },
      { label: 'Facilities', value: S().comma(facTotal), color: PROX.blue },
      { label: 'Layers', value: S().comma(facLayers.length), color: PROX.gold }]
      : [{ label: 'Sites', value: S().comma(nSites), color: PROX.teal },
        { label: 'CVIs', value: S().comma(input.summary.cvis), color: PROX.blue },
        { label: 'Animals', value: S().comma(input.summary.animals), color: PROX.gold }];

    // The panel's rows: each site's county, its own radius (Single), its band list (Bands, when sites differ) or
    // "Zone"; the count of CVIs (or facilities) and the matched origins and destinations.
    const panelRows = sites.map((s, i) => {
      let label = null;
      if (s.zone) label = 'Zone';
      else if (input.bandsMode) label = heterogeneous && bandKey(s.radii) ? bandKey(s.radii) + ' km' : null;
      else if (s.bufferUser !== null && s.bufferUser !== undefined) label = fg(s.bufferUser) + ' km';
      const count = only ? (fac ? fac.counts[i].total : 0) : (input.siteCvis || [])[i] || 0;
      return { name: s.name, count, county: siteCounty(s, input.counties), label,
        orig: only ? null : (input.siteOrigins || [])[i] || 0, dest: only ? null : (input.siteDests || [])[i] || 0 };
    });
    const panel = proximityPanelRows(panelRows, !only, { sitesPanel: style.sitesPanel, width: BR.px(L.gutterW) });
    const footer = only ? [['Facilities inside', S().comma(facTotal)], ['Layers', S().comma(facLayers.length)],
      ['Sites w/ hits', S().comma(fac ? fac.counts.filter(c => c.total > 0).length : 0)]]
      : [['CVIs matched', S().comma(input.summary.cvis)], ['Total animals', S().comma(input.summary.animals)],
        ['Sites w/ hits', S().comma(input.summary.sitesHit)]];

    // The matched endpoints drawn: each row's origin or destination that fell inside a buffer, with usable
    // coordinates (SMR 5651-5690), origins first.
    const ends = (flag, side) => (input.matched || []).filter(r => r[flag]).map(r => ({
      lat: PX.number(r[side + '.Lat']), lon: PX.number(r[side + '.Long']) }))
      .filter(q => q.lat !== null && q.lon !== null && Math.abs(q.lat) <= 90 && Math.abs(q.lon) <= 180);
    const originPts = only ? [] : ends('hitOrigin', 'Origin');
    const destPts = only ? [] : ends('hitDest', 'Dest');
    const showOrigins = !only && (input.endpoint === 'either' || input.endpoint === 'origin') && originPts.length > 0;
    const showDests = !only && (input.endpoint === 'either' || input.endpoint === 'dest') && destPts.length > 0;
    const items = proximityKeyItems({ rings, zones: shapes.zones.length,
      origins: showOrigins ? input.summary.origins : null, dests: showDests ? input.summary.dests : null,
      facilities: facLayers.map(l => ({ label: l.label, color: l.color, shape: l.shape, n: l.points.length })) });

    // ── Drawing ──
    // input.area (a county page): { counties: [names], title } frames the map on those
    // counties as County Focus does (their box, grown to hold the rings, widened 3%), draws only them, cuts Streets and
    // the population layers to them, names them and lights them in the inset; title is added to the page's title.
    const areaNames = input.area && input.area.counties && input.area.counties.length ? new Set(input.area.counties) : null;
    const focusSub = areaNames ? input.counties.filter(c => areaNames.has(c.properties.name)) : null;
    let extent = proximityExtent(shapes, sites);
    if (focusSub && focusSub.length) {
      // The counties' box, grown to hold the rings too (a ring may reach past its county).
      const fb = BR.bounds(focusSub);
      const rb = proximityExtent(shapes, sites);
      const pad = { x: (rb.east - rb.west) / 1.2 * 0.1, y: (rb.north - rb.south) / 1.2 * 0.1 };
      fb.west = Math.min(fb.west, rb.west + pad.x);
      fb.east = Math.max(fb.east, rb.east - pad.x);
      fb.south = Math.min(fb.south, rb.south + pad.y);
      fb.north = Math.max(fb.north, rb.north - pad.y);
      const fx = (fb.east - fb.west) * 0.03;
      const fy = (fb.north - fb.south) * 0.03;
      extent = { west: fb.west - fx, east: fb.east + fx, south: fb.south - fy, north: fb.north + fy };
    }
    const mapH = L.statY - BAND_PAD;
    const corrected = aspectCorrect(extent, L.mapW, mapH);
    const mapPanel = BR.panel(0, 0, L.mapW, mapH, 0);
    const fit = BR.fitMercator(extent, mapPanel);
    const P = (lon, lat) => fit.project(lon, lat);
    const counties = input.counties;
    const land = focusSub && focusSub.length ? focusSub : counties;
    const lw = BR.num(BR.linePt(0.4));
    const mapParts = [];
    // The land: every county, not cut to Washington (CVI keeps the neighbors' context for buffers over a border). Over
    // Streets or a tile background no land fill: the background, then white county lines (SMR 5785-5797). Framed on
    // counties: those counties only, as County Focus (#f5f5f5 under Streets).
    const plain = !streets && !bg;
    if (focusSub) {
      for (const c of land) {
        mapParts.push('<path d="' + BR.pathData(c.geometry, P) + '" fill="' + (streets ? '#f5f5f5' : '#e8e8e8') +
          '" stroke="#8a8a8a" stroke-width="' + BR.num(BR.linePt(0.5)) + '" stroke-linejoin="round"/>');
      }
    }
    for (const c of plain && !focusSub ? counties : []) {
      mapParts.push('<path d="' + BR.pathData(c.geometry, P) + '" fill="#e8e8e8" stroke="#8a8a8a" stroke-width="' + lw +
        '" stroke-linejoin="round"/>');
    }
    const pop = populationOf(input);
    if (pop) mapParts.push(populationLayers(pop, land, P, { extent, clip: focusSub, id: 'prox',
      line: plain || focusSub ? '#8a8a8a' : '#ffffff', width: plain ? 0.4 : 0.5 }));
    if (streets && focusSub) {
      mapParts.push('<clipPath id="prox-area">' + land.map(c => '<path d="' + BR.pathData(c.geometry, P) + '"/>').join('') +
        '</clipPath><g clip-path="url(#prox-area)">' + streetsParts(streets, P, land, extent, 0.05, style) + '</g>');
    } else if (streets) {
      mapParts.push(streetsParts(streets, P, counties, extent, 0.05, style));
    }
    for (const c of focusSub ? land : plain ? [] : counties) {
      mapParts.push('<path d="' + BR.pathData(c.geometry, P) + '" fill="none" stroke="' + (focusSub && land.length > 1
        ? '#d0d0d0' : '#ffffff') + '" stroke-width="' + BR.num(BR.linePt(focusSub ? 0.9 : 0.5)) + '" stroke-linejoin="round"/>');
    }
    // Buffers and zones, outer rings first so an inner ring's outline is on top.
    const ringParts = shapes.bands.slice().sort((a, b) => b.properties.bandKm - a.properties.bandKm).concat(shapes.zones);
    for (const r of ringParts) {
      mapParts.push('<path d="' + BR.pathData(r.geometry, P) + '" fill="' + r.properties.color + '" fill-opacity="' +
        PROX_RING_OPACITY + '" fill-rule="evenodd" stroke="' + r.properties.color + '" stroke-width="' +
        BR.num(BR.linePt(0.7)) + '" stroke-linejoin="round"/>');
    }
    const dot = (q, color) => {
      const [x, y] = P(q.lon, q.lat);
      return { x, y, r: BR.pointRadius(4.6, 0.6), color };
    };
    const drawnOrigins = showOrigins ? originPts.map(q => dot(q, PROX.origin)) : [];
    const drawnDests = showDests ? destPts.map(q => dot(q, PROX.dest)) : [];
    drawnOrigins.concat(drawnDests).forEach(d => mapParts.push(BR.circle(d.x, d.y, 4.6, 0.6, d.color, 0.92, '#ffffff')));
    const facilities = facLayers.map(l => Object.assign({}, l, { points: l.points.map(q => {
      const [x, y] = P(q.lon, q.lat);
      return Object.assign({}, q, { x, y, r: BR.pointRadius(3.0, 0.5) });
    }) }));
    const siteMarks = sites.map(s => {
      const [x, y] = P(s.lon, s.lat);
      return { x, y, r: bullseyeReach(6.0, 1.0), name: s.name === null || s.name === undefined ? '' : String(s.name) };
    });
    siteMarks.forEach(m => mapParts.push(siteMark(m.x, m.y, 6.0, 1.0)));
    // The facilities over the sites: a facility at a site shows as a mark over its bullseye.
    for (const l of facilities) {
      for (const q of l.points) mapParts.push(BR.circle(q.x, q.y, 3.0, 0.5, l.color, 1, '#ffffff', l.shape));
    }

    // Names: the sites' (CVI: bold, 3.4, #222222 on a white halo, centered on the marker; here beside it, clear of
    // the other marks), then the facilities' when "Show facility labels" is ticked, then the population layers'.
    const LB = root.WSDA.labels;
    const area = { x0: mapPanel.left + 2, x1: mapPanel.left + mapPanel.width - 2, y0: mapPanel.top + 2,
      y1: mapPanel.top + mapPanel.height - 2 };
    const sitePt = BR.textPt(3.4);
    const marks = siteMarks.map(m => ({ x: m.x, y: m.y, r: m.r })).concat(drawnOrigins, drawnDests,
      facilities.flatMap(l => l.points.map(q => ({ x: q.x, y: q.y, r: q.r }))));
    const siteNames = siteMarks.filter(m => m.name).map(m => ({ lines: [m.name], x: m.x, y: m.y, r: m.r }));
    const sitePlaces = style.darkNames ? LB.place(siteNames, marks, [], area, sitePt, [])
      : siteNames.map(n => ({ x: n.x, y: n.y, box: nameBox(n.lines[0], n.x, n.y, sitePt), leader: null, free: false }));
    // On Satellite the theme's light names on a dark halo (dark names could not be read).
    const lightNames = !!bg && bg.theme === 'satellite';
    const nameStyle = { pt: sitePt, color: lightNames ? theme.label : '#222222', bold: true, anchor: 'middle',
      halo: { color: bg ? theme.labelFill : '#ffffff', opacity: bg ? theme.labelFillAlpha : 0.78, width: 2 * 0.30 * sitePt } };
    const facilityNames = [];
    if (input.labels) {
      for (const l of facilities) {
        for (const q of l.points) {
          const lines = LB.wrapName(q.name);
          if (lines.length) facilityNames.push({ lines, x: q.x, y: q.y, r: q.r, color: facilityNameColor(l), layer: l.key });
        }
      }
    }
    const namePtF = BR.textPt(2.6);
    const facilityPlaces = LB.place(facilityNames, marks, [], area, namePtF, sitePlaces.map(p => p.box));
    const taken = sitePlaces.map(p => p.box).concat(facilityPlaces.map(p => p.box));
    // Framed on counties: their names, at County Focus's place (the center lifted 5% of the map's height).
    if (focusSub) {
      const lift = (corrected.north - corrected.south) * 0.05;
      const cpt = BR.textPt(3.8);
      for (const c of land) {
        const [lon, lat] = planarCentroid(c.geometry);
        const [x, y] = P(lon, lat + lift);
        mapParts.push(BR.text(c.properties.name, x, y, { pt: cpt, anchor: 'middle', color: lightNames ? theme.label
          : BR.nameColor(style), halo: { color: lightNames ? theme.labelFill : '#ffffff', opacity: lightNames
          ? theme.labelFillAlpha : 0.78, width: 2 * 0.30 * cpt } }));
        taken.push(nameBox(c.properties.name, x, y, cpt));
      }
    }
    const placesInView = focusSub ? land : pop ? counties.filter(c => {
      const b = BR.bounds([c]);
      return b.west < extent.east && b.east > extent.west && b.south < extent.north && b.north > extent.south;
    }) : [];
    const streetNames = streets && focusSub ? streetsNames(streets, P, land, taken, area)
      : streets ? streetsNames(streets, P, [{ geometry: { type: 'Polygon', coordinates: [[
      [corrected.west, corrected.south], [corrected.east, corrected.south], [corrected.east, corrected.north],
      [corrected.west, corrected.north], [corrected.west, corrected.south]]] } }], taken, area) : [];
    streetNames.forEach(n => mapParts.push(n.markup));
    // Names as on the other maps: every city and place in view on a map under 100 km across (County Focus's rule),
    // places of 10,000 people or more on a wider one (WA State's).
    const viewKm = (mapPanel.width / fit.scale) * 180 / Math.PI * 111.320 *
      Math.cos((extent.south + extent.north) / 2 * Math.PI / 180);
    const popNames = pop && !streets ? populationNames(pop, P, area, taken.concat(streetNames.filter(n => n.box)
      .map(n => n.box)), marks, { min: viewKm < PROX_NAMES_KM ? 0 : 10000, counties: placesInView }) : null;
    if (popNames) mapParts.push(popNames.markup);
    facilityNames.forEach((n, i) => mapParts.push(LB.markup(n, facilityPlaces[i], namePtF, n.color)));
    sitePlaces.forEach((at, i) => {
      if (at.leader) mapParts.push(BR.line(at.leader.x1, at.leader.y1, at.leader.x2, at.leader.y2, '#888888', BR.linePt(0.25)));
      mapParts.push(BR.text(siteNames[i].lines[0], at.x, at.y, nameStyle));
    });

    // The inset's corner: the first of the bottom right (CVI's), bottom left, top left and top
    // right that covers no site, matched point, facility or site or facility name; with none clear, the one covering
    // the fewest. CVI's style keeps the bottom right.
    const corners = insetCorners(mapH);
    const insetAt = Object.assign({}, corners[0], { covers: null });
    if (style.insetCorner) {
      const boxes = sitePlaces.map(q => q.box).concat(facilityPlaces.map(q => q.box));
      const hitsAt = (x, y) => {
        const b = insetBox({ x, y });
        return marks.filter(c => touchesBox(c, b)).length + boxes.filter(q => boxesMeet(q, b)).length;
      };
      const scored = corners.map(({ corner, x, y }) => ({ corner, x, y, covers: hitsAt(x, y) }));
      const pick = scored.find(c => c.covers === 0) || scored.slice().sort((a, b) => a.covers - b.covers)[0];
      Object.assign(insetAt, pick, { scores: scored.map(c => ({ corner: c.corner, covers: c.covers })) });
    }
    const insetParts = proximityInset(counties, sites, insetAt, focusSub ? { names: areaNames, color: style.insetFocus } : null);
    const insetAtBox = insetBox(insetAt);
    // The scale bar under the key (SMR 5866-5873), from the page's own projection, as County Focus's.
    const midLat = (extent.south + extent.north) / 2;
    const panelLonDeg = (mapPanel.width / fit.scale) * 180 / Math.PI;
    const mapKm = panelLonDeg * 111.320 * Math.cos(midLat * Math.PI / 180);
    const scale = BR.scaleBarSpec((L.gutterW / L.mapW) * mapKm);
    const SB_H = 0.058;
    const SB_GAP = 0.012;
    const lgY = scale ? 0.045 + SB_H + SB_GAP : 0.045;
    const lgH = scale ? 0.30 - SB_H - SB_GAP : 0.30;
    const panelY = 1 - L.headerH - 0.020 - PROX_PANEL_H;
    const popRows = populationLegend(pop);
    let key;
    let popCorner = null;
    if (style.legendBySize) {
      // Rows at their own spacing (close together while no marks overlap), the box as tall as they
      // need, on the scale bar.
      key = proximityKeyColumn(items, lgY, 0, panelY - 0.008 - lgY, popRows);
      if (popRows.length && !key.fits) {
        key = proximityKeyColumn(items, lgY, 0, panelY - 0.008 - lgY);
        const nameBoxes = sitePlaces.map(p => p.box).concat(facilityPlaces.map(p => p.box),
          popNames ? popNames.placed.map(n => n.box) : [], streetNames.filter(n => n.box).map(n => n.box), [insetAtBox]);
        popCorner = populationCorner(popRows, mapPanel, marks, nameBoxes, 0.03);
      }
    } else {
      key = proximityKeyEven(items, lgY, lgH);
    }
    // A tile background covers the whole map (CVI: mask_poly = NULL), so its mask is the map's own box.
    const corner = (x, y) => fit.unproject(x, y);
    const panelFeature = { geometry: { type: 'Polygon', coordinates: [[corner(mapPanel.left, mapPanel.top),
      corner(mapPanel.left + mapPanel.width, mapPanel.top),
      corner(mapPanel.left + mapPanel.width, mapPanel.top + mapPanel.height),
      corner(mapPanel.left, mapPanel.top + mapPanel.height), corner(mapPanel.left, mapPanel.top)]] } };
    const panelBox = BR.panel(L.gutterX, panelY, L.gutterW, PROX_PANEL_H, 0);

    const source = withPopulation([only ? 'Data: ' + SOURCE_FACILITIES : facilities.length
      ? 'Data: WSDA Animal Services CVI records, ' + SOURCE_FACILITIES : 'Data: WSDA Animal Services CVI records',
    'County boundaries: U.S. Census Bureau'].concat(streets ? [STREETS_NOTE] : []).join(' · '), pop);
    const parts = [
      BR.clipped('prox-map', mapPanel, mapParts.join('')),
      BR.header(title, style),
      BR.metaRow(meta.left, meta.right, style),
      BR.statRow([period], []),
      BR.valueBoxes(boxes, 0.46, L.statY - 0.024, L.mapW - 0.46, 0.044),
      proximityPanelParts(panelBox, panel, only ? 'Facilities' : 'CVIs', footer),
      key.parts,
      insetParts.parts,
      popCorner ? popCorner.parts : '',
      scale ? BR.scaleBar(scale, L.gutterX, 0.045, L.gutterW, SB_H) : '',
      BR.logo(),
      BR.footnote(source, bg ? bg.attribution : null, style, input.synthetic)
    ];
    const model = {
      view: 'proximity', title, titleSize: BR.titleSize(title), meta, stats: { left: [period], right: [] }, boxes,
      facilitiesOnly: only, panel, panelY, panelKey: only ? 'Facilities' : 'CVIs', footer, keyItems: items,
      ringMode: rings.mode, levels: shapes.levels, ringColors: shapes.levels.map(shapes.colorOf), heterogeneous,
      keyY: lgY, keyHeight: key.height, keyRows: key.rows, keyFits: key.fits, keyMode: key.mode || 'even',
      keySqueeze: key.squeeze === undefined ? 1 : key.squeeze,
      keyShown: key.shown || null,
      keyTextScale: key.textScale || 1, keyLeast: key.least || null,   // 2.2: the layers' text size; the least squeeze kept
      extent, corrected, scale, mapKm, mapPanel: { left: mapPanel.left, top: mapPanel.top, width: mapPanel.width,
        height: mapPanel.height },
      sites: siteMarks.map((m, i) => ({ name: m.name, x: m.x, y: m.y, lon: sites[i].lon, lat: sites[i].lat })),
      siteNames: sitePlaces.map((p, i) => ({ name: siteNames[i].lines[0], at: p })),
      origins: originPts.length && showOrigins ? originPts : [], dests: destPts.length && showDests ? destPts : [],
      rings: ringParts.map(r => ({ km: r.properties.bandKm === undefined ? 0 : r.properties.bandKm, zone: !!r.properties.zone,
        color: r.properties.color, site: r.properties.site })),
      facilities: facilities.map(l => ({ key: l.key, label: l.label, color: l.color, shape: l.shape,
        points: l.points.map(q => ({ name: q.name, lon: q.lon, lat: q.lat, x: q.x, y: q.y })) })),
      facilityNames: facilityNames.map((n, i) => ({ lines: n.lines, color: n.color, layer: n.layer, at: facilityPlaces[i] })),
      insetSites: insetParts.marks.length, inset: { corner: insetAt.corner, covers: insetAt.covers, box: insetAtBox,
        scores: insetAt.scores || null }, streetNames: streetNames.map(n => ({ kind: n.kind, name: n.name })),
      area: focusSub ? focusSub.map(c => c.properties.name) : null,
      background: bg || streets ? input.background : 'standard', underlay: underlayOf(input, mapPanel, fit, [panelFeature], 10),
      basemap: bg ? bg.attribution : null, theme: bg ? bg.theme : 'standard',
      source: style.sourceLine ? source : null, fileName: fileNameProximity(input.date)
    };
    if (pop) {
      model.population = { on: pop.on, ramp: pop.ramp, names: popNames ? popNames.placed : [],
        dropped: popNames ? popNames.dropped : [], namesSkipped: !!streets, legend: popCorner ? popCorner.corner : 'legend',
        corner: popCorner ? popCorner.box : null, cornerFallback: !!(popCorner && popCorner.fallback) };
    }
    return { model, parts, style };
  }
  // CVI's file name: premise_proximity_YYYY-MM-DD.png (mod_premise_lookup.R 1244-1247), the local date.
  function fileNameProximity(date) {
    const d = date || new Date();
    const two = n => String(n).padStart(2, '0');
    return 'premise_proximity_' + d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + '.png';
  }

  root.CVIWA = root.CVIWA || {};
  root.CVIWA.brandedmaps = {
    longestFitting,   // for the unit suite's check of the halving search
    wa, speciesLabel, directionLabel, periodParts, resolveTitle, countyLegendSpec, legendBreaks, intervalLabels,
    top3, expand, WA_LIMITS, FIXED_TIERS, placeLabels, sizingLine, SOURCE_COUNTIES,
    flow, flowScale, stateLabelPlaces, yearLabel, TIER_LW, TIER_LABELS, FLOW_LIMITS, SOURCE_STATES,
    focus, groupPremises, groupDistance, aspectCorrect, planarCentroid, focusTop, fileNameFocus, BAND_PAD,
    waLayout, focusLayout, fitAboveBand,   // shared with the WA State and County Focus GIF (timeseries.js)
    INSET, insetCorners, insetBox, landShare, focusInsetCorner,   // the WA inset's corner (Premise Lookup, County Focus)
    FACILITY_NAME_COLORS, facilityNameColor, backgroundOf, underlayOf, MIN_PT,
    populationOf, populationLayers, populationNames, populationLegend, withPopulation, nameBox,
    proximity, siteCounty, proximityPanelRows, proximityKeyItems, proximityExtent, proximityShapes, genericZoneLabels, shapeMark,
    triangleTop, bullseyeReach, siteMark, fileNameProximity, PROX_RING, PROX_RING_OPACITY, PROX, PROX_NAMES_KM, PANEL_ROWS
  };
})(typeof window !== 'undefined' ? window : globalThis);
