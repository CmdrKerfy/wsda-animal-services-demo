# WSDA Animal Services Visualization Platform

Browser-based dashboards for WSDA Animal Services data: static web pages that read the data files a user is given and
show them on maps, charts and branded pictures. Nothing is installed or uploaded; the pages run in the browser tab.

- **CVI Traceability**: animal movements from certificates of veterinary inspection (WA State, National Flow, County
  Focus and Premise Lookup views; charts, exports, branded PNGs and GIFs).
- **Infrastructure**: facility layers with filters, details, optional CVI activity and a branded PNG.
- **Emergency Response (preview)**: positives of an animal disease emergency (HPAI, with New World screwworm as a
  second example) with their zones, the sites inside them and the CVI movements that touch them; current and past
  positives, a date window with a week-by-week play, a chart, km or miles, CSV and GeoJSON exports and a branded PNG.

The repository holds synthetic (made-up) test data only. It is internal WSDA work, not licensed for reuse until WSDA
decides; third-party materials keep their own terms (`site/PROVENANCE.md`).

## Where things are

| Path | What it holds |
|---|---|
| [`site/`](site/README.md) | The pages themselves. Open `site/index.html`, or host the `site/` folder as it is. [`site/README.md`](site/README.md) explains opening, hosting and loading data, and the known limits. |
| [`tests/`](tests/README.md) | Node and browser test suites, mutation runners, R reference scripts and synthetic fixtures; how to run them and the full regression chain. |
| [`docs/DEVELOPER_GUIDE.md`](docs/DEVELOPER_GUIDE.md) | How the pages are put together, a file map and where to change what. |
| [`docs/DELIBERATE_DIFFERENCES.md`](docs/DELIBERATE_DIFFERENCES.md) | Where the CVI dashboard differs from CVI's own app on purpose, and why. |
| [`docs/FUTURE_ENHANCEMENTS.md`](docs/FUTURE_ENHANCEMENTS.md) | Work recorded for later. |
| `VERSION.txt` | The version and its date, as each page's footer shows them. |

## About this copy

- The pages read the files a user loads, in the browser tab; nothing is uploaded or stored. The data files in
  this repository (the test fixtures and the downloadable samples) are synthetic (made up).
- Map backgrounds and their terms: `site/PROVENANCE.md`.
- Contributions keep to synthetic fixtures only, and add no personal paths, user names, secrets or
  machine-specific settings to code or configuration.
