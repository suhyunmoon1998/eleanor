#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 or newer is required. Install it from nodejs.org, then run this file again."
  read -p "Press Enter to close."
  exit 1
fi
node launch.mjs
