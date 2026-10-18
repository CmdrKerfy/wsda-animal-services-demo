/* National Flow map: port of CVI shiny/R/map_helpers.R build_flow_line_data() and of CVI's map module (mod_maps.R:
 * the Flow line data, the live Flow map's colors, widths, tooltips and drawing order, its legend, value boxes, summary
 * strip, Browse periods and Reset All), with geosphere::gcIntermediate() for the arcs. Pure functions; the page draws
 * what they return. Deliberate differences: with "Combine species" the legend swatch
 * takes the lines' color (CVI's is gray); "Unique CVIs" is grayed without a CVI column; Reset All also turns Browse
 * off. */
(function (root) {
  'use strict';
  const S = () => root.CVIWA.scaling;
  const P = () => root.CVIWA.palettes;
  const SUM = () => root.CVIWA.summary;
  const cmpC = (a, b) => (a < b ? -1 : a > b ? 1 : 0);   // dplyr group_by: C locale
  const collate = (a, b) => a.localeCompare(b, 'en');
  const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];

  // Washington's fixed anchor (build_flow_line_data), not the WA row of the centers file.
  const WA_ANCHOR = [-120.5, 47.5];
  const ARC_POINTS = 200;
  // Opening view of CVI's Flow map (mapgl's default globe projection, as CVI), and its state-line and state-label
  // styles.
  const VIEW = { center: [-96, 39.5], zoom: 3.6, projection: 'globe' };
  const STATE_LINES = { color: '#888888', width: 0.6, opacity: 0.6 };
  const STATE_LABELS = { size: 11, color: '#555555', halo: '#ffffff', haloWidth: 1.5, skip: ['AK', 'HI'] };
  // CVI's Flow controls: values as its inputs send them, labels as shown.
  const DIRECTIONS = [{ id: 'inbound', label: 'Inbound' }, { id: 'outbound', label: 'Outbound' },
    { id: 'combined', label: 'Combined' }];
  const OPACITIES = [{ value: '0.2', label: 'Very light (20%)' }, { value: '0.4', label: 'Light (40%)' },
    { value: '0.6', label: 'Medium (60%)' }, { value: '0.8', label: 'Heavy (80%)' },
    { value: '1.0', label: 'Solid (100%)' }];
  const MULTIPLIERS = [{ value: '0.15', label: 'Hairline' }, { value: '0.25', label: 'Ultra Thin' },
    { value: '0.40', label: 'Very Thin' }, { value: '0.65', label: 'Thin' }, { value: '1.0', label: 'Default' },
    { value: '1.5', label: 'Bold' }, { value: '2.0', label: 'Extra Bold' }, { value: '3.0', label: 'Maximum' }];

  // ── geosphere 1.6.8 gcIntermediate(p1, p2, n, addStartEnd = TRUE), one pair of points ──────────────────────────
  // Same arithmetic in the same order (.interm, distCosine with r = 1, antipodal, .pointsToMatrix's range checks), so
  // every vertex equals geosphere's up to the last bits of the platform's sin/cos/atan2. Throws where geosphere stops.
  function pointsCheck(p) {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) throw new Error('point not finite');
    if (p[0] < -360) throw new Error('longitude < -360');
    if (p[0] > 360) throw new Error('longitude > 360');
    if (p[1] < -90) throw new Error('latitude < -90');
    if (p[1] > 90) throw new Error('latitude > 90');
  }
  const rMod = (x, m) => x - Math.floor(x / m) * m;          // R's %% for doubles
  const normalizeLonDeg = x => rMod(x + 180, 360) - 180;
  // Whether two points are on opposite sides of the earth (geosphere's .antipodal), within tol.
  function antipodal(p1, p2, tol) {
    tol = tol === undefined ? 1e-9 : tol;
    const l1 = normalizeLonDeg(p1[0]), l3 = normalizeLonDeg(p2[0]);
    const diflon = Math.abs(l1 - l3), diflat = Math.abs(p1[1] + p2[1]);
    return diflat < tol && (Math.cos(p1[1] * Math.PI / 180) * Math.abs(rMod(diflon, 360) - 180)) < tol;
  }
  // base::all.equal.numeric on two numeric pairs (tolerance sqrt(.Machine$double.eps), countEQ = FALSE): components that
  // are exactly equal are left out; the mean absolute difference of the others, relative to their mean absolute value
  // when that exceeds the tolerance.
  function allEqual(a, b) {
    const tol = Math.sqrt(Number.EPSILON), idx = [0, 1].filter(i => a[i] !== b[i]);
    if (!idx.length) return true;
    const n = idx.length;
    let xy = idx.reduce((t, i) => t + Math.abs(a[i] - b[i]), 0) / n;
    const xn = idx.reduce((t, i) => t + Math.abs(a[i]), 0) / n;
    if (Number.isFinite(xn) && xn > tol) xy = xy / xn;
    return xy <= tol;
  }
  // The great-circle distance between two points on a sphere of radius 1 (geosphere's distCosine, law of cosines).
  function distCosine1(p1, p2) {
    const eps = Math.sqrt(Number.EPSILON);
    if (Math.abs(p1[0] - p2[0]) < eps && Math.abs(p1[1] - p2[1]) < eps) return 0;
    const a = p1[0] * Math.PI / 180, b = p1[1] * Math.PI / 180, c = p2[0] * Math.PI / 180, d = p2[1] * Math.PI / 180;
    return Math.acos(Math.sin(b) * Math.sin(d) + Math.cos(b) * Math.cos(d) * Math.cos(a - c)) * 1;
  }
  // The n points evenly spaced along the great circle between p1 and p2, ends left out (geosphere's .interm).
  function interm(p1, p2, n) {
    const toRad = Math.PI / 180;
    if (antipodal(p1, p2)) return [[Infinity, Infinity]];
    if (allEqual(p1, p2)) return [[p1[0], p1[1]]];
    const d = distCosine1(p1, p2);
    const lon1 = p1[0] * toRad, lat1 = p1[1] * toRad, lon2 = p2[0] * toRad, lat2 = p2[1] * toRad;
    n = Math.max(S().rRound(n), 1);
    const out = [];
    for (let i = 1; i <= n; i++) {
      const f = i / (n + 1);
      const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
      const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
      const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
      const z = A * Math.sin(lat1) + B * Math.sin(lat2);
      const lat = Math.atan2(z, Math.sqrt(x * x + y * y)), lon = Math.atan2(y, x);
      out.push([lon / toRad, lat / toRad]);
    }
    return out;
  }
  // The arc's points from p1 to p2, with p1 and p2 added at the ends when addStartEnd is true.
  function gcIntermediate(p1, p2, n, addStartEnd) {
    pointsCheck(p1); pointsCheck(p2);
    const x = interm(p1, p2, n);
    return addStartEnd ? [[p1[0], p1[1]]].concat(x, [[p2[0], p2[1]]]) : x;
  }
  // build_flow_line_data: the arc from Washington's anchor, a straight line when geosphere fails or gives one point.
  function arc(lon, lat) {
    const to = [lon, lat];
    let a = null;
    try { a = gcIntermediate(WA_ANCHOR, to, ARC_POINTS, true); } catch (e) { a = null; }
    if (a === null || a.length < 2) a = [WA_ANCHOR.slice(), to];
    return a;
  }

  // ── State centers ───────────────────────────────────────────────────────────────────────────────────────────
  // The bundled centers (geo/state-centers.js) as a lookup by code, in file order.
  function centers(data) {
    const m = new Map();
    (data && data.centers || []).forEach(c => { if (!m.has(c.state)) m.set(c.state, { lat: c.lat, lon: c.lon }); });
    return m;
  }
  // Where the state abbreviations are shown: every center but Alaska's and Hawaii's, in file order.
  function stateLabels(data) {
    return (data && data.centers || []).filter(c => STATE_LABELS.skip.indexOf(c.state) < 0).map(c => ({ abbr: c.state,
      lon: c.lon, lat: c.lat }));
  }
  // Each outline's area in km2 (geo/us-states.js; rings on a sphere of radius 6,371 km, outer rings minus holes), by
  // code. Where two labels would overlap the larger state's is shown (a deliberate difference; CVI's
  // map keeps whichever comes first in its data).
  function stateAreas(data) {
    const R = 6371, rad = Math.PI / 180, out = new Map();
    const ring = r => {   // spherical excess of a closed lon/lat ring (absolute value)
      let a = 0;
      for (let i = 0; i < r.length - 1; i++) a += (r[i + 1][0] - r[i][0]) * rad * (2 + Math.sin(r[i][1] * rad)
        + Math.sin(r[i + 1][1] * rad));
      return Math.abs(a * R * R / 2);
    };
    (data && data.states && data.states.features || []).forEach(f => {
      const g = f.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      out.set(f.properties.code, polys.reduce((s, p) => s + ring(p[0]) - p.slice(1).reduce((h, r) => h + ring(r), 0), 0));
    });
    return out;
  }

  // ── Rows ────────────────────────────────────────────────────────────────────────────────────────────────────
  // Species group, year and quarter, then "Refine by species" when the table has a Species column, then f.keep
  // (optional: the chart filters of crossfilter.js).
  function filterRows(loaded, f) {
    const sp = new Set(f.species), yr = new Set(f.years.map(Number)), qt = new Set(f.quarters);
    let df = loaded.rows.filter(r => r['Species.Group'] !== null && sp.has(r['Species.Group']) && r['Reporting.Year'] !== null
      && yr.has(r['Reporting.Year']) && r['Reporting.Quarter'] !== null && qt.has(r['Reporting.Quarter']));
    if (f.speciesSub && f.speciesSub.length && loaded.hasSpecies) {
      const raw = new Set(f.speciesSub); df = df.filter(r => r.Species !== null && r.Species !== undefined && raw.has(r.Species));
    }
    if (f.keep) df = df.filter(f.keep);
    return df;
  }
  // The corridor, from the states only (the Movement column is not used), exact text: Inbound = destination "WA" and
  // origin not "WA" (partner = origin); Outbound the other way round; Combined = the Inbound rows, then the Outbound
  // rows. A missing state never matches.
  const isIn = r => r['Dest.State'] === 'WA' && r['Origin.State'] !== null && r['Origin.State'] !== 'WA';
  const isOut = r => r['Origin.State'] === 'WA' && r['Dest.State'] !== null && r['Dest.State'] !== 'WA';
  function corridor(df, direction) {
    const inb = () => df.filter(isIn).map(r => ({ r, partner: r['Origin.State'] }));
    const outb = () => df.filter(isOut).map(r => ({ r, partner: r['Dest.State'] }));
    if (direction === 'inbound') return inb();
    if (direction === 'outbound') return outb();
    return inb().concat(outb());
  }

  // ── Lines (CVI's flow_line_data) ────────────────────────────────────────────────────────────────────────────
  // f: direction, species, speciesSub, years, quarters, combine, scaling, nBins. Null when CVI draws nothing (an empty
  // picker, no matching row, or no partner with a center). Rows in CVI's order (state, then species group, C locale),
  // each with its total, raw width (before the multiplier), species breakdown (Combine species only) and arc.
  function lines(loaded, f, ctr) {
    if (!loaded || !ctr || !ctr.size) return null;
    if (!f.species.length || !f.quarters.length || !f.years.length || !f.direction) return null;
    const c = corridor(filterRows(loaded, f), f.direction);
    if (!c.length) return null;
    const groups = new Map();
    c.forEach(({ r, partner }) => {
      const g = f.combine ? 'All Species' : r['Species.Group'];
      const k = partner + '\u0000' + g;
      if (!groups.has(k)) groups.set(k, { state: partner, species_group: g, total_animals: 0 });
      const a = r['Total.Animals'];
      if (a !== null && !Number.isNaN(a)) groups.get(k).total_animals += a;
    });
    let agg = [...groups.values()].sort((a, b) => cmpC(a.state, b.state) || cmpC(a.species_group, b.species_group));
    let bd = null;
    if (f.combine) {
      const useRaw = f.species.length === 1 && loaded.hasSpecies;
      bd = root.CVIWA.aggregate.speciesBreakdownByKey(c.map(x => x.partner),
        c.map(x => (useRaw ? (x.r.Species === undefined ? null : x.r.Species) : x.r['Species.Group'])),
        c.map(x => x.r['Total.Animals']));
    }
    agg.forEach(a => { a.species_breakdown = bd ? (bd.get(a.state) || '') : ''; });
    agg = agg.filter(a => ctr.has(a.state)).map(a => Object.assign(a, { dest_lat: ctr.get(a.state).lat, dest_lon: ctr.get(a.state).lon }));
    if (!agg.length) return null;
    const w = S().computeRadius(agg.map(a => a.total_animals), f.scaling, 1, 12, f.nBins);
    agg.forEach((a, i) => { a.line_width_px = w[i]; a.coords = arc(a.dest_lon, a.dest_lat); });
    return agg;
  }

  // CVI's .flow_single_color(): the palette's first color ("#555555" for a palette it does not know).
  // Palettes and their species looked up as own entries only (a group named like an object property, e.g. "constructor",
  // is a group no palette names: #999999, as CVI's named-vector lookup gives NA).
  const own = (o, k) => o !== null && o !== undefined && Object.prototype.hasOwnProperty.call(o, k);
  function singleColor(paletteName) {
    const p = own(P().SPECIES_PALETTES, paletteName) ? P().SPECIES_PALETTES[paletteName] : null;
    if (!p) return '#555555';
    return p[Object.keys(p)[0]];
  }
  const paletteOf = name => (own(P().SPECIES_PALETTES, name) ? P().SPECIES_PALETTES[name] : P().SPECIES_PALETTES['WSDA Default']);
  const lineColor = (paletteName, group) => { const p = paletteOf(paletteName); return own(p, group) ? p[group] : '#999999'; };

  // What the live Flow map draws (CVI's flow_map render): each line's color, width times the multiplier and tooltip,
  // widest first (ties keep CVI's order). f adds palette, multiplier and opacity. Opacity and hover opacity for the layer.
  function draw(ls, f) {
    if (!ls || !ls.length) return null;
    const mult = Number(f.multiplier), fmt = S().formatR;
    const d = ls.map(a => ({ state: a.state, species_group: a.species_group, total_animals: a.total_animals, coords: a.coords,
      color: f.combine ? singleColor(f.palette) : lineColor(f.palette, a.species_group), width: a.line_width_px * mult }));
    if (f.combine) {
      const t = fmt(d.map(a => a.total_animals));
      d.forEach((a, i) => { a.tooltip = '<strong>' + a.state + '</strong><br/>Total: ' + t[i] + ' animals' + ls[i].species_breakdown; });
    } else if (f.direction === 'combined') {
      const byState = new Map();
      d.forEach(a => { if (!byState.has(a.state)) byState.set(a.state, []); byState.get(a.state).push(a); });
      const detail = new Map(), total = new Map();
      for (const [st, rows] of byState) {
        const t = fmt(rows.map(a => a.total_animals));
        detail.set(st, rows.map((a, i) => a.species_group + ': ' + t[i]).join('<br/>'));
        total.set(st, rows.reduce((s, a) => (a.total_animals === null || Number.isNaN(a.total_animals)
          ? s : s + a.total_animals), 0));
      }
      const tt = fmt(d.map(a => total.get(a.state)));
      d.forEach((a, i) => { a.tooltip = '<strong>' + a.state + '</strong><br/>Total: ' + tt[i] + ' animals<br/>'
        + detail.get(a.state); });
    } else {
      const t = fmt(d.map(a => a.total_animals));
      d.forEach((a, i) => { a.tooltip = '<strong>' + a.state + '</strong> (' + a.species_group + ')<br/>' + t[i] + ' animals'; });
    }
    const order = d.map((a, i) => i).sort((i, j) => (d[j].width - d[i].width) || (i - j));
    const op = Number(f.opacity);
    return { lines: order.map(i => d[i]), opacity: op, hoverOpacity: Math.min(1.0, op + 0.30) };
  }

  // The Flow legend (CVI's map_legend_ui, Flow branch): null = "No data loaded". Species: one swatch per species group
  // in CVI's line order (the palette's color, #999999 for a group it does not name; with Combine species the lines'
  // color, a deliberate difference). Line width: the legend tiers on the lines' totals, each bar max(1, round(width x
  // multiplier)) px high, labeled with the rounded value and thousands separators.
  function legend(ls, f) {
    if (!ls || !ls.length) return null;
    const groups = [];
    ls.forEach(a => { if (groups.indexOf(a.species_group) < 0) groups.push(a.species_group); });
    const species = groups.map(g => ({ label: g, color: f.combine ? singleColor(f.palette) : lineColor(f.palette, g) }));
    const tiers = S().legendTiers(ls.map(a => a.total_animals), f.scaling, f.nBins, 1, 12);
    const mult = Number(f.multiplier);
    const widths = tiers ? tiers.values.map((v, i) => ({ px: Math.max(1, S().rRound(tiers.radii[i] * mult)), label: S().comma(v) })) : [];
    return { species, widths, widthHeader: widths.length > 0 };   // "Line width" heading only with bars
  }

  // ── Value boxes and strip ───────────────────────────────────────────────────────────────────────────────────
  // The rows the boxes count (CVI's current_map_data, Flow branch): species group, year and quarter, the corridor (a
  // missing state never matches), then "Refine by species". Null when nothing matches.
  function mapRows(loaded, f) {
    if (!loaded) return null;
    const sp = new Set(f.species), yr = new Set(f.years.map(Number)), qt = new Set(f.quarters);
    const dir = f.direction || 'inbound';   // CVI: input$flow_direction %||% "inbound"
    const keep = dir === 'inbound' ? isIn : dir === 'outbound' ? isOut : (r => isIn(r) || isOut(r));
    let sub = loaded.rows.filter(r => sp.has(r['Species.Group']) && yr.has(r['Reporting.Year']) && qt.has(r['Reporting.Quarter'])
      && r['Origin.State'] !== null && r['Dest.State'] !== null && keep(r));
    if (!sub.length) return null;
    if (f.speciesSub && f.speciesSub.length && loaded.hasSpecies) {
      const raw = new Set(f.speciesSub);
      sub = sub.filter(r => raw.has(r.Species));
      if (!sub.length) return null;
    }
    if (f.keep) {
      sub = sub.filter(f.keep);
      if (!sub.length) return null;
    }
    return sub;
  }
  // The four numbers (CVI's current_map_summary for the Flow map): total animals (merged by the WA map's rule: the
  // corridor compares states exactly, but the merge reads "wa" as Washington, so a "wa"-to-WA row is a corridor row
  // whose two loader copies merge; the "merge only loader copies" difference can therefore reach Flow), unique CVIs
  // (null without a CVI column), the partner states of those rows that have a center, top species. Null when no row
  // matches.
  function summary(loaded, f, ctr) {
    const sub = mapRows(loaded, f);
    if (!sub) return null;
    const total = SUM().dedupeVolume(sub).reduce((t, r) => (r['Total.Animals'] === null ? t : t + r['Total.Animals']), 0);
    const states = new Set();
    sub.forEach(r => { [r['Origin.State'], r['Dest.State']].forEach(s => { if (s !== null && s !== 'WA' && ctr && ctr.has(s)) states.add(s); }); });
    return { total_animals: total, n_cvis: loaded.header.indexOf('CVI') >= 0 ? SUM().uniqueCvis(sub) : null,
      n_states: states.size, top_species: SUM().topSpecies(sub, f.species.length === 1 && loaded.hasSpecies) };
  }
  // The boxes: the WA map's boxes with "States" (icon globe-americas) in place of "WA counties". The WA map's help text
  // on Total animals describes the WA map's two numbers, so it is not shown here.
  function valueBoxes(s) {
    if (!s) return SUM().valueBoxes(null);
    const vb = SUM().valueBoxes(Object.assign({}, s, { n_counties: s.n_states }));
    const text = String(s.n_states);
    vb.metrics[0] = Object.assign({}, vb.metrics[0], { help: null });
    vb.metrics[2] = { label: 'States', text, icon: 'globe-americas', accent: '#5d6873', zero: text === '0' };
    return vb;
  }
  // The strip (CVI's filter_summary_strip, Flow branch): Period, Animals (the lines' total), States (with a line).
  function strip(f, ls) {
    if (!ls || !ls.length) return { state: 'message', lines: ['No records match current filters.'] };
    const sum = ls.reduce((t, a) => (a.total_animals === null || Number.isNaN(a.total_animals) ? t : t + a.total_animals), 0);
    return { state: 'summary', items: [
      { label: 'Period: ', text: SUM().periodLabel(f.years, f.quarters) },
      { label: 'Animals: ', text: S().formatR([sum])[0] },
      { label: 'States: ', text: String(new Set(ls.map(a => a.state)).size) }] };
  }

  // ── Browse over time ────────────────────────────────────────────────────────────────────────────────────────
  // The Flow slider's periods: those of rows where exactly one of the two states is "WA" (both present), whatever the
  // filters; each falls back to the file's own periods when there are none (CVI's .domain()).
  function domains(loaded) {
    const all = root.CVIWA.periods.domains(loaded);
    if (!loaded) return all;
    const fx = { rows: loaded.rows.filter(r => r['Origin.State'] !== null && r['Dest.State'] !== null
      && ((r['Origin.State'] === 'WA') !== (r['Dest.State'] === 'WA'))) };
    const q = root.CVIWA.periods.domains(Object.assign({}, loaded, fx, { yearChoices: [] })).quarter;
    const y = [...new Set(fx.rows.map(r => r['Reporting.Year']).filter(v => v !== null))].sort((a, b) => a - b).map(String);
    return { quarter: q.length ? q : all.quarter, year: y.length ? y : all.year };
  }

  // ── Defaults and Reset All ──────────────────────────────────────────────────────────────────────────────────
  // CVI's Flow defaults (its inputs on load and its reset_filters observer): Inbound, every species group and year, all
  // quarters, no refined species, Combine species on, Natural breaks, 5 bins, 80% opacity, Very Thin, "Single — WSDA
  // Blue", state labels and lines on. Reset All also turns Browse off (by design); the slider position, step
  // and speed stay (as on the WA map).
  function resetDefaults(loaded) {
    return { direction: 'inbound', species: loaded ? loaded.speciesChoices.slice() : [], speciesSub: [],
      years: loaded ? loaded.yearChoices.slice() : [], quarters: QUARTERS.slice(), combine: true, scaling: 'natural', nBins: 5,
      opacity: '0.8', multiplier: '0.40', palette: 'Single — WSDA Blue', labels: true, lines: true, browse: false };
  }

  root.CVIWA = root.CVIWA || {};
  root.CVIWA.flow = { WA_ANCHOR, ARC_POINTS, VIEW, STATE_LINES, STATE_LABELS, DIRECTIONS, OPACITIES, MULTIPLIERS,
    gcIntermediate, arc, centers, stateLabels, stateAreas, filterRows, corridor, lines, singleColor, lineColor, draw, legend,
    mapRows, summary, valueBoxes, strip, domains, resetDefaults };
})(typeof window !== 'undefined' ? window : globalThis);
