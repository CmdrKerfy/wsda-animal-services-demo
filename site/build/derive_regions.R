#!/usr/bin/env Rscript
# Derive geo/regions/<id>.js (a neighboring region's counties, its outline and label points) from the official
# boundary files: U.S. Census Bureau 2023 cartographic boundary file cb_2023_us_county_500k.zip (public domain;
# acknowledgment required; the same file and SHA-256 as geo/wa-counties.js) for Idaho and Oregon, and Statistics
# Canada's 2021 Census cartographic boundary file of census divisions for British
# Columbia (the file's metadata names the Open Government Licence - Canada; see PROVENANCE). One-off, developer-time
# step; the page never runs R.
#
# Usage (from the repository root):
#   Rscript site/build/derive_regions.R <folder with the source zips> [--out <folder>] [region ids, default all]
#
# Needs: R >= 4.4 with sf, jsonlite and openssl already installed. Writes only <out>/<id>.js (default
# site/geo/regions/). Per region: filter, EPSG:4326, coordinates rounded to 4 decimals (about 10 m) with repeated
# points dropped (every vertex is rounded the same way in every feature, so shared borders stay shared), the outline
# as the union of the rounded counties, label points (the polygon centroid as for Washington, or a point on the
# surface when the centroid falls outside), keys and official IDs. Stops on a count, ID, key, validity or extent
# check that fails. A region with a `simplify` setting (British Columbia, whose full coastline would be about 56 MB;
# target about 150 m, islands under 1 km2) is first cut down without breaking shared borders: islands below min_km2 left
# out, then every border line between junctions simplified once (Douglas-Peucker, tolerance in degrees) and the
# districts rebuilt from the simplified lines, so two neighbors keep the same border. Adding a region: an entry in
# REGIONS (and its source in SOURCES), then one in geo/regions/index.js.

suppressPackageStartupMessages({ library(sf); library(jsonlite) })
sf_use_s2 <- function(x) suppressMessages(sf::sf_use_s2(x))

DIGITS <- 4L
SOURCES <- list(
  census = list(file = "cb_2023_us_county_500k.zip",
                sha256 = "99d6597b1fc7767deef62e01d28d8b5dcbd578e151855f7dc0d173cbf5bf0868",
                url = "https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_county_500k.zip",
                filter_col = "STATEFP", name_col = "NAME", id_col = "GEOID",
                describe = "U.S. Census Bureau, 2023 cartographic boundary file cb_2023_us_county_500k",
                attribution = "Boundaries: U.S. Census Bureau"),
  statcan = list(file = "lcd_000b21a_e.zip",
                 sha256 = "1b638cea73fbf8349ba908d86be678272b2abcc74240fb0dfd9daf7a28457ad0",
                 url = "https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/boundary-limites/files-fichiers/lcd_000b21a_e.zip",
                 filter_col = "PRUID", name_col = "CDNAME", id_col = "CDUID",
                 describe = "Statistics Canada, 2021 Census cartographic boundary file lcd_000b21a_e (census divisions)",
                 attribution = "Boundaries: adapted from Statistics Canada",
                 statement = paste("Adapted from Statistics Canada, 2021 Census Boundary Files (census divisions, cartographic),",
                                   "reference date 2021. This does not constitute an endorsement by Statistics Canada of this product.",
                                   "Contains information licensed under the Open Government Licence \u2013 Canada",
                                   "(https://open.canada.ca/en/open-government-licence-canada).")))
# bbox: the extent each region must lie in (lon/lat), a check on the filter and the transformation.
# suffixes: dropped from a county name for its key, as master.js drops " County" (case and spacing ignored); the same
# list as the region's entry in geo/regions/index.js (the NR unit tests check each file's keys against it).
REGIONS <- list(
  bc = list(name = "British Columbia", code = "BC", source = "statcan", filter = "59", count = 29L,
            bbox = c(-139.1, 48.2, -114.0, 60.01), suffixes = c("Regional District", "Regional Municipality", "Region"),
            simplify = list(tolerance = 0.0015, min_km2 = 1)),
  id = list(name = "Idaho", code = "ID", source = "census", filter = "16", count = 44L,
            bbox = c(-117.3, 41.98, -111.0, 49.01), suffixes = c("County")),
  or = list(name = "Oregon", code = "OR", source = "census", filter = "41", count = 36L,
            bbox = c(-124.7, 41.98, -116.4, 46.3), suffixes = c("County")))

args <- commandArgs(trailingOnly = TRUE)
out_i <- which(args == "--out")
out_dir <- NULL
if (length(out_i)) { out_dir <- args[out_i + 1L]; args <- args[-c(out_i, out_i + 1L)] }
if (length(args) < 1L || !dir.exists(args[1])) stop("Pass the folder that holds the source zips.")
src_dir <- normalizePath(args[1], winslash = "/")
ids <- if (length(args) > 1L) args[-1] else names(REGIONS)
bad <- setdiff(ids, names(REGIONS))
if (length(bad)) stop("Unknown region id(s): ", paste(bad, collapse = ", "))
if (is.null(out_dir)) {
  script_dir <- local({
    a <- commandArgs(trailingOnly = FALSE)
    f <- sub("^--file=", "", a[grep("^--file=", a)])
    dirname(normalizePath(f[1]))
  })
  out_dir <- file.path(dirname(script_dir), "geo", "regions")
}
dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)

# Same rule as the page's regions.key(): region code, ":", the name trimmed, spaces collapsed, a listed suffix dropped,
# lower case.
county_key <- function(code, name, suffixes) {
  n <- gsub("\\s+", " ", trimws(name))
  for (s in suffixes) n <- sub(paste0("\\s+", gsub(" ", "\\\\s+", s), "$"), "", n, ignore.case = TRUE)
  paste0(toupper(code), ":", tolower(n))
}

# A ring rounded to DIGITS with repeated points dropped; NULL when fewer than 3 distinct points remain.
clean_ring <- function(m) {
  m <- round(m[, 1:2, drop = FALSE], DIGITS)
  m <- m[c(TRUE, rowSums(abs(diff(m))) > 0), , drop = FALSE]
  if (any(m[1, ] != m[nrow(m), ])) m <- rbind(m, m[1, ])
  if (nrow(m) < 4L) NULL else unname(m)
}
clean_geom <- function(g) {
  polys <- if (inherits(g, "MULTIPOLYGON")) unclass(g) else list(unclass(g))
  out <- list()
  for (p in polys) {
    outer <- clean_ring(p[[1]])
    if (is.null(outer)) next
    holes <- Filter(Negate(is.null), lapply(p[-1], clean_ring))
    out[[length(out) + 1L]] <- c(list(outer), holes)
  }
  st_multipolygon(out)
}

# Islands (polygons of a multipolygon) below min_km2 left out; a district keeps at least its largest polygon.
drop_small <- function(g, min_km2) {
  one <- 1 / (111.32^2 * cos(50 * pi / 180))   # 1 km2 in square degrees near 50 degrees north
  st_sfc(lapply(g, function(m) {
    ps <- unclass(m)
    a <- vapply(ps, function(p) { r <- p[[1]]; abs(sum(r[-1, 1] * r[-nrow(r), 2] - r[-nrow(r), 1] * r[-1, 2])) / 2 }, 0)
    keep <- a >= min_km2 * one
    if (!any(keep)) keep[which.max(a)] <- TRUE
    st_multipolygon(ps[keep])
  }), crs = st_crs(g))
}
# Shared-border simplification: the districts' boundaries as one network of lines between junctions, each line
# simplified once (its end points kept), the faces rebuilt and given back to the district that contains them.
simplify_shared <- function(g, tol) {
  net <- suppressMessages(st_union(st_cast(st_boundary(g), "MULTILINESTRING")))
  edges <- st_cast(st_line_merge(net), "LINESTRING")
  se <- suppressWarnings(st_simplify(edges, preserveTopology = TRUE, dTolerance = tol))
  faces <- st_collection_extract(suppressMessages(st_polygonize(st_union(se))), "POLYGON")
  pts <- suppressMessages(suppressWarnings(st_point_on_surface(faces)))
  who <- vapply(suppressMessages(st_intersects(pts, g)), function(i) if (length(i)) i[1] else NA_integer_, 0L)
  st_sfc(lapply(seq_along(g), function(i) {
    f <- faces[which(who == i)]
    if (!length(f)) stop("a district lost every face in simplification")
    st_cast(suppressMessages(st_union(f))[[1]], "MULTIPOLYGON")
  }), crs = st_crs(g))
}

read_source <- function(key) {
  s <- SOURCES[[key]]
  zip_path <- file.path(src_dir, s$file)
  if (!file.exists(zip_path)) stop("Missing ", zip_path, " (download from ", s$url, ")")
  got <- paste(as.character(openssl::sha256(file(zip_path))), collapse = "")
  if (is.na(s$sha256)) stop("SHA-256 of ", s$file, " not pinned yet: it is ", got, " (pin it in SOURCES and PROVENANCE)")
  if (!identical(tolower(got), s$sha256)) stop("SHA-256 mismatch for ", s$file, ": got ", got, ", expected ", s$sha256)
  inner <- unzip(zip_path, list = TRUE)$Name
  shp <- inner[grepl("\\.shp$", inner)]
  if (length(shp) != 1L) stop(s$file, ": expected one shapefile, found ", length(shp))
  st_read(paste0("/vsizip/", zip_path, "/", shp), quiet = TRUE)
}
cache <- list()

for (id in ids) {
  r <- REGIONS[[id]]; s <- SOURCES[[r$source]]
  if (is.null(cache[[r$source]])) cache[[r$source]] <- read_source(r$source)
  src <- cache[[r$source]]
  x <- src[as.character(src[[s$filter_col]]) == r$filter, c(s$name_col, s$id_col)]
  names(x)[1:2] <- c("name", "gid")
  x$name <- enc2utf8(as.character(x$name)); x$gid <- as.character(x$gid)
  x <- st_transform(x, 4326)
  x <- x[order(x$name, x$gid, method = "radix"), ]   # radix: the same order in every locale
  if (nrow(x) != r$count) stop(id, ": ", nrow(x), " counties, expected ", r$count)

  sf_use_s2(FALSE)   # planar GEOS on lon/lat for the cleaned shapes, their union and the checks below
  raw <- st_geometry(x)
  if (!is.null(r$simplify)) raw <- simplify_shared(drop_small(raw, r$simplify$min_km2), r$simplify$tolerance)
  geoms <- st_sfc(lapply(raw, clean_geom), crs = 4326)
  if (!is.null(r$simplify)) for (pass in 1:3) {   # rounding can make a narrow simplified inlet touch itself:
    bad <- which(!st_is_valid(geoms))              # repair those (existing vertices kept), round again
    if (!length(bad)) break
    for (i in bad) {
      # every polygon of the repaired shape kept (a collection gives one feature per part), and the area unchanged
      parts <- st_cast(suppressWarnings(st_collection_extract(st_make_valid(geoms[i]), "POLYGON")), "MULTIPOLYGON")
      fixed <- clean_geom(st_multipolygon(do.call(c, lapply(parts, unclass))))
      a0 <- as.numeric(st_area(st_set_crs(geoms[i], NA)))
      a1 <- as.numeric(st_area(st_set_crs(st_sfc(fixed, crs = 4326), NA)))
      if (abs(a1 - a0) / a0 > 1e-4) stop(id, ": repairing ", x$name[i], " changed its area by ", signif(100 * (a1 - a0) / a0, 3), "%")
      geoms[[i]] <- fixed
    }
  }
  keys <- vapply(x$name, function(n) county_key(r$code, n, r$suffixes), "")
  if (anyDuplicated(x$gid)) stop(id, ": repeated official ID")
  if (anyDuplicated(keys)) stop(id, ": repeated key ", keys[duplicated(keys)][1])
  valid <- st_is_valid(geoms)
  if (!all(valid)) stop(id, ": invalid after rounding: ", paste(x$name[!valid], collapse = ", "))
  bb <- st_bbox(geoms)
  if (bb[["xmin"]] < r$bbox[1] || bb[["ymin"]] < r$bbox[2] || bb[["xmax"]] > r$bbox[3] || bb[["ymax"]] > r$bbox[4])
    stop(id, ": extent ", paste(round(bb, 3), collapse = " "), " outside the expected box")

  outline <- suppressMessages(st_union(geoms))
  outline <- st_sfc(clean_geom(st_cast(outline[[1]], "MULTIPOLYGON")), crs = 4326)
  if (!st_is_valid(outline)) stop(id, ": outline invalid")
  planar_area <- function(g) as.numeric(st_area(st_set_crs(g, NA)))   # square degrees: a relative check only
  a_out <- planar_area(outline); a_sum <- sum(planar_area(geoms))
  if (abs(a_out - a_sum) / a_sum > 1e-6) stop(id, ": outline area ", a_out, " differs from its counties' ", a_sum)

  # Label points: centroid with s2 on (as wa-counties.js; planar for a shape s2 does not accept, e.g. a simplified
  # inlet whose edges cross on the sphere), else a point on the surface; inside after rounding.
  cen <- lapply(seq_along(geoms), function(i) {
    sf_use_s2(TRUE); on.exit(sf_use_s2(FALSE))
    tryCatch(st_centroid(geoms[i]), error = function(e) { sf_use_s2(FALSE); suppressWarnings(st_centroid(geoms[i])) })
  })
  sf_use_s2(FALSE)
  inside <- function(p, i) suppressMessages(st_intersects(st_sfc(st_point(p), crs = 4326), geoms[i], sparse = FALSE)[1, 1])
  pts <- lapply(seq_along(geoms), function(i) {
    p <- round(st_coordinates(cen[[i]])[1, 1:2], DIGITS)
    if (!inside(p, i)) {
      p <- round(st_coordinates(suppressMessages(suppressWarnings(st_point_on_surface(geoms[i]))))[1, 1:2], DIGITS)
      if (!inside(p, i)) stop(id, ": no label point inside ", x$name[i])
    }
    unname(p)
  })

  coords <- function(g) lapply(unclass(g), function(p) lapply(p, function(m) m))
  features <- lapply(seq_along(geoms), function(i) list(type = "Feature",
    properties = list(name = x$name[i], key = unname(keys[i]), gid = x$gid[i]),
    geometry = list(type = "MultiPolygon", coordinates = coords(geoms[[i]]))))
  labels <- lapply(seq_along(geoms), function(i)
    list(name = x$name[i], key = unname(keys[i]), lon = pts[[i]][1], lat = pts[[i]][2]))
  payload <- list(
    id = id, name = r$name, code = r$code,
    source = paste0(s$describe, " (", s$filter_col, " ", r$filter, "), SHA-256 ", s$sha256, "; transformed to EPSG:4326",
                    if (is.null(r$simplify)) "" else paste0(", islands under ", r$simplify$min_km2, " km2 left out, shared borders simplified to ",
                                                            r$simplify$tolerance, " degrees"),
                    ", coordinates rounded to ", DIGITS, " decimals, repeated points dropped"),
    attribution = s$attribution,
    outline = list(type = "Feature", properties = list(name = r$name, key = r$code),
                   geometry = list(type = "MultiPolygon", coordinates = coords(outline[[1]]))),
    counties = list(type = "FeatureCollection", features = features),
    labels = labels)
  if (!is.null(s$statement)) payload$statement <- s$statement
  json <- toJSON(payload, auto_unbox = TRUE, digits = NA)
  out_path <- file.path(out_dir, paste0(id, ".js"))
  writeLines(c(
    paste0("/* Generated by build/derive_regions.R from ", s$describe, ". Do not edit. */"),
    paste0("(window.WSDA_REGION_DATA = window.WSDA_REGION_DATA || {})['", id, "'] = ", json, ";")),
    out_path, useBytes = TRUE)
  cat(sprintf("%s: %d counties, outline %d polygons, %d vertices, %.0f KB -> %s\n", id, nrow(x),
              length(outline[[1]]), nrow(st_coordinates(geoms)), file.size(out_path) / 1024, out_path))
}
