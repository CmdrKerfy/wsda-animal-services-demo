/* MapLibre rendering of the WA State map, after CVI shiny/modules/mod_maps.R .build_county_map().
 * Labels are HTML markers so no glyph files are fetched (offline, file://).
 * S2a: county spotlight (CVI's circles_dim / circles_spotlight layers) and the screenshot control (CVI's
 * add_screenshot_control: top right, "Capture screenshot", map-screenshot.png, controls left out).
 * S2b: a second map for Compare uses the same create(); link() keeps the two cameras together.
 * Fit button under the zoom buttons on each map (not in CVI, whose only fit is the Map Style button): runs st.onFit, which the page sets to the same action as that button.
 * Fit to Washington (both buttons) returns to the opening view for the map's current size, fitView() (CVI's
 * .fit_to_bbox() uses a fixed center and zoom, tighter than the opening view on wide maps).
 * S3: opt-in tile basemaps (basemaps.js). setBasemap() swaps MapLibre's style for one with the page's own sources and
 * layers on top (ownSources/ownLayers, from what was last drawn); the HTML county labels stay. Every request MapLibre
 * makes passes basemaps.allowed() for the basemap on the map (none at all on the offline map), else it is refused
 * before it is sent; what passes is fetched by the page itself (basemapFetch: redirects refused, no credentials, no
 * referrer). A basemap counts as not loading when its style cannot be used, or when no tile of it has loaded once the
 * map is idle: the county land fill comes back (or the offline style) and st.onBasemapError is told; the map itself
 * stays usable. While a basemap is shown its credit is opened on the map; the screenshot carries it too. Label and
 * boundary colors follow CVI's Label style / Boundary style rule (setContrast), on screen and in the screenshot.
 * Neighboring regions (a deliberate addition, not in CVI): setNeighbor() draws a region's outline, land fill and
 * counties from shared/regions.js among the page's own layers (under Washington's), so they are kept across basemap
 * swaps; the same lines, label font and halo as Washington's. Land fill:
 * while any neighbor is on, Washington's turns white and the neighbors take Washington's usual gray, so the state stands
 * out; with every neighbor off Washington's gray is unchanged. Both follow Washington's rule (offline map, or a basemap
 * that did not load). Region names show while the region is on,
 * its county names from zoom 7 (Washington's from 5). They take no part in the circles, numbers or the opening view.
 * A region's credit (e.g. Statistics Canada for British Columbia) is on the map while it is drawn, opened when it is
 * turned on, and in the screenshot with the neighbor lines and the names shown.
 * S5: create() takes an optional kind, the map's own sources, layers, drawing and hover on top of Washington's land and
 * county lines (the County Focus map, focusmap.js); without one it is the WA State map (WA_KIND below). Basemaps, the
 * request gate, contrast, credits, neighboring regions, the fit button and the screenshot are shared (a kind may draw
 * its own page elements into the screenshot, under the names: kind.capture).
 * Population context (PC, shared/population.js; context only, not in CVI): setPopulation() draws the city limits,
 * population centers and population density among the page's own layers, over Washington's land and under the county
 * lines and the data, so they are kept across basemap swaps. Their names are page elements as the county names are,
 * placed largest first and hidden where they would cover a name already shown (on every map move), and drawn into the
 * screenshot. Hover (only where the kind has nothing under the pointer, kind.hoverLayers): the city or place, and the
 * tract's density. The layers' credits are in the map's attribution while they are drawn (MapLibre lists a source's
 * credit while a layer of it is shown) and in the screenshot.
 * Shaded counties (CH; not in CVI): draw() with opts.shade fills each county in its class's
 * color (choropleth.js) in place of the circles, a light hatch for "No movements", under the population layers and the
 * county lines (white while the Boundary style is Auto); the spotlit counties outlined and the others dimmed; hover
 * gives the county's value. The kind's baseLayers go just above Washington's land.
 */
(function (root) {
  'use strict';
  const WA_VIEW_BOUNDS = [-124.90, 45.40, -116.85, 49.05];   // .WA_VIEW_BOUNDS
  const LABEL_MIN_ZOOM = 5, NR_LABEL_MIN_ZOOM = 7;
  // Circle layers in drawing order, with their sources: all circles (no spotlight), then the dimmed and the spotlit
  // circles (spotlight on), as CVI adds them.
  const LAYERS = [['circles', 'circles_source'], ['circles_dim', 'circles_source_dim'], ['circles_spotlight', 'circles_source_spot']];
  const SOURCE_OF = Object.fromEntries(LAYERS);
  const OWN_SOURCES = ['wa_land_source', 'choro_source'].concat(LAYERS.map(l => l[1]));
  // The page's sources, never the basemap's: Washington's and the circles, and the neighboring regions' (nr_<id>_…).
  const isOwn = id => OWN_SOURCES.indexOf(id) >= 0 || /^nr_[a-z0-9]+_(outline|counties)$/.test(String(id)) ||
    /^pc_(cities|places|density)$/.test(String(id));
  const BASE_STYLE = () => ({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#f8f9fa' } }] });
  const LAND_PAINT = { 'fill-color': '#ececec', 'fill-opacity': 1 };
  // While a neighboring region is on: Washington white, the neighbors in Washington's usual gray.
  const NR_LAND_PAINT = { 'fill-color': '#ececec', 'fill-opacity': 1 };
  const WA_LAND_WITH_NEIGHBORS = '#ffffff';
  const anyNeighbor = st => Object.keys(st.nr.on).some(id => st.nr.on[id] && st.nr.data[id]);
  const waLandPaint = st => Object.assign({}, LAND_PAINT, anyNeighbor(st) ? { 'fill-color': WA_LAND_WITH_NEIGHBORS } : {});
  const landColor = st => waLandPaint(st)['fill-color'];   // Washington's land fill now (the legend's swatches, S1.1)
  const LINE_PAINT = { 'line-color': '#8a8a8a', 'line-width': 0.8, 'line-opacity': 0.7 };   // color: st.contrast.line
  // Basemap requests that pass the gate are handed to MapLibre under this private scheme, so that basemapFetch() makes
  // them (MapLibre's own requests follow redirects to any host); workers pass such requests to the page.
  const PROTOCOL = 'cvi-basemap', PREFIX = PROTOCOL + '://';
  const config = { watchMs: 20000 };   // no tile and the map still busy this long after a basemap is shown: not loading
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // The page's own sources and layers, as last drawn: added on load and on top of every basemap style.
  function ownSources(st) {
    const s = { wa_land_source: { type: 'geojson', data: st.geo.counties } };
    Object.assign(s, st.kind.sources(st));
    Object.keys(st.nr.data).forEach(id => Object.assign(s, nrParts(st, id).sources));
    Object.assign(s, pcParts(st).sources);
    return s;
  }
  // A source of this map's own (never the basemap's): the shared ones, or the kind's.
  const ownOf = st => id => isOwn(id) || !!(st.kind.isOwn && st.kind.isOwn(id));
  // Whether Washington's stand-in land fill shows: on the offline map, or when the basemap failed.
  function landVisible(st) { return !st.shown || st.basemapFailed; }
  // A neighboring region's parts as they should be now (shared/regions.js mapParts): its land fill follows Washington's
  // rule, in Washington's usual gray.
  function nrParts(st, id) {
    const on = !!st.nr.on[id];
    return root.WSDA.regions.mapParts(st.nr.data[id], { landPaint: NR_LAND_PAINT, linePaint: linePaint(st),
      land: on && landVisible(st), outline: on, counties: on && !!st.nr.counties[id] });
  }
  const linePaint = st => Object.assign({}, LINE_PAINT, st.contrast ? { 'line-color': st.contrast.line } : {});
  // The page's own layers in drawing order: the neighbors', Washington's land, the kind's base layers, population,
  // the county lines, then the kind's own layers.
  function ownLayers(st) {
    const vis = on => (on ? 'visible' : 'none');
    const neighbors = [].concat(...Object.keys(st.nr.data).map(id => nrParts(st, id).layers));
    // Stand-in for a basemap's land color on the offline map, and when a basemap's tiles do not load.
    return neighbors.concat([{ id: 'wa-land', type: 'fill', source: 'wa_land_source',
      layout: { visibility: vis(landVisible(st)) }, paint: waLandPaint(st) }],
      st.kind.baseLayers ? st.kind.baseLayers(st) : [], pcParts(st).layers,
      [{ id: 'county-lines', type: 'line', source: 'wa_land_source', layout: { visibility: vis(st.linesVisible) },
        paint: Object.assign(linePaint(st), st.kind.linePaint || {}, st.contrast ? { 'line-color': st.contrast.line } : {}) }]
      .concat(st.kind.layers(st)));
  }

  // ── MC: the movement view (lines between WA counties in place of the circles; movement.js mapView) ──────────
  // Its sources and layers exist only while the view is on (st.mc), so the map is unchanged without it. Lines in
  // their rank group's color and width (movement.js TIER_COLORS and TIER_WIDTH) with a filled arrowhead at the
  // destination end, rings in purple. While it is on, Washington's county names are drawn larger and semibold with a
  // wider halo (the mc-on class), on the screen and in the screenshot (MC_LABEL). Arrowheads and
  // badges 1 to 3 are small pictures made here (the offline map has no fonts for map
  // text), so they are in the screenshot too. Invisible wider lines and county points take the hover.
  const MC_TEAL = '#245566', MC_RING = '#7a3e9d';
  const MC_LABEL = { size: 12.5, weight: 600, halo: 3 };   // as .mc-on .county-label in index.html
  const MC_LABEL_DARK = '#1f1f1f';
  // The population layers' names (index.html .pc-name) over a white halo; over a dark one they take the map's light
  // name color (2.2: dark names were hard to read on satellite).
  const PC_NAME_DARK = '#444444';
  const MC_SOURCES = { lines: 'mc_lines_source', heads: 'mc_heads_source', rings: 'mc_rings_source',
    counties: 'mc_counties_source', badges: 'mc_badges_source' };
  const MC_LAYERS = ['mc-lines', 'mc-heads', 'mc-rings', 'mc-hit', 'mc-county-hit', 'mc-badges'];
  const collection = features => ({ type: 'FeatureCollection', features });
  // v: movement.mapView()'s result, as features.
  function mcFeatures(v) {
    const prop = (x, extra) => Object.assign({ w: x.width_px, c: x.color, o: x.opacity, tip: JSON.stringify(x.tip),
      key: x.key }, extra);
    const line = (coords, x, extra) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords },
      properties: prop(x, extra) });
    return {
      lines: collection(v.lines.map(x => line(x.line, x))),
      heads: collection(v.lines.map(x => ({ type: 'Feature', geometry: { type: 'Point', coordinates: x.head.at },
        properties: { c: x.color, o: x.opacity, b: x.head.bearing, s: x.arrow_px / ARROW_IMAGE_LENGTH } }))),
      rings: collection(v.rings.map(r => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
        properties: { r: r.radius_px, o: r.opacity, county: r.county } }))),
      counties: collection(v.counties.map(c => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
        properties: { county: c.county, tip: JSON.stringify(c.tip) } }))),
      badges: collection(v.lines.filter(x => x.badge).map(x => ({ type: 'Feature',
        geometry: { type: 'Point', coordinates: x.middle }, properties: { badge: x.badge, key: x.key } })))
    };
  }
  // The movement view's sources while it is on (none otherwise).
  function mcSources(st) {
    if (!st.mc) return {};
    return Object.fromEntries(Object.keys(MC_SOURCES).map(k => [MC_SOURCES[k], { type: 'geojson', data: st.mc[k] }]));
  }
  // The movement view's layers while it is on: lines, arrowheads, rings, the invisible hover targets and the badges.
  function mcLayers(st) {
    if (!st.mc) return [];
    return [{ id: 'mc-lines', type: 'line', source: MC_SOURCES.lines, layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'c'], 'line-width': ['get', 'w'], 'line-opacity': ['get', 'o'] } },
      // The arrowhead's base sits at the end of its line, pointing along it (icon-rotate turns the offset too).
      { id: 'mc-heads', type: 'symbol', source: MC_SOURCES.heads, layout: { 'icon-image': ['concat', 'mc-arrow-', ['get', 'c']],
        'icon-size': ['get', 's'], 'icon-rotate': ['get', 'b'], 'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map',
        'icon-anchor': 'bottom', 'icon-allow-overlap': true, 'icon-ignore-placement': true },
      paint: { 'icon-opacity': ['get', 'o'] } },
      { id: 'mc-rings', type: 'circle', source: MC_SOURCES.rings, paint: { 'circle-radius': ['get', 'r'], 'circle-opacity': 0,
        'circle-stroke-color': MC_RING, 'circle-stroke-width': 2.5, 'circle-stroke-opacity': ['get', 'o'] } },
      { id: 'mc-hit', type: 'line', source: MC_SOURCES.lines, paint: { 'line-color': '#000000', 'line-opacity': 0,
        'line-width': ['+', ['get', 'w'], 8] } },
      { id: 'mc-county-hit', type: 'circle', source: MC_SOURCES.counties, paint: { 'circle-radius': 9, 'circle-opacity': 0 } },
      { id: 'mc-badges', type: 'symbol', source: MC_SOURCES.badges, layout: { 'icon-image': ['concat', 'mc-badge-',
        ['to-string', ['get', 'badge']]], 'icon-allow-overlap': true, 'icon-ignore-placement': true } }];
  }
  // A badge picture: a white-edged teal disc with the number in white, drawn at twice the size for sharpness.
  function badgeImage(n) {
    const c = root.document.createElement('canvas');
    c.width = 44; c.height = 44;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(22, 22, 21, 0, 2 * Math.PI); g.fill();
    g.fillStyle = MC_TEAL; g.beginPath(); g.arc(22, 22, 17, 0, 2 * Math.PI); g.fill();
    g.fillStyle = '#ffffff'; g.font = 'bold 22px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(n), 22, 23);
    return g.getImageData(0, 0, 44, 44);
  }
  // The badge pictures 1 to 3 added to the map, each once.
  function addBadgeImages(map) {
    [1, 2, 3].forEach(n => {
      if (!map.hasImage('mc-badge-' + n)) map.addImage('mc-badge-' + n, badgeImage(n), { pixelRatio: 2 });
    });
  }
  // An arrowhead picture in one color: a filled triangle pointing up, its base along the bottom edge, drawn at twice
  // the size of an 8 px line's arrowhead (the widest line is 7 px, so every arrowhead is scaled
  // down from it) and scaled down for thinner lines by icon-size. Each color's
  // picture is added when the map first asks for it (styleimagemissing, in attach).
  const ARROW_IMAGE_LENGTH = 22.8;   // movement.js arrowLength(8)
  const ARROW_IMAGE_HALF = 13.8;     // half the base width for an 8 px line
  function arrowImage(color) {
    const w = Math.ceil(2 * ARROW_IMAGE_HALF) * 2;
    const h = Math.ceil(ARROW_IMAGE_LENGTH) * 2;
    const c = root.document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(w / 2, h - 2 * ARROW_IMAGE_LENGTH);
    g.lineTo(w / 2 + 2 * ARROW_IMAGE_HALF, h);
    g.lineTo(w / 2 - 2 * ARROW_IMAGE_HALF, h);
    g.closePath();
    g.fill();
    return g.getImageData(0, 0, w, h);
  }

  // ---- Facility marks: each layer's shape and color, from facilities.js ----------------------------------------
  // A mark's picture is made when a map first asks for it (styleimagemissing, in create()), so a basemap's new style
  // gets it again. Drawn at twice the size for sharp edges. The circle's radius is 8 px with a 2 px white edge, which
  // keeps the 7 px fill and 9 px reach of the facility circles before.
  const MARK_HALF = 12;
  const markId = (shape, color) => 'wsda-mark:' + shape + ':' + color;
  function markImage(shape, color) {
    const k = 2, c = root.document.createElement('canvas');
    c.width = 2 * MARK_HALF * k;
    c.height = 2 * MARK_HALF * k;
    const g = c.getContext('2d');
    g.scale(k, k);
    const path = new root.Path2D(root.WSDA.facilities.markPath(shape, MARK_HALF, MARK_HALF, 8));
    g.fillStyle = color;
    g.fill(path);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2;
    g.lineJoin = 'round';
    g.stroke(path);
    return g.getImageData(0, 0, c.width, c.height);
  }
  // Adds a mark's picture to the map now (when it is not there yet), so its points are placed and clickable as soon
  // as the map has drawn; styleimagemissing still makes any picture a new style asks for.
  function addMark(map, shape, color) {
    const id = markId(shape, color);
    if (!map.hasImage(id)) map.addImage(id, markImage(shape, color), { pixelRatio: 2 });
    return id;
  }
  // A symbol layer that draws each point of `source` with a mark: image is markId() of one layer, or
  // ['get', 'mark'] when each feature names its own. opts: size (1 = the map's facility size), opacity, filter.
  function markLayer(id, source, image, opts) {
    opts = opts || {};
    const layer = { id, type: 'symbol', source,
      layout: { 'icon-image': image, 'icon-size': opts.size || 1, 'icon-allow-overlap': true,
        'icon-ignore-placement': true },
      paint: { 'icon-opacity': opts.opacity === undefined ? 0.95 : opts.opacity } };
    if (opts.filter) layer.filter = opts.filter;
    return layer;
  }

  // Turns the movement view on with v (movement.mapView()'s result), updates it, or turns it off (v null): the circles
  // are hidden while it is on.
  function setMovement(st, v) {
    const was = !!(st.ready && !st.switching && st.map.getLayer('mc-lines'));
    st.mc = v ? mcFeatures(v) : null;
    st.mcView = v;   // test hook: what is drawn
    st.map.getContainer().classList.toggle('mc-on', !!v);
    if (!st.ready || st.switching || st.failed) return;   // the style is built with st.mc when ready
    const map = st.map;
    st.clearHover();
    LAYERS.forEach(([id]) => [id, id + EDGE].forEach(l => map.setLayoutProperty(l, 'visibility', st.mc ? 'none' : 'visible')));
    if (st.mc && was) {
      Object.keys(MC_SOURCES).forEach(k => map.getSource(MC_SOURCES[k]).setData(st.mc[k]));
    } else if (st.mc) {
      addBadgeImages(map);
      const sources = mcSources(st);
      Object.keys(sources).forEach(id => map.addSource(id, sources[id]));
      mcLayers(st).forEach(l => map.addLayer(l));
    } else if (was) {
      MC_LAYERS.forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
      Object.keys(MC_SOURCES).forEach(k => { if (map.getSource(MC_SOURCES[k])) map.removeSource(MC_SOURCES[k]); });
    }
  }
  // A hover's lines (stored as JSON) as HTML: the first in bold, every line escaped.
  const mcTipHtml = tip => JSON.parse(tip).map((t, i) => (i ? esc(t) : '<strong>' + esc(t) + '</strong>')).join('<br/>');

  // ── CH: shaded counties ─────────────────────────────────────────────────────────────────────────────────────
  // st.shade: { features (one per county: name, color, none, dim, tip), opacity } while shaded, else null. The fills
  // and the hatch sit above Washington's land (the kind's baseLayers); the spotlit counties' outline over the county
  // lines (with the circle layers). Dimmed counties (outside a spotlight) at SHADE_DIM. The source and layers exist
  // only while shaded, so the circles' map is as before.
  const SHADE_LAYERS = ['choro-fill', 'choro-none'];
  const SHADE_DIM = 0.2;
  const SHADE_SPOT = { color: '#ffffff', width: 3 };   // choropleth.js OUTLINE
  const HATCH_IMAGE = 'choro-hatch';
  const shadeCollection = st => collection(st.shade ? st.shade.features : []);
  // The fills' opacity: a dimmed county at SHADE_DIM, the hovered one 0.15 more (at most 1).
  function shadeOpacity(st) {
    const op = st.shade ? Number(st.shade.opacity) : 0.8;
    return ['case', ['boolean', ['get', 'dim'], false], SHADE_DIM,
      ['boolean', ['feature-state', 'hover'], false], Math.min(1, op + 0.15), op];
  }
  // The shaded fills and the hatch for counties with no movements (none unless shaded).
  function shadeBaseLayers(st) {
    if (!st.shade) return [];
    return [{ id: 'choro-fill', type: 'fill', source: 'choro_source', filter: ['!', ['get', 'none']],
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': shadeOpacity(st) } },
    { id: 'choro-none', type: 'fill', source: 'choro_source', filter: ['get', 'none'],
      paint: { 'fill-pattern': HATCH_IMAGE, 'fill-opacity': ['case', ['boolean', ['get', 'dim'], false], SHADE_DIM, 1] } }];
  }
  // The spotlit counties' outline on the shaded map.
  const shadeSpotLayer = () => ({ id: 'choro-spot', type: 'line', source: 'choro_source', filter: ['get', 'spot'],
    paint: { 'line-color': SHADE_SPOT.color, 'line-width': SHADE_SPOT.width } });
  // The hatch tile (choropleth.js HATCH), drawn at twice the size: lines at 45° that join from tile to tile.
  function hatchImage() {
    const H = root.CVIWA.choropleth.HATCH, k = 2, s = H.step * k;
    const c = root.document.createElement('canvas');
    c.width = s; c.height = s;
    const g = c.getContext('2d');
    g.fillStyle = H.ground;
    g.fillRect(0, 0, s, s);
    g.strokeStyle = H.line;
    g.lineWidth = H.width * k;
    [-s, 0, s].forEach(o => {
      g.beginPath();
      g.moveTo(o, s);
      g.lineTo(o + s, 0);
      g.stroke();
    });
    return g.getImageData(0, 0, s, s);
  }
  function addHatch(map) {
    if (!map.hasImage(HATCH_IMAGE)) map.addImage(HATCH_IMAGE, hatchImage(), { pixelRatio: 2 });
  }

  // A thin dark edge outside a circle's white one, drawn by a layer of its own just below the circle layer (its
  // wider stroke shows 1 px past the white): light circles then stand out from a light map (3:1 contrast).
  const EDGE = '-edge';
  const edgeLayer = (id, source, extra) => Object.assign({ id: id + EDGE, type: 'circle', source, paint: {
    'circle-color': '#000000', 'circle-opacity': 0, 'circle-radius': ['get', 'radius_px'],
    'circle-stroke-width': 2.5, 'circle-stroke-color': '#333333', 'circle-stroke-opacity': 0.9 } }, extra || {});

  // The WA State map's own part: the circles (CVI's .build_county_map) and their pop-up; since MC the movement view.
  const WA_KIND = {
    isOwn: id => /^mc[-_]/.test(String(id)),
    hoverLayers: st => (st.mc ? ['mc-county-hit', 'mc-hit'] : LAYERS.map(l => l[0]).concat(SHADE_LAYERS)),
    sources: st => Object.assign(Object.fromEntries(LAYERS.map(([id, source]) => [source, { type: 'geojson',
      data: { type: 'FeatureCollection', features: (st.layers && st.layers[id]) || [] } }])), mcSources(st),
    st.shade ? { choro_source: { type: 'geojson', data: shadeCollection(st) } } : {}),
    baseLayers: st => shadeBaseLayers(st),
    // CH: the county lines white on the shaded map while the Boundary style is Auto (by design).
    contrast: (st, c) => (st.shade && (st.boundaryStyle || 'auto') === 'auto'
      ? Object.assign({}, c, { line: root.CVIWA.choropleth.LINE }) : c),
    layers: st => LAYERS.flatMap(([id, source]) => [edgeLayer(id, source, st.mc ? { layout: { visibility: 'none' } } : {}),
      Object.assign({ id, type: 'circle', source, paint: {
        'circle-color': ['get', 'color'], 'circle-radius': ['get', 'radius_px'],
        'circle-opacity': (st.circleOpacity && st.circleOpacity[id]) || 0.6,
        'circle-stroke-width': 1.5, 'circle-stroke-color': '#ffffff', 'circle-stroke-opacity': 1.0 } },
      st.mc ? { layout: { visibility: 'none' } } : {})]).concat(st.shade ? [shadeSpotLayer()] : [], mcLayers(st)),
    draw: (st, d, opts) => draw(st, d, opts),
    // One pop-up for the circle on top under the pointer, in any circle layer (CVI gives every layer a tooltip;
    // only the full-opacity layers brighten on hover).
    attach(st) {
      const map = st.map, popup = new root.maplibregl.Popup({ closeButton: false, closeOnClick: false });
      const unhover = () => {
        if (st.hover) map.setFeatureState(st.hover, { hover: false }); st.hover = null; st.hoverId = null;
      };
      st.clearHover = () => { map.getCanvas().style.cursor = ''; unhover(); popup.remove(); };
      const ids = LAYERS.map(l => l[0]);
      // MC: the badge and arrowhead pictures, again after a basemap's style replaced them.
      map.on('styleimagemissing', e => {
        if (/^mc-badge-[1-3]$/.test(e.id)) addBadgeImages(map);
        if (/^mc-arrow-#[0-9a-f]{6}$/.test(e.id)) map.addImage(e.id, arrowImage(e.id.slice(9)), { pixelRatio: 2 });
        if (e.id === HATCH_IMAGE) addHatch(map);   // CH: the hatch, again after a basemap's style replaced it
      });
      addHatch(map);
      map.on('mousemove', e => {
        if (st.switching) return;   // the style is being swapped: the circle layers are not there to query
        if (st.mc && map.getLayer('mc-hit')) {
          // The movement view: a county's three numbers, else a line's pair, animals, records and top species.
          const hit = map.queryRenderedFeatures(e.point, { layers: ['mc-county-hit'] })[0]
            || map.queryRenderedFeatures(e.point, { layers: ['mc-hit'] })[0];
          if (!hit) { st.clearHover(); return; }
          map.getCanvas().style.cursor = 'default';
          st.mcHover = hit.properties.county || hit.properties.key;   // test hook
          popup.setLngLat(e.lngLat).setHTML(mcTipHtml(hit.properties.tip)).addTo(map);
          return;
        }
        const fs = map.queryRenderedFeatures(e.point, { layers: ids });
        // CH: on the shaded map, the county under the pointer: its value, or "No movements".
        if (!fs.length && st.shade) {
          const hit = map.queryRenderedFeatures(e.point, { layers: SHADE_LAYERS })[0];
          if (!hit) { st.clearHover(); return; }
          map.getCanvas().style.cursor = 'pointer';
          const key = { source: 'choro_source', id: hit.id };
          if (!st.hover || st.hover.source !== key.source || st.hover.id !== key.id) {
            unhover(); st.hover = key; st.hoverId = key.id; map.setFeatureState(key, { hover: true });
          }
          st.shadeHover = hit.properties.name;   // test hook
          popup.setLngLat(e.lngLat).setHTML(mcTipHtml(hit.properties.tip)).addTo(map);
          return;
        }
        if (!fs.length) { if (st.hover) st.clearHover(); return; }
        map.getCanvas().style.cursor = 'pointer';
        const f = fs[0], key = { source: SOURCE_OF[f.layer.id], id: f.id };
        if (!st.hover || st.hover.source !== key.source || st.hover.id !== key.id) {
          unhover(); st.hover = key; st.hoverId = key.id; map.setFeatureState(key, { hover: true });
        }
        const p = f.properties;
        popup.setLngLat(e.lngLat).setHTML('<strong>' + esc(p.county) + '</strong><br/>' + esc(p.direction) + ': '
          + esc(p.amount) + ' animals').addTo(map);
      });
      map.getCanvas().addEventListener('mouseleave', () => st.clearHover());
    }
  };
  function withOwn(st, next) {   // the basemap's style with the page's own sources and layers on top
    const style = Object.assign({}, next, { sources: Object.assign({}, next.sources), layers: (next.layers || []).slice() });
    const ours = ownSources(st);
    Object.keys(ours).forEach(k => { style.sources[k] = ours[k]; });
    const ids = ownLayers(st).map(l => l.id);
    style.layers = style.layers.filter(l => ids.indexOf(l.id) < 0).concat(ownLayers(st));
    return style;
  }

  // kind: the map's own part (default: the WA State map's circles); see WA_KIND for what it provides.
  function create(container, geo, onReady, onError, kind) {
    let st = null;
    const map = new root.maplibregl.Map({
      container,
      style: BASE_STYLE(),
      bounds: WA_VIEW_BOUNDS, fitBoundsOptions: { padding: 24 },
      attributionControl: { compact: true, customAttribution: geo.attribution },
      transformRequest: (url, resourceType) => gate(st, url, resourceType)
    });
    st = { map, geo, labels: [], labelsVisible: true, linesVisible: false, hover: null, hoverId: null, opacity: 0.6,
      ready: false, pending: null, basemap: null, shown: null, basemapFailed: false, fallback: false, switching: false,
      token: 0, tilesOk: 0, tileTries: 0, sourceErrors: 0,
      blocked: [], styleFetch: null, watch: null, nr: { data: {}, on: {}, counties: {}, labels: {} }, kind: kind || WA_KIND,
      pc: null, pcLabels: [], pcNameKey: '', pcShown: [] };
    st.clearHover = () => {};
    const own = ownOf(st);
    applyContrast(st);
    const fail = () => { st.failed = true; if (onError) onError(); };
    map.on('error', e => {
      e = e || {};
      // Refused by the gate (recorded in st.blocked): never sent, not a failure by itself; a basemap source refused
      // (e.g. its TileJSON on another host) counts for the idle check.
      if (e.error && e.error.refused) { if (st.shown && e.sourceId && !e.tile && !own(e.sourceId)) st.sourceErrors++; return; }
      // A layer the map's style check refused ("layers.<id>.paint…: color expected …") leaves that one layer out;
      // the map itself still draws, so it is not a lost map.
      if (!e.sourceId && e.error && /^layers\./.test(String(e.error.message || ''))) {
        st.styleErrors = (st.styleErrors || []).concat(String(e.error.message).slice(0, 200));
        return;
      }
      const mine = e.sourceId && own(e.sourceId);
      // While a tile basemap is on the map, an error from anything but the page's own sources is the basemap's.
      if (st.shown && !mine) basemapProblem(st, e);
      else if (mine || !e.sourceId) fail();
    });
    // A tile of the basemap that holds data (MapLibre turns a missing vector tile, 404, into an empty loaded tile:
    // no feature index; a missing raster tile is not loaded at all). For a vector basemap only its vector tiles count:
    // a raster relief layer alone is not the basemap. A tile arriving after a failure undoes it.
    map.on('data', e => {
      if (!st.shown || !e || e.dataType !== 'source' || !e.tile || own(e.sourceId)) return;
      if (!(st.shown.type === 'vector' ? e.tile.latestFeatureIndex : e.tile.texture)) return;
      st.tilesOk++;
      if (st.basemapFailed && !st.fallback && st.shown === st.basemap) recovered(st);
    });
    map.on('sourcedata', e => { if (st.shown && e && e.sourceDataType === 'metadata' && !own(e.sourceId)) openCredit(st); });
    map.on('idle', () => noTiles(st, false));
    map.on('style.load', () => {
      if (!st.ready || st.failed) return;
      st.switching = false;
      const p = st.pending || st.last; st.pending = null;
      if (p) st.kind.draw(st, p.d, p.opts);
      // Line color and visibility as set now (they may have changed while the style was being swapped, e.g. Reset All).
      applyContrast(st); setLines(st, st.linesVisible);
      Object.keys(st.nr.data).forEach(id => applyNeighbor(st, id));   // a region turned on while the style was swapped
      if (st.pc) applyPopulation(st);   // population layers switched while the style was swapped
      if (st.shown) openCredit(st);
    });
    map.on('webglcontextlost', fail);
    map.on('styleimagemissing', e => {
      const m = /^wsda-mark:([a-z-]+):(.+)$/.exec(e.id);
      if (m && !map.hasImage(e.id)) map.addImage(e.id, markImage(m[1], m[2]), { pixelRatio: 2 });
    });
    map.addControl(new root.maplibregl.NavigationControl(), 'top-left');
    const zoomOut = map.getContainer().querySelector('.maplibregl-ctrl-top-left .maplibregl-ctrl-zoom-out');
    if (zoomOut) zoomOut.after(fitButton(st));   // in the zoom group, above the compass
    map.addControl(screenshotControl(st), 'top-right');
    // A scale bar in miles, so distances can be judged: bottom right, above the credits (the CVI maps' Legend button
    // holds the bottom left), unless the map's kind names another corner (scaleCorner).
    map.addControl(new root.maplibregl.ScaleControl({ unit: 'imperial', maxWidth: 110 }), st.kind.scaleCorner || 'bottom-right');
    map.on('load', () => {
      if (st.failed) return;
      try {
        const sources = ownSources(st);
        Object.keys(sources).forEach(k => map.addSource(k, sources[k]));
        ownLayers(st).forEach(l => map.addLayer(l));
        geo.labels.forEach(l => {
          const el = document.createElement('div');
          el.className = 'county-label' + (st.kind.labelClass ? ' ' + st.kind.labelClass : ''); el.textContent = l.name;
          st.labels.push(new root.maplibregl.Marker({ element: el }).setLngLat([l.lon, l.lat]).addTo(map));
        });
        st.kind.attach(st);
        const pcTip = new root.maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: '300px',
          className: 'pc-tip' });
        map.on('mousemove', e => pcHover(st, e, pcTip));
        map.getCanvas().addEventListener('mouseleave', () => pcTip.remove());
        map.on('moveend', () => placePcNames(st));
        map.on('zoom', () => applyLabelVisibility(st));
        st.ready = true;
        if (st.pending) { const p = st.pending; st.pending = null; st.kind.draw(st, p.d, p.opts); }
        if (st.pc) pcNames(st);   // population names asked for before the map was ready
        if (st.basemap) setBasemap(st, st.basemap);   // chosen before the map was ready
        if (onReady) onReady(st);
      } catch (e) { fail(); }
    });
    return st;
  }

  // Washington's county names shown from LABEL_MIN_ZOOM when switched on; a neighboring region's name while it is on,
  // and its county names from NR_LABEL_MIN_ZOOM when asked for.
  function applyLabelVisibility(st) {
    const z = st.map.getZoom(), show = st.labelsVisible && z >= LABEL_MIN_ZOOM;
    st.labels.forEach(m => m.getElement().classList.toggle('hidden', !show));
    Object.keys(st.nr.labels).forEach(id => {
      const L = st.nr.labels[id], on = !!st.nr.on[id];
      L.name.getElement().classList.toggle('hidden', !on);
      const counties = on && !!st.nr.counties[id] && st.labelsVisible && z >= NR_LABEL_MIN_ZOOM;
      L.counties.forEach(m => m.getElement().classList.toggle('hidden', !counties));
    });
  }

  // ---- Neighboring regions ---------------------------------------------------------------------------------------
  // data: a region's loaded file (shared/regions.js load()); on: the region; counties: its counties (only with on).
  function setNeighbor(st, data, on, counties) {
    const id = data.id, was = !!st.nr.on[id];
    st.nr.on[id] = !!on; st.nr.counties[id] = !!(on && counties);
    if (!st.nr.data[id]) {
      st.nr.data[id] = data;
      const mark = (text, lonLat, cls) => {
        const el = root.document.createElement('div');
        el.className = 'county-label hidden' + (cls ? ' ' + cls : ''); el.textContent = text;
        return new root.maplibregl.Marker({ element: el }).setLngLat(lonLat).addTo(st.map);
      };
      const e = root.WSDA.regions.entry(id);
      st.nr.labels[id] = { name: mark(data.name, e ? e.anchor : [data.labels[0].lon, data.labels[0].lat], 'region-name'),
        counties: data.labels.map(l => mark(l.name, [l.lon, l.lat], 'neighbor-county')) };
    }
    if (st.ready && !st.switching && !st.failed) applyNeighbor(st, id);
    applyLabelVisibility(st);
    if (on && !was && nrCredits(st).length) openCredit(st);   // turned on: its credit shown (as a basemap's)
  }
  // The credits of the regions on that the page does not already give (e.g. Statistics Canada for British Columbia;
  // the Census Bureau's is the page's own).
  function nrCredits(st) {
    const R = root.WSDA.regions, own = String(st.geo.attribution || '');
    return Object.keys(st.nr.data).filter(id => st.nr.on[id]).map(id => (R.entry(id) || {}).credit)
      .filter((c, i, a) => c && own.indexOf(c) < 0 && a.indexOf(c) === i);
  }
  function applyNeighbor(st, id) {   // its sources and layers on the map (under Washington's), as they should be now
    const map = st.map, parts = nrParts(st, id);
    Object.keys(parts.sources).forEach(k => { if (!map.getSource(k)) map.addSource(k, parts.sources[k]); });
    parts.layers.forEach(l => {
      if (!map.getLayer(l.id)) map.addLayer(l, 'wa-land');
      else {
        map.setLayoutProperty(l.id, 'visibility', l.layout.visibility);
        if (l.type === 'line') map.setPaintProperty(l.id, 'line-color', l.paint['line-color']);
      }
    });
    // white while one is on
    if (map.getLayer('wa-land')) map.setPaintProperty('wa-land', 'fill-color', waLandPaint(st)['fill-color']);
  }
  function setLand(st) {   // Washington's and the neighbors' land fill: on the offline map, or when a basemap failed
    const v = landVisible(st);
    if (st.map.getLayer('wa-land')) st.map.setLayoutProperty('wa-land', 'visibility', v ? 'visible' : 'none');
    Object.keys(st.nr.data).forEach(id => {
      if (st.map.getLayer('nr-' + id + '-land')) st.map.setLayoutProperty('nr-' + id + '-land', 'visibility',
        v && st.nr.on[id] ? 'visible' : 'none');
    });
  }

  // ---- Population context (PC) -----------------------------------------------------------------------------------
  // st.pc: { on: { cities, places, density }, ramp, names: { min, counties } or null (no names) }. The layers come from
  // the files population.js has loaded; the page loads a file before switching its layer on.
  const PN = () => root.WSDA && root.WSDA.population;
  const PC_HOVER = [['cities', 'pc-cities-fill'], ['places', 'pc-places-fill'], ['density', 'pc-density']];
  // Whether any population layer is switched on.
  const pcOn = st => !!(st.pc && st.pc.on && (st.pc.on.cities || st.pc.on.places || st.pc.on.density));
  function pcParts(st) {
    if (!PN() || !st.pc) return { sources: {}, layers: [] };
    return PN().mapParts(st.pc.on, { ramp: st.pc.ramp });
  }
  // Which places the population centers source holds: all of them, or (with city limits on) the census-designated
  // places outside current city limits (population.js's both-on rule).
  const pcPlacesKey = st => (st.pc.on.places && st.pc.on.cities && !!PN().loaded('cities') ? 'cdp' : 'all');
  // The population settings kept, and put on the map when it is ready.
  function setPopulation(st, pc) {
    st.pc = { on: Object.assign({ cities: false, places: false, density: false }, pc && pc.on), ramp: pc && pc.ramp,
      names: (pc && pc.names) || null };
    if (st.ready && !st.switching && !st.failed) applyPopulation(st);
  }
  // The population sources and layers on the map made to match st.pc, then its names.
  function applyPopulation(st) {
    const map = st.map;
    if (!PN() || !st.pc) return;
    const parts = pcParts(st);
    Object.keys(parts.sources).forEach(k => {
      if (!map.getSource(k)) map.addSource(k, parts.sources[k]);
      else if (k === 'pc_places' && st.pcPlaces !== pcPlacesKey(st)) map.getSource(k).setData(parts.sources[k].data);
    });
    if (parts.sources.pc_places) st.pcPlaces = pcPlacesKey(st);
    // A layer whose file arrives later still goes into its place (population.js LAYER_IDS: density, places, cities),
    // under the next population layer already on the map, else under the county lines.
    const ids = PN().LAYER_IDS;
    parts.layers.forEach(l => {
      if (map.getLayer(l.id)) { map.setLayoutProperty(l.id, 'visibility', l.layout.visibility); return; }
      const next = ids.slice(ids.indexOf(l.id) + 1).find(id => map.getLayer(id));
      map.addLayer(l, next || 'county-lines');
    });
    pcNames(st);
  }
  // The names as page elements: one marker per name the page asks for, the largest places first; a name is hidden
  // where it would cover a county name shown or a name placed before it, or lies outside the map.
  function pcNames(st) {
    const P = PN();
    const want = P && pcOn(st) && st.pc.names ? P.names(st.pc.on, st.pc.names) : [];
    const key = JSON.stringify(want.map(n => [n.name, n.kind, n.lon, n.lat]));
    if (key !== st.pcNameKey) {
      (st.pcLabels || []).forEach(m => m.remove());
      st.pcLabels = want.map(n => {
        const el = root.document.createElement('div');
        el.className = 'county-label pc-name' + (n.kind === 'cdp' ? ' pc-cdp' : '');
        el.textContent = n.name;
        return new root.maplibregl.Marker({ element: el }).setLngLat([n.lon, n.lat]).addTo(st.map);
      });
      st.pcNameKey = key;
    }
    placePcNames(st);
  }
  // Each population name shown or hidden for where it falls now (see pcNames).
  function placePcNames(st) {
    if (!st.pcLabels || !st.pcLabels.length) return;
    const map = st.map, c = map.getContainer(), W0 = c.clientWidth, H0 = c.clientHeight;
    const boxOf = (m, w, h) => {
      const q = map.project(m.getLngLat());
      return { x0: q.x - w / 2, x1: q.x + w / 2, y0: q.y - h / 2, y1: q.y + h / 2 };
    };
    const meet = (a, b) => Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) && Math.min(a.y1, b.y1) > Math.max(a.y0, b.y0);
    const taken = shownNames(st).map(m => boxOf(m, m.getElement().offsetWidth, m.getElement().offsetHeight));
    st.pcShown = [];
    st.pcLabels.forEach(m => {
      const el = m.getElement();
      el.classList.remove('collided');
      const b = boxOf(m, el.offsetWidth, el.offsetHeight);
      const show = b.x0 >= 0 && b.y0 >= 0 && b.x1 <= W0 && b.y1 <= H0 && !taken.some(t => meet(t, b));
      el.classList.toggle('collided', !show);
      if (show) {
        taken.push(b);
        st.pcShown.push(el.textContent);
      }
    });
  }
  // The names shown on the map now: Washington's county names and the neighboring regions' (page elements).
  function shownNames(st) {
    const all = (st.labelsVisible && st.map.getZoom() >= LABEL_MIN_ZOOM ? st.labels : [])
      .concat(...Object.keys(st.nr.labels).map(id => [st.nr.labels[id].name].concat(st.nr.labels[id].counties)));
    return all.filter(m => !m.getElement().classList.contains('hidden'));
  }
  // The credits the population layers add while drawn, for the screenshot (the map's control lists them itself).
  const pcCredits = st => (PN() && pcOn(st) ? PN().credits(st.pc.on, { live: true }) : []);
  // Hover: the city or place under the pointer, and the tract's density, where the kind shows nothing.
  function pcHover(st, e, tip) {
    const map = st.map;
    if (st.switching || !pcOn(st)) { tip.remove(); return; }
    const mine = (st.kind.hoverLayers ? st.kind.hoverLayers(st) : []).filter(id => map.getLayer(id));
    if (mine.length && map.queryRenderedFeatures(e.point, { layers: mine }).length) { tip.remove(); return; }
    const lines = [];
    let outline = false;
    for (const [layer, id] of PC_HOVER) {
      if (!st.pc.on[layer] || !map.getLayer(id) || (outline && layer !== 'density')) continue;
      const f = map.queryRenderedFeatures(e.point, { layers: [id] })[0];
      if (!f) continue;
      if (lines.length) lines.push(null);
      lines.push(...PN().hoverLines(layer, f.properties));
      if (layer !== 'density') outline = true;
    }
    if (!lines.length) { tip.remove(); return; }
    const box = root.document.createElement('div');
    let first = true;
    lines.forEach(t => {
      if (t === null) { box.appendChild(root.document.createElement('hr')); first = true; return; }
      const d = root.document.createElement(first ? 'strong' : 'div');
      d.textContent = t;
      box.appendChild(d);
      if (first) box.appendChild(root.document.createElement('br'));
      first = false;
    });
    st.pcHoverText = lines.filter(t => t !== null);   // test hook
    tip.setDOMContent(box).setLngLat(e.lngLat);
    if (!tip.isOpen()) tip.addTo(map);
  }

  // Drawing order: largest circles first (drawn underneath), stable for ties, a missing radius (NA, e.g. from an
  // infinite count) last, like R's order(-radius_px). Returns indexes into d.
  function drawOrder(d) {
    const bad = x => x === null || x === undefined || Number.isNaN(x);
    return d.map((r, i) => i).sort((a, b) => {
      const x = d[a].radius_px, y = d[b].radius_px;
      if (bad(x) || bad(y)) return bad(x) === bad(y) ? a - b : bad(x) ? 1 : -1;
      return y - x || a - b;
    });
  }

  // d: circle rows from aggregate.build(); opts: { palette, opacity, amounts (formatR strings, one per row),
  // spotlight (county names; empty or missing = none), shade (CH: { counties: [{ name, color, none, tip }], opacity }
  // in place of the circles, or null) }
  function draw(st, d, opts) {
    if (st.failed) return;
    if (!st.ready || st.switching) { st.pending = { d, opts }; return; }
    st.last = { d, opts };
    st.clearHover();
    if (drawShade(st, opts.shade || null, opts.spotlight)) d = [];
    const P = root.CVIWA.palettes, op = Number(opts.opacity);
    const idx = drawOrder(d);
    const features = idx.map((i, k) => {
      const r = d[i], amount = opts.amounts[i];   // same padded format() string as the live tooltip
      return { type: 'Feature', id: k + 1, geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
        properties: { county: r.county, direction: r.direction, amount, color: P.circleColor(opts.palette, r.direction), radius_px: r.radius_px } };
    });
    const split = root.CVIWA.summary.spotlightSplit(features.map(f => f.properties), opts.spotlight);
    const pick = set => set ? features.filter(f => set.indexOf(f.properties) >= 0) : [];
    const parts = { circles: split.all ? features : [], circles_dim: pick(split.dim), circles_spotlight: pick(split.spot) };
    const hoverPaint = ['case', ['boolean', ['feature-state', 'hover'], false], Math.min(1, op + 0.25), op];
    st.circleOpacity = {};
    LAYERS.forEach(([id, source]) => {
      st.circleOpacity[id] = id === 'circles_dim' ? root.CVIWA.summary.DIM_OPACITY : hoverPaint;
      st.map.getSource(source).setData({ type: 'FeatureCollection', features: parts[id] });
      st.map.setPaintProperty(id, 'circle-opacity', st.circleOpacity[id]);
    });
    st.drawn = features;
    st.layers = { circles: parts.circles, circles_dim: parts.circles_dim, circles_spotlight: parts.circles_spotlight };
  }

  // CH: the shaded counties (shade: { counties, opacity }) or none. Each county outside a spotlight is dimmed and each
  // spotlit one outlined. Returns whether the map is shaded (the circles are then left empty). The county lines turn
  // white (Auto) or back as the map turns shaded or not.
  function drawShade(st, shade, spotlight) {
    const was = !!st.shade;
    const spot = new Set(spotlight || []);
    st.shade = shade ? { opacity: shade.opacity, features: shade.counties.map((c, k) => {
      const feat = st.geo.counties.features.find(f => f.properties.name === c.name);
      return { type: 'Feature', id: k + 1, geometry: feat.geometry, properties: { name: c.name, color: c.color || '#000000',
        none: !!c.none, dim: spot.size > 0 && !spot.has(c.name), spot: spot.has(c.name), tip: JSON.stringify(c.tip) } };
    }) } : null;
    st.shadeDrawn = st.shade ? st.shade.features.map(f => f.properties) : [];   // test hook
    const map = st.map;
    if (st.shade && !map.getSource('choro_source')) {
      addHatch(map);
      map.addSource('choro_source', { type: 'geojson', data: shadeCollection(st) });
      // Above Washington's land, under the population layers and the county lines.
      const ids = root.WSDA && root.WSDA.population ? root.WSDA.population.LAYER_IDS : [];
      const before = ids.find(id => map.getLayer(id)) || 'county-lines';
      shadeBaseLayers(st).forEach(l => map.addLayer(l, before));
      map.addLayer(shadeSpotLayer());
    } else if (st.shade) {
      map.getSource('choro_source').setData(shadeCollection(st));
      map.setPaintProperty('choro-fill', 'fill-opacity', shadeOpacity(st));
    } else if (map.getSource('choro_source')) {
      ['choro-spot', 'choro-none', 'choro-fill'].forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
      map.removeSource('choro_source');
    }
    if (was !== !!st.shade) applyContrast(st);
    return !!st.shade;
  }

  // The camera as jumpTo() takes it; the opening view (CVI's .WA_VIEW_BOUNDS) for the map's current size.
  const camera = st => ({ center: st.map.getCenter(), zoom: st.map.getZoom(), bearing: st.map.getBearing(),
    pitch: st.map.getPitch() });
  function fitView(st) { st.map.fitBounds(WA_VIEW_BOUNDS, { padding: 24, animate: false }); }

  // Compare (a deliberate difference from CVI, whose two maps move separately): moving either map moves
  // the other to the same center, zoom, bearing and pitch. The other map starts where this one is.
  function link(a, b) {
    let busy = false;
    const follow = (src, dst) => src.map.on('move', () => {
      // A hidden map neither follows nor leads (MapLibre resizes a map that was just hidden a moment later).
      if (busy || dst.failed || !dst.map.getCanvas().clientWidth || !src.map.getCanvas().clientWidth) return;
      busy = true;
      try { dst.map.jumpTo(camera(src)); }
      finally { busy = false; }
    });
    follow(a, b); follow(b, a);
    b.map.jumpTo(camera(a));
  }

  function setLabels(st, visible) { st.labelsVisible = !!visible; if (st.ready) { applyLabelVisibility(st); placePcNames(st); } }
  // The county lines ("Show county outlines") switched on or off.
  function setLines(st, visible) {
    st.linesVisible = !!visible;
    if (st.ready && !st.switching) st.map.setLayoutProperty('county-lines', 'visibility', visible ? 'visible' : 'none');
  }

  // ---- S3: tile basemaps ------------------------------------------------------------------------------------------
  // st.basemap is the basemap chosen (null: the offline county map); st.shown the one whose style is on the map (null
  // while a vector style is being read, and after a fallback: the offline style is on the map then). Every request
  // MapLibre makes comes through gate() (transformRequest): only the hosts of the basemap on the map pass, nothing on the
  // network for the offline style. A refused request is never sent; it is recorded in st.blocked (cleared per choice).
  function gate(st, url, kind) {
    const B = root.CVIWA.basemaps;
    if (st && kind === 'Tile') st.tileTries++;
    if (B.allowed(url, st ? st.shown : null)) return /^https:/i.test(url) ? { url: PREFIX + url } : { url };
    let host = String(url);
    try { host = new URL(url).host || host; } catch (e) { /* keep the address */ }
    if (st) st.blocked.push(String(url));
    const e = new Error('Blocked a request to ' + host + ': not one of the chosen basemap\'s hosts.');
    e.refused = true;
    throw e;
  }

  // The page's own request for a basemap file: only https to a host of the list (the gate has already checked it is the
  // chosen basemap's), redirects refused (a redirect could lead anywhere the CSP allows), no cookies or other
  // credentials, no referrer. Answers in the form MapLibre's request handlers use; an HTTP error carries its status (a
  // missing tile, 404, is then skipped by MapLibre as before).
  function basemapFetch(url, type, signal) {
    const B = root.CVIWA.basemaps;
    const mark = e => { e.basemapRequest = true; return e; };
    if (!/^https:/i.test(url)
      || !B.LIST.some(b => B.allowed(url, b))) return Promise.reject(mark(new Error('Not a basemap address: ' + url)));
    return root.fetch(url, { redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', signal,
      headers: type === 'json' ? { Accept: 'application/json' } : {} })
      .then(r => {
        if (!r.ok) { const e = mark(new Error('HTTP ' + r.status + ' from ' + new URL(url).host)); e.status = r.status; throw e; }
        const body = type === 'json' ? r.json() : type === 'string' ? r.text() : r.arrayBuffer();
        return body.then(data => ({ data, cacheControl: r.headers.get('Cache-Control'), expires: r.headers.get('Expires') }));
      }, e => { throw (e && e.name === 'AbortError') ? e : mark(e instanceof Error ? e : new Error(String(e))); });
  }
  let protocolAdded = false;
  // The basemap request handler registered with MapLibre once: its requests go through basemapFetch().
  function addProtocol() {
    if (protocolAdded) return;
    protocolAdded = true;
    root.maplibregl.addProtocol(PROTOCOL, (params, ac) => basemapFetch(params.url.slice(PREFIX.length), params.type, ac.signal));
  }

  // b: an entry of basemaps.LIST, or null for the offline county map. A vector style is read here (through the same
  // checks), so MapLibre is always handed a whole style with the page's own layers already in it: it then never waits on
  // a style that is still loading, or that failed. While it is read the offline style is shown, so the previous basemap
  // gets no more requests; a newer choice aborts the read.
  function setBasemap(st, b) {
    const B = root.CVIWA.basemaps, token = ++st.token;
    if (st.styleFetch) { st.styleFetch.abort(); st.styleFetch = null; }
    st.basemap = b || null; st.basemapFailed = false; st.fallback = false; st.blocked = [];
    applyContrast(st);
    if (!st.ready || st.failed) return;
    if (!b) return show(st, null, BASE_STYLE());
    addProtocol();
    if (b.type === 'raster') return show(st, b, B.style(b));
    if (!B.allowed(b.style, b)) return styleFailed(st, b, new Error('The style address is not one of the basemap\'s hosts.'));
    if (st.shown) show(st, null, BASE_STYLE());
    const ac = new root.AbortController(),
      late = root.setTimeout(() => ac.abort(new Error('The style did not arrive.')), config.watchMs);
    st.styleFetch = ac;
    basemapFetch(b.style, 'json', ac.signal)
      .then(r => { if (token === st.token) { st.styleFetch = null; show(st, b, r.data); } })
      .catch(e => { if (token === st.token) { st.styleFetch = null; styleFailed(st, b, e); } })
      .finally(() => root.clearTimeout(late));
  }
  // A style put on the map with the page's own sources and layers (b: its basemap, null for the offline style); a
  // basemap's tiles are then watched.
  function show(st, b, style) {
    st.shown = b; st.tilesOk = 0; st.tileTries = 0; st.sourceErrors = 0;
    applyContrast(st);
    if (st.watch) { root.clearTimeout(st.watch); st.watch = null; }
    if (b) watch(st, b);
    st.clearHover();
    st.switching = true;
    try { st.map.setStyle(withOwn(st, style), { diff: false }); }
    catch (e) { if (b) styleFailed(st, b, e); else throw e; }
  }
  // The basemap's style could not be read or used: the offline style is drawn instead, and the page is told once.
  function styleFailed(st, b, e) {
    if (st.basemap !== b || st.basemapFailed) return;
    st.basemapFailed = true; st.fallback = true;
    applyContrast(st);
    show(st, null, BASE_STYLE());
    if (st.onBasemapError) st.onBasemapError(b, (e && e.message) || String(e));
  }

  // An error from the basemap on the map. Tiles, sprites, fonts and other requests that fail are left to the idle check
  // below (one missing piece does not stop a basemap that draws); a source that cannot be read is counted for it. Only
  // a style that MapLibre cannot use (no source, not a request) fails at once, outside the error event.
  function basemapProblem(st, e) {
    const b = st.shown, err = e.error || {};
    if (!b || b !== st.basemap || st.basemapFailed) return;
    if (e.sourceId && !e.tile) st.sourceErrors++;
    if (st.switching && !e.sourceId && !e.tile && err.status === undefined && !err.basemapRequest) {
      const token = st.token;
      root.setTimeout(() => { if (st.token === token && st.shown === b) styleFailed(st, b, err); }, 0);
    }
  }
  // No tile of the basemap has loaded, and the map is idle (or, timedOut, still busy after config.watchMs): the
  // basemap is not loading. The county land fill comes back over its background and the page is told once. Not while
  // the map is hidden (the right map outside Compare) or when nothing was asked for at this zoom (outside the
  // basemap's zoom range).
  function noTiles(st, timedOut) {
    const b = st.shown;
    if (!b || b !== st.basemap || st.basemapFailed || st.tilesOk > 0 || !st.map.getCanvas().clientWidth) return;
    if (st.switching) { if (timedOut) styleFailed(st, b, new Error('The style did not load.')); return; }
    if (timedOut ? st.map.loaded() : !(st.tileTries || st.sourceErrors)) return;
    st.basemapFailed = true;
    applyContrast(st);
    setLand(st);
    if (st.onBasemapError) st.onBasemapError(b, timedOut ? 'No map tiles arrived.' : 'No map tiles could be loaded.');
  }
  // Tiles with data arrived after the basemap was counted as not loading (slow network): it is shown after all.
  function recovered(st) {
    st.basemapFailed = false;
    applyContrast(st);
    setLand(st);
    if (st.onBasemapRecovered) st.onBasemapRecovered(st.shown);
  }
  // After config.watchMs, whether the basemap's tiles are loading (noTiles); later again while the map cannot draw.
  function watch(st, b) {
    st.watch = root.setTimeout(() => {
      st.watch = null;
      if (st.shown !== b) return;
      // The map hidden (right map outside Compare) or the page in a background tab (no animation frames, so MapLibre
      // cannot finish a style there): look again later.
      if (!st.map.getCanvas().clientWidth || root.document.hidden) return watch(st, b);
      noTiles(st, true);
    }, config.watchMs);
  }
  // Label style and Boundary style (CVI's .resolve_label_boundary_style, basemaps.contrast): "auto" follows the basemap
  // on the map (dark or not): while a vector style is read, and after a failure, the county map is on screen, so Auto
  // gives its colors. The
  // HTML labels take the colors through CSS variables on the map; the county lines through their paint.
  function setContrast(st, labelStyle, boundaryStyle) {
    st.labelStyle = labelStyle || 'auto'; st.boundaryStyle = boundaryStyle || 'auto';
    applyContrast(st);
  }
  // The label and boundary colors for the map now, put on the names (CSS variables) and on the lines' paint.
  function applyContrast(st) {
    const b = st.shown, dark = !!(b && b.dark && !st.basemapFailed);
    let c = root.CVIWA.basemaps.contrast(st.labelStyle || 'auto', st.boundaryStyle || 'auto', dark);
    if (st.kind.contrast) c = st.kind.contrast(st, c, dark);   // the kind's own colors (e.g. County Focus's)
    st.contrast = c;
    const el = st.map.getContainer();
    el.style.setProperty('--county-label', c.label); el.style.setProperty('--county-halo', c.halo);
    // The movement view's county names: dark text a little darker over its white halo (13C), light text unchanged.
    el.style.setProperty('--county-label-strong', c.halo === '#ffffff' ? MC_LABEL_DARK : c.label);
    el.style.setProperty('--pc-name', c.halo === '#ffffff' ? PC_NAME_DARK : c.label);
    if (st.ready && !st.switching && st.map.getLayer('county-lines')) {
      st.map.setPaintProperty('county-lines', 'line-color', c.line);
      Object.keys(st.nr.data).forEach(id => ['counties', 'outline'].forEach(part => {
        if (st.map.getLayer('nr-' + id + '-' + part)) st.map.setPaintProperty('nr-' + id + '-' + part, 'line-color', c.line);
      }));
      if (st.kind.applyContrast) st.kind.applyContrast(st);
    }
  }

  // The basemap's credit opened on the map whenever a basemap is shown (the compact attribution folds to "i" on the
  // first drag and would otherwise stay folded for a basemap chosen later).
  function openCredit(st) {
    const c = st.map.getContainer().querySelector('.maplibregl-ctrl-attrib.maplibregl-compact');
    if (c && !c.classList.contains('maplibregl-compact-show')) { c.classList.add('maplibregl-compact-show'); c.setAttribute('open', ''); }
  }

  // The attribution as the map shows it (sources and the page's own credit), and the basemap's and the neighboring
  // regions' credits if the map has not shown them yet.
  function attributionText(st) {
    const el = st.map.getContainer().querySelector('.maplibregl-ctrl-attrib-inner');
    let t = el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
    (st.shown ? [st.shown.attribution] : []).concat(nrCredits(st), pcCredits(st)).forEach(c => {
      if (t.indexOf(c) < 0) t = t ? t + ' | ' + c : c;
    });
    return t;
  }
  // Drawn at the bottom right of the picture, wrapped to its width, on a white band as the map control shows it.
  function drawAttribution(g, out, k, text) {
    const size = 10 * k, pad = 3 * k, maxW = out.width - 2 * pad - 4 * k;
    g.font = size + 'px ' + root.getComputedStyle(root.document.body).fontFamily;
    const lines = [];
    text.split(' ').forEach(w => {
      const last = lines.length ? lines[lines.length - 1] : null;
      if (last !== null && g.measureText(last + ' ' + w).width <= maxW) lines[lines.length - 1] = last + ' ' + w;
      else lines.push(w);
    });
    const lh = size * 1.3, w = Math.min(out.width, Math.max(...lines.map(l => g.measureText(l).width)) + 2 * pad),
      h = lines.length * lh + 2 * pad;
    g.fillStyle = 'rgba(255, 255, 255, 0.85)'; g.fillRect(out.width - w, out.height - h, w, h);
    g.fillStyle = '#333333'; g.textAlign = 'right'; g.textBaseline = 'top';
    lines.forEach((l, i) => g.fillText(l, out.width - pad, out.height - h + pad + i * lh));
  }


  // Screenshot (CVI's add_screenshot_control, mapgl 0.4.6 settings: filename "map-screenshot", controls hidden,
  // image scale 1). The map's own pixels, from a frame drawn on the spot (map.redraw) and read in the same task, with
  // the county labels drawn on top as the map shows them (they are page elements here, map text in CVI). Saved
  // through the browser's download from a blob: address, straight from the click (as the sample bundle's download);
  // nothing leaves the page. The page says where the picture went, or why it could not be made.
  function capture(st) {
    if (!st.ready || st.failed) throw new Error('The map is not ready.');
    const map = st.map;
    map.redraw();
    const src = map.getCanvas(), out = root.document.createElement('canvas');
    out.width = src.width; out.height = src.height;
    const g = out.getContext('2d'), k = src.width / src.clientWidth;
    g.drawImage(src, 0, 0);
    if (st.kind.capture) st.kind.capture(st, g, k);   // the kind's own page elements under the names (County Focus counts)
    // Washington's county names as before (less any the map's kind has hidden, class "covered": the Premise Lookup
    // map's names that would cover its sites); the neighboring regions' names and county names as the map shows them.
    const family = root.getComputedStyle(root.document.body).fontFamily;
    const waNames = st.labels.filter(m => !m.getElement().classList.contains('covered'));
    const marks = (st.labelsVisible && map.getZoom() >= LABEL_MIN_ZOOM ? waNames : [])
      .concat(...Object.keys(st.nr.labels).map(id =>
      [st.nr.labels[id].name].concat(st.nr.labels[id].counties).filter(m => !m.getElement().classList.contains('hidden'))));
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    st.lastLabels = [];   // test hook: the names drawn
    st.lastLabelFonts = [];   // test hook: the font each name was drawn in
    // The population layers' names shown, in their own style (index.html .pc-name), under the county names.
    st.lastPcNames = [];   // test hook
    (st.pcLabels || []).filter(m => !m.getElement().classList.contains('collided')).forEach(m => {
      const q = map.project(m.getLngLat()), el = m.getElement(), cs = root.getComputedStyle(el);
      g.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + (parseFloat(cs.fontSize) * k) + 'px ' + family;
      g.strokeStyle = st.contrast.halo; g.lineWidth = 3 * k; g.strokeText(el.textContent, q.x * k, q.y * k);
      g.fillStyle = cs.color; g.fillText(el.textContent, q.x * k, q.y * k);
      st.lastPcNames.push(el.textContent);
    });
    marks.forEach(m => {
      const q = map.project(m.getLngLat()), x = q.x * k, y = q.y * k, el = m.getElement(), t = el.textContent;
      if (x < 0 || y < 0 || x > out.width || y > out.height) return;
      const region = el.classList.contains('region-name');
      // A Washington county name while the movement view is on (13C): larger, semibold, a wider halo.
      const mv = !!st.mc && !region && !el.classList.contains('neighbor-county');
      g.font = region ? '600 ' + (12 * k) + 'px ' + family
        : mv ? MC_LABEL.weight + ' ' + (MC_LABEL.size * k) + 'px ' + family : (11 * k) + 'px ' + family;
      g.letterSpacing = region ? (0.48 * k) + 'px' : '0px';   // as the page's 0.04em (ignored where not supported)
      g.strokeStyle = st.contrast.halo; g.lineWidth = (mv ? 2 * MC_LABEL.halo : 3) * k; g.strokeText(t, x, y);
      g.fillStyle = mv && st.contrast.halo === '#ffffff' ? MC_LABEL_DARK : st.contrast.label; g.fillText(t, x, y);
      st.lastLabels.push(t);
      st.lastLabelFonts.push(g.font);
    });
    g.letterSpacing = '0px';
    st.lastAttribution = null;
    if (st.shown || nrCredits(st).length || pcCredits(st).length) {
      st.lastAttribution = attributionText(st); drawAttribution(g, out, k, st.lastAttribution);
    }
    return out;
  }
  function screenshot(st) {   // the picture as a PNG blob
    return new Promise((resolve, reject) => {
      try { capture(st).toBlob(b => (b ? resolve(b) : reject(new Error('The picture could not be made.'))), 'image/png'); }
      catch (e) { reject(e); }
    });
  }
  function saveScreenshot(st) {   // synchronous, so the download starts within the click
    const name = shotFileName(st), blob = savePng(capture(st), name);
    st.lastScreenshot = { bytes: blob.size, at: Date.now(), name };   // test hook
    return blob;
  }
  // The camera picture's file name: the day, the view and "map" (2026-10-19_CountyFocus_map.png), so pictures from
  // several views and days do not overwrite each other. st.shotName (a name, or a function giving one) is set by the
  // page; without it, CVI's map-screenshot.png.
  function shotFileName(st) {
    const view = typeof st.shotName === 'function' ? st.shotName() : st.shotName;
    if (!view) return 'map-screenshot.png';
    const d = new Date(), two = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + '_' + view + '_map.png';
  }
  // What the camera button says once its picture is handed to the browser.
  const shotSaved = name => name + ' was handed to your browser to save (usually your Downloads folder). It shows ' +
    'locations: handle it as sensitive data. If no file appears, your browser or IT policy blocked the download.';
  // A picture saved through the browser's download (also used by the Flow map), as map-screenshot.png unless named.
  function savePng(canvas, name) {
    const png = canvas.toDataURL('image/png'), head = 'data:image/png;base64,';
    if (png.indexOf(head) !== 0) throw new Error('The picture could not be made.');
    const bin = root.atob(png.slice(head.length)), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'image/png' });
    const url = root.URL.createObjectURL(blob), a = root.document.createElement('a');
    a.href = url; a.download = name || 'map-screenshot.png'; a.hidden = true; root.document.body.appendChild(a); a.click(); a.remove();
    root.setTimeout(() => root.URL.revokeObjectURL(url), 10000);
    return blob;
  }
  // The camera button (top right) as a MapLibre control: a click saves the picture and says so.
  function screenshotControl(st) {
    let box = null;
    return {
      onAdd() {
        box = root.document.createElement('div'); box.className = 'maplibregl-ctrl maplibregl-ctrl-group';
        const b = root.document.createElement('button');
        b.type = 'button'; b.className = 'map-screenshot'; b.title = 'Capture screenshot'; b.setAttribute('aria-label', 'Capture screenshot');
        b.innerHTML = root.CVIWA.icons ? root.CVIWA.icons.camera : '';
        b.addEventListener('click', () => {
          const say = msg => { if (st.notify) st.notify(msg); };
          try { saveScreenshot(st); say(shotSaved(st.lastScreenshot.name)); }
          catch (e) { say('Screenshot not saved: ' + ((e && e.message) || String(e))); }
        });
        box.appendChild(b); return box;
      },
      onRemove() { if (box) box.remove(); box = null; }
    };
  }

  // The house button in the zoom group: the page's own fit when it has one, else the opening view.
  function fitButton(st) {
    const b = root.document.createElement('button');
    b.type = 'button'; b.className = 'map-fit'; b.title = 'Fit to Washington'; b.setAttribute('aria-label', 'Fit to Washington');
    b.innerHTML = root.CVIWA.icons ? root.CVIWA.icons.house : '';
    b.addEventListener('click', () => { if (st.onFit) st.onFit(); else if (st.ready && !st.failed) fitView(st); });
    return b;
  }

  root.CVIWA = root.CVIWA || {};
  root.CVIWA.map = { create, draw, link, camera, fitView, setLabels, setLines, setBasemap, attributionText, screenshot,
    saveScreenshot, savePng, shotFileName, shotSaved, edgeLayer, EDGE, drawAttribution, drawOrder,
    setContrast, setNeighbor, setPopulation, isOwn, landColor, WA_KIND, setMovement, MC_LAYERS, SHADE_LAYERS, SHADE_DIM,
    SHADE_SPOT, MC_SOURCES, WA_VIEW_BOUNDS, LAYERS, OWN_SOURCES, PROTOCOL, NR_LABEL_MIN_ZOOM, LAND_PAINT, NR_LAND_PAINT,
    WA_LAND_WITH_NEIGHBORS, config,
    markId, markImage, markLayer, addMark };
})(typeof window !== 'undefined' ? window : globalThis);
