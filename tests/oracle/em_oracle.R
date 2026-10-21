#!/usr/bin/env Rscript
# Emergency Response reference: the "inside the zones" results of site/emergency/rules.js, worked out again in R
# from the same fixtures (tests/synthetic/make_em_fixtures.js, rules.json), written fresh rather than taken from the
# page's code:
#   - the positives that get zones by default (every usable positive not marked closed), named by their report ID,
#     else "Positive n (County)" in file order;
#   - the locations too coarse for zone results: RAD's premises_zone_eligible() (core/premises_registry.R in the
#     RAD_Animal_Diseases checkout, sourced unchanged; its geocode_precision first through RAD's own
#     premises_map_precision(), as RAD's registry stores it), a column the file does not have given the passing value
#     (as the page treats a missing column), and a geo_source of google_city (located only to a town) or none (not
#     placed, which CVI leaves out of its counts);
#   - the inside rows: geosphere's distHaversine on a sphere of 6,378,137 m (CVI's distance rule), divided by 1000,
#     the point first; a point inside when its distance is at most the outer ring; its ring the smallest at least the
#     distance; the rows layer by layer, then site by site, nearest first;
#   - the "nearest" line for each layer with nothing inside: its nearest usable point to any positive with zones;
#   - zones from a file: read with sf and tested with GEOS (planar, sf_use_s2(FALSE)), as the S11 reference does;
#   - the speed set: 40 positives against 30,000 points, timed;
#   - the CVI movements for one case (the Emergency sample's positives with zones, HPAI's rings as the bands, a small
#     synthetic master): CVI's own load_master_csv and run_proximity_query (shiny/R/master_loader.R and map_helpers.R
#     in the CVI_Traceability checkout, unchanged and checked by SHA-256 as the S11 reference checks them).
# The Node suite (tests/node/run_em_unit_tests.js) compares the row sets and distances within 1e-6, not counts alone.
# RAD's and the fixtures' files are only read; nothing is installed.
#
# Usage (repository root, as a background job, never with a shell "&"):
#   Rscript tests/oracle/em_oracle.R
# Needs: node tests/synthetic/make_em_fixtures.js (also run by the Emergency unit suite).
# RAD checkout: ../RAD_Animal_Diseases or the environment variable RAD_ANIMAL_DISEASES_DIR.
# CVI checkout: ../CVI_Traceability or the environment variable CVI_TRACEABILITY_DIR.
# Output (git-ignored): local-test-artifacts/em/oracle_em.json.
# R packages: jsonlite, geosphere, sf, openssl, and those CVI's two files load (data.table, dplyr).

suppressPackageStartupMessages({
  library(jsonlite)
  library(geosphere)
  library(sf)
})

repo_root <- local({
  a <- commandArgs(trailingOnly = FALSE)
  f <- sub("^--file=", "", a[grep("^--file=", a)])
  normalizePath(file.path(dirname(normalizePath(f[1])), "..", ".."))
})
rad_dir <- Sys.getenv("RAD_ANIMAL_DISEASES_DIR",
                      unset = file.path(dirname(repo_root), "RAD_Animal_Diseases"))
fx_dir <- file.path(repo_root, "local-test-artifacts", "em", "fixtures")
out_file <- file.path(repo_root, "local-test-artifacts", "em", "oracle_em.json")
sha256 <- function(p) paste(as.character(openssl::sha256(file(p))), collapse = "")

# ── RAD's rule must be the version this reference was written against ─────────────────────────
expected_sha <- c(
  "core/premises_registry.R" = "fb2bc0a5c7c42956c2f138f90fe86f6ab03e049b1ce9ac9b32b567269328299b",
  "core/address_normalize.R" = "6c28b0e671fbe052d1e5de0ebbbaab7ff66dcab997bde9d0b54486b5c9cc98d1",
  "core/atomic_write.R" = "6e4e357fb082230daaaa60199f62ee049275232a2f4bfb187dad7e7029295b9f")
for (f in names(expected_sha)) {
  got <- sha256(file.path(rad_dir, f))
  if (!identical(got, expected_sha[[f]]))
    stop("RAD's ", f, " differs from the checked version (SHA-256 ", got, "). Stop and report.")
}
# premises_registry.R sources its two helpers itself unless they are loaded; they are loaded first here, from RAD's
# own folder, because its folder lookup would point at this script's folder.
for (f in c("core/address_normalize.R", "core/atomic_write.R", "core/premises_registry.R"))
  source(file.path(rad_dir, f), local = .GlobalEnv)

fx_file <- file.path(fx_dir, "rules.json")
if (!file.exists(fx_file)) stop("Run node tests/synthetic/make_em_fixtures.js first.")
rules <- fromJSON(fx_file, simplifyVector = FALSE)
read_fixture <- function(name) {
  read.csv(file.path(fx_dir, name), check.names = FALSE, colClasses = "character", na.strings = character(0),
           stringsAsFactors = FALSE, encoding = "UTF-8")
}
num <- function(x) suppressWarnings(as.numeric(x))
usable <- function(lat, lon) !is.na(lat) & !is.na(lon) & abs(lat) <= 90 & abs(lon) <= 180
rings <- vapply(rules$rings, function(r) as.numeric(r$distance), numeric(1))
ring_labels <- vapply(rules$rings, function(r) r$label, character(1))
outer <- max(rings)

# ── The positives, and the ones that get zones by default ───────────────────────────────────────
pos <- read_fixture(rules$positives)
plat <- num(pos[["Lat"]])
plon <- num(pos[["Long"]])
keep <- usable(plat, plon)
pos <- pos[keep, , drop = FALSE]
plat <- plat[keep]
plon <- plon[keep]
ids <- trimws(pos[["AnimalDiseaseReportId"]])
county <- trimws(pos[["County"]])
pos_names <- ifelse(nzchar(ids), ids,
                    paste0("Positive ", seq_along(ids), ifelse(nzchar(county), paste0(" (", county, ")"), "")))
closed <- tolower(trimws(pos[["Surveillance Closed"]])) %in% c("yes", "y", "true", "1")
target <- !closed
cat(sprintf("positives: %d usable, %d with zones\n", length(pos_names), sum(target)))

# ── The layers, each point usable or left out ───────────────────────────────────────────────────
layers <- lapply(rules$layers, function(l) {
  df <- read_fixture(l$file)
  n <- nrow(df)
  has <- function(col) col %in% names(df)
  prec <- if (has("geocode_precision")) premises_map_precision(df[["geocode_precision"]]) else rep("rooftop", n)
  mtch <- if (has("match_status")) df[["match_status"]] else rep("Matched", n)
  ptype <- if (has("premises_type")) df[["premises_type"]] else rep("Street", n)
  eligible <- premises_zone_eligible(prec, mtch, ptype) == "TRUE"
  town <- if (has("geo_source")) tolower(trimws(df[["geo_source"]])) %in% c("google_city", "none") else rep(FALSE, n)
  list(key = l$key, label = l$label, name = df[["name"]], lat = num(df[["lat"]]), lon = num(df[["long"]]),
       eligible = eligible & !town, rad_eligible = eligible, town = town)
})

# ── Rings: the inside rows and the "nearest" line ────────────────────────────────────────────────
sites <- which(target)
ring_rows <- list()
nearest <- list()
for (l in layers) {
  ok <- which(l$eligible)
  found <- 0
  for (s in sites) {
    d <- distHaversine(cbind(l$lon[ok], l$lat[ok]), c(plon[s], plat[s]), r = 6378137) / 1000
    inside <- which(d <= outer)
    if (!length(inside)) next
    o <- inside[order(d[inside], l$name[ok][inside])]
    for (k in o) {
      ring_rows[[length(ring_rows) + 1]] <- list(site = pos_names[s], layer = l$key, name = l$name[ok][k],
                                                 km = d[k], zone = ring_labels[which(rings >= d[k])[1]])
    }
    found <- found + length(inside)
  }
  if (found == 0 && length(ok)) {
    best <- NULL
    for (s in sites) {
      d <- distHaversine(cbind(l$lon[ok], l$lat[ok]), c(plon[s], plat[s]), r = 6378137) / 1000
      for (k in seq_along(ok)) {
        nm <- l$name[ok][k]
        if (is.null(best) || d[k] < best$km || (d[k] == best$km && nm < best$name))
          best <- list(name = nm, km = d[k], from = pos_names[s])
      }
    }
    nearest[[l$key]] <- best
  }
}
cat(sprintf("rings: %d inside rows, %d layers with a nearest line\n", length(ring_rows), length(nearest)))

# ── Zones from a file ────────────────────────────────────────────────────────────────────────────
suppressMessages(sf_use_s2(FALSE))
zone_out <- list()
for (f in unlist(rules$zoneFiles)) {
  z <- suppressWarnings(st_read(file.path(fx_dir, f), quiet = TRUE))
  z <- st_set_crs(st_zm(z), 4326)
  rows <- list()
  for (zi in seq_len(nrow(z))) {
    for (l in layers) {
      ok <- which(l$eligible)
      pts <- st_as_sf(data.frame(x = l$lon[ok], y = l$lat[ok]), coords = c("x", "y"), crs = 4326)
      hit <- lengths(suppressMessages(st_intersects(pts, z[zi, ]))) > 0
      for (k in which(hit)) rows[[length(rows) + 1]] <- list(zone = as.character(z$name[zi]), layer = l$key,
                                                               name = l$name[ok][k])
    }
  }
  zone_out[[f]] <- list(zones = nrow(z), rows = rows)
  cat(sprintf("zones: %-24s %d zones, %d inside rows\n", f, nrow(z), length(rows)))
}

# ── The speed set ──────────────────────────────────────────────────────────────────────────────
sp <- rules$speed
sp_pos <- do.call(rbind, lapply(sp$positives, function(p) c(lat = p[[1]], lon = p[[2]])))
sp_pts <- do.call(rbind, lapply(sp$points, function(p) c(lat = p[[1]], lon = p[[2]])))
t0 <- proc.time()[["elapsed"]]
dm <- distm(cbind(sp_pts[, "lon"], sp_pts[, "lat"]), cbind(sp_pos[, "lon"], sp_pos[, "lat"]),
            fun = function(x, y) distHaversine(x, y, r = 6378137)) / 1000
pairs <- sum(dm <= outer)
distinct <- sum(apply(dm <= outer, 1, any))
speed_s <- proc.time()[["elapsed"]] - t0
cat(sprintf("speed: %d positives x %d points: %d pairs inside, %d distinct points, %.2f s\n",
            nrow(sp_pos), nrow(sp_pts), pairs, distinct, speed_s))

# ── The CVI movements: CVI's own engine ────────────────────────────────────────────────────────────
cvi_dir <- Sys.getenv("CVI_TRACEABILITY_DIR", unset = file.path(dirname(repo_root), "CVI_Traceability"))
cvi_sha <- c(
  "R/map_helpers.R"   = "ceddb9ac9ca3a6b8eb4fe58ccdf173ea563207a80f87f178781aad36a234a66c",
  "R/master_loader.R" = "7bd156663706303a8fecca8eb9abf8aa159900055c1f00e702cf7fefa8cbf931")
for (f in names(cvi_sha)) {
  got <- sha256(file.path(cvi_dir, "shiny", f))
  if (!identical(got, cvi_sha[[f]]))
    stop("CVI's ", f, " differs from the checked version (SHA-256 ", got, "). Stop and report.")
}
suppressPackageStartupMessages(
  for (f in c("R/master_loader.R", "R/map_helpers.R")) source(file.path(cvi_dir, "shiny", f), local = .GlobalEnv))
cv <- rules$cvi
sp <- read_fixture(cv$positives)
sp_closed <- tolower(trimws(sp[["Surveillance Closed"]])) %in% c("yes", "y", "true", "1")
sp <- sp[!sp_closed, , drop = FALSE]
cvi_sites <- data.frame(name = sp[["AnimalDiseaseReportId"]], lat = num(sp[["Lat"]]), long = num(sp[["Long"]]),
                        buffer_km = NA_real_, stringsAsFactors = FALSE)
cvi_master <- load_master_csv(file.path(fx_dir, cv$master))
cvi_bands <- as.numeric(unlist(cv$bands))
cvi_r <- run_proximity_query(cvi_master, cvi_sites, default_buffer_km = max(cvi_bands), endpoint = "either",
                             filters = list(year = integer(0), quarter = character(0), species = character(0)),
                             bands = cvi_bands)
cvi_out <- list(status = cvi_r$status, summary = cvi_r$summary,
                cvis = I(sort(unique(as.character(cvi_r$matched_df$CVI)))),
                matched_sites = setNames(as.list(cvi_r$matched_df$matched_sites), as.character(cvi_r$matched_df$CVI)))
cat(sprintf("cvi movements: %s, %d CVIs\n", cvi_r$status, length(cvi_out$cvis)))

# ── Written out ────────────────────────────────────────────────────────────────────────────────────
inputs <- c("rules.json", rules$positives, cv$positives, cv$master, vapply(rules$layers, function(l) l$file, character(1)), unlist(rules$zoneFiles))
out <- list(
  generated_by = "tests/oracle/em_oracle.R",
  r_version = R.version.string,
  rad_sha = as.list(expected_sha),
  inputs = setNames(lapply(inputs, function(f) sha256(file.path(fx_dir, f))), inputs),
  positives = list(names = I(pos_names), target = I(target)),
  eligible = setNames(lapply(layers, function(l) list(name = I(l$name), eligible = I(l$eligible),
                                                      rad = I(l$rad_eligible), town = I(l$town))),
                      vapply(layers, function(l) l$key, character(1))),
  rings = ring_rows,
  nearest = nearest,
  zones = zone_out,
  speed = list(pairs = pairs, distinct = distinct, seconds = speed_s),
  cvi = cvi_out
)
dir.create(dirname(out_file), recursive = TRUE, showWarnings = FALSE)
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, null = "null", pretty = FALSE), out_file)
cat("wrote", out_file, "\n")
