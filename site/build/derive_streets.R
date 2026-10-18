#!/usr/bin/env Rscript
# Derive geo/streets-wa.js, the County Focus "Streets (vector)" PNG background (S9), from the files
# CVI draws it from, in CVI's reference/tiger_wa/. All public sources, as CVI's comments name them:
#   primary_wa.rds, secondary_wa.rds, places_wa.rds   U.S. Census Bureau TIGER/Line roads and places (public domain)
#   rivers_poly_wa.rds                                 USGS National Hydrography Dataset, NHDArea wide rivers (public domain)
#   coast_wa.rds, lakes_wa.rds, rivers_wa.rds,
#   urban_wa.rds                                       Natural Earth coastline, lakes, rivers and urban areas (public domain)
# One-off, developer-time step; the page never runs R. Each source's SHA-256 is printed and written into the output,
# so a later run on changed files shows.
#
# Usage (from the repository root):
#   Rscript site/build/derive_streets.R [<path to CVI's reference/tiger_wa>] [--out <folder>]
# The folder defaults to ../CVI_Traceability/reference/tiger_wa (CVI checkout next to this repository).
#
# Needs: R >= 4.4 with sf, jsonlite and openssl already installed. Writes only <out>/streets-wa.js (default site/geo/).
# Lines and areas: EPSG:4326, simplified at TOLERANCE degrees (planar, as CVI's renderer runs with spherical
# geometry off), coordinates rounded to DIGITS, empty parts dropped. Places: CVI uses each place's name, land area
# (ALAND, its label priority) and center; the page keeps only those (the planar center of each place's polygon,
# CVI's st_centroid with spherical geometry off), not the polygons.

suppressPackageStartupMessages({ library(sf); library(jsonlite) })
sf_use_s2 <- function(x) suppressMessages(sf::sf_use_s2(x))

DIGITS <- 4L          # about 10 m
TOLERANCE <- 0.0004   # degrees, about 40 m: under a point on a County Focus page at 200 dpi
FILES <- c("primary_wa.rds", "secondary_wa.rds", "places_wa.rds", "rivers_poly_wa.rds", "coast_wa.rds",
           "lakes_wa.rds", "rivers_wa.rds", "urban_wa.rds")

args <- commandArgs(trailingOnly = TRUE)
out_at <- match("--out", args)
out_dir <- if (!is.na(out_at)) args[out_at + 1L] else file.path("site", "geo")
if (!is.na(out_at)) args <- args[-c(out_at, out_at + 1L)]
src <- if (length(args)) args[1] else file.path("..", "CVI_Traceability", "reference", "tiger_wa")
if (!dir.exists(src)) stop("No folder ", src, ". Pass the path to CVI's reference/tiger_wa.")
missing <- FILES[!file.exists(file.path(src, FILES))]
if (length(missing)) stop("Missing in ", src, ": ", paste(missing, collapse = ", "))

sha256 <- function(p) paste(as.character(openssl::sha256(file(p))), collapse = "")
shas <- setNames(lapply(FILES, function(f) sha256(file.path(src, f))), FILES)
for (f in FILES) cat(sprintf("%-20s %s\n", f, shas[[f]]))

sf_use_s2(FALSE)
read_one <- function(f) sf::st_transform(readRDS(file.path(src, f)), 4326)

# Geometry as GeoJSON-shaped lists, simplified and rounded; NULL for a geometry that vanishes.
coords <- function(m) unname(lapply(seq_len(nrow(m)), function(i) round(m[i, 1:2], DIGITS)))
dedupe <- function(cs) {
  keep <- c(TRUE, vapply(seq_along(cs)[-1], function(i) !identical(cs[[i]], cs[[i - 1]]), TRUE))
  cs[keep]
}
line_parts <- function(g) {
  parts <- if (inherits(g, "LINESTRING")) list(unclass(g)) else unclass(g)
  parts <- lapply(parts, function(m) dedupe(coords(m)))
  Filter(function(p) length(p) >= 2, parts)
}
poly_parts <- function(g) {
  polys <- if (inherits(g, "POLYGON")) list(unclass(g)) else unclass(g)
  polys <- lapply(polys, function(rings) {
    rings <- lapply(rings, function(m) dedupe(coords(m)))
    Filter(function(r) length(r) >= 4, rings)
  })
  Filter(function(p) length(p) >= 1, polys)
}
simplified <- function(x) {
  x <- sf::st_zm(x, drop = TRUE)
  # The tolerance is in degrees on purpose (planar, as CVI's renderer); sf's note about that is silenced.
  g <- suppressWarnings(sf::st_simplify(sf::st_geometry(x), dTolerance = TOLERANCE, preserveTopology = TRUE))
  g[!sf::st_is_empty(g)]
}
as_lines <- function(x) {
  g <- simplified(x)
  Filter(length, lapply(g, function(one) if (inherits(one, c("LINESTRING", "MULTILINESTRING"))) line_parts(one) else NULL))
}
as_areas <- function(x) {
  g <- simplified(x)
  Filter(length, lapply(g, function(one) if (inherits(one, c("POLYGON", "MULTIPOLYGON"))) poly_parts(one) else NULL))
}

primary <- read_one("primary_wa.rds")
secondary <- read_one("secondary_wa.rds")
places <- read_one("places_wa.rds")
rivers_poly <- read_one("rivers_poly_wa.rds")
coast <- read_one("coast_wa.rds")
lakes <- read_one("lakes_wa.rds")
rivers <- read_one("rivers_wa.rds")
urban <- read_one("urban_wa.rds")

centers <- sf::st_coordinates(sf::st_centroid(sf::st_geometry(places)))
place_list <- lapply(seq_len(nrow(places)), function(i) list(name = as.character(places$NAME[i]),
  aland = as.numeric(places$ALAND[i]), lon = round(centers[i, 1], 5), lat = round(centers[i, 2], 5)))
river_list <- Filter(function(r) length(r$lines), lapply(seq_len(nrow(rivers)), function(i) {
  g <- sf::st_zm(sf::st_geometry(rivers)[[i]], drop = TRUE)
  list(name = if (is.na(rivers$name[i])) "" else as.character(rivers$name[i]),
       lines = line_parts(suppressWarnings(sf::st_simplify(g, dTolerance = TOLERANCE))))
}))

out <- list(
  source = paste("Derived by site/build/derive_streets.R from CVI's reference/tiger_wa:",
                 "U.S. Census Bureau TIGER/Line (roads, places), USGS NHD (wide rivers), Natural Earth",
                 "(coast, lakes, rivers, urban areas); public domain."),
  sha256 = shas, tolerance = TOLERANCE, digits = DIGITS,
  primary = as_lines(primary), secondary = as_lines(secondary), places = place_list,
  riversPoly = as_areas(rivers_poly), coast = as_lines(coast), lakes = as_areas(lakes), rivers = river_list,
  urban = as_areas(urban))

for (k in c("primary", "secondary", "riversPoly", "coast", "lakes", "urban")) {
  cat(sprintf("%-11s %5d features\n", k, length(out[[k]])))
}
cat(sprintf("%-11s %5d places, %d named rivers\n", "places", length(out$places), length(out$rivers)))
if (length(out$primary) < 100 || length(out$secondary) < 1000 || length(out$places) < 500)
  stop("Fewer features than CVI's files hold: check the source folder.")

dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)
target <- file.path(out_dir, "streets-wa.js")
writeLines(c("/* Generated by build/derive_streets.R from CVI's reference/tiger_wa (public domain sources). Do not edit. */",
             paste0("window.WSDA_STREETS = ", toJSON(out, auto_unbox = TRUE, digits = NA), ";")), target)
cat(sprintf("Wrote %s (%.0f KB)\n", target, file.info(target)$size / 1024))
