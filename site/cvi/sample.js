/* CVI synthetic sample bundle. Builds, in the browser, the files of the Full example tier: the WA master
 * table, the five facility layers, a manifest adding two layers, and bundle.json. Every value is FABRICATED; only
 * column names follow CVI's files. Nothing here is real data, and no data file is stored in the site: the files are
 * generated from code.
 *
 * One generator for the site and the tests: tests/synthetic/make_cvi_master_fixtures.js writes
 * tests/synthetic/cvi_master_wa39.csv with masterWa39(), and tests/synthetic/make_bundles.js builds its tiers with
 * fullMaster(), facilityCsv(), MANIFEST and bundleJson(), so the downloaded files are byte-identical to the Full
 * tier's (checked by the F1 unit and browser tests). Deterministic: no clock, no Math.random.
 *
 * masterWa39(labels) -> CSV text, 1,500 rows. labels: the county label points of geo/wa-counties.js
 *   (CVIWA_GEO.labels); the anchors are those points rounded to 4 decimals.
 * fullMaster(waText) -> the Full tier's master: every column of the WA table plus synthetic premises columns.
 * facilityCsv(kind, n) -> a facility layer in the shape of CVI's reference file (names only), n rows.
 * fullTier(labels) -> { zipFolder, files: [[name, text]] } in the Full tier's order.
 * entries(labels) -> the downloadable archive's entries for WSDA.sample.zip: the Full tier's files in one folder.
 * rawRecords(text), csvText(rows): CSV records with raw cells, so columns can be dropped without changing other bytes. */
(function (root) {
  'use strict';

  // ---- WA master table (moved from tests/synthetic/make_cvi_master_fixtures.js) ------------------------------------
  const SPECIES = [['Cattle', ['Beef cattle', 'Dairy cattle', 'Beef cattle, cow-calf']], ['Swine', ['Swine', 'Feeder pigs']],
    ['Equids', ['Horses', 'Mules']], ['Poultry', ['Chickens', 'Turkeys', 'Ducks']], ['Small Ruminants', ['Sheep', 'Goats']], ['Other', ['Llama', 'Alpaca']]];
  const STATES = [['ID', 44.3509, -114.6130], ['OR', 43.9336, -120.5583], ['CA', 37.1661, -119.4494],
    ['MT', 47.0527, -109.6333], ['UT', 39.3055, -111.6703], ['NV', 39.3289, -116.6312]];
  const MOVES = { in: ['Import', 'import', 'Imports', 'Inbound'], out: ['Export', 'EXPORTS', 'Outbound', 'export'],
    intra: ['Intrastate', 'intrastate'] };
  // A few counties moved their pipeline centroid between years (exercises the most-recent-year anchor rule).
  const SHIFTED_2024 = new Set(['King', 'Yakima', 'Spokane', 'Grant', 'Whatcom']);
  const MASTER_HEADER = ['CVI', 'Species.Group', 'Species', 'Reporting.Year', 'Reporting.Quarter', 'Movement', 'Total.Animals',
    'Origin.State', 'Origin.County', 'Origin.County.Lat', 'Origin.County.Long', 'Dest.State', 'Dest.County', 'Dest.County.Lat', 'Dest.County.Long'];
  const csvCell = v => /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;

  // The synthetic WA master table (see the list at the top of the file): 1,500 rows from a fixed seed.
  function masterWa39(labels) {
    const COUNTIES = labels.map(l => ({ name: l.name, lat: +l.lat.toFixed(4), lon: +l.lon.toFixed(4) }));
    let seed = 20260930;                       // mulberry32
    // The next number from 0 up to 1 of the seeded sequence.
    function rnd() {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
    const pick = a => a[Math.floor(rnd() * a.length)];
    // One of the [value, weight] pairs' values, picked with chances in proportion to the weights.
    const weighted = pairs => {
      let r = rnd() * pairs.reduce((s, p) => s + p[1], 0);
      for (const p of pairs) { if ((r -= p[1]) < 0) return p[0]; }
      return pairs[pairs.length - 1][0];
    };
    const anchor = (c, year) => SHIFTED_2024.has(c.name) && year === 2024
      ? [+(c.lat + 0.031).toFixed(4), +(c.lon - 0.047).toFixed(4)] : [c.lat, c.lon];
    const countyLabel = c => rnd() < 0.08 ? c.name + ' County' : c.name;
    const animals = () => {
      const r = rnd();
      if (r < 0.02) return '';                 // blank -> NA
      if (r < 0.03) return 'n/a';              // non-numeric -> NA
      if (r < 0.06) return '0';
      // Math.exp is the only engine-approximated step; rounding to whole animals leaves a margin of about 4e-5 from any
      // .5 boundary over the 1,410 calls (measured), so engines that differ in the last bits still agree.
      return String(Math.max(1, Math.round(Math.exp(1 + rnd() * 7.5))));   // ~3 to ~5,000, many ties at small values
    };
    // County weights: a few heavy counties, a long tail (so every scaling method has spread).
    const weights = COUNTIES.map((c, i) => [c, 1 + (i * 7919 % 13)
      + (['Yakima', 'King', 'Grant', 'Spokane', 'Whatcom'].includes(c.name) ? 25 : 0)]);
    const lines = [MASTER_HEADER.join(',')];
    let cvi = 1000;
    for (let i = 0; i < 1500; i++) {
      if (rnd() < 0.7) cvi++;                  // ~30% of rows share a CVI with the previous row (species split)
      const [grp, raws] = pick(SPECIES);
      const year = rnd() < 0.45 ? 2024 : 2025;
      const q = 1 + Math.floor(rnd() * 4);
      const quarter = rnd() < 0.1 ? String(q) : 'Q' + q;
      const kind = weighted([['in', 45], ['out', 40], ['intra', 15]]);
      let mov = pick(MOVES[kind]);
      if (rnd() < 0.005) mov = '';             // NA movement
      let o, d;
      if (kind === 'in') {
        const s = pick(STATES), c = weighted(weights), a = anchor(c, year);
        o = [s[0], 'N/A', s[1], s[2]]; d = ['WA', countyLabel(c), a[0], a[1]];
      } else if (kind === 'out') {
        const s = pick(STATES), c = weighted(weights), a = anchor(c, year);
        o = ['WA', countyLabel(c), a[0], a[1]]; d = [s[0], 'N/A', s[1], s[2]];
      } else {
        const c1 = weighted(weights), c2 = weighted(weights), a1 = anchor(c1, year), a2 = anchor(c2, year);
        o = ['WA', countyLabel(c1), a1[0], a1[1]]; d = ['WA', countyLabel(c2), a2[0], a2[1]];
      }
      if (rnd() < 0.01) { if (kind === 'out') o[2] = ''; else d[2] = ''; }   // missing county coordinate
      const yearCell = rnd() < 0.003 ? '' : String(year);
      const row = ['C' + cvi, grp, pick(raws), yearCell, quarter, mov, animals(), o[0], o[1], String(o[2]),
        String(o[3]), d[0], d[1], String(d[2]), String(d[3])];
      lines.push(row.map(csvCell).join(','));
    }
    return lines.join('\n') + '\n';
  }

  // ---- Full tier (moved from tests/synthetic/make_bundles.js) ---------------------------------------------------------
  /** Splits CSV text into records of raw cells (quotes kept as written), so columns can be dropped or added without
   * changing any other byte. Line breaks inside quotes stay inside their cell. */
  function rawRecords(text) {
    const rows = []; let row = [], start = 0, q = false;
    for (let i = 0; i <= text.length; i++) {
      const c = text[i];
      if (c === '"') q = !q;
      else if (!q && (c === ',' || c === '\n' || i === text.length)) {
        row.push(text.slice(start, i)); start = i + 1;
        if (c !== ',') { if (!(row.length === 1 && row[0] === '')) rows.push(row); row = []; }
      }
    }
    return rows;
  }
  const csvText = rows => rows.map(r => r.join(',')).join('\n') + '\n';

  /** Every column of the WA table, plus synthetic premises columns (cities, coordinates near the county anchor, farm ids). */
  function fullMaster(waText) {
    const rows = rawRecords(waText);
    const head = rows[0];
    const num = v => {
      const x = Number(String(v).replace(/"/g, ''));
      return Number.isFinite(x) && String(v).trim() !== '' ? x : null;
    };
    const ix = n => head.indexOf(n);
    const extra = ['Origin.City', 'Origin.Lat', 'Origin.Long', 'Dest.City', 'Dest.Lat', 'Dest.Long', 'farm_entity_id_origin', 'farm_entity_id_dest'];
    const off = (k, s) => (((k * s) % 101) - 50) / 1000;
    return csvText(rows.map((r, k) => {
      if (k === 0) return r.concat(extra);
      const p = (latC, lonC, s) => {
        const a = num(r[ix(latC)]), b = num(r[ix(lonC)]);
        return a === null || b === null ? ['', ''] : [(a + off(k, s)).toFixed(4), (b + off(k, s + 6)).toFixed(4)];
      };
      return r.concat(['Synthetic Town ' + (k % 9 + 1), ...p('Origin.County.Lat', 'Origin.County.Long', 37),
        'Synthetic Town ' + (k % 7 + 1), ...p('Dest.County.Lat', 'Dest.County.Long', 53),
        'SYN-O-' + String(k % 300).padStart(4, '0'), 'SYN-D-' + String(k % 280).padStart(4, '0')]);
    }));
  }

  // Column names as in CVI's reference files (names only; every value below is synthetic).
  const FACILITY_SHAPES = {
    slaughterhouses: { label: 'Packing Plant', bom: true, cols: ['USDA Slaughter Facility', 'Street', 'City', 'State', 'Zip', 'Lat', 'Long', 'Type', 'Status', 'Notes', 'Phone', 'Inspector', '# Slaughter Facilities'] },
    fairgrounds: { label: 'Fairground', bom: true, cols: ['Fair Name', 'Type', 'Address', 'City', 'Lat', 'Long',
      '# Fairgrounds'] },
    markets: { label: 'Livestock Market', bom: true, cols: ['name', 'owners', 'address', 'street', 'city', 'state',
      'zip code', 'Lat', 'Long', 'phone number', 'sale day', 'sale species'] },
    feedlots: { label: 'Feedlot', bom: true, cols: ['name', 'phone number', 'address', 'street', 'city', 'state',
      'zip code', 'lat', 'long', ''] },
    restricted: { label: 'Restricted Holding', bom: true, cols: ['LIC #', 'NAME', 'CAT', 'MAILING ADDRESS',
      'PHYSICAL ADDRESS', 'STREET', 'CITY', 'STATE', 'ZIP', 'LAT', 'LONG', 'PHONE', 'EMAIL'] },
    custommeat: { label: 'Custom Meat', quoted: true, cols: ['Name', 'City', 'County', 'Lat', 'Long', 'geo_source'] },
    disposal: { label: 'Disposal Site', quoted: true, cols: ['FACILITY.NAME', 'City', 'County', 'Lat', 'Long', 'geo_source'] }
  };
  const COUNTY_NAMES = ['King', 'Yakima', 'Spokane', 'Grant', 'Whatcom', 'Benton', 'Lewis'];

  // A synthetic facility layer of n rows in the shape of CVI's file for that kind (seeded by the kind's name).
  function facilityCsv(kind, n) {
    const sh = FACILITY_SHAPES[kind];
    let seed = [...kind].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0;
    const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
    const value = (col, k, lat, lon) => {
      const c = col.toLowerCase();
      if (c === 'lat') return lat; if (c === 'long') return lon;
      if (/name/.test(c) || c === 'usda slaughter facility') return `Synthetic ${sh.label} ${k}`;
      if (c === '') return '';
      if (c.startsWith('#')) return '1';
      if (c === 'state') return 'WA';
      if (c === 'zip' || c === 'zip code') return '99' + String(100 + k);
      if (c === 'city') return 'Synthetic Town ' + k;
      if (c === 'county') return COUNTY_NAMES[k % COUNTY_NAMES.length];
      if (/phone/.test(c)) return '555-01' + String(10 + k);
      if (c === 'email') return `facility${k}@example.invalid`;
      if (c === 'geo_source') return ['google_address', 'google_city', 'existing'][k % 3];
      if (c === 'sale species') return k % 2 ? 'Cattle|Sheep' : 'Cattle';
      if (c === 'lic #') return 'SYN-' + (1000 + k);
      return `Synthetic ${col.toLowerCase()} ${k}`;
    };
    const q = s => sh.quoted ? '"' + s + '"' : s;
    const lines = [sh.cols.map(q).join(',')];
    for (let k = 1; k <= n; k++) {
      const lat = (45.8 + rnd() * 3.0).toFixed(4), lon = (-123.9 + rnd() * 6.7).toFixed(4);
      lines.push(sh.cols.map(col => q(value(col, k, lat, lon))).join(','));
    }
    return (sh.bom ? '﻿' : '') + lines.join('\n') + '\n';
  }

  const MANIFEST = [
    'key,file,name_col,label,live_label,group,pch,color,label_color,enabled',
    'syn_custommeat,synthetic_custom_meat_geocoded.csv,Name,Custom Meat (synthetic),Custom Meat (synthetic),Processing & Harvest,,,,TRUE',
    'syn_disposal,synthetic_animal_disposal.csv,FACILITY.NAME,Disposal (synthetic),Animal Disposal (synthetic),Disposal & Rendering,,,,TRUE',
    '# example row,example.csv,name,Example,,Other,,,,TRUE',
    'syn_disabled,synthetic_disabled_layer.csv,Name,Disabled layer,,Other,,,,FALSE'
  ].join('\n') + '\n';

  const bundleJson = o => JSON.stringify(o, null, 2) + '\n';
  const COVERAGE = { from: '2024-01-01', to: '2025-12-31' };

  // The Full tier's folder name and its files, as [name, text] pairs in the bundle's order.
  function fullTier(labels) {
    return { zipFolder: 'CVI full bundle', files: [
      ['CVI_Consolidated_Master.csv', fullMaster(masterWa39(labels))],
      ['usda_wa_slaughter_facilities.csv', facilityCsv('slaughterhouses', 6)],
      ['wa_state_fairs.csv', facilityCsv('fairgrounds', 8)],
      ['wa_state_public_livestock_markets.csv', facilityCsv('markets', 5)],
      ['wa_state_feedlots.csv', facilityCsv('feedlots', 7)],
      ['wa_state_restricted_holding_facilities.csv', facilityCsv('restricted', 4)],
      ['facility_overlays_manifest.csv', MANIFEST],
      ['synthetic_custom_meat_geocoded.csv', facilityCsv('custommeat', 9)],
      ['synthetic_animal_disposal.csv', facilityCsv('disposal', 3)],
      ['bundle.json', bundleJson({ profile: 'cvi', label: 'Full – synthetic test bundle', prepared: '2026-09-15',
        coverage: COVERAGE })]
    ] };
  }

  const FOLDER = 'CVI sample bundle (synthetic)';
  const entries = labels => [{ name: FOLDER, dir: true }]
    .concat(fullTier(labels).files.map(([name, data]) => ({ name: FOLDER + '/' + name, data })));

  root.WSDA = root.WSDA || {};
  root.WSDA.samples = root.WSDA.samples || {};
  root.WSDA.samples.cvi = {
    fileName: 'CVI_sample_bundle_synthetic.zip', entries,
    masterWa39, fullMaster, facilityCsv, fullTier, rawRecords, csvText, MANIFEST, bundleJson, COVERAGE, MASTER_HEADER
  };
})(typeof window !== 'undefined' ? window : globalThis);
