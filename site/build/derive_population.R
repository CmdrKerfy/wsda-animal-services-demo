#!/usr/bin/env Rscript
# Derive the population-context layers:
#   geo/citylimits-wa.js  current city limits (WA Department of Revenue) with each city's 2020 Census population
#   geo/places-wa.js      2020 Census places (cities, towns, census-designated places) with their 2020 population
#   geo/tracts-wa.js      2020 Census tracts with population, land area, density and density class
# from four public downloads kept in a folder outside the repository's tracked files (its path is the first argument):
#   cb_2020_53_place_500k.zip    U.S. Census Bureau 2020 cartographic boundary file, places (public domain)
#   cb_2020_53_tract_500k.zip    same, tracts
#   wa2020.pl.zip                2020 Census redistricting data (PL 94-171) for Washington; only its geographic
#                                header wageo2020.pl is read, for each place's and tract's total population (POP100)
#   dor_city_boundaries.geojson  WA Department of Revenue City Boundaries (ArcGIS service Ref/Cities, layer 0) as
#                                GeoJSON in EPSG:4326; free to use
# One-off, developer-time step; the page never runs R. Each source's SHA-256 is checked or printed and written into
# the outputs.
#
# Usage (from the repository root):
#   Rscript site/build/derive_population.R <source folder> [--out <folder>] [--dor-date YYYY-MM-DD]
# The Census files must match the SHA-256 values below. The Department of Revenue's file changes every quarter: a
# download other than the recorded one needs --dor-date (the day it was downloaded).
#
# Needs: R >= 4.4 with sf, jsonlite and openssl already installed. Writes only the three files in <out>
# (default site/geo/).
#
# Steps: city pieces merged by place code and trimmed to land with the site's county outlines (geo/wa-counties.js);
# populations joined by GEOID (a city's GEOID is "53" + its place code); tract density = people per square mile of
# land; census-designated places trimmed to outside current city limits for the view with both outline layers on.
# Shapes are simplified edge by edge (simplify_shared below), so neighbors keep sharing their lines, then rounded
# to DIGITS. The build stops on any failed check or a file over its size budget.

suppressPackageStartupMessages({ library(sf); library(jsonlite) })
sf_use_s2 <- function(x) suppressMessages(sf::sf_use_s2(x))
# Planar operations on longitude and latitude are deliberate (as in derive_streets.R); sf's note about them is
# silenced.
st_union <- function(...) suppressMessages(sf::st_union(...))

DIGITS <- 4L              # about 10 m
KEY_DIGITS <- 6L          # vertices equal to this many decimals count as shared
TOLERANCE <- c(cities = 0.0002, places = 0.0002, tracts = 0.0004)   # degrees, planar
BUDGET_MB <- c(cities = 0.6, places = 1.0, tracts = 1.5)
BREAKS <- c(10, 50, 250, 1000, 5000)   # people per sq mi of land: six classes, under 10 to 5,000 and over
SQ_METERS_PER_SQ_MILE <- 2589988.110336
SLIVER_METERS <- 25       # strips narrower than twice this are slivers between the two sources' lines
DROP_SHARE <- 0.10        # a census-designated place with less than this share of its land left is dropped
STATE_POP_2020 <- 7705281 # Washington, 2020 Census (census.gov); the tracts must add up to it exactly

CENSUS_SHA256 <- c(
  "cb_2020_53_place_500k.zip" = "9ba8c1b358ab955aa0ba526250ef8852bf2334db6d933fc2a5f0868da6d32ca9",
  "cb_2020_53_tract_500k.zip" = "86aa8a93a48e85142e4c552bcd2205576e2b0ab750711d8bf81030408738a5b4",
  "wa2020.pl.zip" = "dde77f2db632a4af274a968c39a7ab58fac6cfd90718e4a72ec239b84980db5b")
DOR_FILE <- "dor_city_boundaries.geojson"
DOR_RECORDED <- list(sha256 = "a05caf3590f962dcc4280e26e4dc7177054350398d5916b39f12e71670697cb8",
                     date = "2026-10-13")

args <- commandArgs(trailingOnly = TRUE)
take_option <- function(name) {
  at <- match(name, args)
  if (is.na(at)) return(NULL)
  value <- args[at + 1L]
  args <<- args[-c(at, at + 1L)]
  value
}
out_dir <- take_option("--out")
if (is.null(out_dir)) out_dir <- file.path("site", "geo")
dor_date <- take_option("--dor-date")
if (!length(args)) stop("Give the folder holding the four downloads: Rscript site/build/derive_population.R <folder>")
src <- args[1]
files <- c(names(CENSUS_SHA256), DOR_FILE)
missing <- files[!file.exists(file.path(src, files))]
if (length(missing)) stop("Missing in ", src, ": ", paste(missing, collapse = ", "))
counties_js <- file.path("site", "geo", "wa-counties.js")
if (!file.exists(counties_js)) stop("Run from the repository root (", counties_js, " not found).")

sha256 <- function(p) paste(as.character(openssl::sha256(file(p))), collapse = "")
shas <- setNames(lapply(files, function(f) sha256(file.path(src, f))), files)
for (f in files) cat(sprintf("%-28s %s\n", f, shas[[f]]))
for (f in names(CENSUS_SHA256)) {
  if (!identical(shas[[f]], CENSUS_SHA256[[f]])) stop("SHA-256 of ", f, " is not the recorded one.")
}
if (identical(shas[[DOR_FILE]], DOR_RECORDED$sha256)) {
  if (is.null(dor_date)) dor_date <- DOR_RECORDED$date
} else if (is.null(dor_date)) {
  stop("A new Department of Revenue download: pass --dor-date YYYY-MM-DD (the day it was downloaded).")
}
if (!grepl("^\\d{4}-\\d{2}-\\d{2}$", dor_date)) stop("--dor-date must be YYYY-MM-DD.")
dor_quarter <- sprintf("%s Q%d", substr(dor_date, 1, 4), (as.integer(substr(dor_date, 6, 7)) - 1L) %/% 3L + 1L)

sf_use_s2(FALSE)

# ---- Populations: the PL 94-171 geographic header ----
# Pipe-separated, 97 fields. Used: 3 SUMLEV (140 tract, 160 place), 5 GEOCOMP (00 = the whole area),
# 10 GEOCODE (the GEOID), 85 AREALAND, 91 POP100 (total population).
geo_lines <- readLines(unz(file.path(src, "wa2020.pl.zip"), "wageo2020.pl"))
# strsplit drops empty fields at the end of a line, so a marker field is added and removed again.
geo <- strsplit(paste0(geo_lines, "|end"), "|", fixed = TRUE)
if (any(lengths(geo) != 98L)) stop("wageo2020.pl does not have the 2020 header's 97 fields on every line.")
geo <- do.call(rbind, geo)[, 1:97]
pl_rows <- function(sumlev) {
  g <- geo[geo[, 3] == sumlev & geo[, 5] == "00", , drop = FALSE]
  data.frame(geoid = g[, 10], aland = as.numeric(g[, 85]), pop = as.numeric(g[, 91]), stringsAsFactors = FALSE)
}
pl_state <- pl_rows("040")
pl_tracts <- pl_rows("140")
pl_places <- pl_rows("160")
rm(geo, geo_lines)
if (nrow(pl_state) != 1L || pl_state$pop != STATE_POP_2020) stop("The PL file's state total is not ", STATE_POP_2020)
if (sum(pl_tracts$pop) != STATE_POP_2020) stop("The PL file's tracts do not add up to the state total.")

# ---- Boundaries ----
read_zip <- function(f) sf::st_transform(sf::st_read(paste0("/vsizip/", file.path(src, f)), quiet = TRUE), 4326)
places <- read_zip("cb_2020_53_place_500k.zip")
tracts <- read_zip("cb_2020_53_tract_500k.zip")
dor <- sf::st_read(file.path(src, DOR_FILE), quiet = TRUE)

counties_text <- paste(readLines(counties_js, warn = FALSE), collapse = "\n")
counties_text <- sub(";\\s*$", "", sub("^[^{]*", "", counties_text))
counties_geojson <- toJSON(fromJSON(counties_text, simplifyVector = FALSE)$counties, auto_unbox = TRUE,
                           digits = NA)
land <- st_union(sf::st_make_valid(sf::st_read(counties_geojson, quiet = TRUE)))

# Tracts: every boundary-file tract has a PL row; the PL tracts missing from the boundary file are water only.
if (!all(tracts$GEOID %in% pl_tracts$geoid)) stop("A boundary-file tract has no population row.")
water_only <- pl_tracts[!(pl_tracts$geoid %in% tracts$GEOID), ]
if (any(water_only$pop != 0 | water_only$aland != 0)) stop("A tract with land or people is missing from the boundaries.")
cat(sprintf("Tracts: %d in the boundary file, %d water-only tracts left out (no land, no people)\n",
            nrow(tracts), nrow(water_only)))

# Places: the boundary file and the PL file hold the same places.
if (!setequal(places$GEOID, pl_places$geoid)) stop("The places in the boundary file and the PL file differ.")
kind_of <- c("25" = "city", "43" = "town", "57" = "cdp")
if (!all(places$LSAD %in% names(kind_of))) stop("A place of an unexpected kind (LSAD).")
places$kind <- unname(kind_of[places$LSAD])
places$pop <- pl_places$pop[match(places$GEOID, pl_places$geoid)]
cat(sprintf("Places: %d (%d cities, %d towns, %d census-designated places)\n", nrow(places),
            sum(places$kind == "city"), sum(places$kind == "town"), sum(places$kind == "cdp")))

# City limits: every piece carries its place code; a city's pieces share one code and are merged.
dor$PLACE <- trimws(as.character(dor$PLACE))
if (any(is.na(dor$PLACE) | !grepl("^\\d{5}$", dor$PLACE))) {
  stop("A Department of Revenue row has no place code (a Hospital Benefit Zone or other non-city row?).")
}
codes_per_name <- tapply(dor$PLACE, dor$CITY_DISSOLVE, function(x) length(unique(x)))
if (any(codes_per_name > 1)) stop("A city's pieces carry different place codes.")
dor$GEOID <- paste0("53", dor$PLACE)
city_ids <- sort(unique(dor$GEOID))
cities <- do.call(rbind, lapply(city_ids, function(id) {
  pieces <- dor[dor$GEOID == id, ]
  sf::st_sf(GEOID = id, name = as.character(pieces$CITY_DISSOLVE[1]),
            geometry = st_union(sf::st_make_valid(sf::st_geometry(pieces))))
}))
before <- as.numeric(sf::st_area(sf::st_transform(cities, 5070)))
cities <- suppressMessages(suppressWarnings(sf::st_intersection(cities, land)))
cities <- cities[!sf::st_is_empty(cities), ]
after <- as.numeric(sf::st_area(sf::st_transform(cities, 5070)))
cat(sprintf("City limits: %d pieces, %d cities; %.1f%% of their area is water and trimmed\n",
            nrow(dor), nrow(cities), 100 * (1 - sum(after) / sum(before))))
if (nrow(cities) != length(city_ids)) stop("A city lies wholly in water after the shoreline trim.")

incorporated <- places[places$kind != "cdp", ]
cities$pop <- pl_places$pop[match(cities$GEOID, pl_places$geoid)]
only_dor <- setdiff(cities$GEOID, incorporated$GEOID)
only_census <- setdiff(incorporated$GEOID, cities$GEOID)
plain <- function(s) gsub("[^a-z]", "", tolower(s))
both <- intersect(cities$GEOID, incorporated$GEOID)
name_dor <- cities$name[match(both, cities$GEOID)]
name_census <- incorporated$NAME[match(both, incorporated$GEOID)]
renamed <- both[plain(name_dor) != plain(name_census)]
cat(sprintf("Join: %d cities matched by place code; only in DOR: %s; only in the Census: %s\n", length(both),
            if (length(only_dor)) paste(only_dor, collapse = ", ") else "none",
            if (length(only_census)) paste(only_census, collapse = ", ") else "none"))
for (id in renamed) {
  cat(sprintf("  Name differs, %s: DOR \"%s\", Census \"%s\"\n", id, cities$name[cities$GEOID == id],
              incorporated$NAME[incorporated$GEOID == id]))
}
# The layers print the 2020 Census name, the same source as the population shown:
# "Sedro-Woolley", "LaCrosse", "Krupp (Marlin)". The Department of Revenue's spelling is kept as
# dorName wherever it differs, even in punctuation only.
cities$dor_name <- cities$name
matched <- match(cities$GEOID, incorporated$GEOID)
cities$name[!is.na(matched)] <- as.character(incorporated$NAME[matched[!is.na(matched)]])

# ---- Census-designated places outside current city limits (both outline layers on) ----
# A place counts as trimmed only where it overlaps the city limits by more than a sliver; its trimmed shape is
# what lies outside the city limits, slivers removed, and it is dropped when less than DROP_SHARE of its land is
# left. Areas in EPSG:5070 (equal area, meters).
opening <- function(g, r) {
  g <- sf::st_buffer(sf::st_buffer(g, -r), r)
  g[!sf::st_is_empty(g)]
}
without_small_parts <- function(g, min_area) {
  parts <- sf::st_cast(sf::st_sfc(g, crs = 5070), "POLYGON")
  parts <- parts[as.numeric(sf::st_area(parts)) >= min_area]
  if (!length(parts)) return(NULL)
  st_union(parts)
}
city_area <- st_union(sf::st_transform(sf::st_geometry(cities), 5070))
cdp <- places[places$kind == "cdp", ]
cdp5 <- sf::st_make_valid(sf::st_transform(sf::st_geometry(cdp), 5070))
cdp$trim <- "none"
cdp$share <- 1
trimmed <- list()
for (i in seq_along(cdp5)) {
  overlap <- suppressWarnings(sf::st_intersection(cdp5[i], city_area))
  if (!length(overlap) || sf::st_is_empty(overlap)) next
  if (!length(opening(overlap, SLIVER_METERS))) next
  area0 <- as.numeric(sf::st_area(cdp5[i]))
  rest <- suppressWarnings(sf::st_difference(cdp5[i], city_area))
  rest <- if (length(rest)) opening(rest, SLIVER_METERS) else rest
  rest <- if (length(rest)) without_small_parts(rest[[1]], 0.01 * area0) else NULL
  share <- if (is.null(rest)) 0 else as.numeric(sf::st_area(rest)) / area0
  cdp$share[i] <- share
  if (share < DROP_SHARE) {
    cdp$trim[i] <- "dropped"
  } else {
    cdp$trim[i] <- "clipped"
    trimmed[[cdp$GEOID[i]]] <- sf::st_transform(rest, 4326)[[1]]
  }
}
cat(sprintf("Census-designated places overlapping city limits: %d trimmed, %d dropped (below %d%% of their land)\n",
            sum(cdp$trim == "clipped"), sum(cdp$trim == "dropped"), round(100 * DROP_SHARE)))
for (i in which(cdp$trim != "none")) {
  cat(sprintf("  %-28s %s, %.1f%% of its land left\n", cdp$NAME[i], cdp$trim[i], 100 * cdp$share[i]))
}

# ---- Shared-edge simplification ----
# Neighbors (tracts, adjacent cities) share their edges vertex for vertex. Simplifying each shape alone would move
# a shared edge differently on each side and open hairline gaps, so each ring is cut at its junctions (vertices
# with more than two neighbors), each stretch between junctions is simplified once (Douglas-Peucker, ends kept)
# and every ring that runs along it reuses the result.
douglas_peucker <- function(m, tol) {
  n <- nrow(m)
  if (n <= 2L) return(m)
  keep <- logical(n)
  keep[c(1L, n)] <- TRUE
  stack <- list(c(1L, n))
  while (length(stack)) {
    span <- stack[[length(stack)]]
    stack[[length(stack)]] <- NULL
    a <- span[1]
    b <- span[2]
    if (b - a < 2L) next
    i <- (a + 1L):(b - 1L)
    dx <- m[b, 1] - m[a, 1]
    dy <- m[b, 2] - m[a, 2]
    len <- sqrt(dx * dx + dy * dy)
    d <- if (len == 0) {
      sqrt((m[i, 1] - m[a, 1])^2 + (m[i, 2] - m[a, 2])^2)
    } else {
      abs(dy * (m[i, 1] - m[a, 1]) - dx * (m[i, 2] - m[a, 2])) / len
    }
    k <- which.max(d)
    if (d[k] > tol) {
      j <- i[k]
      keep[j] <- TRUE
      stack[[length(stack) + 1L]] <- c(a, j)
      stack[[length(stack) + 1L]] <- c(j, b)
    }
  }
  m[keep, , drop = FALSE]
}

polygons_of <- function(g) {
  if (inherits(g, "POLYGON")) return(list(unclass(g)))
  if (inherits(g, "MULTIPOLYGON")) return(unclass(g))
  if (inherits(g, "GEOMETRYCOLLECTION")) return(do.call(c, lapply(g, polygons_of)))
  list()
}

ring_area <- function(m) abs(sum(m[-nrow(m), 1] * m[-1, 2] - m[-1, 1] * m[-nrow(m), 2])) / 2

clean_ring <- function(m) {
  m <- round(m, DIGITS)
  keep <- c(TRUE, rowSums(abs(m[-1, , drop = FALSE] - m[-nrow(m), , drop = FALSE])) > 0)
  m <- m[keep, , drop = FALSE]
  if (nrow(m) < 4L || ring_area(m) == 0) NULL else m
}

# geoms: a list of POLYGON or MULTIPOLYGON shapes in EPSG:4326. Returns, for each, a list of polygons, each a list
# of rings (n x 2 matrices, closed). A shape that would vanish keeps its rounded, unsimplified rings.
simplify_shared <- function(geoms, tol) {
  rings <- list()
  where <- list()
  for (f in seq_along(geoms)) {
    polys <- polygons_of(geoms[[f]])
    for (p in seq_along(polys)) {
      for (r in seq_along(polys[[p]])) {
        rings[[length(rings) + 1L]] <- round(polys[[p]][[r]][, 1:2, drop = FALSE], KEY_DIGITS)
        where[[length(where) + 1L]] <- c(f, p, r)
      }
    }
  }
  all <- do.call(rbind, rings)
  keys <- paste(all[, 1], all[, 2])
  first <- !duplicated(keys)
  coords <- all[first, , drop = FALSE]
  vertex <- match(keys, keys[first])
  ids <- split(vertex, rep(seq_along(rings), vapply(rings, nrow, 1L)))
  ids <- lapply(ids, function(v) v[c(TRUE, diff(v) != 0)])

  from <- unlist(lapply(ids, function(v) v[-length(v)]))
  to <- unlist(lapply(ids, function(v) v[-1]))
  lo <- pmin(from, to)
  hi <- pmax(from, to)
  edge <- !duplicated(lo * (nrow(coords) + 1) + hi)
  degree <- tabulate(c(lo[edge], hi[edge]), nbins = nrow(coords))
  junction <- degree != 2L

  cache <- new.env(hash = TRUE)
  arc <- function(v) {
    n <- length(v)
    flip <- v[1] > v[n] || (v[1] == v[n] && n > 2L && v[2] > v[n - 1L])
    cv <- if (flip) rev(v) else v
    key <- paste(cv, collapse = ",")
    if (nchar(key) > 9000L) key <- as.character(openssl::sha256(key))   # R's limit on names is 10,000 bytes
    out <- cache[[key]]
    if (is.null(out)) {
      out <- douglas_peucker(coords[cv, , drop = FALSE], tol)
      assign(key, out, envir = cache)
    }
    if (flip) out[nrow(out):1, , drop = FALSE] else out
  }
  simplify_ring <- function(v) {
    v <- v[-length(v)]
    j <- which(junction[v])
    start <- if (length(j)) j[1] else which.min(v)
    v <- c(v[start:length(v)], v[seq_len(start - 1L)], v[start])
    if (!length(j)) return(arc(v))
    cut <- which(junction[v])
    pieces <- lapply(seq_len(length(cut) - 1L), function(k) arc(v[cut[k]:cut[k + 1L]]))
    do.call(rbind, c(pieces[1], lapply(pieces[-1], function(p) p[-1, , drop = FALSE])))
  }

  out <- lapply(geoms, function(g) lapply(polygons_of(g), function(p) list()))
  gone <- lapply(out, function(polys) logical(length(polys)))
  for (k in seq_along(rings)) {
    w <- where[[k]]
    ring <- clean_ring(simplify_ring(ids[[k]]))
    if (is.null(ring)) {
      if (w[3] == 1L) gone[[w[1]]][w[2]] <- TRUE   # outer ring vanished: the polygon goes, holes with it
      next
    }
    out[[w[1]]][[w[2]]][[w[3]]] <- ring
  }
  kept_whole <- 0L
  repaired <- 0L
  for (f in seq_along(out)) {
    polys <- lapply(out[[f]][!gone[[f]]], function(p) Filter(Negate(is.null), p))
    if (!length(polys)) {
      kept_whole <- kept_whole + 1L
      polys <- lapply(polygons_of(geoms[[f]]), function(p) Filter(Negate(is.null), lapply(p, clean_ring)))
    }
    # Simplifying can make two stretches of one shape cross, and rounding can pinch a ring onto itself. Such a
    # shape is repaired where it is broken (sf's st_make_valid), which leaves its other edges, shared ones
    # included, as they are.
    if (!sf::st_is_valid(sf::st_multipolygon(polys))) {
      repaired <- repaired + 1L
      fixed <- polygons_of(sf::st_make_valid(sf::st_multipolygon(polys)))
      polys <- Filter(length, lapply(fixed, function(p) Filter(Negate(is.null), lapply(p, clean_ring))))
    }
    out[[f]] <- polys
  }
  attr(out, "kept_whole") <- kept_whole
  attr(out, "repaired") <- repaired
  attr(out, "invalid") <- sum(!vapply(out, function(s) sf::st_is_valid(sf::st_multipolygon(s)), TRUE))
  out
}

# ---- Writing ----
label_point <- function(g) {
  polys <- polygons_of(g)
  areas <- vapply(polys, function(p) ring_area(p[[1]]), 0)
  pt <- sf::st_point_on_surface(sf::st_polygon(polys[[which.max(areas)]]))
  round(as.numeric(pt), DIGITS)
}
# Shapes are stored compactly: a shape is a list of polygons, each a list of rings (the outline, then any holes),
# and a ring is whole numbers of 1/10,000 degree: the first point's longitude and latitude, then each point's
# change from the one before. Written out as plain coordinates, the tracts were over their size budget even at
# twice the tolerance; this keeps the detail at about half the size. population.js decodes it.
ENCODING <- paste("shape = list of polygons; polygon = list of rings (outline first, then holes); ring = [lon0, lat0,",
                  "dlon1, dlat1, ...] in whole units of 1/10,000 degree: the first point, then each point's change",
                  "from the one before; rings are closed (the last point equals the first).")
encode_ring <- function(m) {
  q <- round(m * 10^DIGITS)
  as.integer(t(rbind(q[1, ], diff(q))))
}
feature <- function(props, polys) c(props, list(shape = lapply(polys, function(p) lapply(p, encode_ring))))
count_points <- function(shapes) sum(vapply(shapes, function(s) sum(vapply(s, function(p) {
  sum(vapply(p, nrow, 1L))
}, 1L)), 1L))

write_layer <- function(name, global, comment, content) {
  target <- file.path(out_dir, name)
  writeLines(c(paste0("/* ", comment, " Do not edit. */"),
               paste0("window.", global, " = ", toJSON(content, auto_unbox = TRUE, digits = NA, na = "null"), ";")),
             target)
  target
}

dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)
census_credit <- "Population: U.S. Census Bureau, 2020 Census"
census_sha <- shas[names(CENSUS_SHA256)]

city_shapes <- simplify_shared(sf::st_geometry(cities), TOLERANCE[["cities"]])
city_features <- lapply(seq_len(nrow(cities)), function(i) {
  props <- list(geoid = cities$GEOID[i], name = cities$name[i])
  if (cities$dor_name[i] != cities$name[i]) props$dorName <- cities$dor_name[i]
  feature(c(props, list(pop = cities$pop[i], label = label_point(sf::st_geometry(cities)[[i]]))), city_shapes[[i]])
})

place_shapes <- simplify_shared(sf::st_geometry(places), TOLERANCE[["places"]])
place_features <- lapply(seq_len(nrow(places)), function(i) {
  props <- list(geoid = places$GEOID[i], name = as.character(places$NAME[i]), kind = places$kind[i],
                pop = places$pop[i], label = label_point(sf::st_geometry(places)[[i]]))
  if (places$kind[i] == "cdp") props$trim <- cdp$trim[match(places$GEOID[i], cdp$GEOID)]
  feature(props, place_shapes[[i]])
})
trimmed_shapes <- if (length(trimmed)) simplify_shared(trimmed, TOLERANCE[["places"]]) else list()
trimmed_features <- lapply(seq_along(trimmed), function(i) {
  id <- names(trimmed)[i]
  feature(list(geoid = id, name = as.character(cdp$NAME[cdp$GEOID == id]), share = round(cdp$share[cdp$GEOID == id], 4),
               label = label_point(trimmed[[i]])), trimmed_shapes[[i]])
})

tract_shapes <- simplify_shared(sf::st_geometry(tracts), TOLERANCE[["tracts"]])
tract_pop <- pl_tracts$pop[match(tracts$GEOID, pl_tracts$geoid)]
if (any(as.numeric(tracts$ALAND) <= 0)) stop("A boundary-file tract has no land area.")
tract_density <- tract_pop / (as.numeric(tracts$ALAND) / SQ_METERS_PER_SQ_MILE)
tract_features <- lapply(seq_len(nrow(tracts)), function(i) feature(list(
  geoid = tracts$GEOID[i], pop = tract_pop[i], aland = as.numeric(tracts$ALAND[i]),
  density = round(tract_density[i], 1), class = findInterval(tract_density[i], BREAKS)), tract_shapes[[i]]))
if (sum(tract_pop) != STATE_POP_2020) stop("The tracts drawn do not add up to the state total.")

written <- c(
  cities = write_layer("citylimits-wa.js", "WSDA_CITYLIMITS",
    "Generated by build/derive_population.R from the WA Department of Revenue's City Boundaries and the 2020 Census.",
    list(source = paste0("WA Department of Revenue, City Boundaries (webgis.dor.wa.gov, Ref/Cities), downloaded ",
                         dor_date, "; pieces merged by Census place code and trimmed to land with the county outlines; ",
                         "2020 population from the U.S. Census Bureau's 2020 redistricting data (PL 94-171)."),
         credit = "City limits: WA Department of Revenue", populationCredit = census_credit,
         downloaded = dor_date, quarter = dor_quarter, populationYear = 2020L,
         sha256 = c(shas[DOR_FILE], census_sha["wa2020.pl.zip"]),
         tolerance = TOLERANCE[["cities"]], encoding = ENCODING, cities = city_features)),
  places = write_layer("places-wa.js", "WSDA_PLACES",
    "Generated by build/derive_population.R from public-domain 2020 Census files.",
    list(source = paste("U.S. Census Bureau, 2020 cartographic boundary file cb_2020_53_place_500k and 2020",
                        "redistricting data (PL 94-171); public domain. Census-designated places are also given",
                        "trimmed to outside the WA Department of Revenue's city limits of", dor_date,
                        "(slivers under", 2 * SLIVER_METERS, "m wide removed; dropped below",
                        paste0(round(100 * DROP_SHARE), "%"), "of their land)."),
         credit = census_credit, year = 2020L,
         sha256 = c(census_sha[c("cb_2020_53_place_500k.zip", "wa2020.pl.zip")], shas[DOR_FILE]),
         tolerance = TOLERANCE[["places"]], encoding = ENCODING, places = place_features,
         cdpOutsideCities = trimmed_features)),
  tracts = write_layer("tracts-wa.js", "WSDA_TRACTS",
    "Generated by build/derive_population.R from public-domain 2020 Census files.",
    list(source = paste("U.S. Census Bureau, 2020 cartographic boundary file cb_2020_53_tract_500k and 2020",
                        "redistricting data (PL 94-171); public domain. Density = people per square mile of land",
                        "(ALAND). Water-only tracts (no land, no people) are not in the boundary file."),
         credit = census_credit, year = 2020L, breaks = BREAKS,
         sha256 = census_sha[c("cb_2020_53_tract_500k.zip", "wa2020.pl.zip")],
         tolerance = TOLERANCE[["tracts"]], encoding = ENCODING, tracts = tract_features)))

shapes <- list(cities = list(city_shapes), places = list(place_shapes, trimmed_shapes), tracts = list(tract_shapes))
over <- character()
for (k in names(written)) {
  mb <- file.info(written[[k]])$size / 1e6
  points <- sum(vapply(shapes[[k]], count_points, 1L))
  count <- function(what) sum(vapply(shapes[[k]], function(s) attr(s, what) %||% 0L, 1L))
  cat(sprintf("Wrote %s: %.2f MB (budget %.1f), %d points; shapes kept unsimplified %d, repaired %d, still invalid %d\n",
              written[[k]], mb, BUDGET_MB[[k]], points, count("kept_whole"), count("repaired"), count("invalid")))
  if (mb > BUDGET_MB[[k]]) over <- c(over, k)
}
if (length(over)) stop("Over the size budget: ", paste(over, collapse = ", "), ". Raise TOLERANCE for it.")
