#!/usr/bin/env node
'use strict';
// S9 unit tests: the branded map pages (site/shared/brand.js, site/shared/branded.js, site/cvi/app/brandedmaps.js)
// against CVI's own branded renderers, run by tests/oracle/s9_branded_oracle.R on synthetic data
// (local-test-artifacts/s9/oracle_s9_<fixture>.json).
//
// The WA State map, for every fixture and scenario of the reference:
//   - the circles the page draws (aggregate.build) against the rows CVI's renderer was given: county, direction,
//     position, animals and pixel radius;
//   - the page: size and dpi, file name, the header (title, its size step, "ANIMAL SERVICES", the bar's color),
//     the logo's box, the meta row, the stat row (period, Counties, Total Animals), the Top 3 box (sections,
//     header colors, rows, totals, box position), the legend (kind, titles, tier labels, circle sizes, colors, box
//     position and height), the map's circles (size, border, fill, opacity) and which counties are named;
//   - deliberate differences checked as such: Web Mercator (the map's extent is CVI's limits widened by 5%), the
//     agency name (on by default and off in CVI's style), the darker Last Updated gray, the S1.1 Combined color (the
//     palette's first color, where CVI draws #245566), legend circles spaced by size, dark names, names off circles
//     when a free place exists, the sizing line and the source line.
// Facilities on the Infrastructure dashboard (the Full tier, statewide synthetic facility layers from
// tests/synthetic/make_s9_facilities.js): the layers the dashboard's filters keep against the layers CVI's renderer
// was given, the CVI activity circles, CVI's county anchors, and the page against CVI's: size, file name, title,
// rows, the tile grid, the map's region and extent, the Density fills and class colors, the Locations circles
// (place, size, border, color, drawing order), the county names (which, and CVI's place in CVI's style), the name
// markers, the legend (every text, sample, color and place in CVI's style), the Report caption; then the agency name,
// the grays, the legend spacing, dark names and the source line in the page's style, and the one-class Density map
// where CVI stops.
// The National Flow time-series GIF (site/cvi/app/timeseries.js, site/shared/gif.js), for every fixture and
// GIF scenario of the reference: the frame list (CVI's progress calls, skipped periods included), the frames drawn,
// each frame's rows, title, meta and stat rows and Top 3 States against CVI's frame page, the frame size, delay and
// file name; then the deliberate differences (the view's settings: opacity, palette, state lines, the master's
// species for "ALL SPECIES"; one width scale and legend over all frames, worked out here; the period strip; the last
// frame held 2.4 s), each beside CVI's. The GIF writer is checked by a decoder written here from
// the GIF89a specification: header, loop, delays, sizes, palettes and every pixel.
// The WA State and County Focus GIF: CVI makes none, so each fixture's WA State and County Focus scenarios of the
// reference are drawn as GIFs (by quarter and by year) and checked against the page's own PNG code and the page's
// rules: the frame list; with CVI_OPTIONS each frame is exactly the branded PNG of its period; with the rules on, one
// scale (equal totals equal sizes in every frame, sizes growing with totals, the largest total the largest size, one
// legend; County Focus's one grouping distance), names held still (one place per name in every frame, a frame naming
// only its own counties), the strip's band clear of the map; the file names.
// Then the logo's bytes against CVI's file and the frame's text widths against chartsvg.js.
//
// Usage (repository root): node tests/node/run_f1_unit_tests.js, Rscript tests/oracle/s9_branded_oracle.R,
// then node tests/node/run_s9_unit_tests.js [fixture ...]   (Node >= 22, no packages)

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const SITE = path.join(ROOT, 'site');
const APP = path.join(SITE, 'cvi', 'app');
const ORACLE = path.join(ROOT, 'local-test-artifacts', 's9');
const CVI_DIR = process.env.CVI_TRACEABILITY_DIR || path.join(path.dirname(ROOT), 'CVI_Traceability');

const sandbox = { window: {}, console, TextEncoder, TextDecoder };
vm.createContext(sandbox);
for (const f of ['csv.js', 'master.js', 'scaling.js', 'palettes.js', 'aggregate.js', 'chartsvg.js', 'periods.js',
  'summary.js', 'flow.js', 'focus.js']) {
  vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sandbox, { filename: f });
}
for (const f of ['zip.js', 'brand.js', 'branded.js', 'tiles.js', 'labels.js', 'facilities.js', 'gif.js']) {
  vm.runInContext(fs.readFileSync(path.join(SITE, 'shared', f), 'utf8'), sandbox, { filename: f });
}
vm.runInContext(fs.readFileSync(path.join(APP, 'brandedmaps.js'), 'utf8'), sandbox, { filename: 'brandedmaps.js' });
vm.runInContext(fs.readFileSync(path.join(APP, 'timeseries.js'), 'utf8'), sandbox, { filename: 'timeseries.js' });
vm.runInContext(fs.readFileSync(path.join(SITE, 'infrastructure', 'branded.js'), 'utf8'), sandbox,
  { filename: 'infrastructure/branded.js' });
for (const f of ['wa-counties.js', 'us-states.js', 'state-centers.js']) {
  vm.runInContext(fs.readFileSync(path.join(SITE, 'geo', f), 'utf8'), sandbox);
}
const W = sandbox.window.CVIWA;
const BR = sandbox.window.WSDA.branded;
const BRAND = sandbox.window.WSDA.brand;
const BM = W.brandedmaps;
const IB = sandbox.window.WSDA.infrastructureBranded;
const COUNTIES = sandbox.window.CVIWA_GEO.counties.features;
const STATES = sandbox.window.WSDA_US_STATES.states.features;
const CENTERS = W.flow.centers(sandbox.window.WSDA_STATE_CENTERS);
const TS = W.timeseries;
const GIF = sandbox.window.WSDA.gif;

// ── Test bookkeeping ───────────────────────────────────────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;
const failures = [];
const counts = {};
function check(ok, name, detail) {
  const part = name.split(':')[0];
  counts[part] = (counts[part] || 0) + 1;
  if (ok) {
    pass++;
  } else {
    fail++;
    failures.push(name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail).slice(0, 600)));
  }
}
const near = (a, b, tol) => typeof a === 'number' && typeof b === 'number' &&
  Math.abs(a - b) <= (tol || 1e-9) * Math.max(1, Math.abs(b));
const list = x => (x === null || x === undefined ? [] : Array.isArray(x) ? x : [x]);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// A color with its alpha written by R ("#1C9CD999") as { hex, alpha }.
function rColor(c) {
  const s = String(c);
  if (s === 'white') return { hex: '#ffffff', alpha: 1 };
  return { hex: s.slice(0, 7).toLowerCase(), alpha: s.length === 9 ? parseInt(s.slice(7), 16) / 255 : 1 };
}

// ── Reading the reference's records ────────────────────────────────────────────────────────────────────────────
const plots = rec => rec.page.filter(e => e.kind === 'plot');
const labelsOf = rec => rec.page.filter(e => e.kind === 'label');
const texts = plot => plot.plot.layers.filter(l => l.geom === 'GeomText').map(l => l.data[0]);
const pointsOf = plot => plot.plot.layers.filter(l => l.geom === 'GeomPoint').map(l => l.data[0]);

// The page's filters for a scenario (CVI's input names in the page's terms).
function pageFilters(inp) {
  return {
    species: list(inp.county_species), years: list(inp.county_year).map(Number), quarters: list(inp.county_quarter),
    direction: list(inp.county_direction), rawSpecies: list(inp.county_species_sub), mode: inp.county_mode,
    scaling: inp.county_scaling, nBins: Number(inp.county_n_bins)
  };
}

// ── One WA State scenario ──────────────────────────────────────────────────────────────────────────────────────
function checkWa(fx, name, rec, master, universe) {
  const tag = 'wa ' + fx + ' ' + name;
  if (!rec.render) {
    check(false, 'render: ' + tag + ' CVI drew a page', rec.notes);
    return;
  }
  const f = pageFilters(rec.inputs);
  const rows = W.aggregate.build(master.rows, Object.assign({}, f, { hasSpecies: master.hasSpecies }));
  const cd = rec.render.county_df;

  // The rows the page draws are the rows CVI's renderer was given.
  check(rows.length === cd.length, 'rows: ' + tag + ' count', [rows.length, cd.length]);
  const key = r => r.county + '|' + r.direction;
  const byKey = new Map(rows.map(r => [key(r), r]));
  for (const c of cd) {
    const r = byKey.get(key(c));
    check(r && near(r.lat, c.lat) && near(r.lon, c.lon) && near(r.total_animals, c.total_animals) &&
      near(r.radius_px, c.radius_px), 'rows: ' + tag + ' ' + key(c), { page: r, cvi: c });
  }

  const date = new Date(2026, 9, 12);
  const input = { rows, f, universe, palette: rec.inputs.county_palette, opacity: rec.inputs.county_opacity,
    title: rec.inputs.export_title, date, counties: COUNTIES };
  const built = BM.wa(input);
  const m = built.model;
  const cviBuilt = BM.wa(input, BR.CVI_STYLE);
  const [mapPlot, headerPlot, topPlot, legendPlot] = plots(rec);

  // The page: CVI's size and resolution, its file name.
  check(rec.saved.width_in === BR.PAGE.widthIn && rec.saved.height_in === BR.PAGE.heightIn &&
    rec.saved.dpi === BR.DPI.standard, 'page: ' + tag + ' 11 x 8.5 in at 200 dpi', rec.saved);
  check(same(BR.pixelSize(BR.DPI.standard), rec.png), 'page: ' + tag + ' PNG pixel size', rec.png);
  check(m.fileName === rec.saved.file, 'page: ' + tag + ' file name', [m.fileName, rec.saved.file]);

  // Header: CVI's bar, its texts and the title's size step.
  const ht = texts(headerPlot);
  check(headerPlot.x === 0 && near(headerPlot.y, 1 - BR.LAYOUT.headerH) && headerPlot.width === 1 &&
    near(headerPlot.height, BR.LAYOUT.headerH), 'header: ' + tag + ' region');
  check(headerPlot.plot.background.fill === '#245566', 'header: ' + tag + ' Dark Teal bar');
  check(ht[0].label === 'ANIMAL SERVICES' && ht[0].size === 4.6 && ht[0].fontface === 'bold' && ht[0].hjust === 1 &&
    near(ht[0].x, 0.295), 'header: ' + tag + ' ANIMAL SERVICES');
  check(ht[1].label === '|' && ht[1].size === 5 && near(ht[1].x, 0.305), 'header: ' + tag + ' bar');
  check(m.title === ht[2].label, 'header: ' + tag + ' title', [m.title, ht[2].label]);
  check(m.titleSize === ht[2].size, 'header: ' + tag + ' title size', [m.titleSize, ht[2].size]);
  check(near(ht[2].x, 0.315) && ht[2].hjust === 0 && ht[2].colour === 'white', 'header: ' + tag + ' title place');

  // The logo: CVI's file and box.
  const logo = rec.page.find(e => e.kind === 'grob');
  check(logo && near(logo.x, BR.LAYOUT.logoX) && near(logo.width, BR.LAYOUT.logoW) &&
    near(logo.y, 1 - BR.LAYOUT.headerH * 0.94) && near(logo.height, BR.LAYOUT.headerH * 0.88) &&
    same(logo.raster, [BRAND.LOGO.height, BRAND.LOGO.width]), 'logo: ' + tag + ' box and size', logo);

  // Meta and stat rows.
  const lab = labelsOf(rec);
  const find = s => lab.find(l => l.label === s);
  check(find(m.meta.left) && find(m.meta.left).color === '#555555' && find(m.meta.left).size === 9,
    'rows: ' + tag + ' Data Range', m.meta.left);
  const upd = find(m.meta.right);
  check(upd && upd.color === '#777777' && upd.fontface === 'italic' && near(upd.y, BR.LAYOUT.metaY),
    'rows: ' + tag + ' Last Updated', m.meta.right);
  const period = m.stats.left[0];
  check(find(period.prefix) && find(period.prefix).fontface === 'bold' && find(period.value) &&
    near(find(period.prefix).y, BR.LAYOUT.statY), 'rows: ' + tag + ' period', period);
  for (const s of m.stats.right) {
    const p = lab.find(l => l.label === s.prefix);
    const i = lab.indexOf(p);
    check(p && lab[i + 1] && lab[i + 1].label === s.value && p.size === 13, 'rows: ' + tag + ' ' + s.prefix,
      [s, p, lab[i + 1]]);
  }
  check(lab.length === 2 + 2 + 2 * m.stats.right.length, 'rows: ' + tag + ' nothing else', lab.map(l => l.label));

  // The Top 3 box.
  check(near(topPlot.x, BR.LAYOUT.gutterX) && near(topPlot.width, BR.LAYOUT.gutterW) && near(topPlot.height, 0.285) &&
    near(topPlot.y, 1 - BR.LAYOUT.headerH - 0.020 - 0.285), 'top: ' + tag + ' region');
  const rectFills = topPlot.plot.layers.filter(l => l.geom === 'GeomRect').map(l => l.data[0].fill.toLowerCase());
  check(same(rectFills, m.top.map(s => s.color.toLowerCase())), 'top: ' + tag + ' header colors',
    [rectFills, m.top.map(s => s.color)]);
  const want = [];
  for (const s of m.top) {
    want.push(s.title);
    for (const r of s.rows) want.push(r.label, r.value);
    want.push('Total', s.total);
  }
  check(same(texts(topPlot).map(t => t.label), want), 'top: ' + tag + ' texts', [texts(topPlot).map(t => t.label), want]);

  // The legend.
  // CVI's box in CVI's style; with circles spaced by size the box keeps at least CVI's height (checked below).
  check(near(legendPlot.x, BR.LAYOUT.gutterX) && near(legendPlot.y, 0.045) &&
    near(legendPlot.height, cviBuilt.model.legendHeight) && same(legendPlot.plot.margin_pt, [5, 5, 5, 5]),
  'legend: ' + tag + ' region', [legendPlot.height, cviBuilt.model.legendHeight]);
  const lt = texts(legendPlot).map(t => t.label);
  const lp = pointsOf(legendPlot);
  let wantLabels;
  let wantSizes;
  let wantColors;
  if (m.legend.kind === 'split') {
    wantLabels = ['TOTAL ANIMALS'];
    wantSizes = [];
    wantColors = [];
    for (const s of m.legend.sections) {
      wantLabels.push(s.title, ...s.labels);
      wantSizes.push(...s.sizes);
      wantColors.push(...s.labels.map(() => s.color));
    }
  } else {
    wantLabels = ['TOTAL ANIMALS', '(' + m.legend.title + ')', ...m.legend.labels];
    wantSizes = m.legend.sizes;
    wantColors = m.legend.labels.map(() => m.legend.color);
  }
  check(same(lt, wantLabels), 'legend: ' + tag + ' texts', [lt, wantLabels]);
  check(lp.length === wantSizes.length && lp.every((p, i) => near(p.size, wantSizes[i], 1e-9)),
    'legend: ' + tag + ' circle sizes', [lp.map(p => p.size), wantSizes]);
  // The page's palette colors are CVI's for the default palette; the scenarios use only that one.
  check(lp.every((p, i) => rColor(p.fill).hex === wantColors[i].toLowerCase() && near(rColor(p.fill).alpha, 0.4, 0.01)),
    'legend: ' + tag + ' circle colors', [lp.map(p => p.fill), wantColors]);

  // The map: Web Mercator over CVI's limits widened by 5%; circles as CVI sizes them; the named counties.
  check(near(m.extent.west, mapPlot.plot.x_range[0]) && near(m.extent.east, mapPlot.plot.x_range[1]) &&
    near(m.extent.south, mapPlot.plot.y_range[0]) && near(m.extent.north, mapPlot.plot.y_range[1]),
  'map: ' + tag + ' extent', [m.extent, mapPlot.plot.x_range, mapPlot.plot.y_range]);
  const pts = mapPlot.plot.layers.find(l => l.geom === 'GeomSf' && same(list(l.geometry), ['POINT'])).data;
  check(pts.length === m.circles.length, 'map: ' + tag + ' circle count', [pts.length, m.circles.length]);
  const drawnCvi = pts.map(p => ({ x: p.x, y: p.y, size: p.size, stroke: p.stroke, fill: rColor(p.fill) }));
  m.circles.forEach((c, i) => {
    const p = drawnCvi[i];
    const total = c.direction === 'Total';
    check(p && near(c.lon, p.x) && near(c.lat, p.y) && near(c.size, p.size) && near(c.stroke, p.stroke),
      'map: ' + tag + ' circle ' + i + ' (drawing order, size, border)', { page: c, cvi: p });
    // S1.1: the Combined circle takes the palette's first color; CVI draws it #245566.
    const wantFill = total ? '#245566' : c.fill.toLowerCase();
    check(p && p.fill.hex === wantFill && near(p.fill.alpha, c.opacity, 0.003),
      'map: ' + tag + ' circle ' + i + ' color', { page: [c.fill, c.opacity], cvi: p && p.fill });
    if (total) check(c.fill === '#1C9CD9', 'S1.1: ' + tag + ' Combined circle in the palette\'s first color', c.fill);
  });
  const named = mapPlot.plot.layers.find(l => l.geom === 'GeomShadowText' || l.geom === 'GeomText');
  check(named && same(named.data.map(d => d.label).sort(), m.labels.slice().sort()),
    'map: ' + tag + ' named counties', [named && named.data.map(d => d.label), m.labels]);
  check(named && named.data.every(d => d.colour === '#8a8a8a' && d.size === 3.2), 'map: ' + tag + ' name style');

  // Deliberate differences in the markup: on by default, off in CVI's style.
  const ours = BR.svg(built.parts);
  const cviStyle = BR.svg(cviBuilt.parts);
  checkMapAdditions(tag, m, ours, cviStyle, cviBuilt.model, legendPlot, rec.inputs.county_scaling, built.parts[0]);
  check(ours.includes('>' + BR.AGENCY + '<') && !cviStyle.includes(BR.AGENCY), 'Page style: ' + tag + ' agency name');
  const updatedColor = s => (s.match(/fill="(#[0-9a-f]{6})" font-style="italic"[^>]*>Last Updated/) || [])[1];
  check(updatedColor(ours) === '#555555' && updatedColor(cviStyle) === '#777777', 'Page style: ' + tag + ' Last Updated gray',
    [updatedColor(ours), updatedColor(cviStyle)]);
  check(ours.includes('>' + BR.esc(m.title) + '<'), 'page: ' + tag + ' title in the markup');
  // "ANIMAL SERVICES" ends 0.015 of the page further right than CVI's (CVI's place in CVI's style).
  const servicesX = svgText => Number((svgText.match(/<text x="([0-9.]+)"[^>]*text-anchor="end">ANIMAL SERVICES</) || [])[1]);
  check(near(servicesX(cviStyle), BR.px(0.295), 1e-4) && near(servicesX(ours), BR.px(0.295 + BR.HEADER_SHIFT), 1e-4),
    'Page style: ' + tag + ' header text moved right', [servicesX(ours), servicesX(cviStyle)]);
}

// ── One National Flow scenario ─────────────────────────────────────────────────────────────────────────────────
const EARTH = 6378137;
const merc = (lon, lat) => [lon * Math.PI / 180 * EARTH, Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * EARTH];
// CVI's color for a page color where S1.1 changed a palette entry (palettes.CVI_VALUES).
function cviSpeciesColor(pageColor, palette, group) {
  const hit = W.palettes.CVI_VALUES.find(v => v[0] === 'species' && v[1] === palette && v[2] === group);
  return (hit ? hit[3] : pageColor).toLowerCase();
}
function flowFilters(inp) {
  return {
    direction: inp.flow_direction, species: list(inp.flow_species), speciesSub: list(inp.flow_species_sub),
    years: list(inp.flow_year).map(Number), quarters: list(inp.flow_quarter), combine: !!inp.flow_combine_species,
    scaling: inp.flow_scaling, nBins: Number(inp.flow_n_bins), palette: inp.flow_palette,
    multiplier: inp.flow_width_mult, opacity: inp.flow_opacity, lines: !!inp.flow_show_state_lines
  };
}
const SOURCE_STATES = 'Data: WSDA Animal Services CVI records · State boundaries: U.S. Census Bureau';
function checkFlow(fx, name, rec, master, universe) {
  const tag = 'flow ' + fx + ' ' + name;
  if (!rec.render) {
    check(false, 'render: ' + tag + ' CVI drew a page', rec.notes);
    return;
  }
  const f = flowFilters(rec.inputs);
  const lines = W.flow.lines(master, f, CENTERS);
  const cr = rec.render.flow_rows;
  // The rows the page draws are the rows CVI's renderer was given, in CVI's order.
  check(lines && lines.length === cr.length, 'rows: ' + tag + ' count', [lines && lines.length, cr.length]);
  cr.forEach((c, i) => {
    const r = lines && lines[i];
    check(r && r.state === c.state && r.species_group === c.species_group && near(r.total_animals, c.total_animals),
      'rows: ' + tag + ' row ' + i, { page: r && [r.state, r.species_group, r.total_animals], cvi: c });
  });
  const input = { lines, f, universe, title: rec.inputs.export_title, date: new Date(2026, 9, 12), states: STATES };
  const built = BM.flow(input);
  const cviBuilt = BM.flow(input, BR.CVI_STYLE);
  const m = built.model;
  const [mapPlot, headerPlot, topPlot, legendPlot] = plots(rec);

  // Page, file name, header, logo.
  check(rec.saved.dpi === BR.DPI.standard && same(BR.pixelSize(BR.DPI.standard), rec.png), 'page: ' + tag + ' size');
  check(m.fileName === rec.saved.file, 'page: ' + tag + ' file name', [m.fileName, rec.saved.file]);
  const ht = texts(headerPlot);
  check(m.title === ht[2].label && m.titleSize === ht[2].size, 'header: ' + tag + ' title and size',
    [m.title, ht[2].label, m.titleSize, ht[2].size]);
  check(headerPlot.plot.background.fill === '#245566' && ht[0].label === 'ANIMAL SERVICES', 'header: ' + tag + ' bar');
  const logo = rec.page.find(e => e.kind === 'grob');
  check(logo && near(logo.x, BR.LAYOUT.logoX) && near(logo.width, BR.LAYOUT.logoW), 'logo: ' + tag + ' box');

  // Meta and stat rows: every label CVI places, in order.
  const lab = labelsOf(rec).map(l => l.label);
  const want = [m.meta.left, m.meta.right];
  for (const st of m.stats.left) want.push(st.prefix, st.value);
  check(same(lab, want), 'rows: ' + tag + ' meta and stat texts', [lab, want]);
  check(labelsOf(rec).slice(2).every(l => l.size === 13 && near(l.y, BR.LAYOUT.statY)), 'rows: ' + tag + ' stat row');

  // Top 3 States: CVI's place (65% of the gutter, centered), header color and texts.
  check(near(topPlot.x, BR.LAYOUT.gutterX + BR.LAYOUT.gutterW * 0.175) && near(topPlot.width, BR.LAYOUT.gutterW * 0.65) &&
    near(topPlot.height, 0.21) && near(topPlot.y, 1 - BR.LAYOUT.headerH - 0.020 - 0.21), 'top: ' + tag + ' region');
  const rectFill = topPlot.plot.layers.find(l => l.geom === 'GeomRect').data[0].fill.toLowerCase();
  check(rectFill === m.top.color, 'top: ' + tag + ' header color', rectFill);
  // CVI's Top 3 compared with the page in CVI's style (the page's own style draws a Top 5, checked below).
  const cm = cviBuilt.model;
  const tt = texts(topPlot);
  const wantTop = [cm.top.title];
  for (const r of cm.top.rows) wantTop.push(r.label, r.value);
  wantTop.push('Total', cm.top.total);
  check(same(tt.map(t => t.label), wantTop), 'top: ' + tag + ' texts', [tt.map(t => t.label), wantTop]);
  check(tt[0].size === cm.top.titleSize && tt.slice(1).every(t => t.size === cm.top.rowSize), 'top: ' + tag + ' sizes');
  // By design, the page's Top 5: CVI's top 3 first, then the next by animals,
  // in a box sized to its rows; the badges follow the list.
  const top5 = m.top.rows.map(r => r.label);
  const nStates = new Set(lines.map(a => a.state)).size;
  check(m.top.title === 'Top ' + 5 + ' States' && top5.length === Math.min(5, nStates) &&
    same(top5.slice(0, cm.top.rows.length), cm.top.rows.map(r => r.label)) &&
    same(m.badges.map(b => b.abbr).slice().sort(), top5.filter(a => BM.stateLabelPlaces().some(q => q.abbr === a)).sort()),
    'top: ' + tag + ' the page\'s Top 5 (CVI\'s top 3 first; badges on the five)', { page: top5, cvi: cm.top.rows.map(r =>
      r.label), badges: m.badges.map(b => b.abbr) });

  // The legend: CVI's region in CVI's style, its texts and line widths.
  check(near(legendPlot.x, BR.LAYOUT.gutterX) && near(legendPlot.y, 0.045) &&
    near(legendPlot.height, cviBuilt.model.legendHeight), 'legend: ' + tag + ' region');
  const lt = texts(legendPlot).map(t => t.label);
  check(same(lt, ['TOTAL ANIMALS', '(' + m.legend.title + ')', ...m.legend.labels]), 'legend: ' + tag + ' texts',
    [lt, m.legend.labels]);
  const segs = legendPlot.plot.layers.filter(l => l.geom === 'GeomSegment').map(l => l.data[0]);
  const cviWidths = cviBuilt.model.legend.widths;
  check(segs.length === cviWidths.length && segs.every((sg, i) => near(sg.linewidth, cviWidths[i]) &&
    sg.colour === '#888888'), 'legend: ' + tag + ' line widths in CVI\'s style', [segs.map(sg => sg.linewidth), cviWidths]);
  // The page's widths are the map's own: each tier value's width worked out here as the map's width rule gives
  // it (CVI's .compute_radius with the value added; for classes, the class of the value under the lines' breaks).
  if (!lt.includes('< 100')) {
    const totals = cr.map(c => c.total_animals);
    const mult = Math.max(0.15, Math.min(3, Number(f.multiplier)));
    const want = m.legend.labels.map((lab, i) => {
      const v = W.scaling.legendTiers(totals, f.scaling, f.nBins, 0.30, 3.40).values[i];
      if (f.scaling === 'quantile' || f.scaling === 'natural') {
        const g = W.scaling.binsOf(totals, f.scaling, f.nBins);
        return (g ? 0.30 + (g.binOf(v) - 1) / (g.maxBin - 1) * 3.10 : 1.85) * mult;
      }
      const vmax = Math.max(...totals.concat([v]));
      const norm = f.scaling === 'log' ? Math.log1p(v) / Math.log1p(vmax) : f.scaling === 'sqrt'
        ? Math.sqrt(v) / Math.sqrt(vmax) : v / vmax;
      return (0.30 + norm * 3.10) * mult;
    });
    check(m.legend.widths.every((w, i) => near(w, want[i], 1e-9)), 'Page style: ' + tag + ' legend widths as the map draws them',
      [m.legend.widths, want]);
  }
  // The species key: the groups in the lines' order with the lines' colors (one color with Combine species).
  const groups = [];
  cr.forEach(c => { if (groups.indexOf(c.species_group) < 0) groups.push(c.species_group); });
  const wantKey = f.combine ? ['All species'] : groups;
  const oursSvg = BR.svg(built.parts);
  check(same(m.legend.species.map(x => x.label), wantKey) &&
    m.legend.species.every(x => oursSvg.includes('stroke="' + x.color + '"')) &&
    !BR.svg(cviBuilt.parts).includes('>SPECIES<'), 'Page style: ' + tag + ' species key', [m.legend.species, wantKey]);

  // The map: CVI's extent in Web Mercator; state fill and lines; WA's glow; the flow lines in drawing order.
  const [x0, y0] = merc(m.extent.west, m.extent.south);
  const [x1, y1] = merc(m.extent.east, m.extent.north);
  check(near(mapPlot.plot.x_range[0], x0, 1e-6) && near(mapPlot.plot.x_range[1], x1, 1e-6) &&
    near(mapPlot.plot.y_range[0], y0, 1e-6) && near(mapPlot.plot.y_range[1], y1, 1e-6), 'map: ' + tag + ' extent',
  [mapPlot.plot.x_range, mapPlot.plot.y_range, [x0, x1, y0, y1]]);
  const layers = mapPlot.plot.layers;
  const states = layers[0].data[0];
  const ours = BR.svg(built.parts);
  const cviStyle = BR.svg(cviBuilt.parts);
  check(states.fill === '#e8e8e8' && (f.lines ? states.colour === '#ffffff' && states.linewidth === 0.25
    : states.colour === null), 'map: ' + tag + ' states', states);
  check(ours.includes('fill="#e8e8e8" stroke="#ffffff"') === f.lines, 'map: ' + tag + ' state lines drawn as CVI');
  const glow = layers.slice(1, 4).map(l => l.data[0]);
  check(glow[0].colour === '#9ec9dc' && glow[0].linewidth === 3 && glow[1].colour === '#4ea2c4' &&
    glow[1].linewidth === 1.5 && glow[2].fill === '#dbeaf2' && near(glow[2].alpha, 0.7) &&
    glow[2].colour === '#1c5a83' && glow[2].linewidth === 0.55, 'map: ' + tag + ' WA glow', glow);
  const lineLayer = layers.find(l => l.geom === 'GeomSf' && same(list(l.geometry), ['LINESTRING']));
  check(lineLayer && lineLayer.data.length === m.lines.length, 'map: ' + tag + ' line count');
  m.lines.forEach((ln, i) => {
    const d = lineLayer && lineLayer.data[i];
    const wantColor = cviSpeciesColor(ln.color, f.palette, f.combine ? Object.keys(W.palettes.SPECIES_PALETTES[f.palette])[0]
      : ln.species_group);
    check(d && near(d.linewidth, ln.linewidth) && rColor(d.colour).hex === wantColor && near(d.alpha, ln.opacity),
      'map: ' + tag + ' line ' + i + ' (order, width, color, opacity)', { page: ln, cvi: d });
  });
  // Top 3 badges, state labels and the WA anchor.
  const pts = layers.filter(l => l.geom === 'GeomSf' && same(list(l.geometry), ['POINT']));
  const badgePts = pts.slice(0, -1).reduce((a, l) => a.concat(l.data), []);
  check(badgePts.length === cm.badges.length, 'map: ' + tag + ' badge count', [badgePts.length, cm.badges.length]);
  cm.badges.forEach((b, i) => {
    const d = badgePts[i];
    const pl = BM.stateLabelPlaces().find(q => q.abbr === b.abbr);
    const [bx, by] = merc(pl.lon, pl.lat);
    check(d && near(d.x, bx, 1e-6) && near(d.y, by, 1e-6) && d.size === b.size && d.stroke === b.stroke &&
      d.fill === '#ee7e2c', 'map: ' + tag + ' badge ' + b.abbr, d);
  });
  const anchor = pts[pts.length - 1].data[0];
  const [ax, ay] = merc(m.anchor[0], m.anchor[1]);
  check(near(anchor.x, ax, 1e-6) && near(anchor.y, ay, 1e-6) && anchor.fill === '#1c5a83' && anchor.size === 3,
    'map: ' + tag + ' WA anchor', anchor);
  const halo = layers.filter(l => l.geom === 'GeomShadowText').reduce((a, l) => a.concat(l.data), []);
  const pageHalo = cm.labels.map(q => q.abbr + '@' + q.lon.toFixed(4) + ',' + q.lat.toFixed(4) + '/' + (q.small ? 2 : 3));
  const cviHalo = halo.map(d => d.label + '@' + d.x.toFixed(4) + ',' + d.y.toFixed(4) + '/' + d.size);
  check(same(pageHalo, cviHalo), 'map: ' + tag + ' state labels and places', [pageHalo, cviHalo]);
  check(halo.every(d => d.colour === '#787878' && d.fontface === 'bold' && d['bg.r'] === 0.3), 'map: ' + tag +
    ' state label style');
  const topText = layers.filter(l => l.geom === 'GeomText').reduce((a, l) => a.concat(l.data), []);
  check(same(topText.map(d => d.label), cm.badges.map(b => b.abbr)) && topText.every(d => d.colour === '#ffffff'),
    'map: ' + tag + ' top 3 labels', topText.map(d => d.label));

  // Deliberate differences: the agency name and grays (as WA State), state names near-black, the sizing and source
  // lines, line samples apart.
  check(ours.includes('>' + BR.AGENCY + '<') && !cviStyle.includes(BR.AGENCY), 'Page style: ' + tag + ' agency name');
  const nameFill = svgText => (svgText.match(/font-size="8.54" fill="(#[0-9a-f]{6})" font-weight="bold" text-anchor="middle" stroke="#ffffff"/) || [])[1];
  check(nameFill(ours) === '#222222' && nameFill(cviStyle) === '#787878', 'Page style: ' + tag + ' state name color',
    [nameFill(ours), nameFill(cviStyle)]);
  let wantSizing = 'Line width: ' + SCALE_WORDS[f.scaling];
  const fixed = lt.includes('< 100');
  if ((f.scaling === 'quantile' || f.scaling === 'natural') && !fixed) wantSizing += ', ' + segs.length + ' classes';
  check(ours.includes('>' + wantSizing + '<') && !cviStyle.includes(wantSizing), 'Page style: ' + tag + ' sizing line', wantSizing);
  check(ours.includes('>' + BR.esc(SOURCE_STATES) + '<') && !cviStyle.includes('Data: WSDA'), 'Page style: ' + tag +
    ' source line');
  const ls = m.legendSamples;
  let apart = true;
  for (let i = 1; i < ls.length; i++) if (ls[i].y - ls[i - 1].y < ls[i].r + ls[i - 1].r - 1e-9) apart = false;
  check(apart, 'Page style: ' + tag + ' line samples apart');
  check(ls.every(x => x.labelX > x.capX), 'Page style: ' + tag + ' labels clear of the line caps');
  check(m.legendHeight >= cviBuilt.model.legendHeight - 1e-9, 'Page style: ' + tag + ' box at least CVI\'s height');
}

// The Streets background (County Focus): CVI's layers and colors drawn, the place names inside the focus counties
// and apart, how many of CVI's names the page also shows (CVI estimates name widths from character counts and cuts
// the places to the counties before taking their centers, so a few may differ), the credit.
const streetStats = { scenarios: 0, cvi: 0, both: 0 };
function checkStreets(tag, m, L, f, ours) {
  streetStats.scenarios++;
  // Every color CVI's Streets layers draw (outline or fill) the page draws too.
  const colors = L.filter(l => l.geom === 'GeomSf').flatMap(l => [(l.data[0] || {}).colour, (l.data[0] || {}).fill])
    .filter(Boolean).map(c => String(c).toLowerCase().slice(0, 7));
  for (const c of ['#ead7c2', '#a89070', '#d4e6ef', '#9cc0d4', '#e6e6e6']) {
    check(colors.includes(c) && ours.includes('"' + c + '"'), 'streets: ' + tag + ' layer ' + c + ' drawn as CVI', colors);
  }
  const cviPlaces = L.filter(l => l.geom === 'GeomShadowText').flatMap(l => l.data)
    .filter(d => d.colour === '#2c2c2c').map(d => d.label);
  const pagePlaces = m.streetNames.filter(n => n.kind === 'place').map(n => n.name);
  streetStats.cvi += cviPlaces.length;
  streetStats.both += pagePlaces.filter(n => cviPlaces.includes(n)).length;
  check(pagePlaces.length > 0 && pagePlaces.length <= (f.counties.length <= 1 ? 22 : 14), 'streets: ' + tag +
    ' place names, at most CVI\'s cap', pagePlaces.length);
  const boxes = m.streetNames.filter(n => n.box).map(n => n.box);
  check(boxes.every((b, i) => !boxes.some((o, j) => j !== i && boxesMeet(o, b))), 'streets: ' + tag + ' place names apart');
  check(ours.includes('Streets: U.S. Census Bureau TIGER/Line, USGS NHD, Natural Earth'), 'streets: ' + tag + ' credit');
}

// The synthetic facility layers (tests/synthetic/make_s9_facilities.js) through the page's own loader, as the
// County Focus map's layers: those switched on, filtered to the focus counties (facilities.select).
vm.runInContext(fs.readFileSync(path.join(SITE, 'geo', 'streets-wa.js'), 'utf8'), sandbox);
const STREETS = sandbox.window.WSDA_STREETS;
const FAC = sandbox.window.WSDA.facilities;
// The page draws Feedlots in the guide's Blue Green #0094aa, CVI #0097a7, and the
// facility marks in their layer's shape (checked in tests/node/run_ui_unit_tests.js). A deliberate difference: the
// page's colors are compared here as CVI's, and the Facilities legend's "mark size" as CVI's "circle size".
const S9C = n => Number(n).toLocaleString('en-US');
const asCvi = hex => (String(hex).toLowerCase() === '#0094aa' ? '#0097a7' : String(hex).toLowerCase());
const asCviText = t => (t === 'mark size = facilities in county' ? 'circle size = facilities in county' : t);
const FAC_DIR = path.join(ORACLE, 'facilities');
function focusFacilities(keys, counties) {
  if (!keys.length) return [];
  const files = {};
  for (const l of FAC.registry(null).layers) {
    const f = path.join(FAC_DIR, l.file);
    if (fs.existsSync(f)) files[l.key] = W.csv.parse(fs.readFileSync(f, 'utf8'));
  }
  const prepared = FAC.prepare(files, null, sandbox.window.CVIWA_GEO.counties, 1);
  const geometry = FAC.countyMembership(sandbox.window.CVIWA_GEO.counties, counties);
  return FAC.select(prepared, { layers: keys, attributes: {}, geometry: q => geometry.contains(q.lon, q.lat) }).layers
    .map(l => ({ key: l.key, label: l.label, color: l.color, points: l.points.map(q => ({ name: q.name, lon: q.lon,
      lat: q.lat })) }));
}

// ── One County Focus scenario ──────────────────────────────────────────────────────────────────────────────────
function focusOpts(inp) {
  return {
    counties: list(inp.intra_counties), species: list(inp.intra_species), rawSpecies: list(inp.intra_species_sub),
    years: list(inp.intra_year).map(Number), quarters: list(inp.intra_quarter), direction: inp.intra_filter_dir,
    mode: inp.intra_mode, scaling: inp.intra_scaling, nBins: Number(inp.intra_n_bins), opacity: inp.intra_opacity,
    hideCircles: !!inp.hide_cvi_circles, facilityLayers: list(inp.overlay_layers),
    nameLayers: list(inp.export_overlay_label_layers)
  };
}
const focusStats = { scenarios: 0, namesMoved: 0, namesNotFree: 0, overlapping: 0, across: 0, insetCorners: {} };
// County Focus's WA inset corner: in the page's style the first corner clear of the
// focus counties' land, circles, markers and names when one is, else the one covering fewest, then least land; CVI's
// style keeps the bottom right. Land is measured here on its own finer grid with its own point-in-polygon test, and
// the circles, markers and names are read from the page's model. lay: BM.focusLayout of the same input (its P).
function insetPoly(P, features) {
  const rings = [];
  for (const c of features) {
    const g = c.geometry;
    for (const poly of (g.type === 'Polygon' ? [g.coordinates] : g.coordinates)) {
      for (const ring of poly) rings.push(ring.map(([lon, lat]) => P(lon, lat)));
    }
  }
  return rings;
}
function landPoints(b, rings, n) {
  let hits = 0;
  for (let i = 0; i <= n; i++) {
    for (let k = 0; k <= n / 2; k++) {
      const x = b.x0 + 0.5 + i * (b.x1 - b.x0 - 1) / n;
      const y = b.y0 + 0.5 + k * (b.y1 - b.y0 - 1) / (n / 2);
      let crossings = 0;
      for (const ring of rings) {
        for (let a = 0; a < ring.length - 1; a++) {
          const [x1, y1] = ring[a];
          const [x2, y2] = ring[a + 1];
          if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
            if (x1 + (y - y1) / (y2 - y1) * (x2 - x1) > x) crossings++;
          }
        }
      }
      if (crossings % 2 === 1) hits++;
    }
  }
  return hits;
}
function checkFocusInset(tag, m, cviM, lay, focusSub) {
  check(cviM.inset.corner === 'bottom right' && near(cviM.inset.x, BR.LAYOUT.mapW - 0.130 - 0.008) &&
    near(cviM.inset.y, 0.030), 'inset: ' + tag + ' CVI\'s style keeps the bottom right', cviM.inset.corner);
  const order = ['bottom right', 'bottom left', 'top left', 'top right'];
  const sc = m.inset.scores;
  focusStats.insetCorners[m.inset.corner] = (focusStats.insetCorners[m.inset.corner] || 0) + 1;
  check(sc && same(sc.map(c => c.corner), order), 'inset: ' + tag + ' four corners tried in order', sc);
  if (!sc) return;
  const clear = sc.filter(c => c.covers === 0 && c.land === 0);
  const best = sc.slice().sort((a, b) => a.covers - b.covers || a.land - b.land)[0];
  check(m.inset.corner === (clear.length ? clear[0].corner : best.corner), 'inset: ' + tag + ' the first clear corner, ' +
    'else the one covering least (' + m.inset.corner + ')', sc);
  // What the chosen box covers, checked here on its own.
  const b = m.inset.box;
  const rings = insetPoly(lay.P, focusSub);
  const land = landPoints(b, rings, 60);
  const touch = c => {
    const dx = c.x - Math.max(b.x0, Math.min(c.x, b.x1));
    const dy = c.y - Math.max(b.y0, Math.min(c.y, b.y1));
    return dx * dx + dy * dy < c.r * c.r;
  };
  const meet = q => q && Math.min(q.x1, b.x1) > Math.max(q.x0, b.x0) && Math.min(q.y1, b.y1) > Math.max(q.y0, b.y0);
  const marks = m.circles.filter(touch).length + m.facilities.flatMap(l => l.points)
    .filter(q => touch({ x: q.x, y: q.y, r: BR.pointRadius(3.0, 0.5) })).length;
  const names = m.names.filter(n => meet(n.box)).length + m.streetNames.filter(n => meet(n.box)).length +
    m.facilityNames.filter(n => n.at && meet(n.at.box)).length;
  if (m.inset.covers === 0 && m.inset.land === 0) {
    check(land === 0 && marks === 0 && names === 0, 'inset: ' + tag + ' the chosen corner covers no land, circle, ' +
      'marker or name', { land, marks, names, corner: m.inset.corner });
  }
  // Every corner's land, against this grid: none where the page finds none, some where this grid finds more than 2%.
  const shares = sc.map(c => landPoints(insetBoxOf(c.corner, m), rings, 60) / (61 * 31));
  check(sc.every((c, i) => (c.land > 0 || shares[i] === 0) && (shares[i] <= 0.02 || c.land > 0)),
    'inset: ' + tag + ' each corner\'s land agrees with this grid', [sc.map(c => c.land), shares]);
}
const insetBoxOf = (corner, m) => {
  const c = BM.insetCorners(BR.LAYOUT.statY - BM.BAND_PAD).find(x => x.corner === corner);
  return BM.insetBox(c);
};

function checkFocus(fx, name, rec, master, universe) {
  const tag = 'focus ' + fx + ' ' + name;
  if (!rec.render) {
    // CVI refuses County Focus without premises coordinates; the page's build says the same (S5).
    const built = W.focus.build(master, focusOpts(rec.inputs));
    check(built.missingCoordinates.length > 0 && rec.notes.some(n => /premises coordinates/.test(n.text)),
      'render: ' + tag + ' refused without premises coordinates, as the page', rec.notes.map(n => n.text));
    return;
  }
  focusStats.scenarios++;
  const f = focusOpts(rec.inputs);
  const premises = W.focus.build(master, f).premises;
  const fr = rec.render.focus_rows;
  // The premises the page builds are the ones CVI's renderer was given.
  check(premises.length === fr.length, 'rows: ' + tag + ' count', [premises.length, fr.length]);
  const key = r => r.direction + '|' + r.premises_id;
  const byKey = new Map(premises.map(p => [key(p), p]));
  for (const c of fr) {
    const p = byKey.get(key(c));
    check(p && near(p.lon, c.lon) && near(p.lat, c.lat) && near(p.total_animals, c.total_animals) &&
      near(p.radius_px, c.radius_px) && p.city === c.city, 'rows: ' + tag + ' ' + key(c), { page: p && [p.lon, p.lat,
      p.total_animals, p.radius_px], cvi: c });
  }
  const input = { premises: fr.map(c => byKey.get(key(c)) || c), f, universe, title: rec.inputs.export_title,
    date: new Date(2026, 9, 12), counties: COUNTIES, facilities: focusFacilities(f.facilityLayers, f.counties),
    nameLayers: f.nameLayers, background: rec.inputs.export_png_background || 'standard', streets: STREETS };
  const built = BM.focus(input);
  const cviBuilt = BM.focus(input, BR.CVI_STYLE);
  const m = built.model;
  const pl = plots(rec);
  const [mapPlot, headerPlot, boxPlot, topPlot, legendPlot, insetPlot, scalePlot] = pl;

  check(m.fileName === rec.saved.file, 'page: ' + tag + ' file name', [m.fileName, rec.saved.file]);
  const ht = texts(headerPlot);
  check(m.title === ht[2].label && m.titleSize === ht[2].size, 'header: ' + tag + ' title and size', [m.title, ht[2]]);

  // Meta row, period, and the grouping note.
  const lab = labelsOf(rec);
  const want = [m.meta.left, m.meta.right, m.stats.left[0].prefix, m.stats.left[0].value];
  // In a legend box too short for everything the page writes the note in one line
  // ("248 premises in 12 grouped circles"); CVI's three lines are compared then, a deliberate difference.
  const cviNote = n => (n.length === 1 && / premises in [\d,]+ grouped circles$/.test(n[0])
    ? [S9C(m.grouped.premises) + ' premises grouped into', S9C(m.grouped.circles) + ' nearby-location circles',
      '(full list in export)'] : n);
  if (m.grouped.note.length) want.push(cviNote(m.grouped.note).join('\n'));
  check(same(lab.map(l => l.label), want), 'rows: ' + tag + ' texts', [lab.map(l => l.label), want]);
  if (m.grouped.note.length === 1) {
    check(m.grouped.note[0] === S9C(m.grouped.premises) + ' premises in ' + S9C(m.grouped.circles) + ' grouped circles' &&
      !m.legendSqueezed && !m.legendOverlap, 'rows: ' + tag + ' the one-line note lets the legend fit, unsqueezed',
    [m.grouped.note, m.legendSqueezed, m.legendOverlap]);
  }
  const note = lab.find(l => /premises grouped/.test(l.label));
  if (note) {
    check(near(note.x, BR.LAYOUT.gutterX + BR.LAYOUT.gutterW / 2) && near(note.y, 0.42) && note.size === 8 &&
      note.color === '#666666', 'rows: ' + tag + ' grouping note place');
    check(cviBuilt.model.grouped.noteY === 0.42, 'rows: ' + tag + ' grouping note at CVI\'s place in CVI\'s style');
  }

  // Value boxes: CVI's region, colors, values and labels.
  check(near(boxPlot.x, 0.46) && near(boxPlot.y, BR.LAYOUT.statY - 0.024) && near(boxPlot.width, BR.LAYOUT.mapW - 0.46) &&
    near(boxPlot.height, 0.044), 'boxes: ' + tag + ' region');
  const rects = boxPlot.plot.layers[0].data;
  const bt = boxPlot.plot.layers.slice(1).map(l => l.data.map(d => d.label));
  check(same(rects.map(r => r.fill.toLowerCase()), m.boxes.map(b => b.color)), 'boxes: ' + tag + ' colors');
  check(same(bt[0], m.boxes.map(b => b.value)) && same(bt[1], m.boxes.map(b => b.label)), 'boxes: ' + tag + ' texts',
    [bt, m.boxes]);

  // The Top Importers / Exporters box: place, height and texts.
  check(near(topPlot.x, BR.LAYOUT.gutterX) && near(topPlot.height, m.top.height) && near(topPlot.y, m.topY),
    'top: ' + tag + ' region', [topPlot.height, m.top.height]);
  const wantTop = [];
  for (const sct of m.top.sections) {
    wantTop.push(sct.title);
    for (const r of sct.rows) wantTop.push(r.label, r.value);
  }
  check(same(texts(topPlot).map(t => t.label), wantTop), 'top: ' + tag + ' texts',
    [texts(topPlot).map(t => t.label), wantTop]);

  // The legend in CVI's style: CVI's region, texts and circle sizes.
  check(near(legendPlot.x, BR.LAYOUT.gutterX) && near(legendPlot.y, m.legendY) &&
    near(legendPlot.height, cviBuilt.model.legendHeight), 'legend: ' + tag + ' region', [legendPlot.y, legendPlot.height]);
  const lt = texts(legendPlot).map(t => t.label);
  const facLabels = m.facilities.map(l => l.label);
  const wantLt = f.hideCircles ? ['FACILITY LOCATIONS', ...facLabels]
    : ['PREMISES ROLE', 'Importer (received)', 'Exporter (sent)'].concat(facLabels.length ? ['FACILITY LOCATIONS',
      ...facLabels] : [], ['ANIMALS / PREMISES', ...m.legend.labels]);
  check(same(lt, wantLt), 'legend: ' + tag + ' texts', [lt, wantLt]);
  const lp = pointsOf(legendPlot);
  const role = f.hideCircles ? [] : [5, 5];
  const facSizes = m.facilities.map(() => 4);
  const tierSizes = f.hideCircles ? [] : m.legend.sizes;
  check(lp.length === role.length + facSizes.length + tierSizes.length &&
    same(lp.map(q => q.size).slice(0, role.length + facSizes.length), role.concat(facSizes)) &&
    lp.slice(role.length + facSizes.length).every((q, i) => near(q.size, tierSizes[i])),
  'legend: ' + tag + ' circle sizes', [lp.map(q => q.size), tierSizes]);
  check(lp.slice(role.length, role.length + facSizes.length).every((q, i) => q.fill === asCvi(m.facilities[i].color)),
    'legend: ' + tag + ' facility colors');
  // CVI's style places the legend's rows where CVI's do (with facilities: the squeezed layout).
  const cl = cviBuilt.model.legendCircles;
  check(cl.length === tierSizes.length && cl.every((c, i) => {
    const want = BR.py(legendPlot.y + legendPlot.height) + 5 + (1 - lp[role.length + facSizes.length + i].y) *
      (legendPlot.height * BR.H - 10);
    return Math.abs(c.y - want) < 1e-6;
  }), 'legend: ' + tag + ' CVI\'s style puts the size rows at CVI\'s places');

  // The inset and the scale bar.
  check(near(insetPlot.x, BR.LAYOUT.mapW - 0.130 - 0.008) && near(insetPlot.y, 0.030) && near(insetPlot.height, 0.0715),
    'inset: ' + tag + ' region');
  check(insetPlot.plot.layers[1].data.length === f.counties.length &&
    insetPlot.plot.layers[1].data[0].fill === '#1f77b4', 'inset: ' + tag + ' focus counties');
  {
    const lay = BM.focusLayout(input, BR.styleOf());
    const want = new Set(f.counties);
    checkFocusInset(tag, m, cviBuilt.model, lay, COUNTIES.filter(c => want.has(c.properties.name)));
  }
  const sbt = texts(scalePlot).map(t => t.label);
  const seg = scalePlot.plot.layers[0].data[0];
  check(m.scale && same(sbt, [m.scale.kmLabel, m.scale.miLabel]), 'scale: ' + tag + ' km and miles', [sbt, m.scale]);
  check(m.scale && Math.abs(m.scale.frac - (seg.xend - seg.x)) / (seg.xend - seg.x) < 0.05,
    'scale: ' + tag + ' bar length within 5% of CVI\'s', [m.scale && m.scale.frac, seg.xend - seg.x]);
  check(near(scalePlot.y, 0.045) && near(scalePlot.height, 0.058), 'scale: ' + tag + ' region');

  // The map: focus counties, their outline, the names at CVI's place, every circle (grouped, nudged, sized).
  const L = mapPlot.plot.layers;
  check(near(mapPlot.height, BR.LAYOUT.statY - BM.BAND_PAD) && near(mapPlot.width, BR.LAYOUT.mapW), 'map: ' + tag +
    ' region');
  const streetsOn = rec.inputs.export_png_background === 'vector:streets';
  check(L[0].data.length === f.counties.length && L[0].data[0].fill === (streetsOn ? '#f5f5f5' : '#e8e8e8') &&
    L[0].data[0].colour === '#8a8a8a', 'map: ' + tag + ' focus counties', L[0].data[0]);
  if (streetsOn) checkStreets(tag, m, L, f, BR.svg(built.parts));
  check(L[1].data[0].colour === (f.counties.length > 1 ? '#d0d0d0' : '#ffffff'), 'map: ' + tag + ' outline');
  const shadow = L.find(l => l.geom === 'GeomShadowText').data;
  check(same(shadow.map(d => d.label), m.names.map(n => n.name)) && shadow.every((d, i) => near(d.x, m.names[i].cviLon,
    1e-7) && near(d.y, m.names[i].cviLat, 1e-7)), 'map: ' + tag + ' county names at CVI\'s place',
  [shadow.map(d => [d.label, d.x, d.y]), m.names.map(n => [n.name, n.cviLon, n.cviLat])]);
  const pointLayers = L.filter(l => l.geom === 'GeomSf' && same(list(l.geometry), ['POINT']));
  const pts = f.hideCircles ? [] : pointLayers[0].data;
  check(pts.length === m.circles.length, 'map: ' + tag + ' circle count', [pts.length, m.circles.length]);
  // In the page's style each group sits at its members' animal-weighted center (worked out here from the
  // premises), nudged 0.015 degrees west (Inbound) or east (Outbound) when both directions are drawn.
  const byMember = new Map(input.premises.map(q => [q.direction + '\r' + q.group_key, q]));
  const both = m.circles.some(c => c.direction === 'Inbound') && m.circles.some(c => c.direction === 'Outbound');
  m.circles.forEach((c, i) => {
    const mem = c.members.map(k => byMember.get(k));
    const w = mem.map(q => q.total_animals);
    const wn = w.reduce((a, b) => a + b, 0) > 0 ? w : w.map(() => 1);
    const sw = wn.reduce((a, b) => a + b, 0);
    const lon = mem.reduce((a, q, k) => a + q.lon * wn[k], 0) / sw + (both ? (c.direction === 'Inbound' ? -0.015 : 0.015) : 0);
    const lat = mem.reduce((a, q, k) => a + q.lat * wn[k], 0) / sw;
    check(near(c.lon, lon, 1e-9) && near(c.lat, lat, 1e-9), 'Page style: ' + tag + ' circle ' + i + ' at the weighted center',
      [c.lon, lon, c.lat, lat]);
  });
  // Facility markers: one layer each, in the registry's order, CVI's size, edge and color, at the same places.
  const facLayers = pointLayers.slice(f.hideCircles ? 0 : 1);
  check(facLayers.length === m.facilities.length && facLayers.every((lay, i) => lay.data.length ===
    m.facilities[i].points.length && lay.data.every((d, j) => d.fill === asCvi(m.facilities[i].color) && d.size === 3 &&
    d.stroke === 0.5 && d.colour === 'white' && near(d.x, m.facilities[i].points[j].lon) &&
    near(d.y, m.facilities[i].points[j].lat))), 'map: ' + tag + ' facility markers', [facLayers.length, m.facilities.length]);
  // Name markers: CVI's names (wrapped at 22 characters) and colors, in the same order; the page's places keep
  // every name off the other names and off every marker (labels.js), with a leader line when a name moved away.
  const repel = L.find(l => l.geom === 'GeomTextRepel');
  const cviNames = repel ? repel.data.map(d => d.label + '|' + d.colour) : [];
  const pageNames = m.facilityNames.map(n => n.lines.join('\n') + '|' + n.color);
  check(same(pageNames, cviNames), 'names: ' + tag + ' names, wrapping and colors as CVI\'s', [pageNames, cviNames]);
  check(!repel || repel.data.every(d => d.fontface === 'italic' && d.size === 2.6), 'names: ' + tag + ' CVI\'s style');
  const boxes = m.facilityNames.map(n => n.at.box);
  const marks = m.facilities.flatMap(l => l.points.map(q => ({ x: q.x, y: q.y, r: BR.pointRadius(3.0, 0.5) })));
  m.facilityNames.forEach((n, i) => {
    const b = boxes[i];
    const clear = !boxes.some((o, j) => j !== i && boxesMeet(o, b)) && !marks.some(c => touches(c, b)) &&
      !m.countyNameBoxes.some(o => boxesMeet(o, b));
    check(clear === n.at.free && n.at.free, 'names: ' + tag + ' ' + n.lines.join(' ') + ' apart from names, county names and markers', b);
    const d = Math.hypot(Math.max(b.x0, Math.min(n.x, b.x1)) - n.x, Math.max(b.y0, Math.min(n.y, b.y1)) - n.y);
    check(!!n.at.leader === d > n.r + 3, 'names: ' + tag + ' ' + n.lines[0] + ' leader line when away', d);
  });
  cviBuilt.model.circles.forEach((c, i) => {
    const d = pts[i];
    check(d && near(c.lon, d.x, 1e-9) && near(c.lat, d.y, 1e-9) && near(c.size, d.size) && near(c.stroke, d.stroke) &&
      rColor(d.fill).hex === c.color.toLowerCase() && near(rColor(d.fill).alpha, c.opacity, 0.003),
    'map: ' + tag + ' circle ' + i, { page: [c.lon, c.lat, c.size, c.stroke, c.color, c.opacity], cvi: d });
  });

  // Deliberate differences.
  const ours = BR.svg(built.parts);
  const cviStyle = BR.svg(cviBuilt.parts);
  check(ours.includes('fill="#1c5a83" stroke="#ffffff"') && cviStyle.includes('fill="#1f77b4"'), 'Page style: ' + tag +
    ' inset focus color');
  const nameColor = svgText => (svgText.match(new RegExp('fill="(#[0-9a-f]{6})" text-anchor="middle" stroke="#ffffff"' +
    '[^>]*>' + BR.esc(m.names[0].name) + '<')) || [])[1];
  check(nameColor(ours) === '#222222' && nameColor(cviStyle) === '#333333', 'Page style: ' + tag + ' name color');
  const circ = m.circles.map(c => ({ x: c.x, y: c.y, r: c.r }));
  m.names.forEach(n => {
    const b = n.box;
    const blocked = circ.some(c => touches(c, b));
    check(!n.free || !blocked, 'Page style: ' + tag + ' ' + n.name + ' free of circles', b);
    if (n.moved) focusStats.namesMoved++;
    if (!n.free) focusStats.namesNotFree++;
  });
  // The steps, with the facility markers among the circles (no county: their center decides).
  const stepMarks = m.circles.map(c => ({ x: c.x, y: c.y, r: c.r, county: c.county }))
    .concat(m.facilities.flatMap(l => l.points.map(q => ({ x: q.x, y: q.y, r: BR.pointRadius(3.0, 0.5) }))));
  checkCountySteps(tag, m.names, m.names.map(n => n.box), stepMarks, BR.fitMercator(m.extent, m.mapPanel).project,
    built.parts[0]);
  const wantSizing = 'Circle size: ' + SCALE_WORDS[f.scaling] + ((f.scaling === 'quantile' || f.scaling === 'natural') &&
    !m.legend.fixed ? ', ' + tierSizes.length + ' classes' : '');
  check(ours.includes('>' + wantSizing + '<') === !f.hideCircles && !cviStyle.includes(wantSizing),
    'Page style: ' + tag + ' sizing line (none with the circles hidden)', wantSizing);
  const focusSource = 'Data: WSDA Animal Services CVI records · County boundaries: U.S. Census Bureau' +
    (streetsOn ? ' · Streets: U.S. Census Bureau TIGER/Line, USGS NHD, Natural Earth' : '');
  check(ours.includes('>' + BR.esc(focusSource) + '<') &&
    !cviStyle.includes('Data: WSDA'), 'Page style: ' + tag + ' source line');
  const lc = m.legendCircles;
  let apart = true;
  for (let i = 1; i < lc.length; i++) {
    if (Math.hypot(lc[i].x - lc[i - 1].x, lc[i].y - lc[i - 1].y) < lc[i].r + lc[i - 1].r - 1e-9) apart = false;
  }
  if (m.legendOverlap) focusStats.overlapping++;
  if (m.legendAcross) focusStats.across++;
  // Side by side only when the circles fit across the box.
  const inner = BR.px(BR.LAYOUT.gutterW) - 10;
  const acr = lc.filter(c => c.across);
  check(!m.legendAcross || (acr.length === tierSizes.length && Math.max(...acr.map(c => c.x + c.r)) -
    Math.min(...acr.map(c => c.x - c.r)) <= inner + 1e-9), 'Page style: ' + tag + ' circles side by side only when they fit');
  check(apart !== m.legendOverlap, 'Page style: ' + tag + ' circles apart, or overlap reported', { overlap: m.legendOverlap, h: m.legendHeight, c: lc.map(x => [x.y, x.r]) });
  // The grouping note's lines inside the legend box (CVI's place in CVI's style), the box below the Top box.
  if (m.grouped.note.length) {
    check(m.grouped.noteY === null && m.grouped.note.every(t => ours.includes('>' + BR.esc(t) + '<')) &&
      cviBuilt.model.grouped.noteY === 0.42, 'Page style: ' + tag + ' grouping note in the legend box');
  }
  check(m.legendY + m.legendHeight <= m.topY - 0.008 + 1e-9, 'Page style: ' + tag + ' legend below the Top box',
    [m.legendY + m.legendHeight, m.topY]);
}

// ── One Facilities scenario (the Infrastructure dashboard) ──────────────────────────────────────────────────────
const FAC_WA = path.join(ORACLE, 'facilities-wa');
let facPrepared = null;
function facilitiesPrepared() {
  if (facPrepared) return facPrepared;
  const files = {};
  for (const l of W.facilities.BUILTIN) {
    const f = path.join(FAC_WA, l.file);
    if (fs.existsSync(f)) files[l.key] = W.csv.parse(fs.readFileSync(f, 'utf8'));
  }
  facPrepared = W.facilities.prepare(files, null, sandbox.window.CVIWA_GEO.counties, 1);
  return facPrepared;
}
const facStats = { scenarios: 0, namesDropped: 0, namesCvi: 0, namesPage: 0, overlapCvi: 0, overlapPage: 0 };
const hexA = c => rColor(c);
function checkFacilities(fx, name, rec, master, universe, anchorsRef) {
  const tag = 'facilities ' + fx + ' ' + name;
  const inp = rec.inputs;
  const keys = list(inp.overlay_layers);
  const picked = list(inp.fac_county);
  // The dashboard's layers: its registry order, its county filter.
  const prepared = facilitiesPrepared();
  const sel = W.facilities.select(prepared, { layers: keys, attributes: {},
    geometry: p => !picked.length || picked.includes(p.county) });
  const ref = rec.render ? rec.render.layers : null;
  if (ref) {
    for (const k of keys) {
      const ours = sel.layers.find(l => l.key === k);
      const theirs = list(ref[k]);
      check(ours && ours.points.length === theirs.length, 'layers: ' + tag + ' ' + k + ' rows',
        [ours && ours.points.length, theirs.length]);
      if (!ours) continue;
      const kk = p => [p.name, Number(p.lon).toFixed(5), Number(p.lat).toFixed(5)].join('|');
      const theirsBy = new Map(theirs.map(t => [kk(t), t]));
      for (const p of ours.points) {
        const t = theirsBy.get(kk(p));
        check(t && t.geo_source === p.geoSource && (t.county || null) === (p.county || null),
          'layers: ' + tag + ' ' + k + ' ' + p.name, { page: [p.geoSource, p.county], cvi: t });
      }
    }
  }
  const on = inp.facilities_show_cvi === true;
  const f = { species: list(inp.facilities_species), years: list(inp.facilities_year).map(Number),
    quarters: list(inp.facilities_quarter), rawSpecies: list(inp.facilities_species_sub),
    direction: ['Inbound', 'Outbound'], mode: 'side_by_side', scaling: inp.facilities_scaling,
    nBins: Number(inp.facilities_n_bins) };
  const rows = on ? W.aggregate.build(master.rows, Object.assign({}, f, { hasSpecies: master.hasSpecies })) : [];
  if (on && rec.render) {
    const cd = list(rec.render.cvi_circle_df);
    check(rows.length === cd.length, 'activity: ' + tag + ' circles', [rows.length, cd.length]);
    const key = r => r.county + '|' + r.direction;
    const byKey = new Map(rows.map(r => [key(r), r]));
    for (const c of cd) {
      const r = byKey.get(key(c));
      check(r && near(r.lat, c.lat) && near(r.lon, c.lon) && near(r.total_animals, c.total_animals) &&
        near(r.radius_px, c.radius_px), 'activity: ' + tag + ' ' + key(c));
    }
  }
  const input = {
    layers: sel.layers, counties: COUNTIES, picked, view: inp.facilities_png_view, ramp: inp.facilities_choro_palette,
    chrome: inp.facilities_output_style, nameLayers: list(inp.export_overlay_label_layers),
    activity: on ? { rows, f, universe, palette: 'WSDA Default', opacity: Number(inp.facilities_opacity) } : null,
    period: { years: f.years, quarters: f.quarters }, title: inp.export_title, date: new Date(2026, 9, 12),
    background: 'standard', labelStyle: 'auto', boundaryStyle: 'auto'
  };
  const cviBuilt = IB.facilities(input, BR.CVI_STYLE);
  const built = IB.facilities(input);
  const m = cviBuilt.model;
  facStats.scenarios++;

  if (!rec.render || !rec.saved) {
    // CVI stops when every populated county has the same count; the page draws one class.
    const stop = list(rec.notes).some(n => /invalid number of intervals/.test(n.text));
    check(stop && m.choro && m.choro.single && m.choro.labels.length === 1 && m.choro.colors.length === 1,
      'Facilities: ' + tag + ' CVI stops, the page draws one class', { notes: rec.notes, labels: m.choro && m.choro.labels });
    return;
  }
  const report = inp.facilities_output_style === 'report';
  const page = report ? BR.REPORT_PAGE : BR.PAGE;
  check(rec.saved.width_in === page.widthIn && rec.saved.height_in === page.heightIn && rec.saved.dpi === 200,
    'page: ' + tag + ' size and dpi', rec.saved);
  check(same(BR.pixelSize(200, page), rec.png), 'page: ' + tag + ' PNG pixel size', rec.png);
  check(m.fileName === rec.saved.file, 'page: ' + tag + ' file name', [m.fileName, rec.saved.file]);
  check(m.coverage === rec.render.view_used, 'view: ' + tag + ' coverage drawn', [m.coverage, rec.render.view_used]);
  const notice = list(rec.notes).find(n => /Density \(choropleth\)/.test(n.text));
  check((notice ? notice.text : null) === m.notice, 'view: ' + tag + ' fallback notice', [m.notice, notice]);

  const ps = plots(rec);
  const labels = labelsOf(rec);
  const mapPlot = ps[0];
  // The map's region and extent (the same box, drawn in Web Mercator).
  const fr = BR.frame(page);
  const mp = m.mapPanel;
  check(near(mp.left / fr.W, mapPlot.x, 1e-9) && near(mp.width / fr.W, mapPlot.width, 1e-9) &&
    near(1 - (mp.top + mp.height) / fr.H, mapPlot.y, 1e-9) && near(mp.height / fr.H, mapPlot.height, 1e-9),
  'map: ' + tag + ' region', [mp, mapPlot.x, mapPlot.y, mapPlot.width, mapPlot.height]);
  check(near(m.extent.west, mapPlot.plot.x_range[0], 1e-9) && near(m.extent.east, mapPlot.plot.x_range[1], 1e-9) &&
    near(m.extent.south, mapPlot.plot.y_range[0], 1e-9) && near(m.extent.north, mapPlot.plot.y_range[1], 1e-9),
  'map: ' + tag + ' extent', [m.extent, mapPlot.plot.x_range, mapPlot.plot.y_range]);
  const L = mapPlot.plot.layers;
  const counties = L[0].data;
  check(L[0].rows === COUNTIES.length, 'map: ' + tag + ' counties');
  check(counties.every(c => c.colour === '#ffffff' && c.linewidth === (m.choro ? 0.4 : 0.5)),
    'map: ' + tag + ' county lines');

  // Header or Report title, rows.
  if (report) {
    const t = labels.find(l => l.size === 13);
    check(t && t.label === m.title && t.fontface === 'bold' && t.color === '#222222', 'title: ' + tag, [m.title, t]);
    const cap = labels.find(l => l.size === 7);
    check(cap && cap.label === m.caption && cap.color === '#777777', 'caption: ' + tag, [m.caption, cap && cap.label]);
    // In the page's style the caption names a period only with CVI activity.
    const period = /^CY /.test(built.model.caption);
    check(period === on && built.model.caption.endsWith(m.caption.replace(/^CY [^|]*\|\s+/, '')),
      'Facilities: ' + tag + ' caption period only with CVI activity', [built.model.caption, on]);
  } else {
    const ht = texts(ps[1]);
    check(ht[2].label === m.title && ht[2].size === m.titleSize, 'title: ' + tag, [m.title, ht[2].label]);
    const up = labels.find(l => /^Last Updated/.test(l.label));
    check(up && up.label === m.updated && up.color === '#777777' && near(up.x, 0.765), 'meta: ' + tag + ' Last Updated');
    const pre = labels.find(l => /^CY /.test(l.label));
    check(m.period ? pre && pre.label === m.period.prefix && labels.some(l => l.label === m.period.value) : !pre,
      'meta: ' + tag + ' period', [m.period, pre]);
    // The tile grid.
    const grid = ps[2];
    check(near(grid.x, 0.005) && near(grid.y, m.grid.bottom, 1e-9) && near(grid.height, m.grid.top - m.grid.bottom, 1e-9) &&
      near(mapPlot.height, m.grid.mapH, 1e-9), 'tiles: ' + tag + ' region', [grid, m.grid]);
    const rects = grid.plot.layers[0].data;
    const vals = grid.plot.layers[1].data;
    const labs = grid.plot.layers[2].data;
    check(rects.length === m.tilesDrawn.length, 'tiles: ' + tag + ' count', [rects.length, m.tilesDrawn.length]);
    m.tilesDrawn.forEach((t, i) => {
      // Null-safe: a tile CVI does not draw fails here rather than stopping the run.
      const rect = rects[i] || {};
      const val = (vals[i] || {}).label;
      const lab = (labs[i] || {}).label;
      check(rects[i] && rect.fill.toLowerCase() === asCvi(t.color) && val === t.value && lab === t.label,
        'tiles: ' + tag + ' ' + t.label, { page: t, cvi: [rects[i], val, lab] });
      const gw = 0.76 * fr.W;
      check(near(t.x, fr.px(0.005) + rect.xmin * gw, 1e-6) && near(t.width, (rect.xmax - rect.xmin) * gw, 1e-6),
        'tiles: ' + tag + ' ' + t.label + ' place');
    });
  }

  if (m.choro) {
    // Density: each county's fill, the class colors and labels in the legend.
    COUNTIES.forEach((c, i) => check(m.choro.fills[i].toLowerCase() === String(counties[i].fill).toLowerCase(),
      'density: ' + tag + ' ' + c.properties.name + ' fill', [m.choro.fills[i], counties[i].fill]));
    const named = L[1] ? L[1].data.map(d => d.label) : [];
    const ours = m.names.filter(n => !n.dropped).map(n => n.lines.join('\n'));
    facStats.namesCvi += named.length;
    facStats.namesPage += ours.length;
    facStats.namesDropped += m.names.filter(n => n.dropped).length;
    check(ours.every(t => m.names.some(n => n.lines.join('\n') === t)) && named.every(t => ours.includes(t) ||
      m.names.some(n => n.dropped && n.lines.join('\n') === t)), 'density: ' + tag + ' names', { cvi: named, page: ours });
    check(L[1] ? L[1].data.every(d => d.colour === '#3a3a3a' && d.size === 2.9 * (report ? 0.6 : 1)) : true,
      'density: ' + tag + ' name color and size');
    check(m.nameColor === '#3a3a3a' && built.model.nameColor === '#222222', 'Page style: ' + tag + ' density names');
    // In the page's style each class is labeled by the counts its counties hold (worked out here from the
    // counts and CVI's classes); CVI's style keeps CVI's labels.
    const want = m.choro.labels.map((l, k) => {
      const held = m.choro.counts.filter((c, i) => m.choro.classOf[i] === k + 1);
      const lo = Math.min(...held);
      const hi = Math.max(...held);
      return lo === hi ? String(lo) : lo + ' – ' + hi;
    });
    const pageLegend = built.model.legend.entries.filter(e => e.swatch).map(e => e.label);
    check(same(built.model.choro.labels, want) && same(pageLegend.slice(0, -1), want) &&
      same(m.choro.labels, m.choro.cviLabels), 'Facilities: ' + tag + ' classes labeled by their counts',
    { page: built.model.choro.labels, want, cvi: m.choro.labels });
  } else {
    // Locations: the CVI circles, then each layer's circles in CVI's order.
    const sf = L.filter(l => l.geom === 'GeomSf').slice(1);
    let k = 0;
    if (m.cvi.length) {
      const cl = sf[k++].data;
      check(cl.length === m.cvi.length, 'cvi: ' + tag + ' circles', [cl.length, m.cvi.length]);
      cl.forEach((c, i) => {
        const o = m.cvi[i];
        const fc = hexA(c.fill);
        check(o && near(o.lon, c.x) && near(o.lat, c.y) && near(o.size, c.size) && near(o.stroke, c.stroke) &&
          fc.hex === o.fill.toLowerCase() && near(fc.alpha, o.opacity, 0.003), 'cvi: ' + tag + ' circle ' + i,
        { page: o, cvi: c });
      });
    }
    const gl = m.glyphs ? m.glyphs.layers : [];
    check(sf.length - k === gl.length, 'glyphs: ' + tag + ' layers', [sf.length - k, gl.length]);
    gl.forEach((g, j) => {
      const d = (sf[k + j] || { data: [] }).data;
      check(d.length === g.rows.length, 'glyphs: ' + tag + ' ' + g.key + ' rows', [d.length, g.rows.length]);
      const order = a => a.slice().sort((p, q) => p.x - q.x || p.y - q.y);
      const theirs = order(d);
      const ours = order(g.rows.map(r => ({ x: r.lon, y: r.lat, size: r.size, stroke: r.stroke })));
      ours.forEach((o, i) => {
        const c = theirs[i] || {};
        const fc = hexA(c.fill || '');
        check(near(o.x, c.x, 1e-7) && near(o.y, c.y, 1e-7) && near(o.size, c.size) && near(o.stroke, c.stroke) &&
          fc.hex === asCvi(g.color) && near(fc.alpha, 0.7, 0.003) && c.colour === 'white',
        'glyphs: ' + tag + ' ' + g.key + ' circle ' + i, { page: o, cvi: c });
      });
    });
    // County names: which, and CVI's place in CVI's style.
    const shadow = L.find(l => l.geom === 'GeomShadowText');
    const named = shadow ? shadow.data : [];
    check(named.length === m.names.length && named.every(n => m.names.some(o => o.county === n.label &&
      near(o.x, BR.fitMercator(m.extent, mp).project(n.x, n.y)[0], 1e-6) &&
      near(o.y, BR.fitMercator(m.extent, mp).project(n.x, n.y)[1], 1e-6))), 'names: ' + tag + ' counties at CVI\'s place',
    { cvi: named.map(n => n.label), page: m.names.map(n => n.county) });
    check(named.every(n => n.colour === '#8a8a8a' && near(n.size, 3.2 * (report ? 0.6 : 1))) && m.nameColor === '#8a8a8a',
      'names: ' + tag + ' color and size');
    const pm = built.model;
    check(pm.nameColor === '#222222', 'Page style: ' + tag + ' county names');
    facStats.namesPage += pm.names.length;
    facStats.namesCvi += named.length;
    // Name markers: the lone facilities of the picked layers.
    const rep = L.find(l => l.geom === 'GeomTextRepel');
    const theirs = rep ? rep.data.map(d => d.label + '|' + String(d.colour).toLowerCase()).sort() : [];
    const ours = m.markerNames.map(n => n.lines.join(' ') + '|' + n.color.toLowerCase()).sort();
    check(same(ours, theirs), 'markers: ' + tag + ' names and colors', { page: ours, cvi: theirs });
    check(!rep || rep.data.every(d => d.fontface === 'bold' && d.size === 2.8), 'markers: ' + tag + ' bold 2.8');
  }

  // The legend: every entry at CVI's place (CVI's style).
  const legendPlot = ps.find(p => p.plot.background && p.plot.background.colour === '#bbbbbb');
  const lw = report ? 0.25 : 0.205;
  check(legendPlot && near(legendPlot.width, lw) && near(legendPlot.height, report ? 0.5 : 0.76) &&
    near(legendPlot.y, report ? 0.395 : 0.045), 'legend: ' + tag + ' region', legendPlot && [legendPlot.x, legendPlot.y]);
  const cviItems = [];
  for (const l of legendPlot.plot.layers) {
    const d = l.data[0];
    if (l.geom === 'GeomText') cviItems.push({ kind: 'text', label: d.label, y: d.y, size: d.size, color: d.colour });
    else if (l.geom === 'GeomPoint') cviItems.push({ kind: 'point', x: d.x, y: d.y, size: d.size, stroke: d.stroke,
      fill: hexA(d.fill) });
    else if (l.geom === 'GeomRect') cviItems.push({ kind: 'rect', y: (d.ymin + d.ymax) / 2, fill: String(d.fill).toLowerCase() });
    else if (l.geom === 'GeomSegment') cviItems.push({ kind: 'rule', y: d.y });
  }
  const pageItems = [];
  for (const e of m.legend.entries) {
    if (e.pageOnly) continue;
    if (e.rule) pageItems.push({ kind: 'rule', y: e.y });
    else if (e.lines) pageItems.push({ kind: 'text', label: e.lines.join('\n'), y: e.y, pt: e.pt, color: e.color });
    else if (e.text !== undefined) pageItems.push({ kind: 'text', label: asCviText(e.text), y: e.y, pt: e.pt, color: e.color });
    else if (e.circle) {
      pageItems.push({ kind: 'point', x: e.x, y: e.y, size: e.circle.size, stroke: e.circle.stroke,
        fill: { hex: asCvi(e.circle.fill), alpha: e.circle.opacity } });
      pageItems.push({ kind: 'text', label: e.label, y: e.y, pt: e.labelPt, color: '#444444' });
    } else if (e.swatch) {
      pageItems.push({ kind: 'rect', y: e.y, fill: e.swatch.fill.toLowerCase() });
      pageItems.push({ kind: 'text', label: e.label, y: e.y, pt: e.labelPt, color: '#444444' });
    }
  }
  check(pageItems.length === cviItems.length, 'legend: ' + tag + ' entries', [pageItems.length, cviItems.length]);
  cviItems.forEach((c, i) => {
    const o = pageItems[i] || {};
    let ok = o.kind === c.kind && near(o.y, c.y, 1e-9);
    if (c.kind === 'text') ok = ok && o.label === c.label && near(o.pt, BR.textPt(c.size), 1e-9) && o.color === c.color;
    if (c.kind === 'point') ok = ok && near(o.x, c.x) && near(o.size, c.size, 1e-9) && near(o.stroke, c.stroke) &&
      o.fill.hex === c.fill.hex && near(o.fill.alpha, c.fill.alpha, 0.003);
    if (c.kind === 'rect') ok = ok && o.fill === c.fill;
    check(ok, 'legend: ' + tag + ' entry ' + i + ' ' + (c.label || c.kind), { page: o, cvi: c });
  });
  if (m.legend.overlap) facStats.overlapCvi++;
  if (built.model.legend.overlap) facStats.overlapPage++;
  // The page's legend never has touching samples.
  check(!built.model.legend.overlap, 'Page style: ' + tag + ' legend samples apart', built.model.legend.rows);

  // The page's own differences: the agency name and grays (branded), the source line.
  const svgPage = BR.svg(built.parts, null, { page }).replace(/\s+/g, ' ');
  const svgCvi = BR.svg(cviBuilt.parts, null, { page });
  if (!report) {
    check(svgPage.includes(BR.AGENCY) && !svgCvi.includes(BR.AGENCY), 'Page style: ' + tag + ' agency name');
    check(svgPage.includes('#555555" font-style="italic"') || svgPage.includes('fill="#555555" font-style="italic"'),
      'Page style: ' + tag + ' Last Updated darker');
    check(built.model.source && svgPage.includes(BR.esc(built.model.source)) && !cviBuilt.model.source,
      'Page style: ' + tag + ' source line');
  } else {
    check(svgPage.includes('fill="#666666"') && !svgPage.includes(BR.AGENCY), 'Page style: ' + tag + ' caption darker, no header');
  }
  // CVI's county anchors.
  if (anchorsRef && name === 'density') {
    const ours = IB.anchors(COUNTIES);
    for (const a of anchorsRef) {
      const o = ours.get(a.name);
      check(o && near(o.lon, a.lon, 1e-7) && near(o.lat, a.lat, 1e-7), 'anchors: ' + a.name, { page: o, cvi: a });
    }
  }
}

// ── Town names (the facility files' town column is kept) ─────────────────────────────────────────────────────────
// The dashboard's reader keeps CVI's town column; a lone town-level facility in a name-marker layer is named by its
// town, a town of two is not, and a town without a name (only its place) is not.
function checkTownNames() {
  const prepared = facilitiesPrepared();
  const markets = prepared.layers.find(l => l.key === 'markets');
  const towns = markets.points.filter(p => p.geoSource === 'google_city');
  check(towns.length === 2 && towns.every(p => p.townName === 'Synthetic Town') &&
    markets.points.filter(p => p.geoSource !== 'google_city').every(p => p.townName === ''),
  'towns: the reader keeps the city column', towns.map(p => p.townName));
  const base = { lon: -120.5, lat: 47.0, geoSource: 'google_city', county: 'Kittitas', name: 'Synthetic Lone Market' };
  const layer = pts => ({ key: 'markets', label: 'Markets', color: '#f07325', points: pts });
  const drawn = pts => IB.facilities({ layers: [layer(pts)], counties: COUNTIES, picked: [], view: 'locations',
    ramp: 'blue', chrome: 'branded', nameLayers: ['markets'], activity: null, period: null, title: '',
    date: new Date(2026, 9, 12), background: 'standard' }).model.markerNames.map(n => n.lines.join(' '));
  check(same(drawn([Object.assign({ townName: 'Synthetic Town' }, base)]), ['Synthetic Town']),
    'towns: a lone town-level facility named by its town');
  check(same(drawn([Object.assign({ townName: 'Synthetic Town' }, base), Object.assign({ townName: '' }, base)]), []),
    'towns: a town of two is not named');
  check(same(drawn([Object.assign({ townName: '' }, base)]), []), 'towns: a town known only by its place is not named');
}

// ── The Facilities cluster legend and the Density rule ────────────────────────────────────────────────────────────
// The Locations "Cluster size" legend shows every circle size drawn, labeled by the counts those circles hold.
// Each size is the largest count it holds, area in proportion: max(3, 15 * sqrt(count / top)); one size alone
// is CVI's 9. Worked out here from the circles drawn, not from the page's classes. The Density rule: Density applies
// with exactly one layer with placed facilities and CVI activity off.
function checkClusterLegend() {
  const names = COUNTIES.map(f => f.properties.name).sort();
  // A layer with the given count of facilities in each of the first counties.
  const layerOf = (key, counts) => ({ key, label: key, color: '#0097a7', points: counts.flatMap((n, i) =>
    Array.from({ length: n }, (_, k) => ({ name: key + ' ' + i + '.' + k, lon: -120.5, lat: 47.0, geoSource: 'existing',
      county: names[i] }))) });
  const build = (counts, style) => IB.facilities({ layers: [layerOf('feedlots', counts)], counties: COUNTIES,
    picked: [], view: 'locations', ramp: 'blue', chrome: 'branded', nameLayers: [], activity: null, period: null,
    title: '', date: new Date(2026, 9, 13), background: 'standard' }, style);
  const cases = { tier_full: [1, 1, 1, 1, 1, 2], wide: [1, 2, 2, 3, 5, 8, 13, 21, 40, 40], ones: [1, 1, 1],
    three: [1, 2, 3], gap: [1, 1, 1, 30] };
  for (const [tag, counts] of Object.entries(cases)) {
    const built = build(counts);
    const g = built.model.glyphs;
    const rows = g.layers.flatMap(l => l.rows);
    check(same(rows.map(r => r.n).sort((a, b) => a - b), counts.slice().sort((a, b) => a - b)),
      'Facilities: ' + tag + ' one circle per county', rows.map(r => r.n));
    // The circles grouped by the size they are drawn at, smallest first.
    const bySize = new Map();
    for (const r of rows) bySize.set(r.size, (bySize.get(r.size) || []).concat(r.n));
    const groups = [...bySize.entries()].sort((a, b) => a[0] - b[0]);
    const label = h => (Math.min(...h) === Math.max(...h) ? String(h[0]) : Math.min(...h) + ' – ' + Math.max(...h));
    const top = Math.max(...counts);
    const wantSize = h => (groups.length === 1 ? 9 : Math.max(3, 15 * Math.sqrt(Math.max(...h) / top)));
    const leg = g.classes.legend;
    check(same(leg.labels, groups.map(([, h]) => label(h))), 'Facilities: ' + tag + ' legend labels the counts each size holds',
      { legend: leg.labels, drawn: groups.map(([sz, h]) => [sz, h]) });
    check(leg.sizes.length === groups.length && groups.every(([sz, h], i) => near(leg.sizes[i], sz, 1e-12) &&
      near(sz, wantSize(h), 1e-12)), 'Facilities: ' + tag + ' sizes by the largest count, area in proportion',
    { legend: leg.sizes, want: groups.map(([, h]) => wantSize(h)) });
    // Ranges apart: no count in two sizes.
    check(groups.every(([, h], i) => i === 0 || Math.min(...h) > Math.max(...groups[i - 1][1])),
      'Facilities: ' + tag + ' sizes hold count ranges apart');
    // The legend drawn: its sample rows after the layer rows, with these labels and sizes.
    const samples = built.model.legend.entries.filter(e => e.circle && e.circle.fill === '#888888');
    check(same(samples.map(e => e.label), leg.labels) && samples.every((e, i) => near(e.circle.size, leg.sizes[i], 1e-12)),
      'Facilities: ' + tag + ' the legend drawn as worked out', samples.map(e => [e.label, e.circle.size]));
  }
  // CVI's style keeps CVI's rule: with counts 1 and 2, one entry "2" at the smallest size, circles 3 and 15.
  const cvi = build(cases.tier_full, BR.CVI_STYLE).model.glyphs;
  check(same(cvi.classes.legend.labels, ['2']) && same(cvi.classes.legend.sizes, [3]) &&
    same([...new Set(cvi.layers[0].rows.map(r => r.size))].sort((a, b) => a - b), [3, 15]),
  'Facilities: CVI\'s style keeps CVI\'s legend ("2" at size 3) and even sizes', cvi.classes.legend);

  // The Density rule.
  const one = layerOf('feedlots', [1, 2]);
  const two = layerOf('markets', [1]);
  const none = Object.assign(layerOf('restricted', [1]), {});
  none.points = none.points.map(p => Object.assign({}, p, { geoSource: 'none' }));
  check(IB.densityApplies([one], false) && !IB.densityApplies([one, two], false) && !IB.densityApplies([one], true) &&
    !IB.densityApplies([], false) && IB.densityApplies([one, none], false),
  'Facilities: Density applies with one layer with placed facilities and CVI activity off');
  const fallback = IB.facilities({ layers: [one, two], counties: COUNTIES, picked: [], view: 'density', ramp: 'blue',
    chrome: 'branded', nameLayers: [], activity: null, period: null, title: '', date: new Date(2026, 9, 13),
    background: 'standard' }).model;
  check(fallback.coverage === 'locations' && fallback.fallback, 'Facilities: the picture follows the same rule', fallback.coverage);
}

// ── Legend spacing, county names, the sizing line and the source line ───────────────────────────────────────────
// The tallest legend box: from 0.045 up to 0.008 below the Top 3 box (page fractions).
const LEGEND_MAX = 1 - BR.LAYOUT.headerH - 0.020 - 0.285 - 0.008 - 0.045;
const SCALE_WORDS = { log: 'log scale', sqrt: 'square-root scale', linear: 'linear scale', quantile: 'quantiles',
  natural: 'natural breaks' };
// Does a circle touch a box?
function touches(c, b) {
  const dx = c.x - Math.max(b.x0, Math.min(c.x, b.x1));
  const dy = c.y - Math.max(b.y0, Math.min(c.y, b.y1));
  return dx * dx + dy * dy < c.r * c.r;
}
const boxesMeet = (a, b) => Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) && Math.min(a.y1, b.y1) > Math.max(a.y0, b.y0);
const legendStats = { boxes: 0, overlapping: 0, names: 0, notFree: 0, onNames: 0 };

// The name placement order (county names stay in their county). Each name records the step
// that placed it: (a) free with the whole name inside its county, (b) inside its county over its own circles only,
// drawn on top of them, (c) free but partly or wholly outside, (d) the least crowded place. Checked here with the
// test's own point-in-polygon on the projected county shape: a and b put the name's middle and both ends inside; b
// touches at least one circle, only circles of its own county (by the circle's county, else its center), and no name
// placed before it (other counties' circles only when it is marked overOthers), and its text comes after the last
// circle in the map's markup; a is free. Known examples
// ("Kittitas" in Grant, "Walla Walla" under Benton's circles) must now be inside their counties.
const p2Stats = { names: 0, a: 0, b: 0, c: 0, d: 0, overOthers: 0 };
function insideProjected(feature, project, x, y) {
  const polys = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  let hit = false;
  for (const poly of polys) {
    for (const ring of poly) {
      const pts = ring.map(c => project(c[0], c[1]));
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        if ((pts[i][1] > y) !== (pts[j][1] > y) &&
          x < (pts[j][0] - pts[i][0]) * (y - pts[i][1]) / (pts[j][1] - pts[i][1]) + pts[i][0]) hit = !hit;
      }
    }
  }
  return hit;
}
function checkCountySteps(tag, places, boxes, circles, project, mapSvg) {
  const featureOf = name => COUNTIES.find(c => c.properties.name.toLowerCase() === String(name).toLowerCase());
  const lastCircle = mapSvg.lastIndexOf('<circle');
  places.forEach((l, i) => {
    const b = boxes[i];
    const f = featureOf(l.name);
    const y = (b.y0 + b.y1) / 2;
    const whole = !!f && [l.x, b.x0, b.x1].every(x => insideProjected(f, project, x, y));
    p2Stats.names++;
    p2Stats[l.step]++;
    check(['a', 'b', 'c', 'd'].indexOf(l.step) >= 0 && l.over === (l.step === 'b'), 'Page style: ' + tag + ' ' + l.name +
      ' step recorded', [l.step, l.over]);
    if (l.step === 'a') check(l.free && whole, 'Page style: ' + tag + ' ' + l.name + ' free and inside its county', b);
    if (l.step === 'b') {
      const hit = circles.filter(c => touches(c, b));
      const own = c => (c.county === undefined || c.county === null ? !!f && insideProjected(f, project, c.x, c.y)
        : String(c.county).toLowerCase() === l.name.toLowerCase());
      // Over its own circles only, unless marked overOthers (no such place inside: then neighbors' circles too).
      check(whole && hit.length > 0 && hit.every(own) === !l.overOthers && !boxes.some((o, j) => j < i && boxesMeet(o, b)),
        'Page style: ' + tag + ' ' + l.name + ' inside its county, over circles (its own only unless marked)', [b, l.overOthers]);
      if (l.overOthers) p2Stats.overOthers++;
      const at = mapSvg.indexOf('>' + BR.esc(l.name) + '</text>', lastCircle);
      check(lastCircle >= 0 && at > lastCircle, 'Page style: ' + tag + ' ' + l.name + ' drawn on top of the circles');
    }
    if (/^(kittitas|walla walla)$/i.test(l.name) && tag.indexOf('wa tier_full') === 0) {
      check(l.step === 'a' || l.step === 'b', 'Page style: ' + tag + ' ' + l.name + ' kept in its county (known example)',
        l.step);
    }
  });
}
function checkMapAdditions(tag, m, ours, cviStyle, cviModel, legendPlot, scaling, mapSvg) {
  // Sample circles one below the other without overlapping, sizes as CVI's (checked above on m.legend), the
  // box at least CVI's height and at most the tallest; when they cannot fit, the box is at its tallest.
  const lc = m.legendCircles;
  const wantN = m.legend.kind === 'split' ? m.legend.sections.reduce((s, x) => s + x.labels.length, 0)
    : m.legend.labels.length;
  check(lc.length === wantN, 'Page style: ' + tag + ' every sample circle drawn', [lc.length, wantN]);
  let apart = true;
  for (let i = 1; i < lc.length; i++) {
    if (lc[i].y - lc[i - 1].y < lc[i].r + lc[i - 1].r - 1e-9) apart = false;
  }
  legendStats.boxes++;
  if (m.legendOverlap) legendStats.overlapping++;
  check(apart !== m.legendOverlap, 'Page style: ' + tag + ' circles apart, or overlap reported', { apart, m: m.legendOverlap });
  check(!m.legendOverlap || near(m.legendHeight, LEGEND_MAX), 'Page style: ' + tag + ' overlap only in the tallest box',
    m.legendHeight);
  check(m.legendHeight >= cviModel.legendHeight - 1e-9 && m.legendHeight <= LEGEND_MAX + 1e-9,
    'Page style: ' + tag + ' box between CVI\'s height and the tallest', [m.legendHeight, cviModel.legendHeight]);
  const boxTop = BR.py(0.045 + m.legendHeight);
  const boxBottom = BR.py(0.045);
  check(lc.every(c => c.y - c.r >= boxTop - 1e-6 && c.y + c.r <= boxBottom + 1e-6),
    'Page style: ' + tag + ' circles inside the box');
  // CVI's style keeps CVI's evenly spaced rows.
  const cl = cviModel.legendCircles;
  const steps = cl.slice(1).map((c, i) => c.y - cl[i].y);
  const sections = m.legend.kind === 'split' ? 2 : 1;
  check(cl.length === wantN && new Set(steps.map(x => x.toFixed(6))).size <= 2 * sections,
    'Page style: ' + tag + ' CVI\'s style spaces rows evenly', steps);

  // Names near-black, CVI's gray in CVI's style.
  const nameFill = svgText => (svgText.match(new RegExp('fill="(#[0-9a-f]{6})" text-anchor="middle" stroke="#ffffff"' +
    '[^>]*>' + BR.esc(m.labels[0]) + '<')) || [])[1];
  if (m.labels.length) {
    check(nameFill(ours) === '#222222' && nameFill(cviStyle) === '#8a8a8a', 'Page style: ' + tag + ' name color',
      [nameFill(ours), nameFill(cviStyle)]);
  }

  // A name marked free touches no circle, no name placed before it and stays on the map below the stat row;
  // a name not marked free does touch one of them (it had no free place).
  const circles = m.circles.map(c => ({ x: c.x, y: c.y, r: BR.pointRadius(c.size, c.stroke) }));
  const pt = BR.textPt(3.2);
  const boxes = m.labelPlaces.map(l => {
    const w = BR.textWidth(l.name, pt) + 2;
    const h = pt * 0.95;
    return { x0: l.x - w / 2, x1: l.x + w / 2, y0: l.y - h / 2, y1: l.y + h / 2 };
  });
  const a = m.labelArea;
  check(a.y0 >= BR.py(BR.LAYOUT.statY) && a.x1 <= BR.px(BR.LAYOUT.mapW), 'Page style: ' + tag + ' names kept on the map', a);
  m.labelPlaces.forEach((l, i) => {
    const b = boxes[i];
    const blocked = circles.some(c => touches(c, b)) || boxes.some((o, j) => j < i && boxesMeet(o, b)) ||
      b.x0 < a.x0 || b.x1 > a.x1 || b.y0 < a.y0 || b.y1 > a.y1;
    legendStats.names++;
    if (!l.free) legendStats.notFree++;
    if (boxes.some((o, j) => j < i && boxesMeet(o, b))) legendStats.onNames++;
    check(blocked === !l.free, 'Page style: ' + tag + ' ' + l.name + (l.free ? ' free' : ' marked not free'), b);
  });
  const waFit = BR.fitMercator(m.extent, BR.panel(0, 0, BR.LAYOUT.mapW, 1 - BR.LAYOUT.headerH, 0));
  checkCountySteps(tag, m.labelPlaces, boxes, m.circles.map(c => ({ x: c.x, y: c.y, r: BR.pointRadius(c.size, c.stroke),
    county: c.county })), waFit.project, mapSvg);

  // The sizing line, from CVI's own legend: the scaling's words and, for classes, CVI's circle count.
  const pts = pointsOf(legendPlot);
  const fixed = texts(legendPlot).some(t => t.label === '< 100');
  let want = 'Circle size: ' + SCALE_WORDS[scaling];
  if ((scaling === 'quantile' || scaling === 'natural') && !fixed) {
    const counts = m.legend.kind === 'split' ? m.legend.sections.map(x => x.labels.length) : [pts.length];
    if (m.legend.kind === 'split') check(counts[0] + counts[1] === pts.length, 'Page style: ' + tag + ' class counts');
    const lo = Math.min(...counts);
    const hi = Math.max(...counts);
    want += ', ' + (lo === hi ? hi + ' classes' : lo + ' to ' + hi + ' classes');
  }
  check(ours.includes('>' + want + '<') && !cviStyle.includes('>' + want + '<'), 'Page style: ' + tag + ' sizing line', want);

  // The source line at the bottom left, in the darker gray; none in CVI's style (no tiles on Default).
  const source = 'Data: WSDA Animal Services CVI records · County boundaries: U.S. Census Bureau';
  const at = ours.match(/<text x="([0-9.]+)" y="([0-9.]+)" font-size="6.5" fill="(#[0-9a-f]{6})" font-style="italic">([^<]*)</);
  check(at && at[4] === BR.esc(source) && near(Number(at[1]), 0.005 * BR.W, 0.01) && at[3] === '#666666' &&
    Number(at[2]) > BR.H - 8, 'Page style: ' + tag + ' source line', at);
  check(!cviStyle.includes('Data: WSDA'), 'Page style: ' + tag + ' no source line in CVI\'s style');
}


// ── The time-series GIF (S10) ─────────────────────────────────────────────────────────────────────────────────────
// A GIF89a reader written from the specification (independent of gif.js): the logical screen, the NETSCAPE2.0 loop
// count, and per frame its graphic control (disposal, delay), its descriptor, its local color table and its pixels
// (the LZW decoded with the code size growing when the next code reaches 2^size, and the clear and end codes).
function readGif(bytes) {
  let p = 0;
  const u8 = () => bytes[p++];
  const u16 = () => { const v = bytes[p] | (bytes[p + 1] << 8); p += 2; return v; };
  const ascii = n => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(bytes[p++]); return s; };
  const out = { signature: ascii(6), frames: [], loop: null, blockSizes: [] };
  out.width = u16();
  out.height = u16();
  const packed = u8();
  out.globalTable = (packed & 0x80) !== 0;
  p += 2;
  if (out.globalTable) p += 3 * (1 << ((packed & 7) + 1));
  let gce = null;
  const subBlocks = () => {
    const parts = [];
    for (let n = u8(); n; n = u8()) {
      out.blockSizes.push(n);
      parts.push(bytes.subarray(p, p + n));
      p += n;
    }
    const all = new Uint8Array(parts.reduce((a, b) => a + b.length, 0));
    let k = 0;
    for (const b of parts) { all.set(b, k); k += b.length; }
    return all;
  };
  for (;;) {
    const intro = u8();
    if (intro === 0x3b) { out.trailer = true; break; }
    if (intro === 0x21) {
      const label = u8();
      if (label === 0xf9) {
        u8();
        const pk = u8();
        gce = { disposal: (pk >> 2) & 7, transparent: (pk & 1) === 1, delay: u16() };
        u8();
        u8();
      } else if (label === 0xff) {
        const n = u8();
        const id = ascii(n);
        const data = subBlocks();
        if (id === 'NETSCAPE2.0' && data[0] === 1) out.loop = data[1] | (data[2] << 8);
      } else {
        subBlocks();
      }
      continue;
    }
    if (intro !== 0x2c) throw new Error('unexpected block 0x' + intro.toString(16) + ' at ' + (p - 1));
    const fr = { left: u16(), top: u16(), width: u16(), height: u16(), gce };
    const pk = u8();
    fr.interlaced = (pk & 0x40) !== 0;
    fr.table = null;
    if (pk & 0x80) {
      const n = 1 << ((pk & 7) + 1);
      fr.table = bytes.slice(p, p + 3 * n);
      p += 3 * n;
    }
    fr.minCode = u8();
    fr.indices = lzwDecode(subBlocks(), fr.minCode, fr.width * fr.height);
    out.frames.push(fr);
    gce = null;
  }
  out.rest = bytes.length - p;
  return out;
}
function lzwDecode(data, minCode, expect) {
  const clear = 1 << minCode;
  const end = clear + 1;
  const out = new Uint8Array(expect);
  let n = 0;
  let size;
  let next;
  let dict;
  let prev = null;
  let pos = 0;
  const reset = () => {
    dict = [];
    for (let i = 0; i < clear; i++) dict[i] = [i];
    size = minCode + 1;
    next = end + 1;
    prev = null;
  };
  reset();
  for (;;) {
    if (pos + size > data.length * 8) throw new Error('LZW data ends without the end code');
    let c = 0;
    for (let i = 0; i < size; i++) c |= ((data[(pos + i) >> 3] >> ((pos + i) & 7)) & 1) << i;
    pos += size;
    if (c === clear) { reset(); continue; }
    if (c === end) break;
    let entry;
    if (c < next && dict[c]) entry = dict[c];
    else if (c === next && prev) entry = prev.concat([prev[0]]);
    else throw new Error('LZW code ' + c + ' out of range (next ' + next + ')');
    for (const x of entry) {
      if (n >= expect) throw new Error('LZW data longer than the frame');
      out[n++] = x;
    }
    if (prev && next < 4096) {
      dict[next++] = prev.concat([entry[0]]);
      if (next === (1 << size) && size < 12) size++;
    }
    prev = entry;
  }
  if (n !== expect) throw new Error('LZW data gives ' + n + ' pixels, not ' + expect);
  return out;
}
const rgbAt = (fr, i) => {
  const k = fr.indices[i];
  return [fr.table[3 * k], fr.table[3 * k + 1], fr.table[3 * k + 2]];
};

// The writer on frames made here: few colors (exact), many colors (the flat ones exact, the rest close), one
// pixel, wrong sizes; the reader above checks every byte it relies on.
function checkGifWriter() {
  let seed = 11;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const frameOf = (w, h, at) => {
    const a = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = at(x, y);
        const i = 4 * (y * w + x);
        a[i] = c[0];
        a[i + 1] = c[1];
        a[i + 2] = c[2];
        a[i + 3] = 255;
      }
    }
    return a;
  };
  // Few colors: brand-like flat blocks and noise among 40 colors; every pixel must come back exactly.
  const few = [];
  for (let i = 0; i < 40; i++) few.push([Math.floor(rnd() * 256), Math.floor(rnd() * 256), Math.floor(rnd() * 256)]);
  const w1 = 300;
  const h1 = 200;
  const f1 = frameOf(w1, h1, (x, y) => (y < 40 ? [0x24, 0x55, 0x66] : x < 100 ? [0xe8, 0xe8, 0xe8]
    : few[Math.floor(rnd() * few.length)]));
  // Many colors: a smooth ramp (thousands of colors) beside large flat areas of three brand colors.
  const flat = [[0x24, 0x55, 0x66], [0x1c, 0x5a, 0x83], [0xff, 0xff, 0xff]];
  const w2 = 320;
  const h2 = 240;
  const f2 = frameOf(w2, h2, (x, y) => (x < 120 ? flat[Math.floor(y / 80)] : [x - 120 + 30, y, (x * y) % 256]));
  const w = GIF.writer(w1, h1);
  check(same(Object.keys(w.frame(f1, 80)), ['colors', 'exact', 'reserved']), 'gif writer: a frame returns its summary');
  let threw = false;
  try { w.frame(f2, 80); } catch (e) { threw = true; }
  check(threw, 'gif writer: a frame of another size is refused');
  w.frame(f1.map((v, i) => (i % 4 === 3 ? v : 255 - v)), 240);
  const bytes = w.finish();
  const read = (b, what) => {
    try {
      return readGif(b);
    } catch (e) {
      check(false, 'gif writer: ' + what + ' reads as a GIF', e.message);
      return null;
    }
  };
  const g = read(bytes, 'two frames');
  if (!g) return;
  check(g.signature === 'GIF89a' && g.width === w1 && g.height === h1 && !g.globalTable, 'gif writer: header and screen',
    g.signature);
  check(g.loop === 0, 'gif writer: loops forever (NETSCAPE2.0, count 0)', g.loop);
  check(g.frames.length === 2 && g.trailer && g.rest === 0, 'gif writer: two frames, the trailer, nothing after');
  check(same(g.frames.map(fr => fr.gce && fr.gce.delay), [80, 240]) &&
    g.frames.every(fr => fr.gce.disposal === 1 && !fr.gce.transparent), 'gif writer: delays and disposal');
  check(g.frames.every(fr => fr.left === 0 && fr.top === 0 && fr.width === w1 && fr.height === h1 && !fr.interlaced &&
    fr.table && fr.table.length === 768 && fr.minCode === 8), 'gif writer: each frame whole, with 256 colors of its own');
  check(g.blockSizes.every(n => n >= 1 && n <= 255), 'gif writer: sub-blocks of 1 to 255 bytes');
  let exact = true;
  for (let i = 0; i < w1 * h1 && exact; i++) {
    const c = rgbAt(g.frames[0], i);
    const d = rgbAt(g.frames[1], i);
    if (c[0] !== f1[4 * i] || c[1] !== f1[4 * i + 1] || c[2] !== f1[4 * i + 2] ||
      d[0] !== 255 - f1[4 * i] || d[1] !== 255 - f1[4 * i + 1] || d[2] !== 255 - f1[4 * i + 2]) exact = false;
  }
  check(exact, 'gif writer: a frame of 256 colors or fewer comes back pixel for pixel');
  check(Buffer.compare(Buffer.from(bytes), Buffer.from((() => {
    const w2b = GIF.writer(w1, h1);
    w2b.frame(f1, 80);
    w2b.frame(f1.map((v, i) => (i % 4 === 3 ? v : 255 - v)), 240);
    return w2b.finish();
  })())) === 0, 'gif writer: the same frames give the same bytes');

  // Many colors: the flat colors kept exactly, the ramp close (no dithering: neighbors keep neighbor colors).
  const wm = GIF.writer(w2, h2);
  const sum = wm.frame(f2, 80);
  const gm = read(wm.finish(), 'many colors');
  if (!gm) return;
  const fm = gm.frames[0];
  check(!sum.exact && sum.reserved >= 3 && sum.colors === 256, 'gif writer: many colors reduced to 256', sum);
  let flatOk = true;
  let worst = 0;
  for (let y = 0; y < h2; y++) {
    for (let x = 0; x < w2; x++) {
      const i = y * w2 + x;
      const c = rgbAt(fm, i);
      const src = [f2[4 * i], f2[4 * i + 1], f2[4 * i + 2]];
      if (x < 120 && !same(c, src)) flatOk = false;
      worst = Math.max(worst, ...c.map((v, k) => Math.abs(v - src[k])));
    }
  }
  check(flatOk, 'gif writer: the flat brand colors stay exact among many colors');
  check(worst <= 48, 'gif writer: other colors within 48 of their own in each channel', worst);
  // The smallest frame, and the refusals.
  const w0 = GIF.writer(1, 1);
  w0.frame(new Uint8ClampedArray([1, 2, 3, 255]), 5);
  const g0 = read(w0.finish(), 'one pixel');
  check(g0 && g0.frames.length === 1 && same(rgbAt(g0.frames[0], 0), [1, 2, 3]) && g0.frames[0].gce.delay === 5,
    'gif writer: one pixel');
  const refuses = fn => { try { fn(); return false; } catch (e) { return true; } };
  check(refuses(() => GIF.writer(1, 1).finish()) && refuses(() => GIF.writer(0, 10)) && refuses(() => GIF.writer(70000, 1)),
    'gif writer: no frame, or a size out of range, is refused');
}

// The frame list (SMR 2431-2448) and the period strip on lists made here.
function checkFrameRules() {
  const q = TS.frameSpecs([2025, '2024', 2025], ['Q3', 'Q1', 'Q3'], 'quarter');
  check(same(q.map(x => x.label), ['2024-Q1', '2024-Q3', '2025-Q1', '2025-Q3']) &&
    same(q[1].years, [2024]) && same(q[1].quarters, ['Q3']), 'frames: by quarter, sorted, once each', q);
  const y = TS.frameSpecs([2025, 2024], ['Q3', 'Q1'], 'year');
  check(same(y.map(x => x.label), ['2024', '2025']) && same(y[0].quarters, ['Q3', 'Q1']),
    'frames: by year, each with every picked quarter', y);
  // 12 quarters fit, every label shown; 32 do not: each year's first frame by its year, the current one in full.
  const labels12 = TS.frameSpecs([2023, 2024, 2025], ['Q1', 'Q2', 'Q3', 'Q4'], 'quarter').map(x => x.label);
  const s12 = TS.stripPlaces(labels12, 4);
  check(s12.fit && same(s12.labels.map(l => l && l.text), labels12) && s12.labels[4].current &&
    s12.labels.filter(l => l.current).length === 1, 'GIF: 12 quarters, every label shown, the current one marked');
  const labels32 = TS.frameSpecs([2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025], ['Q1', 'Q2', 'Q3', 'Q4'], 'quarter')
    .map(x => x.label);
  const s32 = TS.stripPlaces(labels32, 9);
  const shown = s32.labels.filter(Boolean);
  check(!s32.fit && shown.some(l => l.current && l.text === '2020-Q2') &&
    shown.filter(l => !l.current).every(l => /^\d{4}$/.test(l.text)), 'GIF: 32 quarters, years and the current label',
  shown.map(l => l.text));
  const boxesApart = shown.every((a, i) => shown.every((b, k) => k <= i || a.right + 3 <= b.left || b.right + 3 <= a.left));
  check(boxesApart, 'GIF: strip labels never touch');
  check(shown.every(l => l.left >= BR.px(TS.STRIP.x0) - 4 - 1e-9 && l.right <= BR.px(TS.STRIP.x1) + 4 + 1e-9),
    'GIF: strip labels inside the strip');
}

// CVI's species list for "ALL SPECIES" in a GIF frame: its SPECIES_COLORS (the renderer's default; SMR 1835), which
// the frame call does not replace (the page uses the master's).
const CVI_UNIVERSE = Object.keys(W.palettes.SPECIES_PALETTES['WSDA Default']);
const gifStats = { scenarios: 0, frames: 0, skipped: 0 };
function checkGif(fx, name, rec, master, universe) {
  const tag = 'gif ' + fx + ' ' + name;
  const f = flowFilters(rec.inputs);
  const by = rec.inputs.gif_frame_by;
  if (!rec.gif) {
    // CVI stops before the GIF when no row matches; the page's export stops at the same check (its rows).
    const rows = W.flow.mapRows(master, f) || [];
    check(!rows.length && rec.notes.some(n => /No rows match current filters/.test(n.text)), 'gif: ' + tag +
      ' no rows, the export stops', rec.notes);
    return;
  }
  gifStats.scenarios++;
  const g = rec.gif;
  check(g.frame_by === by && g.delay === TS.DELAY / 100 && g.dpi === TS.DPI, 'gif: ' + tag +
    ' CVI\'s interval, delay and dpi', [g.frame_by, g.delay, g.dpi]);
  check(TS.fileName(f) === g.output_file, 'gif: ' + tag + ' file name', [TS.fileName(f), g.output_file]);
  // The frame list: CVI's progress calls, 1 to n with each label.
  const specs = TS.frameSpecs(f.years, f.quarters, by);
  check(same(specs.map(x => x.label), g.progress.map(x => x.label)) &&
    g.progress.every((x, i) => x.i === i + 1 && x.n === specs.length), 'gif: ' + tag + ' frame list',
  [specs.map(x => x.label), g.progress.map(x => x.label)]);
  const fr = TS.frames(master, f, by, CENTERS);
  const cviLabel = r => {
    const ys = list(r.render.year_filter);
    const qs = list(r.render.quarter_filter);
    return by === 'year' ? String(ys[0]) : ys[0] + '-' + qs[0];
  };
  check(same(fr.frames.map(x => x.label), rec.frames.map(cviLabel)), 'gif: ' + tag + ' frames drawn (empty skipped)',
    [fr.frames.map(x => x.label), rec.frames.map(cviLabel)]);
  gifStats.frames += fr.frames.length;
  gifStats.skipped += fr.skipped.length;
  check(rec.files.some(x => x.endsWith('/' + g.output_file)) && same(rec.gif_file_png, TS.size()),
    'gif: ' + tag + ' CVI\'s file at 1650 x 1275 (its first frame, gifski missing)', [rec.files, rec.gif_file_png]);

  const input = { universe, title: rec.inputs.export_title, date: new Date(2026, 9, 12), states: STATES,
    stateLines: f.lines };
  const pages = TS.pages(fr, input);
  const cviPages = TS.pages(fr, input, null, TS.CVI_OPTIONS);
  const pool = [].concat(...fr.frames.map(x => x.lines.map(a => a.total_animals)));
  const mult = Math.max(0.15, Math.min(3, Number(f.multiplier)));
  const legendLabels0 = pages.length ? pages[0].model.legend.labels : [];
  rec.frames.forEach((cf, i) => {
    const t = tag + ' ' + cviLabel(cf);
    const page = pages[i];
    if (!page) return;
    const m = page.model;
    const cr = cf.render.flow_rows;
    const lines = fr.frames[i].lines;
    check(lines.length === cr.length && cr.every((c, k) => lines[k].state === c.state &&
      lines[k].species_group === c.species_group && near(lines[k].total_animals, c.total_animals)),
    'gif rows: ' + t + ' the rows CVI drew', [lines.length, cr.length]);
    check(cf.saved.dpi === TS.DPI && cf.saved.width_in === BR.PAGE.widthIn && cf.saved.height_in === BR.PAGE.heightIn,
      'gif page: ' + t + ' 11 x 8.5 in at 150 dpi', cf.saved);
    const [mapPlot, headerPlot, topPlot, legendPlot] = plots(cf);
    // The title: CVI's names "ALL SPECIES" from its own species list (the page from the master's).
    const dir = { inbound: 'IMPORTS', outbound: 'EXPORTS', combined: 'IMPORTS + EXPORTS' }[f.direction];
    const cviTitle = BM.resolveTitle(rec.inputs.export_title, 'TOTAL ANIMAL ' + dir + ' – ' +
      BM.speciesLabel(f.species, CVI_UNIVERSE));
    const pageTitle = BM.resolveTitle(rec.inputs.export_title, 'TOTAL ANIMAL ' + dir + ' – ' +
      BM.speciesLabel(f.species, universe));
    check(texts(headerPlot)[2].label === cviTitle && m.title === pageTitle, 'GIF: ' + t + ' title (CVI\'s species list ' +
      'beside the master\'s)', [texts(headerPlot)[2].label, cviTitle, m.title]);
    // Meta and stat rows (the frame's period, totals and states) and Top 3 States, as CVI's frame.
    const want = [m.meta.left, m.meta.right];
    for (const x of m.stats.left) want.push(x.prefix, x.value);
    check(same(labelsOf(cf).map(l => l.label), want), 'gif rows: ' + t + ' meta and stat texts',
      [labelsOf(cf).map(l => l.label), want]);
    // CVI's Top 3 States: the first three rows of the page's Top 5, with their total.
    const top3 = m.top.rows.slice(0, 3);
    const wantTop = ['Top 3 States'];
    for (const r of top3) wantTop.push(r.label, r.value);
    wantTop.push('Total', W.scaling.comma(top3.reduce((x, r) => x + Number(r.value.replace(/,/g, '')), 0)));
    check(same(texts(topPlot).map(x => x.label), wantTop) && m.top.title === 'Top 5 States' && m.top.rows.length <= 5,
      'gif top: ' + t + ' Top 3 States (the page\'s Top 5 begins with them)', [texts(topPlot).map(x => x.label), wantTop]);
    // CVI's frames use its defaults: opacity 0.85, fixed tiers, state lines on; the page the view's.
    const lineLayer = mapPlot.plot.layers.find(l => l.geom === 'GeomSf' && same(list(l.geometry), ['LINESTRING']));
    const drawn = lineLayer ? lineLayer.data : [];
    check(drawn.length === m.lines.length && drawn.every(d => near(d.alpha, 0.85)) &&
      m.lines.every(ln => near(ln.opacity, Number(f.opacity))), 'GIF: ' + t + ' line opacity (CVI 0.85, the page the view\'s)',
    [drawn.length && drawn[0].alpha, m.lines.length && m.lines[0].opacity]);
    check(drawn.length === m.lines.length && m.lines.every((ln, k) => rColor(drawn[k].colour).hex ===
      cviSpeciesColor(ln.color, f.palette, f.combine ? Object.keys(W.palettes.SPECIES_PALETTES[f.palette])[0]
        : ln.species_group)), 'gif map: ' + t + ' line colors (the palette CVI passes)');
    check(mapPlot.plot.layers[0].data[0].colour === '#ffffff' &&
      BR.svg(page.parts).includes('fill="#e8e8e8" stroke="#ffffff"') === f.lines, 'GIF: ' + t + ' state lines (CVI ' +
      'always, the page as the view)');
    check(same(texts(legendPlot).map(x => x.label).slice(2), BM.TIER_LABELS), 'GIF: ' + t + ' CVI\'s fixed legend tiers');
    // The widths and the legend from every frame's totals, worked out here.
    const lo = 0.30;
    const hi = 3.40;
    // A value's width among a set of totals (CVI's .compute_radius rule, written out here).
    const widthIn = (basis, v) => {
      if (f.scaling === 'quantile' || f.scaling === 'natural') {
        const gb = W.scaling.binsOf(basis, f.scaling, f.nBins);
        return gb ? lo + (gb.binOf(v) - 1) / (gb.maxBin - 1) * (hi - lo) : (lo + hi) / 2;
      }
      const vmax = Math.max(...basis);
      if (vmax === 0 || basis.every(x => x === basis[0])) return (lo + hi) / 2;
      const norm = f.scaling === 'log' ? Math.log1p(v) / Math.log1p(vmax) : f.scaling === 'sqrt'
        ? Math.sqrt(v) / Math.sqrt(vmax) : v / vmax;
      return lo + norm * (hi - lo);
    };
    const widthOf = v => widthIn(pool, v);
    check(m.lines.every(ln => near(ln.linewidth, widthOf(ln.total) * mult, 1e-9)), 'GIF: ' + t +
      ' line widths on every frame\'s totals', m.lines.slice(0, 3).map(ln => [ln.total, ln.linewidth]));
    const tiers = W.scaling.legendTiers(pool, f.scaling, f.nBins, lo, hi);
    const wantLabels = tiers ? tiers.values.map(v => W.scaling.comma(W.scaling.rRound(v))) : BM.TIER_LABELS;
    check(same(m.legend.labels, wantLabels) && same(m.legend.labels, legendLabels0), 'GIF: ' + t +
      ' one legend for all frames', [m.legend.labels, wantLabels]);
    if (tiers) {
      check(m.legend.widths.every((x, k) => near(x, widthOf(tiers.values[k]) * mult, 1e-9)), 'GIF: ' + t +
        ' legend widths as the frames draw them');
    }
    const own = cviPages[i].model;
    const frameTotals = lines.map(a => a.total_animals);
    check(own.lines.every(ln => near(ln.linewidth, widthIn(frameTotals, ln.total) * mult, 1e-9)),
      'GIF: ' + t + ' without it, the frame\'s own widths');
    // The strip names this frame, marked; CVI's options draw none.
    const svgText = BR.svg(page.parts);
    check(m.strip && m.strip.current === m.frame.label && m.strip.labels.filter(l => l.current).length === 1 &&
      svgText.includes('font-weight="bold">' + m.frame.label + '<') && svgText.includes('fill="#1c5a83" stroke="#ffffff"'),
    'GIF: ' + t + ' the period strip marks this frame', m.strip);
    check(!own.strip && !BR.svg(cviPages[i].parts).includes('r="3.6"'), 'GIF: ' + t + ' no strip in CVI\'s options');
    // Delays: 0.8 s, the last 2.4 s (one frame: 0.8 s); CVI's options 0.8 s each.
    const last = i === pages.length - 1 && pages.length > 1;
    check(m.frame.delay === (last ? 240 : 80) && own.frame.delay === 80, 'GIF: ' + t + ' delay (hundredths of a second)',
      [m.frame.delay, own.frame.delay]);
    check(m.frame.index === i && m.frame.of === pages.length, 'gif page: ' + t + ' frame number');
  });
}

// ── The WA State and County Focus GIF ──────────────────────────────────────────────────────────────────────────────
const viewGifStats = { wa: 0, focus: 0, frames: 0, noFrames: 0, raised: 0, ms: 0, pages: 0 };
// The input the export gives prepareView (ui.js gifBuild), without rows or premises.
function viewGifInput(view, inp, universe) {
  const date = new Date(2026, 9, 16);
  if (view === 'wa') {
    return { universe, palette: inp.county_palette, opacity: inp.county_opacity, title: inp.export_title, date,
      counties: COUNTIES };
  }
  const f = focusOpts(inp);
  return { universe, title: inp.export_title, date, counties: COUNTIES, frameF: { opacity: f.opacity,
    hideCircles: false } };
}
// The strip's labels and line keep 10 points or more off a WA inset at the bottom (County Focus).
function stripClearOfInset(m) {
  const b = m.inset.box;
  if (m.inset.corner === 'bottom right') return m.strip.right < b.x0 - 10;
  if (m.inset.corner === 'bottom left') return m.strip.left > b.x1 + 10;
  return true;
}
function checkViewGif(view, fx, name, inp, master, universe, by) {
  const tag = view + '-gif ' + fx + ' ' + name + ' ' + by;
  const f = view === 'wa' ? pageFilters(inp) : Object.assign(focusOpts(inp), { hideCircles: false });
  const fr = view === 'wa' ? TS.waFrames(master, f, by) : TS.focusFrames(master, f, by);
  // The frame list: CVI's, each frame's rows as the export draws that period, empty periods skipped.
  const specs = TS.frameSpecs(f.years, f.quarters, by);
  check(same(fr.specs.map(x => x.label), specs.map(x => x.label)), 'view-gif frames: ' + tag + ' the frame list');
  const rowsOf = ff => (view === 'wa' ? W.aggregate.build(master.rows, Object.assign({}, ff, { hasSpecies:
    master.hasSpecies })) : W.focus.build(master, ff).premises);
  for (const s of specs) {
    const own = rowsOf(Object.assign({}, f, { years: s.years, quarters: s.quarters }));
    const got = fr.frames.find(x => x.label === s.label);
    check(own.length ? !!got && same(got.rows, own) : fr.skipped.includes(s.label),
      'view-gif frames: ' + tag + ' ' + s.label + (own.length ? ' rows as the export' : ' skipped when empty'));
  }
  if (!fr.frames.length) {
    viewGifStats.noFrames++;
    return;
  }
  viewGifStats[view]++;
  viewGifStats.frames += fr.frames.length;
  const input = viewGifInput(view, inp, universe);
  const build = x => (view === 'wa' ? BM.wa(Object.assign({}, input, { rows: x.rows, f: x.f }))
    : BM.focus(Object.assign({}, input, { premises: x.rows, f: Object.assign({}, x.f, input.frameF) })));

  // CVI_OPTIONS: each frame is the branded PNG of its period, exactly (the first three frames).
  const plain = TS.prepareView(view, fr, input, undefined, TS.CVI_OPTIONS);
  for (let i = 0; i < Math.min(3, plain.count); i++) {
    const a = plain.page(i);
    const b = build(fr.frames[i]);
    check(same(a.parts, b.parts), 'view-gif plain: ' + tag + ' frame ' + fr.frames[i].label + ' is its period\'s PNG');
  }

  // The rules on.
  const t0 = Date.now();
  const prep = TS.prepareView(view, fr, input);
  const pages = [];
  for (let i = 0; i < prep.count; i++) pages.push(prep.page(i));
  viewGifStats.ms += Date.now() - t0;
  viewGifStats.pages += pages.length;
  const models = pages.map(p => p.model);
  check(prep.count === fr.frames.length && models.every((m, i) => m.frame.label === fr.frames[i].label &&
    m.frame.delay === (i === models.length - 1 && models.length > 1 ? TS.LAST_DELAY : TS.DELAY)),
  'view-gif pages: ' + tag + ' one page per frame, the last held');
  check(models.every((m, i) => m.strip && m.strip.current === fr.frames[i].label),
    'view-gif pages: ' + tag + ' every frame has the period strip, its own period marked');

  // One scale: equal totals get equal sizes in every frame; sizes grow with totals (each direction); the largest
  // total of the GIF gets the largest size; one legend.
  const circles = [].concat(...models.map(m => m.circles));
  const bySize = new Map();
  let equalOk = true;
  for (const c of circles) {
    // WA State sizes each direction apart; County Focus sizes every group together.
    const key = view === 'wa' ? c.direction + '|' + c.total : String(c.total_animals);
    if (bySize.has(key) && Math.abs(bySize.get(key) - c.size) > 1e-9) equalOk = false;
    bySize.set(key, c.size);
  }
  check(equalOk, 'view-gif scale: ' + tag + ' equal totals, equal sizes in every frame');
  const totalOf = c => (view === 'wa' ? c.total : c.total_animals);
  // WA State sizes each direction apart; County Focus sizes every group together.
  const groupsBy = view === 'wa' ? [...new Set(circles.map(c => c.direction))] : ['all'];
  for (const d of groupsBy) {
    const sub = circles.filter(c => d === 'all' || c.direction === d).sort((a, b) => totalOf(a) - totalOf(b));
    const grows = sub.every((c, i) => !i || c.size >= sub[i - 1].size - 1e-9);
    check(grows, 'view-gif scale: ' + tag + ' ' + d + ' sizes grow with totals across frames');
    const distinct = new Set(sub.map(totalOf)).size > 1;
    if (distinct && view === 'wa') {
      check(near(sub[sub.length - 1].size, BM.MIN_PT + 16.5), 'view-gif scale: ' + tag + ' ' + d +
        ' the largest total of the GIF has the largest size', sub[sub.length - 1].size);
    }
  }
  if (view === 'focus' && circles.length && new Set(circles.map(totalOf)).size > 1) {
    const top = circles.reduce((a, c) => (totalOf(c) > totalOf(a) ? c : a));
    check(near(top.size, BM.MIN_PT + 16.5), 'view-gif scale: ' + tag + ' the largest group total has the largest size',
      top.size);
  }
  check(models.every(m => same(m.legend, models[0].legend)), 'view-gif scale: ' + tag + ' one legend for every frame');
  // The legend box keeps one height (County Focus: room kept for the grouping note in every frame).
  check(models.every(m => near(m.legendHeight, models[0].legendHeight)), 'view-gif scale: ' + tag +
    ' the legend box keeps one height', models.map(m => m.legendHeight));
  if (view === 'focus') {
    const all = [].concat(...fr.frames.map(x => x.rows));
    const distance = BM.groupDistance(all);
    check(near(prep.scale.distance, distance) && models.every((m, i) =>
      m.grouped.circles === BM.groupPremises(fr.frames[i].rows, f.scaling, f.nBins, distance).length),
    'view-gif scale: ' + tag + ' one grouping distance, from every frame\'s premises');
  }

  // Names held still: one place per name in every frame; a frame names only (and every one of) its own counties.
  const placeOf = new Map();
  let stillOk = true;
  const named = view === 'wa' ? m => m.labelPlaces : m => m.names;
  for (const m of models) {
    for (const n of named(m)) {
      const at = n.x + ',' + n.y;
      if (placeOf.has(n.name) && placeOf.get(n.name) !== at) stillOk = false;
      placeOf.set(n.name, at);
    }
  }
  check(stillOk, 'view-gif names: ' + tag + ' every name keeps one place in every frame');
  if (view === 'wa') {
    const ownOk = models.every(m => {
      const counties = new Set(m.circles.map(c => c.county).filter(c => c !== null && String(c).length));
      const names = new Set(m.labelPlaces.map(l => l.name));
      return names.size === counties.size && [...names].every(n => counties.has(n));
    });
    check(ownOk, 'view-gif names: ' + tag + ' each frame names exactly its own counties');
  } else {
    const facOk = models.every(m => same(m.facilityNames.map(n => n.at), models[0].facilityNames.map(n => n.at)));
    check(facOk, 'view-gif names: ' + tag + ' facility names keep their places');
  }

  // The strip's band: nothing of the map reaches it.
  const bandTop = BR.py(TS.BAND);
  const lay = view === 'wa' ? BM.waLayout(Object.assign({}, input, { rows: fr.frames[0].rows, f: fr.frames[0].f,
    band: TS.BAND })) : BM.focusLayout(Object.assign({}, input, { premises: fr.frames[0].rows, f: Object.assign({},
    fr.frames[0].f, input.frameF), band: TS.BAND }), BR.styleOf());
  if (lay.mapPanel.top + lay.mapPanel.height < BR.py(0) - 1) viewGifStats.raised++;
  // Only what shows on the page counts: a row placed outside Washington (the s2 fixture's county "N/A") is drawn
  // below the page and cut off by the map's clip, as in the PNG.
  const pageBottom = BR.py(0);
  const boxes = [].concat(...models.map(m => named(m).map(n => n.box))).filter(b => b && b.y0 < pageBottom);
  check(lay.fit.box.top + lay.fit.box.height <= bandTop + 1e-6 &&
    circles.filter(c => c.y - c.r < pageBottom).every(c => c.y + c.r <= bandTop + 1e-6) &&
    boxes.every(b => b.y1 <= bandTop + 1e-6),
  'view-gif band: ' + tag + ' the map, its circles and names stay above the strip', { land: lay.fit.box,
    bandTop });
  // County Focus's WA inset keeps one corner in every frame, and the strip keeps off it (an earlier
  // version ran the strip over the inset): it ends before an inset at the bottom right and starts after one at the
  // bottom left.
  if (view === 'focus') {
    check(models.every(m => m.inset.corner === models[0].inset.corner && same(m.inset.box, models[0].inset.box)),
      'view-gif inset: ' + tag + ' one corner in every frame', models.map(m => m.inset.corner));
    check(models.every(m => stripClearOfInset(m)), 'view-gif band: ' + tag + ' the strip keeps off the inset (' +
      models[0].inset.corner + ')', [models[0].strip, models[0].inset.box]);
  }

  // File names.
  const fileName = TS.fileNameView(view, f);
  const want = view === 'wa' ? /^CVI_County_Map_TimeSeries_\d{4}(-\d{4})?_(INB|OUT|INB\+OUT)\.gif$/
    : /^CVI_CountyFocus_TimeSeries_(Inbound|Outbound|Inbound-Outbound)_[A-Za-z0-9-]+_\d{4}(-\d{4})?\.gif$/;
  check(want.test(fileName), 'view-gif file: ' + tag + ' ' + fileName);
}
const viewGifMasters = [];
// A synthetic County Focus GIF the reference's scenarios never reach (their premises lie close together, so every
// frame's own grouping distance is the 0.06-degree floor, and no scenario mixes frames with and without grouping):
// frame 1 spreads over Whatcom and Asotin (5 degrees: a 0.2-degree distance for the GIF, nothing grouped), frame 2
// holds two Whatcom premises 0.1 degree apart (grouped only with the GIF's distance; 0.06 on their own).
function checkViewGifSpread() {
  const tag = 'view-gif spread: County Focus';
  const premise = (id, lon, lat, total) => ({ premises_id: id, group_key: id, direction: 'Inbound', lon, lat,
    total_animals: total, city: 'Synthetic', radius_px: 10 });
  const f = { counties: ['Whatcom', 'Asotin'], species: ['Cattle'], rawSpecies: [], years: [2024], quarters: ['Q1'],
    direction: 'inbound', mode: 'overlap', scaling: 'log', nBins: 5 };
  const frames = [
    { label: '2024-Q1', f: Object.assign({}, f, { quarters: ['Q1'] }),
      rows: [premise('A', -122.3, 48.8, 500), premise('B', -117.2, 46.2, 40)] },
    { label: '2024-Q2', f: Object.assign({}, f, { quarters: ['Q2'] }),
      rows: [premise('C', -122.3, 48.85, 300), premise('D', -122.2, 48.85, 20)] }];
  const fr = { specs: frames.map(x => ({ label: x.label })), frames, skipped: [] };
  const input = { universe: ['Cattle'], title: '', date: new Date(2026, 9, 16), counties: COUNTIES,
    frameF: { opacity: 0.8, hideCircles: false } };
  const prep = TS.prepareView('focus', fr, input);
  const models = [prep.page(0).model, prep.page(1).model];
  check(prep.scale.distance > 0.15 && models[0].grouped.circles === 2 && models[1].grouped.circles === 1,
    tag + ': frame 2 grouped with the GIF\'s distance (its own would keep two circles)',
    [prep.scale.distance, models.map(m => m.grouped.circles)]);
  check(near(models[0].legendHeight, models[1].legendHeight) && models[0].grouped.note.every(t => t === '') &&
    models[1].grouped.note.length === 3 && models[1].grouped.note[0] !== '',
  tag + ': a frame without grouping keeps the note\'s room, so the legend box keeps one height',
  models.map(m => [m.legendHeight, m.grouped.note]));
}

// "Synthetic sample data" on a picture made from the synthetic sample (input.synthetic), in any style, and nowhere else.
function checkSyntheticLine() {
  const f = { counties: ['Adams'], species: ['Cattle'], rawSpecies: [], years: [2025], quarters: ['Q1'],
    direction: 'both', mode: 'overlap', scaling: 'log', nBins: 5, opacity: 0.8, hideCircles: false };
  const input = { premises: [{ premises_id: 'A', group_key: 'A', direction: 'Inbound', lon: -118.6, lat: 47.0,
    total_animals: 900, city: 'Synthetic', radius_px: 10 }], f, universe: ['Cattle'], title: '',
    date: new Date(2026, 9, 19), counties: COUNTIES };
  const marked = BR.svg(BM.focus(Object.assign({}, input, { synthetic: true })).parts);
  const markedCvi = BR.svg(BM.focus(Object.assign({}, input, { synthetic: true }), BR.CVI_STYLE).parts);
  check(marked.includes('>' + BR.SYNTHETIC + '<') && markedCvi.includes('>' + BR.SYNTHETIC + '<') &&
    !BR.svg(BM.focus(input).parts).includes(BR.SYNTHETIC), 'synthetic line: "Synthetic sample data" only on a picture from the sample');
}

// Skipped years and quarters on the period line: runs (years measured against the master's years, input.yearChoices;
// quarters against Q1 to Q4); with nothing skipped, CVI's .period_parts exactly, and without the master's years, CVI's
// years.
function checkPeriodGaps() {
  const pp = (q, y, c) => JSON.stringify(BM.periodParts(q, y, c));
  const all = ['Q1', 'Q2', 'Q3', 'Q4'];
  const cases = [
    [all, [2023, 2025], [2023, 2024, 2025], { prefix: 'CY 2023, 2025:', value: 'Full Year' }],
    [['Q1', 'Q3'], [2025], [2025], { prefix: 'CY 2025:', value: 'Q1, Q3' }],
    [['Q4', 'Q1', 'Q2'], [2025], [2025], { prefix: 'CY 2025:', value: 'Q1 – Q2, Q4' }],
    [['Q2', 'Q3', 'Q4'], [2021, 2022, 2025], [2021, 2022, 2023, 2024, 2025], { prefix: 'CY 2021–2022, 2025:', value: 'Q2 – Q4' }],
    [['Q1', 'Q2', 'Q3'], [2024, 2025], [2023, 2024, 2025], { prefix: 'CY 2024–2025:', value: 'Q1 – Q3' }],
    [all, [2023, 2024, 2026], [2023, 2024, 2026], { prefix: 'CY 2023–2026:', value: 'Full Year' }],
    [['Q1'], [2025], [2025], { prefix: 'CY 2025:', value: 'Jan – Mar' }],
    [all, [2023, 2025], undefined, { prefix: 'CY 2023–2025:', value: 'Full Year' }]];
  for (const [q, y, c, want] of cases) {
    check(pp(q, y, c) === JSON.stringify(want), 'period gaps: ' + q.join(',') + ' of ' + y.join(',') + ' reads "' +
      want.prefix + ' ' + want.value + '"', pp(q, y, c));
  }
  const f = { counties: ['Adams'], species: ['Cattle'], rawSpecies: [], years: [2023, 2025], quarters: ['Q1', 'Q3'],
    direction: 'both', mode: 'overlap', scaling: 'log', nBins: 5, opacity: 0.8, hideCircles: false };
  const input = { premises: [{ premises_id: 'A', group_key: 'A', direction: 'Inbound', lon: -118.6, lat: 47.0,
    total_animals: 900, city: 'Synthetic', radius_px: 10 }], f, universe: ['Cattle'], title: '',
    date: new Date(2026, 9, 19), counties: COUNTIES };
  const gapped = BR.svg(BM.focus(Object.assign({}, input, { yearChoices: [2023, 2024, 2025] })).parts);
  const plain = BR.svg(BM.focus(input).parts);
  check(gapped.includes('>CY 2023, 2025:<') && gapped.includes('>Q1, Q3<') && plain.includes('>CY 2023–2025:<') &&
    plain.includes('>Q1, Q3<'), 'period gaps: the PNG\'s period line lists what is skipped; without the master\'s years, CVI\'s years');
}

// A known case: Adams and Asotin, where the WA inset at CVI's bottom right partly covered
// Asotin. Synthetic premises in both counties; the inset should leave the bottom right for the empty bottom left,
// the strip start after it, and CVI's style keep the bottom right.
// 2.2: County Focus's key in the page's style. CVI PREMISES first (the roles, then "Animals per
// premises"), then FACILITY LOCATIONS two layers to a row when both names fit their half; the role and facility rows
// never drawn closer than their text; when the box is still short, the layers' rows in smaller text, then the last
// layers named as "and N more layers (see the CSV export)". CVI's own style keeps CVI's order. Synthetic inputs.
function checkFocusKey() {
  const tag = 'focus key';
  const premise = (id, dir, lon, lat, total) => ({ premises_id: id, group_key: id, direction: dir, lon, lat,
    total_animals: total, city: 'Synthetic', radius_px: 10 });
  const f = { counties: ['Yakima', 'Benton', 'Franklin', 'Kittitas'], species: ['Cattle'], rawSpecies: [], years: [2024],
    quarters: ['Q1'], direction: 'both', mode: 'overlap', scaling: 'log', nBins: 5, opacity: 0.8, hideCircles: false };
  const rows = [premise('A', 'Inbound', -120.5, 46.6, 2800), premise('B', 'Outbound', -119.4, 46.25, 900),
    premise('C', 'Inbound', -118.9, 46.5, 130), premise('D', 'Outbound', -120.55, 47.05, 40)];
  // The real layers' shapes (stars and triangles reach past a circle, so their rows are as tall as their marks).
  const SHAPES = ['star', 'triangle', 'diamond', 'triangle-down', 'circle'];
  const layer = (i, label) => ({ key: 'k' + i, label, color: '#d62728', shape: SHAPES[i % SHAPES.length],
    points: [{ name: 'F' + i, lon: -120.45 + i * 0.002, lat: 46.62 }] });
  const input = (labels, hide) => ({ premises: rows, f: Object.assign({}, f, { hideCircles: !!hide }), universe: ['Cattle'],
    title: '', date: new Date(2026, 9, 27), counties: COUNTIES, facilities: labels.map((l, i) => layer(i, l)) });
  const svgOf = b => b.parts.join('');
  const order = (svg, words) => words.map(w => svg.indexOf('>' + w + '<')).every((at, i, a) => at >= 0 && (!i || at > a[i - 1]));
  // The order, and two short names to a row.
  let b = BM.focus(input(['Feedlots', 'Markets', 'Fairgrounds']));
  check(order(svgOf(b), ['CVI PREMISES', 'Importer (received)', 'Exporter (sent)', 'Animals per premises',
    'FACILITY LOCATIONS', 'Feedlots', 'Markets', 'Fairgrounds']), tag + ': CVI PREMISES first (the roles, then Animals ' +
    'per premises), then FACILITY LOCATIONS');
  check(JSON.stringify(b.model.legendFacilityRows) === JSON.stringify([['Feedlots', 'Markets'], ['Fairgrounds']]) &&
    b.model.legendFacilityScale === 1 && b.model.legendFacilitiesLeftOut === 0 && b.model.legendFits,
  tag + ': the facility layers two to a row, at the key\'s text size', b.model.legendFacilityRows);
  // A name too long for its half has a row of its own.
  const longName = 'Restricted holding facilities for quarantined animals';
  b = BM.focus(input(['Feedlots', longName, 'Markets']));
  check(JSON.stringify(b.model.legendFacilityRows) === JSON.stringify([['Feedlots'], [longName], ['Markets']]),
    tag + ': a name too long for half the box has its own row', b.model.legendFacilityRows);
  // Circles hidden: the facility layers only.
  b = BM.focus(input(['Feedlots', 'Markets'], true));
  check(svgOf(b).indexOf('>CVI PREMISES<') < 0 && svgOf(b).indexOf('>FACILITY LOCATIONS<') >= 0,
    tag + ': with the CVI circles hidden, only FACILITY LOCATIONS');
  // CVI's style keeps CVI's order.
  check(order(svgOf(BM.focus(input(['Feedlots', 'Markets']), BR.CVI_STYLE)), ['PREMISES ROLE', 'FACILITY LOCATIONS',
    'ANIMALS / PREMISES']), tag + ': CVI\'s style keeps CVI\'s order (PREMISES ROLE, FACILITY LOCATIONS, ANIMALS / PREMISES)');
  // More and more layers: the key always fits under the Top box, its facility rows never closer than their text;
  // smaller text comes before layers left out, and layers left out are the last ones, named in one line.
  const pt = BR.textPt(3.0);
  const sweep = [4, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40].map(n => {
    const labels = Array.from({ length: n }, (v, i) => 'Synthetic layer ' + (i + 1));
    const built = BM.focus(input(labels)), m = built.model, svg = BR.svg(built.parts);
    const listed = [].concat(...m.legendFacilityRows);
    const facility = new Set(labels.concat(['']));
    const rowsAt = m.legendCircles.filter(c => facility.has(c.label)).map(c => c.y);
    const least = pt * m.legendFacilityScale * 1.2 + 2;
    return { n, m, ok: m.legendFits && m.legendY + m.legendHeight <= m.topY - 0.008 + 1e-9 &&
      JSON.stringify(listed) === JSON.stringify(labels.slice(0, n - m.legendFacilitiesLeftOut)) &&
      rowsAt.every((y, i) => !i || y - rowsAt[i - 1] >= least - 1e-6) &&
      (m.legendFacilitiesLeftOut > 0) === (svg.indexOf('more layer') >= 0 && svg.indexOf('(see the CSV export)') >= 0) &&
      (m.legendFacilitiesLeftOut === 0 || m.legendFacilityScale === 0.8) };
  });
  check(sweep.every(x => x.ok), tag + ': 4 to 40 layers: the key fits under the Top box, its facility rows never ' +
    'closer than their text, layers left out only at the smallest text, the last ones, named in one line',
  sweep.filter(x => !x.ok).map(x => [x.n, x.m.legendFits, x.m.legendFacilityScale, x.m.legendFacilitiesLeftOut]));
  check(sweep.some(x => x.m.legendFacilitiesLeftOut > 0) && sweep.some(x => x.m.legendFacilityScale === 1) &&
    sweep.some(x => x.m.legendFacilityScale < 1 && x.m.legendFacilitiesLeftOut === 0) &&
    sweep.every((x, i) => !i || x.m.legendFacilityScale <= sweep[i - 1].m.legendFacilityScale),
  tag + ': the sweep reaches every stage (all at full size, every layer at a smaller size, layers left out), in that ' +
    'order',
  sweep.map(x => [x.n, x.m.legendFacilityScale, x.m.legendFacilitiesLeftOut]));
  // In the GIF every frame's key is laid out under the lowest Top box of all frames (input.legendTop), so the key stays
  // the same from frame to frame: given a limit 0.1 lower than this page's own Top box, the key stays under it, made
  // smaller or shorter than on its own.
  const labels12 = Array.from({ length: 12 }, (v, i) => 'Synthetic layer ' + (i + 1));
  const own = BM.focus(input(labels12)).model;
  const limit = own.topY - 0.1;
  const low = BM.focus(Object.assign(input(labels12), { legendTop: limit })).model;
  check(low.legendY + low.legendHeight <= limit - 0.008 + 1e-9 && low.legendFits &&
    (low.legendFacilityScale < own.legendFacilityScale || low.legendFacilitiesLeftOut > own.legendFacilitiesLeftOut),
  tag + ': the GIF\'s lower limit (every frame\'s lowest Top box) keeps the key under it, smaller or shorter',
  [own.topY, limit, low.legendY + low.legendHeight, own.legendFacilityScale, low.legendFacilityScale,
    own.legendFacilitiesLeftOut, low.legendFacilitiesLeftOut]);
}

function checkFocusInsetAsotin() {
  const tag = 'inset Adams-Asotin';
  const premise = (id, dir, lon, lat, total) => ({ premises_id: id, group_key: id, direction: dir, lon, lat,
    total_animals: total, city: 'Synthetic', radius_px: 10 });
  const f = { counties: ['Adams', 'Asotin'], species: ['Cattle'], rawSpecies: [], years: [2024], quarters: ['Q1'],
    direction: 'both', mode: 'overlap', scaling: 'log', nBins: 5, opacity: 0.8, hideCircles: false };
  const rowsQ1 = [premise('A', 'Inbound', -117.25, 46.25, 2800), premise('B', 'Outbound', -118.6, 47.0, 900)];
  const rowsQ2 = [premise('C', 'Outbound', -118.7, 46.95, 1300), premise('D', 'Inbound', -117.1, 46.15, 40)];
  const input = { premises: rowsQ1, f, universe: ['Cattle'], title: '', date: new Date(2026, 9, 16), counties: COUNTIES };
  const m = BM.focus(input).model;
  const cvi = BM.focus(input, BR.CVI_STYLE).model;
  const lay = BM.focusLayout(input, BR.styleOf());
  const sub = COUNTIES.filter(c => f.counties.includes(c.properties.name));
  checkFocusInset(tag, m, cvi, lay, sub);
  check(!!m.inset.scores && m.inset.scores[0].land > 0 && m.inset.corner !== 'bottom right' && m.inset.land === 0 &&
    m.inset.covers === 0, tag + ': the bottom right covers Asotin, so the inset moves to a clear corner (' +
    m.inset.corner + ')', m.inset.scores);
  // A facility marker in that clear corner's empty space: the corner is no longer clear, so the inset goes on to the
  // next clear one (circles and markers count, not only land). The marker's place is found by projecting a grid.
  const first = m.inset.corner;
  const box = m.inset.box;
  const mid = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
  let spot = null;
  for (let lon = -120.5; lon <= -116.5 && !spot; lon += 0.01) {
    for (let lat = 45.6; lat <= 47.5 && !spot; lat += 0.01) {
      const [x, y] = lay.P(lon, lat);
      if (Math.abs(x - mid.x) < 3 && Math.abs(y - mid.y) < 3) spot = { lon, lat };
    }
  }
  const withMark = Object.assign({}, input, { facilities: [{ key: 'f1', label: 'Test', color: '#d62728',
    points: [{ name: 'Synthetic facility', lon: spot ? spot.lon : 0, lat: spot ? spot.lat : 0 }] }] });
  const mm = BM.focus(withMark).model;
  check(!!spot && mm.inset.corner !== first && !!mm.inset.scores &&
    mm.inset.scores.find(c => c.corner === first).covers > 0 && mm.inset.covers === 0 && mm.inset.land === 0,
  tag + ': a marker in the ' + first + ' corner moves the inset on to the next clear corner (' + mm.inset.corner + ')',
  { spot, scores: mm.inset.scores });
  check(BR.svg(BM.focus(input).parts).indexOf('<rect x="' + BR.num(m.inset.box.x0)) >= 0, tag +
    ': the inset is drawn at its corner');
  // The GIF: one corner in every frame, the strip after it.
  const frames = [{ label: '2024-Q1', f: Object.assign({}, f, { quarters: ['Q1'] }), rows: rowsQ1 },
    { label: '2024-Q2', f: Object.assign({}, f, { quarters: ['Q2'] }), rows: rowsQ2 }];
  const fr = { specs: frames.map(x => ({ label: x.label })), frames, skipped: [] };
  const prep = TS.prepareView('focus', fr, { universe: ['Cattle'], title: '', date: new Date(2026, 9, 16),
    counties: COUNTIES, frameF: { opacity: 0.8, hideCircles: false } });
  const models = [prep.page(0).model, prep.page(1).model];
  check(models.every(x => x.inset.corner === models[0].inset.corner && x.inset.corner !== 'bottom right'),
    tag + ': the GIF keeps one clear corner in every frame', models.map(x => x.inset.corner));
  check(models.every(stripClearOfInset), tag + ': the GIF\'s strip keeps off the inset',
    models.map(x => [x.strip.left, x.strip.right, x.inset.box]));
  check(BM.focus(input, BR.CVI_STYLE).parts.join('').indexOf('<rect x="' + BR.num(BR.px(BR.LAYOUT.mapW - 0.138))) >= 0,
    tag + ': CVI\'s style draws the inset at the bottom right');
}

// ── Run ────────────────────────────────────────────────────────────────────────────────────────────────────────
// The logo, byte for byte, and the text widths shared with chartsvg.js.
const logoBytes = Buffer.from(BRAND.LOGO.dataUrl.split(',')[1], 'base64');
const logoSha = crypto.createHash('sha256').update(logoBytes).digest('hex');
check(logoSha === BRAND.LOGO.sha256, 'logo: bytes match the recorded SHA-256', logoSha);
const cviLogo = path.join(CVI_DIR, 'shiny', 'www', 'img', 'wsda_logo.png');
if (fs.existsSync(cviLogo)) check(Buffer.compare(fs.readFileSync(cviLogo), logoBytes) === 0, 'logo: CVI\'s file, byte for byte');
check(logoBytes.readUInt32BE(16) === BRAND.LOGO.width && logoBytes.readUInt32BE(20) === BRAND.LOGO.height,
  'logo: 1760 x 724');
let ascii = '';
for (let c = 32; c <= 126; c++) ascii += String.fromCharCode(c);
for (const ch of ascii) {
  check(near(BR.textWidth(ch, 10), W.chartsvg.textWidth(ch, 10)), 'text: regular width of "' + ch + '" as chartsvg.js');
}
check(BR.titleSize('x'.repeat(50)) === 4.6 && BR.titleSize('x'.repeat(51)) === 4.3 &&
  BR.titleSize('x'.repeat(66)) === 3.9 && BR.titleSize('x'.repeat(81)) === 3.4 && BR.titleSize('x'.repeat(96)) === 2.9,
'header: the title size steps at 50, 65, 80 and 95 characters');
check(BM.resolveTitle('  a  ', 'auto') === 'a' && BM.resolveTitle('   ', 'auto') === 'auto' &&
  BM.resolveTitle(null, 'auto') === 'auto' && BM.resolveTitle('y'.repeat(81), '') === 'y'.repeat(79) + '…' &&
  BM.resolveTitle('y'.repeat(80), '') === 'y'.repeat(80), 'header: the custom title rule');

const asked = process.argv.slice(2);
const files = fs.readdirSync(ORACLE).filter(f => /^oracle_s9_.*\.json$/.test(f))
  .filter(f => !asked.length || asked.includes(f.replace(/^oracle_s9_|\.json$/g, '')));
if (!files.length) {
  console.error('No reference found in ' + ORACLE + '. Run Rscript tests/oracle/s9_branded_oracle.R first.');
  process.exit(2);
}
for (const file of files) {
  const o = JSON.parse(fs.readFileSync(path.join(ORACLE, file), 'utf8'));
  const master = W.master.load(fs.readFileSync(path.join(ROOT, o.file), 'utf8'));
  check(master.ok, 'load: ' + o.fixture);
  for (const [name, rec] of Object.entries(o.views.wa || {})) checkWa(o.fixture, name, rec, master, master.speciesChoices);
  for (const [name, rec] of Object.entries(o.views.flow || {})) checkFlow(o.fixture, name, rec, master, master.speciesChoices);
  for (const [name, rec] of Object.entries(o.views.focus || {})) checkFocus(o.fixture, name, rec, master, master.speciesChoices);
  for (const [name, rec] of Object.entries(o.views.facilities || {})) {
    checkFacilities(o.fixture, name, rec, master, master.speciesChoices, o.facility_anchors);
  }
  for (const [name, rec] of Object.entries(o.views.gif || {})) checkGif(o.fixture, name, rec, master, master.speciesChoices);
  viewGifMasters.push({ o, master });
}
// A scenario that throws fails its check instead of stopping the suite.
function tryViewGif(view, fx, name, inputs, master, by) {
  try {
    checkViewGif(view, fx, name, inputs, master, master.speciesChoices, by);
  } catch (e) {
    check(false, 'view-gif run: ' + view + ' ' + fx + ' ' + name + ' ' + by + ' drawn without an error',
      String(e && e.message));
  }
}
for (const { o, master } of viewGifMasters) {
  let k = 0;
  for (const [name, rec] of Object.entries(o.views.wa || {})) {
    tryViewGif('wa', o.fixture, name, rec.inputs, master, k++ % 2 ? 'year' : 'quarter');
  }
  for (const [name, rec] of Object.entries(o.views.focus || {})) {
    tryViewGif('focus', o.fixture, name, rec.inputs, master, k++ % 2 ? 'year' : 'quarter');
  }
}
checkGifWriter();
checkFrameRules();
checkViewGifSpread();
try {
  checkFocusInsetAsotin();
  checkFocusKey();
  checkSyntheticLine();
  checkPeriodGaps();
} catch (e) {
  check(false, 'inset Adams-Asotin: drawn without an error', String(e && e.message));
}

// ── Limits and fixes ─────────────────────────────────────────────────────────────────────────────────────────────
// The GIF's shared scale worked out once, pages built one at a time: timing on 40 frames of 45 lines (natural breaks
// and log), and each width equal to the per-line rule worked out here. The Esri export picture keeps its box's shape
// when capped. A stalled request stops. Colors escaped. A Cancel during the last frame stops the GIF.
async function checkAuditFixes() {
  const win = sandbox.window;
  Object.assign(win, { setTimeout, clearTimeout, AbortController, Blob });
  let seed = 5;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const STATES_48 = Object.keys(win.CVIWA.brandedmaps.stateLabelPlaces().reduce((o, p) => (o[p.abbr] = 1, o), {}));
  const synthetic = (nFrames, nLines, scaling) => ({
    frames: Array.from({ length: nFrames }, (_, i) => ({
      label: (2016 + Math.floor(i / 4)) + '-Q' + (i % 4 + 1),
      f: { direction: 'inbound', species: ['Cattle'], speciesSub: [], years: [2016 + Math.floor(i / 4)],
        quarters: ['Q' + (i % 4 + 1)], combine: true, scaling, nBins: 5, palette: 'WSDA Default', multiplier: 1,
        opacity: 0.8 },
      lines: Array.from({ length: nLines }, (_, k) => ({ state: STATES_48[k % STATES_48.length], species_group: 'All Species',
        total_animals: Math.round(10 + rnd() * 50000), coords: [[-120.5, 47.5], [-100, 40]] }))
    }))
  });
  const input = { universe: ['Cattle'], title: '', date: new Date(2026, 9, 12), states: STATES, stateLines: true };
  for (const scaling of ['natural', 'log']) {
    const fr = synthetic(40, 45, scaling);
    const t0 = Date.now();
    const prepared = TS.prepare(fr, input);
    const tPrepare = Date.now() - t0;
    let worst = 0;
    let widthsOk = true;
    const pool = [].concat(...fr.frames.map(x => x.lines.map(a => a.total_animals)));
    const gb = scaling === 'natural' ? W.scaling.binsOf(pool, 'natural', 5) : null;
    const vmax = Math.max(...pool);
    const want = v => (gb ? 0.30 + (gb.binOf(v) - 1) / (gb.maxBin - 1) * 3.10 : 0.30 + Math.log1p(v) / Math.log1p(vmax) * 3.10);
    for (let i = 0; i < prepared.count; i++) {
      const t1 = Date.now();
      const page = prepared.page(i);
      worst = Math.max(worst, Date.now() - t1);
      if (!page.model.lines.every(ln => near(ln.linewidth, want(ln.total), 1e-12))) widthsOk = false;
    }
    check(tPrepare < 500 && worst < 500, 'Limits: 40 frames of 45 lines (' + scaling + '): the shared scale at once, ' +
      'each page well under a second', { prepare: tPrepare, worstPage: worst });
    check(widthsOk, 'Limits: 40 frames of 45 lines (' + scaling + '): every width from all frames\' totals');
  }
  // The shared rule equals computeRadius with the value added, value for value (log, linear, square root).
  for (const scaling of ['log', 'linear', 'sqrt']) {
    const pool = Array.from({ length: 300 }, () => Math.round(rnd() * 90000)).concat([0, 0, 17]);
    const rule = BM.flowScale(pool, { scaling, nBins: 5 });
    const same = pool.every(v => {
      const r = W.scaling.computeRadius(pool.concat([v]), scaling, 0.30, 3.40, 5);
      return rule.widthOf(v) === r[r.length - 1];
    });
    check(same, 'Limits: flowScale(' + scaling + ') equals computeRadius with the value added, exactly');
  }
  const flat = BM.flowScale([5, 5, 5], { scaling: 'log', nBins: 5 });
  check(near(flat.widthOf(5), 1.85, 1e-12) && near(BM.flowScale([0, 0], { scaling: 'sqrt', nBins: 5 }).widthOf(0), 1.85, 1e-12),
    'Limits: equal totals, or all zero, give the middle width (as computeRadius)');

  // The export picture's size keeps the box's shape (WA State's map box at 300 dpi, High quality).
  const T = win.WSDA.tiles;
  const box = { west: -125.25, east: -116.45, south: 45.215, north: 49.285 };
  const asked = [];
  for (const [w, h, quality] of [[1694.03, 1543.69, 'standard'], [2541.04, 2315.53, 'standard'], [2541.04, 2315.53, 'high']]) {
    const urls = [];
    await T.load('raster:esri_satellite', box, w, h, { quality, fetch: u => { urls.push(u); return Promise.reject(new Error('offline')); } });
    const m = urls[0] && urls[0].match(/size=(\d+),(\d+)/);
    asked.push({ w, h, quality, size: m && [Number(m[1]), Number(m[2])] });
  }
  check(asked.every(a => a.size && Math.abs(a.size[0] / a.size[1] - a.w / a.h) < 0.001 && Math.max(...a.size) <= 4096),
    'Limits: the export picture keeps its box\'s shape, at most 4096 pixels', asked);
  check(asked[2].size[0] === 4096 && asked[2].size[1] === Math.round(2315.53 * 2 * 4096 / (2541.04 * 2)),
    'Limits: 300 dpi High asks 4096 by the box\'s shape', asked[2]);

  // A request that never answers stops after the limit (shortened here), and the load gives up.
  let signal = null, rules = null;
  const t2 = Date.now();
  const stalled = await T.load('raster:esri_relief', box, 600, 500, { timeoutMs: 60,
    fetch: (u, init) => { signal = init && init.signal; rules = init; return new Promise(() => {}); } });
  check(stalled === null && signal && signal.aborted && Date.now() - t2 < 2000 && T.TIMEOUT_MS === 30000,
    'Limits: a stalled request is stopped (30 s on the page) and the background given up', Date.now() - t2);
  // The live map's request rules (map.js): no redirect, no credentials, no referrer.
  check(rules && rules.redirect === 'error' && rules.credentials === 'omit' && rules.referrerPolicy === 'no-referrer',
    'Limits: a tile background request follows no redirect and sends no credentials or referrer',
    rules && { redirect: rules.redirect, credentials: rules.credentials, referrerPolicy: rules.referrerPolicy });

  // Colors from a file escaped in every attribute.
  const bad = '#123456" opacity="0';
  const marks = [BR.circle(1, 1, 3, 0.5, bad, 1, bad), BR.rect(0, 0, 1, 1, bad, bad, 1), BR.line(0, 0, 1, 1, bad, 1),
    BR.text('x', 0, 0, { pt: 8, color: bad, halo: { color: bad, opacity: 1, width: 1 } })];
  check(marks.every(m => !m.includes(' opacity="0"') && m.includes('#123456&quot; opacity=&quot;0')) &&
    BR.rect(0, 0, 1, 1, '<b>').includes('fill="&lt;b&gt;"') && BR.circle(1, 1, 3, 0.5, '#1c5a83', 1, '#ffffff')
    .includes('fill="#1c5a83" fill-opacity="1" stroke="#ffffff"'), 'Limits: colors escaped, valid ones unchanged', marks[0]);

  // A Cancel arriving while the last frame is written stops the GIF (the encode loop asks three times per
  // frame; the seventh question, for two frames, is the last one, after the file is made).
  const two = TS.prepare(synthetic(2, 3, 'log'), input);
  const realPixels = BR.pixels;
  const px = TS.size();
  BR.pixels = () => Promise.resolve({ data: new Uint8ClampedArray(px.width * px.height * 4).fill(255) });
  let asks = 0;
  let outcome = null;
  try {
    await TS.encode(two, { canceled: () => ++asks >= 7 });
    outcome = 'finished';
  } catch (e) {
    outcome = e && e.name;
  }
  let asks2 = 0;
  let plain = null;
  try {
    plain = (await TS.encode(two, { canceled: () => { asks2++; return false; } })).frames.length;
  } catch (e) {
    plain = e && e.message;
  }
  BR.pixels = realPixels;
  check(outcome === 'CanceledError' && asks === 7 && plain === 2 && asks2 === 7,
    'Limits: a Cancel at the last step stops the GIF; without it, two frames', { outcome, asks, plain, asks2 });
}

(async () => {
  try {
    await checkAuditFixes();
  } catch (e) {
    check(false, 'Limits: the checks ran', String(e && e.stack || e).slice(0, 300));
  }
  if (fs.existsSync(FAC_WA)) checkTownNames();
  checkClusterLegend();
  for (const [k, v] of Object.entries(counts)) console.log('  ' + k + ': ' + v);
  console.log('  legends overlapping (box at its tallest): ' + legendStats.overlapping + ' of ' + legendStats.boxes +
    '; names without a free place: ' + legendStats.notFree + ' of ' + legendStats.names + ' (' + legendStats.onNames +
    ' of them on another name)');
  console.log('  Streets: ' + streetStats.scenarios + ' scenarios; place names CVI shows: ' + streetStats.cvi +
    ', also shown by the page: ' + streetStats.both);
  console.log('  county names by step (a free inside, b over own circles, c outside, d least crowded): ' +
    ['a', 'b', 'c', 'd'].map(k => k + ' ' + p2Stats[k]).join(', ') + ' of ' + p2Stats.names + ' (b over a neighbor\'s ' +
    'circles too: ' + p2Stats.overOthers + ')');
  console.log('  County Focus: ' + focusStats.scenarios + ' scenarios drawn; names moved off circles: ' +
    focusStats.namesMoved + ', without a free place: ' + focusStats.namesNotFree + '; legends overlapping: ' +
    focusStats.overlapping + ', size samples side by side: ' + focusStats.across + '; WA inset corners: ' +
    (Object.entries(focusStats.insetCorners).map(([k, v]) => k + ' ' + v).join(', ') || 'none'));
  console.log('  Facilities: ' + facStats.scenarios + ' scenarios; county names CVI draws: ' + facStats.namesCvi +
    ', the page: ' + facStats.namesPage + ' (Density names dropped: ' + facStats.namesDropped + '); legends with touching' +
    ' samples: CVI ' + facStats.overlapCvi + ', the page ' + facStats.overlapPage);
  console.log('  GIF: ' + gifStats.scenarios + ' scenarios with a GIF; frames drawn: ' + gifStats.frames +
    ', empty periods skipped: ' + gifStats.skipped);
  console.log('  WA State and County Focus GIF: ' + viewGifStats.wa + ' WA State and ' + viewGifStats.focus +
    ' County Focus GIFs, ' + viewGifStats.frames + ' frames; with no frame: ' + viewGifStats.noFrames +
    '; maps fitted above the band: ' + viewGifStats.raised + '; pages built in ' + viewGifStats.ms + ' ms (' +
    viewGifStats.pages + ' pages)');
  failures.slice(0, 40).forEach(x => console.log('FAIL ' + x));
  console.log('S9 unit: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
