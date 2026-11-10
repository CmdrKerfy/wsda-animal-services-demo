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
 *   title         the map picture's title ("HPAI RESPONSE MAP"); the name in capitals with "RESPONSE MAP" when left
 *                 out
 *   diseaseWords  words in a positives file's disease column (columns.disease) that pick this type (any case; a word
 *                 matches at the start of a word, so "h5" matches "H5N1"). A file without that column gets the first
 *                 type loaded
 *   columns       the column names the page reads for each role, any case; the first name the file has wins. id: the
 *                 positive's name; detected: the detection date, in order of preference (a row whose first date is
 *                 blank takes the next); disease: picks the type; status: the testing status (a file without a status
 *                 column gives every positive the first status below); quarantine: the quarantine release date;
 *                 quarantineStatus: the quarantine status ("Under quarantine", "Released"; see quarantineValues),
 *                 which decides for a past positive whose release date is blank;
 *                 flockType: the kind of flock or herd (Commercial, Backyard), counted in the numbers line
 *                 under the value boxes; inventory: the number of animals (thousands commas allowed), added up
 *                 in that line and giving the flock size class; shown: further columns shown in the hover and
 *                 the export. A role left out takes E1a's names (AnimalDiseaseReportId, Detection Date, Disease
 *                 Name), or none. A renamed column in the agency's table is one edit here. A name holding address,
 *                 location, street or premise is refused: those columns are never read
 *   kinds         the kinds of animal, in order. Each kind has its own mark on the map, its own tick under
 *                 "Animals", its own legend and map-key row, its own color in the Overview's "Columns by: Animal"
 *                 and its own total in the counts. A kind's fields:
 *                   key       a short key: lowercase letters, digits and dashes, no two kinds the same
 *                   label     its name on the ticks, the legend and the map key ("Birds")
 *                   word      the word its animals are counted under ("1.2M birds"); the label in lowercase when
 *                             left out
 *                   words     species words, matched in the positive's species column (any case, at the start of a
 *                             word: "cow" matches "Dairy cow", "cat" does not match "Bobcat"). Every kind but the
 *                             last needs one or more; a word may be in one kind only
 *                   nameEach  true: its animals are counted by each species' own word ("12 goats, 6 pigs, 2 seals")
 *                             instead of the kind's word
 *                 A positive is every kind with a word in its species: "Cattle, Chicken" is both birds and cattle,
 *                 drawn with both marks, shown while either kind is ticked, its animals counted in neither kind and
 *                 named in a line under the value boxes. A longer word of another kind wins where both start:
 *                 "Pigeon" is birds only, though "pig" starts it. A positive with no species is the first kind. A
 *                 species no kind's words name is the last kind, and the line under the value boxes names it ("1
 *                 positive with a species not listed: Opossum") so its word can be added here. The order sets the
 *                 marks (circle, square, triangle, diamond, pentagon, hexagon; a seventh kind or later shares the
 *                 hexagon) and the colors. Left out: one kind, "Animals". How to add a word or a kind, with a worked
 *                 example: "Changing the kinds of animals", site/emergency/changing-kinds.html (in a browser) or
 *                 CHANGING_THE_KINDS_OF_ANIMALS.txt beside it
 *   quarantineValues  the quarantine status column's values (any case): under, those meaning still under
 *                 quarantine, and released. A past positive is still under quarantine on the window's end date when
 *                 its release date is after it; with no release date, when its status is an under value; with
 *                 neither, its quarantine is "not known" (in a file with a quarantine status column) or, in a file
 *                 with only the release date column, still under quarantine. Left out: "under quarantine",
 *                 "quarantined", "in quarantine" and "released", "lifted"
 *   statuses      each status a positive can have: its label on the page, the spellings a file may use for it (any
 *                 case) and its color on the map (#rrggbb)
 *   closed        column: the column (or columns, first found wins) that marks a positive closed, and values: the
 *                 values in it that do (any case); dateColumn: the date surveillance ended, when the file has one. A
 *                 positive is past on the window's end date when its closed date is on or before it, or, without a
 *                 readable closed date, when its closed column says so; a past positive never gets zones or counts
 *   zones         source: "rings" (circles around each positive) or "file" (zones come from a zone file);
 *                 rings: each ring's distance, label and color (may be empty when the source is "file");
 *                 applyTo: which positives get zones by default: "open" (not closed) or "confirmed";
 *                 unit: "km" or "mi", the unit of the ring distances
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
    title: 'HPAI RESPONSE MAP',
    diseaseWords: ['hpai', 'avian influenza', 'h5n1', 'h5'],
    // The agency's agreed HPAI table (2026-10-22) first, then E1a's names.
    columns: {
      id: ['Case ID', 'AnimalDiseaseReportId'],
      detected: ['Confirmed Diagnosis', 'Date Reported', 'Detection Date'],
      disease: ['Subtype', 'Disease Name'],
      status: ['Case Status'],
      quarantine: ['Quarantine Release'],
      quarantineStatus: ['Quarantine Status'],
      flockType: ['Flock/Herd Type'],
      inventory: ['Flock/Herd Inventory'],
      shown: ['Production Type']
    },
    // Birds first, so a positive with no species is a bird, HPAI's main animal ("pigeon" keeps a racing pigeon from
    // being a pig); a dairy herd's cattle (the same words as the cattle entry in layers below); then the other mammals
    // HPAI has reached, each counted by its own word, last, so a species no kind names counts there. A positive
    // naming two kinds ("Cattle, Chicken") is both. Changing them: site/emergency/changing-kinds.html (or its .txt
    // twin); the work-PC table check (tools/work-pc/check_hpai_table.R, KINDS) keeps a copy.
    kinds: [
      { key: 'birds', label: 'Birds',
        words: ['poultry', 'chicken', 'turkey', 'duck', 'goose', 'geese', 'bird', 'avian', 'layer', 'broiler', 'gamebird',
          'pigeon', 'dove', 'waterfowl', 'fowl', 'peafowl', 'pheasant', 'quail', 'chukar', 'grouse', 'partridge', 'emu', 'ostrich',
          'rhea', 'swan', 'gull', 'hawk', 'eagle', 'owl', 'falcon', 'raptor', 'crow', 'raven', 'magpie', 'heron', 'egret',
          'pelican', 'cormorant', 'songbird', 'parrot', 'finch', 'sparrow', 'hen'] },
      { key: 'cattle', label: 'Cattle', words: ['cattle', 'dairy', 'bovine', 'cow', 'heifer', 'steer', 'calf', 'calves', 'beef'] },
      { key: 'other', label: 'Other animals', nameEach: true,
        words: ['goat', 'caprine', 'sheep', 'ovine', 'swine', 'hog', 'porcine', 'pig', 'alpaca', 'llama', 'camelid', 'horse',
          'equine', 'mink', 'cat', 'feline', 'dog', 'canine', 'seal', 'sea lion', 'fox', 'raccoon', 'skunk', 'bear', 'ferret',
          'rabbit', 'deer', 'elk', 'wolf', 'dolphin', 'porpoise'] }
    ],
    statuses: [
      { label: 'Confirmed', words: ['confirmed', 'positive'], color: '#a50f15' },
      { label: 'Presumptive', words: ['presumptive', 'presumptive positive'], color: '#de2d26' },
      { label: 'Suspect', words: ['suspect', 'suspected', 'pending'], color: '#fb6a4a' }
    ],
    closed: {
      column: ['Status', 'Surveillance Closed'],
      values: ['closed', 'yes', 'y', 'true', '1'],
      dateColumn: ['Close Date']
    },
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
        { words: ['poultry', 'chicken', 'turkey', 'duck', 'goose', 'geese', 'bird', 'avian', 'layer', 'broiler', 'gamebird'],
          keys: ['poultry', 'premises', 'markets', 'fairgrounds', 'disposal'] },
        { words: ['cattle', 'dairy', 'bovine', 'cow', 'heifer', 'steer', 'calf', 'calves', 'beef'],
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
