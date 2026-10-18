#!/usr/bin/env Rscript
# Population-context reference. Written apart from
# site/build/derive_population.R and sharing none of its code: it reads the four downloads in
# local-test-artifacts/pc/src/ itself and writes what the page's data files must hold, for
# tests/node/run_pc_unit_tests.js to compare:
#   - per city (WA Department of Revenue): place code, name, 2020 population; the rows without a place code (the
#     Hospital Benefit Zones expected), the join with the Census's incorporated places both ways and the
#     names that differ;
#   - per Census place: GEOID, name, kind, 2020 population, land area;
#   - per tract: GEOID, population, land area, density and density class; the water-only tracts left out;
#   - per census-designated place: trimmed or dropped for the view with both outline layers on, and its share of
#     land left (the rule below, worked out here by its own code);
#   - a cross-check of names and land areas against CVI's reference/tiger_wa/places_wa.rds, opened read-only;
#   - the shapes of the page's three files, decoded here: validity, the tracts' overlaps and gaps, and how much
#     each tract's area moved against the boundary file.
# Public data only (the four public downloads); no user data.
#
# Usage (repository root): Rscript tests/oracle/pc_population_oracle.R
# Writes local-test-artifacts/pc/oracle_pc.json. Needs R >= 4.4 with sf, jsonlite and openssl.

suppressPackageStartupMessages({ library(sf); library(jsonlite) })
invisible(suppressMessages(sf::sf_use_s2(FALSE)))
quietly <- function(x) suppressWarnings(suppressMessages(x))

args <- commandArgs(FALSE)
script <- sub("^--file=", "", args[grep("^--file=", args)])
repo <- normalizePath(file.path(dirname(script), "..", ".."))
src <- file.path(repo, "local-test-artifacts", "pc", "src")
out <- file.path(repo, "local-test-artifacts", "pc", "oracle_pc.json")
cvi <- Sys.getenv("CVI_TRACEABILITY_DIR", file.path(dirname(repo), "CVI_Traceability"))
sha <- function(p) paste(as.character(openssl::sha256(file(p))), collapse = "")

files <- c("cb_2020_53_place_500k.zip", "cb_2020_53_tract_500k.zip", "wa2020.pl.zip", "dor_city_boundaries.geojson")
for (f in files) if (!file.exists(file.path(src, f))) stop("Missing download: ", file.path(src, f))

# ---- The PL 94-171 header, read as a table (the build splits lines itself) ----
pl <- read.table(unz(file.path(src, "wa2020.pl.zip"), "wageo2020.pl"), sep = "|", quote = "", comment.char = "",
                 colClasses = "character", fill = TRUE, col.names = paste0("f", 1:97))
whole <- pl[pl$f5 == "00", ]
pl_pop <- function(sumlev) {
  rows <- whole[whole$f3 == sumlev, ]
  setNames(as.numeric(rows$f91), rows$f10)
}
state_pop <- unname(pl_pop("040"))
place_pop <- pl_pop("160")
tract_pop <- pl_pop("140")
tract_land_pl <- setNames(as.numeric(whole$f85[whole$f3 == "140"]), whole$f10[whole$f3 == "140"])
rm(pl, whole)

# ---- Census places and tracts ----
places <- quietly(sf::st_read(paste0("/vsizip/", file.path(src, files[1])), quiet = TRUE))
tracts <- quietly(sf::st_read(paste0("/vsizip/", file.path(src, files[2])), quiet = TRUE))
kind <- ifelse(places$LSAD == "25", "city", ifelse(places$LSAD == "43", "town", ifelse(places$LSAD == "57", "cdp", NA)))
place_rows <- data.frame(geoid = places$GEOID, name = places$NAME, kind = kind,
                         pop = unname(place_pop[places$GEOID]), aland = as.numeric(places$ALAND))
place_rows <- place_rows[order(place_rows$geoid), ]

density_class <- function(d) {
  if (d < 10) 0L else if (d < 50) 1L else if (d < 250) 2L else if (d < 1000) 3L else if (d < 5000) 4L else 5L
}
sq_miles <- as.numeric(tracts$ALAND) / (1609.344^2)
tract_rows <- data.frame(geoid = tracts$GEOID, pop = unname(tract_pop[tracts$GEOID]), aland = as.numeric(tracts$ALAND))
tract_rows$density <- tract_rows$pop / sq_miles
tract_rows$class <- vapply(tract_rows$density, density_class, 0L)
tract_rows <- tract_rows[order(tract_rows$geoid), ]
water_ids <- setdiff(names(tract_pop), tracts$GEOID)
water <- data.frame(geoid = water_ids, pop = unname(tract_pop[water_ids]), aland = unname(tract_land_pl[water_ids]))

# ---- Department of Revenue cities ----
dor <- quietly(sf::st_read(file.path(src, files[4]), quiet = TRUE))
code <- trimws(as.character(dor$PLACE))
no_code <- which(is.na(code) | code == "")
dor_ok <- dor[setdiff(seq_len(nrow(dor)), no_code), ]
dor_ok$geoid <- paste0("53", trimws(as.character(dor_ok$PLACE)))
groups <- split(seq_len(nrow(dor_ok)), dor_ok$geoid)
city_rows <- data.frame(
  geoid = names(groups),
  name = vapply(groups, function(i) as.character(dor_ok$CITY_DISSOLVE[i[1]]), ""),
  pieces = vapply(groups, length, 0L),
  names_in_pieces = vapply(groups, function(i) length(unique(dor_ok$CITY_DISSOLVE[i])), 0L))
city_rows$pop <- unname(place_pop[city_rows$geoid])
incorporated <- place_rows[place_rows$kind %in% c("city", "town"), ]
squash <- function(s) gsub("[^a-z]", "", tolower(s))
both <- merge(city_rows[, c("geoid", "name")], incorporated[, c("geoid", "name")], by = "geoid",
              suffixes = c("_dor", "_census"))
name_diffs <- both[squash(both$name_dor) != squash(both$name_census), ]

# ---- Census-designated places outside current city limits ----
# The rule: trimmed where the overlap with current city limits survives an opening of 25 m (a strip at
# least 50 m wide); what is left outside the limits, opened the same way and without parts under 1% of the place,
# is its trimmed shape; dropped below 10% of its land. Worked out over all places at once, in EPSG:5070.
land <- local({
  txt <- paste(readLines(file.path(repo, "site", "geo", "wa-counties.js"), warn = FALSE), collapse = "\n")
  geo <- fromJSON(sub(";\\s*$", "", sub("^[^{]*", "", txt)), simplifyVector = FALSE)
  counties <- quietly(sf::st_read(toJSON(geo$counties, auto_unbox = TRUE, digits = NA), quiet = TRUE))
  quietly(sf::st_union(sf::st_make_valid(sf::st_transform(counties, 5070))))
})
limits <- quietly(sf::st_intersection(sf::st_union(sf::st_make_valid(sf::st_transform(dor_ok, 5070))), land))
cdps <- sf::st_make_valid(sf::st_transform(places[places$LSAD == "57", ], 5070))
open25 <- function(g) {
  if (!length(g)) return(g)
  g <- sf::st_buffer(sf::st_buffer(g, -25), 25)
  g[!sf::st_is_empty(g)]
}
cdp_rows <- data.frame(geoid = cdps$GEOID, name = cdps$NAME, trim = "none", share = 1)
hits <- which(lengths(sf::st_intersects(cdps, limits)) > 0)
for (i in hits) {
  shape <- sf::st_geometry(cdps)[i]
  if (!length(open25(quietly(sf::st_intersection(shape, limits))))) next
  rest <- open25(quietly(sf::st_difference(shape, limits)))
  if (length(rest)) {
    parts <- sf::st_cast(rest, "POLYGON")
    rest_area <- sum(Filter(function(a) a >= 0.01 * as.numeric(sf::st_area(shape)), as.numeric(sf::st_area(parts))))
  } else {
    rest_area <- 0
  }
  cdp_rows$share[i] <- rest_area / as.numeric(sf::st_area(shape))
  cdp_rows$trim[i] <- if (cdp_rows$share[i] < 0.10) "dropped" else "clipped"
}
cdp_rows <- cdp_rows[order(cdp_rows$geoid), ]

# ---- CVI's places_wa.rds (read-only cross-check) ----
cvi_check <- local({
  rds <- file.path(cvi, "reference", "tiger_wa", "places_wa.rds")
  if (!file.exists(rds)) return(list(available = FALSE))
  x <- sf::st_drop_geometry(readRDS(rds))
  common <- intersect(x$GEOID, place_rows$geoid)
  ours <- place_rows[match(common, place_rows$geoid), ]
  theirs <- x[match(common, x$GEOID), ]
  ratio <- as.numeric(theirs$ALAND) / ours$aland
  renamed <- ours$name != theirs$NAME
  # Its TIGER vintage is later than 2020 (it has the GEOIDFQ column of 2023 and later). Census-designated places
  # lose land there where a city annexed part of them, which makes it a check of the trim rule above.
  cdp <- ours$kind == "cdp" & ratio != 1
  list(available = TRUE, sha256 = sha(rds), rows = nrow(x), common = length(common),
       only_cvi = sort(setdiff(x$GEOID, place_rows$geoid)), only_census = sort(setdiff(place_rows$geoid, x$GEOID)),
       names_differ = data.frame(geoid = common[renamed], census = ours$name[renamed], cvi = theirs$NAME[renamed]),
       cdp_land = data.frame(geoid = common[cdp], name = ours$name[cdp], ratio = ratio[cdp]),
       city_land_differs = sum(ours$kind != "cdp" & ratio != 1))
})

# ---- The page's files, decoded here ----
read_page_file <- function(f) {
  txt <- paste(readLines(file.path(repo, "site", "geo", f), warn = FALSE), collapse = "\n")
  fromJSON(sub(";\\s*$", "", sub("^[^{]*", "", txt)), simplifyVector = FALSE)
}
ring_of <- function(v) {
  m <- matrix(as.numeric(unlist(v)), ncol = 2, byrow = TRUE)
  cbind(cumsum(m[, 1]), cumsum(m[, 2])) / 1e4
}
shapes_of <- function(items) {
  sf::st_sfc(lapply(items, function(it) sf::st_multipolygon(lapply(it$shape, function(p) lapply(p, ring_of)))),
             crs = 4326)
}
page <- list(cities = read_page_file("citylimits-wa.js"), places = read_page_file("places-wa.js"),
             tracts = read_page_file("tracts-wa.js"))
invalid <- c(
  cities = sum(!sf::st_is_valid(shapes_of(page$cities$cities))),
  places = sum(!sf::st_is_valid(shapes_of(page$places$places))),
  cdpOutsideCities = sum(!sf::st_is_valid(shapes_of(page$places$cdpOutsideCities))),
  tracts = sum(!sf::st_is_valid(shapes_of(page$tracts$tracts))))
drawn <- sf::st_transform(shapes_of(page$tracts$tracts), 5070)
drawn_ids <- vapply(page$tracts$tracts, function(t) t$geoid, "")
source_shapes <- sf::st_transform(sf::st_geometry(tracts), 5070)[match(drawn_ids, tracts$GEOID)]
area_change <- abs(as.numeric(sf::st_area(drawn)) / as.numeric(sf::st_area(source_shapes)) - 1)
cover <- quietly(sf::st_union(sf::st_make_valid(drawn)))
overlap_m2 <- sum(as.numeric(sf::st_area(sf::st_make_valid(drawn)))) - as.numeric(sf::st_area(cover))
gap_m2 <- sum(vapply(sf::st_cast(cover, "POLYGON"), function(p) {
  if (length(p) < 2) return(0)
  sum(vapply(p[-1], function(h) as.numeric(sf::st_area(sf::st_sfc(sf::st_polygon(list(h)), crs = 5070))), 0))
}, 0))

ref <- list(
  meta = list(oracle_sha256 = sha(script), sources = setNames(lapply(files, function(f) sha(file.path(src, f))), files),
              page_files = list(cities = sha(file.path(repo, "site/geo/citylimits-wa.js")),
                                places = sha(file.path(repo, "site/geo/places-wa.js")),
                                tracts = sha(file.path(repo, "site/geo/tracts-wa.js")))),
  state_pop = state_pop,
  dor = list(rows = nrow(dor), rows_without_place = as.integer(no_code), cities = city_rows),
  join = list(only_dor = setdiff(city_rows$geoid, incorporated$geoid),
              only_census = setdiff(incorporated$geoid, city_rows$geoid), name_diffs = name_diffs),
  places = place_rows, tracts = tract_rows, water_tracts = water, cdps = cdp_rows, cvi_places = cvi_check,
  shapes = list(invalid = as.list(invalid), tract_overlap_m2 = overlap_m2, tract_gap_m2 = gap_m2,
                tract_area_change_median = median(area_change), tract_area_change_max = max(area_change)))
dir.create(dirname(out), recursive = TRUE, showWarnings = FALSE)
write_json(ref, out, auto_unbox = TRUE, null = "null", na = "null", digits = I(15), dataframe = "rows")
cat(sprintf("Cities %d (DOR rows %d, without a place code %d); places %d; tracts %d (+%d water-only); CDPs trimmed %d, dropped %d\n",
            nrow(city_rows), nrow(dor), length(no_code), nrow(place_rows), nrow(tract_rows), nrow(water),
            sum(cdp_rows$trim == "clipped"), sum(cdp_rows$trim == "dropped")))
if (isTRUE(cvi_check$available)) {
  cat(sprintf("CVI places_wa.rds: %d rows, %d in common; names differ %d; land differs: CDPs %d, cities and towns %d\n",
              cvi_check$rows, cvi_check$common, nrow(cvi_check$names_differ), nrow(cvi_check$cdp_land),
              cvi_check$city_land_differs))
}
cat(sprintf("Shapes: invalid %s; tract overlap %.0f m2, gaps %.0f m2; tract area change median %.3f%%, max %.2f%%\n",
            paste(names(invalid), invalid, collapse = " "), overlap_m2, gap_m2, 100 * median(area_change),
            100 * max(area_change)))
cat("Wrote ", out, "\n", sep = "")
