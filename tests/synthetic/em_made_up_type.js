/* A made-up third emergency type, for the Emergency unit suite's third-type test only (never loaded by a page). Every
 * field differs from HPAI's: its own disease words, column names (its own flock type and inventory), the word after
 * the animals' total, statuses and colors, closed column, values and date, zones from a file around the first status
 * only, in miles, layer keys and links. The test loads it after site/emergency/types/hpai.js, as a third
 * type file would be loaded, and checks that each field reaches the results with no other change. */
(function (root) {
  'use strict';
  root.WSDA.emergencyTypes.add({
    id: 'made-up-pox',
    name: 'Made-up pox (test only)',
    diseaseWords: ['made-up pox', 'mup'],
    columns: {
      id: ['Pox Ref'],
      detected: ['Seen On', 'Logged On'],
      disease: ['Pox Kind'],
      status: ['Pox Status'],
      quarantine: ['Freed On'],
      flockType: ['Herd Kind'],
      inventory: ['Herd Size'],
      shown: ['Pen']
    },
    inventoryWord: 'head',
    statuses: [
      { label: 'Active', words: ['active', 'open case'], color: '#1b7837' },
      { label: 'Watch', words: ['watch', 'monitor'], color: '#762a83' }
    ],
    closed: { column: 'Released', values: ['released', 'done'], dateColumn: ['Released On'] },
    zones: { source: 'file', rings: [], applyTo: 'confirmed', unit: 'mi' },
    layers: {
      bySpecies: [{ words: ['goat', 'sheep'], keys: ['restricted', 'slaughterhouses'] }],
      default: ['feedlots']
    },
    links: [{ label: 'Example reference', url: 'https://example.org/made-up-pox' }]
  });
})(typeof window !== 'undefined' ? window : globalThis);
