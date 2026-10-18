#!/usr/bin/env Rscript
# Derive the two state files of the National Flow map:
#   geo/us-states.js     the outlines of the 48 contiguous states and DC (the set CVI draws), each the union of its
#                        counties in the U.S. Census Bureau 2023 cartographic boundary file cb_2023_us_county_500k.zip
#                        (public domain; acknowledgment required; the same file and SHA-256 as geo/wa-counties.js);
#   geo/state-centers.js CVI's state centers, copied exactly from CVI's reference/state_capitals.csv (SHA-256
#                        pinned below), so every flow line ends where CVI's ends.
# One-off, developer-time step; the page never runs R.
#
# Usage (from the repository root):
#   Rscript site/build/derive_states.R <folder with cb_2023_us_county_500k.zip> [<path to state_capitals.csv>] [--out <folder>]
# The centers file defaults to ../CVI_Traceability/reference/state_capitals.csv (CVI checkout next to this repository).
#
# Needs: R >= 4.4 with sf, jsonlite and openssl already installed. Writes only <out>/us-states.js and
# <out>/state-centers.js (default site/geo/). Outlines: counties in EPSG:4326, coordinates rounded to DIGITS with repeated
# points dropped (4 decimals, as the NR county files), unioned per state; then the states' border network simplified once at TOLERANCE degrees (each line
# between junctions on its own, end points kept, as derive_regions.R does for British Columbia), so two neighbors keep
# one border; islands under MIN_KM2 left out; rounded again. Stops on a count, code, validity, extent, area or center
# check that fails. Every center must lie inside its own state: the drawn outline, or for Alaska and Hawaii (not drawn)
# the union of their own Census counties; Hawaii's, which lies at sea as USGS's does, inside the convex hull of its main
# islands (east of 161 degrees west: the Northwestern Hawaiian Islands, which reach Kure Atoll, left out) and at most
# MAX_SEA_KM from land.

suppressPackageStartupMessages({ library(sf); library(jsonlite) })
sf_use_s2 <- function(x) suppressMessages(sf::sf_use_s2(x))

DIGITS <- 3L          # about 100 m, below the simplification tolerance
TOLERANCE <- 0.005    # degrees, about 500 m (chosen by eye at zoom 3.6 to 6)
MIN_KM2 <- 2          # islands below this area are left out (a state keeps at least its largest polygon)
CENSUS <- list(file = "cb_2023_us_county_500k.zip",
               sha256 = "99d6597b1fc7767deef62e01d28d8b5dcbd578e151855f7dc0d173cbf5bf0868",
               url = "https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_county_500k.zip",
               describe = "U.S. Census Bureau, 2023 cartographic boundary file cb_2023_us_county_500k")
CENTERS <- list(sha256 = "c00bad8aebd88a3bf8a1a6a43d06bbf8d2fdf956c2babe1da4dd201bcebd568a",
                describe = "CVI's reference/state_capitals.csv")
# Left out of the outlines: Alaska, Hawaii (CVI draws neither) and the territories.
NOT_DRAWN <- c("02", "15", "60", "66", "69", "72", "78")
COUNT <- 49L
EXTENT <- c(-124.85, 24.39, -66.88, 49.39)   # lon/lat box the outlines must lie in (the contiguous states)

args <- commandArgs(trailingOnly = TRUE)
out_i <- which(args == "--out")
out_dir <- NULL
if (length(out_i)) { out_dir <- args[out_i + 1L]; args <- args[-c(out_i, out_i + 1L)] }
if (length(args) < 1L || !dir.exists(args[1])) stop("Pass the folder that holds ", CENSUS$file, ".")
script_dir <- local({
  a <- commandArgs(trailingOnly = FALSE)
  f <- sub("^--file=", "", a[grep("^--file=", a)])
  dirname(normalizePath(f[1]))
})
zip_path <- file.path(normalizePath(args[1], winslash = "/"), CENSUS$file)
centers_path <- if (length(args) > 1L) args[2] else
  file.path(dirname(dirname(dirname(script_dir))), "CVI_Traceability", "reference", "state_capitals.csv")
if (is.null(out_dir)) out_dir <- file.path(dirname(script_dir), "geo")
dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)

sha256_of <- function(p) paste(as.character(openssl::sha256(file(p))), collapse = "")
if (!file.exists(zip_path)) stop("Missing ", zip_path, " (download from ", CENSUS$url, ")")
if (!identical(tolower(sha256_of(zip_path)), CENSUS$sha256)) stop("SHA-256 mismatch for ", zip_path)
if (!file.exists(centers_path)) stop("Missing ", centers_path, " (CVI's state centers)")
if (!identical(tolower(sha256_of(centers_path)), CENTERS$sha256)) stop("SHA-256 mismatch for ", centers_path)

# The same ring and shape cleaning as derive_regions.R (at DIGITS unless given).
clean_ring <- function(m, digits = DIGITS) {
  m <- round(m[, 1:2, drop = FALSE], digits)
  m <- m[c(TRUE, rowSums(abs(diff(m))) > 0), , drop = FALSE]
  if (any(m[1, ] != m[nrow(m), ])) m <- rbind(m, m[1, ])
  if (nrow(m) < 4L) NULL else unname(m)
}
clean_geom <- function(g, digits = DIGITS) {
  polys <- if (inherits(g, "MULTIPOLYGON")) unclass(g) else if (inherits(g, "POLYGON")) list(unclass(g)) else
    unlist(lapply(st_collection_extract(st_sfc(g), "POLYGON"), function(p) list(unclass(p))), recursive = FALSE)
  out <- list()
  for (p in polys) {
    outer <- clean_ring(p[[1]], digits)
    if (is.null(outer)) next
    holes <- Filter(Negate(is.null), lapply(p[-1], clean_ring, digits = digits))
    out[[length(out) + 1L]] <- c(list(outer), holes)
  }
  st_multipolygon(out)
}
# Planar area of a ring in km2 at its own latitude (a size test for islands only).
ring_km2 <- function(r) {
  a <- abs(sum(r[-1, 1] * r[-nrow(r), 2] - r[-nrow(r), 1] * r[-1, 2])) / 2
  a * 111.32^2 * cos(mean(r[, 2]) * pi / 180)
}
drop_small <- function(g, min_km2) {
  st_sfc(lapply(g, function(m) {
    ps <- unclass(m)
    a <- vapply(ps, function(p) ring_km2(p[[1]]), 0)
    keep <- a >= min_km2
    if (!any(keep)) keep[which.max(a)] <- TRUE
    st_multipolygon(ps[keep])
  }), crs = st_crs(g))
}
# Shared-border simplification (derive_regions.R): the states' boundaries as one network of lines between junctions,
# each line simplified once (its end points kept), the faces rebuilt and given back to the state that contains them.
simplify_shared <- function(g, tol) {
  net <- suppressMessages(st_union(st_cast(st_boundary(g), "MULTILINESTRING")))
  edges <- st_cast(st_line_merge(net), "LINESTRING")
  se <- suppressWarnings(st_simplify(edges, preserveTopology = TRUE, dTolerance = tol))
  faces <- st_collection_extract(suppressMessages(st_polygonize(st_union(se))), "POLYGON")
  pts <- suppressMessages(suppressWarnings(st_point_on_surface(faces)))
  who <- vapply(suppressMessages(st_intersects(pts, g)), function(i) if (length(i)) i[1] else NA_integer_, 0L)
  st_sfc(lapply(seq_along(g), function(i) {
    f <- faces[which(who == i)]
    if (!length(f)) stop("a state lost every face in simplification")
    st_cast(suppressMessages(st_union(f))[[1]], "MULTIPOLYGON")
  }), crs = st_crs(g))
}
planar_area <- function(g) as.numeric(st_area(st_set_crs(g, NA)))   # square degrees: a relative check only

# ── Outlines ───────────────────────────────────────────────────────────────────────────────────────────────────────
inner <- unzip(zip_path, list = TRUE)$Name
src <- st_read(paste0("/vsizip/", zip_path, "/", inner[grepl("\\.shp$", inner)]), quiet = TRUE)
src <- st_transform(src[, c("STATEFP", "STUSPS", "STATE_NAME")], 4326)
sf_use_s2(FALSE)   # planar GEOS on lon/lat, as derive_regions.R
x <- src[!(src$STATEFP %in% NOT_DRAWN), ]
codes <- sort(unique(as.character(x$STUSPS)), method = "radix")
if (length(codes) != COUNT) stop(length(codes), " states, expected ", COUNT)
cat(sprintf("%d counties in %d states and DC\n", nrow(x), length(codes) - 1L))
one_state <- function(rows) {
  g <- st_sfc(lapply(st_geometry(rows), clean_geom, digits = 4L), crs = 4326)   # as the NR county files
  st_cast(suppressMessages(st_union(st_make_valid(g)))[[1]], "MULTIPOLYGON")
}
full <- st_sfc(lapply(codes, function(cd) one_state(x[x$STUSPS == cd, ])), crs = 4326)
meta <- st_drop_geometry(x)[match(codes, x$STUSPS), ]
raw <- simplify_shared(drop_small(full, MIN_KM2), TOLERANCE)
geoms <- st_sfc(lapply(raw, clean_geom), crs = 4326)
for (pass in 1:3) {   # rounding can make a narrow simplified inlet touch itself: repair (existing vertices kept), round again
  bad <- which(!st_is_valid(geoms))
  if (!length(bad)) break
  for (i in bad) {
    parts <- st_cast(suppressWarnings(st_collection_extract(st_make_valid(geoms[i]), "POLYGON")), "MULTIPOLYGON")
    fixed <- clean_geom(st_multipolygon(do.call(c, lapply(parts, unclass))))
    a0 <- planar_area(geoms[i]); a1 <- planar_area(st_sfc(fixed, crs = 4326))
    if (abs(a1 - a0) / a0 > 1e-4) stop(codes[i], ": repair changed its area by ", signif(100 * (a1 - a0) / a0, 3), "%")
    geoms[[i]] <- fixed
  }
}
valid <- st_is_valid(geoms)
if (!all(valid)) stop("invalid after rounding: ", paste(codes[!valid], collapse = ", "))
bb <- st_bbox(geoms)
if (bb[["xmin"]] < EXTENT[1] || bb[["ymin"]] < EXTENT[2] || bb[["xmax"]] > EXTENT[3] || bb[["ymax"]] > EXTENT[4])
  stop("extent ", paste(round(bb, 3), collapse = " "), " outside the expected box")
# Each state's area within 2% of its full-detail outline (simplification, islands under MIN_KM2).
rel <- abs(planar_area(geoms) - planar_area(full)) / planar_area(full)
if (any(rel > 0.02)) stop("area off by more than 2% for ", paste(codes[rel > 0.02], collapse = ", "))

# ── Centers ────────────────────────────────────────────────────────────────────────────────────────────────────────
ctr_text <- readLines(centers_path, warn = FALSE)
ctr <- read.csv(text = ctr_text, stringsAsFactors = FALSE, colClasses = "character")
if (!identical(names(ctr), c("state", "state_lat", "state_long"))) stop("centers: unexpected columns ", paste(names(ctr), collapse = ","))
if (nrow(ctr) != 51L || anyDuplicated(ctr$state)) stop("centers: expected 51 unique state codes")
if (!all(grepl("^[A-Z]{2}$", ctr$state))) stop("centers: a code that is not two capital letters")
lat <- as.numeric(ctr$state_lat); lon <- as.numeric(ctr$state_long)
if (anyNA(lat) || anyNA(lon)) stop("centers: a coordinate that is not a number")
if (!setequal(ctr$state, c(codes, "AK", "HI"))) stop("centers: codes differ from the 48 states, DC, AK and HI")
check_g <- c(geoms, st_sfc(lapply(c("02", "15"), function(fp) one_state(src[src$STATEFP == fp, ])), crs = 4326))
check_codes <- c(codes, "AK", "HI")
# Hawaii's center lies at sea between Maui and the island of Hawaii, as USGS's own ("off Maui Island", 20 deg 15 min N,
# 156 deg 20 min W): it is checked against the smallest convex area holding its main islands instead
# (parts east of MAIN_WEST only), and must be within MAX_SEA_KM of land.
AT_SEA <- "HI"
MAIN_WEST <- -161
MAX_SEA_KM <- 50
main_hull <- function(g) {
  parts <- st_cast(st_sfc(g, crs = 4326), "POLYGON")
  keep <- vapply(seq_along(parts), function(k) st_bbox(parts[k])[["xmin"]] > MAIN_WEST, TRUE)
  st_convex_hull(suppressMessages(st_union(parts[keep])))
}
inside <- vapply(seq_len(nrow(ctr)), function(i) {
  j <- match(ctr$state[i], check_codes)
  area <- if (ctr$state[i] %in% AT_SEA) main_hull(check_g[[j]]) else check_g[j]
  suppressMessages(st_intersects(st_sfc(st_point(c(lon[i], lat[i])), crs = 4326), area, sparse = FALSE)[1, 1])
}, TRUE)
if (!all(inside)) stop("centers outside their own state: ", paste(ctr$state[!inside], collapse = ", "))
on_land <- vapply(seq_len(nrow(ctr)), function(i) suppressMessages(st_intersects(
  st_sfc(st_point(c(lon[i], lat[i])), crs = 4326), check_g[match(ctr$state[i], check_codes)], sparse = FALSE)[1, 1]), TRUE)
if (!identical(ctr$state[!on_land], AT_SEA)) stop("centers at sea: ", paste(ctr$state[!on_land], collapse = ", "), ", expected ", AT_SEA)
sea_km <- local({ sf_use_s2(TRUE); on.exit(sf_use_s2(FALSE))
  as.numeric(st_distance(st_sfc(st_point(c(lon[ctr$state == AT_SEA], lat[ctr$state == AT_SEA])), crs = 4326),
                         check_g[match(AT_SEA, check_codes)])) / 1000 })
if (sea_km > MAX_SEA_KM) stop(AT_SEA, " center ", round(sea_km, 1), " km from land (at most ", MAX_SEA_KM, ")")

# ── Write ──────────────────────────────────────────────────────────────────────────────────────────────────────────
coords <- function(g) lapply(unclass(g), function(p) lapply(p, function(m) m))
features <- lapply(seq_along(codes), function(i) list(type = "Feature",
  properties = list(code = codes[i], name = enc2utf8(as.character(meta$STATE_NAME[i])), fips = as.character(meta$STATEFP[i])),
  geometry = list(type = "MultiPolygon", coordinates = coords(geoms[[i]]))))
states_payload <- list(
  source = paste0(CENSUS$describe, " (the 48 contiguous states and DC), SHA-256 ", CENSUS$sha256,
                  "; transformed to EPSG:4326, counties rounded to 4 decimals and unioned per state, islands under ",
                  MIN_KM2, " km2 left out, shared borders simplified to ", TOLERANCE, " degrees, coordinates rounded to ",
                  DIGITS, " decimals, repeated points dropped"),
  attribution = "Boundaries: U.S. Census Bureau",
  states = list(type = "FeatureCollection", features = features))
states_path <- file.path(out_dir, "us-states.js")
writeLines(c(paste0("/* Generated by build/derive_states.R from ", CENSUS$describe, ". Do not edit. */"),
             paste0("window.WSDA_US_STATES = ", toJSON(states_payload, auto_unbox = TRUE, digits = NA), ";")),
           states_path, useBytes = TRUE)
centers_payload <- list(
  source = paste0(CENTERS$describe, " (51 rows: the 50 states and DC), SHA-256 ", CENTERS$sha256,
                  ", copied exactly (file order, values as written)"),
  note = paste("Values as in CVI's reference file, described by CVI as USGS geographic centers. USGS publishes the centers",
               "of most states only as locality descriptions (coordinates for Alaska, Hawaii and a later Nevada note),",
               "so these positions are approximate."),
  centers = lapply(seq_len(nrow(ctr)), function(i) list(state = ctr$state[i], lat = lat[i], lon = lon[i])))
centers_out <- file.path(out_dir, "state-centers.js")
writeLines(c(paste0("/* Generated by build/derive_states.R from ", CENTERS$describe, ". Do not edit. */"),
             paste0("window.WSDA_STATE_CENTERS = ", toJSON(centers_payload, auto_unbox = TRUE, digits = NA), ";")),
           centers_out, useBytes = TRUE)
cat(sprintf("states: %d outlines, %d polygons, %d vertices, area max %.2f%% off, %.0f KB -> %s\n", length(codes),
            sum(vapply(geoms, length, 0L)), nrow(st_coordinates(geoms)), 100 * max(rel), file.size(states_path) / 1024, states_path))
cat(sprintf("centers: %d rows, all inside their own state (%s at sea, %.1f km from land, inside its main islands' convex hull), %.1f KB -> %s\n",
            nrow(ctr), AT_SEA, sea_km, file.size(centers_out) / 1024, centers_out))
# The libraries the shapes depend on (a byte-identical rebuild is expected with the same versions).
v <- sf::sf_extSoftVersion()
cat(sprintf("built with R %s, sf %s, GEOS %s, GDAL %s, PROJ %s\n", getRversion(), packageVersion("sf"), v[["GEOS"]], v[["GDAL"]], v[["PROJ"]]))
