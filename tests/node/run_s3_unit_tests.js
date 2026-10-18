#!/usr/bin/env node
'use strict';
// S3 unit tests (opt-in tile basemaps): site/cvi/app/basemaps.js against CVI's own basemap list, raster style
// builder and label/boundary contrast rule (local-test-artifacts/s3/oracle_s3_basemaps.json, written by
// tests/oracle/cvi_r_oracle.R), the page's CSP, and the host gate the map applies to every request.
// Usage (repository root): node tests/node/run_s3_unit_tests.js      (Node >= 22; no packages; run the R oracle first)
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '..', '..');
const SB = { console, URL };
vm.createContext(SB);
// shared/release.js first, as on the pages: in a public copy (phase B) the list offered is the cleared basemaps only.
vm.runInContext(fs.readFileSync(path.join(ROOT, 'site', 'shared', 'release.js'), 'utf8'), SB, { filename: 'release.js' });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'site', 'cvi', 'app', 'basemaps.js'), 'utf8'), SB, { filename: 'basemaps.js' });
const B = SB.CVIWA.basemaps;
const plain = x => JSON.parse(JSON.stringify(x));   // out of the vm context, for deep comparison
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let pass = 0, fail = 0; const failures = [];
const check = (ok, name, detail) => { if (ok) pass++; else { fail++; failures.push(name + (detail !== undefined ? ' :: ' + JSON.stringify(detail).slice(0, 500) : '')); } };

const oracleFile = path.join(ROOT, 'local-test-artifacts', 's3', 'oracle_s3_basemaps.json');
if (!fs.existsSync(oracleFile)) { console.error('S3 oracle missing: run Rscript tests/oracle/cvi_r_oracle.R first'); process.exit(2); }
const O = JSON.parse(fs.readFileSync(oracleFile, 'utf8'));

// 1. The list itself: ids, groups, addresses, hosts, flags.
// L: every basemap built (compared with CVI's list); OFFERED: those this copy offers (all of them, or in a public copy
// the cleared ones), which the picker, hosts() and the CSP follow.
const L = plain(B.ALL);
const OFFERED = plain(B.LIST);
// A basemap by id from every one built (B.get() knows only those offered, so in a public copy not CARTO's or Esri's).
const anyOf = id => B.ALL.find(b => b.id === id);
check(new Set(L.map(b => b.id)).size === L.length && L.every(b => /^[a-z0-9-]+$/.test(b.id) && b.id !== B.OFFLINE), 'ids unique and plain', L.map(b => b.id));
check(same(plain(B.GROUPS), [...new Set(O.choices.map(c => c.group))]), 'groups are CVI\'s, in CVI\'s order', { page: B.GROUPS, cvi: O.choices.map(c => c.group) });
L.forEach(b => {
  const addr = b.type === 'raster' ? b.tiles : b.style, u = new URL(addr.replace(/[{}]/g, '_'));
  check(B.GROUPS.indexOf(b.group) >= 0 && b.name && b.provider && b.attribution && typeof b.dark === 'boolean' && typeof b.publish === 'boolean',
    b.id + ': group, name, provider, attribution and flags present', b);
  // A raster basemap uses its tile address's host only; a vector one its style's host and the hosts its style names
  // (CARTO: tiles, sprites and fonts on tiles.basemaps.cartocdn.com, tiles on tiles-a…d; checked live).
  const sameSite = h => h === u.hostname || h.endsWith('.' + u.hostname.split('.').slice(-2).join('.'));
  check(u.protocol === 'https:' && (b.type === 'raster' ? same(b.hosts, [u.hostname]) : b.hosts[0] === u.hostname || b.hosts.indexOf(u.hostname) >= 0) && b.hosts.every(sameSite),
    b.id + ': https; its hosts are its address\'s host (and, for a vector style, that provider\'s own hosts)', { addr, hosts: b.hosts });
  if (b.type === 'raster') check(/\{z\}/.test(b.tiles) && /\{x\}/.test(b.tiles) && /\{y\}/.test(b.tiles) && Number.isInteger(b.maxZoom) && b.maxZoom > 0 && b.maxZoom <= 22,
    b.id + ': raster tile address with {z}/{x}/{y} and a max zoom', b);
  else check(b.type === 'vector' && !b.tiles && !b.maxZoom, b.id + ': vector style address only', b);
});

// 2. Entries from CVI's list: same group, label and address as CVI (.basemap_choices(); raster from .RASTER_BASEMAPS).
const fromCvi = L.filter(b => b.cvi);
fromCvi.forEach(b => {
  const c = O.choices.find(x => x.value === b.cvi);
  const label = B.RENAMED[b.cvi] || b.name;
  check(!!c && c.group === b.group && c.label === label, b.id + ': CVI\'s group and label for ' + b.cvi + (B.RENAMED[b.cvi] ? ' (renamed: ' + b.name + ')' : ''), { page: [b.group, b.name], cvi: c });
  if (b.type === 'vector') check(b.style === b.cvi, b.id + ': CVI\'s style address', b.style);
  else {
    const r = O.raster.find(x => x.key === b.cvi), src = r && r.style.sources['raster-source'];
    check(!!src && src.tiles[0] === b.tiles && src.maxzoom === b.maxZoom && src.attribution === b.attribution,
      b.id + ': CVI\'s tile address, max zoom and attribution', { page: [b.tiles, b.maxZoom, b.attribution], cvi: src });
    check(same(plain(B.rasterStyle(b)), r.style), b.id + ': the whole raster style equals CVI\'s', { page: B.rasterStyle(b), cvi: r.style });
  }
});
const cviIds = new Set(fromCvi.map(b => b.cvi));
const notBuilt = O.choices.filter(c => !cviIds.has(c.value)).map(c => c.label);
check(!fromCvi.some(b => b.cvi === 'https://demotiles.maplibre.org/style.json') && same(notBuilt, ['MapLibre Demo']),
  'every CVI basemap built except MapLibre Demo (deliberate difference)', notBuilt);
check(same(Object.keys(plain(B.RENAMED)).sort(), ['raster:esri_physical', 'raster:opentopo']) && Object.keys(B.RENAMED).every(k => /PNG/.test(B.RENAMED[k])),
  'only the two CVI labels that speak of CVI\'s PNG export are renamed', plain(B.RENAMED));
// The agreed additions: OpenFreeMap Dark, USGS x5, WSDOT; and nothing else.
const additions = L.filter(b => !b.cvi);
check(same(additions.map(b => b.id).sort(), ['ofm-dark', 'usgs-hydro', 'usgs-imagery', 'usgs-imagery-topo', 'usgs-relief', 'usgs-topo', 'wsdot']),
  'additions: OpenFreeMap Dark, USGS x5, WSDOT', additions.map(b => b.id));
check(L.length === 23, '23 basemaps in all', L.length);
// Held back from any public copy: CARTO and Esri (terms); the rest cleared (WSDOT included).
check(L.every(b => b.publish === !(b.provider === 'CARTO' || b.provider === 'Esri')), 'held back: CARTO and Esri; the rest cleared (WSDOT included)',
  L.filter(b => b.publish).map(b => b.id));
check(same(L.filter(b => /retire/.test(b.note || '')).map(b => b.id).sort(), ['esri-physical', 'esri-relief']), 'the two Esri basemaps on Esri\'s retirement list are marked');

// 3. The raster style builder is CVI's .make_raster_style().
const probe = { tiles: O.probe.tiles, attribution: O.probe.attribution, maxZoom: O.probe.max_zoom, hosts: ['example.invalid'] };
check(same(plain(B.rasterStyle(probe)), O.probe_style), 'rasterStyle() equals CVI\'s .make_raster_style() on a probe', { page: B.rasterStyle(probe), cvi: O.probe_style });
// style(): CVI's raster style with the stretch past the max zoom (a deliberate difference):
// the raster layer has no max zoom; the source keeps CVI's max zoom, so nothing is asked for beyond it.
L.filter(b => b.type === 'raster').forEach(b => {
  const want = plain(B.rasterStyle(b)); delete want.layers[1].maxzoom;
  if (b.minZoom) want.sources['raster-source'].minzoom = b.minZoom;
  if (b.bounds) want.sources['raster-source'].bounds = b.bounds;
  const got = plain(B.style(b));
  check(same(got, want) && got.sources['raster-source'].maxzoom === b.maxZoom && !('maxzoom' in got.layers[1]),
    b.id + ': style() = CVI\'s raster style, last tiles stretched past max zoom ' + b.maxZoom, { got, want });
});
check(same(plain(B.rasterStyle(B.get('usgs-topo'))).layers[1].maxzoom, 16), 'rasterStyle() itself stays CVI\'s (layer ends at the max zoom)');
// Coverage boxes (only WSDOT): around Washington, with Portland and Vancouver BC inside (live check: tiles there) and
// Boise and Denver outside (404 there).
{
  const inBox = (bx, lon, lat) => lon >= bx[0] && lon <= bx[2] && lat >= bx[1] && lat <= bx[3];
  const bx = B.get('wsdot').bounds;
  check(same(L.filter(b => b.bounds).map(b => b.id), ['wsdot']) && inBox(bx, -124.85, 48.38) && inBox(bx, -116.92, 46.0) && inBox(bx, -122.68, 45.52)
    && inBox(bx, -123.1, 49.28) && !inBox(bx, -116.2, 43.6) && !inBox(bx, -104.99, 39.74), 'WSDOT coverage box: Washington, Portland, Vancouver BC in; Boise, Denver out', bx);
}
L.filter(b => b.type === 'vector').forEach(b => check(B.style(b) === b.style, b.id + ': style() gives the style address'));

// 3b. Label/boundary contrast against CVI's .resolve_label_boundary_style (every style pair, every basemap value).
const addrOf = b => b.cvi || (b.type === 'raster' ? b.tiles : b.style);
additions.forEach(b => check(O.additions.indexOf(addrOf(b)) >= 0, b.id + ': its address is among the oracle\'s addition values', addrOf(b)));
const cviDark = v => { const c = O.contrast.find(x => x.basemap === v && x.label_style === 'auto' && x.boundary_style === 'auto'); return c ? c.label_color === '#f0f0f0' : null; };
const hex = c => (c === 'white' ? '#ffffff' : c);   // CVI writes the dark-text halo as "white"
let cbad = [];
O.contrast.forEach(c => {
  const got = plain(B.contrast(c.label_style, c.boundary_style, cviDark(c.basemap)));
  if (!same(got, { label: c.label_color, halo: hex(c.label_fill), line: c.boundary_color })) cbad.push({ c, got });
});
check(O.contrast.length === 216 && cbad.length === 0, 'contrast(): CVI\'s colors for all ' + O.contrast.length + ' cases (3 label x 3 boundary styles x 24 basemap values)', cbad.slice(0, 3));
L.forEach(b => {
  const want = b.id === 'ofm-dark' ? true : cviDark(addrOf(b));
  check(b.dark === want, b.id + ': dark for Auto ' + (b.id === 'ofm-dark' ? '(deliberate: CVI\'s rule does not know this style, as for any added dark basemap)' : 'as CVI\'s rule'), { dark: b.dark, cvi: cviDark(addrOf(b)) });
});
check(cviDark('https://tiles.openfreemap.org/styles/dark') === false, 'OpenFreeMap Dark: CVI\'s rule would call it light (hence the deliberate difference)');
check(same(plain(B.contrast('auto', 'auto', false)), { label: '#333333', halo: '#ffffff', line: '#8a8a8a' }), 'offline map (Auto, light): the page\'s colors before S3');
check(same(plain(B.LABEL_STYLES), [['auto', 'Auto'], ['dark', 'Dark text'], ['light', 'Light text']]) && same(plain(B.BOUNDARY_STYLES), [['auto', 'Auto'], ['dark', 'Dark lines'], ['light', 'Light lines']]),
  'Label style and Boundary style choices as CVI\'s');

// 4. The picker: offline first (not part of the list), CVI's groups in order, every entry once.
check(B.OFFLINE === 'offline' && B.OFFLINE_NAME === 'Offline county map (no internet)' && B.get(B.OFFLINE) === null && B.get(null) === null && B.get('nope') === null,
  'offline map: its id and name; get() gives null for it and for unknown ids');
const G = plain(B.groups());
check(same(G.map(g => g.group), B.GROUPS.filter(g => OFFERED.some(b => b.group === g))) && same(G.flatMap(g => g.items.map(b => b.id)).sort(), OFFERED.map(b => b.id).sort()),
  'groups(): non-empty groups in CVI\'s order, every basemap once', G.map(g => [g.group, g.items.map(b => b.id)]));
check(B.providerLine(null) === '' && B.providerLine(B.get('ofm-liberty')) === 'Map tiles come from OpenFreeMap over the internet. Your data stays in this browser.',
  'provider line: none for the offline map, the provider sentence for a basemap');
check(B.providerLine(B.get('wsdot')) === 'Map tiles come from WSDOT (Washington State Department of Transportation) over the internet. Your data stays in this browser. It covers Washington and the land just around it, at the zoom of the whole state and closer.'
  && /retire this basemap in March 2028\.$/.test(B.providerLine(anyOf('esri-relief'))), 'provider line: the basemap\'s note after it (WSDOT coverage, Esri retirement)');

// 5. The page's CSP lists exactly these hosts in connect-src, and nothing else changed for the network.
const html = fs.readFileSync(path.join(ROOT, 'site', 'cvi', 'index.html'), 'utf8');
const csp = (/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html) || [])[1] || '';
const dir = name => ((new RegExp('(?:^|;)\\s*' + name + ' ([^;]*)')).exec(csp) || [])[1];
check(same((dir('connect-src') || '').trim().split(/\s+/).sort(), plain(B.hosts()).map(h => 'https://' + h).sort()), 'CSP connect-src: exactly the basemap hosts, https', { csp: dir('connect-src'), hosts: B.hosts() });
// font-src: the site's own Open Sans file (was 'none' before the UI pass).
check(dir('default-src') === "'none'" && dir('img-src') === 'data: blob:' && dir('font-src') === "'self' file:" && dir('script-src') === "'self' file:" && dir('frame-src') === "'none'"
  && dir('form-action') === "'none'" && dir('base-uri') === "'none'", 'CSP: other directives as before S3 (fonts: the site\'s own file)', csp);
check(/<meta name="referrer" content="no-referrer">/.test(html), 'referrer off (no-referrer)');
// The Infrastructure dashboard offers the same basemaps, so its CSP lists the same hosts.
const infraHtml = fs.readFileSync(path.join(ROOT, 'site', 'infrastructure', 'index.html'), 'utf8');
const infraCsp = (/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(infraHtml) || [])[1] || '';
const infraConnect = ((/(?:^|;)\s*connect-src ([^;]*)/.exec(infraCsp)) || [])[1] || '';
check(same(infraConnect.trim().split(/\s+/).sort(), plain(B.hosts()).map(h => 'https://' + h).sort()),
  'Infrastructure CSP connect-src: exactly the basemap hosts, https', { csp: infraConnect, hosts: B.hosts() });
check(/<meta name="referrer" content="no-referrer">/.test(infraHtml), 'Infrastructure: referrer off (no-referrer)');
check(same(plain(B.hosts()), [...new Set(OFFERED.flatMap(b => b.hosts))].sort()), 'hosts(): every host of the list, sorted, once');

// 7. The public-copy switch (phase B, shared/release.js): with publicCopy true, the list, the picker and the hosts
// keep only the basemaps cleared for public use, and the PNG backgrounds held back with the Esri basemaps are gone.
const PB = { console, URL };
vm.createContext(PB);
vm.runInContext('globalThis.WSDA = { release: { publicCopy: true } };', PB);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'site', 'cvi', 'app', 'basemaps.js'), 'utf8'), PB, { filename: 'basemaps.js' });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'site', 'shared', 'tiles.js'), 'utf8'), PB, { filename: 'tiles.js' });
const PBL = plain(PB.CVIWA.basemaps.LIST), PBH = plain(PB.CVIWA.basemaps.hosts());
check(PBL.length === L.filter(b => b.publish).length && PBL.every(b => b.publish) && PBL.length === 11 &&
  !PBH.some(h => /cartocdn|arcgisonline/.test(h)) && PB.CVIWA.basemaps.get('carto-light') === null &&
  same(plain(PB.CVIWA.basemaps.groups()).flatMap(g => g.items.map(b => b.id)).sort(), PBL.map(b => b.id).sort()),
  'public copy: 11 cleared basemaps in the list, the picker and the hosts; no CARTO or Esri host', { ids: PBL.map(b => b.id), hosts: PBH });
const T = PB.WSDA.tiles;
const picker = { options: ['standard', 'raster:esri_satellite', 'raster:esri_relief', 'raster:esri_hillshade', 'vector:streets']
  .map(value => ({ value })) };
picker.options.forEach(o => { o.remove = () => picker.options.splice(picker.options.indexOf(o), 1); });
T.prunePickers([picker, null]);
check(Object.keys(T.BACKGROUNDS).length === 0 && Object.keys(T.ALL_BACKGROUNDS).length === 3 &&
  same(picker.options.map(o => o.value), ['standard', 'vector:streets']),
  'public copy: no Esri PNG background offered; the pickers keep Default and Streets', picker.options.map(o => o.value));
if (!SB.WSDA.release.publicCopy) {
  check(OFFERED.length === L.length, 'this private build offers every basemap', OFFERED.length);
}

// 6. The gate: nothing on the network for the offline map; only https to the chosen basemap's own hosts.
const ofm = B.get('ofm-liberty'), usgs = B.get('usgs-topo'), carto = anyOf('carto-light'), wsdot = B.get('wsdot'), esri = anyOf('esri-imagery');
const cases = [
  [null, 'https://tiles.openfreemap.org/styles/liberty', false], [null, 'https://basemap.nationalmap.gov/x', false],
  [null, 'blob:null/1234', true], [null, 'data:,x', true], [null, 'http://127.0.0.1:8765/cvi/x', false], [null, 'file:///etc/passwd', false],
  [ofm, 'https://tiles.openfreemap.org/planet', true], [ofm, 'https://tiles.openfreemap.org/fonts/Noto%20Sans%20Regular/0-255.pbf', true],
  [ofm, 'https://TILES.openfreemap.org/planet', true],
  [ofm, 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/1/1/1', false],
  [ofm, 'http://tiles.openfreemap.org/planet', false], [ofm, 'https://tiles.openfreemap.org:8443/planet', false],
  [ofm, 'https://user:pw@tiles.openfreemap.org/planet', false], [ofm, 'https://tiles.openfreemap.org.example.com/planet', false],
  [ofm, 'https://x.tiles.openfreemap.org/planet', false], [ofm, 'https://openfreemap.org/', false], [ofm, '/styles/liberty', false],
  [ofm, 'not a url', false], [ofm, 'wss://tiles.openfreemap.org/', false], [ofm, 'blob:null/1', true],
  [usgs, 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/6/22/10', true],
  [usgs, 'https://tiles.openfreemap.org/planet', false],
  [carto, 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json', true], [carto, 'https://tiles-c.basemaps.cartocdn.com/vectortiles/carto.streets/v1/6/10/22.mvt', true],
  [carto, 'https://tiles.basemaps.cartocdn.com/fonts/Montserrat%20Regular/0-255.pbf', true], [carto, 'https://tiles-e.basemaps.cartocdn.com/x', false],
  [carto, 'https://evil.cartocdn.com/x', false], [carto, 'https://tiles.openfreemap.org/planet', false],
  [wsdot, 'https://data.wsdot.wa.gov/arcgis/rest/services/Shared/WebBaseMapWebMercator/MapServer/tile/8/91/41', true], [wsdot, 'https://www.wsdot.wa.gov/x', false],
  [esri, 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/8/91/41', true], [esri, 'https://services.arcgisonline.com/x', false],
  [B.get('opentopo'), 'https://a.tile.opentopomap.org/8/41/91.png', true], [B.get('opentopo'), 'https://b.tile.opentopomap.org/8/41/91.png', false]
];
cases.forEach(([b, url, want]) => check(B.allowed(url, b) === want, 'allowed(' + url + ', ' + (b ? b.id : 'offline') + ') = ' + want));

console.log('S3 unit: ' + pass + '/' + (pass + fail) + ' passed (' + L.length + ' basemaps; CVI entries not built: ' + notBuilt.join(', ') + ')' +
  (fail ? '\n  ' + failures.join('\n  ') : ''));
process.exitCode = fail ? 1 : 0;
