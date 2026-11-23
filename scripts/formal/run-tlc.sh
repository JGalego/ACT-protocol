#!/usr/bin/env bash
# Runs the real TLC model checker over every model in formal/.
#
#   formal/modules/*.cfg   the shipped configurations: TLC must find NO error.
#   formal/mutants/*.cfg   deliberately broken variants (one guard removed): TLC
#                          MUST find the violation named on the file's
#                          `\* EXPECT: <name>` line. This is what proves a passing
#                          model is not passing vacuously, and it runs every time.
#
# A mutant that TLC does NOT break, or that breaks a different property than the
# one expected, fails the run just as a failing module does.
#
# Downloads a pinned, checksum-verified tla2tools.jar once (cached under
# formal/tools/, gitignored). Requires Java 17+; no Docker.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TLA_VERSION="v1.7.4"
TLA_JAR_SHA256="936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88"
TOOLS_DIR="$REPO_ROOT/formal/tools"
JAR="$TOOLS_DIR/tla2tools.jar"
MODULES_DIR="$REPO_ROOT/formal/modules"
MUTANTS_DIR="$REPO_ROOT/formal/mutants"
ONLY="${1:-}"   # optional: run only models whose name contains this substring

if ! command -v java >/dev/null 2>&1; then
  echo "run-tlc.sh: java is required (17+)." >&2
  exit 1
fi

mkdir -p "$TOOLS_DIR"
if [[ ! -f "$JAR" ]]; then
  echo "Downloading tla2tools.jar ${TLA_VERSION}..."
  curl -fsSL -o "$JAR" \
    "https://github.com/tlaplus/tlaplus/releases/download/${TLA_VERSION}/tla2tools.jar"
fi
echo "${TLA_JAR_SHA256}  ${JAR}" | sha256sum -c - >/dev/null

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# run_tlc <cfg> <module> <log>: writes TLC's full output to <log>.
#
# TLC resolves `-config` relative to the spec's own directory, so the module
# and the config are staged together in a scratch directory first (a mutant's
# config lives in formal/mutants/ but checks the module in formal/modules/).
# Output goes to a file and is grepped afterwards: piping java straight into
# `grep -q` under `set -o pipefail` is a SIGPIPE trap (grep exits on the first
# match, killing java and failing the pipeline although TLC succeeded).
run_tlc() {
  local cfg="$1" module="$2" log="$3"
  local stage="$WORK/stage-$(basename "$cfg" .cfg)"
  mkdir -p "$stage"
  cp "$MODULES_DIR"/*.tla "$stage/"
  cp "$cfg" "$stage/run.cfg"
  (cd "$stage" && java -XX:+UseParallelGC -cp "$JAR" tlc2.TLC -workers auto \
    -metadir "$stage/states" -config run.cfg "$module.tla") > "$log" 2>&1 || true
}

status=0
modules_ok=0; mutants_ok=0

for cfg in "$MODULES_DIR"/*.cfg; do
  module="$(basename "$cfg" .cfg)"
  [[ -n "$ONLY" && "$module" != *"$ONLY"* ]] && continue
  log="$WORK/${module}.log"
  run_tlc "$cfg" "$module" "$log"
  if grep -q "Model checking completed. No error has been found." "$log"; then
    printf 'PASS  %-28s %s\n' "$module" "$(grep 'states generated' "$log" | tail -1 | sed 's/, 0 states left on queue.*//')"
    modules_ok=$((modules_ok + 1))
  else
    tail -25 "$log"
    echo "FAIL  ${module}"
    status=1
  fi
done

shopt -s nullglob
for cfg in "$MUTANTS_DIR"/*.cfg; do
  base="$(basename "$cfg" .cfg)"            # Module.mutant-name
  module="${base%%.*}"
  [[ -n "$ONLY" && "$base" != *"$ONLY"* ]] && continue
  expect="$(sed -n 's/^\\\* EXPECT: *//p' "$cfg" | head -1)"
  if [[ -z "$expect" ]]; then
    echo "FAIL  ${base}: no '\\* EXPECT: <name>' line"; status=1; continue
  fi
  log="$WORK/${base}.log"
  run_tlc "$cfg" "$module" "$log"
  # What TLC reported: "Invariant X is violated", "Action property X is
  # violated", or (liveness) "Temporal properties were violated".
  reported="$(grep -oE '(Invariant|Action property) [A-Za-z0-9_]+ is violated|Temporal properties were violated' "$log" | head -1 || true)"
  if [[ "$reported" == "Invariant ${expect} is violated" \
     || "$reported" == "Action property ${expect} is violated" \
     || ( "$expect" == "liveness" && "$reported" == "Temporal properties were violated" ) ]]; then
    steps="$(grep -cE '^State [0-9]+:' "$log" || true)"
    printf 'CAUGHT %-44s violates %s in %s states\n' "$base" "$expect" "$steps"
    mutants_ok=$((mutants_ok + 1))
  else
    echo "FAIL  ${base}: expected a violation of ${expect}, TLC reported: ${reported:-no violation}"
    status=1
  fi
done

echo "formal: ${modules_ok} models verified, ${mutants_ok} mutants caught"
exit $status
