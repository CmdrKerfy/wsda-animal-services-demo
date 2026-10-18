#!/usr/bin/env node
'use strict';
// MC movement fixture: a synthetic CVI master with realistic within-state structure, for the
// within-state movement rules (site/cvi/app/movement.js) and the three within-state map styles. The Full tier's 225
// within-state rows are spread evenly over 180 county pairs, which makes every option look like noise; real movement
// is likely concentrated, so this table has:
//   - a few heavy corridors between neighboring counties (dairy in the northwest, beef in the Yakima valley and the
//     Columbia basin, poultry from Lewis to Thurston), one with a smaller reverse corridor (Benton to Yakima);
//   - within-county movement in a few counties (Yakima, Whatcom, Grant, Lewis, Stevens);
//   - a long tail of light pairs between any two counties;
//   - several species groups and raw species, eight quarters (2024 and 2025), and some interstate rows so the WA map
//     also has its usual circles;
//   - edge rows at the end, one rule each (listed in EDGES below; the last one is the table's only 2026 row).
// The same 15 columns as tests/synthetic/cvi_master_wa39.csv. Every value is made up; the county points are the
// Census-derived label points of site/geo/wa-counties.js rounded to 4 decimals (no point moves between years).
// Deterministic: a fixed seed, no clock.
//
// Usage (repository root): node tests/synthetic/make_cvi_movement_fixtures.js
// Output (committed): tests/synthetic/cvi_master_movement.csv

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(__dirname, 'cvi_master_movement.csv');

// The county points, read from the site's county file (read only).
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'site', 'geo', 'wa-counties.js'), 'utf8'), sandbox);
const POINT = {};
sandbox.window.CVIWA_GEO.labels.forEach(l => {
  POINT[l.name] = [+l.lat.toFixed(4), +l.lon.toFixed(4)];
});
const COUNTIES = Object.keys(POINT).sort();

// Partner states for the interstate rows (made-up points inside each state).
const STATES = { OR: [43.9336, -120.5583], ID: [44.3509, -114.613], CA: [37.1661, -119.4494], MT: [47.0527, -109.6333] };

const HEADER = ['CVI', 'Species.Group', 'Species', 'Reporting.Year', 'Reporting.Quarter', 'Movement',
  'Total.Animals', 'Origin.State', 'Origin.County', 'Origin.County.Lat', 'Origin.County.Long',
  'Dest.State', 'Dest.County', 'Dest.County.Lat', 'Dest.County.Long'];

const GROUP_OF = {
  'Dairy cattle': 'Cattle', 'Beef cattle': 'Cattle', Chickens: 'Poultry', Turkeys: 'Poultry',
  'Feeder pigs': 'Swine', Sheep: 'Small Ruminants', Goats: 'Small Ruminants', Horses: 'Equids'
};
const PERIODS = [];
for (const year of [2024, 2025]) {
  for (const q of ['Q1', 'Q2', 'Q3', 'Q4']) PERIODS.push([year, q]);
}

// Heavy corridors: [origin, destination, raw species, typical animals per row, rows per quarter].
const CORRIDORS = [
  ['Whatcom', 'Skagit', 'Dairy cattle', 180, 3],
  ['Skagit', 'Snohomish', 'Dairy cattle', 120, 2],
  ['Yakima', 'Benton', 'Beef cattle', 220, 3],
  ['Benton', 'Yakima', 'Beef cattle', 60, 1],
  ['Benton', 'Franklin', 'Beef cattle', 140, 2],
  ['Kittitas', 'Yakima', 'Beef cattle', 90, 2],
  ['Grant', 'Adams', 'Beef cattle', 160, 2],
  ['Spokane', 'Lincoln', 'Beef cattle', 70, 1],
  ['Lewis', 'Thurston', 'Chickens', 900, 1],
  ['Snohomish', 'King', 'Horses', 12, 2],
  ['Walla Walla', 'Columbia', 'Sheep', 45, 1]
];
// Within-county movement: [county, raw species, typical animals per row, rows per quarter].
const WITHIN = [
  ['Yakima', 'Beef cattle', 150, 2],
  ['Whatcom', 'Dairy cattle', 110, 2],
  ['Grant', 'Beef cattle', 80, 1],
  ['Lewis', 'Chickens', 600, 1],
  ['Stevens', 'Goats', 15, 1]
];

let seed = 20261011;   // mulberry32, as site/cvi/sample.js
function rnd() {
  seed |= 0;
  seed = seed + 0x6D2B79F5 | 0;
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}
const pick = list => list[Math.floor(rnd() * list.length)];
// About the typical number, between 60% and 140% of it, at least 1.
const about = typical => String(Math.max(1, Math.round(typical * (0.6 + rnd() * 0.8))));

let cviNumber = 10000;
const nextCvi = () => 'MC-WA-' + String(++cviNumber);
const wa = county => ['WA', county, String(POINT[county][0]), String(POINT[county][1])];
const state = s => [s, 'N/A', String(STATES[s][0]), String(STATES[s][1])];
// One row: [cvi, group, species, year, quarter, movement, animals, origin (4 cells), destination (4 cells)].
const row = (species, year, quarter, movement, animals, origin, dest) =>
  [nextCvi(), GROUP_OF[species], species, year === null ? null : String(year), quarter, movement, animals]
    .concat(origin, dest);

const rows = [];
// Heavy corridors and within-county movement, every quarter.
for (const [year, quarter] of PERIODS) {
  for (const [from, to, species, typical, perQuarter] of CORRIDORS) {
    for (let k = 0; k < perQuarter; k++) {
      rows.push(row(species, year, quarter, 'Intrastate', about(typical), wa(from), wa(to)));
    }
  }
  for (const [county, species, typical, perQuarter] of WITHIN) {
    for (let k = 0; k < perQuarter; k++) {
      rows.push(row(species, year, quarter, 'Intrastate', about(typical), wa(county), wa(county)));
    }
  }
}
// The long tail: light movement between any two different counties.
const SPECIES = Object.keys(GROUP_OF);
for (let k = 0; k < 220; k++) {
  const from = pick(COUNTIES);
  let to = pick(COUNTIES);
  while (to === from) to = pick(COUNTIES);
  const [year, quarter] = pick(PERIODS);
  rows.push(row(pick(SPECIES), year, quarter, 'Intrastate', about(20), wa(from), wa(to)));
}
// Interstate rows, so the WA State map has its usual circles too.
for (let k = 0; k < 150; k++) {
  const county = pick(COUNTIES), partner = pick(Object.keys(STATES));
  const [year, quarter] = pick(PERIODS);
  const species = pick(SPECIES);
  if (rnd() < 0.5) rows.push(row(species, year, quarter, 'Import', about(60), state(partner), wa(county)));
  else rows.push(row(species, year, quarter, 'Export', about(60), wa(county), state(partner)));
}

// Edge rows, one rule each.
const missing = [null, null];   // a missing pair of coordinates
const EDGES = [
  // A WA-to-WA row coded Import: counted once (CVI's former line map counts it too).
  row('Beef cattle', 2025, 'Q2', 'Import', '75', wa('Yakima'), wa('Benton')),
  // A WA-to-WA row coded Export: counted once (CVI's former line map, taking Inbound rows only, leaves it out).
  row('Beef cattle', 2025, 'Q2', 'Export', '64', wa('Grant'), wa('Adams')),
  // One movement written twice, as an Import row and an Export row: counted twice (by design).
  row('Beef cattle', 2025, 'Q3', 'Import', '33', wa('Spokane'), wa('Lincoln')),
  row('Beef cattle', 2025, 'Q3', 'Export', '33', wa('Spokane'), wa('Lincoln')),
  // No destination county: left out, counted under "no county".
  row('Sheep', 2024, 'Q2', 'Intrastate', '40', wa('Klickitat'), ['WA', null, String(POINT.Benton[0]), String(POINT.Benton[1])]),
  // The out-of-state placeholder "N/A" as a WA county: left out, counted under "no county".
  row('Horses', 2024, 'Q4', 'Intrastate', '6', ['WA', 'N/A', '47.0', '-120.5'], wa('Kittitas')),
  // No origin county point: left out, counted under "no county point".
  row('Goats', 2025, 'Q1', 'Intrastate', '9', ['WA', 'Chelan'].concat(missing), wa('Douglas')),
  // "County" written after the name: the loader removes it, so this is King to Pierce.
  row('Horses', 2025, 'Q4', 'Intrastate', '4', ['WA', 'King County', String(POINT.King[0]), String(POINT.King[1])], wa('Pierce')),
  // No animal count: the row is counted (a CVI record) with 0 animals.
  row('Feeder pigs', 2024, 'Q3', 'Intrastate', null, wa('Franklin'), wa('Walla Walla')),
  // Marked Intrastate but going to Oregon: not within the state.
  row('Beef cattle', 2025, 'Q1', 'Intrastate', '50', wa('Klickitat'), state('OR')),
  // Lowercase "wa" (exact text, as CVI's line map and the National Flow map): not within the state.
  row('Beef cattle', 2025, 'Q1', 'Intrastate', '28', wa('Asotin'), ['wa', 'Garfield', String(POINT.Garfield[0]), String(POINT.Garfield[1])]),
  // No Movement: on no map (the WA State map needs a direction), so not counted.
  row('Beef cattle', 2025, 'Q1', null, '19', wa('Whitman'), wa('Spokane')),
  // No year: in no year, so never in the selected years.
  row('Beef cattle', null, 'Q2', 'Intrastate', '22', wa('Yakima'), wa('Yakima')),
  // Quarter written "3": the loader reads Q3.
  row('Goats', 2024, '3', 'Intrastate', '7', wa('Pacific'), wa('Wahkiakum')),
  // A within-county row coded Import: counted as within-county movement.
  row('Dairy cattle', 2025, 'Q4', 'Import', '26', wa('Whatcom'), wa('Whatcom')),
  // A pair whose only animals are 0: a pair with a total of 0.
  row('Sheep', 2024, 'Q1', 'Intrastate', '0', wa('Asotin'), wa('Garfield')),
  // No destination county and no destination point: counted under "no county" (the county is checked first).
  row('Goats', 2025, 'Q4', 'Intrastate', '3', wa('Ferry'), ['WA', null].concat(missing)),
  // The only 2026 row, within Okanogan, with a different point at each end: Okanogan's point is the origin's
  // (latest year first, then the origin before the destination).
  row('Horses', 2026, 'Q1', 'Intrastate', '2', wa('Okanogan'),
    ['WA', 'Okanogan', (POINT.Okanogan[0] + 0.05).toFixed(4), (POINT.Okanogan[1] - 0.05).toFixed(4)])
];
rows.push(...EDGES);

const cell = v => {
  if (v === null || v === undefined) return '';
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
};
const text = [HEADER.join(',')].concat(rows.map(r => r.map(cell).join(','))).join('\n') + '\n';
fs.writeFileSync(OUT, text);
console.log('wrote', path.relative(ROOT, OUT), rows.length, 'rows (' + EDGES.length + ' edge rows)');
