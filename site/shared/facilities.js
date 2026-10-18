/* S5 facility layers (CVI shiny/R/map_helpers.R, read-only reference): pure rules, no page work here.
 * countyMembership(counties, selectedNames): compile selected bundled GeoJSON polygons.
 * countiesAt(lon, lat) returns every intersecting county in geometry order; contains is their union.
 * Closed boundaries include outer and hole edges; hole interiors are excluded. No bbox buffer.
 * Straight segments in EPSG:4326 coordinates, independently checked with planar sf/GEOS.
 * registry(manifestRows): CVI's .OVERLAY_REGISTRY_BUILTIN merged with .read_overlay_manifest() (key, file, name_col,
 * label, live_label, group, color, enabled; the auto colors from CVI's pool of unused WSDA brand hues, re-walked at
 * other lightness once used up, .shade_hex), in CVI's order; a manifest key equal to a built-in replaces it in place.
 * The page's own limits, as the F1 dataset list (datasets.js expandManifest): the keys "master" and "manifest" are not
 * layers, at most 500 manifest layers.
 * groups(reg): CVI's .overlay_groups(): its canonical group order, then the other groups alphabetically.
 * parseLayer(text, nameColumn): CVI's load_overlay_csv() on the file's text: read.csv headers (make.names), the first
 * lat/latitude/y and long/lon/lng/longitude/x column (any case), rows whose two values convert to numbers, the name
 * column resolved as CVI's .resolve_name_col(). Deliberate difference: a point outside -90..90 /
 * -180..180 or not finite is left out too and counted. Only the name and the point are kept (CVI's Focus payload).
 */
(function (root) {
  'use strict';
  // Where a point lies against one ring: 1 inside, 0 on its boundary, -1 outside.
  function inRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[j], [bx, by] = ring[i];
      const dx = bx - ax, dy = by - ay, px = x - ax, py = y - ay;
      // Only exact collinearity is boundary: no geographic tolerance or buffer.
      if (dx * py === dy * px && x >= Math.min(ax, bx) && x <= Math.max(ax, bx)
          && y >= Math.min(ay, by) && y <= Math.max(ay, by)) return 0;
      if ((ay > y) !== (by > y) && x < ax + dx * py / dy) inside = !inside;
    }
    return inside ? 1 : -1;
  }
  // True when a point lies in a polygon (its outer ring and none of its holes); a boundary point counts as in.
  function inPolygon(x, y, rings) {
    const outer = inRing(x, y, rings[0]);
    if (outer === 0) return true;
    if (outer < 0) return false;
    for (const hole of rings.slice(1)) {
      const hit = inRing(x, y, hole);
      if (hit === 0) return true;
      if (hit > 0) return false;
    }
    return true;
  }
  // A lookup over the selected counties: countiesAt(lon, lat) names the counties holding a point, and contains()
  // says whether any does.
  function countyMembership(counties, selectedNames) {
    const selected = new Set(selectedNames || []);
    const features = counties.features.filter(f => selected.has(f.properties.name)).map(f => {
      const g = f.geometry;
      if (!g || !['Polygon', 'MultiPolygon'].includes(g.type)) throw new Error('County membership needs polygon geometry.');
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
      const bbox = [Infinity, Infinity, -Infinity, -Infinity];
      for (const p of polys) for (const [x, y] of p[0]) {
        bbox[0] = Math.min(bbox[0], x); bbox[1] = Math.min(bbox[1], y);
        bbox[2] = Math.max(bbox[2], x); bbox[3] = Math.max(bbox[3], y);
      }
      return { name: f.properties.name, polys, bbox };
    });
    function countiesAt(lon, lat) {
      // Parsing is a separate facility-loader concern. Do not coerce blank/null to (0,0).
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) return [];
      return features.filter(f => lon >= f.bbox[0] && lon <= f.bbox[2] && lat >= f.bbox[1]
        && lat <= f.bbox[3] && f.polys.some(p => inPolygon(lon, lat, p))).map(f => f.name);
    }
    return { countiesAt, contains: (lon, lat) => countiesAt(lon, lat).length > 0 };
  }

  // ---- Facility layers: CVI's registry, manifest and loader -----------------------------------------------------
  const BUILTIN = [
    { key: 'slaughterhouses', file: 'usda_wa_slaughter_facilities.csv', nameColumn: 'USDA.Slaughter.Facility', color: '#382513',
      label: 'Packing Plants', liveLabel: 'Packing Plants', group: 'Processing & Harvest' },
    { key: 'fairgrounds', file: 'wa_state_fairs.csv', nameColumn: 'Fair.Name', color: '#522348',
      label: 'Fairgrounds', liveLabel: 'Fairgrounds', group: 'Events' },
    { key: 'markets', file: 'wa_state_public_livestock_markets.csv', nameColumn: 'name', color: '#f07325',
      label: 'Markets', liveLabel: 'Livestock Markets', group: 'Markets & Sales' },
    { key: 'feedlots', file: 'wa_state_feedlots.csv', nameColumn: 'name', color: '#0097a7',
      label: 'Feedlots', liveLabel: 'Feedlots', group: 'Holding & Feeding' },
    { key: 'restricted', file: 'wa_state_restricted_holding_facilities.csv', nameColumn: 'NAME', color: '#ca3014',
      label: 'Restricted', liveLabel: 'Restricted Holding Facilities', group: 'Holding & Feeding' }
  ];
  // The built-in layers' marks (UI pass): a shape each, and Feedlots
  // in the guide's Blue Green (CVI: #0097a7). The other built-in colors are CVI's, already guide colors.
  const BUILTIN_MARKS = {
    slaughterhouses: { shape: 'square' },
    markets: { shape: 'diamond' },
    feedlots: { shape: 'triangle', color: '#0094aa' },
    restricted: { shape: 'triangle-down' },
    fairgrounds: { shape: 'star' }
  };
  const GROUP_ORDER = ['Processing & Harvest', 'Markets & Sales', 'Holding & Feeding', 'Events'];
  const TOWN_COLUMNS = ['google_city', 'city', 'City', 'Town', 'town', 'locality', 'Locality', 'Mailing.City',
    'Physical.City'];
  const AUTO_COLORS = ['#1c5a83', '#4a8b2c', '#fcb614', '#8bc04a', '#a7d7e2', '#245566'];
  const LAP_F = [1, 0.58, 1.42, 0.78];
  const RESERVED = ['master', 'manifest'], MAX_MANIFEST_LAYERS = 500;

  // R's make.names (read.csv check.names): characters other than letters, digits, "." and "_" become "."; "X" in front
  // of a name not starting with a letter or "." (or "." and a digit); "." after a reserved word; then make.unique.
  const R_RESERVED = new Set(['if', 'else', 'repeat', 'while', 'function', 'for', 'next', 'break', 'TRUE', 'FALSE', 'NULL',
    'Inf', 'NaN', 'NA', 'NA_integer_', 'NA_real_', 'NA_character_', 'NA_complex_', 'in']);
  function makeName(n) {
    let s = String(n == null ? '' : n).replace(/[^\p{L}\p{N}._]/gu, '.');
    if (!/^(\p{L}|\.(?!\p{N}))/u.test(s)) s = 'X' + s;
    return R_RESERVED.has(s) ? s + '.' : s;
  }
  // R's make.unique: a repeated name gets ".1", ".2" and so on, skipping names already in use.
  function makeUnique(names) {
    const seen = new Set(names), used = new Set(), count = new Map();
    return names.map(n => {
      if (!used.has(n)) { used.add(n); return n; }
      let k = count.get(n) || 0, c;
      do { k++; c = n + '.' + k; } while (seen.has(c) || used.has(c));
      count.set(n, k); used.add(c); return c;
    });
  }
  const makeNames = names => makeUnique(names.map(makeName));

  // R's as.numeric on text: blank is NA; hexadecimal allowed; JavaScript's 0b/0o forms are not numbers in R.
  function num(v) {
    if (v === null || v === undefined) return NaN;
    const t = String(v).trim();
    if (!t || /^[+-]?0[bBoO]/.test(t) || /^[+-]0[xX]/.test(t)) return NaN;
    if (/^[+-]?inf$/i.test(t)) return t[0] === '-' ? -Infinity : Infinity;
    return Number(t);
  }

  // R's col2rgb/rgb round trip of .shade_hex: rgb(..., maxColorValue = 255) is R's special case that turns the values
  // into integers (truncated), checked against R.
  function shadeHex(hex, f) {
    if (Math.abs(f - 1) < 1.5e-8) return hex;
    const h = hex.replace('#', '');
    let rgb = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
    rgb = rgb.map(c => (f > 1 ? c + (255 - c) * (f - 1) : c * f)).map(c => Math.max(0, Math.min(255, c)));
    return '#' + rgb.map(c => Math.trunc(c).toString(16).toUpperCase().padStart(2, '0')).join('');
  }

  // rows: the manifest CSV as parsed (csv.js parse(): { header, rows }), or null when no manifest was supplied.
  // Returns { layers: [{ key, file, nameColumn, color, label, liveLabel, group, builtin, fromManifest }], skipped },
  // the colors as CVI gives them.
  function cviRegistry(manifest) {
    const layers = BUILTIN.map(b => Object.assign({ builtin: true, fromManifest: false }, b)), skipped = [];
    if (!manifest || !manifest.header) return { layers, skipped };
    const head = makeNames(manifest.header).map(h => h.trim().toLowerCase());
    if (head.indexOf('key') < 0 || head.indexOf('file') < 0) return { layers, skipped, malformed: true };
    const get = (r, name) => {
      const i = head.indexOf(name); if (i < 0) return '';
      const v = r[i] == null ? '' : String(r[i]).trim();
      return v.toUpperCase() === 'NA' ? '' : v;
    };
    const rows = manifest.rows;
    let used = BUILTIN.map(b => b.color.toLowerCase());
    rows.forEach(r => { const c = get(r, 'color'); if (c) used.push(c.toLowerCase()); });
    used = [...new Set(used)];
    const out = new Map();
    let nAuto = 0, added = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i], key = get(r, 'key'), file = get(r, 'file');
      if (!key || key.startsWith('#') || !file) continue;
      const en = get(r, 'enabled').toLowerCase();
      if (en && ['false', 'no', '0', 'f'].includes(en)) continue;
      let color = get(r, 'color');
      const ownColor = !!color;
      if (!color) {
        nAuto++;
        const free = AUTO_COLORS.filter(c => !used.includes(c.toLowerCase()));
        if (free.length) color = free[0];
        else {
          const np = AUTO_COLORS.length, nl = LAP_F.length;
          let pick = null;
          for (let step = 1; step <= np * nl && !pick; step++) {
            const idx = nAuto - 1 + step - 1, cand = shadeHex(AUTO_COLORS[idx % np], LAP_F[Math.floor(idx / np) % nl]);
            if (!used.includes(cand.toLowerCase())) pick = cand;
          }
          color = pick || shadeHex(AUTO_COLORS[(nAuto - 1) % np], LAP_F[Math.floor((nAuto - 1) / np) % nl]);
        }
        used.push(color.toLowerCase());
      }
      if (RESERVED.includes(key)) { skipped.push({ row: i + 2, key, reason: 'the key "' + key + '" is reserved' }); continue; }
      const label = get(r, 'label') || key;
      const spec = { key, file, nameColumn: get(r, 'name_col') || 'name', color, ownColor, label,
        liveLabel: get(r, 'live_label') || label,
        group: get(r, 'group') || 'Other',
        filterColumns: get(r, 'filter_cols').split(/[;,|]/).map(x => x.trim()).filter(Boolean) };
      if (!out.has(key)) {
        if (!BUILTIN.some(b => b.key === key) && added >= MAX_MANIFEST_LAYERS) {
          skipped.push({ row: i + 2, key, reason: 'more than ' + MAX_MANIFEST_LAYERS + ' layers; the rest were not added' });
          continue;
        }
        if (!BUILTIN.some(b => b.key === key)) added++;
      }
      out.set(key, spec);   // a repeated key replaces the earlier row in its place, as R's out[[key]] <-
    }
    out.forEach((spec, key) => {
      const at = layers.findIndex(l => l.key === key);
      const l = Object.assign({ builtin: at >= 0 && at < BUILTIN.length, fromManifest: true }, spec);
      if (at >= 0) layers[at] = l; else layers.push(l);
    });
    return { layers, skipped };
  }

  // CVI's registry with each layer's mark (marks() below): `cviColor` keeps CVI's color, which the parity checks
  // compare with CVI's own registry; `color` and `shape` are what the maps, the PNGs and the legends draw.
  function registry(manifest) {
    const reg = cviRegistry(manifest);
    marks(reg.layers);
    return reg;
  }

  // CVI's .overlay_groups(): [{ group, keys }] in its canonical order, then the other groups alphabetically (R's sort
  // in an English locale: letters before case).
  function groups(layers) {
    const names = [...new Set(layers.map(l => l.group || 'Other'))];
    const ordered = GROUP_ORDER.filter(g => names.includes(g))
      .concat(names.filter(g => !GROUP_ORDER.includes(g)).sort((a, b) => a.localeCompare(b, 'en')));
    return ordered.map(g => ({ group: g, keys: layers.filter(l => (l.group || 'Other') === g).map(l => l.key) }));
  }

  // CVI's .resolve_name_col on the read.csv names (after make.names). Deliberate privacy difference: the last step,
  // "any column with name in it", skips columns the personal-field screen excludes (e.g. Owner.Name), so such a file
  // shows "Unnamed facility" instead of a person's name.
  function resolveNameColumn(nm, cols) {
    if (cols.includes(nm)) return nm;
    const lower = s => s.toLowerCase();
    let hit = cols.find(c => lower(c) === lower(nm)); if (hit !== undefined) return hit;
    const mn = makeName(nm);
    if (cols.includes(mn)) return mn;
    hit = cols.find(c => lower(c) === lower(mn)); if (hit !== undefined) return hit;
    hit = cols.find(c => /name/i.test(c) && c !== 'ref_name' && !EXCLUDED.test(c));
    return hit === undefined ? null : hit;
  }

  // parsed: csv.js parse() of the file. { ok: false, reason } when CVI's loader gives NULL (no rows, no coordinate
  // columns, no row with numbers in both); else { ok: true, points: [{ name, lon, lat }], dropped, outOfRange }.
  function parseLayer(parsed, nameColumn) {
    const header = makeNames(parsed.header || []);
    const rows = (parsed.rows || []).filter(r => !(r.length === 1 && (r[0] === null || r[0] === '')));
    if (!header.length || !rows.length) return { ok: false, reason: 'no rows' };
    const pick = cands => {
      const low = header.map(h => h.toLowerCase());
      for (const c of cands) { const i = low.indexOf(c); if (i >= 0) return i; }
      return -1;
    };
    const iLat = pick(['lat', 'latitude', 'y']), iLon = pick(['long', 'lon', 'lng', 'longitude', 'x']);
    if (iLat < 0 || iLon < 0) return { ok: false, reason: 'no ' + (iLat < 0 ? 'latitude' : 'longitude') + ' column' };
    const nc = resolveNameColumn(nameColumn, header.concat(['ref_lat', 'ref_long']));
    const iName = nc === null ? -1 : header.indexOf(nc);
    const points = [];
    let dropped = 0, outOfRange = 0;
    rows.forEach(r => {
      const lat = num(r[iLat]), lon = num(r[iLon]);
      if (Number.isNaN(lat) || Number.isNaN(lon)) { dropped++; return; }
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) { outOfRange++; return; }
      const v = iName < 0 ? '' : r[iName];
      points.push({ name: v === null || v === undefined ? '' : String(v), lon, lat });
    });
    if (!points.length) return { ok: false, reason: outOfRange ? 'no rows with valid coordinates' : 'no rows with numeric coordinates', dropped, outOfRange };
    return { ok: true, points, dropped, outOfRange, nameColumn: nc };
  }

  // ---- UI pass: one mark (a shape and a color) per facility layer -------------------------------------------------
  // Ten shapes; every layer gets a shape and color pair no other layer has, and one shape never carries two colors that
  // look alike, in normal vision or in the three simulated color-vision types. The pages draw the same mark on the live
  // maps, the PNGs, the legends, the layer lists and the Infrastructure count cards.
  const SHAPES = ['circle', 'square', 'diamond', 'triangle', 'triangle-down', 'star', 'pentagon', 'hexagon', 'cross',
    'x'];
  // Layers added from a manifest take the five shapes the built-in layers do not use first.
  const ADDED_SHAPES = ['circle', 'pentagon', 'hexagon', 'cross', 'x', 'square', 'diamond', 'triangle', 'triangle-down',
    'star'];
  // Six color families from the guide, no two alike in any of the four kinds of vision: Dark Blue, Evergreen, Gold,
  // Grass Green (CVI's first four colors for added layers), Black and Crimson. CVI's next two are left out: Light Blue
  // is nearly invisible on the light gray county map (1.3:1) and Dark Teal looks like Dark Blue. Ten shapes times six
  // families make 60 pairs.
  const FAMILIES = ['#1c5a83', '#4a8b2c', '#fcb614', '#8bc04a', '#000000', '#ca3014'];

  // Color-vision deficiency simulated as Machado, Oliveira and Fernandes (2009), severity 1.0, in linear RGB. Two
  // colors look alike when their CIE76 difference is under 10 (the measure used since S1.1), in any of the four.
  const VISION = {
    protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
    tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]]
  };
  const ALIKE = 10;
  const toLinear = v => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const toSrgb = v => {
    const c = Math.min(1, Math.max(0, v));
    return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
  };
  // A color written as "#rgb", "#rgba", "#rrggbb", "#rrggbbaa", "rgb()" or "rgba()" (any case) as { hex: "#rrggbb",
  // alpha }, read as CSS reads it: either the comma form, "rgb(r, g, b)" or "rgba(r, g, b, a)" (the three
  // channels all numbers or all percentages), or the space form, "rgb(r g b)" or "rgb(r g b / a)" (numbers and
  // percentages may mix); channels clamped to 0 to 255 and alpha to 0 to 1, as CSS clamps them; alpha a number or a
  // percentage. Null for any other way of writing a color (a name such as "teal", "hsl()": a known limit, drawn as
  // written by markSvg() but compared as text).
  function colorParts(color) {
    const t = String(color == null ? '' : color).trim().toLowerCase();
    const two = v => v.toString(16).padStart(2, '0');
    let m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(t);
    if (m) {
      let h = m[1];
      if (h.length <= 4) h = h.split('').map(c => c + c).join('');
      const alpha = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
      return { hex: '#' + h.slice(0, 6), alpha };
    }
    m = /^rgba?\(([^()]*)\)$/.exec(t);
    if (!m) return null;
    const body = m[1].trim();
    let channels;
    let alphaText = null;
    if (body.indexOf(',') >= 0) {
      // The comma form: no "/", three or four parts, the channels all numbers or all percentages.
      if (body.indexOf('/') >= 0) return null;
      const parts = body.split(',').map(x => x.trim());
      if (parts.length !== 3 && parts.length !== 4) return null;
      channels = parts.slice(0, 3);
      if (parts.length === 4) alphaText = parts[3];
      const percent = channels.filter(v => v.endsWith('%')).length;
      if (percent !== 0 && percent !== 3) return null;
    } else {
      // The space form: three channels, then "/ a" or nothing.
      const halves = body.split('/');
      if (halves.length > 2) return null;
      channels = halves[0].trim().split(/\s+/);
      if (channels.length !== 3) return null;
      if (halves.length === 2) {
        alphaText = halves[1].trim();
        if (!alphaText || /\s/.test(alphaText)) return null;
      }
    }
    const number = (v, scale) => {
      if (!/^[+-]?(\d+(\.\d*)?|\.\d+)%?$/.test(v)) return NaN;
      return v.endsWith('%') ? parseFloat(v) / 100 * scale : parseFloat(v);
    };
    const clamp = (v, hi) => Math.min(hi, Math.max(0, v));
    const rgb = channels.map(v => number(v, 255));
    const alpha = alphaText === null ? 1 : number(alphaText, 1);
    if (rgb.some(Number.isNaN) || Number.isNaN(alpha)) return null;
    return { hex: '#' + rgb.map(v => two(Math.round(clamp(v, 255)))).join(''), alpha: clamp(alpha, 1) };
  }
  // The color as "#rrggbb" (its alpha left out), for comparing colors; null when it is not read (colorParts()).
  function hexColor(color) {
    const parts = colorParts(color);
    return parts ? parts.hex : null;
  }
  const rgbOf = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  // A color as seen with one kind of color vision (VISION's matrices), as "#rrggbb".
  function simulate(color, kind) {
    const hex = hexColor(color);
    if (!hex || !VISION[kind]) return hex;
    const lin = rgbOf(hex).map(toLinear), m = VISION[kind];
    const out = m.map(row => toSrgb(row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]));
    return '#' + out.map(v => v.toString(16).padStart(2, '0')).join('');
  }
  // A color in CIE L*a*b*.
  function lab(hex) {
    const [r, g, b] = rgbOf(hex).map(toLinear);
    const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
    const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  }
  // The CIE76 difference between two colors.
  function deltaE(a, b) {
    const p = lab(a), q = lab(b);
    return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  }
  // The smallest difference between two colors over the four kinds of vision.
  function visionDifference(a, b) {
    return Math.min(...['normal'].concat(Object.keys(VISION)).map(k => deltaE(simulate(a, k), simulate(b, k))));
  }
  // A color written some other way (a name such as "red") is compared as text only.
  function lookAlike(a, b) {
    const p = hexColor(a), q = hexColor(b);
    if (!p || !q) return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
    return visionDifference(p, q) < ALIKE;
  }

  // Gives each layer, in registry order, its `shape` and `color`; `cviColor` keeps the color the registry had.
  // A layer whose color is fixed (a built-in layer's, or the color a manifest row gives) keeps it and takes the first
  // shape where no look-alike color is drawn (a built-in layer its own shape first). Any other layer takes the first
  // free pair in the list below: round 0 gives the shapes in turn the families in turn, each later round moves every
  // shape on to its next family, so the first added layers differ by shape and by color. A layer's mark never depends
  // on the layers after it. When every shape already carries a look-alike color, the layer shares a mark: both
  // layers list each other in `sharesMarkWith`, and the legends say so (sharedNote()).
  function marks(layers) {
    const placed = Object.fromEntries(SHAPES.map(s => [s, []]));
    const fits = (shape, color) => placed[shape].every(o => !lookAlike(o.color, color));
    const pairs = [];
    FAMILIES.forEach((f, round) => ADDED_SHAPES.forEach((shape, i) => {
      pairs.push({ shape, color: FAMILIES[(i + round) % FAMILIES.length] });
    }));
    const builtinColor = key => {
      const b = BUILTIN.find(x => x.key === key);
      return (BUILTIN_MARKS[key] && BUILTIN_MARKS[key].color) || b.color;
    };
    let overflow = 0;
    layers.forEach(l => {
      const preferred = l.builtin && BUILTIN_MARKS[l.key] ? BUILTIN_MARKS[l.key].shape : null;
      // A manifest color the browser cannot read is not used: the map would refuse the layer; the
      // layer takes an automatic mark, and the checklist names the row (facility-datasets.js readableColor()).
      const own = l.ownColor && (colorParts(l.color) || drawable(l.color));
      const fixed = own ? l.color : l.builtin ? builtinColor(l.key) : null;
      let mark = null;
      if (fixed) {
        const order = (preferred ? [preferred] : []).concat(ADDED_SHAPES.filter(s => s !== preferred));
        const shape = order.find(s => fits(s, fixed));
        if (shape) mark = { shape, color: fixed };
      } else {
        mark = pairs.find(p => fits(p.shape, p.color)) || null;
      }
      if (!mark) {
        const reuse = pairs[overflow % pairs.length];
        mark = fixed ? { shape: preferred || reuse.shape, color: fixed } : reuse;
        overflow++;
      }
      const alike = placed[mark.shape].filter(o => lookAlike(o.color, mark.color));
      alike.forEach(o => o.layer.sharesMarkWith.push(l.key));
      Object.assign(l, { cviColor: l.color, color: mark.color, shape: mark.shape,
        sharesMarkWith: alike.map(o => o.layer.key) });
      placed[mark.shape].push({ color: mark.color, layer: l });
    });
    return layers;
  }

  // The legend's note when two of the layers it shows share a mark (only past 60 layers); '' otherwise.
  function sharedNote(layers) {
    const keys = new Set(layers.map(l => l.key));
    const pairs = [];
    layers.forEach(l => (l.sharesMarkWith || []).forEach(k => {
      const other = layers.find(x => x.key === k);
      if (keys.has(k) && layers.indexOf(other) > layers.indexOf(l)) pairs.push(l.liveLabel + ' and ' + other.liveLabel);
    }));
    return pairs.length ? 'Some layers share a mark: ' + pairs.join('; ') + '.' : '';
  }

  // The outline of a mark centered on (cx, cy) as SVG path data, for the live maps' pictures (Path2D), the PNGs and
  // the legends alike. r is the circle's radius; the other shapes are sized to look about as heavy as that circle.
  // MARK_EXTENT: how far each shape reaches from its center, in r, for spacing legend rows.
  const MARK_EXTENT = { circle: 1, square: 0.88, diamond: 1.18, triangle: 1.32, 'triangle-down': 1.32, star: 1.36,
    pentagon: 1.1, hexagon: 1.06, cross: 1.12, x: 1.16 };
  function markPath(shape, cx, cy, r) {
    const n = v => String(Math.round(v * 100) / 100);
    const poly = points => 'M' + points.map(([x, y]) => n(cx + x) + ' ' + n(cy + y)).join('L') + 'Z';
    const around = (count, radius, start) => Array.from({ length: count }, (_, i) => {
      const t = start + i * 2 * Math.PI / count;
      return [radius * Math.cos(t), radius * Math.sin(t)];
    });
    const e = MARK_EXTENT[shape] * r;
    switch (shape) {
      case 'square':
        return poly([[-e, -e], [e, -e], [e, e], [-e, e]]);
      case 'diamond':
        return poly(around(4, e, -Math.PI / 2));
      case 'triangle':
        return poly(around(3, e, -Math.PI / 2));
      case 'triangle-down':
        return poly(around(3, e, Math.PI / 2));
      case 'star':
        return poly(Array.from({ length: 10 }, (_, i) => {
          const t = -Math.PI / 2 + i * Math.PI / 5, radius = i % 2 ? e * 0.5 : e;
          return [radius * Math.cos(t), radius * Math.sin(t)];
        }));
      case 'pentagon':
        return poly(around(5, e, -Math.PI / 2));
      case 'hexagon':
        return poly(around(6, e, 0));
      case 'cross':
      case 'x': {
        // A plus sign of two bars 0.72 r wide; the X is the same turned by 45 degrees.
        const w = 0.36 * r, a = shape === 'x' ? Math.PI / 4 : 0;
        const plus = [[-w, -e], [w, -e], [w, -w], [e, -w], [e, w], [w, w], [w, e], [-w, e], [-w, w], [-e, w],
          [-e, -w], [-w, -w]];
        return poly(plus.map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]));
      }
      default:
        return 'M' + n(cx - r) + ' ' + n(cy) + 'A' + n(r) + ' ' + n(r) + ' 0 1 0 ' + n(cx + r) + ' ' + n(cy) +
          'A' + n(r) + ' ' + n(r) + ' 0 1 0 ' + n(cx - r) + ' ' + n(cy) + 'Z';
    }
  }

  // A layer's mark as a small inline SVG for the page's lists, legends and cards (size: CSS pixels, square), with
  // the white edge the map draws. The caller escapes nothing: the shape is from SHAPES and the color is checked.
  // A color colorParts() does not read but the browser draws (a name such as "teal", "hsl()"): drawn as
  // written in the lists, legends and count cards, as on the live map. Only the characters a CSS color uses, and
  // only where the browser says it is a color (CSS.supports); a plain name otherwise.
  function drawable(color) {
    const t = String(color == null ? '' : color).trim();
    if (!t || !/^[a-z0-9#(),.%\s\/+-]+$/i.test(t)) return false;
    const css = root.CSS;
    if (css && typeof css.supports === 'function') return css.supports('color', t);
    return /^[a-z]+$/i.test(t);
  }
  // The markup of a layer's mark as a small SVG image, size pixels square.
  function markSvg(layer, size) {
    const s = size || 16, shape = SHAPES.includes(layer.shape) ? layer.shape : 'circle';
    const r = (s / 2 - 1) / Math.max(...Object.values(MARK_EXTENT));
    const parts = colorParts(layer.color);
    const fill = parts ? parts.hex : drawable(layer.color) ? String(layer.color).trim() : '#666666';
    // A see-through color ("#rrggbbaa", "rgba()") is drawn see-through, as on the live map; a fully see-through one
    // gets a gray outline so its mark still shows.
    const opacity = parts && parts.alpha < 1 ? '" fill-opacity="' + Number(parts.alpha.toFixed(3)) : '';
    const stroke = parts && parts.alpha === 0 ? '#666666' : '#ffffff';
    return '<svg class="facility-mark" width="' + s + '" height="' + s + '" viewBox="0 0 ' + s + ' ' + s +
      '" aria-hidden="true" focusable="false"><path d="' + markPath(shape, s / 2, s / 2, r) + '" fill="' + fill +
      opacity + '" stroke="' + stroke + '" stroke-width="1.2" stroke-linejoin="round"/></svg>';
  }

  // The mark as a page element (a list row, a legend line, a count card): a span holding markSvg(). data-shape and
  // data-color say which mark it is.
  function markElement(layer, size) {
    const span = root.document.createElement('span');
    span.className = 'facility-swatch facility-mark-box';
    span.dataset.shape = layer.shape || 'circle';
    span.dataset.color = layer.color;
    span.innerHTML = markSvg(layer, size || 18);
    return span;
  }

  // ---- S6: shared preparation, filters and selection (the S5 coordinate and registry rules above) ------------
  // CVI's .CVI_OVERLAY_EXCL_PAT: personal or noisy column names, never offered as filters or shown in details.
  const EXCLUDED = new RegExp([
    'address|street|\\bzip\\b|phone|e-?mail|url|website|http|note|comment|',
    'geometry|coord|\\bcounty\\b|\\blocation\\b|',
    'owner|contact|submitter|operator|licensee|permittee|applicant|manager|',
    'first.?name|last.?name'].join(''), 'i');
  // CVI's excl_exact in cvi_overlay_filter_cols (the name column is added per layer).
  const EXACT = new Set(['ref_name', 'ref_lat', 'ref_long', 'geo_source', '._county', '.cvi_lon', '.cvi_lat',
    'lat', 'lon', 'lng', 'long', 'latitude', 'longitude', 'Lat', 'Long', 'Latitude', 'Longitude', 'x', 'y']);
  const missing = v => v == null || String(v) === 'NA';
  // CVI's cvi_split_multivalue: only "|" and ";" separate values; "," and "/" stay inside one value.
  const tokens = v => missing(v) ? [] : String(v).split(/[|;]/).map(x => x.trim()).filter(Boolean);
  const pretty = key => String(key).replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();

  // R's type.convert, as read.csv applies it to each column. Logical: only TRUE, FALSE, T and F, exactly as
  // written ("true", "True" and " TRUE" are text). Numbers: spaces around them allowed; decimal with an
  // optional exponent; hexadecimal with an optional binary exponent; NaN, Inf and Infinity in any case,
  // except text starting with "NA" ("NAN"), which R reads as NA followed by more text. Checked against R
  // 4.4.3; R's complex numbers ("1i") count as text here.
  const R_LOGICAL = /^(TRUE|FALSE|T|F)$/;
  const R_DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
  const R_HEX = /^[+-]?0[xX](?=[0-9a-fA-F.])[0-9a-fA-F]*\.?[0-9a-fA-F]*([pP][+-]?\d+)?$/;
  const R_SPECIAL = /^[+-]?(nan|inf|infinity)$/i;
  // True for text R reads as a number.
  function rNumeric(value) {
    const t = String(value).trim();
    if (/^NA/.test(t)) return false;
    return R_DECIMAL.test(t) || R_HEX.test(t) || R_SPECIAL.test(t);
  }
  // A column's type as read.csv gives it: logical, numeric or character, missing values ignored.
  function columnType(values) {
    const v = values.filter(x => !missing(x) && String(x).trim() !== '');
    if (v.every(x => R_LOGICAL.test(String(x)))) return 'logical';
    if (v.every(rNumeric)) return 'numeric';
    return 'character';
  }

  // A cell as R holds it after type conversion, as text (null when missing or not a number).
  function cellValue(v, type) {
    if (missing(v)) return null;
    if (type === 'numeric') {
      const n = num(v);
      return Number.isNaN(n) ? null : String(n);
    }
    if (type === 'logical') {
      const t = String(v).trim();
      return t === 'T' ? 'TRUE' : t === 'F' ? 'FALSE' : t;
    }
    return String(v);
  }

  // read.csv's header: make.names(unique = TRUE), where names that make.names leaves unchanged keep their
  // spelling and the changed ones get the numbered suffixes.
  function readCsvNames(original) {
    const made = original.map(makeName);
    const order = made.map((h, i) => i)
      .sort((a, b) => Number(made[b] === original[b]) - Number(made[a] === original[a]));
    const unique = makeUnique(order.map(i => made[i]));
    const header = [];
    order.forEach((i, j) => { header[i] = unique[j]; });
    return header;
  }

  const isBlankLine = r => r.length === 1 && (r[0] == null || r[0] === '');
  // The index of the first header equal to one of the names, ignoring case, or -1.
  function findColumn(header, names) {
    for (const n of names) {
      const i = header.findIndex(h => h.toLowerCase() === n);
      if (i >= 0) return i;
    }
    return -1;
  }

  // The layer's filter columns: the manifest's filter_cols when given (screened, any type), otherwise CVI's
  // automatic choice: text columns other than the name and bookkeeping columns, with 2 to 30 distinct values
  // (200 for species columns) among the rows kept on the map.
  function filterColumns(spec, header, types, cells, nameColumn) {
    if (spec.filterColumns && spec.filterColumns.length) {
      return [...new Set(spec.filterColumns)].filter(h => header.includes(h) && !EXCLUDED.test(h));
    }
    return header.filter(h => {
      if (h === nameColumn || EXACT.has(h) || EXCLUDED.test(h) || types[h] !== 'character') return false;
      const n = new Set(cells.flatMap(row => tokens(row[h]))).size;
      return n >= 2 && n <= (/species/i.test(h) ? 200 : 30);
    });
  }

  // Each registry layer prepared from its supplied file (csv.js parse() results keyed by layer key, a Map or an
  // object). Points keep their name, location, precision, counties and only the filter columns' values; other
  // supplied columns, screened ones included, are not kept. Point IDs belong to this revision of the files.
  function prepare(files, manifest, counties, revision) {
    const reg = registry(manifest);
    const membership = countyMembership(counties, counties.features.map(f => f.properties.name));
    const byId = new Map();
    const layers = reg.layers.map((spec, index) => {
      const parsed = files instanceof Map ? files.get(spec.key) : files[spec.key];
      if (!parsed) {
        return Object.assign({}, spec, { usable: false, reason: 'file not supplied', points: [],
          choices: Object.create(null) });
      }
      const layer = prepareLayer(spec, index, parsed, membership, revision);
      layer.points.forEach(p => byId.set(p.id, p));
      return layer;
    });
    return { registry: reg, layers, byId, revision };
  }

  // One registry layer prepared from its parsed file: its points, omission counts, column types and filter
  // choices.
  function prepareLayer(spec, index, parsed, membership, revision) {
    const header = readCsvNames(parsed.header || []);
    const base = parseLayer({ header, rows: parsed.rows }, spec.nameColumn);
    const rows = (parsed.rows || []).filter(r => !isBlankLine(r));
    const types = Object.create(null);
    header.forEach((h, i) => { types[h] = columnType(rows.map(r => r[i])); });
    const latIndex = findColumn(header, ['lat', 'latitude', 'y']);
    const lonIndex = findColumn(header, ['long', 'lon', 'lng', 'longitude', 'x']);
    const nameIndex = header.indexOf(base.nameColumn || resolveNameColumn(spec.nameColumn, header) || '');
    const precisionIndex = header.indexOf('geo_source');
    // The town a point names: the first of CVI's town columns the file has (static_map_renderer.R 3647-3652). The
    // Facilities PNG names a lone town-level facility by it (S9).
    const townIndex = header.indexOf(TOWN_COLUMNS.find(c => header.includes(c)) || '');

    // The rows drawn on the map: a finite point inside the valid ranges. `ordinal` counts non-blank rows.
    const kept = [];
    if (base.ok) {
      rows.forEach((r, ordinal) => {
        const lat = num(r[latIndex]), lon = num(r[lonIndex]);
        if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) return;
        const cells = Object.create(null);
        header.forEach((h, i) => { cells[h] = cellValue(r[i], types[h]); });
        kept.push({ r, ordinal, lon, lat, cells });
      });
    }
    const columns = base.ok ? filterColumns(spec, header, types, kept.map(k => k.cells), base.nameColumn) : [];

    const points = kept.map(({ r, ordinal, lon, lat, cells }) => {
      const values = Object.create(null);
      columns.forEach(h => { values[h] = cells[h]; });
      // CVI trims geo_source and treats blank as "existing"; NA is "existing" too (a deliberate S6 difference).
      const flag = precisionIndex < 0 || missing(r[precisionIndex]) ? '' : String(r[precisionIndex]).trim();
      const geoSource = flag || 'existing';
      const name = nameIndex < 0 || missing(r[nameIndex]) ? '' : String(r[nameIndex]);
      const town = /^google_city$/i.test(geoSource) ? ' (town-level location)' : '';
      const hits = membership.countiesAt(lon, lat);
      const townName = townIndex < 0 || missing(r[townIndex]) ? '' : String(r[townIndex]).trim();
      return { id: String(revision) + ':' + index + ':' + ordinal, ordinal, name, lon, lat, geoSource, townName,
        display: name + town, county: hits[0] || null, counties: hits, values };
    });

    const choices = Object.create(null);
    columns.forEach(h => {
      const values = new Set(points.flatMap(p => tokens(p.values[h])));
      choices[h] = [...values].sort((a, b) => a.localeCompare(b, 'en'));
    });
    return Object.assign({}, spec, { usable: !!base.ok, reason: base.reason || '', points, choices, types,
      dropped: base.dropped || 0, outOfRange: base.outOfRange || 0 });
  }

  // The selected usable layers with only their matching points. Within one column any picked value matches;
  // across columns every column with picks must match; a column with nothing picked does not restrict.
  // opts: { layers, attributes: { layerKey: { column: [values] } }, geometry(point) -> boolean }.
  function select(prepared, opts) {
    const on = new Set(opts.layers || []);
    const attributes = opts.attributes || Object.create(null);
    const layers = prepared.layers.filter(l => l.usable && on.has(l.key)).map(l => {
      const picks = Object.hasOwn(attributes, l.key) ? attributes[l.key] : Object.create(null);
      const columns = Object.keys(l.choices);
      const matches = p => columns.every(h => {
        const selected = Object.hasOwn(picks, h) ? picks[h] : [];
        return !selected.length || tokens(p.values[h]).some(v => selected.includes(v));
      });
      const points = l.points.filter(p => (!opts.geometry || opts.geometry(p)) && matches(p));
      return Object.assign({}, l, { points, count: points.length,
        zeroReason: points.length ? '' : 'No facilities match the selected counties and attributes.' });
    });
    return { revision: prepared.revision, layers, counts: Object.fromEntries(layers.map(l => [l.key, l.count])),
      rowIds: layers.flatMap(l => l.points.map(p => p.id)) };
  }

  // Layer switches and attribute picks carried over to newly prepared files. `initial` switches on every usable
  // layer (once per page). `cleared` names the picks dropped: values no longer offered, and every pick of a
  // layer that is not usable with the new files.
  function reconcile(prepared, selectedLayers, attributes, initial) {
    const usable = prepared.layers.filter(l => l.usable);
    const isUsable = key => usable.some(l => l.key === key);
    const on = initial ? usable.map(l => l.key) : selectedLayers.filter(isUsable);
    const picks = Object.create(null), cleared = [];
    for (const l of usable) {
      picks[l.key] = Object.create(null);
      for (const [h, values] of Object.entries(Object.hasOwn(attributes, l.key) ? attributes[l.key] : {})) {
        picks[l.key][h] = values.filter(v => l.choices[h] && l.choices[h].includes(v));
        if (picks[l.key][h].length !== values.length) cleared.push(l.liveLabel + ' / ' + pretty(h));
      }
    }
    for (const [key, columns] of Object.entries(attributes)) {
      if (isUsable(key)) continue;
      const layer = prepared.layers.find(l => l.key === key);
      for (const [h, values] of Object.entries(columns)) {
        if (!values.length) continue;
        cleared.push((layer ? layer.liveLabel : key) + ' / ' + pretty(h) + ' (layer not usable with these files)');
      }
    }
    return { selectedLayers: on, attributes: picks, cleared };
  }

  root.CVIWA = root.CVIWA || {};
  root.CVIWA.facilities = { countyMembership, registry, groups, parseLayer, resolveNameColumn, makeNames, makeName, num, shadeHex,
    BUILTIN, GROUP_ORDER, AUTO_COLORS, LAP_F, prepare, select, reconcile, tokens, pretty, columnType, EXCLUDED,
    cviRegistry, marks, sharedNote, markPath, markSvg, markElement, SHAPES, ADDED_SHAPES, FAMILIES, BUILTIN_MARKS, MARK_EXTENT,
    lookAlike, visionDifference, simulate, hexColor, colorParts };
  root.WSDA = root.WSDA || {}; root.WSDA.facilities = root.CVIWA.facilities;
})(typeof window !== 'undefined' ? window : globalThis);
