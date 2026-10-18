#!/bin/bash
# The full regression chain, Node half (and the PC and S11 R references), from the repository root. One log per suite.
cd "$(dirname "$0")/../.." || exit 2
source tests/chain/step.sh
step node_f1 node tests/node/run_f1_unit_tests.js
step node_s1 node tests/node/run_s1_unit_tests.js
step node_s2 node tests/node/run_s2_unit_tests.js
step node_s3 node tests/node/run_s3_unit_tests.js
step node_nr node tests/node/run_nr_unit_tests.js
step node_s4 node tests/node/run_s4_unit_tests.js
for m in membership premises payloads module-tiers module-facilities module-matrix summaries facilities scaling-gate; do
  step "node_s5_${m//-/_}" node tests/node/run_s5_unit_tests.js "--$m"
done
step node_s6_day1 node tests/node/run_s6_unit_tests.js
step node_s6_entryflow node tests/node/run_s6_unit_tests.js --entryflow
step node_s6_facilities node tests/node/run_s6_unit_tests.js --facilities
step node_s6_activity node tests/node/run_s6_unit_tests.js --activity
step node_s7 node tests/node/run_s7_unit_tests.js
step node_mc node tests/node/run_mc_unit_tests.js
step node_s9 node tests/node/run_s9_unit_tests.js
step r_pc_oracle Rscript tests/oracle/pc_population_oracle.R
step node_pc node tests/node/run_pc_unit_tests.js
step node_s11_fixtures node tests/synthetic/make_s11_fixtures.js
step r_s11_oracle Rscript tests/oracle/s11_proximity_oracle.R
step node_s11 node tests/node/run_s11_unit_tests.js
step node_ch node tests/node/run_ch_unit_tests.js
step node_ui node tests/node/run_ui_unit_tests.js
echo "chain done"
