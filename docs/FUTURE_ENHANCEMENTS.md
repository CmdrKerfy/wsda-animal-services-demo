# Possible future enhancements

Ideas to revisit after the CVI and Infrastructure release. Nothing here is scoped or approved; each entry gets its own
scope and approval when its time comes.

## Entries

1. **More circle and line scaling options.** The pages offer CVI's five (Logarithmic, Square root, Linear, Quantile,
   Natural breaks) with CVI's defaults (Logarithmic for circles, Natural breaks with 5 bins for National Flow's
   lines), kept on purpose. Candidates: Equal interval and Standard deviation (estimated about a day for both: a class
   rule each in `site/cvi/app/scaling.js`, reaching WA State and Compare, National Flow, County Focus and its
   clusters, Infrastructure's CVI activity, the live and PNG legends, the GIF's shared scale, `export_params.json` and
   the "?" notes, with an R reference from classInt since CVI has neither); manual breaks (about two more days: a
   control to type the breaks on each map, checks on what is typed, Reset All, legends labeled from the typed values,
   and numbered browser test steps). Manual breaks look the most useful; start there if someone asks for it.

2. **Location precision (CVI's P1-3).** Today a facility whose `geo_source` is blank, missing or not recognized
   counts as a precise location, as in CVI. CVI plans three states (precise, town-level, unknown), with unknown left
   out of distance results; as of 2026-10-16 CVI has not built it or settled which values count as precise. Revisit
   once CVI builds it: about 1.5 to 2 days here (`site/shared/facilities.js`, `facility-details.js`,
   `site/infrastructure/branded.js`, `site/cvi/app/lookup.js`, fixtures, the S6, S9 and S11 checks and R
   references), with before-and-after screenshots. Recorded as a known limit of the CVI and Infrastructure release
   (`site/README.md` "Known limits of the CVI and Infrastructure release"); planned with the movement-view GIF as the
   first update after the release.

3. **Agricultural coverage (S12; CVI's Coverage tab, planned there as Access Scenarios).** Not settled in CVI (its
   data, method and privacy have no approval yet). The release shows a grayed "Coverage (planned)" control on the
   Infrastructure dashboard. Develop it with the Emergency dashboard: one shared design for distance to the nearest
   facility, points inside a buffer and coverage counts, which S12 then uses once CVI approves its method; avoid
   CVI's banned claims (demand, service area, capacity, access, service gap).

4. **More time-series GIFs.** Left out of the WA State and County Focus GIFs on purpose: a GIF of WA State's movement
   lines (its lines are ranked per period, so it needs its own rule for one width scale across periods), a GIF on the
   Infrastructure dashboard or Premise Lookup, tile backgrounds inside a GIF (256 colors per frame make photo tiles
   blotchy and files large), and a video format. **Planned:** the movement-lines GIF is the first small update after
   release, with entry 2, with its own short scope (about a day: which pairs are drawn and one width scale across all
   frames).

5. **More shaded-map views.** Left out of the shaded maps on purpose: shaded counties for the Infrastructure
   dashboard's CVI activity (its own Density view already shades counties by facilities, and two fills on one map
   clash); a "net" view (more animals in than out, or the reverse, on a two-color ramp); a two-direction (bivariate)
   map; animals per resident; hexagon bins. Also: the shaded maps show at most five classes, since six or seven from
   ColorBrewer's 9-class ramps put neighboring colors too close to tell apart (ΔE 5.8 to 7.3); more classes would need
   a ramp designed for them.

6. **A shorter sidebar.** The sidebar has grown long. Today some controls are grayed with a reason (shaded maps, the
   movement lines, National Flow's population layers) and others stay shown. To explore: hiding or folding controls
   that cannot apply to the view and mode on screen (with a short note of where they went), folding the less used
   style controls under a "More options" fold, and remembering which folds the user opened. Start with a short scope
   and before-and-after screenshots of the sidebar.

7. **The spotlight outline's look.** The spotlit county on WA State's shaded map, and a state picked in a chart on
   National Flow's, are outlined in white (3 px live, a little wider than the county lines on the PNG). On the
   lightest classes white is close to the white county lines; the alternatives considered are near-black, dark gray
   and WSDA Gold. Revisit with real use.

8. **Every color a facility layer can be given.** Colors in hex, `rgb()` and `rgba()` are read and compared when
   marks are given out; a color name (such as `teal`) or `hsl()` is drawn as written but compared as text, so it
   could share a shape with the same color written in hex. To do: read every CSS color (for example through the
   browser's own color parsing) so the comparison covers them too.

9. **Three Top lists on the shaded PNG.** The shaded map's PNG now shows one Top 5 list ranked by the Combined value,
   with each county's Total, In and Out. The alternative kept for later, pending users' feedback: three lists stacked,
   the Combined top, then the Top Inbound and the Top Outbound, each its own ranking. Its drawbacks: the taller box
   runs into the circles' legend, so it needs a shorter legend or smaller rows; a county can appear in one list and
   not another.

10. **A provenance footer inside exported pictures** (not drawn for this release; it may be too much on a PNG). Each
    branded PNG already carries a source line ("Data: … · County boundaries: U.S. Census Bureau"), and
    `export_params.json` records the choices behind an export. To decide later: a fuller provenance block (file
    names, preparation date, filters) as an optional footer, shown first as a mock-up beside today's PNG.

11. **CVI's later candidates** (none in this release). From CVI's own list of later work, not built in CVI either: a
    preferences page (settings kept in the browser), color by an attribute for one facility layer, glyph and label
    size controls for the facility PNGs, a small-multiples grid export (high on CVI's list), and a directional
    gradient along the flow lines. (CVI's Alaska and Hawaii insets, also on that list, were built for this release.)

12. **A size limit for the CVI master table.** The loader accepts any file up to 512 MB, but a master is read whole
    and takes about 25 times its size in the browser's memory, so a very large one is slow or fails with no word
    about its size (a known limit in `site/README.md`). To do: refuse a master over a practical size (about 64 MB)
    in the checklist, with a plain message naming the limit, keeping the 512 MB cap for files that are only checked
    by their first lines.

13. **A "?" note for every control with help.** 41 controls have a "?" note that opens on a click and is read by
    screen readers, WA State's Display Mode among them. A few controls still carry their help only as hover text,
    which keyboard and touch users cannot reach: WA State's Direction and Lines shown, the PNG's Label style and
    Boundary style, the Map View, layout and Preview buttons, and Compare with. To do with the shorter sidebar
    (entry 6), so the notes do not lengthen it.

14. **Datasets and columns the pages do not know yet.** How to handle new datasets and columns users might add that
    the code does not account for. What the pages do today:
    - A CVI master table's extra columns are kept with each row and written to `filtered_rows.csv` as they are, but
      no map, chart, filter or count uses them. A required column under another name (for example `Dest County` for
      `Dest.County`) is not recognized: the file is listed as not used, with the missing column named.
    - A facility file keeps only its name, location, location precision and town columns, plus its filter columns:
      the ones a manifest names (`filter_cols`), or else text columns with 2 to 30 different values, chosen as CVI
      chooses them. Every other column is left out, and personal or noisy columns (owner, contact, address, phone,
      e-mail, notes and the like) are never offered or shown, whatever the manifest says.
    - A CSV that no dashboard knows is listed under "Your files" as not used, with its columns shown, and goes no
      further. New facility layers need a manifest row; a new kind of dataset needs code.
    Ideas, each to be scoped and approved on its own:
    - **Column names under other spellings:** accept small differences (case, spaces, dots and underscores) and a
      list of known other names per column, and let the checklist ask "which of your columns is Dest.County?" when a
      file is a near miss, keeping the answer in `bundle.json` so the next load needs no question.
    - **Extra master columns as filters:** offer a column the code does not know as an optional filter (a pick list
      for a text column with few values, a range for a number), with the choice written in `export_params.json`.
    - **A plain point file as a map layer:** a CSV with a name and latitude and longitude, but no manifest row, could
      be offered as a facility layer after the user names it in the checklist.
    - **More facility columns in the details pop-up:** columns a manifest names for display (not as filters), with
      the same screen that keeps personal columns out today.
    - **A dataset list a curator can extend:** a file in the bundle that describes a new dataset (its name, the
      columns it needs and which dashboard reads it), so a new table can be recognized and listed without a code
      change; what the dashboards draw from it would still need code.
    - **A version in `bundle.json`:** so a CVI export whose columns changed is caught with a message that names the
      change, rather than as a file that is not used.
    Each would keep the current rules: nothing leaves the browser, personal columns stay out, the size limits hold,
    and each new behavior gets its own tests.

## Noted for other work

- File picks that need a second try when switching files in Safari: a known limit in `site/README.md`; the cause is
  still to be looked at.
- Neighbor counties filled like Washington where located rows fall in them: a later cross-border data piece.
- A footprint grown outward as a buffer zone (irregular buffers, for example a dairy's footprint): the Emergency
  dashboard's scope. A network address lookup, if one is ever added, would be the Census geocoder only, opt-in and
  with a notice, and needs the agency's decision.
