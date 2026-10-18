/* WA State direction palettes and National Flow species palettes: values from CVI shiny/R/map_helpers.R
 * DIRECTION_PALETTES and SPECIES_PALETTES, except (by design) the WSDA-named colors that are not the WSDA
 * brand guide's: CVI's orange #ee7e2c is the guide's Orange #f07325, and Flow "WSDA Brand" takes the guide's Blue Green,
 * Grass Green and Gold. CVI_VALUES lists each changed color with CVI's value. */
(function (root) {
  'use strict';
  const DIRECTION_PALETTES = {
    'WSDA Default': { Inbound: '#1C9CD9', Outbound: '#F0A06E' },
    'WSDA Brand': { Inbound: '#1c5a83', Outbound: '#f07325' },
    'Print Friendly': { Inbound: '#003F5C', Outbound: '#F4A261' },
    'High Contrast': { Inbound: '#0033A0', Outbound: '#D62728' },
    'Single — WSDA Blue': { Inbound: '#1c5a83', Outbound: '#1c5a83' },
    'Single — WSDA Teal': { Inbound: '#245566', Outbound: '#245566' },
    'Single — WSDA Orange': { Inbound: '#f07325', Outbound: '#f07325' },
    'Single — Slate Gray': { Inbound: '#555555', Outbound: '#555555' }
  };
  // .build_county_map: color = palette[direction]. The Combined total circle ("Total", which no palette names) takes
  // the palette's first color (by design: CVI's own "Combine species" rule on its Flow map,
  // .flow_single_color); CVI draws it #245566 whatever the palette. The legend shows the same color.
  function circleColor(paletteName, direction) {
    const p = DIRECTION_PALETTES[paletteName] || DIRECTION_PALETTES['WSDA Default'];
    return p[direction] || p.Inbound;
  }
  const legendColor = circleColor;
  // The color a circle shows: hex at opacity over the color under it (MapLibre's blending), as '#rrggbb'.
  function blend(hex, opacity, under) {
    const c = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)), a = c(hex), b = c(under), t = Number(opacity);
    return '#' + a.map((x, i) => Math.round(x * t + b[i] * (1 - t)).toString(16).padStart(2, '0')).join('');
  }
  // National Flow species palettes: values and order from CVI shiny/R/map_helpers.R SPECIES_PALETTES ("WSDA Default" is
  // SPECIES_COLORS; each "Single — …" palette gives every species the same color).
  const SPECIES = ['Cattle', 'Equids', 'Exotic Hoofstock', 'Poultry', 'Small Ruminants', 'Swine', 'Other'];
  const named = hexes => { const o = {}; SPECIES.forEach((k, i) => { o[k] = hexes[i]; }); return o; };
  const solid = hex => named(SPECIES.map(() => hex));
  const SPECIES_PALETTES = {
    'WSDA Default': named(['#4E79A7', '#F28E2B', '#E15759', '#76B7B2', '#59A14F', '#EDC948', '#B07AA1']),
    'WSDA Brand': named(['#245566', '#1c5a83', '#f07325', '#0094aa', '#8bc04a', '#fcb614', '#888888']),
    'Color-blind Safe': named(['#0072B2', '#E69F00', '#009E73', '#56B4E9', '#F0E442', '#D55E00', '#CC79A7']),
    'Muted': named(['#5D7592', '#C5814A', '#A4585C', '#7B9F9C', '#7B9466', '#B5A24E', '#9D8FA0']),
    'Single — WSDA Blue': solid('#1c5a83'),
    'Single — WSDA Teal': solid('#245566'),
    'Single — WSDA Orange': solid('#f07325'),
    'Single — Slate Gray': solid('#555555')
  };

  // CVI's values where the page's differ on purpose: [palette, entry, CVI's value]; the tests check every other value is CVI's.
  const CVI_VALUES = [['direction', 'WSDA Brand', 'Outbound', '#ee7e2c'], ['direction', 'Single — WSDA Orange', 'Inbound', '#ee7e2c'],
    ['direction', 'Single — WSDA Orange', 'Outbound', '#ee7e2c'], ['species', 'WSDA Brand', 'Exotic Hoofstock', '#ee7e2c'],
    ['species', 'WSDA Brand', 'Poultry', '#4ea2c4'], ['species', 'WSDA Brand', 'Small Ruminants', '#76a553'],
    ['species', 'WSDA Brand', 'Swine', '#d4a017']].concat(SPECIES.map(k => ['species', 'Single — WSDA Orange', k, '#ee7e2c']));

  root.CVIWA = root.CVIWA || {};
  root.CVIWA.palettes = { DIRECTION_PALETTES, circleColor, legendColor, blend, SPECIES_PALETTES, CVI_VALUES };
})(typeof window !== 'undefined' ? window : globalThis);
