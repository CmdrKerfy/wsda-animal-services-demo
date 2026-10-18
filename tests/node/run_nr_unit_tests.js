#!/usr/bin/env node
'use strict';
// NR unit tests (neighboring regions): the region list (site/geo/regions/index.js), each region file the build script
// wrote (site/geo/regions/<id>.js), and the shared part (site/shared/regions.js): key(), locate() and resolve() on the
// synthetic cross-border fixture (tests/synthetic/nr_crossborder.csv), load() with a stand-in document (loaded once,
// two calls at once share one request, a missing file or one that defines no data rejected and tried again later),
// shared borders (every border segment used by exactly two counties, the rest exactly the outline), mapParts(), a fourth region added to a copy of the list as data only,
// the credits (US regions add none to the page's own; British Columbia adds Statistics Canada, its statement in the list
// equal to its file's, with the license), and Washington's county file unchanged.
// Usage (repository root): node tests/node/run_nr_unit_tests.js      (Node >= 22; no packages)
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..', '..');
const SITE = path.join(ROOT, 'site');
const WA_COUNTIES_SHA256 = '39cec9a3c1f98f474c4eb06ca79fedc0bb8868783041061d5b13973f498b6853';   // unchanged since F1
const BUDGET = 2 * 1024 * 1024;   // 2 MB per region file

let pass = 0, fail = 0; const failures = [], notRun = [];
const check = (ok, name, detail) => { if (ok) pass++; else { fail++; failures.push(name + (detail !== undefined ? ' :: ' + JSON.stringify(detail).slice(0, 500) : '')); } };
const plain = x => JSON.parse(JSON.stringify(x));

// A page-like context: window = the context itself, plus a stand-in document whose <script> elements run the file
// from the site folder (as the browser would) and call onload, or onerror when it is missing. virtual: { src: source }
// stands in for files that are not in the site folder (e.g. one that loads but defines no data).
function context(listSource, virtual) {
  const scripts = [];
  const ctx = { console };
  ctx.window = ctx;
  ctx.document = {
    head: { appendChild(s) {
      scripts.push(s.src);
      setTimeout(() => {
        const f = path.join(SITE, s.src.replace(/^\.\.\//, ''));
        const v = virtual && Object.prototype.hasOwnProperty.call(virtual, s.src) ? virtual[s.src] : null;
        if (v === null && !fs.existsSync(f)) return s.onerror && s.onerror();
        vm.runInContext(v !== null ? v : fs.readFileSync(f, 'utf8'), ctx, { filename: s.src });
        if (s.onload) s.onload();
      }, 0);
    } },
    createElement() { return { remove() {} }; }
  };
  vm.createContext(ctx);
  vm.runInContext(listSource, ctx, { filename: 'index.js' });
  vm.runInContext(fs.readFileSync(path.join(SITE, 'shared', 'regions.js'), 'utf8'), ctx, { filename: 'regions.js' });
  return { ctx, R: ctx.WSDA.regions, scripts };
}
const LIST_SRC = fs.readFileSync(path.join(SITE, 'geo', 'regions', 'index.js'), 'utf8');

(async () => {
  const { ctx, R, scripts } = context(LIST_SRC);
  const list = plain(R.list());

  // ---- 1. The region list ---------------------------------------------------------------------------------------
  const FIELDS = ['id', 'name', 'code', 'country', 'countiesLabel', 'file', 'count', 'bbox', 'suffixes', 'anchor', 'credit'];
  check(list.length >= 1, 'region list: at least one region', list.length);
  list.forEach(e => check(FIELDS.every(k => e[k] !== undefined && e[k] !== ''), 'region list: ' + e.id + ' has every field', FIELDS.filter(k => e[k] === undefined || e[k] === '')));
  check(new Set(list.map(e => e.id)).size === list.length && new Set(list.map(e => e.code)).size === list.length, 'region list: ids and codes unique');
  check(list.every(e => /^[a-z0-9]+$/.test(e.id) && e.file === 'geo/regions/' + e.id + '.js'), 'region list: ids are plain, files named after them');
  check(JSON.stringify(list.map(e => e.name)) === JSON.stringify(list.map(e => e.name).slice().sort()), 'region list: alphabetical (the switches\' order)');
  check(list.every(e => fs.existsSync(path.join(SITE, e.file))), 'region list: every file present', list.filter(e => !fs.existsSync(path.join(SITE, e.file))).map(e => e.file));

  // ---- 2. Each region file -------------------------------------------------------------------------------------
  const sizes = {};
  for (const e of list) {
    const file = path.join(SITE, e.file);
    sizes[e.id] = fs.statSync(file).size;
    check(sizes[e.id] <= BUDGET, e.name + ': file within the 2 MB budget', sizes[e.id]);
    const d = await R.load(e.id, { base: '../' });
    check(d.id === e.id && d.code === e.code && d.name === e.name, e.name + ': file matches its list entry', [d.id, d.code, d.name]);
    check(/^Boundaries: /.test(d.attribution) && d.source.length > 40, e.name + ': source and attribution recorded');
    // The credit on the map names the file's source; a statement in the list (the footer's) is the file's own, the
    // license link left out (the footer links the license name).
    check(d.attribution.indexOf(e.credit.replace(/^A/, 'a')) >= 0 || d.attribution.indexOf(e.credit) >= 0, e.name + ': list credit names the file\'s source', [e.credit, d.attribution]);
    check(!d.statement === !e.statement && (!e.statement || (e.license && d.statement === e.statement.replace(/\.$/, '') + ' (' + e.license.url + ').' &&
      e.statement.lastIndexOf(e.license.name) > 0)), e.name + ': statement in the list = the file\'s statement, its license named in it', [e.statement, d.statement]);
    const fs_ = d.counties.features;
    check(fs_.length === e.count, e.name + ': ' + e.count + ' counties', fs_.length);
    const keys = fs_.map(f => f.properties.key), gids = fs_.map(f => f.properties.gid);
    check(new Set(keys).size === keys.length && new Set(gids).size === gids.length, e.name + ': keys and official IDs unique');
    check(fs_.every(f => f.properties.key === R.key(e.code, f.properties.name)), e.name + ': each key = key(code, name)',
      fs_.filter(f => f.properties.key !== R.key(e.code, f.properties.name)).map(f => f.properties.name).slice(0, 3));
    const rings = [], bad = [];
    [d.outline].concat(fs_).forEach(f => {
      check(f.geometry.type === 'MultiPolygon', e.name + ': MultiPolygon geometry');
      f.geometry.coordinates.forEach(p => p.forEach(r => rings.push(r)));
    });
    rings.forEach(r => {
      const a = r[0], z = r[r.length - 1];
      if (r.length < 4 || a[0] !== z[0] || a[1] !== z[1]) bad.push('open or short ring');
      r.forEach(([x, y]) => { if (!(x >= e.bbox[0] && x <= e.bbox[2] && y >= e.bbox[1] && y <= e.bbox[3])) bad.push([x, y]); });
      r.forEach(([x, y]) => { if (Math.round(x * 1e4) / 1e4 !== x || Math.round(y * 1e4) / 1e4 !== y) bad.push('not 4 decimals'); });
    });
    check(!bad.length, e.name + ': ' + rings.length + ' rings closed, inside the region box, 4 decimals', bad.slice(0, 3));
    const set = R.fromData(d);
    check(d.labels.length === fs_.length && d.labels.every((l, i) => l.key === keys[i] && l.name === fs_[i].properties.name),
      e.name + ': one label per county, same order and keys');
    const outsideLabel = d.labels.filter(l => { const hit = R.locate(l.lon, l.lat, [set]); return !hit || hit.key !== l.key; });
    check(!outsideLabel.length, e.name + ': every label point inside its own county', outsideLabel.map(l => l.name));
    const outlineSet = R.dataset(e.code, e.name, { type: 'FeatureCollection', features: [d.outline] }, { idProp: 'key' });
    check(!!R.locate(e.anchor[0], e.anchor[1], [outlineSet]), e.name + ': its name anchor inside the region', e.anchor);
    check(d.labels.every(l => !!R.locate(l.lon, l.lat, [outlineSet])), e.name + ': every label point inside the outline');
    check(d.outline.properties.key === e.code, e.name + ': outline keyed by the region code');
    // Shared borders: each segment of a county ring is used once (the region's edge, which is exactly the outline) or
    // twice (a border between two different counties); anything else would be a gap, an overlap or a split border.
    const seg = (a, b) => { const p = a.join(), q = b.join(); return p < q ? p + '|' + q : q + '|' + p; };
    const uses = new Map(), outSeg = new Set();
    fs_.forEach((f, fi) => f.geometry.coordinates.forEach(p => p.forEach(r => { for (let i = 0; i < r.length - 1; i++) {
      const k = seg(r[i], r[i + 1]); (uses.get(k) || uses.set(k, []).get(k)).push(fi); } })));
    d.outline.geometry.coordinates.forEach(p => p.forEach(r => { for (let i = 0; i < r.length - 1; i++) outSeg.add(seg(r[i], r[i + 1])); }));
    const odd = [...uses].filter(([k, v]) => v.length > 2 || (v.length === 2 && v[0] === v[1]) || (v.length === 2) === outSeg.has(k));
    const outOnly = [...outSeg].filter(k => !uses.has(k));
    check(!odd.length && !outOnly.length, e.name + ': shared borders identical (' + [...uses.values()].filter(v => v.length === 2).length +
      ' shared segments; single-use segments = the outline)', { odd: odd.slice(0, 3).map(([k, v]) => k + ' x' + v.length), outOnly: outOnly.slice(0, 3) });
  }
  check(scripts.length === list.length, 'load(): one script per region', scripts.length);
  await Promise.all(list.map(e => R.load(e.id, { base: '../' })));
  check(scripts.length === list.length, 'load(): a loaded region is not loaded again', scripts.length);

  // ---- 3. key() -------------------------------------------------------------------------------------------------
  check(R.key('or', 'Multnomah County') === R.key('OR', 'multnomah') && R.key('OR', 'multnomah') === 'OR:multnomah', 'key(): code case, "County" and name case ignored');
  check(R.key('OR', '  Hood   River  county ') === 'OR:hood river', 'key(): spaces trimmed and collapsed');
  ['Adams', 'Franklin', 'Lincoln'].forEach(n => check(R.key('WA', n) !== R.key('ID', n) && R.key('ID', n) === 'ID:' + n.toLowerCase(),
    'key(): ' + n + ' in Washington and Idaho give different keys'));
  check(R.key('BC', 'Capital Regional District', ['Regional District']) === 'BC:capital', 'key(): a listed suffix of several words dropped');
  if (R.entry('bc')) check(R.key('BC', 'Capital Regional District') === 'BC:capital' && R.key('BC', 'Capital') === 'BC:capital', 'key(): BC drops "Regional District" (its list entry)');
  else notRun.push('BC suffix from its list entry (BC not in the list yet)');
  check(R.key('ID', 'Adams County Line') === 'ID:adams county line', 'key(): "County" dropped only at the end');
  check(R.key('XX', 'Odd (A.B.)', ['(A.B.)']) === 'XX:odd' && R.key('XX', 'Odd AxB', ['A.B']) === 'XX:odd axb', 'key(): a suffix is plain text, not a pattern');
  if (R.entry('bc')) {
    check(R.key('BC', 'Metro Vancouver Regional District') === 'BC:greater vancouver' && R.key('BC', 'QATHET') === 'BC:powell river' &&
      R.key('BC', 'North Coast') === 'BC:skeena-queen charlotte', 'key(): BC\'s current names (aliases) give the file\'s keys');
    check(R.key('BC', 'Stikine Region') === 'BC:stikine' && R.key('BC', 'Northern Rockies Regional Municipality') === 'BC:northern rockies',
      'key(): BC drops "Region" and "Regional Municipality"');
    const bcNames = new Set(R.loaded('bc').counties.features.map(f => f.properties.key));
    const al = R.entry('bc').aliases || {};
    check(Object.keys(al).length > 0 && Object.values(al).every(n => bcNames.has(R.key('BC', n))) && Object.keys(al).every(n => !bcNames.has('BC:' + R.normalizeName(n, R.entry('bc').suffixes))),
      'region list: every BC alias names a district in the file, and no alias is a file name itself', al);
  }

  // ---- 4. Cross-border fixture: locate() and resolve() ----------------------------------------------------------
  const geoCtx = { window: {} }; vm.createContext(geoCtx);
  vm.runInContext(fs.readFileSync(path.join(SITE, 'geo', 'wa-counties.js'), 'utf8'), geoCtx);
  const WA = R.dataset('WA', 'Washington', geoCtx.window.CVIWA_GEO.counties, { idProp: 'fips' });
  const sets = [WA].concat(list.map(e => R.fromData(R.loaded(e.id))));
  const lines = fs.readFileSync(path.join(ROOT, 'tests', 'synthetic', 'nr_crossborder.csv'), 'utf8').trim().split(/\r?\n/);
  const head = lines[0].split(',');
  const rows = lines.slice(1).map(l => Object.fromEntries(l.split(',').map((v, i) => [head[i], v])));
  const have = new Set(['wa'].concat(list.map(e => e.id)));
  let ran = 0;
  rows.forEach(r => {
    const needs = r.needs.split(/\s+/).filter(Boolean);
    if (!needs.every(n => have.has(n))) { notRun.push('fixture case ' + r.case + ' (needs ' + needs.filter(n => !have.has(n)).join(', ') + ')'); return; }
    ran++;
    const got = plain(R.resolve({ state: r.state, county: r.county, lat: r.lat, lon: r.lon }, sets));
    const key = got.match ? got.match.key : '';
    check(got.status === r.expect_status && key === r.expect_key, 'fixture case ' + r.case + ' (' + r.note + '): ' + r.expect_status + (r.expect_key ? ' ' + r.expect_key : ''),
      { status: got.status, key, byPoint: got.byPoint && got.byPoint.key, byName: got.byName && got.byName.key });
    if (r.expect_status === 'mismatch') check(!!(got.byPoint && got.byPoint.key) && got.match === null, 'fixture case ' + r.case + ': mismatch reports the point\'s county and chooses none', got);
  });
  check(ran >= 10, 'fixture: at least 10 cases run', ran);
  check(R.locate(-122.68, 45.52, sets).key === 'OR:multnomah' && R.locate(-122.68, 45.70, sets).key === 'WA:clark', 'locate(): either side of the Columbia at Portland');
  check(R.locate(-100, 40, sets) === null && R.locate('x', 1, sets) === null, 'locate(): nothing outside every region or for a bad point');
  check(R.resolve({ state: 'OR', county: 'Gilliam', lat: '', lon: '' }, sets).via === 'name', 'resolve(): empty coordinates fall back to the name');
  {   // whatever the row states must agree with the point
    const r1 = plain(R.resolve({ state: 'Oregon', county: 'N/A', lat: 45.70, lon: -122.68 }, sets));
    check(r1.status === 'mismatch' && r1.match === null && r1.byPoint.key === 'WA:clark', 'resolve(): a stated region (county N/A) that disagrees with the point is flagged', r1);
    const r2 = plain(R.resolve({ state: 'Montana', county: '', lat: 45.40, lon: -120.20 }, sets));
    check(r2.status === 'mismatch', 'resolve(): a stated region not in the sets, with a point, is flagged', r2);
    const r3 = plain(R.resolve({ state: '', county: 'Gilliam', lat: 45.40, lon: -120.20 }, sets));
    check(r3.status === 'ok' && r3.match.key === 'OR:gilliam', 'resolve(): a county alone that agrees with the point is ok', r3);
  }

  // ---- 5. load(): a missing file ---------------------------------------------------------------------------------
  {
    const src = LIST_SRC.replace("file: 'geo/regions/" + list[0].id + ".js'", "file: 'geo/regions/missing-test.js'");
    const t = context(src);
    let err = null;
    try { await t.R.load(list[0].id, { base: '../' }); } catch (e) { err = e; }
    check(!!err && /could not be loaded/.test(err.message) && err.message.indexOf(list[0].name) >= 0, 'load(): a missing file rejects, naming the region', err && err.message);
    err = null;
    try { await t.R.load(list[0].id, { base: '../' }); } catch (e) { err = e; }
    check(!!err && t.scripts.length === 2, 'load(): tried again on the next call', t.scripts.length);
    let unk = null; try { await t.R.load('nowhere'); } catch (e) { unk = e; }
    check(!!unk && t.scripts.length === 2, 'load(): an id not in the list rejects without a request');
  }
  {   // two calls at once: one request, one result
    const t = context(LIST_SRC);
    const [a, b] = await Promise.all([t.R.load(list[0].id, { base: '../' }), t.R.load(list[0].id, { base: '../' })]);
    check(t.scripts.length === 1 && a === b && a.id === list[0].id, 'load(): two calls at once share one request', t.scripts.length);
  }
  {   // a file that loads but defines no data (e.g. a broken or truncated file), or another region's data
    const id = list[0].id, src = '../' + list[0].file;
    for (const [what, body] of [['defines no data', ''], ['defines another region', "(window.WSDA_REGION_DATA = window.WSDA_REGION_DATA || {})['" + id + "'] = { id: 'other', counties: { features: [] } };"],
      ['has no county list', "(window.WSDA_REGION_DATA = window.WSDA_REGION_DATA || {})['" + id + "'] = { id: '" + id + "' };"],
      ['has shapes that cannot be drawn', fs.readFileSync(path.join(SITE, list[0].file), 'utf8').replace(/"coordinates":\[\[\[\[/, '"coordinates":[[[["x",'),],
      ['has a county without a shape', fs.readFileSync(path.join(SITE, list[0].file), 'utf8').replace(/"geometry":\{"type":"MultiPolygon"/g, (m, i) => i > 1e5 ? '"geometry":null,"g":{"type":"MultiPolygon"' : m)]]) {
      const t = context(LIST_SRC, { [src]: body });
      let err = null;
      try { await t.R.load(id, { base: '../' }); } catch (e) { err = e; }
      check(!!err && /could not be loaded/.test(err.message) && t.R.loaded(id) === null, 'load(): a file that ' + what + ' rejects', err && err.message);
    }
  }

  // ---- 6. mapParts() ---------------------------------------------------------------------------------------------
  {
    const d = R.loaded(list[0].id), id = list[0].id;
    const mp = plain(R.mapParts(d, { landPaint: { 'fill-color': '#ececec' }, linePaint: { 'line-color': '#8a8a8a' }, land: true, outline: true, counties: false }));
    check(JSON.stringify(mp.layers.map(l => l.id)) === JSON.stringify(['nr-' + id + '-land', 'nr-' + id + '-counties', 'nr-' + id + '-outline']) &&
      JSON.stringify(plain(R.layerIds(id))) === JSON.stringify(mp.layers.map(l => l.id)), 'mapParts(): land, counties, outline in drawing order');
    check(mp.layers.map(l => l.layout.visibility).join() === 'visible,none,visible', 'mapParts(): visibility as asked');
    check(Object.keys(mp.sources).join() === 'nr_' + id + '_outline,nr_' + id + '_counties' && mp.sources['nr_' + id + '_counties'].data.features.length === list[0].count,
      'mapParts(): two GeoJSON sources, all counties in one');
    check(list.every(e => { const m = R.mapParts(R.loaded(e.id), {}); return Object.values(m.sources).every(x => x.attribution === e.credit); }),
      'mapParts(): each source carries its region\'s credit (shown on the map only while drawn)');
  }

  // ---- 7. A fourth region, data only ----------------------------------------------------------------------------
  {
    const extra = "{ id: 'zz', name: 'Zed Test Province', code: 'ZZ', country: 'XX', countiesLabel: 'Districts', file: 'geo/regions/zz.js', count: 1, " +
      "bbox: [10, 10, 11, 11], suffixes: ['District'], anchor: [10.5, 10.5], credit: 'test' }";
    const t = context(LIST_SRC.replace(/\n\];\s*$/, ',\n  ' + extra + '\n];\n'));
    const sq = [[[[10, 10], [11, 10], [11, 11], [10, 11], [10, 10]]]];
    vm.runInContext("(window.WSDA_REGION_DATA = window.WSDA_REGION_DATA || {})['zz'] = " + JSON.stringify({ id: 'zz', name: 'Zed Test Province', code: 'ZZ',
      source: 'test', attribution: 'Boundaries: test', outline: { type: 'Feature', properties: { name: 'Zed Test Province', key: 'ZZ' }, geometry: { type: 'MultiPolygon', coordinates: sq } },
      counties: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'North District', key: 'ZZ:north', gid: 'z1' }, geometry: { type: 'MultiPolygon', coordinates: sq } }] },
      labels: [{ name: 'North District', key: 'ZZ:north', lon: 10.5, lat: 10.5 }] }) + ';', t.ctx);
    const L = plain(t.R.list());
    check(L.length === list.length + 1 && L[L.length - 1].id === 'zz', 'fourth region: picked up from the list alone', L.map(e => e.id));
    check(t.R.key('zz', 'North District') === 'ZZ:north', 'fourth region: its suffix from its list entry');
    const hit = t.R.resolve({ state: 'zed test province', county: 'north', lat: 10.2, lon: 10.2 });
    check(hit.status === 'ok' && hit.match.key === 'ZZ:north', 'fourth region: resolve() finds it with no code change', plain(hit));
  }

  // ---- 7b. Credits: the Census Bureau's is the page's own (not repeated); Statistics Canada's is added ---------------
  {
    const g = { window: {} }; vm.createContext(g);
    vm.runInContext(fs.readFileSync(path.join(SITE, 'geo', 'wa-counties.js'), 'utf8'), g, { filename: 'wa-counties.js' });
    const own = g.window.CVIWA_GEO.attribution;
    const us = list.filter(e => e.country === 'US'), ca = list.filter(e => e.country === 'CA');
    check(us.length > 0 && us.every(e => own.indexOf(e.credit) >= 0), 'credits: US regions\' credit contained in the page\'s own ("' + own + '")', us.map(e => e.credit));
    check(ca.length > 0 && ca.every(e => own.indexOf(e.credit) < 0 && /Statistics Canada/.test(e.credit) && /^Adapted from Statistics Canada, 2021 Census Boundary Files/.test(e.statement) &&
      /does not constitute an endorsement by Statistics Canada/.test(e.statement) && /Open Government Licence – Canada/.test(e.statement) &&
      e.license.url === 'https://open.canada.ca/en/open-government-licence-canada'), 'credits: British Columbia adds Statistics Canada, both statements and the license link');
  }

  // ---- 8. Washington's county file unchanged ---------------------------------------------------------------------
  const waHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(SITE, 'geo', 'wa-counties.js'))).digest('hex');
  check(waHash === WA_COUNTIES_SHA256, 'wa-counties.js unchanged (SHA-256)', waHash);

  const kb = Object.entries(sizes).map(([k, v]) => k + ' ' + Math.round(v / 1024) + ' KB').join(', ');
  console.log('NR unit: ' + pass + '/' + (pass + fail) + ' passed (regions: ' + kb + ')' + (notRun.length ? '; not run: ' + notRun.join('; ') : '') +
    (fail ? '\n  ' + failures.join('\n  ') : ''));
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
