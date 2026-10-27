/* The Emergency Response sample: made-up positives, facility files, a facility layer list (manifest) with dairies,
 * premises and disposal sites, and a GeoJSON zone, with a bundle.json for this dashboard. Every file is written out
 * here as text (no arithmetic), so the ZIP is the same bytes in every browser; it uses the shared ZIP writer
 * (shared/sample.js). Downloaded from the Emergency page's "Load your data"; the all-in-one sample on the landing
 * page does not change. Not real records: names, Case IDs and coordinates are invented, and the "Premises" and
 * "Address" values are marked "(synthetic)" (the page never reads either column).
 * The positives are in the agency's agreed HPAI table's 20 columns (2026-10-22), dates written M/D/YYYY as there.
 * The manifest's keys are those of WSDA's own facility list (CVI_Traceability's reference/facility_overlays_manifest.csv),
 * so the HPAI type's suggested layers are ticked as they will be with the real files.
 * What the files show: open positives and one closed (its surveillance ended, its quarantine released later); one
 * positive with a Date Reported and no Confirmed Diagnosis; inventories with thousands commas; sites at different
 * distances from the positives
 * (inside 3 km, inside 10 km, outside both), so each layer has an inside list or a "nearest" line; premises with each
 * location-precision value (the coarse ones are left out of the zone results); a dairy located only to its town; a
 * control area drawn around one positive. */
(function (root) {
  'use strict';
  const fileName = 'emergency_synthetic.zip';
  const files = {
    'emergency_case_sites.csv': [
      'Case ID,Date Reported,Close Date,Confirmed Diagnosis,Quarantine Release,Premises,Address,City,County,Latitude,Longitude,Status,Subtype,Flock/Herd Type,Production Type,Species,Flock/Herd Inventory,Depop Inventory,Structures,Disposal Method',
      'SYN-HPAI-001,8/31/2026,,9/2/2026,,(synthetic) Example Farm 1,(synthetic) 100 Example Road,Synthetic Town,Yakima,46.5520,-120.4700,Active,H5N1 2.3.4.4b,Commercial,Commercial Table Egg Layer,Chicken,"1,200,000","1,200,000",6,Landfill',
      'SYN-HPAI-002,9/8/2026,,9/10/2026,,(synthetic) Example Farm 2,(synthetic) 107 Example Road,Synthetic Town,Yakima,46.4010,-120.3150,Active,H5N1 2.3.4.4b,Backyard,WOAH Non-Poultry,Multiple Poultry Species,35,35,1,On-Site Burial',
      'SYN-HPAI-003,8/19/2026,,8/21/2026,,(synthetic) Example Farm 3,(synthetic) 114 Example Road,Synthetic Town,Franklin,46.4000,-119.0500,Active,H5N1 2.3.4.4b,Commercial,Dairy,Cattle,"2,400",,4,',
      'SYN-HPAI-004,9/28/2026,,,,(synthetic) Example Farm 4,(synthetic) 121 Example Road,Synthetic Town,Skagit,48.4200,-122.3300,Active,H5N1 2.3.4.4b,Backyard,WOAH Non-Poultry,Duck,12,12,1,Outdoor Compost',
      'SYN-HPAI-005,7/13/2026,8/20/2026,7/15/2026,9/1/2026,(synthetic) Example Farm 5,(synthetic) 128 Example Road,Synthetic Town,Snohomish,48.0500,-122.1500,Closed,H5N1 2.3.4.4b,Commercial,Commercial Meat Turkey,Turkey,"18,500","18,500",3,Incinerator',
      'SYN-HPAI-006,9/16/2026,,9/18/2026,,(synthetic) Example Farm 6,(synthetic) 135 Example Road,Synthetic Town,Lewis,46.6600,-122.9600,Active,H5N1 2.3.4.4b,Backyard,WOAH Non-Poultry,Chicken,7,7,1,On-Site Burial',
      'SYN-HPAI-007,10/3/2026,,10/5/2026,,(synthetic) Example Farm 7,(synthetic) 142 Example Road,Synthetic Town,Whatcom,48.9000,-122.4500,Active,H5N1 2.3.4.4b,Commercial,Dairy,Cattle,"1,150",,2,'
    ],
    'wa_state_public_livestock_markets.csv': [
      'name,lat,long,Species',
      'Synthetic Valley Market,46.53049,-120.55592,Cattle|Poultry',
      'Synthetic North Market,48.75627,-122.45000,Cattle'
    ],
    'wa_state_fairs.csv': [
      'Fair.Name,lat,long,Season',
      'Synthetic Central Fair,46.52469,-120.43028,Summer',
      'Synthetic County Fair,46.85763,-122.96000,Summer'
    ],
    'wa_state_feedlots.csv': [
      'name,lat,long,Operation.Type',
      'Synthetic Basin Feedlot,46.43684,-118.99658,Cattle',
      'Synthetic West Feedlot,46.40000,-119.44079,Cattle'
    ],
    'facility_overlays_manifest.csv': [
      'key,file,name_col,label,group',
      'poultry,synthetic_commercial_poultry.csv,name,Commercial Poultry,Dairy & Producers',
      'milkproducer,synthetic_dairies.csv,name,Milk Producers (Dairies),Dairy & Producers',
      'premises,synthetic_premises.csv,name,Premise PINs by Species,Premises & Operations',
      'disposal,synthetic_disposal_sites.csv,name,Disposal Facilities,Disposal & Rendering'
    ],
    'synthetic_commercial_poultry.csv': [
      'name,lat,long,Type',
      'Synthetic Poultry Farm 1,46.56163,-120.45824,Layers',
      'Synthetic Poultry Farm 2,46.52921,-120.48206,Broilers',
      'Synthetic Poultry Farm 3,46.57985,-120.54014,Layers',
      'Synthetic Poultry Farm 4,46.39696,-120.30485,Turkeys',
      'Synthetic Poultry Farm 5,46.47266,-120.29668,Layers',
      'Synthetic Poultry Farm 6,48.42281,-122.30601,Broilers',
      'Synthetic Poultry Farm 7,48.40310,-122.39996,Layers',
      'Synthetic Poultry Farm 8,48.06712,-122.13522,Ducks',
      'Synthetic Poultry Farm 9,46.62623,-122.94209,Layers',
      'Synthetic Poultry Farm 10,46.66000,-122.72440,Broilers'
    ],
    'synthetic_dairies.csv': [
      'name,lat,long,geo_source',
      'Synthetic Dairy 1,46.41634,-119.06368,existing',
      'Synthetic Dairy 2,46.38846,-118.95507,existing',
      'Synthetic Dairy 3,46.30275,-119.13141,existing',
      'Synthetic Dairy 4,48.90000,-122.46503,existing',
      'Synthetic Dairy 5,48.93124,-122.43727,google_city',
      'Synthetic Dairy 6,48.83669,-122.36919,existing'
    ],
    'synthetic_premises.csv': [
      'name,lat,long,premises_type,geocode_precision,match_status',
      'Synthetic Premises 1,46.41178,-120.34207,Street,rooftop,Matched',
      'Synthetic Premises 2,46.44292,-120.25421,Street,street,Matched',
      'Synthetic Premises 3,46.31566,-120.31500,Street,city,Matched',
      'Synthetic Premises 4,48.39258,-122.32271,Mailing,rooftop,Matched',
      'Synthetic Premises 5,46.67415,-122.95636,Street,rooftop,Unmatched',
      'Synthetic Premises 6,46.63634,-123.05470,Street,rooftop,Matched'
    ],
    'synthetic_disposal_sites.csv': [
      'name,lat,long,Type',
      'Synthetic Rendering Plant,46.46064,-118.89771,Rendering',
      'Synthetic Compost Site,46.76759,-120.47000,Compost',
      'Synthetic Landfill,48.42000,-121.78858,Landfill'
    ],
    'synthetic_control_area.geojson': [
      '{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"name":"Synthetic control area"},',
      '"geometry":{"type":"Polygon","coordinates":[[[-120.25973,46.43911],[-120.25973,46.36289],',
      '[-120.37027,46.36289],[-120.37027,46.43911],[-120.25973,46.43911]]]}}]}'
    ],
    'bundle.json': [
      '{',
      '  "profiles": [',
      '    "emergency"',
      '  ],',
      '  "label": "Emergency Response – synthetic sample",',
      '  "prepared": "2026-10-20",',
      '  "synthetic": true',
      '}'
    ]
  };

  // The sample ZIP's files as { name, data } entries, each file's lines joined and encoded as UTF-8 bytes.
  function entries() {
    return Object.entries(files).map(([name, lines]) => ({ name, data: new TextEncoder().encode(lines.join('\n') + '\n') }));
  }

  root.WSDA = root.WSDA || {};
  root.WSDA.samples = root.WSDA.samples || {};
  root.WSDA.samples.emergency = { fileName, entries };
})(typeof window !== 'undefined' ? window : globalThis);
