/* Which copy of the pages this is. publicCopy false: this private build,
 * with every basemap and PNG background. publicCopy true: a public copy, without the map services whose terms are
 * not confirmed for public use (each marked publish: false in cvi/app/basemaps.js and shared/tiles.js). A public copy
 * is made with it set to true; nothing on the pages changes it.
 * Loaded first on the CVI and Infrastructure pages, before basemaps.js and tiles.js read it. */
(function (root) {
  'use strict';
  root.WSDA = root.WSDA || {};
  root.WSDA.release = { publicCopy: true };
})(typeof window !== 'undefined' ? window : globalThis);
