#!/usr/bin/env Rscript
# S11 reference: CVI's own Premise Lookup engine, run_proximity_query (shiny/R/map_helpers.R), on the synthetic
# scenarios of tests/synthetic/make_s11_fixtures.js.
#
# For each scenario the script loads the master with CVI's load_master_csv, builds the sites as the Premise Lookup
# tab does (numbers parsed, the per-site band list dropped in Single mode, the global radii passed in Bands mode) and
# calls run_proximity_query unchanged. It writes what the engine returns: the status, the skipped sites and rows,
# the sites used with their radii, the matched rows (with the columns the engine adds), the membership with its ring,
# the per-site counts and the summary. For the 60-site grid it also writes geosphere's distances (the function CVI
# calls) from the first 300 rows' origins and destinations to every site, for the page's distance check.
# It also runs CVI's Premise Lookup module itself (shiny/modules/mod_premise_lookup.R, unchanged)
# through shiny::testServer, as the S7 reference runs mod_maps.R, for the tab's own steps in scenarios.json "module":
# the pasted rows, the uploaded files, the sites added one by one, the cell edits, the band radii check and Run query.
# It writes the sites table after each step and every notification CVI shows (its text and type), and for Run query
# the result's status and summary (showNotification is replaced here by a function that records them) and the
# file its "Export CSV" button writes. Also the zone files of scenarios.json "zones", read
# with sf and tested with GEOS (see "Zone files" below).
# Also CVI's branded proximity PNG (render_branded_proximity_map in shiny/R/static_map_renderer.R) for
# the cases of scenarios.json "pngs": the module's "Download branded PNG" button, run by testServer after Run query,
# with its "Branded map options". As the S9 reference does, traces on cowplot's draw_plot, draw_label and draw_grob
# and on ggplot2's ggsave record each region of the page as it is placed, and every text, mark and color is read
# from those plots with ggplot2::layer_data(); the renderer's own arguments are kept too, and CVI's PNG is copied for
# side-by-side comparison with the page's. Written to oracle_s11_png.json. S11_PNG_ONLY=1 runs this part alone (oracle_s11.json is then
# left as it is).
# Also CVI's "Find coordinates" through the module for scenarios.json "geocode", with its two network
# steps replaced by stubs (nothing leaves the computer; see the geocode part of the module steps).
# CVI's files are only read; nothing is installed.
#
# Usage (repository root, as a background job, never with a shell "&"):
#   Rscript tests/oracle/s11_proximity_oracle.R
# Needs: node tests/node/run_f1_unit_tests.js (the tiers), then node tests/synthetic/make_s11_fixtures.js.
# CVI checkout: ../CVI_Traceability or the environment variable CVI_TRACEABILITY_DIR.
# Output (git-ignored): local-test-artifacts/s11/oracle_s11.json, oracle_s11_png.json and CVI's
#   PNGs in local-test-artifacts/s11/cvi_png/.
# R packages: jsonlite, data.table, dplyr, geosphere, sf (map_helpers.R loads them; also the zone files), openssl;
# for the module part shiny and DT (the module's table output is created when it starts); for the PNG part also
# ggplot2, cowplot, png, shadowtext, scales and ggrepel (as the S9 reference).

suppressPackageStartupMessages(library(jsonlite))

repo_root <- local({
  a <- commandArgs(trailingOnly = FALSE)
  f <- sub("^--file=", "", a[grep("^--file=", a)])
  normalizePath(file.path(dirname(normalizePath(f[1])), "..", ".."))
})
cvi_dir <- Sys.getenv("CVI_TRACEABILITY_DIR",
                      unset = file.path(dirname(repo_root), "CVI_Traceability"))
out_dir <- file.path(repo_root, "local-test-artifacts", "s11")
sha256 <- function(p) paste(as.character(openssl::sha256(file(p))), collapse = "")

# ── CVI's code must be the version these references were written against ───────────────────────
expected_sha <- c(
  "R/map_helpers.R"   = "ceddb9ac9ca3a6b8eb4fe58ccdf173ea563207a80f87f178781aad36a234a66c",
  "R/master_loader.R" = "7bd156663706303a8fecca8eb9abf8aa159900055c1f00e702cf7fefa8cbf931",
  "modules/mod_premise_lookup.R" = "50e2ff48a879fddac8e3ab242af9844b07bc89e3406a008fc1693281adaa1ff3",
  "R/geocode_site.R" = "2a4a3bbc65dce25ae0e389d917cadff2cf60a54e79e1bcccda8fc77ea2c8f121")
for (f in names(expected_sha)) {
  got <- sha256(file.path(cvi_dir, "shiny", f))
  if (!identical(got, expected_sha[[f]]))
    stop("CVI's ", f, " differs from the checked version (SHA-256 ", got, "). Stop and report.")
}
suppressPackageStartupMessages(
  for (f in c("R/master_loader.R", "R/map_helpers.R"))
    source(file.path(cvi_dir, "shiny", f), local = .GlobalEnv))
cvi_rev <- system2("git", c("-C", shQuote(cvi_dir), "rev-parse", "HEAD"), stdout = TRUE)

fx_file <- file.path(out_dir, "fixtures", "scenarios.json")
if (!file.exists(fx_file)) stop("Run node tests/synthetic/make_s11_fixtures.js first.")
fx <- fromJSON(fx_file, simplifyVector = FALSE)
png_only <- nzchar(Sys.getenv("S11_PNG_ONLY"))

# ── Sites as the Premise Lookup tab builds them ────────────────────────────────────────────────
# Its parsers turn latitude, longitude and buffer into numbers (as.numeric; text becomes NA) and keep a per-site
# band list as text. In Single mode run_query drops the band lists; in Bands mode it passes the global radii.
num_or_na <- function(x) if (is.null(x)) NA_real_ else suppressWarnings(as.numeric(x))
sites_frame <- function(sites, mode) {
  df <- data.frame(
    name      = vapply(sites, function(s) as.character(s$name), character(1)),
    lat       = vapply(sites, function(s) num_or_na(s$lat), numeric(1)),
    long      = vapply(sites, function(s) num_or_na(s$long), numeric(1)),
    buffer_km = vapply(sites, function(s) num_or_na(s$buffer_km), numeric(1)),
    bands_csv = vapply(sites, function(s) if (is.null(s$bands_csv)) NA_character_ else
      as.character(s$bands_csv), character(1)),
    stringsAsFactors = FALSE)
  if (!identical(mode, "bands")) df$bands_csv <- NULL
  df
}

# ── Run every scenario ─────────────────────────────────────────────────────────────────────────
masters <- list()
master_of <- function(rel) {
  if (is.null(masters[[rel]])) masters[[rel]] <<- load_master_csv(file.path(repo_root, rel))
  masters[[rel]]
}
na_null <- function(x) if (length(x) == 0L || all(is.na(x))) NULL else x
results <- list()
distances <- NULL
if (!png_only) {
  for (sc in fx$scenarios) {
    df <- master_of(sc$master)
    sites <- sites_frame(sc$sites, sc$mode)
    filters <- list(year = as.integer(unlist(sc$filters$year)),
                    quarter = as.character(unlist(sc$filters$quarter)),
                    species = as.character(unlist(sc$filters$species)))
    bands <- if (identical(sc$mode, "bands")) as.numeric(unlist(sc$bands)) else NULL
    t0 <- proc.time()[["elapsed"]]
    r <- run_proximity_query(df, sites, default_buffer_km = as.numeric(sc$default_buffer_km),
                             endpoint = sc$endpoint, filters = filters, bands = bands)
    ms <- round((proc.time()[["elapsed"]] - t0) * 1000)
    out <- list(name = sc$name, status = r$status, ms = ms, has_cvi = r$has_cvi,
                n_skipped_sites = r$n_skipped_sites, n_skipped_coords = r$n_skipped_coords,
                missing_cols = r$missing_cols, bands_mode = r$bands_mode,
                n_master = nrow(df))
    if (!is.null(r$sites_df_used)) {
      s <- r$sites_df_used
      out$sites_used <- lapply(seq_len(nrow(s)), function(k) list(
        site_id = s$site_id[k], name = s$name[k], lat = s$lat[k], long = s$long[k],
        buffer_km = s$buffer_km[k], buffer_km_user = na_null(s$buffer_km_user[k]),
        bands = if (is.null(r$site_bands)) NULL else I(as.numeric(r$site_bands[[k]]))))
    }
    if (r$status %in% c("ok", "no_match")) {
      m <- r$matched_df
      out$matched <- lapply(seq_len(nrow(m)), function(i) list(
        CVI = m$CVI[i], Movement = m$Movement[i], Species.Group = m$Species.Group[i],
        Reporting.Year = m$Reporting.Year[i], Reporting.Quarter = m$Reporting.Quarter[i],
        Total.Animals = na_null(m$Total.Animals[i]),
        Origin.Lat = na_null(m$Origin.Lat[i]), Origin.Long = na_null(m$Origin.Long[i]),
        Dest.Lat = na_null(m$Dest.Lat[i]), Dest.Long = na_null(m$Dest.Long[i]),
        hit_origin = m$.hit_origin[i], hit_dest = m$.hit_dest[i], matched_sites = m$matched_sites[i],
        nearest_site_km = na_null(m$nearest_site_km[i]), nearest_band_km = na_null(m$nearest_band_km[i])))
      mb <- r$membership
      out$membership <- lapply(seq_len(nrow(mb)), function(j) list(
        row_id = mb$row_id[j], CVI = mb$CVI[j], site_id = mb$site_id[j], hit_origin = mb$hit_origin[j],
        hit_dest = mb$hit_dest[j], band_km = mb$band_km[j]))
      out$site_cvi_counts <- I(as.integer(r$site_cvi_counts))
      out$site_origin_counts <- I(as.integer(r$site_origin_counts))
      out$site_dest_counts <- I(as.integer(r$site_dest_counts))
      out$summary <- r$summary
    }
    results[[length(results) + 1L]] <- out

    # geosphere's distances (CVI's own call) from the first 300 rows to the 60 grid sites.
    if (identical(sc$name, "grid_60_sites")) {
      sub <- df[seq_len(min(300L, nrow(df))), , drop = FALSE]
      nm <- function(x) suppressWarnings(as.numeric(x))
      sp <- cbind(sites$long, sites$lat)
      km <- function(lat, lon) {
        bad <- is.na(lat) | is.na(lon) | abs(lat) > 90 | abs(lon) > 180
        lat[bad] <- NA; lon[bad] <- NA
        geosphere::distm(cbind(lon, lat), sp, fun = geosphere::distHaversine) / 1000
      }
      distances <- list(scenario = sc$name, rows = nrow(sub),
                        origin = km(nm(sub$Origin.Lat), nm(sub$Origin.Long)),
                        dest = km(nm(sub$Dest.Lat), nm(sub$Dest.Long)))
    }
    cat(sprintf("  %-28s %-18s %4s matched rows, %4s membership rows, %5d ms\n", sc$name, r$status,
                if (is.null(out$matched)) "-" else length(out$matched),
                if (is.null(out$membership)) "-" else length(out$membership), ms))
  }
}

# ── The tab's own steps: CVI's module through shiny::testServer ───────────────────────────────
suppressPackageStartupMessages({
  library(shiny)
  source(file.path(cvi_dir, "shiny", "modules", "mod_premise_lookup.R"), local = .GlobalEnv)
})
# CVI's notifications, recorded instead of shown (the module finds this one first: it was sourced here).
notes <- new.env()
showNotification <- function(ui, action = NULL, duration = 5, closeButton = TRUE, id = NULL,
                             type = "default", session = NULL) {
  notes$list[[length(notes$list) + 1L]] <- list(text = paste(as.character(ui), collapse = ""), type = type)
  invisible(id)
}
# A number as JSON keeps R's infinities apart from NA (written "Inf" and "-Inf"; NA becomes null).
num_json <- function(x) if (is.numeric(x) && is.infinite(x)) (if (x > 0) "Inf" else "-Inf") else x
table_rows <- function(df) lapply(seq_len(nrow(df)), function(k) list(
  name = df$name[k], lat = num_json(df$lat[k]), long = num_json(df$long[k]),
  buffer_km = num_json(df$buffer_km[k]), bands_csv = df$bands_csv[k]))
fx_sites <- function(sites) data.frame(
  name      = vapply(sites, function(s) as.character(s$name), character(1)),
  lat       = vapply(sites, function(s) num_or_na(s$lat), numeric(1)),
  long      = vapply(sites, function(s) num_or_na(s$long), numeric(1)),
  buffer_km = vapply(sites, function(s) num_or_na(s$buffer_km), numeric(1)),
  bands_csv = vapply(sites, function(s) if (is.null(s$bands_csv)) NA_character_ else
    as.character(s$bands_csv), character(1)),
  stringsAsFactors = FALSE)
# One fresh module per step list; body(session, obj) runs the steps, obj(name) giving the module's own objects
# (its sites_state, .stamp_sites, .validate_band_radii, query_result and rv).
with_module <- function(body) {
  notes$list <- list()
  box <- new.env()   # the steps' result (an assignment inside testServer stays in the session's own environment)
  testServer(mod_premise_lookup_server,
             args = list(rv = reactiveValues(master_df = NULL, master_loading = FALSE),
                         project_root = out_dir), {
    here <- environment()
    box$out <- body(session, function(name) get(name, envir = here))
  })
  if (is.null(box$out)) stop("A module step list returned nothing.")
  box$out
}
take_notes <- function() { n <- notes$list; notes$list <- list(); n }
# CVI's registry folder (shiny/R/paths.R), here only for the geocode cache: each address case sets the file.
geo <- new.env()   # the address cases' cache file, network calls and box values
cvi_dir_registry <- function(...) geo$path
if (!png_only) {
  M <- fx$module
  module_out <- list()
  module_out$pastes <- lapply(M$pastes, function(cs) with_module(function(session, obj) {
    session$setInputs(bulk_paste = cs$text, bulk_apply = 1L)
    list(name = cs$name, sites = table_rows(obj("sites_state")()), notes = take_notes())
  }))
  module_out$uploads <- lapply(M$uploads, function(cs) with_module(function(session, obj) {
    f <- file.path(repo_root, cs$file)
    session$setInputs(upload_csv = data.frame(name = basename(f), size = file.size(f), type = "text/csv",
                                              datapath = f, stringsAsFactors = FALSE))
    list(name = cs$name, sites = table_rows(obj("sites_state")()), notes = take_notes())
  }))
  module_out$adds <- with_module(function(session, obj) {
    steps <- list()
    for (k in seq_along(M$adds)) {
      a <- M$adds[[k]]
      session$setInputs(new_name = a$name, new_lat = num_or_na(a$lat), new_long = num_or_na(a$long),
                        new_buffer = num_or_na(a$buffer), site_add = k)
      steps[[k]] <- list(sites = table_rows(obj("sites_state")()), notes = take_notes())
    }
    steps
  })
  module_out$edits <- lapply(M$edits, function(cs) with_module(function(session, obj) {
    session$setInputs(buffer_mode = cs$mode)
    obj("sites_state")(obj(".stamp_sites")(fx_sites(cs$sites)))
    lapply(cs$edits, function(e) {
      session$setInputs(sites_table_cell_edit = list(row = e$row, col = e$col, value = e$value))
      list(sites = table_rows(obj("sites_state")()))
    })
  }))
  module_out$bands <- with_module(function(session, obj) lapply(M$bands, function(text) {
    v <- obj(".validate_band_radii")(text)
    list(text = text, radii = if (is.null(v)) NULL else I(v), notes = take_notes())
  }))
  module_out$runs <- lapply(M$runs, function(cs) with_module(function(session, obj) {
    df <- suppressWarnings(master_of(cs$master))
    inputs <- list(buffer_mode = cs$mode, band_radii = cs$band_radii, filter_endpoint = cs$endpoint,
                   default_buffer_km = if (is.null(cs$default_buffer_km)) NA_real_ else cs$default_buffer_km)
    if (length(cs$years)) inputs$filter_year <- as.character(unlist(cs$years))
    if (length(cs$quarters)) inputs$filter_quarter <- as.character(unlist(cs$quarters))
    if (length(cs$species)) inputs$filter_species <- as.character(unlist(cs$species))
    do.call(session$setInputs, inputs)
    rv <- obj("rv")
    rv$master_df <- df
    session$flushReact()
    if (length(cs$sites)) obj("sites_state")(obj(".stamp_sites")(fx_sites(cs$sites)))
    take_notes()
    session$setInputs(run_query = 1L)
    r <- obj("query_result")()
    # The file CVI's "Export CSV" button writes (its downloadHandler, run by testServer), as bytes.
    csv_path <- tryCatch(obj("output")$download_csv, error = function(e) NULL)
    csv <- if (is.null(csv_path) || !file.exists(csv_path)) NULL else
      rawToChar(readBin(csv_path, "raw", file.size(csv_path)))
    list(name = cs$name, notes = take_notes(), csv = csv,
         result = if (is.null(r)) NULL else list(status = r$status, summary = r$summary,
                                                 matched = nrow(r$matched_df), bands_mode = r$bands_mode,
                                                 sites = I(r$sites_df_used$name)))
  }))
  # "Find coordinates" (the module's geocode_find) for scenarios.json "geocode". CVI's two network
  # steps are replaced by stubs that find nothing and record the call, so nothing leaves the computer and CVI's answer
  # is its cache answer; "online" says where CVI would have asked the Census Bureau and Nominatim. The registry folder
  # is pointed at each case's cache file (a missing path for no file). The coordinates the module puts in the
  # Latitude and Longitude boxes are recorded from its updateNumericInput calls.
  suppressPackageStartupMessages(source(file.path(cvi_dir, "shiny", "R", "geocode_site.R"), local = .GlobalEnv))
  .geocode_census <- function(address) { geo$online <- TRUE; NULL }
  .geocode_nominatim <- function(address) { geo$online <- TRUE; NULL }
  updateNumericInput <- function(session, inputId, label = NULL, value = NULL, ...) {
    geo$boxes[[inputId]] <- value
    invisible(NULL)
  }
  G <- fx$geocode
  module_out$geocode <- lapply(G$cases, function(cs) with_module(function(session, obj) {
    geo$online <- FALSE
    geo$boxes <- list()
    geo$path <- if (is.null(cs$cache)) file.path(out_dir, "no_such_folder", "geocode_cache.csv") else
      file.path(repo_root, G$dir, cs$cache)
    session$setInputs(new_address = cs$address, geocode_find = 1L)
    m <- obj("geocode_msg")()
    list(address = cs$address, cache = cs$cache, level = m$level, text = m$text, online = geo$online,
         lat = num_json(if (is.null(geo$boxes$new_lat)) NA_real_ else geo$boxes$new_lat),
         long = num_json(if (is.null(geo$boxes$new_long)) NA_real_ else geo$boxes$new_long))
  }))
  rm(updateNumericInput, .geocode_census, .geocode_nominatim)
  cat(sprintf("  module: %d address lookups (%d would have gone online in CVI)\n", length(module_out$geocode),
              sum(vapply(module_out$geocode, function(g) isTRUE(g$online), logical(1)))))
  cat(sprintf("  module: %d pastes, %d uploads, %d adds, %d edit lists, %d band texts, %d runs\n",
              length(module_out$pastes), length(module_out$uploads), length(module_out$adds),
              length(module_out$edits), length(module_out$bands), length(module_out$runs)))
}

if (!png_only) {
  # ── Zone files: read with sf (GDAL) and tested with GEOS, independently of the page ───────────────────────────
  # For each zone file the page should read (scenarios.json "zones"), the zones sf reads (polygon shapes only; empty
  # shapes, points and lines left out, as the page does), their names, and for every test point and every origin and
  # destination of the Full tier, which zones hold it (st_intersects, planar: sf_use_s2(FALSE), so the edges are
  # straight lines in longitude and latitude, as the page's even-odd test treats them).
  suppressPackageStartupMessages(library(sf))
  invisible(sf_use_s2(FALSE))
  Z <- fx$zones
  full_df <- master_of(fx$full)
  zone_points <- rbind(
    do.call(rbind, lapply(Z$points, function(p) c(p[[1]], p[[2]]))),
    cbind(suppressWarnings(as.numeric(full_df$Origin.Long)), suppressWarnings(as.numeric(full_df$Origin.Lat))),
    cbind(suppressWarnings(as.numeric(full_df$Dest.Long)), suppressWarnings(as.numeric(full_df$Dest.Lat))))
  ok_pt <- stats::complete.cases(zone_points) & abs(zone_points[, 1]) <= 180 & abs(zone_points[, 2]) <= 90
  pts_sf <- st_as_sf(data.frame(x = zone_points[ok_pt, 1], y = zone_points[ok_pt, 2]), coords = c("x", "y"), crs = 4326)
  zone_out <- list(n_grid = length(Z$points), n_rows = nrow(full_df), files = list())
  for (f in Z$files$read) {
    p <- file.path(repo_root, Z$dir, f)
    src <- if (grepl("\\.zip$", f)) paste0("/vsizip/", p, "/zones/zones.shp") else p
    z <- suppressWarnings(st_read(src, quiet = TRUE))
    z <- z[!st_is_empty(z), , drop = FALSE]
    gt <- as.character(st_geometry_type(z))
    if (any(gt == "GEOMETRYCOLLECTION")) z <- suppressWarnings(st_collection_extract(z, "POLYGON"))
    z <- z[as.character(st_geometry_type(z)) %in% c("POLYGON", "MULTIPOLYGON"), , drop = FALSE]
    z <- st_set_crs(st_zm(z), 4326)
    nm_col <- intersect(c("NAME", "Name", "name", "zone_name"), names(z))
    hits <- st_intersects(pts_sf, z)
    holding <- vector("list", nrow(zone_points))
    idx <- which(ok_pt)
    for (k in seq_along(idx)) holding[[idx[k]]] <- I(as.integer(hits[[k]]))
    zone_out$files[[f]] <- list(
      zones = nrow(z), names = I(if (length(nm_col)) as.character(z[[nm_col[1]]]) else rep(NA_character_, nrow(z))),
      parts = I(vapply(seq_len(nrow(z)), function(k) length(st_geometry(st_cast(z[k, ], "POLYGON", warn = FALSE))), integer(1))),
      holding = lapply(holding, function(h) if (is.null(h)) I(integer(0)) else h))
    cat(sprintf("  zones: %-24s %d zones, %d point hits\n", f, nrow(z), sum(lengths(hits))))
  }

  # Numbers as write.csv (write.table) writes them, one at a time (scenarios.json "csvNumbers").
  csv_numbers <- vapply(fx$csvNumbers, function(x) {
    tc <- textConnection("line", "w", local = TRUE)
    utils::write.table(as.numeric(x), tc, col.names = FALSE, row.names = FALSE)
    close(tc)
    line
  }, character(1))

  ref <- list(
    made_by = "tests/oracle/s11_proximity_oracle.R", cvi_rev = cvi_rev, cvi_sha = as.list(expected_sha),
    r_version = R.version.string, geosphere = as.character(utils::packageVersion("geosphere")),
    shiny = as.character(utils::packageVersion("shiny")),
    sf = as.character(utils::packageVersion("sf")),
    fixtures_sha = sha256(fx_file), scenarios = results, distances = distances, module = module_out,
    zones = zone_out, csv_numbers = I(csv_numbers))
  dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)
  write_json(ref, file.path(out_dir, "oracle_s11.json"), auto_unbox = TRUE, digits = NA, null = "null",
             na = "null", pretty = FALSE)
  cat("S11 reference: ", length(results), " scenarios written to local-test-artifacts/s11/oracle_s11.json\n", sep = "")
}

# ── The branded proximity PNG: CVI's render_branded_proximity_map through the module ─────────────────────────────
# The renderer and its helpers, checked as the S9 reference checks them; the logo is CVI's own file.
png_sha <- c(
  "R/static_map_renderer.R" = "099e94baf9bfb4a99d54fc2bb0def8f4580c8414da5b928d71562beffd0a47f4",
  "R/tile_basemap.R"        = "9e5f955cb69731de9699e43e457c32c5fd4b2bbecf84455a65f995d3f1903b56",
  "www/img/wsda_logo.png"   = "1bdff086b0bc3aab9b0adb3135714ffc08d10e028e77940cb82f810cec2d9b72")
for (f in names(png_sha)) {
  got <- sha256(file.path(cvi_dir, "shiny", f))
  if (!identical(got, png_sha[[f]]))
    stop("CVI's ", f, " differs from the one the S9 and S11 references read (SHA-256 ", got, "). Stop and report.")
}
suppressPackageStartupMessages(
  for (f in c("R/ui_helpers.R", "R/tile_basemap.R", "R/static_map_renderer.R"))
    source(file.path(cvi_dir, "shiny", f), local = .GlobalEnv))
# "Last Updated" and the file name use today's date; pinned here so the reference does not change by day.
PINNED_DATE <- as.Date("2026-10-14")
Sys.Date <- function() PINNED_DATE

# A sandbox for the renderer's files, as in the S9 reference: CVI's logo, the site's bundled Census counties (CVI's
# own polygon file is in its reference folder, which is not read), the Full tier's synthetic facility files (already
# under CVI's file names) and CVI's Streets files (public Census, USGS and Natural Earth data).
cvi_root <- file.path(out_dir, "cvi_root")
unlink(cvi_root, recursive = TRUE)
dir.create(file.path(cvi_root, "reference"), recursive = TRUE)
dir.create(file.path(cvi_root, "www", "img"), recursive = TRUE)
invisible(file.copy(file.path(cvi_dir, "shiny", "www", "img", "wsda_logo.png"), file.path(cvi_root, "www", "img")))
full_dir <- dirname(file.path(repo_root, fx$full))
for (k in names(.OVERLAY_REGISTRY)) {
  src <- file.path(full_dir, .OVERLAY_REGISTRY[[k]]$file)
  if (!file.exists(src)) stop("The Full tier has no ", .OVERLAY_REGISTRY[[k]]$file, ". Run node tests/node/run_f1_unit_tests.js.")
  invisible(file.copy(src, file.path(cvi_root, "reference")))
}
tiger_src <- file.path(cvi_dir, "reference", "tiger_wa")
if (dir.exists(tiger_src)) {
  dir.create(file.path(cvi_root, "reference", "tiger_wa"), recursive = TRUE, showWarnings = FALSE)
  invisible(file.copy(list.files(tiger_src, pattern = "[.]rds$", full.names = TRUE),
                      file.path(cvi_root, "reference", "tiger_wa")))
}
sandbox_path <- function(kind) function(...) file.path(cvi_root, kind, ...)
cvi_dir_reference <- sandbox_path("reference")
cvi_dir_exports <- sandbox_path("exports")
cvi_dir_www <- sandbox_path("www")
cvi_dir_tile_cache <- sandbox_path("tile_cache")
local({
  ring <- function(r) do.call(rbind, lapply(r, unlist))
  shape <- function(g) {
    if (g$type == "Polygon") sf::st_polygon(lapply(g$coordinates, ring))
    else sf::st_multipolygon(lapply(g$coordinates, function(p) lapply(p, ring)))
  }
  txt <- readLines(file.path(repo_root, "site", "geo", "wa-counties.js"), warn = FALSE)
  geo <- fromJSON(sub(";$", "", sub("^window.CVIWA_GEO = ", "", txt[2])), simplifyVector = FALSE)
  feats <- geo$counties$features
  counties <- sf::st_sf(name = vapply(feats, function(f) f$properties$name, ""),
                        geometry = sf::st_sfc(lapply(feats, function(f) shape(f$geometry)), crs = 4326))
  suppressMessages(sf::st_write(counties, cvi_dir_reference("wa_counties_polygons.gpkg"), quiet = TRUE))
})

# Recording CVI's page as it is composed (the S9 reference's traces): each region in the order the renderer places
# it; ggsave's trace keeps the page size. The traces change nothing in CVI's code.
placed <- list()
saved <- NULL
prox_renders <- list()
record <- function(kind, ...) placed[[length(placed) + 1L]] <<- c(list(kind = kind), list(...))
invisible(suppressMessages({
  trace("draw_plot", where = asNamespace("cowplot"), print = FALSE,
        tracer = quote(record("plot", plot = plot, x = x, y = y, width = width, height = height)))
  trace("draw_label", where = asNamespace("cowplot"), print = FALSE,
        tracer = quote(record("label", label = label, x = x, y = y, hjust = hjust, vjust = vjust,
                              size = size, fontface = fontface, fontfamily = fontfamily,
                              color = if (!missing(colour)) colour else color)))
  trace("draw_grob", where = asNamespace("cowplot"), print = FALSE,
        tracer = quote(record("grob", grob = grob, x = x, y = y, width = width, height = height,
                              hjust = hjust, vjust = vjust)))
  trace("ggsave", where = asNamespace("ggplot2"), print = FALSE,
        tracer = quote(saved <<- list(file = basename(filename), width_in = width, height_in = height,
                                      dpi = dpi, bg = bg)))
}))
# The renderer's own arguments, kept on entry (the module finds this one first: it is in the global environment).
render_proximity <- render_branded_proximity_map
render_branded_proximity_map <- function(...) {
  prox_renders[[length(prox_renders) + 1L]] <<- list(...)
  render_proximity(...)
}
# One ggplot as plain values (the S9 reference's plot_record): its background, margins, panel ranges and every
# layer's rows from layer_data(). Point geometries become x and y; other geometries are counted, not copied.
plot_record <- function(p) {
  bg <- p$theme$plot.background
  margin <- p$theme$plot.margin
  b <- ggplot2::ggplot_build(p)
  pp <- b$layout$panel_params[[1]]
  layers <- lapply(seq_along(p$layers), function(i) {
    d <- ggplot2::layer_data(p, i)
    rec <- list(geom = class(p$layers[[i]]$geom)[1], rows = nrow(d))
    if ("geometry" %in% names(d)) {
      g <- d$geometry
      types <- unique(as.character(sf::st_geometry_type(g)))
      rec$geometry <- types
      if (identical(types, "POINT")) {
        xy <- sf::st_coordinates(g)
        d$x <- xy[, 1]
        d$y <- xy[, 2]
      }
      d$geometry <- NULL
    }
    keep <- intersect(names(d), c("label", "x", "y", "xend", "yend", "xmin", "xmax", "ymin", "ymax",
                                  "colour", "fill", "size", "stroke", "shape", "alpha", "linewidth",
                                  "fontface", "family", "hjust", "vjust", "bg.colour", "bg.r"))
    rec$data <- as.data.frame(lapply(d[keep], function(col) if (is.list(col)) unlist(col) else col))
    rec
  })
  list(background = list(fill = bg$fill, colour = bg$colour, linewidth = bg$linewidth),
       margin_pt = if (is.null(margin)) NULL else as.numeric(margin),
       x_range = pp$x_range, y_range = pp$y_range, layers = layers)
}
page_record <- function() {
  kept <- Filter(function(e) e$kind != "grob" || !is.null(e$grob$raster), placed)
  lapply(kept, function(e) {
    if (e$kind == "plot") {
      list(kind = "plot", x = e$x, y = e$y, width = e$width, height = e$height, plot = plot_record(e$plot))
    } else if (e$kind == "grob") {
      img <- e$grob$raster
      list(kind = "grob", x = e$x, y = e$y, width = e$width, height = e$height, hjust = e$hjust, vjust = e$vjust,
           raster = if (is.null(img)) NULL else dim(img)[1:2])
    } else {
      e
    }
  })
}
png_size <- function(p) {
  b <- readBin(p, "raw", 24L)
  to_int <- function(x) sum(as.integer(x) * 256^(3:0))
  list(width = to_int(b[17:20]), height = to_int(b[21:24]))
}
# The renderer's arguments as plain values: the sites drawn, the matched rows' endpoints and hit flags, the bands,
# the counts and filters, and each facility layer's points.
iv <- function(x) if (is.null(x)) NULL else I(x)   # I() refuses NULL (an empty filter)
proximity_args <- function(a) {
  s <- a$sites_df
  m <- a$matched_df
  pick <- function(col) if (!is.null(m) && col %in% names(m)) m[[col]] else NULL
  ov <- a[grep("^overlay_.*_sf$", names(a), value = TRUE)]
  list(
    sites = lapply(seq_len(nrow(s)), function(k) list(site_id = s$site_id[k], name = s$name[k], lat = s$lat[k],
      long = s$long[k], buffer_km = s$buffer_km[k], buffer_km_user = na_null(s$buffer_km_user[k]))),
    matched = if (is.null(m)) NULL else list(n = nrow(m), Origin.Lat = iv(pick("Origin.Lat")),
      Origin.Long = iv(pick("Origin.Long")), Dest.Lat = iv(pick("Dest.Lat")), Dest.Long = iv(pick("Dest.Long")),
      hit_origin = iv(pick(".hit_origin")), hit_dest = iv(pick(".hit_dest"))),
    endpoint = a$endpoint, summary = a$summary, bands_mode = isTRUE(a$bands_mode),
    site_bands = if (is.null(a$site_bands)) NULL else lapply(a$site_bands, function(v) I(as.numeric(v))),
    site_match_counts = iv(a$site_match_counts), site_origin_counts = iv(a$site_origin_counts),
    site_dest_counts = iv(a$site_dest_counts), species_filter = iv(a$species_filter), year_filter = iv(a$year_filter),
    quarter_filter = iv(a$quarter_filter), species_universe = iv(a$species_universe), live_basemap = a$live_basemap,
    overlay_show_labels = isTRUE(a$overlay_show_labels),
    overlays = lapply(ov[!vapply(ov, is.null, TRUE)], function(x) {
      xy <- sf::st_coordinates(x)
      list(name = I(x$ref_name), lon = I(xy[, 1]), lat = I(xy[, 2]))
    }))
}
png_dir <- file.path(out_dir, "cvi_png")
dir.create(png_dir, recursive = TRUE, showWarnings = FALSE)
png_cases <- lapply(fx$pngs, function(pc) with_module(function(session, obj) {
  cs <- pc$run
  df <- suppressWarnings(master_of(cs$master))
  inputs <- list(buffer_mode = cs$mode, band_radii = cs$band_radii, filter_endpoint = cs$endpoint,
                 default_buffer_km = if (is.null(cs$default_buffer_km)) NA_real_ else cs$default_buffer_km)
  if (length(cs$years)) inputs$filter_year <- as.character(unlist(cs$years))
  if (length(cs$quarters)) inputs$filter_quarter <- as.character(unlist(cs$quarters))
  if (length(cs$species)) inputs$filter_species <- as.character(unlist(cs$species))
  do.call(session$setInputs, inputs)
  rv <- obj("rv")
  rv$master_df <- df
  session$flushReact()
  obj("sites_state")(obj(".stamp_sites")(fx_sites(cs$sites)))
  session$setInputs(run_query = 1L)
  session$setInputs(prox_basemap = pc$basemap, prox_overlays = as.character(unlist(pc$overlays)),
                    prox_overlay_labels = isTRUE(pc$labels))
  r <- obj("query_result")()
  placed <<- list(); saved <<- NULL; prox_renders <<- list()
  t0 <- proc.time()[["elapsed"]]
  err <- NULL
  path <- tryCatch(obj("output")$download_branded_png, error = function(e) { err <<- conditionMessage(e); NULL })
  ms <- round((proc.time()[["elapsed"]] - t0) * 1000)
  out <- list(name = pc$name, notes = take_notes(), error = err, ms = ms,
              status = if (is.null(r)) NULL else r$status)
  if (length(prox_renders)) {
    out$render <- proximity_args(prox_renders[[1]])
    out$saved <- saved
    out$page <- page_record()
  }
  if (!is.null(path) && file.exists(path)) {
    out$png <- png_size(path)
    keep_as <- file.path(png_dir, paste0(gsub("[^A-Za-z0-9]+", "_", pc$name), ".png"))
    invisible(file.copy(path, keep_as, overwrite = TRUE))
    out$png_file <- sub(paste0(repo_root, "/"), "", keep_as)
  }
  cat(sprintf("  png: %-28s %-9s %5d ms%s\n", pc$name, if (is.null(r)) "-" else r$status, ms,
              if (is.null(err)) "" else paste0("  error: ", err)))
  out
}))
png_ref <- list(
  made_by = "tests/oracle/s11_proximity_oracle.R", cvi_rev = cvi_rev, cvi_sha = as.list(c(expected_sha, png_sha)),
  pinned_date = format(PINNED_DATE), r_version = R.version.string,
  ggplot2 = as.character(utils::packageVersion("ggplot2")), cowplot = as.character(utils::packageVersion("cowplot")),
  sf = as.character(utils::packageVersion("sf")), fixtures_sha = sha256(fx_file), cases = png_cases)
write_json(png_ref, file.path(out_dir, "oracle_s11_png.json"), auto_unbox = TRUE, digits = NA, null = "null",
           na = "null", pretty = FALSE)
cat("S11 PNG reference: ", length(png_cases), " cases written to local-test-artifacts/s11/oracle_s11_png.json\n",
    sep = "")
