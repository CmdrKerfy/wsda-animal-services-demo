#!/usr/bin/env Rscript
# Derive geo/us-insets.js: the outlines of Alaska and Hawaii for the National Flow map's two inset boxes (inset maps
# on the shaded and the Lines map). Each state is the union of
# its counties in the U.S. Census Bureau 2023 cartographic boundary file cb_2023_us_county_500k.zip (public domain;
# the same file and SHA-256 as geo/us-states.js and geo/wa-counties.js), drawn in its own equal-area projection
# (Alaska Albers, EPSG:3338; Hawaii Albers, ESRI:102007's parameters), simplified for a box about 100 points wide,
# and scaled to the box: x and y from 0 to 1 (y down), with the box's width-to-height ratio. Each state's anchor, where
# its flow lines end, is its center from geo/state-centers.js (CVI's centers, as every other line) in the same
# projection. One-off, developer-time step; the page never runs R.
#
# Usage (from the repository root):
#   Rscript site/build/derive_insets.R <folder with cb_2023_us_county_500k.zip> [--out <folder>]
#
# Needs: R >= 4.4 with sf, jsonlite and openssl already installed. Reads site/geo/state-centers.js (written by
# derive_states.R). Writes only <out>/us-insets.js (default site/geo/). Stops on a count, validity, area or anchor check
# that fails.

suppressPackageStartupMessages({ library(sf); library(jsonlite) })
sf_use_s2 <- function(x) suppressMessages(sf::sf_use_s2(x))

CENSUS <- list(file = "cb_2023_us_county_500k.zip",
               sha256 = "99d6597b1fc7767deef62e01d28d8b5dcbd578e151855f7dc0d173cbf5bf0868",
               url = "https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_county_500k.zip",
               describe = "U.S. Census Bureau, 2023 cartographic boundary file cb_2023_us_county_500k")
# Per state: the projection, the smallest island kept (km2), the simplification tolerance (m), and for Hawaii the
# main islands only (east of 161 degrees west, as derive_states.R's center check: the Northwestern Hawaiian Islands
# reach Kure Atoll, far off the box).
INSETS <- list(
  AK = list(fips = "02", name = "Alaska", crs = "EPSG:3338", min_km2 = 150, tol_m = 3000, main_west = NA),
  HI = list(fips = "15", name = "Hawaii",
            crs = "+proj=aea +lat_0=13 +lon_0=-157 +lat_1=8 +lat_2=18 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs",
            min_km2 = 2, tol_m = 300, main_west = -161))
DIGITS <- 4L        # in box units (0 to 1): about 0.01 point in a 100-point box
MIN_AREA <- 0.97    # each simplified outline keeps at least this share of its full-detail area

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
geo_dir <- file.path(dirname(script_dir), "geo")
if (is.null(out_dir)) out_dir <- geo_dir
dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)
zip_path <- file.path(normalizePath(args[1], winslash = "/"), CENSUS$file)

sha256_of <- function(p) paste(as.character(openssl::sha256(file(p))), collapse = "")
if (!file.exists(zip_path)) stop("Missing ", zip_path, " (download from ", CENSUS$url, ")")
if (!identical(tolower(sha256_of(zip_path)), CENSUS$sha256)) stop("SHA-256 mismatch for ", zip_path)

# CVI's centers for the anchors, from the page's own file (JSON after "window.WSDA_STATE_CENTERS = ").
centers_js <- paste(readLines(file.path(geo_dir, "state-centers.js"), warn = FALSE), collapse = "\n")
centers <- fromJSON(sub(";\\s*$", "", sub("^[\\s\\S]*?window\\.WSDA_STATE_CENTERS = ", "", centers_js, perl = TRUE)))$centers

inner <- unzip(zip_path, list = TRUE)$Name
src <- st_read(paste0("/vsizip/", zip_path, "/", inner[grepl("\\.shp$", inner)]), quiet = TRUE)
sf_use_s2(FALSE)

one_inset <- function(code, o) {
  rows <- src[src$STATEFP == o$fips, ]
  if (!nrow(rows)) stop(code, ": no counties")
  g <- st_transform(st_geometry(rows), o$crs)
  full <- suppressMessages(st_union(st_make_valid(g)))
  parts <- st_cast(full, "POLYGON")
  if (!is.na(o$main_west)) {
    west <- vapply(seq_along(parts), function(k) st_bbox(st_transform(parts[k], 4326))[["xmin"]], 0)
    parts <- parts[west > o$main_west]
  }
  km2 <- as.numeric(st_area(parts)) / 1e6
  kept <- parts[km2 >= o$min_km2]
  simple <- st_simplify(suppressMessages(st_union(kept)), dTolerance = o$tol_m, preserveTopology = TRUE)
  if (!all(st_is_valid(simple))) stop(code, ": invalid after simplification")
  share <- as.numeric(st_area(simple)) / sum(as.numeric(st_area(parts)))
  if (share < MIN_AREA) stop(code, ": the simplified outline keeps ", round(100 * share, 1), "% of the land")
  bb <- st_bbox(simple)
  w <- bb[["xmax"]] - bb[["xmin"]]; h <- bb[["ymax"]] - bb[["ymin"]]
  box <- function(xy) cbind(round((xy[, 1] - bb[["xmin"]]) / w, DIGITS), round((bb[["ymax"]] - xy[, 2]) / h, DIGITS))
  rings <- list()
  for (p in st_cast(simple, "POLYGON")) {
    r <- box(unclass(p)[[1]][, 1:2, drop = FALSE])
    r <- r[c(TRUE, rowSums(abs(diff(r))) > 0), , drop = FALSE]
    if (nrow(r) >= 4L) rings[[length(rings) + 1L]] <- unname(r)
  }
  ctr <- centers[centers$state == code, ]
  if (nrow(ctr) != 1L) stop(code, ": no center in state-centers.js")
  at <- st_transform(st_sfc(st_point(c(ctr$lon, ctr$lat)), crs = 4326), o$crs)
  anchor <- box(st_coordinates(at))
  # The anchor lies on the state's land, or for Hawaii (center at sea, as USGS's) inside its main islands' hull.
  area <- if (is.na(o$main_west)) simple else st_convex_hull(simple)
  if (!suppressMessages(st_intersects(at, area, sparse = FALSE)[1, 1])) stop(code, ": anchor outside the state")
  list(name = o$name, aspect = round(w / h, 4), anchor = as.numeric(anchor), rings = rings,
       stats = c(polygons = length(rings), points = sum(vapply(rings, nrow, 1L)), share = share))
}

out <- lapply(names(INSETS), function(code) one_inset(code, INSETS[[code]]))
names(out) <- names(INSETS)
payload <- list(
  source = paste0(CENSUS$describe, ", SHA-256 ", CENSUS$sha256, "; Alaska's counties unioned in Alaska Albers ",
                  "(EPSG:3338), islands under ", INSETS$AK$min_km2, " km2 left out, simplified to ", INSETS$AK$tol_m / 1000,
                  " km; Hawaii's main islands (east of 161 degrees west) in Hawaii Albers, islands under ",
                  INSETS$HI$min_km2, " km2 left out, simplified to ", INSETS$HI$tol_m, " m; each scaled to its box ",
                  "(0 to 1, y down), coordinates rounded to ", DIGITS, " decimals; anchors at CVI's state centers"),
  attribution = "Boundaries: U.S. Census Bureau",
  states = lapply(out, function(s) s[c("name", "aspect", "anchor", "rings")]))
path <- file.path(out_dir, "us-insets.js")
writeLines(c(paste0("/* Generated by build/derive_insets.R from ", CENSUS$describe, ". Do not edit. */"),
             paste0("window.WSDA_US_INSETS = ", toJSON(payload, auto_unbox = TRUE, digits = NA), ";")),
           path, useBytes = TRUE)
for (code in names(out)) {
  s <- out[[code]]$stats
  cat(sprintf("%s: %d polygons, %d points, %.1f%% of the land kept, width %.3f x height\n", code, s[["polygons"]],
              s[["points"]], 100 * s[["share"]], out[[code]]$aspect))
}
cat(sprintf("%.1f KB -> %s\n", file.size(path) / 1024, path))
v <- sf::sf_extSoftVersion()
cat(sprintf("built with R %s, sf %s, GEOS %s, GDAL %s, PROJ %s\n", getRversion(), packageVersion("sf"), v[["GEOS"]], v[["GDAL"]], v[["PROJ"]]))
