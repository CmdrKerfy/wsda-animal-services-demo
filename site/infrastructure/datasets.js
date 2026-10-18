/* Infrastructure recognition list. Facility files open the dashboard without a CVI master. */
(function (root) {
  'use strict';
  if (!root.WSDA?.facilityDatasets && typeof require === 'function') require('../shared/facility-datasets.js');
  if (!root.WSDA.profiles?.cvi && typeof require === 'function') require('../cvi/datasets.js');
  const common = root.WSDA.facilityDatasets;
  const datasets = common.datasets.map(d => Object.assign({}, d, {
    later: d.kind === 'manifest'
      ? 'Lists additional Infrastructure facility files; supplies no points'
      : 'Infrastructure facility locations, county filters, counts and details'
  }));
  const master = root.WSDA.profiles.cvi.datasets.find(d => d.id === 'master');
  datasets.push(Object.assign({}, master, { required: false, useful: [
    { columns: ['Species'], feature: 'species-refine' }
  ], features: ['cvi-activity'],
  about: 'Optional animal movement table for county-level CVI activity; facility exploration works without it.' }));
  root.WSDA.profiles.infrastructure = {
    id: 'infrastructure', name: 'Infrastructure', version: 1, datasets,
    expandManifest: common.expandManifest, handoffKinds: ['facility', 'manifest'],
    features: [
      { id: 'facility-files', name: 'Facility locations', anyKind: 'facility', needs: [] },
      { id: 'cvi-activity', name: 'Optional CVI activity', needs: [{ dataset: 'master' }] },
      { id: 'species-refine', name: 'Refine CVI activity by species', needs: [{ dataset: 'master', columns: ['Species'] }] }
    ],
    dataNote: 'Supply at least one recognized facility file. A manifest lists layers but supplies no points. Found means its headers fit; usable points and omissions are checked separately.',
    sampleNote: 'Made-up facility files and a manifest, with no CVI master. Facility exploration works without CVI activity. Not real records.'
  };
})(typeof window !== 'undefined' ? window : globalThis);
