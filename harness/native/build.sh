#!/usr/bin/env bash
# Build the macOS OS-input helpers used by the human control arm.
#
#   human_input  replay a JSON plan of moves/clicks/keys through CGEvent, so
#                the browser produces genuinely trusted input
#   act          bring a specific PID's window to front (AppleScript activates
#                whichever Chrome is registered, not necessarily ours)
#   permcheck    report whether this process may post synthetic events
set -euo pipefail
cd "$(dirname "$0")"
for f in human_input act permcheck; do
  swiftc -O "$f.swift" -o "$f"
done
echo "built: human_input act permcheck"
