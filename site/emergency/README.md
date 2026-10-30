# Emergency Response (preview)

The Emergency Response dashboard: positives of an animal disease emergency on a map, their zones, the facility and
premises sites inside them, and the CVI movements that touch them. HPAI is the first emergency type.

## Files

| File | What it is |
|---|---|
| `index.html` | The page |
| `app.js` | The page's code: loading (chosen here or sent by the landing page), the five folds, the value boxes, the "Map \| Overview" switch; on the Map the map's data, the legend, the tabs; the Overview (2.3: its three boxes, with the people inside the zones from the 2020 Census tracts of `site/geo/tracts-wa.js`, the charts, the counties and positives tables) |
| `map.js` | The Emergency map kind of the shared map: zones, the sites inside and outside, the positives, the picked spot |
| `datasets.js` | The files the dashboard recognizes: positives, facility layers and their manifest, zone files, the CVI master |
| `sample.js` | The synthetic sample offered under "Load your data" |
| `types.js` | The emergency types' list: checks each type's fields and picks the type for a positives file |
| `types/hpai.js` | The HPAI type; its top comment explains every field. Copy it to add a type |
| `types/nws.js` | The New World screwworm type: zones from a file, with an example ring until one is loaded |
| `rules.js` | The rules, with no page work: the positives and their names, which get zones, the locations left out, what lies inside, the "nearest" line, the value boxes, the chart's counts, the Overview's counties, positives, boxes, bars and people inside the zones, the export rows (with `counties.csv`), `zones.csv` and `zones.geojson` (each zone with a `name` property, as `zones.csv`'s "Zone", so the file reopens under "Use a zone file" with its zones named) |
| `branded.js` | The map picture (PNG): the branded 11 x 8.5 in page of the map as shown, with no page work (a copy of Premise Lookup's, below); with a CVI master, the CVI premises in a zone drawn hollow under "CVI PREMISES" with the CVI tab's years |
| `chart.js` | The charts, drawn as SVG with no page work: "Positives over time" (stacked columns, one per week or month), its counts from `rules.js` `overTime`; the Overview's horizontal bars ("Positives by county", "Sites inside the zones by layer"); E2's chart view is meant to add its charts here |

## Shared and copied code

The page loads the platform's shared files unchanged (`site/shared/`), and CVI's files as the Infrastructure page
loads them (`datasets.js`, `csv.js`, `master.js`, `scaling.js`, `palettes.js`, `aggregate.js`, `summary.js`,
`icons.js`, `basemaps.js`, `map.js`), with CVI's `exports.js` (the CSV writer and its formula guard), `lookup.js`
(`query`, Premise Lookup's CVI match, for the CVI movements tab) and `brandedmaps.js` (the branded pages' helpers, for
the map picture, with the shared `branded.js`, `tiles.js` and `labels.js`, in the Infrastructure page's order); none of
them is changed. Code copied from the other dashboards names its source and version in a comment at its top, so a later
fix to the original can be carried over on purpose:

| Copy | Source |
|---|---|
| `index.html`: the loader's markup; the loader, checklist, section, field, ticked-list, help-button, count-card, map-frame and legend styles | `site/infrastructure/index.html`, v1.1 |
| `index.html`: the two-button switch's styles (here the result tabs and "Map \| Overview") | `site/cvi/index.html`, v1.1 |
| `app.js`: the loading (run, publish, answerHub, the hand-off and the sample download), the facility files' preparation, the basemap, neighboring regions and population context controls, the "?" handler | `site/infrastructure/app.js`, v1.1 |
| `map.js`: the kind's sources, layers, hover and Pick on map | `site/cvi/app/lookupmap.js`, v1.1 |
| `rules.js`: the inside rows and counts (`facilitiesInside`, `facilityCounts`, `facilityTable`, grouped by layer and with the unit added) and `round2` | `site/cvi/app/lookup.js`, v1.1 |
| `rules.js`: the blank-line rule a layer's points are numbered by (`isBlankLine`) | `site/shared/facilities.js`, v1.1 |
| `branded.js`: Premise Lookup's branded proximity page (`proximity()` and the helpers it does not export or that change: the panel's rows and drawing, the key's lines and column, the WA inset, the shape sizes, `touchesBox`, `boxesMeet`), with the Emergency changes listed at its top | `site/cvi/app/brandedmaps.js`, v2.0 |
| `app.js`: the map picture's background, quality and tile loading (with Default and a notice when tiles cannot be loaded) | `site/infrastructure/app.js`, v2.0 |
| `chart.js`: the text escaping, Arial's text widths (`textWidth`) and ggplot2's axis breaks (`extended` and its scores; `valueAxis`, here keeping whole numbers only) | `site/cvi/app/chartsvg.js`, v2.0 |
| `chart.js`: the horizontal bars (`hbars` with `fit`, `labelStep` and the drawing context, without the picking; a row's bars stacked, a hollow bar and the labels above their bars on a phone marked "Emergency:") | `site/cvi/app/chartsvg.js`, v2.2 |
| `app.js`: the charts' hover box (`showTip`); `index.html`: its style (`.chart-tip`) | `site/cvi/app/ui.js` and `site/cvi/index.html`, v2.0 |
| `index.html`: the map hover's text size and padding (`.maplibregl-popup-content`) | `site/cvi/index.html`, v2.0 |
