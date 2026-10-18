/* Opt-in tile basemaps for the WA State map, after CVI shiny/modules/mod_maps.R .basemap_choices() and
 * .RASTER_BASEMAPS (raster entries built as its .make_raster_style()), and CVI's label/boundary contrast rule
 * (.resolve_label_boundary_style). The offline county map is the default and fetches nothing; a tile basemap is
 * fetched only when chosen, and only from its own hosts (allowed() is the gate map.js applies to every request
 * MapLibre makes; the page's Content-Security-Policy lists the hosts of this list as the outer limit). No API keys.
 * publish: false marks a basemap held back from any public copy of the page until its terms are confirmed (CARTO,
 * Esri). WSDOT's terms were confirmed. In a public copy (shared/release.js publicCopy true) those basemaps are left
 * out of the list, the picker and the hosts.
 * Pure functions, also loaded by tests/node/run_s3_unit_tests.js. */
(function (root) {
  'use strict';
  const OFFLINE = 'offline';
  const OFFLINE_NAME = 'Offline county map (no internet)';
  // CVI's groups, in CVI's order.
  const GROUPS = ['With state labels', 'No labels', 'Dark themes', 'Terrain & satellite'];
  const CARTO_HOSTS = ['basemaps.cartocdn.com', 'tiles.basemaps.cartocdn.com', 'tiles-a.basemaps.cartocdn.com', 'tiles-b.basemaps.cartocdn.com',
    'tiles-c.basemaps.cartocdn.com', 'tiles-d.basemaps.cartocdn.com'];
  const CARTO_CREDIT = '© CARTO, © OpenStreetMap contributors';
  const OFM_CREDIT = 'OpenFreeMap © OpenMapTiles Data from OpenStreetMap';
  const carto = s => 'https://basemaps.cartocdn.com/gl/' + s + '/style.json';
  const ofm = s => 'https://tiles.openfreemap.org/styles/' + s;
  const esri = s => 'https://server.arcgisonline.com/ArcGIS/rest/services/' + s + '/MapServer/tile/{z}/{y}/{x}';
  const usgs = s => 'https://basemap.nationalmap.gov/arcgis/rest/services/' + s + '/MapServer/tile/{z}/{y}/{x}';
  // One entry of the list: a vector basemap (a MapLibre style URL) or a raster one (a tile URL template), with
  // its hosts and the usual defaults; more overrides them.
  const vector = (id, group, name, style, provider, hosts, attribution, more) => Object.assign({
    id, group, name, cvi: style, provider, type: 'vector',
    style, hosts, attribution, dark: false, publish: true }, more);
  const raster = (id, group, name, cvi, provider, tiles, maxZoom, attribution, more) => Object.assign({
    id, group, name, cvi, provider, type: 'raster',
    tiles, maxZoom, hosts: [new URL(tiles.replace(/[{}]/g, '_')).hostname], attribution, dark: false, publish: true }, more);

  // cvi: the entry's value in CVI's .basemap_choices() (a style URL, or a "raster:" key into .RASTER_BASEMAPS); null
  // for the deliberate additions. name: CVI's label, except where CVI's label speaks of its PNG export (see RENAMED).
  // Vector styles carry their credit in the provider's own source data (attribution: what the map then shows); raster
  // entries set it, as CVI's .make_raster_style() does. dark: Auto label/boundary style treats the basemap as dark (CVI:
  // satellite, imagery, dark-matter; plus OpenFreeMap Dark). Order: CVI's within each group, additions after them
  // (OpenFreeMap Dark where CVI has MapLibre Demo, which is left out: demo tiles, not for production).
  const ALL = [
    vector('carto-light', 'With state labels', 'CARTO Light (labeled)', carto('positron-gl-style'),
      'CARTO', CARTO_HOSTS, CARTO_CREDIT, { publish: false }),
    vector('carto-voyager', 'With state labels', 'CARTO Voyager (labeled)', carto('voyager-gl-style'),
      'CARTO', CARTO_HOSTS, CARTO_CREDIT, { publish: false }),
    vector('ofm-liberty', 'With state labels', 'OpenFreeMap Liberty (labeled)', ofm('liberty'), 'OpenFreeMap', ['tiles.openfreemap.org'], OFM_CREDIT),
    vector('ofm-bright', 'With state labels', 'OpenFreeMap Bright (labeled)', ofm('bright'), 'OpenFreeMap', ['tiles.openfreemap.org'], OFM_CREDIT),
    raster('wsdot', 'With state labels', 'WSDOT Washington basemap (labeled)', null,
      'WSDOT (Washington State Department of Transportation)',
      'https://data.wsdot.wa.gov/arcgis/rest/services/Shared/WebBaseMapWebMercator/MapServer/tile/{z}/{y}/{x}', 17,
      'Washington State Department of Transportation', { minZoom: 7, bounds: [-125.5, 45.0, -116.0, 49.6], publish: true,
        note: 'It covers Washington and the land just around it, at the zoom of the whole state and closer.' }),
    vector('carto-light-nolabels', 'No labels', 'CARTO Light (no labels)', carto('positron-nolabels-gl-style'),
      'CARTO', CARTO_HOSTS, CARTO_CREDIT, { publish: false }),
    vector('carto-dark-nolabels', 'No labels', 'CARTO Dark (no labels)', carto('dark-matter-nolabels-gl-style'),
      'CARTO', CARTO_HOSTS, CARTO_CREDIT, { dark: true, publish: false }),
    vector('carto-voyager-nolabels', 'No labels', 'CARTO Voyager (no labels)', carto('voyager-nolabels-gl-style'),
      'CARTO', CARTO_HOSTS, CARTO_CREDIT, { publish: false }),
    vector('ofm-positron', 'No labels', 'OpenFreeMap Positron (no labels)', ofm('positron'), 'OpenFreeMap', ['tiles.openfreemap.org'], OFM_CREDIT),
    vector('carto-dark', 'Dark themes', 'CARTO Dark (labeled)', carto('dark-matter-gl-style'),
      'CARTO', CARTO_HOSTS, CARTO_CREDIT, { dark: true, publish: false }),
    vector('ofm-dark', 'Dark themes', 'OpenFreeMap Dark (labeled)', ofm('dark'), 'OpenFreeMap', ['tiles.openfreemap.org'], OFM_CREDIT, { cvi: null, dark: true }),
    raster('opentopo', 'Terrain & satellite', 'OpenTopoMap', 'raster:opentopo', 'OpenTopoMap', 'https://a.tile.opentopomap.org/{z}/{x}/{y}.png', 17,
      '© OpenTopoMap (CC-BY-SA), © OpenStreetMap contributors'),
    raster('esri-topo', 'Terrain & satellite', 'Esri World Topo (terrain + roads)', 'raster:esri_topo',
      'Esri', esri('World_Topo_Map'), 19, 'Source: Esri, USGS, NOAA', { publish: false }),
    raster('esri-relief', 'Terrain & satellite', 'Esri Shaded Relief (clean terrain)', 'raster:esri_relief', 'Esri', esri('World_Shaded_Relief'), 13, 'Source: Esri',
      { publish: false, note: 'Esri plans to retire this basemap in March 2028.' }),
    raster('esri-hillshade', 'Terrain & satellite', 'Esri Hillshade (grayscale relief)', 'raster:esri_hillshade',
      'Esri', esri('Elevation/World_Hillshade'), 18, 'Source: Esri', { publish: false }),
    raster('esri-physical', 'Terrain & satellite', 'Esri Physical (low zoom)', 'raster:esri_physical', 'Esri', esri('World_Physical_Map'), 8, 'Source: Esri, National Geographic',
      { publish: false, note: 'Esri plans to retire this basemap in March 2028.' }),
    raster('esri-imagery', 'Terrain & satellite', 'Esri World Imagery (satellite)', 'raster:esri_satellite', 'Esri', esri('World_Imagery'), 19, 'Source: Esri, Maxar, Earthstar Geographics',
      { dark: true, publish: false }),
    raster('esri-streets', 'Terrain & satellite', 'Esri World Streets (POI-rich)', 'raster:esri_streets',
      'Esri', esri('World_Street_Map'), 19, 'Source: Esri, HERE, Garmin', { publish: false }),
    raster('usgs-topo', 'Terrain & satellite', 'USGS Topo (The National Map)', null,
      'USGS The National Map', usgs('USGSTopo'), 16,
      'Tiles courtesy of the U.S. Geological Survey (The National Map)'),
    raster('usgs-imagery', 'Terrain & satellite', 'USGS Imagery (The National Map)', null,
      'USGS The National Map', usgs('USGSImageryOnly'), 16,
      'USDA, USGS The National Map: Orthoimagery', { dark: true }),
    raster('usgs-imagery-topo', 'Terrain & satellite', 'USGS Imagery + Topo (The National Map)', null, 'USGS The National Map', usgs('USGSImageryTopo'), 16,
      'USGS The National Map: Orthoimagery and US Topo', { dark: true }),
    raster('usgs-relief', 'Terrain & satellite', 'USGS Shaded Relief (The National Map)', null,
      'USGS The National Map', usgs('USGSShadedReliefOnly'), 8,
      'USGS The National Map: 3D Elevation Program'),
    raster('usgs-hydro', 'Terrain & satellite', 'USGS Hydro (The National Map)', null,
      'USGS The National Map', usgs('USGSHydroCached'), 12,
      'USGS The National Map: National Hydrography Dataset')
  ];
  // CVI labels not used as they are (deliberate differences): both speak of CVI's PNG export, which is not this page's
  // screenshot (both providers allow the page to read their tiles, so the screenshot works on them).
  const RENAMED = {
    'raster:opentopo': 'OpenTopoMap (live map only — tile fetch blocked for PNG)',
    'raster:esri_physical': 'Esri Physical (live map only — low zoom, blocky PNG)'
  };
  // The basemaps this copy offers: all of them, or in a public copy only those cleared for public use.
  const release = root.WSDA && root.WSDA.release;
  const LIST = release && release.publicCopy ? ALL.filter(b => b.publish) : ALL;
  const BY_ID = Object.create(null);
  LIST.forEach(b => { BY_ID[b.id] = b; });

  // The basemap with this id, or null for the offline map or an unknown id.
  function get(id) { return id && id !== OFFLINE ? BY_ID[id] || null : null; }

  // The picker: the offline map first, then CVI's groups in order (empty groups left out).
  function groups() {
    return GROUPS.map(g => ({ group: g, items: LIST.filter(b => b.group === g) })).filter(g => g.items.length);
  }

  // Every host any basemap may use, sorted: what the page's CSP connect-src lists.
  function hosts() {
    const s = new Set();
    LIST.forEach(b => b.hosts.forEach(h => s.add(h)));
    return [...s].sort();
  }

  // May the page fetch this URL while basemap b (null = the offline map) is chosen? Only https to b's own hosts;
  // nothing at all on the network for the offline map. blob: and data: addresses never leave the browser.
  function allowed(url, b) {
    let u;
    try { u = new URL(url); } catch (e) { return false; }
    if (u.protocol === 'blob:' || u.protocol === 'data:') return true;
    return !!b && u.protocol === 'https:' && !u.username && !u.password && !u.port && b.hosts.indexOf(u.hostname) >= 0;
  }

  // CVI's .make_raster_style(): one raster source over a light background.
  function rasterStyle(b) {
    return {
      version: 8,
      sources: { 'raster-source': { type: 'raster', tiles: [b.tiles], tileSize: 256, maxzoom: b.maxZoom,
        attribution: b.attribution } },
      layers: [
        { id: 'background', type: 'background', paint: { 'background-color': '#f4f4f4' } },
        { id: 'raster-layer', type: 'raster', source: 'raster-source', minzoom: 0, maxzoom: b.maxZoom }
      ]
    };
  }

  // What the map is given for a raster basemap: CVI's style, except that past the max zoom the last tiles are
  // stretched (by design; CVI's layer ends at the max zoom, so its basemap disappears there). The
  // source's max zoom stays, so nothing is asked for beyond it. A min zoom and bounds (WSDOT) keep requests within the
  // service's coverage (live check: tiles in Portland and Vancouver BC, 404 in Boise and Denver).
  function style(b) {
    if (b.type !== 'raster') return b.style;
    const s = rasterStyle(b);
    delete s.layers[1].maxzoom;
    if (b.minZoom) s.sources['raster-source'].minzoom = b.minZoom;
    if (b.bounds) s.sources['raster-source'].bounds = b.bounds;   // nothing asked for outside its coverage
    return s;
  }

  // The note under the picker on where the tiles come from (empty for the offline map).
  function providerLine(b) {
    return b ? 'Map tiles come from ' + b.provider + ' over the internet. Your data stays in this browser.'
      + (b.note ? ' ' + b.note : '') : '';
  }

  // CVI's .resolve_label_boundary_style for the live WA map: style "auto" | "dark" | "light"; dark: the basemap on the
  // map counts as dark. label: text color, halo: its outline (CVI's text-halo-color; "white" written as #ffffff),
  // line: county boundary color. On a light basemap and the offline map, Auto gives the page's colors before S3.
  function contrast(labelStyle, boundaryStyle, dark) {
    const lightText = labelStyle === 'light' || (labelStyle !== 'dark' && dark);
    return {
      label: lightText ? '#f0f0f0' : '#333333',
      halo: lightText ? '#1a1a1a' : '#ffffff',
      line: boundaryStyle === 'dark' ? '#4a4a4a' : boundaryStyle === 'light' ? '#dddddd' : dark ? '#dddddd' : '#8a8a8a'
    };
  }
  const LABEL_STYLES = [['auto', 'Auto'], ['dark', 'Dark text'], ['light', 'Light text']];       // CVI's choices
  const BOUNDARY_STYLES = [['auto', 'Auto'], ['dark', 'Dark lines'], ['light', 'Light lines']];

  root.CVIWA = root.CVIWA || {};
  root.CVIWA.basemaps = { OFFLINE, OFFLINE_NAME, GROUPS, ALL, LIST, RENAMED, LABEL_STYLES, BOUNDARY_STYLES, get, groups,
    hosts, allowed, rasterStyle, style, providerLine, contrast };
})(typeof window !== 'undefined' ? window : globalThis);
