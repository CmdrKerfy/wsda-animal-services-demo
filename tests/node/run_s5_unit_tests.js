#!/usr/bin/env node
'use strict';
// S5 explicit modes: scaling gate, polygon membership, premises/payloads, facilities, summaries,
// actual tiers and the complete enumerated module matrix. Browser interactions have their own foreground suite.
// Usage: fixture generator --scaling-gate; Rscript tests/oracle/cvi_r_oracle.R s5;
//        node tests/node/run_s5_unit_tests.js --scaling-gate
// Exit 0 = checks and timing target met; 1 = assertion error; 2 = correct results but timing target missed.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), vm = require('vm');
const { performance } = require('perf_hooks');
const ROOT = path.resolve(__dirname, '../..'), OUT = path.join(ROOT, 'local-test-artifacts/s5');
const mode = process.argv.slice(2).join(' ');
if (mode === '--premises') { runPremises(); return; }
if (mode === '--payloads') { runPremises(true); return; }
if (mode === '--membership') { runMembership(); return; }
if (mode === '--module-tiers') { runModuleTiers(); return; }
if (mode === '--module-facilities') { runModuleFacilities(); return; }
if (mode === '--summaries') { runSummaries(); return; }
if (mode === '--facilities') { runFacilities(); return; }
if (mode === '--module-matrix') { runModuleMatrix(); return; }
if (mode !== '--scaling-gate') throw new Error('Use --scaling-gate, --membership, --premises, --payloads, --module-facilities, --module-tiers, --summaries, --facilities or --module-matrix.');
require(path.join(ROOT, 'site/cvi/app/scaling.js'));
const S = globalThis.CVIWA.scaling;
const oracle = JSON.parse(fs.readFileSync(path.join(OUT, 'oracle_s5_gate.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'gate/cases.json'), 'utf8'));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const near = (a, b) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= 1e-9);
let pass = 0, fail = 0;
const failures = [], timings = [], differences = [];
const check = (ok, name) => { if (ok) pass++; else { fail++; failures.push(name); } };
check(oracle.cases.length === 6, 'six required premise-count/direction cases');
check(oracle.meta.classInt === '0.4.11', 'pinned classInt version (R packageVersion notation)');
check(oracle.meta.largeN === 3000 && oracle.meta.samplingDisabled === true, 'explicit exact R route');
check(Array.isArray(oracle.edgeCases) && oracle.edgeCases.length === 165, 'independent small/degenerate R cases present');
for (const c of oracle.edgeCases || []) {
  const got = S.focusSizing(c.values, c.scaling, c.bins);
  check(near(got.radii, c.radii), `edge ${c.name}: every R point radius`);
  check(c.legend === null ? got.legend === null : got.legend !== null && near(got.legend.values, c.legend.values)
    && near(got.legend.radii, c.legend.radii), `edge ${c.name}: independent R tier values and actual-map radii`);
}
// Measure calls inside the lexical engine (wrapping the exported function would miss internal calls).
// Instrument an isolated VM copy; never write to the application file. Count expensive classifications, not
// only numerical outputs, so an accidental second Fisher pass cannot slip through on a faster machine.
const source = fs.readFileSync(path.join(ROOT, 'site/cvi/app/scaling.js'), 'utf8');
const counted = source.replace('function fisherBreaks(values, n) {', 'function fisherBreaks(values, n) { root.fisherCalls++;');
check(counted !== source, 'Fisher call instrumentation attached');
const box = { fisherCalls: 0 }; vm.createContext(box); vm.runInContext(counted, box);
const countedSizing = box.CVIWA.scaling.focusSizing;
for (const scaling of ['log', 'sqrt', 'linear', 'quantile', 'natural']) {
  box.fisherCalls = 0;
  countedSizing([1, 2, 3, 10, 40, 200], scaling, 3);
  check(box.fisherCalls === (scaling === 'natural' ? 1 : 0), `${scaling}: only natural computes Fisher, once`);
}
// A tier recalculation mutant should trip that structural cost check even though its numeric results match.
const repeated = counted.replace('function focusSizing(values, scaling, nBins) {',
  'function focusSizing(values, scaling, nBins) { if (scaling === "natural") binsOf(values, scaling, nBins);');
const mutant = { fisherCalls: 0 }; vm.createContext(mutant); vm.runInContext(repeated, mutant);
mutant.CVIWA.scaling.focusSizing([1, 2, 3, 10, 40, 200], 'natural', 3);
check(repeated !== counted && mutant.fisherCalls > 1, 'repeat-partition mutation would fail the Fisher-call guard');
// Calls own their results. A new data vector or caller mutation cannot retain stale bins/legend state.
const input = [1, 2, 3, 10, 40, 200], savedInput = input.slice();
const first = S.focusSizing(input, 'natural', 3), expected = JSON.stringify(first);
first.radii[0] = -1; first.breaks[0] = -1; first.legend.values[0] = -1;
check(JSON.stringify(S.focusSizing(input, 'natural', 3)) === expected && near(input, savedInput), 'no shared mutable cache or input mutation');
check(near(S.focusSizing([10, 20, 100, 500], 'natural', 3).radii, S.computeRadius([10, 20, 100, 500], 'natural', 4, 24, 3)),
  'new input recomputes its own partition');
// Warm the existing engine without including initialization in later timings.
S.computeRadius([1, 2, 3, 10, 40], 'natural', 4, 24, 3);
for (const c of oracle.cases) {
  const fx = manifest.cases.find(f => f.name === c.name);
  check(Boolean(fx) && fx.sha256 === sha(path.join(OUT, 'gate', fx.file)) && fx.sha256 === c.fixtureSha256,
    `${c.name}: generated fixture agrees with independent reference`);
  check(c.n === c.values.length && c.n === fx.n, `${c.name}: unmodified CVI grouped premises count`);
  check(c.animalSum === fx.expectedAnimals, `${c.name}: grouped animal sum`);
  check(c.inbound + c.outbound === c.n && (c.direction !== 'inbound' || c.outbound === 0), `${c.name}: direction counts`);
  for (const v of c.views) {
    const name = `${c.name}/${v.bins}`;
    const sized = S.focusSizing(c.values, 'natural', v.bins);
    check(near(sized.breaks, v.exactBreaks), `${name}: JS exact breaks equal independent unsampled R`);
    check(near(sized.radii, v.exactRadii), `${name}: every exact R radius`);
    check(near(sized.legend.values, v.exactTiers), `${name}: exact tier midpoints`);
    check(near(sized.legend.radii, v.exactLegendRadii), `${name}: legend uses actual-map bins and 4-24 range`);
    if (c.n <= 3000) check(near(v.sampledRadii, v.exactRadii), `${name}: below sampling boundary CVI parity`);
    differences.push({ name, sampledRadiusDifferences: v.sampledRadii.filter((x, i) => Math.abs(x - v.exactRadii[i]) > 1e-9).length,
      sampledBreaks: v.sampledBreaks, exactBreaks: v.exactBreaks });
    // One call computes point radii and the complete nested legend. This remains a pure-computation gate,
    // not a settled redraw or a browser benchmark.
    const runs = [];
    for (let repeat = 1; repeat <= 3; repeat++) {
      const start = performance.now();
      const got = S.focusSizing(c.values, 'natural', v.bins);
      const end = performance.now();
      check(near(got.radii, v.exactRadii) && near(got.legend.values, v.exactTiers) && near(got.legend.radii, v.exactLegendRadii),
        `${name}: timed run ${repeat} remains correct`);
      runs.push({ repeat, totalMs: end - start });
    }
    const medianMs = runs.map(r => r.totalMs).sort((a, b) => a - b)[1];
    const timing = { name, n: c.n, direction: c.direction, bins: v.bins, runs, medianMs, targetMs: 2000, met: medianMs <= 2000 };
    timings.push(timing);
    console.log(`${name}: median ${medianMs.toFixed(1)} ms; 2,000 ms target ${timing.met ? 'MET' : 'NOT MET'}`);
  }
}
const exceeded = timings.filter(t => !t.met);
const report = { stage: 'scaling gate only', implementation: 'focusSizing: shared exact partition, no persistent cache',
  node: process.version, platform: process.platform, arch: process.arch,
  generated: new Date().toISOString(), scalingSha256: sha(path.join(ROOT, 'site/cvi/app/scaling.js')),
  oracleSha256: sha(path.join(OUT, 'oracle_s5_gate.json')), pass, fail, failures, differences, timings,
  performanceMet: exceeded.length === 0, settledRedraw: 'NOT RUN: no Focus page built',
  geometry: 'NOT RUN: checked by another mode', moduleSummaryRoute: 'NOT RUN: checked by another mode' };
fs.writeFileSync(path.join(OUT, 'scaling_gate_results.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`S5 scaling gate reference checks: ${pass} passed, ${fail} failed`);
failures.forEach(f => console.error(f));
console.log(`S5 scaling gate: ${fail ? 'ASSERTION FAILURE' : exceeded.length ? 'STOP — pure-computation target exceeded' : 'PASS'}`);
process.exitCode = fail ? 1 : exceeded.length ? 2 : 0;

// Separate bounded geometry check; does not rerun or alter the completed scaling gate.
function runMembership() {
  const dir = path.join(OUT, 'membership');
  const inputsPath = path.join(dir, 'inputs.json'), referencePath = path.join(dir, 'reference.json');
  const inputs = JSON.parse(fs.readFileSync(inputsPath, 'utf8'));
  const ref = JSON.parse(fs.readFileSync(referencePath, 'utf8'));
  require(path.join(ROOT, 'site/shared/facilities.js'));
  const compile = globalThis.CVIWA.facilities.countyMembership;
  let pass = 0, fail = 0; const failures = [];
  const check = (ok, name) => { if (ok) pass++; else { fail++; failures.push(name); } };
  const hash = (file, kind = 'sha256') => crypto.createHash(kind).update(fs.readFileSync(file)).digest('hex');
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  check(inputs.geometrySha256 === hash(path.join(ROOT, 'site/geo/wa-counties.js')), 'current bundled geometry hash');
  check(ref.meta.geometrySha256[0] === inputs.geometrySha256
    && ref.meta.inputMd5[0] === hash(inputsPath, 'md5'), 'fresh R reference for exact inputs');
  check(ref.meta.s2[0] === false && ref.meta.crs[0] === 'EPSG:4326'
    && ref.meta.boundary[0] === 'closed; outer and hole edges included', 'explicit independent boundary/CRS model');
  check(inputs.groups.length === 2 && ref.groups.length === 2, 'both required geometry groups');
  const cases = [];
  for (const g of inputs.groups) {
    const r = ref.groups.find(x => x.name[0] === g.name);
    if (!r) throw new Error(`Missing R group ${g.name}`);
    const names = g.counties.features.map(f => f.properties.name);
    check(same(r.counties, names), `${g.name}: independent R county order`);
    check(r.matches.length === g.points.length, `${g.name}: every point independently checked`);
    const all = compile(g.counties, names), empty = compile(g.counties, []);
    // Singleton selections prove multi-county union cannot conceal a wrong county assignment.
    const singles = names.map(n => compile(g.counties, [n]));
    const subsetNames = names.filter((_, i) => i % 2 === 0);
    const subset = compile(g.counties, subsetNames);
    for (let i = 0; i < g.points.length; i++) {
      const p = g.points[i], expected = r.matches[i], got = all.countiesAt(p.lon, p.lat);
      check(same(got, expected), `${g.name}/${p.name}: R county membership`);
      check(all.contains(p.lon, p.lat) === (expected.length > 0), `${g.name}/${p.name}: union`);
      check(!empty.contains(p.lon, p.lat), `${g.name}/${p.name}: no selection`);
      check(same(subset.countiesAt(p.lon, p.lat), expected.filter(n => subsetNames.includes(n))),
        `${g.name}/${p.name}: selected subset`);
      for (let j = 0; j < names.length; j++) check(singles[j].contains(p.lon, p.lat) === expected.includes(names[j]),
        `${g.name}/${p.name}: singleton ${names[j]}`);
      if (p.expected) check(same(got, p.expected), `${p.name}: explicit closed-boundary expectation`);
      cases.push({ group: g.name, name: p.name, expected, got });
    }
    check(!compile(g.counties, ['unknown county']).contains(g.points[0].lon, g.points[0].lat), 'unknown selection empty');
    check(same(compile(g.counties, [names[0], names[0]]).countiesAt(g.points[0].lon, g.points[0].lat),
      singles[0].countiesAt(g.points[0].lon, g.points[0].lat)), 'duplicate picks do not duplicate membership');
    for (const [x, y] of [[null, 47], ['', 47], ['-120', 47], [NaN, 47], [Infinity, 47],
      [-120, undefined], [-120, -91], [-181, 47]]) check(!all.contains(x, y), 'invalid/unparsed point rejected');
  }
  const wa = inputs.groups[0], point = wa.points.find(p => p.name.startsWith('Whidbey'));
  const sn = compile(wa.counties, ['Snohomish']);
  check(!sn.contains(point.lon, point.lat), 'Whidbey not included by Snohomish bbox');
  check(compile(wa.counties, ['Island']).contains(point.lon, point.lat), 'Whidbey positively located in Island County');
  // In-memory sensitivity probes; no mutation copies or page tests.
  const original = fs.readFileSync(path.join(ROOT, 'site/shared/facilities.js'), 'utf8');
  const mutants = [
    ['bbox-only', 'f.polys.some(p => inPolygon(lon, lat, p))', 'true'],
    ['holes ignored', 'if (hit > 0) return false;', 'if (hit > 0) return true;'],
    ['open boundaries', 'if (outer === 0) return true;', 'if (outer === 0) return false;'],
    ['first island only', 'f.polys.some(p => inPolygon(lon, lat, p))', 'inPolygon(lon, lat, f.polys[0])']
  ];
  for (const [name, from, to] of mutants) {
    const source = original.replace(from, to), box = {}; vm.runInNewContext(source, box);
    let mismatches = 0;
    for (let j = 0; j < inputs.groups.length; j++) {
      const g = inputs.groups[j], m = box.CVIWA.facilities.countyMembership(g.counties, g.counties.features.map(f => f.properties.name));
      g.points.forEach((p, i) => { if (!same(m.countiesAt(p.lon, p.lat), ref.groups[j].matches[i])) mismatches++; });
    }
    check(source !== original && mismatches > 0, `${name}: independent reference detects changed behavior`);
    console.log(`S5 membership sensitivity: ${name}: ${mismatches} mismatches`);
  }
  const report = { stage: 'polygon membership only', node: process.version, generated: new Date().toISOString(),
    geometrySha256: inputs.geometrySha256, facilitiesSha256: hash(path.join(ROOT, 'site/shared/facilities.js')),
    inputSha256: hash(inputsPath), referenceSha256: hash(referencePath), pass, fail, failures, cases,
    moduleReference: 'NOT RUN', premisesSubsets: 'NOT RUN', page: 'NOT BUILT' };
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  failures.forEach(f => console.error(`FAIL ${f}`));
  console.log(`S5 membership: ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}

function runPremises(payloads = false) {
  for (const file of ['csv', 'master', 'scaling', 'focus']) require(path.join(ROOT, 'site/cvi/app', file + '.js'));
  const F = globalThis.CVIWA.focus, M = globalThis.CVIWA.master;
  const out = path.join(OUT, payloads ? 'payloads' : 'premises'), refPath = path.join(out, 'reference.json');
  const ref = JSON.parse(fs.readFileSync(refPath, 'utf8'));
  const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  let pass = 0, fail = 0; const failures = [];
  const check = (ok, name) => { if (ok) pass++; else { fail++; failures.push(name); } };
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  check(ref.meta.oracleSha256 === digest(path.join(ROOT, 'tests/oracle/cvi_r_oracle.R')), 'current independent oracle source');
  check(ref.meta.manifestSha256 === digest(path.join(out, 'cases.json')), 'current fixture manifest');
  for (const [file, hash] of Object.entries(ref.meta.cviSources))
    check(hash === digest(path.join(ROOT, '../CVI_Traceability', file)), 'current CVI builder/loader ' + file);
  check(ref.cases.length === 11, 'all 11 column variants');
  const allResults = [];
  for (const c of ref.cases) {
    const file = path.join(out, c.file), loaded = M.load(fs.readFileSync(file, 'utf8'));
    check(c.sha256 === digest(file), c.name + ': current fixture');
    check(loaded.ok && loaded.physicalRows === c.physicalRows && loaded.mapRows === c.mapRows, c.name + ': loader physical/twin rows');
    check(equal(F.countyChoices(loaded), c.countyChoices), c.name + ': independent county domain');
    const saved = JSON.stringify(loaded);
    for (const [vi, v] of c.views.entries()) {
      const opts = v.opts, name = c.name + '/' + vi + '/' + v.scene;
      // R auto_unbox keeps scalar vectors scalar; make every filter a vector before calling JS.
      const array = x => Array.isArray(x) ? x : x === null ? [] : [x];
      const o = { ...opts };
      for (const k of ['counties','species','years','quarters','rawSpecies']) o[k] = array(o[k]);
      const got = F.build(loaded, o);
      check(equal(got.missingCoordinates, array(v.missingCoordinates)), name + ': missing-coordinate capability');
      check(equal(got.selectedRowIndices, array(v.selectedRowIndices)), name + ': selected master rows (WA/filter guards)');
      check(got.omittedRows === v.omittedRows, name + ': exact invalid/missing coordinate row count');
      check(got.premises.length === v.rows.length, name + ': builder premises count');
      const members = got.premises.map(g => ({ direction: g.direction, group_key: g.group_key, row_indices: g.row_indices }))
        .sort((a,b) => cmp(a.direction, b.direction) || cmp(a.group_key, b.group_key));
      const expectedMembers = v.members.map(g => ({ ...g, row_indices: array(g.row_indices) }));
      check(equal(members, expectedMembers), name + ': independent R group membership');
      for (const [i, row] of v.rows.entries()) {
        const g = got.premises[i];
        for (const [key, value] of Object.entries(row)) {
          if (payloads && ['helperPopup','helperSpecies','safeSpecies','safeTooltip','tooltip_text','species_json'].includes(key)) continue;
          const ok = typeof value === 'number' ? g && Math.abs(g[key] - value) <= 1e-9 : g && g[key] === value;
          check(ok, name + '/' + i + ': builder ' + key);
        }
      }
      if (payloads) for (const [i, row] of v.rows.entries()) {
        const g = got.premises[i];
        check(g.popup_html === row.helperPopup, name + '/' + i + ': direct popup helper');
        check(g.species_json === row.safeSpecies, name + '/' + i + ': independent safely encoded species JSON');
        check(g.tooltip_text === row.safeTooltip, name + '/' + i + ': independently escaped CVI tooltip');
        const expected = JSON.parse(row.safeSpecies), parsed = JSON.parse(g.species_json);
        check(equal(parsed, expected), name + '/' + i + ': parseable species counts');
        check(!/<(?:img|script|b)>|<img /i.test(g.popup_html + g.tooltip_text), name + '/' + i + ': file markup escaped');
      }
      allResults.push({ case: c.name, view: vi, premises: got.premises.length, omittedRows: got.omittedRows });
    }
    check(JSON.stringify(loaded) === saved, c.name + ': master unmodified');
  }
  // Hand-derived anchors and sensitivity probes prevent empty or self-comparing references.
  const full = M.load(fs.readFileSync(path.join(out, 'full.csv'), 'utf8'));
  const opts = { counties: ['King', 'Pierce'], species: ['Cattle','Poultry'], years: [2025,2026],
    quarters: ['Q1','Q2','Q3','Q4'], rawSpecies: [], direction: 'combined', mode: 'overlap', scaling: 'log', nBins: 5 };
  const got = F.build(full, opts), id = got.premises.find(g => g.group_key === 'e:D1');
  check(full.physicalRows === (payloads ? 68 : 18) && full.mapRows === (payloads ? 69 : 19), 'hand-derived physical rows plus one loader twin');
  check(id && id.total_animals === 40 && id.n_shipments === 3 && id.lon === -121.9 && id.lat === 47.4 && id.county === 'King',
    'repeated id across counties: first location; identical physical row retained');
  check(got.omittedRows === 4 && !got.selectedRowIndices.includes(12), 'four omitted coordinate rows and non-WA county homonym excluded');
  const fallback = got.premises.find(g => g.group_key === 'c:-121.9,47.4' && g.direction === 'Inbound');
  check(fallback && fallback.total_animals === 1.5 && fallback.n_shipments === 3 && fallback.n_cvis === 2 && fallback.merged_premises,
    'mixed fallback: fractions/negative/NA animals, blank CVI, repeated CVI, multiple cities');
  check(got.premises.filter(g => g.lon === -121.9 && g.lat === 47.4 && g.direction === 'Inbound').length >= 4,
    'distinct entity ids sharing coordinates remain separate');
  check(equal(F.build(full, { ...opts, counties: ['Pierce','King','King','Absent'] }), got), 'pick order/duplicates/unknown counties do not change groups');
  const source = fs.readFileSync(path.join(ROOT, 'site/cvi/app/focus.js'), 'utf8');
  const probes = [
    ['coordinate-only identity', "nonblank(eid) ? 'e:' + eid.trim() : 'c:' + lon + ',' + lat", "'c:' + lon + ',' + lat"],
    ['county-prefixed identity', "const id = dir + '\\r' + key;", "const id = dir + '\\r' + r[end + '.County'] + key;"],
    ['WA guard removed', "|| r[end + '.State'] !== 'WA'", ''],
    ['range guard removed', '|| Math.abs(lon) > 180 || Math.abs(lat) > 90', ''],
    ['merge warning removed', "g.group_key.startsWith('c:') && g.cities.size > 1", 'false']
  ];
  const sensitivity = [];
  for (const [name, from, to] of probes) {
    const mutated = source.replace(from, to);
    check(mutated !== source, name + ': probe attached');
    const box = { CVIWA: { master: M, scaling: globalThis.CVIWA.scaling } };
    vm.runInNewContext(mutated, box);
    const changed = !equal(box.CVIWA.focus.build(full, opts), got);
    check(changed, name + ': hand fixture detects changed result'); sensitivity.push({ name, detected: changed });
  }
  // Missing CVI remains unavailable; City/ids/Species are independently removable.
  check(ref.cases.find(c => c.name === 'no_city').directBuilder.error !== null, 'direct unmodified CVI missing-City failure recorded');
  for (const c of ref.cases.filter(c => c.name.startsWith('missing_') || c.name === 'required_only'))
    check(c.directBuilder.class === 'cvi_missing_premise_coords', c.name + ': CVI typed coordinate error recorded');
  const payloadSensitivity = [];
  if (payloads) {
    require(path.join(ROOT, 'site/cvi/app/focusmap.js'));
    const summed = globalThis.CVIWA.focusmap.sumLeaves([
      { properties: { total_animals: 17, species_json: '{"__proto__":4,"constructor":5,"toString":6,"Cattle":2}' } },
      { properties: { total_animals: 7, species_json: '{"__proto__":3,"constructor":2,"toString":1,"Cattle":1}' } }
    ]);
    check(summed.animals === 24, 'cluster hand fixture: two leaves total 24 animals');
    for (const [key, value] of [['__proto__', 7], ['constructor', 7], ['toString', 7], ['Cattle', 3]])
      check(Object.hasOwn(summed.spec, key) && typeof summed.spec[key] === 'number' && summed.spec[key] === value,
        'cluster hand fixture: own numeric sum for raw species ' + key);
    check(Object.keys(summed.spec).length === 4, 'cluster hand fixture: all four file labels retained');
    const quotePath = path.join(out, 'loader_quote_probe.csv');
    check(digest(quotePath) === ref.meta.loaderQuoteProbeSha256, 'current loader quote probe');
    const quoteRow = M.load(fs.readFileSync(quotePath, 'utf8')).rows[0];
    check(quoteRow.CVI === 'SYN "quoted"' && ref.loaderQuoteProbe.cvi === 'SYN ""quoted""',
      'separate recorded loader difference: doubled CVI quotes');
    check(quoteRow.Species === 'Cattle "quoted"' && ref.loaderQuoteProbe.species === 'Cattle ""quoted""',
      'separate recorded loader difference: doubled species quotes');
    const helperPath = path.join(out, 'helper_inputs.json');
    check(digest(helperPath) === ref.meta.helperInputsSha256, 'current direct helper inputs');
    const inputs = JSON.parse(fs.readFileSync(helperPath, 'utf8'));
    for (const [i, probe] of inputs.entries()) {
      const expected = ref.probes[i];
      check(F.popup(probe.rows, true) === expected.popup, probe.name + ': direct helper quoted popup');
      check(F.popup(probe.rows, false) === expected.noCviPopup, probe.name + ': direct helper absent CVI popup');
      check(F.speciesJson(probe.rows, 'Species') === expected.safeSpecies, probe.name + ': direct helper safe JSON');
    }
    check(ref.probes[0].species !== ref.probes[0].safeSpecies, 'CVI control/backslash JSON difference retained');
    const busy = got.premises.find(g => g.group_key === 'e:BUSY');
    check(busy.n_shipments === 31 && busy.n_cvis === 30 && (busy.popup_html.match(/<tr><td>/g) || []).length === 25
      && busy.popup_html.includes('+5 more CVIs'), 'hand: distinct details capped at 25 while shipments retain duplicate');
    check(busy.popup_html.indexOf('SYN000') < busy.popup_html.indexOf('SYN024') && !busy.popup_html.includes('SYN025'), 'hand: sort before cap');
    const raw = F.build(full, { ...opts, species: ['Cattle'] }).premises.find(g => g.group_key === 'e:JSON');
    check(raw.species_json === '{"__proto__":4,"Line\\\\break\\nnext":-2}', 'hand: safe unusual keys and negative half-even rounding');
    const markup = F.build(full, { ...opts, species: ['Cattle'] }).premises.find(g => g.group_key === 'e:MARKUP');
    check(markup.species_json === '{"Cattle quoted":2}', 'hand: trim and CVI quote substitution; positive half-even rounding');
    check(markup.tooltip_text.includes('&lt;script&gt;city&lt;/script&gt; &amp; text')
      && markup.popup_html.includes("&lt;img src=x onerror=alert(1)&gt; &amp; 'quoted'"), 'hand: cell/hover escaping preserves quotes as text');
    const noCvi = M.load(fs.readFileSync(path.join(out, 'no_cvi.csv'), 'utf8'));
    const missing = F.build(noCvi, opts).premises.find(g => g.group_key === 'e:BUSY');
    check(missing.n_cvis === null && !missing.tooltip_text.includes('CVIs:') && missing.popup_html.includes('<td>—</td>'), 'hand: absent CVI retains popup details and omits hover CVI value');
    // CVI numbers in the real CVI format; written-out order = code-point order = R's order() here.
    const fmtOrder = ['2024-WA-1', '23-ID-9', '24-OR-77001234', '24-WA-2134823', '24-WA-21348232', '24-WA-21348232-B',
      '24-WA-21348232A', '24-WA-21348233', '25-WA-00012345'];
    const cviCells = html => [...html.matchAll(/<tr><td>([^<]*)<\/td>/g)].map(m => m[1]);
    check(equal([...fmtOrder].sort(cmp), fmtOrder), 'hand: real-format expected order is code-point order');
    const fmt = got.premises.find(g => g.group_key === 'e:REALFMT');
    check(fmt && fmt.n_cvis === 9 && equal(cviCells(fmt.popup_html), fmtOrder), 'hand: real-format CVI popup order');
    const refFmt = ref.cases.find(c => c.name === 'full').views[0].rows.find(r => r.popup_html && r.popup_html.includes('2024-WA-1'));
    check(refFmt && equal(cviCells(refFmt.popup_html), fmtOrder) && ref.meta.collation && ref.meta.collation.locale,
      'R order() under the recorded collation gives the same real-format order');
    // Recorded difference outside the real format: R's ICU order puts "<" before digits; code-point order does not.
    const coll = ref.meta.collation || {}, probe = coll.symbolProbe || [];
    check(equal([...probe].sort(cmp), coll.symbolProbeRadix) && equal(coll.symbolProbeOrder, ['<x>', '2024-WA-1', '24-WA-21348232', 'SYN-A'])
      && !equal(coll.symbolProbeOrder, coll.symbolProbeRadix), 'recorded difference: symbol-led CVI sorts first in R ICU order, not in code-point order');
    const pair = got.premises.find(g => g.group_key === 'e:REALPAIR');
    check(pair && pair.tooltip_text.includes('CVIs: 24-WA-2134823, 24-WA-21348232<br/>'), 'hand: two real-format CVIs listed sorted in hover');
    for (const [name, from, to] of [
      ['popup cap removed', 'maxRows = 25', 'maxRows = 250'],
      ['popup dedup removed', 'distinct.set(JSON.stringify(item), item)', 'distinct.set(distinct.size, item)'],
      ['popup sort removed', '.sort((a, b) => cmp(a.cvi, b.cvi))', ''],
      ['hyphen-ignoring CVI collation', '.sort((a, b) => cmp(a.cvi, b.cvi))', ".sort((a, b) => cmp(a.cvi && a.cvi.replace(/-/g, ''), b.cvi && b.cvi.replace(/-/g, '')))"],
      ['escaping removed', "replace(/</g, '&lt;')", "replace(/</g, '<')"],
      ['species rounding changed', 'root.CVIWA.scaling.rRound(n)', 'Math.round(n)'],
      ['raw drill-down removed', "opts.species.length === 1 && master.hasSpecies", 'false']
    ]) {
      const mutated = source.replace(from, to); check(mutated !== source, name + ': attached');
      const box = { CVIWA: { master: M, scaling: globalThis.CVIWA.scaling } }; vm.runInNewContext(mutated, box);
      const changed = !equal(box.CVIWA.focus.build(full, { ...opts, species: ['Cattle'] }), F.build(full, { ...opts, species: ['Cattle'] }));
      check(changed, name + ': detected'); payloadSensitivity.push({ name, detected: changed });
    }
  }
  const report = { stage: payloads ? 'bounded popup/species payloads' : 'bounded pure premises/subsets', pass, fail, failures, views: allResults.length,
    node: process.version, focusSha256: digest(path.join(ROOT, 'site/cvi/app/focus.js')), referenceSha256: digest(refPath),
    oracleSha256: ref.meta.oracleSha256, manifestSha256: ref.meta.manifestSha256, collation: ref.meta.collation || null, sensitivity, payloadSensitivity, results: allResults,
    deferred: 'summary/module/facility/full tier matrix, page and settled redraw NOT RUN' };
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  for (const f of failures.slice(0, 30)) console.error('FAIL ' + f);
  console.log(`S5 ${payloads ? "payloads" : "premises"}: ${pass} passed, ${fail} failed; ${allResults.length} views`);
  console.log('exit ' + (fail ? 1 : 0)); if (fail) process.exitCode = 1;
}

// Focus value boxes and strip: pure focus.js rules against every box/strip the unchanged CVI module rendered in the
// saved module-route (initial view and four Browse frames), module-facilities and module-tiers references. Deliberate
// differences are checked beside CVI's values, never by comparing a function with itself.
function runModuleMatrix() {
  for (const f of ['csv', 'master', 'scaling', 'summary', 'focus', 'periods']) require(path.join(ROOT, f === 'facilities' ? 'site/shared/facilities.js' : 'site/cvi/app/' + f + '.js'));
  const C = globalThis.CVIWA, F = C.focus, folder = path.join(OUT, 'module-matrix');
  const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  const array = x => x == null ? [] : [].concat(x), equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  const flat = x => String(x).replace(/\s+/g, ' ').trim();
  let passed = 0, failed = 0; const failures = [], ledger = [], page = [], sourceOutcomes = [];
  const check = (ok, label) => { if (ok) passed++; else { failed++; failures.push(label); } };
  for (const tier of ['fixture', 'full', 'partner', 'public']) {
    const referenceFile = path.join(folder, 'reference_' + tier + '.json');
    const ref = JSON.parse(fs.readFileSync(referenceFile)), route = ref.routes.approved_input;
    check(ref.meta.oracle_sha256 === hash(path.join(ROOT, 'tests/oracle/cvi_r_oracle.R')), tier + ': current oracle');
    check(ref.meta.input_sha256 === hash(path.join(ROOT, ref.meta.input_file)), tier + ': current input');
    check(ref.meta.geometry_input_sha256 === hash(path.join(OUT, 'membership/inputs.json')), tier + ': current geometry');
    for (const [src, digest] of Object.entries(ref.meta.source_sha256))
      check(hash(path.join(ROOT, '../CVI_Traceability/shiny', src)) === digest, tier + ': unchanged source ' + src);
    check(ref.meta.paths_requested.every(p => p.startsWith(folder + '/empty_cvi_root/')), tier + ': synthetic paths');
    const master = C.master.load(fs.readFileSync(path.join(ROOT, ref.meta.input_file), 'utf8'));
    check(master.ok && master.physicalRows === ref.physical_rows && master.mapRows === ref.map_rows, tier + ': loader rows');
    const domains = C.periods.domains(master);
    check(equal(domains, route.domains), tier + ': whole-master period domains');
    const variants = ['combined', 'inbound', 'outbound'].flatMap(direction => ['overlap', 'side_by_side'].map(mode => [direction,mode]));
    const sizing = route.views.filter(v => v.scene === 'scaling_bins');
    check(sizing.length === (['fixture','full'].includes(tier) ? 180 : 0), tier + ': all 5 scalings x 6 bins x 6 direction/mode views');
    if (sizing.length) for (const [direction,mode] of variants) for (const scaling of ['log','sqrt','linear','quantile','natural']) for (const nBins of [3,4,5,6,7,10])
      check(sizing.filter(v => v.opts.direction === direction && v.opts.mode === mode && v.opts.scaling === scaling && v.opts.nBins === nBins).length === 1,
        tier + ': exact sizing case ' + [direction,mode,scaling,nBins].join('/'));
    const scenes = ['single_county','multiple_counties','group','raw_refine','empty_counties','empty_species','empty_years','empty_quarters','first_period','last_period','empty_result'];
    for (const scene of scenes) for (const [direction,mode] of variants)
      check(route.views.filter(v => v.scene === scene && v.opts.direction === direction && v.opts.mode === mode).length === 1, tier + ': filter scene ' + scene + '/' + direction + '/' + mode);
    check(equal(array(ref.required_cases), route.views.map(v => v.id)), tier + ': complete required-case ledger');
    check(route.frames.length === (domains.quarter.length + domains.year.length) * 6, tier + ': every Browse frame in six variants');
    for (const [direction,mode] of variants) for (const step of ['quarter','year']) for (let index=1;index<=domains[step].length;index++)
      check(route.frames.filter(v=>v.opts.direction===direction&&v.opts.mode===mode&&v.step===step&&v.index===index).length===1,
        tier+': exact Browse case '+[direction,mode,step,index].join('/'));
    for (const [sourceRoute, results] of Object.entries(ref.routes)) for (const v of [...results.views,...results.frames])
      for (const key of ['premises','summary','boxes','strip']) if (v[key].status !== 'ok')
        sourceOutcomes.push({tier,route:sourceRoute,id:v.id,field:key,error:v[key].error,classes:v[key].classes});
    const pageTier = {tier, input:ref.meta.input_file, inputSha256:ref.meta.input_sha256, referenceSha256:hash(referenceFile), domains, cases:[], resets:route.resets};
    for (const v of [...route.views,...route.frames]) {
      const o = {...v.opts}; for (const key of ['counties','species','years','quarters','rawSpecies']) o[key] = array(o[key]);
      const tag = v.id, built = F.build(master,o), summary = F.summary(master,o,built), boxes = F.valueBoxes(summary,built.missingCoordinates), strip = F.strip(o,built);
      check(equal(built.selectedRowIndices,array(v.selection.row_indices)), tag + ': independent selected rows');
      check(built.omittedRows === v.selection.omitted_rows, tag + ': independent omitted rows');
      const members = built.premises.map(p => ({direction:p.direction,group_key:p.group_key,row_indices:p.row_indices}));
      const sortMembers = a => a.sort((x,y) => x.direction.localeCompare(y.direction) || x.group_key.localeCompare(y.group_key));
      check(equal(sortMembers(members),sortMembers(v.selection.members.map(m => ({...m,row_indices:array(m.row_indices)})))), tag + ': independent R group membership');
      let rows = array(v.premises.value), cviStrip = v.strip.value, companion = false;
      if (v.premises.status !== 'ok') {
        if (v.approved_direction_companion) {
          const dirs = new Set(v.selection.members.map(m => m.direction));
          check(o.direction === 'combined' && dirs.size === 1 && /popup_html/.test(v.premises.error) && /data.frame/.test(v.premises.error), tag + ': exact known one-direction Combined source failure');
          const c = v.approved_direction_companion;
          check(c.premises.status === 'ok' && c.strip.status === 'ok', tag + ': unchanged single-role module companion');
          rows = array(c.premises.value).map(r => ({...r,lon:r.lon + (o.mode === 'side_by_side' ? (r.direction === 'Inbound' ? -0.008 : 0.008) : 0)}));
          cviStrip = c.strip.value; companion = true;
        } else {
          const requirement = v.premises.error === '' && array(v.premises.classes).includes('shiny.silent.error');
          const emptyResult = !array(v.selection.row_indices).length && !v.selection.members.length && o.counties.length && o.species.length && o.years.length && o.quarters.length
            && /popup_html/.test(v.premises.error) && /data.frame/.test(v.premises.error) && v.summary.status === 'ok' && v.summary.value === null
            && v.boxes.status === 'ok' && v.boxes.value.state === 'alert' && v.strip.status === 'ok' && v.strip.value.state === 'message';
          check(!built.premises.length && (requirement || emptyResult), tag + ': empty requirement/result comparison; source failure retained');
          rows = [];
        }
      }
      check(built.premises.length === rows.length, tag + ': module premises count');
      rows.forEach((r,i) => {
        const got = built.premises[i];
        for (const key of ['direction','lon','lat','total_animals','n_shipments','n_cvis','city','state','county','premises_id','radius_px','color','popup_html','tooltip_text','species_json']) {
          const expected = r[key];
          check(got && (typeof expected === 'number' ? Math.abs(got[key]-expected) <= 1e-9 : got[key] === expected), tag + '/' + i + ': module ' + key);
        }
      });
      check(v.summary.status === 'ok' && v.boxes.status === 'ok' && v.strip.status === 'ok', tag + ': direct module summary/boxes/strip reachable');
      const s = v.summary.value, vb = v.boxes.value;
      check((summary === null) === (s === null), tag + ': empty result summary');
      if (summary && s) for (const key of ['total_animals','n_cvis','n_premises','top_species']) {
        const gated = (key === 'n_cvis' && !master.header.includes('CVI')) || (key === 'n_premises' && built.missingCoordinates.length);
        check(gated ? summary[key] === null && s[key] === 0 : summary[key] === s[key], tag + ': Combined module summary ' + key);
      }
      check(boxes.state === vb.state, tag + ': box state');
      if (boxes.state === 'metrics') boxes.metrics.forEach((m,i) => {
        const e = vb.metrics[i], gated = (i === 1 && !master.header.includes('CVI')) || (i === 2 && built.missingCoordinates.length);
        check(m.label === e.label && m.icon === e.icon && m.accent === e.accent, tag + ': box ' + i + ' labels/style');
        check(gated ? m.disabled && m.text === '—' && e.text === '0' : m.text === e.text && m.zero === e.zero, tag + ': box ' + i + ' value/deliberate gate');
      });
      else check(equal(boxes.lines,vb.lines), tag + ': alert text');
      if (built.missingCoordinates.length && o.counties.length) {
        check(cviStrip.state === 'message' && strip.state === 'message' && built.missingCoordinates.every(k => strip.lines[0].includes(k)), tag + ': independent missing-column explanation');
      } else {
        check(strip.state === cviStrip.state, tag + ': strip state');
        if (strip.state === 'summary') {
          check(strip.items.length === cviStrip.items.length + (built.omittedRows ? 1 : 0), tag + ': strip rows plus the undrawn notice (by design)');
          cviStrip.items.forEach((e,i) => check(strip.items[i] && strip.items[i].label === e.label && strip.items[i].text === flat(e.text), tag + ': module strip ' + i));
        } else check(equal(strip.lines,cviStrip.lines), tag + ': strip message');
      }
      if (v.step) {
        const frame = C.periods.frame(domains,v.step,v.index);
        check(equal(frame.years,o.years) && equal(frame.quarters,o.quarters), tag + ': module-selected Browse frame');
        check(C.periods.timeLabel(domains,v.step,v.index) === v.label, tag + ': module period label');
      }
      ledger.push({id:tag,premises:rows.length,approvedA1:companion,frame:!!v.step});
      // Page expectations are module values plus independently defined deliberate differences, not product outputs.
      pageTier.cases.push({id:tag,opts:o,rows,selection:v.selection,missingCoordinates:['Origin.Lat','Origin.Long','Dest.Lat','Dest.Long'].filter(k => !master.header.includes(k)),
        boxes:vb,strip:cviStrip,approvedA1:companion,step:v.step,index:v.index,label:v.label,hasCvi:master.header.includes('CVI')});
    }
    check(route.resets.length === 6, tier + ': reset from six variants');
    for (const [direction,mode] of variants) check(route.resets.filter(r=>r.direction===direction&&r.mode===mode).length===1,tier+': exact reset variant '+direction+'/'+mode);
    const defaults = F.resetDefaults(master);
    for (const r of route.resets) {
      const value = id => r.messages.find(m => m.id === id)?.msg.value;
      for (const [key,id] of Object.entries({counties:'intra_counties',direction:'intra_filter_dir',mode:'intra_mode',species:'intra_species',speciesSub:'intra_species_sub',years:'intra_year',quarters:'intra_quarter',scaling:'intra_scaling',nBins:'intra_n_bins',opacity:'intra_opacity',labels:'intra_show_labels',outlines:'intra_show_outlines',labelStyle:'intra_label_style',boundaryStyle:'intra_boundary_style',hide:'hide_cvi_circles'})) {
        let e = value(id); if (key === 'years') e = array(e).map(Number); if (key === 'nBins') e = Number(e);
        if (Array.isArray(defaults[key])) e = array(e);
        check(equal(defaults[key],e), tier + '/reset/' + r.direction + '/' + r.mode + ': module ' + key);
      }
      check(!r.messages.some(m => ['intra_time_enabled','intra_time_step','intra_time_slider'].includes(m.id)), tier + ': CVI leaves Browse controls; the page stops Browse (by design)');
    }
    page.push(pageTier);
  }
  const result = {passed,failed,failures,ledger,sourceOutcomes,companionChecks:ledger.filter(x => x.approvedA1).length};
  fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify(result,null,2)+'\n');
  if (!failed) fs.writeFileSync(path.join(folder,'page_reference.json'),JSON.stringify({oracleSha256:hash(path.join(ROOT,'tests/oracle/cvi_r_oracle.R')),tiers:page})+'\n');
  console.log(`S5 module matrix: ${passed} passed, ${failed} failed; ${ledger.length} module views/frames; ${result.companionChecks} one-direction Combined companions; source outcomes retained separately`);
  failures.slice(0,30).forEach(x => console.error('FAIL '+x));
  process.exitCode = failed ? 1 : 0;
}

function runSummaries() {
  for (const f of ['csv', 'master', 'scaling', 'summary', 'focus']) require(path.join(ROOT, f === 'facilities' ? 'site/shared/facilities.js' : 'site/cvi/app/' + f + '.js'));
  const C = globalThis.CVIWA, F = C.focus;
  const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  const oracleHash = hash(path.join(ROOT, 'tests/oracle/cvi_r_oracle.R'));
  let passed = 0, failed = 0; const failures = [], views = [], differences = [];
  const check = (ok, name) => { if (ok) passed++; else { failed++; failures.push(name); } };
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const flat = t => String(t).replace(/\s+/g, ' ').trim();   // CVI's strip text as the browser renders it
  const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
  const refs = {};
  for (const [name, file] of [['route', 'module-route'], ['facilities', 'module-facilities'], ['tiers', 'module-tiers']]) {
    const refPath = path.join(OUT, file, 'reference.json'); refs[name] = JSON.parse(fs.readFileSync(refPath, 'utf8'));
    check(refs[name].meta.oracle_sha256 === oracleHash, file + ': current oracle hash');
    for (const [src, digest] of Object.entries(refs[name].meta.source_sha256))
      check(hash(path.join(ROOT, '../CVI_Traceability/shiny', src)) === digest, file + ': unchanged CVI source ' + src);
  }
  check(hash(path.join(OUT, 'module-route/master.csv')) === refs.route.meta.fixture_sha256, 'module-route: current fixture');
  check(hash(path.join(OUT, 'module-facilities/master.csv')) === refs.facilities.meta.fixture_sha256, 'module-facilities: current fixture');
  // One view: CVI's summary numbers, rendered boxes and strip against the pure rules; `missing` lists the deliberate gaps.
  function compare(tag, master, opts, cvi) {
    const built = F.build(master, opts), s = F.summary(master, opts, built), vb = F.valueBoxes(s, built.missingCoordinates);
    const st = F.strip(opts, built), noCvi = !master.header.includes('CVI'), noCoords = built.missingCoordinates.length > 0;
    check(s !== null && cvi.summary !== null, tag + ': rows in view');
    check(s.total_animals === cvi.summary.total_animals, tag + ': Total animals (merged WA-to-WA copies)');
    check(s.top_species === cvi.summary.top_species, tag + ': Top species');
    check(noCvi ? s.n_cvis === null && cvi.summary.n_cvis === 0 : s.n_cvis === cvi.summary.n_cvis, tag + ': Unique CVIs');
    check(noCoords ? s.n_premises === null && cvi.summary.n_premises === 0 : s.n_premises === cvi.summary.n_premises, tag + ': Premises');
    check(vb.state === 'metrics' && vb.metrics.length === 4 && (!cvi.boxes || cvi.boxes.state === 'metrics'), tag + ': four boxes');
    if (cvi.boxes) vb.metrics.forEach((m, i) => {
      const e = cvi.boxes.metrics[i], gated = (i === 1 && noCvi) || (i === 2 && noCoords);
      check(m.label === e.label && m.icon === e.icon && m.accent === e.accent, tag + ': box ' + i + ' label/icon/accent');
      if (gated) check(m.disabled && m.text === '—' && e.text === '0' && e.zero, tag + ': box ' + i + ' grayed where CVI shows 0 (by design)');
      else check(m.text === e.text && m.zero === e.zero, tag + ': box ' + i + ' text and zero style');
    });
    check(vb.metrics[0].help === F.HELP_TOTAL, tag + ': Total animals help text');
    if (noCoords) {
      check(cvi.strip.state === 'message' && equal(cvi.strip.lines, ['No records match the selected counties + filters.']), tag + ': CVI no-records strip');
      check(st.state === 'message' && built.missingCoordinates.every(c => st.lines[0].includes(c)), tag + ': strip names the missing columns (by design)');
      check(vb.metrics[2].reason === 'Needs the columns ' + built.missingCoordinates.slice(0, -1).join(', ') + ' and '
        + built.missingCoordinates.slice(-1)[0] + ' in the CVI master table.', tag + ': premises box reason');
      differences.push({ view: tag, cvi: 'Unique CVIs/Premises 0, strip "No records match"', page: 'grayed with the missing columns; strip names them' });
    } else if (cvi.strip.state === 'message') {
      check(st.state === 'message' && equal(st.lines, cvi.strip.lines), tag + ': strip message');
    } else {
      check(st.state === 'summary' && st.items.length === (built.omittedRows ? 5 : 4), tag + ': strip items (plus rows not on the map)');
      cvi.strip.items.forEach((e, i) => check(st.items[i] && st.items[i].label === e.label && st.items[i].text === flat(e.text), tag + ': strip ' + flat(e.label)));
      check(st.items[2].help === F.HELP_STRIP, tag + ': strip Animals help text');
    }
    views.push({ view: tag, summary: s, strip: st.state === 'summary' ? st.items.map(x => x.label + x.text) : st.lines });
    return { built, s, st };
  }
  // Module route: King, Cattle, both years, Combined/Overlapping; then CVI's own Browse messages for each frame.
  const route = C.master.load(fs.readFileSync(path.join(OUT, 'module-route/master.csv'), 'utf8'));
  const base = { counties: ['King'], species: ['Cattle'], years: [2025, 2026], quarters: QUARTERS, rawSpecies: [],
    direction: 'combined', mode: 'overlap', scaling: 'log', nBins: 5 };
  const first = compare('route/initial', route, base, refs.route.reference.initial);
  check(first.s.total_animals === 100 && first.st.items[2].text === '90' && first.st.items[3].text === '4 (2 importer, 2 exporter)'
    && first.built.omittedRows === 1, 'hand: box 100 (undrawn 40 kept, twins merged), strip 90, 4 premises; 1 row not on the map');
  check(first.st.items[4] && first.st.items[4].text === '1 row without a usable premises location', 'hand: the undrawn row is counted (by design)');
  differences.push({ view: 'route/initial', cvi: 'no count of undrawn rows', page: '"Not on the map: 1 row without a usable premises location"' });
  for (const fr of refs.route.reference.frames) {
    const msg = id => { const m = fr.messages.find(x => x.id === id); return [].concat(m.msg.value); };
    const opts = { ...base, years: msg('intra_year').map(Number), quarters: msg('intra_quarter') };
    const tag = 'route/frame ' + fr.step + ' ' + fr.label;
    if (fr.summary === null) {
      check(F.summary(route, opts) === null && equal(F.valueBoxes(null), C.summary.valueBoxes(null)), tag + ': no rows, CVI alert boxes');
      const st = F.strip(opts, F.build(route, opts));
      check(st.state === 'message' && equal(st.lines, fr.strip.lines), tag + ': strip message');
      views.push({ view: tag, summary: null, strip: st.lines });
    } else compare(tag, route, opts, fr);
  }
  // Module facilities: six direction/mode views on the same small master.
  const fac = C.master.load(fs.readFileSync(path.join(OUT, 'module-facilities/master.csv'), 'utf8'));
  for (const [name, v] of Object.entries(refs.facilities.reference.facility_views)) {
    const [direction, mode] = name.split('/');
    compare('facilities/' + name, fac, { ...base, direction, mode }, v);
  }
  // Actual Full/Partner/Public tiers, all counties, the six views each.
  const tiers = refs.tiers.tiers;
  check(hash(path.join(OUT, 'module-tiers/cases.json')) === refs.tiers.meta.manifest_sha256, 'module-tiers: current manifest');
  for (const tier of ['full', 'partner', 'public']) {
    const file = tier === 'partner' ? 'partner_county_totals.csv' : 'CVI_Consolidated_Master.csv';
    const master = C.master.load(fs.readFileSync(path.join(OUT, 'module-tiers', tier, file), 'utf8'));
    for (const [name, v] of Object.entries(tiers[tier].views)) {
      const opts = { ...v.filters, direction: v.direction, mode: v.mode, scaling: 'log', nBins: 5, rawSpecies: [] };
      check(v.summary.status === 'ok' && v.boxes.status === 'ok' && v.strip.status === 'ok', tier + '/' + name + ': module outputs');
      const got = compare(tier + '/' + name, master, opts, { summary: v.summary.value, boxes: v.boxes.value, strip: v.strip.value });
      if (tier === 'full' && name === 'combined/overlap')
        check(got.s.total_animals === 963984 && got.st.items[2].text === '1,106,508' && got.st.items[3].text === '569 (277 importer, 292 exporter)',
          'hand: Full Combined 963,984 / 1,106,508 / 569 (277 importer, 292 exporter) as recorded');
    }
  }
  // CVI's two strip prompts (module views with no picks are not in the saved references): checked against its source.
  const cviSource = fs.readFileSync(path.join(ROOT, '../CVI_Traceability/shiny/modules/mod_maps.R'), 'utf8');
  const noPicks = F.strip({ ...base, counties: [] }, F.build(route, { ...base, counties: [] }));
  check(cviSource.includes('"' + noPicks.lines[0] + '"') && F.summary(route, { ...base, counties: [] }) === null, 'source: no-picks prompt and alert boxes');
  check(cviSource.includes('"No records match the selected counties + filters."'), 'source: no-records text');
  // Deliberate differences on synthetic rows the module references do not hold.
  const prem = C.master.load(fs.readFileSync(path.join(OUT, 'premises/full.csv'), 'utf8'));
  const popts = { ...base, counties: ['King', 'Pierce'], species: ['Cattle', 'Poultry'] };
  const homonym = prem.rows.findIndex(r => r['Dest.State'] === 'OR' && r['Dest.County'] === 'King' && r.Movement === 'Inbound');
  check(homonym >= 0 && !F.summaryRows(prem, popts).includes(prem.rows[homonym]), 'WA guard: same-named county in OR not counted (by design)');
  const inOnly = { ...base, direction: 'combined' }, oneDir = C.master.load(fs.readFileSync(path.join(OUT, 'module-route/master.csv'), 'utf8'));
  oneDir.rows = oneDir.rows.filter(r => r.Movement === 'Inbound');
  const a1 = F.strip(inOnly, F.build(oneDir, inOnly));
  check(a1.state === 'summary' && /\(\d+ importer, 0 exporter\)$/.test(a1.items[3].text), 'one direction: Combined with no exporters summarizes the importers (by design)');
  const allOff = { ...route, rows: route.rows.map(r => ({ ...r, 'Dest.Lat': null, 'Origin.Lat': null })) };
  const off = F.strip(base, F.build(allOff, base));
  check(off.state === 'message' && /^No premises can be placed: \d+ rows without a usable premises location\.$/.test(off.lines[0]), 'no usable location: says so instead of "No records match"');
  // In-memory sensitivity: each change must make a CVI comparison or anchor fail.
  const source = fs.readFileSync(path.join(ROOT, 'site/cvi/app/focus.js'), 'utf8'), sensitivity = [];
  for (const [name, from, to, probe] of [
    ['intrastate copies not merged', 'SUM().dedupeVolume(sub)', 'sub', B => B.summary(route, base).total_animals === 100],
    ['WA guard removed from boxes', "&& counties.has(r[end + '.County']) && r[end + '.State'] === 'WA'", "&& counties.has(r[end + '.County'])",
      B => !B.summaryRows(prem, popts).includes(prem.rows[homonym])],
    ['undrawn rows dropped from boxes', 'if (!sub.length) return null;\n    if (opts.rawSpecies', "sub = sub.filter(r => r[(r.Movement === 'Inbound' ? 'Dest' : 'Origin') + '.Lat'] !== null);\n    if (!sub.length) return null;\n    if (opts.rawSpecies",
      B => B.summary(route, base).total_animals === 100],
    ['strip sums box rows', 'const sum = ps.reduce((t, p) => t + p.total_animals, 0)', 'const sum = 100',
      B => B.strip(base, B.build(route, base)).items[2].text === '90'],
    ['importers/exporters swapped', "ps.filter(p => p.direction === 'Inbound')", "ps.filter(p => p.direction === 'Outbound')",
      B => { const t = B.strip(inOnly, B.build(oneDir, inOnly)).items[3].text; return / 0 exporter\)$/.test(t); }],
    ['premises box not gated', 'n_premises: b.missingCoordinates.length ? null : b.premises.length', 'n_premises: b.premises.length',
      B => { const m = C.master.load(fs.readFileSync(path.join(OUT, 'module-tiers/partner/partner_county_totals.csv'), 'utf8'));
        const v = tiers.partner.views['combined/overlap'], o = { ...v.filters, direction: 'combined', mode: 'overlap', rawSpecies: [] };
        return B.summary(m, o).n_premises === null; }]
  ]) {
    const mutated = source.replace(from, to);
    check(mutated !== source, name + ': probe attached');
    const box = { CVIWA: { master: C.master, scaling: C.scaling, summary: C.summary } };
    vm.runInNewContext(mutated, box);
    let held; try { held = probe(box.CVIWA.focus); } catch (e) { held = false; }
    check(probe(F) && !held, name + ': detected'); sensitivity.push({ name, detected: probe(F) && !held });
  }
  const result = { stage: 'Focus value boxes and strip against unchanged CVI module output', passed, failed, failures,
    views: views.length, node: process.version, focusSha256: hash(path.join(ROOT, 'site/cvi/app/focus.js')),
    summarySha256: hash(path.join(ROOT, 'site/cvi/app/summary.js')), oracleSha256: oracleHash, sensitivity, differences, results: views,
    deferred: 'no-picks/one-direction-Combined/refine/raw-species module views, page rendering and settled redraw NOT RUN' };
  fs.mkdirSync(path.join(OUT, 'summaries'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'summaries/results.json'), JSON.stringify(result, null, 2) + '\n');
  failures.slice(0, 30).forEach(f => console.error('FAIL: ' + f));
  console.log(`S5 summaries: ${passed} passed, ${failed} failed; ${views.length} module views`);
  process.exitCode = failed ? 1 : 0;
}

// Bounded bridge: compare the pure utilities to the unchanged module's serialized
// renderer and independent R membership. No tier/full-matrix or browser claim.
function runModuleFacilities() {
  const out = path.join(OUT, 'module-facilities');
  const refPath = path.join(out, 'reference.json');
  const ref = JSON.parse(fs.readFileSync(refPath, 'utf8'));
  const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  let passed = 0, failed = 0; const failures = [];
  const check = (ok, name) => { if (ok) passed++; else { failed++; failures.push(name); } };
  for (const f of ['csv', 'master', 'scaling', 'focus', 'facilities']) require(path.join(ROOT, f === 'facilities' ? 'site/shared/facilities.js' : 'site/cvi/app/' + f + '.js'));
  const geoBox = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'site/geo/wa-counties.js'), 'utf8'), geoBox);
  const geo = geoBox.window.CVIWA_GEO.counties;
  check(ref.meta.synthetic && ref.meta.facilities_injected && !ref.meta.full_matrix_run && !ref.meta.page_run, 'bounded synthetic module metadata');
  check(hash(path.join(out, 'master.csv')) === ref.meta.fixture_sha256, 'master hash');
  check(hash(path.join(out, 'facilities.json')) === ref.meta.facility_input_sha256, 'facility hash');
  check(hash(path.join(OUT, 'membership/inputs.json')) === ref.meta.geometry_input_sha256, 'geometry input hash');
  const geometryInput = JSON.parse(fs.readFileSync(path.join(OUT, 'membership/inputs.json'), 'utf8'));
  check(hash(path.join(ROOT, 'site/geo/wa-counties.js')) === geometryInput.geometrySha256, 'bundled geometry hash');
  check(hash(path.join(ROOT, 'tests/oracle/cvi_r_oracle.R')) === ref.meta.oracle_sha256, 'oracle source hash');
  for (const [file, digest] of Object.entries(ref.meta.source_sha256))
    check(hash(path.join(ROOT, '../CVI_Traceability/shiny', file)) === digest, 'unchanged CVI source ' + file);
  check(ref.meta.paths_requested.every(p => p.startsWith(path.join(out, 'empty_cvi_root') + path.sep)), 'all module data paths in empty synthetic root');
  const master = globalThis.CVIWA.master.load(fs.readFileSync(path.join(out, 'master.csv'), 'utf8'));
  check(master.ok && master.physicalRows === 5 && master.mapRows === 6, 'hand physical/map row counts');
  const views = Object.entries(ref.reference.facility_views);
  check(views.length === 6, 'six direction/mode module views');
  for (const [name, v] of views) {
    const [direction, mode] = name.split('/');
    const got = globalThis.CVIWA.focus.build(master, { counties: ['King'], species: ['Cattle'], years: [2025,2026],
      quarters: ['Q1','Q2','Q3','Q4'], direction, mode, scaling: 'log', nBins: 5, rawSpecies: [] });
    const sort = rows => [...rows].sort((a,b) => a.direction.localeCompare(b.direction) || b.total_animals - a.total_animals);
    const actual = sort(got.premises), expected = sort(v.premises);
    check(actual.length === expected.length, name + ' premise count');
    check(got.omittedRows === (direction === 'outbound' ? 0 : 1), name + ' undrawn row');
    actual.forEach((row, i) => {
      const r = expected[i]; if (!r) return;
      for (const f of ['direction','total_animals','n_shipments','n_cvis','city','state','county','premises_id','color','popup_html','species_json','tooltip_text'])
        check(row[f] === r[f], name + '/' + i + '/' + f);
      for (const f of ['lon','lat','radius_px']) check(Math.abs(row[f] - r[f]) < 1e-9, name + '/' + i + '/' + f);
    });
  }
  const cases = [...views.map(([name,v]) => [name, v.facilities]), ...Object.entries(ref.reference.facility_cases)];
  for (const [name,c] of cases) {
    const membership = globalThis.CVIWA.facilities.countyMembership(geo, c.picks);
    for (const layer of ref.reference.facility_inputs.layers) {
      const expected = c.expected[layer.key];
      const actual = c.selected.includes(layer.key) ? layer.points.filter(p => membership.contains(p.lon, p.lat)).map(p => p.ref_name) : [];
      check(JSON.stringify(actual) === JSON.stringify(expected), name + '/' + layer.key + ' R/module/JS membership');
    }
  }
  const falsePositive = ref.reference.facility_inputs.layers[0].points.find(p => p.ref_name.includes('Whidbey'));
  const sno = geo.features.find(f => f.properties.name === 'Snohomish');
  const vertices = sno.geometry.coordinates.flat(sno.geometry.type === 'MultiPolygon' ? 2 : 1);
  const xs = vertices.map(v => v[0]), ys = vertices.map(v => v[1]);
  check(falsePositive.lon >= Math.min(...xs) && falsePositive.lon <= Math.max(...xs) && falsePositive.lat >= Math.min(...ys) && falsePositive.lat <= Math.max(...ys), 'bbox-only sensitivity accepts Whidbey');
  check(!globalThis.CVIWA.facilities.countyMembership(geo, ['Snohomish']).contains(falsePositive.lon, falsePositive.lat), 'polygon rejects bbox false positive');
  const result = { passed, failed, failures, views: views.length, facilityCases: cases.length,
    fullMatrixRun: false, sourceSha256: Object.fromEntries(['focus','facilities','master','csv','scaling'].map(f => [f, hash(path.join(ROOT, f === 'facilities' ? 'site/shared/facilities.js' : 'site/cvi/app/' + f + '.js'))])),
    referenceSha256: hash(refPath), oracleSha256: ref.meta.oracle_sha256 };
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 2) + '\n');
  for (const f of failures) console.error('FAIL: ' + f);
  console.log(`S5 module facilities: ${passed} passed, ${failed} failed; ${views.length} module views, ${cases.length} facility cases`);
  process.exitCode = failed ? 1 : 0;
}


// Actual tier contents, unchanged module evidence, and pure browser capabilities chosen by design.
function runModuleTiers() {
  const out = path.join(OUT, 'module-tiers'), refPath = path.join(out, 'reference.json');
  const ref = JSON.parse(fs.readFileSync(refPath, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'cases.json'), 'utf8'));
  const originals = require('../synthetic/make_bundles.js').tierContents();
  const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  let passed = 0, failed = 0; const failures = [];
  const check = (ok, name) => { if (ok) passed++; else { failed++; failures.push(name); } };
  for (const f of ['csv','master','scaling','focus','facilities']) require(path.join(ROOT, f === 'facilities' ? 'site/shared/facilities.js' : 'site/cvi/app/' + f + '.js'));
  const C = globalThis.CVIWA, geoBox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'site/geo/wa-counties.js'), 'utf8'), geoBox);
  const geo = geoBox.window.CVIWA_GEO.counties;
  check(ref.meta.synthetic && !ref.meta.full_matrix_run && !ref.meta.page_run, 'bounded synthetic tier/module metadata');
  check(hash(path.join(ROOT, 'tests/oracle/cvi_r_oracle.R')) === ref.meta.oracle_sha256, 'current oracle hash');
  check(hash(path.join(out, 'cases.json')) === ref.meta.manifest_sha256, 'tier manifest hash');
  check(hash(path.join(OUT, 'membership/inputs.json')) === ref.meta.geometry_input_sha256, 'geometry input hash');
  const geometryInput = JSON.parse(fs.readFileSync(path.join(OUT, 'membership/inputs.json'), 'utf8'));
  check(hash(path.join(ROOT, 'site/geo/wa-counties.js')) === geometryInput.geometrySha256, 'current bundled geometry hash');
  for (const [file, digest] of Object.entries(ref.meta.source_sha256))
    check(hash(path.join(ROOT, '../CVI_Traceability/shiny', file)) === digest, 'unchanged CVI source ' + file);
  check(ref.meta.paths_requested.every(p => p.startsWith(path.join(out, 'empty_cvi_root') + path.sep)), 'module paths confined to empty synthetic root');
  const differences = [], capabilities = [];
  let totalViews = 0;
  for (const tc of manifest.cases) {
    const tier = tc.tier, r = ref.tiers[tier];
    check(JSON.stringify(Object.keys(tc.files).sort()) === JSON.stringify(Object.keys(originals[tier].files).sort()), tier + ' exact established tier file set');
    for (const [file, digest] of Object.entries(tc.files)) {
      check(hash(path.join(out, tier, file)) === digest, tier + '/' + file + ' current input hash');
      check(crypto.createHash('sha256').update(originals[tier].files[file]).digest('hex') === digest, tier + '/' + file + ' byte-identical actual tier');
    }
    const masterFile = tier === 'partner' ? 'partner_county_totals.csv' : 'CVI_Consolidated_Master.csv';
    const master = C.master.load(fs.readFileSync(path.join(out, tier, masterFile), 'utf8'));
    check(master.ok && master.physicalRows === 1500 && master.physicalRows === r.physical_rows && master.mapRows === r.map_rows, tier + ' independent physical/map row counts');
    check(master.header.length === ({full:23, partner:13, public:14})[tier], tier + ' actual column count');
    check(master.hasSpecies === (tier !== 'partner') && master.header.includes('CVI') === (tier === 'full'), tier + ' raw species/certificate capability');
    check(Object.keys(r.facility_files).length === ({full:7, partner:2, public:0})[tier], tier + ' supplied facility count');
    const views = Object.entries(r.views); totalViews += views.length;
    check(views.length === 6, tier + ' six direction/mode module views');
    for (const [name, v] of views) {
      const opts = {...v.filters, direction:v.direction, mode:v.mode, scaling:'log', nBins:5, rawSpecies:[]};
      const got = C.focus.build(master, opts), tag = tier + '/' + name;
      check(JSON.stringify(got.missingCoordinates) === JSON.stringify(r.missing_coordinates), tag + ' exact missing-coordinate list');
      check(v.premises.status === 'ok', tag + ' module capability handled');
      if (tier !== 'full') {
        check(got.premises.length === 0 && v.premises.value === null, tag + ' premises gated independently');
        check(v.direct.status === 'error' && v.direct.classes.includes('cvi_missing_premise_coords'), tag + ' retained unchanged builder error');
        check(r.missing_coordinates.every(c => v.direct.error.includes(c)), tag + ' source error names required coordinates');
      } else {
        const order = rows => [...rows].sort((a,b) => a.direction.localeCompare(b.direction) || a.premises_id.localeCompare(b.premises_id) || a.total_animals-b.total_animals || a.lon-b.lon);
        const actual = order(got.premises), expected = order(v.premises.value);
        check(actual.length === expected.length && expected.length === v.direct.rows, tag + ' all module/builder premise groups');
        actual.forEach((row,i) => {
          const e = expected[i]; if (!e) return;
          for (const f of ['direction','total_animals','n_shipments','n_cvis','city','state','county','premises_id','color','popup_html','species_json','tooltip_text'])
            check(row[f] === e[f], tag + '/' + i + '/' + f);
          for (const f of ['lon','lat','radius_px']) check(Math.abs(row[f]-e[f]) < 1e-9, tag + '/' + i + '/' + f);
        });
        check(v.summary.status === 'ok' && v.boxes.status === 'ok' && v.strip.status === 'ok', tag + ' full module summaries reachable');
        check(got.premises.reduce((s,p) => s+p.total_animals,0) === v.premises.value.reduce((s,p) => s+p.total_animals,0), tag + ' drawn activity');
        check(v.summary.value.n_premises === actual.length, tag + ' summary premises');
      }
      const selected = master.rows.filter(row => {
        const end = row.Movement === 'Inbound' ? 'Dest' : 'Origin';
        return ['Inbound','Outbound'].includes(row.Movement) && (opts.direction === 'combined' || row.Movement === (opts.direction === 'inbound' ? 'Inbound' : 'Outbound'))
          && opts.species.includes(row['Species.Group']) && opts.years.includes(row['Reporting.Year'])
          && opts.quarters.includes(row['Reporting.Quarter']) && opts.counties.includes(row[end+'.County']) && row[end+'.State'] === 'WA';
      });
      const unique = new Map(selected.map(row => [row[C.master.SOURCE_ROW], row]));
      const animals = [...unique.values()].reduce((s,row) => s+(row['Total.Animals'] || 0),0);
      const cvis = new Set(selected.map(row => row.CVI).filter(c => c !== undefined && c !== null && c.trim() !== ''));
      check(v.summary.status === 'ok' && v.summary.value.total_animals === animals, tag + ' independent source-row box animals');
      check(v.summary.value.n_cvis === cvis.size, tag + ' independent nonblank certificates');
      check(v.boxes.status === 'ok' && v.boxes.value.metrics[0].value === animals.toLocaleString('en-US'), tag + ' rendered animal box');
      if (tier !== 'full') {
        check(v.summary.value.n_premises === 0 && v.summary.value.n_cvis === 0, tag + ' CVI unavailable metrics recorded as zero');
        check(v.strip.status === 'ok' && v.strip.value.state === 'message' && v.strip.value.lines.includes('No records match the selected counties + filters.'), tag + ' CVI misleading reduced strip retained');
        differences.push({tier,view:name,source:'CVI zero premises/CVIs and no-records strip without coordinates',approvedBrowser:'explain missing coordinates; certificate box needs CVI column; retain available summary/facility context'});
      } else {
        check(v.strip.value.items[2].text === got.premises.reduce((s,p) => s+p.total_animals,0).toLocaleString('en-US'), tag + ' independently rendered drawn activity');
      }
      const membership = C.facilities.countyMembership(geo, opts.counties);
      for (const [key, file] of Object.entries(r.facility_files)) {
        const parsed = C.csv.parse(fs.readFileSync(path.join(out, tier, file), 'utf8'));
        const lonIndex = parsed.header.findIndex(h => h.toLowerCase() === 'long');
        const latIndex = parsed.header.findIndex(h => h.toLowerCase() === 'lat');
        const nameColumn = {slaughterhouses:'USDA Slaughter Facility',fairgrounds:'Fair Name',markets:'name',feedlots:'name',restricted:'NAME',syn_custommeat:'Name',syn_disposal:'FACILITY.NAME'}[key];
        const nameIndex = parsed.header.indexOf(nameColumn);
        const points = parsed.rows.map(row => ({lon:Number(row[lonIndex]),lat:Number(row[latIndex]),ref_name:row[nameIndex]}));
        const injected = v.facilities.injected[key];
        check(points.length === injected.length && points.every((p,i) => p.lon === injected[i].lon && p.lat === injected[i].lat && p.ref_name === injected[i].ref_name), tag + '/' + key + ' independent tier CSV injection');
        const inside = points.filter(p => membership.contains(p.lon,p.lat)).map(p => p.ref_name);
        const extra = key.startsWith('syn_');
        check(JSON.stringify(extra ? [] : inside) === JSON.stringify(v.facilities.expected[key]), tag + '/' + key + ' R/module/JS spatial membership');
        if (extra) differences.push({tier,view:name,layer:key,source:'CVI Focus ignores supplied manifest extra',approvedBrowser:'draw usable supplied extra',insideCount:inside.length});
      }
      capabilities.push({tier,view:name,summary:v.summary,boxes:v.boxes,strip:v.strip,premisesEnabled:got.missingCoordinates.length===0,missingCoordinates:got.missingCoordinates});
    }
    check(JSON.stringify(C.focus.countyChoices(master)) === JSON.stringify(geo.features.map(f => f.properties.name).sort()), tier + ' whole-master county context preserved');
    check(r.domains.quarter.length === 8 && r.domains.year.length === 2, tier + ' whole-master period domains');
  }
  check(totalViews === 18, 'all actual tier module views');
  const result = {passed,failed,failures,views:totalViews,fullMatrixRun:false,capabilities,differences,
    sourceSha256:Object.fromEntries(['focus','facilities','master','csv','scaling'].map(f => [f,hash(path.join(ROOT,f === 'facilities' ? 'site/shared/facilities.js' : 'site/cvi/app/' + f + '.js'))])),
    referenceSha256:hash(refPath),oracleSha256:ref.meta.oracle_sha256};
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2)+'\n');
  failures.slice(0,30).forEach(f => console.error('FAIL: '+f));
  console.log(`S5 module tiers: ${passed} passed, ${failed} failed; ${totalViews} actual tier/module views`);
  process.exitCode = failed ? 1 : 0;
}


// Facility layers: facilities.js registry/groups/parseLayer against CVI's unchanged .build_overlay_registry,
// .overlay_groups and load_overlay_csv on the --facilities folders (Rscript tests/oracle/cvi_r_oracle.R s5-facilities).
// Deliberate differences, checked beside CVI's values: the reserved key "master" is not a layer; points outside
// -90..90 / -180..180 are left out and counted. Node-only probes for what R cannot be given (Inf, 0b/0o, blank lines).
function runFacilities() {
  const out = path.join(OUT, 'facilities'), refPath = path.join(out, 'reference.json');
  const ref = JSON.parse(fs.readFileSync(refPath, 'utf8'));
  const meta = JSON.parse(fs.readFileSync(path.join(out, 'cases.json'), 'utf8'));
  const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  let passed = 0, failed = 0; const failures = [];
  const check = (ok, name, detail) => { if (ok) passed++; else { failed++; failures.push(name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail))); } };
  require(path.join(ROOT, 'site/cvi/app/csv.js')); require(path.join(ROOT, 'site/shared/facilities.js'));
  const C = globalThis.CVIWA, F = C.facilities;
  check(ref.meta.synthetic === true, 'synthetic reference');
  check(hash(path.join(out, 'cases.json')) === ref.meta.cases_sha256, 'current fixture');
  check(hash(path.join(ROOT, 'tests/oracle/cvi_r_oracle.R')) === ref.meta.oracle_sha256, 'oracle source hash');
  for (const [file, digest] of Object.entries(ref.meta.source_sha256))
    check(hash(path.join(ROOT, '../CVI_Traceability/shiny', file)) === digest, 'unchanged CVI source ' + file);
  // Saved R paths describe the original generation root, including in an isolated mutation copy.
  const referenceOut = path.join(process.env.S5_REFERENCE_ROOT || ROOT, 'local-test-artifacts/s5/facilities');
  check(ref.meta.paths_requested.every(p => p.startsWith(referenceOut + path.sep)), 'R read only the fixture folders');
  const arr = v => (v === null || v === undefined ? [] : Array.isArray(v) ? v : [v]);
  let layersCompared = 0, pointsCompared = 0;
  for (const [name, c] of Object.entries(meta.cases)) {
    const dir = path.join(out, name), r = ref.reference[name];
    for (const f of c.files) check(hash(path.join(dir, f.file)) === f.sha256, name + '/' + f.file + ' current');
    const mPath = path.join(dir, 'facility_overlays_manifest.csv');
    const reg = F.registry(fs.existsSync(mPath) ? C.csv.parse(fs.readFileSync(mPath, 'utf8')) : null);
    const rLayers = r.layers.filter(l => l.key !== 'master');
    check(r.layers.length - rLayers.length === (name === 'manifest' ? 1 : 0) && reg.skipped.some(x => x.key === 'master') === (name === 'manifest'),
      name + ': the reserved key "master" is listed by CVI and skipped by the page (deliberate difference)', reg.skipped);
    check(JSON.stringify(reg.layers.map(l => l.key)) === JSON.stringify(rLayers.map(l => l.key)), name + ': layer keys in CVI\'s order', [reg.layers.map(l => l.key), rLayers.map(l => l.key)]);
    check(!!reg.malformed === (name === 'malformed'), name + ': malformed manifest flagged', reg.malformed);
    const rGroups = r.groups.map(g => ({ group: g.group, keys: arr(g.keys).filter(k => k !== 'master') })).filter(g => g.keys.length);
    check(JSON.stringify(F.groups(reg.layers)) === JSON.stringify(rGroups), name + ': groups in CVI\'s order (.overlay_groups)', [F.groups(reg.layers), rGroups]);
    rLayers.forEach(rl => {
      const l = reg.layers.find(x => x.key === rl.key);
      if (!l) return;
      layersCompared++;
      // CVI's color is kept as cviColor; `color` is the layer's own mark color on these pages (Feedlots #0094aa,
      // added layers from six guide color families), a deliberate difference checked in the UI unit suite.
      for (const [a, b] of [['file', 'file'], ['nameColumn', 'name_col'], ['cviColor', 'color'], ['label', 'label'], ['liveLabel', 'live_label'], ['group', 'group']])
        check(l[a] === rl[b], name + '/' + rl.key + ' ' + a, [l[a], rl[b]]);
      const fp = path.join(dir, l.file);
      if (!fs.existsSync(fp)) { check(rl.points === null, name + '/' + rl.key + ': file not supplied, CVI has no layer'); return; }
      const got = F.parseLayer(C.csv.parse(fs.readFileSync(fp, 'utf8')), l.nameColumn);
      if (rl.points === null) { check(!got.ok, name + '/' + rl.key + ': CVI gives no layer, nor does the page', got); return; }
      const names = arr(rl.points.name), lats = arr(rl.points.lat), lons = arr(rl.points.lon);
      const want = names.map((n, i) => ({ name: n === null ? '' : n, lon: lons[i], lat: lats[i] }));
      const inRange = want.filter(p => Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180);
      pointsCompared += want.length;
      check(got.ok && JSON.stringify(got.points) === JSON.stringify(inRange), name + '/' + rl.key + ': points (names, coordinates) as CVI\'s loader', [got.points, inRange]);
      check(got.outOfRange === want.length - inRange.length, name + '/' + rl.key + ': points out of range left out and counted (deliberate difference)', [got.outOfRange, want.length - inRange.length]);
    });
  }
  // Node-only probes (values R's fixture cannot hold without failing CVI's own loader).
  const probe = text => F.parseLayer(C.csv.parse(text), 'name');
  let pr = probe('name,lat,long\nInf,Inf,-122\nBin,47,0b101\nOct,0o7,-122\n\nGood,47.1,-122.1\n');
  check(pr.ok && pr.points.length === 1 && pr.points[0].name === 'Good' && pr.outOfRange === 1 && pr.dropped === 2,
    'probe: Inf counted out of range, 0b/0o not numbers (as R), a blank line not a row', pr);
  pr = probe('name,lat,long\nA, ,-122\n');
  check(!pr.ok && pr.reason === 'no rows with numeric coordinates', 'probe: a blank-looking coordinate is not 0 (as R)', pr);
  pr = probe('name,lat,long\nNorth,91,-122\nWest,47,-181\n');
  check(!pr.ok && pr.reason === 'no rows with valid coordinates' && pr.outOfRange === 2 && pr.dropped === 0,
    'probe: entirely out-of-range layer is unusable and preserves rejected-row count', pr);
  pr = probe('name,lat,long\nInfinite,Inf,-122\nNegative,-Inf,-122\n');
  check(!pr.ok && pr.reason === 'no rows with valid coordinates' && pr.outOfRange === 2,
    'probe: entirely nonfinite layer is unusable', pr);
  pr = probe('name,lat,long\nInvalid,91,-122\nOutside picked county,46,-117\n');
  check(pr.ok && pr.points.length === 1 && pr.points[0].name === 'Outside picked county' && pr.outOfRange === 1,
    'probe: valid coordinates remain usable even outside selected counties', pr);
  // R 4.4.3 on a Mac (arm64): make.names(c("a","a","a.1","","if","2x",".5","é b","_x","a b","TRUE"), unique = TRUE).
  check(F.makeNames(['a', 'a', 'a.1', '', 'if', '2x', '.5', 'é b', '_x', 'a b', 'TRUE']).join('|') === 'a|a.2|a.1|X|if.|X2x|X.5|é.b|X_x|a.b|TRUE.', 'probe: make.names as R\'s (recorded output)');
  const result = { passed, failed, failures, cases: Object.keys(meta.cases).length, layersCompared, pointsCompared,
    sourceSha256: hash(path.join(ROOT, 'site/shared/facilities.js')), referenceSha256: hash(refPath), oracleSha256: ref.meta.oracle_sha256 };
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 2) + '\n');
  failures.slice(0, 40).forEach(f => console.error('FAIL: ' + f));
  console.log(`S5 facilities: ${passed} passed, ${failed} failed; ${result.cases} reference folders, ${layersCompared} layers, ${pointsCompared} CVI points`);
  process.exitCode = failed ? 1 : 0;
}
