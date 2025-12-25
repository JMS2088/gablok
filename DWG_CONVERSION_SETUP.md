# DWG Import/Export Setup (Server-side Conversion)

## Why this is needed
DWG is a proprietary, complex binary format. This project runs as a static web app with a lightweight Python dev server.

- **DXF** import/export is supported in-browser.
- **DWG** import/export requires **server-side conversion** using an external converter tool.

This repo includes endpoints in `server.py` that can convert:
- DWG → DXF (for import)
- DXF → DWG (for export)

…but **you must install/provide a converter CLI** and configure the server with environment variables.

## Endpoints
- `POST /api/dwg/to-dxf`
  - Request JSON: `{ "filename": "file.dwg", "bytesBase64": "..." }`
  - Response JSON: `{ "ok": true, "dxfText": "...", "dxfBase64": "..." }`

- `POST /api/dwg/to-dwg`
  - Request JSON: `{ "filename": "file.dxf", "dxfText": "..." }` (or `dxfBase64`)
  - Response JSON: `{ "ok": true, "bytesBase64": "..." }`

If the converter is not configured, the server returns **501** with:
- `error: "dwg-converter-not-configured"`
- `requiredEnv: "GABLOK_DWG2DXF_CMD"` or `GABLOK_DXF2DWG_CMD`

## Configure the converter
Set one or both of these environment variables:

- `GABLOK_DWG2DXF_CMD` (DWG → DXF)
- `GABLOK_DXF2DWG_CMD` (DXF → DWG)

The command string supports placeholders:
- `{in}`: full path to the input file
- `{out}`: full path to the expected output file
- `{in_dir}`: temp input folder (contains the uploaded file)
- `{out_dir}`: temp output folder (must be different from `{in_dir}` for some tools)

### Example (simple converter)
If you have a CLI that works like `dwg2dxf input.dwg output.dxf`:

- `export GABLOK_DWG2DXF_CMD='dwg2dxf {in} {out}'`

### Example (directory-based converters)
Some converters take an input folder and output folder and create files inside.

- `export GABLOK_DWG2DXF_CMD='ODAFileConverter {in_dir} {out_dir} ACAD2013 DXF 0 1'`
- `export GABLOK_DXF2DWG_CMD='ODAFileConverter {in_dir} {out_dir} ACAD2013 DWG 0 1'`

#### Headless Linux note (Codespaces/dev containers)
`ODAFileConverter` is a Qt GUI app. In a headless environment, run it via Xvfb:

- `export GABLOK_DWG2DXF_CMD='xvfb-run -a ODAFileConverter {in_dir} {out_dir} ACAD2013 DXF 0 1'`
- `export GABLOK_DXF2DWG_CMD='xvfb-run -a ODAFileConverter {in_dir} {out_dir} ACAD2013 DWG 0 1'`

Note: Directory-based converters may not let you control output naming; the server will fall back to “first .dxf/.dwg in the temp output folder”.

## Run the dev server with conversion enabled
Example:

- `GABLOK_DWG2DXF_CMD='dwg2dxf {in} {out}' GABLOK_DXF2DWG_CMD='dxf2dwg {in} {out}' python3 server.py`

## Client behavior
- Importing a `.dwg`:
  - If it’s actually an ASCII DXF renamed to `.dwg`, it imports directly.
  - If it’s a real DWG, the app calls `/api/dwg/to-dxf` and then imports the returned DXF.

- Exporting DWG:
  - The app serializes the project to DXF, calls `/api/dwg/to-dwg`, and downloads the DWG.
  - If conversion is unavailable, it falls back to exporting DXF.
