/* Emergency Response rules: pure (no page work), on plain lists, so the unit suite and the R reference
 * (tests/oracle/em_oracle.R) check them directly. Distances and "inside" are the shared engine's (shared/proximity.js:
 * CVI's distance rule on a sphere of 6,378,137 m, the edge counting as inside, a point inside a zone polygon at 0 km).
 *
 * Positives:
 *   readPositives(header, rows, type?, today?) -> { type, positives, dropped, columns, badDates, badCloseDates,
 *     badReleaseDates, badQuarantineStatus }
 *     header: the file's column names; rows: its data rows (lists of text, as a CSV reader gives them). type: an
 *     emergency type (types.js); without one, the type is picked (types.pick) from the values of every disease
 *     column the loaded types name (their columns.disease) that the file has.
 *     The type names the columns read for the ID, the detection date, the disease, the status, the quarantine release,
 *     the quarantine status, the flock type, the inventory and the columns shown (its columns field), and the closed column and closed date
 *     (its closed field); the latitude, longitude, county and species are read by the names in COLUMNS whatever the
 *     type.
 *     positives: [{ index (0, 1, ... among the usable rows), line (the file's line number, the header being line 1),
 *       id, name, county, lat, lon, status ({ label, color } or null), statusText, closed, closedDate, quarantine,
 *       releaseAfterToday (a release date after today, given today), quarantineStatus ('under', 'released' or null), quarantineStatusText (as written, or null),
 *       detected (dates as YYYY-MM-DD or null), disease, species, flockType, inventoryText (as written), inventory
 *       (a number, or null when blank or unreadable), size (the flock size class), shown ([[column, value]] in the
 *       type's order) }].
 *     The detection date is the first of the type's detected columns with a value in that row (the agreed HPAI
 *     table: Confirmed Diagnosis, else Date Reported). A file with none of the type's status columns gives every
 *     positive the type's first status (the agreed HPAI table has no testing status: every row is confirmed); with
 *     one, a value that is not one of the type's statuses gives none.
 *     dropped: the rows without a usable latitude and longitude ("not mapped"): each with the same fields as a
 *       positive (index, lat and lon null; named by its ID, else "Line 9 (County)") and a reason: "no coordinates",
 *       "no latitude", "no longitude", "latitude and longitude look swapped" (unusable as written, in Washington the
 *       other way round; never swapped by the page) or "coordinates not readable".
 *     columns: the column found for each of lat, lon, id, status, closed, closedDate, quarantine, quarantineStatus, flockType,
 *       inventory, detected (the first found), county, disease, species (or null), and shown (a list).
 *     badDates, badCloseDates, badReleaseDates: rows whose detection date, closed date or quarantine release date
 *       could not be read. A positive with an unreadable closed date is past by its closed column alone.
 *     badQuarantineStatus: rows whose quarantine status is not one of the type's quarantineValues (read as blank).
 *     Each row also carries its own: unreadDates (0 to 3 of those dates not read) and unreadQuarantine, which the
 *     lines under the value boxes count, so they count only the kinds ticked.
 *     Names: the ID (Case ID, or AnimalDiseaseReportId in the earlier form) when the row has one, else "Positive 1
 *     (County)" in file order, or "Positive 1" without a county. A column whose name holds address, location, street
 *     or premise is never read, so no address can reach a name, a label or an export.
 *   statusChoices(type, positives) -> [{ key, label, color, count }]: the type's statuses, then "No status" when a
 *     positive has none (key "none").
 *   defaultTicks(type, positives) -> { statuses: [keys], pastShown }: zones.applyTo "open": every status;
 *     "confirmed": the type's first status only. Past positives are hidden at first (pastShown false).
 *   targets(positives, ticks, win?) -> the positives that get zones: a ticked status, inside the window, and current
 *     on its end date. A past positive never gets zones.
 *   suggestedLayers(type, positives, loaded) -> the layer keys ticked at first: the keys of every bySpecies entry
 *     with a word in a positive's species (any case, at the start of a word), else the type's default list; only
 *     the keys in loaded (the layers whose files are there), in the type's order.
 *
 * The window, the groups and the play (dates as YYYY-MM-DD; a window is { start, end }, either may be blank):
 *   windowOf(positives) -> the earliest and latest readable detection dates, or null.
 *   inWindow(p, win) -> detected between start and end, both counting; a positive without a readable date is inside
 *     whatever the window.
 *   isPast(p, end) -> past on the end date: its closed date on or before it; without a readable closed date, when its
 *     closed column says closed, its quarantine release date on or before it (not a release date after today),
 *     or, with neither date, any end date. closedDayNotKnown(p) -> closed by its closed column alone, with neither
 *     date or with a release date after today (so a day before today may show it closed too early). quarantineOf(read, p, end) -> for a past positive in a file with a quarantine
 *     release or status column: 'under' (still under quarantine on the end date) or 'released' by a readable release
 *     date (after the end, or on or before it); without one, by its quarantine status; with neither, 'unknown' in a
 *     file with a status column, 'under' in a file with only the release date. Else
 *     null. stillQuarantined(read, p, end) -> quarantineOf is 'under'.
 *   groups(read, win) -> { current, past, stillQuarantined, notKnown, closedDayNotKnown, undated, outside, notMapped }: the
 *     positives inside the window by group (closedDayNotKnown: the past ones closed on a day not known; undated: those
 *     of them without a readable date; outside: detected outside the window).
 *     groupOf(p, end) -> "Active", "Closed" or "Not mapped" (the lists keep their names, current and past).
 *   playSteps(win) -> { by: 'week' or 'month', steps: [{ start, end, label }] }: epi weeks (Sunday to Saturday,
 *     "Week of Oct 4, 2026"), or calendar months ("Month of Oct 2026") when the window holds more than 26 weeks;
 *     each step ends on its Saturday or the month's last day, the last on the window's end. Worked out with
 *     Date.UTC, never local time. weekOf(date) -> its Sunday; dayLabel(date) -> "Oct 4, 2026".
 *   overTime(read, win, steps) -> { by, columns: [{ start, end, label, current, past, outside, kinds }], notMapped,
 *     undated }: the chart's counts, one column per step of the file's play (steps), the mapped dated positives by the
 *     step they were detected in: current or past on the window's end date, or outside the window. kinds: the same
 *     positives inside the window, active and closed together, by chartKindOf ({ birds: 2, several: 1 }), for the
 *     Overview's "Columns by: Animal".
 *   chartKindOf(type, p) -> the part of a chart a positive is counted in by animal: its kind's key, or SEVERAL
 *     ("several") when its species names more than one kind, so each positive is counted once. chartKinds(read, keys)
 *     -> [{ key, index, label }]: the kinds of keys among the read's rows, in the type's order, then "Several kinds"
 *     (index: the number of kinds) when a mixed positive is among them.
 *
 * The two views. A view is a window with its kind, so every rule that takes a window takes a view:
 *   dayView(fileWindow, day) -> { view: 'day', start (the file's first detection), end (the day) }: "On a day", every
 *     positive detected on or before the day, active or closed on it. rangeView(start, end) -> { view: 'range',
 *     start, end }: "Between dates", every positive detected between the dates, active or closed on the second.
 *   openingViews(fileWindow, today) -> { day, range } after a load: the day today, the range from the first detection
 *     to today (both moved to a detection after today, so none is hidden); null without a readable date.
 *   chartSpan(fileWindow, today) -> the chart's span, the first detection to today (or the last detection, if later).
 *   viewSteps(steps, view) -> the play's steps in a view: the chart's columns that reach into it, the last ending on
 *     the view's end (On a day from the file's first column; Between dates from the range's first date).
 *   pickColumn(view, column) -> the view after a chart column is picked: the day moved to the column's last day, or
 *     the range made the column's own dates.
 *   boxesOf(view) -> the value boxes shown, in order: ['positives', 'past', 'last', 'inside'] On a day (and without a
 *     view), ['detected', 'positives', 'past', 'inside'] Between dates.
 *   viewBadge(view) -> "Oct 30, 2026" or "Sep 1, 2026 – Oct 5, 2026"; periodLine(view) -> the map picture's "Active on
 *     Oct 30, 2026" or "Detected Sep 1, 2026 to Oct 5, 2026"; viewParams(view) -> export_params.json's
 *     { view: 'on a day', day } or { view: 'between dates', detected_between: [start, end] }.
 *
 * The report's numbers:
 *   inventoryOf(text) -> a whole number (thousands commas allowed), or null; never zero for a blank.
 *   sizeClass(n) -> "Small" under 100, "Medium" 100 to 1,000, "Large" over 1,000, or null.
 *   numbersLine(read, list) -> "4 commercial, 67 backyard, 4.1M birds" (the flock type with the most animals first;
 *     each kind's totals: "1.2M birds, 3,550 cattle, 12 goats"; "; 2 without an inventory" when some are blank), or
 *     null. bigNumber(n) -> "4.1M", or "18,535" under a million.
 * The kinds of animal (the type's kinds):
 *   kindOf(type, p) -> { kind, index, indices, mixed, parts, named, one, unlisted }: every kind with a word in p's
 *     species, in the type's order ("Cattle, Chicken" is birds and cattle, mixed); a word inside a longer word of
 *     another kind does not count ("Pigeon" is birds, not a "pig"); no species, the first; a species no kind names,
 *     the last and unlisted. named: the word its animals are counted under ("birds"; with nameEach the species' own,
 *     "goats"; mixed, "animals"), one: the same for one animal. kindKeysOf(type, p) -> its kinds' keys.
 *     pluralOf(word). inventoryWordOf(type, p) -> the word in p's hover ("2 seals", "1 opossum", "400 animals (birds
 *     and cattle)").
 *   animalShapeOf(type, p) -> the mark's shape: the first kind's place in ANIMAL_SHAPES (circle, square, triangle,
 *     diamond, pentagon, hexagon; a seventh kind or later the hexagon); animalShapesOf(type, p) -> one per kind it
 *     names. animalKeys(type, list) -> [{ key, shape, label, legend }], one per kind among list, in the type's order.
 *     animalKindsOf(read) -> the same over the positives and the rows not mapped (the "Animals" ticks).
 *   byAnimals(read, keys, species?) -> the read with only the positives and rows not mapped of the kinds whose keys
 *     are given (a mixed one while any of its kinds is), and with species picked, only those (the
 *     "Animals" ticks and "Refine by species"). speciesList(read, keys) -> the species of those kinds with their numbers.
 *     animalsOnly(type, list, keys) -> "Cattle", "Birds and cattle" when some kinds are left out, else null.
 *     unlistedLine(type, list) -> "1 positive with a species not listed: Opossum", or null. mixedLine(type, list) ->
 *     '1 positive names two kinds: "Cattle, Chicken" (400 animals, counted in neither kind)', or null.
 *   notMappedLine(dropped) -> "2 not mapped: no coordinates", or null.
 *   details(read, p) -> [[column, value]] shown in the hover and positives.csv: the flock type, the shown columns,
 *     the inventory as written and "Flock size".
 *
 * Zones (ring distances in the unit shown, "km" or "mi"; toKm(d, unit) is the one conversion, 1 mile = 1.609344 km,
 * and fromKm(km, unit) turns an exact km into the unit shown):
 *   ringSites(targets, rings, unit?) -> prepared sites (proximity.prepareSites): one per positive with zones, its
 *     radii the rings' distances in km; each site also has positive (the positive's index).
 *   zoneSites(zones) -> prepared sites from a zone file's zones (zones.js read()) or drawn zones: each a polygon,
 *     matched inside only, with its source ("file" or "drawn") and areaM2. bothSites(ringSites, zoneSites) -> the
 *     two together for Both, the zone sites' ids numbered on after the rings'.
 *   ringLabel(rings, km, unit?) -> the label of the smallest ring at least km (the ring a point lies in).
 *   daysSince(sites, list, asOf) -> for each site and each of its rings, the latest detection among the dated
 *     positives in list inside it, and the days from it to asOf: [{ site, name, positive, rings: [{ km, latest,
 *     days }], latest, days (the outer ring's) }]. byQuiet(rows) -> the longest-quiet zone last.
 *   zoneRows(days, { zonesMode, rings, unit, asOf }) -> { columns, rows } for the "Zones" list and zones.csv: one row
 *     per positive with zones (its outer ring) or per zone-file zone, the longest-quiet last.
 *   zonesGeoJson(parts, opts) -> a FeatureCollection (RFC 7946: longitude and latitude, no crs, six decimals,
 *     exteriors counterclockwise and holes clockwise): a whole 360-step circle per ring per positive, and each zone
 *     file zone as read, never merged; properties name (as zones.csv's "Zone", so the file reopens named here and
 *     in a GIS), zone, positive, group, distance, unit, days_since_last_positive, as_of. A ring's direction is read by shared/zones.js signedArea (positive when counterclockwise).
 *     A zone's feature also has area_sq_mi, area_acres and source ("file" or "drawn"), a drawn zone's zone
 *     "Drawn zone"; zones.csv's rows end with "Area (sq mi)" and "Area (acres)" (blank for a ring).
 *
 * Drawn zones ("Draw a zone"). Corners are [lon, lat]; a side is the straight line between two
 * corners in longitude and latitude, as the inside test reads it:
 *   areaM2(geometry) -> the area in m² on the sphere of 6,378,137 m (the spherical-polygon formula Leaflet.draw and
 *     Turf use), a polygon's holes taken off; areaOf(m2) -> { sqMi (two decimals), acres (whole) }; areaText(m2) ->
 *     "12.4 sq mi, 7,936 acres" (acres alone under 0.1 sq mi); lengthText(km, unit) -> "3.9 km" or "2.4 mi".
 *   DRAW: the limits (3 to 200 corners, 20 drawn zones, 60-character names, a square's size 0.1 to 100).
 *   crossesAt(corners, p) -> the next side, from the last corner to p, would meet a side drawn before it or turn back
 *     along the last one; isSimple(corners) -> the closed shape's sides meet only where they follow each other;
 *     canClose(corners) -> 3 to 200 corners and isSimple. sidesMeet(p, q, r, s): crossing or touching.
 *   drawLabel(corners, pointer, unit) -> { lines, cross, closes }: "8.8 km from the first click" and, from the third
 *     corner, "Area ..." with the pointer as the next corner (or "Can’t close here: sides would cross" when the side
 *     back to the first corner would cross, closes false); ["Sides can’t cross"] with cross true.
 *   rectangleCorners(a, b) (null for a flat one), rectangleSize(a, b) -> { eastKm, northKm }, rectangleLabel(a, b,
 *     unit) -> ["9.9 km by 4.8 km", "Area ..."]; squareCorners(mid, size, unit) (its edges size away from mid, north,
 *     south, east and west; KM_LAT degrees a km north), squareLabel(mid, size, unit, around) -> ["Around
 *     SYN-HPAI-001", "6.0 km across (3.0 km each way)", "Area ..."]; circleCorners(mid, size, unit) (CIRCLE_SIDES
 *     corners, each size from mid on the sphere), circleLabel(mid, size, unit, around) -> ["Around SYN-HPAI-001",
 *     "3.0 km radius", "Area ..."]; readSize(text) -> { size } or { reason }.
 *   drawnZone(corners, name, shape) -> { name, first, geometry, point, vertices, source: 'drawn', shape } (the
 *     corners to six decimals, the outline counterclockwise, the point from zones.js pointInside: what a zone file
 *     holding the same polygon gives, with source and shape), or null when not canClose; editedZone(zone, corners)
 *     (no shape); cornersOf(zone); shapeText(zone, unit) -> "Square, 6.0 km across", "Rectangle, 9.9 km by 4.8 km",
 *     "Circle, 3.0 km radius" or "6 corners".
 *   drawnName(count, taken) -> { name: "Drawn zone n", count: n }, skipping a name taken; zoneName(typed, zone,
 *     taken, reserved) -> { name, taken, by }: a typed name as the added points' (blank gives the first name), refused
 *     when another zone, a ring or a positive has it (by: 'zone', 'ring' or 'positive').
 *   zoneSet(fileZones, drawn) -> the file's zones, then the drawn ones; SHOWS ('rings', 'zones', 'both');
 *     showOf(show, fileZones, drawn) -> what shows ('rings' while no zone exists); showAfter(change, { show,
 *     fileZones, drawn }) -> the switch after 'drawn' (Rings becomes Both), 'file' (Rings becomes Zones), 'edited',
 *     'removed' or 'file cleared' (Rings once no zone is left); zonesNamed(fileName, n) -> "zones.geojson and 2
 *     drawn", "2 drawn zones"; drawnParams(drawn, shown) -> export_params.json's { drawn_zones, zones_shown }.
 *   cviEnds(matched) -> the CVI premises the map draws with the tick "CVI movements": { origins, dests }, each
 *     [{ lat, lon, cvis, ids, place }], a matched movement's origin (hitOrigin) or destination (hitDest) inside a zone
 *     with usable coordinates, each spot once per end (as the map picture draws them, branded.js) with its number of
 *     CVIs, their numbers in order, and its place as the CVI movements table writes it ("Yakima, WA": the county and
 *     state of the first movement there).
 *   cviSpeciesIn(master, groups) -> "Refine by species" in the CVI movements tab: the raw Species of the
 *     master's rows in the species groups given, each once, blanks left out, sorted as CVI sorts them (master.js
 *     collate); none for a master without a Species column. CVI's rule (ui.js refreshSub, v2.3).
 *   cviRows(master, species) -> the master CVI's query reads: only the rows whose Species is one of those
 *     picked, as CVI's maps narrow theirs (aggregate.js build); the master itself with none picked or without a
 *     Species column. A master without a CVI column numbers the rows it is given (lookup.js query), so its "row_"
 *     numbers are those of the species picked.
 *   CVI_ENDS -> the movement's end in a zone (as Premise Lookup's "Match endpoint"): [{ key (lookup.js query's
 *     endpoint: 'either', 'origin' or 'dest'), label (the tab's choice), words (the tab's line: "left from inside the
 *     zones") }]; cviEndOf(key) -> its entry, Either for any other key.
 *
 * Locations too coarse for zone results ("Left out"), checked on each point before the inside list is made:
 *   coarseReason(point) -> null, or why the point is left out: located only to a town (geo_source "google_city", the
 *     platform's rule) or not placed (geo_source "none", which CVI leaves out of its counts); a geocode_precision other than rooftop or street (trimmed and lowercased, as RAD's registry
 *     stores it), a match_status other than Matched, a premises_type other than Street (RAD's
 *     premises_zone_eligible(), core/premises_registry.R). point.precision holds those three values as the file gives
 *     them; a column the file does not have is left out of it and does not count against the point.
 *   precisionRows(header, rows) -> for each row facilities.prepare numbers (its points' ordinal: the file's rows
 *     without blank lines), the precision values of the columns the file has (any case), as point.precision wants.
 *   layersOf(selected, precision) -> { key: layer }: the facility layers as the page keeps them, from the shared
 *     select (facilities.js select: the layers asked for, with only the points matching their attribute picks) and
 *     precisionRows by layer key. Each { key, label, color, shape, layer (the selected layer), points: [{ id, name,
 *     display, lat, lon, county, town, geoSource, values (the filter columns' values), precision }] }.
 *
 * What is inside:
 *   inside(sites, layers, opts) -> { rows, layers, leftOut, total }
 *     layers: [{ key, label, color, points: [{ name, display, lat, lon, county, town, geoSource, precision }] }]
 *     opts: { mode ('rings', 'zones' or 'both': the ring sites and the zone sites, a zone site by its source),
 *       rings (rings and both: the rings, for the labels), unit (the rings' unit, km by
 *       default), positives (the positives the "nearest" line measures from), includeCoarse (true: no point is left
 *       out) }.
 *     rows: layer by layer, then site by site, nearest first (then by name): { site, siteName, layer, layerLabel, name, lat,
 *       lon, exactKm, km (R's round(x, 2)), bandKm, inZone (matched to a zone polygon, so no distance is said), zone
 *       (the ring's label, or the zone's name), county, town }.
 *     layers: per layer { key, label, color, mode, inside (distinct sites inside any ring or zone), byZone: [{ label,
 *       count, ring }] (each site once in the smallest ring that holds it, and in each zone polygon that holds it; the
 *       rings first), nearest ({ name, km,
 *       from, county, town } for a layer with nothing inside, null otherwise), leftOut (count), usable (points
 *       checked) }.
 *     leftOut: [{ layer, layerLabel, name, reason, county, town }]. total: distinct sites inside, over every layer.
 *   countLine(layerSummary, unit?, noneMatch?) -> one line per layer: "Dairies: 1 in the Infection zone, 3 in the
 *     Control zone", or, with nothing inside, "Dairies: none inside. Nearest: Synthetic Dairy 3, 14.2 km from
 *     SYN-HPAI-003" (the distance in the unit, km by default); a layer whose filters leave it no site at all (noneMatch),
 *     "none inside (no sites match the filters)"; one whose sites are all left out, "(no usable locations)".
 *
 * The value boxes and the exports:
 *   valueBoxes(read, result, win?, today?, targets?) -> { order (boxesOf), detected: { value, reason, active, closed }, positives: { value,
 *     note, lines }, past: { value, reason, note, quarantined, notKnown }, last: { value, reason, note }, inside: { value,
 *     reason } }; a value that cannot be given is null with "Not
 *     available: needs ..." as its reason (never shown as zero). Each count is said once: the positives' value
 *     counts the current positives inside the window, its note "5 with zones" only when that differs; the past box
 *     counts the past positives inside it, its note "2 still under quarantine" (or "none under quarantine"), with ", 1
 *     not known" when a quarantine is not known; lines holds the not-mapped line, "2 dates not readable" (detection,
 *     closed and release dates together), "1 quarantine status not read", "1 without a date" and, on a view ending before
 *     today, "3 closed on a day not known" (closedDayNotKnown), each when it applies; the last
 *     positive is the latest inside the window, its note "As of Oct 5, 2026" (the window's end); a view with no
 *     dated positive in a file whose dates are read says "None by this day" (On a day) or "None between these dates";
 *     detected counts every positive in the view (the current and the past). Without a window
 *     (no readable detection date) the current positives are those not past by their closed column, the past box is
 *     not available and only the not-mapped and unreadable-dates lines are added.
 *   exportRows(read, targets, result, unit?, win?) -> { positives, inside, layers, leftOut }: each { columns, rows }
 *     for the CSV files, with no address column; positives.csv lists the positives inside the window and the rows
 *     not mapped, each with its group (Active, Closed or Not mapped), the details and a note ("Still under quarantine", "Quarantine not known", or
 *     "Not mapped: ..."); a "Quarantine Status" column (as written) when the file has one. The
 *     distances in the unit (km by default).
 *
 * The Overview, from the positives inside the window, current or past on its end date:
 *   countyOf(p, counties) -> the file's County (as the county's own name when it names one of Washington's, whatever
 *     its case, spacing or a trailing "County"), else the name of the county shape holding the positive (counties: the
 *     map's county Features, site/geo/wa-counties.js), else the nearest within NEAR_KM (2 km), else "Outside
 *     Washington" (OUTSIDE_WA).
 *   countyRows(read, win, counties) -> [{ county, current, past, total, kinds (active and closed by chartKindOf),
 *     animals ([[word, n]], the current positives'), animalsText ("1.3M birds"), missing (current positives without a
 *     count) }], by current, then total, then name, "Outside Washington" last.
 *   positiveRows(read, win, counties) -> { columns, rows }: the ID (or "Positive"), Detected, County, Flock size, the
 *     flock type, species, status, "Active or closed", quarantine release and quarantine status columns the file has; dates written out
 *     ("Oct 5, 2026"); newest first, the undated last. No address column.
 *   peopleInside(sites, tracts, opts) -> null without sites, else { total, rounded (three significant figures:
 *     roughly(n)), year, tracts: [{ geoid, pop, share, people }] (each tract touched), beyond (a zone reaches past
 *     Washington: reachesPastWashington) }: tracts [{ geoid, pop, coordinates }] (a MultiPolygon's, as population.js
 *     geometry() decodes them; Washington's); opts { year, counties }. How it is measured: at the function.
 *   overviewBoxes(read, win, counties, people) -> { counties: { value, label, note }: On a day the counties with an
 *     active positive ("Outside Washington" not counted), note "8 counties since Nov 2024 · 1 outside Washington";
 *     Between dates the counties with a positive detected, note "3 with an active one" }, animals: { value ("1.3M
 *     birds"), note (the counted-apart animals, the flock types, "1 without a count") }, people: { value (rounded),
 *     note ("Estimate from 57 Census tracts (2020)", with " · Washington only" when a zone reaches past the state; "Not
 *     available: the zones are outside Washington" when it touches no tract) } }, each with a reason ("Not available: needs zones") when its
 *     value cannot be given, never zero for an unknown.
 *   overviewBars(countyRows, result, kinds?) -> { counties, layers }: [{ label, parts: [{ key, value }], total }] for
 *     the two bar charts (current and past by county, or with kinds (chartKinds' keys) each kind's by county; each
 *     ring's or zone's count by layer, the total its distinct sites).
 *   countyTable(read, countyRows) -> { columns, rows } for counties.csv: County, Active, Closed, Total, each animal
 *     word's exact total at the active positives, and the active positives without a count.
 *   flockKinds(list), animalTotals(read, list), animalsText(totals): the counts shared with numbersLine.
 * The inside rows and counts are copied from site/cvi/app/lookup.js, v1.1 (facilitiesInside, facilityCounts and
 * facilityTable), with the zones' labels and the unit added, and the rows grouped by layer first (the results tab lists
 * them layer by layer); round2 is copied from the same file. */
(function (root) {
  'use strict';
  const P = () => root.WSDA.proximity;
  const T = () => root.WSDA.emergencyTypes;
  // Ring distances are kept in the unit shown and turned into km by toKm alone; shown distances come from the exact km.
  const KM_PER_MILE = 1.609344;
  const UNITS = { km: { label: 'km' }, mi: { label: 'mi' } };
  const toKm = (d, unit) => (unit === 'mi' ? d * KM_PER_MILE : d);
  const fromKm = (km, unit) => (unit === 'mi' ? km / KM_PER_MILE : km);
  // Washington's box, a little wide, used only to say a pair looks swapped.
  const WA = { south: 45.5, north: 49.1, west: -124.9, east: -116.9 };

  // Columns read from a positives file whatever the type, any case (the type names the others); never one whose
  // name holds a word below.
  const COLUMNS = {
    lat: ['case lat', 'lat', 'latitude', 'y'],
    lon: ['case long', 'long', 'lon', 'lng', 'longitude', 'x'],
    county: ['county'],
    species: ['species', 'species group']
  };
  const PRIVATE = /address|location|street|premise/i;
  const TOWN_LEVEL = /^google_city$/i, UNPLACED = /^none$/i;

  // R's round(x, 2): to the nearest hundredth of the number's exact value; an exact half goes to the even hundredth.
  // The exact value is read from its decimal expansion (x * 100 can itself round onto a half: 2.675 is below one).
  function round2(x) {
    if (x === null) return null;
    const exact = Math.abs(x).toFixed(20);
    if (/\.\d\d50*$/.test(exact)) {
      const down = Number(exact.slice(0, exact.indexOf('.') + 3).replace('.', ''));
      return Math.sign(x) * (down % 2 === 0 ? down : down + 1) / 100;
    }
    return Number(x.toFixed(2));
  }
  const text = v => (v === null || v === undefined ? '' : String(v).trim());
  // True when a word starts a word of the text (both lowercased): types.js's one word rule.
  const hasWord = (v, w) => T().hasWord(v, w);
  const listOf = a => a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];

  // The index of the first column with one of the names (any case), skipping private columns; -1 when none.
  function columnIndex(header, names) {
    const lower = header.map(h => text(h).toLowerCase());
    for (const n of names) {
      const i = lower.indexOf(n.toLowerCase());
      if (i >= 0 && !PRIVATE.test(header[i])) return i;
    }
    return -1;
  }

  // A date written YYYY-MM-DD, YYYY/M/D or M/D/YYYY (a time after any of them is ignored, as Excel and ArcGIS write
  // "10/15/2026 0:00"), as YYYY-MM-DD; null otherwise.
  function dateOf(v) {
    const s = text(v);
    let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T].*)?$/.exec(s), y, mo, d;
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else {
      m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T].*)?$/.exec(s);
      if (!m) return null;
      y = +m[3]; mo = +m[1]; d = +m[2];
    }
    const iso = String(y).padStart(4, '0') + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    const back = new Date(iso + 'T00:00:00Z');
    return !isNaN(back) && back.toISOString().slice(0, 10) === iso ? iso : null;
  }

  function readPositives(header, rows, type, today) {
    const col = {};
    for (const k of Object.keys(COLUMNS)) col[k] = columnIndex(header, COLUMNS[k]);
    const cell = (r, i) => i < 0 ? '' : text(r[i]);
    const blank = r => r.every(v => text(v) === '');
    const data = (rows || []).map((r, i) => ({ r, line: i + 2 })).filter(x => !blank(x.r));
    // The type: picked from the values of every disease column the loaded types name that the file has.
    if (!type) {
      const diseaseNames = T().list().flatMap(t => t.columns.disease);
      const at = [...new Set(diseaseNames.map(n => columnIndex(header, [n])).filter(i => i >= 0))];
      type = T().pick(at.length ? at.flatMap(i => data.map(x => cell(x.r, i))) : null).type;
    }
    const names = type.columns;
    Object.assign(col, { id: columnIndex(header, names.id), status: columnIndex(header, names.status),
      disease: columnIndex(header, names.disease), quarantine: columnIndex(header, names.quarantine),
      quarantineStatus: columnIndex(header, names.quarantineStatus),
      closed: columnIndex(header, type.closed.column), closedDate: columnIndex(header, type.closed.dateColumn),
      flockType: columnIndex(header, names.flockType), inventory: columnIndex(header, names.inventory) });
    // Every detection-date column the file has, in the type's order of preference; and the columns shown.
    const each = list => [...new Set(list.map(n => columnIndex(header, [n])).filter(i => i >= 0))];
    const detectedAt = each(names.detected), shownAt = each(names.shown);
    const firstStatus = type.statuses[0];
    const positives = [], dropped = [];
    let badDates = 0, badCloseDates = 0, badReleaseDates = 0, badQuarantineStatus = 0;
    for (const { r, line } of data) {
      const latText = cell(r, col.lat), lonText = cell(r, col.lon);
      const lat = P().number(latText), lon = P().number(lonText);
      const mapped = P().usable(lat, lon);
      const id = cell(r, col.id), county = cell(r, col.county);
      const statusText = cell(r, col.status);
      const status = col.status < 0 ? firstStatus : T().statusOf(type, statusText);
      const detectedText = detectedAt.map(i => cell(r, i)).find(v => v) || '', detected = dateOf(detectedText);
      if (detectedText && !detected) badDates++;
      const closedText = cell(r, col.closedDate), closedDate = dateOf(closedText);
      if (closedText && !closedDate) badCloseDates++;
      const releaseText = cell(r, col.quarantine), release = dateOf(releaseText);
      if (releaseText && !release) badReleaseDates++;
      const qText = cell(r, col.quarantineStatus), qStatus = T().quarantineStatusOf(type, qText);
      if (qText && !qStatus) badQuarantineStatus++;
      // The row's own unreadable dates and quarantine status, so the lines under the value boxes count only the
      // kinds ticked.
      const unreadDates = (detectedText && !detected ? 1 : 0) + (closedText && !closedDate ? 1 : 0) + (releaseText && !release ? 1 : 0);
      const inventoryText = cell(r, col.inventory), inventory = inventoryOf(inventoryText);
      const p = { index: null, line, id: id || null, name: null, county: county || null, lat: null, lon: null,
        status: status ? { label: status.label, color: status.color } : null,
        statusText: statusText || null, closed: col.closed >= 0 && T().isClosed(type, r[col.closed]),
        closedDate, quarantine: release, releaseAfterToday: !!(today && release && release > today),
        quarantineStatus: qStatus, quarantineStatusText: qText || null, unreadDates, unreadQuarantine: !!(qText && !qStatus),
        detected, disease: cell(r, col.disease) || null, species: cell(r, col.species) || null,
        flockType: cell(r, col.flockType) || null, inventoryText: inventoryText || null, inventory,
        size: sizeClass(inventory), shown: shownAt.map(i => [header[i], cell(r, i)]) };
      if (mapped) {
        const n = positives.length + 1;
        positives.push(Object.assign(p, { index: positives.length, lat, lon,
          name: id || 'Positive ' + n + (county ? ' (' + county + ')' : '') }));
      } else {
        dropped.push(Object.assign(p, { name: id || 'Line ' + line + (county ? ' (' + county + ')' : ''),
          reason: notMappedReason(latText, lonText, lat, lon) }));
      }
    }
    const columns = {};
    for (const k of Object.keys(col)) columns[k] = col[k] < 0 ? null : header[col[k]];
    columns.detected = detectedAt.length ? header[detectedAt[0]] : null;
    columns.shown = shownAt.map(i => header[i]);
    return { type, positives, dropped, columns, badDates, badCloseDates, badReleaseDates, badQuarantineStatus };
  }

  // Why a row could not be mapped. A pair that is unusable as written but would fall in Washington the other way
  // round is reported as swapped; the page never swaps it itself.
  function notMappedReason(latText, lonText, lat, lon) {
    if (!latText && !lonText) return 'no coordinates';
    if (!latText) return 'no latitude';
    if (!lonText) return 'no longitude';
    if (lat !== null && lon !== null && lon >= WA.south && lon <= WA.north && lat >= WA.west && lat <= WA.east) {
      return 'latitude and longitude look swapped';
    }
    return 'coordinates not readable';
  }

  // A whole number of animals, written with or without thousands commas ("1,250,000"); null when blank or unreadable,
  // never zero.
  function inventoryOf(v) {
    const s = text(v);
    if (!/^\d+$/.test(s) && !/^\d{1,3}(,\d{3})+$/.test(s)) return null;
    return Number(s.replace(/,/g, ''));
  }

  // The flock size class, as the agency's HPAI update defines it: Small under 100, Medium 100 to 1,000, Large over
  // 1,000; null without an inventory.
  function sizeClass(n) {
    if (n === null || n === undefined) return null;
    return n < 100 ? 'Small' : n <= 1000 ? 'Medium' : 'Large';
  }

  function statusChoices(type, positives) {
    const out = type.statuses.map(s => ({ key: s.label, label: s.label, color: s.color,
      count: positives.filter(p => p.status && p.status.label === s.label).length }));
    const none = positives.filter(p => !p.status).length;
    if (none) out.push({ key: 'none', label: 'No status', color: null, count: none });
    return out;
  }

  function defaultTicks(type, positives) {
    const all = statusChoices(type, positives).map(c => c.key);
    const applyTo = type.zones.applyTo;
    return { statuses: applyTo === 'confirmed' ? [type.statuses[0].label] : all, pastShown: false };
  }

  function targets(positives, ticks, win) {
    const on = new Set(ticks.statuses), end = win ? win.end : null;
    return positives.filter(p => on.has(p.status ? p.status.label : 'none') && inWindow(p, win) && !isPast(p, end));
  }

  function suggestedLayers(type, positives, loaded) {
    const species = positives.map(p => text(p.species).toLowerCase()).filter(Boolean);
    const hits = type.layers.bySpecies.filter(e => e.words.some(w => species.some(v => hasWord(v, w))));
    const keys = hits.length ? hits.flatMap(e => e.keys) : type.layers.default;
    const have = new Set(loaded || []);
    return [...new Set(keys)].filter(k => have.has(k));
  }

  // ---- The window, the groups and the play -------------------------------------------------------------------

  // The earliest and the latest readable detection date, or null when no positive has one.
  function windowOf(positives) {
    const dates = positives.map(p => p.detected).filter(Boolean).sort();
    return dates.length ? { start: dates[0], end: dates[dates.length - 1] } : null;
  }

  // Inside the window: detected between its start and end (both counting); a positive without a readable date is
  // shown whatever the window. A blank start or end does not limit.
  function inWindow(p, win) {
    if (!win || !p.detected) return true;
    return (!win.start || p.detected >= win.start) && (!win.end || p.detected <= win.end);
  }

  // Past on the end date: its closed date (the end of surveillance) on or before it. Without a readable closed date,
  // a positive its closed column says closed is past from its quarantine release date (2.5: the agency's table often
  // has the release date but not the closed date, so a day before the release shows it active, as it was); with
  // neither date, on any date. A release date after today (a planned date, or a typing slip) is not when it closed,
  // so it counts as neither. With no end date, any closed date makes it past.
  function isPast(p, end) {
    if (p.closedDate) return !end || p.closedDate <= end;
    if (p.closed && p.quarantine && !p.releaseAfterToday) return !end || p.quarantine <= end;
    return p.closed;
  }
  // Closed by its closed column alone, with no readable closed date and no release date on or before today: past on
  // any date, so the day it closed is not known (the boxes say how many on a view ending before today).
  const closedDayNotKnown = p => p.closed && !p.closedDate && (!p.quarantine || p.releaseAfterToday);

  // A past positive's quarantine on the end date. A readable release date decides (it is exact for any end date);
  // without one, the quarantine status (it describes today, whatever the end date); with neither, not known when the
  // file has a status column, or still under quarantine when it has only the release date column (the rule before
  // the status column). The agency's release dates are often filled in late, hence the status column (2.4).
  function quarantineOf(read, p, end) {
    if ((!read.columns.quarantine && !read.columns.quarantineStatus) || !isPast(p, end)) return null;
    if (p.quarantine) return end && p.quarantine > end ? 'under' : 'released';
    if (p.quarantineStatus) return p.quarantineStatus;
    return read.columns.quarantineStatus ? 'unknown' : 'under';
  }
  const stillQuarantined = (read, p, end) => quarantineOf(read, p, end) === 'under';

  function groups(read, win) {
    const end = win ? win.end : null;
    const out = { current: [], past: [], stillQuarantined: [], notKnown: [], closedDayNotKnown: [], undated: [], outside: [],
      notMapped: read.dropped };
    for (const p of read.positives) {
      if (!inWindow(p, win)) {
        out.outside.push(p);
        continue;
      }
      if (!p.detected) out.undated.push(p);
      if (isPast(p, end)) {
        out.past.push(p);
        const q = quarantineOf(read, p, end);
        if (q === 'under') out.stillQuarantined.push(p);
        else if (q === 'unknown') out.notKnown.push(p);
        if (closedDayNotKnown(p)) out.closedDayNotKnown.push(p);
      } else out.current.push(p);
    }
    return out;
  }

  // A positive's group on the end date: "Active", "Closed", or "Not mapped" for a row without usable coordinates (the
  // words since 2.5; the lists keep their names, current and past).
  const groupOf = (p, end) => (p.index === null ? 'Not mapped' : isPast(p, end) ? 'Closed' : 'Active');

  // Dates: YYYY-MM-DD in and out, worked out in UTC (never the computer's own time zone).
  const DAY_MS = 86400000;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const msOf = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  const isoOf = ms => new Date(ms).toISOString().slice(0, 10);
  const addDays = (iso, n) => isoOf(msOf(iso) + n * DAY_MS);
  const daysBetween = (from, to) => Math.round((msOf(to) - msOf(from)) / DAY_MS);
  // The Sunday that starts the date's epi week (Sunday to Saturday).
  const weekOf = iso => addDays(iso, -new Date(msOf(iso)).getUTCDay());
  // "Oct 4, 2026"
  const dayLabel = iso => MONTHS[+iso.slice(5, 7) - 1] + ' ' + +iso.slice(8, 10) + ', ' + iso.slice(0, 4);
  // More than this many epi weeks in the window: the play and the chart step by calendar month.
  const MAX_WEEKS = 26;

  // The play's steps over the window: { by: 'week' or 'month', steps: [{ start, end, label }] }. Each step's end
  // is its Saturday (or the month's last day), except the last, which stops on the window's end itself.
  function playSteps(win) {
    if (!win || !win.start || !win.end || win.start > win.end) return { by: null, steps: [] };
    const first = weekOf(win.start), last = weekOf(win.end);
    const weeks = daysBetween(first, last) / 7 + 1;
    const steps = [];
    if (weeks <= MAX_WEEKS) {
      for (let sunday = first; sunday <= last; sunday = addDays(sunday, 7)) {
        const saturday = addDays(sunday, 6);
        steps.push({ start: sunday, end: saturday < win.end ? saturday : win.end, label: 'Week of ' + dayLabel(sunday) });
      }
      return { by: 'week', steps };
    }
    let y = +win.start.slice(0, 4), m = +win.start.slice(5, 7);
    const lastMonth = win.end.slice(0, 7);
    for (;;) {
      const start = String(y).padStart(4, '0') + '-' + String(m).padStart(2, '0') + '-01';
      const monthEnd = isoOf(Date.UTC(y, m, 0));
      steps.push({ start, end: monthEnd < win.end ? monthEnd : win.end, label: 'Month of ' + MONTHS[m - 1] + ' ' + y });
      if (start.slice(0, 7) === lastMonth) break;
      if (++m > 12) { m = 1; y++; }
    }
    return { by: 'month', steps };
  }

  // Positives over time (the chart): the mapped positives with a readable detection date, counted in the step they
  // were detected in. steps: playSteps over the file's whole span, so the columns stay put while the window moves.
  // Each column counts its current and past positives on the window's end date (detected inside the window) and those
  // outside the window (detected before its start or after its end). The rows not mapped and the positives without a
  // date are not counted; their numbers are given for the note under the chart.
  function overTime(read, win, steps) {
    const end = win ? win.end : null;
    const columns = (steps ? steps.steps : []).map(s => ({ start: s.start, end: s.end, label: s.label,
      current: 0, past: 0, outside: 0, kinds: {} }));
    const positives = read ? read.positives : [];
    for (const p of positives) {
      if (!p.detected) continue;
      const c = columns.find(x => p.detected >= x.start && p.detected <= x.end);
      if (!c) continue;   // only when the steps are not the file's own
      if (!inWindow(p, win)) { c.outside++; continue; }
      if (isPast(p, end)) c.past++;
      else c.current++;
      const k = chartKindOf(read.type, p);
      c.kinds[k] = (c.kinds[k] || 0) + 1;
    }
    return { by: steps ? steps.by : null, columns, notMapped: read ? read.dropped.length : 0,
      undated: positives.filter(p => !p.detected).length };
  }

  // ---- The two views (2.5) -------------------------------------------------------------------------------------

  // A view is a window with its kind, so every rule here that takes a window takes a view unchanged:
  //   "On a day", { view: 'day', start, end }: end is the day, and start is held at the file's first detection, so
  //     every positive detected on or before the day is inside it, active or closed on the day.
  //   "Between dates", { view: 'range', start, end }: the positives detected between the two dates (both counting),
  //     active or closed on the second.
  const dayView = (fileWindow, day) => ({ view: 'day', start: fileWindow ? fileWindow.start : null, end: day });
  const rangeView = (start, end) => ({ view: 'range', start, end });
  const later = (a, b) => (a > b ? a : b);

  // The views a load opens on: the day is today; the range runs from the file's first detection to today. A
  // detection after today (a typing slip, or the computer's date set wrong) moves both to it, so the opening dates
  // never hide a positive. Null without a readable detection date.
  function openingViews(fileWindow, today) {
    if (!fileWindow) return null;
    const end = later(today, fileWindow.end);
    return { day: dayView(fileWindow, end), range: rangeView(fileWindow.start, end) };
  }

  // The chart's span: the file's first detection to today (or to its last detection, when later), so the day's line
  // on today is not at the chart's edge. The chart's columns are playSteps over it and stay put whatever the view.
  const chartSpan = (fileWindow, today) => (fileWindow ? { start: fileWindow.start, end: later(today, fileWindow.end) } : null);

  // The play's steps in a view: the chart's columns (steps: playSteps over chartSpan) that reach into it, the last
  // ending on the view's end. "On a day" plays from the file's first column to the day; "Between dates" grows the
  // range from its first date, each step's end becoming its second date.
  function viewSteps(steps, view) {
    const by = steps ? steps.by : null;
    if (!view || !steps) return { by, steps: [] };
    const from = view.view === 'range' ? view.start : null;
    const list = steps.steps.filter(s => s.start <= view.end && (!from || s.end >= from))
      .map(s => (s.end > view.end ? Object.assign({}, s, { end: view.end }) : s));
    return { by, steps: list };
  }

  // A chart column picked: "On a day" moves the day to the column's last day; "Between dates" becomes the column's
  // own week or month.
  function pickColumn(view, column) {
    return view.view === 'range' ? rangeView(column.start, column.end) : Object.assign({}, view, { end: column.end });
  }

  // The boxes each view shows, in order: "On a day" the active, the closed, the last positive and the sites inside;
  // "Between dates" the detected first, and no last positive (the band shows where the range ends).
  const boxesOf = view => (view && view.view === 'range' ? ['detected', 'positives', 'past', 'inside']
    : ['positives', 'past', 'last', 'inside']);

  // The view's words: the badge on the map and the Overview ("Oct 30, 2026", or "Sep 1, 2026 – Oct 5, 2026"); the map
  // picture's period line ("Active on Oct 30, 2026", or "Detected Sep 1, 2026 to Oct 5, 2026": its key says closed);
  // export_params.json's fields. Null without a view.
  function viewBadge(view) {
    if (!view) return null;
    return view.view === 'range' ? dayLabel(view.start) + ' – ' + dayLabel(view.end) : dayLabel(view.end);
  }
  function periodLine(view) {
    if (!view) return null;
    return view.view === 'range' ? 'Detected ' + dayLabel(view.start) + ' to ' + dayLabel(view.end)
      : 'Active on ' + dayLabel(view.end);
  }
  function viewParams(view) {
    if (!view) return { view: null };
    return view.view === 'range' ? { view: 'between dates', detected_between: [view.start, view.end] }
      : { view: 'on a day', day: view.end };
  }

  // ---- The report's numbers ------------------------------------------------------------------------------------

  // 4133418 -> "4.1M"; under a million with thousands commas ("18,535").
  function bigNumber(n) {
    if (n >= 1e6) return Math.round(n / 1e5) / 10 + 'M';
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  // ---- The kinds of animal (2.8, option E) --------------------------------------------------------------------

  // A positive's kinds: every kind with one of its words in the species, in the type's order, so
  // "Cattle, Chicken" is both birds and cattle (mixed). A word does not count where a longer word of another kind
  // starts at the same place ("pig" in "pigeon": "Pigeon" is birds only). No species, the first kind; a species no
  // kind's words name, the last kind, and unlisted (only in a type that lists species words). -> { kind and index
  // (the first of its kinds), indices (all of them), mixed, parts: [{ index, named, one }] one per kind, named and one
  // (the word its animals are counted under: the kind's word, or with nameEach the species' own word, "goats", "goat";
  // mixed, "animals", "animal"), unlisted }.
  function kindOf(type, p) {
    const kinds = type.kinds, species = text(p.species).toLowerCase().replace(/\s+/g, ' ');
    const covered = (i, w, at) => kinds.some((k, j) => j !== i && k.words.some(f => f.length > w.length && species.startsWith(f, at)));
    const hitOf = i => kinds[i].words.find(w => T().wordStarts(species, w).some(at => !covered(i, w, at))) || null;
    const hits = species ? kinds.map((k, i) => ({ index: i, hit: hitOf(i) })).filter(h => h.hit) : [];
    const unlisted = !!species && !hits.length && kinds.some(k => k.words.length);
    if (!hits.length) hits.push({ index: species ? kinds.length - 1 : 0, hit: null });
    const parts = hits.map(h => {
      const kind = kinds[h.index], own = h.hit || species;
      return kind.nameEach && species ? { index: h.index, named: pluralOf(own), one: own } : { index: h.index, named: kind.word, one: kind.word };
    });
    const mixed = parts.length > 1;
    return { kind: kinds[parts[0].index], index: parts[0].index, indices: parts.map(x => x.index), mixed, parts,
      named: mixed ? 'animals' : parts[0].named, one: mixed ? 'animal' : parts[0].one, unlisted };
  }
  // A positive's kinds by key: ["birds", "cattle"].
  const kindKeysOf = (type, p) => kindOf(type, p).indices.map(i => type.kinds[i].key);
  // A species word for many animals: "goats", "foxes", "wolves"; "sheep", "mink", the -ine words and a word already
  // plural ("geese", "mice") as they are; a species ending in something other than a plain word ("Opossum (juvenile)")
  // as written.
  const SAME_PLURAL = ['sheep', 'deer', 'elk', 'moose', 'bison', 'mink', 'swine', 'cattle', 'fish', 'caprine', 'ovine',
    'porcine', 'bovine', 'equine', 'feline', 'canine', 'camelid'];
  const IRREGULAR = { wolf: 'wolves', mouse: 'mice', goose: 'geese', ox: 'oxen' };
  function pluralOf(w) {
    const at = w.lastIndexOf(' ') + 1, last = w.slice(at);
    if (IRREGULAR[last]) return w.slice(0, at) + IRREGULAR[last];
    if (SAME_PLURAL.includes(last) || Object.values(IRREGULAR).includes(last) || /s$/.test(last)) return w;
    if (!/^[a-z][a-z-]*$/.test(last)) return w;
    if (/(x|z|ch|sh)$/.test(last)) return w + 'es';
    return /[^aeiou]y$/.test(last) ? w.slice(0, -1) + 'ies' : w + 's';
  }

  // The word a positive's animals are counted under in its hover: "1.2M birds", "2 seals", "1 opossum"; a mixed one
  // its kinds: "400 animals (birds and cattle)".
  function inventoryWordOf(type, p) {
    const k = kindOf(type, p), word = p.inventory === 1 ? k.one : k.named;
    return k.mixed ? word + ' (' + listOf(k.parts.map(x => x.named)) + ')' : word;
  }

  // The positive's mark tells its kind (2.4; 2.8 every kind its own): in the type's order a circle, square, triangle,
  // diamond, pentagon, hexagon; a seventh kind or later shares the hexagon (its legend row says so). animalShapeOf: its
  // first kind's; animalShapesOf: one per kind it names, a mixed positive's marks side by side ("circle", "square").
  const ANIMAL_SHAPES = ['circle', 'square', 'triangle', 'diamond', 'pentagon', 'hexagon'];
  const shapeAt = i => ANIMAL_SHAPES[Math.min(Math.max(i, 0), ANIMAL_SHAPES.length - 1)];
  function animalShapeOf(type, p) {
    return shapeAt(kindOf(type, p).index);
  }
  function animalShapesOf(type, p) {
    return [...new Set(kindOf(type, p).indices.map(shapeAt))];
  }
  // The kinds among the positives, in the type's order: [{ key, shape, label ("Birds"; the ticks and the words),
  // legend (the legend's and the map key's row: the label, with "(same mark as Swine)" on a kind sharing a mark) }].
  // A mixed positive brings each of its kinds.
  function animalKeys(type, list) {
    const present = new Set(list.flatMap(p => kindOf(type, p).indices));
    return type.kinds.map((k, i) => {
      if (!present.has(i)) return null;
      const first = type.kinds[ANIMAL_SHAPES.indexOf(shapeAt(i))];
      return { key: k.key, shape: shapeAt(i), label: k.label, legend: first === k ? k.label : k.label + ' (same mark as ' + first.label + ')' };
    }).filter(Boolean);
  }

  // The file's kinds (2.7): animalKeys over its positives and its rows not mapped, so a kind whose rows are all
  // unmapped still gets its tick.
  function animalKindsOf(read) {
    return animalKeys(read.type, read.positives.concat(read.dropped || []));
  }

  // A positive's species as "Refine by species" lists it: as written, or "(no species)".
  const speciesName = p => text(p.species) || '(no species)';
  // The animal filter (2.7; 2.8 by the kind's key and, with species picked, only those): the read with only the
  // positives (and the rows not mapped) of the kinds ticked, so a kind left out leaves every view as if it were not in
  // the file; a mixed positive stays while any of its kinds is ticked. species: the species picked in "Refine by
  // species" (none picked: every species of the kinds ticked).
  function byAnimals(read, keys, species) {
    const picked = species && species.length ? species : null;
    const keep = p => kindKeysOf(read.type, p).some(k => keys.includes(k)) && (!picked || picked.includes(speciesName(p)));
    return Object.assign({}, read, { positives: read.positives.filter(keep), dropped: (read.dropped || []).filter(keep) });
  }
  // "Refine by species" (2.8): the species of the kinds ticked, under each kind in the type's order, the most animals
  // first, then by name: [{ key, label, shape, species: [{ name, positives, animals (null when none has a count),
  // text ("1 positive, 1,200,000 animals") }] }]. Over the read given (the whole file's) and its rows not mapped. A
  // mixed species ("Cattle, Chicken") is listed under each of its kinds.
  function speciesList(read, keys) {
    const all = read.positives.concat(read.dropped || []);
    return read.type.kinds.map((k, i) => {
      if (!keys.includes(k.key)) return null;
      const by = new Map();
      all.filter(p => kindOf(read.type, p).indices.includes(i)).forEach(p => {
        const name = speciesName(p), s = by.get(name) || { name, positives: 0, animals: null };
        s.positives++;
        if (p.inventory !== null && p.inventory !== undefined) s.animals = (s.animals || 0) + p.inventory;
        by.set(name, s);
      });
      if (!by.size) return null;
      const species = [...by.values()].sort((a, b) => (b.animals || 0) - (a.animals || 0) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      species.forEach(s => {
        s.text = s.positives + (s.positives === 1 ? ' positive' : ' positives') + ', ' + (s.animals === null ? 'no count'
          : s.animals.toLocaleString('en-US') + (s.animals === 1 ? ' animal' : ' animals'));
      });
      return { key: k.key, label: k.label, shape: shapeAt(i), species };
    }).filter(Boolean);
  }
  // The kinds shown in words when some are left out: "Cattle", "Birds and cattle"; null with every kind shown, with
  // one kind in the file, or with none ticked. keys: the kinds ticked.
  function animalsOnly(type, list, keys) {
    const kinds = animalKeys(type, list);
    const shown = kinds.filter(k => keys.includes(k.key));
    if (kinds.length < 2 || !shown.length || shown.length === kinds.length) return null;
    return listOf(shown.map((k, i) => (i ? k.label.toLowerCase() : k.label)));
  }
  // The line under the value boxes naming the species no kind's words name (2.8): "2 positives with a species not
  // listed: Fox, Opossum" (five names, then how many more), or null.
  function unlistedLine(type, list) {
    const hits = list.filter(p => kindOf(type, p).unlisted);
    if (!hits.length) return null;
    const names = [...new Set(hits.map(p => text(p.species)))].sort();
    const shown = names.length > 6 ? names.slice(0, 5).join(', ') + ' and ' + (names.length - 5) + ' more' : names.join(', ');
    return hits.length.toLocaleString('en-US') + (hits.length === 1 ? ' positive' : ' positives') + ' with a species not listed: ' + shown;
  }
  // The line under the value boxes naming the positives whose species names more than one kind:
  // '1 positive names two kinds: "Cattle, Chicken" (400 animals, counted in neither kind)' (five names, then how
  // many more; "more than one kind" when one names three or more; no number when none has a count), or null.
  function mixedLine(type, list) {
    const hits = list.filter(p => kindOf(type, p).mixed);
    if (!hits.length) return null;
    const names = [...new Set(hits.map(p => '"' + text(p.species) + '"'))].sort();
    const shown = names.length > 6 ? names.slice(0, 5).join(', ') + ' and ' + (names.length - 5) + ' more' : names.join(', ');
    const two = hits.every(p => kindOf(type, p).indices.length === 2);
    const counted = hits.filter(p => p.inventory !== null && p.inventory !== undefined);
    const n = counted.reduce((s, p) => s + p.inventory, 0);
    return hits.length.toLocaleString('en-US') + (hits.length === 1 ? ' positive names ' : ' positives name ') +
      (two ? 'two kinds: ' : 'more than one kind: ') + shown + ' (' +
      (counted.length ? n.toLocaleString('en-US') + (n === 1 ? ' animal' : ' animals') + ', ' : '') + 'counted in neither kind)';
  }

  // One line counting the positives by flock type and adding up their animals: "4 commercial, 67 backyard, 4.1M
  // birds", each kind's animals added up apart ("1.2M birds, 3,550 cattle, 12 goats"). The flock type with the most
  // animals comes first; the totals in animalTotals' order, each only when one of its positives has an inventory. A blank inventory is left out of the totals and named ("2
  // without an inventory"), never counted as zero. Null when the file has neither column, or for no positives.
  function numbersLine(read, list) {
    const hasType = !!read.columns.flockType, hasInventory = !!read.columns.inventory;
    if (!list.length || (!hasType && !hasInventory)) return null;
    const parts = hasType ? flockKinds(list).map(kindText) : [];
    let line = '';
    if (hasInventory) {
      const a = animalTotals(read, list);
      a.totals.forEach(([w, n]) => parts.push(bigNumber(n) + ' ' + w));
      line = parts.join(', ');
      if (a.missing) line += (line ? '; ' : '') + a.missing + ' without an inventory';
    } else line = parts.join(', ');
    return line;
  }

  // The positives by flock type: [{ key (lowercase, '' when blank), count, animals }], the type with the most
  // animals first, then the most positives, then by name; a blank type last. kindText(k) -> "3 commercial".
  function flockKinds(list) {
    const kinds = new Map();
    for (const p of list) {
      const key = text(p.flockType).toLowerCase();
      const k = kinds.get(key) || { key, count: 0, animals: 0 };
      k.count++;
      k.animals += p.inventory || 0;
      kinds.set(key, k);
    }
    return [...kinds.values()].sort((a, b) => (a.key === '') - (b.key === '') || b.animals - a.animals ||
      b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }
  const kindText = k => k.count + ' ' + (k.key || 'without a type');

  // The Overview's charts by animal (2.8, "Columns by: Animal"): a positive is counted once, in its kind's part, or in
  // "Several kinds" when its species names more than one kind (as its animals are counted in neither kind).
  const SEVERAL = 'several';
  function chartKindOf(type, p) {
    const k = kindOf(type, p);
    return k.mixed ? SEVERAL : k.kind.key;
  }
  // The chart's parts for the kinds ticked (keys): those among the read's rows (mapped or not, so a part keeps its
  // color while the dates move), in the type's order, then "Several kinds" when a mixed positive is among them.
  function chartKinds(read, keys) {
    const rows = read.positives.concat(read.dropped || []);
    const present = new Set(rows.map(p => chartKindOf(read.type, p)));
    const out = read.type.kinds.map((k, index) => ({ key: k.key, index, label: k.label }))
      .filter(k => keys.includes(k.key) && present.has(k.key));
    if (present.has(SEVERAL)) out.push({ key: SEVERAL, index: read.type.kinds.length, label: 'Several kinds' });
    return out;
  }

  // The positives' animals added up by the word they are counted under (kindOf's named: the kind's word, or each
  // species' own): { totals: [[word, n]], the first kind's first, then the most animals first (on a tie, the type's
  // order, then the word); a total of one animal in its singular ("1 opossum"); the animals of the mixed positives in
  // neither kind, last ("400 animals of several kinds"); missing (the positives without a count, never counted as
  // zero) }. animalsText(totals) -> "1.2M birds, 2,400 cattle, 12 goats".
  const MIXED_WORD = 'animals of several kinds', MIXED_ONE = 'animal of several kinds';
  function animalTotals(read, list) {
    const totals = new Map();
    let missing = 0, mixed = null;
    for (const p of list) {
      if (p.inventory === null) {
        missing++;
        continue;
      }
      const k = kindOf(read.type, p);
      if (k.mixed) {
        mixed = (mixed || 0) + p.inventory;
        continue;
      }
      const t = totals.get(k.named) || { word: k.named, one: k.one, index: k.index, n: 0 };
      t.n += p.inventory;
      totals.set(k.named, t);
    }
    const sorted = [...totals.values()].sort((a, b) => (b.index === 0) - (a.index === 0) || b.n - a.n || a.index - b.index ||
      (a.word < b.word ? -1 : a.word > b.word ? 1 : 0)).map(t => [t.n === 1 ? t.one : t.word, t.n]);
    if (mixed !== null) sorted.push([mixed === 1 ? MIXED_ONE : MIXED_WORD, mixed]);
    return { totals: sorted, missing };
  }
  const animalsText = totals => totals.map(([w, n]) => bigNumber(n) + ' ' + w).join(', ');

  // The rows without usable coordinates, counted by reason: "2 not mapped: no coordinates", or with several reasons
  // "3 not mapped: 2 no coordinates, 1 latitude and longitude look swapped". Null when every row is mapped.
  function notMappedLine(dropped) {
    if (!dropped.length) return null;
    const by = new Map();
    dropped.forEach(d => by.set(d.reason, (by.get(d.reason) || 0) + 1));
    const reasons = [...by];
    if (reasons.length === 1) return dropped.length + ' not mapped: ' + reasons[0][0];
    return dropped.length + ' not mapped: ' + reasons.map(([r, n]) => n + ' ' + r).join(', ');
  }

  // What the hover and positives.csv show beside a positive, in this order: the flock type, the shown columns, the
  // inventory as written and the flock size class (the last two when the file has an inventory column).
  function details(read, p) {
    const out = [];
    if (read.columns.flockType) out.push([read.columns.flockType, p.flockType || '']);
    p.shown.forEach(pair => out.push(pair));
    if (read.columns.inventory) {
      out.push([read.columns.inventory, p.inventoryText || '']);
      out.push(['Flock size', p.size || '']);
    }
    return out;
  }

  // ---- Days since the last positive, per zone ------------------------------------------------------------------

  // For each prepared site (ringSites or zoneSites), each of its rings: the latest detection among the dated
  // positives inside it (the edge counting; inside a zone file's polygon by proximity.inZone), and the days from
  // it to the as-of date. list: the positives that count (those detected inside the window, whatever their group).
  // -> [{ site, name, positive (a ring site's positive index, else null), rings: [{ km, latest, days }], latest, days
  // (the outer ring's), source and areaM2 (a zone site's, else null) }]; latest and days are null when no dated
  // positive is inside.
  function daysSince(sites, list, asOf) {
    const dated = list.filter(p => p.detected && (!asOf || p.detected <= asOf));
    return sites.map(s => {
      const rings = s.radii.map(km => {
        let latest = null;
        for (const p of dated) {
          const d = P().siteKm(p.lat, p.lon, s);
          if (d !== null && d <= km && (!latest || p.detected > latest)) latest = p.detected;
        }
        return { km, latest, days: latest && asOf ? daysBetween(latest, asOf) : null };
      });
      const outer = rings[rings.length - 1];
      return { site: s.id, name: text(s.name), positive: s.positive === undefined ? null : s.positive, rings,
        latest: outer.latest, days: outer.days, source: s.source || null, areaM2: s.areaM2 === undefined ? null : s.areaM2 };
    });
  }

  // The "Zones" list's order: the most recent positive first, the longest-quiet zone last, a zone with no dated
  // positive after them all; then by name.
  function byQuiet(rows) {
    const key = r => (r.days === null ? Infinity : r.days);
    return rows.slice().sort((a, b) => key(a) - key(b) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  // The "Zones" list and zones.csv: one row per positive with zones (its outer ring: "Control zone (10 km) around
  // SYN-HPAI-001") or per zone (its name; in Both, 3b, the rings' rows and the zones' together), the longest-quiet
  // last. days: daysSince's rows (a zone's has its source); o: { zonesMode, rings (distances in unit), unit, asOf }. A
  // zone (from a file or drawn) has no positive, ring, distance or unit; its area (2.6) is in the last two columns,
  // blank for a ring.
  function zoneRows(days, o) {
    const unit = o.unit || 'km', outer = !o.zonesMode && o.rings && o.rings.length ? o.rings[o.rings.length - 1] : null;
    const shown = d => String(Number(d.toFixed(2)));
    const columns = ['Zone', 'Positive', 'Ring', 'Distance', 'Unit', 'Last positive', 'Days since the last positive', 'As of',
      'Area (sq mi)', 'Area (acres)'];
    const area = z => (z.areaM2 === null || z.areaM2 === undefined ? ['', ''] : [areaOf(z.areaM2).sqMi, areaOf(z.areaM2).acres]);
    const rows = byQuiet(days).map(z => (outer && !z.source
      ? [outer.label + ' (' + shown(outer.distance) + ' ' + UNITS[unit].label + ') around ' + z.name, z.name, outer.label,
        outer.distance, UNITS[unit].label, z.latest || '', z.days === null ? '' : z.days, o.asOf || '', '', '']
      : [z.name, '', '', '', '', z.latest || '', z.days === null ? '' : z.days, o.asOf || ''].concat(area(z))));
    return { columns, rows };
  }

  // ---- The zones as GeoJSON (RFC 7946) ---------------------------------------------------------------------------

  const round6 = x => Number(x.toFixed(6));
  // A ring written to RFC 7946: counterclockwise (ccw true) or clockwise, six decimals, closed.
  function writeRing(ring, ccw) {
    const r = (root.WSDA.zones.signedArea(ring) > 0) === ccw ? ring.slice() : ring.slice().reverse();
    const out = r.map(pt => [round6(pt[0]), round6(pt[1])]);
    const a = out[0], b = out[out.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) out.push(a.slice());
    return out;
  }
  // A Polygon or MultiPolygon with each exterior counterclockwise and each hole clockwise.
  function writeGeometry(g) {
    const polygon = rings => rings.map((ring, i) => writeRing(ring, i === 0));
    return g.type === 'Polygon' ? { type: 'Polygon', coordinates: polygon(g.coordinates) }
      : { type: 'MultiPolygon', coordinates: g.coordinates.map(polygon) };
  }

  // One feature per zone drawn: a whole circle per ring per positive (360 steps, as CVI draws them), and each zone
  // file zone as read. No merging. parts: { rings: [{ sites (ringSites), group ('Active', 'Added point' or 'Closed') }], zones
  // (zoneSites, or none) }; opts: { rings (the ring list, distances in unit), unit, asOf, positives (those that count
  // for days since) }. Properties: name ("Infection zone (3 km) around SYN-HPAI-001", or the zone file zone's name: the
  // property shared/zones.js reads a zone's name from), zone, positive, group, distance, unit, days_since_last_positive,
  // as_of; a zone's also area_sq_mi, area_acres and source ('file' or 'drawn'; 2.6), a drawn zone's zone "Drawn zone";
  // never an address, location, street or premise.
  function zonesGeoJson(parts, opts) {
    const o = opts || {}, features = [];
    const feature = (geometry, props) => features.push({ type: 'Feature', properties: props, geometry });
    for (const part of parts.rings || []) {
      const days = daysSince(part.sites, o.positives || [], o.asOf);
      part.sites.forEach((s, k) => o.rings.forEach((ring, i) => {
        const km = toKm(ring.distance, o.unit);
        const at = days[k].rings.find(x => x.km === km);
        feature(writeGeometry({ type: 'Polygon', coordinates: [P().circle(s.lat, s.lon, km, 360)] }), {
          name: ring.label + ' (' + String(Number(ring.distance.toFixed(2))) + ' ' + UNITS[o.unit || 'km'].label + ') around ' + text(s.name),
          zone: ring.label, positive: text(s.name), group: part.group, distance: ring.distance, unit: o.unit || 'km',
          days_since_last_positive: at ? at.days : null, as_of: o.asOf || null });
      }));
    }
    const zones = parts.zones || [];
    const zoneDays = daysSince(zones, o.positives || [], o.asOf);
    zones.forEach((s, k) => {
      const area = areaOf(s.areaM2 !== undefined ? s.areaM2 : areaM2(s.zone));
      feature(writeGeometry(s.zone), { name: text(s.name), zone: s.source === 'drawn' ? 'Drawn zone' : text(s.name), positive: null,
        group: null, distance: null, unit: null, days_since_last_positive: zoneDays[k].days, as_of: o.asOf || null,
        area_sq_mi: area.sqMi, area_acres: area.acres, source: s.source === 'drawn' ? 'drawn' : 'file' });
    });
    return { type: 'FeatureCollection', features };
  }

  function ringSites(list, rings, unit) {
    const distances = rings.map(r => toKm(r.distance, unit));
    const prepared = P().prepareSites(list.map(p => ({ name: p.name, lat: p.lat, long: p.lon })),
      { defaultKm: Math.max(...distances), bands: distances });
    prepared.sites.forEach((s, k) => { s.positive = list[k].index; });
    return prepared.sites;
  }

  // Each zone site also has its source ('file', or 'drawn' for a zone drawn on the map) and its area in m² (areaM2).
  function zoneSites(zones) {
    const sites = P().prepareSites(zones.map(z => ({ name: z.name, lat: z.point[1], long: z.point[0], zone: z.geometry })),
      { defaultKm: 0 }).sites;
    sites.forEach((s, k) => { s.source = zones[k].source === 'drawn' ? 'drawn' : 'file'; s.areaM2 = areaM2(zones[k].geometry); });
    return sites;
  }

  // Both (3b): the ring sites, then the zone sites numbered on after them, so each site's id is its own (each
  // prepareSites call numbers from 1).
  function bothSites(ringList, zoneList) {
    zoneList.forEach((s, k) => { s.id = ringList.length + k + 1; });
    return ringList.concat(zoneList);
  }

  // ---- Drawn zones (2.6) -------------------------------------------------------------------------------------------
  // A zone drawn on the map is a zone as a zone file's (zones.js read()): { name, geometry, point, vertices }, with
  // source 'drawn', its first name and its shape. Corners are [lon, lat]; a side is the straight line between two
  // corners in longitude and latitude, as the inside test (proximity.js inZone) reads it.

  // The area on the sphere of CVI's distance rule (6,378,137 m), by the spherical-polygon formula of Chamberlain and
  // Duquette (JPL, 2007), as Leaflet.draw's geodesicArea writes it (Turf's area is the same sum): each ring's area, a
  // polygon's outline less its holes, a MultiPolygon's polygons added. A ring may be closed or not.
  const EARTH_M = 6378137, M2_PER_SQ_MI = 2589988.110336, M2_PER_ACRE = 4046.8564224;
  const rad = d => d * Math.PI / 180;
  function ringAreaM2(ring) {
    const a = ring[0], z = ring[ring.length - 1];
    const pts = ring.length > 1 && a[0] === z[0] && a[1] === z[1] ? ring.slice(0, -1) : ring;
    let sum = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      sum += rad(q[0] - p[0]) * (2 + Math.sin(rad(p[1])) + Math.sin(rad(q[1])));
    }
    return Math.abs(sum * EARTH_M * EARTH_M / 2);
  }
  function areaM2(g) {
    const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    return polygons.reduce((t, rings) => t + rings.reduce((u, r, i) => u + (i ? -1 : 1) * ringAreaM2(r), 0), 0);
  }
  // The exports' area: square miles to two decimals (R's round), whole acres.
  const areaOf = m2 => ({ sqMi: round2(m2 / M2_PER_SQ_MI), acres: Math.round(m2 / M2_PER_ACRE) });
  // "12.4 sq mi, 7,936 acres", whatever the km | miles switch says; acres alone under 0.1 sq mi.
  function areaText(m2) {
    const sqMi = m2 / M2_PER_SQ_MI, acres = Math.round(m2 / M2_PER_ACRE);
    const a = acres.toLocaleString('en-US') + (acres === 1 ? ' acre' : ' acres');
    return sqMi < 0.1 ? a : Number(sqMi.toFixed(1)).toLocaleString('en-US', { minimumFractionDigits: 1 }) + ' sq mi, ' + a;
  }
  // A length in the unit shown, to one decimal: "3.9 km", "2.4 mi".
  const lengthText = (km, unit) => fromKm(km, unit).toFixed(1) + ' ' + UNITS[unit || 'km'].label;
  const kmBetween = (a, b) => P().distanceKm(a[1], a[0], b[1], b[0]);

  // The limits: 3 to 200 corners a zone, up to 20 drawn zones, names as the added points' (60 characters); a
  // square's size from 0.1 to 100 in the unit shown, each way from its middle.
  const DRAW = { minCorners: 3, maxCorners: 200, maxZones: 20, nameMax: 60, minSize: 0.1, maxSize: 100 };

  // Sides that cross. turn: which way c lies from the line a-b (1, -1, or 0 on it); within: c inside a-b's box.
  const turn = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  const within = (a, b, c) => Math.min(a[0], b[0]) <= c[0] && c[0] <= Math.max(a[0], b[0])
    && Math.min(a[1], b[1]) <= c[1] && c[1] <= Math.max(a[1], b[1]);
  // The sides p-q and r-s meet: they cross, or one's end lies on the other (touching counts: ArcGIS and QGIS mark a
  // ring that touches itself invalid).
  function sidesMeet(p, q, r, s) {
    const d1 = turn(r, s, p), d2 = turn(r, s, q), d3 = turn(p, q, r), d4 = turn(p, q, s);
    if (d1 * d2 < 0 && d3 * d4 < 0) return true;
    return (d1 === 0 && within(r, s, p)) || (d2 === 0 && within(r, s, q)) || (d3 === 0 && within(p, q, r))
      || (d4 === 0 && within(p, q, s));
  }
  // Two sides in a row, a-b then b-c, where c turns straight back along a-b.
  const doublesBack = (a, b, c) => turn(a, b, c) === 0 && (a[0] - b[0]) * (c[0] - b[0]) + (a[1] - b[1]) * (c[1] - b[1]) > 0;
  const sameSpot = (a, b) => a[0] === b[0] && a[1] === b[1];
  // While drawing: the side from the last corner to p would meet a side drawn before it, or turn back along the last
  // one. (A click on the first corner finishes the shape and a click on the last adds nothing; the page checks those
  // first.)
  function crossesAt(corners, p) {
    const n = corners.length, last = corners[n - 1];
    if (n < 2) return false;
    if (doublesBack(corners[n - 2], last, p)) return true;
    for (let i = 0; i + 2 < n; i++) if (sidesMeet(last, p, corners[i], corners[i + 1])) return true;
    return false;
  }
  // A closed shape whose sides meet only where they follow each other, without turning back: what a zone needs.
  function isSimple(corners) {
    const n = corners.length;
    if (n < DRAW.minCorners) return false;
    const side = i => [corners[i], corners[(i + 1) % n]];
    for (let i = 0; i < n; i++) {
      if (doublesBack(corners[i], corners[(i + 1) % n], corners[(i + 2) % n])) return false;
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        if (sidesMeet(...side(i), ...side(j))) return false;
      }
    }
    return true;
  }
  const canClose = corners => corners.length >= DRAW.minCorners && corners.length <= DRAW.maxCorners && isSimple(corners);

  // The live label beside the pointer: the distance from the first click and, from the third corner on, the area the
  // shape would have if closed at the pointer (closes true); "Sides can’t cross" (cross true) when the next side would
  // cross.
  function drawLabel(corners, pointer, unit) {
    if (!corners.length) return { lines: [], cross: false, closes: false };
    if (crossesAt(corners, pointer)) return { lines: ['Sides can’t cross'], cross: true, closes: false };
    const lines = [lengthText(kmBetween(corners[0], pointer), unit) + ' from the first click'];
    // From the third corner: the area if closed with the pointer as the next corner (the corners alone when the
    // pointer is on the last one, as on a phone after a tap), unless the side back to the first corner would cross.
    const last = corners[corners.length - 1];
    const shape = sameSpot(pointer, last) ? corners.slice() : corners.concat([pointer]);
    const closes = corners.length >= DRAW.minCorners && isSimple(shape);
    if (corners.length >= DRAW.minCorners) lines.push(closes ? 'Area ' + areaText(ringAreaM2(shape)) : 'Can’t close here: sides would cross');
    return { lines, cross: false, closes };
  }

  // The set shapes (3a). A rectangle from two opposite corners, its sides north-south and east-west (null when the
  // two clicks share a longitude or a latitude); its size along its middle latitude and its west side.
  function rectangleCorners(a, b) {
    if (a[0] === b[0] || a[1] === b[1]) return null;
    return [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]];
  }
  function rectangleSize(a, b) {
    const mid = (a[1] + b[1]) / 2;
    return { eastKm: kmBetween([a[0], mid], [b[0], mid]), northKm: kmBetween([a[0], a[1]], [a[0], b[1]]) };
  }
  function rectangleLabel(a, b, unit) {
    const c = rectangleCorners(a, b), z = rectangleSize(a, b);
    return [lengthText(z.eastKm, unit) + ' by ' + lengthText(z.northKm, unit)].concat(c ? ['Area ' + areaText(ringAreaM2(c))] : []);
  }
  // A square of a set size around its middle: its edges the size away north, south, east and west (a 3 km square is
  // 6 km across, as the ring distances read), on the sphere of CVI's radius: a kilometer north is KM_LAT degrees
  // everywhere, a kilometer east KM_LAT / cos(latitude). Corners from the northwest, clockwise.
  const KM_LAT = 180 / (Math.PI * EARTH_M / 1000);
  function squareCorners(mid, size, unit) {
    const km = toKm(size, unit), dy = km * KM_LAT, dx = km * KM_LAT / Math.cos(rad(mid[1]));
    return [[mid[0] - dx, mid[1] + dy], [mid[0] + dx, mid[1] + dy], [mid[0] + dx, mid[1] - dy], [mid[0] - dx, mid[1] - dy]];
  }
  // around: the positive's name when the square is centered on it (its mark clicked).
  function squareLabel(mid, size, unit, around) {
    const km = toKm(size, unit);
    return (around ? ['Around ' + around] : []).concat([lengthText(2 * km, unit) + ' across (' + lengthText(km, unit) + ' each way)',
      'Area ' + areaText(ringAreaM2(squareCorners(mid, size, unit)))]);
  }
  // A circle of a set radius around its middle (3b): CIRCLE_SIDES corners, each the radius from the middle on the
  // sphere of CVI's radius (the destination along a great circle, as the ring distances are measured), from the north,
  // clockwise. Each side bows in at most r (1 - cos(pi / 120)), about 1 m at 3 km.
  const CIRCLE_SIDES = 120;
  function circleCorners(mid, size, unit) {
    const d = toKm(size, unit) * 1000 / EARTH_M, lat = rad(mid[1]), lon = rad(mid[0]), out = [];
    for (let i = 0; i < CIRCLE_SIDES; i++) {
      const b = rad(i * 360 / CIRCLE_SIDES);
      const to = Math.asin(Math.sin(lat) * Math.cos(d) + Math.cos(lat) * Math.sin(d) * Math.cos(b));
      const by = Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat), Math.cos(d) - Math.sin(lat) * Math.sin(to));
      out.push([(lon + by) * 180 / Math.PI, to * 180 / Math.PI]);
    }
    return out;
  }
  // around: the positive's name when the circle is centered on it (its mark clicked).
  function circleLabel(mid, size, unit, around) {
    return (around ? ['Around ' + around] : []).concat([lengthText(toKm(size, unit), unit) + ' radius',
      'Area ' + areaText(ringAreaM2(circleCorners(mid, size, unit)))]);
  }
  // The size box: a plain number from 0.1 to 100 -> { size }, else { reason }.
  function readSize(t) {
    const s = text(t), v = /^\d*\.?\d+$/.test(s) ? Number(s) : null;
    return v !== null && v >= DRAW.minSize && v <= DRAW.maxSize ? { size: v }
      : { reason: 'Type a size from ' + DRAW.minSize + ' to ' + DRAW.maxSize + '.' };
  }

  // A drawn zone from its corners (not closed), rounded to six decimals (as added points and zones.geojson are) and
  // its outline counterclockwise; null when the rounded corners do not make a shape a zone can be (canClose). name:
  // its name, also its first name; shape: { kind: 'rectangle', eastKm, northKm }, { kind: 'square', km } or
  // { kind: 'circle', km } (its radius), or null.
  function drawnZone(corners, name, shape) {
    const c = corners.map(p => [round6(p[0]), round6(p[1])]);
    if (!canClose(c)) return null;
    const ring = c.concat([c[0].slice()]);
    const outline = root.WSDA.zones.signedArea(ring) > 0 ? ring : ring.reverse();
    const geometry = { type: 'Polygon', coordinates: [outline] };
    return { name, first: name, geometry, point: root.WSDA.zones.pointInside(geometry), vertices: outline.length,
      source: 'drawn', shape: shape || null };
  }
  // The corners of a drawn zone, for editing (its outline without the closing point).
  const cornersOf = zone => zone.geometry.coordinates[0].slice(0, -1).map(p => p.slice());
  // After an edit: the same zone with new corners and no shape (its first name kept); null as drawnZone.
  function editedZone(zone, corners) {
    const z = drawnZone(corners, zone.name, null);
    if (z) z.first = zone.first;
    return z;
  }
  // The list row's shape: "Square, 6.0 km across", "Rectangle, 9.9 km by 4.8 km", "Circle, 3.0 km radius", or "6 corners".
  function shapeText(zone, unit) {
    const s = zone.shape;
    if (s && s.kind === 'circle') return 'Circle, ' + lengthText(s.km, unit) + ' radius';
    if (s && s.kind === 'square') return 'Square, ' + lengthText(2 * s.km, unit) + ' across';
    if (s && s.kind === 'rectangle') return 'Rectangle, ' + lengthText(s.eastKm, unit) + ' by ' + lengthText(s.northKm, unit);
    return (zone.vertices - 1) + ' corners';
  }

  // Names. A new zone's first name, "Drawn zone n": n one more than the zones drawn so far (count), skipping a name a
  // zone already has (taken: every zone's name; a reopened zones.geojson may hold "Drawn zone 1") -> { name, count }.
  function drawnName(count, taken) {
    const has = new Set(taken || []);
    let n = count + 1;
    while (has.has('Drawn zone ' + n)) n++;
    return { name: 'Drawn zone ' + n, count: n };
  }
  // A typed name: spaces squeezed, at most 60 characters, blank giving the first name back; refused (taken true, the
  // name kept) when another zone has it (taken: the other zones' names), since the counts are kept by zone name; also
  // (3b) when a ring or a positive has it (reserved: { ring: labels, positive: names }), so the count lines, layers.csv
  // and the hover never name two things alike in Both. by: 'zone', 'ring' or 'positive', what has the name.
  function zoneName(typed, zone, taken, reserved) {
    const want = text(typed).replace(/\s+/g, ' ').slice(0, DRAW.nameMax) || zone.first;
    const r = reserved || {};
    const by = (taken || []).includes(want) ? 'zone' : (r.ring || []).includes(want) ? 'ring'
      : (r.positive || []).includes(want) ? 'positive' : null;
    return by ? { name: zone.name, taken: true, by } : { name: want, taken: false, by: null };
  }

  // The zone set and the rings (3b, the switch "Rings | Zones | Both"): the zone file's zones, then the drawn ones.
  // SHOWS: the switch's picks. showOf(show, fileZones, drawn): what shows, the pick, or 'rings' while no zone exists.
  // showAfter(change, { show, fileZones, drawn }): the pick after a change, made for the user only when a new zone
  // would be hidden: on Rings a finished drawn zone picks Both and a zone file Zones; once no zone is left, Rings;
  // otherwise the pick stays. change: 'drawn', 'edited', 'removed', 'file' or 'file cleared'.
  const SHOWS = ['rings', 'zones', 'both'];
  const zoneSet = (fileZones, drawn) => (fileZones || []).concat(drawn || []);
  const showOf = (show, fileZones, drawn) => (zoneSet(fileZones, drawn).length && SHOWS.includes(show) ? show : 'rings');
  function showAfter(change, o) {
    if (o.show === 'rings' && change === 'drawn') return 'both';
    if (o.show === 'rings' && change === 'file') return 'zones';
    return showOf(o.show, o.fileZones, o.drawn);
  }
  // The map picture's meta line and export_params.json: "<file name> and 2 drawn", "2 drawn zones", or the file's name.
  function zonesNamed(fileName, drawnCount) {
    if (!drawnCount) return fileName || null;
    if (fileName) return fileName + ' and ' + drawnCount + ' drawn';
    return drawnCount === 1 ? '1 drawn zone' : drawnCount + ' drawn zones';
  }
  // export_params.json: the drawn zones' count and what showed ('rings', 'zones' or 'both').
  const drawnParams = (drawn, shown) => ({ drawn_zones: (drawn || []).length, zones_shown: shown });
  function cviEnds(matched) {
    const end = (flag, side) => {
      const spots = new Map();
      for (const r of matched || []) {
        if (!r[flag]) continue;
        const lat = P().number(r[side + '.Lat']), lon = P().number(r[side + '.Long']);
        if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
        const key = lat + ',' + lon;
        if (!spots.has(key)) {
          const place = [r[side + '.County'], r[side + '.State']].filter(v => v !== null && v !== undefined && v !== '').join(', ');
          spots.set(key, { lat, lon, ids: new Set(), place });
        }
        spots.get(key).ids.add(String(r.CVI));
      }
      return [...spots.values()].map(s => ({ lat: s.lat, lon: s.lon, cvis: s.ids.size,
        ids: [...s.ids].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })), place: s.place }));
    };
    return { origins: end('hitOrigin', 'Origin'), dests: end('hitDest', 'Dest') };
  }
  // CVI's order for its pickers (master.js collate).
  const cviCollate = (a, b) => a.localeCompare(b, 'en');
  function cviSpeciesIn(master, groups) {
    if (!master || !master.hasSpecies) return [];
    const g = new Set(groups || []);
    const names = master.rows.filter(r => g.has(r['Species.Group'])).map(r => r.Species)
      .filter(s => s !== null && s !== undefined && s !== '');
    return [...new Set(names)].sort(cviCollate);
  }
  function cviRows(master, species) {
    if (!master || !master.hasSpecies || !species || !species.length) return master;
    const picked = new Set(species);
    return Object.assign({}, master, { rows: master.rows.filter(r => r.Species !== null && picked.has(r.Species)) });
  }
  const CVI_ENDS = [
    { key: 'either', label: 'Either', words: 'left from or arrived inside the zones' },
    { key: 'origin', label: 'Origin', words: 'left from inside the zones' },
    { key: 'dest', label: 'Destination', words: 'arrived inside the zones' }];
  const cviEndOf = key => CVI_ENDS.find(e => e.key === key) || CVI_ENDS[0];

  function ringLabel(rings, km, unit) {
    const ring = rings.find(r => km <= toKm(r.distance, unit)) || rings[rings.length - 1];
    return ring.label;
  }

  function coarseReason(point) {
    if (TOWN_LEVEL.test(text(point.geoSource))) return 'located only to a town';
    if (UNPLACED.test(text(point.geoSource))) return 'not placed';
    const p = point.precision || {};
    if (p.geocode_precision !== undefined) {
      const v = text(p.geocode_precision).toLowerCase();
      if (v !== 'rooftop' && v !== 'street') return v ? 'location precision "' + v + '"' : 'no location precision';
    }
    if (p.match_status !== undefined && text(p.match_status) !== 'Matched') return 'address not matched';
    if (p.premises_type !== undefined && text(p.premises_type) !== 'Street') return 'not a street address';
    return null;
  }

  // RAD's three location-precision columns; a facility file may carry any of them.
  const PRECISION = ['geocode_precision', 'match_status', 'premises_type'];
  // A blank line, as facilities.prepare skips it before numbering its points (copied from shared/facilities.js, v1.1).
  const isBlankLine = r => r.length === 1 && (r[0] == null || r[0] === '');
  function precisionRows(header, rows) {
    const at = PRECISION.map(c => header.findIndex(h => text(h).toLowerCase() === c));
    return (rows || []).filter(r => !isBlankLine(r)).map(r => {
      const out = {};
      PRECISION.forEach((c, k) => { if (at[k] >= 0) out[c] = r[at[k]] === undefined ? '' : r[at[k]]; });
      return out;
    });
  }

  function layersOf(selected, precision) {
    const out = Object.create(null);
    for (const l of selected.layers) {
      const prec = precision[l.key] || [];
      out[l.key] = { key: l.key, label: l.liveLabel, color: l.color, shape: l.shape, layer: l,
        points: l.points.map(p => ({ id: p.id, name: p.name, display: p.display, lat: p.lat, lon: p.lon, county: p.county,
          town: p.townName || null, geoSource: p.geoSource, values: p.values, precision: prec[p.ordinal] || {} })) };
    }
    return out;
  }

  // The same site twice in a layer (one line of the file repeated) is counted once: by its name and place. The map,
  // the picture and the counts all use these two keys, so they cannot disagree about whether two rows are one site.
  const siteKey = r => r.lat + '\r' + r.lon + '\r' + r.name;
  const layerSiteKey = (layer, r) => layer + '\r' + siteKey(r);

  function inside(sites, layers, opts) {
    const o = opts || {}, PX = P(), mode = o.mode === 'zones' || o.mode === 'both' ? o.mode : 'rings';
    // A zone site: every site in zones mode; in both, those with a source (zoneSites).
    const isZone = s => mode === 'zones' || (mode === 'both' && !!s.source);
    const zoneIds = new Set(sites.filter(isZone).map(s => s.id));
    const rows = [], leftOut = [], summaries = [];
    const nameOf = p => text(p.display !== undefined ? p.display : p.name);
    for (const l of layers) {
      const usable = [];
      let left = 0;
      for (const p of l.points) {
        const reason = o.includeCoarse ? null : coarseReason(p);
        if (reason) {
          left++;
          leftOut.push({ layer: l.key, layerLabel: l.label, name: nameOf(p), reason, county: p.county || null,
            town: p.town || null });
        } else usable.push(p);
      }
      const found = [];
      sites.forEach(s => {
        const mine = [];
        usable.forEach(p => {
          const km = PX.siteKm(p.lat, p.lon, s);
          if (km === null || km > s.bufferKm) return;
          const bandKm = PX.ringOf(s.radii, km);
          mine.push({ site: s.id, siteName: text(s.name), layer: l.key, layerLabel: l.label, name: nameOf(p),
            lat: p.lat, lon: p.lon, exactKm: km, km: round2(km), bandKm, inZone: isZone(s),
            zone: isZone(s) ? text(s.name) : ringLabel(o.rings, km, o.unit), county: p.county || null, town: p.town || null });
        });
        mine.sort((a, b) => a.exactKm - b.exactKm || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        mine.forEach(r => found.push(r));
      });
      found.forEach(r => rows.push(r));
      // Each site once: in the smallest ring that holds it, and in every zone polygon that holds it. Kept by ring or
      // zone and name, so a zone named as a ring ("Control zone") is counted apart from the ring in Both.
      // No rings list yet (facility layers loaded before a positives file): no ring rows.
      const ringRows = mode === 'zones' ? [] : (o.rings || []).map(r => ['ring\r' + r.label, { label: r.label, ring: true, keys: new Set() }]);
      const zoneRows = sites.filter(isZone).map(s => ['zone\r' + text(s.name), { label: text(s.name), ring: false, keys: new Set() }]);
      const byZone = new Map(ringRows.concat(zoneRows));
      const best = new Map();
      for (const r of found) {
        const k = siteKey(r);
        if (zoneIds.has(r.site)) byZone.get('zone\r' + r.zone).keys.add(k);
        else if (!best.has(k) || r.exactKm < best.get(k).exactKm) best.set(k, r);
      }
      for (const [k, r] of best) byZone.get('ring\r' + r.zone).keys.add(k);
      const insideCount = new Set(found.map(siteKey)).size;
      let nearest = null;
      if (!insideCount) {
        for (const p of usable) for (const from of o.positives || []) {
          const km = PX.distanceKm(p.lat, p.lon, from.lat, from.lon);
          if (km === null) continue;
          const name = nameOf(p);
          if (!nearest || km < nearest.exactKm || (km === nearest.exactKm && name < nearest.name)) {
            nearest = { name, exactKm: km, km: round2(km), from: from.name, county: p.county || null, town: p.town || null };
          }
        }
      }
      summaries.push({ key: l.key, label: l.label, color: l.color, mode, inside: insideCount,
        byZone: [...byZone.values()].map(z => ({ label: z.label, count: z.keys.size, ring: z.ring })), nearest, leftOut: left,
        usable: usable.length });
    }
    const total = new Set(rows.map(r => layerSiteKey(r.layer, r))).size;
    return { rows, layers: summaries, leftOut, total };
  }

  function countLine(s, unit, noneMatch) {
    const u = unit || 'km';
    if (s.inside) {
      // A ring's label takes "the" ("in the Control zone"); a zone's names are written as they are.
      const parts = s.byZone.filter(z => z.count).map(z => z.count + ' in ' + (z.ring ? 'the ' : '') + z.label);
      return s.label + ': ' + listOf(parts);
    }
    if (!s.nearest) {
      return s.label + ': none inside' + (s.usable ? '' : noneMatch ? ' (no sites match the filters)' : ' (no usable locations)');
    }
    return s.label + ': none inside. Nearest: ' + s.nearest.name + ', ' + round2(fromKm(s.nearest.exactKm, u)) + ' ' +
      UNITS[u].label + ' from ' + s.nearest.from;
  }

  // win: the view (or a plain window); without one (no readable detection date), the current positives are those
  // not past by their closed column, and only the not-mapped and unreadable-dates lines are added. today
  // (YYYY-MM-DD): on a view ending before it, a line counts the closed positives whose closing day is not known.
  // targets: the positives with zones (targets()); fewer than the current ones adds "n with zones" to the note.
  function valueBoxes(read, result, win, today, targets) {
    const g = read && win ? groups(read, win) : null;
    const all = !read ? [] : g ? g.current : read.positives.filter(p => !isPast(p, null));
    const withZones = read && targets ? targets.length : null;
    const counted = !read ? [] : g ? g.current.concat(g.past) : read.positives;
    const dates = counted.map(p => p.detected).filter(Boolean).sort();
    // No dated positive in the view of a file whose dates are read: the box says so in the view's words (a day before
    // the first detection, or dates with no detection between them).
    const none = !!g && !dates.length && read.positives.some(p => p.detected);
    const noneWords = win && win.view === 'day' ? 'None by this day' : 'None between these dates';
    const last = !read ? { value: null, reason: 'Not available: needs the positives file' }
      : !read.columns.detected ? { value: null, reason: 'Not available: needs ' + read.type.columns.detected[0] }
        : !dates.length ? { value: null, reason: none ? noneWords : 'Not available: no readable ' + read.columns.detected }
          : { value: dates[dates.length - 1], reason: null };
    if (g && last.value && win.end) last.note = 'As of ' + dayLabel(win.end);
    const insideBox = !result || !result.layers.length
      ? { value: null, reason: 'Not available: needs a facility layer' } : { value: result.total, reason: null };
    const lines = [];
    if (read) {
      const notMapped = notMappedLine(read.dropped);
      if (notMapped) lines.push(notMapped);
      // Counted over the rows of the kinds ticked (the read given), mapped or not.
      const rows = read.positives.concat(read.dropped || []);
      const bad = rows.reduce((n, p) => n + (p.unreadDates || 0), 0);
      if (bad) lines.push(bad.toLocaleString('en-US') + (bad === 1 ? ' date' : ' dates') + ' not readable');
      const badQ = rows.filter(p => p.unreadQuarantine).length;
      if (badQ) lines.push(badQ.toLocaleString('en-US') + (badQ === 1 ? ' quarantine status' : ' quarantine statuses') + ' not read');
      const unlisted = unlistedLine(read.type, read.positives.concat(read.dropped || []));
      if (unlisted) lines.push(unlisted);
      const mixed = mixedLine(read.type, read.positives.concat(read.dropped || []));
      if (mixed) lines.push(mixed);
    }
    // The animals at the current positives are the Overview's own box (2.3), no longer a line here.
    if (g && g.undated.length) lines.push(g.undated.length.toLocaleString('en-US') + ' without a date');
    const dayNotKnown = g && today && win.end && win.end < today ? g.closedDayNotKnown.length : 0;
    if (dayNotKnown) lines.push(dayNotKnown.toLocaleString('en-US') + ' closed on a day not known');
    const quarantined = g ? g.stillQuarantined.length : 0, notKnown = g ? g.notKnown.length : 0;
    const past = !read ? { value: null, reason: 'Not available: needs the positives file' }
      : !g ? { value: null, reason: last.value === null ? last.reason : 'Not available: needs dates' }
        : { value: g.past.length, reason: null, quarantined, notKnown,
          note: !g.past.length ? null : (quarantined ? quarantined.toLocaleString('en-US') + ' still under quarantine' : 'none under quarantine')
            + (notKnown ? ', ' + notKnown.toLocaleString('en-US') + ' not known' : '') };
    // Detected ("Between dates"): every positive in the view, with its two parts for the bar under the number.
    const detected = !g ? { value: null, reason: past.reason }
      : { value: g.current.length + g.past.length, reason: null, active: g.current.length, closed: g.past.length };
    return {
      order: boxesOf(win),
      detected,
      positives: read ? { value: all.length, note: withZones === null || withZones === all.length ? null : withZones + ' with zones', lines }
        : { value: null, note: 'Not available: needs the positives file', lines },
      past,
      last,
      inside: insideBox
    };
  }

  // win: the date window; the positives inside it are listed (with the rows not mapped), each with its group on the
  // window's end date.
  function exportRows(read, targetList, result, unit, win) {
    const u = unit || 'km';
    const km = x => x === null || x === undefined ? null : round2(fromKm(x, u));
    const withZones = new Set((targetList || []).map(p => p.index));
    const end = win ? win.end : null;
    const listed = read.positives.filter(p => inWindow(p, win)).concat(read.dropped);
    const extra = listed.length ? details(read, listed[0]).map(pair => pair[0]) : [];
    const note = p => p.index === null ? 'Not mapped: ' + p.reason
      : { under: 'Still under quarantine', unknown: 'Quarantine not known' }[quarantineOf(read, p, end)] || '';
    const status = !!read.columns.quarantineStatus;
    const positives = { columns: ['Positive', 'Group', 'Status', 'Closed', 'Close Date', 'Quarantine Release']
      .concat(status ? ['Quarantine Status'] : [], ['Detection Date', 'County', 'Latitude', 'Longitude', 'Zones'], extra, ['Note']),
    rows: listed.map(p => [p.name, groupOf(p, end), p.status ? p.status.label : (p.statusText || ''),
      p.closed ? 'Yes' : 'No', p.closedDate || '', p.quarantine || ''].concat(status ? [p.quarantineStatusText || ''] : [], [
      p.detected || '', p.county || '',
      p.lat === null ? '' : p.lat, p.lon === null ? '' : p.lon, withZones.has(p.index) ? 'Yes' : 'No']
      .concat(details(read, p).map(pair => pair[1]), [note(p)]))) };
    const inside = { columns: ['Positive or zone', 'Layer', 'Site', 'Distance (' + UNITS[u].label + ')', 'Zone', 'County', 'Town'],
      rows: result.rows.map(r => [r.siteName, r.layerLabel, r.name, r.inZone ? '' : km(r.exactKm), r.zone, r.county || '', r.town || '']) };
    const zoneNames = result.layers.length ? result.layers[0].byZone.map(z => z.label) : [];
    const layers = { columns: ['Layer', 'Inside'].concat(zoneNames, ['Nearest', 'Nearest distance (' + UNITS[u].label + ')',
      'Nearest to', 'Left out']),
    rows: result.layers.map(s => [s.label, s.inside].concat(s.byZone.map(z => z.count),
      [s.nearest ? s.nearest.name : '', s.nearest ? km(s.nearest.exactKm) : '', s.nearest ? s.nearest.from : '', s.leftOut])) };
    const leftOut = { columns: ['Layer', 'Site', 'Reason', 'County', 'Town'],
      rows: result.leftOut.map(x => [x.layerLabel, x.name, x.reason, x.county || '', x.town || '']) };
    return { positives, inside, layers, leftOut };
  }


  // ---- The Overview (2.3) ----------------------------------------------------------------------------------------

  const OUTSIDE_WA = 'Outside Washington';

  // A positive's county: the file's County, written as one of the map's county names whatever its case, spacing or a
  // trailing "County" ("yakima", "Yakima County"), or else as written ("Umatilla (Oregon)"); a blank County, the
  // county its location falls in (the map's county shapes, each a GeoJSON Feature with properties.name), else the
  // nearest within NEAR_KM (a location geocoded just off the shore), else "Outside Washington". Kept per positive.
  const NEAR_KM = 2;
  const countyMemo = new WeakMap(), shapeMemo = new WeakMap();
  const countyKey = name => text(name).replace(/\s+/g, ' ').replace(/ county$/i, '').toLowerCase();
  function countyShapes(counties) {
    let c = shapeMemo.get(counties);
    if (!c) {
      const names = new Map(counties.map(f => [countyKey(f.properties.name), f.properties.name]));
      const rings = counties.map(f => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).flat());
      const boxes = rings.map(rs => { const pts = rs.flat();
        return [Math.min(...pts.map(q => q[0])), Math.min(...pts.map(q => q[1])), Math.max(...pts.map(q => q[0])), Math.max(...pts.map(q => q[1]))]; });
      c = { names, rings, boxes };
      shapeMemo.set(counties, c);
    }
    return c;
  }
  // The distance in km from a point to the nearest edge of a county's rings (a flat plane at the point's latitude).
  function edgeKm(lon, lat, rings) {
    const kx = 111.32 * Math.cos(lat * Math.PI / 180), ky = 110.574;
    let best = Infinity;
    for (const r of rings) {
      for (let i = 1; i < r.length; i++) {
        const ax = (r[i - 1][0] - lon) * kx, ay = (r[i - 1][1] - lat) * ky, bx = (r[i][0] - lon) * kx, by = (r[i][1] - lat) * ky;
        const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
        const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
        best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
      }
    }
    return best;
  }
  function countyOf(p, counties) {
    const list = counties || [];
    const kept = countyMemo.get(p);
    if (kept && kept.counties === list) return kept.name;
    const c = countyShapes(list), written = text(p.county);
    let name = written ? c.names.get(countyKey(written)) || written : null;
    if (!name) {
      const hit = list.find(f => P().inZone(p.lon, p.lat, f.geometry));
      if (hit) name = hit.properties.name;
    }
    if (!name) {
      const dLat = NEAR_KM / 110.574, dLon = NEAR_KM / (111.32 * Math.cos(p.lat * Math.PI / 180));
      let best = NEAR_KM;
      list.forEach((f, k) => {
        const b = c.boxes[k];
        if (p.lon < b[0] - dLon || p.lon > b[2] + dLon || p.lat < b[1] - dLat || p.lat > b[3] + dLat) return;
        const km = edgeKm(p.lon, p.lat, c.rings[k]);
        if (km <= best) { best = km; name = f.properties.name; }
      });
    }
    name = name || OUTSIDE_WA;
    countyMemo.set(p, { counties: list, name });
    return name;
  }
  const monthLabel = iso => MONTHS[+iso.slice(5, 7) - 1] + ' ' + iso.slice(0, 4);

  function countyRows(read, win, counties) {
    const g = groups(read, win), rows = new Map();
    const row = name => rows.get(name) || rows.set(name, { county: name, current: 0, past: 0, total: 0, list: [], kinds: {} }).get(name);
    const byKind = (r, p) => {
      const k = chartKindOf(read.type, p);
      r.kinds[k] = (r.kinds[k] || 0) + 1;
    };
    for (const p of g.current) {
      const r = row(countyOf(p, counties));
      r.current++;
      r.list.push(p);
      byKind(r, p);
    }
    for (const p of g.past) {
      const r = row(countyOf(p, counties));
      r.past++;
      byKind(r, p);
    }
    const out = [...rows.values()].map(r => {
      const a = read.columns.inventory ? animalTotals(read, r.list) : { totals: [], missing: 0 };
      return { county: r.county, current: r.current, past: r.past, total: r.current + r.past, kinds: r.kinds, animals: a.totals,
        animalsText: animalsText(a.totals), missing: a.missing };
    });
    return out.sort((a, b) => (a.county === OUTSIDE_WA) - (b.county === OUTSIDE_WA) || b.current - a.current ||
      b.total - a.total || (a.county < b.county ? -1 : a.county > b.county ? 1 : 0));
  }

  function positiveRows(read, win, counties) {
    const g = groups(read, win), c = read.columns, end = win ? win.end : null;
    const day = d => (d ? dayLabel(d) : '');
    const all = [
      [c.id || 'Positive', p => p.name, true],
      ['Detected', p => day(p.detected), !!c.detected],
      ['County', p => countyOf(p, counties), true],
      ['Flock size', p => p.size || '', !!c.inventory],
      [c.flockType, p => text(p.flockType), !!c.flockType],
      [c.species, p => text(p.species), !!c.species],
      [c.status, p => (p.status ? p.status.label : text(p.statusText)), !!c.status],
      ['Active or closed', p => groupOf(p, end), true],
      [c.quarantine, p => day(p.quarantine), !!c.quarantine],
      [c.quarantineStatus, p => text(p.quarantineStatusText), !!c.quarantineStatus]].filter(col => col[2]);
    const list = g.current.concat(g.past).sort((a, b) => (b.detected || '').localeCompare(a.detected || '') || a.line - b.line);
    return { columns: all.map(col => col[0]), rows: list.map(p => all.map(col => col[1](p))) };
  }

  // People inside the zones: each Census tract's people counted by the share of its area inside the zones, the people
  // taken as spread evenly over the tract; zones that overlap counted once. The share is measured with square cells
  // on one plane for all of Washington (longitude and latitude scaled to km at 47.3 degrees north, on CVI's sphere of
  // 6,378,137 m), a cell counting where its middle lies (inside the tract by its polygon; inside a zone by the shared
  // engine's distance, the edge counting, or the zone's polygon). Each tract has its own cells: 250 m, or smaller so
  // that a small tract holds about 2,500 of them. Only the part of the tract's box under the zones is covered, and the
  // share is the cells inside both over the tract's area on the same plane (at most 1).
  const PLANE_LAT = 47.3, CELL_KM = 0.25, TRACT_CELLS = 2500;
  const tractPrep = new WeakMap();
  function plane(px) {
    const ky = px.EARTH_RADIUS_M / 1000 * Math.PI / 180;
    return { kx: ky * Math.cos(PLANE_LAT * Math.PI / 180), ky };
  }
  // A tract's box, area on the plane and cell size, worked out once and kept with it.
  function preparedTract(t, px) {
    let prep = tractPrep.get(t);
    if (prep) return prep;
    const { kx, ky } = plane(px), box = [Infinity, Infinity, -Infinity, -Infinity];
    let area = 0;
    for (const polygon of t.coordinates) {
      polygon.forEach((ring, k) => {
        let twice = 0;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          twice += ring[j][0] * kx * ring[i][1] * ky - ring[i][0] * kx * ring[j][1] * ky;
          box[0] = Math.min(box[0], ring[i][0]);
          box[1] = Math.min(box[1], ring[i][1]);
          box[2] = Math.max(box[2], ring[i][0]);
          box[3] = Math.max(box[3], ring[i][1]);
        }
        area += (k === 0 ? 1 : -1) * Math.abs(twice) / 2;
      });
    }
    prep = { box, area, cell: Math.min(CELL_KM, Math.sqrt(area / TRACT_CELLS)),
      geometry: { type: 'MultiPolygon', coordinates: t.coordinates } };
    tractPrep.set(t, prep);
    return prep;
  }
  // A site's box in degrees: its zone's box, or its circle's (a little wide).
  function siteBox(site, ky) {
    if (site.zone) return site.zoneBox;
    const dLat = site.bufferKm / ky * 1.01;
    const far = Math.min(89, Math.abs(site.lat) + dLat);
    const dLon = site.bufferKm / (ky * Math.cos(far * Math.PI / 180)) * 1.01;
    return [site.lon - dLon, site.lat - dLat, site.lon + dLon, site.lat + dLat];
  }
  const overlaps = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
  const inBox = (lon, lat, b) => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];

  function peopleInside(sites, tracts, opts) {
    const o = opts || {};
    if (!sites || !sites.length) return null;
    const px = P(), { kx, ky } = plane(px);
    const boxes = sites.map(site => siteBox(site, ky));
    const all = [Math.min(...boxes.map(b => b[0])), Math.min(...boxes.map(b => b[1])), Math.max(...boxes.map(b => b[2])),
      Math.max(...boxes.map(b => b[3]))];
    const rows = [];
    for (const t of tracts) {
      const prep = preparedTract(t, px), tb = prep.box;
      if (!overlaps(tb, all)) continue;
      const near = boxes.map((b, k) => k).filter(k => overlaps(boxes[k], tb));
      if (!near.length) continue;
      const inside = (lon, lat) => near.some(k => {
        if (!inBox(lon, lat, boxes[k])) return false;
        const km = px.siteKm(lat, lon, sites[k]);
        return km !== null && km <= sites[k].bufferKm;
      });
      // The tract's cells under each zone's box, each counted once (zones' boxes overlap).
      const c = prep.cell, seen = new Set();
      let hits = 0;
      for (const k of near) {
        const b = [Math.max(tb[0], boxes[k][0]), Math.max(tb[1], boxes[k][1]), Math.min(tb[2], boxes[k][2]), Math.min(tb[3], boxes[k][3])];
        for (let i = Math.floor((b[0] - tb[0]) * kx / c); i <= Math.floor((b[2] - tb[0]) * kx / c); i++) {
          const lon = tb[0] + (i + 0.5) * c / kx;
          for (let j = Math.floor((b[1] - tb[1]) * ky / c); j <= Math.floor((b[3] - tb[1]) * ky / c); j++) {
            const at = i * 1e6 + j;
            if (seen.has(at)) continue;
            seen.add(at);
            const lat = tb[1] + (j + 0.5) * c / ky;
            if (inside(lon, lat) && px.inZone(lon, lat, prep.geometry)) hits++;
          }
        }
      }
      const share = Math.min(1, hits * c * c / prep.area);
      if (share > 0) rows.push({ geoid: t.geoid, pop: t.pop, share, people: t.pop * share });
    }
    const total = rows.reduce((sum, r) => sum + r.people, 0);
    return { total, rounded: roughly(total), year: o.year || null, tracts: rows,
      beyond: o.counties ? reachesPastWashington(sites, o.counties) : false };
  }
  // Whether a zone reaches into Oregon, Idaho or British Columbia, where the tracts (Washington's) count no one: a
  // point of its edge (a ring's 64 points, a zone's corners) outside every county shape and past one of the state's
  // land borders (north of 49 degrees, east of Idaho's line, or south toward the Columbia and Oregon), so a zone
  // that reaches only over Puget Sound or the ocean does not count.
  function reachesPastWashington(sites, counties) {
    const past = (lon, lat) => (lat > 49.0 || lon > -117.04 || (lat < 46.3 && lon > -124.0))
      && !counties.some(f => P().inZone(lon, lat, f.geometry));
    return sites.some(site => {
      if (site.zone) {
        const g = site.zone, polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
        return polys.some(poly => poly[0].some(q => past(q[0], q[1])));
      }
      for (let k = 0; k < 64; k++) {
        const [lon, lat] = P().destination(site.lat, site.lon, site.bufferKm, k * 360 / 64);
        if (past(lon, lat)) return true;
      }
      return past(site.lon, site.lat);
    });
  }
  // To three significant figures (12,437 -> 12,400); under 100 to the nearest whole person.
  function roughly(n) {
    if (n < 100) return Math.round(n);
    const step = Math.pow(10, Math.floor(Math.log10(n)) - 2);
    return Math.round(n / step) * step;
  }

  function overviewBoxes(read, win, counties, people) {
    const g = groups(read, win), cur = g.current;
    const named = list => {
      const set = new Set(list.map(p => countyOf(p, counties)));
      set.delete(OUTSIDE_WA);
      return set;
    };
    // Outside Washington: the active positives On a day; Between dates every positive detected, as the box counts.
    const outside = (win && win.view === 'range' ? cur.concat(g.past) : cur).filter(p => countyOf(p, counties) === OUTSIDE_WA).length;
    const all = named(cur.concat(g.past));
    const first = cur.concat(g.past).map(p => p.detected).filter(Boolean).sort()[0];
    const outsideNote = outside ? outside + ' outside Washington' : '';
    // "Between dates" counts the counties with a positive detected in the range, its note how many have an active one
    // ("n with an active one"); "On a day" the counties with an active positive on the day, as before.
    const countyBox = win && win.view === 'range'
      ? { value: all.size, reason: null, label: 'Counties with a positive detected',
        note: [named(cur).size + ' with an active one', outsideNote].filter(Boolean).join(' · ') }
      : { value: named(cur).size, reason: null, label: 'Counties with an active positive',
        note: [all.size + (all.size === 1 ? ' county' : ' counties') + (first ? ' since ' + monthLabel(first) : ''),
          outsideNote].filter(Boolean).join(' · ') };
    let animals;
    if (!read.columns.inventory) animals = { value: null, reason: 'Not available: needs ' + read.type.columns.inventory[0], note: null };
    else if (!cur.length) animals = { value: '0 ' + read.type.kinds[0].word, reason: null, note: null };
    else {
      // After the first, six named, or five and how many more.
      const a = animalTotals(read, cur), rest = a.totals.slice(1), cut = rest.length > 6;
      const note = [animalsText(cut ? rest.slice(0, 5) : rest) + (cut ? ' and ' + (rest.length - 5) + ' more' : ''), read.columns.flockType ? flockKinds(cur).map(kindText).join(', ') : '',
        a.missing ? a.missing + ' without a count' : ''].filter(Boolean).join(' · ') || null;
      animals = a.totals.length ? { value: animalsText(a.totals.slice(0, 1)), reason: null, note }
        : { value: null, reason: 'Not available: no animal counts at the active positives', note };
    }
    // Washington's tracts only: "Washington only" when a zone reaches past the state; zones wholly outside it are
    // not available, never zero.
    const peopleBox = !people ? { value: null, reason: 'Not available: needs zones', note: null }
      : people.beyond && !people.tracts.length ? { value: null, reason: 'Not available: the zones are outside Washington', note: null }
      : { value: people.rounded, reason: null, note: 'Estimate from ' + people.tracts.length.toLocaleString('en-US') +
        (people.tracts.length === 1 ? ' Census tract' : ' Census tracts') + (people.year ? ' (' + people.year + ')' : '') +
        (people.beyond ? ' · Washington only' : '') };
    return { counties: countyBox, animals, people: peopleBox };
  }

  // The two bar charts' rows: [{ label, parts: [{ key, value }], total }] by county (current, then past) and by layer
  // (one part per ring or zone, as the layer's byZone; its total the distinct sites inside, since a zone file's zones
  // can overlap).
  function overviewBars(rows, result, kinds) {
    const partsOf = r => (kinds ? kinds.map(k => ({ key: k, value: r.kinds[k] || 0 }))
      : [{ key: 'current', value: r.current }, { key: 'past', value: r.past }]);
    return {
      counties: rows.map(r => ({ label: r.county, parts: partsOf(r), total: r.total })),
      layers: !result ? [] : result.layers.map(l => ({ label: l.label, parts: l.byZone.map(z => ({ key: z.label, value: z.count, ring: !!z.ring })),
        total: l.inside }))
    };
  }

  // counties.csv: the counties table with each animal word's exact total at the active positives, in the type's
  // order of kinds, a kind's own species words by name ("Birds at the active positives", "Goats at the active
  // positives"), the mixed positives' last ("Animals of several kinds at the active positives"), and the active
  // positives without a count. A county without an active positive with a count has a
  // blank total, never zero for an unknown. Its words Active and Closed since 2.5.
  function countyTable(read, rows) {
    const forms = new Map();
    read.positives.forEach(p => {
      const k = kindOf(read.type, p);
      if (k.mixed) forms.set(MIXED_WORD, { named: MIXED_WORD, one: MIXED_ONE, index: read.type.kinds.length });
      else forms.set(k.named, { named: k.named, one: k.one, index: k.index });
    });
    const has = (a, f) => a[0] === f.named || a[0] === f.one;
    const words = [...forms.values()].sort((a, b) => a.index - b.index || (a.named < b.named ? -1 : a.named > b.named ? 1 : 0))
      .filter(f => rows.some(r => r.animals.some(a => has(a, f))));
    // A column named from a species as typed in the table gets the export's formula guard (an apostrophe before =, +,
    // -, @, a tab or a carriage return, as CVI's exports.js asText does for cells), so a spreadsheet opens it as text.
    const guarded = name => (/^[=+\-@\t\r]/.test(name) ? "'" + name : name);
    const columns = ['County', 'Active', 'Closed', 'Total']
      .concat(words.map(f => guarded(f.named.charAt(0).toUpperCase() + f.named.slice(1) + ' at the active positives')))
      .concat(read.columns.inventory ? ['Active positives without a count'] : []);
    return { columns, rows: rows.map(r => {
      const counted = r.current - r.missing > 0;
      const animals = words.map(f => {
        const hit = r.animals.find(a => has(a, f));
        return hit ? hit[1] : counted ? 0 : null;
      });
      return [r.county, r.current, r.past, r.total].concat(animals, read.columns.inventory ? [r.missing] : []);
    }) };
  }

  root.WSDA = root.WSDA || {};
  root.WSDA.emergencyRules = { readPositives, statusChoices, defaultTicks, targets, suggestedLayers, ringSites,
    zoneSites, bothSites, ringLabel,
    coarseReason, precisionRows, layersOf, inside, countLine, valueBoxes, exportRows, round2, dateOf, PRIVATE, COLUMNS, UNITS,
    PRECISION, toKm, fromKm, KM_PER_MILE, inventoryOf, sizeClass, windowOf, inWindow, isPast, closedDayNotKnown, quarantineOf, stillQuarantined, groups,
    groupOf, weekOf, dayLabel, playSteps, MAX_WEEKS, overTime, dayView, rangeView, openingViews, chartSpan, viewSteps,
    chartKindOf, chartKinds, SEVERAL, siteKey, layerSiteKey,
    pickColumn, boxesOf, viewBadge, periodLine, viewParams, bigNumber, inventoryWordOf, kindOf, kindKeysOf, pluralOf, ANIMAL_SHAPES, animalShapeOf, animalShapesOf, animalKeys, animalKindsOf, byAnimals, speciesList, animalsOnly, unlistedLine, mixedLine, numbersLine, notMappedLine, details, daysSince, byQuiet,
    zoneRows,
    zonesGeoJson, DRAW, areaM2, areaOf, areaText, lengthText, sidesMeet, crossesAt, isSimple, canClose, drawLabel,
    rectangleCorners, rectangleSize, rectangleLabel, KM_LAT, squareCorners, squareLabel, CIRCLE_SIDES, circleCorners,
    circleLabel, readSize, drawnZone, cornersOf,
    editedZone, shapeText, drawnName, zoneName, SHOWS, zoneSet, showOf, showAfter, zonesNamed, drawnParams, cviEnds, cviSpeciesIn, cviRows, CVI_ENDS, cviEndOf, flockKinds, animalTotals, animalsText, OUTSIDE_WA, NEAR_KM, countyOf, countyRows, positiveRows, CELL_KM,
    PLANE_LAT, TRACT_CELLS, peopleInside, reachesPastWashington, roughly, overviewBoxes, overviewBars, countyTable };
})(typeof window !== 'undefined' ? window : globalThis);
