#!/usr/bin/env node
'use strict';
// S1.1 mutation checks, with the S4 runner's method: each mutation is applied to a copy of the
// repository's site and tests (local-test-artifacts/s1_1/mutation-copy/, deleted at the end), one at a time, and must
// make the suite named with it fail:
//   unit: mutations of palettes.js, scaling.js and master.js against node tests/node/run_s1_unit_tests.js (seconds
//         each);
//   page: mutations of the page (ui.js, map.js) against the S1 browser suite, or the NR or S3 browser suite where the
//         land under the circles changes (a minute to three each, Chrome in the foreground as the suites need).
// The copy first runs each suite unmutated (it must pass); after each mutation the copied file is restored and checked by
// SHA-256, and at the end the repository's copies of the mutated files are checked unchanged by SHA-256. A mutation is
// "caught" only when its suite runs to its summary line and reports at least one failed check. Each suite run is stopped
// after 9 minutes (with SIGINT, so a browser suite closes its Chrome).
// Usage (repository root, after the S1 oracle files with the s1_1 part and the F1 tiers exist; see tests/README.md):
//   node tests/mutation/run_s1_1_mutations.js unit|page [number ...]     (numbers: run only those, 1-based; 0 alone: only
//   the unmutated runs)
// Optional: CHROME_BIN. S1_PAGE_URL, NR_PAGE_URL and S3_PAGE_URL are not passed on (the copy is tested). Node >= 22, no packages.
const fs = require('fs'), path = require('path'), cp = require('child_process'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'local-test-artifacts', 's1_1');
const COPY = path.join(OUT, 'mutation-copy');
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const PAL = 'site/cvi/app/palettes.js', SCAL = 'site/cvi/app/scaling.js', UI = 'site/cvi/app/ui.js', MAP = 'site/cvi/app/map.js';
const MASTER = 'site/cvi/app/master.js';
const SUITES = {
  unit: { file: 'tests/node/run_s1_unit_tests.js', summary: /^\d+ passed, \d+ failed$/m },
  s1: { file: 'tests/browser/run_s1_browser.js', summary: /^\d+ passed, \d+ failed$/m },
  nr: { file: 'tests/browser/run_nr_browser.js', summary: /^NR browser .*: (\d+)\/(\d+) passed.*$/m },
  s3: { file: 'tests/browser/run_s3_browser.js', summary: /^S3 browser .*: (\d+)\/(\d+) passed.*$/m }
};
const UNIT = [   // [name, file, text, replacement, suite]
  ['an old hex value put back (WA WSDA Brand orange)', PAL, "'WSDA Brand': { Inbound: '#1c5a83', Outbound: '#f07325' },", "'WSDA Brand': { Inbound: '#1c5a83', Outbound: '#ee7e2c' },", 'unit'],
  ['an old hex value put back (Flow WSDA Brand Poultry)', PAL, "'#f07325', '#0094aa', '#8bc04a'", "'#f07325', '#4ea2c4', '#8bc04a'", 'unit'],
  ['Total fixed at #245566 (CVI)', PAL, "return p[direction] || p.Inbound;", "return p[direction] || '#245566';", 'unit'],
  ['Total from the wrong palette entry', PAL, "return p[direction] || p.Inbound;", "return p[direction] || p.Outbound;", 'unit'],
  ['swatch blend over white whatever the land', PAL, "Math.round(x * t + b[i] * (1 - t))", "Math.round(x * t + 255 * (1 - t))", 'unit'],
  ['legend radii from the tier values alone (CVI)', SCAL, "return { values: t.values, radii, cviRadii: t.radii };", "return { values: t.values, radii: t.radii, cviRadii: t.radii };", 'unit'],
  ['the 20 px cap put back', SCAL, "return r[r.length - 1]; });", "return Math.min(r[r.length - 1], 20); });", 'unit'],
  ['binned legend radii from the tier values alone (CVI)', SCAL, "radii = t.values.map(v => (g ? 4 + (g.binOf(v) - 1) / (g.maxBin - 1) * (48 - 4) : (4 + 48) / 2));", "radii = t.radii;", 'unit'],
  ['a repeated required column accepted (its last copy read)', MASTER, "const repeated = REQUIRED.filter(c => header.indexOf(c) !== header.lastIndexOf(c));", "const repeated = [];", 'unit']
];
const PAGE = [
  ['legend swatch at full strength (CVI)', UI, "dot.style.background = shown;", "dot.style.background = color;", 's1'],
  ['the 20 px cap put back in the drawn legend', UI, "const GAP = 11, rs = tiers.radii,", "const GAP = 11, rs = tiers.radii.map(r => Math.min(r, 20)),", 's1'],
  ['nested circles drawn smallest at the back', UI, "order.forEach(i => el('circle',", "order.slice().reverse().forEach(i => el('circle',", 's1'],
  ['values not moved apart', UI, "ys[i] = k ? Math.max(top, ys[order[k - 1]] + GAP) : top;", "ys[i] = top;", 's1'],
  ['Total circles drawn #245566 on the map (CVI)', MAP, "color: P.circleColor(opts.palette, r.direction),", "color: r.direction === 'Total' ? '#245566' : P.circleColor(opts.palette, r.direction),", 's1'],
  ['swatches over the county land whatever the neighbors', UI, "    return m && m.nr ? W.map.landColor(m) : W.map.LAND_PAINT['fill-color'];\n  };", "    return W.map.LAND_PAINT['fill-color'];\n  };", 'nr'],
  ['swatches not redrawn when a neighbor changes the land', UI, "W.map.setNeighbor(m, d, s.on, s.counties));\n    relegend();", "W.map.setNeighbor(m, d, s.on, s.counties));", 'nr'],
  ['swatches not redrawn after a basemap failure', UI, "    $('basemap-status').hidden = false;\n    relegend();", "    $('basemap-status').hidden = false;", 's3'],
  ['swatches ignore a failed basemap', UI, "if (b && !(m && m.basemapFailed)) return b.dark ? null : '#ffffff';", "if (b) return b.dark ? null : '#ffffff';", 's3'],
  ['swatches over white on a dark basemap', UI, "return b.dark ? null : '#ffffff';", "return '#ffffff';", 's3']
];

const mode = process.argv[2], pick = process.argv.slice(3).map(Number);
if (mode !== 'unit' && mode !== 'page') { console.error('Usage: node tests/mutation/run_s1_1_mutations.js unit|page [number ...]'); process.exit(2); }
const LIST = (mode === 'unit' ? UNIT : PAGE).map((m, i) => [i + 1].concat(m)).filter(m => !pick.length || pick.includes(m[0]));

const need = [path.join(ROOT, 'local-test-artifacts', 's1', 'oracle_s1_1.json'), path.join(ROOT, 'local-test-artifacts', 'f1', 'tiers')];
if (need.some(p => !fs.existsSync(p))) { console.error('Missing oracle files or F1 tiers: run the F1 unit tests and Rscript tests/oracle/cvi_r_oracle.R s1 s1_1 first.'); process.exit(2); }
const files = [...new Set(LIST.map(m => m[2]))];
const before = Object.fromEntries(files.map(f => [f, sha(path.join(ROOT, f))]));
// The copy: the site and the tests, the S1 oracle files, the F1 tiers.
fs.rmSync(COPY, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'site'), path.join(COPY, 'site'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tests'), path.join(COPY, 'tests'), { recursive: true, filter: src => !src.startsWith(__dirname) });   // not the runners
const S1 = path.join(ROOT, 'local-test-artifacts', 's1');
fs.mkdirSync(path.join(COPY, 'local-test-artifacts', 's1'), { recursive: true });
for (const f of fs.readdirSync(S1)) if (/^oracle_.*\.json$/.test(f)) fs.copyFileSync(path.join(S1, f), path.join(COPY, 'local-test-artifacts', 's1', f));
fs.cpSync(path.join(ROOT, 'local-test-artifacts', 'f1', 'tiers'), path.join(COPY, 'local-test-artifacts', 'f1', 'tiers'), { recursive: true });

const ENV = Object.assign({}, process.env); delete ENV.S1_PAGE_URL; delete ENV.NR_PAGE_URL; delete ENV.S3_PAGE_URL;
// One suite run: failed (the failed checks in its summary line; null without one), the summary or what stopped it.
const runSuite = suite => {
  const t0 = Date.now(), S = SUITES[suite];
  const r = cp.spawnSync(process.execPath, [S.file], { cwd: COPY, encoding: 'utf8', env: ENV, maxBuffer: 64 << 20, timeout: 9 * 60000, killSignal: 'SIGINT' });
  const out = (r.stdout || '') + (r.stderr || ''), sum = out.match(S.summary);
  let failed = null;
  if (sum) failed = suite === 'nr' || suite === 's3' ? Number(sum[2]) - Number(sum[1]) : Number(sum[0].match(/(\d+) failed/)[1]);
  const err = (out.match(/^\w*Error: .*/m) || [out.trim().split('\n').slice(-1)[0] || ''])[0].slice(0, 160);
  return { status: r.status, failed, line: sum ? sum[0] : 'suite stopped' + (r.error ? ' (' + r.error.code + ')' : '') + ': ' + err,
    first: (out.match(/^\s*FAIL .*|^\s{2}\S.* :: .*/m) || [''])[0].trim().slice(0, 220), s: Math.round((Date.now() - t0) / 1000) };
};
// A passing unmutated run is remembered by the SHA-256 of everything copied (local-test-artifacts/s1_1/
// mutation-baseline.json), so a later call on the same files runs only its mutations.
const treeHash = () => {
  const h = crypto.createHash('sha256');
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).sort((x, y) => (x.name < y.name ? -1 : 1)).forEach(e => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else h.update(path.relative(COPY, p) + '\0').update(fs.readFileSync(p));
  });
  walk(COPY); return h.digest('hex');
};
const BASE = path.join(OUT, 'mutation-baseline.json'), tree = treeHash();
let caught = 0, applied = 0, restored = true, basesOk = true;
try {
  for (const suite of [...new Set((mode === 'unit' ? UNIT : PAGE).filter((m, i) => !pick.length || pick.includes(i + 1) || pick.includes(0)).map(m => m[4]))]) {
    const key = [suite, tree, ENV.CHROME_BIN || ''].join(' ');
    let all = {}; try { all = JSON.parse(fs.readFileSync(BASE, 'utf8')); } catch (e) { /* none yet */ }
    const known = all[key] || null;
    const base = known ? Object.assign({ status: 0, failed: 0 }, known, { line: known.line + ' (remembered from ' + known.at + ')' }) : runSuite(suite);
    if (!known && base.status === 0 && base.failed === 0) { all[key] = { line: base.line, s: base.s, at: new Date().toISOString() }; fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(BASE, JSON.stringify(all, null, 1)); }
    console.log('unmutated copy, ' + suite + ': ' + base.line + ' (' + base.s + ' s)');
    if (base.status !== 0 || base.failed !== 0) basesOk = false;
  }
  if (!basesOk) { console.log('An unmutated suite does not pass; no mutation run.'); process.exitCode = 1; }
  else for (const [n, name, file, a, b, suite] of LIST) {
    const p = path.join(COPY, file), orig = fs.readFileSync(p, 'utf8'), h = sha(p);
    const count = orig.split(a).length - 1;
    if (count !== 1) { console.log(n + '. NOT APPLIED (' + count + ' matches) ' + name); continue; }
    applied++;
    fs.writeFileSync(p, orig.replace(a, () => b));
    let r;
    try { r = runSuite(suite); } finally { fs.writeFileSync(p, orig); }
    if (sha(p) !== h) restored = false;
    const ok = r.failed !== null && r.failed > 0;
    if (ok) caught++;
    console.log(n + '. ' + (ok ? 'caught ' : r.failed === null ? 'SUITE ERROR ' : 'MISSED ') + name + ' [' + suite + '] -> ' + r.line + ' (' + r.s + ' s)' + (r.first ? '\n     ' + r.first : ''));
  }
} finally {
  fs.rmSync(COPY, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
const unchanged = files.every(f => sha(path.join(ROOT, f)) === before[f]);
console.log(mode + ': ' + caught + ' of ' + applied + ' applied mutations caught (' + LIST.length + ' listed); copy restored after each: ' + restored
  + '; the mutated files unchanged in the repository (SHA-256): ' + unchanged + '; copy deleted: ' + !fs.existsSync(COPY));
if (caught !== LIST.length || !restored || !unchanged) process.exitCode = 1;
