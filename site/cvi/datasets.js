/* CVI dataset list v1 (F1). Declares every file the CVI profile can use: what it is called, the file name CVI
 * expects, whether it is required, the columns that identify it, the optional columns that switch features on, and
 * a one-line description for the in-app guide. Shapes follow CVI as-is (stable as of 2026-09-30):
 *   master           CVI shiny/R/master_loader.R (13 required columns, exact names as fread
 *                    reads them); optional columns as CVI's features use them.
 *   facility layers  map_helpers.R .OVERLAY_REGISTRY_BUILTIN (key, file, name_col) and load_overlay_csv() (any
 *                    lat/latitude/y and long/lon/lng/longitude/x spelling, case-insensitive). CVI tells these
 *                    layers apart by file name only; their columns are generic.
 *   manifest         map_helpers.R .read_overlay_manifest(): adds layers, or overrides a built-in layer's file.
 * Any CVI schema change updates this file and its tests in the same change.
 *
 * Boundary: this list reproduces what CVI needs to RECOGNIZE its files, not CVI's whole loaders.
 * Still to match when the maps that use them are built: master type coercion and normalization (S1 engine does
 * this for the WA map); facility rows need numeric coordinates to be plotted ("found" only means the right
 * columns), display-name fallback, geo_source; manifest label vs live_label, marker shape/color and filter_cols;
 * R's read.csv type inference (e.g. a numeric-looking key). Differences kept on purpose: the dataset ids "master"
 * and "manifest" cannot be manifest keys; at most 500 manifest layers; CVI's fread also accepts semicolon- or
 * tab-separated master files, which F1 reports as "save it as a comma-separated CSV file".
 *
 * S5 (County Focus): the County Focus map needs the master; its premises need the four premises coordinate columns;
 * City, farm ids and CVI are optional and only change labels, grouping and certificate numbers, so they are
 * described, not required. Facility layers and the manifest are used by County Focus's Facility Locations:
 * handoffKinds makes the landing page send every found dataset of those kinds with the master.
 * Useful-column notes: feature (a feature that is off without them), later (a later version's use), with (what they add,
 * for the guide) and without (what happens without them, for the checklist).
 *
 * Column specs: a string is an exact column name (after trimming); { anyOf, caseless, label } accepts any of the
 * spellings. Dataset kinds: 'table', 'facility' (identified by file name; columns only show it is a facility
 * layer) and 'manifest' (expanded by expandManifest() into extra facility datasets). */
(function (root) {
  'use strict';
  if (!root.WSDA?.facilityDatasets && typeof require === 'function') require('../shared/facility-datasets.js');
  const common = root.WSDA.facilityDatasets;
  const COORDS = ['Origin.Lat', 'Origin.Long', 'Dest.Lat', 'Dest.Long'];
  const MASTER_COLUMNS = [
    'Species.Group', 'Reporting.Year', 'Reporting.Quarter', 'Movement', 'Total.Animals',
    'Origin.State', 'Dest.State',
    'Origin.County', 'Origin.County.Lat', 'Origin.County.Long',
    'Dest.County', 'Dest.County.Lat', 'Dest.County.Long'
  ];

  const datasets = [
    { id: 'master', name: 'CVI master table', file: 'CVI_Consolidated_Master.csv', required: true, kind: 'table',
      columns: MASTER_COLUMNS,
      useful: [
        { columns: ['Species'], feature: 'species-refine' },
        { columns: ['CVI'], feature: 'unique-cvis', with: 'Certificate numbers in the County Focus hover and CVI table',
          without: 'no certificate numbers in the County Focus hover and CVI table' },
        { columns: COORDS, feature: 'focus-premises' },
        { columns: ['Origin.City', 'Dest.City'], with: 'Place names of County Focus premises',
          without: 'County Focus premises are named "(unknown city)"' },
        { columns: ['farm_entity_id_origin', 'farm_entity_id_dest'], with: 'County Focus premises grouped by farm',
          without: 'County Focus premises are grouped by their exact location' }
      ],
      features: ['wa-map'],
      about: 'One row per animal movement record (CVI), with species, period, direction, head count and the origin and destination counties.' },
    ...common.datasets
  ];

  const features = [
    { id: 'wa-map', name: 'WA State map', needs: [{ dataset: 'master' }] },
    { id: 'species-refine', name: 'Refine by species', needs: [{ dataset: 'master', columns: ['Species'] }] },
    // S2a: summaries above and below the map, the "Unique CVIs" box (needs the CVI column; grayed without it, a
    // deliberate deviation: CVI shows 0) and the county spotlight.
    { id: 'summaries', name: 'Summary boxes and strip', needs: [{ dataset: 'master' }] },
    { id: 'unique-cvis', name: 'Unique CVIs in current view', needs: [{ dataset: 'master', columns: ['CVI'] }] },
    { id: 'spotlight', name: 'Spotlight Counties', needs: [{ dataset: 'master' }] },
    // S2b: Single period / Browse over time / Compare two periods (years and quarters are required master columns).
    { id: 'period-modes', name: 'Browse over time and Compare two periods', needs: [{ dataset: 'master' }] },
    // S4: the National Flow map (lines between Washington and other states, its legend, boxes, strip and Browse) needs
    // the master table only; its state outlines and centers are bundled with the page. Its "Refine by species" and
    // "Unique CVIs" follow the two features above.
    { id: 'flow-map', name: 'National Flow map', needs: [{ dataset: 'master' }] },
    // S5: the County Focus map (county grid, boxes, strip, Browse; facility markers with their own files) needs the
    // master; its premises circles need the four coordinate columns (required for the premises only).
    { id: 'focus-map', name: 'County Focus map', needs: [{ dataset: 'master' }] },
    { id: 'focus-premises', name: 'County Focus premises', needs: [{ dataset: 'master', columns: COORDS }] }
  ];

  root.WSDA = root.WSDA || {};
  root.WSDA.profiles = root.WSDA.profiles || {};
  root.WSDA.profiles.cvi = {
    id: 'cvi', name: 'CVI Traceability', version: 1, datasets, features, expandManifest: common.expandManifest, handoffKinds: ['facility', 'manifest']
  };
})(typeof window !== 'undefined' ? window : globalThis);
