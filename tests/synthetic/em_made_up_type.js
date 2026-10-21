/* A made-up third emergency type, for the Emergency unit suite's third-type test only (never loaded by a page). Every
 * field differs from HPAI's: its own disease words, statuses and colors, closed column and values, zones from a file
 * applied to every positive, layer keys and links. The test loads it after site/emergency/types/hpai.js, as a third
 * type file would be loaded, and checks that each field reaches the results with no other change. */
(function (root) {
  'use strict';
  root.WSDA.emergencyTypes.add({
    id: 'made-up-pox',
    name: 'Made-up pox (test only)',
    diseaseWords: ['made-up pox', 'mup'],
    statuses: [
      { label: 'Active', words: ['active', 'open case'], color: '#1b7837' },
      { label: 'Watch', words: ['watch', 'monitor'], color: '#762a83' }
    ],
    closed: { column: 'Released', values: ['released', 'done'] },
    zones: { source: 'file', rings: [], applyTo: 'all', unit: 'km' },
    layers: {
      bySpecies: [{ words: ['goat', 'sheep'], keys: ['restricted', 'slaughterhouses'] }],
      default: ['feedlots']
    },
    links: [{ label: 'Example reference', url: 'https://example.org/made-up-pox' }]
  });
})(typeof window !== 'undefined' ? window : globalThis);
