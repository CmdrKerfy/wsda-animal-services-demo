/* Emergency Response recognition list: the positives file, the facility layers and their manifest (as on the other
 * dashboards), zone files, and the optional CVI master. Read by the landing page and the Emergency page.
 *
 * Positives: a table recognized by its columns only (the file name breaks ties, as for every dataset): a latitude
 * and a longitude column ("Case Lat" and "Case Long" as the earlier Emergency demo writes them, or "Lat" and "Long"
 * in any form the facility files accept) and at least one marker column ("Surveillance Closed", "Case Status",
 * "Detection Date", "AnimalDiseaseReportId" or "Disease Name"; any case). The HPAI mapping tool's CSV ("Lat",
 * "Long", "County", "Premise Location", "Surveillance Closed") fits as it is. "Premise Location" is not a marker, so a
 * facility or premises file that carries it stays a facility layer. As a table, a positives file is never taken for
 * a facility layer, whatever its other columns (recognize.js).
 * Zone files: GeoJSON (.geojson) and KML (.kml), recognized by their extension (the "zone" kind in recognize.js) and
 * read by shared/zones.js on the page. A zipped shapefile is loaded on the page, under Zones: inside a bundle it
 * arrives unpacked, and its parts get a reason saying so.
 * The CVI master: optional supporting data, as on Infrastructure; it switches on "CVI movements". */
(function (root) {
  'use strict';
  if (!root.WSDA?.facilityDatasets && typeof require === 'function') require('../shared/facility-datasets.js');
  if (!root.WSDA.profiles?.cvi && typeof require === 'function') require('../cvi/datasets.js');
  const common = root.WSDA.facilityDatasets;

  const LAT = { anyOf: ['case lat', 'lat', 'latitude', 'y'], caseless: true,
    label: 'latitude column (Case Lat, Lat, Latitude or y)' };
  const LONG = { anyOf: ['case long', 'long', 'lon', 'lng', 'longitude', 'x'], caseless: true,
    label: 'longitude column (Case Long, Long, Lon, Lng, Longitude or x)' };
  const MARKERS = ['Surveillance Closed', 'Case Status', 'Detection Date', 'AnimalDiseaseReportId', 'Disease Name'];
  const MARKER = { anyOf: MARKERS.map(m => m.toLowerCase()), caseless: true,
    label: 'at least one of Surveillance Closed, Case Status, Detection Date, AnimalDiseaseReportId or Disease Name' };

  const positives = { id: 'positives', name: 'Positives', file: 'emergency_case_sites.csv', required: true,
    kind: 'table', columns: [LAT, LONG, MARKER],
    useful: [
      { columns: ['Case Status'], with: 'Each positive\'s status (confirmed, presumptive, suspect) and its color',
        without: 'positives are shown without a status' },
      { columns: ['Detection Date'], with: 'The "Last positive" box',
        without: 'the "Last positive" box says "Not available"' },
      { columns: ['County'], with: 'Positives named with their county when the file has no report ID',
        without: 'positives are named "Positive 1", "Positive 2" and so on' }
    ],
    features: ['positives'],
    about: 'One row per positive premises, with its latitude and longitude and its status or closed mark.' };

  const zones = { id: 'zones', name: 'Zone file', file: 'zones.geojson', required: false, kind: 'zone',
    extensions: ['geojson', 'kml'], columns: [], useful: [], features: [],
    later: 'Zones from a file in place of the rings (a zipped shapefile is loaded on the Emergency page, under Zones)',
    about: 'Optional control areas or other zones drawn as polygons: a GeoJSON or KML file in longitude and latitude.' };

  const layers = common.datasets.map(d => Object.assign({}, d, {
    later: d.kind === 'manifest'
      ? 'Lists more facility layers to check (dairies, premises, disposal sites); supplies no points'
      : 'Layers to check: which of their sites lie inside the zones, and the nearest when none does'
  }));

  const master = root.WSDA.profiles.cvi.datasets.find(d => d.id === 'master');
  const cviMaster = Object.assign({}, master, { required: false, useful: [
    { columns: ['Species'], feature: 'species-refine' }
  ], features: ['cvi-movements'],
  about: 'Optional animal movement table: the CVI movements that left from or arrived inside the zones.' });

  root.WSDA.profiles = root.WSDA.profiles || {};
  root.WSDA.profiles.emergency = {
    id: 'emergency', name: 'Emergency Response', version: 1,
    datasets: [positives, ...layers, zones, cviMaster],
    expandManifest: common.expandManifest, handoffKinds: ['facility', 'manifest', 'zone'],
    features: [
      { id: 'positives', name: 'Positives and their zones', needs: [{ dataset: 'positives' }] },
      { id: 'layers', name: 'Layers to check', anyKind: 'facility', needs: [] },
      { id: 'cvi-movements', name: 'CVI movements', needs: [{ dataset: 'master' }] },
      { id: 'species-refine', name: 'CVI movements by species', needs: [{ dataset: 'master', columns: ['Species'] }] }
    ],
    MARKERS
  };
})(typeof window !== 'undefined' ? window : globalThis);
