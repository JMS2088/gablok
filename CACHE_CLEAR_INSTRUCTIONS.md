# How to Clear Browser Cache and See Changes

## The Problem
Your browser has cached the old JavaScript files, so changes aren't showing up.

## Solutions (try in this order):

### 1. Use the Reset Button in the App
- Click "Main Menu" → "Reset" 
- This will now clear ALL cache (localStorage, sessionStorage, cookies) and force reload

### 2. Hard Refresh in Browser
**Windows/Linux:**
- Press `Ctrl + Shift + R` (or `Ctrl + F5`)

**Mac:**
- Press `Cmd + Shift + R`

### 3. Clear Browser Cache Manually
**Chrome/Edge:**
1. Press `F12` to open DevTools
2. Right-click the refresh button
3. Select "Empty Cache and Hard Reload"

**Firefox:**
1. Press `Ctrl + Shift + Delete` (Windows) or `Cmd + Shift + Delete` (Mac)
2. Check "Cached Web Content"
3. Click "Clear Now"

### 4. Use DevTools to Disable Cache
1. Press `F12` to open DevTools
2. Go to Network tab
3. Check "Disable cache" checkbox
4. Keep DevTools open while testing

### 5. Force Reload All JS Files
Add `?nocache=` + current timestamp to the URL:
```
http://localhost:8001/?nocache=1763716707
```

## What Was Fixed

1. **Window Glass Color**: Windows now turn blue when you press Render button or 'R' key
2. **Cache Busting**: All files now have timestamp versions (v=1763716707)
3. **Reset Function**: Enhanced to clear all storage and force hard reload
4. **Splash Screen**: Fixed to prevent 3D rendering until all modules loaded

## How to Verify Changes Are Loading

1. Open browser console (F12)
2. Look for these messages when clicking Render:
   ```
   [setWallRenderMode] Mode changed to: solid
   [setWallRenderMode] Window glass color set to blue: rgba(59,130,246,0.75)
   ```

3. Check Network tab - files should show:
   ```
   engine3d.js?v=1763716707
   bootstrap.js?v=1763716707
   ```

## Current Server URL
The development server should run on a SINGLE port. We now standardize on:
- Port 8000: http://localhost:8000 (or its forwarded Codespaces/Gitpod URL)

If you ever see more than one `server.py` process (e.g. ports 8000 and 8001 both listening), kill them and start a fresh one:
```bash
pkill -f "python3 server.py" || true
python3 server.py --port 8000
```

Verify with:
```bash
ps -ef | grep server.py | grep -v grep
lsof -nP -p <PID> | grep LISTEN
```

### Forwarded URLs (Codespaces/Gitpod)
Use the IDE Ports panel or the Host shown in the console (it normalizes to `<port>-<codespace>.app.github.dev`). Always match the port (8000) shown by the server startup line.

## Version Query Parameters (Cache Busting)
Each `<script>` / `<link>` tag uses a `?v=...` stamp. After changing a file and wanting to guarantee reload, increment ONLY that file’s `v=` value in `index.html` (e.g. `bootstrap.js?v=20251121-3`). This forces the browser to fetch a fresh copy even if intermediate proxies misbehave.

Checklist when a change “doesn’t show”:
1. Confirm you edited the correct file path (e.g. `css/styles.css` vs another similarly named file).
2. Increment that asset’s `v=` stamp in `index.html`.
3. Hard refresh (Ctrl+Shift+R / Cmd+Shift+R).
4. DevTools Network tab: enable “Disable cache” and reload.
5. Ensure only one server instance (see commands above).
6. Open Console to verify your new log lines appear.
7. If still stale, append `?_nocache=<timestamp>` to the page URL.

