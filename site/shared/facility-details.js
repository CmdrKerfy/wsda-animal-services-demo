/* Supplied, screened facility details. Consumer supplies county context; no raw HTML. */
(function(root) {
  'use strict';
  // The details box for one facility: its name, layer, WA county, location precision and supplied values.
  function element(layer, point, counties) {
    const box = document.createElement('div'); box.className = 'facility-details';
    const title = document.createElement('strong'); title.textContent = point.name || 'Unnamed facility'; box.append(title);
    const add = (heading,value) => {
      if (value == null || value === '') return;
      const row = document.createElement('div'), label = document.createElement('strong');
      label.textContent = heading + ': '; row.append(label,document.createTextNode(String(value))); box.append(row);
    };
    add('Layer',layer.liveLabel); add('WA county',(counties || (point.county ? [point.county] : [])).join(', '));
    if (/^google_city$/i.test(point.geoSource)) add('Location','Town-level location');
    Object.keys(layer.choices).forEach(h => add(root.WSDA.facilities.pretty(h),point.values[h]));
    return box;
  }
  root.WSDA = root.WSDA || {}; root.WSDA.facilityDetails = { element };
})(typeof window !== 'undefined' ? window : globalThis);
