# Emergency Response (preview)

The Emergency Response dashboard: positives of an animal disease emergency on a map, their zones, the facility and
premises sites inside them, and the CVI movements that touch them. HPAI is the first emergency type.

## Files

| File | What it is |
|---|---|
| `index.html` | The page |
| `app.js` | The page's code: loading (chosen here or sent by the landing page), the four folds, the map's data, the value boxes, the legend, the tabs |
| `map.js` | The Emergency map kind of the shared map: zones, the sites inside and outside, the positives, the picked spot |
| `datasets.js` | The files the dashboard recognizes: positives, facility layers and their manifest, zone files, the CVI master |
| `sample.js` | The synthetic sample offered under "Load your data" |
| `types.js` | The emergency types' list: checks each type's fields and picks the type for a positives file |
| `types/hpai.js` | The HPAI type; its top comment explains every field. Copy it to add a type |
| `rules.js` | The rules, with no page work: the positives and their names, which get zones, the locations left out, what lies inside, the "nearest" line, the value boxes, the export rows |

## Shared and copied code

The page loads the platform's shared files unchanged (`site/shared/`), and CVI's files as the Infrastructure page
loads them (`datasets.js`, `csv.js`, `master.js`, `scaling.js`, `palettes.js`, `aggregate.js`, `summary.js`,
`icons.js`, `basemaps.js`, `map.js`), with CVI's `exports.js` (the CSV writer and its formula guard) and `lookup.js`
(`query`, Premise Lookup's CVI match, for the CVI movements tab); none of them is changed. Code copied from the other dashboards names its source and version in a comment at its top, so a later
fix to the original can be carried over on purpose:

| Copy | Source |
|---|---|
| `index.html`: the loader's markup; the loader, checklist, section, field, ticked-list, help-button, count-card, map-frame and legend styles | `site/infrastructure/index.html`, v1.1 |
| `index.html`: the two-button switch's styles (here the result tabs) | `site/cvi/index.html`, v1.1 |
| `app.js`: the loading (run, publish, answerHub, the hand-off and the sample download), the facility files' preparation, the basemap, neighboring regions and population context controls, the "?" handler | `site/infrastructure/app.js`, v1.1 |
| `map.js`: the kind's sources, layers, hover and Pick on map | `site/cvi/app/lookupmap.js`, v1.1 |
| `rules.js`: the inside rows and counts (`facilitiesInside`, `facilityCounts`, `facilityTable`, grouped by layer and with the unit added) and `round2` | `site/cvi/app/lookup.js`, v1.1 |
| `rules.js`: the blank-line rule a layer's points are numbered by (`isBlankLine`) | `site/shared/facilities.js`, v1.1 |
