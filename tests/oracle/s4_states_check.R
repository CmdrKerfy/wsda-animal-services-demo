#!/usr/bin/env Rscript
# S4 state-file check: reads site/geo/us-states.js and site/geo/state-centers.js back and compares them with their
# sources. Outlines, against the Census county file: the same 49 states (codes, names, FIPS) as the 48 contiguous states
# and DC in the source; each state's area within 1% of the union of its source counties (equal-area, EPSG:5070); no two
# outlines overlap (their areas sum to their union's within 1e-9); no gap between neighbors: every vertex on the edge of
# the union of all outlines lies within 0.002 degrees of the edge of the union of the full-detail counties (a gap or
# sliver between two states, enclosed or reaching the coast, puts union edge inside the land, far from that edge).
# Centers, against CVI's reference/state_capitals.csv: the same 51 rows in the same order and the same values; every
# center inside its own state (the drawn outline; Alaska's and Hawaii's against their own Census counties; Hawaii's at
# sea, as USGS's own, inside the convex hull of its main islands east of 161 degrees west and within 50 km of land).
# A second run of site/build/derive_states.R (into a temporary folder) byte-identical to both files.
# Usage (repository root): Rscript tests/oracle/s4_states_check.R
# Needs local-test-artifacts/nr/cb_2023_us_county_500k.zip (see site/PROVENANCE.md) and the CVI checkout next to this
# repository (or CVI_TRACEABILITY_DIR); without one, that part is reported "not run" (never a pass: the exit status is then
# 2, and 1 when a check failed). R >= 4.4 with sf and jsonlite; nothing is written outside a temporary folder.

suppressPackageStartupMessages({ library(sf); library(jsonlite) })
sf_use_s2 <- function(x) suppressMessages(sf::sf_use_s2(x))

ZIP <- file.path("local-test-artifacts", "nr", "cb_2023_us_county_500k.zip")
cvi_dir <- Sys.getenv("CVI_TRACEABILITY_DIR", unset = file.path("..", "CVI_Traceability"))
CENTERS_SRC <- file.path(cvi_dir, "reference", "state_capitals.csv")
GEO <- file.path("site", "geo")
# Written out here, independently of the build script.
NOT_DRAWN <- c("02", "15", "60", "66", "69", "72", "78")

read_js <- function(f, var) {
  l <- readLines(f, warn = FALSE, encoding = "UTF-8")
  fromJSON(sub(";$", "", sub(paste0("^window\\.", var, " = "), "", l[2])), simplifyVector = FALSE)
}
mpoly <- function(g) st_multipolygon(lapply(g$coordinates, function(p) lapply(p, function(r) do.call(rbind, lapply(r, function(xy) c(xy[[1]], xy[[2]]))))))
# Areas in an equal-area projection after densifying every edge in longitude/latitude to 0.01 degrees, as the NR check:
# the page draws an edge as a straight line in longitude/latitude, so a long simplified edge along the 49th parallel stays
# on it; projected undensified it would cut across the parallel's curve and lose area that is on the map.
area_ea <- function(g) {
  d <- st_set_crs(st_segmentize(st_set_crs(st_make_valid(g), NA), 0.01), 4326)
  as.numeric(st_area(st_transform(d, 5070)))
}

if (!file.exists(file.path(GEO, "us-states.js"))) { cat("S4 state-file check: no site/geo/us-states.js (run it from the repository root): not run\n"); quit(status = 2L) }
failed <- 0L; not_run <- 0L
problem <- function(...) { failed <<- failed + 1L; cat("  FAIL:", ..., "\n") }
st <- read_js(file.path(GEO, "us-states.js"), "WSDA_US_STATES")
ct <- read_js(file.path(GEO, "state-centers.js"), "WSDA_STATE_CENTERS")
codes <- vapply(st$states$features, function(f) f$properties$code, "")
sf_use_s2(FALSE)
got <- st_sfc(lapply(st$states$features, function(f) mpoly(f$geometry)), crs = 4326)
ctr <- data.frame(state = vapply(ct$centers, function(c) c$state, ""), lat = vapply(ct$centers, function(c) c$lat, 0),
                  lon = vapply(ct$centers, function(c) c$lon, 0), stringsAsFactors = FALSE)

# Overlaps and gaps between the outlines.
a_each <- area_ea(got)
uni <- suppressMessages(st_union(got))
a_uni <- area_ea(uni)
overlap <- (sum(a_each) - a_uni) / a_uni
if (overlap > 1e-9) problem("outlines overlap: their areas sum to ", signif(100 * overlap, 3), "% more than their union")
holes <- unlist(lapply(st_cast(uni, "POLYGON"), function(p) if (length(p) > 1L)
  area_ea(st_sfc(lapply(p[-1], function(h) st_polygon(list(h))), crs = 4326)) else numeric(0)))
slivers <- sum(holes < 1e6)
if (slivers) problem(slivers, " hole(s) under 1 km2 in the union of the outlines (a gap between neighbors)")
cat(sprintf("s4 outlines: %d, overlap %.2e, %d holes in their union (smallest %.1f km2)\n", length(codes), overlap,
            length(holes), if (length(holes)) min(holes) / 1e6 else NA))

if (!file.exists(ZIP)) {
  cat("s4 outlines vs Census: not run (", ZIP, " missing)\n", sep = ""); not_run <- not_run + 1L
} else {
  n <- unzip(ZIP, list = TRUE)$Name
  src <- st_read(paste0("/vsizip/", ZIP, "/", n[grepl("\\.shp$", n)]), quiet = TRUE)
  src <- st_transform(src[, c("STATEFP", "STUSPS", "STATE_NAME")], 4326)
  x <- src[!(src$STATEFP %in% NOT_DRAWN), ]
  want <- unique(st_drop_geometry(x)[, c("STUSPS", "STATE_NAME", "STATEFP")])
  have <- data.frame(STUSPS = codes, STATE_NAME = vapply(st$states$features, function(f) f$properties$name, ""),
                     STATEFP = vapply(st$states$features, function(f) f$properties$fips, ""))
  if (!setequal(do.call(paste, want), do.call(paste, have))) problem("codes, names or FIPS differ from the source")
  full <- st_sfc(lapply(codes, function(cd) suppressMessages(st_union(st_make_valid(st_geometry(x[x$STUSPS == cd, ]))))[[1]]), crs = 4326)
  rel <- abs(a_each - area_ea(full)) / area_ea(full)
  if (any(rel > 0.01)) problem("area off by more than 1% for ", paste(codes[rel > 0.01], collapse = ", "))
  cat(sprintf("s4 outlines vs Census: 49 = source (codes, names, FIPS); area max %.3f%% off (%s)\n", 100 * max(rel), codes[which.max(rel)]))
  # No gap: the union's edge vertices against the full-detail union's edge (split into short pieces for the index).
  full_edge <- st_cast(st_cast(st_boundary(suppressMessages(st_union(st_make_valid(st_geometry(x))))), "MULTILINESTRING"), "LINESTRING")
  full_edge <- st_cast(st_segmentize(st_set_crs(full_edge, NA), 1), "LINESTRING")
  edge_pts <- st_set_crs(st_cast(st_cast(st_boundary(uni), "MULTILINESTRING"), "POINT"), NA)
  near_edge <- lengths(st_is_within_distance(edge_pts, full_edge, 0.002)) > 0
  if (!all(near_edge)) problem(sum(!near_edge), " vertices on the union's edge more than 0.002 degrees inside the land (a gap between neighbors), first at ",
                               paste(round(st_coordinates(edge_pts[!near_edge][1]), 3), collapse = ", "))
  cat(sprintf("s4 gaps: %d union edge vertices, all within 0.002 degrees of the full-detail coast and borders: %s\n",
              length(edge_pts), if (all(near_edge)) "yes" else "NO"))
  # Centers inside their own state.
  extra <- st_sfc(lapply(c("02", "15"), function(fp) suppressMessages(st_union(st_make_valid(st_geometry(src[src$STATEFP == fp, ]))))[[1]]), crs = 4326)
  areas <- c(got, extra); acodes <- c(codes, "AK", "HI")
  inside <- vapply(seq_len(nrow(ctr)), function(i) {
    j <- match(ctr$state[i], acodes)
    if (is.na(j)) return(FALSE)
    a <- if (ctr$state[i] == "HI") { parts <- st_cast(areas[j], "POLYGON")
      st_convex_hull(suppressMessages(st_union(parts[vapply(seq_along(parts), function(k) st_bbox(parts[k])[["xmin"]] > -161, TRUE)]))) } else areas[j]
    suppressMessages(st_intersects(st_sfc(st_point(c(ctr$lon[i], ctr$lat[i])), crs = 4326), a, sparse = FALSE)[1, 1])
  }, TRUE)
  if (!all(inside)) problem("centers outside their own state: ", paste(ctr$state[!inside], collapse = ", "))
  hi <- ctr$state == "HI"
  hi_km <- local({ sf_use_s2(TRUE); on.exit(sf_use_s2(FALSE))
    as.numeric(st_distance(st_sfc(st_point(c(ctr$lon[hi], ctr$lat[hi])), crs = 4326), areas[match("HI", acodes)])) / 1000 })
  if (hi_km > 50) problem("Hawaii's center ", round(hi_km, 1), " km from land (at most 50)")
  cat(sprintf("s4 centers: %d of %d inside their own state (HI inside its main islands' convex hull, %.1f km from land)\n", sum(inside), nrow(ctr), hi_km))
}

if (!file.exists(CENTERS_SRC)) {
  cat("s4 centers vs CVI: not run (", CENTERS_SRC, " missing)\n", sep = ""); not_run <- not_run + 1L
} else {
  cvi <- read.csv(CENTERS_SRC, stringsAsFactors = FALSE)
  same <- identical(cvi$state, ctr$state) && identical(as.numeric(cvi$state_lat), ctr$lat) && identical(as.numeric(cvi$state_long), ctr$lon)
  if (!same) problem("centers differ from CVI's file")
  cat("s4 centers vs CVI:", nrow(cvi), "rows,", if (same) "identical (order and values)" else "DIFFERENT", "\n")
}

if (file.exists(ZIP) && file.exists(CENTERS_SRC)) {
  tmp <- tempfile("s4-rebuild-"); dir.create(tmp)
  status <- system2("Rscript", c("site/build/derive_states.R", dirname(ZIP), CENTERS_SRC, "--out", tmp), stdout = FALSE, stderr = FALSE)
  same <- status == 0L && all(vapply(c("us-states.js", "state-centers.js"), function(f)
    identical(unname(tools::md5sum(file.path(tmp, f))), unname(tools::md5sum(file.path(GEO, f)))), TRUE))
  if (!same) problem("a second build is not byte-identical")
  cat("s4 rebuild:", if (same) "byte-identical" else "DIFFERENT", "\n")
  unlink(tmp, recursive = TRUE)
} else not_run <- not_run + 1L
cat(sprintf("S4 state-file check: %d failed, %d part(s) not run\n", failed, not_run))
quit(status = if (failed) 1L else if (not_run) 2L else 0L)
