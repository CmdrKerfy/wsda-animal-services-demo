/* Emergency type: New World screwworm (NWS), the second type.
 *
 * The fields are explained at the top of types/hpai.js. Screwworm differs from HPAI in its disease words, its two
 * statuses, its layers (cattle and other livestock, horses and dogs) and its zones: a dispersal or surveillance area
 * drawn by APHIS or WSDA, loaded as a zone file under Zones. Until a zone file is loaded, one example ring is drawn.
 * The column names are HPAI's (the agency's agreed table) until a screwworm file's own names are known.
 *
 * The values below are examples until WSDA staff confirm them; the page says so behind the type's "?". */
(function (root) {
  'use strict';
  root.WSDA.emergencyTypes.add({
    id: 'nws',
    name: 'New World screwworm (NWS)',
    title: 'NEW WORLD SCREWWORM RESPONSE MAP',
    diseaseWords: ['screwworm', 'nws', 'cochliomyia', 'hominivorax', 'myiasis'],
    columns: {
      id: ['Case ID', 'AnimalDiseaseReportId'],
      detected: ['Confirmed Diagnosis', 'Date Reported', 'Detection Date'],
      disease: ['Subtype', 'Disease Name'],
      status: ['Case Status'],
      quarantine: ['Quarantine Release'],
      flockType: ['Flock/Herd Type'],
      inventory: ['Flock/Herd Inventory'],
      shown: ['Production Type']
    },
    inventoryWord: 'animals',
    statuses: [
      { label: 'Confirmed', words: ['confirmed', 'positive'], color: '#a50f15' },
      { label: 'Presumptive', words: ['presumptive', 'presumptive positive'], color: '#de2d26' }
    ],
    closed: {
      column: ['Status', 'Surveillance Closed'],
      values: ['closed', 'yes', 'y', 'true', '1'],
      dateColumn: ['Close Date']
    },
    zones: {
      source: 'file',
      rings: [
        { distance: 20, label: 'Example area', color: '#cb181d' }
      ],
      applyTo: 'open',
      unit: 'km'
    },
    layers: {
      bySpecies: [
        { words: ['cattle', 'dairy', 'bovine', 'cow', 'calf'],
          keys: ['premises', 'milkproducer', 'markets', 'feedlots', 'fairgrounds', 'disposal'] },
        { words: ['horse', 'equine', 'sheep', 'ovine', 'goat', 'caprine', 'swine', 'pig', 'hog', 'dog', 'canine'],
          keys: ['premises', 'markets', 'fairgrounds', 'disposal'] }
      ],
      default: ['premises', 'milkproducer', 'markets', 'feedlots', 'fairgrounds', 'disposal']
    },
    links: [
      { label: 'USDA APHIS: New World screwworm', url: 'https://www.aphis.usda.gov/livestock-poultry-disease/cattle/ticks/screwworm' },
      { label: 'USDA: Screwworm.gov', url: 'https://www.aphis.usda.gov/livestock-poultry-disease/stop-screwworm' }
    ]
  });
})(typeof window !== 'undefined' ? window : globalThis);
