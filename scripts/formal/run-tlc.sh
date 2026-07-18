#!/usr/bin/env bash
# Downloads a pinned, checksum-verified tla2tools.jar (once; cached under
# formal/tools/, gitignored) and runs TLC against every formal/modules/*.cfg.
# Requires: Java 17+. No Docker needed.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TLA_VERSION="v1.7.4"
TLA_JAR_SHA256="936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88"
TOOLS_DIR="$REPO_ROOT/formal/tools"
JAR="$TOOLS_DIR/tla2tools.jar"
MODULES_DIR="$REPO_ROOT/formal/modules"

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

echo "${TLA_JAR_SHA256}  ${JAR}" | sha256sum -c -

status=0
for cfg in "$MODULES_DIR"/*.cfg; do
  module="$(basename "$cfg" .cfg)"
  log="/tmp/tlc-${module}.log"
  echo "=== TLC: ${module} ==="
  # Piping java's output directly into `grep -q` is a classic SIGPIPE trap
  # under `set -o pipefail`: grep -q exits as soon as it sees a match,
  # closing its end of the pipe, which kills java/tee with SIGPIPE and
  # makes the whole pipeline "fail" even though TLC actually succeeded.
  # Writing the full log first, then grepping the file, avoids that.
  java -XX:+UseParallelGC -cp "$JAR" tlc2.TLC -workers auto \
    -config "$cfg" "$MODULES_DIR/$module.tla" > "$log" 2>&1 || true
  if grep -q "Model checking completed. No error has been found." "$log"; then
    grep "states generated" "$log" | tail -1
    echo "PASS: ${module}"
  else
    tail -20 "$log"
    echo "FAIL: ${module} (see ${log})"
    status=1
  fi
done

exit $status
