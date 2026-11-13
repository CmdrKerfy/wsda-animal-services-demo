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
 *   report        the printed update made in the Report view (2.9); a type without it has no Report view. Its fields:
 *                   title, note  the update's title and the line under it
 *                   source       the table named in the source line ("WSDA HPAI table")
 *                   flocks       what the status sentence is about ("domestic flocks"): the first kind's cases
 *                   cases        each kind's words for one case and for more ("flock", "flocks"); a kind left out is
 *                                "<label> case"
 *                   livestock    the kind the livestock card counts (a kind's key); left out, no livestock card
 *                   status       the approved status wordings: free (no active flock) and active
 *                   milk         the milk testing stages: each its stage and the sentence printed after it
 *                   milkLink, map, online  links: a label and an https address (the milk testing strategy, the
 *                                outbreak map, the address printed in the foot)
 *                   messages     the key messages a new report starts with: headline, icon (a name from
 *                                site/emergency/message-icons.js), text, an optional link, highlight true for a shaded card
 *                   hotline      the foot's hotline: ask (its question), name and number
 *                   alternate    the alternate-format line at every page's foot
 *                   page2        optional, page 2 (its numbers are typed each month in the form): national { source,
 *                                livestock, sequencing } and wild { source }, https addresses; testing { intro (WADDL's
 *                                sentence), since (its tests' start), categories (names), lists }; call, the "Report
 *                                sick birds" box's parts { headline, text, link }; resources, the link lists. A list is
 *                                { name, links: [{ label, url (https:// or mailto:) }] }; left out, no page 2
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
    ],
    // The printed update (2.9, E2), from WSDA's update of September 1, 2026 (its wording and links; the source of truth
    // for the figures). A new report starts from these.
    report: {
      title: 'Highly Pathogenic Avian Influenza (HPAI) Update',
      note: 'Updates are issued as needed; the links lead to each source.',
      source: 'WSDA HPAI table',
      flocks: 'domestic flocks',
      cases: { birds: ['flock', 'flocks'], cattle: ['dairy herd', 'dairy herds'],
        other: ['premises with other animals', 'premises with other animals'] },
      livestock: 'cattle',
      status: {
        free: 'Washington is currently considered free of highly pathogenic avian influenza in domestic flocks.',
        active: 'Washington has active detections of highly pathogenic avian influenza in domestic flocks.'
      },
      milk: [
        { stage: 'Unaffected / Stage 4', text: 'Using statistical sampling and a phased approach for sampling frequency, ' +
          'Washington state has demonstrated the absence of the virus.' }
      ],
      milkLink: { label: 'National Milk Testing Strategy (NMTS)',
        url: 'https://www.aphis.usda.gov/sites/default/files/national-milk-testing-strategy-5-stage.pdf' },
      map: { label: 'Washington State Avian Influenza Outbreak Map', url: 'https://arcg.is/05KT8S' },
      // The update's own key messages; the livestock one is drawn from the data (report.js wording).
      messages: [
        { headline: 'Protect your flock', icon: 'shield-check',
          text: 'Highly pathogenic avian influenza (HPAI) A(H5) viruses have been detected in U.S. wild birds, commercial ' +
            'poultry and backyard flocks beginning in January 2022. Biosecurity is the best way to protect a flock:',
          link: { label: 'USDA\'s Defend the Flock program',
            url: 'https://www.aphis.usda.gov/aphis/ourfocus/animalhealth/animal-disease-information/avian/defend-the-flock-program' } },
        { headline: 'Low risk to the public', icon: 'person',
          text: 'CDC currently considers the current strain of avian influenza circulating in the U.S. to be low risk to the ' +
            'general public. However, people with close or prolonged contact with infected birds, animals, or their ' +
            'environments are at higher risk of infection and should be aware of the risk of exposure to avian influenza ' +
            'so that they can take proper precautions and wear appropriate personal protective equipment (PPE). CDC Guidance:',
          link: { label: 'Reducing Exposure for Workers to Avian Influenza A Viruses', url: 'https://www.cdc.gov/bird-flu/worker-safety/index.html' } },
        { headline: 'Moving dairy cattle', icon: 'truck', highlight: true,
          text: 'Lactating dairy cattle moving interstate from States with Unaffected State Status under the National Milk ' +
            'Testing Strategy are no longer required to be tested for highly pathogenic avian influenza (HPAI) H5N1 before ' +
            'movement. See the updated',
          link: { label: 'APHIS Requirements and Recommendations for HPAI H5N1 Virus in Livestock',
            url: 'https://www.aphis.usda.gov/sites/default/files/aphis-requirements-hpai-livestock-2026.pdf' } }
      ],
      hotline: { ask: 'Sick birds?', name: 'Sick Bird Hotline', number: '1-800-606-3056' },
      online: { label: 'agr.wa.gov/birdflu', url: 'https://agr.wa.gov/birdflu' },
      alternate: 'Do you need this publication in an alternate format? Contact WSDA at (360) 902-1976 or TTY Relay 800-833-6388.',
      // Page 2 (2.9): the national, wild-bird and testing figures typed from USDA APHIS and WADDL each month; here
      // only their sources, WADDL's sentence and categories, the "Report sick birds" box and the link lists, as the
      // update of September 1, 2026 has them (staff change them in the form; the numbers start empty).
      page2: {
        national: { source: 'https://www.aphis.usda.gov/aphis/ourfocus/animalhealth/animal-disease-information/avian/avian-influenza/hpai-2022/2022-hpai-commercial-backyard-flocks',
          livestock: 'https://www.aphis.usda.gov/livestock-poultry-disease/avian/avian-influenza/hpai-detections/hpai-confirmed-cases-livestock',
          sequencing: 'https://www.aphis.usda.gov/livestock-poultry-disease/avian/avian-influenza/hpai-detections/livestock/testing-and-science' },
        wild: { source: 'https://www.aphis.usda.gov/livestock-poultry-disease/avian/avian-influenza/hpai-detections/wild-birds' },
        testing: {
          intro: 'The Washington Animal Disease Diagnostic Laboratory (WADDL) collaborates closely with state and federal agencies to ' +
            'actively monitor, understand, and mitigate the spread of highly pathogenic avian influenza virus (HPAI H5N1) across dairy ' +
            'cattle, poultry, and other animal species.',
          since: 'January 1, 2024',
          categories: ['Animal Feed', 'Domestic Cats', 'Domestic Cattle/Milk', 'Domestic Mammal (Other)', 'Domestic Poultry',
            'Not Specified', 'Wild Birds', 'Wildlife'],
          lists: [
            { name: 'Avian influenza testing information', links: [
              { label: 'Clinical Lactating Dairy Cattle', url: 'https://waddl.vetmed.wsu.edu/2024/04/01/highly-pathogenic-avian-influenza-detected-in-dairy-cattle/' },
              { label: 'Interstate Movement of Lactating Dairy Cattle',
                url: 'https://waddl.vetmed.wsu.edu/2024/04/26/faq-clinically-normal-lactating-cows-for-interstate-movement-testing-cattle-for-highly-pathogenic-avian-influenza-hpai/' },
              { label: 'Poultry testing information', url: 'https://waddl.vetmed.wsu.edu/2022/11/09/avian-influenza-fact-sheet/' },
              { label: 'Avian Influenza testing in cats and dogs FAQ', url: 'https://waddl.vetmed.wsu.edu/2025/02/24/avian-influenza-testing-in-cats-and-dogs-faq/' }] },
            { name: 'Quick links', links: [
              { label: 'Submit a sample', url: 'https://waddl.vetmed.wsu.edu/submit-a-sample/' },
              { label: 'Sample packing guidelines', url: 'https://waddl.vetmed.wsu.edu/packaging-and-shipping/' },
              { label: 'Sample shipping guidelines', url: 'https://waddl.vetmed.wsu.edu/shipping/' }] }
          ]
        },
        // The box's two parts; the hotline's name and number (from "Boxes and resources") follow the first.
        call: [
          { headline: 'Report Sick Birds to WSDA', text: 'If a flock experiences sudden death or illness of multiple birds, submit a report ' +
            'through Washington State Department of Agriculture\'s', link: { label: 'online reporting tool',
              url: 'https://survey123.arcgis.com/share/a384e90f69744f2e846135a9ce80027f' } },
          { headline: 'Report Sick Wild Birds to WDFW', text: 'Sick or dead wild birds should not be touched or moved and can be reported ' +
            'using the Washington Department of Fish and Wildlife\'s', link: { label: 'online reporting tool', url: 'https://wdfw.wa.gov/species-habitats/diseases/bird-flu' } }
        ],
        resources: [
          { name: 'Animal health', links: [
            { label: 'agr.wa.gov/birdflu', url: 'https://agr.wa.gov/birdflu' },
            { label: 'avhealth@agr.wa.gov', url: 'mailto:avhealth@agr.wa.gov' },
            { label: 'For veterinarians', url: 'https://cms.agr.wa.gov/WSDAKentico/Documents/Pubs/488-KeyInsightsFAQVetsAvianInfluenza.pdf' },
            { label: 'For backyard flock owners', url: 'https://cms.agr.wa.gov/WSDAKentico/Documents/Pubs/482-BirdFluFAQ.pdf' }] },
          { name: 'Wild birds and wildlife', links: [
            { label: 'Washington Dept. of Fish and Wildlife', url: 'https://wdfw.wa.gov/species-habitats/diseases/bird-flu' },
            { label: 'USGS Avian Influenza Surveillance', url: 'https://www.usgs.gov/centers/nwhc/science/avian-influenza-surveillance' },
            { label: 'USDA APHIS wild bird data', url: 'https://www.aphis.usda.gov/livestock-poultry-disease/avian/avian-influenza/hpai-detections/wild-birds' },
            { label: 'USDA APHIS wildlife data', url: 'https://www.aphis.usda.gov/livestock-poultry-disease/avian/avian-influenza/hpai-detections/mammals' }] },
          { name: 'Public health', links: [
            { label: 'Washington (Dept. of Health)', url: 'https://doh.wa.gov/you-and-your-family/illness-and-disease-z/avian-influenza' },
            { label: 'National (CDC)', url: 'https://www.cdc.gov/bird-flu/situation-summary/index.html' }] }
        ]
      }
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
