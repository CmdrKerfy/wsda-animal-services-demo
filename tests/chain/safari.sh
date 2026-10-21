#!/bin/bash
# The full regression chain, Safari, from the repository root, in the foreground:
# bash tests/chain/safari.sh <file|http> <part ...>
# Parts: core s6-entryflow s6-facilities s6-focus s6-activity s7 mc s9 pc s11 ab ui gif ch em. Safari is quit before and
# after each run. "http" needs tests/browser/serve_case_strict.js running on port 8765.
cd "$(dirname "$0")/../.." || exit 2
source tests/chain/step.sh
M=$1; shift
[ "$M" = http ] && export SAFARI_PAGE_URL=${CHAIN_HOST:-http://127.0.0.1:8765}/index.html
for part in "$@"; do
  if [ "$part" = core ]; then qstep safari_${M}_core node tests/browser/run_safari.js
  else qstep safari_${M}_${part//-/_} node tests/browser/run_safari.js --$part; fi
done
