#!/usr/bin/env node
'use strict';
// S7 synthetic fixture: one CVI master with all 38 canonical columns plus Comments (CVI's
// scripts/shared/helpers.R CVI_MASTER_PHYSICAL_COLUMNS), for the chart and export checks.
// It has what the existing fixtures lack: quarters with gaps and a same quarter one year
// earlier, a species group no palette names, premises in two focus counties, repeated CVI
// numbers, and the values CVI's CSV reader and writer treat specially (100000 written as
// 1e+05, a ZIP code with a leading zero, ISO dates and date-times, TRUE/FALSE text, commas
// and line breaks in comments). No real data: every name, number and place is made up.
//
// Usage (repository root): node tests/synthetic/make_cvi_s7_fixtures.js
// Output (git-ignored): local-test-artifacts/s7/fixtures/cvi_master_s7.csv

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'local-test-artifacts', 's7', 'fixtures');

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

// Washington counties used here, with a county point and a premises point inside each.
const WA = {
  King: { lat: 47.4905, lon: -121.8345, farm: [47.5181, -121.8233], city: 'Synthetic Town 1', zip: '98001' },
  Yakima: { lat: 46.4562, lon: -120.7398, farm: [46.4278, -120.7565], city: 'Synthetic Town 2', zip: '98901' },
  Pierce: { lat: 47.0383, lon: -122.1405, farm: [47.0502, -122.2902], city: 'Synthetic Town 3', zip: '98301' },
  Spokane: { lat: 47.6205, lon: -117.4041, farm: [47.6511, -117.2213], city: 'Synthetic Town 4', zip: '99001' }
};
// Partner states (the National Flow view needs each in CVI's state centers file).
const OUT_OF_STATE = {
  OR: { city: 'Synthetic Town 5', zip: '97001', farm: [44.05, -121.31] },
  ID: { city: 'Synthetic Town 6', zip: '83201', farm: [43.61, -116.2] },
  CA: { city: 'Synthetic Town 7', zip: '95001', farm: [37.27, -119.27] },
  // A leading-zero ZIP: CVI's reader takes the ZIP columns as numbers (01234 becomes 1234).
  MA: { city: 'Synthetic Town 8', zip: '01234', farm: [42.26, -71.8] }
};

const SPECIES = {
  'Dairy cattle': 'Cattle', 'Beef cattle': 'Cattle', Chickens: 'Poultry', Turkeys: 'Poultry',
  Pigs: 'Swine', Horses: 'Equids', Goats: 'Small Ruminants', Alpacas: 'Camelids'
};

// One movement per entry: [year, quarter, kind, from, to, species, animals, cvi]. kind is
// Import (into WA), Export (out of WA) or Intrastate (WA to WA). Quarters with data:
// 2023 Q3-Q4, 2024 Q1, 2024 Q3-Q4 and 2025 Q3 (2024 Q2 and 2025 Q1-Q2 are empty), so
// 2025 Q3 can be compared with 2024 Q3. The last rows are edge cases.
const MOVES = [
  [2023, 'Q3', 'Import', 'OR', 'King', 'Dairy cattle', 120, 'S7-WA-0001'],
  [2023, 'Q3', 'Export', 'Yakima', 'ID', 'Beef cattle', 80, 'S7-WA-0002'],
  [2023, 'Q3', 'Intrastate', 'Yakima', 'King', 'Chickens', 100000, 'S7-WA-0003'],
  [2023, 'Q4', 'Import', 'CA', 'Yakima', 'Pigs', 40, 'S7-WA-0004'],
  [2023, 'Q4', 'Export', 'King', 'OR', 'Horses', 3, 'S7-WA-0005'],
  [2023, 'Q4', 'Intrastate', 'Pierce', 'Spokane', 'Goats', 12, 'S7-WA-0006'],
  [2024, 'Q1', 'Import', 'ID', 'Spokane', 'Beef cattle', 300, 'S7-WA-0007'],
  [2024, 'Q1', 'Import', 'ID', 'Spokane', 'Beef cattle', 150, 'S7-WA-0007'],
  [2024, 'Q1', 'Export', 'Pierce', 'CA', 'Dairy cattle', 64, 'S7-WA-0008'],
  [2024, 'Q1', 'Intrastate', 'King', 'Yakima', 'Turkeys', 1500000, 'S7-WA-0009'],
  [2024, '3', 'Import', 'OR', 'Yakima', 'Dairy cattle', 210, 'S7-WA-0010'],
  [2024, 'Q3', 'Import', 'MA', 'King', 'Alpacas', 6, 'S7-WA-0011'],
  [2024, 'Q3', 'Export', 'Spokane', 'ID', 'Pigs', 95, 'S7-WA-0012'],
  [2024, 'Q3', 'Intrastate', 'Yakima', 'Pierce', 'Beef cattle', 44, 'S7-WA-0013'],
  [2024, 'Q3', 'Export', 'King', 'MA', 'Goats', 2.5, 'S7-WA-0014'],
  [2024, 'Q4', 'Import', 'CA', 'Pierce', 'Chickens', 300000, 'S7-WA-0015'],
  [2024, 'Q4', 'Export', 'Yakima', 'OR', 'Dairy cattle', 75, 'S7-WA-0016'],
  [2024, 'Q4', 'Intrastate', 'Spokane', 'King', 'Horses', 2, 'S7-WA-0017'],
  [2025, 'Q3', 'Import', 'OR', 'Yakima', 'Dairy cattle', 330, 'S7-WA-0018'],
  [2025, 'Q3', 'Import', 'ID', 'King', 'Pigs', 25, 'S7-WA-0019'],
  [2025, 'Q3', 'Export', 'King', 'CA', 'Beef cattle', 18, 'S7-WA-0020'],
  [2025, 'Q3', 'Export', 'Pierce', 'OR', 'Alpacas', 4, 'S7-WA-0021'],
  [2025, 'Q3', 'Intrastate', 'King', 'Pierce', 'Dairy cattle', 52, 'S7-WA-0022'],
  [2025, 'Q3', 'Intrastate', 'Yakima', 'Yakima', 'Chickens', 900, 'S7-WA-0023'],
  // Edge cases: a missing animal count, a row with no year, a blank CVI number.
  [2025, 'Q3', 'Import', 'CA', 'Spokane', 'Turkeys', null, 'S7-WA-0024'],
  [null, 'Q3', 'Import', 'OR', 'King', 'Dairy cattle', 9, 'S7-WA-0025'],
  [2024, 'Q4', 'Export', 'Spokane', 'ID', 'Beef cattle', 11, '']
];

// A field as CSV text: quoted when it holds a comma, a quote or a line break.
function csvField(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function end(place, role, i) {
  const wa = WA[place];
  if (wa) {
    return {
      name: 'Synthetic ' + role + ' ' + (i + 1), org: 'Synthetic Org ' + ((i % 3) + 1),
      address: (100 + i) + ' Example Road', city: wa.city, county: place + ' County', state: 'WA',
      zip: wa.zip, lat: wa.farm[0], lon: wa.farm[1], countyLat: wa.lat, countyLon: wa.lon
    };
  }
  const o = OUT_OF_STATE[place];
  return {
    name: 'Synthetic ' + role + ' ' + (i + 1), org: 'Synthetic Org ' + ((i % 3) + 1),
    address: (200 + i) + ' Sample Lane', city: o.city, county: 'N/A', state: place,
    zip: o.zip, lat: o.farm[0], lon: o.farm[1], countyLat: null, countyLon: null
  };
}

function rows() {
  return MOVES.map((m, i) => {
    const [year, quarter, kind, from, to, species, animals, cvi] = m;
    const o = end(from, 'Origin', i);
    const d = end(to, 'Destination', i);
    const month = { Q1: 2, Q2: 5, Q3: 8, '3': 8, Q4: 11 }[quarter];
    const y = year === null ? 2025 : year;
    const day = String((i % 27) + 1).padStart(2, '0');
    const mm = String(month).padStart(2, '0');
    const comment = i % 5 === 0 ? 'Checked at the gate, ok' : i % 7 === 0 ? 'Two lines:\nsecond line' : null;
    const value = {
      CVI: cvi,
      'Shipment.Date': y + '-' + mm + '-' + day,
      // Without leading zeros: CVI's reader still reads these as dates and writes them back padded.
      'Inspection.Date': y + '-' + month + '-' + Number(day),
      Date: y + '-' + mm + '-' + day,
      'Reporting.Date': month + '/' + Number(day) + '/' + y,
      'Reporting.Year': year,
      'Reporting.Quarter': quarter,
      'Permit.Number': i % 4 === 0 ? 'P-' + (1000 + i) : null,
      Movement: kind,
      'Origin.Name': o.name, 'Origin.Org': o.org, 'Origin.Address': o.address, 'Origin.City': o.city,
      'Origin.County': o.county, 'Origin.State': o.state, 'Origin.Zip': o.zip,
      'Origin.Lat': o.lat, 'Origin.Long': o.lon, 'Origin.County.Lat': o.countyLat, 'Origin.County.Long': o.countyLon,
      'Dest.Name': d.name, 'Dest.Org': d.org, 'Dest.Address': d.address, 'Dest.City': d.city,
      'Dest.County': d.county, 'Dest.State': d.state, 'Dest.Zip': d.zip,
      'Dest.Lat': d.lat, 'Dest.Long': d.lon, 'Dest.County.Lat': d.countyLat, 'Dest.County.Long': d.countyLon,
      Veterinarian: 'Synthetic Vet ' + ((i % 4) + 1),
      Species: species,
      'Species.Group': SPECIES[species],
      'Total.Animals': animals,
      Paper: i % 2 === 0 ? 'TRUE' : 'FALSE',
      'Updated.Date': y + '-' + mm + '-' + day + ' 08:' + String(i % 60).padStart(2, '0') + ':00',
      'Updated.By': 'synthetic.user',
      Comments: comment
    };
    return COLUMNS.map(c => csvField(value[c])).join(',');
  });
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const text = [COLUMNS.join(',')].concat(rows()).join('\n') + '\n';
  const file = path.join(OUT, 'cvi_master_s7.csv');
  fs.writeFileSync(file, text);
  console.log('wrote ' + path.relative(ROOT, file) + ' (' + MOVES.length + ' rows)');
}

main();
