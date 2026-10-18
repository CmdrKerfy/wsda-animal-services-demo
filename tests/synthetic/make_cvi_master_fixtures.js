#!/usr/bin/env node
'use strict';
// Deterministic generator for two synthetic CVI master-shaped tables (all values FABRICATED):
//   tests/synthetic/cvi_master_wa39.csv  all 39 WA counties, 2 years, 4 quarters. Counts, CVI numbers and coordinates
//     are invented; county anchors are the Census-derived label points in site/geo/wa-counties.js, rounded to 4
//     decimals. The generator itself is site/cvi/sample.js (masterWa39; kept there so the landing page can
//     build the same table for the downloadable sample bundle).
//   tests/synthetic/cvi_master_s4.csv    S4 National Flow: hand-made rows below, one edge each (tests/synthetic/README.md).
// Usage (repository root): node tests/synthetic/make_cvi_master_fixtures.js   (no packages needed)
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '..', '..');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'site', 'geo', 'wa-counties.js'), 'utf8'), sandbox);
require(path.join(ROOT, 'site', 'cvi', 'sample.js'));
const text = globalThis.WSDA.samples.cvi.masterWa39(sandbox.window.CVIWA_GEO.labels);
const out = path.join(__dirname, 'cvi_master_wa39.csv');
fs.writeFileSync(out, text);
console.log('wrote', path.relative(ROOT, out), text.split('\n').length - 2, 'rows');

// ── S4 fixture ──────────────────────────────────────────────────────────────────────────────────────────────────────
// WA counties (made-up rounded positions) and out-of-state rows ("N/A" county at a made-up point).
const WA = { Yakima: [46.46, -120.74], King: [47.49, -121.81], Spokane: [47.62, -117.40], Grant: [47.20, -119.45], Benton: [46.24, -119.51] };
const wa = c => ['WA', c, WA[c][0], WA[c][1]];
const st = s => [s, 'N/A', 40.00, -100.00];
const MISSING = null, QUOTED_BLANK = '""';
// [cvi, group, species, year, quarter, movement, animals, origin [state, county, lat, lon], dest [...]]
const S4 = [
  // Inbound, one partner each: 100,000 exactly (R prints 1e+05 alone), AK and HI (lines, no outline or label).
  ['F001', 'Cattle', 'Beef cattle', 2024, 'Q1', 'Import', 1200, st('ID'), wa('Yakima')],
  ['F002', 'Cattle', 'Dairy cattle', 2024, 'Q2', 'Import', 800, st('OR'), wa('King')],
  ['F003', 'Swine', 'Swine', 2024, 'Q3', 'Import', 100000, st('CA'), wa('Grant')],
  ['F004', 'Poultry', 'Chickens', 2024, 'Q4', 'Import', 5000, st('MT'), wa('Spokane')],
  ['F005', 'Equids', 'Horse', 2025, 'Q1', 'Import', 12, st('AK'), wa('King')],
  ['F006', 'Small Ruminants', 'Sheep', 2025, 'Q1', 'Import', 45, st('HI'), wa('King')],
  // Partners without a center (dropped from the lines, counted in Total animals as CVI): XX, BC, a quoted blank state
  // and a missing one (never matches).
  ['F007', 'Cattle', 'Beef cattle', 2025, 'Q3', 'Import', 300, st('XX'), wa('Benton')],
  ['F008', 'Cattle', 'Beef cattle', 2025, 'Q3', 'Import', 250, st('BC'), wa('Benton')],
  ['F009', 'Cattle', 'Beef cattle', 2025, 'Q4', 'Import', 75, [QUOTED_BLANK, 'N/A', 40.00, -100.00], wa('Benton')],
  ['F010', 'Cattle', 'Beef cattle', 2025, 'Q4', 'Import', 60, [MISSING, 'N/A', 40.00, -100.00], wa('Benton')],
  // A state whose inbound total is 0 (NV), missing and non-numeric animals left out of a sum (UT).
  ['F011', 'Swine', 'Swine', 2026, 'Q1', 'Import', 0, st('NV'), wa('Grant')],
  ['F012', 'Poultry', 'Turkeys', 2026, 'Q1', 'Import', MISSING, st('UT'), wa('Grant')],
  ['F013', 'Poultry', 'Turkeys', 2026, 'Q1', 'Import', 'many', st('UT'), wa('Grant')],
  ['F014', 'Cattle', 'Beef cattle', 2026, 'Q1', 'Import', 40, st('UT'), wa('Grant')],
  // Equal totals in one group (ties in width and drawing order).
  ['F015', 'Cattle', 'Beef cattle', 2026, 'Q3', 'Import', 500, st('CO'), wa('Yakima')],
  ['F016', 'Cattle', 'Beef cattle', 2026, 'Q3', 'Import', 500, st('AZ'), wa('Yakima')],
  // A group no palette names (#999999), with a fractional count (R's format() shows one decimal).
  ['F017', 'Camelids', 'Alpaca', 2026, 'Q3', 'Import', 7, st('NM'), wa('Spokane')],
  ['F018', 'Camelids', 'Llama', 2026, 'Q3', 'Import', 2.5, st('NM'), wa('Spokane')],
  // Lowercase "wa" (exact text: not Washington): ID to "wa" and "wa" to TX are drawn nowhere; "wa" to WA is an
  // inbound row whose partner "wa" has no center.
  ['F019', 'Cattle', 'Beef cattle', 2024, 'Q2', 'Import', 90, st('ID'), ['wa', 'King', 47.49, -121.81]],
  ['F020', 'Cattle', 'Beef cattle', 2024, 'Q2', 'Export', 33, ['wa', 'Yakima', 46.46, -120.74], st('TX')],
  ['F021', 'Cattle', 'Beef cattle', 2024, 'Q2', 'Import', 21, ['wa', 'Yakima', 46.46, -120.74], wa('King')],
  // Outbound.
  ['F022', 'Cattle', 'Dairy cattle', 2024, 'Q1', 'Export', 400, wa('Yakima'), st('OR')],
  ['F023', 'Swine', 'Swine', 2024, 'Q3', 'Export', 150, wa('Grant'), st('ID')],
  ['F024', 'Poultry', 'Chickens', 2025, 'Q1', 'Export', 2000, wa('Spokane'), st('CA')],
  ['F025', 'Small Ruminants', 'Goat', 2025, 'Q3', 'Export', 30, wa('Benton'), st('MT')],
  // Marked Intrastate but going to Oregon: both loader copies are drawn and counted (Outbound, 2 x 70).
  ['F026', 'Cattle', 'Beef cattle', 2024, 'Q4', 'Intrastate', 70, wa('Yakima'), st('OR')],
  // No Movement: drawn on the Flow map (states only), not on the WA map.
  ['F027', 'Equids', 'Horse', 2025, 'Q4', MISSING, 25, wa('King'), st('NV')],
  // Marked Import but from WA to Idaho: Outbound on the Flow map.
  ['F028', 'Cattle', 'Beef cattle', 2026, 'Q1', 'Import', 55, wa('Yakima'), st('ID')],
  ['F029', 'Exotic Hoofstock', 'Bison', 2026, 'Q3', 'Export', 18, wa('Spokane'), st('TX')],
  ['F030', 'Other', 'Rabbit', 2026, 'Q4', 'Export', 6, wa('King'), st('FL')],
  ['F031', 'Cattle', 'Beef cattle', 2024, 'Q2', 'Export', 220, wa('Yakima'), st('NY')],
  // Eight raw Cattle species from CA (one group picked: top 6 plus "Other: N").
  ['F032', 'Cattle', 'Beef cattle', 2025, 'Q1', 'Import', 640, st('CA'), wa('Yakima')],
  ['F033', 'Cattle', 'Dairy cattle', 2025, 'Q1', 'Import', 520, st('CA'), wa('Yakima')],
  ['F034', 'Cattle', 'Calves', 2025, 'Q1', 'Import', 410, st('CA'), wa('Yakima')],
  ['F035', 'Cattle', 'Steers', 2025, 'Q1', 'Import', 300, st('CA'), wa('Yakima')],
  ['F036', 'Cattle', 'Heifers', 2025, 'Q1', 'Import', 300, st('CA'), wa('Yakima')],
  ['F037', 'Cattle', 'Bulls', 2025, 'Q1', 'Import', 85, st('CA'), wa('Yakima')],
  ['F038', 'Cattle', 'Cows', 2025, 'Q1', 'Import', 64, st('CA'), wa('Yakima')],
  ['F039', 'Cattle', 'Feeder cattle', 2025, 'Q1', 'Import', 9, st('CA'), wa('Yakima')],
  // Eight species groups from ID (all groups: top 6 plus "Other: N"; "Other" is also a group name).
  ['F040', 'Swine', 'Swine', 2025, 'Q3', 'Import', 700, st('ID'), wa('Spokane')],
  ['F041', 'Poultry', 'Chickens', 2025, 'Q3', 'Import', 3000, st('ID'), wa('Spokane')],
  ['F042', 'Equids', 'Horse', 2025, 'Q3', 'Import', 14, st('ID'), wa('Spokane')],
  ['F043', 'Small Ruminants', 'Sheep', 2025, 'Q3', 'Import', 260, st('ID'), wa('Spokane')],
  ['F044', 'Exotic Hoofstock', 'Bison', 2025, 'Q3', 'Import', 22, st('ID'), wa('Spokane')],
  ['F045', 'Other', 'Rabbit', 2025, 'Q3', 'Import', 3, st('ID'), wa('Spokane')],
  ['F046', 'Camelids', 'Alpaca', 2025, 'Q3', 'Import', 5, st('ID'), wa('Spokane')],
  // 2025 Q2 has only WA-to-WA rows: the Flow slider skips it (the WA map's does not).
  ['F047', 'Cattle', 'Beef cattle', 2025, 'Q2', 'Export', 100, wa('Yakima'), wa('King')],
  ['F048', 'Swine', 'Swine', 2025, 'Q2', 'Intrastate', 50, wa('Grant'), wa('Benton')],
  // No year: in no period and no year filter.
  ['F049', 'Cattle', 'Beef cattle', MISSING, 'Q1', 'Import', 10, st('OR'), wa('King')],
  // A group named like a JavaScript object property: in no palette (#999999), as CVI's lookup.
  ['F050', 'constructor', 'Odd name', 2026, 'Q4', 'Import', 4, st('WY'), wa('Benton')]
];
const cell = v => (v === null ? '' : String(v));
const s4Lines = ['CVI,Species.Group,Species,Reporting.Year,Reporting.Quarter,Movement,Total.Animals,Origin.State,Origin.County,'
  + 'Origin.County.Lat,Origin.County.Long,Dest.State,Dest.County,Dest.County.Lat,Dest.County.Long']
  .concat(S4.map(r => [r[0], r[1], r[2], r[3], r[4], r[5], r[6]].concat(r[7], r[8]).map(cell).join(',')));
const s4Text = s4Lines.join('\n') + '\n';
const s4Out = path.join(__dirname, 'cvi_master_s4.csv');
fs.writeFileSync(s4Out, s4Text);
console.log('wrote', path.relative(ROOT, s4Out), S4.length, 'rows');
