# WSDA Animal Services Visualization Platform: the site

Static web pages that show animal movement and facility data on maps, charts and branded pictures. Everything runs in
the browser tab: nothing is installed, nothing is uploaded, and the pages make no network request unless you pick an
online background map. The data comes from the files you load; the site itself holds no records.

## What is here

| Page | What it does |
|---|---|
| `index.html` | The starting page. Load your files (a ZIP, several files or a folder), see which dashboard each file is for and whether each dashboard is ready, then open a dashboard in its own tab. "What data does this need?" lists every dataset each dashboard reads, and offers a sample bundle to try. |
| `cvi/index.html` | **CVI Traceability**: animal movements from certificates of veterinary inspection. Four views (WA State county map, National Flow between Washington and other states, County Focus on picked counties, and Premise Lookup with buffers around sites), charts, previews, a ZIP export, branded PNG maps and time-series GIFs. |
| `emergency/index.html` | **Emergency Response (preview)**: positives of an animal disease emergency (HPAI first) on a map with their zones (rings around each positive, or a zone file), the facility and premises sites inside the zones and the nearest one for a layer with nothing inside, the CVI movements that left from or arrived inside the zones, and the results as CSV files in one ZIP. |
| `infrastructure/index.html` | **Infrastructure**: facility layers (packing plants, markets, feedlots, fairgrounds and more) on a map with filters and details, optional CVI activity, and a branded PNG. No CVI master table needed. |

## Open it

- **On your own computer:** open `index.html` in a current browser (double-click it, or File → Open). The pages use
  only standard browser features; they are tested in Google Chrome and Safari. Keep the `site/` folder together: the pages read their scripts, maps and fonts
  from it.
- **On macOS with Chrome:** if the page shows nothing and every script is refused, allow Chrome to read the folder in
  System Settings → Privacy & Security → Files & Folders → Google Chrome → Documents Folder.
- **Hosted:** publish the `site/` folder as it is on any static web host (for example GitHub Pages). No server code,
  database or build step is needed. File names are case-sensitive on most hosts, as written in the pages.

## Load your data

1. On the starting page, choose your files, a folder, or drag them onto the page. A ZIP bundle may hold everything
   for every dashboard; an optional `bundle.json` inside it can give a label, dates and which dashboards it is for.
2. Each dashboard card says "Ready." or what it still needs. Under "Load your data" a one-line result names the
   dashboard checked; "Details: datasets, features and your files" opens the full checklist (it opens by itself when
   something needs attention).
3. Click a ready card's button. The dashboard opens in its own tab with your files, passed in memory; nothing is
   written to disk or sent anywhere. Clicking again sends the files loaded now to the same tab.
4. A file without an optional column, or a missing optional dataset, turns off only the features that need it, and
   the page says why. A CVI master table missing one of its 13 required columns, or with one of them written twice,
   is not used at all; the page names the column.
5. When a master loads, its status says how many rows have no readable animal count (empty, or text such as "1,200"
   or "12 head"; they add no animals). A file not saved as UTF-8 (Excel's plain "CSV") is named with how to save it
   again: in Excel, Save As, then CSV UTF-8.

Each page's footer shows its version and date; the same is in `VERSION.txt` beside `site/`.

To try the site without data, use **Download a sample bundle (ZIP)** under "What data does this need?" and load the
downloaded file.

## Background maps and network use

The maps are drawn offline from county, state and regional outlines in `geo/`. On the CVI page, **Map Style →
Basemap** offers online background maps (OpenStreetMap-based, USGS, WSDOT and others); a background is fetched only when
picked, and only from that provider. The page's security policy allows no other address. Credits and licenses:
[PROVENANCE.md](PROVENANCE.md). Every provider's terms are confirmed for WSDA's pages;
a copy for another host leaves out CARTO and Esri, whose terms cover WSDA's own pages only (see PROVENANCE.md).

## Using the exports in GIS

- **Coordinates** in every export (the CSV files and `export_params.json`) are WGS 84 longitude and latitude
  (EPSG:4326); each `export_params.json` says so under `"coordinates"`.
- **Distances** in Premise Lookup are great-circle (haversine) kilometers on a sphere of radius 6,378,137 m, as in
  CVI's app; its `export_params.json` says so under `"distances"`.
- **Load the CSV files into a file geodatabase table, not a shapefile.** A shapefile cuts field names to 10
  characters, so `Origin.County.Lat` and `Origin.County.Long` both become `Origin_Cou`; a file geodatabase keeps names
  up to 64 characters.
- **`NA` in Premise Lookup's Matched CVIs file.** That file is written as CVI's Export CSV writes it, with a missing
  value as `NA`, and ArcGIS reads a number column holding any `NA` as text. Before using its latitude and longitude as
  XY data, replace `NA` with an empty cell (in Excel: Find and Replace, "Match entire cell contents"). The Facilities
  inside file, `filtered_rows.csv` and `summary_table.csv` already write a missing value as an empty cell.
- **National Flow's state points are drawing positions.** In `summary_table.csv` the other end of each National Flow
  line (`dest_lat`, `dest_lon`) is the state's approximate center, where the line is drawn to, not where any record is.
- **Exports from the synthetic sample** say so: `"data_note": "Synthetic sample data"` in `export_params.json`, and a
  line on each picture.

## Known limits of the CVI and Infrastructure release

Where a later change is planned, the entry number in `docs/FUTURE_ENHANCEMENTS.md` is given.

- **Location precision (CVI's P1-3; entry 2).** A facility file's `geo_source` column says how exact each location is.
  Only the Infrastructure dashboard's PNG reads it, as CVI's PNG does: `google_city` (a town's center) is counted as
  town-level and `none` as not placed (written exactly so, in lower case); a blank, missing or other value counts as a
  precise location. Elsewhere it only labels a `google_city` point "town-level location" in its name and its click
  details: the live maps draw every point that has coordinates, `none` and town-level ones included, and Premise
  Lookup measures every point with coordinates as precise. This follows in a small update once CVI settles its rules.
- **Agricultural coverage (S12; entry 3).** Not included. The Infrastructure dashboard shows a grayed "Coverage
  (planned)" control. It is developed with the Emergency dashboard.
- **Facility colors written as names (entry 8).** A layer color given as a name (such as `teal`) or as `hsl()` is
  drawn as written but compared as text only, so it can share a shape with the same color written in hex, without the
  legend's note. Colors in hex and `rgb()` or `rgba()` are read as the browser reads them.
- **Very large CVI master tables (entry 12).** A master is read whole and takes about 25 times its file size in the
  browser's memory, so a master much above 50 MB may be slow or fail to load, and the page does not say that size is
  the reason. Masters as CVI writes them are far smaller.
- **A count written "Inf".** An animal count written `Inf` (R's infinity) shows as "Inf animals" on a county's circle
  but is hatched "No movements" on the shaded map, with nothing under the legend saying why. Real files are not
  expected to hold one.
- **Facility layers on the CVI map come through the landing page.** The CVI page's own file chooser takes the master
  table only; facility layers and the manifest reach County Focus and Premise Lookup when the CVI map is opened from
  the landing page with them. (The Infrastructure dashboard's own loader takes facility files directly.)
- **A blocked download cannot be seen by the page.** After an export the page says the file was handed to the
  browser; if a browser setting or an IT policy blocks downloads, no file appears and the page cannot tell. The
  export line says so.
- **A newly chosen file that does not load (Safari).** In Safari a file picked to replace the one on screen has
  sometimes needed a second try. If a file you chose does not appear, choose it again.

## Known limits of the Emergency Response preview

- **The values are examples.** HPAI's statuses, its two rings (3 km and 10 km), the layers it suggests and its
  closed rule are examples until WSDA staff confirm them; the type's "?" says so.
- **Kilometers only.** Rings and distances are in km; a miles switch is planned.
- **Positives are points.** A positives file needs a latitude and a longitude per row; an emergency reported by
  county only is not covered yet.
- **Zone files in longitude and latitude only.** A GeoJSON, KML or zipped shapefile in another coordinate system
  (such as Washington State Plane) is refused with a message. A zipped shapefile is loaded on the Emergency page,
  under "Positives and zones", "Use a zone file"; inside a bundle it arrives unpacked and is not used.
- **Locations known only roughly are left out of the zone results** by default and listed with their reason: a
  facility's `geo_source` of `google_city` (a town's center) or `none` (not placed), and, when a file carries them,
  a `geocode_precision` other than rooftop or street, a `match_status` other than Matched or a `premises_type` other
  than Street. "More options", "Include locations known only roughly", takes them in.
- **CVI movements need the master's premises coordinates** (`Origin.Lat`, `Origin.Long`, `Dest.Lat`, `Dest.Long`).
- **No address is shown or exported.** A column whose name holds address, location, street or premise is never read
  from the positives file, and the CVI movements' CSV leaves such columns of the master out.

## For developers

- How the pages are built, a file map and where to change what: [`docs/DEVELOPER_GUIDE.md`](../docs/DEVELOPER_GUIDE.md).
- The tests and the full regression chain: [`tests/README.md`](../tests/README.md).
- Where the page differs from CVI's own app on purpose: [`docs/DELIBERATE_DIFFERENCES.md`](../docs/DELIBERATE_DIFFERENCES.md).
- Data sources, licenses and how the map files were made: [`PROVENANCE.md`](PROVENANCE.md).
