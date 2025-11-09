# CSS Refactor Notes (Utility Classes & Tokens)

## Overview
This pass introduced design tokens, utility visibility classes, and removed several repeated inline `style.*` assignments in JS by switching to class toggles.

## New Design Tokens (in `css/styles.css` `:root`)
- `--transition-fast`: 120ms standardized micro‑interaction duration
- `--label-btn-font-size`: Font size for room label edit buttons
- `--label-btn-height`: Consistent height for room edit button chip
- `--label-btn-radius`: Border radius for room edit button chip
- `--roof-rotate-size`: Diameter for rotate button

## New Utility Classes
- `.is-hidden`: Forces `display: none !important;` for complete removal from layout
- `.is-invisible`: Forces `visibility: hidden !important;` when layout continuity is desired
- `.visible`: (Existing pattern) Used on several modals or control containers to enable display

## Refactored Components
| Component | Previous | Now |
|-----------|----------|-----|
| Info Modal / Share / Pricing / Room Palette / Floorplan | `style.display='block'/'flex'/'none'` | `element.classList.add('visible')` / `.remove('visible')` |
| Roof Dropdown hiding when modals open | `style.display='none'` | `classList.add('is-hidden')` |
| 2D Opening Controls (Window/Door selects) | `style.display` toggles | `classList.add/remove('visible')` |
| Share Badge | Inline style assignments per property | Pure CSS rules (`#share-badge`, `#share-badge-link`) |
| Room Edit / Rotate Buttons | Hard-coded sizes | CSS variables for size & transitions |

## Migration Guidelines
1. Prefer adding/removing `.visible` or `.is-hidden` classes over mutating `element.style.display`.
2. Use CSS custom properties for recurring dimensions, timing values, and fonts instead of repeating magic numbers.
3. Inline positioning updates (dynamic `left`, `top`, `opacity`, `cursor`) remain acceptable where frame-by-frame adjustments are required.
4. When introducing new UI elements with show/hide behavior, default them to hidden in CSS and toggle with class additions.
5. Avoid mixing class toggles and manual `style.display`; choose one approach per element for clarity.

## Future Opportunities
- Consolidate remaining modal base styles into a `.modal` class with variants.
- Introduce `.flex-row`, `.flex-col`, spacing utilities (`.gap-4`, etc.) for frequently repeated layout definitions.
- Create a theming section for color tokens (brand blue, grays) to simplify future palette adjustments.
- Unify button focus/hover shadows using a shared utility class.

## Quick API Helpers (suggested - not yet implemented)
You may add small DOM helpers:
```js
function show(el){ el && el.classList.remove('is-hidden'); }
function hide(el){ el && el.classList.add('is-hidden'); }
function toggleVisible(el, on){ if(!el) return; el.classList[on?'add':'remove']('visible'); }
```

## Verification Checklist
- No functional regression opening/closing: Info, Share, Pricing, Room Palette, Floorplan modals.
- Roof dropdown hides while modals are active and returns afterward.
- 2D opening controls show only for correct element type (door/window).
- Share badge renders with correct spacing and responsive wrapping.

## Notes
Dynamic measurements panel still uses some direct style changes for cursor/position; these are intentionally left for performance and specificity.

---
Last updated: 2025-11-09
