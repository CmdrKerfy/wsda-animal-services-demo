#!/usr/bin/env node
'use strict';
// S11 spot mutations: changes to the distance, the ring choice, the endpoint rule, the count rules, the zone test and
// the facilities-inside filter must each fail a suite, and so must changes to the tab's rules and the page.
//
// Each mutant changes one exact piece of code in a temporary copy of the repository; the suite named for its group
// must then report failed checks. A suite that stops early does not count as catching it.
//   unit   site/shared/proximity.js and site/cvi/app/lookup.js, against the S11 unit suite
//   page   the Premise Lookup page (lookup.js, lookupmap.js, ui.js, icons.js), against the S11 Chrome suite's page part
//          (foreground only; run a few numbers at a time so a batch stays under 600 seconds)
//   day3   zones.js, lookup.js and lookupmap.js against the Chrome suite's part "day3" (foreground); the unit mutants
//          of zones, places, facilities inside and the CSVs are in the group "unit".
//   png    the branded proximity PNG (brandedmaps.js) and export_params.json's PNG fields, against the unit
//          suite (which compares the page with CVI's own page)
//   day4   the page's PNG controls, preview, export and population switches (lookup.js, lookupmap.js,
//          index.html) against the Chrome suite's part "day4" (foreground)
//   day5   Find coordinates and the geocode cache file on the page (lookup.js, index.html) against the
//          Chrome suite's part "day5" (foreground); the address rules' mutants are in the group "unit".
//
// Usage (repository root): node tests/mutation/run_s11_mutations.js unit|page|day3 [numbers ...]
//                          node tests/mutation/run_s11_mutations.js list   (groups: unit, page, day3, png, day4, day5)
// The unmutated suite runs first in the same copy and must pass. The copy is deleted at the end, and the
// repository's files are checked unchanged (SHA-256). Logs and a ledger: local-test-artifacts/s11/mutations/.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'local-test-artifacts', 's11', 'mutations');
const TEMP = path.join(ROOT, 'local-test-artifacts', 's11', 'mutation-copy-' + process.argv[2]);
const COPY = path.join(TEMP, 'platform');
const PX = 'site/shared/proximity.js', LK = 'site/cvi/app/lookup.js';
const LM = 'site/cvi/app/lookupmap.js', UI = 'site/cvi/app/ui.js', IC = 'site/cvi/app/icons.js';
const ZN = 'site/shared/zones.js', PN = 'site/shared/population.js', EX = 'site/cvi/app/exports.js';
const HT = 'site/cvi/index.html', BM = 'site/cvi/app/brandedmaps.js';

// [name, file, exact original text, replacement]
const GROUPS = {
  unit: [
    ['distance: the mean Earth radius (6,371,008.8 m) in place of geosphere\'s', PX,
      'const EARTH_RADIUS_M = 6378137;', 'const EARTH_RADIUS_M = 6371008.8;'],
    ['buffer edge (engine): a point on the radius left out', PX,
      'if (km !== null && km <= s.bufferKm) hits.push({ site: k, km });',
      'if (km !== null && km < s.bufferKm) hits.push({ site: k, km });'],
    ['buffer edge (CVI rules): an endpoint on the radius left out', LK,
      'const within = (d, k) => d !== null && d <= sites[k].bufferKm;',
      'const within = (d, k) => d !== null && d < sites[k].bufferKm;'],
    ['usable points: latitude 90 refused', PX,
      'Math.abs(lat) <= 90 && Math.abs(lon) <= 180;', 'Math.abs(lat) < 90 && Math.abs(lon) <= 180;'],
    ['ring choice: the ring above a match on its edge', PX, 'const enclosing = radii.filter(r => r >= km);',
      'const enclosing = radii.filter(r => r > km);'],
    ['ring choice: always the outer ring', PX,
      'return enclosing.length ? Math.min(...enclosing) : Math.max(...radii);', 'return Math.max(...radii);'],
    ['radius lists: not sorted', PX, 'return [...new Set(v)].sort((p, q) => p - q);', 'return [...new Set(v)];'],
    ['site buffers: a zero buffer kept as the site\'s own', PX,
      'const bufferUser = own === null || own <= 0 ? null : own;',
      'const bufferUser = own === null || own < 0 ? null : own;'],
    ['site rings: the global bands before the site\'s own', PX,
      'const radii = zone ? [0] : parseRadii(text) || global || [buffer];',
      'const radii = zone ? [0] : global || parseRadii(text) || [buffer];'],
    ['endpoint rule: origins counted on a destination search', LK,
      "const ho = sites.map((s, k) => endpoint !== 'dest' && within(dOrigin[i][k], k));",
      'const ho = sites.map((s, k) => within(dOrigin[i][k], k));'],
    ['rows CVI cannot check: either endpoint missing counts on an "either" search', LK,
      "endpoint === 'dest' ? !dests[i] : !origins[i] && !dests[i];",
      "endpoint === 'dest' ? !dests[i] : !origins[i] || !dests[i];"],
    ['nearest distance: the farther endpoint', LK,
      'return a === null ? b : b === null ? a : Math.min(a, b);',
      'return a === null ? b : b === null ? a : Math.max(a, b);'],
    ['count rules: origin points told apart by latitude only', LK,
      "return PX.usable(lat, lon) ? lat + ',' + lon : null;", 'return PX.usable(lat, lon) ? String(lat) : null;'],
    ['count rules: distinct CVIs counted once per direction', LK,
      'cvis: new Set(matched.map(r => (r.CVI === undefined ? null : r.CVI))).size,',
      'cvis: new Set(matched.map(r => r.Movement + (r.CVI === undefined ? null : r.CVI))).size,'],
    ['collapse (CVI\'s rule): any repeated row merged, not only within Washington', LK,
      "return !(isWa(r['Origin.State']) && isWa(r['Dest.State'])) || first;", 'return first;'],
    ['collapse (the page\'s rule): CVI\'s rule used for repeated WA-to-WA rows', LK,
      "if (rule === 'loader') return root.CVIWA.summary.dedupeVolume(list);", "if (rule === 'none') return list;"],
    ['filters: the quarter ignored', LK, "if (qt.size) sub = sub.filter(r => qt.has(r['Reporting.Quarter']));",
      'void qt;'],
    ['zone test: holes counted as inside', PX,
      'return polygons.some(rings => rings.reduce((k, ring) => (inRing(lon, lat, ring) ? !k : k), false));',
      'return polygons.some(rings => rings.some(ring => inRing(lon, lat, ring)));'],
    ['rounding: to one decimal', LK, 'return Number(x.toFixed(2));', 'return Number(x.toFixed(1));'],
    // The tab's rules.
    ['paste: a trailing empty piece kept (not R\'s strsplit)', LK,
      "if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();", 'void parts;'],
    ['paste: short lines not counted as skipped (CVI\'s count)', LK, 'shortLines++;', 'void shortLines;'],
    ['paste: one extra number taken as bands', LK, "bands_csv: extra.length >= 2 ? extra.join(',') : null",
      "bands_csv: extra.length >= 1 ? extra.join(',') : null"],
    ['upload: lon preferred over long', LK, "iLong = first(['long', 'lng', 'lon'])", "iLong = first(['lon', 'lng', 'long'])"],
    ['upload: a leading space not prefixed with X (make.names)', LK,
      "if (!/^([A-Za-z]|\\.(?![0-9]))/.test(s)) s = 'X' + s;", "if (!/^([A-Za-z ]|\\.(?![0-9]))/.test(s)) s = 'X' + s;"],
    ['bands: repeated radii allowed', LK, 'if (new Set(v).size < v.length) return', 'if (false) return'],
    ['bands: four radii allowed', LK, 'if (v.length > 3) return', 'if (v.length > 4) return'],
    ['add a site: latitude -90 refused', LK, 'if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {\n      return { message:',
      'if (Math.abs(lat) >= 90 || Math.abs(lon) > 180) {\n      return { message:'],
    ['add a site: an unnamed site numbered from 0', LK, "const name = typed !== '' ? typed : 'Site ' + (count + 1);",
      "const name = typed !== '' ? typed : 'Site ' + count;"],
    ['cell edit: the bands read as a number', LK, "if (field === 'name' || field === 'bands_csv') site[field] = String(text);",
      "if (field === 'name') site[field] = String(text);"],
    ['run: Single mode keeps the per-site bands', LK,
      'sites = sites.map(s => (s.zone ? { name: s.name, lat: s.lat, long: s.long, buffer_km: s.buffer_km, zone: s.zone }\n' +
      '        : { name: s.name, lat: s.lat, long: s.long, buffer_km: s.buffer_km }));', 'sites = sites.slice();'],
    ['run: no warning at 201 sites', LK, 'if (sites.length > MANY_SITES) {', 'if (sites.length > MANY_SITES + 1) {'],
    ['tiles: Total animals shows the CVIs', LK, "text: f(summary.animals), icon: 'stack'", "text: f(summary.cvis), icon: 'stack'"],
    ['table: nearest_site_km from the ring', LK, "nearest_site_km: 'nearestSiteKm'", "nearest_site_km: 'nearestBandKm'"],
    ['map: every band in the inner gray', LK, 'BAND_COLORS[Math.min(levels.indexOf(f.properties.bandKm), BAND_COLORS.length - 1)]',
      'BAND_COLORS[Math.min(levels.indexOf(f.properties.bandKm), 0)]'],
    ['map: origins drawn by the destination flag', LK, "const origins = ends('hitOrigin', 'Origin')",
      "const origins = ends('hitDest', 'Origin')"],
    ['rings: drawn on the mean Earth radius', PX, 'const d = (km * 1000) / EARTH_RADIUS_M;', 'const d = (km * 1000) / 6371008.8;'],
    ['rings: no hole in the outer bands', PX, 'if (i > 0) rings.push(circle(', 'if (i > 9) rings.push(circle('],
    ['messages: "No CVIs match the current filters." worded otherwise', LK, "messages.push({ level: 'warn', text: 'No CVIs match the current filters.' });",
      "messages.push({ level: 'warn', text: 'No CVI matches the current filters.' });"],
    // Zones, places, facilities inside, the CSVs.
    ['zones: a shapefile hole read as an outline (winding reversed)', ZN,
      'const outlines = clean.filter(r => signedArea(r) < 0).map(r =>', 'const outlines = clean.filter(r => signedArea(r) > 0).map(r =>'],
    ['zones: only the first part of a GeoJSON MultiPolygon', ZN, 'g.coordinates.forEach(c => {',
      'g.coordinates.slice(0, 1).forEach(c => {'],
    ['zones: a projected .prj accepted', ZN, "if (/^\\s*(PROJCS|PROJCRS|PROJECTEDCRS)\\s*\\[/i.test(t) || /PROJECTION\\s*\\[/i.test(t)) {",
      'if (false) {'],
    ['zones: any datum accepted (NAD 27 too)', ZN, 'if (WGS84.test(datum) || NAD83.test(datum)) return { ok: true };',
      'if (true) return { ok: true };'],
    ['zones: an unnamed zone numbered from 0', ZN, "String(z.name).trim() === '' ? 'Zone ' + (i + 1)",
      "String(z.name).trim() === '' ? 'Zone ' + i"],
    ['zones: the centroid kept even outside a bent zone', ZN, 'if (inside(c)) return c;', 'return c;'],
    ['zones (engine): a zone\'s ring is the buffer, not 0', PX, 'const radii = zone ? [0] : parseRadii(text) || global || [buffer];',
      'const radii = zone ? [buffer] : parseRadii(text) || global || [buffer];'],
    ['zones (engine): the box test uses the south edge for the north', PX, 'lon > b[2] || lat > b[3]))) return null;',
      'lon > b[2] || lat > b[1]))) return null;'],
    ['places: Census cities and towns used outside city limits', PN, 'const cdp = p.places.filter(isCdp).find(inside);',
      'const cdp = p.places.find(inside);'],
    ['places: outside Washington read as outside city limits', LK,
      "return inWashington ? 'Outside city limits' : 'Outside Washington';", "return 'Outside city limits';"],
    ['facilities: a facility at the edge left out (zones lose theirs)', LK, 'if (km === null || km > s.bufferKm) return;',
      'if (km === null || km >= s.bufferKm) return;'],
    ['facilities: every facility in the outer ring', LK, 'bandKm: PX.ringOf(s.radii, km),', 'bandKm: s.bufferKm,'],
    ['facilities: listed in file order, not nearest first', LK, 'found.sort((a, b) => a.exactKm - b.exactKm ||',
      'found.sort((a, b) => 0 ||'],
    ['facilities: distances not rounded', LK, 'exactKm: km, km: round2(km),', 'exactKm: km, km: km,'],
    ['map: zones in the second color', LK, 'innerKm: 0, outerKm: 0, bandKm: 0, color: BAND_COLORS[0] } }));',
      'innerKm: 0, outerKm: 0, bandKm: 0, color: BAND_COLORS[1] } }));'],
    ['map: a facility listed twice drawn twice', LK, '      if (seen.has(key)) return;\n', ''],
    ['run: a zone dropped in Single mode', LK, 'sites = sites.map(s => (s.zone ? {', 'sites = sites.map(s => (false ? {'],
    ['run: the master\'s check skipped for every run', LK, 'if (!input.master && !input.facilitiesOnly) return stop(',
      'if (false) return stop('],
    ['CSV: numbers to 7 significant digits', EX, 'const exp = Math.abs(x).toExponential(14);',
      'const exp = Math.abs(x).toExponential(6);'],
    ['CSV: text not quoted', EX, "if (type === 'character') return '\"' + String(v).replace(/\"/g, '\"\"') + '\"';",
      "if (type === 'character') return String(v);"],
    ['CSV: a missing value written empty', EX, "(v === '' && type !== 'character')) return 'NA';",
      "(v === '' && type !== 'character')) return '';"],
    ['CSV: the endpoint flags in the other order', EX,
      "[['.hit_origin', 'hitOrigin', 'logical'], ['.hit_dest', 'hitDest', 'logical'],",
      "[['.hit_dest', 'hitDest', 'logical'], ['.hit_origin', 'hitOrigin', 'logical'],"],
    ['export_params.json: the default buffer kept in Bands mode', EX,
      "default_buffer_km: p.mode === 'bands' ? null : p.defaultKm,", 'default_buffer_km: p.defaultKm,'],
    // Zone files' limits and edge cases, facility counts and the CSVs.
    ['the map box by a spread call again (a detailed zone overflows it)', LK,
      '    let bounds = null;\n    points.forEach(p => {', '    let bounds = null;\n    Math.min(...points.map(p => p[0]));\n    points.forEach(p => {'],
    ['a hole judged by its first corner only', ZN,
      'const holds = o => corners.filter(c => inRing(c[0], c[1], o.rings[0])).length * 2 > corners.length;',
      'const holds = o => inRing(corners[0][0], corners[0][1], o.rings[0]);'],
    ['a hole given to the largest outline holding it', ZN, '.sort((a, b) => a.area - b.area);',
      '.sort((a, b) => b.area - a.area);'],
    ['the centroid summed on absolute coordinates', ZN, 'const x0 = outline[0][0], y0 = outline[0][1];\n    let cx',
      'const x0 = 0, y0 = 0;\n    let cx'],
    ['a .dbf record length shorter than its fields accepted', ZN,
      'if (headerLength > bytes.length || recordLength < width) return null;', 'if (headerLength > bytes.length) return null;'],
    ['a file over 64 MB read anyway', ZN, 'if (file.size > LIMITS.maxBytes) {', 'if (false) {'],
    ['a .shp over 16 MB unpacked anyway', ZN, 'if (shp.size > LIMITS.maxShpBytes) {', 'if (false) {'],
    ['the point limit not counted while reading', ZN, 'if (tally.points > LIMITS.maxVertices) {', 'if (false) {'],
    ['NAD 1983 (2011) not recognized', ZN, 'const NAD83 = /North[ _]American[ _](Datum[ _])?1983|NAD[ _]?(19)?83/i;',
      'const NAD83 = /North[ _]American[ _](Datum[ _])?1983|NAD[ _]?83/i;'],
    ['WKT2 "World Geodetic System 1984" not recognized', ZN,
      'const WGS84 = /WGS[ _]?(19)?84|World[ _]Geodetic[ _]System[ _]1984/i;', 'const WGS84 = /WGS[ _]?(19)?84/i;'],
    ['the GeoJSON crs refusal off', ZN, 'if (crs && !LONLAT_CRS.test(String(crs))) {', 'if (false) {'],
    ['part starts not checked', ZN,
      'if (starts[0] !== 0 || starts.some((s, k) => k > 0 && s <= starts[k - 1]) || starts[parts - 1] >= points) {',
      'if (false) {'],
    ['the header\'s file length ignored', ZN,
      'const fileEnd = Math.min(bytes.length, Math.max(100, v.getInt32(24, false) * 2));', 'const fileEnd = bytes.length;'],
    ['no depth limit on collections', ZN, 'depth > LIMITS.maxDepth) return;', 'depth > 1e9) return;'],
    ['an outline with no area accepted', ZN, 'return distinct.size >= 3 && hasArea(ring) ? ring : null;',
      'return distinct.size >= 3 ? ring : null;'],
    ['a broken hole dropped (its area then inside)', ZN, 'return clean.every(Boolean) ? clean : null;',
      'return clean[0] ? clean.filter(Boolean) : null;'],
    ['the run\'s line counts listings, not facilities', LK, ").size;\n    return { level: 'ok', text: 'Found ' + k",
      ").size * 0 + fac.total;\n    return { level: 'ok', text: 'Found ' + k"],
    ['a site\'s own buffer written in Bands mode', EX, ": 'global bands')", ": s.buffer_km + ' km')"],
    ['Inf written as NA', EX, "/^\\+?Inf$/.test(t) ? Infinity", "false ? Infinity"],
    ['a .dbf name cut inside a letter not trimmed', ZN, '.decode(trimUtf8(b));', '.decode(b);'],
    // The address lookup's rules.
    ['address: case kept', LK, '    return trimR(s).toLowerCase();\n  }', '    return trimR(s);\n  }'],
    ['address: white space not joined', LK, "    s = s.replace(/[ \\t\\n\\v\\f\\r]+/g, ' ');", '    s = String(s);'],
    ['address: surrounding quotes kept', LK, ".replace(/^[\"']+|[\"']+$/g, '');", ".replace(/^$/g, '');"],
    ['address: the last usable row instead of the first', LK, 'const hit = cache.rows.find(r => r.key === key && coordOk(r.lat, r.long));',
      'const hit = cache.rows.findLast(r => r.key === key && coordOk(r.lat, r.long));'],
    ['address: a latitude up to 95 accepted', LK, 'lat !== null && lon !== null && Math.abs(lat) <= 90', 'lat !== null && lon !== null && Math.abs(lat) <= 95'],
    ['address: coordinates not rounded to 6 decimals', LK, 'const round6 = x => Number(x.toFixed(6));', 'const round6 = x => x;'],
    ['address: column names in any case', LK, "const iAddress = names.indexOf('address'), iLat = names.indexOf('lat'), iLong = names.indexOf('long');",
      "const low = names.map(x => x.toLowerCase()), iAddress = low.indexOf('address'), iLat = low.indexOf('lat'), iLong = low.indexOf('long');"],
    ['address: no "load a file" message without a file', LK, '    if (!cache) {\n      return { message: { level: \'warn\', text: \'Load a geocode',
      '    if (false) {\n      return { message: { level: \'warn\', text: \'Load a geocode'],
    // Spread calls, the name placer, cutting names, zone limits and the CSVs.
    ['outline bounds by spreading the list', ZN, '    let south = Infinity, north = -Infinity;\n    for (const q of outline) {\n      if (q[1] < south) south = q[1];\n      if (q[1] > north) north = q[1];\n    }',
      '    const ys = outline.map(p => p[1]);\n    let south = Math.min(...ys), north = Math.max(...ys);'],
    ['facilities pushed by spreading the list', LK, 'found.forEach(x => rows.push(x));', 'rows.push(...found);'],
    ['the placer ignores its wide items', 'site/shared/labels.js', '        if (wide.some(item => test(item.v))) return true;', '        if (false) return true;'],
    ['the placer files each item in its first cell only', 'site/shared/labels.js',
      'const span = (a, b) => [Math.floor(a / size), Math.floor(b / size)];', 'const span = (a, b) => [Math.floor(a / size), Math.floor(a / size)];'],
    ['the halving cut one character short', BM, '      else hi = mid - 1;\n    }\n    return lo;', '      else hi = mid - 1;\n    }\n    return Math.max(0, lo - 1);'],
    ['a name that fits is cut anyway', BM, '    if (fits(n)) return n;\n    let lo = 0, hi = n - 1;', '    if (false) return n;\n    let lo = 0, hi = n - 1;'],
    ['the box test never meets', ZN, 'const meets = o => o.box.x0 <= hb.x1 &&', 'const meets = o => o.box.x0 > hb.x1 &&'],
    ['a .prj unpacked whatever its size', ZN, "      tooBig(prj, LIMITS.maxPrjBytes, '.prj');\n", ''],
    ['formula-like text written as it is', EX, "const asText = v => (typeof v === 'string' && /^[=+\\-@\\t\\r]/.test(v) ? \"'\" + v : v);", 'const asText = v => v;'],
    ['blank lines counted', LK, 'const rows = parsed.rows.filter(r => !blank(r)).map(', 'const rows = parsed.rows.map('],
    ['a UTF-16 file not refused for its encoding', LK, "    if (raw.indexOf('\\u0000') >= 0) {", '    if (false) {'],
    ['a facility listed twice counted twice', LK, "const distinct = new Set(found.map(r => r.lat + '\\r' + r.lon + '\\r' + r.name)).size;",
      'const distinct = found.length;'],
    ['bidirectional controls kept', 'site/shared/branded.js', '\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]/g', ']/g']
  ],
  page: [
    ['switch: the maps stay shown with Premise Lookup', UI, "$('maps-main').hidden = lookup;", "$('maps-main').hidden = false;"],
    ['Run query: not grayed without premises coordinates', LK, 'if (missing.length) reason = COORD_REASON(missing);',
      'if (false) reason = COORD_REASON(missing);'],
    ['filters: no year ticked when a master loads', LK, 'ps.years = ps.yearChoices.slice();   // CVI', 'ps.years = [];   // CVI'],
    ['cell edit: Escape keeps the edit', LK, "if (e.key === 'Escape') { e.preventDefault(); finish(false); }",
      "if (e.key === 'Escape') { e.preventDefault(); finish(true); }"],
    ['remove: every row removed', LK, 'ps.sites = ps.sites.filter(s => !ps.selected.has(s.uid));', 'ps.sites = [];'],
    ['sites table: 10 rows a page', LK, 'const SITES_PAGE = 8, TABLE_PAGE = 10;', 'const SITES_PAGE = 10, TABLE_PAGE = 10;'],
    ['no filter match: the result shown before kept', LK,
      "      messages.push({ level: 'warn', text: 'No CVIs match the current filters.' });\n      return { messages, keep: 'clear' };",
      "      messages.push({ level: 'warn', text: 'No CVIs match the current filters.' });\n      return { messages, keep: 'previous' };"],
    ['messages: the result\'s lines before the run\'s own', LK, 'sayRun(plan.messages.concat(after.messages, fac ?',
      'sayRun(after.messages.concat(plan.messages, fac ?'],
    ['map: the fit margin under the buttons', LM, 'padding: FIT_PADDING, animate: false', 'padding: 24, animate: false'],
    ['map: county names never hidden', LM, "el.classList.add('covered');", 'void el;'],
    ['table: opens unsorted', LK, "ps.table = { search: '', sortColumn: 0, descending: false, page: 0 };\n      renderTable();",
      "ps.table = { search: '', sortColumn: null, descending: false, page: 0 };\n      renderTable();"],
    ['new master: the result stays', LK, '      if (ps.result) {\n        showResult(null);', '      if (false) {\n        showResult(null);'],
    ['map: the hover shows no text', LM, 'tip.setLngLat(e.lngLat).setHTML(esc(f.properties.label)).addTo(map);',
      "tip.setLngLat(e.lngLat).setHTML('').addTo(map);"],
    ['tiles: an icon missing from icons.js', IC, '    "geo": "<svg', '    "geo-x": "<svg'],
    ['result area: no reason while Run query is grayed', LK,
      "const emptyNote = () => (ps.runReason && !ps.facilitiesOnly ? 'Run query is grayed: ' + ps.runReason : EMPTY_NOTE);",
      'const emptyNote = () => EMPTY_NOTE;'],
    ['select: the table rebuilt on a click (no double-click in Safari)', LK,
      "      const tr = $('lk-sites').querySelector('tr[data-uid=\"' + uid + '\"]');\n      if (!tr) return;",
      "      renderSites();\n      const tr = $('lk-sites').querySelector('tr[data-uid=\"' + uid + '\"]');\n      if (!tr) return;"],
    ['edit: a second click on the cell does not open it (only a double-click)', LK,
      '          secondClick(e, site);\n', ''],
    ['file pick: no watch after a click (a pick with no event is lost)', UI,
      "watch = root.setInterval(() => { if (Date.now() > until) stop(); else take(); }, WATCH_EVERY_MS);", 'void until;'],
    ['file pick: the "input" event not read', UI, "    input.addEventListener('input', take);\n", ''],
    ['run lines: written under Run query instead of the result area', LK, "      say($('lk-run-lines'), messages);\n",
      "      say($('lk-run-reason'), messages);\n"],
    ['rings: CVI\'s fill again', LM, "'fill-opacity': 0.35", "'fill-opacity': 0.22"],
    ['rings: the outer two colors swapped', LK, "['#fcb614', '#8fc965', '#a7d7e2']", "['#fcb614', '#a7d7e2', '#8fc965']"],
    ['file pick: the picker not emptied after a pick', UI, "      stop();\n      input.value = '';\n      onFile(f);", "      stop();\n      onFile(f);"]
  ],
  // The branded proximity PNG, against the unit suite.
  png: [
    ['rings: CVI\'s grays in place of the page\'s ring colors', BM,
      "const PROX_RING = ['#fcb614', '#8fc965', '#a7d7e2'];", "const PROX_RING = ['#7d858d', '#9aa3ab', '#bfc5cb'];"],
    ['map box: 5% around the buffers', BM, 'const padX = (b.east - b.west) * 0.10;', 'const padX = (b.east - b.west) * 0.05;'],
    ['map box: no least span', BM, 'const MIN_SPAN = 0.15;', 'const MIN_SPAN = 0.01;'],
    ['panel (CVI\'s style): ten rows before "+N more"', BM, 'rows.some(r => r.label) ? 9 : 12;', 'rows.some(r => r.label) ? 9 : 10;'],
    ['panel: a long name not shrunk', BM, 'nmSize = 3.1 * scl * Math.max(0.50, maxNm / chars.length);', 'nmSize = 3.1 * scl;'],
    ['panel: the county cut one letter later', BM,
      "cty = Array.from(cty).slice(0, maxCty - 2).join('') + '..';", "cty = Array.from(cty).slice(0, maxCty - 1).join('') + '..';"],
    ['panel: origins and destinations always on the subline', BM, 'odRight: !km });', 'odRight: true });'],
    ['bands: different bands not noticed', BM, 'new Set(keys.filter(k => k)).size > 1;', 'new Set(keys.filter(k => k)).size > 2;'],
    ['key: CVI\'s "Middle zone" renamed', BM, "['Inner zone', 'Middle zone', 'Outer zone']", "['Inner zone', 'Mid zone', 'Outer zone']"],
    ['key: origins counted in the singular', BM, "label: 'Matched origins: ' + S().comma(o.origins)",
      "label: 'Matched origin: ' + S().comma(o.origins)"],
    ['map: every matched row\'s origin drawn, inside a buffer or not', BM, "const originPts = only ? [] : ends('hitOrigin', 'Origin');",
      "const originPts = only ? [] : ends('CVI', 'Origin');"],
    ['title: SITE and SITES swapped', BM, "nSites === 1 ? ' SITE' : ' SITES'", "nSites > 1 ? ' SITE' : ' SITES'"],
    ['period: CY row without a year picked', BM, ': f.year && f.year.length ? periodParts(', ': f.year ? periodParts('],
    ['facilities only: every site counted with hits', BM, "S().comma(fac ? fac.counts.filter(c => c.total > 0).length : 0)",
      'S().comma(fac ? fac.counts.length : 0)'],
    ['facility names printed with labels off', BM, '    if (input.labels) {\n      for (const l of facilities) {',
      '    if (true) {\n      for (const l of facilities) {'],
    ['key (CVI\'s style): rows 0.13 apart', BM, "if (i > 0) at -= 0.135 + (it.type === 'subheader' ? 0.06 : 0);",
      "if (i > 0) at -= 0.13 + (it.type === 'subheader' ? 0.06 : 0);"],
    ['panel: the site\'s county with latitude and longitude swapped', BM, 'PX.inZone(site.lon, site.lat, f.geometry)',
      'PX.inZone(site.lat, site.lon, f.geometry)'],
    ['site names centered on their markers (CVI\'s place)', BM, 'const sitePlaces = style.darkNames ? LB.place(',
      'const sitePlaces = false ? LB.place('],
    ['population: every place named on a wide map', BM, 'min: viewKm < PROX_NAMES_KM ? 0 : 10000', 'min: 0'],
    ['export_params.json: no PNG resolution', EX, '      o.png_resolution = p.png.resolution;\n', ''],
    // The site panel, the inset and the key.
    ['panel: 12 sites listed', BM, 'const PANEL_ROWS = 8;', 'const PANEL_ROWS = 12;'],
    ['panel: sites in table order', BM, 'if (page) order.sort(', 'if (false) order.sort('],
    ['panel: a long name not cut to the column', BM, 'if (BR.textWidth(nm, pt, true) > room) {', 'if (false) {'],
    ['panel: the note says nothing about the ranking', BM, "' not listed (ranked by ' +", "' not listed (' +"],
    ['inset: sites outside its Washington frame drawn', BM, 'const marks = sites.map(s => fit.project(s.lon, s.lat)).filter(inside);',
      'const marks = sites.map(s => fit.project(s.lon, s.lat));'],
    ['inset: always the bottom right', BM, 'const pick = scored.find(c => c.covers === 0) ||', 'const pick = scored[0] ||'],
    ['key: rows spread over CVI\'s height', BM, 'key = proximityKeyColumn(items, lgY, 0, panelY - 0.008 - lgY, popRows);',
      'key = proximityKeyColumn(items, lgY, lgH, panelY - 0.008 - lgY, popRows);'],
    // Long key labels, Satellite names, facilities over sites and county pages.
    ['key: a long label not wrapped', BM, '    if (BR.textWidth(label, pt) <= room) return label;', '    return label;'],
    ['Satellite: dark site names', BM, "const lightNames = !!bg && bg.theme === 'satellite';", 'const lightNames = false;'],
    ['facilities drawn under the sites again', BM,
      "    siteMarks.forEach(m => mapParts.push(siteMark(m.x, m.y, 6.0, 1.0)));\n" +
      "    // The facilities over the sites: a facility at a site shows as a mark over its bullseye.\n" +
      "    for (const l of facilities) {\n" +
      "      for (const q of l.points) mapParts.push(BR.circle(q.x, q.y, 3.0, 0.5, l.color, 1, '#ffffff', l.shape));\n" +
      "    }",
      "    for (const l of facilities) {\n" +
      "      for (const q of l.points) mapParts.push(BR.circle(q.x, q.y, 3.0, 0.5, l.color, 1, '#ffffff', l.shape));\n" +
      "    }\n" +
      "    siteMarks.forEach(m => mapParts.push(siteMark(m.x, m.y, 6.0, 1.0)));"],
    ['county page: the frame not grown to the rings', BM,
      '      fb.west = Math.min(fb.west, rb.west + pad.x);\n      fb.east = Math.max(fb.east, rb.east - pad.x);\n' +
      '      fb.south = Math.min(fb.south, rb.south + pad.y);\n      fb.north = Math.max(fb.north, rb.north - pad.y);', ''],
    ['export_params.json: no county pages', EX, '      if (p.countyPages && p.countyPages.length) o.county_pngs = p.countyPages;', ''],
    ['panel: county names cut by their letter count again', BM,
      'if (!page && cty && Array.from(cty).length > maxCty)', 'if (cty && Array.from(cty).length > maxCty)']
  ],
  day4: [
    ['legend: no population block', LK, '      W.lookupmap.setPopulationLegend(ps.map, PN.legendEntries(on, PN.DEFAULT_RAMP));\n', ''],
    ['PNG: population layers left out', LK, 'population: pcAny(pcDrawn()) ? { on: pcDrawn(), ramp: PN.DEFAULT_RAMP } : null };',
      'population: null };'],
    ['PNG: Show facility labels ignored', LK, "labels: $('lk-png-labels').checked,", 'labels: false,'],
    ['PNG: Default background first', HT, '<option value="standard">Default (flat WSDA)</option>',
      '<option value="standard" selected>Default (flat WSDA)</option>'],
    ['PNG: a background that cannot load kept', LK, "          built = pngBuild(res, fac, choices, 'standard', null, now, area);\n", ''],
    ['export: the PNG not written into the ZIP', LK,
      'for (const pic of made.pictures) files.push({ name: pic.name, data: new Uint8Array(await pic.blob.arrayBuffer()) });', ''],
    ['PNG: no facilities', LK, 'const main = await pngPage(res, ps.facResult, choices, now, choices.background);',
      'const main = await pngPage(res, null, choices, now, choices.background);'],
    ['PNG: the Streets data path wrong', LK, "host.loadScript('../geo/streets-wa.js')", "host.loadScript('../geo/streets.js')"],
    ['export: Branded map (.png) not ticked', HT, 'value="branded_png" checked>', 'value="branded_png">'],
    ['export quality always hidden', LK, "$('lk-png-quality-field').hidden = !root.WSDA.tiles.BACKGROUNDS[$('lk-png-background').value];",
      "$('lk-png-quality-field').hidden = true;"],
    ['population: the switches drive the Maps side\'s state', LK,
      "    $('lk-pc-block').addEventListener('change', e => {", "    $('pc-block').addEventListener('change', e => {"],
    ['match map: population not drawn', LK, '      W.map.setPopulation(ps.map, { on, ramp: PN.DEFAULT_RAMP, names: pcNames() });\n', ''],
    // Population switches, the live basemap, county pages and the export buttons.
    ['population: off when the page opens again', LK, 'ps.pc = { on: { cities: true, places: true, density: true }, missing: {} };',
      'ps.pc = { on: { cities: false, places: false, density: false }, missing: {} };'],
    ['live basemap: the choice not applied', LK, '      W.map.setBasemap(ps.map, b);\n', ''],
    ['county pages: never written', LK, '      if (choices.counties) {\n        for (const c of countyRuns(res)) {',
      '      if (false) {\n        for (const c of countyRuns(res)) {'],
    ['county pages: every site on each page', LK, '        if (!groups.has(c)) groups.set(c, []);\n        groups.get(c).push(site);',
      '        if (!groups.has(c)) groups.set(c, ps.runSites.slice());'],
    ['Export buttons: the margin back', HT, '  .lk-export-buttons .btn.export-btn { margin-top: 0; }', ''],
    ['live map: population names under the legend kept', LM, '    st.labels.concat(st.pcLabels || []).forEach(m => {',
      '    st.labels.forEach(m => {']
  ],
  day3: [
    ['KML: the inner boundaries (holes) dropped', ZN,
      "const holes = childByName(poly, 'innerBoundaryIs').map(b => kmlRing(b, name, tally));", 'const holes = [];'],
    ['zone rows: the point and "Zone" cells editable', LK, 'const fixed = !!site.zone && j > 0;', 'const fixed = false;'],
    ['Place column: never filled in', LK, "if (ps.places !== 'ready') return '…';", "if (true) return '…';"],
    ['facility layers: none ticked when the files arrive', LK, '!ps.facInitialized && usable);', 'false);'],
    ['Run query: no facilities-only run without a usable master', LK,
      'const facilitiesOnly = !!reason && !host.loading() && checkedLayers().length > 0;', 'const facilitiesOnly = false;'],
    ['Pick on map: latitude and longitude swapped', LK, "$('lk-new-lat').value = String(la);", "$('lk-new-lat').value = String(lo);"],
    ['Pick on map: Add site does not end picking', LK, '        if (ps.picking) setPicking(false);\n', ''],
    ['Pick on map: Escape does not end picking', LK, "if (e.key === 'Escape' && ps.picking && ps.shown && !inBox) setPicking(false);",
      'void e;'],
    ['legend: no rings', LM, 'if (l.rings && l.rings.length) {', 'if (false) {'],
    ['legend: not in the screenshot', LM, 'capture: (st, g, k) => captureLegend(st, g, k)', 'capture: () => null'],
    ['legend: county names under it kept', LM, 'const underLegend = legend && legend.x0 < x1',
      'const underLegend = false && legend.x0 < x1'],
    ['map: no hover on the facilities', LM, "const POINT_LAYERS = ['lookup_fac', 'lookup_sites',", "const POINT_LAYERS = ['lookup_sites',"],
    ['export: the matched rows written as the Maps side\'s file (fwrite)', LK,
      'const m = EX().lookupMatchesCsv(host.master(), res);', 'const m = EX().filteredRowsCsv(host.master(), res.matched);'],
    ['export: the matched-rows box open with no CVI match', LK, "formatBox('matches_csv').disabled = noCvi;",
      "formatBox('matches_csv').disabled = false;"],
    ['result area: a hidden part shown by its own style (the tiles\' grid)', HT,
      '  #lookup-main [hidden] { display: none !important; }', '  #lookup-main .x-none { display: none; }'],
    ['facilities: the counts table without its sideways scroll', HT,
      '  .lk-fac-scroll { overflow-x: auto; margin-bottom: 0.6rem; }', '  .lk-fac-scroll { margin-bottom: 0.6rem; }']    ,
    // Facilities with no CVI match, and picking on the map.
    ['no facilities when the filters match no CVI', LK, "else if (after.keep === 'clear' && fac) {",
      "else if (false) {"],
    ['Escape inside a text box ends picking', LK, '&& ps.shown && !inBox) setPicking(false);', '&& ps.shown) setPicking(false);'],
    ['a pick on another copy of the world not wrapped', LK, 'lo = Number(wrapped.toFixed(5));', 'lo = Number(lon.toFixed(5));'],
    ['a facilities-only run while a master loads', LK, 'const facilitiesOnly = !!reason && !host.loading() && checkedLayers().length > 0;',
      'const facilitiesOnly = !!reason && checkedLayers().length > 0;']
  ],
  day5: [
    ['Add site keeps the address', LK, "['lk-new-name', 'lk-new-address', 'lk-new-lat',", "['lk-new-name', 'lk-new-lat',"],
    ['Add site keeps the address message', LK, "        say($('lk-geo-msg'), []);\n", ''],
    ['a refused file drops the one before', LK, "        const r = parseGeocodeCache(String(reader.result), f.name);\n        if (!r.rows) {",
      "        const r = parseGeocodeCache(String(reader.result), f.name);\n        ps.geocache = r.rows ? r : null;\n        if (!r.rows) {"],
    ['Find coordinates puts the latitude in Longitude', LK, "$('lk-new-long').value = String(r.long);", "$('lk-new-long').value = String(r.lat);"],
    ['the address box and button on two rows', HT, '  .lk-address { display: flex;', '  .lk-address { display: block;'],
    // The geocode cache file, the address box and export_params.json.
    ['no size limit on the cache file', LK, '      if (f.size > GEOCACHE_MAX_BYTES) {', '      if (false) {'],
    ['an older pick may win', LK, '        if (pick !== ps.geocachePick) return;   // a later pick replaced this one', '        void pick;'],
    ['Find during a read says nothing of it', LK, '      if (ps.geocacheReading) {', '      if (false) {'],
    ['spell check on in the address box', HT, 'id="lk-new-address" spellcheck="false" autocomplete="off"', 'id="lk-new-address"'],
    ['export_params.json from the table as it is now', LK, 'ps.runTable = res && ps.nextRun ? ps.nextRun.table : null;', 'ps.runTable = ps.sites;']
  ]
};

const ARTIFACTS = ['local-test-artifacts/f1/tiers', 'local-test-artifacts/s11/fixtures',
  'local-test-artifacts/s11/oracle_s11.json', 'local-test-artifacts/s11/oracle_s11_png.json'];

const mode = process.argv[2];
const picks = process.argv.slice(3).map(Number);
if (mode === 'list') {
  Object.keys(GROUPS).forEach(g => GROUPS[g].forEach((m, i) => console.log(g + ' ' + (i + 1) + '. ' + m[0] + ' (' + m[1] + ')')));
  process.exit(0);
}
if (!GROUPS[mode] || picks.some(n => !Number.isInteger(n) || n < 1 || n > GROUPS[mode].length)) {
  throw new Error('Use: <unit|page|day3|png|day4|day5> [numbers ...] | list');
}
const list = GROUPS[mode].map((m, i) => ({ n: i + 1, name: m[0], file: m[1], from: m[2], to: m[3] }))
  .filter(m => !picks.length || picks.includes(m.n));

const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const files = [...new Set(list.map(m => m.file))];
const before = Object.fromEntries(files.map(f => [f, sha(path.join(ROOT, f))]));

// One run of the group's suite in the copy: the summary line, the failed checks and whether it stopped early.
function runSuite(label) {
  const started = Date.now();
  const suite = mode === 'page' ? ['tests/browser/run_s11_browser.js', 'page']
    : mode === 'day3' ? ['tests/browser/run_s11_browser.js', 'day3']
      : mode === 'day4' ? ['tests/browser/run_s11_browser.js', 'day4']
        : mode === 'day5' ? ['tests/browser/run_s11_browser.js', 'day5'] : ['tests/node/run_s11_unit_tests.js'];
  const r = cp.spawnSync(process.execPath, suite, { cwd: COPY, encoding: 'utf8',
    maxBuffer: 64 << 20, timeout: 5 * 60000, killSignal: 'SIGINT' });
  const output = (r.stdout || '') + (r.stderr || '');
  fs.writeFileSync(path.join(OUT, mode + '-' + label + '.log'), output);
  const m = output.match(/(\d+) passed, (\d+) failed\s*$/);
  const fails = output.split('\n').filter(l => /^\s*FAIL /.test(l));
  return { status: r.status, passed: m ? Number(m[1]) : null, failed: m ? Number(m[2]) : null,
    crashed: !m || r.signal !== null, firstFails: fails.slice(0, 4).map(l => l.slice(0, 200)),
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
    console.log(m.n + '. ' + (ok ? 'caught' : r.crashed ? 'STOPPED (not counted)' : 'MISSED') + ': ' + m.name + ' (' +
      r.passed + ' passed, ' + r.failed + ' failed, ' + r.seconds + ' s)');
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
