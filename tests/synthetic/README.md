# Synthetic tests

Only deliberately synthetic, non-identifying fixtures may be placed here.
Every fixture should state what behavior it tests and how it was generated.


## `cvi_master_s2.csv` (S2: WA map summaries)

Hand-written, made-up rows in the CVI master shape (same 15 columns as `cvi_master_small.csv`). Each row is there for
one edge of the value boxes and summary strip, checked against CVI's own WA map module (`tests/oracle/cvi_r_oracle.R`,
S2 section) and by hand in `tests/node/run_s2_unit_tests.js`:

- S001 twice: identical WA-to-WA rows (CVI counts one; the page counts both, by design).
- S003: marked Intrastate but going to Oregon (CVI does not merge its two loader copies; neither does the page).
- S004: Import and Export of the same WA-to-WA movement (CVI merges them; the page counts both, by design).
- S005: lowercase `wa` destination state; S024/S025: identical except `CVI` (merged by CVI once the column is dropped).
- CVI values: blank, `NA`, `" S007 "` (padded) and `S007` (one certificate).
- Top-species ties: Llama/Alpaca (two rows each); 2023 is a three-way tie in which an intrastate row counts twice.
- Years 2023, 2024, 2026 (a gap) with missing quarters; Okanogan only in 2026; S021 has no year; S022 uses the
  `Imports` spelling, quarter `1` and `King County` (the loader's normalizations).
- 2023 Q2 Cattle sums to 0 (zero styling); 2026 Q1 Swine is 100,000 (R shows `1e+05`); S020 has no animal count;
  S019 has coordinates but no destination county (CVI counts it in "WA counties", the map draws no circle).

The S2 oracle also runs it with the `CVI` column removed after loading (`cvi_master_s2_nocvi`) and with S014's count
set to infinity after loading (`cvi_master_s2_inf`; R prints `Inf`).

## `cvi_master_s2_numcvi.csv` (S2: an all-numeric CVI column)

Five made-up rows whose `CVI` values are all plain numbers (`00123`, `123`, `123.0`, `456`, blank). CVI's loader then
reads the column as numbers, so `00123`, `123` and `123.0` are one certificate in CVI's "Unique CVIs" (2 in all) and
three on the page (3). Real CVI numbers always mix letters and digits, so CVI reads them as text and both count the
same; this file only documents the difference, and the S2 unit tests require it to be exactly this.

## `cvi_master_s4.csv` (S4: National Flow)

Hand-written, made-up rows in the CVI master shape (the same 15 columns), written by
`tests/synthetic/make_cvi_master_fixtures.js` (each row commented there). Checked against CVI's own map module
(`tests/oracle/cvi_r_oracle.R`, S4 section) by `tests/node/run_s4_unit_tests.js`:

- Inbound and outbound rows with 15 states, including Alaska and Hawaii (lines, no outline or label) and a total of exactly
  100,000 (R shows `1e+05` when it stands alone).
- Partners without a center: `XX`, `BC`, a quoted blank state and a missing one; lowercase `wa` as origin or destination
  (exact text, so not Washington).
- A row marked Intrastate going to Oregon (both loader copies drawn and counted), a row with no Movement (drawn on the
  Flow map), a row marked Import from Washington to Idaho (Outbound on the Flow map).
- Nevada's inbound total is 0; Utah has a missing and a non-numeric count; Colorado and Arizona tie (width and drawing
  order); the group `Camelids` is in no palette (`#999999`) and has a fractional count (2.5); the group `constructor`
  (named like a JavaScript object property) from Wyoming is in no palette either.
- Eight raw Cattle species from California and eight species groups from Idaho (top 6 plus "Other: N").
- 2025 Q2 has only WA-to-WA rows (the Flow slider skips it); one row has no year.

## `cvi_master_small.csv` (S1: WA State map basics)

Twenty-two hand-written, made-up rows in the CVI master shape (15 columns). Each row is there for one rule of the WA
State map: the movement spellings (`Import`, `import`, `Imports`, `EXPORTS`, `Inbound`, `Outbound`, `intrastate`), `King`
beside `King County`, quarters written `Q1` and `1`, one CVI on two rows, a species name with a comma, blank, non-numeric
and zero counts, a row with no Movement and one with no year. Read by the S1 suites, the S1 part of
`tests/oracle/cvi_r_oracle.R` and `make_bundles.js` (the ZIP cases).

## `cvi_master_small_expected.json` (S1: hand oracle)

The expected map for `cvi_master_small.csv`, worked out by hand from CVI's mapping rules: county totals, which
counties each direction includes, label anchors and circle radii (log, linear and square root) for eight views.
Independent of the R and JavaScript code; read by `tests/node/run_s1_unit_tests.js`.

## `cvi_master_wa39.csv` (S1: all 39 WA counties)

About 1,500 made-up rows covering every WA county over two years and four quarters, written by
`make_cvi_master_fixtures.js` (through `site/cvi/sample.js`, which also builds the landing page's sample). Counts, CVI
numbers and coordinates are invented; the county points are the Census-derived label points of `site/geo/wa-counties.js`.

## `cvi_master_movement.csv` (MC: within-state movement)

About 600 made-up rows written by `make_cvi_movement_fixtures.js`: a few heavy corridors between neighboring counties,
within-county movement, a long tail of light pairs, some interstate rows, and edge rows at the end (one rule each).
Read by the MC suites and `tests/oracle/mc_oracle.R`.

## `nr_crossborder.csv` (NR: places across the border)

Thirty made-up places, each a facility site or a master's origin or destination in Washington, Idaho, Oregon, British
Columbia or outside them, with the result expected from `locate()` and `resolve()` (`ok` with its county key,
`mismatch`, `unknown`, `outside` or `none`) and a note saying why. Read by `tests/node/run_nr_unit_tests.js`.

## `f1_checklist_matrix.json` (F1: expected checklists)

Written by hand from the loader's rules, not from its code: for each bundle case made by `make_bundles.js` (the tiers
and the negative cases), the dataset each file is used as, the files not used and why, and the features offered. Read
by the F1 unit and Chrome suites and the Safari core run.

## Generators

Each generator is deterministic (no clock, no random numbers without a fixed seed) and writes only synthetic values.
Run them from the repository root; `tests/README.md`, section 2, gives the order.

- `make_cvi_master_fixtures.js` rewrites the committed `cvi_master_wa39.csv` and `cvi_master_s4.csv`.
- `make_cvi_movement_fixtures.js` rewrites the committed `cvi_master_movement.csv`.
- `make_bundles.js` writes the F1 example bundles under `local-test-artifacts/f1/`: ZIPs written the way common tools
  write them, damaged and hostile archives, the Full, Partner and Public tiers, the negative cases and the
  landing page's sample. The F1 unit suite runs it.
- `make_test_tables.js` copies synthetic tables into `test-tables/` for the suites and for trying the pages by hand;
  it keeps any file it did not make. The F1 unit suite runs it at the end.
- `make_cvi_focus_fixtures.js --<mode>` writes the County Focus (S5) inputs under `local-test-artifacts/s5/`, one mode
  per call: `--scaling-gate`, `--membership`, `--premises`, `--payloads`, `--module-route`, `--module-facilities`,
  `--module-tiers`, `--facilities` and `--clusters`.
- `make_cvi_facilities_fixtures.js` writes the Infrastructure (S6) inputs to `local-test-artifacts/s6/day1/`; with
  `--entryflow`, the entry-flow fixtures to `local-test-artifacts/s6/day2/fixtures/`.
- `make_cvi_s7_fixtures.js` writes the Charts (S7) master, with all 38 of CVI's master columns and the values CVI's
  CSV reader and writer treat specially, to `local-test-artifacts/s7/fixtures/`.
- `make_s9_facilities.js` writes facility layers for the branded PNGs (S9): one set inside the two focus counties
  (`local-test-artifacts/s9/facilities/`) and one statewide set (`local-test-artifacts/s9/facilities-wa/`).
- `make_s9_tiles.js` is a module, not a command: the S9 Chrome suite uses it to answer the page's map-tile requests
  with checkerboard PNGs, so the tile backgrounds are tested with no network.
- `make_s11_fixtures.js` writes the Premise Lookup (S11) scenarios to `local-test-artifacts/s11/fixtures/` and the
  `s11_*` files to `test-tables/`.
