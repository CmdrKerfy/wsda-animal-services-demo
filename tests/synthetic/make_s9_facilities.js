#!/usr/bin/env node
'use strict';
// Synthetic facility layers for S9's County Focus name markers: three of CVI's built-in layers with CVI's
// file names and name columns, every point inside the Full tier's two focus counties (Grant and Yakima), with a
// tight cluster (names must move apart), a long name (wrapped onto two lines) and a name with a comma and quotes.
// Synthetic only: invented names and places. Written to local-test-artifacts/s9/facilities/ (git-ignored); the R
// reference copies them into its sandbox, the browser suite hands them to the page as dropped files.
//
// A second, statewide set (all five layers, for the Infrastructure dashboard's Facilities PNG) is written beside it;
// see generateWa() below.
//
// Usage (repository root): node tests/synthetic/make_s9_facilities.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'local-test-artifacts', 's9', 'facilities');

const LAYERS = {
  markets: { file: 'wa_state_public_livestock_markets.csv', nameColumn: 'name', rows: [
    ['Synthetic Livestock Market North', 47.131, -119.279],
    ['Synthetic Market Two', 47.122, -119.301],
    ['Synthetic Cooperative Livestock Auction Yard of Central Washington', 46.602, -120.505]] },
  feedlots: { file: 'wa_state_feedlots.csv', nameColumn: 'name', rows: [
    ['Synthetic Feedlot A', 47.128, -119.288],
    ['Synthetic Feedlot B', 47.119, -119.276],
    ['Synthetic Feedlot "C", East', 46.398, -120.302],
    ['Synthetic Feedlot D', 46.476, -120.748]] },
  fairgrounds: { file: 'wa_state_fairs.csv', nameColumn: 'Fair.Name', rows: [
    ['Synthetic County Fair', 47.231, -119.552],
    ['Synthetic Valley Fair', 46.621, -120.481]] }
};

const field = v => (/[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
function generate() {
  fs.mkdirSync(OUT, { recursive: true });
  const written = [];
  for (const [key, l] of Object.entries(LAYERS)) {
    const lines = [[l.nameColumn, 'lat', 'long'].join(',')].concat(l.rows.map(r => r.map(field).join(',')));
    fs.writeFileSync(path.join(OUT, l.file), lines.join('\n') + '\n');
    written.push({ key, file: l.file, rows: l.rows.length });
  }
  return { dir: OUT, written };
}

// ── Statewide layers for the Facilities PNG on the Infrastructure dashboard ─────────────────────────────────────
// All five of CVI's built-in layers, spread over Washington's counties so the Density view has five count classes
// (feedlots: 6, 4, 3, 2, 2, 1, 1, 1 per county) and the Locations view several layers per county. Points are
// placed inside their county at least 0.03 degrees from its border (from the site's bundled county boundaries), by a
// fixed pseudo-random sequence, so every run writes the same files. Markets also carry CVI's precision flag:
// two town-level rows at one town (geo_source "google_city", with a city column), one row without a location
// ("none") and one at 0, 0, which CVI counts as unplaced. Two Yakima markets share one 0.12-degree cell, so only the
// third is named when markets carry name markers. Written to local-test-artifacts/s9/facilities-wa/.
const OUT_WA = path.join(ROOT, 'local-test-artifacts', 's9', 'facilities-wa');
const PLAN_WA = {
  markets: { file: 'wa_state_public_livestock_markets.csv', nameColumn: 'name', prefix: 'Synthetic Market',
    counties: ['Yakima', 'Yakima', 'Yakima', 'Spokane', 'Spokane', 'Grant', 'Grant', 'Whatcom', 'Lewis',
      'Walla Walla', 'Okanogan', 'Stevens'] },
  feedlots: { file: 'wa_state_feedlots.csv', nameColumn: 'name', prefix: 'Synthetic Feedlot',
    counties: ['Grant', 'Grant', 'Grant', 'Grant', 'Grant', 'Grant', 'Adams', 'Adams', 'Adams', 'Adams',
      'Yakima', 'Yakima', 'Yakima', 'Franklin', 'Franklin', 'Benton', 'Benton', 'Walla Walla', 'Lincoln', 'Douglas'] },
  fairgrounds: { file: 'wa_state_fairs.csv', nameColumn: 'Fair.Name', prefix: 'Synthetic Fair',
    counties: ['Clallam', 'Thurston', 'Lewis', 'Clark', 'Kittitas', 'Chelan', 'Okanogan', 'Ferry', 'Whitman',
      'Asotin', 'Klickitat', 'Skagit'] },
  slaughterhouses: { file: 'usda_wa_slaughter_facilities.csv', nameColumn: 'USDA.Slaughter.Facility',
    prefix: 'Synthetic Packing Plant', counties: ['King', 'King', 'Pierce', 'Snohomish', 'Yakima', 'Spokane'] },
  restricted: { file: 'wa_state_restricted_holding_facilities.csv', nameColumn: 'NAME',
    prefix: 'Synthetic Holding Facility', counties: ['Whitman', 'Skagit'] }
};

function countyGeometry() {
  const txt = fs.readFileSync(path.join(ROOT, 'site', 'geo', 'wa-counties.js'), 'utf8').split('\n')[1];
  const geo = JSON.parse(txt.replace(/^window\.CVIWA_GEO = /, '').replace(/;$/, ''));
  return new Map(geo.counties.features.map(f => [f.properties.name, f.geometry]));
}
function inside(geometry, lon, lat) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let hit = false;
  for (const poly of polys) {
    for (const ring of poly) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
      }
    }
  }
  return hit;
}
function generateWa() {
  const shapes = countyGeometry();
  // Park and Miller's generator: exact in doubles, the same numbers on every run.
  let seed = 20261012;
  const next = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const r5 = x => Math.round(x * 1e5) / 1e5;
  // A point well inside a county: it and the four points 0.03 degrees around it are inside.
  function pointIn(county) {
    const g = shapes.get(county);
    if (!g) throw new Error('No county ' + county);
    const rings = g.type === 'Polygon' ? [g.coordinates[0]] : g.coordinates.map(p => p[0]);
    const xs = rings.flat().map(c => c[0]);
    const ys = rings.flat().map(c => c[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    for (let k = 0; k < 10000; k++) {
      const lon = r5(x0 + next() * (x1 - x0));
      const lat = r5(y0 + next() * (y1 - y0));
      const d = 0.03;
      if ([[0, 0], [d, 0], [-d, 0], [0, d], [0, -d]].every(([dx, dy]) => inside(g, lon + dx, lat + dy))) {
        return [lat, lon];
      }
    }
    throw new Error('No place found in ' + county);
  }
  fs.mkdirSync(OUT_WA, { recursive: true });
  const written = [];
  for (const [key, plan] of Object.entries(PLAN_WA)) {
    const rows = plan.counties.map((county, i) => {
      const [lat, lon] = pointIn(county);
      return { name: plan.prefix + ' ' + (i + 1), lat, lon, geo: 'existing', city: '', county };
    });
    if (key === 'markets') {
      // The second Yakima market beside the first, in the same 0.12-degree cell (CVI's name-marker cells).
      const a = rows[0];
      const cell = v => Math.round(v / 0.12);
      let b = [r5(a.lat + 0.004), r5(a.lon + 0.004)];
      if (cell(b[0]) !== cell(a.lat) || cell(b[1]) !== cell(a.lon)) b = [r5(a.lat - 0.004), r5(a.lon - 0.004)];
      rows[1].lat = b[0];
      rows[1].lon = b[1];
      const town = pointIn('Kittitas');
      rows.push({ name: 'Synthetic Town Market A', lat: town[0], lon: town[1], geo: 'google_city', city: 'Synthetic Town',
        county: 'Kittitas' });
      rows.push({ name: 'Synthetic Town Market B', lat: town[0], lon: town[1], geo: 'google_city', city: 'Synthetic Town',
        county: 'Kittitas' });
      const lost = pointIn('Pacific');
      rows.push({ name: 'Synthetic Unplaced Market', lat: lost[0], lon: lost[1], geo: 'none', city: '', county: null });
      rows.push({ name: 'Synthetic Zero Market', lat: 0, lon: 0, geo: 'existing', city: '', county: null });
    }
    const header = [plan.nameColumn, 'lat', 'long', 'geo_source', 'city'].join(',');
    const lines = [header].concat(rows.map(r => [r.name, r.lat, r.lon, r.geo, r.city].map(field).join(',')));
    fs.writeFileSync(path.join(OUT_WA, plan.file), lines.join('\n') + '\n');
    written.push({ key, file: plan.file, rows: rows.length, points: rows });
  }
  return { dir: OUT_WA, written };
}

if (require.main === module) {
  const r = generate();
  r.written.forEach(w => console.log(w.key + ': ' + w.file + ' (' + w.rows + ' rows)'));
  const wa = generateWa();
  wa.written.forEach(w => console.log('statewide ' + w.key + ': ' + w.file + ' (' + w.rows + ' rows)'));
}
module.exports = { generate, LAYERS, OUT, generateWa, PLAN_WA, OUT_WA };
