/* Deterministic facility-only synthetic sample; uses the existing browser ZIP writer. */
(function (root) {
  'use strict';
  const fileName = 'infrastructure_synthetic.zip';
  // The sample ZIP's files as { name, data } entries, each file's text encoded as UTF-8 bytes.
  function entries() {
    const files = {
      'usda_wa_slaughter_facilities.csv': 'USDA.Slaughter.Facility,lat,long,Operation.Type,geo_source\nSynthetic Packing Plant,47.25,-122.35,Bovine,existing\nSynthetic Town Plant,47.25,-122.35,Poultry,google_city\n',
      'wa_state_fairs.csv': 'Fair.Name,lat,long,Season\nSynthetic Fair,47.04,-122.9,Summer\n',
      'wa_state_public_livestock_markets.csv': 'name,lat,long,Species\nSynthetic Market,46.6,-120.5,Cattle|Equids\n',
      'wa_state_feedlots.csv': 'name,lat,long,Operation.Type\nSynthetic Feedlot,46.2,-119.15,Cattle\n',
      'wa_state_restricted_holding_facilities.csv': 'NAME,lat,long,Operation.Type\nSynthetic Holding Facility,48.42,-122.33,Holding\n',
      'facility_overlays_manifest.csv': 'key,file,name_col,label,group,filter_cols\nsynthetic_support,synthetic_support.csv,name,Synthetic support,Other,Service\n',
      'synthetic_support.csv': 'name,lat,long,Service,geo_source\nSynthetic Support A,47.6,-122.33,Transport,existing\nSynthetic Support B,47.61,-122.34,Storage,NA\n',
      'bundle.json': JSON.stringify({ profile: 'infrastructure', label: 'Infrastructure – synthetic facilities only',
        prepared: '2026-09-15' }, null, 2) + '\n'
    };
    return Object.entries(files).map(([name, text]) => ({ name, data: new TextEncoder().encode(text) }));
  }
  root.WSDA = root.WSDA || {};
  root.WSDA.samples = root.WSDA.samples || {};
  root.WSDA.samples.infrastructure = { fileName, entries };
})(typeof window !== 'undefined' ? window : globalThis);
