#!/usr/bin/env node
'use strict';
// Bounded S5 mutations. Each complete suite must report failed assertions; crashes do not count as caught.
// Usage: node tests/mutation/run_s5_mutations.js unit|page [numbers ...]; page 0 establishes the baseline.
// Browser batches: at most two mutants per call after page 0. No installations or source-project writes.
const fs = require('fs'), path = require('path'), cp = require('child_process'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '../..'), OUT = path.join(ROOT, 'local-test-artifacts/s5');
const TEMP = path.join(OUT, 'mutation-copy'), COPY = path.join(TEMP, 'platform');
const F = 'site/cvi/app/focus.js', M = 'site/cvi/app/focusmap.js', A = 'site/shared/facilities.js', U = 'site/cvi/app/ui.js';
// name, file, exact original text, replacement, complete unit mode (page uses the full browser suite).
const UNIT = [
  ['wrong premises end', F, "end = dir === 'Inbound' ? 'Dest' : 'Origin'", "end = dir === 'Inbound' ? 'Origin' : 'Dest'", '--premises'],
  ['relevant-end WA guard removed', F, "|| !counties.has(r[end + '.County']) || r[end + '.State'] !== 'WA'", "|| !counties.has(r[end + '.County'])", '--premises'],
  ['entity grouping discarded', F, "const key = nonblank(eid) ? 'e:' + eid.trim() : 'c:' + lon + ',' + lat;", "const key = 'c:' + lon + ',' + lat;", '--premises'],
  ['coordinate fallback key wrong', F, "'c:' + lon + ',' + lat;", "'c:' + lon + ',' + (lat + index * 0.001);", '--premises'],
  ['side-by-side offset reversed', F, "g.direction === 'Inbound' ? -0.008 : 0.008", "g.direction === 'Inbound' ? 0.008 : -0.008", '--premises'],
  ['radius scaled per direction', F, "g.radius_px = sizing.radii[i];", "g.radius_px = root.CVIWA.scaling.focusSizing(out.filter(p => p.direction === g.direction).map(p => p.total_animals), opts.scaling || 'log', opts.nBins || 5).radii[out.filter(p => p.direction === g.direction).indexOf(g)];", '--premises'],
  ['popup truncates at 24', F, 'function popupData(rows, hasCvi, maxRows = 25)', 'function popupData(rows, hasCvi, maxRows = 24)', '--payloads'],
  ['popup escaping removed', F, "'<td>' + esc(c) + '</td>'", "'<td>' + c + '</td>'", '--payloads'],
  ['species totals wrong', F, "(totals.get(key) || 0) + (n === null", "(totals.get(key) || 0) + 1 + (n === null", '--payloads'],
  ['facility bbox-only membership', A, '&& f.polys.some(p => inPolygon(lon, lat, p))', '&& true', '--membership'],
  ['facility all-invalid coordinates accepted', A, 'if (!points.length) return { ok: false, reason: outOfRange', 'if (!points.length && !outOfRange) return { ok: false, reason: outOfRange', '--facilities']
];
const PAGE = [
  ['wrong cluster radius', M, 'clusterMaxZoom: 12, clusterRadius: 40', 'clusterMaxZoom: 12, clusterRadius: 41'],
  ['wrong cluster threshold', M, "14, 10, 18, 50, 24, 200, 32", "14, 11, 18, 50, 24, 200, 32"],
  ['mixed-direction clusters', M, "features: out[dir] });", "features: out.Inbound.concat(out.Outbound) });"],
  ['cluster animal totals wrong', M, 'animals += a;', 'animals += a + 1;'],
  ['cluster species totals wrong', M, '(spec[k] || 0) + o[k]', '(spec[k] || 0) + o[k] + 1'],
  ['stale hover accepted', M, 'token !== st.hoverToken || st.map.getSource(SRC[dir]) !== src', 'false'],
  ['absent facility files retained', U, 't === undefined ? null', 't === undefined ? fo.fac.layers[l.key]'],
  ['hidden size legend retained', U, 'if (fo.hide) return only(', 'if (false) return only('],   // 2.2: the legend's groups
  ['reset keeps a county', F, "return { counties: [], direction: 'combined'", "return { counties: ['King'], direction: 'combined'"],
  ['popup unreadable font restored', M, "overflow: 'auto', fontSize: '14px'", "overflow: 'auto', fontSize: '0.78em'"],
  ['popup short-window height cap removed', M, "maxHeight: 'min(240px, 30vh, calc(38.5vh - 80px))'", "maxHeight: '240px'"],
  ['passive hover intercepts clicks', 'site/cvi/index.html', '.focus-tip .maplibregl-popup-content { pointer-events: none; }', '.focus-tip .maplibregl-popup-content { pointer-events: auto; }'],
  ['popup file text parsed as HTML', M, 'if (text !== undefined) e.textContent = text;', 'if (text !== undefined) e.innerHTML = text;'],
  ['cluster raw species prototype keys corrupted', M, 'const spec = Object.create(null);', 'const spec = {};']
];
const mode = process.argv[2], picks = process.argv.slice(3).map(Number);
if (!['unit', 'page'].includes(mode) || picks.some(n => !Number.isInteger(n) || n < 0)) throw new Error('Use unit|page [numbers ...]');
const all = mode === 'unit' ? UNIT : PAGE;
if (mode === 'page' && (!picks.length || picks.length > 2)) throw new Error('Bound browser calls: page 0, then at most two numbered mutants per call.');
if (picks.some(n => n > all.length)) throw new Error('Unknown mutation number');
const list = all.map((m, i) => [i + 1, ...m]).filter(m => !picks.length || picks.includes(m[0]));
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const files = [...new Set(list.map(m => m[2]))], before = Object.fromEntries(files.map(f => [f, sha(path.join(ROOT, f))]));
const env = { ...process.env, S5_REFERENCE_ROOT: ROOT, CVI_TRACEABILITY_DIR: process.env.CVI_TRACEABILITY_DIR || path.resolve(ROOT, '../CVI_Traceability') }; delete env.S5_PAGE_URL;
const suite = mode === 'unit' ? 'tests/node/run_s5_unit_tests.js' : 'tests/browser/run_s5_browser.js';
let caught = 0, restored = true;
fs.mkdirSync(OUT, { recursive: true });
if (fs.existsSync(TEMP)) throw new Error('Existing mutation-copy: inspect interrupted work before restarting.');
const logs = path.join(OUT, 'mutations'); fs.mkdirSync(logs, { recursive: true });
try {
  for (const d of ['site', 'tests']) fs.cpSync(path.join(ROOT, d), path.join(COPY, d), { recursive: true });
  for (const d of ['gate', 'membership', 'premises', 'payloads', 'module-route', 'module-facilities', 'module-tiers', 'facilities', 'clusters', 'summaries']) {
    fs.cpSync(path.join(OUT, d), path.join(COPY, 'local-test-artifacts/s5', d), { recursive: true });
  }
  fs.copyFileSync(path.join(OUT, 'oracle_s5_gate.json'), path.join(COPY, 'local-test-artifacts/s5/oracle_s5_gate.json'));
  fs.cpSync(path.join(ROOT, 'local-test-artifacts/f1/tiers'), path.join(COPY, 'local-test-artifacts/f1/tiers'), { recursive: true });
  // Only these two read-only source files are needed by the premises/payload digest checks.
  for (const file of ['shiny/R/master_loader.R', 'shiny/R/map_helpers.R']) {
    const dest = path.join(TEMP, 'CVI_Traceability', file); fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(ROOT, '../CVI_Traceability', file), dest);
  }
  const hash = crypto.createHash('sha256');
  function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
    const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else hash.update(path.relative(COPY, p)).update(fs.readFileSync(p));
  } }
  walk(TEMP); const tree = hash.digest('hex');
  const baseFile = path.join(logs, 'baseline.json');
  let bases = {}; try { bases = JSON.parse(fs.readFileSync(baseFile)); } catch (e) { /* first batch */ }
  const run = (arg, name) => {
    const t = Date.now(); const r = cp.spawnSync(process.execPath, [suite, ...(arg ? [arg] : [])], { cwd: COPY, env, encoding: 'utf8', maxBuffer: 64 << 20, timeout: 7 * 60000, killSignal: 'SIGINT' });
    const out = (r.stdout || '') + (r.stderr || ''); fs.writeFileSync(path.join(logs, name + '.log'), out);
    const m = out.match(/S5 [^\n]*?(\d+) passed, (\d+) failed/);
    return { status: r.status, stopped: /FAIL run stopped:/.test(out), failed: m ? Number(m[2]) : null, summary: m ? m[0] : 'SUITE ERROR', seconds: Math.round((Date.now()-t)/1000) };
  };
  const args = mode === 'page' ? [''] : [...new Set(list.map(m => m[5]))];
  for (const arg of args) {
    const key = [tree, mode, arg, env.S5_STRIDE || '', env.CHROME_BIN || ''].join('|');
    const base = bases[key] || run(arg, mode + '-baseline' + arg);
    console.log('unmutated ' + (arg || 'page') + ': ' + JSON.stringify(base));
    if (base.status !== 0 || base.failed !== 0) throw new Error('Complete unmutated suite must pass before mutations');
    bases[key] = base; fs.writeFileSync(baseFile, JSON.stringify(bases, null, 2));
  }
  for (const [n, name, file, a, b, arg] of list) {
    const p = path.join(COPY, file), orig = fs.readFileSync(p, 'utf8'), h = sha(p);
    const count = orig.split(a).length - 1;
    if (count !== 1) throw new Error(n + ' ' + name + ': expected exactly one match, got ' + count);
    fs.writeFileSync(p, orig.replace(a, () => b)); let r;
    try { r = run(arg, mode + '-' + n); } finally { fs.writeFileSync(p, orig); }
    restored = restored && sha(p) === h;
    const ok = r.status === 1 && !r.stopped && r.failed !== null && r.failed > 0;
    if (ok) caught++;
    console.log(n + '. ' + (ok ? 'caught' : r.failed === null ? 'SUITE ERROR' : 'MISSED') + ' ' + name + ': ' + JSON.stringify(r));
    if (!ok) process.exitCode = 1;
  }
} finally { fs.rmSync(TEMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
const unchanged = files.every(f => sha(path.join(ROOT, f)) === before[f]);
console.log(mode + ': ' + caught + ' of ' + list.length + ' mutations caught; copy restored: ' + restored + '; repository hashes unchanged: ' + unchanged + '; copy deleted: ' + !fs.existsSync(TEMP));
if (caught !== list.length || !restored || !unchanged) process.exitCode = 1;
