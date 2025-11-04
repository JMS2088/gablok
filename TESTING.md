# 2D Editor Keyboard Delete Tests

This project includes a lightweight, in-browser test harness to verify that pressing Delete removes selected doors and windows in the 2D editor.

## How to run

- Start the dev server (it usually autostarts in this workspace).
- Open the app with the test flag:
  - http://127.0.0.1:8000/?test2d=delete&keep2d=1

The test will:
- Build a 4m x 3m rectangular room with a bottom-wall door and a right-wall window.
- Select the window, press Delete, and assert it is removed.
- Select the door, press Delete, and assert it is removed.
- Recreate the room, set the window as hovered, press Delete, and assert it is removed.

Results are reported in the on-page status bar and in the browser console:
- PASS: "2D Delete tests: PASS (selected window, selected door, hover window)"
- FAIL/ERROR: A brief message describing what assertion failed or why init failed.

Tip: Add `&keep2d=1` to keep the 2D editor open after the test completes.

## Additional modes

- Basic 2D smoke: `?smoke2d=1` opens the 2D editor and shows whether it has content.
- 2D→3D apply smoke: `?smokeApply=1` programmatically draws a simple room with one door and one window and applies it to 3D, then reports status in the status bar.

## Notes

- These are in-browser tests driven by the tiny harness in `js/smoke/smoke2d.js` to keep them fast and close to real user interactions.
- If a test fails, check the DevTools console for details (`F12`).
