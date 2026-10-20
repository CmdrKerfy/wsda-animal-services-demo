# Deliberate differences from CVI

Where the page differs from CVI's own app on purpose, and why.

The CVI Traceability dashboard follows CVI's own app (`CVI_Traceability`, its Shiny modules and the R functions behind
them) wherever it can, and its tests compare the page with CVI's functions run on the same synthetic files. Where the
page does something else on purpose, it is listed here with its reason. The first section lists CVI behaviors kept on
purpose even though they may look odd. New differences are added to the top of the second section. A copy for another host,
made with `publicCopy` set to true (`site/shared/release.js`), leaves out the CARTO and Esri basemaps and the Esri PNG
backgrounds this document mentions.

## Known CVI behaviors reproduced on purpose

- Missing or non-numeric animal counts are left out of totals (the page also says how many rows have one: see "Files
  as Excel and R write them" below).
- The live map's hover text is CVI's simple tooltip; the builder's species breakdown is computed but not shown
  (CVI replaces it in `.build_county_map`).
- R `format()` pads the amounts in one view to a common width and can switch to scientific notation
  (100,000 shows as `1e+05`).
- Without a `Species` column CVI ignores "Refine by species" and draws the whole species group; the page grays the
  control with the reason instead of offering it.
- Period modes: the slider starts at the middle period when a file loads, and a new step (Quarter/Year) moves it to
  the middle of that step's periods; entering Browse shows the period the slider is on (corrected wording); leaving
  Browse keeps the last period in the pickers; Play stops as it reaches the last period and starts again at the first
  from there; Reset All sets Single period and the right map's pickers but keeps the slider position, its step and the
  speed. Each Compare map is scaled on its own data; the boxes and strip follow the left map. With the arrow keys,
  going from Single to Compare passes through Browse, which puts the slider's period on the left map (CVI's radio
  buttons most likely the same).
- Compare: the left map's "Refine by species" does not reach the right map; the right map shows the whole shared
  Species Group unless "Use different species on right map" is ticked (CVI). The page says so in a line under the maps
  while a left refine is in use, and the note in the right map's block says the refine is not shared.
- National Flow: the corridor uses the two states only (the `Movement` column is not read), compared exactly (a
  lowercase `wa` is a partner state with no center and is dropped); lines start at Washington's fixed point (−120.5,
  47.5); Alaska and Hawaii get lines but no outline or label; a state without a center (foreign or blank codes) gets no
  line but its rows still count in the value boxes, so Total animals and the strip's Animals can differ (as CVI); the
  strip's message when nothing is drawn is the single line "No records match current filters." (no diagnostic, as
  CVI's Flow branch); the warning "No records match current flow map filters." when every picker has a value and no
  line results.
- County Focus: a premises whose rows have no CVI number counts it as one certificate in its hover ("CVIs: 1"), as
  R's `n_distinct` counts a missing value, while the view's Unique CVIs box counts only CVI numbers that are there.
- Fractional animal counts: R sums them in long double on x86-64 (e.g. CVI on a Windows PC), the browser in double, so
  a total with fractions could differ in its last bit there (not seen on an arm64 Mac, where R also sums in
  double; synthetic fixtures use exactly representable fractions only; not verified on Windows).

## Deliberate differences from CVI

- **Plainer words, and easier to read with any eyesight (version 1.1):** first-time users and reviewers of
  version 1.0 misread a few labels, and some states were shown by color or faint gray alone.
  - County Focus's strip names its number "Animals at mapped premises" (CVI: "Animals"). The branded PNG keeps CVI's
    words ("Last Updated:", "Data Range" by month and year, "Premises"), the agency's preferred names.
  - When the ticks skip a year the file holds, or a quarter, the PNG's bold period line lists them as runs ("CY 2024,
    2026:", "Q1, Q3 – Q4"; CVI: "CY 2024–2026:" and "Q1 – Q4", as if the ones between were in), as do the Preview
    Stats "Years:" line and a chart's caption. A year with no records in the file is not a skip. With nothing skipped
    the line reads as CVI's. Data Range, the export file names and the live strip keep CVI's form;
    `export_params.json` already lists every year and quarter.
  - Pictures made from the synthetic sample (a `bundle.json` with `"synthetic": true`) say "Synthetic sample data" at
    the bottom right of the map area, and their `export_params.json` has `"data_note": "Synthetic sample data"`.
  - Every `export_params.json` names its coordinate system (`"coordinates"`), and Premise Lookup's also its distance
    method (`"distances"`). Premise Lookup's facilities CSV, the page's own file, writes a missing value as an empty
    cell, so GIS software reads its number columns as numbers; the matched-rows CSV keeps CVI's `NA`.
  - The camera button names its picture by day, view and kind (`2026-10-19_CountyFocus_map.png`; CVI:
    `map-screenshot.png` every time), and its message says the picture shows locations, to be handled as sensitive.
  - Every live map has a scale bar in miles (CVI's have none). Each map's circles have a thin dark edge outside the
    white one, so light circles stand out from a light map; the PNG keeps CVI's look. The WA State legend says
    "Inbound left, Outbound right" when both directions are drawn side by side.
  - Export & Preview ticks "Branded map (.png)" when the page opens (CVI: unticked), so an export holds a map unless
    it is unticked.
  - County Focus with no county ticked says "Tick a county under Focus county / counties to see its numbers." (CVI:
    "Load a master and apply filters to see summary metrics.", which read as if the data had not arrived), and a
    type-to-find field narrows its county list.
  - A value box that is zero or not available, faded as in CVI, also says why ("none for these filters", "Not
    available: …").
  - The legend's decimals: when two class labels would read the same, only those labels get extra digits, at most
    two (the page gave every label up to four).
  - Below 768 px wide (and at 400% zoom) the sidebar stacks above the maps (CVI's sidebar stays beside them).

- **Files as Excel and R write them:** the page says more than CVI's app when a file may be read differently than
  meant, and guards its CSV exports.
  - "Master loaded" ends with "N rows have no readable animal count." when some counts are empty or text such as
    "1,200" (as Excel saves a number with a thousands comma) or "12 head"; those rows add no animals, as in CVI, which
    says nothing about them. Infrastructure's note for an optional master says the same.
  - A file read with the replacement character "�" (not saved as UTF-8, for example Excel's plain "CSV") gets "This
    file may not be UTF-8: in Excel, use Save As, then CSV UTF-8." in the master status (yellow), and a facility file
    is named in the facilities notice the same way. CVI reads such files without a word.
  - A master whose required column is written twice is refused, naming the column. CVI's reader uses the first copy,
    while the page read the last one, so the two could show different numbers.
  - Text a spreadsheet would run as a formula (starting with `=`, `+`, `-`, `@`, a tab or a carriage return) gets an
    apostrophe in front in the text columns of every CSV the page writes: `filtered_rows.csv`, `summary_table.csv`
    (its county, state, species group, city and premises id are the master's own text), Premise Lookup's matched-rows
    CSV (with `matched_sites`) and its facilities CSV. Numbers never change: columns read as numbers, negative
    longitudes included, and a plain number in a text column ("-120.51" beside an "N/A"). CVI's CSVs write such text
    as it is.
  - `filtered_rows.csv` leaves out a column without a name (the row numbers R writes as a first, unnamed column); CVI's
    export keeps it.
  - "Total animals"'s help says that a record repeated exactly in the file counts each time, while CVI's own app
    counts a repeated WA-to-WA record once (the merge rule itself is described under "Premise Lookup" below).
- **County Focus grouping and National Flow's Top 5:** County Focus Style has a "Group nearby premises" checkbox, on
  by default as CVI's clusters (off: every premises at its own size at any zoom, on the live map only; the PNG and the
  GIF keep their grouping); while grouped, the legend says the numbered bubbles keep one size. CVI has no such switch.
  The National Flow PNG and GIF show a Top 5 States box sized to its rows (CVI: a Top 3 over a taller box), CVI's top 3
  first; the map's white bold names and badges mark the five.
- **Messages in plain words:** CVI's two messages that name steps of its own R pipeline say instead what is missing and
  where to get it: a master missing a required column, "Master CSV missing the column Dest.County.Long. Ask for a CVI
  master table with all 13 required columns (listed under "What data does this need?" on the landing page)." (CVI:
  "… Re-run Steps 3-5 on this data first."); County Focus's Preview Map and Export without premises coordinates, "…
  which this master file does not have. Ask for a CVI master table that includes them, then load it again." (CVI: "…
  Re-run Assign County Locations, Generate County Map Points, and Generate State Flow Lines on this data first, then
  reload it here."). Map failure messages say "The browser could not …" (CVI's page said "Chrome"). Premise Lookup's
  sensitive-data warning uses a colon where CVI's has a hyphen ("coordinates: handle as sensitive data"). A manifest
  color the browser cannot read (CVI passes it to the map as written) is replaced by an automatic color with a note in
  the checklist.
- **Alaska and Hawaii on National Flow (in both the Lines and the Shaded states view):** CVI draws neither state (its
  lines to them leave the frame unnamed). The page draws each in an inset box (`app/flowinsets.js`,
  `geo/us-insets.js`) while it has movements in the view (a GIF: in any frame), both boxes the same height, each as
  wide as its outline, with the state's name and animals. On the live map they sit at the top left beside the zoom
  buttons; on the PNG and GIF at the top left under the stat row. Shaded states: each outline in its class color (the
  classes already counted them). Lines: each line to Alaska or Hawaii runs straight from Washington's anchor to the
  state's center in its box (on the live map it follows Washington as the map moves and is drawn above the other
  lines); hover, the screenshot, a chart pick and a Top 3 badge (PNG) treat them as any state.

- **Help notes, Preview Stats, the glossary and the banner:** the "?" help notes are reworded in the brand guide's
  voice (direct and short, no capitals for emphasis, no shorthand), the facts unchanged; CVI's wording where they came
  from CVI is not kept (the palette sentence and the National Flow wording written for this page are). Preview Stats
  writes the quarters "Q1, Q2, Q3, Q4" (CVI: "Q1Q2Q3Q4") and adds, after CVI's totals, "Unique CVIs", a note when
  WA-to-WA movements are counted at both ends, and a "CHANGE FROM THE PREVIOUS QUARTER" block (animals and Unique CVIs
  in the two quarters the "Emerging vs cooling" chart compares, following its "Compare with"; National Flow the
  previous quarter). Every page's footer has a closed "Terms used on these pages" glossary (CVI, Premises, WA-to-WA,
  Bundle; `WSDA.brand.GLOSSARY`). Also: a chart's value axis keeps its last label inside the picture (the plot is made
  narrower; ggplot2, and so CVI's charts, can let it run past the edge), on the page and in the exported charts; WA
  State's Circle size scaling and Number of bins have "?" notes as in CVI (and the Infrastructure dashboard's CVI
  activity scaling), the scaling notes describing each option; the footers' data sources and credits sit in a closed
  "Data sources and credits" fold. The banner reads "Animal Services Division · Visualization Platform" (was "WSDA
  Visualization Platform"), the tab titles "<dashboard> — WSDA Animal Services", and each page's tab icon is WSDA's
  own site icon from agr.wa.gov (`WSDA.brand.FAVICON`, `setFavicon()`; `site/PROVENANCE.md`).

- **Facility marks, icons, tables and the Premise Lookup marker:** facility layers are drawn as marks, a shape and a
  color per layer, on the live maps, the PNGs, the legends, the layer lists and Infrastructure's count cards (CVI: a
  circle per layer, told apart by color only). Built-in layers: Packing Plants square, Livestock Markets diamond,
  Feedlots triangle, Restricted Holding Facilities downward triangle, Fairgrounds star. Feedlots are the guide's Blue
  Green `#0094aa` (CVI: `#0097a7`). Layers added without a color take a free pair from ten shapes and six guide colors
  (Dark Blue, Evergreen, Gold, Grass Green, Black, Crimson) instead of CVI's color pool; a manifest's own color is
  kept. Clusters stay circles. The Facilities PNG's legend says "mark size = facilities in county" (CVI: "circle
  size"). Reset All reads "Reset All" on every dashboard (CVI: "Reset All Filters"). Buttons carry Bootstrap icons
  where CVI's carry Font Awesome ones. Each chart offers "Show as table" (not in CVI). Premise Lookup draws each query
  site as a bullseye (a white-centered red ring with a red dot) on the PNG's map, key and inset and on the live map
  (CVI: a red triangle, which looked like Restricted Holding Facilities' mark). When its PNG key's facility rows would
  be drawn under 60% of their height, the key lists the layers with the most facilities and "and N more layers (see
  the facilities CSV)" (CVI draws every row closer). In a County Focus PNG whose legend box is too short, the grouping
  note is one line ("248 premises in 12 grouped circles"; CVI: three lines).

- **Premise Lookup: the tab, the sites and the match map:** the tab is a "Maps / Premise Lookup" switch at the top of
  the CVI page's sidebar, using the master loaded there (CVI: its own tab).
  - Within-state rows merge as on the rest of the page: only the loader's Inbound and Outbound copies of one row
    merge, so a row the file repeats exactly counts each time (CVI's `dedupe_intrastate_volume` counts it once).
  - CVI's notifications are lines under the button that caused them (Add site, the paste and upload box, Run query),
    with CVI's words; they stay until that button is used again. Run query's lines are the exception: they show only
    at the top of the result area, above the five boxes (under the button they were out of view, and a copy in both
    places was redundant).
  - The match map's buffer rings are WSDA Gold #fcb614 inside, then a light green #8fc965, then WSDA Light Blue
    #a7d7e2, with a fill of 0.35 and 2 px outlines; CVI draws three grays (0.22, 1.5 px), which were too alike to
    tell apart.
  - A cell opens for editing on a double-click, as CVI's table, and also on a second click on the same cell within
    600 ms (Safari counted a slightly slow or moved double-click as two clicks).
  - Run query is grayed with its reason, under it and in the result area, while no master is loaded or the master
    has no premises coordinates (Origin.Lat, Origin.Long, Dest.Lat, Dest.Long; the Partner and Public tiers). CVI
    runs and then says "Master is missing required coord columns".
  - An empty default buffer (Single buffer) stops the run with "Enter a default buffer (km)." CVI runs, and a site
    without its own buffer matches nothing.
  - A new master clears the result on screen (CVI keeps the old one until the next run). The sites stay, as in CVI.
  - The sites table sits above the results (CVI: in the same column as the inputs); an edited cell keeps the table's
    page and selection (CVI's table redraws on page one). Filters with nothing ticked mean every value, as CVI's
    empty pickers.
  - The match map is the page's offline county map, no request (CVI: CARTO Positron tiles). Its view keeps the sites
    clear of the zoom, fit and screenshot buttons; a county name that would cover a site or a matched point is
    hidden (also in the screenshot), as CVI's basemap names lie under its points.
  - A pasted line with fewer than three parts counts in "Skipped N unparseable line(s)." (CVI leaves it out without
    counting it).
  - No "Lookup mode" choice: CVI's Premise Type mode is shown as coming soon in CVI and is not built here. The street
    address lookup is offline (below).
- **Premise Lookup: zones, facilities inside, places, picking on the map and the export:** additions CVI does not
  have, and the export.
  - Zones: "Zones from a file (polygons)" reads GeoJSON, KML or a zipped shapefile in longitude and latitude in the
    browser (nothing is sent). A shapefile needs a .prj saying WGS 84 or NAD 83 longitude and latitude; a projected or
    other system, or no .prj, is refused with a message (converting needs a projection library), and so is a KMZ (with
    "unzip it"). Each polygon becomes a site: its name can be edited, its point (inside the polygon) and "Zone" cells
    are fixed. A CVI endpoint or facility matches when it lies inside the polygon (holes are outside); it is 0 km away
    and in ring 0, so `nearest_site_km` and `nearest_band_km` read 0. At most 1,000 zones and 500,000 outline points
    per file, files up to 64 MB and a .shp up to 16 MB (refused before reading); damaged files are refused with a
    message. A shapefile hole goes to the smallest outline that holds most of its corners; a polygon with a broken
    hole, or an outline with no area, is left out and counted. Known limits: the same file loaded twice adds its zones
    twice (as pasting rows twice); how far a KML file's XML entities expand depends on the browser's XML reader.
  - Facilities inside: "Facilities inside" in the sidebar lists the facility files the page holds (from the
    hand-off), picked as on the Infrastructure dashboard (every usable layer ticked at first; attribute filters). Run
    query adds, per site, the facilities of the ticked layers inside its buffer or zone: a counts table, a list with
    distance and ring, and their dots on the match map. With no usable master (none loaded, or the Partner or Public
    tier) and a layer ticked, Run query stays on and checks the facilities only, saying why the CVI match is grayed
    (not while a master is still loading). When the filters match no CVI, the facilities inside still show (CVI
    clears the result).
  - The sites table has a Place column: the city (WA Department of Revenue limits) or census-designated place
    ("<name> CDP") holding the site, "Outside city limits", or "Outside Washington".
  - Pick on map: the button shows the match map (before a run, with the sites so far); a click fills in Add a site's
    latitude and longitude (5 decimals) and marks the spot; Add site adds it with its usual checks and ends picking
    (so does Escape or the button again).
  - The match map has a small legend in its bottom left corner: the sites, origins and destinations drawn, each
    facility layer with its count, each ring radius in its color, zones. It is in the screenshot too, and a county
    name under it is hidden. CVI's match map has none.
  - Export: one ZIP, `premise_lookup_<date>.zip`, with a folder of the same name holding the ticked files and
    `export_params.json` (new); CVI has separate buttons. "Matched CVIs (.csv)" is CVI's Export CSV file (`premise_lookup_matches_<date>.csv`,
    R's write.csv: every column of the matched rows, the engine's five added), with the formula guard of "Files as
    Excel and R write them" above;
    "Facilities inside (.csv)" is new (`premise_lookup_facilities_<date>.csv`). No GeoPackage. CVI's sensitive-data
    warning is beside the button. Known limits: a date-time column in the master is written as its text (CVI writes
    it in the computer's time zone); the text "NaN" in one of the loader's number columns is written NA (R reads it
    as NaN, and its write.csv writes NaN as NA as well, so the files agree).
- **Premise Lookup: the branded proximity PNG and the population layers:**
  - The PNG is CVI's `render_branded_proximity_map` page on the branded PNG frame: the title ("PREMISE PROXIMITY
    ASSESSMENT - <species> - <n> SITES"), "Endpoint: …", the period, the Sites / CVIs / Animals boxes, the QUERY SITES
    panel (CVI's rows, sizes, cuts, "+N more sites" and footer), the MAP KEY over the scale bar, the WA inset with the
    sites, the map fitted to the buffers (10% around them, at least 0.15 degrees). "Preview branded map" shows it in a
    dialog; the Export ZIP holds it as `premise_proximity_<date>.png` (CVI's name) when "Branded map (.png)" is ticked
    (ticked at first). Under "Branded map options": the basemap (Streets, CVI's default; Default, CVI's "Flat WSDA";
    the page's three Esri backgrounds; CVI's "Live tiles", CARTO, is not offered, as it needs another host), Export
    quality for a tile background, PNG resolution (Standard 200 dpi, as CVI; High 300 dpi) and CVI's "Show facility
    labels". `export_params.json` adds `png_background`, `export_quality` (tile backgrounds), `png_resolution`,
    `facility_labels_on_png` and, with a layer drawn, `population_layers` and `population_sources`.
  - The rings are in the same three colors as on the match map (CVI: three grays). Where CVI's key would name colors
    the rings do not have (sites with different bands: "Inner / Middle / Outer zone"; several single buffers: one
    "Search buffer"), the key lists each radius drawn ("Within 10 km") in its color.
  - Facilities: the layers ticked under "Facilities inside" (no second layer list), only the facilities inside a
    buffer or zone, as County Focus's circles, the key's rows reading "Feedlots: 4 inside" (CVI: every facility of
    its own list in view, as shapes).
  - A run with no CVI match (facilities only, or no CVI matching the filters while facilities are inside) has its own
    page: "FACILITY PROXIMITY ASSESSMENT - <n> SITES", boxes Sites / Facilities / Layers, the panel's column
    "Facilities" and footer counting the facilities inside.
  - Zones: drawn as their polygons in the inner color; the panel says "Zone", the key "Zone (from file)" (CVI has no
    zones).
  - Site names sit beside their markers, clear of the other marks (CVI centers them on the triangle); CVI's style keeps
    CVI's place.
  - The QUERY SITES panel: at most 8 sites, the most matches first (facilities inside on a facilities-only page; ties
    in table order), every name at one size, a name too wide for the column cut with "…", and a note such as "6 more
    sites not listed (ranked by matches)" on its own line (CVI: up to 12 rows in table order, long names shrunk, "+N
    more sites" over the last row).
  - The WA inset shows only the sites inside its Washington frame, as CVI's (a site in Oregon would otherwise fall
    below the inset, onto the source line); the main map shows every site.
  - The WA inset goes to the first map corner (bottom right, bottom left, top left, top right) that covers no site,
    matched point, facility or site or facility name; with none clear, the one covering the fewest (CVI: always the
    bottom right). The population corner box avoids it.
  - The MAP KEY's rows are packed at their own spacing (CVI spreads them over a fixed box); a long label wraps onto up
    to three lines inside the box (CVI's run past it).
  - Also: facilities are drawn over the site triangles, on the PNG and the live map, so a facility at a site shows as
    a dot on it (CVI draws the sites on top); on the Satellite PNG the site names are light on a dark halo; the live
    map has a basemap choice ("Map Style", the Maps side's list and request gate; CVI's match map uses CARTO Positron,
    fetched always); "Also one PNG per county" (off at first) adds a page per county holding a site, framed on the
    county as County Focus with Streets, listing and counting only that county's sites (the query or the facilities
    inside run again for them), named `premise_proximity_<date>_<County>.png` and listed in `export_params.json` as
    `county_pngs`; a site outside Washington's county shapes (at sea, or on a shoreline outside them) has no county
    page. The zone file picker accepts .kmz so the page can say to unzip it.
  - Population context: Premise Lookup has its own three switches (City limits, Population centers, Population
    density) in its "Map Style" section, all on when the page opens and apart from the Maps side's (their files load
    when Premise Lookup is first shown). They draw on the match map (with a "Population context" block in its legend
    and screenshot, hover as on the other maps) and on the PNG (under the rings; the key's block, or a corner box when
    the key is full; their credits in the source line). Names: every city and place in view on a map under 100 km
    across, else places of 10,000 people or more (County Focus's and WA State's rules).
  - Known limit, as in CVI: rings of a few kilometers and small zones are hard to see on a map that spans the state.
- **Premise Lookup: the address lookup:** "Find coordinates" looks a typed address up only in a geocode cache file the
  user loads ("Geocode cache file", CVI's columns `address, lat, long`, such as CVI's `registry/geocode_cache.csv`);
  the file is read in the browser and nothing is sent anywhere. CVI looks in its registry's cache file, then asks the
  US Census geocoder and OpenStreetMap's Nominatim over the network.
  - CVI's rules for the file: addresses compared trimmed, without surrounding quotes, with white space joined and in
    lower case; the first row with usable coordinates wins (latitude -90 to 90, longitude -180 to 180); the boxes get
    the coordinates rounded to 6 decimals; CVI's messages for an empty box ("Enter a street address first.") and a hit
    ("Resolved to: … (source: saved cache). Review, then Add site."). Add site clears the address and its message.
  - Where CVI would go online, the page says "No match for that address in the geocode cache file. Enter lat/long
    manually." (a file loaded) or "Load a geocode cache file to look up addresses, or enter lat/long manually." (none);
    CVI says "Could not resolve that address (service unreachable or no match). Enter lat/long manually."
  - A file without the three columns, an empty file or one with no rows is refused when picked, with its reason
    (CVI's lookup quietly finds nothing in it); the file loaded before stays in use. The load message counts the rows
    and those without an address or usable coordinates.
  - "Find coordinates" has no magnifier icon (CVI's `search` icon is not in the page's icon set). The page's CSV
    reader trims spaces around an unquoted cell, so a matched address shows without them (CVI's read.csv keeps them;
    the match itself is the same).
  - Where the page reads a cache file more kindly than CVI's `read.csv`: a UTF-8 byte order mark (Excel's "CSV UTF-8")
    is dropped (in CVI the first column becomes `X.address` and nothing matches); spaces around an unquoted column
    name are trimmed (CVI: `X.lat`); a cell that is not UTF-8 spoils only its own row (in CVI `tolower` fails for the
    whole column). The page joins only ASCII white space; Unicode spaces and letters such as "İ" may compare
    differently from R. Rounding to 6 decimals is pinned against CVI's module on a seventh-decimal half (fixtures, "5
    Half Way").
  - Also: a cache file over 32 MB is refused before it is read; "Reading <file>…" shows while it loads (Find
    coordinates then says so), and only the latest pick is used; blank lines are not counted; a UTF-16 file is refused
    for its encoding; text that is not UTF-8, and a quote mark never closed, add a warning line.
- **Premise Lookup: robustness and output details:** fixes that change no output: zone outlines of any allowed size,
  many facilities in one buffer and a run line if the facilities step fails, the PNG's name placer and name cuts much
  faster with the same results (the placer's places checked against the old plain search), detailed holes, side files
  of a zipped shapefile size-checked before unpacking (.prj and .cpg 64 KB, .dbf 32 MB), `export_params.json` from the
  sites as run, spell check and autocomplete off on the typed boxes so no browser spelling service sees an address,
  bidirectional controls dropped from names on the PNGs. Changes that show:
  - The facilities CSV (the page's own file) writes text starting with `=`, `+`, `-`, `@`, a tab or a carriage
    return with an apostrophe in front, so a spreadsheet opens it as text; the matched-rows CSV stays exactly CVI's.
  - The per-site facility counts (the counts table, the PNG's panel) count a facility listed twice in a file once,
    as the run's line and the PNG's boxes do; the CSV still lists every line of the file.
  - The QUERY SITES note reads "N more sites not listed (ranked by matches)" (or "by facilities inside"), true also
    when the sites left out tie with listed ones.
  - `export_params.json`: `png_background` is the background chosen, also when a notice says Default was drawn;
    `formats` lists `branded_png` also when the page could not be drawn (an error line says so); a single site,
    layer, population layer or county is written as a string and several as a list (jsonlite's auto_unbox), as on the
    Maps side.
  - Known limit: the rings have three colors, so with more than three different radii (Single buffer, per-site
    buffers) the outer rings share Light Blue and the key shows those rows in one color.
- **Population context:** CVI has none of these layers, and all three are off unless the user turns one on, so CVI's
  style and the page's other outputs are unchanged by default.
  - City limits from the WA Department of Revenue, with the 2020 Census population joined by place code.
  - Population centers, the 2020 Census places, census-designated places dashed; with city limits on, the
    census-designated places only, trimmed to outside current city limits.
  - Population density by 2020 Census tract in six fixed classes, one lavender ramp at 65%.
  - The source line adds "City limits: WA Department of Revenue" and "Population: U.S. Census Bureau, 2020 Census"
    when their layers are drawn.
  - "POPULATION CONTEXT" rows at the legend's foot. When they do not fit, each section's size samples go side by side,
    and if they still do not fit the rows go into a box over a corner of the map.
  - Place names (2020 Census spelling) may go over the circles, on top with their halo, never over another name.
  - The rule that keeps map names off circles changed: a county name stays in its county. It takes (a) a free spot
    inside, (b) a spot inside over its own circles, else the one covering the least of a neighbor's circles, (c) a
    free spot outside only when (a) and (b) have no room, (d) the least crowded spot. A grid of spots across the
    county follows the spots near its circles.
- **Branded PNGs and the time-series GIF:**
  - Every page: drawn as vector SVG from the page's own geometry and numbers, not a copy of the live map (sharp at
    any resolution); Web Mercator for all four maps (CVI draws three in longitude/latitude); the agency name
    "WASHINGTON STATE DEPARTMENT OF AGRICULTURE" above "ANIMAL SERVICES"; darker small grays; WSDA Dark Blue for the
    County Focus inset's focus counties; a failed background falls back to Default with a notice (CVI is silent); in
    Compare two PNGs, `…_left.png` and `…_right.png`; "PNG resolution" Standard or High (300 dpi) for the map and the
    charts; legend samples spaced by their size; more room between the logo and the title; the County Focus grouping
    note inside the legend; County Focus groups at their animal-weighted center; a species color key on the National
    Flow legend and its line widths as the map draws them; near-black map names, names kept off circles where a free
    place exists, a legend line naming the sizing, a source line on every page. What the screen adds since CVI is
    drawn too: the movement view, the spotlight, neighboring regions, chart filters (named in a "Highlighted:" line).
  - Facilities (the Infrastructure dashboard): the Report caption names a period only with CVI activity drawn; a
    Density map whose counties all have one count draws one class (CVI writes no PNG); Density classes labeled by the
    counts they hold; CVI activity circles in the dashboard's palette; the town column kept for a lone town-level
    facility's name (as CVI). Also: the Locations "Cluster size" legend shows every circle size drawn, labeled by the
    counts it holds (CVI labels rounded in-between breaks and drops repeats, so with counts 1 and 2 its one entry
    reads "2" beside the smallest circle); each size drawn by its largest count, area in proportion, 15 for the
    largest and never below 3 (CVI's even steps from 3 to 15); "Density (choropleth)" grayed with the reason while it
    cannot apply (more than one layer shown, or CVI activity on), the pick coming back when it can (CVI keeps it
    clickable and shows its fallback notice after Preview).
  - The GIF (National Flow): the page's own GIF writer, no library (CVI needs the R package `gifski`, else it writes
    the first frame as a PNG under the `.gif` name); frames use the view's settings (CVI's use its defaults: opacity
    0.85, width 1.0, fixed tiers, state lines on, and a title listing the species where the PNG says "ALL SPECIES");
    one legend and width scale over all frames; a period strip under the map, the current frame marked; the last
    frame held 2.4 s; progress "GIF frame 3 of 8: 2024-Q3" with Cancel (CVI: its progress bar); the progress counts
    the frames drawn, not the empty periods CVI also counts; `export_params.json` adds `"gif_frame_interval"` before
    `"exported_at"` (an addition).
  - The GIF on WA State and County Focus (CVI makes no GIF for these views): the same box, interval, size, timing,
    progress and Cancel as National Flow, each frame the view's branded PNG for its period, with: one scale across
    frames (WA State sizes every frame's county totals together, each direction apart as the live map; County Focus
    groups every frame's premises with one distance and sizes every frame's groups together) and one legend; names
    placed once around every frame's circles and held still, a frame naming only its own counties; the period strip
    with the map fitted above it (on County Focus keeping off the WA inset); County Focus's legend laid out the
    same in every frame; grayed with the reason while the movement lines are on or the CVI circles are hidden; in
    Compare the left map; a tile background stays with the PNG and the GIF uses Default, with a notice; Streets
    works. File names `CVI_County_Map_TimeSeries_{years}_{INB+OUT}.gif` and
    `CVI_CountyFocus_TimeSeries_{directions}_{counties}_{years}.gif`.
  - County Focus's WA inset (CVI always draws it at the bottom right): on the PNG and every GIF frame it goes to the
    first map corner (bottom right, bottom left, top left, top right) that covers no focus-county land, circle,
    facility marker or name, else the corner covering the fewest circles, markers and names, then the least land, as
    Premise Lookup's inset does; the population rows' corner box keeps off it. CVI's style (`BR.CVI_STYLE`) keeps the
    bottom right. On `tier_full`, 9 of the 39 single counties move (Asotin, Grays Harbor, Kittitas, Lincoln, Okanogan,
    Wahkiakum, Walla Walla, Whitman, Yakima), each to a corner clear of land.
  - White map lines on the County Focus PNG (CVI draws gray): on the Default background the land's outline and the
    lines between focus counties are white, as the WA State, National Flow and Infrastructure PNGs already draw them;
    Streets keeps the gray lines (white would vanish on its near-white land); Premise Lookup's PNG and the live maps
    are unchanged.
- **Shaded counties and states (not in CVI):**
  - WA State's "Show counties as: Circles · Shaded counties" (Circles the default and unchanged): each county filled
    by its animals for the view's filters and period, both directions ticked giving the Combined total; "Measure"
    Total animals (default) or Animals per square mile (the county's 2020 Census land area); "Shading classes"
    Natural breaks (default) or Quantile with "Number of bins" (at most 5: more would put neighboring colors too
    close to tell apart); "Fill opacity" 80% by default. While shaded, the smooth scalings, bins over 5, Display
    Mode, Color palette and Population density are grayed with their reasons; the movement lines take over as they
    do from the circles, the switch grayed with its reason and the choice kept. Spotlight dims the other counties and
    outlines the spotlit ones; hover gives the county's animals (and per square mile).
  - National Flow's "Show states as: Lines · Shaded states": each state filled by its animals moved with Washington
    (species added together; Direction picks the ramp), states with none in plain land gray, Washington white with a
    dark outline (the hub); no lines while shaded; Line width, Color palette and Combine species grayed with their
    reasons; a state picked in a chart outlined with the others dimmed; hover gives the state's total and species.
  - Colors: ColorBrewer 2.0's Blues (Inbound), Oranges (Outbound) and GnBu (Combined) without their near-white
    classes (`site/PROVENANCE.md`); white county and state lines on the shaded maps (on the live map while the Boundary
    style is Auto); "No movements" a light hatch on WA counties.
  - Compare's two maps share one set of classes, from both maps' values, and one legend (the circles keep CVI's
    sizing per map). The GIF uses one set of classes from every frame's values and one legend, every county named in
    the same place in every frame. The branded PNG and the GIF draw the same kind of fills and legend; their classes
    differ (the PNG's come from the whole view, the GIF's from each frame's own values).
  - The branded PNG's shaded legend is as tall as its rows, and WA State's Top 3 box with one list is half as tall
    in the page's style (`compactTop`), on the circles' PNG too.
  - `export_params.json` adds `"map_style": "shaded"`, `"shade_measure"`, `"shade_classes"`, `"shade_class_count"` and
    `"shade_breaks"` before `"exported_at"` while the map is shaded, whatever the export holds (additions; nothing
    added with circles or lines). With the GIF in the export, `"gif_shade_class_count"` and `"gif_shade_breaks"` give
    the GIF's classes; with the GIF and no PNG, `"shade_class_count"` and `"shade_breaks"` are the GIF's themselves.
    The strip's "Mode" reads "Shaded counties".
- **Charts, previews and exports:**
  - Rows: every file, chart and preview uses the rows the map draws: "Refine by species" applies everywhere, and
    National Flow Combined leaves out WA-to-WA rows, where CVI's files and previews do not always.
    `summary_table.csv` leaves out Flow's `line_width_px`, so it holds what Preview Map Data shows.
  - One ZIP download per Export click, with CVI's folder and files inside; no `_002` numbering (the browser numbers a
    repeated name); "Exports this session" in place of "Recent exports"; messages inside the section, not pop-ups; no
    button icons. Above 3 County Focus counties the folder name's area part is "<n>Counties" (CVI's export fails on
    the long name). `export_params.json` keeps CVI's form, so it does not record "Show charts by:" or the Emerging
    comparison.
  - Charts: a layout switch (Map, Map + charts, Charts) in place of CVI's "Show charts" drawer; click-to-spotlight on
    the WA State map's county bars; the five chart changes (top premises in place of top counties on County Focus,
    empty periods at zero, "Show charts by:" animals, CVI records or unique CVIs, exact values on hover, the same
    quarter last year in Emerging); one design for the page and the export (species colors in the species chart, CVI's
    two heatmaps kept, the export writing the charts shown); "Top Counties by Period" (CVI: "Top Countys"); Inbound
    above Outbound; a chart with only a gray message keeps its title and is not exported; top premises grayed with the
    missing premises coordinates.
  - Export PNGs: a caption and a footer line; 14 pt text for every chart (CVI: 14 pt for its species and top charts,
    12 pt for its heatmaps and time charts); 150 dpi recorded, as CVI's.
  - Text with doubled quotes written as read (CVI doubles them again).
  - Map Data table: a number column's filter box matches the number's text (CVI: a range slider); the search matches
    word by word, as CVI's.
  - Charts by direction (CVI's own planned fix P1-12): "Top counties" or "Top states", "Animal volume over time" and
    "Emerging vs cooling" count the rows as the map draws them, so a movement between two WA counties counts as
    Outbound at its origin and as Inbound at its destination, as its two circles on the map. Totals across directions
    ("Animals by species group", "Top movement corridors", the heatmap of species, the value boxes, the Stats text and
    `filtered_rows.csv`) still count it once. CVI's current code counts it once everywhere, so its charts by direction
    leave out the Outbound side of each such movement. A chart filter on a county or state keeps each copy at its own
    end, so a county's Outbound bar filters the other charts to its movements. One period (2025 Q3 of the S7 fixture)
    is reconciled by hand in the S7 unit suite (CVI's P1-13).

- **Shared facility preparation:** a missing, blank or NA precision becomes `existing` and keeps the supplied name
  (CVI keeps NA and shows nothing). Valid finite `none` and zero-coordinate points stay supplied points, with no
  accuracy claim; points out of range are still left out, as on County Focus. Each replacement file rebuilds the
  choices from its content, clears picks that no longer apply with a notice and closes the details (CVI's check of
  equal names and an equal row count keeps stale choices). Infrastructure tags each facility with the first
  Washington county it falls in; County Focus's union of the selected counties is unchanged. Click details add the
  supplied identity, layer, spatial county and eligible attributes as plain text, while hover stays compact and
  clusters have no click action. The basic facility swatch and cluster legend on the Infrastructure map is an
  addition (CVI's Facilities legend has none). County Focus reuses the shared refine lists and details, compact row
  counts and unclustered facility swatches, and its Reset All clears attribute picks; Infrastructure's overlay,
  styles and Reset All work the same way.

- **Facility filters and names:**
  - The facility-name column is never offered as an attribute filter. CVI leaves out only the registry's `name_col`
    as written, so in CVI a name column found another way (different case, the `make.names` form or the fallback)
    could also appear as a filter.
  - The name fallback ("any column with name in it") skips columns that the personal-field screen leaves out, such as
    `Owner.Name`. Such a file shows "Unnamed facility" where CVI would show the person's name (for privacy).
  - Refine lists have Clear but no All: ticking every value is not the same as no filter, because rows without a
    value would then be left out.
  - Known limit: for 250 ms after a county change, County Focus facility counts can still use the previous counties.
- **Facility attribute filters folded:** each facility layer's attribute filters sit in their own "Filter by
  attributes" fold, closed at first, its header saying how many filters are on, in Infrastructure and County Focus (a
  browser addition for a shorter sidebar).
  - Matching R: column types follow R's `read.csv` rules. Left as they are: R reads values such as `1i` as complex
    numbers (here text); the shared CSV reader trims spaces around unquoted values, as the CVI master reader does,
    while CVI's facility reader keeps them.

- National Flow Browse with no cross-border rows: when a file has no row with exactly one end "WA", the Flow slider
  steps through the file's own periods for both steps; CVI does so for years only and shows a single period "-" for
  quarters (R's `paste0` on zero rows). The Flow map draws nothing in such a file either way.
- Projection: CVI draws its maps on mapgl's default **globe** projection. The National Flow map does too; the WA State
  map stays on Web Mercator, which looks nearly the same at its zoom (about 6.5 and closer).
- National Flow: **offline only**: light gray states (Census 2023 outlines) with state lines on the page background,
  no basemap and no request (CVI: CARTO Positron tiles); Map View shows only WA State and National Flow until the
  other views exist; the camera stays on filter and style changes (CVI rebuilds the map and snaps back unless
  browsing); "Fit to Lower 48" and a house button under the zoom buttons return to the opening view (CVI flies to the
  lower 48's box, about zoom 4.01); Browse as on the WA map (label, speed during Play, slider sized for the step);
  screenshot saved from the click with the message, the picture carrying the state labels and the Census credit;
  Species Group folded with a summary; Unique CVIs grayed without a `CVI` column; state labels switched live (CVI
  re-renders); with Combine species the legend swatch takes the lines' color (CVI's is gray); Reset All also turns
  Flow's Browse off (keeping its slider, step and speed). CVI's Flow "Label style" and "Boundary style" only change
  its PNG export and are handled with the branded PNG.
- National Flow state labels: labels that would overlap are hidden, as on CVI's map (its symbol layer's default),
  rechecked as the map moves, so they return as you zoom in; where two collide the **larger state's** label is kept
  (CVI keeps whichever comes first in its data; e.g. at the opening view the page shows MD and hides DC). Labels on
  the far side of the globe are hidden too, and the screenshot draws exactly the labels shown. The WA map's and the
  Flow map's legends share one open state, as CVI's single legend (Compare's right-map legend keeps its own).
- National Flow page details: the hover texts of "Show state labels" and "Show state lines" without their basemap
  sentences ("Adds state abbreviations on top of the map.", "Draws US state boundary outlines on the live map.");
  CVI's other Flow hover texts copied with American spelling ("color" for "colour"); in place of CVI's "National Flow
  uses the default basemap only." the line "The National Flow map does not use basemaps."; the Flow view's Total
  animals box without the WA map's help text (which describes the WA map's two numbers); tooltips show the file's
  state codes and species names as text, only CVI's bold and line breaks being markup (CVI's map renders the text as
  HTML); Play stops when the view is switched; each view's "No records match…" warning shows only while that view is
  on screen; "Fit to Lower 48" without CVI's crosshairs icon and hover text, as the page's "Fit to Washington"; Map
  View usable without a file (as CVI), Flow's Browse grayed without one (as the WA period modes).

- WSDA guide colors and the legend: **WSDA guide colors** in the WSDA-named palettes where CVI's are not the brand
  guide's: WA "WSDA Brand" Outbound and "Single — WSDA Orange" `#f07325` (CVI `#ee7e2c`); Flow "WSDA Brand" Exotic
  Hoofstock `#f07325`, Poultry `#0094aa`, Small Ruminants `#8bc04a`, Swine `#fcb614` (CVI `#ee7e2c`, `#4ea2c4`,
  `#76a553`, `#d4a017`) and Flow "Single — WSDA Orange" `#f07325`; every other palette value CVI's (`palettes.js` lists
  CVI's value for each change). **Combined total** circles and their legend swatch take the selected palette's first
  color (CVI's own "Combine species" rule on its Flow map; CVI draws them `#245566` whatever the palette), on both
  Compare maps and in the screenshot. **Legend:** each direction swatch shows the circles' color as the map draws it,
  the palette color at the circle opacity over Washington's land fill (`#ececec`, white while a neighboring region is
  on) or over white on a light tile basemap, and at full strength on a dark one (CARTO Dark x2, OpenFreeMap Dark, the
  Esri and USGS imagery: no single color under the circles) (CVI: full strength always); while a basemap's style is
  still loading the county map shows but the swatches already follow the basemap; the size circles are **nested**
  (the largest at the back, CVI's tier values beside them, moved apart where two would touch), each at the radius the
  map draws that value among the circles drawn: for log, linear and square root CVI's `.compute_radius` with the
  value added (smaller than CVI's legend, which sizes the tiers against each other); for quantile and natural breaks
  the radius of the tier's bin under the circles' own breaks (CVI re-bins the tier values alone, which differs when
  the data has fewer distinct bins than asked for or a tier is negative); no 20 px cap (CVI: a column of gray circles
  capped at radius 20, so with log scaling all tiers looked the same). In the default view the map scales Inbound and
  Outbound each on its own; the legend sizes against all circles drawn and keeps CVI's "Sizes scaled per direction"
  note. The legend box scrolls inside the map if it is ever taller (CVI's ran past the top of the map at 1024 x 600
  with 10 bins); the National Flow legend shares the box style, so it too scrolls at very short windows instead of
  running past the map. The National Flow palette help reads "WSDA Brand uses colors from the WSDA brand guide." (CVI:
  "WSDA Default uses brand colors.", which neither map's WSDA Default is). The default circle opacity stays CVI's 60%.
- WA State map: duplicate rows merge only the loader's two copies; both animals numbers kept, with help text; Reset All
  clears the spotlight; "Unique CVIs" grayed without a `CVI` column; spotlight picker is a ticked list; Reset All's
  hover text says what it does; "Load a master dataset."; **county lines on when the page opens** (CVI: off); the page
  says where a screenshot went or why it failed.
- Period modes and Compare: the Browse header names the period on the map also when stepping by year (CVI's names a
  quarter from the wrong list); one legend on each Compare map (CVI: none in Compare); the two Compare cameras are
  linked (CVI: separate); a new speed during Play keeps playing (CVI's slider is rebuilt). Also: the right map ignores
  a "Refine by species" pick left over while its own species is switched off (CVI applies it, hidden); after a new
  file while stepping by year the slider is sized for years (CVI sizes it for quarters); a one-line note under the
  Compare maps says circle sizes are per map; the camera stays put between Browse frames (CVI's WA map is rebuilt
  each frame).
- Compare fit and loading: **Fit to Washington in Compare** fits each map to its own size (CVI's button moves only its
  hidden single map); **a failed load returns to Single period** (the mode radios are grayed without a master). Left
  as they are: "Show county labels" applies to both Compare maps (CVI's Compare maps are always labeled); the Compare
  cameras stay put when filters change (CVI redraws both fitted to Washington); the right map's legend says "No data
  loaded" when its filters match nothing; the maps stack below 768 px (CVI's Bootstrap columns most likely below
  576 px); a new file while browsing always puts the slider's period on the map (CVI most likely not when the middle
  position is unchanged; inferred from the code).
- Fit button: **a fit button (house icon) under the zoom buttons on each map**, both maps in Compare, doing what Map
  Style's "Fit to Washington" does; that button stays where CVI has it (CVI has no button on the map). **Both buttons
  return to the view the map opens with**, fitted to the map's current size, in every period mode (CVI's
  `.fit_to_bbox()` uses a fixed center and zoom, tighter than the opening view on a wide map).
- Folded pickers: **Species Group** (both maps) and **Spotlight Counties** are folded, closed when the page opens, the
  header saying what is ticked ("all 6", "Cattle, Poultry", "4 of 6 groups", "none (map empty)"; "none", "King"); All
  and Clear stay in the header; Reset All leaves them open or closed. "Refine by species" stays its own fold under the
  header. CVI shows these as compact dropdown pickers; the label is "Spotlight Counties" (CVI: "Spotlight counties").
- County names are page elements drawn on top of the circles and always shown (CVI: map text under the circles,
  hidden where they overlap); the screenshot shows them as the page does. On the offline county map the screenshot
  leaves out the map attribution; on a tile basemap it carries the map's attribution text at the bottom right.
- Basemaps: **the offline county map is the default** and the first choice of the Basemap picker (CVI's default is
  CARTO Light); tile basemaps are fetched only when chosen, only from the chosen provider's hosts; **Reset All returns
  to the offline map** (CVI: CARTO Light); MapLibre Demo is not offered (demo tiles, not for production). Raster
  basemaps use CVI's `.make_raster_style()`, except that past a raster basemap's max zoom (USGS 16) its last tiles are
  stretched instead of the basemap disappearing as in CVI (nothing is asked for beyond the max zoom). The basemap's
  credit is opened on the map whenever a basemap is shown (MapLibre folds the compact credit on the first drag). A
  basemap counts as not loading (message, county land fill back) when its style cannot be read or used (or does not
  arrive within 20 seconds), when none of its tiles with data has loaded once the map is idle after asking for some
  (for a vector basemap only its vector tiles count, not a raster relief layer; a source refused by the page counts
  as asked), or when none has arrived 20 seconds after it was shown while the map is still busy (not counted while the
  page is in a background tab or the map is hidden). If its tiles arrive later after all, the message goes and the
  basemap is shown. A missing sprite or font, or a few missing tiles, does not stop one that draws. While a vector
  style is being read the county map is shown, with its label colors. Outside Compare the hidden right map neither
  follows the camera nor takes a new basemap; it catches up when Compare is turned on.
- Basemap list: **23 basemaps**: CVI's 16 (all but MapLibre Demo) plus OpenFreeMap Dark (in MapLibre Demo's place),
  USGS The National Map x5 and WSDOT's Washington basemap. Two of CVI's labels are shortened because they describe
  CVI's PNG export, not this page's screenshot (which works on both): "OpenTopoMap" (CVI: "OpenTopoMap (live map only
  — tile fetch blocked for PNG)") and "Esri Physical (low zoom)" (CVI: "Esri Physical (live map only — low zoom,
  blocky PNG)"). Under the picker, WSDOT says what it covers (Washington and the land just around it, from the
  whole-state view closer; nothing is asked for outside a box around that), and Esri Shaded Relief and Physical say
  Esri plans to retire them in March 2028. **Left out of a copy for another host** (`publish: false` in
  `basemaps.js`): CARTO x6 and Esri x6 (their terms cover WSDA's own pages). WSDOT is cleared for any copy.
- Label style and Boundary style: CVI's choices and colors. **OpenFreeMap Dark counts as dark for Auto** (CVI's rule
  matches satellite, imagery and dark-matter names, and would give dark gray text on near-black here). USGS Imagery
  and Imagery + Topo count as dark because CVI's rule matches "imagery". When a basemap cannot load, Auto gives the
  county map's colors (the basemap is not on screen; CVI has no such fallback). The screenshot draws the county labels
  in the chosen colors. CVI repaints the colors on its single WA map only, and any re-render there (filters, opacity,
  palette) brings back its fixed `#333333` / white / `#8a8a8a`; its Compare maps always use the fixed colors. The
  page applies the chosen colors on both maps and keeps them.
- **Neighboring regions (a deliberate addition; CVI has none):** "Neighboring regions" in Map Style: British
  Columbia, Idaho and Oregon, each with a switch for its counties (BC: regional districts), all off when the page opens;
  a counties switch is hidden until its region is on and goes back to off when the region is turned off. Outlines,
  county lines, names (region names while on; neighbor county names from zoom 7, following "Show county labels") and
  Label style / Boundary style as Washington's. Below it, "County lines and labels" holds "Show county labels"
  (Washington's and the neighbors' county names) and "Show county lines" (Washington's only; each neighbor has its own
  switches). Land fill: while any neighbor is on, Washington turns white and the neighbors take Washington's usual
  `#ececec`; with all off, Washington's `#ececec` as before. Both follow Washington's rule (offline map, or a basemap
  that did not load). Kept across basemaps, on both Compare maps (the hidden right map catches up when Compare is
  turned on) and in the screenshot (lines, the names shown, the credit band while BC is on). Reset All turns every
  switch off. The map credit adds "Adapted from Statistics Canada" while BC is drawn (MapLibre's " | " between
  credits); the footer carries Statistics Canada's statement and the Open Government Licence – Canada link at all
  times. Circles, numbers, the opening view and Fit to Washington stay Washington-only.
- **County Focus popup readability:** premises table text is 14px, for reading in the browser (CVI's
  `.mk_focus_popup` uses 0.78em, about 10.14px under the page's 13px popup). CVI's columns, 25-row limit and overflow
  note are kept. Header and body cells have 10px horizontal padding on each side (20px between adjacent columns; CVI's
  body cells have none). The table scrolls horizontally and vertically within a 240px limit, less in small windows to
  leave room for navigation, padding and the popup tip within half the 77vh map (so the popup stays inside the map in
  Safari); navigation places the popup again after replacing the table.
- **County Focus cluster raw-species labels:** a species labeled `__proto__`, `constructor`, `toString` or another
  name every JavaScript object already carries keeps its sum and shows in the cluster's hover text. CVI's embedded
  `applyLeaves` adds the totals into a plain JavaScript object, so these labels go wrong there. Only these labels
  differ: the sums, sorting and rounding, the cluster shapes, the collision priorities and the clusters' lack of a
  click action are CVI's.
- **County Focus, several premises under a click (a deliberate addition):** CVI opens the CVI table of the premises on
  top only. When a click hits several premises, the page's table has a bar above it, "1 of N · Exporter" (the role of
  the premises shown), with previous and next buttons through every premises under the pointer, topmost first: the
  exporters' layer over the importers', then within a direction the later-drawn, smaller circle first. The buttons are
  grayed at the first and last premises (no wrap-around). One premises under the click: CVI's table alone, as before.
  New data closes the table. To make "on top" exact, the premises are drawn in their feature-id order (ids given
  widest first, as CVI's `order(-radius_px)`), and the hover also shows the premises on top (MapLibre lists
  overlapping circles of one layer in its tile order, not in drawing order).
- **County Focus, facility layers:** usable layers added by a supplied manifest are drawn as well as CVI's five
  built-ins (CVI's Focus map draws only the five, although its list offers every registry layer). A layer that cannot
  be drawn (its file not handed over, no coordinate column, no row with numbers in both) stays in the list grayed,
  with the reason under it, and All leaves it off (CVI lists it and draws nothing). Rows left out of a drawn layer are
  counted under it, including points outside -90..90 / -180..180 (CVI passes those to the map). Names are text (CVI's
  map reads them as HTML). The manifest keys "master" and "manifest" are not layers, and at most 500 manifest layers
  are read (as the landing page's dataset list; the skipped rows are named under the list); a manifest without "key"
  and "file" columns is said under the list (CVI shows a notification). One hover pop-up for what is on top, a
  facility marker being above the premises (CVI: one per layer).
- **County Focus legend, Browse, neighbors and Reset All:** the legend's role swatches at the circle opacity over the
  land under the circles (full strength on a dark basemap; over white while a neighboring region is on), as the WA
  legend (CVI: full strength); the "Animals per premises" circles nested at the radii the map draws (4–24 px, from the
  circles' own partition), no cap (CVI: a column of gray circles from separate 4–20 px tiers, capped at 20); with Hide
  CVI circles one line, 'CVI circles are hidden ("Hide CVI circles" in County Focus Style).', in place of the premises
  sections (CVI keeps them); without the premises coordinate columns the strip's reason (CVI: "No data matches
  current filters."); "color" for CVI's "colour" in the cluster note. The County Focus map has its own
  neighboring-region switches in County Focus Style, off at first, context only (not in CVI; as its own basemap).
  Reset All also turns County Focus's Browse off (its slider, step and speed kept; CVI leaves Browse on), switches its
  facility layers and neighboring regions off and puts the offline map back (CVI: CARTO Light); the camera stays (as
  CVI). Play stops when the view is switched (as the other views).
