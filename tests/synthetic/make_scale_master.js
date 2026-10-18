#!/usr/bin/env node
'use strict';
// A synthetic CVI master the size of the real one, for timing the pages: 50,000 rows with all 38 canonical
// columns plus Comments (CVI's scripts/shared/helpers.R CVI_MASTER_PHYSICAL_COLUMNS, as the S7 fixture), written the
// way CVI's writer writes them (data.table::fwrite: no BOM, quotes only when needed, an empty cell for a missing
// value, 100000 as 1e+05). CVI's own master is of this order: some tens of thousands of rows.
//
// Every value is made up, from a fixed seed, so the file is the same on every run: the 39 Washington counties at
// their label points (site/geo/wa-counties.js) with 40 invented premises each, partner states at CVI's state centers
// (site/geo/state-centers.js), four years of quarters, CVI's seven species groups, and counts from 1 to about 5,000.
//
// Usage (repository root): node tests/synthetic/make_scale_master.js
// Output (git-ignored): local-test-artifacts/scale/cvi_master_50000.csv
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'local-test-artifacts', 'scale');
const FILE = path.join(OUT, 'cvi_master_50000.csv');
const ROWS = 50000;

const COLUMNS = [
  'CVI', 'Shipment.Date', 'Inspection.Date', 'Date', 'Reporting.Date',
  'Reporting.Year', 'Reporting.Quarter', 'Permit.Number', 'Movement',
  'Origin.Name', 'Origin.Org', 'Origin.Address', 'Origin.City',
  'Origin.County', 'Origin.State', 'Origin.Zip',
  'Origin.Lat', 'Origin.Long', 'Origin.County.Lat', 'Origin.County.Long',
  'Dest.Name', 'Dest.Org', 'Dest.Address', 'Dest.City',
  'Dest.County', 'Dest.State', 'Dest.Zip',
  'Dest.Lat', 'Dest.Long', 'Dest.County.Lat', 'Dest.County.Long',
  'Veterinarian', 'Species', 'Species.Group', 'Total.Animals', 'Paper',
  'Updated.Date', 'Updated.By', 'Comments'
];
const SPECIES = {
  'Dairy cattle': 'Cattle', 'Beef cattle': 'Cattle', Chickens: 'Poultry', Turkeys: 'Poultry', Pigs: 'Swine',
  Horses: 'Equids', Goats: 'Small Ruminants', Sheep: 'Small Ruminants', Alpacas: 'Camelids', Llamas: 'Other'
};
const YEARS = [2022, 2023, 2024, 2025];
const PARTNERS = ['OR', 'ID', 'CA', 'MT', 'UT', 'NV', 'AZ', 'CO', 'TX', 'MN', 'WI', 'IA', 'NE', 'SD', 'KS'];

// A small seeded generator (mulberry32), so the file never changes between runs.
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = random(20261018);
const pick = list => list[Math.floor(rnd() * list.length)];
const round4 = x => Math.round(x * 10000) / 10000;

// The places: each WA county's label point and 40 premises near it; each partner state's center and 10 premises.
const geo = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'site', 'geo', 'wa-counties.js'), 'utf8'), geo);
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'site', 'geo', 'state-centers.js'), 'utf8'), geo);
const centers = Object.fromEntries(geo.window.WSDA_STATE_CENTERS.centers.map(c => [c.state, c]));
let premisesNumber = 0;
function premises(lat, lon, spread, n) {
  return Array.from({ length: n }, () => {
    premisesNumber++;
    return { lat: round4(lat + (rnd() - 0.5) * spread), lon: round4(lon + (rnd() - 0.5) * spread * 1.4),
      name: 'Synthetic Farm ' + premisesNumber, road: 'Synthetic Road ' + (premisesNumber % 90 + 1),
      city: 'Synthetic Town ' + (premisesNumber % 400 + 1),
      zip: String(98000 + premisesNumber % 1000) };
  });
}
const WA = geo.window.CVIWA_GEO.labels.map(c => ({ county: c.name, lat: round4(c.lat), lon: round4(c.lon),
  farms: premises(c.lat, c.lon, 0.3, 40) }));
const OUT_OF_STATE = PARTNERS.map(s => ({ state: s, lat: centers[s].lat, lon: centers[s].lon,
  farms: premises(centers[s].lat, centers[s].lon, 1.0, 10) }));

// A value as fwrite writes it: quoted only with a comma, a quote or a line break; a missing value empty;
// numbers in R's shortest form (1e+05 for 100000).
function cell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return v === 100000 ? '1e+05' : String(v);
  return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
const day = (year, quarter) => {
  const month = (quarter - 1) * 3 + 1 + Math.floor(rnd() * 3);
  return year + '-' + String(month).padStart(2, '0') + '-' + String(1 + Math.floor(rnd() * 28)).padStart(2, '0');
};

const lines = [COLUMNS.join(',')];
const speciesNames = Object.keys(SPECIES);
for (let i = 1; i <= ROWS; i++) {
  const year = pick(YEARS), quarter = 1 + Math.floor(rnd() * 4);
  const u = rnd();
  const movement = u < 0.45 ? 'Import' : u < 0.8 ? 'Export' : 'Intrastate';
  const waFrom = pick(WA), waTo = pick(WA), other = pick(OUT_OF_STATE);
  const from = movement === 'Import' ? other : waFrom;
  const to = movement === 'Export' ? other : waTo;
  const fromFarm = pick(from.farms), toFarm = pick(to.farms);
  const species = pick(speciesNames);
  // Mostly small counts, a few large ones (poultry loads), and an exact 100000 now and then.
  const animals = i % 997 === 0 ? 100000 : Math.max(1, Math.round(Math.exp(rnd() * 8.5)));
  const date = day(year, quarter);
  const end = (place, farm, isWa) => [farm.name, '', farm.road, farm.city,
    isWa ? place.county : 'N/A', isWa ? 'WA' : place.state, farm.zip, farm.lat, farm.lon,
    place.lat, place.lon];
  const o = end(from, fromFarm, movement !== 'Import'), d = end(to, toFarm, movement !== 'Export');
  const row = ['SC-' + String(i).padStart(6, '0'), date, date, date, date, year, 'Q' + quarter,
    'P' + String(1 + Math.floor(rnd() * 99999)).padStart(5, '0'), movement]
    .concat(o.slice(0, 4), [o[4], o[5], o[6], o[7], o[8], o[9], o[10]],
      d.slice(0, 4), [d[4], d[5], d[6], d[7], d[8], d[9], d[10]],
      ['Synthetic Vet ' + (1 + Math.floor(rnd() * 60)), species, SPECIES[species], animals,
        rnd() < 0.1 ? 'TRUE' : 'FALSE', date, 'synthetic', i % 50 === 0 ? 'Made-up note, row ' + i : null]);
  lines.push(row.map(cell).join(','));
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(FILE, lines.join('\n') + '\n');
console.log('wrote ' + path.relative(ROOT, FILE) + ': ' + ROWS + ' rows, ' + COLUMNS.length + ' columns, '
  + (fs.statSync(FILE).size / 1048576).toFixed(1) + ' MB');
