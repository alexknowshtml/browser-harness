#!/usr/bin/env bash
# Offline test gate for the TS daemon (#1600). Mock browsers only: never touches Helium or BU_NAME=default.
set -e
cd "$(dirname "$0")/.."
bun tests/parity.ts
bun tests/helper-parity.ts
bun tests/recovery.ts
bun tests/runner.ts
