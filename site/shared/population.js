/* Population context: three context layers that come with the site, not from the user's files. They change no count,
 * statistic or class on any map; they only add a picture underneath, legend entries and credits. Shared by every
 * profile (it knows no page): the CVI page and the Infrastructure dashboard now, Premise Lookup (S11) and the Emergency
 * dashboard later.
 *
 *   cities   City limits (WA Department of Revenue, current), with each city's 2020 Census population
 *            (geo/citylimits-wa.js, window.WSDA_CITYLIMITS)
 *   places   Population centers: every 2020 Census place, cities, towns and census-designated places
 *            (geo/places-wa.js, window.WSDA_PLACES)
 *   density  Population density: people per square mile of land by 2020 Census tract, in six fixed classes
 *            (geo/tracts-wa.js, window.WSDA_TRACTS)
 *
 * The data files are written by build/derive_population.R. Their shapes are stored compactly (each file's "encoding"
 * field): a shape is a list of polygons, a polygon a list of rings (outline first, then holes), and a ring
 * [lon0, lat0, dlon1, dlat1, ...] in whole units of 1/10,000 degree: the first point, then each point's change from
 * the one before. decodeRing() and geometry() turn them back into longitude and latitude.
 *
 * The both-on rule: with city limits and population centers both on, the cities are outlined from the
 * Department of Revenue only, and the population centers switch draws the census-designated places only, each trimmed
 * to the part outside current city limits (the file's cdpOutsideCities; a place left with less than 10% of its land
 * is dropped by the build). So no city is outlined twice.
 *
 * on: { cities, places, density } (booleans); ramp: a key of RAMPS.
 *
 * load(layer, { base }) -> Promise<data>; base: the path from the page to the site folder (e.g. '../'). The file is
 *   added as a <script> the first time (file:// and http both work; the CSP is unchanged). A missing or broken file
 *   rejects, and a later call tries again.
 * loaded(layer) -> the layer's data once loaded, else null
 * decodeRing(ring) -> [[lon, lat], ...]; geometry(item) -> a GeoJSON MultiPolygon (decoded once per item)
 * classOf(density) -> 0 to 5, the class of BREAKS
 * outlines(on) -> { cities: [items], places: [items] }: what the outline layers draw now (the both-on rule)
 * credits(on, { live }) -> the credit lines for what is drawn
 * legendEntries(on, ramp) -> [{ type: 'line', label, dash } | { type: 'title', label } | { type: 'swatch', color, label }]
 * pngLegend(on, { ramp, pt, titlePt, width }) -> rows for branded.legendColumn under "POPULATION CONTEXT":
 *   a rule, the title, a small gap, one row per outline (a small outlined square, dashed for census-designated
 *   places) and the density title with its six classes in two columns of three; [] with every layer off. pt: the labels' size;
 *   titlePt: the title's; width: the column's inner width in points.
 * mapParts(on, { ramp }) -> { sources, layers } for MapLibre (ids in LAYER_IDS); only loaded layers are included
 * svgParts(on, project, { ramp, extent, clip, id }) -> { density, outlines }: SVG markup for the branded PNGs, in page
 *   points; extent { west, east, south, north } skips shapes outside it; clip: county features to cut to (County
 *   Focus, a county-filtered Infrastructure map)
 * names(on, { min, counties }) -> [{ name, kind, pop, lon, lat }]: the names to print, largest first; min: the smallest
 *   population named (WA State 10,000); counties: only the names whose point lies in these county features
 * placeNames(items, project, pt, area, taken, marks) -> { placed: [{ name, kind, x, y, box, over }], dropped: [name] }
 * nameMarkup(placed, pt) -> SVG text for the placed names (drawn over the data marks, with a halo)
 * hoverLines(layer, properties) -> the live map's hover text, one string per line; layer: 'cities', 'places' or
 *   'density'
 * exportParams(on) -> what export_params.json records: each switch and each data file's source and date
 * placeAt(lon, lat) -> { name, kind ('city' or 'cdp'), geoid } or null (S11): the city limits holding the point, else
 *   the census-designated place; needs the cities and places files loaded
 */
(function (root) {
  'use strict';
  const B = () => root.WSDA.branded;

  const LAYERS = ['cities', 'places', 'density'];
  const FILES = { cities: 'geo/citylimits-wa.js', places: 'geo/places-wa.js', density: 'geo/tracts-wa.js' };
  const GLOBALS = { cities: 'WSDA_CITYLIMITS', places: 'WSDA_PLACES', density: 'WSDA_TRACTS' };
  const LISTS = { cities: 'cities', places: 'places', density: 'tracts' };
  const SCALE = 10000;   // the files' whole units: 1/10,000 degree

  // People per square mile of land: under 10, 10-50, 50-250, 250-1,000, 1,000-5,000, 5,000 and over.
  // Fixed classes, so maps can be compared whatever data is loaded.
  const BREAKS = [10, 50, 250, 1000, 5000];
  const CLASS_LABELS = ['Under 10', '10 – 50', '50 – 250', '250 – 1,000', '1,000 – 5,000', '5,000 and over'];
  const DENSITY_TITLE = 'People per sq mi of land (2020)';
  // The density ramp, one hue from light to dark (lavender, at 65% opacity). It reuses none of
  // the page's data colors (direction and species palettes, facility colors, WSDA teal and blue, the movement view's
  // purple). Kept as a list of ramps so a later choice needs no new code.
  const RAMPS = {
    lavender: { name: 'Lavender', colors: ['#f0eff7', '#d8d5ea', '#b9b3d8', '#958cc0', '#6f65a3', '#4b4380'] }
  };
  const DEFAULT_RAMP = 'lavender';
  const DENSITY_OPACITY = 0.65;
  // Outlines: one mid neutral gray, solid for cities and towns, dashed for census-designated places, with a very
  // light fill of the same gray. A step lighter than #4d4d4d, the gray first tried.
  const OUTLINE = '#737373';
  const OUTLINE_FILL_OPACITY = 0.06;
  const NAME_COLOR = '#444444';
  // The space under the PNG legend's "POPULATION CONTEXT" heading, in the legend's text size.
  const GAP_UNDER_TITLE = 0.6;
  // The space above the density title when outline rows come before it, in the legend's text size (without it,
  // "Census-designated place" sat against the title).
  const GAP_ABOVE_DENSITY = 0.6;

  const CITY_CREDIT = 'City limits: WA Department of Revenue';
  const CENSUS_CREDIT = 'Population: U.S. Census Bureau, 2020 Census';

  // ── Loading ─────────────────────────────────────────────────────────────────────────────────────────────────
  const pending = Object.create(null);
  // A file counts as loaded only when every item has a shape (and every tract a class from 0 to 5), so a damaged file
  // is refused like a missing one instead of failing while drawing . Checked once per data object.
  const checked = new WeakMap();
  function loaded(layer) {
    const d = root[GLOBALS[layer]];
    if (!d || typeof d !== 'object') return null;
    if (!checked.has(d)) {
      const list = d[LISTS[layer]];
      const ok = Array.isArray(list) && list.length > 0 && list.every(x => x && Array.isArray(x.shape) &&
        (layer !== 'density' || (Number.isInteger(x.class) && x.class >= 0 && x.class <= 5)));
      checked.set(d, ok);
    }
    return checked.get(d) ? d : null;
  }
  // Load a layer's data file (a script) once; resolves with its data, rejects when it is missing or broken.
  function load(layer, opts) {
    if (!FILES[layer]) return Promise.reject(new Error('No population layer "' + layer + '".'));
    if (loaded(layer)) return Promise.resolve(loaded(layer));
    if (pending[layer]) return pending[layer];
    const base = (opts && opts.base) || '';
    pending[layer] = new Promise((resolve, reject) => {
      const s = root.document.createElement('script');
      const done = err => {
        s.onload = s.onerror = null;
        s.remove();
        delete pending[layer];
        const d = loaded(layer);
        if (err || !root[GLOBALS[layer]]) {
          reject(new Error('This layer\'s file is not in this copy of the site (' + FILES[layer] + ').'));
        } else if (!d) {
          reject(new Error('This layer\'s file is damaged in this copy of the site (' + FILES[layer] + ').'));
        } else resolve(d);
      };
      s.onload = () => done(null);
      s.onerror = () => done(true);
      s.src = base + FILES[layer];
      root.document.head.appendChild(s);
    });
    return pending[layer];
  }

  // ── Shapes ──────────────────────────────────────────────────────────────────────────────────────────────────
  // The running sums are whole numbers, so the decoded points are exact to the file's 1/10,000 degree.
  function decodeRing(v) {
    const out = [];
    let x = 0;
    let y = 0;
    for (let i = 0; i + 1 < v.length; i += 2) {
      x += v[i];
      y += v[i + 1];
      out.push([x / SCALE, y / SCALE]);
    }
    return out;
  }
  const geometries = new WeakMap();
  const boxes = new WeakMap();
  // An item's shape decoded into a MultiPolygon, decoded once.
  function geometry(item) {
    if (!geometries.has(item)) {
      geometries.set(item, { type: 'MultiPolygon', coordinates: item.shape.map(poly => poly.map(decodeRing)) });
    }
    return geometries.get(item);
  }
  // An item's bounding box (west, east, south, north), worked out once.
  function bboxOf(item) {
    if (!boxes.has(item)) {
      const b = { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity };
      for (const poly of geometry(item).coordinates) {
        for (const [lon, lat] of poly[0]) {
          if (lon < b.west) b.west = lon;
          if (lon > b.east) b.east = lon;
          if (lat < b.south) b.south = lat;
          if (lat > b.north) b.north = lat;
        }
      }
      boxes.set(item, b);
    }
    return boxes.get(item);
  }
  // True when box b meets extent e, or when there is no extent.
  const overlaps = (b, e) => !e || (b.west <= e.east && b.east >= e.west && b.south <= e.north && b.north >= e.south);

  // Point in polygon (ray casting) for the names of the shown counties; a point exactly on an edge may go either way.
  function inRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0];
      const yi = ring[i][1];
      const xj = ring[j][0];
      const yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  // True when the point is inside a polygon's outer ring and outside its holes.
  function inGeometry(x, y, g) {
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    return polys.some(p => inRing(x, y, p[0]) && !p.slice(1).some(h => inRing(x, y, h)));
  }

  // ── Classes, the both-on rule, credits, legend ──────────────────────────────────────────────────────────────
  function classOf(density) {
    let k = 0;
    while (k < BREAKS.length && density >= BREAKS[k]) k++;
    return k;
  }
  const rampOf = key => RAMPS[key] || RAMPS[DEFAULT_RAMP];
  const isCdp = p => p.kind === 'cdp';

  // A census-designated place as the both-on view draws it: its trimmed shape and label point when a city has
  // annexed part of it since 2020 (the build's cdpOutsideCities), else itself; null when dropped.
  function trimmedCdp(place, data) {
    if (place.trim === 'dropped') return null;
    if (place.trim !== 'clipped') return place;
    const t = (data.cdpOutsideCities || []).find(c => c.geoid === place.geoid);
    return t ? Object.assign({}, place, { label: t.label, shape: t.shape, share: t.share }) : null;
  }
  // Trimmed copies are made once per data object, so their decoded shapes are kept too.
  const cdpCache = new WeakMap();
  function cdpsOutside(data) {
    if (!cdpCache.has(data)) cdpCache.set(data, data.places.filter(isCdp).map(p => trimmedCdp(p, data)).filter(Boolean));
    return cdpCache.get(data);
  }
  // The city limits and places whose outlines are drawn for the layers shown.
  function outlines(on) {
    const o = on || {};
    const cities = o.cities && loaded('cities') ? loaded('cities').cities : [];
    const pd = o.places ? loaded('places') : null;
    const places = !pd ? [] : o.cities && cities.length ? cdpsOutside(pd) : pd.places;
    return { cities, places };
  }

  // S11 (Premise Lookup's place column): the city or census-designated place that holds a point. City limits (the
  // Department of Revenue's, current) come first; outside them, the Census's census-designated places (whole, as
  // published for 2020). Needs both files loaded (load('cities') and load('places')); null when neither holds it.
  function placeAt(lon, lat) {
    const c = loaded('cities'), p = loaded('places');
    if (!c || !p || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    const inside = item => {
      const b = bboxOf(item);
      return lon >= b.west && lon <= b.east && lat >= b.south && lat <= b.north && inGeometry(lon, lat, geometry(item));
    };
    const city = c.cities.find(inside);
    if (city) return { name: city.name, kind: 'city', geoid: city.geoid };
    const cdp = p.places.filter(isCdp).find(inside);
    return cdp ? { name: cdp.name, kind: 'cdp', geoid: cdp.geoid } : null;
  }

  // The credit lines for the layers shown (live: the live map's, which names the Census for city limits too).
  function credits(on, opts) {
    const o = on || {};
    const live = !!(opts && opts.live);
    const out = [];
    if (o.cities) out.push(CITY_CREDIT);
    // The live map's hover shows the cities' Census population, so its credit names the Census for any layer.
    if (o.places || o.density || (live && o.cities)) out.push(CENSUS_CREDIT);
    return out;
  }

  // The legend rows for the layers shown.
  function legendEntries(on, ramp) {
    const o = on || {};
    const out = [];
    if (o.cities) out.push({ type: 'line', label: 'City limits (current)', dash: false });
    if (o.places && !o.cities) out.push({ type: 'line', label: 'City or town, 2020', dash: false });
    if (o.places) out.push({ type: 'line', label: 'Census-designated place', dash: true });
    if (o.density) {
      out.push({ type: 'title', label: DENSITY_TITLE });
      rampOf(ramp).colors.forEach((c, k) => out.push({ type: 'swatch', color: c, label: CLASS_LABELS[k] }));
    }
    return out;
  }

  // The branded PNGs' legend rows (branded.legendColumn's entries), spaced by their size as legendColumn's rows are.
  function pngLegend(on, opts) {
    const BR = B();
    const o = opts || {};
    const list = legendEntries(on, o.ramp);
    if (!list.length) return [];
    const pt = o.pt;
    // A little space under the heading, so its first row does not crowd it.
    const out = [{ rule: true }, { text: 'POPULATION CONTEXT', pt: o.titlePt || pt, color: '#222222', bold: true },
      { gap: GAP_UNDER_TITLE * pt }];
    const box = dash => (x, y) => '<rect x="' + BR.num(x - 7) + '" y="' + BR.num(y - 4.5) + '" width="14" height="9" fill="' +
      OUTLINE + '" fill-opacity="' + OUTLINE_FILL_OPACITY + '" stroke="' + OUTLINE + '" stroke-width="' +
      BR.num(BR.linePt(dash ? 0.4 : 0.45)) + '"' + (dash ? ' stroke-dasharray="2.4 1.6"' : '') + '/>';
    const swatches = [];
    for (const e of list) {
      if (e.type === 'line') out.push({ sample: { height: 9, draw: box(e.dash) }, label: e.label, labelPt: pt,
        x: 0.14, labelX: 0.26 });
      else if (e.type === 'title') {
        if (list[0].type === 'line') out.push({ gap: GAP_ABOVE_DENSITY * pt });
        out.push({ text: e.label, pt, color: '#444444', italic: true });
      }
      else swatches.push(e);
    }
    if (swatches.length) {
      // Two columns of three classes, read down: under 10 to 250 on the left, 250 and over on the right.
      const rowH = Math.max(9, pt * 1.35);
      const colW = (o.width || 140) / 2;
      const draw = (x, y) => swatches.map((e, k) => {
        const cx = x - colW + (k < 3 ? 0 : colW) + 6;
        const cy = y + ((k % 3) - 1) * rowH;
        return '<rect x="' + BR.num(cx) + '" y="' + BR.num(cy - 3.5) + '" width="11" height="7" fill="' + e.color +
          '" fill-opacity="' + DENSITY_OPACITY + '" stroke="#bbbbbb" stroke-width="' + BR.num(BR.linePt(0.3)) + '"/>' +
          BR.text(e.label, cx + 14, cy, { pt, color: '#444444' });
      }).join('');
      out.push({ sample: { height: 3 * rowH, draw }, label: [], labelPt: pt, x: 0.5, labelX: 0.5 });
    }
    return out;
  }

  // ── The live map (MapLibre) ─────────────────────────────────────────────────────────────────────────────────
  // Sources pc_cities, pc_places, pc_density; layers in drawing order (density under the outlines, the cities' over
  // the places'). The caller adds them under its county lines and data marks, and calls mapParts() again (setData)
  // when a switch changes the both-on rule.
  const LAYER_IDS = ['pc-density', 'pc-places-fill', 'pc-places-line', 'pc-places-cdp', 'pc-cities-fill',
    'pc-cities-line'];
  const SOURCE_IDS = { cities: 'pc_cities', places: 'pc_places', density: 'pc_density' };
  const feature = (item, props) => ({ type: 'Feature', properties: props, geometry: geometry(item) });
  // The live map's sources and layers for the population layers.
  function mapParts(on, opts) {
    const o = on || {};
    const ramp = rampOf(opts && opts.ramp);
    const vis = v => ({ visibility: v ? 'visible' : 'none' });
    const sources = {};
    const layers = [];
    const cityData = loaded('cities');
    const lines = outlines(o);
    if (loaded('density')) {
      const d = loaded('density');
      sources.pc_density = { type: 'geojson', attribution: CENSUS_CREDIT, data: { type: 'FeatureCollection',
        features: d.tracts.map(t => feature(t, { geoid: t.geoid, pop: t.pop, density: t.density, cls: t.class })) } };
      const color = ['match', ['get', 'cls']];
      ramp.colors.forEach((c, k) => color.push(k, c));
      color.push(ramp.colors[0]);
      layers.push({ id: 'pc-density', type: 'fill', source: 'pc_density', layout: vis(o.density),
        paint: { 'fill-color': color, 'fill-opacity': DENSITY_OPACITY } });
    }
    if (loaded('places')) {
      const list = o.places ? lines.places : loaded('places').places;
      sources.pc_places = { type: 'geojson', attribution: CENSUS_CREDIT, data: { type: 'FeatureCollection',
        features: list.map(p => feature(p, { geoid: p.geoid, name: p.name, kind: p.kind, pop: p.pop,
          trimmed: p.share === undefined ? null : p.share })) } };
      layers.push({ id: 'pc-places-fill', type: 'fill', source: 'pc_places', layout: vis(o.places),
        paint: { 'fill-color': OUTLINE, 'fill-opacity': OUTLINE_FILL_OPACITY } });
      layers.push({ id: 'pc-places-line', type: 'line', source: 'pc_places', layout: vis(o.places),
        filter: ['!=', ['get', 'kind'], 'cdp'], paint: { 'line-color': OUTLINE, 'line-width': 1 } });
      layers.push({ id: 'pc-places-cdp', type: 'line', source: 'pc_places', layout: vis(o.places),
        filter: ['==', ['get', 'kind'], 'cdp'],
        paint: { 'line-color': OUTLINE, 'line-width': 1, 'line-dasharray': [3, 2] } });
    }
    if (cityData) {
      sources.pc_cities = { type: 'geojson', attribution: CITY_CREDIT + ' · ' + CENSUS_CREDIT, data: {
        type: 'FeatureCollection', features: cityData.cities.map(c => feature(c, { geoid: c.geoid, name: c.name,
          pop: c.pop === undefined ? null : c.pop })) } };
      layers.push({ id: 'pc-cities-fill', type: 'fill', source: 'pc_cities', layout: vis(o.cities),
        paint: { 'fill-color': OUTLINE, 'fill-opacity': OUTLINE_FILL_OPACITY } });
      layers.push({ id: 'pc-cities-line', type: 'line', source: 'pc_cities', layout: vis(o.cities),
        paint: { 'line-color': OUTLINE, 'line-width': 1.2 } });
    }
    return { sources, layers };
  }

  // ── The branded PNGs (SVG in page points) ───────────────────────────────────────────────────────────────────
  // The population layers as SVG for a branded PNG: { density, outlines }, each clipped when opts.clip is given.
  function svgParts(on, project, opts) {
    const o = on || {};
    const op = opts || {};
    const BR = B();
    const ext = op.extent || null;
    const id = op.id || 'map';
    const clipped = (tag, inner) => {
      if (!inner || !op.clip) return inner;
      const cid = 'pc-clip-' + id + '-' + tag;
      return '<clipPath id="' + cid + '">' + op.clip.map(f => '<path d="' + BR.pathData(f.geometry, project) +
        '"/>').join('') + '</clipPath><g clip-path="url(#' + cid + ')">' + inner + '</g>';
    };
    const path = (item, attrs) => '<path d="' + BR.pathData(geometry(item), project) + '" fill-rule="evenodd" ' +
      attrs + '/>';

    let density = '';
    const d = o.density ? loaded('density') : null;
    if (d) {
      const colors = rampOf(op.ramp).colors;
      const shapes = d.tracts.filter(t => overlaps(bboxOf(t), ext))
        .map(t => path(t, 'fill="' + colors[t.class] + '" stroke="none"'));
      density = clipped('density', '<g opacity="' + DENSITY_OPACITY + '">' + shapes.join('') + '</g>');
    }

    const lines = outlines(o);
    const fill = 'fill="' + OUTLINE + '" fill-opacity="' + OUTLINE_FILL_OPACITY + '"';
    const width = w => 'stroke="' + OUTLINE + '" stroke-width="' + BR.num(BR.linePt(w)) + '" stroke-linejoin="round"';
    const DASH = 'stroke-dasharray="2.4 1.6"';
    const parts = [];
    for (const p of lines.places.filter(x => overlaps(bboxOf(x), ext))) {
      parts.push(path(p, fill + ' ' + width(0.4) + (isCdp(p) ? ' ' + DASH : '')));
    }
    for (const c of lines.cities.filter(x => overlaps(bboxOf(x), ext))) {
      parts.push(path(c, fill + ' ' + width(0.45)));
    }
    const outlinesSvg = parts.length ? clipped('outlines', '<g>' + parts.join('') + '</g>') : '';
    return { density, outlines: outlinesSvg };
  }

  // ── Names ───────────────────────────────────────────────────────────────────────────────────────────────────
  // With both outline layers on, the city names come from the city limits and the census-designated places add
  // theirs (at their trimmed label point); one layer alone names its own.
  function names(on, opts) {
    const op = opts || {};
    const min = op.min || 0;
    const lines = outlines(on);
    const out = lines.cities.map(c => ({ name: c.name, kind: 'city', pop: c.pop, lon: c.label[0], lat: c.label[1] }))
      .concat(lines.places.map(p => ({ name: p.name, kind: isCdp(p) ? 'cdp' : 'city', pop: p.pop, lon: p.label[0],
        lat: p.label[1] })));
    const counties = op.counties || null;
    return out.filter(n => (n.pop || 0) >= min)
      .filter(n => !counties || counties.some(f => inGeometry(n.lon, n.lat, f.geometry)))
      .sort((a, b) => (b.pop || 0) - (a.pop || 0) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  // Names centered on their point, else just right, left, above or below it, never over another name or a box taken
  // (county names). A spot clear of the marks (data circles, facility markers) is preferred; a name with none goes over
  // the marks (names may go over the circles on every map, drawn on top with their halo; over: true). A name that fits
  // nowhere is left out. Largest places first.
  // True when two boxes overlap.
  const meet = (a, b) => Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) && Math.min(a.y1, b.y1) > Math.max(a.y0, b.y0);
  // True when a circle ({ x, y, r }) overlaps a box.
  const touches = (c, b) => {
    const dx = c.x - Math.max(b.x0, Math.min(c.x, b.x1));
    const dy = c.y - Math.max(b.y0, Math.min(c.y, b.y1));
    return dx * dx + dy * dy < c.r * c.r;
  };
  // Returns { placed: [{ name, kind, x, y, box, over }], dropped: [names left out] }.
  function placeNames(items, project, pt, area, taken, marks) {
    const BR = B();
    const used = (taken || []).slice();
    const placed = [];
    const dropped = [];
    for (const n of items) {
      const [px, py] = project(n.lon, n.lat);
      const w = BR.textWidth(n.name, pt, false) + 2;
      const h = pt * 1.1;
      const gap = pt * 0.4;
      const spots = [[px, py], [px + w / 2 + gap, py], [px - w / 2 - gap, py], [px, py - h - gap / 2],
        [px, py + h + gap / 2]];
      let hit = null;
      let over = null;
      for (const [x, y] of spots) {
        const b = { x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2 };
        if (b.x0 < area.x0 || b.x1 > area.x1 || b.y0 < area.y0 || b.y1 > area.y1) continue;
        if (used.some(u => meet(u, b))) continue;
        if ((marks || []).some(m => touches(m, b))) {
          if (!over) over = { x, y, box: b };
          continue;
        }
        hit = { x, y, box: b };
        break;
      }
      if (!hit && over) hit = Object.assign(over, { over: true });
      if (!hit) {
        dropped.push(n.name);
        continue;
      }
      used.push(hit.box);
      placed.push({ name: n.name, kind: n.kind, x: hit.x, y: hit.y, box: hit.box, over: !!hit.over });
    }
    return { placed, dropped };
  }
  // The placed names as SVG text with a white halo; census-designated places in italics.
  function nameMarkup(placed, pt) {
    const BR = B();
    return placed.map(n => BR.text(n.name, n.x, n.y, { pt, color: NAME_COLOR, italic: n.kind === 'cdp', anchor: 'middle',
      halo: { color: '#ffffff', opacity: 0.8, width: 2 * 0.25 * pt } })).join('');
  }

  // ── The live map's hover text and export_params.json ───────────────────────────────────────────────────────
  const comma = n => Math.round(n).toLocaleString('en-US');
  const popLine = pop => (pop === null || pop === undefined ? '2020 population not available'
    : '2020 population ' + comma(pop));
  // The live map's hover lines for a feature of one layer.
  function hoverLines(layer, props) {
    const p = props || {};
    if (layer === 'cities') {
      const d = loaded('cities');
      return [String(p.name), 'City limits, current (WA Department of Revenue' + (d && d.quarter ? ', ' + d.quarter : '') +
        ')', popLine(p.pop) + (p.pop === null || p.pop === undefined ? '' : ' (U.S. Census Bureau)')];
    }
    if (layer === 'places') {
      return [String(p.name), p.kind === 'cdp' ? 'Census-designated place' : 'City or town (2020 Census limits)',
        popLine(p.pop)];
    }
    if (layer === 'density') {
      return ['Census tract, 2020', comma(p.density) + ' people per sq mi of land', popLine(p.pop)];
    }
    return [];
  }
  // The population layers and their sources, as recorded in export_params.json.
  function exportParams(on) {
    const o = on || {};
    const c = loaded('cities');
    const p = loaded('places');
    const t = loaded('density');
    return {
      city_limits: !!o.cities, population_centers: !!o.places, population_density: !!o.density,
      sources: {
        city_limits: o.cities && c ? { source: c.credit, downloaded: c.downloaded, quarter: c.quarter,
          population_year: c.populationYear } : null,
        population_centers: o.places && p ? { source: p.credit, year: p.year } : null,
        population_density: o.density && t ? { source: t.credit, year: t.year } : null
      }
    };
  }

  root.WSDA = root.WSDA || {};
  root.WSDA.population = {
    LAYERS, FILES, GLOBALS, BREAKS, CLASS_LABELS, DENSITY_TITLE, RAMPS, DEFAULT_RAMP, DENSITY_OPACITY, OUTLINE,
    OUTLINE_FILL_OPACITY, NAME_COLOR, CITY_CREDIT, CENSUS_CREDIT, LAYER_IDS, SOURCE_IDS,
    load, loaded, decodeRing, geometry, classOf, outlines, credits, legendEntries, pngLegend, mapParts, svgParts, names,
    placeNames, nameMarkup, hoverLines, exportParams, placeAt
  };
})(typeof window !== 'undefined' ? window : globalThis);
