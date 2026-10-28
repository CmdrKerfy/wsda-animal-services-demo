#!/usr/bin/env node
'use strict';
// Population-context spot mutations: changes to the class breaks, the joins, the both-on rule, the drawing order and
// the gating must each fail a suite, and so must changes to S9's county-name placement steps.
//
// Each mutant changes one exact piece of code in a temporary copy of the repository; the suite named for its group
// must then report failed checks. A suite that stops early does not count as catching it.
//   unit   site/shared/population.js and the PNG order, against the PC unit suite
//   build  site/build/derive_population.R: the build is rerun in the copy, then the PC unit suite. A rebuilt file
//          always fails the suite's "the reference measured this file" hash check, so a build mutant counts as
//          caught only when some other check fails too.
//   page   the pages' switches and live map, against the PC Chrome part each names (file://, foreground)
//   p2     S9's county-name placement steps, against the S9 unit suite on tier_full
//
// Usage (repository root): node tests/mutation/run_pc_mutations.js <unit|build|page|p2> [numbers ...]
//                          node tests/mutation/run_pc_mutations.js list
// Run in the foreground for page (Chrome does not start from a background job); build reruns the R build per mutant
// (about 30 s each) and may run as a background job.
// The unmutated suite runs first in the same copy and must pass. The copy is deleted at the end, and the
// repository's files are checked unchanged (SHA-256). Logs and a ledger: local-test-artifacts/pc/mutations/.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'local-test-artifacts', 'pc', 'mutations');
// One copy folder per group, so two groups can run at once (a background build group beside a foreground one).
const TEMP = path.join(ROOT, 'local-test-artifacts', 'pc', 'mutation-copy' + (process.argv[2] === 'build' ? '' : '-' + process.argv[2]));
const COPY = path.join(TEMP, 'platform');
const PN = 'site/shared/population.js', BM = 'site/cvi/app/brandedmaps.js', R = 'site/build/derive_population.R';
const MAP = 'site/cvi/app/map.js', UI = 'site/cvi/app/ui.js', IAPP = 'site/infrastructure/app.js';
const EXP = 'site/cvi/app/exports.js';
const IHTML = 'site/infrastructure/index.html';
const CHTML = 'site/cvi/index.html', EHTML = 'site/emergency/index.html';
const NAME_CSS = '.county-label.pc-name { font-size: 10px; color: var(--pc-name, #444444); }';
const NAME_CSS_OLD = '.county-label.pc-name { font-size: 10px; color: #444444; }';
// A page mutant: the County lines group moved back below the population group (the span from its
// comment to the group's last line, read from the page, with its first two lines moved to the end).
const ORDER = (() => {
  const t = fs.readFileSync(path.join(ROOT, IHTML), 'utf8');
  const a = t.indexOf('<!-- County lines and labels before Population context');
  const z = t.indexOf('\n', t.indexOf('<p id="pc-msg"', a));
  const lines = t.slice(a, z).split('\n');
  return { from: lines.join('\n'), to: lines.slice(2).concat(lines.slice(0, 2)).join('\n') };
})();

// [name, file, exact original text, replacement, Chrome part (page only)]
const GROUPS = {
  unit: [
    ['class breaks: the top break at 4,000', PN, 'const BREAKS = [10, 50, 250, 1000, 5000];',
      'const BREAKS = [10, 50, 250, 1000, 4000];'],
    ['class breaks: a density on a break goes to the class below', PN, 'density >= BREAKS[k]', 'density > BREAKS[k]'],
    ['both-on rule: every place drawn with city limits on', PN,
      'const places = !pd ? [] : o.cities && cities.length ? cdpsOutside(pd) : pd.places;',
      'const places = !pd ? [] : pd.places;'],
    ['both-on rule: a trimmed place keeps its untrimmed shape', PN,
      'Object.assign({}, place, { label: t.label, shape: t.shape, share: t.share })',
      'Object.assign({}, place, { label: t.label, shape: place.shape, share: t.share })'],
    ['drawing order (PNG): outlines under the density', BM, 'return svg.density + svg.outlines + lines;',
      'return svg.outlines + svg.density + lines;'],
    ['drawing order (PNG): WA State place names under the circles', BM,
      `    if (!shaded) for (const c of drawn) mapParts.push(BR.circle(c.x, c.y, c.size, c.stroke, c.fill, c.opacity, '#ffffff'));
    // County names placed over their own circles (step b above) go on top of the circles.
    for (const lb of labels.filter(l => l.over)) mapParts.push(countyName(lb));
    if (popNames) mapParts.push(popNames.markup);`,
      `    if (popNames) mapParts.push(popNames.markup);
    if (!shaded) for (const c of drawn) mapParts.push(BR.circle(c.x, c.y, c.size, c.stroke, c.fill, c.opacity, '#ffffff'));
    // County names placed over their own circles (step b above) go on top of the circles.
    for (const lb of labels.filter(l => l.over)) mapParts.push(countyName(lb));`],
    // Movement badges, facility names and damaged data files.
    ['place names may cover the movement badges', BM,
      '      .concat(badgeBoxes), obstacles.filter(o => !o.badge), { min: 10000 }) : null;',
      '      , obstacles, { min: 10000 }) : null;'],
    ['county-name step (b) may use a spot touching a badge', BM, 'wholeIn && !hit.some(c => c.badge)) {', 'wholeIn) {'],
    ['the corner box ignores facility names', BM,
      ', facilityPlaces.filter(f => f && f.box).map(f => f.box));', ');'],
    ['a damaged data file counts as loaded', PN, 'return checked.get(d) ? d : null;', 'return d;'],
    ['the population keys in every export', EXP,
      "const pop = formats.includes('branded_png') ? opts.population : null;", 'const pop = opts.population;'],
    // The PNG legend's spacing and the outlines' gray.
    ['no space under the PNG legend\'s heading', PN, 'const GAP_UNDER_TITLE = 0.6;',
      'const GAP_UNDER_TITLE = 0;'],
    ['the outlines back in the darker gray', PN, "const OUTLINE = '#737373';", "const OUTLINE = '#4d4d4d';"],
    // More spacing, and County Focus's size circles.
    ['no space above the density title', PN, 'const GAP_ABOVE_DENSITY = 0.6;',
      'const GAP_ABOVE_DENSITY = 0;'],
    ['County Focus\'s size circles never wrapped into two or three rows', BM,
      'const tries = [1, 2, 3].filter(', 'const tries = [1].filter('],
    // The WA inset's corner: the corner box keeps off an inset that moved.
    ['inset corner: the corner box may lie on the inset', BM,
      'const avoid = keepOff ? names.concat([keepOff]) : names;', 'const avoid = names;'],
    ['inset corner: the fallback box may lie on the inset', BM,
      'const off = tried.find(t => !keepOff || !boxesMeet(keepOff, t.b)) || tried[0];', 'const off = tried[0];']
  ],
  build: [
    ['class breaks (build): the top break at 4,000', R, 'BREAKS <- c(10, 50, 250, 1000, 5000)',
      'BREAKS <- c(10, 50, 250, 1000, 4000)'],
    ['join: each city given the next place\'s population', R,
      'cities$pop <- pl_places$pop[match(cities$GEOID, pl_places$geoid)]',
      'cities$pop <- pl_places$pop[match(cities$GEOID, pl_places$geoid) + 1L]'],
    ['join: each place given the next place\'s population', R,
      'places$pop <- pl_places$pop[match(places$GEOID, pl_places$geoid)]',
      'places$pop <- pl_places$pop[match(places$GEOID, pl_places$geoid) + 1L]'],
    ['join: each tract given the next tract\'s population', R,
      'tract_pop <- pl_tracts$pop[match(tracts$GEOID, pl_tracts$geoid)]',
      'tract_pop <- pl_tracts$pop[match(tracts$GEOID, pl_tracts$geoid) + 1L]'],
    ['join: the Department of Revenue\'s names kept (not the Census names)', R,
      'cities$name[!is.na(matched)] <- as.character(incorporated$NAME[matched[!is.na(matched)]])',
      'cities$name[!is.na(matched)] <- cities$name[!is.na(matched)]'],
    ['both-on rule (build): places dropped below 30% of their land', R, 'DROP_SHARE <- 0.10', 'DROP_SHARE <- 0.30'],
    // Mutant 4 is stopped by the build's own state-total check; this one keeps the total and passes that check.
    ['join: the tracts\' populations in reverse order (the state total kept)', R,
      'tract_pop <- pl_tracts$pop[match(tracts$GEOID, pl_tracts$geoid)]',
      'tract_pop <- rev(pl_tracts$pop[match(tracts$GEOID, pl_tracts$geoid)])']
  ],
  page: [
    ['drawing order (live map): the layers added on top of everything', MAP,
      "map.addLayer(l, next || 'county-lines');", 'map.addLayer(l);', 'cvi'],
    ['gating: not grayed on National Flow', UI, 'b.disabled = flow || !!pc.missing[l];',
      'b.disabled = !!pc.missing[l];', 'cvi'],
    ['gating: Reset All leaves the layers on', UI, 'pcOff();   // PC: the three population layers off', 'void 0;', 'cvi'],
    ['gating: a missing file not grayed', UI, 'pc.missing[layer] = true;', 'void 0;', 'cvi'],
    ['gating: density not grayed over the Density view', IAPP,
      "b.disabled = !!pop.missing[l] || (l === 'density' && fill);", 'b.disabled = !!pop.missing[l];', 'infra'],
    ['gating: density drawn over the county fill', IAPP,
      "density: on.density && !!PN.loaded('density') && coverageNow() !== 'density' };",
      "density: on.density && !!PN.loaded('density') };", 'infra'],
    // The movement legend with the population layers.
    ['a population switch replaces the movement legend', UI,
      `    st.legend = st.movement ? renderMovementLegend(st.movement, $('legend-panel'))
      : renderLegend(st.data, $('legend-panel'), mapSt);`,
      "    st.legend = renderLegend(st.data, $('legend-panel'), mapSt);", 'cvi'],
    ['the movement legend without the population block', UI,
      "    pcLegend(p, 'wa');   // PC: the population layers' block while one is drawn\n", '', 'cvi'],
    // The Fit buttons, the grayed group, the outlines and the switch labels.
    ['the Fit buttons not switched with the view', UI,
      "    $('fit-wa').hidden = !wa; $('fit-focus').hidden = !focus; $('fit-conus').hidden = !flow;\n", '', 'cvi'],
    ['the grayed group not collapsed on National Flow', UI,
      "    $('pc-block').classList.toggle('pc-collapsed', flow);", '    void 0;', 'cvi'],
    ['the live outlines back in the darker gray', PN, "const OUTLINE = '#737373';",
      "const OUTLINE = '#4d4d4d';", 'cvi'],
    ['the Infrastructure switch labels at 16 px', IHTML,
      '  #pc-block .tip-row > label { display: flex;', '  #pc-block .tip-row > label.none { display: flex;', 'infra'],
    ['County lines and labels below the population group again', IHTML, ORDER.from, ORDER.to, 'infra'],
    // 2.2: the names' color follows the map's halo (light on a dark one), on each page.
    ['the names dark gray over a dark halo too', MAP,
      "el.style.setProperty('--pc-name', c.halo === '#ffffff' ? PC_NAME_DARK : c.label);",
      "el.style.setProperty('--pc-name', PC_NAME_DARK);", 'names'],
    ['the CVI page\'s names not reading the map\'s color', CHTML, NAME_CSS, NAME_CSS_OLD, 'names'],
    ['Infrastructure\'s names not reading the map\'s color', IHTML, NAME_CSS, NAME_CSS_OLD, 'names'],
    ['Emergency\'s names not reading the map\'s color', EHTML, NAME_CSS, NAME_CSS_OLD, 'names'],
    // 2.2: County Focus's live legend in groups that fold.
    ['the legend groups forget their state on a redraw', UI, "    d.addEventListener('toggle', () => { focusGroupsOpen[key] = d.open; });\n", '', 'legend'],
    ['the facility layers\' group open at the start', UI, 'const focusGroupsOpen = { cvi: true, facilities: false,',
      'const focusGroupsOpen = { cvi: true, facilities: true,', 'legend'],
    ['the legend without its 60% cap', CHTML, '  #legend-panel-focus { width: 210px; max-height: 60%; }', '  #legend-panel-focus { width: 210px; }', 'legend'],
    ['the legend hidden under the map on a phone', CHTML, '    #legend-panel-focus:not(.no-map) { display: block; }\n', '', 'legend'],
    ['the facility layers left out of the legend', UI, '    facilityGroup();\n    const activity', '    const activity', 'legend'],
    // 2.2: County Focus's map picture key: the grouping note in one line before any layer is left out.
    ['the picture key leaves layers out before the note goes to one line', BM,
      '        const notes = noteLines.length && nGroupedAway > 0 ? [noteLines, shortNote] : [noteLines];',
      '        const notes = [noteLines];', 'legend']
  ],
  p2: [
    ['county names: a free spot outside the county before step (b)', BM, 'score = 2000 + (middleIn ? 0 : 500) + k;',
      'score = 500 + (middleIn ? 0 : 500) + k;'],
    ['county names: step (b) with no preference for its own circles', BM,
      'score = hit.every(own) ? 1000 + k : 1300 + Math.min(600, others / 10) + k * 0.01;', 'score = 1000 + k;'],
    ['county names: no grid of spots across the county', BM, 'spots.push(...grid);', 'void grid;'],
    ['county names: step (a) with only the name\'s middle inside', BM, 'if (free && wholeIn) {', 'if (free && middleIn) {']
  ]
};

// The inputs the suites and the build read; their outputs land in the copy and are deleted with it.
const ARTIFACTS = ['local-test-artifacts/f1/tiers', 'local-test-artifacts/s9/facilities', 'local-test-artifacts/s9/facilities-wa',
  'local-test-artifacts/s9/oracle_s9_tier_full.json', 'local-test-artifacts/pc/oracle_pc.json', 'test-tables'];

const mode = process.argv[2];
const picks = process.argv.slice(3).map(Number);
if (mode === 'list') {
  Object.keys(GROUPS).forEach(g => GROUPS[g].forEach((m, i) => console.log(g + ' ' + (i + 1) + '. ' + m[0] + ' (' + m[1] + ')')));
  process.exit(0);
}
if (!GROUPS[mode] || picks.some(n => !Number.isInteger(n) || n < 1 || n > GROUPS[mode].length)) {
  throw new Error('Use: <unit|build|page|p2> [numbers ...] | list');
}
const list = GROUPS[mode].map((m, i) => ({ n: i + 1, name: m[0], file: m[1], from: m[2], to: m[3], part: m[4] }))
  .filter(m => !picks.length || picks.includes(m.n));
const parts = [...new Set(list.map(m => m.part).filter(Boolean))];

const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const files = [...new Set(list.map(m => m.file))];
const before = Object.fromEntries(files.map(f => [f, sha(path.join(ROOT, f))]));

function run(cmd, args, label, minutes) {
  return cp.spawnSync(cmd, args, { cwd: COPY, encoding: 'utf8', maxBuffer: 64 << 20, timeout: minutes * 60000,
    killSignal: 'SIGINT' });
}
// One run of the group's suite in the copy (the build first, for build mutants): the summary line, the failed checks
// and whether it stopped early.
function runSuite(label) {
  const started = Date.now();
  let output = '';
  if (mode === 'build') {
    const b = run('Rscript', [R, path.join(ROOT, 'local-test-artifacts', 'pc', 'src')], label, 10);
    output += '── build ──\n' + (b.stdout || '') + (b.stderr || '') + '\n── build exit ' + b.status + ' ──\n';
    if (b.status !== 0) {
      fs.writeFileSync(path.join(OUT, mode + '-' + label + '.log'), output);
      return { status: b.status, passed: null, failed: null, crashed: true, buildStopped: true,
        seconds: Math.round((Date.now() - started) / 1000) };
    }
  }
  const args = mode === 'page' ? ['tests/browser/run_pc_browser.js'].concat(parts)
    : mode === 'p2' ? ['tests/node/run_s9_unit_tests.js', 'tier_full'] : ['tests/node/run_pc_unit_tests.js'];
  const r = run(process.execPath, args, label, 8);
  output += (r.stdout || '') + (r.stderr || '');
  fs.writeFileSync(path.join(OUT, mode + '-' + label + '.log'), output);
  const m = output.match(/(\d+) passed, (\d+) failed\s*$/);
  const fails = output.split('\n').filter(l => /^\s*FAIL /.test(l));
  const crashed = !m || /FAIL run stopped/.test(output) || r.signal !== null;
  // Build mutants: some failure other than the rebuilt files' hash check.
  const beyondHash = fails.some(l => !/the reference measured this/.test(l));
  return { status: r.status, passed: m ? Number(m[1]) : null, failed: m ? Number(m[2]) : null, crashed, beyondHash,
    firstFails: fails.slice(0, 4).map(l => l.slice(0, 200)), seconds: Math.round((Date.now() - started) / 1000) };
}

if (fs.existsSync(TEMP)) throw new Error('A mutation-copy folder exists: inspect the interrupted run before starting again.');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
let caught = 0;
let restored = true;
try {
  for (const d of ['site', 'tests']) fs.cpSync(path.join(ROOT, d), path.join(COPY, d), { recursive: true });
  for (const a of ARTIFACTS) fs.cpSync(path.join(ROOT, a), path.join(COPY, a), { recursive: true });
  // The build reads the downloads; linked, not copied (41 MB, read only).
  if (mode === 'build') fs.symlinkSync(path.join(ROOT, 'local-test-artifacts', 'pc', 'src'), path.join(COPY, 'local-test-artifacts', 'pc', 'src'));

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
    // The build's outputs are put back too, so each mutant starts from the committed data files.
    const geo = mode === 'build' ? Object.fromEntries(['citylimits-wa.js', 'places-wa.js', 'tracts-wa.js']
      .map(f => [f, fs.readFileSync(path.join(COPY, 'site', 'geo', f))])) : null;
    fs.writeFileSync(p, original.replace(m.from, () => m.to));
    let r;
    try {
      r = runSuite(String(m.n));
    } finally {
      fs.writeFileSync(p, original);
      if (geo) Object.entries(geo).forEach(([f, data]) => fs.writeFileSync(path.join(COPY, 'site', 'geo', f), data));
    }
    restored = restored && sha(p) === hash;
    const ok = r.status === 1 && r.failed > 0 && !r.crashed && (mode !== 'build' || r.beyondHash);
    if (ok) caught++;
    results.push(Object.assign({ n: m.n, name: m.name, file: m.file, caught: ok }, r));
    const verdict = ok ? 'caught' : r.buildStopped ? 'BUILD STOPPED (not counted)' : r.crashed ? 'STOPPED (not counted)' : 'MISSED';
    console.log(m.n + '. ' + verdict + ': ' + m.name + ' (' + r.passed + ' passed, ' + r.failed + ' failed, ' + r.seconds + ' s)');
    (r.firstFails || []).forEach(l => console.log('     ' + l));
  }
} finally {
  fs.rmSync(TEMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  fs.writeFileSync(path.join(OUT, mode + '-' + (picks.join('-') || 'all') + '.json'), JSON.stringify(results, null, 2) + '\n');
}
const unchanged = files.every(f => sha(path.join(ROOT, f)) === before[f]);
console.log(mode + ': ' + caught + ' of ' + list.length + ' mutants caught; copy restored: ' + restored
  + '; repository files unchanged: ' + unchanged + '; copy deleted: ' + !fs.existsSync(TEMP));
if (caught !== list.length || !restored || !unchanged) process.exitCode = 1;
