/* Which copy of the pages this is. publicCopy false: WSDA's pages, with every basemap and PNG background.
 * publicCopy true: a copy for another host, without the map services whose terms cover WSDA's own pages only (each
 * marked publish: false in cvi/app/basemaps.js and shared/tiles.js). Such a copy is made with it set to true; nothing
 * on the pages changes it.
 * Loaded first on the CVI and Infrastructure pages, before basemaps.js and tiles.js read it. */
(function (root) {
  'use strict';
  root.WSDA = root.WSDA || {};
  root.WSDA.release = { publicCopy: false };
})(typeof window !== 'undefined' ? window : globalThis);
