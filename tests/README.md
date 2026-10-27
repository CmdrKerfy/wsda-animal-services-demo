# Tests

The test suites for the static pages in `site/`. Every command below runs from the repository root. All test data is
synthetic. Outputs go to `local-test-artifacts/` and `test-tables/`, both ignored by Git. The fixtures and their
generators are described in [`synthetic/README.md`](synthetic/README.md).

| Folder | What is in it |
|---|---|
| `node/run_*_unit_tests.js` | Unit suites in plain Node: the pages' own modules, run outside a browser |
| `browser/run_*_browser.js` | Google Chrome suites, driven through the DevTools protocol (headless, a throw-away profile) |
| `browser/run_safari.js` | The Safari suite, driven through Apple's `/usr/bin/safaridriver` (a visible window) |
| `browser/serve_case_strict.js` | A local http server for `site/` that refuses a path with the wrong letter case |
| `mutation/run_*_mutations.js` | Mutation runners: each changes one piece of code in a copy, and the named suite must fail |
| `oracle/*.R` | R scripts that run CVI's own functions (or read public sources) and write reference files |
| `synthetic/` | Synthetic fixtures and their generators; `make_test_tables.js` fills `test-tables/` |
| `chain/` | The full regression chain's scripts (section 4) |

How the pages themselves are built is in [`docs/DEVELOPER_GUIDE.md`](../docs/DEVELOPER_GUIDE.md).

## 1. Requirements

- **macOS.** The suites were built and run on a Mac. The F1 unit suite also reads ZIPs made by the system `zip` and
  `ditto`; the Safari suite needs Safari.
- **Node.js 22 or newer** (last tested with 25.9.0). No npm packages: nothing is installed by any suite.
- **Google Chrome** in `/Applications`, or its program path in `CHROME_BIN`.
- **Safari**, for the Safari steps: Safari Settings, Advanced, "Show features for web developers"; then Settings,
  Developer, "Allow remote automation".
- **R 4.4** (last tested with 4.4.3) for the oracle scripts, with these packages already installed: `dplyr`,
  `data.table`, `geosphere`, `sf`, `classInt` (0.4-11), `jsonlite`, `openssl`, `shiny`, `bslib`, `shinyjs`, `cli`,
  `glue`, `DT`, `mapgl`, `bsicons`, `scales`, `ggplot2`, `rlang`, and for the S9 reference also `cowplot`, `png` and
  `shadowtext`. The scripts load several of these through CVI's own code. `gifski` is not needed.
- **The CVI_Traceability checkout** beside this repository (`../CVI_Traceability`). CVI_Traceability is an internal
  WSDA repository; it is not published with a public copy of this project. Without it, the F1, CH, UI and NR suites
  (Node and Chrome), the AB, CH and UI mutation runners and the Safari `--ab`, `--ui` and `--ch` parts still run; every
  other suite compares the pages with references written from CVI's own code and needs the checkout. The oracle
  scripts and the S9 unit suite also accept another location in the environment variable `CVI_TRACEABILITY_DIR`,
  but the S5 and S6 unit suites (and the S5 mutation runner) read `../CVI_Traceability` directly, so keep the
  checkout beside the repository; the UI unit suite checks CVI's font file only when the checkout is there. CVI's
  files are only read.
- **The RAD_Animal_Diseases checkout** beside this repository (`../RAD_Animal_Diseases`, or the environment variable
  `RAD_ANIMAL_DISEASES_DIR`), for the Emergency R reference only: it runs RAD's `premises_zone_eligible()` unchanged
  (the same reference also runs CVI's `run_proximity_query`, so it needs the CVI checkout too).
  Its files are only read.
- **Public source files** (not in the repository; see `site/PROVENANCE.md`): the Census and Statistics Canada zips in
  `local-test-artifacts/nr/` for `nr_regions_check.R` and `s4_states_check.R`, and the four population downloads in
  `local-test-artifacts/pc/src/` for `pc_population_oracle.R`. Without them those scripts stop or report "not run".

## 2. Preparation, in order

Most suites compare the pages with reference files written by earlier steps. On a fresh clone, run these once, in
this order. Later, rerun a step only when its inputs change (CVI's checkout, an oracle script or a fixture): the
Node suites check the references' SHA-256 digests and say when one is stale. Without any R reference, and without
the CVI_Traceability checkout, the F1, CH, UI and NR unit suites already run on a fresh clone; the others stop or
fail with a message naming the R script to run first (for example "S3 oracle missing: run Rscript
tests/oracle/cvi_r_oracle.R first"), and those R scripts need the checkout.

1. `node tests/synthetic/make_cvi_master_fixtures.js` regenerates the committed `cvi_master_wa39.csv` and
   `cvi_master_s4.csv`; `git status` must then show them unchanged. Optional, as a check.
2. `node tests/node/run_f1_unit_tests.js` writes the example bundle tiers (Full, Partner, Public), the negative
   cases and the sample bundles under `local-test-artifacts/f1/`, and rewrites the synthetic tables in
   `test-tables/` (through `make_test_tables.js`; files it does not make are kept). Almost every later step reads
   the tiers.
3. `Rscript tests/oracle/cvi_r_oracle.R` (about 12 minutes; parts `s1 s1_1 s2 s3 s4` by default) writes
   `local-test-artifacts/s1/`, `s2/`, `s3/` and `s4/` for the S1 to S4 suites and the Safari core run. A part can be
   run alone, for example `Rscript tests/oracle/cvi_r_oracle.R s4`.
4. County Focus (S5): for each check, the generator, then the R mode (writes `local-test-artifacts/s5/`):
   - `node tests/synthetic/make_cvi_focus_fixtures.js --membership`, then `Rscript tests/oracle/s5_membership_check.R`
   - `node tests/synthetic/make_cvi_focus_fixtures.js --<mode>`, then `Rscript tests/oracle/cvi_r_oracle.R s5-<mode>`,
     for each mode of `premises`, `payloads`, `module-route`, `module-facilities`, `module-tiers` and `facilities`
     (for example `--premises`, then `s5-premises`)
   - `node tests/synthetic/make_cvi_focus_fixtures.js --scaling-gate`, then `Rscript tests/oracle/cvi_r_oracle.R s5`
   - `S5_MATRIX_TIER=<tier> Rscript tests/oracle/cvi_r_oracle.R s5-module-matrix` for `fixture`, `full`, `partner`
     and `public`
   - `node tests/synthetic/make_cvi_focus_fixtures.js --clusters` (for the S5 Chrome suite; the chain repeats it)
5. Infrastructure (S6): `node tests/synthetic/make_cvi_facilities_fixtures.js`, then
   `Rscript tests/oracle/s6_facilities_oracle.R` (several minutes; writes `local-test-artifacts/s6/day1/`), then
   `node tests/synthetic/make_cvi_facilities_fixtures.js --entryflow` and
   `Rscript tests/oracle/s6_facilities_oracle.R --activity` (also writes `local-test-artifacts/s6/day5/`).
6. Charts (S7): `node tests/synthetic/make_cvi_s7_fixtures.js`, then `Rscript tests/oracle/s7_charts_oracle.R`
   (about 8 minutes; writes `local-test-artifacts/s7/oracle_s7_*.json`).
7. Movement and chart filters (MC, after step 6): `node tests/synthetic/make_cvi_movement_fixtures.js`, then
   `Rscript tests/oracle/mc_oracle.R` (about 8 minutes; writes `local-test-artifacts/mc/`).
8. Branded PNGs and GIFs (S9): `node tests/synthetic/make_s9_facilities.js`, then
   `Rscript tests/oracle/s9_branded_oracle.R` (about 40 minutes for every view; `S9_VIEWS=gif` or another list runs
   only those views; writes `local-test-artifacts/s9/`, with CVI's own PNGs in `s9/cvi/`).
9. Population context (PC, after step 8, whose fixture and facility files it reuses):
   `Rscript tests/oracle/pc_population_oracle.R` writes `local-test-artifacts/pc/oracle_pc.json`.
10. Premise Lookup (S11, after step 2): `node tests/synthetic/make_s11_fixtures.js` writes
    `local-test-artifacts/s11/fixtures/` and the `s11_*` files in `test-tables/`; then
    `Rscript tests/oracle/s11_proximity_oracle.R` (about 2 minutes) writes `local-test-artifacts/s11/`. Run the
    fixtures again after every F1 unit run, since that run rewrites the tiers and `test-tables/`.
11. Optional source checks: `Rscript tests/oracle/nr_regions_check.R` (the region files against their sources) and
    `Rscript tests/oracle/s4_states_check.R` (the state files against theirs). Exit status 2 means a source is missing.
12. Emergency Response: `node tests/synthetic/make_em_fixtures.js`, then `Rscript tests/oracle/em_oracle.R` (seconds;
    it also checks the agreed-table scenario: groups, miles, days since and the page's `zones.geojson` read with sf;
    reads RAD's `core/premises_registry.R` from the `../RAD_Animal_Diseases` checkout, or `RAD_ANIMAL_DISEASES_DIR`;
    writes `local-test-artifacts/em/oracle_em.json`).

The CH (shaded maps) and UI suites need only `test-tables/`, written by step 2 or by
`node tests/synthetic/make_test_tables.js`. The scale suite and the Emergency Chrome suite's `speed` part need
`node tests/synthetic/make_scale_master.js` first (a 50,000-row synthetic master, 17 MB, in `local-test-artifacts/scale/`).

`test-tables/` holds synthetic tables collected in one folder, read by the suites and handy for trying the pages by
hand (some steps pick two files at once). The F1 unit run and `make_test_tables.js` rewrite the files they make there
and keep any other file; `make_s11_fixtures.js` adds the `s11_*` files. `test-tables/README.txt` lists what each file
is for.

Run every R script as a background job (they take minutes and open no browser), never with a shell `&` inside a
foreground command. The generators and Node suites can run either way.

## 3. The suites

"Fg" means the command must run in the foreground (it starts Chrome or Safari). Times are rough, from the last full
chain on a Mac. Parts are named as arguments, for example `node tests/browser/run_ch_browser.js wa flow
insets png`; no part named means the default set.

### Node unit suites (fg or background; no browser)

| File | What it checks | Time | Parts or modes |
|---|---|---|---|
| `run_f1_unit_tests.js` | ZIP reader, file intake, recognition, checklist, guide, sample and all-in-one bundles against the hand-written matrix; writes tiers and `test-tables/` | ~15 s | none |
| `run_s1_unit_tests.js` | WA State engine against the hand oracle and CVI's R functions, each tier, the S1.1 palettes and legend radii | seconds | none |
| `run_s2_unit_tests.js` | Value boxes, summary strip and period modes against CVI's WA map module | seconds | none |
| `run_s3_unit_tests.js` | Basemap list, raster style and label contrast against CVI's; the page's CSP and host check | seconds | none |
| `run_nr_unit_tests.js` | Neighboring-region list and files, `locate()` and `resolve()`, loading, credits | seconds | none |
| `run_s4_unit_tests.js` | National Flow against CVI's module; arcs against geosphere; the state files | seconds | none |
| `run_s5_unit_tests.js` | County Focus against the S5 references (one mode per call; exit 2 = values right, timing over target) | seconds each | `--membership --premises --payloads --module-tiers --module-facilities --module-matrix --summaries --facilities --scaling-gate` (one required) |
| `run_s6_unit_tests.js` | Infrastructure: the day-1 reference gate (no flag), the entry flow, shared facilities, CVI activity | seconds each | none, `--entryflow`, `--facilities`, `--activity` |
| `run_s7_unit_tests.js` | Charts, export files and previews against CVI's module, byte for byte | ~15 s | `[fixture ...]` |
| `run_mc_unit_tests.js` | Within-state movement rules and chart cross-filters against the MC reference | ~10 s | `[fixture ...]` |
| `run_s9_unit_tests.js` | Branded PNG pages and the GIFs against CVI's renderers; the GIF writer by its own decoder | 1.5-4 min | `[fixture ...]` |
| `run_pc_unit_tests.js` | The three population data files against the PC reference; `population.js`; the PNG parts | ~30 s | none |
| `run_s11_unit_tests.js` | Premise Lookup engine, tab rules, PNG and "Find coordinates" against CVI's own | ~15-30 s | none |
| `run_ui_unit_tests.js` | Brand colors and contrast pairs, font, banner and footer, text floor, facility marks, chart tables, Stats text, help notes, glossary | seconds | none |
| `run_ch_unit_tests.js` | Shaded maps: land areas, ramps, classes against Fisher, quantiles and R's `cut()`, shared classes, PNG, GIF, Alaska and Hawaii insets | ~3 s | none |
| `run_em_unit_tests.js` | Emergency Response: the emergency types and the made-up third type, recognition of positives and zone files (the collision cases), the sample, shared bundle entries, the guide; the rules (names, which positives get zones, the locations left out, the inside rows, the "nearest" line, the value boxes, the exports) against the R reference, and their speed; writes the fixtures | ~2 s | none |

### Chrome suites (fg only)

Hosted mode: set the suite's page variable to the case-strict server (section 4), for example
`S7_PAGE_URL=http://127.0.0.1:8765/cvi/index.html`.

| File | What it checks | Time | Default parts or modes |
|---|---|---|---|
| `run_f1_browser.js` | Landing page: three load modes, every checklist case, hand-off to the CVI tab, guide, sample download, all-in-one bundle | ~30 s | none (`F1_PAGE_URL`) |
| `run_s1_browser.js` | WA State map against the S1 reference: circles, hover, legend, fit, messages, network | ~1 min | none (`S1_PAGE_URL`) |
| `run_s2_browser.js` | Value boxes, strip, spotlight, Reset All, screenshot, Browse and Compare | ~3.5 min | none (`S2_PAGE_URL`) |
| `run_s3_browser.js` | Opt-in basemaps, every provider request answered locally; CSP; failures | ~2.7 min | none (`S3_PAGE_URL`) |
| `run_nr_browser.js` | Neighboring-region switches, land fills, Compare, screenshot, credits | ~1.2 min | none (`NR_PAGE_URL`) |
| `run_s4_browser.js` | National Flow against CVI's module (every `S4_STRIDE`-th view, default 5) | ~4.6 min | none (`S4_PAGE_URL`) |
| `run_s5_browser.js` | County Focus against the S5 references: premises, clusters, hover and pop-ups | ~2 min | none; also `--timing`, `--module-matrix <tier> <shard>` (`S5_PAGE_URL`, `S5_STRIDE`) |
| `run_s6_browser.js` | Hub and Infrastructure: day-2 entry flow (no flag), entry regression, facilities, County Focus facilities, CVI activity | under 1 min each | none, `--entry-regression`, `--facilities`, `--focus`, `--activity` (`S6_PAGE_URL`) |
| `run_mc_browser.js` | Chart filters and the movement view on the page | ~1.5 min | `marks wa flow focus movement exports perf` (`MC_PAGE_URL`) |
| `run_s7_browser.js` | Charts, layouts, spotlight, previews and the export ZIP | ~2 min | `png layout charts spotlight measure subsets perf checkpoint previews exports special` (`S7_PAGE_URL`) |
| `run_s9_browser.js` | Branded PNGs, backgrounds, name markers, Facilities PNG, the GIFs | ~2-2.5 min | `png export additions backgrounds names facilities gif viewgif` (`S9_PAGE_URL`, `S9_INFRA_URL`) |
| `run_pc_browser.js` | Population switches on the CVI page and Infrastructure; their PNGs | under 1 min | `cvi infra` (`PC_PAGE_URL`, `PC_INFRA_URL`) |
| `run_s11_browser.js` | Premise Lookup: sites table, Run query against CVI's, zones, facilities, PNG, "Find coordinates" | ~35 s | `page day3 day4 day5` (`S11_PAGE_URL`) |
| `run_ui_browser.js` | Six views: font, logo, banner, footer, every visible text's size and contrast; buttons, keyboard, Stats, glossary, chart labels; the notes for real files (PNG background notes, the sensitive-data notice, blocked downloads, the load statuses); the sidebars that stay in view on CVI and Infrastructure (`v20`) | 1.5-7 min | `checks`; also `controls day3 chartlabels fixes v11 v20` (`UI_SITE_URL`) |
| `run_ch_browser.js` | Shaded counties and states on the live maps, the PNG and GIF, Alaska and Hawaii insets | ~25-60 s | `wa records flow insets png` (`CH_PAGE_URL`) |
| `run_em_browser.js` | Emergency Response: a bundle with a zone file sent from the landing page, loose positives routed to it, the sample loaded and downloaded; the page with the sample (the map's contents, the boxes, the folds, the type's "?" and links, the zone file, a ring distance, the density limits, 320 px); the results (the tabs, CVI movements with a master, the Export ZIP, no marked address anywhere); E1b on the page (past positives, the window, the play, km \| miles, the zone hover (also inside the map at 320 px), the line under the value boxes, the rows not mapped, the screwworm outbreak); the map picture; the chart; the one-second step at full size (40 positives against 30,000 points, without and with the 50,000-row master, which `make_scale_master.js` writes) | ~70 s | `load page results e1b png chart speed` (`EM_PAGE_URL`) |
| `run_scale_browser.js` | A 50,000-row master (`make_scale_master.js`): times the hand-off, the load, Browse Play, the charts, County Focus with 39 counties, the GIF and Premise Lookup; a step fails only past 30 seconds | ~50 s | none (`SCALE_SITE_URL`, the site's address) |

### Safari suite (fg only; quit Safari first)

`node tests/browser/run_safari.js` with no flag runs the core part (landing page, sample bytes, checklist cases,
hand-off, WA State against the S1 reference, National Flow against the S4 reference, County Focus pop-ups; a few
minutes). The other parts run alone, each under about a minute: `--s6-entryflow`, `--s6-facilities`, `--s6-focus`,
`--s6-activity`, `--s7`, `--mc`, `--s9`, `--pc`, `--s11`, `--ab`, `--ui`, `--gif`, `--ch` and `--em` (Emergency
Response: needs `make_em_fixtures.js` and the Emergency Chrome suite's `load` part, which writes its sample). Each needs the same
preparation as the matching Chrome suite. Hosted mode: `SAFARI_PAGE_URL=http://127.0.0.1:8765/index.html`. Results
are in `local-test-artifacts/f1/safari_run.json` and each part's folder; `S5_SAFARI_OUTPUT=<folder>` (relative to
`local-test-artifacts/s5/`) keeps the core run's County Focus screenshots apart from earlier ones.

## 4. The full regression chain

Run the whole chain before a release and after any change that could reach more than one slice. The scripts are in
`tests/chain/`: `chain_node.sh`, `chrome.sh`, `safari.sh` and their helper `step.sh`, which runs each step under
macOS `caffeinate -di` (so neither the computer nor the display sleeps mid-run), writes one log per step (with `exit <code>` at the
end) to `$CHAIN_LOGS` (default: `local-test-artifacts/chain/`) and prints each step's summary line. The order and
commands are written out below.

**Part 1, Node and the R references** (`bash tests/chain/chain_node.sh`, one background job):

```sh
node tests/node/run_f1_unit_tests.js
node tests/node/run_s1_unit_tests.js
node tests/node/run_s2_unit_tests.js
node tests/node/run_s3_unit_tests.js
node tests/node/run_nr_unit_tests.js
node tests/node/run_s4_unit_tests.js
for m in membership premises payloads module-tiers module-facilities module-matrix summaries facilities scaling-gate; do
  node tests/node/run_s5_unit_tests.js --$m
done
node tests/node/run_s6_unit_tests.js
node tests/node/run_s6_unit_tests.js --entryflow
node tests/node/run_s6_unit_tests.js --facilities
node tests/node/run_s6_unit_tests.js --activity
node tests/node/run_s7_unit_tests.js
node tests/node/run_mc_unit_tests.js
node tests/node/run_s9_unit_tests.js
Rscript tests/oracle/pc_population_oracle.R
node tests/node/run_pc_unit_tests.js
node tests/synthetic/make_s11_fixtures.js
Rscript tests/oracle/s11_proximity_oracle.R
node tests/node/run_s11_unit_tests.js
node tests/node/run_ch_unit_tests.js
node tests/node/run_ui_unit_tests.js
node tests/synthetic/make_em_fixtures.js
Rscript tests/oracle/em_oracle.R
node tests/node/run_em_unit_tests.js
```

This part regenerates only the PC and S11 references; the S1 to S9 references from section 2 are reused.

**Part 2, Chrome over `file://`** (foreground, one batch per command, each under 600 seconds):
`bash tests/chain/chrome.sh file <batch>`, for batches `1`, `1b`, `2`, `2b`, `3`, `4`, `5`, `6` and `7` (Emergency).

| Batch | Commands |
|---|---|
| 1 | `run_s1_browser.js`, `run_s2_browser.js`, `run_nr_browser.js` |
| 1b | `run_f1_browser.js`, `run_s3_browser.js` |
| 2 | `run_s4_browser.js` (about 5 minutes) |
| 2b | `node tests/synthetic/make_cvi_focus_fixtures.js --clusters`, then `run_s5_browser.js` |
| 3 | `run_s6_browser.js` with `--entry-regression`, `--facilities`, `--focus`, `--activity` (four runs), `run_mc_browser.js`, `run_s7_browser.js` |
| 4 | `run_s9_browser.js`, `run_pc_browser.js` (every part), `run_s11_browser.js` |
| 5 | `run_ui_browser.js checks controls day3 chartlabels fixes v11 v20` |
| 6 | `run_ch_browser.js` (about 40 seconds), then `node tests/synthetic/make_scale_master.js` and `run_scale_browser.js` (about 50 seconds) |
| 7 | `run_em_browser.js` (Emergency Response) |

**Part 3, Chrome over `http`.** Start the case-strict server as a background job:
`node tests/browser/serve_case_strict.js` (port 8765, or the port given as its argument). Then run the same batches
with `bash tests/chain/chrome.sh http <batch>`, which sets:

```sh
H=http://127.0.0.1:8765
export F1_PAGE_URL=$H/index.html S6_PAGE_URL=$H/index.html UI_SITE_URL=$H/ SCALE_SITE_URL=$H/
for v in S1 S2 S3 S4 S5 S7 S9 MC NR PC S11 CH; do export ${v}_PAGE_URL=$H/cvi/index.html; done
export PC_INFRA_URL=$H/infrastructure/index.html S9_INFRA_URL=$H/infrastructure/index.html EM_PAGE_URL=$H/index.html
```

Over `http` batch 4 runs `run_pc_browser.js cvi infra`. The F1 suite has one check fewer over `http`
(a `file://`-only check). Stop the server when done (Ctrl+C or SIGTERM); it must print `case misses: 0`.

**Part 4, Safari, once over `file://` and once over `http`** (foreground, the server running for `http`):

```sh
bash tests/chain/safari.sh file core s6-entryflow s6-facilities s6-focus s6-activity s7 mc s9 pc s11 ab ui gif ch em
bash tests/chain/safari.sh http core s6-entryflow s6-facilities s6-focus s6-activity s7 mc s9 pc s11 ab ui gif ch em
```

`safari.sh` quits Safari before and after each part (`osascript -e 'tell application "Safari" to quit'`), runs
`node tests/browser/run_safari.js` for `core` and `node tests/browser/run_safari.js --<part>` for the others, and sets
`SAFARI_PAGE_URL=http://127.0.0.1:8765/index.html` for `http`.

A run passes when every log ends with `exit 0` and a summary of `0 failed`. Keep a failed attempt's log beside the
rerun (for example `*_attempt1.log`) rather than overwriting it.

## 5. Mutation runners

A mutation runner checks that a suite can fail. Each mutant changes one exact piece of code; the suite named for it
must then report failed checks.

```sh
node tests/mutation/run_<slice>_mutations.js list            # the numbered mutants (MC, S7, S9, S11, PC, CH, EM)
node tests/mutation/run_<slice>_mutations.js unit [n ...]    # mutants against the slice's Node suite
node tests/mutation/run_<slice>_mutations.js page n [n ...]  # mutants against the slice's Chrome suite (fg)
```

Numbers are 1-based, as listed; no number runs the whole group where the runner allows it. Some runners have more
groups: S11 `unit page day3 png day4 day5`, PC `unit build page p2`. `page 0` (S5) or `0` alone (S1.1, S4) runs only
the unmutated suite.

- **The copy.** Each call copies `site/`, `tests/` and the fixtures it needs into a folder under
  `local-test-artifacts/<slice>/` (`mutation-copy`, or `mutation-copy-<group>`), runs the unmutated suite there first
  (it must pass), applies one mutant at a time and restores the file after each (checked by SHA-256), and deletes
  the copy at the end. Most runners refuse to start while an earlier copy folder exists: look at the interrupted
  run, then delete it. At the end the repository's own copies of every mutated file are checked unchanged (SHA-256).
- **"Caught"** means the suite ran to its summary line and reported at least one failed check. A suite that stops
  or crashes before its summary does not count (the S4 runner calls it a `SUITE ERROR`). The UI runner also ignores
  failures of checks that only search source text (marked `[source text]`).
- **Batches under 600 seconds.** Choose numbers so each call stays under 600 seconds; several runners stop a suite
  run after 9 minutes. Rough cost per mutant: AB unit 5 s, page 30 s; CH page 70 s (two calls of six); MC unit 30 s,
  page 1 to 6 per call; PC unit 5 s, build 30 s; S1.1 unit seconds, page 1 to 3 min; S4 page 4.6 min (one or two per
  call); S5 page two per call; S6 page up to four per call; S7 page 1 to 6 per call; S9 unit 40 s (up to about 12 per
  call), page 1 to 6 per call; S11 unit 8 s, page 12 s, day4 20 s; UI unit 2 s, page 30 s to 2 min; EM (Emergency)
  unit about 2 s, page 5 to 60 s (each page mutant names the Chrome suite's parts that must catch it: `page` and
  `results` for E1a's, `e1b`, `png`, `chart` or `speed` for E1b's; the unmutated run covers every part named).
- **Ledgers and logs** go to `local-test-artifacts/<slice>/mutations/` (S6: `local-test-artifacts/s6/mutations/`).
- Page groups run in the foreground. Unit groups, and the PC `build` group, may run as background jobs.

## 5b. Testing another copy of the site

A copy of `site/` kept elsewhere (for example a public copy, with `shared/release.js` `publicCopy` true) is tested by
serving it and pointing the suites at it with the same setting:

    SITE_ROOT=<copy>/site node tests/browser/serve_case_strict.js   (background)
    export SITE_ROOT=<copy>/site CHAIN_LOGS=local-test-artifacts/copy-chain
    bash tests/chain/chrome.sh http <batch>     and     bash tests/chain/safari.sh http <parts>

A copy without the held-back providers offers fewer basemaps and no Esri PNG background; the suites read the copy's
own `release.js` (S3 through `SITE_ROOT`; S6, S9 and S11 by asking the page) and check that nothing held back is
offered, in place of the checks of those providers. The Node suites that run on a fresh clone (F1, CH, UI, NR) run
inside the copy itself; S3 unit too, with its R reference copied in.

A copy already hosted elsewhere is tested the same way without the local server: `CHAIN_HOST` gives the address of
its `site/` folder (no trailing slash), and `SITE_ROOT` a local folder holding the same files, for the S3 suite's
lists:

    export CHAIN_HOST=https://<host>/<path>/site SITE_ROOT=<copy>/site CHAIN_LOGS=local-test-artifacts/hosted-chain
    bash tests/chain/chrome.sh http <batch>     and     bash tests/chain/safari.sh http <parts>

## 6. Screenshots

Several suites save screenshots under `local-test-artifacts/<slice>/screens/` or `browser/` on every run.

## 7. Tips learned

- **Browser suites cannot start Chrome from a background job.** Run every Chrome and Safari command in the
  foreground. Only the Node suites, the R scripts, the case-strict server and unit mutation groups can run in the
  background.
- **Quit Safari before a Safari run** and leave it closed: `safaridriver` starts it, and it refuses a session while
  Safari is already open. The driver leaves Safari open when it finishes.
- **Safari needs the screen awake and the computer left alone.** It opens a visible window and uses real pointer
  clicks; when the display slept, Safari stopped drawing the map and runs failed with timeouts.
- **Keep the computer awake for long runs** with macOS's built-in `caffeinate`, which ends with the command it wraps:
  `caffeinate -i <command>` prevents idle sleep; `caffeinate -d <command>` also keeps the display on (for Safari).
- **`F1_TRACE=1`** makes the F1 Chrome suite print each check as it is made, with the seconds since the start, to see
  where a slow run spends its time. `S7_VERBOSE=1` and `MC_VERBOSE=1` print each check of those suites as it runs
  (without the times).
- **F1 unit runs rewrite `test-tables/`** and the tiers in `local-test-artifacts/f1/`. Run
  `node tests/synthetic/make_s11_fixtures.js` again afterwards; files picked from `test-tables/` before the run may
  have changed.
- **One timing failure may not repeat.** A few checks time the page (for example the S9 Facilities preview against
  3 seconds); a single slow result on a busy machine is rerun alone before it is treated as a failure.
- **Clean up after a run.** Each Chrome suite uses a throw-away profile in its output folder, deleted at the end
  (and at the next start if a run was interrupted). Afterwards check that no test Chrome, `safaridriver` or
  `serve_case_strict.js` is still running, for example with `ps -ax | grep -E 'serve_case_strict|safaridriver|chrome-profile-'`.

