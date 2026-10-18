/* PNG backgrounds for the branded map exports (S9; CVI shiny/R/tile_basemap.R, "TB" below, and
 * the themes of static_map_renderer.R). CVI's three tile backgrounds come from Esri's services on
 * server.arcgisonline.com (already allowed by the page's Content Security Policy): first one "export" image of the
 * map's box (TB 137-198), and when that fails, the service's tiles at CVI's zoom stitched together (TB 200-288).
 * The page asks for both in Web Mercator, the projection it draws in (a deliberate difference); CVI asks for the
 * export image in longitude/latitude. A background that cannot be loaded gives null, and the caller draws the
 * Default background with a notice (a deliberate difference; CVI falls back silently).
 *
 * "Export quality" keeps CVI's meaning, tile zoom +2 (TB's tiles); the page also doubles the export image's size
 * with High, since in CVI the export image (used whenever it loads) is always 2,400 pixels wide and Export quality
 * changes nothing then. The tile zoom is lowered while the tiles would hold more than twice the picture's pixels
 * across (four times with High), so a fallback asks tens of tiles, not hundreds or thousands. Nothing here runs
 * unless a background other than Default is picked. */
(function (root) {
  'use strict';

  const HOST = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
  // CVI's choices (mod_maps.R 4463-4468), their services, credits (TB 91-103), largest zooms (TB 31-39) and themes
  // (static_map_renderer.R 1526-1600: "satellite" and "hillshade" have their own; Shaded Relief keeps the standard).
  // publish: false: cleared for WSDA's own pages with the Esri basemaps (site/PROVENANCE.md); a copy made with
  // shared/release.js publicCopy true offers none of them.
  const ALL_BACKGROUNDS = {
    'raster:esri_satellite': { label: 'Satellite', provider: 'Esri', service: 'World_Imagery/MapServer', maxZoom: 19,
      attribution: 'Source: Esri, Maxar, Earthstar Geographics', theme: 'satellite', publish: false },
    'raster:esri_relief': { label: 'Shaded Relief', provider: 'Esri', service: 'World_Shaded_Relief/MapServer', maxZoom: 13,
      attribution: 'Source: Esri', theme: 'standard', publish: false },
    'raster:esri_hillshade': { label: 'Hillshade', provider: 'Esri', service: 'Elevation/World_Hillshade/MapServer', maxZoom: 19,
      attribution: 'Source: Esri', theme: 'hillshade', publish: false }
  };
  const release = root.WSDA && root.WSDA.release;
  const BACKGROUNDS = Object.fromEntries(Object.entries(ALL_BACKGROUNDS)
    .filter(([, b]) => !(release && release.publicCopy) || b.publish));
  // Takes out of the given pickers (select elements) the backgrounds this copy does not offer, so a public copy
  // offers Default only (and the background a picker had chosen falls back to its first choice).
  function prunePickers(selects) {
    for (const sel of selects) {
      if (!sel) continue;
      for (const o of [...sel.options]) {
        if (ALL_BACKGROUNDS[o.value] && !BACKGROUNDS[o.value]) o.remove();
      }
    }
  }
  // The note under a PNG background picker: where the chosen background comes from and what its provider sees (the
  // live basemap note's sentence, cvi/app/basemaps.js); empty for Default and Streets, which need no network.
  function providerLine(key) {
    const b = BACKGROUNDS[key];
    return b ? root.CVIWA.basemaps.providerSentence(b.provider) : '';
  }
  // The parts of CVI's themes the branded maps use (static_map_renderer.R 1528-1590).
  const THEMES = {
    standard: { boundary: '#8a8a8a', label: '#333333', labelFill: '#ffffff', labelFillAlpha: 0.78,
      outline: '#1c5a83' },
    satellite: { boundary: '#6e7a70', label: '#f7f7f0', labelFill: '#182019', labelFillAlpha: 0.70,
      outline: '#d8eee2' },
    hillshade: { boundary: '#5f6f78', label: '#2f3336', labelFill: '#ffffff', labelFillAlpha: 0.82,
      outline: '#4c6570' }
  };
  const EARTH = 6378137;
  const RAD = Math.PI / 180;
  // A longitude and latitude in Web Mercator meters.
  const mercator = (lon, lat) => [lon * RAD * EARTH, Math.log(Math.tan(Math.PI / 4 + lat * RAD / 2)) * EARTH];

  // The export request for a longitude/latitude box drawn width x height pixels (TB 151-171, in Web Mercator).
  function exportUrl(key, box, width, height) {
    const b = BACKGROUNDS[key];
    const [x0, y0] = mercator(box.west, box.south);
    const [x1, y1] = mercator(box.east, box.north);
    const q = ['f=image', 'bbox=' + [x0, y0, x1, y1].map(v => v.toFixed(2)).join(','), 'bboxSR=3857',
      'imageSR=3857', 'size=' + width + ',' + height, 'format=png24', 'transparent=false'];
    return HOST + b.service + '/export?' + q.join('&');
  }
  // The tiles covering a box at a zoom: { z, x0, x1, y0, y1 } and each tile's address.
  function tileRange(box, z) {
    const n = Math.pow(2, z);
    const tx = lon => Math.floor((lon + 180) / 360 * n);
    const ty = lat => Math.floor((1 - Math.log(Math.tan(lat * RAD) + 1 / Math.cos(lat * RAD)) / Math.PI) / 2 * n);
    return { z, x0: tx(box.west), x1: tx(box.east), y0: ty(box.north), y1: ty(box.south) };
  }
  // The address of one tile of a background.
  const tileUrl = (key, z, x, y) => HOST + BACKGROUNDS[key].service + '/tile/' + z + '/' + y + '/' + x;

  // A picture from a response, or null.
  async function picture(res) {
    if (!res || !res.ok) return null;
    try {
      const blob = await res.blob();
      if (!blob.size) return null;
      return await root.createImageBitmap(blob);
    } catch (e) {
      return null;
    }
  }
  // One picture from a URL, or null; the request and its picture stop after TIMEOUT_MS (a stalled
  // connection would otherwise keep Export grayed), so a stalled background falls back to Default with its notice.
  const TIMEOUT_MS = 30000;
  async function fetched(fetcher, url, ms) {
    const stop = typeof root.AbortController === 'function' ? new root.AbortController() : null;
    let timer = null;
    const late = new Promise(resolve => {
      timer = root.setTimeout(() => {
        if (stop) stop.abort();
        resolve(null);
      }, ms || TIMEOUT_MS);
    });
    // The live map's request rules (map.js): no redirect followed, no credentials, no referrer.
    const init = { redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' };
    if (stop) init.signal = stop.signal;
    const got = (async () => picture(await fetcher(url, init).catch(() => null)))();
    try {
      return await Promise.race([got, late]);
    } finally {
      root.clearTimeout(timer);
    }
  }
  // The tile zoom: CVI's, lowered while the tiles would hold more than `limit` times the picture's width in pixels
  // (CVI's zoom 10 for Washington is about 500 tiles, 6,900 pixels across, for a map about 1,700 pixels wide).
  function tileZoom(box, width, zoom, maxZoom, limit) {
    let z = Math.min(zoom, maxZoom);
    while (z > 0 && 256 * Math.pow(2, z) * (box.east - box.west) / 360 > limit * width) z--;
    return z;
  }
  // The tiles stitched and cut to the box, as a canvas of width x height pixels; null when any tile fails.
  async function stitched(key, box, width, height, zoom, fetcher, ms) {
    const r = tileRange(box, zoom);
    const n = Math.pow(2, r.z);
    const worldPx = 256 * n;
    const px = (lon, lat) => [(lon + 180) / 360 * worldPx,
      (1 - Math.log(Math.tan(lat * RAD) + 1 / Math.cos(lat * RAD)) / Math.PI) / 2 * worldPx];
    const [bx0, by0] = px(box.west, box.north);
    const [bx1, by1] = px(box.east, box.south);
    const canvas = root.document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const sx = width / (bx1 - bx0);
    const sy = height / (by1 - by0);
    for (let x = r.x0; x <= r.x1; x++) {
      for (let y = r.y0; y <= r.y1; y++) {
        const img = await fetched(fetcher, tileUrl(key, r.z, x, y), ms);
        if (!img) return null;
        ctx.drawImage(img, (x * 256 - bx0) * sx, (y * 256 - by0) * sy, 256 * sx, 256 * sy);
      }
    }
    return canvas;
  }

  // The background for a longitude/latitude box drawn width x height pixels: { image, attribution, how } or null.
  // o: { zoom (CVI's base zoom for the map), quality ('standard' or 'high'), fetch (the page's fetch; tests pass
  // their own), timeoutMs (the tests' shorter limit) }.
  async function load(key, box, width, height, o) {
    const b = BACKGROUNDS[key];
    if (!b) return null;
    const fetcher = (o && o.fetch) || ((u, init) => root.fetch(u, init));
    const high = o && o.quality === 'high';
    const scale = high ? 2 : 1;
    // Capped at 4096 pixels on the longer side, keeping the box's shape (capping each side alone asked
    // a square picture for an oblong box, which the service would widen to fit).
    const k = Math.min(1, 4096 / Math.max(width * scale, height * scale));
    const w = Math.round(width * scale * k);
    const h = Math.round(height * scale * k);
    const ms = o && o.timeoutMs;
    const image = await fetched(fetcher, exportUrl(key, box, w, h), ms);
    if (image) return { image, attribution: b.attribution, how: 'export', width: w, height: h };
    const zoom = tileZoom(box, width, ((o && o.zoom) || 10) + (high ? 2 : 0), b.maxZoom, high ? 4 : 2);
    const tiles = await stitched(key, box, Math.round(width), Math.round(height), zoom, fetcher, ms).catch(() => null);
    return tiles ? { image: tiles, attribution: b.attribution, how: 'tiles', zoom } : null;
  }

  root.WSDA = root.WSDA || {};
  root.WSDA.tiles = { ALL_BACKGROUNDS, BACKGROUNDS, prunePickers, providerLine, THEMES, exportUrl, tileRange, tileUrl, tileZoom, load, mercator, TIMEOUT_MS };
})(typeof window !== 'undefined' ? window : globalThis);
