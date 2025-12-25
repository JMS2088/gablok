#!/usr/bin/env bash
set -euo pipefail

# DWG conversion commands (requires ODAFileConverter installed and on PATH)
export GABLOK_DWG2DXF_CMD="xvfb-run -a ODAFileConverter {in_dir} {out_dir} ACAD2013 DXF 0 1"
export GABLOK_DXF2DWG_CMD="xvfb-run -a ODAFileConverter {in_dir} {out_dir} ACAD2013 DWG 0 1"

exec python3 server.py
