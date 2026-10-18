#!/usr/bin/env Rscript
# NR file check: reads each generated site/geo/regions/<id>.js back and compares it with the official source file:
# the same counties (names and official IDs) as the source's filter, each county's area within 0.5% of the source's
# after rounding (1% for British Columbia, whose islands under 1 km2 are left out and borders simplified to about
# 150 m, by design), every label point inside its own county, the outline's area equal to its counties', and a second
# run of site/build/derive_regions.R (into a temporary folder) byte-identical to the file in the site.
# Usage (repository root): Rscript tests/oracle/nr_regions_check.R
# Needs the source zips in local-test-artifacts/nr/ (see site/PROVENANCE.md); without one, that region is reported
# "not run" (never a pass: the exit status is then 2, and 1 when a check failed). R >= 4.4 with sf and jsonlite; nothing
# is written outside a temporary folder.

suppressPackageStartupMessages({ library(sf); library(jsonlite) })

SRC_DIR <- file.path("local-test-artifacts", "nr")
OUT_DIR <- file.path("site", "geo", "regions")
# Written out here, independently of the build script: where each region comes from.
SOURCES <- list(
  bc = list(zip = "lcd_000b21a_e.zip", filter_col = "PRUID", filter = "59", name_col = "CDNAME", id_col = "CDUID", max_off = 0.01),
  id = list(zip = "cb_2023_us_county_500k.zip", filter_col = "STATEFP", filter = "16", name_col = "NAME", id_col = "GEOID", max_off = 0.005),
  or = list(zip = "cb_2023_us_county_500k.zip", filter_col = "STATEFP", filter = "41", name_col = "NAME", id_col = "GEOID", max_off = 0.005))
# Areas in an equal-area projection (BC Albers, EPSG:3005) after densifying every edge in longitude/latitude to 0.01
# degrees: the page draws an edge as a straight line in longitude/latitude (Web Mercator), so a long simplified edge
# along a parallel (49 or 60 degrees north) stays on it; measured undensified on the sphere or in a projection it would
# bulge off the parallel and add area that is not on the map.
area_ea <- function(g) {
  d <- st_set_crs(st_segmentize(st_set_crs(st_make_valid(g), NA), 0.01), 4326)
  as.numeric(st_area(st_transform(d, 3005)))
}

read_region_js <- function(f) {
  l <- readLines(f, warn = FALSE, encoding = "UTF-8")
  body <- sub(";$", "", sub("^\\(window\\.WSDA_REGION_DATA = window\\.WSDA_REGION_DATA \\|\\| \\{\\}\\)\\['[a-z0-9]+'\\] = ", "", l[2]))
  fromJSON(body, simplifyVector = FALSE)
}
mpoly <- function(g) st_multipolygon(lapply(g$coordinates, function(p) lapply(p, function(r) do.call(rbind, lapply(r, function(xy) c(xy[[1]], xy[[2]]))))))
shp_of <- function(zip) { n <- unzip(zip, list = TRUE)$Name; paste0("/vsizip/", zip, "/", n[grepl("\\.shp$", n)]) }

ids <- sub("\\.js$", "", setdiff(list.files(OUT_DIR, pattern = "\\.js$"), "index.js"))
if (!length(ids)) { cat("NR file check: no region files in", OUT_DIR, "(run it from the repository root): not run\n"); quit(status = 2L) }
failed <- 0L; ran <- 0L
problem <- function(...) { failed <<- failed + 1L; cat("  FAIL:", ..., "\n") }
tmp <- tempfile("nr-rebuild-"); dir.create(tmp)
src_cache <- list()

for (id in ids) {
  s <- SOURCES[[id]]
  if (is.null(s)) { problem(id, ": no source known to this check"); next }
  zip <- file.path(SRC_DIR, s$zip)
  if (!file.exists(zip)) { cat(sprintf("nr %s: not run (source %s not in %s)\n", id, s$zip, SRC_DIR)); next }
  ran <- ran + 1L
  d <- read_region_js(file.path(OUT_DIR, paste0(id, ".js")))
  if (is.null(src_cache[[s$zip]])) src_cache[[s$zip]] <- st_read(shp_of(zip), quiet = TRUE)
  src <- src_cache[[s$zip]]
  src <- st_transform(src[as.character(src[[s$filter_col]]) == s$filter, ], 4326)
  names_got <- vapply(d$counties$features, function(f) f$properties$name, "")
  gids_got <- vapply(d$counties$features, function(f) f$properties$gid, "")
  if (!setequal(paste(names_got, gids_got), paste(enc2utf8(as.character(src[[s$name_col]])), as.character(src[[s$id_col]]))))
    problem(id, ": names / official IDs differ from the source")
  m <- match(gids_got, as.character(src[[s$id_col]]))

  sf_use_s2(FALSE)
  got <- st_sfc(lapply(d$counties$features, function(f) mpoly(f$geometry)), crs = 4326)
  a_got <- area_ea(got)
  a_src <- area_ea(st_geometry(src)[m])
  rel <- abs(a_got - a_src) / a_src
  if (any(rel > s$max_off)) problem(id, ": area off by more than ", 100 * s$max_off, "% for ", paste(names_got[rel > s$max_off], collapse = ", "))
  a_out <- area_ea(st_sfc(mpoly(d$outline$geometry), crs = 4326))
  if (abs(a_out - sum(a_got)) / sum(a_got) > 1e-4) problem(id, ": outline area differs from its counties' (", a_out, " vs ", sum(a_got), ")")

  # Labels inside their own county (planar test on lon/lat, as the build and the page's locate()).
  lab_in <- vapply(seq_along(d$labels), function(i) {
    l <- d$labels[[i]]
    j <- which(vapply(d$counties$features, function(f) f$properties$key, "") == l$key)
    length(j) == 1L && suppressMessages(st_intersects(st_sfc(st_point(c(l$lon, l$lat)), crs = 4326), got[j], sparse = FALSE)[1, 1])
  }, TRUE)
  if (!all(lab_in)) problem(id, ": label outside its county: ", paste(vapply(d$labels[!lab_in], function(l) l$name, ""), collapse = ", "))

  # A second build, byte-identical.
  status <- system2("Rscript", c("site/build/derive_regions.R", SRC_DIR, "--out", tmp, id), stdout = FALSE, stderr = FALSE)
  same <- status == 0L && identical(unname(tools::md5sum(file.path(tmp, paste0(id, ".js")))), unname(tools::md5sum(file.path(OUT_DIR, paste0(id, ".js")))))
  if (!same) problem(id, ": a second build is not byte-identical")
  cat(sprintf("nr %s: %d counties = source (names, IDs); area max %.3f%% off; outline = counties; %d labels inside; rebuild %s\n",
              id, length(gids_got), 100 * max(rel), length(d$labels), if (same) "byte-identical" else "DIFFERENT"))
}
unlink(tmp, recursive = TRUE)
cat(sprintf("NR file check: %d region(s) checked, %d not run, %d failed\n", ran, length(ids) - ran, failed))
quit(status = if (failed) 1L else if (ran < length(ids)) 2L else 0L)
