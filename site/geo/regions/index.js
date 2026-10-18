/* Neighboring regions: the list read by shared/regions.js, in the order the switches show them (alphabetical). Data
 * only: adding a region is its file from build/derive_regions.R (with an entry in that script and in
 * tests/oracle/nr_regions_check.R) and one entry here.
 *   id, name, code (as rows write the state or province), country, countiesLabel (its switch), file (from the site
 *   folder), count (counties in the file), bbox (lon/lat box the file must lie in), suffixes (dropped from a county
 *   name for its key, as "County" in master.js), anchor (where its name is shown: a fixed point near Washington,
 *   inside the region, in the opening view), credit (the boundary source on the map and in the screenshot while the
 *   region is on; a credit the page already gives, e.g. the Census Bureau's, is not repeated). Optional: statement (a
 *   source's required statement, shown in the page footer whether or not the region is on), license { name, url }
 *   (its license, linked where the statement names it) and aliases { 'current name': 'name in the file' } (names rows
 *   may use that the boundary file does not, e.g. a district renamed after the file's year; suffixes are dropped from
 *   both sides).
 */
window.WSDA_REGIONS = [
  { id: 'bc', name: 'British Columbia', code: 'BC', country: 'CA', countiesLabel: 'Regional districts', file: 'geo/regions/bc.js',
    count: 29, bbox: [-139.1, 48.2, -114.0, 60.01], suffixes: ['Regional District', 'Regional Municipality', 'Region'], anchor: [-124.0, 48.8],
    aliases: { 'Metro Vancouver': 'Greater Vancouver', 'qathet': 'Powell River', 'North Coast': 'Skeena-Queen Charlotte' },
    credit: 'Adapted from Statistics Canada',
    statement: 'Adapted from Statistics Canada, 2021 Census Boundary Files (census divisions, cartographic), reference date 2021. ' +
      'This does not constitute an endorsement by Statistics Canada of this product. Contains information licensed under the ' +
      'Open Government Licence – Canada.',
    license: { name: 'Open Government Licence – Canada', url: 'https://open.canada.ca/en/open-government-licence-canada' } },
  { id: 'id', name: 'Idaho', code: 'ID', country: 'US', countiesLabel: 'Counties', file: 'geo/regions/id.js', count: 44,
    bbox: [-117.3, 41.98, -111.0, 49.01], suffixes: ['County'], anchor: [-116.86, 47.75], credit: 'U.S. Census Bureau' },
  { id: 'or', name: 'Oregon', code: 'OR', country: 'US', countiesLabel: 'Counties', file: 'geo/regions/or.js', count: 36,
    bbox: [-124.7, 41.98, -116.4, 46.3], suffixes: ['County'], anchor: [-120.6, 45.5], credit: 'U.S. Census Bureau' }
];
