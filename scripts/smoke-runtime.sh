#!/usr/bin/env bash
set -euo pipefail

curl -sf http://127.0.0.1:8080/health >/dev/null
curl -sf http://127.0.0.1:3000/ >/dev/null
