/* Common facility recognition descriptors and manifest expansion; shared by CVI and Infrastructure.
 * Header recognition does not promise usable map points. The master/manifest IDs remain reserved. */
(function (root) {
  'use strict';
  const LAT = { anyOf: ['lat', 'latitude', 'y'], caseless: true, label: 'latitude column (Lat, Latitude or y)' };
  const LONG = { anyOf: ['long', 'lon', 'lng', 'longitude', 'x'], caseless: true,
    label: 'longitude column (Long, Lon, Lng, Longitude or x)' };
  const FACILITY_LATER = 'County Focus facility markers (Facility Locations); Infrastructure facility locations';

  // A facility dataset descriptor: an optional file recognized by its latitude and longitude columns.
  function facility(id, name, file, nameColumn, group, about) {
    return { id, name, file, required: false, kind: 'facility', group, nameColumn, columns: [LAT, LONG],
      useful: [], features: [], later: FACILITY_LATER, about };
  }

  const datasets = [
    facility('slaughterhouses', 'Packing plants', 'usda_wa_slaughter_facilities.csv', 'USDA.Slaughter.Facility',
      'Processing & Harvest', 'USDA-inspected slaughter and packing facilities, one row per facility with its location.'),
    facility('fairgrounds', 'Fairgrounds', 'wa_state_fairs.csv', 'Fair.Name',
      'Events', 'Fairs and fairgrounds, one row per fair with its location.'),
    facility('markets', 'Livestock markets', 'wa_state_public_livestock_markets.csv', 'name',
      'Markets & Sales', 'Public livestock markets, one row per market with its location.'),
    facility('feedlots', 'Feedlots', 'wa_state_feedlots.csv', 'name',
      'Holding & Feeding', 'Feedlots, one row per feedlot with its location.'),
    facility('restricted', 'Restricted holding facilities', 'wa_state_restricted_holding_facilities.csv', 'NAME',
      'Holding & Feeding', 'Restricted holding facilities, one row per facility with its location.'),
    { id: 'manifest', name: 'Facility layer list (manifest)', file: 'facility_overlays_manifest.csv', required: false,
      kind: 'manifest',
      columns: [{ anyOf: ['key'], caseless: true, label: 'key' }, { anyOf: ['file'], caseless: true, label: 'file' }],
      useful: [], features: [], later: 'Adds facility layers to County Focus (Facility Locations) and Infrastructure',
      about: 'Optional list of extra facility layers: one row per layer with its file name, label and group.' }
  ];
  /** CVI's .read_overlay_manifest() rules, on rows parsed from the manifest CSV (header row first).
   * Column names are lower-cased and trimmed; blank keys, keys starting with "#", blank files and
   * enabled = false/no/0/f rows are skipped; the text "NA" counts as blank. A key equal to a built-in layer
   * overrides that layer (file, name column, label); other keys add layers in manifest order.
   * Returns { overrides: { id: { file, nameColumn, name, group } }, added: [dataset], skipped: [{ row, reason }],
   * notes: [{ row, reason }] } (notes: rows used with a change, such as a color the browser cannot read). */
  const MAX_MANIFEST_LAYERS = 500;

  // Whether a manifest color is one the browser (and so the live map) can read: the browser's own answer where it
  // has one (CSS.supports), else a hex color, an rgb()/hsl() form or a plain name. A color it
  // cannot read ("1c5a83" without "#", "#12345", "Teal Blue") would stop the map from drawing the layer.
  function readableColor(color) {
    const t = String(color == null ? '' : color).trim();
    if (!t) return false;
    const css = root.CSS;
    if (css && typeof css.supports === 'function') return css.supports('color', t);
    return /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(t) || /^(rgb|hsl)a?\([^()]*\)$/i.test(t) ||
      /^[a-z]+$/i.test(t);
  }

  function expandManifest(rows) {
    const out = { overrides: {}, added: [], skipped: [], notes: [] }, at = new Map();
    if (!rows.length) return out;
    const head = rows[0].map(h => String(h == null ? '' : h).trim().toLowerCase());
    const col = name => head.indexOf(name);
    const get = (r, name) => {
      const i = col(name); if (i < 0) return '';
      const v = r[i] == null ? '' : String(r[i]).trim();
      return v.toUpperCase() === 'NA' ? '' : v;
    };
    if (col('key') < 0 || col('file') < 0) return out;
    const builtins = new Set(datasets.filter(d => d.kind === 'facility').map(d => d.id));
    const reserved = new Set(['master', 'manifest']);
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const key = get(r, 'key'), file = get(r, 'file');
      if (!key || key.startsWith('#') || !file) continue;
      const en = get(r, 'enabled').toLowerCase();
      if (en && ['false', 'no', '0', 'f'].includes(en)) continue;
      if (reserved.has(key)) { out.skipped.push({ row: i + 1, reason: `the key "${key}" is reserved` }); continue; }
      const color = get(r, 'color');
      if (color && !readableColor(color)) {
        out.notes.push({ row: i + 1, reason: `the color "${color.slice(0, 40)}" is not a color the browser can read, ` +
          'so the layer is drawn in an automatic color' });
      }
      const label = get(r, 'label') || key;
      const spec = { file, nameColumn: get(r, 'name_col') || 'name', name: get(r, 'live_label') || label,
        group: get(r, 'group') || 'Other' };
      if (builtins.has(key)) { out.overrides[key] = spec; continue; }
      const ds = Object.assign(facility(key, spec.name, file, spec.nameColumn, spec.group,
        'Extra facility layer listed in the manifest.'), { fromManifest: true });
      if (at.has(key)) { out.added[at.get(key)] = ds; continue; }   // a repeated key replaces the earlier row, as in CVI
      if (out.added.length >= MAX_MANIFEST_LAYERS) {
        out.skipped.push({ row: i + 1, reason: `more than ${MAX_MANIFEST_LAYERS} layers; the rest were not added` });
        break;
      }
      at.set(key, out.added.length); out.added.push(ds);
    }
    return out;
  }

  root.WSDA = root.WSDA || {};
  root.WSDA.facilityDatasets = { datasets, expandManifest, readableColor };
})(typeof window !== 'undefined' ? window : globalThis);
