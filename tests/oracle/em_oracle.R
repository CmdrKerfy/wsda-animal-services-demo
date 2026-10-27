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
#     in the CVI_Traceability checkout, unchanged and checked by SHA-256 as the S11 reference checks them);
#   - the agreed-table scenario (E1b; rules.json "agreed"): each row mapped or not and why (a pair unusable as
#     written that falls in Washington the other way round "looks swapped"), the names, the detection date
#     (Confirmed Diagnosis, else Date Reported) and the closed date read with as.Date, each positive's group on two
#     end dates (past: its Close Date on or before the end, else Status Closed) and still under quarantine, the flock
#     size classes (Small under 100, Medium 100 to 1,000, Large over 1,000) and the current positives' counts by flock
#     type and their animals; the inside rows with rings in miles (1 mile = 1.609344 km, the distance shown in miles);
#     days since the last positive for each ring of each positive with zones and for the zone file's zone (read with
#     sf and tested with GEOS); and the page's zones.geojson read with sf: each polygon valid (st_is_valid), each
#     circle 361 points with the first equal to the last and every vertex at its ring's distance from its positive,
#     each exterior running counterclockwise.
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
# The sample is in the agency's agreed HPAI table's columns: Case ID, Latitude, Longitude, and Status Closed.
sp <- read_fixture(cv$positives)
sp_closed <- tolower(trimws(sp[["Status"]])) %in% c("closed", "yes", "y", "true", "1")
sp <- sp[!sp_closed, , drop = FALSE]
cvi_sites <- data.frame(name = sp[["Case ID"]], lat = num(sp[["Latitude"]]), long = num(sp[["Longitude"]]),
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

# ── The agreed-table scenario (E1b) ────────────────────────────────────────────────────────────────
ag <- rules$agreed
ap <- read_fixture(ag$positives)
# Dates written YYYY-MM-DD, YYYY/MM/DD or M/D/YYYY; anything else (or an impossible date) is NA.
as_day <- function(x) {
  x <- trimws(x)
  out <- as.Date(rep(NA_character_, length(x)))
  iso <- grepl("^[0-9]{4}[-/][0-9]{1,2}[-/][0-9]{1,2}$", x)
  us <- grepl("^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$", x)
  out[iso] <- as.Date(gsub("/", "-", x[iso]), format = "%Y-%m-%d")
  out[us] <- as.Date(x[us], format = "%m/%d/%Y")
  out
}
lat_t <- trimws(ap[["Latitude"]])
lon_t <- trimws(ap[["Longitude"]])
alat <- num(lat_t)
alon <- num(lon_t)
mapped <- usable(alat, alon)
in_wa <- function(lat, lon) lat >= 45.5 & lat <= 49.1 & lon >= -124.9 & lon <= -116.9
reason <- ifelse(!nzchar(lat_t) & !nzchar(lon_t), "no coordinates",
          ifelse(!nzchar(lat_t), "no latitude",
          ifelse(!nzchar(lon_t), "no longitude",
          ifelse(!is.na(alat) & !is.na(alon) & in_wa(alon, alat), "latitude and longitude look swapped",
                 "coordinates not readable"))))
reason[mapped] <- NA
aid <- trimws(ap[["Case ID"]])
acounty <- trimws(ap[["County"]])
with_county <- function(s) paste0(s, ifelse(nzchar(acounty), paste0(" (", acounty, ")"), ""))
anames <- ifelse(nzchar(aid), aid, with_county(ifelse(mapped, paste0("Positive ", cumsum(mapped)),
                                                         paste0("Line ", seq_along(aid) + 1))))
confirmed <- trimws(ap[["Confirmed Diagnosis"]])
detected <- as_day(ifelse(nzchar(confirmed), confirmed, trimws(ap[["Date Reported"]])))
closed_date <- as_day(ap[["Close Date"]])
closed_flag <- tolower(trimws(ap[["Status"]])) %in% c("closed", "yes", "y", "true", "1")
release <- as_day(ap[["Quarantine Release"]])
inv_t <- trimws(ap[["Flock/Herd Inventory"]])
inv_ok <- grepl("^[0-9]+$", inv_t) | grepl("^[0-9]{1,3}(,[0-9]{3})+$", inv_t)
inventory <- ifelse(inv_ok, suppressWarnings(as.numeric(gsub(",", "", inv_t))), NA)
size <- ifelse(is.na(inventory), NA, ifelse(inventory < 100, "Small", ifelse(inventory <= 1000, "Medium", "Large")))
flock <- tolower(trimws(ap[["Flock/Herd Type"]]))
# HPAI counts cattle apart from the birds: a species with one of these words at the start of a word.
cattle <- grepl("(^|[^a-z0-9])(cattle|dairy|bovine|cow)", tolower(trimws(ap[["Species"]])))
win_start <- min(detected[mapped], na.rm = TRUE)
# Each mapped positive's group on an end date (the window from the first detection to it), and the current ones'
# counts by flock type, their birds and their cattle.
groups_on <- function(end) {
  inside <- mapped & (is.na(detected) | (detected >= win_start & detected <= end))
  past <- ifelse(!is.na(closed_date), closed_date <= end, closed_flag)
  group <- ifelse(!mapped, "Not mapped", ifelse(!inside, "Outside", ifelse(past, "Past", "Current")))
  still <- group == "Past" & (is.na(release) | release > end)
  cur <- group == "Current"
  kinds <- lapply(split(seq_along(flock)[cur], flock[cur]), function(k)
    list(count = length(k), animals = sum(inventory[k], na.rm = TRUE)))
  list(end = format(end), group = I(group), still = I(still),
       kinds = kinds, animals = sum(inventory[cur & !cattle], na.rm = TRUE),
       cattle = sum(inventory[cur & cattle], na.rm = TRUE), missing = sum(cur & is.na(inventory)))
}
as_of <- as.Date(ag$asOf)
ag_groups <- list(asOf = groups_on(as_of), earlier = groups_on(as.Date(ag$earlierEnd)))
in_window <- mapped & (is.na(detected) | (detected >= win_start & detected <= as_of))
ag_target <- which(ag_groups$asOf$group == "Current")
km_per_mile <- 1.609344
ag_rings_km <- vapply(ag$rings, function(r) as.numeric(r$distance), numeric(1)) * km_per_mile
ag_labels <- vapply(ag$rings, function(r) r$label, character(1))
lay <- read_fixture(ag$layer$file)
llat <- num(lay[["lat"]])
llon <- num(lay[["long"]])
mile_rows <- list()
for (s in ag_target) {
  d <- distHaversine(cbind(llon, llat), c(alon[s], alat[s]), r = 6378137) / 1000
  inside <- which(d <= max(ag_rings_km))
  for (k in inside[order(d[inside], lay[["name"]][inside])]) {
    mile_rows[[length(mile_rows) + 1]] <- list(site = anames[s], name = lay[["name"]][k], mi = d[k] / km_per_mile,
                                               zone = ag_labels[which(ag_rings_km >= d[k])[1]])
  }
}
# Days since: the dated positives inside the window, whatever their group.
dated <- which(in_window & !is.na(detected))
latest_in <- function(hit) if (any(hit)) format(max(detected[dated][hit])) else NA
days_to <- function(latest) if (is.na(latest)) NA else as.numeric(as_of - as.Date(latest))
ring_days <- lapply(ag_target, function(s) {
  d <- distHaversine(cbind(alon[dated], alat[dated]), c(alon[s], alat[s]), r = 6378137) / 1000
  rings <- lapply(ag_rings_km, function(km) {
    latest <- latest_in(d <= km)
    list(km = km, latest = latest, days = days_to(latest))
  })
  list(name = anames[s], rings = rings)
})
zone2 <- st_set_crs(st_zm(suppressWarnings(st_read(file.path(fx_dir, ag$zoneFile), quiet = TRUE))), 4326)
dated_pts <- st_as_sf(data.frame(x = alon[dated], y = alat[dated]), coords = c("x", "y"), crs = 4326)
zone_hit <- lengths(suppressMessages(st_intersects(dated_pts, zone2))) > 0
zone_latest <- latest_in(zone_hit)
zone_days <- list(name = as.character(zone2$name[1]), inside = I(anames[dated][zone_hit]), latest = zone_latest,
                  days = days_to(zone_latest))
cat(sprintf("agreed: %d rows, %d mapped, %d current, %d past, %d inside rows in miles, zone %s: %s days\n",
            length(anames), sum(mapped), length(ag_target), sum(ag_groups$asOf$group == "Past"), length(mile_rows),
            zone_days$name, zone_days$days))
# The page's zones.geojson, read with sf.
gj <- suppressWarnings(st_read(file.path(fx_dir, ag$geojson), quiet = TRUE))
ccw <- function(m) {
  x <- m[, 1]
  y <- m[, 2]
  j <- c(length(x), seq_len(length(x) - 1))
  sum((x[j] - x) * (y[j] + y)) > 0
}
gj_check <- lapply(seq_len(nrow(gj)), function(i) {
  xy <- st_coordinates(gj[i, ])
  outer <- xy[xy[, "L1"] == 1, c("X", "Y"), drop = FALSE]
  circle <- !is.na(gj$positive[i])
  err <- NA
  if (circle) {
    s <- which(anames == gj$positive[i] & mapped)
    err <- max(abs(distHaversine(outer, c(alon[s], alat[s]), r = 6378137) / 1000 - gj$distance[i] * km_per_mile))
  }
  list(zone = gj$zone[i], positive = if (circle) gj$positive[i] else NA, group = gj$group[i],
       valid = isTRUE(st_is_valid(gj[i, ])), points = nrow(outer),
       closed = all(outer[1, ] == outer[nrow(outer), ]), ccw = ccw(outer), vertex_error_km = err,
       days = gj$days_since_last_positive[i])
})
gj_props <- setdiff(names(gj), attr(gj, "sf_column"))
cat(sprintf("agreed zones.geojson: %d features, all valid %s, largest vertex error %.3g km\n", nrow(gj),
            all(vapply(gj_check, function(x) x$valid, logical(1))),
            max(vapply(gj_check, function(x) if (is.na(x$vertex_error_km)) 0 else x$vertex_error_km, numeric(1)))))
agreed_out <- list(
  names = I(anames), mapped = I(mapped), reason = I(reason), detected = I(format(detected)),
  closed_date = I(format(closed_date)), size = I(size), inventory = I(inventory),
  groups = ag_groups, window = list(start = format(win_start), end = format(as_of)),
  mile_rows = mile_rows, ring_days = ring_days, zone_days = zone_days,
  geojson = list(features = nrow(gj), properties = I(gj_props), check = gj_check))

# ── Written out ────────────────────────────────────────────────────────────────────────────────────
inputs <- c("rules.json", rules$positives, cv$positives, cv$master, vapply(rules$layers, function(l) l$file, character(1)),
            unlist(rules$zoneFiles), ag$positives, ag$layer$file, ag$zoneFile, ag$geojson)
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
  cvi = cvi_out,
  agreed = agreed_out
)
dir.create(dirname(out_file), recursive = TRUE, showWarnings = FALSE)
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, null = "null", na = "null", pretty = FALSE), out_file)
cat("wrote", out_file, "\n")
