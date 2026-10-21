/* Emergency type: highly pathogenic avian influenza (HPAI), the first type and the default.
 *
 * Every emergency type is one file like this one, loaded by a script line in site/emergency/index.html after
 * types.js; the page reads its fields and names no emergency itself. To add a type, copy this file, change the fields
 * and add its script line ("Adding an emergency type" in docs/DEVELOPER_GUIDE.md). types.js checks every field when
 * the page loads and names any field that is missing or of the wrong form.
 *
 * The fields:
 *   id            the type's key: lowercase letters, digits and dashes
 *   name          the name shown on the page
 *   diseaseWords  words in a positives file's "Disease Name" column that pick this type (any case; a word matches at
 *                 the start of a word, so "h5" matches "H5N1"). A file without that column gets the first type loaded
 *   statuses      each status a positive can have: its label on the page, the spellings a file may use for it (any
 *                 case) and its color on the map (#rrggbb)
 *   closed        the column that marks a positive closed, and the values in it that do (any case); a closed
 *                 positive is shown but gets no zones by default
 *   zones         source: "rings" (circles around each positive) or "file" (zones come from a zone file);
 *                 rings: each ring's distance, label and color (may be empty when the source is "file");
 *                 applyTo: which positives get zones by default: "open" (not closed), "confirmed" or "all";
 *                 unit: "km" (miles come later)
 *   layers        the facility layers suggested for checking, by their keys (the built-in layer ids, or the "key"
 *                 column of the facility layer list, the manifest; HPAI's are the keys of WSDA's own list, as in
 *                 CVI_Traceability's reference/facility_overlays_manifest.csv): bySpecies maps words in a positives
 *                 file's species column to keys, default is used when no species word matches. A suggested layer
 *                 whose file is not loaded is skipped
 *   links         reference pages (label and https address), opened in a new tab from the type's "?"
 *
 * Positives are points (a latitude and a longitude each). An emergency whose detections are whole counties is not
 * covered yet; zones by county would be the way to add it (site/shared/facilities.js countyMembership).
 *
 * The values below are examples until WSDA staff confirm them; the page says so behind the type's "?". */
(function (root) {
  'use strict';
  root.WSDA.emergencyTypes.add({
    id: 'hpai',
    name: 'Highly pathogenic avian influenza (HPAI)',
    diseaseWords: ['hpai', 'avian influenza', 'h5n1', 'h5'],
    statuses: [
      { label: 'Confirmed', words: ['confirmed', 'positive'], color: '#a50f15' },
      { label: 'Presumptive', words: ['presumptive', 'presumptive positive'], color: '#de2d26' },
      { label: 'Suspect', words: ['suspect', 'suspected', 'pending'], color: '#fb6a4a' }
    ],
    closed: { column: 'Surveillance Closed', values: ['yes', 'y', 'true', '1'] },
    zones: {
      source: 'rings',
      rings: [
        { distance: 3, label: 'Infection zone', color: '#cb181d' },
        { distance: 10, label: 'Control zone', color: '#fd8d3c' }
      ],
      applyTo: 'open',
      unit: 'km'
    },
    layers: {
      bySpecies: [
        { words: ['poultry', 'chicken', 'turkey', 'duck', 'goose', 'bird', 'avian', 'layer', 'broiler', 'gamebird'],
          keys: ['poultry', 'premises', 'markets', 'fairgrounds', 'disposal'] },
        { words: ['cattle', 'dairy', 'bovine', 'cow'],
          keys: ['milkproducer', 'milkprocessing', 'premises', 'markets', 'feedlots', 'fairgrounds', 'disposal'] }
      ],
      default: ['poultry', 'milkproducer', 'milkprocessing', 'premises', 'markets', 'feedlots', 'fairgrounds', 'disposal']
    },
    links: [
      { label: 'USDA APHIS: avian influenza', url: 'https://www.aphis.usda.gov/livestock-poultry-disease/avian/avian-influenza' },
      { label: 'CDC: bird flu', url: 'https://www.cdc.gov/bird-flu/' }
    ]
  });
})(typeof window !== 'undefined' ? window : globalThis);
