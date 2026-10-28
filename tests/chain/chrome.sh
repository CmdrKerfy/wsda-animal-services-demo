#!/bin/bash
# The full regression chain, Chrome half, from the repository root, in the foreground:
# bash tests/chain/chrome.sh <file|http> <batch 1, 1b, 2, 2b, 3, 4, 5, 6, 7>
# Each batch stays under 600 seconds. "http" needs tests/browser/serve_case_strict.js running on port 8765.
cd "$(dirname "$0")/../.." || exit 2
source tests/chain/step.sh
M=$1
if [ "$M" = http ]; then
  H=${CHAIN_HOST:-http://127.0.0.1:8765}   # CHAIN_HOST: another address of site/ (for example a hosted copy)
  export F1_PAGE_URL=$H/index.html S6_PAGE_URL=$H/index.html UI_SITE_URL=$H/ SCALE_SITE_URL=$H/
  for v in S1 S2 S3 S4 S5 S7 S9 MC NR PC S11 CH; do export ${v}_PAGE_URL=$H/cvi/index.html; done
  export PC_INFRA_URL=$H/infrastructure/index.html PC_EM_URL=$H/emergency/index.html S9_INFRA_URL=$H/infrastructure/index.html EM_PAGE_URL=$H/index.html
fi
case $2 in
  1) step chrome_${M}_s1 node tests/browser/run_s1_browser.js
     step chrome_${M}_s2 node tests/browser/run_s2_browser.js
     step chrome_${M}_nr node tests/browser/run_nr_browser.js ;;
  1b) step chrome_${M}_f1 node tests/browser/run_f1_browser.js
     step chrome_${M}_s3 node tests/browser/run_s3_browser.js ;;
  2) step chrome_${M}_s4 node tests/browser/run_s4_browser.js ;;
  2b) node tests/synthetic/make_cvi_focus_fixtures.js --clusters > "$L/clusters_${M}.log" 2>&1
     step chrome_${M}_s5 node tests/browser/run_s5_browser.js ;;
  3) step chrome_${M}_s6_entry node tests/browser/run_s6_browser.js --entry-regression
     step chrome_${M}_s6_facilities node tests/browser/run_s6_browser.js --facilities
     step chrome_${M}_s6_focus node tests/browser/run_s6_browser.js --focus
     step chrome_${M}_s6_activity node tests/browser/run_s6_browser.js --activity
     step chrome_${M}_mc node tests/browser/run_mc_browser.js
     step chrome_${M}_s7 node tests/browser/run_s7_browser.js ;;
  4) step chrome_${M}_s9 node tests/browser/run_s9_browser.js
     if [ "$M" = http ]; then step chrome_${M}_pc node tests/browser/run_pc_browser.js cvi infra names legend
     else step chrome_${M}_pc node tests/browser/run_pc_browser.js; fi
     step chrome_${M}_s11 node tests/browser/run_s11_browser.js ;;
  5) step chrome_${M}_ui node tests/browser/run_ui_browser.js checks controls day3 chartlabels fixes v11 v20 ;;
  6) step chrome_${M}_ch node tests/browser/run_ch_browser.js
     node tests/synthetic/make_scale_master.js > "$L/scale_master_${M}.log" 2>&1
     step chrome_${M}_scale node tests/browser/run_scale_browser.js ;;
  7) # The part "speed" reads the 50,000-row master batch 6 writes; written here when batch 7 runs on its own.
     [ -f local-test-artifacts/scale/cvi_master_50000.csv ] || node tests/synthetic/make_scale_master.js > "$L/scale_master_${M}.log" 2>&1
     step chrome_${M}_em node tests/browser/run_em_browser.js ;;
esac
