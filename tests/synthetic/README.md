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
