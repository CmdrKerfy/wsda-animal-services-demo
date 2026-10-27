# Sourced helper (the full regression chain): step <log name> <command ...> writes the log with its exit
# code and prints the summary line; every step runs under macOS caffeinate -di, so neither the computer
# nor the display sleeps mid-run (a Chrome suite stalled once when the display turned off); qstep quits
# Safari before and after the run.
L=${CHAIN_LOGS:-local-test-artifacts/chain}; mkdir -p "$L"
step() { name=$1; shift; caffeinate -di "$@" > "$L/$name.log" 2>&1; code=$?; echo "exit $code" >> "$L/$name.log";
  echo "$name exit $code: $(grep -E '[0-9]+ passed|passed|PASS' "$L/$name.log" | tail -1 | cut -c1-140)"; }
qstep() { osascript -e 'tell application "Safari" to quit' >/dev/null 2>&1; sleep 2; step "$@"; osascript -e 'tell application "Safari" to quit' >/dev/null 2>&1; }
