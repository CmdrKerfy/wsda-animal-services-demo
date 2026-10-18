#!/usr/bin/env Rscript
# S1 reference oracle: runs CVI's OWN WA State map functions, read-only, on the synthetic fixtures and
# writes JSON for tests/node/run_s1_unit_tests.js. CVI is sourced in place and never modified.
#
# Usage (repository root):  Rscript tests/oracle/cvi_r_oracle.R [parts]
#   parts: any of s1 (S1, F1 tiers and engine cases), s1_1 (S1.1: CVI's palettes and the legend radii by CVI's
#   .compute_radius, from the s1 files), s2 (S2 and S2b), s3, s4, s5 (scaling gate ONLY), s5-module-route (bounded synthetic module probe), s5-module-facilities (bounded facility injection), s5-module-tiers (actual tier subsets), s5-premises (bounded pure grouping/subsets), s5-payloads (bounded popup/species), s5-facilities (CVI's facility loader, manifest registry and groups on the --facilities fixture);
#   default: s1, s1_1, s2, s3 and s4. The s5 parts run only when named, each after its own fixture (tests/README.md,
#   section 2, step 4). A part left out is not written, so its earlier output stays as it was.
# CVI checkout: ../CVI_Traceability (sibling of this repository) or env CVI_TRACEABILITY_DIR.
# Output: local-test-artifacts/s1/oracle_<fixture>.json, oracle_tier_<tier>.json (F1) and oracle_engine.json; S2 (CVI's
# WA map module itself, see the S2 section): local-test-artifacts/s2/oracle_s2_<name>.json and format_cases_s2.json
# (all git-ignored; delete after use); S4 (CVI's National Flow map through the same module):
# local-test-artifacts/s4/oracle_s4_<name>.json and oracle_s4_arcs.json. About 12 minutes in all (the S4 part alone
# about 4.5).
# Needs R >= 4.4 with dplyr, data.table, geosphere, sf, classInt 0.4-11, jsonlite; for S2 also shiny, bslib, shinyjs,
# cli, glue, DT, mapgl, bsicons, scales, ggplot2 (already installed; no installs).

suppressPackageStartupMessages(library(jsonlite))

repo_root <- local({
  a <- commandArgs(trailingOnly = FALSE)
  f <- sub("^--file=", "", a[grep("^--file=", a)])
  normalizePath(file.path(dirname(normalizePath(f[1])), "..", ".."), winslash = "/")
})
cvi_dir <- Sys.getenv("CVI_TRACEABILITY_DIR", unset = file.path(dirname(repo_root), "CVI_Traceability"))
cvi_r <- file.path(cvi_dir, "shiny", "R")
if (!file.exists(file.path(cvi_r, "map_helpers.R"))) stop("CVI checkout not found at ", cvi_dir)
out_dir <- file.path(repo_root, "local-test-artifacts", "s1")
dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)

suppressPackageStartupMessages({
  source(file.path(cvi_r, "master_loader.R"), local = .GlobalEnv)
  source(file.path(cvi_r, "map_helpers.R"), local = .GlobalEnv)
})
cvi_rev <- tryCatch(system2("git", c("-C", shQuote(cvi_dir), "rev-parse", "HEAD"), stdout = TRUE),
                    error = function(e) NA_character_)
cvi_dirty <- tryCatch(length(system2("git", c("-C", shQuote(cvi_dir), "status", "--porcelain", "--",
                      "shiny/R/map_helpers.R", "shiny/R/master_loader.R"), stdout = TRUE)) > 0L,
                      error = function(e) NA)

`%||%` <- function(x, y) if (is.null(x)) y else x
parts <- commandArgs(trailingOnly = TRUE)
PARTS <- c("s1", "s1_1", "s2", "s3", "s4", "s5", "s5-module-route", "s5-module-facilities", "s5-premises", "s5-payloads", "s5-module-tiers", "s5-facilities", "s5-module-matrix")
if (length(setdiff(parts, PARTS))) stop("Unknown part(s): ", paste(setdiff(parts, PARTS), collapse = ", "))
want <- function(p) !length(parts) || p %in% parts
SCALINGS <- c("log", "sqrt", "linear", "quantile", "natural")
BINS <- c(3L, 4L, 5L, 6L, 7L, 10L)
DIRS <- list(c("Inbound", "Outbound"), "Inbound", "Outbound")
MODES <- c("side_by_side", "total")

# The live WA State map replaces the builder's tooltip (mod_maps.R .build_county_map, lines 421-427). Same
# expression, applied to the whole frame before drawing, so format() pads to one common width.
live_tooltip <- function(d) sprintf("<strong>%s</strong><br/>%s: %s animals",
  d$county, d$direction, format(round(d$total_animals), big.mark = ","))

run_view <- function(df, f, mode, scaling, n_bins) {
  res <- tryCatch(withCallingHandlers(build_county_circle_data(
    master_df = df, species_filter = f$species, year_filter = as.integer(f$years),
    quarter_filter = f$quarters, direction = f$direction, mode = mode, scaling = scaling,
    n_bins = n_bins, raw_species_filter = f$raw_species), warning = function(w) invokeRestart("muffleWarning")),
    error = function(e) structure(list(msg = conditionMessage(e)), class = "oracle_error"))
  base <- list(filters = f, mode = mode, scaling = scaling, n_bins = n_bins)
  if (inherits(res, "oracle_error")) return(c(base, list(error = res$msg)))
  if (nrow(res) == 0L) return(c(base, list(rows = list(), legend = NULL)))
  tiers <- .legend_tiers(res$total_animals, scaling = scaling, n_bins = n_bins)
  rows <- lapply(seq_len(nrow(res)), function(i) list(
    county = res$county[i], direction = res$direction[i], total_animals = res$total_animals[i],
    lat = res$lat[i], lon = res$lon[i], radius_px = res$radius_px[i],
    builder_tooltip = res$tooltip_text[i], live_tooltip = live_tooltip(res)[i]))
  c(base, list(rows = rows, legend = if (is.null(tiers)) NULL else
    list(values = tiers$values, radii = tiers$radii)))
}

fixture_views <- function(df) {
  spp <- sort(unique(df$Species.Group)); spp <- spp[!is.na(spp) & nzchar(spp)]
  yrs <- sort(unique(df$Reporting.Year)); yrs <- yrs[!is.na(yrs)]
  q4 <- c("Q1", "Q2", "Q3", "Q4")
  scen <- list(
    default    = list(species = spp, years = yrs, quarters = q4),
    cattle     = list(species = "Cattle", years = yrs, quarters = q4),
    cattle_raw = list(species = "Cattle", years = yrs, quarters = q4, raw_species = "Dairy cattle"),
    y_first    = list(species = spp, years = yrs[1], quarters = q4),
    q2_q3      = list(species = spp, years = yrs, quarters = c("Q2", "Q3")),
    two_groups = list(species = c("Swine", "Poultry"), years = yrs, quarters = q4))
  out <- list()
  for (sn in names(scen)) for (d in DIRS) for (m in MODES) for (s in SCALINGS) {
    bins <- if (s %in% c("quantile", "natural")) BINS else 5L
    for (b in bins) {
      f <- scen[[sn]]; f$direction <- d; f$raw_species <- f$raw_species %||% character(0)
      v <- run_view(df, f, m, s, b); v$scenario <- sn
      out[[length(out) + 1L]] <- v
    }
  }
  list(load = list(physical_rows = cvi_master_physical_nrow(df), map_rows = nrow(df),
                   species_choices = spp, year_choices = yrs), views = out)
}

for (fx in if (want("s1")) c("cvi_master_small", "cvi_master_wa39") else character(0)) {
  df <- suppressWarnings(load_master_csv(file.path(repo_root, "tests", "synthetic", paste0(fx, ".csv"))))
  if (is.null(df)) stop("load_master_csv failed for ", fx)
  o <- c(list(meta = list(fixture = paste0("tests/synthetic/", fx, ".csv"), cvi_revision = cvi_rev,
              cvi_helpers_modified_in_worktree = cvi_dirty, r = R.version.string,
              classInt = as.character(packageVersion("classInt")), generated = format(Sys.time(), tz = "UTC", usetz = TRUE))),
         fixture_views(df))
  write_json(o, file.path(out_dir, paste0("oracle_", fx, ".json")), auto_unbox = TRUE, digits = I(17),
             null = "null", na = "null", pretty = FALSE)
  cat(fx, ":", length(o$views), "views\n")
}

# F1: the same views for the master of each example bundle tier (Full, Partner, Public), read by CVI's own loader
# from the folder copy that tests/synthetic/make_bundles.js writes (node tests/node/run_f1_unit_tests.js first).
# Full and Public keep every row and column the WA map uses; Partner has only the 13 required columns (no Species).
tier_dir <- file.path(repo_root, "local-test-artifacts", "f1", "tiers")
tier_masters <- c(full = "CVI_Consolidated_Master.csv", partner = "partner_county_totals.csv",
                  public = "CVI_Consolidated_Master.csv")
if (!dir.exists(tier_dir)) {
  cat("tiers: not generated; run node tests/node/run_f1_unit_tests.js first, then this script again\n")
} else for (tier in if (want("s1")) names(tier_masters) else character(0)) {
  f <- file.path(tier_dir, tier, tier_masters[[tier]])
  df <- suppressWarnings(load_master_csv(f))
  if (is.null(df)) stop("load_master_csv failed for tier ", tier)
  o <- c(list(meta = list(fixture = paste0("local-test-artifacts/f1/tiers/", tier, "/", tier_masters[[tier]]),
              tier = tier, cvi_revision = cvi_rev, cvi_helpers_modified_in_worktree = cvi_dirty, r = R.version.string,
              classInt = as.character(packageVersion("classInt")), generated = format(Sys.time(), tz = "UTC", usetz = TRUE))),
         fixture_views(df))
  write_json(o, file.path(out_dir, paste0("oracle_tier_", tier, ".json")), auto_unbox = TRUE, digits = I(17),
             null = "null", na = "null", pretty = FALSE)
  cat("tier", tier, ":", length(o$views), "views\n")
}

# Engine-level cases: radius engine, Fisher breaks and R's format() on awkward vectors.
if (want("s1")) {
  set.seed(20260930)
  vec_cases <- list(c(0, 0, 0), c(5, 5, 5), c(0, 1), c(1, 2, 3, 4, 5, 6, 7, 8, 9, 10), c(0, 3, 3, 3, 10, 50, 50, 900),
                    c(-5, NA, 0, 12, 12, 400), c(1, 1, 1, 1, 2, 3))
  for (i in 1:60) {
    n <- sample(c(3:12, 20, 39, 39, 80, 200, 1000), 1)
    v <- if (i %% 3 == 0) sample(0:20, n, replace = TRUE) else round(exp(runif(n, 0, 9)))
    vec_cases[[length(vec_cases) + 1L]] <- v
  }
  radius_cases <- list(); fisher_cases <- list()
  for (v in vec_cases) for (s in SCALINGS) for (b in if (s %in% c("quantile", "natural")) BINS else 5L) {
    r <- tryCatch(.compute_radius(v, scaling = s, n_bins = b), error = function(e) conditionMessage(e))
    t <- tryCatch(.legend_tiers(v, scaling = s, n_bins = b), error = function(e) conditionMessage(e))
    radius_cases[[length(radius_cases) + 1L]] <- list(values = v, scaling = s, n_bins = b,
      radius = if (is.character(r)) NULL else r, error = if (is.character(r)) r else NULL,
      legend = if (is.list(t)) list(values = t$values, radii = t$radii) else NULL)
  }
  for (v in vec_cases) for (b in BINS) {
    x <- v[!is.na(v) & v > 0]
    br <- tryCatch(suppressWarnings(classInt::classIntervals(x, n = b, style = "fisher")$brks),
                   error = function(e) conditionMessage(e))
    fisher_cases[[length(fisher_cases) + 1L]] <- list(x = x, n = b,
      brks = if (is.character(br)) NULL else br, error = if (is.character(br)) br else NULL)
  }
  fmt_vecs <- list(c(5, 1200), 100000, c(100000, 1234), c(200000, 3e5), c(0, 7), 1e6, c(1e6, 2e6), 12345678,
                   c(120000, 5), 0, c(-40, 3), 999999, c(150000, 1e5))
  format_cases <- lapply(fmt_vecs, function(v) list(x = v, out = format(round(v), big.mark = ",")))
  write_json(list(meta = list(r = R.version.string, classInt = as.character(packageVersion("classInt"))),
                  radius = radius_cases, fisher = fisher_cases, format = format_cases),
             file.path(out_dir, "oracle_engine.json"), auto_unbox = TRUE, digits = I(17), null = "null", na = "null")
  cat("engine cases:", length(radius_cases), "radius,", length(fisher_cases), "fisher,", length(format_cases), "format\n")
}

# S1.1 (deliberate differences, by design): CVI's own palettes, as defined (the page's are compared with them,
# except the listed guide colors), and the legend's size circles as the map draws them: for every view of the s1 files
# (fixtures and tiers) with a legend, each of CVI's tier values sized against the view's circles. Log, linear, square
# root: CVI's .compute_radius with the value added (the last radius). Quantile and natural breaks: the
# radius of the tier's bin under the circles' own breaks, made with the same calls as CVI's .compute_radius
# (stats::quantile, classInt::classIntervals "fisher" with the quantile fallback, cut(include.lowest), NA as bin 1;
# adding a value would move the breaks). Reads the s1 files written above or by an earlier run.
s11_bin_radii <- function(values, tv, scaling, n_bins, min_r = 4, max_r = 48) {
  values <- as.numeric(values); values[is.na(values) | values < 0] <- 0
  mid <- rep((min_r + max_r) / 2, length(tv))
  if (max(values) == 0 || all(values == values[1])) return(mid)
  n_bins <- max(2L, as.integer(n_bins)); pos <- values[values > 0]
  q <- function() unique(stats::quantile(pos, probs = seq(0, 1, length.out = n_bins + 1), na.rm = TRUE, names = FALSE))
  brks <- if (scaling == "quantile") q() else {
    b <- tryCatch(suppressWarnings(classInt::classIntervals(pos, n = n_bins, style = "fisher"))$brks, error = function(e) NULL)
    if (is.null(b) || length(unique(b)) < 2) q() else b
  }
  if (length(brks) < 2) return(mid)
  bins <- as.integer(cut(values, breaks = brks, include.lowest = TRUE)); bins[is.na(bins)] <- 1L
  max_bin <- max(bins); if (max_bin < 2) return(mid)
  tb <- as.integer(cut(pmax(tv, 0), breaks = brks, include.lowest = TRUE)); tb[is.na(tb)] <- 1L
  min_r + (tb - 1) / (max_bin - 1) * (max_r - min_r)
}
if (want("s1_1")) {
  s11_files <- list.files(out_dir, pattern = "^oracle_(cvi_master_[a-z0-9_]+|tier_[a-z]+)\\.json$")
  if (!length(s11_files)) stop("s1_1: no s1 oracle files in ", out_dir, "; run the s1 part first")
  s11_views <- list(); s11_tiers <- 0L
  for (fn in s11_files) {
    o <- fromJSON(file.path(out_dir, fn), simplifyVector = FALSE)
    for (i in seq_along(o$views)) {
      v <- o$views[[i]]
      if (is.null(v$legend) || !length(v$rows)) next
      vals <- vapply(v$rows, function(r) as.numeric(r$total_animals), numeric(1))
      tv <- vapply(v$legend$values, as.numeric, numeric(1))
      radii <- if (v$scaling %in% c("quantile", "natural")) s11_bin_radii(vals, tv, v$scaling, v$n_bins) else
        vapply(tv, function(x) tail(.compute_radius(c(vals, x), scaling = v$scaling, n_bins = v$n_bins), 1L), numeric(1))
      s11_views[[length(s11_views) + 1L]] <- list(file = fn, view = i, scaling = v$scaling, n_bins = v$n_bins, values = tv, radii = radii)
      s11_tiers <- s11_tiers + length(tv)
    }
  }
  pal_json <- function(P) lapply(names(P), function(n) list(name = n, colors = lapply(names(P[[n]]),
    function(k) list(key = k, color = unname(P[[n]][[k]])))))
  write_json(list(meta = list(cvi_revision = cvi_rev, cvi_helpers_modified_in_worktree = cvi_dirty, r = R.version.string,
                              generated = format(Sys.time(), tz = "UTC", usetz = TRUE)),
                  direction_palettes = pal_json(DIRECTION_PALETTES), species_palettes = pal_json(SPECIES_PALETTES),
                  legend = s11_views),
             file.path(out_dir, "oracle_s1_1.json"), auto_unbox = TRUE, digits = I(17), null = "null", na = "null")
  cat("s1_1: palettes", length(DIRECTION_PALETTES), "direction,", length(SPECIES_PALETTES), "species; legend radii for",
      length(s11_views), "views,", s11_tiers, "tiers\n")
}

# ── S2: CVI's WA State map module itself, driven by shiny::testServer ────────────────────────────────────────────
# The value boxes, summary strip, period label and Reset All live inside mod_maps_server(), so this section runs
# that module unmodified in a mock Shiny session: it sets the WA map's inputs for each view, lets the 250 ms
# debounces elapse and reads CVI's rendered outputs. CVI's file access goes only through cvi_dir_reference(),
# cvi_dir_exports() and cvi_dir_www() (from paths.R, which is not sourced); they are pointed at an empty folder under
# local-test-artifacts/, so nothing in the CVI checkout is read beyond its code and nothing is written there.
# The mock session's sendInputMessage() and registerDataObj() are no-ops in shiny; on this test's own session object
# they are replaced by recorders, which is how the choices CVI sets at load and the values Reset All sends are read.
# S2b (period modes, s2b_periods above) is recorded in the same files under "periods".
# Output: local-test-artifacts/s2/oracle_s2_<name>.json. Needs shiny, bslib, shinyjs, cli, glue, DT, mapgl, bsicons,
# scales, ggplot2 (installed; no installs).
s2_out <- file.path(repo_root, "local-test-artifacts", "s2")
s2_sandbox <- file.path(s2_out, "empty_cvi_root")
dir.create(s2_sandbox, recursive = TRUE, showWarnings = FALSE)
suppressPackageStartupMessages({
  library(shiny); library(bslib); library(shinyjs); library(cli); library(glue); library(DT); library(mapgl)
})
cvi_shiny <- file.path(cvi_dir, "shiny")
s2_sources <- c("R/ui_helpers.R", "R/tile_basemap.R", "R/static_map_renderer.R", "R/charts.R", "modules/mod_maps.R")
suppressPackageStartupMessages(for (f in s2_sources) source(file.path(cvi_shiny, f), local = .GlobalEnv))
s2_paths_used <- character(0)
.s2_path <- function(kind) function(...) {
  s2_paths_used <<- union(s2_paths_used, paste(kind, paste(c(...), collapse = "/")))
  file.path(s2_sandbox, ...)
}
cvi_dir_reference <- .s2_path("reference"); cvi_dir_exports <- .s2_path("exports"); cvi_dir_www <- .s2_path("www")
cvi_dir_tile_cache <- .s2_path("tile_cache")   # never reached in these views; pointed at the empty folder all the same
s2_dirty <- tryCatch(length(system2("git", c("-C", shQuote(cvi_dir), "status", "--porcelain", "--",
                     file.path("shiny", s2_sources), "shiny/R/ui_helpers.R"), stdout = TRUE)) > 0L, error = function(e) NA)

.unescape <- function(x) {
  for (p in list(c("&lt;", "<"), c("&gt;", ">"), c("&quot;", "\""), c("&#39;", "'"), c("&amp;", "&")))
    x <- gsub(p[1], p[2], x, fixed = TRUE)
  x
}
# The visible lines of an HTML fragment: split at <br/> and block ends, tags removed, white space collapsed as a
# browser shows it (htmltools puts each child on its own source line).
.html_lines <- function(h) {
  h <- gsub("<br/>|</div>|</p>", "\001", h); h <- gsub("<[^>]+>", "", h)
  l <- trimws(gsub("[[:space:]]+", " ", strsplit(.unescape(h), "\001", fixed = TRUE)[[1]])); l[nzchar(l)]
}
s2_value_boxes <- function(o) {
  h <- o$html
  if (!grepl("metric-value", h, fixed = TRUE)) return(list(state = "alert", lines = I(.html_lines(h)),
    icon = sub('.*class="bi bi-([a-z-]+) .*', "\\1", h)))
  parts <- strsplit(h, '<div style="min-width:170px;">', fixed = TRUE)[[1]][-1]
  list(state = "metrics", metrics = I(lapply(parts, function(p) list(
    label = .unescape(sub('.*letter-spacing:0.03em;">([^<]*)</div>.*', "\\1", p)),
    value = .unescape(sub('.*class="metric-value"[^>]*title="([^"]*)".*', "\\1", p)),
    text = .unescape(sub('.*class="metric-value"[^>]*>([^<]*)</div>.*', "\\1", p)),
    zero = grepl('class="metric-zero"', p, fixed = TRUE),
    accent = sub('.*background:(#[0-9a-fA-F]{6});.*', "\\1", p),
    icon = sub('.*class="bi bi-([a-z-]+) .*', "\\1", p)))))
}
s2_strip <- function(o) {
  h <- o$html
  if (grepl("d-flex gap-4", h, fixed = TRUE)) {
    it <- regmatches(h, gregexpr("<strong>[^<]*</strong>[^<]*", h))[[1]]
    return(list(state = "summary", items = I(lapply(it, function(s) list(
      label = .unescape(sub("<strong>([^<]*)</strong>.*", "\\1", s)),
      text = trimws(.unescape(sub("<strong>[^<]*</strong>", "", s))))))))
  }
  list(state = "message", lines = I(.html_lines(h)))
}

s2_scenarios <- function(df) {
  spp <- sort(unique(df$Species.Group)); spp <- spp[!is.na(spp) & nzchar(spp)]
  yrs <- sort(unique(df$Reporting.Year)); yrs <- yrs[!is.na(yrs)]
  q4 <- c("Q1", "Q2", "Q3", "Q4")
  sc <- list(
    default    = list(species = spp, years = yrs, quarters = q4),
    cattle     = list(species = "Cattle", years = yrs, quarters = q4),
    cattle_raw = list(species = "Cattle", years = yrs, quarters = q4, raw_species = "Dairy cattle"),
    y_first    = list(species = spp, years = yrs[1], quarters = q4),
    q2_q3      = list(species = spp, years = yrs, quarters = c("Q2", "Q3")),
    two_groups = list(species = c("Swine", "Poultry"), years = yrs, quarters = q4),
    no_quarters = list(species = spp, years = yrs, quarters = character(0)),
    zero_2023_q2 = list(species = "Cattle", years = 2023L, quarters = "Q2"),
    swine_2026_q1 = list(species = "Swine", years = 2026L, quarters = "Q1"))
  for (g in spp) sc[[paste0("group_", g)]] <- list(species = g, years = yrs, quarters = q4)
  for (y in yrs) sc[[paste0("year_", y)]] <- list(species = spp, years = y, quarters = q4)
  for (q in q4) sc[[paste0("quarter_", q)]] <- list(species = spp, years = yrs, quarters = q)
  sc
}

# ── S2b: period modes (Single / Browse over time / Compare two periods), run inside the same module session ─────
# In a running CVI the browser applies every update*Input() message CVI sends (the radio flips the hidden Browse and
# Compare checkboxes; the slider writes the year and quarter pickers). The mock session has no browser, so each message
# recorded here is applied with setInputs(), in order, until CVI sends no more: the oracle keeps both the messages
# (what CVI asks the page to do) and the outputs that follow. Inputs a fresh browser would hold are set first: the load
# messages (pickers, slider), then the UI defaults (step Quarter, speed 3500, right-map species off).
s2b_take <- function(box) {
  m <- box$msgs; box$msgs <- list()
  lapply(m, function(x) list(id = x$id, msg = x$msg[setdiff(names(x$msg), "config")]))
}
s2b_apply <- function(session, box, first) {   # apply recorded messages until CVI answers with none; returns them all
  all <- first; pending <- first; n <- 0L
  while (length(pending) && n < 10L) {
    for (x in pending) if (!is.null(x$msg$value)) {
      v <- x$msg$value   # a slider value arrives as text with data-type "number"; the browser sends it back as a number
      if (identical(x$msg[["data-type"]], "number")) v <- as.numeric(v)
      do.call(session$setInputs, setNames(list(v), x$id))
    }
    session$elapse(300)
    pending <- s2b_take(box); all <- c(all, pending); n <- n + 1L
  }
  all
}
s2b_circles <- function(f) {
  d <- tryCatch(suppressWarnings(f()), error = function(e) NULL)
  if (is.null(d) || !is.data.frame(d) || nrow(d) == 0L) return(NULL)
  I(lapply(seq_len(nrow(d)), function(i) list(county = d$county[i], direction = d$direction[i],
    total_animals = d$total_animals[i], lat = d$lat[i], lon = d$lon[i], radius_px = d$radius_px[i])))
}
s2b_periods <- function(session, output, box, map_state, circ_a, circ_b, df, load_msgs) {
  spp <- sort(unique(df$Species.Group)); spp <- spp[!is.na(spp) & nzchar(spp)]
  yrs <- as.character(sort(unique(df$Reporting.Year))); q4 <- c("Q1", "Q2", "Q3", "Q4")
  read <- function() {
    list(mode = session$input$county_period_mode, years = I(as.character(session$input$county_year)),
         quarters = I(as.character(session$input$county_quarter)),
         slider = session$input$county_time_slider, step = session$input$county_time_step,
         time_label = tryCatch(output$county_time_label, error = function(e) NULL),
         header = tryCatch(output$county_period_summary, error = function(e) NULL),
         value_boxes = s2_value_boxes(output$value_boxes), strip = s2_strip(output$filter_summary_strip))
  }
  session$setInputs(county_species = spp, county_species_sub = character(0), county_year = yrs, county_quarter = q4,
                    county_direction = c("Inbound", "Outbound"), county_mode = "side_by_side",
                    county_period_mode = "single", county_time_enabled = FALSE, county_compare_enabled = FALSE,
                    county_time_step = "quarter", county_time_speed = "3500",
                    county_time_slider = as.numeric(Filter(function(m) m$id == "county_time_slider", load_msgs)[[1]]$msg$value),
                    county_species_b_enabled = FALSE, county_species_b = spp, county_species_b_sub = character(0),
                    county_year_b = yrs, county_quarter_b = q4)
  session$elapse(300); invisible(s2b_take(box))
  # CVI's "Playback speed" picker as its UI function renders it (values, labels, the one selected).
  sp_html <- as.character(.time_slider_filter(NS("m"), "county", hide_toggle = TRUE))
  sp_html <- regmatches(sp_html, regexpr('(?s)<select id="m-county_time_speed".*?</select>', sp_html, perl = TRUE))
  sp_opt <- regmatches(sp_html, gregexpr('<option value="[^"]*"( selected)?>[^<]*</option>', sp_html))[[1]]
  res <- list(domains = list(quarter = I(map_state$tq_combos %||% character(0)),
                             year = I(map_state$year_combos %||% character(0))),
              speed_choices = I(lapply(sp_opt, function(x) list(value = sub('.*value="([^"]*)".*', "\\1", x),
                label = .unescape(sub(".*>([^<]*)</option>", "\\1", x)), selected = grepl(" selected>", x, fixed = TRUE)))),
              single = read())
  # Browse: entering, every quarter frame, the switch to years, every year frame, then back to Single.
  session$setInputs(county_period_mode = "browse")
  enter <- s2b_apply(session, box, s2b_take(box))
  res$browse_enter <- c(read(), list(messages = I(enter)))
  frames <- list()
  for (step in c("quarter", "year")) {
    if (step == "year") {
      session$setInputs(county_time_step = "year")
      flip <- s2b_apply(session, box, s2b_take(box))
      res$browse_year_switch <- c(read(), list(messages = I(flip)))
    }
    n <- length(if (step == "year") map_state$year_combos else map_state$tq_combos)
    for (i in seq_len(n)) {
      session$setInputs(county_time_slider = i)
      ms <- s2b_apply(session, box, s2b_take(box))
      frames[[length(frames) + 1L]] <- c(list(index = i), read(), list(messages = I(ms)))
    }
  }
  res$browse_frames <- I(frames)
  # The slider itself (rebuilt by CVI on a speed change): range, value and Play interval for each speed.
  res$speeds <- I(lapply(c("5000", "2500", "3500"), function(sp) {
    session$setInputs(county_time_speed = sp); session$elapse(300)
    h <- as.character(output$county_time_slider_slot$html)
    at <- function(a) { m <- regmatches(h, regexpr(paste0(a, '="[^"]*"'), h)); if (length(m)) sub('.*="([^"]*)"', "\\1", m) else NULL }
    list(speed = sp, min = at("data-min"), max = at("data-max"), from = at("data-from"),
         interval = at("data-interval"), loop = at("data-loop"))
  }))
  session$setInputs(county_period_mode = "single")
  res$browse_leave <- c(read(), list(messages = I(s2b_apply(session, box, s2b_take(box)))))
  # Compare: right-map period, species (on, off with a hidden refine left over), left map changed, empty right map.
  session$setInputs(county_year = yrs, county_quarter = q4, county_time_step = "quarter")
  session$setInputs(county_period_mode = "compare")
  res$compare_enter <- c(read(), list(messages = I(s2b_apply(session, box, s2b_take(box)))))
  first_sp <- spp[1]; raw <- if ("Cattle" %in% spp) "Dairy cattle" else character(0)
  # a_raw: the left map refined, the right map on the shared species group (CVI: refine not shared).
  cs <- list(
    same           = list(),
    b_last_year    = list(county_year_b = yrs[length(yrs)]),
    b_q2           = list(county_quarter_b = "Q2"),
    a_first_b_last = list(county_year = yrs[1], county_year_b = yrs[length(yrs)]),
    b_species      = list(county_species_b_enabled = TRUE, county_species_b = first_sp),
    b_cattle_raw   = list(county_species_b_enabled = TRUE, county_species_b = "Cattle", county_species_b_sub = raw),
    b_raw_hidden   = list(county_species_b_enabled = FALSE, county_species_b = "Cattle", county_species_b_sub = raw),
    b_no_quarter   = list(county_quarter_b = character(0)),
    b_no_species   = list(county_species_b_enabled = TRUE, county_species_b = character(0)),
    a_raw          = list(county_species = if (length(raw)) "Cattle" else spp, county_species_sub = raw))
  base_b <- list(county_species = spp, county_species_sub = character(0),
                 county_year = yrs, county_quarter = q4, county_species_b_enabled = FALSE, county_species_b = spp,
                 county_species_b_sub = character(0), county_year_b = yrs, county_quarter_b = q4)
  cmp <- list()
  for (cn in names(cs)) for (d in DIRS) for (m in MODES) {
    inp <- modifyList(base_b, cs[[cn]], keep.null = TRUE)
    do.call(session$setInputs, c(inp, list(county_direction = d, county_mode = m)))
    session$elapse(300)
    cmp[[length(cmp) + 1L]] <- c(list(case = cn, direction = I(d), mode = m,
      left = list(species = I(inp$county_species), species_sub = I(inp$county_species_sub)),
      right = list(species_b_enabled = inp$county_species_b_enabled, species_b = I(inp$county_species_b),
                   species_b_sub = I(inp$county_species_b_sub), years_b = I(inp$county_year_b),
                   quarters_b = I(inp$county_quarter_b)),
      label_a = output$county_compare_label_a, label_b = output$county_compare_label_b,
      circles_a = s2b_circles(circ_a), circles_b = s2b_circles(circ_b)), read())
  }
  res$compare <- I(cmp)
  session$setInputs(county_direction = c("Inbound", "Outbound"), county_mode = "side_by_side")
  session$setInputs(county_period_mode = "single")
  invisible(s2b_apply(session, box, s2b_take(box)))
  res
}

s2_run <- function(df) {
  sess <- MockShinySession$new()
  box <- new.env()  # recorder and result state; testServer's expression assigns into it, not with <<-
  box$msgs <- list(); box$data_objs <- list()
  for (nm in c("sendInputMessage", "registerDataObj")) unlockBinding(nm, sess)
  sess$sendInputMessage <- function(inputId, message) box$msgs[[length(box$msgs) + 1L]] <- list(id = inputId, msg = message)
  sess$registerDataObj <- function(name, data, filterFunc) { box$data_objs[[name]] <- data; "data-obj-url" }
  for (nm in c("sendInputMessage", "registerDataObj")) lockBinding(nm, sess)
  rv <- reactiveValues(master_df = NULL)
  scen <- s2_scenarios(df)
  testServer(mod_maps_server, args = list(rv = rv, project_root = s2_sandbox, scripts_dir = s2_sandbox),
             session = sess, {
    rv$master_df <- df
    session$flushReact()
    load_msgs <- Filter(function(m) grepl("^county_", m$id), box$msgs)
    load_msgs <- lapply(load_msgs, function(m) list(id = m$id, msg = m$msg[setdiff(names(m$msg), "config")]))
    spot <- box$data_objs[[grep("county_spotlight", names(box$data_objs), value = TRUE)[1]]]
    views <- list()
    for (sn in names(scen)) for (d in DIRS) for (m in MODES) {
      f <- scen[[sn]]; f$direction <- d; f$raw_species <- f$raw_species %||% character(0)
      session$setInputs(county_species = f$species, county_species_sub = f$raw_species,
                        county_year = as.character(f$years), county_quarter = f$quarters,
                        county_direction = f$direction, county_mode = m, county_scaling = "log", county_n_bins = "5")
      session$elapse(300)
      s <- current_map_summary()
      views[[length(views) + 1L]] <- list(scenario = sn, filters = f, mode = m,
        summary = if (is.null(s)) NULL else s[c("total_animals", "n_cvis", "n_counties", "top_species")],
        value_boxes = s2_value_boxes(output$value_boxes), strip = s2_strip(output$filter_summary_strip))
    }
    box$periods <- s2b_periods(session, output, box, map_state, county_circle_data, county_circle_data_b, df, load_msgs)
    session$setInputs(county_species = sort(unique(df$Species.Group)), county_species_sub = character(0),
                      county_year = as.character(sort(unique(df$Reporting.Year))), county_quarter = c("Q1", "Q2", "Q3", "Q4"),
                      county_direction = c("Inbound", "Outbound"), county_mode = "side_by_side")
    session$elapse(300)
    vb_html <- output$value_boxes$html
    box$msgs <- list()
    session$setInputs(reset_filters = 1)
    reset <- lapply(box$msgs, function(m) list(id = m$id, msg = m$msg[setdiff(names(m$msg), "config")]))
    box$res <- list(load = list(physical_rows = cvi_master_physical_nrow(df), map_rows = nrow(df), messages = load_msgs,
                             spotlight_choices = if (is.null(spot)) NULL else spot$value),
                 views = views, reset = reset, periods = box$periods,
                 icons = regmatches(vb_html, gregexpr("(?s)<svg[^>]*class=\"bi bi-[a-z-]+ \".*?</svg>", vb_html, perl = TRUE))[[1]])
  })
  box$res
}

s2_targets <- list(
  cvi_master_small = file.path(repo_root, "tests", "synthetic", "cvi_master_small.csv"),
  cvi_master_wa39  = file.path(repo_root, "tests", "synthetic", "cvi_master_wa39.csv"),
  cvi_master_s2    = file.path(repo_root, "tests", "synthetic", "cvi_master_s2.csv"),
  cvi_master_s2_numcvi = file.path(repo_root, "tests", "synthetic", "cvi_master_s2_numcvi.csv"))
if (dir.exists(tier_dir)) for (tier in names(tier_masters))
  s2_targets[[paste0("tier_", tier)]] <- file.path(tier_dir, tier, tier_masters[[tier]])
# S2a, spotlight: CVI's own map builder .build_county_map() (mod_maps.R) on the circles of a view, for
# several spotlight picks from CVI's spotlight choices (as the module offers them on load) and one name not in the
# data. Records the circle layers it adds, in drawing order: id, source, opacity, hover opacity and the circles in
# each source, in order. The basemap and county geometries are not used here (NULL).
s2_spotlight <- function(df, choices) {
  spp <- sort(unique(df$Species.Group)); spp <- spp[!is.na(spp) & nzchar(spp)]
  yrs <- sort(unique(df$Reporting.Year)); yrs <- yrs[!is.na(yrs)]
  ch <- as.character(unlist(choices))
  picks <- list(none = character(0), first = ch[1], first_last = unique(ch[c(1, length(ch))]), all = ch,
                absent = "Not a county")
  if ("King" %in% ch) picks$king <- "King"
  if ("N/A" %in% ch) picks$out_of_state <- "N/A"
  pal <- c(Inbound = "#2a9d8f", Outbound = "#e76f51", Total = "#245566")
  out <- list()
  for (d in DIRS) for (m in MODES) {
    circ <- suppressWarnings(build_county_circle_data(master_df = df, species_filter = spp,
      year_filter = as.integer(yrs), quarter_filter = c("Q1", "Q2", "Q3", "Q4"), direction = d, mode = m,
      scaling = "log", n_bins = 5L, raw_species_filter = character(0)))
    for (pn in names(picks)) for (op in c(0.6, 0.9)) {
      w <- .build_county_map(circ, "style.json", op, pal, picks[[pn]], NULL, NULL, FALSE)
      src <- setNames(lapply(w$x$sources, function(s) s$data), vapply(w$x$sources, function(s) s$id, ""))
      layers <- lapply(Filter(function(l) l$type == "circle", w$x$layers), function(l) {
        g <- fromJSON(as.character(src[[l$source]]), simplifyVector = FALSE)
        list(id = l$id, source = l$source, opacity = l$paint[["circle-opacity"]],
             hover_opacity = if (is.null(l$hover_options)) NULL else l$hover_options$circle_opacity,
             circles = I(lapply(g$features, function(f) list(county = f$properties$county,
               direction = f$properties$direction, radius_px = f$properties$radius_px))))
      })
      out[[length(out) + 1L]] <- list(direction = d, mode = m, pick = pn, spotlight = I(picks[[pn]]), opacity = op,
                                      n_circles = nrow(circ), layers = I(layers))
    }
  }
  out
}

# CVI's module as run here is the CVI checkout's working tree (by design: the parity reference). It differs from the
# committed revision in this module only by the help text on the "Unique CVIs in current view" label.
if (want("s2")) cat("s2 CVI module modified in the working tree (the reference build):", s2_dirty, "\n")
s2_t0 <- Sys.time()
for (nm in if (want("s2")) c(names(s2_targets), "cvi_master_s2_nocvi", "cvi_master_s2_inf") else character(0)) {
  src <- if (nm %in% c("cvi_master_s2_nocvi", "cvi_master_s2_inf")) s2_targets$cvi_master_s2 else s2_targets[[nm]]
  df <- suppressWarnings(load_master_csv(src))
  if (is.null(df)) stop("load_master_csv failed for ", nm)
  # Variants of the S2 fixture built in memory after CVI's loader (the Node tests change the loaded rows the same way):
  # without its CVI column (a reduced table), and with S014's count infinite (R prints "Inf").
  if (nm == "cvi_master_s2_nocvi") df$CVI <- NULL
  if (nm == "cvi_master_s2_inf") df$Total.Animals[df$CVI %in% "S014"] <- Inf
  o <- c(list(meta = list(name = nm, fixture = sub(paste0(repo_root, "/"), "", src, fixed = TRUE),
              cvi_column_dropped = nm == "cvi_master_s2_nocvi", infinite_s014 = nm == "cvi_master_s2_inf",
              cvi_column_class = if ("CVI" %in% names(df)) class(df$CVI)[1] else NA_character_, cvi_revision = cvi_rev,
              cvi_module_modified_in_worktree = s2_dirty, r = R.version.string,
              shiny = as.character(packageVersion("shiny")), bsicons = as.character(packageVersion("bsicons")),
              generated = format(Sys.time(), tz = "UTC", usetz = TRUE))),
         s2_run(df))
  o$spotlight <- s2_spotlight(df, o$load$spotlight_choices)
  o$alert_icon <- as.character(bsicons::bs_icon("info-circle"))
  write_json(o, file.path(s2_out, paste0("oracle_s2_", nm, ".json")), auto_unbox = TRUE, digits = I(17),
             null = "null", na = "null", pretty = FALSE)
  cat("s2", nm, ":", length(o$views), "views,", length(o$reset), "reset messages,", length(o$icons), "icons,",
      length(o$spotlight), "spotlight maps\n")
  cat("s2b", nm, ":", length(o$periods$domains$quarter), "quarter and", length(o$periods$domains$year), "year periods,",
      length(o$periods$browse_frames), "browse frames,", length(o$periods$compare), "compare views\n")
}
# R's format() as the summaries use it: totals are doubles (padded, scientific when shorter, Inf/NaN/NA), the CVI count
# an integer (never scientific).
if (want("s2")) {
fmt_d <- list(Inf, -Inf, c(Inf, 5), c(Inf, 1234), c(-Inf, 100000), c(Inf, 12.5), c(NaN, 3), c(Inf, -Inf, 7),
              c(Inf, 1e6, 2e6), c(NA, 5), 100000, c(5, 1200), 12.5, -4.7, c(974, 101052))
fmt_i <- list(0L, 5L, 1234L, 100000L, 1000000L, 23L)
write_json(list(double = lapply(fmt_d, function(v) list(x = as.character(v), out = format(v, big.mark = ","))),
                integer = lapply(fmt_i, function(v) list(x = v, out = format(v, big.mark = ",")))),
           file.path(s2_out, "format_cases_s2.json"), auto_unbox = FALSE, digits = I(17))
cat("s2 format cases:", length(fmt_d), "double,", length(fmt_i), "integer\n")
}
if (length(list.files(s2_sandbox, all.files = TRUE, no.. = TRUE))) stop("S2: something was written to the empty CVI root")
if (want("s2")) {
  cat("s2 paths asked for (all inside the empty root):", paste(sort(s2_paths_used), collapse = "; "), "\n")
  cat("s2 time:", format(round(difftime(Sys.time(), s2_t0, units = "secs"), 1)), "\n")
}

# ── S3: CVI's basemap list and raster style builder (mod_maps.R, sourced above for S2) ──────────────────────────
# .basemap_choices() (groups, labels and values in order), .RASTER_BASEMAPS (CVI's raster styles) and
# .make_raster_style() on a probe address, which the page's basemaps.rasterStyle() must build the same way; also the
# default .resolve_basemap() falls back to. Nothing is fetched. Output: local-test-artifacts/s3/oracle_s3_basemaps.json.
if (want("s3")) {
  s3_out <- file.path(repo_root, "local-test-artifacts", "s3")
  dir.create(s3_out, recursive = TRUE, showWarnings = FALSE)
  s3_ch <- .basemap_choices()
  s3_choices <- unlist(lapply(names(s3_ch), function(g) lapply(seq_along(s3_ch[[g]]), function(i)
    list(group = g, label = names(s3_ch[[g]])[i], value = unname(s3_ch[[g]][i])))), recursive = FALSE)
  s3_raster <- lapply(names(.RASTER_BASEMAPS), function(k) list(key = k, style = .RASTER_BASEMAPS[[k]]))
  s3_probe <- list(tiles = "https://example.invalid/tile/{z}/{y}/{x}", attribution = "Probe credit", max_zoom = 16L)
  # Label/boundary contrast: CVI's .resolve_label_boundary_style() lives inside mod_maps_server(), so it is called through
  # shiny::testServer on the unmodified module (no data loaded; same empty sandbox as S2), for each label style x
  # boundary style x basemap value. Values: every CVI choice, and the addresses of the page's additions (OpenFreeMap Dark,
  # USGS x5, WSDOT; what CVI's rule says of them). The S3 unit tests check that this list covers every addition.
  s3_additions <- c(
    "https://tiles.openfreemap.org/styles/dark",
    paste0("https://basemap.nationalmap.gov/arcgis/rest/services/", c("USGSTopo", "USGSImageryOnly", "USGSImageryTopo",
           "USGSShadedReliefOnly", "USGSHydroCached"), "/MapServer/tile/{z}/{y}/{x}"),
    "https://data.wsdot.wa.gov/arcgis/rest/services/Shared/WebBaseMapWebMercator/MapServer/tile/{z}/{y}/{x}")
  s3_values <- c(vapply(s3_choices, function(x) x$value, ""), s3_additions)
  s3_box <- new.env()
  testServer(mod_maps_server, args = list(rv = reactiveValues(master_df = NULL), project_root = s2_sandbox, scripts_dir = s2_sandbox), {
    cases <- list()
    for (v in s3_values) for (l in c("auto", "dark", "light")) for (bd in c("auto", "dark", "light"))
      cases[[length(cases) + 1L]] <- c(list(basemap = v, label_style = l, boundary_style = bd), .resolve_label_boundary_style(l, bd, v))
    s3_box$cases <- cases
  })
  write_json(list(meta = list(cvi_revision = cvi_rev, cvi_module_modified_in_worktree = s2_dirty, r = R.version.string,
                              generated = format(Sys.time(), tz = "UTC", usetz = TRUE)),
                  choices = s3_choices, raster = s3_raster, probe = s3_probe,
                  probe_style = .make_raster_style(s3_probe$tiles, attribution = s3_probe$attribution, max_zoom = s3_probe$max_zoom),
                  default_basemap = .resolve_basemap(NULL), unknown_raster = .resolve_basemap("raster:nope"),
                  additions = s3_additions, contrast = s3_box$cases),
             file.path(s3_out, "oracle_s3_basemaps.json"), auto_unbox = TRUE, digits = I(17), null = "null", na = "null", pretty = FALSE)
  if (length(list.files(s2_sandbox, all.files = TRUE, no.. = TRUE))) stop("S3: something was written to the empty CVI root")
  cat("s3 basemaps:", length(s3_choices), "choices in", length(s3_ch), "groups,", length(s3_raster), "raster styles,",
      length(s3_box$cases), "contrast cases\n")
}

# ── S4: National Flow, through CVI's module (mod_maps_server, sourced above for S2) ────────────────────────────────
# The Flow map is switched on with CVI's own Map View button (show_flow); its inputs are set for each view and CVI's
# outputs read: flow_line_data() (lines, totals, widths, breakdowns, arcs), the rendered flow_map widget (layers in
# order, each line's color, width, tooltip and drawing order, opacity and hover, state lines and labels, opening view),
# the legend, value boxes and strip; then Browse (domains, every frame by quarter and by year, the messages CVI sends)
# and Reset All. CVI reads its state centers from reference/state_capitals.csv: the sandbox's copy is written from the
# page's bundled site/geo/state-centers.js (and must be byte-identical to CVI's own file, by SHA-256), so both use the
# same centers. Nothing else is in the sandbox, and nothing may be written there. geosphere's arcs for every center
# (and a few probe pairs for the port's edge cases) go to oracle_s4_arcs.json.
if (want("s4")) {
  s4_t0 <- Sys.time()
  s4_out <- file.path(repo_root, "local-test-artifacts", "s4")
  s4_root <- file.path(s4_out, "cvi_root")
  unlink(s4_root, recursive = TRUE)
  dir.create(file.path(s4_root, "reference"), recursive = TRUE, showWarnings = FALSE)
  s4_ctr_js <- readLines(file.path(repo_root, "site", "geo", "state-centers.js"), warn = FALSE, encoding = "UTF-8")
  s4_ctr <- fromJSON(sub(";$", "", sub("^window\\.WSDA_STATE_CENTERS = ", "", s4_ctr_js[2])))$centers
  s4_ctr_file <- file.path(s4_root, "reference", "state_capitals.csv")
  writeLines(c("state,state_lat,state_long", sprintf("%s,%.2f,%.2f", s4_ctr$state, s4_ctr$lat, s4_ctr$lon)), s4_ctr_file)
  s4_ctr_sha <- paste(as.character(openssl::sha256(file(s4_ctr_file))), collapse = "")
  if (!identical(s4_ctr_sha, "c00bad8aebd88a3bf8a1a6a43d06bbf8d2fdf956c2babe1da4dd201bcebd568a"))
    stop("S4: the bundled centers do not write back to CVI's file (SHA-256 ", s4_ctr_sha, ")")
  s4_paths_used <- character(0)
  .s4_path <- function(kind) function(...) {
    s4_paths_used <<- union(s4_paths_used, paste(kind, paste(c(...), collapse = "/")))
    file.path(s4_root, kind, ...)
  }
  cvi_dir_reference <- .s4_path("reference"); cvi_dir_exports <- .s4_path("exports"); cvi_dir_www <- .s4_path("www")
  cvi_dir_tile_cache <- .s4_path("tile_cache")

  S4_PALETTES <- names(SPECIES_PALETTES)
  S4_MULTS <- c("0.15", "0.25", "0.40", "0.65", "1.0", "1.5", "2.0", "3.0")
  S4_OPACITIES <- c("0.2", "0.4", "0.6", "0.8", "1.0")
  S4_DIRS <- c("inbound", "outbound", "combined")
  q4 <- c("Q1", "Q2", "Q3", "Q4")

  # The legend's visible parts: species swatches (color, label) and width bars (height, label), or its message.
  s4_legend <- function(h) {
    h <- as.character(h$html)
    if (!grepl("<strong>Species</strong>", h, fixed = TRUE)) return(list(state = "message", lines = I(.html_lines(h))))
    sp <- regmatches(h, gregexpr('width:20px; height:3px; background:[^;]*;"></span>\\s*<span>[^<]*</span>', h))[[1]]
    wd <- regmatches(h, gregexpr('width:28px; height:[0-9]+px;[^>]*></span>\\s*<span style="font-size:0.75em;">[^<]*</span>', h))[[1]]
    list(state = "legend",
         species = I(lapply(sp, function(x) list(color = sub(".*background:([^;]*);.*", "\\1", x),
                                                 label = .unescape(sub(".*<span>([^<]*)</span>$", "\\1", x))))),
         widths = I(lapply(wd, function(x) list(px = as.integer(sub(".*height:([0-9]+)px;.*", "\\1", x)),
                                                label = .unescape(sub('.*0.75em;">([^<]*)</span>$', "\\1", x))))),
         line_width_header = grepl("<strong>Line width</strong>", h, fixed = TRUE))
  }
  # The rendered widget: map options once, and per view the layers in order with their paint, layout and data.
  s4_widget <- function(w) fromJSON(unclass(w), simplifyVector = FALSE)$x
  s4_layers <- function(x) {
    src <- setNames(lapply(x$sources, function(s) s$data), vapply(x$sources, function(s) s$id, ""))
    lapply(x$layers, function(l) {
      out <- list(id = l$id, type = l$type, source = l$source, paint = l$paint, layout = l$layout,
                  tooltip = l$tooltip, hover_options = l$hover_options)
      g <- src[[l$source]]
      if (identical(l$id, "flow_lines")) out$features <- I(lapply(g$features, function(f) list(
        state = f$properties$state, species_group = f$properties$species_group, color = f$properties$color,
        line_width_px = f$properties$line_width_px, tooltip_text = f$properties$tooltip_text,
        n_vertices = length(f$geometry$coordinates))))
      if (identical(l$id, "state-labels")) out$features <- I(lapply(g$features, function(f) list(
        abbr = f$properties$abbr, lon = f$geometry$coordinates[[1]], lat = f$geometry$coordinates[[2]])))
      if (identical(l$id, "state-lines")) out$n_features <- length(g$features)
      out
    })
  }
  s4_run <- function(df, full, extra = list()) {
    sess <- MockShinySession$new()
    box <- new.env(); box$msgs <- list(); box$data_objs <- list()
    for (nm in c("sendInputMessage", "registerDataObj")) unlockBinding(nm, sess)
    sess$sendInputMessage <- function(inputId, message) box$msgs[[length(box$msgs) + 1L]] <- list(id = inputId, msg = message)
    sess$registerDataObj <- function(name, data, filterFunc) { box$data_objs[[name]] <- data; "data-obj-url" }
    for (nm in c("sendInputMessage", "registerDataObj")) lockBinding(nm, sess)
    spp <- sort(unique(df$Species.Group)); spp <- spp[!is.na(spp) & nzchar(spp)]
    yrs <- as.character(sort(unique(df$Reporting.Year))); yrs <- yrs[!is.na(yrs)]
    has_sp <- "Species" %in% names(df)
    testServer(mod_maps_server, args = list(rv = reactiveValues(master_df = NULL), project_root = s4_root, scripts_dir = s4_root),
               session = sess, {
      rv$master_df <- df
      session$flushReact()
      load_msgs <- lapply(Filter(function(m) grepl("^flow_", m$id), box$msgs),
                          function(m) list(id = m$id, msg = m$msg[setdiff(names(m$msg), "config")]))
      slider0 <- Filter(function(m) m$id == "flow_time_slider", load_msgs)
      session$setInputs(show_flow = 1)
      base <- list(flow_direction = "inbound", flow_species = spp, flow_species_sub = character(0), flow_year = yrs,
                   flow_quarter = q4, flow_combine_species = TRUE, flow_scaling = "natural", flow_n_bins = "5",
                   flow_opacity = "0.8", flow_width_mult = "0.40", flow_palette = "Single — WSDA Blue",
                   show_state_labels = TRUE, flow_show_state_lines = TRUE, flow_time_enabled = FALSE,
                   flow_time_step = "quarter", flow_time_speed = "3500",
                   flow_time_slider = if (length(slider0)) as.numeric(slider0[[1]]$msg$value) else 1)
      do.call(session$setInputs, base); session$elapse(300)
      box$msgs <- list()
      res <- list(active_map = active_map(), slider_load = if (length(slider0)) slider0[[1]]$msg else NULL,
                  domains = list(quarter = I(map_state$flow_tq_combos %||% character(0)),
                                 year = I(map_state$flow_year_combos %||% character(0)),
                                 all_quarter = I(map_state$tq_combos %||% character(0)),
                                 all_year = I(map_state$year_combos %||% character(0))))
      x0 <- s4_widget(output$flow_map)
      res$map <- x0[setdiff(names(x0), c("layers", "sources"))]
      arcs <- list()
      view <- function(inp) {
        inp <- modifyList(base, inp, keep.null = TRUE)
        do.call(session$setInputs, inp); session$elapse(300)
        d <- tryCatch(flow_line_data(), error = function(e) NULL)
        ls <- NULL
        if (!is.null(d) && nrow(d) > 0) {
          cc <- sf::st_coordinates(d)
          dp <- sf::st_drop_geometry(d)
          ls <- I(lapply(seq_len(nrow(dp)), function(i) {
            xy <- unname(cc[cc[, "L1"] == i, c("X", "Y"), drop = FALSE])
            st <- dp$state[i]
            if (is.null(arcs[[st]])) arcs[[st]] <<- xy
            list(state = st, species_group = dp$species_group[i], total_animals = dp$total_animals[i],
                 line_width_px = dp$line_width_px[i], species_breakdown = dp$species_breakdown[i], color = dp$color[i],
                 dest_lat = dp$dest_lat[i], dest_lon = dp$dest_lon[i], arc_same = identical(xy, arcs[[st]]))
          }))
        }
        x <- tryCatch(s4_widget(output$flow_map), error = function(e) NULL)
        list(inputs = lapply(inp[c("flow_direction", "flow_species", "flow_species_sub", "flow_year", "flow_quarter",
                                    "flow_combine_species", "flow_scaling", "flow_n_bins", "flow_opacity", "flow_width_mult",
                                    "flow_palette", "show_state_labels", "flow_show_state_lines")], function(v) if (length(v) == 1L) v else I(v)),
             lines = ls, layers = if (is.null(x)) NULL else I(s4_layers(x)),
             legend = s4_legend(output$map_legend_ui), value_boxes = s2_value_boxes(output$value_boxes),
             strip = s2_strip(output$filter_summary_strip))
      }
      scen <- list(default = list(), no_quarters = list(flow_quarter = character(0)), no_species = list(flow_species = character(0)),
                   no_years = list(flow_year = character(0)), y_first = list(flow_year = yrs[1]),
                   y_last = list(flow_year = yrs[length(yrs)]), q2_q3 = list(flow_quarter = c("Q2", "Q3")),
                   two_groups = list(flow_species = spp[seq_len(min(2L, length(spp)))]))
      for (g in spp) scen[[paste0("group_", g)]] <- list(flow_species = g)
      if ("Cattle" %in% spp) {
        scen$cattle_raw <- list(flow_species = "Cattle", flow_species_sub = c("Dairy cattle", "Beef cattle"))
        scen$cattle_raw_none <- list(flow_species = "Cattle", flow_species_sub = "Not a species")
        scen$all_raw <- list(flow_species_sub = "Dairy cattle")
      }
      scen <- c(scen, extra)   # file-specific views (S4 fixture: partners without a center only, States 0)
      if (length(res$domains$quarter)) {
        p1 <- strsplit(res$domains$quarter[1], "-", fixed = TRUE)[[1]]
        scen$one_period <- list(flow_year = p1[1], flow_quarter = p1[2])
      }
      views <- list(); k <- 0L
      add <- function(name, inp) {
        k <<- k + 1L
        v <- view(inp); v$scenario <- name
        views[[length(views) + 1L]] <<- v
      }
      # Every scenario x direction x Combine species, palette, multiplier and opacity rotating with the view count.
      for (sn in names(scen)) for (dr in S4_DIRS) for (cb in c(TRUE, FALSE)) {
        add(sn, c(scen[[sn]], list(flow_direction = dr, flow_combine_species = cb,
                                   flow_palette = S4_PALETTES[k %% 8L + 1L], flow_width_mult = S4_MULTS[(3L * k + 1L) %% 8L + 1L],
                                   flow_opacity = S4_OPACITIES[k %% 5L + 1L])))
      }
      # Every scaling and bin count on the whole file (S4 fixture and Full tier; scaling itself is checked in S1).
      if (full) for (dr in S4_DIRS) for (cb in c(TRUE, FALSE)) for (sc in SCALINGS) for (b in if (sc %in% c("quantile", "natural")) BINS else 5L)
        add(paste0("scaling_", sc, "_", b), list(flow_direction = dr, flow_combine_species = cb, flow_scaling = sc,
                                                 flow_n_bins = as.character(b), flow_palette = S4_PALETTES[k %% 8L + 1L]))
      # Every palette, each with another multiplier (S4 fixture and Full tier); state labels and lines off.
      if (full) for (dr in S4_DIRS) for (cb in c(TRUE, FALSE)) for (i in seq_along(S4_PALETTES))
        add("palette", list(flow_direction = dr, flow_combine_species = cb, flow_palette = S4_PALETTES[i],
                            flow_width_mult = S4_MULTS[(i + match(dr, S4_DIRS) + cb) %% 8L + 1L]))
      add("labels_off", list(show_state_labels = FALSE))
      add("lines_off", list(flow_show_state_lines = FALSE))
      add("both_off", list(show_state_labels = FALSE, flow_show_state_lines = FALSE, flow_direction = "combined"))
      res$views <- views

      # Browse over time: on, every quarter frame, the switch to years, every year frame (CVI's messages applied as a
      # browser would), then off. Default filters otherwise.
      do.call(session$setInputs, base); session$elapse(300); box$msgs <- list()
      frame <- function() {
        d <- tryCatch(flow_line_data(), error = function(e) NULL)
        list(years = I(as.character(session$input$flow_year)), quarters = I(as.character(session$input$flow_quarter)),
             slider = session$input$flow_time_slider, step = session$input$flow_time_step,
             label = tryCatch(output$flow_time_label, error = function(e) NULL),
             lines = if (is.null(d) || !nrow(d)) NULL else I(lapply(seq_len(nrow(d)), function(i) list(
               state = d$state[i], species_group = d$species_group[i], total_animals = d$total_animals[i],
               line_width_px = d$line_width_px[i]))),
             strip = s2_strip(output$filter_summary_strip), value_boxes = s2_value_boxes(output$value_boxes))
      }
      session$setInputs(flow_time_enabled = TRUE)
      enter <- s2b_apply(session, box, s2b_take(box))
      br <- list(enter = c(frame(), list(messages = I(enter))))
      frames <- list()
      for (step in c("quarter", "year")) {
        if (step == "year") {
          session$setInputs(flow_time_step = "year")
          ms <- s2b_apply(session, box, s2b_take(box))   # CVI's messages applied first, then the state read
          br$year_switch <- c(frame(), list(messages = I(ms)))
        }
        n <- length(if (step == "year") (if (length(res$domains$year)) res$domains$year else res$domains$all_year)
                    else (if (length(res$domains$quarter)) res$domains$quarter else res$domains$all_quarter))
        for (i in seq_len(n)) {
          session$setInputs(flow_time_slider = i)
          ms <- s2b_apply(session, box, s2b_take(box))
          frames[[length(frames) + 1L]] <- c(list(step = step, index = i), frame(), list(messages = I(ms)))
        }
      }
      br$frames <- I(frames)
      session$setInputs(flow_time_enabled = FALSE)
      ms <- s2b_apply(session, box, s2b_take(box))
      br$leave <- c(frame(), list(messages = I(ms)))
      res$browse <- br

      # Reset All after every Flow control was changed: the values CVI sends for the Flow map.
      do.call(session$setInputs, modifyList(base, list(flow_direction = "combined", flow_species = spp[1],
        flow_species_sub = "Dairy cattle", flow_year = yrs[1], flow_quarter = "Q2", flow_combine_species = FALSE,
        flow_scaling = "log", flow_n_bins = "3", flow_opacity = "0.2", flow_width_mult = "3.0", flow_palette = "Muted",
        show_state_labels = FALSE, flow_show_state_lines = FALSE, flow_time_enabled = TRUE, flow_time_step = "year",
        flow_time_speed = "2500")))
      session$elapse(300); box$msgs <- list()
      session$setInputs(reset_filters = 1)
      res$reset <- I(lapply(Filter(function(m) grepl("^flow_|^show_state_labels$", m$id), box$msgs),
                            function(m) list(id = m$id, msg = m$msg[setdiff(names(m$msg), "config")])))
      res$load_messages <- I(load_msgs)
      res$arcs <- lapply(names(arcs), function(st) list(state = st, coords = arcs[[st]]))
      box$res <- res
    })
    box$res
  }

  s4_fixture <- file.path(repo_root, "tests", "synthetic", "cvi_master_s4.csv")
  s4_targets <- c(s2_targets, list(cvi_master_s4 = s4_fixture, cvi_master_s4_noflow = s4_fixture))
  # Views only the S4 fixture can give (each in every direction): corridor rows whose partners have no center, inbound
  # (States 0 while the boxes count animals): blank and missing origins (2025 Q4), XX and BC (2025 Q3, Cattle).
  s4_extra <- list(no_center_blank = list(flow_year = "2025", flow_quarter = "Q4"),
                   no_center_xx_bc = list(flow_year = "2025", flow_quarter = "Q3", flow_species = "Cattle"))
  dir.create(s4_out, recursive = TRUE, showWarnings = FALSE)
  for (nm in names(s4_targets)) {
    df <- suppressWarnings(load_master_csv(s4_targets[[nm]]))
    if (is.null(df)) stop("load_master_csv failed for ", nm)
    # cvi_master_s4_noflow: the S4 fixture after loading without its rows that have exactly one end "WA" (both states
    # present), so the Flow slider has no periods of its own and CVI falls back to the file's (the Node tests filter the
    # loaded rows the same way).
    if (nm == "cvi_master_s4_noflow") {
      xo <- !is.na(df$Origin.State) & !is.na(df$Dest.State) & ((df$Origin.State == "WA") != (df$Dest.State == "WA"))
      df <- df[!xo, , drop = FALSE]
    }
    o <- c(list(meta = list(name = nm, fixture = sub(paste0(repo_root, "/"), "", s4_targets[[nm]], fixed = TRUE),
                cvi_revision = cvi_rev, cvi_module_modified_in_worktree = s2_dirty, r = R.version.string,
                shiny = as.character(packageVersion("shiny")), mapgl = as.character(packageVersion("mapgl")),
                geosphere = as.character(packageVersion("geosphere")), centers_sha256 = s4_ctr_sha,
                variant_noflow = nm == "cvi_master_s4_noflow", generated = format(Sys.time(), tz = "UTC", usetz = TRUE))),
           suppressWarnings(s4_run(df, full = nm %in% c("cvi_master_s4", "tier_full"),
                                   extra = if (nm == "cvi_master_s4") s4_extra else list())))
    write_json(o, file.path(s4_out, paste0("oracle_s4_", nm, ".json")), auto_unbox = TRUE, digits = I(17),
               null = "null", na = "null", pretty = FALSE)
    cat("s4", nm, ":", length(o$views), "views,", length(o$browse$frames), "browse frames,", length(o$reset),
        "reset messages,", length(o$arcs), "arcs\n")
  }
  # geosphere's arcs from Washington's anchor to every center, and probe pairs for the port's edge cases.
  s4_arc <- function(from, to) tryCatch(list(coords = geosphere::gcIntermediate(from, to, n = 200, addStartEnd = TRUE)),
                                        error = function(e) list(error = conditionMessage(e)))
  probes <- list(list(from = c(-120.5, 47.5), to = c(-120.5, 47.5)), list(from = c(-120.5, 47.5), to = c(59.5, -47.5)),
                 list(from = c(-120.5, 47.5), to = c(170, 60)), list(from = c(-120.5, 47.5), to = c(-70, 95)),
                 list(from = c(-120.5, 47.5), to = c(-400, 10)), list(from = c(0, 0), to = c(90, 0)),
                 list(from = c(-120.5, 47.5), to = c(-120.5 + 1e-10, 47.5)),
                 # near base::all.equal's tolerance: one coordinate equal, the other just inside or outside
                 list(from = c(-120.5, 47.5), to = c(-120.5, 47.5 + 5e-7)), list(from = c(-120.5, 47.5), to = c(-120.5, 47.5 + 1e-6)),
                 list(from = c(-120.5, 47.5), to = c(-120.5 + 1e-6, 47.5)), list(from = c(-120.5, 47.5), to = c(-120.5 + 3e-6, 47.5)),
                 list(from = c(-120.5, 47.5), to = c(-120.5 + 1e-6, 47.5 + 1e-6)))
  write_json(list(meta = list(geosphere = as.character(packageVersion("geosphere")), r = R.version.string),
                  palettes = lapply(names(SPECIES_PALETTES), function(n) list(name = n, colors = lapply(names(SPECIES_PALETTES[[n]]),
                    function(sp) list(species = sp, color = unname(SPECIES_PALETTES[[n]][sp]))))),
                  centers = lapply(seq_len(nrow(s4_ctr)), function(i) c(list(state = s4_ctr$state[i]),
                    s4_arc(c(-120.5, 47.5), c(s4_ctr$lon[i], s4_ctr$lat[i])))),
                  probes = lapply(probes, function(p) c(p, s4_arc(p$from, p$to)))),
             file.path(s4_out, "oracle_s4_arcs.json"), auto_unbox = TRUE, digits = I(17), null = "null", na = "null", pretty = FALSE)
  s4_left <- setdiff(list.files(s4_root, recursive = TRUE, all.files = TRUE), "reference/state_capitals.csv")
  if (length(s4_left)) stop("S4: something was written to the CVI root: ", paste(s4_left, collapse = ", "))
  cat("s4 paths asked for (all inside the sandbox):", paste(sort(s4_paths_used), collapse = "; "), "\n")
  cat("s4 time:", format(round(difftime(Sys.time(), s4_t0, units = "secs"), 1)), "\n")
}

# S5 first gate ONLY. Runs the unmodified Focus builder on synthetic CSVs through CVI's loader, using log sizing
# to get the premises set without a random sample. Independently run exact classInt Fisher (sampling disabled)
# beside seeded CVI's sampled sizing. The other s5 parts check the module, the premises, the payloads and facilities.
if ("s5" %in% parts) {
  s5_out <- file.path(repo_root, "local-test-artifacts", "s5")
  s5_gate <- file.path(s5_out, "gate")
  if (!file.exists(file.path(s5_gate, "cases.json"))) stop("S5: run make_cvi_focus_fixtures.js --scaling-gate first")
  s5_cases <- fromJSON(file.path(s5_gate, "cases.json"), simplifyVector = FALSE)$cases
  s5_results <- list()
  for (case in s5_cases) {
    fixture <- file.path(s5_gate, case$file)
    fixture_sha <- strsplit(system2("shasum", c("-a", "256", shQuote(fixture)), stdout = TRUE), " ")[[1]][1]
    if (!identical(fixture_sha, case$sha256)) stop("S5: fixture hash mismatch ", case$name)
    df <- suppressWarnings(load_master_csv(fixture))
    if (is.null(df)) stop("S5 loader failed: ", case$name)
    t0 <- proc.time()[["elapsed"]]
    premises <- build_county_focus_data(df, focus_counties = "King", species_filter = "Cattle",
      year_filter = 2025L, quarter_filter = "Q1", direction = case$direction, mode = "overlap", scaling = "log")
    if (is.null(premises) || nrow(premises) != case$n) stop("S5: wrong grouped premises count ", case$name)
    values <- premises$total_animals
    if (sum(values) != case$expectedAnimals || any(values <= 0)) stop("S5: wrong positive grouped values ", case$name)
    views <- lapply(c(5L, 10L), function(bins) {
      # largeN=Inf turns sampling off explicitly; this is classInt's exact Fortran implementation,
      # independently of the JavaScript dynamic-programming implementation.
      exact <- suppressWarnings(classInt::classIntervals(values, n = bins, style = "fisher", largeN = Inf))$brks
      exact_bins <- as.integer(cut(values, breaks = exact, include.lowest = TRUE))
      exact_bins[is.na(exact_bins)] <- 1L
      exact_radii <- 4 + (exact_bins - 1) / (max(exact_bins) - 1) * 20
      tiers <- (head(exact, -1L) + tail(exact, -1L)) / 2
      tier_bins <- as.integer(cut(tiers, breaks = exact, include.lowest = TRUE))
      tier_bins[is.na(tier_bins)] <- 1L
      exact_legend <- 4 + (tier_bins - 1) / (max(exact_bins) - 1) * 20
      set.seed(20261008)
      sampled_breaks <- suppressWarnings(classInt::classIntervals(values, n = bins, style = "fisher"))$brks
      set.seed(20261008)
      sampled_radii <- suppressWarnings(.compute_radius(values, scaling = "natural", min_r = 4, max_r = 24, n_bins = bins))
      list(bins = bins, exactBreaks = exact, exactRadii = exact_radii, exactTiers = tiers,
        exactLegendRadii = exact_legend, sampledBreaks = sampled_breaks, sampledRadii = sampled_radii)
    })
    s5_results[[length(s5_results) + 1L]] <- list(name = case$name, n = nrow(premises), direction = case$direction,
      fixtureSha256 = fixture_sha, animalSum = sum(values), inbound = sum(premises$direction == "Inbound"),
      outbound = sum(premises$direction == "Outbound"), values = values, views = views,
      referenceSecs = unname(proc.time()[["elapsed"]] - t0))
    cat("s5 gate", case$name, ":", nrow(premises), "grouped premises,", length(views), "Fisher views;",
      round(proc.time()[["elapsed"]] - t0, 3), "seconds\n")
    flush.console()
  }
  # Small/degenerate vectors across all five scalings and every approved bin choice. The Focus helper must retain
  # CVI's radius/tier behavior, including single values, ties, zeros, negatives, NA and the quantile fallback.
  edge_vectors <- list(numeric(0), 7, c(0, 0, 0), c(5, 5, 5), c(0, 7, 7), c(0, 1),
    c(-5, NA, 0, 12, 12, 400), c(1, 1, 1, 1, 2, 3), c(0, 120, 2750, 400, 120),
    c(0.25, 0.5, 1.5, 1.5, 100.25), c(1, 2, 3, 4, 5, 6, 7, 8, 9, 10))
  s5_edges <- list()
  for (i in seq_along(edge_vectors)) for (sc in SCALINGS) for (b in if (sc %in% c("quantile", "natural")) BINS else 5L) {
    vv <- edge_vectors[[i]]
    rr <- suppressWarnings(.compute_radius(vv, scaling = sc, n_bins = b, min_r = 4, max_r = 24))
    tt <- suppressWarnings(.legend_tiers(vv, scaling = sc, n_bins = b, min_r = 4, max_r = 24))
    legend <- if (is.null(tt)) NULL else list(values = tt$values,
      radii = if (sc %in% c("quantile", "natural")) s11_bin_radii(vv, tt$values, sc, b, min_r = 4, max_r = 24) else
        vapply(tt$values, function(x) tail(.compute_radius(c(vv, x), scaling = sc, n_bins = b, min_r = 4, max_r = 24), 1L), numeric(1)))
    s5_edges[[length(s5_edges) + 1L]] <- list(name = paste(i, sc, b, sep = "/"), values = I(vv), scaling = sc,
      bins = b, radii = I(rr), legend = legend)
  }
  write_json(list(meta = list(stage = "scaling gate only", cvi_revision = cvi_rev,
    cvi_helpers_modified_in_worktree = cvi_dirty, r = R.version.string,
    classInt = as.character(packageVersion("classInt")), largeN = 3000, samplingDisabled = TRUE,
    samplingSeed = 20261008, samplingNote = "default classInt samples above 3000 distinct positive values",
    generated = format(Sys.time(), tz = "UTC", usetz = TRUE)), cases = s5_results, edgeCases = s5_edges),
    file.path(s5_out, "oracle_s5_gate.json"), auto_unbox = TRUE, digits = I(17), null = "null", na = "null")
  cat("s5 gate edges:", length(s5_edges), "views across all five scalings\n")
  cat("s5 gate: complete; full S5 oracle, module route and geometry checks NOT RUN\n")
}

# S5 bounded module-route check. Uses the unmodified module and a small synthetic
# master, optionally injecting facilities and a six-view direction/mode grid.
# Not the full S5 premises/subset/facility matrix. No extracted fallback.
if (any(c("s5-module-route", "s5-module-facilities") %in% parts)) {
  facility_probe <- "s5-module-facilities" %in% parts
  route_out <- file.path(repo_root, "local-test-artifacts", "s5", if (facility_probe) "module-facilities" else "module-route")
  route_root <- file.path(route_out, "empty_cvi_root")
  dir.create(route_root, recursive = TRUE, showWarnings = FALSE)
  if (length(list.files(route_root, all.files = TRUE, no.. = TRUE))) stop("S5 route root must be empty")
  route_paths <- character(0)
  route_path <- function(kind) function(...) {
    pieces <- c(...)
    if (any(grepl("(^/|^[A-Za-z]:|(^|[/\\\\])\\.\\.([/\\\\]|$))", pieces))) stop("Unsafe CVI path")
    p <- file.path(route_root, kind, ...)
    route_paths <<- union(route_paths, p)
    p
  }
  cvi_dir_reference <- route_path("reference"); cvi_dir_exports <- route_path("exports")
  cvi_dir_www <- route_path("www"); cvi_dir_tile_cache <- route_path("tile_cache")
  fixture <- file.path(route_out, "master.csv")
  df <- suppressWarnings(load_master_csv(fixture))
  if (is.null(df) || nrow(df) != 6L || cvi_master_physical_nrow(df) != 5L) stop("S5 route loader count")
  geo_file <- file.path(repo_root, "local-test-artifacts", "s5", "membership", "inputs.json")
  if (!file.exists(geo_file)) stop("Generate --membership first for bundled polygon injection")
  geo_input <- fromJSON(geo_file, simplifyVector = FALSE)
  if (!identical(geo_input$geometrySha256, paste(as.character(openssl::sha256(file(file.path(repo_root, "site", "geo", "wa-counties.js")))), collapse = ""))) stop("S5 route geometry input stale")
  geo <- geo_input$groups[[1]]$counties
  polygons <- sf::st_read(toJSON(geo, auto_unbox = TRUE), quiet = TRUE)
  sess <- MockShinySession$new(); box <- new.env(); box$msgs <- list()
  unlockBinding("sendInputMessage", sess)
  sess$sendInputMessage <- function(inputId, message) box$msgs[[length(box$msgs) + 1L]] <- list(id = inputId, msg = message)
  lockBinding("sendInputMessage", sess)
  checks <- 0L
  check <- function(ok, label) {
    if (!isTRUE(ok)) stop("S5 module route: ", label)
    checks <<- checks + 1L
  }
  testServer(mod_maps_server, args = list(rv = reactiveValues(master_df = NULL),
    project_root = route_root, scripts_dir = route_root), session = sess, {
    rv$master_df <- df; session$flushReact()
    map_state$county_polygons <- sf::st_sf(name = polygons$name, geometry = sf::st_geometry(polygons))
    session$setInputs(show_intrastate = 1, intra_counties = "King", intra_species = "Cattle",
      intra_species_sub = character(0), intra_year = c("2025", "2026"), intra_quarter = c("Q1", "Q2", "Q3", "Q4"),
      intra_filter_dir = "combined", intra_mode = "overlap", intra_scaling = "log", intra_n_bins = "5",
      intra_time_enabled = FALSE, intra_time_step = "quarter", intra_time_slider = 1)
    session$elapse(300)
    check(identical(active_map(), "intrastate"), "Focus activation")
    snapshot <- function() {
      d <- intrastate_line_data()
      list(summary = current_map_summary(), premises = sf::st_drop_geometry(d),
        boxes = s2_value_boxes(output$value_boxes), strip = s2_strip(output$filter_summary_strip))
    }
    initial <- snapshot()
    check(initial$summary$total_animals == 100, "box includes missing-coordinate animals and merges loader twins")
    check(initial$summary$n_premises == 4L, "direction-prefixed premises")
    check(initial$summary$n_cvis == 4L, "box unique certificates")
    check(identical(initial$summary$top_species, "Dairy cattle"), "raw species box")
    check(nrow(initial$premises) == 4L && sum(initial$premises$total_animals) == 90, "drawn activity excludes missing coordinates and counts both twins")
    check(identical(initial$boxes$state, "metrics") && length(initial$boxes$metrics) == 4L, "rendered boxes reachable")
    check(identical(initial$strip$state, "summary"), "rendered strip reachable")
    check(identical(vapply(initial$boxes$metrics, function(m) m$value, character(1)), c("100", "4", "4", "Dairy cattle")), "rendered box values")
    check(identical(initial$strip$items[[3]]$text, "90") && grepl("2 importer, 2 exporter", initial$strip$items[[4]]$text, fixed = TRUE), "rendered activity and roles")
    domains <- list(quarter = I(map_state$tq_combos), year = I(map_state$year_combos))
    check(identical(as.character(domains$quarter), c("2025-Q1", "2026-Q2")), "whole-master quarter domain includes unselected Pierce")
    check(identical(as.character(domains$year), c("2025", "2026")), "whole-master year domain")
    frames <- list()
    for (step in c("quarter", "year")) for (i in 1:2) {
      box$msgs <- list()
      session$setInputs(intra_time_enabled = TRUE, intra_time_step = step, intra_time_slider = i)
      session$elapse(300)
      msgs <- Filter(function(m) m$id %in% c("intra_year", "intra_quarter"), box$msgs)
      check(length(msgs) == 2L, paste("Browse messages", step, i))
      # Mock sessions do not apply updateSelectizeInput; replay the module's own
      # selected values, as a client would, before capturing the resulting view.
      for (m in msgs) do.call(session$setInputs, setNames(list(m$msg$value), m$id))
      session$elapse(300)
      selected_year <- input$intra_year
      check(identical(as.character(selected_year), as.character(2024L + i)), paste("Browse year", step, i))
      s <- current_map_summary()
      check(if (i == 1L) !is.null(s) && s$total_animals == 100 else is.null(s), paste("Browse selected-county result", step, i))
      frames[[length(frames) + 1L]] <- list(step = step, index = i, label = output$intra_time_label,
        messages = msgs, summary = s, strip = s2_strip(output$filter_summary_strip))
    }
    box$msgs <- list(); session$setInputs(reset_filters = 1)
    reset <- Filter(function(m) grepl("^intra_|^hide_cvi_circles$", m$id), box$msgs)
    take <- function(id) Filter(function(m) m$id == id, reset)[[1]]$msg$value
    check(length(take("intra_counties")) == 0L, "reset clears counties")
    check(identical(take("intra_filter_dir"), "combined"), "reset direction")
    check(identical(take("intra_mode"), "overlap"), "reset mode")
    check(identical(take("intra_scaling"), "log"), "reset scaling")
    check(!any(vapply(reset, function(m) identical(m$id, "intra_time_enabled"), logical(1))), "CVI reset leaves Browse enabled (approved browser difference)")
    box$result <- list(initial = initial, domains = domains, frames = frames, reset = reset)
    if (facility_probe) {
      old_s2 <- sf::sf_use_s2(FALSE)
      on.exit(sf::sf_use_s2(old_s2), add = TRUE)
      facility_file <- file.path(route_out, "facilities.json")
      facility_inputs <- fromJSON(facility_file, simplifyVector = FALSE)
      check(isTRUE(facility_inputs$synthetic), "synthetic facilities only")
      layers <- setNames(lapply(facility_inputs$layers, function(layer) {
        pts <- do.call(rbind, lapply(layer$points, as.data.frame))
        sf::st_as_sf(pts, coords = c("lon", "lat"), crs = 4326)
      }), vapply(facility_inputs$layers, `[[`, character(1), "key"))
      map_state$overlays <- layers
      session$setInputs(intra_time_enabled = FALSE, intra_counties = "King", intra_species = "Cattle",
        intra_year = c("2025", "2026"), intra_quarter = c("Q1", "Q2", "Q3", "Q4"),
        overlay_layers = names(layers), hide_cvi_circles = FALSE, intra_opacity = "0.8")
      session$elapse(300)
      colors <- c(slaughterhouses = "#382513", fairgrounds = "#522348", markets = "#f07325",
        feedlots = "#0097a7", restricted = "#ca3014")
      facility_snapshot <- function(picks, selected) {
        widget <- fromJSON(output$intrastate_map, simplifyVector = FALSE)
        sources <- widget$x$sources %||% list()
        markers <- widget$x$layers %||% list()
        expected <- list()
        polys <- polygons[polygons$name %in% picks, , drop = FALSE]
        for (key in names(layers)) {
          pts <- layers[[key]]
          keep <- if (nrow(polys)) lengths(sf::st_intersects(pts, polys)) > 0 else rep(FALSE, nrow(pts))
          names_expected <- if (key %in% selected) as.character(pts$ref_name[keep]) else character(0)
          expected[[key]] <- I(names_expected)
          src <- Filter(function(x) identical(x$id, paste0("overlay_src_", key)), sources)
          marker <- Filter(function(x) identical(x$id, paste0("overlay_marker_", key)), markers)
          check(length(src) == as.integer(length(names_expected) > 0), paste(key, "rendered source availability"))
          check(length(marker) == length(src), paste(key, "rendered marker availability"))
          if (length(src)) {
            features <- src[[1]]$data$features
            check(identical(vapply(features, function(f) f$properties$ref_name, character(1)), names_expected), paste(key, "exact independent membership"))
            check(all(vapply(features, function(f) identical(names(f$properties), "ref_name"), logical(1))), paste(key, "minimal payload"))
            paint <- marker[[1]]$paint
            check(identical(paint[["circle-color"]], unname(colors[key])) && paint[["circle-radius"]] == 7 &&
              paint[["circle-opacity"]] == 0.95 && paint[["circle-stroke-width"]] == 2 &&
              identical(paint[["circle-stroke-color"]], "#ffffff"), paste(key, "hand marker style"))
            check(identical(marker[[1]]$tooltip, "ref_name") && identical(marker[[1]]$popup, "ref_name"), paste(key, "name tooltip/popup"))
          }
        }
        list(widget = widget, expected = expected, picks = I(picks), selected = I(selected))
      }
      views <- list()
      for (dir in c("combined", "inbound", "outbound")) for (mode in c("overlap", "side_by_side")) {
        session$setInputs(intra_filter_dir = dir, intra_mode = mode)
        session$elapse(300)
        v <- snapshot()
        expected <- switch(dir, combined = c(100, 90, 4, 4), inbound = c(80, 40, 3, 2), outbound = c(50, 50, 2, 2))
        check(v$summary$total_animals == expected[1], paste(dir, mode, "hand box animals"))
        check(sum(v$premises$total_animals) == expected[2], paste(dir, mode, "hand drawn activity"))
        check(v$summary$n_cvis == expected[3] && v$summary$n_premises == expected[4], paste(dir, mode, "hand certificates/premises"))
        # The module's serialized widget is evidence of the unchanged live renderer,
        # including its internal spatial filter and property stripping. No browser runs.
        v$facilities <- facility_snapshot("King", names(layers))
        for (key in names(layers)) check(identical(v$facilities$expected[[key]], I(paste0(key, ": King inside"))), paste(key, "hand King anchor"))
        expected_lon <- if (dir == "combined" && mode == "side_by_side") ifelse(v$premises$direction == "Inbound", -121.908, -121.892) else rep(-121.9, nrow(v$premises))
        check(all(abs(v$premises$lon - expected_lon) < 1e-9), paste(dir, mode, "hand offsets"))
        views[[paste(dir, mode, sep = "/")]] <- v
      }
      scenarios <- list(
        snohomish = list(picks = "Snohomish", selected = names(layers)),
        union = list(picks = c("King", "Snohomish"), selected = names(layers)),
        empty_counties = list(picks = character(0), selected = names(layers)),
        empty_layers = list(picks = "King", selected = character(0)),
        two_layers_hidden_empty_master_filter = list(picks = "King", selected = c("markets", "feedlots")))
      facility_cases <- list()
      for (sn in names(scenarios)) {
        sc <- scenarios[[sn]]
        session$setInputs(intra_counties = sc$picks, overlay_layers = sc$selected,
          intra_species = if (sn == "two_layers_hidden_empty_master_filter") "No matching species" else "Cattle",
          hide_cvi_circles = sn == "two_layers_hidden_empty_master_filter")
        session$elapse(300)
        case <- facility_snapshot(sc$picks, sc$selected)
        if (sn == "snohomish") for (key in names(layers)) check(identical(case$expected[[key]], I(paste0(key, ": Everett inside Snohomish"))), paste(key, "hand Everett/Whidbey anchor"))
        if (sn == "two_layers_hidden_empty_master_filter") {
          check(is.null(current_map_summary()), "empty master filters while facilities remain")
          check(!any(vapply(case$widget$x$sources, function(x) x$id %in% c("focus_src_in", "focus_src_out"), logical(1))), "hide omits premises sources")
        }
        facility_cases[[sn]] <- case
      }
      box$result$facility_views <- views
      box$result$facility_cases <- facility_cases
      box$result$facility_inputs <- facility_inputs
    }
  })
  check(length(list.files(route_root, recursive = TRUE, all.files = TRUE, no.. = TRUE)) == 0L, "empty root unchanged")
  sha <- function(p) paste(as.character(openssl::sha256(file(p))), collapse = "")
  source_files <- c("R/master_loader.R", "R/map_helpers.R", s2_sources)
  result <- list(meta = list(synthetic = TRUE, cvi_revision = cvi_rev,
    cvi_helpers_dirty = cvi_dirty, cvi_module_sources_dirty = s2_dirty, R_version = R.version.string,
    source_sha256 = setNames(lapply(file.path(cvi_shiny, source_files), sha), source_files),
    fixture_sha256 = sha(fixture), geometry_input_sha256 = sha(geo_file), oracle_sha256 = sha(file.path(repo_root, "tests/oracle/cvi_r_oracle.R")),
    route = "unmodified shiny::testServer module; bundled polygons injected into map_state",
    paths_requested = I(route_paths), checks = checks, full_matrix_run = FALSE,
    facilities_injected = facility_probe, facility_input_sha256 = if (facility_probe) sha(file.path(route_out, "facilities.json")) else NULL, page_run = FALSE), reference = box$result)
  write_json(result, file.path(route_out, "reference.json"), auto_unbox = TRUE, digits = I(17), null = "null", na = "null")
  cat(if (facility_probe) "S5 module facilities: PASS;" else "S5 module route: PASS;", checks, "checks; full premises/subset/facility matrix NOT RUN\n")
}


# Bounded actual tier/module route. CSV normalization here is independent test input
# preparation, not a reference-overlay loader/registry parity claim. No source edits.
if ("s5-module-tiers" %in% parts) {
  tier_out <- file.path(repo_root, "local-test-artifacts", "s5", "module-tiers")
  tier_manifest <- fromJSON(file.path(tier_out, "cases.json"), simplifyVector = FALSE)
  tier_root <- file.path(tier_out, "empty_cvi_root")
  dir.create(tier_root, recursive = TRUE, showWarnings = FALSE)
  if (length(list.files(tier_root, all.files = TRUE, no.. = TRUE))) stop("Tier root must be empty")
  tier_paths <- character(0)
  tier_path <- function(kind) function(...) {
    pieces <- c(...)
    if (any(grepl("(^/|^[A-Za-z]:|(^|[/\\\\])\\.\\.([/\\\\]|$))", pieces))) stop("Unsafe tier path")
    p <- file.path(tier_root, kind, ...); tier_paths <<- union(tier_paths, p); p
  }
  cvi_dir_reference <- tier_path("reference"); cvi_dir_exports <- tier_path("exports")
  cvi_dir_www <- tier_path("www"); cvi_dir_tile_cache <- tier_path("tile_cache")
  sha <- function(p) paste(as.character(openssl::sha256(file(p))), collapse = "")
  geo_file <- file.path(repo_root, "local-test-artifacts", "s5", "membership", "inputs.json")
  geo_input <- fromJSON(geo_file, simplifyVector = FALSE)
  if (!identical(geo_input$geometrySha256, sha(file.path(repo_root, "site", "geo", "wa-counties.js")))) stop("Stale tier geometry")
  polygons <- sf::st_read(toJSON(geo_input$groups[[1]]$counties, auto_unbox = TRUE), quiet = TRUE)
  picks <- sort(as.character(polygons$name))
  old_s2 <- sf::sf_use_s2(FALSE)
  colors <- c(slaughterhouses = "#382513", fairgrounds = "#522348", markets = "#f07325", feedlots = "#0097a7", restricted = "#ca3014")
  mappings <- list(
    full = c(slaughterhouses = "usda_wa_slaughter_facilities.csv", fairgrounds = "wa_state_fairs.csv",
      markets = "wa_state_public_livestock_markets.csv", feedlots = "wa_state_feedlots.csv",
      restricted = "wa_state_restricted_holding_facilities.csv", syn_custommeat = "synthetic_custom_meat_geocoded.csv",
      syn_disposal = "synthetic_animal_disposal.csv"),
    partner = c(markets = "wa_state_public_livestock_markets.csv", feedlots = "feedlots_2025.csv"), public = character(0))
  name_cols <- c(slaughterhouses = "USDA Slaughter Facility", fairgrounds = "Fair Name", markets = "name",
    feedlots = "name", restricted = "NAME", syn_custommeat = "Name", syn_disposal = "FACILITY.NAME")
  checks <- 0L
  check <- function(ok, label) { if (!isTRUE(ok)) stop("S5 module tiers: ", label); checks <<- checks + 1L }
  capture <- function(f) tryCatch(list(status = "ok", value = f()), error = function(e)
    list(status = "error", error = conditionMessage(e), classes = I(class(e))))
  records <- list()
  for (tc in tier_manifest$cases) {
    tier <- tc$tier; folder <- file.path(tier_out, tier)
    for (file in names(tc$files)) check(identical(sha(file.path(folder, file)), tc$files[[file]]), paste(tier, file, "input hash"))
    master_file <- file.path(folder, if (tier == "partner") "partner_county_totals.csv" else "CVI_Consolidated_Master.csv")
    df <- suppressWarnings(load_master_csv(master_file))
    check(!is.null(df) && cvi_master_physical_nrow(df) == 1500L, paste(tier, "actual 1500-row tier loaded"))
    missing <- setdiff(c("Origin.Lat", "Origin.Long", "Dest.Lat", "Dest.Long"), names(df))
    check(length(missing) == if (tier == "full") 0L else 4L, paste(tier, "coordinate capability"))
    layers <- lapply(names(mappings[[tier]]), function(key) {
      raw <- read.csv(file.path(folder, mappings[[tier]][key]), check.names = FALSE, stringsAsFactors = FALSE,
        fileEncoding = "UTF-8-BOM")
      lon_col <- names(raw)[tolower(names(raw)) == "long"]; lat_col <- names(raw)[tolower(names(raw)) == "lat"]
      pts <- data.frame(lon = as.numeric(raw[[lon_col]]), lat = as.numeric(raw[[lat_col]]),
        ref_name = as.character(raw[[name_cols[key]]]), synthetic_private_note = "must be stripped")
      sf::st_as_sf(pts, coords = c("lon", "lat"), crs = 4326)
    })
    names(layers) <- names(mappings[[tier]])
    sess <- MockShinySession$new(); box <- new.env(); box$views <- list()
    testServer(mod_maps_server, args = list(rv = reactiveValues(master_df = NULL), project_root = tier_root,
      scripts_dir = tier_root), session = sess, {
      rv$master_df <- df; session$flushReact()
      map_state$county_polygons <- sf::st_sf(name = polygons$name, geometry = sf::st_geometry(polygons))
      map_state$overlays <- layers
      spp <- sort(unique(df$Species.Group)); spp <- spp[!is.na(spp) & nzchar(spp)]
      years <- sort(unique(df$Reporting.Year)); years <- years[!is.na(years)]
      session$setInputs(show_intrastate = 1, intra_counties = picks, intra_species = spp,
        intra_species_sub = character(0), intra_year = as.character(years), intra_quarter = c("Q1", "Q2", "Q3", "Q4"),
        intra_scaling = "log", intra_n_bins = "5", intra_time_enabled = FALSE, intra_time_step = "quarter",
        intra_time_slider = 1, overlay_layers = names(layers), hide_cvi_circles = FALSE, intra_opacity = "0.8")
      for (dir in c("combined", "inbound", "outbound")) for (mode in c("overlap", "side_by_side")) {
        session$setInputs(intra_filter_dir = dir, intra_mode = mode); session$elapse(300)
        direct <- capture(function() build_county_focus_data(df, picks, spp, years, c("Q1", "Q2", "Q3", "Q4"),
          direction = dir, mode = mode, scaling = "log", n_bins = 5, raw_species_filter = character(0)))
        # Keep the source error and module result independently; never replace the module builder.
        if (tier == "full") check(direct$status == "ok" && nrow(direct$value) > 0, paste(tier, dir, mode, "direct builder"))
        else check(direct$status == "error" && "cvi_missing_premise_coords" %in% direct$classes &&
          all(vapply(missing, function(c) grepl(c, direct$error, fixed = TRUE), logical(1))), paste(tier, dir, mode, "direct missing-coordinate error"))
        premises <- capture(function() { d <- intrastate_line_data(); if (is.null(d)) NULL else sf::st_drop_geometry(d) })
        summary <- capture(function() current_map_summary())
        boxes <- capture(function() s2_value_boxes(output$value_boxes))
        strip <- capture(function() s2_strip(output$filter_summary_strip))
        widget <- capture(function() fromJSON(output$intrastate_map, simplifyVector = FALSE))
        check(premises$status == "ok", paste(tier, dir, mode, "module handles coordinate capability"))
        check(if (tier == "full") nrow(premises$value) > 0 else is.null(premises$value), paste(tier, dir, mode, "module premise availability"))
        check(widget$status == "ok", paste(tier, dir, mode, "unchanged renderer reachable"))
        expected <- list(); injected <- list()
        for (key in names(layers)) {
          pts <- layers[[key]]; inside <- lengths(sf::st_intersects(pts, polygons)) > 0
          injected[[key]] <- sf::st_drop_geometry(pts)
          injected[[key]]$lon <- sf::st_coordinates(pts)[,1]; injected[[key]]$lat <- sf::st_coordinates(pts)[,2]
          exp_names <- if (key %in% names(colors)) as.character(pts$ref_name[inside]) else character(0)
          expected[[key]] <- I(exp_names)
          src <- Filter(function(x) identical(x$id, paste0("overlay_src_", key)), widget$value$x$sources %||% list())
          check(length(src) == as.integer(length(exp_names) > 0), paste(tier, dir, mode, key, "source availability (extras unsupported by CVI Focus)"))
          if (length(src)) {
            check(identical(vapply(src[[1]]$data$features, function(f) f$properties$ref_name, character(1)), exp_names), paste(tier, dir, mode, key, "independent spatial membership"))
            check(all(vapply(src[[1]]$data$features, function(f) identical(names(f$properties), "ref_name"), logical(1))), paste(tier, dir, mode, key, "minimal payload"))
            marker <- Filter(function(x) identical(x$id, paste0("overlay_marker_", key)), widget$value$x$layers)
            check(length(marker) == 1L && marker[[1]]$paint[["circle-radius"]] == 7 &&
              identical(marker[[1]]$paint[["circle-color"]], unname(colors[key])), paste(tier, dir, mode, key, "fixed style"))
          }
        }
        sources <- widget$value$x$sources %||% list()
        for (role in c("in", "out")) {
          src <- Filter(function(x) identical(x$id, paste0("focus_src_", role)), sources)
          rows <- if (is.null(premises$value)) 0L else sum(premises$value$direction == if (role == "in") "Inbound" else "Outbound")
          check(length(src) == as.integer(rows > 0), paste(tier, dir, mode, role, "premise source availability"))
          if (length(src)) check(length(src[[1]]$data$features) == rows, paste(tier, dir, mode, role, "rendered premise count"))
        }
        box$views[[paste(dir, mode, sep = "/")]] <- list(direction = dir, mode = mode,
          filters = list(counties = I(picks), species = I(spp), years = I(years), quarters = I(c("Q1", "Q2", "Q3", "Q4"))),
          direct = if (direct$status == "ok") list(status = "ok", rows = nrow(direct$value)) else direct,
          premises = premises, summary = summary, boxes = boxes, strip = strip,
          facilities = list(expected = expected, injected = injected, widget = widget$value))
      }
      box$domains <- list(quarter = I(map_state$tq_combos), year = I(map_state$year_combos))
    })
    records[[tier]] <- list(header = I(names(df)), physical_rows = cvi_master_physical_nrow(df), map_rows = nrow(df),
      missing_coordinates = I(missing), facility_files = as.list(mappings[[tier]]), domains = box$domains, views = box$views)
  }
  sf::sf_use_s2(old_s2)
  check(length(list.files(tier_root, recursive = TRUE, all.files = TRUE, no.. = TRUE)) == 0L, "empty root unchanged")
  source_files <- c("R/master_loader.R", "R/map_helpers.R", s2_sources)
  write_json(list(meta = list(synthetic = TRUE, full_matrix_run = FALSE, page_run = FALSE, checks = checks,
    route = "unmodified shiny::testServer; actual tiers; independent CSV coordinate/name normalization then sf injection",
    cvi_revision = cvi_rev, R_version = R.version.string, paths_requested = I(tier_paths),
    source_sha256 = setNames(lapply(file.path(cvi_shiny, source_files), sha), source_files),
    oracle_sha256 = sha(file.path(repo_root, "tests/oracle/cvi_r_oracle.R")), geometry_input_sha256 = sha(geo_file),
    manifest_sha256 = sha(file.path(tier_out, "cases.json"))), tiers = records),
    file.path(tier_out, "reference.json"), auto_unbox = TRUE, digits = I(17), null = "null", na = "null")
  cat("S5 module tiers: PASS;", checks, "checks; 18 module views; full S5 reference NOT COMPLETE\n")
}

# Explicit bounded premises/subset reference. Calls the unmodified CVI builder; independent R
# preprocessing implements only approved missing-City, valid-coordinate and relevant-end WA differences.
if (any(c("s5-premises", "s5-payloads") %in% parts)) {
  payloads <- "s5-payloads" %in% parts
  po <- file.path(repo_root, "local-test-artifacts", "s5", if (payloads) "payloads" else "premises")
  manifest <- fromJSON(file.path(po, "cases.json"), simplifyVector = FALSE)
  hash <- function(p) paste(as.character(openssl::sha256(file(p))), collapse = "")
  records <- list()
  coords <- c("Origin.Lat", "Origin.Long", "Dest.Lat", "Dest.Long")
  scenes <- list(
    all = list(counties = c("King", "Pierce")), king = list(counties = "King"),
    pierce = list(counties = "Pierce"), empty = list(counties = character(0)),
    absent = list(counties = "Absent"), cattle = list(counties = c("King", "Pierce"), species = "Cattle"),
    refine = list(counties = c("King", "Pierce"), species = "Cattle", rawSpecies = "Dairy cattle"),
    period = list(counties = c("King", "Pierce"), years = 2026L, quarters = "Q2"))
  builder <- function(d, o) build_county_focus_data(d, o$counties, o$species, o$years, o$quarters,
    direction = o$direction, mode = o$mode, scaling = o$scaling, n_bins = o$nBins, raw_species_filter = o$rawSpecies)
  for (case in manifest$cases) {
    fp <- file.path(po, case$file); if (!identical(hash(fp), case$sha256)) stop("S5 premises fixture stale")
    original <- suppressWarnings(load_master_csv(fp)); if (is.null(original)) stop("S5 premises load failed")
    d <- original; d$.index <- seq_len(nrow(d)) - 1L
    miss <- setdiff(coords, names(d))
    choices <- sort(unique(c(d$Origin.County[d$Origin.State %in% "WA"], d$Dest.County[d$Dest.State %in% "WA"])))
    choices <- choices[!is.na(choices) & nzchar(trimws(choices))]
    # The source builder expects City even though it is optional in the approved browser.
    for (col in c("Origin.City", "Dest.City")) if (!col %in% names(d)) d[[col]] <- NA_character_
    for (col in intersect(coords, names(d))) d[[col]] <- suppressWarnings(as.numeric(d[[col]]))
    o0 <- list(counties = c("King", "Pierce"), species = c("Cattle", "Poultry"), years = c(2025L, 2026L),
      quarters = c("Q1", "Q2", "Q3", "Q4"), rawSpecies = character(0), direction = "combined", mode = "overlap", scaling = "log", nBins = 5L)
    direct <- tryCatch({ x <- suppressWarnings(builder(original, o0)); list(error = NULL, n = if (is.null(x)) 0L else nrow(x)) },
      error = function(e) list(error = conditionMessage(e), class = class(e)[1]))
    views <- list()
    add_view <- function(o, scene) {
      selected <- d[FALSE, , drop = FALSE]; valid <- selected; omitted <- 0L
      if (!length(miss) && length(o$counties)) {
        idx <- d$Species.Group %in% o$species & d$Reporting.Year %in% o$years & d$Reporting.Quarter %in% o$quarters
        if ("Species" %in% names(d) && length(o$rawSpecies)) idx <- idx & d$Species %in% o$rawSpecies
        role <- (d$Movement %in% "Inbound" & d$Dest.County %in% o$counties & d$Dest.State %in% "WA" & o$direction %in% c("combined", "inbound")) |
          (d$Movement %in% "Outbound" & d$Origin.County %in% o$counties & d$Origin.State %in% "WA" & o$direction %in% c("combined", "outbound"))
        selected <- d[idx & role, , drop = FALSE]
        lon <- ifelse(selected$Movement %in% "Inbound", selected$Dest.Long, selected$Origin.Long)
        lat <- ifelse(selected$Movement %in% "Inbound", selected$Dest.Lat, selected$Origin.Lat)
        good <- is.finite(lon) & is.finite(lat) & abs(lon) <= 180 & abs(lat) <= 90
        omitted <- sum(!good); valid <- selected[good, , drop = FALSE]
      }
      members <- list()
      for (dir in c("Inbound", "Outbound")) {
        sub <- valid[valid$Movement %in% dir, , drop = FALSE]; end <- if (dir == "Inbound") "dest" else "origin"
        eid_col <- paste0("farm_entity_id_", end)
        eid <- if (eid_col %in% names(sub)) trimws(as.character(sub[[eid_col]])) else rep(NA_character_, nrow(sub))
        prefix <- if (dir == "Inbound") "Dest" else "Origin"
        keys <- ifelse(!is.na(eid) & nzchar(eid), paste0("e:", eid), paste0("c:", sub[[paste0(prefix, ".Long")]], ",", sub[[paste0(prefix, ".Lat")]]))
        for (key in sort(unique(keys))) members[[length(members) + 1L]] <- list(direction = dir, group_key = key, row_indices = unname(sub$.index[keys == key]))
      }
      builder_error <- NULL
      res <- if (length(miss)) NULL else tryCatch(suppressWarnings(builder(valid, o)), error = function(e) {
        builder_error <<- conditionMessage(e); NULL
      })
      route <- if (length(miss)) "missing-coordinate capability; builder not called" else "unmodified builder"
      if (!is.null(builder_error)) {
        # CVI's combined path invokes popup summarise on an empty direction and errors.
        # Use its unchanged single-direction builder for the nonempty branch; no extracted builder.
        if (!nrow(valid) || length(unique(valid$Movement)) != 1L || o$direction != "combined") stop(builder_error)
        one <- o; one$direction <- if (valid$Movement[1] == "Inbound") "inbound" else "outbound"
        res <- suppressWarnings(builder(valid, one)); route <- "unmodified single-direction builder; independent combined offset"
        if (o$mode == "side_by_side") res$lon <- res$lon + ifelse(res$direction == "Inbound", -0.008, 0.008)
      }
      rows <- if (is.null(res)) list() else lapply(seq_len(nrow(res)), function(i) {
        fields <- c("direction", "lon", "lat", "total_animals", "n_shipments", "n_cvis", "city", "state", "county", "premises_id", "radius_px", "color")
        z <- lapply(fields, function(k) res[[k]][i]); names(z) <- fields
        if (payloads) {
          # Direct unchanged helpers on independently grouped loader rows, beside builder output.
          candidates <- lapply(members, function(m) {
            sub <- valid[valid$.index %in% m$row_indices, , drop = FALSE]
            prefix <- if (m$direction == "Inbound") "Dest" else "Origin"
            list(member = m, city = sub[[paste0(prefix, ".City")]][1], total = sum(sub$Total.Animals, na.rm = TRUE))
          })
          ord <- order(vapply(candidates, function(x) x$city, character(1)),
            vapply(candidates, function(x) x$member$direction, character(1)),
            -vapply(candidates, function(x) x$total, numeric(1)), na.last = TRUE)
          m <- candidates[[ord[i]]]$member
          sub <- valid[match(m$row_indices, valid$.index), , drop = FALSE]
          z$popup_html <- res$popup_html[i]; z$tooltip_text <- res$tooltip_text[i]; z$species_json <- res$species_json[i]
          z$helperPopup <- .mk_focus_popup(if ("CVI" %in% names(sub)) sub$CVI else NULL,
            sub$Origin.City, sub$Origin.State, sub$Dest.City, sub$Dest.State, sub$Species.Group)
          labels <- if (length(o$species) == 1L && "Species" %in% names(sub)) sub$Species else sub$Species.Group
          z$helperSpecies <- unname(.species_json_by_group(rep("g", nrow(sub)), labels, sub$Total.Animals)[1])
          # Safe independent JSON encoding preserves CVI's quote substitution and round-half-even totals.
          ok <- !is.na(labels) & nzchar(trimws(labels))
          dt <- data.table::data.table(s = trimws(labels[ok]), a = sub$Total.Animals[ok])
          if (nrow(dt)) {
            dt <- dt[, list(a = sum(a, na.rm = TRUE)), by = s]; data.table::setorder(dt, -a)
            z$safeSpecies <- paste0("{", paste(vapply(seq_len(nrow(dt)), function(j)
              paste0(toJSON(gsub('"', "'", dt$s[j], fixed = TRUE), auto_unbox = TRUE), ":", toJSON(round(dt$a[j]), auto_unbox = TRUE)), ""), collapse = ","), "}")
          } else z$safeSpecies <- "{}"
          # Escape only file text in the hover; retain CVI's structural HTML and vector formatting.
          esc <- function(x) gsub(">", "&gt;", gsub("<", "&lt;", gsub("&", "&amp;", x, fixed = TRUE), fixed = TRUE), fixed = TRUE)
          z$safeTooltip <- res$tooltip_text[i]
          for (value in unique(c(sub$CVI, res$city[i], res$state[i], res$county[i])))
            if (!is.na(value) && nzchar(value) && grepl("[<>&]", value)) z$safeTooltip <- gsub(value, esc(value), z$safeTooltip, fixed = TRUE)
          if (!identical(z$helperPopup, z$popup_html) || !identical(z$helperSpecies, z$species_json)) stop("S5 payload helper/builder disagreement")
        }
        z$merged_premises <- grepl("Multiple premises share this geocode", res$tooltip_text[i], fixed = TRUE)
        z
      })
      views[[length(views) + 1L]] <<- list(scene = scene, opts = o, missingCoordinates = miss,
        selectedRowIndices = unname(selected$.index), omittedRows = omitted, builderError = builder_error, route = route, members = members, rows = rows)
    }
    for (sn in names(scenes)) for (dir in c("combined", "inbound", "outbound")) for (md in c("overlap", "side_by_side")) {
      o <- modifyList(o0, scenes[[sn]], keep.null = TRUE); o$direction <- dir; o$mode <- md
      add_view(o, sn)
    }
    # All scalings/bin choices on this small full-column fixture; full module/tier matrix deferred.
    if (case$name == "full") for (dir in c("combined", "inbound", "outbound")) for (md in c("overlap", "side_by_side"))
      for (sc in c("sqrt", "linear", "quantile", "natural")) for (nb in if (sc %in% c("quantile", "natural")) BINS else 5L) {
        o <- o0; o$direction <- dir; o$mode <- md; o$scaling <- sc; o$nBins <- nb; add_view(o, "sizing")
      }
    records[[length(records) + 1L]] <- list(name = case$name, file = case$file, sha256 = hash(fp),
      physicalRows = cvi_master_physical_nrow(original), mapRows = nrow(original), countyChoices = choices,
      directBuilder = direct, views = views)
    cat(if (payloads) "S5 payload reference:" else "S5 premises reference:", case$name, length(views), "views\n")
  }
  probes <- list()
  if (payloads) {
    inputs <- fromJSON(file.path(po, "helper_inputs.json"), simplifyVector = FALSE)
    for (probe in inputs) {
      get <- function(k, is_numeric = FALSE) vapply(probe$rows, function(r) r[[k]] %||% if (is_numeric) NA_real_ else NA_character_, if (is_numeric) numeric(1) else character(1))
      labels <- get("Species"); animals <- get("Total.Animals", TRUE)
      ok <- !is.na(labels) & nzchar(trimws(labels))
      dt <- data.table::data.table(s = trimws(labels[ok]), a = animals[ok])
      if (nrow(dt)) {
        dt <- dt[, list(a = sum(a, na.rm = TRUE)), by = s]; data.table::setorder(dt, -a)
        sj <- paste0("{", paste(vapply(seq_len(nrow(dt)), function(j)
          paste0(toJSON(gsub('"', "'", dt$s[j], fixed = TRUE), auto_unbox = TRUE), ":", toJSON(round(dt$a[j]), auto_unbox = TRUE)), ""), collapse = ","), "}")
      } else sj <- "{}"
      probes[[length(probes) + 1L]] <- list(name = probe$name,
        popup = .mk_focus_popup(get("CVI"), get("Origin.City"), get("Origin.State"), get("Dest.City"), get("Dest.State"), get("Species.Group")),
        noCviPopup = .mk_focus_popup(NULL, get("Origin.City"), get("Origin.State"), get("Dest.City"), get("Dest.State"), get("Species.Group")),
        species = unname(.species_json_by_group(rep("g", length(labels)), labels, animals)[1]), safeSpecies = sj)
    }
  }
  sources <- c("shiny/R/master_loader.R", "shiny/R/map_helpers.R")
  refs <- setNames(lapply(sources, function(f) hash(file.path(cvi_dir, f))), sources)
  reference <- list(meta = list(stage = if (payloads) "bounded popup/species payloads" else "bounded pure premises/subsets", r = R.version.string, cviRevision = cvi_rev,
    oracleSha256 = hash(file.path(repo_root, "tests/oracle/cvi_r_oracle.R")), manifestSha256 = hash(file.path(po, "cases.json")),
    cviSources = refs, differences = c("missing City supplied as NA", "numeric finite in-range premises coordinates only", "relevant-end state exactly WA",
      if (payloads) c("file text escaped in hover", "JSON control characters/backslashes encoded; CVI quote substitution retained"))), cases = records, probes = probes)
  if (payloads) {
    reference$meta$helperInputsSha256 <- hash(file.path(po, "helper_inputs.json"))
    reference$meta$loaderQuoteProbeSha256 <- hash(file.path(po, "loader_quote_probe.csv"))
    # CVI's popup order(d$cvi) and hover sort(unique(CVI)) follow the session's collation.
    # Outside that format the orders differ: ICU puts punctuation such as "<" before digits (recorded, not hidden).
    probe <- c("24-WA-21348232", "<x>", "SYN-A", "2024-WA-1")
    reference$meta$collation <- list(locale = Sys.getlocale("LC_COLLATE"), icu = unname(capabilities("ICU")),
      symbolProbe = probe, symbolProbeOrder = probe[order(probe)], symbolProbeRadix = sort(probe, method = "radix"))
    quote_probe <- load_master_csv(file.path(po, "loader_quote_probe.csv"))
    reference$loaderQuoteProbe <- list(cvi = quote_probe$CVI[1], species = quote_probe$Species[1])
  }
  write_json(reference, file.path(po, "reference.json"), auto_unbox = TRUE, digits = I(17), null = "null", na = "null")
  cat(if (payloads) "S5 payloads R: PASS;" else "S5 premises R: PASS;", sum(vapply(records, function(x) length(x$views), integer(1))), "views; full module/facility matrix NOT RUN\n")
}

# ---- S5 facility layers: CVI's unchanged load_overlay_csv, .build_overlay_registry and .overlay_groups on
# each synthetic reference folder of `node tests/synthetic/make_cvi_focus_fixtures.js --facilities`. Only that folder
# is read (cvi_dir_reference pointed into it, every path asked for recorded); the active registry is restored after.
if ("s5-facilities" %in% parts) {
  fac_out <- file.path(repo_root, "local-test-artifacts", "s5", "facilities")
  fac_meta <- fromJSON(file.path(fac_out, "cases.json"), simplifyVector = FALSE)
  if (!isTRUE(fac_meta$synthetic)) stop("S5 facilities: synthetic fixture only")
  sha <- function(p) paste(as.character(openssl::sha256(file(p))), collapse = "")
  fac_paths <- character(0)
  saved_registry <- .OVERLAY_REGISTRY
  result <- list()
  for (case in names(fac_meta$cases)) {
    case_dir <- file.path(fac_out, case)
    for (f in fac_meta$cases[[case]]$files) if (!identical(sha(file.path(case_dir, f$file)), f$sha256)) stop("S5 facilities: stale ", case, "/", f$file)
    cvi_dir_reference <- function(...) {
      pieces <- c(...)
      if (any(grepl("(^/|^[A-Za-z]:|(^|[/\\\\])\\.\\.([/\\\\]|$))", pieces))) stop("Unsafe facility path")
      p <- file.path(case_dir, ...); fac_paths <<- union(fac_paths, p); p
    }
    reg <- .build_overlay_registry()
    assign(".OVERLAY_REGISTRY", reg, envir = .MAP_HELPERS_ENV)
    grps <- .overlay_groups()
    layers <- lapply(names(reg), function(k) {
      s <- reg[[k]]
      sf_layer <- load_overlay_csv(s$file, s$name_col)
      pts <- if (is.null(sf_layer)) NULL else list(
        name = as.character(sf_layer$ref_name), lat = sf_layer$ref_lat, lon = sf_layer$ref_long)
      list(key = k, file = s$file, name_col = s$name_col, color = s$color, label = s$label, live_label = s$live_label,
        group = s$group, points = pts)
    })
    result[[case]] <- list(layers = layers, groups = lapply(names(grps), function(g) list(group = g, keys = I(grps[[g]]))),
      manifest_status = cvi_overlay_manifest_status())
  }
  assign(".OVERLAY_REGISTRY", saved_registry, envir = .MAP_HELPERS_ENV)
  if (!all(startsWith(fac_paths, fac_out))) stop("S5 facilities: a path outside the fixture was asked for")
  ref <- list(meta = list(synthetic = TRUE, cvi_rev = cvi_rev, cvi_dirty = cvi_dirty, cases_sha256 = sha(file.path(fac_out, "cases.json")),
    oracle_sha256 = sha(file.path(repo_root, "tests", "oracle", "cvi_r_oracle.R")),
    source_sha256 = list(`R/map_helpers.R` = sha(file.path(cvi_r, "map_helpers.R"))), paths_requested = I(sort(fac_paths))),
    reference = result)
  writeLines(toJSON(ref, auto_unbox = TRUE, null = "null", na = "null", digits = NA, pretty = TRUE), file.path(fac_out, "reference.json"))
  cat("S5 facilities R: PASS;", length(result), "reference folders;", sum(vapply(result, function(r) length(r$layers), integer(1))), "layers\n")
}

# Full module ledger, in bounded tier calls. Every result comes from the unchanged module.
# Original fixture outcomes remain beside the approved-input companion, including source failures.
# Usage: S5_MATRIX_TIER=fixture|full|partner|public Rscript tests/oracle/cvi_r_oracle.R s5-module-matrix
if ("s5-module-matrix" %in% parts) {
  mx_out <- file.path(repo_root, "local-test-artifacts", "s5", "module-matrix")
  mx_root <- file.path(mx_out, "empty_cvi_root")
  dir.create(mx_root, recursive = TRUE, showWarnings = FALSE)
  if (length(list.files(mx_root, all.files = TRUE, no.. = TRUE))) stop("Matrix root must be empty")
  mx_paths <- character(0)
  mx_path <- function(kind) function(...) {
    pieces <- c(...)
    if (any(grepl("(^/|^[A-Za-z]:|(^|[/\\\\])\\.\\.([/\\\\]|$))", pieces))) stop("Unsafe matrix path")
    p <- file.path(mx_root, kind, ...); mx_paths <<- union(mx_paths, p); p
  }
  cvi_dir_reference <- mx_path("reference"); cvi_dir_exports <- mx_path("exports")
  cvi_dir_www <- mx_path("www"); cvi_dir_tile_cache <- mx_path("tile_cache")
  sha <- function(p) paste(as.character(openssl::sha256(file(p))), collapse = "")
  geo_file <- file.path(repo_root, "local-test-artifacts", "s5", "membership", "inputs.json")
  geo <- fromJSON(geo_file, simplifyVector = FALSE)
  if (!identical(geo$geometrySha256, sha(file.path(repo_root, "site", "geo", "wa-counties.js")))) stop("Stale matrix geometry")
  polygons <- sf::st_read(toJSON(geo$groups[[1]]$counties, auto_unbox = TRUE), quiet = TRUE)
  tier <- Sys.getenv("S5_MATRIX_TIER", "fixture")
  if (!tier %in% c("fixture", "full", "partner", "public")) stop("Unknown matrix tier")
  input_file <- if (tier == "fixture") file.path(repo_root, "local-test-artifacts/s5/premises/full.csv") else
    file.path(repo_root, "local-test-artifacts/s5/module-tiers", tier,
      if (tier == "partner") "partner_county_totals.csv" else "CVI_Consolidated_Master.csv")
  original <- suppressWarnings(load_master_csv(input_file))
  if (is.null(original)) stop("Matrix fixture failed to load")
  d <- original
  coords <- c("Origin.Lat", "Origin.Long", "Dest.Lat", "Dest.Long")
  # Only the existing deliberate input differences; do not drop rows or master periods.
  for (col in c("Origin.City", "Dest.City")) if (!col %in% names(d)) d[[col]] <- NA_character_
  for (col in intersect(coords, names(d))) {
    x <- suppressWarnings(as.numeric(d[[col]]))
    x[!is.finite(x) | abs(x) > if (grepl("Lat$", col)) 90 else 180] <- NA_real_
    d[[col]] <- x
  }
  for (end in c("Origin", "Dest")) {
    bad <- !d[[paste0(end, ".State")]] %in% "WA"
    d[[paste0(end, ".County")]][bad] <- NA_character_
  }
  counties <- sort(unique(c(original$Origin.County[original$Origin.State %in% "WA"],
    original$Dest.County[original$Dest.State %in% "WA"])))
  counties <- counties[!is.na(counties) & nzchar(counties)]
  species <- sort(unique(original$Species.Group)); species <- species[!is.na(species) & nzchar(species)]
  years <- sort(unique(original$Reporting.Year)); years <- years[!is.na(years)]
  quarters <- c("Q1", "Q2", "Q3", "Q4")
  base <- list(counties = counties, species = species, years = years, quarters = quarters,
    rawSpecies = character(0), direction = "combined", mode = "overlap", scaling = "log", nBins = 5L)
  one_group <- if ("Cattle" %in% species) "Cattle" else species[1]
  raw <- if ("Species" %in% names(original)) sort(unique(original$Species[original$Species.Group %in% one_group])) else character(0)
  raw <- raw[!is.na(raw) & nzchar(raw)]
  scenes <- list(single_county = list(counties = counties[1]), multiple_counties = list(counties = head(counties, 2)),
    group = list(species = one_group), raw_refine = list(species = one_group, rawSpecies = head(raw, 1)),
    empty_counties = list(counties = character(0)), empty_species = list(species = character(0)),
    empty_years = list(years = integer(0)), empty_quarters = list(quarters = character(0)),
    first_period = list(years = years[1], quarters = "Q1"), last_period = list(years = tail(years, 1), quarters = "Q4"))
  # A nonempty, offered set of picks producing no rows, separate from empty picks.
  empty <- NULL
  for (county in counties) for (sp in species) for (yr in years) for (qt in quarters) {
    if (!is.null(empty)) next
    keep <- d$Species.Group %in% sp & d$Reporting.Year %in% yr & d$Reporting.Quarter %in% qt &
      ((d$Movement %in% "Inbound" & d$Dest.County %in% county) |
       (d$Movement %in% "Outbound" & d$Origin.County %in% county))
    if (!any(keep)) empty <- list(counties = county, species = sp, years = yr, quarters = qt)
  }
  if (is.null(empty)) stop("Need an independently enumerated offered empty-result case")
  scenes$empty_result <- empty
  cases <- list()
  add <- function(o, scene) { cases[[length(cases) + 1L]] <<- list(id = paste(tier, scene, o$direction, o$mode,
    o$scaling, o$nBins, sep = "/"), scene = scene, opts = o) }
  for (direction in c("combined", "inbound", "outbound")) for (mode in c("overlap", "side_by_side")) {
    o <- base; o$direction <- direction; o$mode <- mode
    if (tier %in% c("fixture", "full")) for (scaling in SCALINGS) for (nb in BINS) {
      z <- o; z$scaling <- scaling; z$nBins <- nb; add(z, "scaling_bins")
    } else add(o, "baseline")
    for (scene in names(scenes)) add(modifyList(o, scenes[[scene]], keep.null = TRUE), scene)
  }
  capture <- function(f) tryCatch(list(status = "ok", value = f()), error = function(e)
    list(status = "source_failure", error = conditionMessage(e), classes = I(class(e))))
  result <- list(); routes <- if (tier == "fixture") c("original", "approved_input") else "approved_input"
  for (route in routes) {
    df <- if (route == "original") original else d
    sess <- MockShinySession$new(); box <- new.env(); box$msgs <- list(); box$views <- list(); box$frames <- list(); box$resets <- list()
    unlockBinding("sendInputMessage", sess)
    sess$sendInputMessage <- function(inputId, message) box$msgs[[length(box$msgs) + 1L]] <- list(id = inputId, msg = message)
    lockBinding("sendInputMessage", sess)
    testServer(mod_maps_server, args = list(rv = reactiveValues(master_df = NULL),
      project_root = mx_root, scripts_dir = mx_root), session = sess, {
      rv$master_df <- df; session$flushReact()
      map_state$county_polygons <- sf::st_sf(name = polygons$name, geometry = sf::st_geometry(polygons))
      session$setInputs(show_intrastate = 1, intra_time_enabled = FALSE, intra_time_step = "quarter",
        intra_time_slider = 1, hide_cvi_circles = FALSE)
      set_opts <- function(o) {
        session$setInputs(intra_counties = o$counties, intra_species = o$species, intra_species_sub = o$rawSpecies,
          intra_year = as.character(o$years), intra_quarter = o$quarters, intra_filter_dir = o$direction,
          intra_mode = o$mode, intra_scaling = o$scaling, intra_n_bins = as.character(o$nBins))
        session$elapse(300)
      }
      snapshot <- function(o) {
        # Independent row provenance beside the module, never inferred from product output.
        selected <- integer(0); valid <- integer(0); members <- list()
        if (all(coords %in% names(df))) {
          role <- (df$Movement %in% "Inbound" & df$Dest.County %in% o$counties & df$Dest.State %in% "WA" &
            o$direction %in% c("combined", "inbound")) |
            (df$Movement %in% "Outbound" & df$Origin.County %in% o$counties & df$Origin.State %in% "WA" &
            o$direction %in% c("combined", "outbound"))
          keep <- role & df$Species.Group %in% o$species & df$Reporting.Year %in% o$years & df$Reporting.Quarter %in% o$quarters
          if ("Species" %in% names(df) && length(o$rawSpecies)) keep <- keep & df$Species %in% o$rawSpecies
          selected <- which(keep)
          lon <- suppressWarnings(as.numeric(ifelse(df$Movement[selected] %in% "Inbound", df$Dest.Long[selected], df$Origin.Long[selected])))
          lat <- suppressWarnings(as.numeric(ifelse(df$Movement[selected] %in% "Inbound", df$Dest.Lat[selected], df$Origin.Lat[selected])))
          valid <- selected[is.finite(lon) & is.finite(lat) & abs(lon) <= 180 & abs(lat) <= 90]
          for (dir in c("Inbound", "Outbound")) {
            idx <- valid[df$Movement[valid] %in% dir]; end <- if (dir == "Inbound") "Dest" else "Origin"
            idcol <- if (dir == "Inbound") "farm_entity_id_dest" else "farm_entity_id_origin"
            eid <- if (idcol %in% names(df)) trimws(as.character(df[[idcol]][idx])) else rep(NA_character_, length(idx))
            keys <- ifelse(!is.na(eid) & nzchar(eid), paste0("e:", eid), paste0("c:",
              as.numeric(df[[paste0(end, ".Long")]][idx]), ",", as.numeric(df[[paste0(end, ".Lat")]][idx])))
            for (key in sort(unique(keys))) members[[length(members) + 1L]] <- list(direction = dir,
              group_key = key, row_indices = I(idx[keys == key] - 1L))
          }
        }
        x <- list(premises = capture(function() { p <- intrastate_line_data(); if (is.null(p)) NULL else sf::st_drop_geometry(p) }),
          summary = capture(function() current_map_summary()), boxes = capture(function() s2_value_boxes(output$value_boxes)),
          strip = capture(function() s2_strip(output$filter_summary_strip)),
          selection = list(row_indices = I(selected - 1L), omitted_rows = length(selected) - length(valid), members = members))
        # Retain failed Combined output and its own boxes. Reach the unchanged module's
        # nonempty direction only for drawing evidence; independent +/-0.008 offset is compared later.
        dirs <- unique(vapply(members, `[[`, character(1), "direction"))
        if (route == "approved_input" && o$direction == "combined" && length(dirs) == 1L &&
          x$premises$status == "source_failure" && grepl("popup_html", x$premises$error, fixed = TRUE) &&
          grepl("data.frame", x$premises$error, fixed = TRUE)) {
          one <- if (dirs == "Inbound") "inbound" else "outbound"
          session$setInputs(intra_filter_dir = one); session$elapse(300)
          x$approved_direction_companion <- list(direction = one,
            premises = capture(function() sf::st_drop_geometry(intrastate_line_data())),
            strip = capture(function() s2_strip(output$filter_summary_strip)))
          session$setInputs(intra_filter_dir = "combined"); session$elapse(300)
          if (x$approved_direction_companion$premises$status != "ok") stop("Direction companion failed")
        }
        x
      }
      for (case in cases) {
        set_opts(case$opts)
        box$views[[length(box$views) + 1L]] <- c(case, snapshot(case$opts))
      }
      domains <- list(quarter = I(map_state$tq_combos), year = I(map_state$year_combos))
      for (direction in c("combined", "inbound", "outbound")) for (mode in c("overlap", "side_by_side")) {
        o <- base; o$direction <- direction; o$mode <- mode
        session$setInputs(intra_time_enabled = FALSE); set_opts(o)
        for (step in c("quarter", "year")) for (i in seq_along(domains[[step]])) {
          box$msgs <- list()
          session$setInputs(intra_time_enabled = TRUE, intra_time_step = step, intra_time_slider = i)
          session$elapse(300)
          msgs <- Filter(function(m) m$id %in% c("intra_year", "intra_quarter"), box$msgs)
          if (length(msgs) != 2L) stop("Matrix Browse messages missing: ", tier, "/", step, "/", i)
          for (m in msgs) do.call(session$setInputs, setNames(list(m$msg$value), m$id))
          session$elapse(300)
          fr_opts <- o; fr_opts$years <- as.integer(input$intra_year); fr_opts$quarters <- input$intra_quarter
          box$frames[[length(box$frames) + 1L]] <- c(list(id = paste(tier, "browse", direction, mode, step, i, sep = "/"),
            opts = fr_opts, step = step, index = i, label = output$intra_time_label, messages = msgs), snapshot(fr_opts))
        }
        box$msgs <- list(); session$setInputs(reset_filters = length(box$resets) + 1L)
        box$resets[[length(box$resets) + 1L]] <- list(direction = direction, mode = mode,
          messages = Filter(function(m) grepl("^intra_|^hide_cvi_circles$", m$id), box$msgs))
        session$setInputs(intra_time_enabled = FALSE)
      }
      box$domains <- domains
    })
    result[[route]] <- list(views = box$views, frames = box$frames, resets = box$resets, domains = box$domains)
    cat("S5 module matrix:", tier, route, length(box$views), "views,", length(box$frames), "Browse frames,", length(box$resets), "resets captured\n")
  }
  if (length(list.files(mx_root, recursive = TRUE, all.files = TRUE, no.. = TRUE))) stop("Matrix synthetic root changed")
  source_files <- c("R/master_loader.R", "R/map_helpers.R", s2_sources)
  ref <- list(meta = list(synthetic = TRUE, tier = tier, comparison_run = FALSE,
    route = "unchanged shiny::testServer module; source failures retained; approved input companion separately recorded",
    input_file = substring(input_file, nchar(repo_root) + 2L), input_sha256 = sha(input_file),
    oracle_sha256 = sha(file.path(repo_root, "tests/oracle/cvi_r_oracle.R")), geometry_input_sha256 = sha(geo_file),
    source_sha256 = setNames(lapply(file.path(cvi_shiny, source_files), sha), source_files), paths_requested = I(mx_paths),
    differences = I(c("numeric finite in-range premises coordinates", "relevant-end state exactly WA", "optional City supplied as NA"))),
    header = I(names(original)), physical_rows = cvi_master_physical_nrow(original), map_rows = nrow(original),
    required_cases = vapply(cases, `[[`, character(1), "id"), routes = result)
  write_json(ref, file.path(mx_out, paste0("reference_", tier, ".json")), auto_unbox = TRUE, digits = I(17), null = "null", na = "null")
  cat("S5 module matrix reference: COMPLETE;", tier, "comparisons NOT RUN\n")
}
