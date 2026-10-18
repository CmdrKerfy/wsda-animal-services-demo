#!/usr/bin/env node
'use strict';
/*
 * Collects synthetic tables into one git-ignored folder, test-tables/ at the repository root: read by the suites and
 * handy for trying the pages by hand, since a file picker then needs one folder instead of several. Copies only: the
 * tests keep reading the originals in tests/synthetic/ and local-test-artifacts/f1/tiers/ (written by the F1 unit
 * tests, which call this at the end). Run alone: node tests/synthetic/make_test_tables.js
 *
 * Only the files this script makes are replaced; anything else in the folder (for example a user's own copies)
 * is kept, so local files are never lost on a rebuild.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'test-tables');
const SYN = path.join(ROOT, 'tests', 'synthetic');
const TIERS = path.join(ROOT, 'local-test-artifacts', 'f1', 'tiers');

const MASTERS = [
  ['cvi_master_small.csv', 'Small CVI master (S1 map basics)'],
  ['cvi_master_wa39.csv', 'All 39 WA counties (larger S1 map example)'],
  ['cvi_master_s2.csv', 'S2 edge cases: duplicates, blank CVIs, ties, year gaps, Okanogan only in 2026'],
  ['cvi_master_s2_numcvi.csv', 'All-numeric CVI column (documents one counting difference)'],
  ['cvi_master_movement.csv', 'MC within-state movement: heavy corridors, within-county movement, edge rows'],
];
const TIER_INFO = {
  full: 'Full tier: every column and every facility layer',
  partner: 'Partner tier: the 13 required columns (no CVI, no Species) and two facility layers',
  public: 'Public tier: 13 required columns + Species, no facility layers',
};
// The master inside each tier folder (recognized by its columns, so the copy can be renamed).
const TIER_MASTER = { full: 'CVI_Consolidated_Master.csv', partner: 'partner_county_totals.csv', public: 'CVI_Consolidated_Master.csv' };
const INFRA_INFO = 'Infrastructure sample: facility layers only, no master (the same files as its "Download a synthetic sample")';

// Copies a folder file by file, replacing those files and leaving any other file in the target folder alone.
function copyFolder(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    const source = path.join(from, name);
    if (fs.statSync(source).isDirectory()) copyFolder(source, path.join(to, name));
    else fs.copyFileSync(source, path.join(to, name));
  }
}

// The Infrastructure sample, built by the page's own generator and ZIP writer (byte-identical to its download).
function writeInfrastructureSample(lines) {
  require(path.join(ROOT, 'site', 'shared', 'zip.js'));
  require(path.join(ROOT, 'site', 'shared', 'sample.js'));
  require(path.join(ROOT, 'site', 'infrastructure', 'sample.js'));
  const sample = globalThis.WSDA.samples.infrastructure;
  const entries = sample.entries();
  const folderName = sample.fileName.replace(/\.zip$/, '');
  fs.writeFileSync(path.join(OUT, sample.fileName), globalThis.WSDA.sample.zip(entries));
  fs.mkdirSync(path.join(OUT, folderName), { recursive: true });
  for (const e of entries) fs.writeFileSync(path.join(OUT, folderName, e.name), e.data);
  lines.push(`${sample.fileName}  ${INFRA_INFO}: the whole bundle as a ZIP`);
  lines.push(`${folderName}/  ${INFRA_INFO}: the same files as a folder (keep the file names: facility layers are recognized by name)`);
}

// The all-in-one sample (AB), built by the page's own generator (byte-identical to its download), as a ZIP and as
// a folder with its cvi/ and facilities/ subfolders.
const ALL_INFO = 'All-in-one sample: the CVI map and Infrastructure in one bundle (bundle.json lists both)';
function writeAllInOneSample(lines) {
  require(path.join(ROOT, 'site', 'shared', 'zip.js'));
  require(path.join(ROOT, 'site', 'shared', 'sample.js'));
  require(path.join(ROOT, 'site', 'cvi', 'sample.js'));
  const gen = require(path.join(__dirname, 'make_bundles.js'));
  const all = gen.allInOne();
  fs.writeFileSync(path.join(OUT, all.fileName), gen.allInOneZip());
  for (const e of all.entries) {
    const target = path.join(OUT, e.name);
    if (e.dir) fs.mkdirSync(target, { recursive: true });
    else fs.writeFileSync(target, e.data);
  }
  lines.push(`${all.fileName}  ${ALL_INFO}: the whole bundle as a ZIP`);
  lines.push(`${all.folder}/  ${ALL_INFO}: the same files as a folder, with cvi/ and facilities/ subfolders`);
}

// National Flow with Alaska and Hawaii: the Full tier's master with its first 40
// Montana-to-Washington rows moved to Alaska and its first 30 Washington-to-Nevada rows to Hawaii (the CH unit suite
// makes the same rows in memory). Only the two state cells change; every other cell is written as read.
const FLOW_AKHI = 'flow_alaska_hawaii.csv';
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    if (ch === ',' && !quoted) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}
function writeAlaskaHawaii(lines) {
  const text = fs.readFileSync(path.join(OUT, 'tier_full_master.csv'), 'utf8');
  const rows = text.split(/\r?\n/);
  const head = splitCsvLine(rows[0]);
  const o = head.indexOf('Origin.State');
  const d = head.indexOf('Dest.State');
  let ak = 0;
  let hi = 0;
  const out = rows.map((line, i) => {
    if (i === 0 || !line) return line;
    const cells = splitCsvLine(line);
    if (cells[o] === 'MT' && cells[d] === 'WA' && ak < 40) { cells[o] = 'AK'; ak++; }
    else if (cells[o] === 'WA' && cells[d] === 'NV' && hi < 30) { cells[d] = 'HI'; hi++; }
    else return line;
    return cells.join(',');
  });
  if (ak !== 40 || hi !== 30) throw new Error(FLOW_AKHI + ': expected 40 Alaska and 30 Hawaii rows, made ' + ak + ' and ' + hi);
  fs.writeFileSync(path.join(OUT, FLOW_AKHI), out.join('\n'));
  lines.push(FLOW_AKHI + '  National Flow with Alaska and Hawaii: the Full tier master with 40 Montana rows moved to ' +
    'Alaska and 30 Nevada rows to Hawaii');
}

// Two error cases: a master missing one required column, and a folder whose manifest gives a layer a color the
// browser cannot read ("1c5a83", no "#").
const MISSING_COLUMN = 'cvi_master_missing_column.csv';
const BAD_COLOR = 'manifest_bad_color';
function writeReleaseChecks(lines) {
  const rows = fs.readFileSync(path.join(OUT, 'tier_full_master.csv'), 'utf8').split(/\r?\n/);
  const drop = splitCsvLine(rows[0]).indexOf('Dest.County.Long');
  if (drop < 0) throw new Error(MISSING_COLUMN + ': Dest.County.Long not found');
  fs.writeFileSync(path.join(OUT, MISSING_COLUMN), rows.map(line => {
    if (!line) return line;
    const cells = splitCsvLine(line);
    cells.splice(drop, 1);
    return cells.join(',');
  }).join('\n'));
  lines.push(MISSING_COLUMN + '  The Full tier master without its Dest.County.Long column (a near miss the landing page names)');
  const folder = path.join(OUT, BAD_COLOR);
  fs.mkdirSync(folder, { recursive: true });
  fs.copyFileSync(path.join(TIERS, 'full', 'wa_state_feedlots.csv'), path.join(folder, 'wa_state_feedlots.csv'));
  fs.writeFileSync(path.join(folder, 'facility_overlays_manifest.csv'),
    'key,file,label,group,color\nextra_points,extra_points.csv,Extra points,Other,1c5a83\n');
  fs.writeFileSync(path.join(folder, 'extra_points.csv'), 'name,lat,long\nSynthetic Extra North,47.95,-120.30\n' +
    'Synthetic Extra Center,47.20,-120.90\nSynthetic Extra South,46.40,-120.10\n');
  lines.push(BAD_COLOR + '/  Feedlots and one extra layer whose manifest color "1c5a83" (no "#") the browser cannot read');
}

// Files as Excel or R can leave them, for the load statuses: a master with counts the page cannot read ("1,200" as
// Excel saves it, "12 head", "about 40"), one saved as Windows-1252 rather than UTF-8 (an "ñ" in a city name), one
// with its Total.Animals column written twice, and a fairs file saved as Windows-1252 (in a folder, under its own
// name so it is recognized).
const UNREADABLE = 'cvi_master_unreadable_counts.csv';
const NOT_UTF8 = 'cvi_master_not_utf8.csv';
const REPEATED = 'cvi_master_repeated_column.csv';
const FAIRS_NOT_UTF8 = 'fairs_not_utf8';
function writeLoadChecks(lines) {
  const rows = fs.readFileSync(path.join(OUT, 'tier_full_master.csv'), 'utf8').split(/\r?\n/);
  const head = splitCsvLine(rows[0]);
  const animals = head.indexOf('Total.Animals');
  const city = head.indexOf('Dest.City');
  if (animals < 0 || city < 0) throw new Error('tier_full_master.csv: Total.Animals or Dest.City not found');
  const changed = (edit) => rows.map((line, i) => {
    if (i === 0 || !line) return line;
    const cells = splitCsvLine(line);
    return edit(cells, i) ? cells.join(',') : line;
  });
  const BAD = { 1: '"1,200"', 2: '12 head', 3: 'about 40' };
  fs.writeFileSync(path.join(OUT, UNREADABLE), changed((cells, i) => {
    if (!BAD[i]) return false;
    cells[animals] = BAD[i];
    return true;
  }).join('\n'));
  lines.push(UNREADABLE + '  The Full tier master with three counts the page cannot read ("1,200", "12 head", "about 40")');
  // Windows-1252 writes "ñ" as the one byte F1, which is not UTF-8 (latin1 is the same for this letter).
  fs.writeFileSync(path.join(OUT, NOT_UTF8), Buffer.from(changed((cells, i) => {
    if (i !== 1) return false;
    cells[city] = 'Cañon Synthetic Town';
    return true;
  }).join('\n'), 'latin1'));
  lines.push(NOT_UTF8 + '  The Full tier master saved as Windows-1252, not UTF-8 (one city name has an "ñ")');
  fs.writeFileSync(path.join(OUT, REPEATED), rows.map(line => {
    if (!line) return line;
    const cells = splitCsvLine(line);
    return cells.concat([cells[animals]]).join(',');
  }).join('\n'));
  lines.push(REPEATED + '  The Full tier master with its Total.Animals column written twice (refused)');
  const folder = path.join(OUT, FAIRS_NOT_UTF8);
  fs.mkdirSync(folder, { recursive: true });
  // Without the UTF-8 BOM, which a Windows-1252 file does not have.
  const fairs = fs.readFileSync(path.join(TIERS, 'full', 'wa_state_fairs.csv'), 'utf8').replace(/^\uFEFF/, '').split('\n');
  fairs[1] = fairs[1].replace('Synthetic Fairground 1,', 'Synthetic Fairground Peña,');
  fs.writeFileSync(path.join(folder, 'wa_state_fairs.csv'), Buffer.from(fairs.join('\n'), 'latin1'));
  lines.push(FAIRS_NOT_UTF8 + '/  A fairs file saved as Windows-1252, not UTF-8 (one fair\'s name has an "ñ")');
}

function make() {
  for (const t of Object.keys(TIER_INFO)) {
    if (!fs.existsSync(path.join(TIERS, t + '.zip'))) {
      throw new Error('tier files missing; run node tests/node/run_f1_unit_tests.js first');
    }
  }
  fs.mkdirSync(OUT, { recursive: true });
  const lines = [
    'Synthetic test tables, collected in one folder: read by the suites and handy for trying the pages by hand (made-up data only).',
    'Rebuilt by every F1 unit test run and by: node tests/synthetic/make_test_tables.js',
    'A rebuild replaces only the files listed below; other files you put in this folder are kept.',
    'Not committed (git-ignored).',
    '',
  ];
  for (const [f, about] of MASTERS) {
    fs.copyFileSync(path.join(SYN, f), path.join(OUT, f));
    lines.push(`${f}  ${about}`);
  }
  for (const [t, about] of Object.entries(TIER_INFO)) {
    const flat = `tier_${t}_master.csv`;
    fs.copyFileSync(path.join(TIERS, t, TIER_MASTER[t]), path.join(OUT, flat));
    fs.copyFileSync(path.join(TIERS, t + '.zip'), path.join(OUT, `tier_${t}.zip`));
    copyFolder(path.join(TIERS, t), path.join(OUT, `tier_${t}`));
    lines.push(`${flat}  ${about}: the master table on its own`);
    lines.push(`tier_${t}.zip  ${about}: the whole bundle as a ZIP`);
    lines.push(`tier_${t}/  ${about}: the same files as a folder (keep the file names: facility layers are recognized by name)`);
  }
  writeInfrastructureSample(lines);
  writeAllInOneSample(lines);
  writeAlaskaHawaii(lines);
  writeReleaseChecks(lines);
  writeLoadChecks(lines);
  fs.writeFileSync(path.join(OUT, 'README.txt'), lines.join('\n') + '\n');
  return OUT;
}

module.exports = { make, OUT };
if (require.main === module) console.log('Test tables written to ' + path.relative(ROOT, make()));
