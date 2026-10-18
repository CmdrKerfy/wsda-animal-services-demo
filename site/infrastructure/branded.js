/* The Facilities branded PNG of the Infrastructure dashboard (S9): what the map shows on the shared
 * branded page (site/shared/branded.js). Structural parity with CVI's render_branded_facilities_map
 * (shiny/R/static_map_renderer.R 3465-4174, "SMR" below): the same title, tile grid, legend, marks and
 * colors, computed from the facilities and CVI activity the dashboard shows on screen (its layers, county and
 * attribute filters).
 *
 * Two output styles: "branded" (11 x 8.5 in: the teal header and logo, the tile grid, the legend in the gutter)
 * and "report" (6.5 x 3.3 in, for Word: a plain title, the map, a smaller legend and a one-line caption). Two
 * coverage views: "density" (a county choropleth of one layer's counts, Fisher classes and one of six color ramps)
 * when exactly one layer is shown and CVI activity is off, else "locations" (one circle per county per layer, sized
 * by Fisher classes of the counts; layers with name markers drawn as individual facilities, the ones alone in their
 * 0.12-degree cell named). The fallback from Density to Locations is reported (`fallback`) for CVI's notice.
 *
 * The page's own deliberate differences, as on the CVI page's maps: Web Mercator and the brand options of
 * branded.js. Here legendBySize spaces the legend's rows by their samples' sizes (CVI's rows run past the box when
 * CVI activity is on), and county names are placed by the page's own rule. Also: the Report caption's period only
 * with CVI activity, a Density map whose populated counties all have the same count gets one class (CVI stops with
 * "invalid number of intervals"), Density classes labeled by the counts they hold, and the CVI activity circles in
 * the dashboard's palette (as on screen).
 * Pure: model and SVG parts out; branded.svg() and branded.png() make the picture. */
(function (root) {
  'use strict';
  const B = () => root.WSDA.branded;
  const BM = () => root.CVIWA.brandedmaps;
  const S = () => root.CVIWA.scaling;

  const HDR_H = 0.092;
  const GRID_TOP = 1 - HDR_H - 0.044;   // the tile grid's top (SMR 3926-3931)
  const ROW_H = 0.052;
  const DODGE = 0.09;                    // degrees between the layers' circles of one county (SMR 3711)
  const CELL = 0.12;                     // the name-marker cells, degrees (SMR 1309)
  const SIZE_MIN = 3;                    // the glyph classes' sizes (SMR 1385)
  const SIZE_MAX = 15;
  const ZERO_FILL = '#e8e8e8';
  // The Density ramps, light to dark (SMR 3839-3846).
  const RAMPS = {
    blue: ['#cfe3f2', '#1C6FA8'], teal: ['#d0e8e4', '#1C7A6F'], green: ['#dcecd0', '#3C7A2E'],
    gold: ['#f6e6c8', '#C8892A'], purple: ['#e3d7ed', '#5E3A8C'], gray: ['#e4e4e4', '#4a4a4a']
  };
  const RAMP_LABELS = { blue: 'Blue (WSDA)', teal: 'Teal', green: 'Green', gold: 'Gold', purple: 'Purple', gray: 'Gray' };
  const GOLD = '#c8842c';
  const DARK_TEAL = '#245566';
  const FALLBACK_NOTICE = 'Density (choropleth) needs a single facility layer with CVI activity off. Showing ' +
    'proportional symbols instead.';
  const SOURCE = 'Data: facility layers as loaded · County boundaries: U.S. Census Bureau';
  const SOURCE_CVI = 'Data: facility layers as loaded, WSDA Animal Services CVI records · County boundaries: U.S. ' +
    'Census Bureau';
  const cmpEn = (a, b) => String(a).localeCompare(String(b), 'en');

  // ── Colors ──────────────────────────────────────────────────────────────────────────────────────────────────
  // R's colorRampPalette(ends)(n): each channel (as a fraction of 255) interpolated at seq(0, 1, length.out = n),
  // times 255, then cut to a whole number as rgb(..., maxColorValue = 255) does (it truncates, so 197.99999 is
  // 197); upper-case hex.
  function rampColors(ends, n) {
    const c = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
    const a = c(ends[0]);
    const b = c(ends[1]);
    const out = [];
    for (let i = 0; i < n; i++) {
      // approx() gives the ends exactly.
      const t = n === 1 ? 0 : i === n - 1 ? 1 : i * (1 / (n - 1));
      const v = (x, k) => (t === 0 ? x : t === 1 ? b[k] : x + (b[k] - x) * t);
      out.push('#' + a.map((x, k) => Math.trunc(v(x, k) * 255).toString(16).padStart(2, '0'))
        .join('').toUpperCase());
    }
    return out;
  }

  // ── Facilities as CVI counts them (cvi_split_facility_precision, map_helpers.R 791-858) ─────────────────────
  // A point is placed when its location is finite, in range and not 0, 0, and its precision flag is not "none";
  // "google_city" marks a town-level point (a town's center). Others count as unplaced.
  const placed = p => Number.isFinite(p.lon) && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 &&
    Math.abs(p.lon) <= 180 && !(p.lat === 0 && p.lon === 0) && p.geoSource !== 'none';
  // A layer's points split into located and town-level points (the towns grouped and named) and a count of
  // unplaced ones.
  function splitLayer(l) {
    const located = [];
    const town = [];
    let unplaced = 0;
    for (const p of l.points) {
      if (!placed(p)) unplaced++;
      else if (p.geoSource === 'google_city') town.push(p);
      else located.push(p);
    }
    // Town-level points at one rounded place are one town, named by the first town name its points carry (the
    // file's town column), else by its place (SMR 821-835).
    const towns = new Map();
    for (const p of town) {
      const key = (Math.round(p.lat * 1000) / 1000) + '_' + (Math.round(p.lon * 1000) / 1000);
      if (!towns.has(key)) towns.set(key, []);
      towns.get(key).push(p);
    }
    const townAgg = [...towns.keys()].sort(cmpEn).map(k => {
      const ps = towns.get(k);
      const lat = ps.reduce((s, p) => s + p.lat, 0) / ps.length;
      const lon = ps.reduce((s, p) => s + p.lon, 0) / ps.length;
      const named = ps.map(p => p.townName || '').find(t => t);
      return { town: named || lat.toFixed(3) + ', ' + lon.toFixed(3), lat, lon, n: ps.length };
    }).map((t, i) => Object.assign(t, { i })).sort((a, b) => b.n - a.n || a.i - b.i);
    return { located, town, townAgg, unplaced, count: located.length + town.length };
  }
  // Facilities per county (cvi_facility_county_counts, map_helpers.R 1221-1258): placed points by their county.
  function countyCounts(l) {
    const counts = new Map();
    let unplaced = 0;
    for (const p of l.points) {
      if (!placed(p)) {
        unplaced++;
        continue;
      }
      if (!p.county) continue;
      counts.set(p.county, (counts.get(p.county) || 0) + 1);
    }
    return { counts, unplaced };
  }

  // ── County anchors (.county_label_anchor, SMR 441-466) ──────────────────────────────────────────────────────
  // CVI's file of counties is in Web Mercator meters: per county, a 22 x 22 grid over its box, the grid point inside
  // it farthest from its border (the first one when two tie), back in longitude and latitude.
  const EARTH = 6378137;
  const RAD = Math.PI / 180;
  const toMerc = c => [c[0] * RAD * EARTH, Math.log(Math.tan(Math.PI / 4 + c[1] * RAD / 2)) * EARTH];
  const fromMerc = (x, y) => [x / EARTH / RAD, (2 * Math.atan(Math.exp(y / EARTH)) - Math.PI / 2) / RAD];
  // R's seq(a, b, length.out = n): n evenly spaced numbers from a to b, both ends exact.
  const seqR = (a, b, n) => Array.from({ length: n }, (_, i) => (i === 0 ? a : i === n - 1 ? b : a + i * ((b - a) / (n - 1))));
  // The distance from a point to a line segment.
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
  function anchorOf(geometry) {
    const polys = (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates)
      .map(poly => poly.map(ring => ring.map(toMerc)));
    const all = polys.flat(2);
    const xs = all.map(c => c[0]);
    const ys = all.map(c => c[1]);
    const gx = seqR(Math.min(...xs), Math.max(...xs), 22);
    const gy = seqR(Math.min(...ys), Math.max(...ys), 22);
    const rings = polys.flat();
    const inside = (x, y) => {
      let hit = false;
      for (const ring of rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, yi] = ring[i];
          const [xj, yj] = ring[j];
          if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
        }
      }
      return hit;
    };
    let best = null;
    for (const y of gy) {
      for (const x of gx) {
        if (!inside(x, y)) continue;
        let d = Infinity;
        for (const ring of rings) {
          for (let i = 1; i < ring.length; i++) {
            d = Math.min(d, segDist(x, y, ring[i - 1][0], ring[i - 1][1], ring[i][0], ring[i][1]));
          }
        }
        if (d > 0 && (!best || d > best.d)) best = { x, y, d };
      }
    }
    if (!best) return null;
    const [lon, lat] = fromMerc(best.x, best.y);
    return { lon, lat };
  }
  // Density applies when exactly one layer has placed facilities and CVI activity is off (SMR 3540-3546). The
  // dashboard grays its Density choice otherwise.
  function densityApplies(layers, activityOn) {
    if (activityOn) return false;
    return layers.filter(l => {
      const s = splitLayer(l);
      return s.located.length || s.town.length;
    }).length === 1;
  }
  let anchorCache = null;
  // Each county's label anchor by name, worked out once per county list.
  function anchors(features) {
    if (anchorCache && anchorCache.features === features) return anchorCache.map;
    const map = new Map();
    for (const f of features) map.set(f.properties.name, anchorOf(f.geometry));
    anchorCache = { features, map };
    return map;
  }

  // ── Classes ─────────────────────────────────────────────────────────────────────────────────────────────────
  const uniq = a => a.filter((v, i) => a.indexOf(v) === i);
  // R's findInterval(x, brks, rightmost.closed = TRUE, all.inside = TRUE): with all.inside the top break falls in the
  // last interval anyway, so rightmost.closed changes nothing.
  function findInterval(x, brks) {
    const nb = brks.length;
    let i = 0;
    while (i < nb && brks[i] <= x) i++;
    return Math.max(1, Math.min(nb - 1, i));
  }
  // The Density classes of one layer's county counts (SMR 3817-3851). When every populated county has the same
  // count CVI stops ("invalid number of intervals"); the page draws one class.
  function densityClasses(counts, rampKey) {
    const pos = counts.filter(c => c > 0);
    let brks = null;
    if (uniq(pos).length >= 2) {
      try {
        brks = S().fisherBreaks(pos, Math.min(5, uniq(pos).length));
      } catch (e) {
        brks = null;
      }
    }
    if (!brks || uniq(brks).length < 2) brks = uniq([0].concat(uniq(pos).sort((a, b) => a - b)));
    brks = uniq(brks);
    if (brks.length >= 2 && pos.length) {
      brks[0] = Math.min(...pos);
      brks = uniq(brks);
    }
    const single = brks.length < 2;
    if (single) brks = pos.length ? [pos[0], pos[0]] : [0, 0];
    const labels = BM().intervalLabels(brks);
    const cls = single ? counts.map(c => (c > 0 ? 1 : null))
      : S().bincode(counts, brks).map((b, i) => (counts[i] > 0 ? b : null));
    const colors = rampColors(RAMPS[rampKey] || RAMPS.blue, Math.max(1, labels.length));
    // Each class labeled by the counts its counties hold, "n" or "low – high".
    const countLabels = labels.map((l, k) => {
      const held = counts.filter((c, i) => cls[i] === k + 1);
      if (!held.length) return l;
      const lo = Math.min(...held);
      const hi = Math.max(...held);
      return lo === hi ? S().comma(lo) : S().comma(lo) + ' – ' + S().comma(hi);
    });
    return { breaks: brks, labels, cviLabels: labels, countLabels, colors, classOf: cls, single };
  }
  // The Locations view's size classes over every circle's count (SMR 1381-1414): Fisher classes, at most five, sizes
  // evenly from 3 to 15; the legend shows each class's upper count (rounded as R) with its size.
  // In the page's style (clusterCountLabels), the legend shows every class drawn, labeled by the counts its circles
  // hold ("1", "3 – 5"); CVI rounds the in-between breaks and drops repeats, so with counts 1 and 2 its one entry reads
  // "2" beside the smallest circle. With clusterSizeByCount, each class sized by its largest count, area in proportion,
  // the largest count at 15 and none below 3 (CVI's even steps draw a 2 five times as wide as a 1). One class keeps
  // CVI's 9.
  function glyphClasses(allN, style) {
    const un = uniq(allN).sort((a, b) => a - b);
    let n = Math.min(5, un.length);
    if (n <= 1) {
      const top = Math.max(...allN);
      const one = (SIZE_MIN + SIZE_MAX) / 2;
      return { breaks: [Math.min(...allN), top], sizes: [one], sizeOf: () => one, classOf: () => 1,
        legend: { counts: [top], sizes: [one], labels: [S().comma(top)] } };
    }
    let brks;
    try {
      brks = S().fisherBreaks(allN, n);
    } catch (e) {
      brks = null;
    }
    if (!brks || uniq(brks).length < 2) brks = uniq([Math.min(...allN)].concat(un));
    brks = uniq(brks);
    n = brks.length - 1;
    const classOf = x => Math.min(Math.max(findInterval(x, brks), 1), n);
    // The counts each class holds, for the two options above.
    const held = Array.from({ length: n }, (_, k) => allN.filter(x => classOf(x) === k + 1));
    const top = Math.max(...allN);
    let sizes = seqR(SIZE_MIN, SIZE_MAX, Math.max(1, n));
    if (style && style.clusterSizeByCount) {
      sizes = held.map((h, k) => (h.length ? Math.max(SIZE_MIN, SIZE_MAX * Math.sqrt(Math.max(...h) / top)) : sizes[k]));
    }
    const sizeOf = x => sizes[classOf(x) - 1];
    if (style && style.clusterCountLabels) {
      const drawn = held.map((h, k) => k).filter(k => held[k].length);
      const label = h => {
        const lo = Math.min(...h);
        const hi = Math.max(...h);
        return lo === hi ? S().comma(lo) : S().comma(lo) + ' – ' + S().comma(hi);
      };
      return { breaks: brks, sizes, sizeOf, classOf, held,
        legend: { counts: drawn.map(k => Math.max(...held[k])), sizes: drawn.map(k => sizes[k]),
          labels: drawn.map(k => label(held[k])) } };
    }
    const counts = brks.slice(1).map(b => S().rRound(b));
    const keep = counts.map((c, i) => c > 0 && counts.indexOf(c) === i);
    const kept = counts.filter((c, i) => keep[i]);
    return { breaks: brks, sizes, sizeOf, classOf, held,
      legend: { counts: kept, sizes: sizes.filter((s, i) => keep[i]), labels: kept.map(c => S().comma(c)) } };
  }

  // ── The theme (.static_basemap_theme with the Facilities "auto" rule, SMR 3557-3565, 1622-1644) ─────────────
  function themeOf(labelStyle, boundaryStyle) {
    const t = { boundary: '#ffffff', label: '#8a8a8a', labelFill: '#ffffff', labelFillAlpha: 0.78 };
    if (labelStyle === 'dark') Object.assign(t, { label: '#4a4a4a', labelFill: '#ffffff', labelFillAlpha: 0.78 });
    if (labelStyle === 'light') Object.assign(t, { label: '#f0f0f0', labelFill: '#1a1a1a', labelFillAlpha: 0.70 });
    if (boundaryStyle === 'dark') t.boundary = '#8a8a8a';
    if (boundaryStyle === 'light') t.boundary = '#ffffff';
    t.autoLabel = !labelStyle || labelStyle === 'auto';
    return t;
  }

  // ── The model ───────────────────────────────────────────────────────────────────────────────────────────────
  // input: layers (the dashboard's shown layers in the registry's order, each { key, label, color, points: [{ name,
  // lon, lat, geoSource, county }] } after its county and attribute filters), counties (GeoJSON features), picked
  // (the county filter's names), view ('density' or 'locations'), ramp, chrome ('branded' or 'report'),
  // nameLayers, activity (null, or { rows (aggregate.build's circles), f: { species, years, quarters, scaling,
  // nBins }, universe, palette, opacity }), period (the activity pickers' { years, quarters }, for the Report
  // caption), title, date, background (tiles.js key or 'standard'), labelStyle, boundaryStyle.
  function facilities(input, styleOpts) {
    const BR = B();
    const style = BR.styleOf(styleOpts);
    const report = input.chrome === 'report';
    const lblScale = report ? 0.6 : 1;
    const features = input.counties;
    const bg = BM().backgroundOf(input);
    const theme = themeOf(input.labelStyle, input.boundaryStyle);
    const act = input.activity && input.activity.rows && input.activity.rows.length ? input.activity : null;

    // The layers that have placed points.
    const split = input.layers.map(l => Object.assign({ layer: l }, splitLayer(l)));
    const active = split.filter(s => s.located.length || s.town.length);
    const nFac = split.reduce((t, s) => t + s.count, 0);
    const unplacedAll = split.reduce((t, s) => t + s.unplaced, 0);
    const canDensity = densityApplies(input.layers, !!act);
    const density = input.view === 'density' && canDensity;
    const fallback = input.view === 'density' && !density;
    const anchor = anchors(features);

    // The map's box: Washington, or the picked counties' box padded by 8% (at least 0.05 degrees); then widened 5%
    // as coord_sf(expand = TRUE) (SMR 3567-3577, mod_maps.R 4092-4102).
    const pickedSet = new Set(input.picked || []);
    let limits = BM().WA_LIMITS;
    const pickedFeatures = features.filter(f => pickedSet.has(f.properties.name));
    if (pickedFeatures.length) {
      const b = BR.bounds(pickedFeatures);
      const padX = Math.max((b.east - b.west) * 0.08, 0.05);
      const padY = Math.max((b.north - b.south) * 0.08, 0.05);
      limits = { west: b.west - padX, east: b.east + padX, south: b.south - padY, north: b.north + padY };
    }
    const extent = BM().expand(limits);

    // CVI activity: WA State's circles (SMR 3606-3622): sizes 3 to 19.5 from the map's pixel radii, largest first,
    // at 85% of their opacity over tiles. Colors follow the dashboard's palette (as on screen).
    let cvi = [];
    let toSize = null;
    if (act) {
      const px = act.rows.map(r => r.radius_px).filter(x => x !== null && !Number.isNaN(x));
      const rMin = Math.min(...px);
      let rMax = Math.max(...px);
      if (rMax === rMin) rMax = rMin + 1;
      toSize = r => BM().MIN_PT + ((r - rMin) / (rMax - rMin)) * 16.5;
      const opacity = Math.max(0.1, Math.min(1, Number(act.opacity === undefined ? 0.6 : act.opacity)) * (bg ? 0.85 : 1));
      cvi = act.rows.map((r, i) => {
        const size = toSize(r.radius_px);
        return { county: r.county, direction: r.direction, lon: r.lon, lat: r.lat, total: r.total_animals, size,
          stroke: Math.max(0.15, Math.min(1.0, size * 0.06)),
          fill: root.CVIWA.palettes.circleColor(act.palette || 'WSDA Default', r.direction), opacity, i };
      }).sort((a, b) => b.size - a.size || a.i - b.i);
    }

    // ── Locations: the circles (SMR 3697-3772, 1308-1488) ──
    const wanted = new Set(input.nameLayers || []);
    let glyphs = null;
    const dataCounties = [];
    if (!density) {
      const specs = [];
      active.forEach((s, j) => {
        const l = s.layer;
        if (wanted.has(l.key)) {
          // Name markers: the located facilities in 0.12-degree cells, then the towns; a lone one keeps its name.
          const cells = new Map();
          for (const p of s.located) {
            const key = S().rRound(p.lon / CELL) + '_' + S().rRound(p.lat / CELL);
            if (!cells.has(key)) cells.set(key, []);
            cells.get(key).push(p);
          }
          const rows = [...cells.keys()].sort(cmpEn).map(k => {
            const ps = cells.get(k);
            return { lon: ps.reduce((t, p) => t + p.lon, 0) / ps.length, lat: ps.reduce((t, p) => t + p.lat, 0) / ps.length,
              n: ps.length, name: ps.length === 1 ? ps[0].name : '', county: null };
          });
          // A lone town-level facility is named by its town, unless the town is only a place (SMR 1352-1360).
          for (const t of s.townAgg) {
            const placeOnly = /^-?[0-9.]+, *-?[0-9.]+$/.test(t.town);
            rows.push({ lon: t.lon, lat: t.lat, n: t.n, name: t.n === 1 && !placeOnly ? t.town : '', county: null,
              town: t.town });
          }
          specs.push({ layer: l, rows, named: true });
          return;
        }
        const cc = countyCounts(l);
        const ang = 2 * Math.PI * j / Math.max(1, active.length);
        const dodge = active.length > 1 ? DODGE : 0;
        const rows = [];
        for (const county of [...cc.counts.keys()].sort(cmpEn)) {
          const a = anchor.get(county);
          const n = cc.counts.get(county);
          if (!a || !(n > 0)) continue;
          if (dataCounties.indexOf(county) < 0) dataCounties.push(county);
          rows.push({ lon: a.lon + dodge * Math.cos(ang), lat: a.lat + dodge * Math.sin(ang), n, name: '', county });
        }
        specs.push({ layer: l, rows, named: false });
      });
      const used = specs.filter(sp => sp.rows.length);
      const allN = used.flatMap(sp => sp.rows.map(r => r.n));
      if (allN.length) {
        const classes = glyphClasses(allN, style);
        // The layer with the most facilities drawn first, the fewest on top.
        const order = used.map((sp, i) => ({ sp, i, total: sp.rows.reduce((t, r) => t + r.n, 0) }))
          .sort((a, b) => b.total - a.total || a.i - b.i).map(x => x.sp);
        glyphs = { classes, layers: order.map(sp => ({ key: sp.layer.key, label: sp.layer.label, color: sp.layer.color,
          shape: sp.layer.shape,
          named: sp.named,
          rows: sp.rows.map(r => {
            const size = classes.sizeOf(r.n);
            return Object.assign({}, r, { size, stroke: Math.max(0.55, Math.min(1.1, size * 0.06)) });
          }) })) };
      }
    }
    if (act) for (const c of cvi) if (c.county && dataCounties.indexOf(c.county) < 0) dataCounties.push(c.county);

    // ── Density: the classes (SMR 3815-3852) ──
    let choro = null;
    if (density) {
      const s = active[0];
      const cc = countyCounts(s.layer);
      const counts = features.map(f => cc.counts.get(f.properties.name) || 0);
      const classes = densityClasses(counts, input.ramp);
      if (style.densityCountLabels) classes.labels = classes.countLabels;
      choro = Object.assign(classes, { counts, layer: s.layer, unplaced: cc.unplaced,
        fills: counts.map((c, i) => (classes.classOf[i] ? classes.colors[classes.classOf[i] - 1] : ZERO_FILL)) });
    }

    // ── Strings ──
    let auto;
    if (act) {
      auto = 'WASHINGTON FACILITIES + CVI ACTIVITY – ' + BM().speciesLabel(act.f.species, act.universe);
    } else {
      auto = density ? 'FACILITY DENSITY BY COUNTY' : glyphs ? 'FACILITIES BY COUNTY' : 'WASHINGTON FACILITIES & INFRASTRUCTURE';
    }
    const title = BM().resolveTitle(input.title, auto);
    const period = act ? BM().periodParts(act.f.quarters, act.f.years) : null;
    const updated = BR.updated(input.date);

    // The tiles (SMR 3893-3920): Total Animals first with CVI activity; Density: Facilities, Counties covered and
    // Busiest county; else one tile per layer with facilities, in the registry's order.
    const tiles = [];
    if (act) {
      tiles.push({ label: 'Total Animals', value: S().comma(act.rows.reduce((t, r) => t + (Number.isFinite(r.total_animals)
        ? r.total_animals : 0), 0)), color: GOLD });
    }
    if (density) {
      const fc = choro.counts;
      let bi = 0;
      fc.forEach((c, i) => { if (c > fc[bi]) bi = i; });
      tiles.push({ label: 'Facilities', value: S().comma(nFac), color: choro.layer.color },
        { label: 'Counties covered', value: fc.filter(c => c > 0).length + ' of ' + fc.length, color: DARK_TEAL },
        { label: 'Busiest county', value: features[bi].properties.name + ': ' + fc[bi], color: DARK_TEAL });
    } else {
      for (const s of active) tiles.push({ label: s.layer.label, value: S().comma(s.count), color: s.layer.color });
    }

    const model = {
      view: 'facilities', chrome: report ? 'report' : 'branded', coverage: density ? 'density' : 'locations',
      requested: input.view, fallback, notice: fallback ? FALLBACK_NOTICE : null, title,
      titleSize: report ? null : BR.titleSize(title), updated, period, facilities: nFac, unplaced: unplacedAll,
      layers: split.map(s => ({ key: s.layer.key, label: s.layer.label, color: s.layer.color, shape: s.layer.shape,
        count: s.count,
        located: s.located.length, town: s.town.length, unplaced: s.unplaced, active: active.indexOf(s) >= 0 })),
      tiles, extent, zoomed: pickedFeatures.length > 0, background: bg ? input.background : 'standard',
      basemap: bg ? bg.attribution : null, cvi, choro, glyphs, dataCounties,
      fileName: 'CVI_Facilities_' + dateStamp(input.date) + '.png',
      page: report ? BR.REPORT_PAGE : BR.PAGE
    };
    const parts = report ? reportPage(model, input, style, theme) : brandedPage(model, input, style, theme);
    return { model, parts, style, page: model.page };
  }
  // A date as YYYY-MM-DD (today by default), for the file name.
  function dateStamp(d) {
    const x = d || new Date();
    const two = n => String(n).padStart(2, '0');
    return x.getFullYear() + '-' + two(x.getMonth() + 1) + '-' + two(x.getDate());
  }

  // ── The map (both styles) ───────────────────────────────────────────────────────────────────────────────────
  // fr: the page's frame; mapPanel: the map's region in points. Fills model.mapPanel, circles, names, underlay.
  function mapParts(model, input, style, theme, fr, mapPanel, lblScale) {
    const BR = B();
    const features = input.counties;
    const fit = BR.fitMercator(model.extent, mapPanel);
    const P = fit.project;
    const parts = [];
    const bg = model.background !== 'standard';
    const anchor = anchors(features);
    const area = { x0: mapPanel.left + 2, x1: mapPanel.left + mapPanel.width - 2, y0: mapPanel.top + 2,
      y1: mapPanel.top + mapPanel.height - 2 };
    const halo = (fill, alpha, pt) => ({ color: fill, opacity: alpha, width: 2 * 0.22 * pt });
    model.mapPanel = { left: mapPanel.left, top: mapPanel.top, width: mapPanel.width, height: mapPanel.height };
    model.underlay = bg ? Object.assign(BM().underlayOf(input, mapPanel, fit, features, model.zoomed ? 12 : 10),
      { pageWidth: fr.W }) : null;

    // Population context (PC): cut to the picked counties when there are some; over a county fill (Density), the
    // two outline layers only and no names. model.populationDrawn: the layers drawn (the legend rows and credits).
    const pop = BM().populationOf(input);
    model.populationDrawn = pop ? Object.assign({}, pop, { on: Object.assign({}, pop.on,
      model.choro ? { density: false } : {}) }) : null;
    const pickedSet = new Set(input.picked || []);
    const shown = model.zoomed ? features.filter(f => pickedSet.has(f.properties.name)) : null;
    const popLayers = (on, width) => BM().populationLayers(Object.assign({}, pop, { on }), features, P,
      { extent: model.extent, clip: shown, id: 'fac', line: theme.boundary, width });

    if (model.choro) {
      // Counties filled by class (none: CVI's light gray), white lines 0.4; "NAME" over the count on each populated
      // county, the busiest placed first, dropped when it cannot be placed clear of the others (SMR 3857-3896).
      features.forEach((f, i) => {
        parts.push('<path d="' + BR.pathData(f.geometry, P) + '" fill="' + model.choro.fills[i] + '" stroke="' +
          theme.boundary + '" stroke-width="' + BR.num(BR.linePt(0.4)) + '"/>');
      });
      if (pop && (pop.on.cities || pop.on.places)) {
        parts.push(popLayers({ cities: pop.on.cities, places: pop.on.places, density: false }, 0.4));
        model.population = { on: pop.on, ramp: pop.ramp, names: [], dropped: [], densityOverFill: !!pop.on.density };
      }
      const pt = BR.textPt(2.9 * lblScale);
      const order = features.map((f, i) => ({ f, i, n: model.choro.counts[i] })).filter(x => x.n > 0)
        .sort((a, b) => b.n - a.n || a.i - b.i);
      const taken = [];
      const names = [];
      for (const x of order) {
        const a = anchor.get(x.f.properties.name);
        if (!a) continue;
        const lines = [String(x.f.properties.name).toUpperCase(), String(x.n)];
        const at = placeBlock(lines, P(a.lon, a.lat), pt, taken, area);
        if (!at) {
          names.push({ county: x.f.properties.name, lines, dropped: true });
          continue;
        }
        taken.push(at.box);
        names.push({ county: x.f.properties.name, lines, x: at.x, y: at.y, box: at.box, moved: at.moved });
      }
      const color = style.darkNames ? BR.nameColor(style) : '#3a3a3a';
      for (const n of names.filter(m => !m.dropped)) {
        n.lines.forEach((t, k) => parts.push(BR.text(t, n.x, n.y + (k - 0.5) * pt * 1.15, { pt, color,
          anchor: 'middle', halo: halo('#ffffff', 0.85, pt) })));
      }
      model.names = names;
      model.nameColor = color;
      return { parts: parts.join(''), fit };
    }

    // Locations: counties (land fill, or none over tiles), the CVI circles, the facility circles, the facility names,
    // then the county names on top (SMR 3897-3960).
    for (const f of features) {
      parts.push('<path d="' + BR.pathData(f.geometry, P) + '" fill="' + (bg ? 'none' : ZERO_FILL) + '" stroke="' +
        theme.boundary + '" stroke-width="' + BR.num(BR.linePt(0.5)) + '"/>');
    }
    if (pop) parts.push(popLayers(pop.on, 0.5));
    const cviDrawn = model.cvi.map(c => {
      const [x, y] = P(c.lon, c.lat);
      return Object.assign({}, c, { x, y, r: BR.pointRadius(c.size, c.stroke) });
    });
    for (const c of cviDrawn) parts.push(BR.circle(c.x, c.y, c.size, c.stroke, c.fill, c.opacity, '#ffffff'));
    const glyphDrawn = [];
    if (model.glyphs) {
      for (const l of model.glyphs.layers) {
        for (const r of l.rows) {
          const [x, y] = P(r.lon, r.lat);
          const g = Object.assign({}, r, { x, y, rad: BR.pointRadius(r.size, r.stroke), key: l.key, color: l.color });
          glyphDrawn.push(g);
          parts.push(BR.circle(x, y, r.size, r.stroke, l.color, 0.7, '#ffffff', l.shape));
        }
      }
    }
    // County names: the counties with facility circles or CVI circles, at CVI's place (0.14 degrees above the county's
    // anchor) in CVI's style, else placed off the circles by the page's rule.
    const namePt = BR.textPt(3.2 * lblScale);
    // A circle's county, for that rule's "own circles"; a name marker's circle has none, so it counts as the county's
    // where its center lies (placeLabels).
    const countyOf = c => (c.county === null || c.county === undefined ? {} : { county: c.county });
    const circles = glyphDrawn.map(g => Object.assign({ x: g.x, y: g.y, r: g.rad }, countyOf(g)))
      .concat(cviDrawn.map(c => Object.assign({ x: c.x, y: c.y, r: c.r }, countyOf(c))));
    const items = [];
    for (const county of model.dataCounties.slice().sort(cmpEn)) {
      const a = anchor.get(county);
      if (!a) continue;
      const own = glyphDrawn.filter(g => g.county === county).map(g => ({ x: g.x, y: g.y, r: g.rad }))
        .concat(cviDrawn.filter(c => c.county === county));
      const lift = P(a.lon, a.lat + 0.14);
      if (!own.length) {
        items.push({ name: county, at: lift, cvi: lift });
        continue;
      }
      const box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
      for (const c of own) {
        box.x0 = Math.min(box.x0, c.x - c.r);
        box.x1 = Math.max(box.x1, c.x + c.r);
        box.y0 = Math.min(box.y0, c.y - c.r);
        box.y1 = Math.max(box.y1, c.y + c.r);
      }
      items.push({ name: county, box, cvi: lift, size: box.x1 - box.x0 });
    }
    items.sort((a, b) => (b.size || 0) - (a.size || 0));
    const placedNames = style.darkNames ? BM().placeLabels(items, circles, input.counties, P, namePt, area, 4)
      : items.map(it => ({ name: it.name, x: it.cvi[0], y: it.cvi[1] }));
    const nameColor = theme.autoLabel && style.darkNames ? BR.nameColor(style) : theme.label;
    model.names = placedNames.map(n => ({ county: n.name, lines: [n.name], x: n.x, y: n.y, free: n.free, step: n.step }));
    model.nameColor = nameColor;

    // Name markers: the lone facilities of the picked layers, bold in the layer's name color (SMR 1424-1470).
    const LB = root.WSDA.labels;
    const markerPt = BR.textPt(2.8);
    const markerNames = [];
    for (const g of glyphDrawn) {
      if (g.n !== 1 || !g.name) continue;
      const l = input.layers.find(x => x.key === g.key);
      markerNames.push({ lines: [g.name], x: g.x, y: g.y, r: g.rad, color: BM().facilityNameColor(l), layer: g.key });
    }
    const countyBoxes = model.names.map(n => {
      const w = BR.textWidth(n.lines[0], namePt) + 2;
      return { x0: n.x - w / 2, x1: n.x + w / 2, y0: n.y - namePt * 0.475, y1: n.y + namePt * 0.475 };
    });
    // The population layers' names: places of 10,000 or more statewide, every city and place in picked counties;
    // clear of the county names, over the circles (before the facility names).
    const popNames = pop ? BM().populationNames(pop, P, area, countyBoxes, circles,
      { min: shown ? 0 : 10000, counties: shown }) : null;
    if (popNames) {
      parts.push(popNames.markup);
      model.population = { on: pop.on, ramp: pop.ramp, names: popNames.placed, dropped: popNames.dropped };
    }
    const markerPlaces = LB.place(markerNames, glyphDrawn.map(g => ({ x: g.x, y: g.y, r: g.rad })), cviDrawn, area,
      markerPt, countyBoxes.concat(popNames ? popNames.placed.map(n => n.box) : []));
    markerNames.forEach((n, i) => parts.push(LB.markup(n, markerPlaces[i], markerPt, n.color, { bold: true })));
    model.markerNames = markerNames.map((n, i) => ({ lines: n.lines, color: n.color, layer: n.layer, x: n.x, y: n.y,
      at: markerPlaces[i] }));
    for (const n of model.names) {
      parts.push(BR.text(n.lines[0], n.x, n.y, { pt: namePt, color: nameColor, anchor: 'middle',
        halo: halo(theme.labelFill, theme.labelFillAlpha, namePt) }));
    }
    model.cviDrawn = cviDrawn;
    model.glyphDrawn = glyphDrawn;
    model.countyNameBoxes = countyBoxes;
    return { parts: parts.join(''), fit };
  }
  // A block of lines centered at `at` when that place is clear of the boxes taken, else the first clear place of
  // three rings of eight around it; null when none is clear (CVI drops it).
  function placeBlock(lines, at, pt, taken, area) {
    const BR = B();
    const w = Math.max(...lines.map(t => BR.textWidth(t, pt))) + 2;
    const h = lines.length * pt * 1.15;
    const meet = (a, b) => Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) && Math.min(a.y1, b.y1) > Math.max(a.y0, b.y0);
    const spots = [[0, 0]];
    for (let ring = 1; ring <= 3; ring++) {
      const gx = ring * w * 0.55;
      const gy = ring * h * 0.6;
      spots.push([0, -gy], [0, gy], [gx, 0], [-gx, 0], [gx, -gy], [-gx, -gy], [gx, gy], [-gx, gy]);
    }
    for (const [dx, dy] of spots) {
      const x = at[0] + dx;
      const y = at[1] + dy;
      const box = { x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2 };
      const off = box.x0 < area.x0 || box.x1 > area.x1 || box.y0 < area.y0 || box.y1 > area.y1;
      if (!off && !taken.some(t => meet(t, box))) return { x, y, box, moved: dx !== 0 || dy !== 0 };
    }
    return null;
  }

  // ── The legend ──────────────────────────────────────────────────────────────────────────────────────────────
  // The entries CVI's .build_facilities_legend draws (SMR 3222-3455), each with CVI's place in its box (y, a
  // fraction of the box from the bottom) and, for the page's layout (legendBySize), a least row height (CVI's step).
  function legendSpec(model, style, s, boxH) {
    const BR = B();
    const sz = x => x * s;
    const out = [];
    const gray = style.darkerGrays ? '#666666' : '#777777';
    // compact: no least height on the page's layout (the facility rows as close as other legends').
    const row = (y, step, circle, label, x, labelX, compact) => out.push({ y, minH: compact ? 0 : step * boxH, circle,
      label, labelPt: BR.textPt(sz(3.0)), x, labelX });
    if (model.choro) {
      const c = model.choro;
      const title = c.layer.label ? String(c.layer.label).trim().toUpperCase() + ' PER COUNTY' : 'FACILITIES PER COUNTY';
      const lines = wrap22(title).slice(0, 3);
      out.push({ y: 0.985, top: true, lines, text: lines.join(' '), pt: BR.textPt(sz(3.0)), color: '#222222',
        bold: true });
      const yFirst = 0.985 - lines.length * 0.062 - 0.073;
      const swatchH = 0.052 * boxH;
      const swatchW = 0.12;
      const swatch = fill => ({ height: swatchH, fill, width: swatchW });
      c.labels.forEach((label, i) => out.push({ y: yFirst - i * 0.075, minH: 0.075 * boxH, swatch: swatch(c.colors[i]),
        label, labelPt: BR.textPt(sz(3.0)), x: 0.14, labelX: 0.24 }));
      const yNone = yFirst - c.labels.length * 0.075;
      out.push({ y: yNone, minH: 0.075 * boxH, swatch: swatch(ZERO_FILL), label: 'none (0)',
        labelPt: BR.textPt(sz(3.0)), x: 0.14, labelX: 0.24 });
      out.push({ y: yNone - 0.075, text: 'Counts located + town-level rows.', pt: BR.textPt(sz(2.4)), color: gray,
        italic: true });
      if (c.unplaced > 0) {
        out.push({ y: yNone - 0.075 - 0.038, text: S().comma(c.unplaced) + ' unplaced (no location)',
          pt: BR.textPt(sz(2.4)), color: gray, italic: true });
      }
      return { entries: out, yLow: 0 };
    }
    const yHdr = 0.95;
    const yFirst = yHdr - sz(0.09);
    const step = sz(0.075);
    out.push({ y: yHdr, text: 'FACILITY LOCATIONS', pt: BR.textPt(sz(3.2)), color: '#222222', bold: true });
    // The layers with facilities, in the registry's order.
    const shown = model.layers.filter(l => l.active);
    shown.forEach((l, i) => row(yFirst - i * step, step, { size: sz(4), stroke: 0.8, fill: l.color, opacity: 1,
      shape: l.shape },
      l.label, 0.14, 0.26, true));
    let cursor = yFirst - shown.length * step;
    const g = model.glyphs;
    if (g && g.classes.legend.counts.length) {
      const hdr = cursor - sz(0.045);
      const first = hdr - sz(0.095);
      const tstep = sz(0.095);
      out.push({ gap: 4, pageOnly: true });   // the page's layout: room above the divider too
      out.push({ y: hdr + sz(0.05), rule: { color: '#bbbbbb', width: 0.3, x0: 0.06, x1: 0.94 } });
      out.push({ gap: 6, pageOnly: true });   // the page's layout: room under the divider
      out.push({ y: hdr, text: 'CLUSTER SIZE', pt: BR.textPt(sz(3.2)), color: '#222222', bold: true });
      // CVI: "circle size"; the marks have their layer's shape, so "mark size".
      out.push({ y: hdr - sz(0.058), text: 'mark size = facilities in county', pt: BR.textPt(sz(2.5)), color: gray,
        italic: true });
      const counts = g.classes.legend.counts;
      counts.forEach((n, i) => row(first - sz(0.040) - i * tstep, tstep,
        { size: g.classes.legend.sizes[i] * s, stroke: 0.8, fill: '#888888', opacity: 0.55 },
        g.classes.legend.labels[i], 0.18, 0.40));
      cursor = first - sz(0.040) - (counts.length - 1) * tstep - sz(0.04);
    }
    if (model.cvi.length) {
      const base = Math.max(0.10, cursor - sz(0.04));
      const role1 = base - sz(0.07);
      const role2 = role1 - sz(0.07);
      const ap = role2 - sz(0.09);
      const tiers = model.cviLegend;
      const n = tiers.labels.length;
      const lo = Math.max(0.04, ap - sz(0.06) - sz(0.20));
      const hi = ap - sz(0.06);
      const ys = n === 1 ? [lo] : Array.from({ length: n }, (_, i) => lo + i * (hi - lo) / (n - 1)).reverse();
      out.push({ gap: 4, pageOnly: true });   // the page's layout: room above the divider too
      out.push({ y: base + sz(0.045), rule: { color: '#bbbbbb', width: 0.3, x0: 0.06, x1: 0.94 } });
      out.push({ gap: 6, pageOnly: true });   // the page's layout: room under the divider
      out.push({ y: base, text: 'PREMISES ROLE', pt: BR.textPt(sz(3.2)), color: '#222222', bold: true });
      row(role1, sz(0.07), { size: sz(5), stroke: 0.8, fill: '#1C9CD9', opacity: 0.85 }, 'Importer (received)', 0.14, 0.26);
      row(role2, sz(0.07), { size: sz(5), stroke: 0.8, fill: '#F0A06E', opacity: 0.85 }, 'Exporter (sent)', 0.14, 0.26);
      out.push({ y: ap, text: 'ANIMALS / PREMISES', pt: BR.textPt(sz(3.2)), color: '#222222', bold: true });
      tiers.labels.forEach((label, i) => row(ys[i], n > 1 ? (hi - lo) / (n - 1) : sz(0.07),
        { size: tiers.sizes[i] * s, stroke: 1.0, fill: '#888888', opacity: 0.5 }, label, 0.18, 0.40));
      cursor = Math.min(...ys);
      if (style.sizingLine) {
        out.push({ y: null, text: tiers.sizing, pt: BR.textPt(sz(2.5)), color: '#444444', italic: true, pageOnly: true });
      }
    }
    return { entries: out, yLow: Math.max(0, cursor - 0.08) };
  }
  // R's strwrap(x, width = 22).
  function wrap22(t) {
    return root.WSDA.labels.wrapName(t, 22);
  }
  // CVI's layout: every entry at CVI's place in a box at CVI's region (x, y, w, h page fractions of the frame);
  // the Report style's box shows the part from yLow up (SMR 3447-3453).
  function legendCvi(spec, fr, x, y, w, h, crop) {
    const BR = B();
    const p = fr.panel(x, y, w, h, 5);
    const lo = crop ? spec.yLow : 0;
    const v = f => p.v((f - lo) / (1 - lo));
    const parts = [BR.box(p)];
    const placedRows = [];
    for (const e of spec.entries) {
      if (e.pageOnly) continue;
      if (e.rule) {
        parts.push(BR.line(p.u(e.rule.x0), v(e.y), p.u(e.rule.x1), v(e.y), e.rule.color, BR.linePt(e.rule.width)));
      } else if (e.lines) {
        e.lines.forEach((t, k) => parts.push(BR.text(t, p.u(0.5), v(e.y) + e.pt * (0.5 + 1.15 * k), { pt: e.pt,
          color: e.color, bold: e.bold, anchor: 'middle' })));
      } else if (e.text !== undefined) {
        parts.push(BR.text(e.text, p.u(0.5), v(e.y), { pt: e.pt, color: e.color, bold: e.bold, italic: e.italic,
          anchor: 'middle' }));
      } else if (e.circle) {
        const c = e.circle;
        parts.push(BR.circle(p.u(e.x), v(e.y), c.size, c.stroke, c.fill, c.opacity, '#ffffff', c.shape));
        parts.push(BR.text(e.label, p.u(e.labelX), v(e.y), { pt: e.labelPt, color: '#444444' }));
        placedRows.push({ x: p.u(e.x), y: v(e.y), r: BR.pointRadius(c.size, c.stroke), label: e.label });
      } else if (e.swatch) {
        const sw = e.swatch;
        const hh = sw.height;
        parts.push(BR.rect(p.u(0.08), v(e.y) - hh / 2, p.u(0.20) - p.u(0.08), hh, sw.fill, '#ffffff', BR.linePt(0.6)));
        parts.push(BR.text(e.label, p.u(e.labelX), v(e.y), { pt: e.labelPt, color: '#444444' }));
        placedRows.push({ x: p.u(0.14), y: v(e.y), r: hh / 2, label: e.label, fill: sw.fill });
      }
    }
    const overlap = placedRows.some((c, i) => i > 0 && Math.abs(c.y - placedRows[i - 1].y) < c.r + placedRows[i - 1].r);
    return { parts: parts.join(''), rows: placedRows, overlap, box: { left: p.left, top: p.top, width: p.width,
      height: p.height } };
  }
  // The page's layout (legendBySize): the same entries stacked from the top of CVI's region, each row at least CVI's
  // step and as tall as its sample, the box hugging its content (up to CVI's height). When the column cannot fit
  // without the rows drawn closer, each run of size samples is drawn side by side with its labels under it (as in
  // County Focus's legend).
  function legendPage(spec, fr, x, top, w, maxH) {
    const column = legendColumnOf(spec, fr, w, false);
    let first = B().legendColumn(column, { bottom: 0, minH: 0, maxH, x, width: w, frame: fr });
    let entries = column;
    if (first.squeezed) {
      entries = legendColumnOf(spec, fr, w, true);
      first = B().legendColumn(entries, { bottom: 0, minH: 0, maxH, x, width: w, frame: fr });
    }
    const out = B().legendColumn(entries, { bottom: top - first.height, minH: 0, maxH, x, width: w, frame: fr });
    out.acrossRows = entries !== column;
    return out;
  }
  // The legend spec's entries as branded.legendColumn() rows; across: runs of size circles become one row each.
  function legendColumnOf(spec, fr, w, across) {
    const BR = B();
    const entries = [];
    spec.entries.forEach(e => {
      if (e.gap !== undefined) entries.push({ gap: e.gap });
      else if (e.rule) entries.push({ rule: e.rule });
      else if (e.lines) e.lines.forEach(t => entries.push({ text: t, pt: e.pt, color: e.color, bold: e.bold }));
      else if (e.text !== undefined) entries.push({ text: e.text, pt: e.pt, color: e.color, bold: e.bold, italic: e.italic });
      else if (e.circle) {
        entries.push({ circle: e.circle, label: e.label, labelPt: e.labelPt, x: e.x, labelX: e.labelX, minH: e.minH });
      } else if (e.column) {
        entries.push(...e.column);   // rows already in legendColumn's form (the population layers')
      } else if (e.swatch) {
        const sw = e.swatch;
        const wPt = sw.width * (w * fr.W - 10);
        entries.push({ sample: { height: sw.height, draw: (cx, cy) => BR.rect(cx - wPt / 2, cy - sw.height / 2, wPt,
          sw.height, sw.fill, '#ffffff', BR.linePt(0.6)) }, label: e.label, labelPt: e.labelPt, x: e.x,
        labelX: e.labelX, minH: e.minH });
      }
    });
    if (!across) return entries;
    // Runs of size samples (the circles at 0.18) become one row each.
    const out = [];
    for (const e of entries) {
      const sizeRow = e.circle && e.x === 0.18;
      const last = out[out.length - 1];
      if (sizeRow && last && last.across) last.across.push(Object.assign({ label: e.label }, e.circle));
      else if (sizeRow) out.push({ across: [Object.assign({ label: e.label }, e.circle)], labelPt: e.labelPt });
      else out.push(e);
    }
    return out;
  }

  // ── The branded page (SMR 3925-4040, 4107-4161) ─────────────────────────────────────────────────────────────
  const MAP_W = 0.770;
  // The parts of the Branded style's page for a built model.
  function brandedPage(model, input, style, theme) {
    const BR = B();
    const L = BR.LAYOUT;
    const fr = BR.frame(BR.PAGE);
    const nRows = model.tiles.length ? Math.ceil(model.tiles.length / Math.min(6, model.tiles.length)) : 0;
    const gridH = nRows * ROW_H;
    const gridBot = GRID_TOP - gridH;
    const mapH = nRows ? gridBot - 0.006 : 1 - HDR_H;
    model.grid = { rows: nRows, top: GRID_TOP, bottom: gridBot, mapH };
    if (model.cvi.length) cviLegendOf(model, input);
    const map = mapParts(model, input, style, theme, fr, BR.panel(0, 0, MAP_W, mapH, 0), 1);
    const parts = [BR.clipped('fac-map', model.mapPanel, map.parts), BR.header(model.title, style)];
    if (nRows) parts.push(BR.rect(0, BR.py(1 - HDR_H), BR.px(MAP_W), BR.py(mapH) - BR.py(1 - HDR_H), '#ffffff'));
    parts.push(BR.text(model.updated, BR.px(MAP_W - 0.005), BR.py(L.metaY), { pt: 9, italic: true, anchor: 'end',
      color: style.darkerGrays ? '#555555' : '#777777' }));
    if (model.period) {
      const x0 = BR.px(0.01);
      parts.push(BR.text(model.period.prefix, x0, BR.py(L.metaY), { pt: 11, color: '#222222', bold: true }));
      parts.push(BR.text(model.period.value, x0 + BR.textWidth(model.period.prefix, 11, true) + BR.px(0.006),
        BR.py(L.metaY), { pt: 11, color: '#222222' }));
    }
    if (nRows) {
      const g = BR.tileGrid(model.tiles, 0.005, gridBot, MAP_W - 0.010, gridH, 6);
      parts.push(g.parts);
      model.tilesDrawn = g.tiles;
    } else {
      parts.push(BR.statRow([], [{ prefix: 'Facilities:', value: S().comma(model.facilities) }]));
    }
    const spec = legendSpec(model, style, 1, 0.760 * fr.H - 10);
    const popRows = BM().populationLegend(model.populationDrawn, 1);
    if (popRows.length) spec.entries.push({ column: popRows, pageOnly: true });
    const legend = style.legendBySize ? legendPage(spec, fr, L.gutterX, 0.045 + 0.760, L.gutterW, 0.760)
      : legendCvi(spec, fr, L.gutterX, 0.045, L.gutterW, 0.760, false);
    parts.push(legend.parts);
    model.legend = { entries: spec.entries.map(e => Object.assign({}, e,
        { swatch: e.swatch ? { fill: e.swatch.fill } : undefined })),
      overlap: legend.overlap, box: legend.box, squeezed: !!legend.squeezed, rows: legend.rows || legend.circles };
    const source = BM().withPopulation(model.cvi.length ? SOURCE_CVI : SOURCE, model.populationDrawn);
    parts.push(BR.footnote(source, model.basemap, style));
    model.source = style.sourceLine ? source : null;
    parts.push(BR.logo());
    return parts;
  }
  // The CVI circles' legend tiers (.county_legend_spec over every circle, SMR 3955-3962) and sizingLine's line.
  function cviLegendOf(model, input) {
    const f = input.activity.f;
    const scaling = ['log', 'sqrt', 'linear', 'quantile', 'natural'].indexOf(f.scaling) >= 0 ? f.scaling : 'log';
    const px = input.activity.rows.map(r => r.radius_px).filter(x => x !== null && !Number.isNaN(x));
    const rMin = Math.min(...px);
    let rMax = Math.max(...px);
    if (rMax === rMin) rMax = rMin + 1;
    const toSize = r => BM().MIN_PT + ((r - rMin) / (rMax - rMin)) * 16.5;
    const spec = BM().countyLegendSpec(input.activity.rows.map(r => r.total_animals), scaling, f.nBins, toSize);
    const tiers = spec || { labels: ['low', 'mid', 'high'], sizes: [5, 10, 16], fixed: true };
    model.cviLegend = { labels: tiers.labels, sizes: tiers.sizes,
      sizing: BM().sizingLine('Circle size', scaling, spec ? [tiers.labels.length] : null) };
  }

  // ── The Report page (SMR 3984-4033) ─────────────────────────────────────────────────────────────────────────
  function reportPage(model, input, style, theme) {
    const BR = B();
    const fr = BR.frame(BR.REPORT_PAGE);
    const CAP_H = 0.075;
    const TTL_H = 0.085;
    const R_MAP_W = 0.735;
    const R_GUT_X = 0.745;
    const R_GUT_W = 0.250;
    const R_LEG_H = 0.50;
    const R_LEG_Y = (1 - TTL_H - 0.02) - R_LEG_H;
    if (model.cvi.length) cviLegendOf(model, input);
    const map = mapParts(model, input, style, theme, fr, fr.panel(0, CAP_H, R_MAP_W, 1 - CAP_H - TTL_H, 0), 0.6);
    const parts = [BR.clipped('fac-map', model.mapPanel, map.parts)];
    parts.push(BR.text(model.title, fr.px(0.006), fr.py(1 - TTL_H / 2), { pt: 13, color: '#222222', bold: true }));
    // The caption: the activity pickers' period (CVI writes it whenever they hold years), the facilities, the source,
    // the basemap.
    const cap = [];
    // activityPeriodOnly: the period only when CVI activity is drawn (CVI writes the activity pickers' period whenever
    // they hold years).
    const per = style.activityPeriodOnly && !model.cvi.length ? null : input.period;
    if (per && per.years && per.years.length && per.quarters && per.quarters.length) {
      const pp = BM().periodParts(per.quarters, per.years);
      cap.push(pp.prefix + ' ' + pp.value);
    } else if (per && per.years && per.years.length) {
      const ys = per.years.map(Number);
      const lo = Math.min(...ys);
      const hi = Math.max(...ys);
      cap.push('CY ' + (lo === hi ? lo : lo + '-' + hi));
    }
    cap.push('Facilities: ' + S().comma(model.facilities), 'Source: WSDA CVI');
    // The population layers' credits, when drawn.
    if (model.populationDrawn) cap.push(...root.WSDA.population.credits(model.populationDrawn.on));
    if (model.basemap) cap.push('Basemap: ' + model.basemap);
    model.caption = cap.join('   |   ');
    // SVG text joins runs of spaces, so CVI's wide separators are drawn with no-break spaces.
    parts.push(BR.text(model.caption.replace(/ {2,}/g, m => '\u00a0'.repeat(m.length)), fr.px(0.006), fr.py(CAP_H / 2), { pt: 7,
      color: style.darkerGrays ? '#666666' : '#777777' }));
    const spec = legendSpec(model, style, 0.62, R_LEG_H * fr.H - 10);
    const popRows = BM().populationLegend(model.populationDrawn, 0.62, R_GUT_W * fr.W - 10);
    if (popRows.length) spec.entries.push({ column: popRows, pageOnly: true });
    const legend = style.legendBySize ? legendPage(spec, fr, R_GUT_X, R_LEG_Y + R_LEG_H, R_GUT_W, R_LEG_Y + R_LEG_H - CAP_H)
      : legendCvi(spec, fr, R_GUT_X, R_LEG_Y, R_GUT_W, R_LEG_H, !model.choro);
    parts.push(legend.parts);
    model.legend = { entries: spec.entries.map(e => Object.assign({}, e,
        { swatch: e.swatch ? { fill: e.swatch.fill } : undefined })),
      overlap: legend.overlap, box: legend.box, squeezed: !!legend.squeezed, rows: legend.rows || legend.circles };
    return parts;
  }

  // ── The export's choices (export_params.json) and the ZIP's folder (mod_maps.R 6216-6224) ───────────────────
  function folderName(label, date) {
    const t = String(label || '').trim();
    return dateStamp(date) + '_' + (t ? t.replace(/[^A-Za-z0-9_-]/g, '_') : 'Facilities');
  }

  root.WSDA = root.WSDA || {};
  root.WSDA.infrastructureBranded = {
    facilities, rampColors, RAMPS, RAMP_LABELS, splitLayer, countyCounts, anchorOf, anchors, densityClasses,
    glyphClasses, densityApplies, findInterval, themeOf, folderName, dateStamp, FALLBACK_NOTICE, SOURCE, SOURCE_CVI
  };
})(typeof window !== 'undefined' ? window : globalThis);
