#!/usr/bin/env node
'use strict';
// S9 mutations: changes to the title rule, top boxes, legend tiers, inset and scale bar, the frame list and the GIF
// writer must each fail a suite, and so must changes to the GIF's four deliberate differences from CVI and its
// controls. Each mutant changes one exact piece of code in a temporary copy of the repository; the suite named for
// it must then report failed checks. A suite that stops early (a crash) does not count as catching it.
//
// Usage (repository root, after the S9 reference and the F1 unit run):
//   node tests/mutation/run_s9_mutations.js unit 1 2 3      rule mutants by number (all when none is named) against
//                                                           the Node S9 unit suite on s2 and tier_full; about 40 s
//                                                           each, so name up to about 12 per call
//   node tests/mutation/run_s9_mutations.js page 1 2 3      page mutants by number against the Chrome part each
//                                                           names ("gif"; "facilities" for 7 and 8; "viewgif" for
//                                                           9 to 14, the WA State and County Focus GIF; file://);
//                                                           1 to 6 per call
//   node tests/mutation/run_s9_mutations.js list            the numbered list
// Run in the foreground (the browser suite cannot start Chrome from a background job). The unmutated suite runs
// first in the same copy and must pass. The copy is deleted at the end, and the repository's files are checked
// unchanged (SHA-256). Logs and a ledger: local-test-artifacts/s9/mutations/.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'local-test-artifacts', 's9', 'mutations');
const TEMP = path.join(ROOT, 'local-test-artifacts', 's9', 'mutation-copy');
const COPY = path.join(TEMP, 'platform');
const BM = 'site/cvi/app/brandedmaps.js', BR = 'site/shared/branded.js', SC = 'site/cvi/app/scaling.js';
const TS = 'site/cvi/app/timeseries.js', GIF = 'site/shared/gif.js', UI = 'site/cvi/app/ui.js';
const EXPORTS = 'site/cvi/app/exports.js', TILES = 'site/shared/tiles.js';
const IBR = 'site/infrastructure/branded.js', IAPP = 'site/infrastructure/app.js';
const UNIT_FIXTURES = ['s2', 'tier_full'];

// [name, file, exact original text, replacement]; each must fail the Node S9 unit suite.
const UNIT = [
  // The title rule, the top boxes, the legend tiers, the inset and the scale bar (the branded pages).
  ['a custom title cut at 78 characters', BM, 'chars.slice(0, 79).join', 'chars.slice(0, 78).join'],
  ['Top States holds one more (four in CVI\'s style, six in the page\'s)', BM,
    '.map((g, i) => Object.assign(g, { i })).sort((a, b) => b.animals - a.animals || a.i - b.i).slice(0, topN);',
    '.map((g, i) => Object.assign(g, { i })).sort((a, b) => b.animals - a.animals || a.i - b.i).slice(0, topN + 1);'],
  ['legend tiers at the 95th percentile', SC, '      tv = quantile7(v, [0.1, 0.5, 0.9]);',
    '      tv = quantile7(v, [0.1, 0.5, 0.95]);'],
  ['the inset\'s focus counties in the other counties\' gray', BR, "(on ? style.insetFocus : '#e8eaed')",
    "(on ? '#e8eaed' : '#e8eaed')"],
  // (A bar at 60% in place of 50% of the map changes nothing on the fixtures: the nice rounding still gives 20 and
  // 50 km. This one is decided by the rounding.)
  ['the scale bar\'s nice steps 1, 2.5, 5', BR, 'return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * p;',
    'return (f >= 5 ? 5 : f >= 2 ? 2.5 : 1) * p;'],
  // The frame list (CVI's rules).
  ['quarters not sorted for the frames', TS, 'const qs = [...new Set(quarters)].sort(cmpC);',
    'const qs = [...new Set(quarters)];'],
  ['a quarter frame takes every picked quarter', TS,
    'const ff = Object.assign({}, f, { years: s.years, quarters: s.quarters });\n      const lines =',
    'const ff = Object.assign({}, f, { years: s.years, quarters: f.quarters });\n      const lines ='],
  ['year frames labeled with a suffix', TS, "label: String(y) }));", "label: y + '-Y' }));"],
  // The deliberate differences.
  ['GIF difference: frames always with state lines', TS, 'f: Object.assign({}, x.f, { lines: input.stateLines }) }), styleOpts);',
    'f: Object.assign({}, x.f, { lines: true }) }), styleOpts);'],
  ['GIF difference: each frame its own scale', TS, 'const scale = o.sharedScale && fr.frames.length', 'const scale = false && fr.frames.length'],
  ['GIF difference: no frame marked in the strip', TS, "if (i === current) return { text: label, x: xs[i], current: true };",
    "if (i === current) return { text: label, x: xs[i], current: false };"],
  ['GIF difference: the last frame not held', TS, 'const LAST_DELAY = 240;', 'const LAST_DELAY = 80;'],
  // The GIF writer.
  ['LZW code size grows one code late', GIF, 'if (next >= (1 << codeSize)) codeSize++;',
    'if (next > (1 << codeSize)) codeSize++;'],
  ['the loop count 1 in place of forever', GIF, 'out.byte(3);\n    out.byte(1);\n    out.u16(0);',
    'out.byte(3);\n    out.byte(1);\n    out.u16(1);'],
  ['disposal "restore to background"', GIF, 'out.byte(0x04);', 'out.byte(0x08);'],
  ['no color kept exactly before the median cut', GIF,
    'while (reserved < MAX_RESERVED && colors[reserved].count >= pixels * RESERVED_SHARE) reserved++;', 'void 0;'],
  // Line classes, tile sizes, escaping, Cancel and stalled tile requests.
  ['the classes worked out again for every line', BM,
    'return { basis, tiers, widthOf: v => (g ? lo + (g.binOf(v) - 1) / (g.maxBin - 1) * (hi - lo) : mid) };',
    'return { basis, tiers, widthOf: v => { const g2 = S().binsOf(basis, f.scaling, f.nBins); ' +
    'return g2 ? lo + (g2.binOf(v) - 1) / (g2.maxBin - 1) * (hi - lo) : mid; } };'],
  ['each side capped alone', TILES,
    'const w = Math.round(width * scale * k);\n    const h = Math.round(height * scale * k);',
    'const w = Math.min(4096, Math.round(width * scale));\n    const h = Math.min(4096, Math.round(height * scale));'],
  ['a circle\'s fill not escaped', BR, "esc(fill) + '\" fill-opacity=\"'", "fill + '\" fill-opacity=\"'"],
  ['no Cancel check after the last frame', TS,
    "const blob = new root.Blob([w.finish()], { type: 'image/gif' });\n    stop();",
    "const blob = new root.Blob([w.finish()], { type: 'image/gif' });"],
  ['a stalled request never stopped', TILES, '        if (stop) stop.abort();', '        void 0;'],
  // The Infrastructure PNG's cluster legend and sizes, and Density with CVI activity.
  ['the Cluster size legend by CVI\'s rounded breaks', IBR, 'if (style && style.clusterCountLabels) {', 'if (false) {'],
  ['the cluster sizes in CVI\'s even steps', IBR, 'if (style && style.clusterSizeByCount) {', 'if (false) {'],
  ['Density allowed with CVI activity on', IBR, '    if (activityOn) return false;\n', ''],
  // The WA State and County Focus GIF.
  ['GIF: a view\'s empty periods kept as frames', TS, 'if (rows && rows.length) out.push({ label: s.label, f: ff, rows });',
    'if (rows) out.push({ label: s.label, f: ff, rows });'],
  ['GIF: WA State circles sized per frame', TS, '      rows.forEach((r, i) => { r.radius_px = radii[i]; });\n', ''],
  ['GIF: WA State\'s legend from the frame\'s own values', BM,
    'const values = input.scale ? input.scale.values : null;', 'const values = null;'],
  ['GIF: County Focus grouped with each frame\'s own distance', TS,
    'BM().groupPremises(x.rows, f.scaling, f.nBins, distance)', 'BM().groupPremises(x.rows, f.scaling, f.nBins)'],
  ['GIF: County Focus sizes from the frame\'s own range', BM,
    'const rMin = input.scale ? input.scale.rMin : Math.min(...grouped.map(c => c.radius_px));',
    'const rMin = Math.min(...grouped.map(c => c.radius_px));'],
  ['GIF: names placed per frame', TS, 'const held = o.holdNames && frames.length ?', 'const held = false ?'],
  ['GIF: a frame names counties it does not draw', BM,
    'const labels = input.obstacles ? placedAll.filter(l => own.has(l.name)) : placedAll;', 'const labels = placedAll;'],
  ['GIF: the map not fitted above the band', BM,
    'if (!band || band <= y || fit.box.top + fit.box.height <= BR.py(band))', 'if (true)'],
  ['GIF: County Focus\'s strip over the inset', TS,
    'return { x0: STRIP.x0, x1: inset.x - INSET_GAP };', 'return { x0: STRIP.x0, x1: STRIP.x1 };'],
  ['GIF: County Focus\'s legend room per frame', BM,
    'const legendTop = input.legendTop === undefined ? topY : Math.min(input.legendTop, topY);', 'const legendTop = topY;'],
  ['GIF: no room kept for the grouping note', BM, ": input.notePad ? ['', '', ''] : [];", ': [];'],
  ['GIF: WA State\'s file name without "TimeSeries"', TS, "'CVI_County_Map_TimeSeries_'", "'CVI_County_Map_'"],
  // County Focus's WA inset corner.
  ['inset: County Focus always at the bottom right', BM,
    'if (!style.insetCorner) return Object.assign({}, corners[0]', 'if (true) return Object.assign({}, corners[0]'],
  ['inset: land not counted', BM, 'land: landShare(b, rings) });', 'land: 0 });'],
  ['inset: circles, markers and names not counted', BM,
    'covers: marks.filter(m => touchesBox(m, b)).length +\n        names.filter(n => boxesMeet(n, b)).length,',
    'covers: 0,'],
  ['inset: a corner with land taken as clear', BM, 'scored.find(c => c.covers === 0 && c.land === 0)',
    'scored.find(c => c.covers === 0)'],
  ['inset: drawn at CVI\'s place whatever the corner', BM, 'BR.inset(input.counties, counties, style, insetAt),',
    'BR.inset(input.counties, counties, style),'],
  ['GIF: the strip over an inset at the bottom left', TS,
    "if (inset.corner === 'bottom left') return { x0: inset.x + inset.w + INSET_GAP, x1: STRIP.x1 };",
    "if (inset.corner === 'bottom left') return { x0: STRIP.x0, x1: STRIP.x1 };"],
  ['inset: a thin piece of land not counted', BM, 'return vertexIn ? 1 / (nx * ny) : 0;', 'return 0;']
];

// [name, file, exact original text, replacement, Chrome part (default "gif")]; each must fail that part.
const PAGE = [
  ['Cancel ignored', UI, 'canceled: () => gifCanceled', 'canceled: () => false'],
  ['the GIF offered on National Flow only', UI, "$('export-gif-row').hidden = false;",
    "$('export-gif-row').hidden = st.view !== 'flow';"],
  ['the GIF left out of the ZIP', EXPORTS, '    if (parts.gif) { add(parts.gif.name, parts.gif.bytes); written.push(parts.gif.name); }\n',
    ''],
  ['the progress line counts from 0', UI, "'GIF frame ' + i + ' of ' + n + ': ' + label", "'GIF frame ' + (i - 1) + ' of ' + n + ': ' + label"],
  ['the frame interval not recorded', EXPORTS, "if (formats.includes('branded_gif')) p.gif_frame_interval = opts.gifBy || 'quarter';",
    'void 0;'],
  ['the GIF drawn at 200 dpi', TS, 'const DPI = 150;', 'const DPI = 200;'],
  // Density with CVI activity on the Infrastructure dashboard.
  ['Density never grayed', IAPP, "if (b.value === 'density') b.disabled = !can;", 'void 0;', 'facilities'],
  ['the Density pick not kept', IAPP, "const pick = state.coverage || 'density';", "const pick = 'density';", 'facilities'],
  // The WA State and County Focus GIF, hidden tip rows and notices.
  ['a hidden tip row shown', 'site/cvi/index.html', '  .tip-row[hidden] { display: none; }', '', 'viewgif'],
  ['the notice shown after Reset All', 'site/cvi/index.html', '  .fac-why[hidden] { display: none; }', '', 'viewgif'],
  ['GIF: not grayed with the movement lines', UI, "if (st.view === 'wa' && st.movementOn) return GIF_WHY.movement;",
    'void 0;', 'viewgif'],
  ['GIF: a tile background kept in the GIF', UI, "const background = tile ? 'standard' : ch.png.background;",
    'const background = ch.png.background;', 'viewgif'],
  ['GIF: Streets not loaded for the GIF', UI, '    if (made.streets) {', '    if (false) {', 'viewgif'],
  ['GIF: no "Preparing" line', UI, "$('gif-progress-text').textContent = 'Preparing the GIF frames…';", 'void 0;', 'viewgif']
];

// The inputs the two suites read; their outputs land in the copy and are deleted with it.
const ARTIFACTS = ['local-test-artifacts/f1/tiers', 'local-test-artifacts/s9/facilities', 'local-test-artifacts/s9/facilities-wa',
  'local-test-artifacts/s9/oracle_s9_s2.json', 'local-test-artifacts/s9/oracle_s9_tier_full.json', 'test-tables',
  // CVI's own Facilities PNGs, which the facilities part reads.
  'local-test-artifacts/s9/cvi'];

const mode = process.argv[2];
const picks = process.argv.slice(3).map(Number);
if (mode === 'list') {
  UNIT.forEach((m, i) => console.log('unit ' + (i + 1) + '. ' + m[0] + ' (' + m[1] + ')'));
  PAGE.forEach((m, i) => console.log('page ' + (i + 1) + '. ' + m[0] + ' (' + m[1] + ')'));
  process.exit(0);
}
if (!['unit', 'page'].includes(mode) || picks.some(n => !Number.isInteger(n) || n < 1)) {
  throw new Error('Use: unit [numbers ...] | page <1 to 6 numbers> | list');
}
const all = mode === 'unit' ? UNIT : PAGE;
if (picks.some(n => n > all.length)) throw new Error('Unknown mutant number');
if (mode === 'page' && (picks.length < 1 || picks.length > 6)) throw new Error('Page calls take 1 to 6 mutant numbers.');
const list = all.map((m, i) => ({ n: i + 1, name: m[0], file: m[1], from: m[2], to: m[3], part: m[4] || 'gif' }))
  .filter(m => !picks.length || picks.includes(m.n));
// The Chrome parts the picked page mutants need; the baseline and every mutant run them all.
const parts = [...new Set(list.map(m => m.part))];

const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const files = [...new Set(list.map(m => m.file))];
const before = Object.fromEntries(files.map(f => [f, sha(path.join(ROOT, f))]));

// One run of the suite in the copy: the summary line, and whether it stopped early.
function runSuite(label) {
  const args = mode === 'unit' ? ['tests/node/run_s9_unit_tests.js'].concat(UNIT_FIXTURES)
    : ['tests/browser/run_s9_browser.js'].concat(parts);
  const started = Date.now();
  const r = cp.spawnSync(process.execPath, args, { cwd: COPY, encoding: 'utf8', maxBuffer: 64 << 20,
    timeout: 6 * 60000, killSignal: 'SIGINT' });
  const output = (r.stdout || '') + (r.stderr || '');
  fs.writeFileSync(path.join(OUT, mode + '-' + label + '.log'), output);
  const m = output.match(/(\d+) passed, (\d+) failed\s*$/);
  // The browser suite reports a stop as "FAIL run stopped"; a timeout ends without the summary.
  const crashed = !m || /FAIL run stopped/.test(output) || r.signal !== null;
  return { status: r.status, passed: m ? Number(m[1]) : null, failed: m ? Number(m[2]) : null, crashed,
    seconds: Math.round((Date.now() - started) / 1000) };
}

if (fs.existsSync(TEMP)) throw new Error('A mutation-copy folder exists: inspect the interrupted run before starting again.');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
let caught = 0;
let restored = true;
try {
  for (const d of ['site', 'tests']) fs.cpSync(path.join(ROOT, d), path.join(COPY, d), { recursive: true });
  for (const a of ARTIFACTS) fs.cpSync(path.join(ROOT, a), path.join(COPY, a), { recursive: true });

  const base = runSuite('baseline');
  console.log('unmutated: ' + JSON.stringify(base));
  results.push(Object.assign({ baseline: mode }, base));
  if (base.status !== 0 || base.failed !== 0 || base.crashed) throw new Error('The unmutated suite must pass before mutations.');
  for (const m of list) {
    const p = path.join(COPY, m.file);
    const original = fs.readFileSync(p, 'utf8');
    const hash = sha(p);
    const count = original.split(m.from).length - 1;
    if (count !== 1) throw new Error(m.n + '. ' + m.name + ': expected exactly one match, found ' + count);
    fs.writeFileSync(p, original.replace(m.from, () => m.to));
    let r;
    try {
      r = runSuite(String(m.n));
    } finally {
      fs.writeFileSync(p, original);
    }
    restored = restored && sha(p) === hash;
    const ok = r.status === 1 && r.failed > 0 && !r.crashed;
    if (ok) caught++;
    results.push(Object.assign({ n: m.n, name: m.name, file: m.file, caught: ok }, r));
    const verdict = ok ? 'caught' : r.crashed ? 'STOPPED (not counted)' : 'MISSED';
    console.log(m.n + '. ' + verdict + ': ' + m.name + ' (' + r.passed + ' passed, ' + r.failed + ' failed, ' + r.seconds + ' s)');
  }
} finally {
  fs.rmSync(TEMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  fs.writeFileSync(path.join(OUT, mode + '-' + (picks.join('-') || 'all') + '.json'), JSON.stringify(results, null, 2) + '\n');
}
const unchanged = files.every(f => sha(path.join(ROOT, f)) === before[f]);
console.log(mode + ': ' + caught + ' of ' + list.length + ' mutants caught; copy restored: ' + restored
  + '; repository files unchanged: ' + unchanged + '; copy deleted: ' + !fs.existsSync(TEMP));
if (caught !== list.length || !restored || !unchanged) process.exitCode = 1;
