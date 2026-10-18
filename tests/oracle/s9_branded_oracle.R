#!/usr/bin/env Rscript
# S9 reference: CVI's own branded map PNGs, run read-only on synthetic data.
#
# CVI's map module (mod_maps_server) runs unchanged under shiny::testServer, as in the S7 reference. For each
# fixture and scenario the script sets the module's inputs, ticks "Branded map (.png)" with the Default background
# and presses Export. CVI's renderer then composes its page with cowplot and saves it with ggsave. In this R session
# only, traces on cowplot::draw_plot, draw_label and draw_grob and on ggplot2::ggsave record each region as it is
# placed (its position on the page and its ggplot), and every text, value, color and mark is read from those plots
# with ggplot2::layer_data(). CVI's PNG is kept for side-by-side comparison. Nothing in CVI's files is changed.
#
# Views: WA State, National Flow and County Focus, Facilities on the Infrastructure dashboard (the Full tier only:
# its CVI activity scenarios use that master) and the National Flow time-series GIF (view "gif"): CVI's
# render_branded_flow_map_gif runs unchanged; its frame list (the progress calls, skipped periods included) and each
# frame's render_branded_flow_map call and page are recorded. The R package gifski is not
# installed (nothing is installed), so CVI writes the first frame's PNG under the .gif name, as its fallback does.
#
# Usage (repository root):  Rscript tests/oracle/s9_branded_oracle.R [fixture ...]
# S9_VIEWS=flow,focus (for example) runs only those views and keeps the other views already recorded in each
# fixture's JSON file.
# Needs: node tests/node/run_f1_unit_tests.js first (it writes the three tier bundles).
# CVI checkout: ../CVI_Traceability or the environment variable CVI_TRACEABILITY_DIR.
# Output (git-ignored): local-test-artifacts/s9/oracle_s9_<fixture>.json and CVI's PNGs in
#   local-test-artifacts/s9/cvi/<fixture>_<view>_<scenario>.png.
# "Last Updated" is pinned to 2026-10-12 (Sys.Date is replaced in this session only).
# R packages as for the S7 reference plus cowplot, png, shadowtext and classInt; nothing is installed.

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
out_dir <- file.path(repo_root, "local-test-artifacts", "s9")
png_dir <- file.path(out_dir, "cvi")
dir.create(png_dir, recursive = TRUE, showWarnings = FALSE)
sha256 <- function(p) paste(as.character(openssl::sha256(file(p))), collapse = "")

# ── CVI's code must be the version these references were written against ────────────────────────────────────
expected_sha <- c(
  "R/static_map_renderer.R" = "099e94baf9bfb4a99d54fc2bb0def8f4580c8414da5b928d71562beffd0a47f4",
  "modules/mod_maps.R"      = "a5bae40d60a8e01a2b3dea6399be6e03ef4cdfca7d82106886fbdfef6b486115",
  "R/tile_basemap.R"        = "9e5f955cb69731de9699e43e457c32c5fd4b2bbecf84455a65f995d3f1903b56",
  "R/map_helpers.R"         = "ceddb9ac9ca3a6b8eb4fe58ccdf173ea563207a80f87f178781aad36a234a66c",
  "www/img/wsda_logo.png"   = "1bdff086b0bc3aab9b0adb3135714ffc08d10e028e77940cb82f810cec2d9b72")
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

# "Last Updated" is today's date in CVI's renderer; it is pinned here so the reference does not change by day.
PINNED_DATE <- as.Date("2026-10-12")
Sys.Date <- function() PINNED_DATE

# ── Sandbox for CVI's data paths ────────────────────────────────────────────────────────────────────────────
# The renderer reads the logo from www/img and the county polygons from reference/. The logo is CVI's own file,
# copied into the sandbox; the polygons are the site's bundled Census counties (CVI's own polygon file is in its
# reference folder, which is not read), as in the S5 to S7 references.
cvi_root <- file.path(out_dir, "cvi_root")
unlink(cvi_root, recursive = TRUE)
dir.create(file.path(cvi_root, "reference"), recursive = TRUE)
dir.create(file.path(cvi_root, "www", "img"), recursive = TRUE)
file.copy(file.path(cvi_dir, "shiny", "www", "img", "wsda_logo.png"), file.path(cvi_root, "www", "img"))
# The Flow map's state centers: the site's bundled copy written back to CVI's file, byte for byte (as the S7
# reference checks it).
centers_js <- readLines(file.path(repo_root, "site", "geo", "state-centers.js"), warn = FALSE)
centers <- fromJSON(sub(";$", "", sub("^window\\.WSDA_STATE_CENTERS = ", "", centers_js[2])))$centers
centers_file <- file.path(cvi_root, "reference", "state_capitals.csv")
writeLines(c("state,state_lat,state_long",
             sprintf("%s,%.2f,%.2f", centers$state, centers$lat, centers$lon)), centers_file)
# The synthetic facility layers (County Focus scenarios with facilities), in the sandbox's reference folder under
# CVI's file names, as CVI's loader reads them.
# CVI's Streets files (its reference/tiger_wa, public Census, USGS and Natural Earth data), copied into the sandbox as CVI reads them.
tiger_src <- file.path(cvi_dir, "reference", "tiger_wa")
if (dir.exists(tiger_src)) {
  dir.create(file.path(cvi_root, "reference", "tiger_wa"), recursive = TRUE, showWarnings = FALSE)
  file.copy(list.files(tiger_src, pattern = "[.]rds$", full.names = TRUE), file.path(cvi_root, "reference", "tiger_wa"))
}
# Two sets under CVI's file names: County Focus's (inside Grant and Yakima) and the statewide set of the Facilities
# view; each view copies its own set in before it loads the layers.
fac_dir <- file.path(out_dir, "facilities")
fac_wa_dir <- file.path(out_dir, "facilities-wa")
if (!dir.exists(fac_dir) || !dir.exists(fac_wa_dir)) stop("Run node tests/synthetic/make_s9_facilities.js first.")
use_facilities <- function(dir) {
  file.copy(list.files(dir, full.names = TRUE), file.path(cvi_root, "reference"), overwrite = TRUE)
}
use_facilities(fac_dir)
if (!identical(sha256(centers_file),
               "c00bad8aebd88a3bf8a1a6a43d06bbf8d2fdf956c2babe1da4dd201bcebd568a"))
  stop("The bundled state centers do not write back to CVI's file")
sandbox_path <- function(kind) function(...) file.path(cvi_root, kind, ...)
cvi_dir_reference <- sandbox_path("reference")
cvi_dir_exports <- sandbox_path("exports")
cvi_dir_www <- sandbox_path("www")
cvi_dir_tile_cache <- sandbox_path("tile_cache")

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
# CVI's own polygon file is in Web Mercator (EPSG:3857; .read_wa_counties, SMR 4520-4523). The Facilities renderer
# reads it without transforming it and finds its county anchors in those meters (.county_label_anchor, SMR 441-466),
# so the Facilities view writes the counties in EPSG:3857 as CVI's file is; the other views keep the S5 to S7
# references' longitude/latitude file (their renderers transform what they read).
write_counties <- function(crs) {
  path <- cvi_dir_reference("wa_counties_polygons.gpkg")
  unlink(path)
  suppressMessages(sf::st_write(sf::st_transform(county_polygons, crs), path, quiet = TRUE))
}
write_counties(4326)

# ── Fixtures ────────────────────────────────────────────────────────────────────────────────────────────────
tier_dir <- file.path(repo_root, "local-test-artifacts", "f1", "tiers")
fixtures <- list(
  s2 = file.path(repo_root, "tests", "synthetic", "cvi_master_s2.csv"),
  wa39 = file.path(repo_root, "tests", "synthetic", "cvi_master_wa39.csv"),
  tier_full = file.path(tier_dir, "full", "CVI_Consolidated_Master.csv"),
  tier_partner = file.path(tier_dir, "partner", "partner_county_totals.csv"),
  tier_public = file.path(tier_dir, "public", "CVI_Consolidated_Master.csv"))
only <- commandArgs(trailingOnly = TRUE)
if (length(setdiff(only, names(fixtures))))
  stop("Unknown fixture: ", paste(setdiff(only, names(fixtures)), collapse = ", "))
if (length(only)) fixtures <- fixtures[only]
missing <- names(fixtures)[!file.exists(unlist(fixtures))]
if (length(missing))
  stop("Missing fixtures: ", paste(missing, collapse = ", "), ". Run node tests/node/run_f1_unit_tests.js first.")

# ── Recording CVI's page as it is composed ──────────────────────────────────────────────────────────────────
# Each trace adds one entry to `placed`, in the order the renderer places it; ggsave's trace keeps the page size.
# The traces change nothing in CVI's code: each function still runs and the PNG is still written.
placed <- list()
saved <- NULL
renders <- list()
record <- function(kind, ...) placed[[length(placed) + 1L]] <<- c(list(kind = kind), list(...))
suppressMessages({
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
})
# The renderers' own arguments (the rows they draw and the choices they were given), kept on entry.
render_county <- render_branded_county_map
render_branded_county_map <- function(...) {
  renders[[length(renders) + 1L]] <<- list(view = "wa", args = list(...))
  render_county(...)
}
# In the GIF view each frame's page is recorded as it is drawn (gif_mode), since one export draws many pages.
gif_mode <- FALSE
render_flow <- render_branded_flow_map
render_branded_flow_map <- function(...) {
  renders[[length(renders) + 1L]] <<- list(view = "flow", args = list(...))
  res <- render_flow(...)
  if (gif_mode) {
    renders[[length(renders)]]$page <<- page_record()
    renders[[length(renders)]]$saved <<- saved
    placed <<- list()
  }
  res
}
# The GIF renderer's own choices and every progress call (i, n, label): the frame list before empty periods are
# skipped.
gif_calls <- list()
render_gif <- render_branded_flow_map_gif
render_branded_flow_map_gif <- function(..., progress_fn = NULL) {
  a <- list(...)
  progress <- list()
  record_progress <- function(i, n, label) {
    progress[[length(progress) + 1L]] <<- list(i = i, n = n, label = label)
    if (is.function(progress_fn)) progress_fn(i, n, label)
  }
  call <- list(frame_by = a$frame_by, delay = a$delay, dpi = a$dpi, years = I(a$year_filter),
               quarters = I(a$quarter_filter), direction = a$direction, species = I(a$species_filter),
               combine_species = a$combine_species, custom_title = a$custom_title,
               output_file = basename(a$output_path))
  res <- tryCatch(render_gif(..., progress_fn = record_progress), error = function(e) {
    call$error <<- conditionMessage(e)
    stop(e)
  }, finally = {
    call$progress <- progress
    gif_calls[[length(gif_calls) + 1L]] <<- call
  })
  res
}
render_focus <- render_branded_county_focus_map
render_branded_county_focus_map <- function(...) {
  renders[[length(renders) + 1L]] <<- list(view = "focus", args = list(...))
  render_focus(...)
}
# The Facilities renderer also says which coverage view it drew (its "facility_view_used" attribute).
render_facilities <- render_branded_facilities_map
render_branded_facilities_map <- function(...) {
  renders[[length(renders) + 1L]] <<- list(view = "facilities", args = list(...))
  res <- render_facilities(...)
  renders[[length(renders)]]$view_used <<- attr(res, "facility_view_used")
  res
}

# One ggplot as plain values: its background, margins, panel ranges and every layer's rows from layer_data().
# Point geometries become x and y; other geometries are counted, not copied.
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
       x_range = pp$x_range, y_range = pp$y_range,
       x_limits = pp$x.range, layers = layers)
}

# The page as recorded: regions in the order placed (plots as records, labels as they are, the logo's box).
# cowplot's draw_plot places its plot through draw_grob, so only the grob holding a picture (the logo) is kept.
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

# The width and height of a PNG file, from its header.
png_size <- function(p) {
  b <- readBin(p, "raw", 24L)
  to_int <- function(x) sum(as.integer(x) * 256^(3:0))
  list(width = to_int(b[17:20]), height = to_int(b[21:24]))
}

notes <- list()
new_session <- function() {
  s <- MockShinySession$new()
  unlockBinding("sendNotification", s)
  s$sendNotification <- function(type, message) {
    if (identical(type, "show"))
      notes[[length(notes) + 1L]] <<- list(type = message$type, text = as.character(message$html))
  }
  lockBinding("sendNotification", s)
  s
}

# ── Scenarios (WA State) ────────────────────────────────────────────────────────────────────────────────────
Q4 <- c("Q1", "Q2", "Q3", "Q4")
scenarios_wa <- function(df) {
  spp <- sort(unique(df$Species.Group))
  spp <- spp[!is.na(spp) & nzchar(spp)]
  yrs <- as.character(sort(unique(df$Reporting.Year)))
  last_year <- yrs[length(yrs)]
  base <- list(county_species = spp, county_species_sub = character(0), county_year = yrs,
               county_quarter = Q4, county_direction = c("Inbound", "Outbound"),
               county_mode = "side_by_side", county_scaling = "log", county_n_bins = "5",
               county_palette = "WSDA Default", county_opacity = 0.6, export_title = "")
  out <- list()
  add <- function(name, changes) out[[name]] <<- modifyList(base, changes)
  add("default", list())
  add("inbound", list(county_direction = "Inbound"))
  add("outbound", list(county_direction = "Outbound"))
  add("combined_total", list(county_mode = "total"))
  add("one_period", list(county_year = last_year, county_quarter = "Q3"))
  add("one_year_two_quarters", list(county_year = last_year, county_quarter = c("Q2", "Q3")))
  add("first_group", list(county_species = spp[1]))
  if (length(spp) > 2) add("two_groups", list(county_species = spp[1:2]))
  add("scale_sqrt", list(county_scaling = "sqrt"))
  add("scale_linear", list(county_scaling = "linear"))
  add("scale_quantile", list(county_scaling = "quantile"))
  add("scale_natural", list(county_scaling = "natural"))
  add("natural_inbound_3", list(county_scaling = "natural", county_n_bins = "3", county_direction = "Inbound"))
  add("opacity_80", list(county_opacity = 0.8))
  add("title_custom", list(export_title = "  Synthetic test map  "))
  add("title_long", list(export_title = strrep("Long custom title ", 6)))
  add("title_step", list(export_title = strrep("X", 70)))
  out
}

# ── Scenarios (National Flow) ───────────────────────────────────────────────────────────────────────────────
scenarios_flow <- function(df) {
  spp <- sort(unique(df$Species.Group))
  spp <- spp[!is.na(spp) & nzchar(spp)]
  yrs <- as.character(sort(unique(df$Reporting.Year)))
  last_year <- yrs[length(yrs)]
  base <- list(flow_direction = "inbound", flow_species = spp, flow_species_sub = character(0), flow_year = yrs,
               flow_quarter = Q4, flow_combine_species = FALSE, flow_scaling = "log", flow_n_bins = "5",
               flow_width_mult = "1.0", flow_opacity = "0.6", flow_palette = "WSDA Default",
               flow_show_state_lines = TRUE, export_title = "")
  out <- list()
  add <- function(name, changes) out[[name]] <<- modifyList(base, changes)
  add("default", list())
  add("outbound", list(flow_direction = "outbound"))
  add("combined", list(flow_direction = "combined"))
  add("combine_species", list(flow_combine_species = TRUE, flow_palette = "Single — WSDA Blue"))
  add("combine_both", list(flow_direction = "combined", flow_combine_species = TRUE, flow_palette = "Muted"))
  add("one_period", list(flow_year = last_year, flow_quarter = "Q3"))
  add("first_group", list(flow_species = spp[1]))
  if (length(spp) > 2) add("two_groups", list(flow_species = spp[1:2]))
  add("scale_sqrt", list(flow_scaling = "sqrt"))
  add("scale_linear", list(flow_scaling = "linear"))
  add("scale_quantile_3", list(flow_scaling = "quantile", flow_n_bins = "3"))
  add("scale_natural", list(flow_scaling = "natural"))
  add("width_3", list(flow_width_mult = "3.0"))
  add("width_hairline", list(flow_width_mult = "0.15"))
  add("opacity_80", list(flow_opacity = "0.8"))
  add("no_state_lines", list(flow_show_state_lines = FALSE))
  add("palette_brand", list(flow_palette = "WSDA Brand"))
  add("title_custom", list(export_title = "  Synthetic flow map  "))
  add("title_long", list(export_title = strrep("Long custom title ", 6)))
  out
}

# ── Scenarios (County Focus) ────────────────────────────────────────────────────────────────────────────────
# The focus counties are the busiest WA counties of the file (animals into and out of them), as the MC reference.
top_counties <- function(df, n) {
  a <- suppressWarnings(as.numeric(df$Total.Animals))
  inb <- df$Movement %in% "Inbound" & df$Dest.State %in% "WA"
  outb <- df$Movement %in% "Outbound" & df$Origin.State %in% "WA"
  keys <- c(as.character(df$Dest.County[inb]), as.character(df$Origin.County[outb]))
  values <- c(a[inb], a[outb])
  ok <- !is.na(keys) & nzchar(keys) & keys != "N/A"
  if (!any(ok)) return(character(0))
  t <- tapply(values[ok], keys[ok], function(v) sum(v, na.rm = TRUE))
  names(t)[order(-t, names(t), method = "radix")][seq_len(min(n, length(t)))]
}
scenarios_focus <- function(df) {
  spp <- sort(unique(df$Species.Group))
  spp <- spp[!is.na(spp) & nzchar(spp)]
  yrs <- as.character(sort(unique(df$Reporting.Year)))
  last_year <- yrs[length(yrs)]
  base <- list(intra_counties = top_counties(df, 2), intra_species = spp, intra_species_sub = character(0),
               intra_year = yrs, intra_quarter = Q4, intra_filter_dir = "combined", intra_mode = "overlap",
               intra_scaling = "log", intra_n_bins = "5", intra_time_enabled = FALSE, intra_opacity = "0.8",
               overlay_layers = character(0), export_overlay_label_layers = character(0), hide_cvi_circles = FALSE,
               export_title = "", export_png_background = "standard")
  out <- list()
  add <- function(name, changes) out[[name]] <<- modifyList(base, changes)
  add("default", list())
  add("one_county", list(intra_counties = top_counties(df, 1)))
  add("four_counties", list(intra_counties = top_counties(df, 4)))
  add("inbound", list(intra_filter_dir = "inbound"))
  add("outbound", list(intra_filter_dir = "outbound"))
  add("one_period", list(intra_year = last_year, intra_quarter = "Q3"))
  add("first_group", list(intra_species = spp[1]))
  add("scale_sqrt", list(intra_scaling = "sqrt"))
  add("scale_linear", list(intra_scaling = "linear"))
  add("scale_quantile_3", list(intra_scaling = "quantile", intra_n_bins = "3"))
  add("scale_natural", list(intra_scaling = "natural"))
  add("opacity_60", list(intra_opacity = "0.6"))
  add("title_custom", list(export_title = "  Synthetic focus map  "))
  add("title_long", list(export_title = strrep("Long custom title ", 6)))
  # Facility layers (tests/synthetic/make_s9_facilities.js, inside Grant and Yakima): shown, named, circles hidden.
  if (identical(sort(base$intra_counties), c("Grant", "Yakima"))) {
    add("facilities", list(overlay_layers = FACILITY_KEYS))
    add("facility_names", list(overlay_layers = FACILITY_KEYS, export_overlay_label_layers = c("markets", "feedlots")))
    add("facilities_only", list(overlay_layers = FACILITY_KEYS, hide_cvi_circles = TRUE))
  }
  if (dir.exists(tiger_src)) {
    add("streets", list(export_png_background = "vector:streets"))
    add("streets_one_county", list(export_png_background = "vector:streets", intra_counties = top_counties(df, 1)))
  }
  out
}
FACILITY_KEYS <- c("markets", "feedlots", "fairgrounds")

# ── Scenarios (Facilities, the Infrastructure dashboard; statewide synthetic layers) ────────────────────────
# The CVI activity pickers keep their values while CVI activity is off, as in CVI's sidebar (every year and
# quarter selected), so the Report caption's period is CVI's in every scenario.
ALL_FACILITY_KEYS <- c("slaughterhouses", "fairgrounds", "markets", "feedlots", "restricted")
scenarios_facilities <- function(df) {
  spp <- sort(unique(df$Species.Group))
  spp <- spp[!is.na(spp) & nzchar(spp)]
  yrs <- as.character(sort(unique(df$Reporting.Year)))
  last_year <- yrs[length(yrs)]
  base <- list(overlay_layers = "feedlots", fac_county = character(0), facilities_png_view = "density",
               facilities_choro_palette = "blue", facilities_output_style = "branded", facilities_show_cvi = FALSE,
               facilities_species = spp, facilities_species_sub = character(0), facilities_year = yrs,
               facilities_quarter = Q4, facilities_scaling = "log", facilities_n_bins = "5",
               facilities_opacity = "0.6", export_overlay_label_layers = character(0), export_title = "",
               export_png_background = "standard")
  out <- list()
  add <- function(name, changes) out[[name]] <<- modifyList(base, changes)
  add("density", list())
  for (pal in c("teal", "green", "gold", "purple", "gray")) add(paste0("density_", pal),
                                                                list(facilities_choro_palette = pal))
  add("density_markets", list(overlay_layers = "markets"))
  add("density_fairgrounds", list(overlay_layers = "fairgrounds"))
  # Layers in the registry's order, as CVI's checkbox group gives them (the order sets each layer's nudge).
  add("density_fallback", list(overlay_layers = c("fairgrounds", "markets", "feedlots")))
  add("locations_one", list(facilities_png_view = "locations"))
  add("locations_all", list(facilities_png_view = "locations", overlay_layers = ALL_FACILITY_KEYS))
  add("names", list(facilities_png_view = "locations", overlay_layers = ALL_FACILITY_KEYS,
                    export_overlay_label_layers = c("markets", "restricted")))
  add("report_density", list(facilities_output_style = "report"))
  add("report_locations", list(facilities_output_style = "report", facilities_png_view = "locations",
                               overlay_layers = ALL_FACILITY_KEYS))
  add("counties", list(facilities_png_view = "locations", overlay_layers = ALL_FACILITY_KEYS,
                       fac_county = c("Kittitas", "Yakima")))
  add("counties_density", list(fac_county = c("Adams", "Grant")))
  add("cvi", list(facilities_png_view = "locations", overlay_layers = ALL_FACILITY_KEYS, facilities_show_cvi = TRUE))
  add("cvi_density", list(facilities_show_cvi = TRUE))
  add("cvi_report", list(facilities_output_style = "report", facilities_png_view = "locations",
                         overlay_layers = c("markets", "feedlots"), facilities_show_cvi = TRUE))
  add("cvi_period_natural", list(facilities_png_view = "locations", overlay_layers = c("markets", "feedlots"),
                                 facilities_show_cvi = TRUE, facilities_year = last_year, facilities_quarter = "Q3",
                                 facilities_scaling = "natural"))
  add("cvi_first_group", list(facilities_png_view = "locations", facilities_show_cvi = TRUE,
                              facilities_species = spp[1], facilities_opacity = "0.8"))
  add("title_custom", list(export_title = "  Synthetic facilities map  "))
  add("title_long", list(export_title = strrep("Long custom title ", 6)))
  out
}

# ── Scenarios (the National Flow time-series GIF) ──────────────────────────────────────────────────────────
# Each ticks only "Time-series GIF (.gif)". The view's style choices are set off their defaults in "styled", to show
# that CVI's frames ignore them. "sparse_group" picks the species group with the fewest
# periods, so empty periods are skipped.
scenarios_gif <- function(df) {
  out <- scenarios_flow(df)[c("default", "outbound", "combined", "combine_species", "first_group", "title_custom")]
  out <- lapply(out, function(x) modifyList(x, list(export_viz = "branded_gif", gif_frame_by = "quarter")))
  base <- out$default
  add <- function(name, changes) out[[name]] <<- modifyList(base, changes)
  yrs <- as.character(sort(unique(df$Reporting.Year)))
  periods <- unique(df[!is.na(df$Reporting.Year) & !is.na(df$Species.Group), c("Species.Group", "Reporting.Year",
                                                                                 "Reporting.Quarter")])
  sparse <- names(which.min(table(periods$Species.Group)))
  add("year", list(gif_frame_by = "year"))
  add("two_quarters", list(flow_quarter = c("Q3", "Q2")))
  add("one_year", list(flow_year = yrs[length(yrs)]))
  add("sparse_group", list(flow_species = sparse))
  add("sparse_group_year", list(flow_species = sparse, gif_frame_by = "year"))
  add("styled", list(flow_scaling = "natural", flow_n_bins = "3", flow_width_mult = "2.0", flow_opacity = "0.9",
                     flow_show_state_lines = FALSE, flow_palette = "WSDA Brand"))
  out
}

VIEWS <- list(
  wa = list(button = "show_county", scenarios = scenarios_wa),
  flow = list(button = "show_flow", scenarios = scenarios_flow),
  focus = list(button = "show_intrastate", scenarios = scenarios_focus),
  facilities = list(button = "show_facilities", scenarios = scenarios_facilities),
  gif = list(button = "show_flow", scenarios = scenarios_gif))
run_views <- strsplit(Sys.getenv("S9_VIEWS", unset = paste(names(VIEWS), collapse = ",")), ",")[[1]]
if (length(setdiff(run_views, names(VIEWS)))) stop("Unknown view: ", paste(setdiff(run_views, names(VIEWS)), collapse = ", "))

# The rows and choices a renderer was given, as plain values.
plain_rows <- function(d) {
  d <- if (inherits(d, "sf")) sf::st_drop_geometry(d) else as.data.frame(d)
  as.data.frame(lapply(d, function(col) if (is.list(col)) vapply(col, function(v) paste(v, collapse = "|"), "")
                       else if (is.factor(col)) as.character(col) else col), stringsAsFactors = FALSE)
}
render_record <- function(r) {
  a <- r$args
  keep <- setdiff(names(a), c("county_df", "flow_sf", "focus_df", "county_polys_path", "logo_path", "output_path",
                               grep("^overlay_.*_sf$", names(a), value = TRUE)))
  out <- lapply(a[keep], function(v) if (is.null(v)) NULL else if (length(v) > 1 || !is.null(names(v)))
    I(if (is.null(names(v))) v else as.list(v)) else v)
  if (r$view == "wa") {
    cd <- a$county_df
    out$county_df <- data.frame(county = cd$county, direction = cd$direction, lat = cd$lat, lon = cd$lon,
                                total_animals = cd$total_animals, radius_px = cd$radius_px)
  }
  if (r$view == "flow") out$flow_rows <- plain_rows(a$flow_sf)
  if (r$view == "focus") {
    out$focus_rows <- plain_rows(a$focus_df)
    ov <- a[grep("^overlay_.*_sf$", names(a), value = TRUE)]
    out$overlays <- lapply(ov[!vapply(ov, is.null, TRUE)], function(x) nrow(x))
  }
  if (r$view == "facilities") {
    # Each layer's rows as given (after the dashboard's county and attribute filters), the CVI circles, and the
    # coverage view the renderer drew.
    out$overlay_sf_list <- NULL
    out$layers <- lapply(a$overlay_sf_list, function(x) {
      if (is.null(x)) return(NULL)
      xy <- sf::st_coordinates(x)
      d <- sf::st_drop_geometry(x)
      data.frame(name = d$ref_name, lon = xy[, 1], lat = xy[, 2], geo_source = d$geo_source,
                 county = if ("._county" %in% names(d)) d[["._county"]] else NA_character_,
                 stringsAsFactors = FALSE)
    })
    if (!is.null(a$cvi_circle_df)) {
      cd <- a$cvi_circle_df
      out$cvi_circle_df <- data.frame(county = cd$county, direction = cd$direction, lat = cd$lat, lon = cd$lon,
                                      total_animals = cd$total_animals, radius_px = cd$radius_px)
    }
    out$view_used <- r$view_used
  }
  out
}

# ── Run every fixture ───────────────────────────────────────────────────────────────────────────────────────
for (fx in names(fixtures)) {
  t0 <- Sys.time()
  df <- suppressWarnings(load_master_csv(fixtures[[fx]]))
  if (is.null(df)) stop("CVI's loader refused ", fx)
  json_file <- file.path(out_dir, paste0("oracle_s9_", fx, ".json"))
  old <- if (file.exists(json_file)) fromJSON(json_file, simplifyVector = FALSE) else NULL
  result <- list(fixture = fx, file = sub(paste0(repo_root, "/"), "", fixtures[[fx]]),
                 file_sha256 = sha256(fixtures[[fx]]), species_universe = I(sort(unique(df$Species.Group))),
                 views = list())
  # Views not run this time are kept from the earlier record of the same file.
  if (!is.null(old) && identical(old$file_sha256, result$file_sha256)) {
    for (v in setdiff(names(old$views), run_views)) result$views[[v]] <- old$views[[v]]
    if (!("facilities" %in% run_views)) result$facility_anchors <- old$facility_anchors
  }
  box <- new.env()
  box$recs <- list()
  sess <- new_session()
  testServer(mod_maps_server, args = list(rv = reactiveValues(master_df = NULL),
             project_root = cvi_root, scripts_dir = cvi_root), session = sess, {
    rv$master_df <- df
    session$flushReact()
    map_state$county_polygons <- county_polygons
    session$setInputs(export_tables = character(0), export_viz = "branded_png", export_gis = character(0),
                      export_png_background = "standard", export_quality = "standard", export_label = "")
    click <- 0L
    for (view in run_views) {
      if (view == "facilities" && fx != "tier_full") next
      write_counties(if (view == "facilities") 3857 else 4326)
      do.call(session$setInputs, setNames(list(1L), VIEWS[[view]]$button))
      session$elapse(300)
      if (view %in% c("focus", "facilities")) {
        use_facilities(if (view == "facilities") fac_wa_dir else fac_dir)
        map_state$overlays <- lapply(.OVERLAY_REGISTRY, function(s) load_overlay_csv(s$file, s$name_col))
        session$flushReact()
        session$elapse(300)
      }
      recs <- list()
      for (name in names(VIEWS[[view]]$scenarios(df))) {
        inputs <- VIEWS[[view]]$scenarios(df)[[name]]
        do.call(session$setInputs, inputs)
        session$elapse(300)
        unlink(file.path(cvi_root, "exports"), recursive = TRUE)
        placed <<- list(); saved <<- NULL; renders <<- list(); notes <<- list(); gif_calls <<- list()
        gif_mode <<- view == "gif"
        click <- click + 1L
        session$setInputs(run_export = click)
        session$elapse(100)
        gif_mode <<- FALSE
        rec <- list(inputs = inputs, notes = notes)
        if (view == "gif") {
          # The GIF call, its frame list, and each frame drawn: its rows, choices and page.
          rec$gif <- if (length(gif_calls)) gif_calls[[1]] else NULL
          rec$frames <- lapply(renders, function(r) list(render = render_record(r), saved = r$saved, page = r$page))
          rec$files <- I(sort(list.files(file.path(cvi_root, "exports"), recursive = TRUE)))
          gif <- list.files(file.path(cvi_root, "exports"), pattern = "[.]gif$", recursive = TRUE, full.names = TRUE)
          if (length(gif)) {
            # CVI's fallback wrote the first frame's PNG under the .gif name; kept for side-by-side comparison.
            rec$gif_file_png <- png_size(gif[1])
            keep_as <- file.path(png_dir, paste0(fx, "_gif_", name, "_frame1.png"))
            file.copy(gif[1], keep_as, overwrite = TRUE)
            rec$png_file <- sub(paste0(repo_root, "/"), "", keep_as)
          }
          recs[[name]] <- rec
          next
        }
        if (length(renders)) {
          rec$render <- render_record(renders[[1]])
          rec$saved <- saved
          rec$page <- page_record()
          files <- list.files(file.path(cvi_root, "exports"), pattern = "[.]png$", recursive = TRUE,
                              full.names = TRUE)
          if (length(files)) {
            rec$png <- png_size(files[1])
            keep_as <- file.path(png_dir, paste0(fx, "_", view, "_", name, ".png"))
            file.copy(files[1], keep_as, overwrite = TRUE)
            rec$png_file <- sub(paste0(repo_root, "/"), "", keep_as)
          }
        }
        recs[[name]] <- rec
      }
      box$recs[[view]] <- recs
      if (view == "gif") session$setInputs(export_viz = "branded_png")
    }
  })
  for (v in names(box$recs)) result$views[[v]] <- box$recs[[v]]
  # CVI's county anchors (.county_label_anchor on the counties in EPSG:3857, as the Facilities renderer reads them),
  # in longitude/latitude: where the Locations view's circles and the county names start.
  if ("facilities" %in% run_views && fx == "tier_full") {
    merc <- sf::st_transform(county_polygons, 3857)
    anchors <- sf::st_coordinates(sf::st_transform(.county_label_anchor(merc), 4326))
    result$facility_anchors <- data.frame(name = county_polygons$name, lon = anchors[, 1], lat = anchors[, 2])
  }
  result$meta <- list(cvi_rev = cvi_rev, cvi_sources = as.list(expected_sha), pinned_date = format(PINNED_DATE),
    r = R.version.string, ggplot2 = as.character(packageVersion("ggplot2")),
    cowplot = as.character(packageVersion("cowplot")), sf = as.character(packageVersion("sf")),
    scales = as.character(packageVersion("scales")), shiny = as.character(packageVersion("shiny")),
    generated = format(Sys.time(), tz = "UTC", usetz = TRUE))
  write_json(result, json_file, auto_unbox = TRUE, digits = NA, null = "null", na = "null", pretty = FALSE)
  for (v in names(box$recs)) {
    drawn <- sum(vapply(box$recs[[v]], function(r) if (v == "gif") length(r$frames) else !is.null(r$png), 0))
    cat(sprintf("s9 %s %s: %d scenarios, %d %s\n", fx, v, length(box$recs[[v]]), drawn,
                if (v == "gif") "frames" else "PNGs"))
  }
  cat(sprintf("s9 %s: %.0f s\n", fx, as.numeric(difftime(Sys.time(), t0, units = "secs"))))
}
unlink(cvi_root, recursive = TRUE)
cat("s9 oracle: complete\n")
