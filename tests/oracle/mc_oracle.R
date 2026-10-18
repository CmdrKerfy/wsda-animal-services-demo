#!/usr/bin/env Rscript
# MC reference: within-state movement and chart cross-filtering, on synthetic data only.
#
# For each fixture and scenario the script records:
#   1. CVI's former county-to-county line map: build_intrastate_line_data() in CVI's map_helpers.R (still in the
#      file, no longer called by CVI), sourced unchanged from CVI's checkout and run as it is. Before its output is
#      kept, a plain R reading of its rule (Inbound rows, both states "WA", two different counties, county points
#      present) must give the same totals; the script stops if not.
#   2. The counting rules, written here from their plain statement and not from the page's code: the rows
#      counted and left out, each county's point, the county pairs (and pairs by species group), the option A
#      lines (top 25 between counties, CVI's 0.5 to 6 px widths) and rings (within one county), the option B grid
#      (the 15 busiest counties) and the option C county numbers, and the pairs touching a spotlight. Widths and
#      radii use CVI's own .compute_radius(). Also: county names without surrounding spaces, each pair's unique CVIs,
#      and the pairs between counties ranked by animals, CVI records and unique CVIs, ties in R's sort order of the
#      corridor chart's label.
# The page's loader rows are CVI's loader rows: each fixture is read by CVI's load_master_csv() from a copy that
# has one extra column, MC.File.Row (the row's place in the file, from 0), so the loader's two copies of an
# Intrastate row can be told apart from two rows of the file. CVI's files are only read.
#
# Part 2, chart cross-filtering: CVI's map module runs unchanged under
# shiny::testServer, as in the S7 reference, and for each fixture, Map View and scenario the script records CVI's
# own drawer charts (charts.R, from the module's .chart_inputs()) for every chart the page shows in that view:
#   - a species or period chart filter is set as the matching sidebar pick (that group alone, that year and quarter
#     alone), so the expected charts are CVI's own for those inputs;
#   - a place, pair or premises filter has no sidebar match: R filters the rows behind CVI's charts itself, written
#     from the rules and not from the page's code (place and premises: each loader copy at its own end; pair: the
#     corridor's two ends; all before CVI's merge), then runs CVI's chart functions on them: with
#     CVI's per-direction fix P1-12, top places, over time and emerging vs cooling on the rows the map draws (both
#     copies), species and corridors on the merged rows;
#   - the chart the click comes from keeps all its bars: it gets every filter but its own kind.
# Each chart is recorded for animals and for CVI records (CVI's chart with every row's animals set to 1).
#
# Usage (repository root):  Rscript tests/oracle/mc_oracle.R [rules | crossfilter] [fixture ...]
#   no part named: both parts; "rules": part 1 only (seconds); "crossfilter": part 2 only (about a minute).
# Needs: node tests/node/run_f1_unit_tests.js first (it writes the three tier bundles), and for part 2
#        node tests/synthetic/make_cvi_s7_fixtures.js (the S7 fixture).
# CVI checkout: ../CVI_Traceability or the environment variable CVI_TRACEABILITY_DIR.
# Output (git-ignored): local-test-artifacts/mc/oracle_mc_<fixture>.json (part 1) and
#        local-test-artifacts/mc/oracle_mc_cf_<fixture>.json (part 2).
# R packages: dplyr, data.table, geosphere, sf, classInt, jsonlite, openssl; for part 2 also those of the S7
# reference (shiny, bslib, shinyjs, cli, glue, DT, mapgl, bsicons, scales, ggplot2); nothing is installed.

suppressPackageStartupMessages(library(jsonlite))

repo_root <- local({
  a <- commandArgs(trailingOnly = FALSE)
  f <- sub("^--file=", "", a[grep("^--file=", a)])
  normalizePath(file.path(dirname(normalizePath(f[1])), "..", ".."))
})
cvi_dir <- Sys.getenv("CVI_TRACEABILITY_DIR",
                      unset = file.path(dirname(repo_root), "CVI_Traceability"))
out_dir <- file.path(repo_root, "local-test-artifacts", "mc")
dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)
sha256 <- function(p) paste(as.character(openssl::sha256(file(p))), collapse = "")

# ── CVI's code must be the version these rules were written against ──────────────────────────
expected_sha <- c(
  "R/master_loader.R" = "7bd156663706303a8fecca8eb9abf8aa159900055c1f00e702cf7fefa8cbf931",
  "R/map_helpers.R"   = "ceddb9ac9ca3a6b8eb4fe58ccdf173ea563207a80f87f178781aad36a234a66c")
for (f in names(expected_sha)) {
  got <- sha256(file.path(cvi_dir, "shiny", f))
  if (!identical(got, expected_sha[[f]]))
    stop("CVI's ", f, " differs from the checked version (SHA-256 ", got, "). Stop and report.")
}
suppressPackageStartupMessages({
  source(file.path(cvi_dir, "shiny", "R", "master_loader.R"), local = .GlobalEnv)
  source(file.path(cvi_dir, "shiny", "R", "map_helpers.R"), local = .GlobalEnv)
})
cvi_rev <- system2("git", c("-C", shQuote(cvi_dir), "rev-parse", "HEAD"), stdout = TRUE)

# ── Fixtures ───────────────────────────────────────────────────────────────────────────────────
tier_dir <- file.path(repo_root, "local-test-artifacts", "f1", "tiers")
fixtures <- list(
  movement = file.path(repo_root, "tests", "synthetic", "cvi_master_movement.csv"),
  s2 = file.path(repo_root, "tests", "synthetic", "cvi_master_s2.csv"),
  s4 = file.path(repo_root, "tests", "synthetic", "cvi_master_s4.csv"),
  tier_full = file.path(tier_dir, "full", "CVI_Consolidated_Master.csv"),
  tier_partner = file.path(tier_dir, "partner", "partner_county_totals.csv"),
  tier_public = file.path(tier_dir, "public", "CVI_Consolidated_Master.csv"))
# Part 2 (chart cross-filtering) also uses the S7 fixture.
cf_fixtures <- c(fixtures[c("movement", "s4")],
  list(s7 = file.path(repo_root, "local-test-artifacts", "s7", "fixtures", "cvi_master_s7.csv")),
  fixtures[c("tier_full", "tier_partner")])
args <- commandArgs(trailingOnly = TRUE)
run_rules <- !("crossfilter" %in% args)
run_crossfilter <- !("rules" %in% args)
only <- setdiff(args, c("rules", "crossfilter"))
unknown <- setdiff(only, union(names(fixtures), names(cf_fixtures)))
if (length(unknown)) stop("Unknown fixture: ", paste(unknown, collapse = ", "))
if (length(only)) {
  fixtures <- fixtures[intersect(only, names(fixtures))]
  cf_fixtures <- cf_fixtures[intersect(only, names(cf_fixtures))]
}
if (!run_rules) fixtures <- list()
if (!run_crossfilter) cf_fixtures <- list()
missing <- c(fixtures, cf_fixtures)
missing <- names(missing)[!file.exists(unlist(missing))]
if (length(missing))
  stop("Missing fixtures: ", paste(unique(missing), collapse = ", "),
       ". Run node tests/node/run_f1_unit_tests.js and node tests/synthetic/make_cvi_s7_fixtures.js first.")

# CVI's loader on a copy of the file with the extra column MC.File.Row. The copy is made line by line, so it
# needs a file without line breaks inside quoted cells (checked).
input_dir <- file.path(out_dir, "oracle_input")
load_with_rows <- function(path) {
  lines <- readLines(path, warn = FALSE, encoding = "UTF-8")
  while (length(lines) && lines[length(lines)] == "") lines <- lines[-length(lines)]
  quotes <- nchar(gsub('[^"]', "", lines))
  if (any(quotes %% 2 == 1)) stop(path, " has a line break inside a quoted cell")
  lines[1] <- paste0(lines[1], ",MC.File.Row")
  lines[-1] <- paste0(lines[-1], ",", seq_len(length(lines) - 1) - 1)
  dir.create(input_dir, recursive = TRUE, showWarnings = FALSE)
  copy <- file.path(input_dir, basename(path))
  writeLines(lines, copy, useBytes = TRUE)
  df <- load_master_csv(copy)
  unlink(copy)
  if (is.null(df)) stop("CVI's loader could not read ", path)
  df
}

# ── The counting rules ───────────────────────────────────────────────────────────────────────
no_county <- function(v) is.na(v) | trimws(v) == "" | toupper(trimws(v)) %in% c("N/A", "NA")
c_order <- function(...) order(..., method = "radix")   # C-locale order, as dplyr's group order

within_state_rows <- function(df, f) {
  keep <- df$Movement %in% c("Inbound", "Outbound") &
    df$Origin.State %in% "WA" & df$Dest.State %in% "WA" &
    df$Species.Group %in% f$species & df$Reporting.Year %in% f$years &
    df$Reporting.Quarter %in% f$quarters
  if (length(f$rawSpecies) && "Species" %in% names(df)) keep <- keep & df$Species %in% f$rawSpecies
  d <- df[keep, , drop = FALSE]
  d <- d[!duplicated(d$MC.File.Row), , drop = FALSE]   # the first of the loader's two copies
  # County names without surrounding spaces, as the charts' labels.
  d$Origin.County <- trimws(d$Origin.County)
  d$Dest.County <- trimws(d$Dest.County)
  county_missing <- no_county(d$Origin.County) | no_county(d$Dest.County)
  point_missing <- !county_missing & !(is.finite(d$Origin.County.Lat) & is.finite(d$Origin.County.Long) &
                                         is.finite(d$Dest.County.Lat) & is.finite(d$Dest.County.Long))
  list(counted = d[!county_missing & !point_missing, , drop = FALSE],
       leftOut = list(noCounty = sum(county_missing), noPoint = sum(point_missing)))
}

county_points <- function(d) {
  if (!nrow(d)) return(setNames(list(), character(0)))
  ends <- rbind(
    data.frame(county = d$Origin.County, lat = d$Origin.County.Lat, lon = d$Origin.County.Long,
               year = d$Reporting.Year, row = d$MC.File.Row, side = 0L, stringsAsFactors = FALSE),
    data.frame(county = d$Dest.County, lat = d$Dest.County.Lat, lon = d$Dest.County.Long,
               year = d$Reporting.Year, row = d$MC.File.Row, side = 1L, stringsAsFactors = FALSE))
  ends <- ends[order(-ends$year, ends$row, ends$side), ]
  ends <- ends[!duplicated(ends$county), ]
  ends <- ends[c_order(ends$county), ]
  setNames(lapply(seq_len(nrow(ends)), function(i) list(lat = ends$lat[i], lon = ends$lon[i])), ends$county)
}

# Distinct nonblank CVI numbers, without surrounding spaces (as the Unique CVIs box counts them).
unique_cvis <- function(v) {
  v <- trimws(as.character(v))
  length(unique(v[!is.na(v) & v != ""]))
}

pair_table <- function(d, by_species = FALSE) {
  if (!nrow(d)) {
    out <- data.frame(origin = character(0), dest = character(0), animals = numeric(0), records = integer(0),
                      cvis = integer(0))
    if (by_species) out$species <- character(0)
    return(out)
  }
  key <- paste(d$Origin.County, d$Dest.County, if (by_species) d$Species.Group else "", sep = "\r")
  idx <- split(seq_len(nrow(d)), key)
  out <- do.call(rbind, lapply(idx, function(i) data.frame(
    origin = d$Origin.County[i[1]], dest = d$Dest.County[i[1]],
    species = if (by_species) d$Species.Group[i[1]] else "",
    animals = sum(d$Total.Animals[i], na.rm = TRUE), records = length(i),
    cvis = unique_cvis(d$CVI[i]), stringsAsFactors = FALSE)))
  out <- out[c_order(-out$animals, out$origin, out$dest, out$species), ]
  if (!by_species) out$species <- NULL
  rownames(out) <- NULL
  out
}

# The pairs between counties ranked by each "Show charts by:" measure, the most first, ties in R's sort order of
# "Origin  →  Destination" (the corridor chart's label); each pair as "origin\rdest".
ranks_of <- function(p) {
  b <- p[p$origin != p$dest, , drop = FALSE]
  if (!nrow(b)) return(list(animals = I(character(0)), records = I(character(0)), cvis = I(character(0))))
  label <- paste0(b$origin, "  \u2192  ", b$dest)
  key <- paste(b$origin, b$dest, sep = "\r")
  by <- function(x) I(key[order(-x, label)])
  list(animals = by(b$animals), records = by(b$records), cvis = by(b$cvis))
}

lines_of <- function(p, cap, scaling, n_bins) {
  b <- p[p$origin != p$dest, , drop = FALSE]
  b <- head(b, cap)
  b$width_px <- .compute_radius(b$animals, scaling = scaling, min_r = 0.5, max_r = 6, n_bins = n_bins)
  b
}
rings_of <- function(p, scaling, n_bins) {
  w <- p[p$origin == p$dest, , drop = FALSE]
  data.frame(county = w$origin, animals = w$animals, records = w$records,
             radius_px = .compute_radius(w$animals, scaling = scaling, min_r = 3, max_r = 14, n_bins = n_bins))
}
county_totals <- function(p) {
  counties <- sort(unique(c(p$origin, p$dest)), method = "radix")
  out <- data.frame(county = counties, stringsAsFactors = FALSE)
  same <- p$origin == p$dest
  add <- function(sel, by, value) vapply(counties, function(c) sum(value[sel & by == c]), numeric(1))
  out$within <- add(same, p$origin, p$animals)
  out$sent <- add(!same, p$origin, p$animals)
  out$received <- add(!same, p$dest, p$animals)
  out$withinRecords <- add(same, p$origin, p$records)
  out$sentRecords <- add(!same, p$origin, p$records)
  out$receivedRecords <- add(!same, p$dest, p$records)
  rownames(out) <- NULL
  out
}
grid_of <- function(p, size = 15) {
  t <- county_totals(p)
  busy <- head(t$county[c_order(-(t$within + t$sent + t$received), t$county)], size)
  cells <- p[p$origin %in% busy & p$dest %in% busy, c("origin", "dest", "animals", "records"), drop = FALSE]
  rownames(cells) <- NULL
  list(counties = I(busy), cells = cells)
}

# ── CVI's former line map, and a plain reading of its rule ─────────────────────────────────────
cvi_lines <- function(df, f, scaling, n_bins) {
  res <- build_intrastate_line_data(df, f$species, f$years, f$quarters, "combined", scaling, n_bins)
  if (is.null(res)) return(NULL)
  rows <- sf::st_drop_geometry(res)
  rows$points <- vapply(sf::st_geometry(res), function(g) nrow(sf::st_coordinates(g)), integer(1))
  rows <- as.data.frame(rows, stringsAsFactors = FALSE)
  # CVI groups by the county points too; summed over them, one entry per pair and species group.
  key <- paste(rows$origin_county, rows$dest_county, rows$species_group, sep = "\r")
  summed <- do.call(rbind, lapply(split(seq_len(nrow(rows)), key), function(i) data.frame(
    origin = rows$origin_county[i[1]], dest = rows$dest_county[i[1]], species = rows$species_group[i[1]],
    animals = sum(rows$total_animals[i]), stringsAsFactors = FALSE)))
  summed <- summed[c_order(summed$origin, summed$dest, summed$species), ]
  rownames(summed) <- NULL
  # The plain reading: Inbound rows (one copy of each Intrastate row, and rows coded Import), both states "WA",
  # two different counties, all four county coordinates present.
  d <- df[df$Movement %in% "Inbound" & df$Origin.State %in% "WA" & df$Dest.State %in% "WA" &
            !is.na(df$Origin.County) & !is.na(df$Dest.County) & df$Origin.County != df$Dest.County &
            df$Species.Group %in% f$species & df$Reporting.Year %in% f$years &
            df$Reporting.Quarter %in% f$quarters &
            !is.na(df$Origin.County.Lat) & !is.na(df$Origin.County.Long) &
            !is.na(df$Dest.County.Lat) & !is.na(df$Dest.County.Long), , drop = FALSE]
  mine <- pair_table(d, by_species = TRUE)
  mine <- mine[c_order(mine$origin, mine$dest, mine$species), c("origin", "dest", "species", "animals")]
  rownames(mine) <- NULL
  if (!isTRUE(all.equal(mine, summed, check.attributes = FALSE)))
    stop("The plain reading of CVI's line-map rule disagrees with CVI's builder. Stop and report.")
  list(rows = rows, pairs = summed, split = anyDuplicated(key) > 0,
       # Pairs only CVI shows: a county that is blank or the out-of-state placeholder (approved difference).
       placeholderPairs = summed[no_county(summed$origin) | no_county(summed$dest), , drop = FALSE])
}

# ── Scenarios ──────────────────────────────────────────────────────────────────────────────────
scenarios_for <- function(df) {
  species <- sort(unique(df$Species.Group[!is.na(df$Species.Group) & df$Species.Group != ""]))
  years <- sort(unique(df$Reporting.Year[!is.na(df$Reporting.Year)]))
  quarters <- c("Q1", "Q2", "Q3", "Q4")
  base <- list(species = species, years = years, quarters = quarters, rawSpecies = character(0))
  with_f <- function(...) modifyList(base, list(...))
  one_group <- if ("Cattle" %in% species) "Cattle" else species[1]
  # One Browse frame with data: Q2 of the latest year that has a Q2 row (else the latest year's Q2).
  q2_years <- df$Reporting.Year[df$Reporting.Quarter %in% "Q2" & !is.na(df$Reporting.Year)]
  frame_year <- if (length(q2_years)) max(q2_years) else years[length(years)]
  s <- list(
    list(name = "default", f = base, scaling = "log", nBins = 5L, cap = 25L),
    list(name = "cap_10", f = base, scaling = "log", nBins = 5L, cap = 10L),
    list(name = "cap_50", f = base, scaling = "log", nBins = 5L, cap = 50L),
    list(name = "linear", f = base, scaling = "linear", nBins = 5L, cap = 25L),
    list(name = "sqrt", f = base, scaling = "sqrt", nBins = 5L, cap = 25L),
    list(name = "quantile", f = base, scaling = "quantile", nBins = 5L, cap = 25L),
    list(name = "quantile_3", f = base, scaling = "quantile", nBins = 3L, cap = 25L),
    list(name = "natural", f = base, scaling = "natural", nBins = 5L, cap = 25L),
    list(name = "one_group", f = with_f(species = one_group), scaling = "log", nBins = 5L, cap = 25L),
    list(name = "one_year", f = with_f(years = years[1]), scaling = "log", nBins = 5L, cap = 25L),
    list(name = "one_period", f = with_f(years = frame_year, quarters = "Q2"),
         scaling = "log", nBins = 5L, cap = 25L),
    list(name = "no_species", f = with_f(species = character(0)), scaling = "log", nBins = 5L, cap = 25L),
    list(name = "no_period", f = with_f(years = 1999L), scaling = "log", nBins = 5L, cap = 25L))
  if ("Species" %in% names(df) && "Dairy cattle" %in% df$Species)
    s[[length(s) + 1]] <- list(name = "refine", f = with_f(species = "Cattle", rawSpecies = "Dairy cattle"),
                               scaling = "log", nBins = 5L, cap = 25L)
  s
}
SPOTLIGHTS <- list(c("King", "Pierce"), c("Yakima", "Benton"))

run_scenario <- function(df, sc) {
  r <- within_state_rows(df, sc$f)
  p <- pair_table(r$counted)
  out <- list(name = sc$name,
              filters = list(species = I(sc$f$species), years = I(sc$f$years), quarters = I(sc$f$quarters),
                             rawSpecies = I(sc$f$rawSpecies)),
              scaling = sc$scaling, nBins = sc$nBins, cap = sc$cap,
              records = nrow(r$counted), leftOut = r$leftOut,
              points = county_points(r$counted),
              pairs = p, pairsBySpecies = pair_table(r$counted, by_species = TRUE),
              lines = lines_of(p, sc$cap, sc$scaling, sc$nBins),
              ranks = ranks_of(p),
              rings = rings_of(p, sc$scaling, sc$nBins),
              counties = county_totals(p),
              grid = grid_of(p),
              touching = lapply(SPOTLIGHTS, function(spot) list(
                counties = I(spot), pairs = p[p$origin %in% spot | p$dest %in% spot, , drop = FALSE])))
  # CVI's line map has no "Refine by species", so it is not run for that scenario.
  out$cvi <- if (length(sc$f$rawSpecies)) NULL else cvi_lines(df, sc$f, sc$scaling, sc$nBins)
  out
}

# ── Part 2: chart cross-filtering ───────────────────────────────────────────────────────────────
# CVI's chart and module code must be what the S7 reference checked.
cf_expected_sha <- c(
  "R/charts.R"         = "e715e805e56d89830b0ba09733c1abdbbf42d30ce89e5b7e777c2cf46a3b7f84",
  "modules/mod_maps.R" = "a5bae40d60a8e01a2b3dea6399be6e03ef4cdfca7d82106886fbdfef6b486115")

# Sources CVI's module (as the S7 reference does) and prepares the sandbox its data paths point into:
# CVI's state centers written back from the site's copy (checked byte for byte), and the site's county
# polygons for County Focus.
cf_setup <- function() {
  for (f in names(cf_expected_sha)) {
    got <- sha256(file.path(cvi_dir, "shiny", f))
    if (!identical(got, cf_expected_sha[[f]]))
      stop("CVI's ", f, " differs from the version the S7 reference checked (SHA-256 ", got, "). Stop and report.")
  }
  suppressPackageStartupMessages({
    library(shiny); library(bslib); library(shinyjs); library(cli); library(glue); library(DT); library(mapgl)
    for (f in c("R/ui_helpers.R", "R/tile_basemap.R", "R/static_map_renderer.R", "R/charts.R",
                "modules/mod_maps.R"))
      source(file.path(cvi_dir, "shiny", f), local = .GlobalEnv)
  })
  root <- file.path(out_dir, "cvi_root")
  unlink(root, recursive = TRUE)
  dir.create(file.path(root, "reference"), recursive = TRUE)
  centers_js <- readLines(file.path(repo_root, "site", "geo", "state-centers.js"), warn = FALSE)
  centers <- fromJSON(sub(";$", "", sub("^window\\.WSDA_STATE_CENTERS = ", "", centers_js[2])))$centers
  centers_file <- file.path(root, "reference", "state_capitals.csv")
  writeLines(c("state,state_lat,state_long",
               sprintf("%s,%.2f,%.2f", centers$state, centers$lat, centers$lon)), centers_file)
  if (!identical(sha256(centers_file), "c00bad8aebd88a3bf8a1a6a43d06bbf8d2fdf956c2babe1da4dd201bcebd568a"))
    stop("The bundled state centers do not write back to CVI's file")
  sandbox_path <- function(kind) function(...) file.path(root, kind, ...)
  assign("cvi_dir_reference", sandbox_path("reference"), envir = .GlobalEnv)
  assign("cvi_dir_exports", sandbox_path("exports"), envir = .GlobalEnv)
  assign("cvi_dir_www", sandbox_path("www"), envir = .GlobalEnv)
  assign("cvi_dir_tile_cache", sandbox_path("tile_cache"), envir = .GlobalEnv)
  ring <- function(r) do.call(rbind, lapply(r, unlist))
  shape <- function(g) {
    if (g$type == "Polygon") sf::st_polygon(lapply(g$coordinates, ring))
    else sf::st_multipolygon(lapply(g$coordinates, function(p) lapply(p, ring)))
  }
  txt <- readLines(file.path(repo_root, "site", "geo", "wa-counties.js"), warn = FALSE)
  geo <- fromJSON(sub(";$", "", sub("^window.CVIWA_GEO = ", "", txt[2])), simplifyVector = FALSE)
  feats <- geo$counties$features
  polygons <- sf::st_sf(name = vapply(feats, function(f) f$properties$name, ""),
                        geometry = sf::st_sfc(lapply(feats, function(f) shape(f$geometry)), crs = 4326))
  list(root = root, polygons = polygons)
}

# A drawer chart as CVI draws it: its gray message, or its slots (bottom to top, or periods left to
# right), the plotted rows and the subtitle (as in the S7 reference).
cf_chart_record <- function(p) {
  b <- ggplot2::ggplot_build(p)
  if (length(p$layers) == 1L && inherits(p$layers[[1]]$geom, "GeomText"))
    return(list(empty = b$data[[1]]$label[1]))
  slot_column <- as.character(rlang::quo_get_expr(p$mapping$x)[[3]])
  d <- as.data.frame(p$data)
  for (nm in names(d)) if (is.factor(d[[nm]])) d[[nm]] <- as.character(d[[nm]])
  list(subtitle = p$labels$subtitle, slots = I(as.character(levels(p$data[[slot_column]]))), rows = d)
}

# ── The row rules, written here from their plain statement (not from the page) ─────────────────
# Where a merged row counts: Inbound at its destination county, otherwise at its origin county, the
# out-of-state placeholder read "Non-WA"; on National Flow the partner state.
cf_place_of <- function(d, view) {
  if (view == "flow") {
    os <- toupper(trimws(as.character(d$Origin.State)))
    ds <- toupper(trimws(as.character(d$Dest.State)))
    return(ifelse(ds == "WA", os, ds))
  }
  x <- trimws(ifelse(d$Movement %in% "Inbound", as.character(d$Dest.County), as.character(d$Origin.County)))
  x[toupper(x) %in% c("N/A", "NA")] <- "Non-WA"
  x
}
cf_county_label <- function(x) {
  x <- trimws(as.character(x))
  x[toupper(x) %in% c("N/A", "NA")] <- "Non-WA"
  x
}
# A corridor's rows. On the WA State movement view: both states exactly "WA" and the two counties as written.
# On County Focus: the two county labels, as its corridor chart shows them.
cf_in_pair <- function(d, view, pairs) {
  if (view == "wa") {
    key <- paste(d$Origin.County, d$Dest.County, sep = "\r")
    return(d$Origin.State %in% "WA" & d$Dest.State %in% "WA" & key %in% pairs)
  }
  paste(cf_county_label(d$Origin.County), cf_county_label(d$Dest.County), sep = "\r") %in% pairs
}
# A loader copy's premises (CVI's premises identity on County Focus): the direction, then the farm entity id at
# the copy's own end (Inbound: the destination, Outbound: the origin) when there is one, else its coordinates.
cf_premises_key <- function(d) {
  inbound <- d$Movement %in% "Inbound"
  col <- function(name) if (name %in% names(d)) as.character(d[[name]]) else rep(NA_character_, nrow(d))
  eid <- trimws(ifelse(inbound, col("farm_entity_id_dest"), col("farm_entity_id_origin")))
  lon <- ifelse(inbound, as.numeric(d$Dest.Long), as.numeric(d$Origin.Long))
  lat <- ifelse(inbound, as.numeric(d$Dest.Lat), as.numeric(d$Origin.Lat))
  key <- ifelse(!is.na(eid) & nzchar(eid), paste0("e:", eid), paste0("c:", lon, ",", lat))
  paste0(d$Movement, "\r", key)
}
# The kind a chart sets with a click, so the one it is not filtered by.
cf_own_kind <- function(chart, view) {
  switch(chart, species = "species", over_time = "period", top_places = "place", emerging = "place",
         corridors = if (view == "flow") "place" else "pair")
}
# The charts the page shows in each view that are CVI drawer charts, and CVI's function for each.
CF_CHARTS <- list(wa = c("species", "top_places", "over_time", "emerging"),
                  flow = c("species", "top_places", "over_time", "corridors"),
                  focus = c("species", "corridors", "emerging"))
CF_FUNCTIONS <- list(species = function(s, cur) cvi_chart_species(s, cur),
                     top_places = function(s, cur) cvi_chart_top_geo(s, cur),
                     over_time = function(s, cur) cvi_chart_over_time(s, cur),
                     corridors = function(s, cur) cvi_chart_corridors(s, cur),
                     emerging = function(s, cur) cvi_chart_emerging(s, cur))
# The charts by direction, drawn from both loader copies of a WA-to-WA movement.
CF_BY_DIRECTION <- c("top_places", "over_time", "emerging")
CF_PREFIX <- c(wa = "county", flow = "flow", focus = "intra")
CF_BUTTON <- c(wa = "show_county", flow = "show_flow", focus = "show_intrastate")

# ── One scenario ───────────────────────────────────────────────────────────────────────────────
# sidebar: the view's inputs. filters: species (groups), period (year, quarter), place, pair (two ends joined by
# "\r") and premises (keys), each optional. Each chart gets every filter except its own kind: species and period as
# sidebar picks through CVI's module, the others as R row filters on the rows behind CVI's charts.
cf_run_scenario <- function(m, session, df, view, sidebar, filters) {
  prefix <- CF_PREFIX[[view]]
  set <- function(inputs) {
    do.call(session$setInputs, inputs)
    session$elapse(300)
  }
  with_picks <- function(skip) {
    inp <- sidebar
    if (length(filters$species) && skip != "species") inp[[paste0(prefix, "_species")]] <- filters$species
    if (length(filters$period) && skip != "period") {
      inp[[paste0(prefix, "_year")]] <- as.character(filters$period$year)
      inp[[paste0(prefix, "_quarter")]] <- filters$period$quarter
    }
    inp
  }
  # The module's map rows and chart rows for a set of inputs; each distinct set is given to the module once.
  seen <- list()
  module_rows <- function(inputs) {
    key <- paste(deparse(inputs), collapse = "")
    if (is.null(seen[[key]])) {
      set(inputs)
      seen[[key]] <<- list(md = get("current_map_data", envir = m)(), ci = get(".chart_inputs", envir = m)())
    }
    seen[[key]]
  }
  out <- list(charts = list())
  # The map's rows: species and period filter the map like sidebar picks.
  md <- module_rows(with_picks("none"))$md
  out$map_rows <- if (is.null(md)) 0L else nrow(md$sub)
  for (chart in CF_CHARTS[[view]]) {
    own <- cf_own_kind(chart, view)
    got <- module_rows(with_picks(own))
    md <- got$md
    ci <- got$ci
    # The filters on the rows the map draws, each loader copy at its own end, before CVI's merge (a premises bar
    # counts each copy, and so does a place bar). Then the charts by
    # direction count the copies, and the totals across directions the merged rows (.chart_inputs' merge).
    rows <- if (is.null(md)) df[0, , drop = FALSE] else md$sub
    if (length(filters$premises) && own != "premises")
      rows <- rows[cf_premises_key(rows) %in% filters$premises, , drop = FALSE]
    if (length(filters$pair) && own != "pair") rows <- rows[cf_in_pair(rows, view, filters$pair), , drop = FALSE]
    if (length(filters$place) && own != "place") rows <- rows[cf_place_of(rows, view) %in% filters$place, , drop = FALSE]
    d <- if (chart %in% CF_BY_DIRECTION) rows else dedupe_intrastate_volume(rows)
    ones <- d
    if (nrow(ones)) ones$Total.Animals <- 1
    cur <- ci$cur
    out$charts[[chart]] <- list(rows = nrow(d),
      animals = cf_chart_record(CF_FUNCTIONS[[chart]](if (nrow(d)) d else NULL, cur)),
      records = cf_chart_record(CF_FUNCTIONS[[chart]](if (nrow(ones)) ones else NULL, cur)))
  }
  out
}

# ── Scenarios per view ─────────────────────────────────────────────────────────────────────────
# Picks are made from the view's own rows under the base sidebar: the species groups, the first, middle and last
# periods with data, the busiest places, corridors and premises.
cf_top <- function(keys, values, n) {
  ok <- !is.na(keys) & nzchar(keys)
  if (!any(ok)) return(character(0))
  t <- tapply(values[ok], keys[ok], function(v) sum(v, na.rm = TRUE))
  names(t)[order(-t, names(t), method = "radix")][seq_len(min(n, length(t)))]
}
cf_scenarios <- function(m, session, df, view, base) {
  do.call(session$setInputs, base)
  session$elapse(300)
  ci <- get(".chart_inputs", envir = m)()
  md <- get("current_map_data", envir = m)()
  sub0 <- if (is.null(ci$sub)) df[0, , drop = FALSE] else ci$sub
  a <- suppressWarnings(as.numeric(sub0$Total.Animals))
  spp <- sort(unique(as.character(df$Species.Group)))
  spp <- spp[!is.na(spp) & nzchar(spp)]
  top_group <- cf_top(as.character(sub0$Species.Group), a, 1)
  q <- toupper(trimws(as.character(sub0$Reporting.Quarter)))
  ok_q <- q %in% c("Q1", "Q2", "Q3", "Q4") & !is.na(sub0$Reporting.Year)
  pk <- sort(unique(sub0$Reporting.Year[ok_q] * 10L + as.integer(substr(q[ok_q], 2, 2))))
  pk <- unique(pk[c(1L, ceiling(length(pk) / 2), length(pk))])
  pk <- pk[!is.na(pk)]
  period <- function(k) list(year = k %/% 10L, quarter = paste0("Q", k %% 10L),
                             label = paste0(k %/% 10L, " Q", k %% 10L))
  places <- cf_top(cf_place_of(sub0, view), a, 3)
  places <- places[places != "Non-WA"]
  s <- list()
  add <- function(name, filters, sidebar = base) s[[length(s) + 1L]] <<- list(name = name, sidebar = sidebar,
                                                                               filters = filters)
  add("none", list())
  for (g in head(spp, 6)) add(paste("species", g), list(species = g))
  if (length(spp) >= 2) add("species two", list(species = spp[1:2]))
  if (view != "focus") for (k in pk) add(paste("period", period(k)$label), list(period = period(k)))
  if (view != "focus" && length(pk) && length(top_group))
    add("species and period", list(species = top_group, period = period(pk[length(pk)])))
  dir_input <- paste0(CF_PREFIX[[view]], c(wa = "_direction", flow = "_direction", focus = "_filter_dir")[[view]])
  other_dir <- c(wa = "Inbound", flow = "combined", focus = "inbound")[[view]]
  if (length(top_group))
    add("other direction, species", list(species = top_group), modifyList(base, setNames(list(other_dir), dir_input)))
  if (length(places)) {
    add("place", list(place = places[1]))
    if (length(places) >= 2) add("place two", list(place = places[1:2]))
    if (length(top_group)) add("place and species", list(place = places[1], species = top_group))
    if (view != "focus" && length(pk)) add("place and period", list(place = places[1], period = period(pk[length(pk)])))
    add("other direction, place", list(place = places[1]), modifyList(base, setNames(list(other_dir), dir_input)))
  }
  if (view == "wa") {
    within <- sub0$Origin.State %in% "WA" & sub0$Dest.State %in% "WA" & !no_county(sub0$Origin.County) &
      !no_county(sub0$Dest.County) & sub0$Origin.County != sub0$Dest.County
    pairs <- cf_top(paste(sub0$Origin.County, sub0$Dest.County, sep = "\r")[within], a[within], 2)
    if (length(pairs)) {
      add("pair", list(pair = pairs[1]))
      if (length(top_group)) add("pair and species", list(pair = pairs[1], species = top_group))
      if (length(places)) add("pair and place", list(pair = pairs[1], place = places[1]))
    }
  }
  if (view == "focus") {
    labels <- paste(cf_county_label(sub0$Origin.County), cf_county_label(sub0$Dest.County), sep = "\r")
    pairs <- cf_top(labels, a, 2)
    if (length(pairs)) {
      add("pair", list(pair = pairs[1]))
      if (length(pairs) >= 2) add("pair two", list(pair = pairs))
      if (length(top_group)) add("pair and species", list(pair = pairs[1], species = top_group))
    }
    rows <- if (is.null(md)) df[0, , drop = FALSE] else md$sub
    has_coords <- all(c("Origin.Lat", "Origin.Long", "Dest.Lat", "Dest.Long") %in% names(rows))
    if (has_coords && nrow(rows)) {
      keys <- cf_premises_key(rows)
      ra <- suppressWarnings(as.numeric(rows$Total.Animals))
      first_in <- cf_top(keys[rows$Movement %in% "Inbound"], ra[rows$Movement %in% "Inbound"], 1)
      first_out <- cf_top(keys[rows$Movement %in% "Outbound"], ra[rows$Movement %in% "Outbound"], 1)
      both <- c(first_in, first_out)
      if (length(both)) {
        add("premises", list(premises = both[1]))
        if (length(both) == 2) add("premises two", list(premises = both))
        if (length(top_group)) add("premises and species", list(premises = both[1], species = top_group))
        if (length(places)) add("premises and place", list(premises = both[1], place = places[1]))
      }
    }
  }
  s
}

# The base sidebar of each view (the S7 reference's base scenarios). County Focus picks the two counties with
# the most animals counted at a WA end, so its charts have data.
cf_base <- function(df, view) {
  spp <- sort(unique(df$Species.Group)); spp <- spp[!is.na(spp) & nzchar(spp)]
  yrs <- as.character(sort(unique(df$Reporting.Year)))
  q4 <- c("Q1", "Q2", "Q3", "Q4")
  if (view == "wa") {
    return(list(county_species = spp, county_species_sub = character(0), county_year = yrs, county_quarter = q4,
                county_direction = c("Inbound", "Outbound"), county_mode = "side_by_side",
                county_scaling = "log", county_n_bins = "5"))
  }
  if (view == "flow") {
    return(list(flow_direction = "inbound", flow_species = spp, flow_species_sub = character(0),
                flow_year = yrs, flow_quarter = q4, flow_combine_species = FALSE,
                flow_scaling = "log", flow_n_bins = "5", flow_width_mult = "1.0"))
  }
  a <- suppressWarnings(as.numeric(df$Total.Animals))
  inb <- df$Movement %in% "Inbound" & df$Dest.State %in% "WA"
  outb <- df$Movement %in% "Outbound" & df$Origin.State %in% "WA"
  counted <- c(as.character(df$Dest.County[inb]), as.character(df$Origin.County[outb]))
  counties <- cf_top(counted, c(a[inb], a[outb]), 2)
  list(intra_counties = counties, intra_species = spp, intra_species_sub = character(0), intra_year = yrs,
       intra_quarter = q4, intra_filter_dir = "combined", intra_mode = "overlap", intra_scaling = "log",
       intra_n_bins = "5", intra_time_enabled = FALSE)
}

run_crossfilter_part <- function(cf_fixtures) {
  env <- cf_setup()
  for (fx in names(cf_fixtures)) {
    t1 <- Sys.time()
    df <- suppressWarnings(load_master_csv(cf_fixtures[[fx]]))
    if (is.null(df)) stop("CVI's loader refused ", fx)
    box <- new.env()
    box$views <- list()
    sess <- MockShinySession$new()
    testServer(mod_maps_server, args = list(rv = reactiveValues(master_df = NULL), project_root = env$root,
               scripts_dir = env$root), session = sess, {
      rv$master_df <- df
      session$flushReact()
      map_state$county_polygons <- env$polygons
      session$setInputs(show_charts = TRUE)
      module <- environment()
      click <- 0L
      for (view in names(CF_BUTTON)) {
        click <- click + 1L
        do.call(session$setInputs, setNames(list(click), CF_BUTTON[[view]]))
        session$elapse(300)
        base <- cf_base(df, view)
        recs <- list()
        for (sc in cf_scenarios(module, session, df, view, base)) {
          r <- cf_run_scenario(module, session, df, view, sc$sidebar, sc$filters)
          recs[[length(recs) + 1L]] <- c(list(name = sc$name, sidebar = sc$sidebar, filters = sc$filters), r)
        }
        box$views[[view]] <- recs
      }
    })
    res <- list(fixture = fx, file = sub(paste0(repo_root, "/"), "", cf_fixtures[[fx]]), cviRevision = cvi_rev,
                cviSha256 = as.list(c(expected_sha, cf_expected_sha)), views = box$views)
    write_json(res, file.path(out_dir, paste0("oracle_mc_cf_", fx, ".json")), auto_unbox = TRUE, digits = NA,
               null = "null", na = "null", pretty = FALSE)
    cat(sprintf("mc crossfilter %s: %d WA State, %d National Flow, %d County Focus scenarios (%.0f s)\n", fx,
                length(box$views$wa), length(box$views$flow), length(box$views$focus),
                as.numeric(difftime(Sys.time(), t1, units = "secs"))))
  }
  unlink(env$root, recursive = TRUE)
}

t0 <- Sys.time()
for (name in names(fixtures)) {
  df <- load_with_rows(fixtures[[name]])
  scenarios <- lapply(scenarios_for(df), function(sc) run_scenario(df, sc))
  res <- list(fixture = name, file = basename(fixtures[[name]]), cviRevision = cvi_rev,
              cviSha256 = as.list(expected_sha), scenarios = scenarios)
  out_file <- file.path(out_dir, paste0("oracle_mc_", name, ".json"))
  writeLines(toJSON(res, auto_unbox = TRUE, digits = NA, na = "null", null = "null", dataframe = "rows"),
             out_file)
  default <- scenarios[[1]]
  cat(sprintf("mc %s: %d scenarios; default %d rows counted (left out: %d no county, %d no point), %d pairs, %d within one county; CVI's line map %d entries%s\n",
              name, length(scenarios), default$records, default$leftOut$noCounty, default$leftOut$noPoint,
              nrow(default$pairs), nrow(default$rings),
              if (is.null(default$cvi)) 0L else nrow(default$cvi$rows),
              if (!is.null(default$cvi) && default$cvi$split) " (some pairs split by changed county points)" else ""))
}
unlink(input_dir, recursive = TRUE)
if (length(cf_fixtures)) run_crossfilter_part(cf_fixtures)
cat(sprintf("mc oracle: complete (%.1f s)\n", as.numeric(difftime(Sys.time(), t0, units = "secs"))))
