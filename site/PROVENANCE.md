# Provenance — site (the landing page, CVI Traceability and Infrastructure dashboards)

Everything the pages load is in this folder (`site/`). Nothing is fetched at run time, except map tiles from an opt-in
tile basemap on the CVI and Infrastructure maps (S3, below) and an opt-in tile background for a branded PNG (S9,
below), each only after the user chooses one. Paths below are relative to `site/`.

## MapLibre GL JS 5.22.0 (`vendor/maplibre-gl/`)

| File | SHA-256 |
|---|---|
| `maplibre-gl.js` | `2e3fc89bc9bbbe9fedc6f4bebbdfca31114474b7641db3064324a89a1dfaffc9` |
| `maplibre-gl.css` | `761a1130f0960ea369d917ec843f7d1af5ca1dcf27701aef1d9d59821b3bab25` |
| `LICENSE.txt` | `ee5fc05a0677eaf69601d2c7db0d9ecd6cc27c3abc1d0733bc9ed34707cf8ef2` |

- License: BSD 3-Clause, MapLibre contributors (`LICENSE.txt`, kept with the files).
- Upstream: <https://github.com/maplibre/maplibre-gl-js/releases/tag/v5.22.0> (also published on npm as
  `maplibre-gl@5.22.0`).
- Obtained 2026-09-30 by copying the unmodified files that the R package `mapgl` 0.4.6 ships
  (`htmlwidgets/lib/maplibre-gl/`; its `maplibregl.yaml` declares version 5.22.0). That is the same engine CVI's
  live Maps tab uses. No package manager or network download was used. To verify against upstream, compare the
  hashes above with the npm tarball's `dist/` files.

## WA county geometry (`geo/wa-counties.js`)

- Source: U.S. Census Bureau, 2023 cartographic boundary file `cb_2023_us_county_500k.zip`,
  <https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_county_500k.zip>, SHA-256
  `99d6597b1fc7767deef62e01d28d8b5dcbd578e151855f7dc0d173cbf5bf0868` (checked by the build script).
- Terms: Census cartographic boundary files are public domain; the Census Bureau asks for acknowledgment as the
  source, which the page shows in its attribution and footer.
- Derivation: `build/derive_counties.R` keeps `STATEFP == "53"` (39 counties), transforms to EPSG:4326, rounds
  coordinates to 5 decimals and computes label points with `sf::st_centroid()` (s2 on), the call CVI uses for its
  county labels. Geometry differs slightly from CVI's own `reference/wa_counties_polygons.gpkg`, whose provenance is
  unrecorded; names match CVI's short county names.
- The archive used on 2026-09-30 was a copy kept outside this repository (its SHA-256 matches the one above); it is
  not committed here (`*.zip` is ignored).

## Neighboring regions (`geo/regions/`, NR; loaded only when a region's switch is turned on)

- Idaho (`id.js`, 44 counties) and Oregon (`or.js`, 36 counties): the same Census file and SHA-256 as Washington's
  above (downloaded again on 2026-10-07 from the same address; the hash matched), `STATEFP` 16 and 41. Public domain;
  the page's "Boundaries: U.S. Census Bureau" credit covers them. Census use constraint (from the file's metadata):
  for display at small scales, not for "determining precise geographic area relationships", which is why
  `shared/regions.js` flags a row whose point and county name disagree instead of settling it.
- British Columbia (`bc.js`, 29 census divisions = 27 regional districts, the Stikine Region and Northern Rockies):
  Statistics Canada, 2021 Census cartographic boundary file of census divisions, `lcd_000b21a_e.zip` (139,871,865
  bytes, SHA-256 `1b638cea73fbf8349ba908d86be678272b2abcc74240fb0dfd9daf7a28457ad0`, shapefile dated 2021-12-20),
  downloaded in a browser on 2026-10-07 from the 2021 Census boundary-file page
  <https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/boundary-limites/index2021-eng.cfm?year=21>
  (Cartographic Boundary Files, Census divisions, shapefile, English); the server answers HTTP 403 to command-line
  downloads. License: the file's metadata names the **Open Government Licence – Canada**
  (<https://open.canada.ca/en/open-government-licence-canada>): use, adapt and publish, also commercially; acknowledge
  the source with the provider's attribution statement and a link to the license where possible; no implied
  endorsement; Ontario law. Statements carried: "Adapted from Statistics Canada,
  2021 Census Boundary Files (census divisions, cartographic), reference date 2021. This does not constitute an
  endorsement by Statistics Canada of this product. Contains information licensed under the Open Government Licence –
  Canada." with the link: on the CVI page the footer shows this statement at all times with the license name linked
  (from the BC entry of `geo/regions/index.js`), and the map credit and the screenshot add "Adapted from Statistics
  Canada" while BC is drawn. Size cut: islands under 1 km2 left out, shared borders simplified to 0.0015 degrees
  (about 150 m) with both sides kept identical. The island cut is measured per district piece in square
  degrees scaled at 50 degrees north, so the real threshold runs from about 0.8 km2 (north) to 1.04 km2 (south), and an
  island split between two districts is judged piece by piece.
- Derivation: `build/derive_regions.R` (checks the SHA-256, the filter, EPSG:4326, coordinates rounded to 4 decimals
  with repeated points dropped, so shared borders stay shared; the outline is the union of the rounded counties; label
  points as Washington's, or a point on the surface when the centroid falls outside; keys and official IDs; stops on a
  count, key, validity or extent check). Sizes (2026-10-07): `bc.js` 1,718 KB, `id.js` 485 KB, `or.js` 340 KB (budget
  2 MB each). `tests/oracle/nr_regions_check.R` compares them with the source: names and IDs equal, each county's area
  within 0.010% (Idaho, Oregon) and 0.551% (BC) of the source's, labels inside, a rebuild byte-identical. Known
  limitations: along the 49th parallel and in the straits the Census and Statistics Canada lines come from different
  agencies and BC's are simplified to about 150 m, so they can be apart by up to that when zoomed in. Washington's
  borders with Idaho and Oregon come from the same Census file but `wa-counties.js` keeps 5 decimals and the region files
  4, so they can be up to about 7 m apart: invisible on the map, but a point within meters of
  such a border may fall in both or neither file (for the cross-border data slice).

## Bootstrap Icons (`cvi/app/icons.js`, S2a, S2b, S4 and S5)

- Seven icons as inline SVG: `stack`, `file-earmark-medical`, `geo-alt`, `tags` (value boxes), `info-circle` (the boxes'
  alert), `arrow-counterclockwise` (Reset All), `camera` (screenshot button). Copied unchanged (line breaks removed)
  from the output of `bsicons::bs_icon()` in the R package bsicons 0.1.2, which CVI uses for the same boxes and button;
  the S2 unit tests check the four box icons and the alert icon against the SVG CVI's module renders.
- S2b, eleven more, made the same way (`bsicons::bs_icon()`, bsicons 0.1.2, 2026-10-06): `calendar3`, `calendar-event`,
  `clock-history`, `layout-split`, `arrow-left-circle`, `arrow-right-circle`, `arrow-up-short`, `layers`,
  `speedometer2` (the Period block, as CVI's) and `play-fill`, `pause-fill` (the Play button; Shiny draws its own).
- Later, one more, made the same way (2026-10-06): `house` (the fit button on each map; not in CVI).
- S4, two more, made the same way (2026-10-07): `map` and `globe-americas` (the Map View buttons, the Flow sections'
  headings and its States box, as CVI's).
- S5, two more, made the same way (2026-10-08; the stored `map` and `house` checked identical to that
  output first): `bullseye` (the County Focus button and its sections' headings) and `buildings` (its Premises box), as
  CVI's.
- For the shared look, twelve more, made the same way (`bsicons::bs_icon()`, bsicons 0.1.2, 2026-10-15; nothing installed):
  `eye`, `table`, `bar-chart`, `clipboard-data`, `download`, `search`,
  `plus-lg`, `dash-lg`, `x-lg`, `x-circle`, `box-arrow-up-right`, `file-earmark-zip` (the buttons' icons; CVI's own
  buttons carry Font Awesome icons, which the site does not ship, so their Bootstrap counterparts are used).
- License: Bootstrap Icons, MIT, © The Bootstrap Authors (<https://github.com/twbs/icons>). The notice is in
  `cvi/app/bootstrap-icons-LICENSE.txt` (2026-10-06). The installed bsicons
  package holds only CRAN's two-line stub ("YEAR: 2022 / COPYRIGHT HOLDER: bsicons authors"; its DESCRIPTION names
  Mark Otto, Bootstrap Icons maintainer, as a copyright holder), so the file is the standard MIT text with
  "The Bootstrap Authors". It is identical to upstream's `LICENSE` (twbs/icons, compared on 2026-10-17).
- No icon font and nothing fetched.

## Tile basemaps (S3; opt-in, fetched only when chosen; `cvi/app/basemaps.js`)

Nothing of these providers is stored in the repository: the page fetches their style, tiles, sprites and fonts at run
time when the user picks the basemap (the page's CSP `connect-src` lists only these hosts). No API keys. Terms as checked
on 2026-10-06; live check on 2026-10-07.

| Basemap(s) | Host | Credit shown (map and screenshot) | Terms | WSDA's pages |
|---|---|---|---|---|
| OpenFreeMap Liberty, Bright, Positron (vector; CVI's list) and Dark (vector; added) | `tiles.openfreemap.org` (style, TileJSON, tiles, sprites, fonts, Natural Earth relief) | From the provider's TileJSON: "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" (links) | Free, no key, no stated limits; "as is"; OpenStreetMap data ODbL | Cleared |
| USGS The National Map: Topo, Imagery, Imagery + Topo, Shaded Relief, Hydro (raster; added) | `basemap.nationalmap.gov` (tiles only) | Topo: "Tiles courtesy of the U.S. Geological Survey (The National Map)"; the others name their dataset, as the service's own credit text gives it: "USDA, USGS The National Map: Orthoimagery", "USGS The National Map: Orthoimagery and US Topo", "USGS The National Map: 3D Elevation Program", "USGS The National Map: National Hydrography Dataset" | US federal service, no key; USGS data generally public domain (not confirmed on the service's credits page). Topo's full service credit: "USGS The National Map: National Boundaries Dataset, 3DEP Elevation Program, Geographic Names Information System, National Hydrography Dataset, National Land Cover Database, National Structures Dataset, and National Transportation Dataset; USGS Global Ecosystems; U.S. Census Bureau TIGER/Line data; USFS Road data; Natural Earth Data; U.S. Department of State HIU; NOAA National Centers for Environmental Information." | Cleared |
| OpenTopoMap (raster; CVI's list) | `a.tile.opentopomap.org` (CVI's address, one host) | CVI's: "© OpenTopoMap (CC-BY-SA), © OpenStreetMap contributors" | CC-BY-SA, no key; volunteer servers, no bulk or heavy use | Cleared |
| CARTO Light, Voyager (labeled); Light, Dark, Voyager (no labels); Dark (labeled) (vector; CVI's list) | `basemaps.cartocdn.com` (style), `tiles.basemaps.cartocdn.com` (TileJSON, sprites, fonts), `tiles-a`…`tiles-d.basemaps.cartocdn.com` (tiles) | From CARTO's TileJSON: "© CARTO, © OpenStreetMap contributors" (links) | Keyless vector styles work; free use is non-commercial up to 5 M tiles/month; whether agency use counts is not stated | **Cleared** for WSDA's pages (October 2026); left out of a copy made with `publicCopy` true |
| Esri World Topo, Shaded Relief, Hillshade, Physical, World Imagery, World Streets (raster; CVI's list) | `server.arcgisonline.com` | CVI's: "Source: Esri, USGS, NOAA"; "Source: Esri"; "Source: Esri"; "Source: Esri, National Geographic"; "Source: Esri, Maxar, Earthstar Geographics"; "Source: Esri, HERE, Garmin" | Keyless requests work; no Esri page found granting keyless use in a public page. Shaded Relief and Physical on Esri's retirement list (March 2028; the page says so under the picker) | **Cleared** for WSDA's pages (October 2026); left out of a copy made with `publicCopy` true |
| WSDOT Washington basemap (raster; added) | `data.wsdot.wa.gov` (`Shared/WebBaseMapWebMercator` tiles) | "Washington State Department of Transportation" (the service's copyright text) | © WSDOT; "planning use only", no warranty, indemnify WSDOT | **Cleared**: WSDOT's Washington basemap is a public service of a Washington state agency, reviewed and cleared by WSDA for its own pages; its terms (planning use only, no warranty) are kept with the credit |

Live check: every provider answers with CORS headers (`Access-Control-Allow-Origin: *`;
WSDOT echoes the page's origin, also `null` from `file://`), so every basemap's tiles can be drawn into the screenshot;
all 23 drew in headless Chrome on a Mac (arm64) with only their own hosts asked, and their screenshots were made. Zoom
ranges found (Seattle and Spokane tiles): USGS Topo, Imagery, Imagery + Topo to 16 (404 from 17); USGS Shaded Relief
to 8 (404 at 9–11, service limit about zoom 7), so `maxZoom` 8; USGS Hydro to 12 (404 at 13–14), so `maxZoom` 12;
WSDOT 7–17 (404 below and above), so `minZoom` 7, `maxZoom` 17; OpenTopoMap to 17 (beyond: a small image without CORS
headers); Esri as CVI's max zooms, but Esri answers its gray "map data not yet available" tile past about 16
(Hillshade; CVI's max 18), 13 (Shaded Relief), 8 (Physical) and 19 (Topo, Streets, Imagery), which the stretch past the
max zoom does not change. CARTO's raster tiles need a key since 2026-09-25; its vector tiles (used here, as in CVI) did
not.

WSDOT outside Washington: tiles in Portland and Vancouver BC, 404 in Boise and Denver; the page asks for
nothing outside the box −125.5…−116.0 longitude, 45.0…49.6 latitude.

**Redirects:** every basemap request refuses redirects, also to the same host. A provider that starts
redirecting (for example to a new versioned path) makes its basemap show the failure message until its address in
`cvi/app/basemaps.js` is updated. None of the 23 redirected at the live checks.

**Copies for other hosts:** `shared/release.js` holds one setting, `publicCopy`. On WSDA's pages it is false and every
basemap is offered. A copy for a host not covered by CARTO's and Esri's terms sets it to true, and the basemaps
marked `publish: false` (CARTO, Esri) are left out of the list, the picker and the allowed hosts; the three Esri tile
backgrounds of the branded PNGs (next section, `publish: false` in `shared/tiles.js`) are left out of the CVI, Premise
Lookup and Infrastructure pickers by the same switch. Both dashboards' CSP `connect-src` (`cvi/index.html` and
`infrastructure/index.html`) list only the hosts the copy offers; the S3 unit tests compare both pages' CSPs with the
list. How such a copy is made is in `docs/DEVELOPER_GUIDE.md` ("A public copy").

**Trust boundary:** what a provider sends is data the page does not control. Its style decides
what MapLibre draws and asks for next (every such request still passes the page's host check and is fetched by the
page with redirects refused, no credentials and no referrer). A vector provider's credit is HTML from its
TileJSON, which MapLibre puts into the attribution control as HTML; the page's CSP keeps it from running scripts or
loading images, fonts, frames or forms (links and inline styles remain possible). The screenshot uses the credit's
text only.

## Branded PNG tile backgrounds (`shared/tiles.js`, S9; fetched only when picked for an export)

The branded PNGs (the CVI page's three maps, Premise Lookup's map and the Infrastructure dashboard's map) offer CVI's
three tile backgrounds besides Default: Satellite (`World_Imagery`), Shaded Relief (`World_Shaded_Relief`) and
Hillshade (`Elevation/World_Hillshade`), from Esri's services on `server.arcgisonline.com` (one "export" image of the
map's box, else the service's tiles stitched together). Nothing is stored in the repository; nothing is asked unless
one is picked. Each picture carries the credit `tiles.js` gives it, as CVI does: "Source: Esri, Maxar, Earthstar
Geographics" (Satellite) and "Source: Esri" (Shaded Relief, Hillshade). The requests follow the live map's rules: no
redirect followed, no credentials, no referrer.

- Terms: the same as the Esri basemaps above: **cleared** for WSDA's pages, and left out of a copy made with
  `publicCopy` true by the same switch as the Esri basemaps; see "Copies for other hosts" above.

## National Flow state outlines and centers (`geo/us-states.js`, `geo/state-centers.js`, S4)

- Outlines (`us-states.js`, 49: the 48 contiguous states and DC, the set CVI draws): the same Census file and SHA-256 as
  Washington's above, every county outside Alaska, Hawaii and the territories (`STATEFP` not 02, 15, 60, 66, 69, 72, 78;
  3,109 counties), counties rounded to 4 decimals and unioned per state, islands under 2 km2 left out (a state keeps
  at least its largest polygon), the states' shared borders simplified once at 0.005 degrees (about 500 m; both sides
  identical, as BC's in NR), coordinates rounded to 3 decimals. Public domain; the page's "Boundaries: U.S. Census
  Bureau" credit covers them. 247 polygons, 21,955 vertices, **371 KB** (budget 1 MB; measured on 2026-10-07: 623 KB at
  0.0025 degrees, 212 KB at 0.01). Every state's area within 0.74% of its full-detail outline. CVI draws the `maps`
  package's state outlines (GPL-2, from an older Census tape); these are a deliberate geometry difference,
  visible only when zoomed in.
- Centers (`state-centers.js`, 51: the 50 states and DC): **copied exactly** from CVI's `reference/state_capitals.csv`
  (SHA-256 `c00bad8aebd88a3bf8a1a6a43d06bbf8d2fdf956c2babe1da4dd201bcebd568a`,
  checked by the build script; file order and values kept), so every flow line ends where CVI's ends. CVI describes the
  file as USGS geographic centers ("Filename is historical"), public domain. USGS publishes the centers of most states
  only as locality descriptions (coordinates for Alaska, Hawaii and a later Nevada note), so these positions are
  approximate and cannot be rebuilt from USGS; CVI's Alaska point (64.20, -153.00) is not USGS's (63 deg 50 min N, 152 deg
  W). Hawaii's center (20.27, -156.41) lies at sea between Maui and the island of Hawaii, 30.4 km from land, as USGS's
  own does ("off Maui Island"); kept as CVI has it.
- Derivation: `build/derive_states.R` (both SHA-256s; counts; codes; validity; extent; areas; every center inside its
  own state: the drawn outline, Alaska's and Hawaii's against their own Census counties, Hawaii's inside the convex hull
  of its main islands east of 161 degrees west and at most 50 km from land). Built 2026-10-07 with R 4.4.3, sf 1.1.0,
  GEOS 3.13.0, GDAL 3.8.5, PROJ 9.5.1 (printed by the script; a byte-identical rebuild is expected with the same
  versions). `tests/oracle/s4_states_check.R` compares both files with their sources: codes, names, FIPS; areas within
  1% in an equal-area projection after densifying; overlaps (areas sum to the union's within 1e-9); gaps (every vertex
  on the edge of the union of the outlines within 0.002 degrees of the edge of the full-detail counties' union, so a gap
  or sliver between neighbors fails); centers identical to CVI's file and inside their states; a rebuild byte-identical.

## National Flow's Alaska and Hawaii insets (`geo/us-insets.js`)

- Outlines of Alaska and Hawaii for the two inset boxes: the same Census file and SHA-256 as `us-states.js`
  (`cb_2023_us_county_500k.zip`, already on the development machine; nothing downloaded),
  each state's counties unioned in its own equal-area projection: Alaska in Alaska Albers (EPSG:3338), islands under
  150 km2 left out, simplified to 3 km (43 polygons, 2,179 points, 99.6% of the land kept); Hawaii's main islands (east
  of 161 degrees west, as `derive_states.R`'s center check) in Hawaii Albers (ESRI:102007's parameters), islands
  under 2 km2 left out, simplified to 300 m (8 polygons, 640 points). Each is scaled to its box (0 to 1, y down) with
  its width-to-height ratio. Each box's anchor, where the state's flow lines end, is its center in `state-centers.js`
  (CVI's, as every other line) in the same projection: Alaska's on its land, Hawaii's at sea between its islands.
  Public domain; the page's "Boundaries: U.S. Census Bureau" credit covers them. **44 KB**, loaded with the National
  Flow map.
- Derivation: `build/derive_insets.R` (SHA-256; validity; each outline at least 97% of its land; the anchors' places),
  built 2026-10-17 with R 4.4.3, sf 1.1.0, GEOS 3.13.0, GDAL 3.8.5, PROJ 9.5.1.

## WSDA site icon (`shared/brand.js`, the shared look)

The tab icon of every page is WSDA's own site icon: `https://agr.wa.gov/content/icons/favicon.ico`, the icon declared by
the agency's pages (`<link rel="icon">` on `https://agr.wa.gov/departments/animals-livestock-and-pets`). Fetched once
on 2026-10-16 (09:21 UTC; three requests: the page, this icon and the page's `apple-touch-icon.png`, 60 x 60, not
used). Windows icon file, 15,086
bytes, three images (16, 32 and 48 px, 32 bits per pixel), SHA-256
`431f7371f542d0474b2005c8d5c9ac42f351c54d28ee5f8f6a2bd8765bdbd67f`; copied byte for byte as base64 into
`shared/brand.js` (`WSDA.brand.FAVICON`), which gives it to each page's `<link rel="icon">` (it holds `data:,` until
then, so the browser never asks the network for an icon). `tests/node/run_ui_unit_tests.js` checks the bytes against
that SHA-256. Its use follows the WSDA logo's (below): it is approved for WSDA's pages, a public demo copy
included. The same file, byte for byte, is `shared/wsda.ico`: the icon of the Windows shortcut that opens the pages
from a shared folder (a shortcut needs a real `.ico` file; the unit test checks the two are identical).

## WSDA logo (`shared/brand.js`, S9)

The WSDA symbol-only logo, CVI's own file `shiny/www/img/wsda_logo.png` (1760 x 724 pixels, RGBA, 63,152 bytes,
SHA-256 `1bdff086b0bc3aab9b0adb3135714ffc08d10e028e77940cb82f810cec2d9b72`, CVI HEAD `daf1a1f`), copied byte for
byte as base64 into `shared/brand.js` (the page's Content Security Policy allows pictures only as `data:` or `blob:`
addresses). `tests/node/run_s9_unit_tests.js` checks the decoded bytes against that SHA-256 and, when the CVI
checkout is present, against CVI's file. Used in the header of the branded map PNGs, as CVI's branded exports use it,
and, as part of the shared look, at the left of every page's banner, as CVI's app shows it (32 px high; the page's
`<img data-wsda-logo>` gets the same `data:` picture from `shared/brand.js`, so the site keeps one copy).
The WSDA brand guide (AGR Publication No. 140-608) governs its use; brand use is approved, including in a public
demo copy (2026-10-07). The brand colors in the same file are the
guide's values.

## Open Sans (`shared/fonts/`, the shared look)

- `shared/fonts/OpenSans-Variable-latin.woff2`: CVI's own file `shiny/www/fonts/OpenSans-Variable-latin.woff2` (CVI
  HEAD `daf1a1f`), copied byte for byte on 2026-10-15; 48,320 bytes, SHA-256
  `d8e4fe0452aa2076429a9bb5d8757d00a994dd95986cf950e9a1a371b9a072a0` (`tests/node/run_ui_unit_tests.js` checks it, and
  CVI's file when the checkout is present). The variable Open Sans 3.003, Latin subset, weights 300 to 800; its name
  records: "Copyright 2020 The Open Sans Project Authors (https://github.com/googlefonts/opensans)", license
  <http://scripts.sil.org/OFL>.
- License: SIL Open Font License 1.1, which allows bundling the font with software when the copyright notice and the
  license go with it: `shared/fonts/OFL.txt`: the font's copyright line, then the official OFL 1.1 text as
  <https://openfontlicense.org/documents/OFL.txt> gives it (read and compared on 2026-10-17).
- Loaded by `shared/brand.css` (`@font-face`) from the site itself; each page's policy allows fonts from the site's own
  files only (`font-src 'self' file:`). Nothing is fetched from the network.

## County Focus Streets background (`geo/streets-wa.js`, S9; loaded only when "Streets (vector)" is picked)

- Source: CVI's own `reference/tiger_wa/` files, read by `build/derive_streets.R`, which CVI's branded County Focus PNG draws its Streets background from. As CVI's comments
  name them: U.S. Census Bureau TIGER/Line primary and secondary roads and places (`primary_wa.rds`
  `c22bb812…5551`, `secondary_wa.rds` `3492194f…3450`, `places_wa.rds` `053050e7…4046`); USGS National Hydrography
  Dataset NHDArea wide rivers (`rivers_poly_wa.rds` `7e9057f1…b209`); Natural Earth coastline, lakes, rivers and urban
  areas (`coast_wa.rds` `6cd21d3d…08de`, `lakes_wa.rds` `dc1b94b4…a21a`, `rivers_wa.rds` `fd37e1a7…68f3`,
  `urban_wa.rds` `e5095aac…979b`; full SHA-256 values are printed by the script and kept in the file). All public
  domain; the PNG credits them on its source line ("Streets: U.S. Census Bureau TIGER/Line, USGS NHD, Natural Earth").
- Derivation: EPSG:4326, simplified at 0.0004 degrees (planar, as CVI's renderer), coordinates rounded to 4
  decimals, empty parts dropped; places kept as name, land area (CVI's label priority) and the planar center of each
  place's polygon. Output SHA-256 `55e94f2921d56f5767ab8a54b8b6651a815c8fe08498b3d9cd749e30f8270cad`, 2.8 MB.

## Population context (`geo/citylimits-wa.js`, `geo/places-wa.js`, `geo/tracts-wa.js`, PC; loaded only when a layer's switch is turned on)

- Sources (downloaded 2026-10-13; kept outside the repository, their folder given to the build script):
  - U.S. Census Bureau, 2020 cartographic boundary files `cb_2020_53_place_500k.zip` (SHA-256
    `9ba8c1b358ab955aa0ba526250ef8852bf2334db6d933fc2a5f0868da6d32ca9`) and `cb_2020_53_tract_500k.zip`
    (`86aa8a93a48e85142e4c552bcd2205576e2b0ab750711d8bf81030408738a5b4`), from
    <https://www2.census.gov/geo/tiger/GENZ2020/shp/>.
  - U.S. Census Bureau, 2020 Census redistricting data (PL 94-171) for Washington, `wa2020.pl.zip`
    (`dde77f2db632a4af274a968c39a7ab58fac6cfd90718e4a72ec239b84980db5b`), from
    <https://www2.census.gov/programs-surveys/decennial/2020/data/01-Redistricting_File--PL_94-171/Washington/>; only
    its geographic header is read, for each place's and tract's total population (`POP100`). (The Census
    Data API now needs a key, so this file is used instead.)
  - WA Department of Revenue, City Boundaries, ArcGIS service
    <https://webgis.dor.wa.gov/arcgis/rest/services/Ref/Cities/FeatureServer/0>, all 299 records as GeoJSON in
    EPSG:4326 (`a05caf3590f962dcc4280e26e4dc7177054350398d5916b39f12e71670697cb8`); it changes every quarter.
- Terms: the Census files are public domain, and the Census Bureau asks for acknowledgment as the source ("Population:
  U.S. Census Bureau, 2020 Census" on the map when a layer using it is drawn). The Department of Revenue's layer is
  freely available for use, public copies included; credited as "City limits: WA Department of Revenue".
- Derivation: `build/derive_population.R` checks the Census files' SHA-256 values, merges each city's pieces by Census
  place code, trims the city limits to land with `geo/wa-counties.js`, joins the 2020 population by GEOID ("53" + the
  place code for a city), works out tract density (people per square mile of land, `ALAND`) and its class (under 10,
  10–50, 50–250, 250–1,000, 1,000–5,000, 5,000 and over), and trims census-designated places to outside current city
  limits for the view with both outline layers on. Each city is named by its 2020 Census name, the source of the
  population shown; the Department of Revenue's spelling is kept as `dorName`
  where it differs (Krupp, La Crosse, Sedro Woolley). Shapes are simplified edge by edge (0.0002 degrees for city limits
  and places, 0.0004 for tracts, planar), rounded to 4 decimals, repaired where simplifying made them invalid, and
  stored as whole-number steps of 1/10,000 degree (each file's `encoding` field). Each file carries its sources'
  SHA-256 values. Output SHA-256: `citylimits-wa.js` `500a63a720f8733bcefeeef7beea0bf750fdc06165a14b6ccf242247470cfea7`
  (0.18 MB), `places-wa.js` `bd27c36ab38f7d8c1e65ffabf73a1676c19de3ebbb39374d319f84725ef5b07c` (0.32 MB),
  `tracts-wa.js` `2f858124dfc350837bbff0fef0b8b2f027f1326583bb118cd4d870e5daa726d6` (0.76 MB).

## ColorBrewer colors (`cvi/app/choropleth.js`, CH)

The shaded maps' color ramps (WA State's shaded counties and National Flow's shaded states) are
ColorBrewer 2.0's sequential schemes, chosen on 2026-10-16 with each scheme's palest classes dropped: Blues for Inbound (`#c6dbef`, `#6baed6`, `#2171b5`, `#08519c`, `#08306b`: classes 3, 5, 7, 8 and 9
of the 9-class Blues), Oranges for Outbound (`#fdd0a2`, `#fdae6b`, `#fd8d3c`, `#e6550d`, `#a63603`: classes 2 to 6 of
the 6-class Oranges) and GnBu for Combined (`#ccebc5`, `#7bccc4`, `#2b8cbe`, `#0868ac`, `#084081`: classes 3, 5, 7, 8
and 9 of the 9-class GnBu). Only the hex values are used, typed into the file from the published schemes; no
ColorBrewer file is bundled and nothing is fetched.

- Credit: ColorBrewer 2.0, Cynthia A. Brewer, Geography, Pennsylvania State University (<https://colorbrewer2.org>).
  The CVI page's "Data sources and credits" fold names it.
- License: the Apache License 2.0, as ColorBrewer publishes it (axismaps/colorbrewer, `LICENCE.txt`, read on
  2026-10-17). `COLORBREWER_LICENSE.txt` beside this file holds its attribution notice ("This product includes color
  specifications and designs developed by Cynthia Brewer (http://colorbrewer.org/).") and that license text.

## Own code

Everything in `site/` except `vendor/`, `shared/fonts/` and the generated data files in `geo/` (whose sources are
above): the landing page (`index.html`, `landing.js`), the CVI page (`cvi/`, with `cvi/app/choropleth.js`, whose colors
are ColorBrewer's, above), the Infrastructure dashboard (`infrastructure/`), the shared code (`shared/*.js`,
`shared/brand.css`), the build scripts (`build/*.R`) and `geo/regions/index.js`, and the tests, are new WSDA work
product (internal, not licensed for reuse, per the repository README). No source code of CVI or of the Partner Data
Viewer (another internal WSDA tool) was copied; the CVI files copied are the state centers above (S4), the WSDA logo
(S9) and the Open Sans font file (for the shared look). The behavior is ported from CVI's R code and checked against
CVI's functions run unmodified.


**Infrastructure dashboard (S6):** it uses the same MapLibre files, map adapter, basemap list and
request gate, neighboring-region files and credits as the CVI page; no other provider, host, font or data file. Its
footer carries the Statistics Canada adaptation and non-endorsement statements and the Open Government Licence –
Canada statement for the British Columbia regions. Facility files stay in the browser's memory.
