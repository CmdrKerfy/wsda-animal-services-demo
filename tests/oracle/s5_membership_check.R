#!/usr/bin/env Rscript
# Independent S5 spatial reference: sf/GEOS intersects on precisely the bundled polygons.
# Usage from repository root: generator --membership, Rscript tests/oracle/s5_membership_check.R,
# then Node S5 --membership. No CVI operational geometry, source file, network or installation.
suppressPackageStartupMessages({ library(sf); library(jsonlite) })
a <- commandArgs(trailingOnly = FALSE)
f <- sub("^--file=", "", a[grep("^--file=", a)])
root <- normalizePath(file.path(dirname(normalizePath(f[1])), "..", ".."))
out <- file.path(root, "local-test-artifacts/s5/membership")
input_path <- file.path(out, "inputs.json")
d <- fromJSON(input_path, simplifyVector = FALSE)
# EPSG:4326 remains the declared CRS. GEOS uses straight lon/lat segments (s2 disabled),
# with closed polygon boundaries, including hole edges. No projection, buffer or make_valid.
sf_use_s2(FALSE)
ring <- function(r) do.call(rbind, lapply(r, unlist))
geometry <- function(g) {
  if (g$type == "Polygon") st_polygon(lapply(g$coordinates, ring))
  else if (g$type == "MultiPolygon") st_multipolygon(lapply(g$coordinates, function(p) lapply(p, ring)))
  else stop("Nonpolygon geometry")
}
geo_text <- readLines(file.path(root, "site/geo/wa-counties.js"), warn = FALSE)
geo <- fromJSON(sub(";$", "", sub("^window.CVIWA_GEO = ", "", geo_text[2])), simplifyVector = FALSE)
if (!identical(d$groups[[1]]$counties, geo$counties)) stop("Fixture polygons differ from bundled WA geometry")
results <- lapply(d$groups, function(g) {
  counties <- st_sfc(lapply(g$counties$features, function(f) geometry(f$geometry)), crs = 4326)
  if (!all(st_is_valid(counties))) stop("Invalid reference geometry: ", g$name)
  names <- vapply(g$counties$features, function(f) f$properties$name, "")
  points <- st_sfc(lapply(g$points, function(p) st_point(c(p$lon, p$lat))), crs = 4326)
  hits <- suppressMessages(st_intersects(points, counties))
  matches <- lapply(hits, function(i) unname(names[i]))
  for (i in seq_along(g$points)) if (!is.null(g$points[[i]]$expected)) {
    expected <- unlist(g$points[[i]]$expected, use.names = FALSE)
    if (!setequal(matches[[i]], expected)) stop("Explicit boundary reference disagrees: ", g$points[[i]]$name)
  }
  cat("s5 membership R:", g$name, length(g$points), "points,", length(names), "polygons; explicit expectations checked\n")
  list(name = g$name, counties = unname(names), matches = matches)
})
reference <- list(meta = list(route = "sf::st_intersects / GEOS", crs = "EPSG:4326",
  segments = "planar longitude/latitude", s2 = FALSE, boundary = "closed; outer and hole edges included",
  sf = as.character(packageVersion("sf")), versions = as.list(sf_extSoftVersion()),
  geometrySha256 = d$geometrySha256, inputMd5 = unname(tools::md5sum(input_path))), groups = results)
write_json(reference, file.path(out, "reference.json"), auto_unbox = FALSE, digits = NA, pretty = TRUE)
cat("S5 membership R: PASS; full Focus module/subset reference NOT RUN\n")
