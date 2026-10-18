#!/usr/bin/env Rscript
# S7 reference: CVI's own Maps-tab charts, previews and exports, run read-only on synthetic data.
#
# CVI's map module (mod_maps_server) runs unchanged under shiny::testServer, as in the S2, S4 and
# S5 references. For each fixture, view and scenario the script sets the module's inputs, then:
#   1. reads the analytics drawer's data (.chart_inputs) and draws CVI's five chart functions
#      (charts.R), recording each chart's bars or points, titles and empty-chart messages;
#   2. presses CVI's Export button and keeps what it writes (into a sandbox folder): the folder
#      name, filtered_rows.csv, summary_table.csv, export_params.json, the chart PNG sizes and
#      the data plotted in each export chart, the notification and the result lines;
#   3. presses Preview Stats, Preview Map Data and Preview Charts and keeps their dialogs;
#   4. computes what the page shows instead, by design: the same CVI functions run on the rows
#      the map draws (with CVI's per-direction fix P1-12: top places, over time and emerging vs cooling
#      from the rows as drawn, both copies of a WA-to-WA movement; species and corridors merged),
#      and the page's chart additions ("q9" below: record counts, unique CVIs, empty periods, the same
#      quarter last year, top premises) from a separate R implementation that is first checked to give CVI's own values.
# CVI's files are only read. Its data paths point into local-test-artifacts/s7/cvi_root.
#
# Usage (repository root):  Rscript tests/oracle/s7_charts_oracle.R [fixture ...]
# Pictures (for side-by-side comparison with the page):  S7_PICTURES=1 Rscript tests/oracle/s7_charts_oracle.R tier_full s7
#   saves CVI's drawer charts at the drawer's size (640 x 320 pixels at Shiny's 96 dpi) and copies CVI's export
#   chart PNGs, for the scenarios in PICTURE_SCENARIOS only, into local-test-artifacts/s7/boards/cvi/; it writes
#   no reference JSON.
# Needs: node tests/node/run_f1_unit_tests.js first (it writes the three tier bundles) and
#        node tests/synthetic/make_cvi_s7_fixtures.js (the S7 fixture).
# CVI checkout: ../CVI_Traceability or the environment variable CVI_TRACEABILITY_DIR.
# Output (git-ignored): local-test-artifacts/s7/oracle_s7_<fixture>.json and oracle_s7_formats.json.
# R packages as for the S2 reference (shiny, bslib, shinyjs, cli, glue, DT, mapgl, bsicons,
# scales, ggplot2, sf, data.table, dplyr, jsonlite); nothing is installed.

suppressPackageStartupMessages({
  library(jsonlite); library(shiny); library(bslib); library(shinyjs)
  library(cli); library(glue); library(DT); library(mapgl)
})

repo_root <- local({
  a <- commandArgs(trailingOnly = FALSE)
  f <- sub("^--file=", "", a[grep("^--file=", a)])
  normalizePath(file.path(dirname(normalizePath(f[1])), "..", ".."))
})
cvi_dir <- Sys.getenv("CVI_TRACEABILITY_DIR",
                      unset = file.path(dirname(repo_root), "CVI_Traceability"))
out_dir <- file.path(repo_root, "local-test-artifacts", "s7")
dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)
sha256 <- function(p) paste(as.character(openssl::sha256(file(p))), collapse = "")

# ── CVI's code must be the version these references were written against ──────────────────────
expected_sha <- c(
  "R/charts.R"         = "e715e805e56d89830b0ba09733c1abdbbf42d30ce89e5b7e777c2cf46a3b7f84",
  "modules/mod_maps.R" = "a5bae40d60a8e01a2b3dea6399be6e03ef4cdfca7d82106886fbdfef6b486115",
  "R/map_helpers.R"    = "ceddb9ac9ca3a6b8eb4fe58ccdf173ea563207a80f87f178781aad36a234a66c")
for (f in names(expected_sha)) {
  got <- sha256(file.path(cvi_dir, "shiny", f))
  if (!identical(got, expected_sha[[f]]))
    stop("CVI's ", f, " differs from the checked version (SHA-256 ", got, "). Stop and report.")
}
cvi_sources <- c("R/master_loader.R", "R/map_helpers.R", "R/ui_helpers.R", "R/tile_basemap.R",
                 "R/static_map_renderer.R", "R/charts.R", "modules/mod_maps.R")
suppressPackageStartupMessages(
  for (f in cvi_sources) source(file.path(cvi_dir, "shiny", f), local = .GlobalEnv))
cvi_rev <- system2("git", c("-C", shQuote(cvi_dir), "rev-parse", "HEAD"), stdout = TRUE)

# ── Sandbox for CVI's data paths ───────────────────────────────────────────────────────────────
# National Flow needs CVI's state centers; they are written back from the site's copy, which must
# give CVI's own file byte for byte (checked as in the S4 reference).
cvi_root <- file.path(out_dir, "cvi_root")
unlink(cvi_root, recursive = TRUE)
dir.create(file.path(cvi_root, "reference"), recursive = TRUE)
centers_js <- readLines(file.path(repo_root, "site", "geo", "state-centers.js"), warn = FALSE)
centers <- fromJSON(sub(";$", "", sub("^window\\.WSDA_STATE_CENTERS = ", "", centers_js[2])))$centers
centers_file <- file.path(cvi_root, "reference", "state_capitals.csv")
writeLines(c("state,state_lat,state_long",
             sprintf("%s,%.2f,%.2f", centers$state, centers$lat, centers$lon)), centers_file)
if (!identical(sha256(centers_file),
               "c00bad8aebd88a3bf8a1a6a43d06bbf8d2fdf956c2babe1da4dd201bcebd568a"))
  stop("The bundled state centers do not write back to CVI's file")
sandbox_path <- function(kind) function(...) file.path(cvi_root, kind, ...)
cvi_dir_reference <- sandbox_path("reference")
cvi_dir_exports <- sandbox_path("exports")
cvi_dir_www <- sandbox_path("www")
cvi_dir_tile_cache <- sandbox_path("tile_cache")

# County Focus needs county polygons; CVI's are not in the sandbox, so the site's bundled Census
# polygons are given to the module (as in the S5 and S6 references).
county_polygons <- local({
  ring <- function(r) do.call(rbind, lapply(r, unlist))
  shape <- function(g) {
    if (g$type == "Polygon") sf::st_polygon(lapply(g$coordinates, ring))
    else sf::st_multipolygon(lapply(g$coordinates, function(p) lapply(p, ring)))
  }
  txt <- readLines(file.path(repo_root, "site", "geo", "wa-counties.js"), warn = FALSE)
  geo <- fromJSON(sub(";$", "", sub("^window.CVIWA_GEO = ", "", txt[2])), simplifyVector = FALSE)
  feats <- geo$counties$features
  sf::st_sf(name = vapply(feats, function(f) f$properties$name, ""),
            geometry = sf::st_sfc(lapply(feats, function(f) shape(f$geometry)), crs = 4326))
})

# ── Fixtures ───────────────────────────────────────────────────────────────────────────────────
tier_dir <- file.path(repo_root, "local-test-artifacts", "f1", "tiers")
fixtures <- list(
  s2 = file.path(repo_root, "tests", "synthetic", "cvi_master_s2.csv"),
  s4 = file.path(repo_root, "tests", "synthetic", "cvi_master_s4.csv"),
  s7 = file.path(out_dir, "fixtures", "cvi_master_s7.csv"),
  tier_full = file.path(tier_dir, "full", "CVI_Consolidated_Master.csv"),
  tier_partner = file.path(tier_dir, "partner", "partner_county_totals.csv"),
  tier_public = file.path(tier_dir, "public", "CVI_Consolidated_Master.csv"))
# Pictures mode (see Usage): only the scenarios below, CVI's PNGs saved, no reference JSON written.
pictures <- nzchar(Sys.getenv("S7_PICTURES"))
PICTURE_SCENARIOS <- list(wa = c("default", "one_period"), flow = c("inbound", "combined"),
                          focus = c("two_counties", "all_counties"))
pictures_dir <- file.path(out_dir, "boards", "cvi")
if (pictures) { unlink(pictures_dir, recursive = TRUE); dir.create(pictures_dir, recursive = TRUE) }
# Optional arguments name fixtures to run alone (for example: s7 tier_full); the formats always run.
only <- commandArgs(trailingOnly = TRUE)
if (length(setdiff(only, names(fixtures)))) stop("Unknown fixture: ", paste(setdiff(only, names(fixtures)), collapse = ", "))
if (length(only)) fixtures <- fixtures[only]
missing <- names(fixtures)[!file.exists(unlist(fixtures))]
if (length(missing))
  stop("Missing fixtures: ", paste(missing, collapse = ", "),
       ". Run node tests/node/run_f1_unit_tests.js and node tests/synthetic/make_cvi_s7_fixtures.js first.")

# ── Recording export charts ────────────────────────────────────────────────────────────────────
# CVI's export charts are written with ggplot2::ggsave(). A trace on ggsave records each plot
# before it is saved: file name, size in inches and dpi, title, subtitle and the data plotted.
# The trace changes nothing in CVI's code and ggsave still writes every file.
saved_plots <- list()
recording <- TRUE   # off while pictures mode saves CVI's drawer charts
record_plot <- function(filename, plot, width, height, dpi) {
  if (!recording) return(invisible())
  rec <- list(file = basename(filename), width_in = width, height_in = height, dpi = dpi,
              title = plot$labels$title, subtitle = plot$labels$subtitle, data = plot_rows(plot))
  if (inherits(plot$layers[[1]]$geom, "GeomTile")) {
    # A heatmap's cells as drawn: column and row slot, fill color and the cell's label.
    b <- ggplot2::ggplot_build(plot)
    tiles <- b$data[[1]]; labels <- b$data[[2]]
    rec$cells <- data.frame(x = tiles$x, y = tiles$y, fill = tiles$fill,
                            label = labels$label[match(paste(tiles$x, tiles$y), paste(labels$x, labels$y))])
  }
  saved_plots[[length(saved_plots) + 1L]] <<- rec
}
suppressMessages(trace("ggsave", where = asNamespace("ggplot2"), print = FALSE,
  tracer = quote(record_plot(filename, plot, width, height, dpi))))

# A plot's data as plain columns (factors as text), with each factor's level order.
plot_rows <- function(p) {
  d <- as.data.frame(p$data)
  levels <- list()
  for (nm in names(d)) if (is.factor(d[[nm]])) {
    levels[[nm]] <- I(levels(d[[nm]]))
    d[[nm]] <- as.character(d[[nm]])
  }
  list(rows = d, levels = levels)
}

# The width and height of a PNG file, from its header.
png_size <- function(p) {
  b <- readBin(p, "raw", 24L)
  to_int <- function(x) sum(as.integer(x) * 256^(3:0))
  list(width = to_int(b[17:20]), height = to_int(b[21:24]))
}

# ── Reading CVI's drawer charts ────────────────────────────────────────────────────────────────
# A chart function returns either CVI's gray placeholder (text only) or a plot. For a plot, the
# drawn layer's rows are kept with their slot (1 = bottom bar of a flipped chart, or the first
# period), value, fill or line color and series, and the text of each slot.
chart_record <- function(p) {
  b <- ggplot2::ggplot_build(p)
  if (length(p$layers) == 1L && inherits(p$layers[[1]]$geom, "GeomText"))
    return(list(empty = b$data[[1]]$label[1]))
  d <- b$data[[1]]
  slot_column <- as.character(rlang::quo_get_expr(p$mapping$x)[[3]])   # .data$<column>
  fill <- if (is.null(d$fill) || all(is.na(d$fill))) d$colour else d$fill
  marks <- data.frame(slot = round(d$x), value = d$y, color = fill, group = d$group)
  text_layer <- which(vapply(p$layers, function(l) inherits(l$geom, "GeomText"), TRUE))
  labels <- NULL
  if (length(text_layer)) {
    t <- b$data[[text_layer[1]]]
    labels <- I(as.character(t$label[order(t$x)]))     # the value labels, bottom to top
  }
  list(title = p$labels$title, subtitle = p$labels$subtitle, labels = labels,
       slots = I(as.character(levels(p$data[[slot_column]]))),
       data = plot_rows(p), marks = marks,
       lines = any(vapply(p$layers, function(l) inherits(l$geom, "GeomLine"), TRUE)))
}

# ── The page's chart additions (q9), written separately in R ───────────────────────────────────
# Each measure is a way of totaling a set of rows: animals (CVI's rule, a missing count is 0),
# CVI records (each row counts once) and unique CVIs (distinct nonblank CVI numbers, as the value
# box counts them). These functions follow charts.R's rules for animals and are checked against
# CVI's own charts for animals and records (records = CVI's chart with every row's animals set
# to 1) before their other results are kept.
measure_total <- function(d, measure) {
  if (measure == "animals") {
    a <- suppressWarnings(as.numeric(d$Total.Animals)); a[is.na(a)] <- 0; sum(a)
  } else if (measure == "records") {
    nrow(d)
  } else {
    v <- trimws(as.character(d$CVI)); length(unique(v[!is.na(v) & nzchar(v)]))
  }
}
by_group <- function(d, keys, measure) {
  if (!nrow(d)) return(data.frame(key = character(0), value = numeric(0)))
  k <- sort(unique(keys))          # R's aggregate(): groups in sorted order
  v <- vapply(k, function(x) measure_total(d[keys == x, , drop = FALSE], measure), 0, USE.NAMES = FALSE)
  data.frame(key = k, value = v, stringsAsFactors = FALSE)
}
place_of <- function(d, cur) {
  if (identical(cur, "flow")) {
    os <- toupper(trimws(as.character(d$Origin.State)))
    ds <- toupper(trimws(as.character(d$Dest.State)))
    ifelse(ds == "WA", os, ds)
  } else {
    x <- trimws(as.character(ifelse(d$Movement %in% "Inbound", as.character(d$Dest.County),
                                    as.character(d$Origin.County))))
    x[toupper(x) %in% c("N/A", "NA")] <- "Non-WA"
    x
  }
}
county_label <- function(x) {
  x <- trimws(as.character(x)); x[toupper(x) %in% c("N/A", "NA")] <- "Non-WA"; x
}
period_of <- function(d) {
  yr <- suppressWarnings(as.integer(d$Reporting.Year))
  q <- toupper(trimws(as.character(d$Reporting.Quarter)))
  qn <- suppressWarnings(as.integer(sub("^Q", "", q))); qn[is.na(qn)] <- 0L
  list(label = paste0(yr, " ", q), key = yr * 10L + qn)
}
top_n <- function(t, n) utils::head(t[order(-t$value), , drop = FALSE], n)

ref_species <- function(d, measure, n = 12) {
  g <- as.character(d$Species.Group)
  ok <- !is.na(g) & nzchar(trimws(g))
  if (!nrow(d)) return(list(empty = "No records for the current filters"))
  if (!any(ok)) return(list(empty = "No species data"))
  t <- top_n(by_group(d[ok, , drop = FALSE], g[ok], measure), n)
  list(bars = t)
}
ref_top_places <- function(d, cur, measure, n = 12) {
  if (!nrow(d)) return(list(empty = "No records for the current filters"))
  geo <- place_of(d, cur); mv <- as.character(d$Movement)
  ok <- !is.na(geo) & nzchar(trimws(geo)) & !is.na(mv) & nzchar(mv)
  if (!any(ok)) return(list(empty = "No geographic data"))
  d <- d[ok, , drop = FALSE]; geo <- trimws(geo[ok]); mv <- mv[ok]
  top <- top_n(by_group(d, geo, measure), n)$key
  bars <- do.call(rbind, lapply(top, function(g) do.call(rbind, lapply(c("Inbound", "Outbound"),
    function(m) {
      s <- d[geo == g & mv == m, , drop = FALSE]
      if (nrow(s)) data.frame(key = g, series = m, value = measure_total(s, measure)) else NULL
    }))))
  list(order = I(top), bars = bars)
}
ref_corridors <- function(d, cur, measure, n = 12) {
  if (!nrow(d)) return(list(empty = "No records for the current filters"))
  if (identical(cur, "flow")) {
    o <- toupper(trimws(as.character(d$Origin.State)))
    p <- toupper(trimws(as.character(d$Dest.State)))
  } else {
    o <- county_label(d$Origin.County); p <- county_label(d$Dest.County)
  }
  ok <- !is.na(o) & nzchar(o) & !is.na(p) & nzchar(p)
  if (!any(ok)) return(list(empty = "No corridor data"))
  pair <- paste0(o[ok], "  →  ", p[ok])
  list(bars = top_n(by_group(d[ok, , drop = FALSE], pair, measure), n))
}
# Animal volume over time. fill = TRUE adds every selected period between the first and the last
# period with data at zero, for each direction that has data.
ref_over_time <- function(d, measure, fill = FALSE, years = NULL, quarters = NULL) {
  if (!nrow(d)) return(list(empty = "No records for the current filters"))
  pr <- period_of(d); mv <- as.character(d$Movement)
  ok <- !is.na(pr$key) & !is.na(mv) & nzchar(mv)
  if (!any(ok)) return(list(empty = "No dated records"))
  d <- d[ok, , drop = FALSE]; key <- pr$key[ok]; label <- pr$label[ok]; mv <- mv[ok]
  periods <- unique(data.frame(key = key, label = label, stringsAsFactors = FALSE))
  periods <- periods[order(periods$key), , drop = FALSE]
  if (fill) {
    qn <- suppressWarnings(as.integer(sub("^Q", "", quarters)))
    grid <- expand.grid(y = as.integer(years), q = qn[!is.na(qn)])
    grid <- data.frame(key = grid$y * 10L + grid$q, label = paste0(grid$y, " Q", grid$q))
    grid <- grid[grid$key > min(key) & grid$key < max(key) & !(grid$key %in% periods$key), ]
    periods <- rbind(periods, grid)
    periods <- periods[order(periods$key), , drop = FALSE]
  }
  points <- do.call(rbind, lapply(c("Inbound", "Outbound"), function(m) {
    if (!any(mv == m)) return(NULL)
    do.call(rbind, lapply(seq_len(nrow(periods)), function(i) {
      s <- d[mv == m & key == periods$key[i], , drop = FALSE]
      if (!nrow(s) && !fill) return(NULL)
      data.frame(period = periods$label[i], key = periods$key[i], series = m,
                 value = measure_total(s, measure))
    }))
  }))
  list(periods = I(periods$label), points = points)
}
# Emerging vs cooling. compare = "previous" is CVI's (the two latest periods with data);
# "last_year" compares the latest period with the same quarter one year earlier, which must be
# among the selected years.
ref_emerging <- function(d, cur, measure, compare = "previous", years = NULL, n = 12) {
  if (!nrow(d)) return(list(empty = "No records for the current filters"))
  pr <- period_of(d); geo <- place_of(d, cur)
  ok <- !is.na(geo) & nzchar(trimws(geo)) & !is.na(pr$key)
  if (!any(ok)) return(list(empty = "No dated geographic data"))
  d <- d[ok, , drop = FALSE]; key <- pr$key[ok]; label <- pr$label[ok]; geo <- trimws(geo[ok])
  periods <- sort(unique(key))
  p_curr <- max(periods)
  curr_label <- label[match(p_curr, key)]
  if (compare == "previous") {
    if (length(periods) < 2L) return(list(empty = "Select 2+ quarters to compare change"))
    p_prev <- periods[length(periods) - 1L]
    prev_label <- label[match(p_prev, key)]
  } else {
    p_prev <- p_curr - 10L
    prev_label <- paste0(p_prev %/% 10L, " ", sub("^[0-9NA]+ ", "", curr_label))
    if (!(as.character(p_prev %/% 10L) %in% as.character(years)))
      return(list(empty = paste0("Same quarter last year (", prev_label,
                                 ") is not in the selected years"), base = prev_label))
  }
  # CVI's order before ranking: the earlier period's places (sorted), then the later period's others.
  places <- union(sort(unique(geo[key == p_prev])), sort(unique(geo[key == p_curr])))
  delta <- vapply(places, function(g) {
    measure_total(d[geo == g & key == p_curr, , drop = FALSE], measure) -
      measure_total(d[geo == g & key == p_prev, , drop = FALSE], measure)
  }, 0)
  ch <- data.frame(key = places, value = unname(delta), stringsAsFactors = FALSE)
  ch <- ch[ch$value != 0, , drop = FALSE]
  if (!nrow(ch)) return(list(empty = "No change between quarters", from = prev_label, to = curr_label))
  ch <- utils::head(ch[order(-abs(ch$value)), , drop = FALSE], n)
  ch <- ch[order(ch$value), , drop = FALSE]
  list(from = prev_label, to = curr_label, bars = ch)
}
# dplyr's order for CVI's export charts: groups sorted in the C locale (group_by), then the largest totals
# first, ties keeping that order (arrange(desc())). method = "radix" sorts text in the C locale and is stable.
dplyr_order <- function(t) {
  t <- t[order(t$key, method = "radix"), , drop = FALSE]
  t[order(-t$value, method = "radix"), , drop = FALSE]
}

# Heatmaps as CVI's export draws them, for any measure: species by period from the merged rows,
# and on WA State and Flow the top 10 places by period from the rows as given (by direction).
ref_heatmaps <- function(rows, cur, measure) {
  tq <- paste0(rows$Reporting.Year, "-", rows$Reporting.Quarter)
  n_combos <- length(unique(tq[!grepl("NA", tq, fixed = TRUE)]))
  if (!nrow(rows) || n_combos < 2L) return(list(periods = n_combos))
  vol <- dedupe_intrastate_volume(rows)
  vol$period <- paste0(vol$Reporting.Year, " ", vol$Reporting.Quarter)
  vol <- vol[!grepl("NA", vol$period, fixed = TRUE), , drop = FALSE]
  cells <- function(d, key) {
    out <- by_group(d, paste(d$period, key, sep = "\001"), measure)
    parts <- strsplit(out$key, "\001", fixed = TRUE)
    data.frame(period = vapply(parts, `[`, "", 1), key = vapply(parts, `[`, "", 2),
               value = out$value, stringsAsFactors = FALSE)
  }
  species_cells <- cells(vol, as.character(vol$Species.Group))
  # Each group's total over all periods (for animals CVI's sum of its cells; unique CVIs are counted once).
  top_species <- utils::head(dplyr_order(by_group(vol, as.character(vol$Species.Group), measure))$key, 10)
  out <- list(periods = n_combos, species = list(order = I(top_species),
              cells = species_cells[species_cells$key %in% top_species, , drop = FALSE]))
  if (cur %in% c("county", "flow")) {
    ent <- rows
    ent$period <- paste0(ent$Reporting.Year, " ", ent$Reporting.Quarter)
    ent <- ent[!grepl("NA", ent$period, fixed = TRUE), , drop = FALSE]
    ent$entity <- if (cur == "county") {
      ifelse(ent$Movement == "Inbound", as.character(ent$Dest.County), as.character(ent$Origin.County))
    } else {
      ifelse(ent$Movement == "Inbound", as.character(ent$Origin.State), as.character(ent$Dest.State))
    }
    ent <- ent[!is.na(ent$entity) & nchar(trimws(ent$entity)) > 0L, , drop = FALSE]
    if (nrow(ent)) {
      totals <- by_group(ent, ent$entity, measure)
      top_places <- utils::head(dplyr_order(totals)$key, 10)
      ent <- ent[ent$entity %in% top_places, , drop = FALSE]
      out$places <- list(order = I(top_places), cells = cells(ent, ent$entity))
    }
  }
  out
}

# ── One scenario through CVI's module ──────────────────────────────────────────────────────────
notes <- list()
modals <- list()
data_objects <- list()     # tables CVI serves to the browser separately (Preview Map Data)
new_session <- function() {
  s <- MockShinySession$new()
  for (nm in c("sendNotification", "sendModal", "registerDataObj")) unlockBinding(nm, s)
  s$sendNotification <- function(type, message) {
    if (identical(type, "show"))
      notes[[length(notes) + 1L]] <<- list(type = message$type, text = as.character(message$html))
  }
  s$sendModal <- function(type, message) {
    if (identical(type, "show")) modals[[length(modals) + 1L]] <<- as.character(message$html)
  }
  s$registerDataObj <- function(name, data, filterFunc) {
    data_objects[[name]] <<- data
    "data-obj-url"
  }
  for (nm in c("sendNotification", "sendModal", "registerDataObj")) lockBinding(nm, s)
  s
}
html_text <- function(h) {
  h <- gsub("<[^>]+>", "", h)
  for (p in list(c("&lt;", "<"), c("&gt;", ">"), c("&quot;", "\""), c("&#39;", "'"), c("&amp;", "&")))
    h <- gsub(p[1], p[2], h, fixed = TRUE)
  h
}
# A dialog's parts: title, the preformatted text (Preview Stats), the footer's note.
modal_record <- function(h) {
  grab <- function(rx) { m <- regmatches(h, regexpr(rx, h, perl = TRUE)); if (length(m)) html_text(m) else NULL }
  list(title = trimws(grab("(?s)<h4 class=\"modal-title\">.*?</h4>")),
       pre = grab("(?s)<pre[^>]*>.*?</pre>"),
       footer = trimws(grab("(?s)<span style=\"color:#777;[^\"]*\">.*?</span>")))
}
# CVI's Preview Map Data table: the column names shown (from the rendered DT widget) and the rows it
# serves to the browser (the data object it registers), as rows of values.
table_record <- function(w) {
  x <- fromJSON(as.character(w), simplifyVector = FALSE)$x
  cols <- vapply(regmatches(x$container, gregexpr("<th>[^<]*</th>", x$container))[[1]],
                 function(s) html_text(s), "")
  d <- data_objects[[grep("preview_table_dt", names(data_objects), value = TRUE)[1]]]
  list(columns = I(cols), rows = unname(lapply(seq_len(nrow(d)), function(i) unname(as.list(d[i, ])))))
}
# The rows the active map draws (CVI's current_map_data), or NULL.
map_rows <- function(m) { d <- get("current_map_data", envir = m)(); if (is.null(d)) NULL else d$sub }

EXPORT_FORMATS <- list(export_tables = c("csv", "summary_csv"), export_viz = "charts", export_gis = character(0))

run_scenario <- function(m, session, output, view, sc, df) {
  do.call(session$setInputs, sc$inputs)
  session$elapse(300)
  rec <- list(name = sc$name, view = view, inputs = sc$inputs)
  cur <- c(wa = "county", flow = "flow", focus = "intrastate")[[view]]

  # 1. The drawer (charts are drawn only while "Show charts" is on).
  ci <- get(".chart_inputs", envir = m)()
  rec$chart_rows <- if (is.null(ci$sub)) 0L else nrow(ci$sub)
  rec$drawer <- list(
    species = chart_record(cvi_chart_species(ci$sub, ci$cur)),
    top_places = chart_record(cvi_chart_top_geo(ci$sub, ci$cur)),
    over_time = chart_record(cvi_chart_over_time(ci$sub, ci$cur)),
    corridors = chart_record(cvi_chart_corridors(ci$sub, ci$cur)),
    emerging = chart_record(cvi_chart_emerging(ci$sub, ci$cur)))

  # 1b. The charts by direction as the page draws them (CVI's planned fix P1-12): CVI's own chart
  #     functions on the rows the map draws (both copies of a WA-to-WA movement) instead of the merged rows.
  drawn <- map_rows(m)
  rec$drawer_drawn <- list(
    top_places = chart_record(cvi_chart_top_geo(drawn, ci$cur)),
    over_time = chart_record(cvi_chart_over_time(drawn, ci$cur)),
    emerging = chart_record(cvi_chart_emerging(drawn, ci$cur)))

  # 2. The chart additions' rules (R, checked against CVI's charts first).
  sub <- if (is.null(ci$sub)) df[0, , drop = FALSE] else ci$sub
  rec$q9 <- q9_references(sub, if (is.null(drawn)) df[0, , drop = FALSE] else drawn, ci$cur, sc$inputs, view, df)

  # 3. Export, as CVI writes it today.
  unlink(file.path(cvi_root, "exports"), recursive = TRUE)
  notes <<- list(); saved_plots <<- list()
  session$setInputs(run_export = sc$click)
  session$elapse(100)
  rec$export <- export_record(output)
  if (pictures) save_pictures(view, sc, ci)

  # 4. The previews.
  rec$previews <- list()
  for (b in c("preview_stats", "preview_table", "preview_charts")) {
    notes <<- list(); modals <<- list(); data_objects <<- list()
    do.call(session$setInputs, setNames(list(sc$click), b))
    session$elapse(100)
    p <- list(notes = notes, modal = if (length(modals)) modal_record(modals[[1]]) else NULL)
    if (b == "preview_table" && length(modals)) p$table <- table_record(output$preview_table_dt)
    rec$previews[[b]] <- p
  }

  # 5. What the page shows instead, by design: CVI's functions on the map's rows.
  rec$approved <- approved_record(m, view, cur, sc$inputs, df)
  rec
}

# Pictures mode: CVI's drawer charts as Shiny draws them (renderPlot at 96 dpi in a 640 x 320 cell) and the PNGs
# CVI's export just wrote, named <fixture>_<view>_<scenario>_<chart>.png.
save_pictures <- function(view, sc, ci) {
  stem <- file.path(pictures_dir, paste(fx_now, view, sc$name, sep = "_"))
  drawer <- list(species = cvi_chart_species(ci$sub, ci$cur), top_places = cvi_chart_top_geo(ci$sub, ci$cur),
                 over_time = cvi_chart_over_time(ci$sub, ci$cur), corridors = cvi_chart_corridors(ci$sub, ci$cur),
                 emerging = cvi_chart_emerging(ci$sub, ci$cur))
  recording <<- FALSE
  on.exit(recording <<- TRUE)
  for (id in names(drawer)) {
    ggplot2::ggsave(paste0(stem, "_drawer_", id, ".png"), drawer[[id]], width = 640 / 96, height = 320 / 96,
                    dpi = 96, bg = "white")
  }
  dirs <- list.dirs(file.path(cvi_root, "exports"), recursive = FALSE)
  if (length(dirs)) for (f in list.files(file.path(dirs[1], "charts"), pattern = "[.]png$")) {
    file.copy(file.path(dirs[1], "charts", f), paste0(stem, "_export_", f), overwrite = TRUE)
  }
}

export_record <- function(output) {
  dirs <- list.dirs(file.path(cvi_root, "exports"), recursive = FALSE)
  r <- list(notes = notes, result = NULL, folder = NULL)
  res <- tryCatch(output$export_result, error = function(e) NULL)
  if (!is.null(res)) r$result <- I(html_text(regmatches(res$html,
    gregexpr("(?s)<div>.*?</div>", res$html, perl = TRUE))[[1]]))
  if (!length(dirs)) return(r)
  d <- dirs[1]
  r$folder <- basename(d)
  files <- sort(list.files(d, recursive = TRUE))
  r$files <- I(files)
  read_text <- function(f) { p <- file.path(d, f); if (file.exists(p)) rawToChar(readBin(p, "raw", file.size(p))) else NULL }
  r$filtered_rows_csv <- read_text("filtered_rows.csv")
  r$summary_table_csv <- read_text("summary_table.csv")
  r$export_params_json <- read_text("export_params.json")
  r$charts <- lapply(saved_plots, function(sp) {
    sp$png <- png_size(file.path(d, "charts", sp$file))
    sp
  })
  r
}

# The chart additions' references for the drawer's rows of one scenario. sub: the merged rows (CVI's .chart_inputs), for
# the totals across directions; drawn: the rows the map draws, for the charts by direction. The R rules are
# checked against CVI's chart functions on both.
q9_references <- function(sub, drawn, cur, inputs, view, df) {
  years <- inputs[[paste0(c(wa = "county", flow = "flow", focus = "intra")[[view]], "_year")]]
  quarters <- inputs[[paste0(c(wa = "county", flow = "flow", focus = "intra")[[view]], "_quarter")]]
  ones <- sub; if (nrow(ones)) ones$Total.Animals <- 1
  check <- function(ref, cvi_chart, what) {
    if (!same_chart(ref, chart_record(cvi_chart), what)) {
      str(ref); str(chart_record(cvi_chart))
      stop("The R chart rules disagree with CVI's ", what, " chart: ", sc_name)
    }
  }
  for (m in c("animals", "records")) {
    d <- if (m == "animals") sub else ones
    check(ref_species(sub, m), cvi_chart_species(if (nrow(d)) d else NULL, cur), paste("species", m))
    check(ref_top_places(sub, cur, m), cvi_chart_top_geo(if (nrow(d)) d else NULL, cur), paste("top places", m))
    check(ref_corridors(sub, cur, m), cvi_chart_corridors(if (nrow(d)) d else NULL, cur), paste("corridors", m))
    check(ref_over_time(sub, m), cvi_chart_over_time(if (nrow(d)) d else NULL, cur), paste("over time", m))
    check(ref_emerging(sub, cur, m), cvi_chart_emerging(if (nrow(d)) d else NULL, cur), paste("emerging", m))
  }
  dd <- drawn; if (nrow(dd)) dd$Total.Animals <- 1
  for (m in c("animals", "records")) {
    d <- if (m == "animals") drawn else dd
    check(ref_top_places(drawn, cur, m), cvi_chart_top_geo(if (nrow(d)) d else NULL, cur), paste("top places drawn", m))
    check(ref_over_time(drawn, m), cvi_chart_over_time(if (nrow(d)) d else NULL, cur), paste("over time drawn", m))
    check(ref_emerging(drawn, cur, m), cvi_chart_emerging(if (nrow(d)) d else NULL, cur), paste("emerging drawn", m))
  }
  has_cvi <- "CVI" %in% names(df)
  out <- list()
  for (m in c("animals", "records", if (has_cvi) "cvis")) {
    out[[m]] <- list(
      species = ref_species(sub, m), top_places = ref_top_places(drawn, cur, m),
      corridors = ref_corridors(sub, cur, m),
      over_time = ref_over_time(drawn, m, fill = TRUE, years = years, quarters = quarters),
      emerging = ref_emerging(drawn, cur, m),
      emerging_last_year = ref_emerging(drawn, cur, m, "last_year", years = years))
  }
  out
}

# Does an R reference give what CVI's chart shows? Compares values, their order and the messages.
same_chart <- function(ref, cvi, what) {
  if (!is.null(ref$empty) || !is.null(cvi$empty)) return(identical(ref$empty, cvi$empty))
  cvi$slots <- as.character(cvi$slots)   # without the I() wrapper kept for the JSON
  d <- cvi$data$rows
  if (grepl("^species", what)) return(identical(rev(cvi$slots), ref$bars$key) &&
                                       isTRUE(all.equal(d$a[match(ref$bars$key, d$g)], ref$bars$value)))
  if (grepl("^corridors", what)) return(identical(rev(cvi$slots), ref$bars$key) &&
                                         isTRUE(all.equal(d$a[match(ref$bars$key, d$pair)], ref$bars$value)))
  if (grepl("^top places", what)) {
    k <- paste(d$geo, d$mv); rk <- paste(ref$bars$key, ref$bars$series)
    return(identical(rev(cvi$slots), as.character(ref$order)) && setequal(k, rk) &&
           isTRUE(all.equal(d$a[match(rk, k)], ref$bars$value)))
  }
  if (grepl("^over time", what)) {
    k <- paste(d$label, d$mv); rk <- paste(ref$points$period, ref$points$series)
    return(identical(cvi$slots, as.character(ref$periods)) && setequal(k, rk) &&
           isTRUE(all.equal(d$a[match(rk, k)], ref$points$value)))
  }
  if (grepl("^emerging", what)) return(identical(cvi$slots, ref$bars$key) &&
    isTRUE(all.equal(d$delta, ref$bars$value)) &&
    identical(cvi$subtitle, paste0("Change in animals: ", ref$from, "  →  ", ref$to)))
  FALSE
}

# The expectations for the page: the rows the map draws are used for the files, the
# Stats text and the export charts. Each is made by CVI's own code (its intrastate merge, fwrite,
# .build_summary_lines and .write_export_charts) given those rows; only the small preparation of
# their arguments below repeats the module's (mod_maps.R, Preview Stats and Export).
approved_record <- function(m, view, cur, inputs, df) {
  rows <- map_rows(m)
  if (is.null(rows)) return(list(rows = 0L))
  agg <- tryCatch(switch(view, wa = get("county_circle_data", envir = m)(), flow = get("flow_line_data", envir = m)(),
                         focus = get("intrastate_line_data", envir = m)()), error = function(e) NULL)
  prefix <- c(wa = "county", flow = "flow", focus = "intra")[[view]]
  yrs <- as.integer(inputs[[paste0(prefix, "_year")]])
  yr <- if (min(yrs) == max(yrs)) as.character(min(yrs)) else paste(range(yrs), collapse = "-")
  qtr <- paste(sort(inputs[[paste0(prefix, "_quarter")]]), collapse = "")
  spp <- inputs[[paste0(prefix, "_species")]]
  dir_raw <- switch(view, wa = inputs$county_direction, flow = inputs$flow_direction,
    focus = switch(inputs$intra_filter_dir, inbound = "Inbound", outbound = "Outbound",
                   c("Inbound", "Outbound")))
  map_tag <- c(wa = "County", flow = "Flow", focus = "Focus")[[view]]
  focus_cty <- if (view == "focus") inputs$intra_counties else character(0)
  is3 <- list(view == "wa", view == "flow", view == "focus")

  csv_text <- function(d) {
    f <- tempfile(fileext = ".csv"); data.table::fwrite(d, f)
    rawToChar(readBin(f, "raw", file.size(f)))
  }
  table <- NULL
  if (!is.null(agg) && nrow(agg) > 0) {
    t <- if (view == "wa") agg else sf::st_drop_geometry(agg)
    t <- t[, setdiff(names(t), c("popup_html", "tooltip_text", "color", "radius_px",
                                 "species_json", "line_width_px")), drop = FALSE]
    table <- csv_text(as.data.frame(t))
  }
  saved_plots <<- list()
  chart_dir <- file.path(out_dir, "scratch_charts")
  unlink(chart_dir, recursive = TRUE)
  get(".write_export_charts", envir = m)(chart_dir, map_tag, yr, qtr, dir_raw, focus_cty, rows, agg,
                       is3[[1]], is3[[2]], is3[[3]])
  unlink(chart_dir, recursive = TRUE)
  heatmaps <- lapply(setNames(nm = c("animals", "records", if ("CVI" %in% names(df)) "cvis")),
                     function(m) ref_heatmaps(rows, cur, m))
  check_heatmaps(heatmaps$animals, saved_plots)
  list(rows = nrow(rows),
       filtered_rows_csv = csv_text(dedupe_intrastate_volume(rows)),
       summary_table_csv = table,
       stats = I(get(".build_summary_lines", envir = m)(map_tag, spp, yr, qtr, dir_raw, focus_cty, rows, agg,
                                      is3[[1]], is3[[2]], is3[[3]])),
       export_charts = saved_plots,
       heatmaps = heatmaps,
       top_premises = if (view == "focus" && !is.null(agg) && nrow(agg) > 0)
         top_premises(sf::st_drop_geometry(agg), "CVI" %in% names(df)) else NULL)
}

# The R heatmap rules must give CVI's own export heatmaps for animals: the same rows top to
# bottom and the same value in every cell.
check_heatmaps <- function(ref, plots) {
  for (part in c("species", "places")) {
    file <- c(species = "temporal_heatmap.png", places = "entity_heatmap.png")[[part]]
    p <- Filter(function(x) identical(x$file, file), plots)
    r <- ref[[part]]
    if (!length(p) && is.null(r)) next
    if (!length(p) || is.null(r)) stop("Heatmap ", part, " drawn by only one side: ", sc_name)
    d <- p[[1]]$data$rows
    key <- if (part == "species") "Species.Group" else "entity"
    same <- identical(rev(as.character(p[[1]]$data$levels[[key]])), as.character(r$order)) &&
      setequal(paste(d$period, d[[key]]), paste(r$cells$period, r$cells$key)) &&
      isTRUE(all.equal(d$Animals[match(paste(r$cells$period, r$cells$key), paste(d$period, d[[key]]))],
                       r$cells$value))
    if (!same) stop("The R heatmap rules disagree with CVI's ", file, ": ", sc_name)
  }
}

# Chart addition: one bar per premises, labeled as the map labels its circles, per
# direction, the 12 largest for each measure (ties keep CVI's premises order).
top_premises <- function(agg, has_cvi) {
  col <- c(animals = "total_animals", records = "n_shipments", cvis = "n_cvis")
  out <- list()
  for (m in names(col)) {
    if (m == "cvis" && !has_cvi) next
    out[[m]] <- lapply(setNames(nm = c("Inbound", "Outbound")), function(dir) {
      s <- agg[agg$direction == dir, , drop = FALSE]
      s <- utils::head(s[order(-s[[col[[m]]]]), , drop = FALSE], 12)
      data.frame(label = s$premises_id, value = s[[col[[m]]]])
    })
  }
  out
}

# ── Scenarios per view ─────────────────────────────────────────────────────────────────────────
Q4 <- c("Q1", "Q2", "Q3", "Q4")
scenarios_for <- function(df, view) {
  spp <- sort(unique(df$Species.Group)); spp <- spp[!is.na(spp) & nzchar(spp)]
  yrs <- as.character(sort(unique(df$Reporting.Year)))
  has_species <- "Species" %in% names(df)
  cattle_raw <- if (has_species) sort(unique(df$Species[df$Species.Group %in% "Cattle"])) else character(0)
  last_year <- yrs[length(yrs)]
  out <- list()
  add <- function(name, inputs) out[[length(out) + 1L]] <<- list(name = name, inputs = inputs)
  if (view == "wa") {
    base <- list(county_species = spp, county_species_sub = character(0), county_year = yrs,
                 county_quarter = Q4, county_direction = c("Inbound", "Outbound"),
                 county_mode = "side_by_side", county_scaling = "log", county_n_bins = "5",
                 export_label = "")
    add("default", base)
    add("inbound", modifyList(base, list(county_direction = "Inbound")))
    add("outbound", modifyList(base, list(county_direction = "Outbound")))
    add("combined_total", modifyList(base, list(county_mode = "total")))
    add("one_year_two_quarters", modifyList(base, list(county_year = last_year, county_quarter = c("Q2", "Q3"))))
    add("one_period", modifyList(base, list(county_year = last_year, county_quarter = "Q3")))
    add("first_group", modifyList(base, list(county_species = spp[1])))
    if (length(cattle_raw)) add("cattle_refined", modifyList(base, list(county_species = "Cattle",
                                county_species_sub = cattle_raw[1])))
    add("no_species", modifyList(base, list(county_species = character(0))))
    add("label", modifyList(base, list(export_label = "Report: Q3 / dairy, v2!")))
    add("label_accents", modifyList(base, list(export_label = "Caf\u00e9 \u00e9t\u00e9 \u2013 Ny\u00e5")))
  } else if (view == "flow") {
    base <- list(flow_direction = "inbound", flow_species = spp, flow_species_sub = character(0),
                 flow_year = yrs, flow_quarter = Q4, flow_combine_species = FALSE,
                 flow_scaling = "log", flow_n_bins = "5", flow_width_mult = "1.0", export_label = "")
    add("inbound", base)
    add("outbound", modifyList(base, list(flow_direction = "outbound")))
    add("combined", modifyList(base, list(flow_direction = "combined")))
    add("combined_species", modifyList(base, list(flow_direction = "combined", flow_combine_species = TRUE)))
    add("one_period", modifyList(base, list(flow_year = last_year, flow_quarter = "Q3")))
    if (length(cattle_raw)) add("cattle_refined", modifyList(base, list(flow_direction = "combined",
                                flow_species = "Cattle", flow_species_sub = cattle_raw[1])))
    add("no_quarters", modifyList(base, list(flow_quarter = character(0))))
  } else {
    wa_counties <- sort(unique(c(df$Origin.County[df$Origin.State %in% "WA"],
                                 df$Dest.County[df$Dest.State %in% "WA"])))
    wa_counties <- wa_counties[!is.na(wa_counties) & nzchar(wa_counties)]
    base <- list(intra_counties = wa_counties[seq_len(min(2L, length(wa_counties)))],
                 intra_species = spp, intra_species_sub = character(0), intra_year = yrs,
                 intra_quarter = Q4, intra_filter_dir = "combined", intra_mode = "overlap",
                 intra_scaling = "log", intra_n_bins = "5", intra_time_enabled = FALSE,
                 export_label = "")
    add("no_counties", modifyList(base, list(intra_counties = character(0))))
    add("two_counties", base)
    add("inbound", modifyList(base, list(intra_filter_dir = "inbound")))
    add("outbound", modifyList(base, list(intra_filter_dir = "outbound")))
    add("all_counties", modifyList(base, list(intra_counties = wa_counties)))
    if (length(wa_counties) > 3L) add("four_counties", modifyList(base, list(intra_counties = wa_counties[1:4])))
    if (length(cattle_raw)) add("cattle_refined", modifyList(base, list(intra_species = "Cattle",
                                intra_species_sub = cattle_raw[1])))
  }
  out
}

# ── Run every fixture ──────────────────────────────────────────────────────────────────────────
sc_name <- ""
for (fx in names(fixtures)) {
  t0 <- Sys.time()
  fx_now <- fx
  df <- suppressWarnings(load_master_csv(fixtures[[fx]]))
  if (is.null(df)) stop("CVI's loader refused ", fx)
  result <- list(fixture = fx, file = sub(paste0(repo_root, "/"), "", fixtures[[fx]]),
                 file_sha256 = sha256(fixtures[[fx]]), physical_rows = cvi_master_physical_nrow(df),
                 map_rows = nrow(df), columns = I(names(df)),
                 column_types = lapply(df, function(x) class(x)[1]), views = list())
  box <- new.env()          # testServer's expression stores its results here
  box$views <- list()
  click <- 0L
  buttons <- c(wa = "show_county", flow = "show_flow", focus = "show_intrastate")
  sess <- new_session()
  testServer(mod_maps_server, args = list(rv = reactiveValues(master_df = NULL),
             project_root = cvi_root, scripts_dir = cvi_root), session = sess, {
    rv$master_df <- df
    session$flushReact()
    map_state$county_polygons <- county_polygons
    do.call(session$setInputs, c(EXPORT_FORMATS, list(show_charts = TRUE)))
    module <- environment()   # the module's functions are found from here (get(), not $)
    for (view in names(buttons)) {
      click <- click + 1L
      do.call(session$setInputs, setNames(list(click), buttons[[view]]))
      session$elapse(300)
      recs <- list()
      for (sc in scenarios_for(df, view)) {
        if (pictures && !(sc$name %in% PICTURE_SCENARIOS[[view]])) next
        click <- click + 1L
        sc$click <- click
        sc_name <<- paste(fx, view, sc$name)
        recs[[sc$name]] <- run_scenario(module, session, output, view, sc, df)
      }
      box$views[[view]] <- recs
    }
  })
  result$views <- box$views
  if (pictures) {
    cat(sprintf("s7 pictures %s: %d files\n", fx, length(list.files(pictures_dir, pattern = paste0("^", fx, "_")))))
    next
  }
  result$meta <- list(cvi_rev = cvi_rev, cvi_sources = as.list(expected_sha),
    r = R.version.string, data.table = as.character(packageVersion("data.table")),
    jsonlite = as.character(packageVersion("jsonlite")), ggplot2 = as.character(packageVersion("ggplot2")),
    scales = as.character(packageVersion("scales")), shiny = as.character(packageVersion("shiny")),
    timezone = Sys.timezone(), generated = format(Sys.time(), tz = "UTC", usetz = TRUE))
  write_json(result, file.path(out_dir, paste0("oracle_s7_", fx, ".json")),
             auto_unbox = TRUE, digits = NA, null = "null", na = "null", pretty = FALSE)
  n <- sum(vapply(result$views, length, 0L))
  cat(sprintf("s7 %s: %d scenarios over 3 views (%.0f s)\n", fx, n,
              as.numeric(difftime(Sys.time(), t0, units = "secs"))))
}

if (pictures) {
  unlink(cvi_root, recursive = TRUE)
  cat("s7 pictures: complete\n")
  quit(save = "no", status = 0)
}

# ── Number, text and JSON formats ──────────────────────────────────────────────────────────────
# Inputs are written with 17 significant digits so the page reads back the same doubles.
set.seed(20261011)
battery <- c(0, -0, 1, 10, 100, 1000, 1e4, 1e5, 1e6, 1e7, 1.5e6, 2.5e6, 3e5, 1.2e5, 1.2e6,
             100001, 0.1 + 0.2, 1/3, 2/3, 1e-4, 1e-3, 1e-5, 0.00012345, 1e-20, 1e15, 1e16, 1e300,
             123456789012, 12345678901234567, 47.6062, 47.6062 - 0.2, -122.33, -122.33 + 0.2,
             100000.5, 2.5, 0.5, 1e21, 123456.7, 9.999999999999999e22,
             round(runif(300, -1e6, 1e6), sample(0:6, 300, TRUE)),
             signif(exp(runif(300, log(1e-9), log(1e17))), sample(1:16, 300, TRUE)),
             runif(200, -180, 180), round(runif(100) * 10^sample(0:12, 100, TRUE)),
             runif(1000, -1e3, 1e3), exp(runif(1000, log(1e-6), log(1e12))))
fwrite_cases <- local({
  f <- tempfile(fileext = ".csv")
  data.table::fwrite(data.frame(x = battery), f)
  list(inputs = I(sprintf("%.17g", battery)), outputs = I(readLines(f)[-1]))
})
comma_vectors <- list(c(2.5, 1000), c(1, 1000, 123456), c(0.25, 0.5), c(12, 12.5, 13),
                      c(1e6, 2.5e6), c(0), c(-1500, 300), c(999.5, 1000.5), c(1234.5678))
short_vectors <- list(c(0.5, 999, 1000, 1234, 1250, 12345, 999999, 1e6, 1.5e6, 2.25e9, 1e12, 950, 9999.5, 0, 12.5),
                      c(1200, 35000), c(1, 2, 3), c(120, 4500, 98000, 1500000), c(100000), c(0, 0),
                      c(15, 1500, 150000, 15000000), c(7, 1e3 + 1))
format_vectors <- c(list(c(0), c(5), c(1234), c(100000), c(1e6), c(1234567), c(2.5), c(1e15),
                         c(123456789), c(1500000), c(12, 100000), c(0.5), c(-42), c(1600228.5), c(1600229.5)),
                    as.list(c(round(runif(150, 0, 3e6)) + sample(c(0, 0.5, 0.25), 150, TRUE),
                              round(runif(50, 0, 1e4), 1))))
# round(x, 3) (Preview Map Data): coordinates with 4 decimals, as the map's rows carry them, and offsets.
round_inputs <- c(round(runif(800, -125, -116), 4), round(runif(800, 45, 49), 4),
                  round(runif(400, -125, -116), 4) + 0.2, runif(200, -1e4, 1e4), (0:400) / 8000)
json_cases <- list(
  list(map = "county", species = c("Cattle"), years = 2024L, year_min = 2024L, year_max = 2024L,
       quarters = c("Q1", "Q2"), direction = c("Inbound", "Outbound"), export_label = "",
       formats = c("csv", "summary_csv", "charts"), append_accumulator = FALSE, exported_at = "2026-10-11 09:05:00"),
  list(map = "county_focus", species = c("A", "B"), years = c(2024L, 2025L), focus_counties = character(0),
       overlays_active = c(), overlay_labels_on_png = "", export_label = "say \"hi\" \\ é → /",
       exported_at = "2026-10-11 09:05:00"),
  list(map = "flow", species = character(0), direction = "combined", formats = "csv"))
json_cases <- lapply(json_cases, function(p) {
  f <- tempfile(fileext = ".json")
  jsonlite::write_json(p, f, pretty = TRUE, auto_unbox = TRUE)
  list(input = p, output = rawToChar(readBin(f, "raw", file.size(f))))
})
formats <- list(
  fwrite = fwrite_cases,
  comma = lapply(comma_vectors, function(v) list(input = I(v), output = I(scales::comma(v)))),
  short = lapply(short_vectors, function(v) list(input = I(v),
    output = I(scales::label_number(scale_cut = scales::cut_short_scale())(v)))),
  format_big_mark = lapply(format_vectors, function(v) list(input = I(v),
    output = I(format(v, big.mark = ",")))),
  json = json_cases,
  round3 = list(inputs = I(sprintf("%.17g", round_inputs)), outputs = I(sprintf("%.17g", round(round_inputs, 3)))))
write_json(formats, file.path(out_dir, "oracle_s7_formats.json"), auto_unbox = TRUE,
           digits = NA, null = "null", na = "null")
cat(sprintf("s7 formats: %d fwrite numbers, %d comma, %d short-scale, %d format, %d JSON, %d round cases\n",
            length(battery), length(comma_vectors), length(short_vectors), length(format_vectors),
            length(json_cases), length(round_inputs)))
unlink(cvi_root, recursive = TRUE)
cat("s7 oracle: complete\n")
