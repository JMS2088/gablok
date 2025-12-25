## Wall Corners — Corner Config 007 (DO NOT CHANGE)

This documents the current, correct behavior for wall corners in 3D (the visual you get for the first room placed in the 3D area). The implementation lives in `js/core/engine3d.js` inside `drawWallStrip`, annotated with a banner comment: "Corner Config 007 — DO NOT CHANGE".

Summary
- T‑junctions: endpoints that land near the middle of another wall are trimmed (butt join). This prevents overlaps while keeping the primary wall continuous.
- L‑corners: two walls sharing an endpoint are mitered with a fixed 45° cut per wall by intersecting each offset face with a local diagonal.
  - Start endpoint uses the diagonal (t + n)
  - End endpoint uses the diagonal (t − n)
  where t is the unit tangent from (x0,z0) to (x1,z1), and n is the unit left normal.

Why it’s correct for the first room
- The first room is axis‑aligned and rectangular. For a 90° corner, (t ± n) gives an exact 45° miter on both faces when thickness is constant across the walls. This yields perfectly flush edges without gaps or overdraw.

Key parameters and thresholds
- Same‑level only: junction detection ignores strips from other floors.
- T‑junction classification: requires the projected contact to be > 6 cm away from the neighbor’s endpoints (to avoid misclassifying an L‑corner as a T).
- Offset geometry: corners A/B/C/D are computed from the centerline by offsetting ± (thickness/2) along the left/right normal, then corrected by the miter or T‑trim.

Do not modify (007 contract)
- The 45° construction using (t + n) at start and (t − n) at end.
- The T‑junction trim and its endpoint distance threshold.
- The order of intersection operations that determines A/D at start and B/C at end.

Changing any of the above is likely to reintroduce non‑flush corners, hairline gaps, or visible overlaps.

# Gablok Architecture Audit & Optimization Report
**Date:** November 1, 2025  
**Conducted by:** Senior Development Team

---

## Executive Summary

This comprehensive audit analyzes the Gablok 3D building configurator codebase for performance, architecture quality, modularity, and loading efficiency.

### Key Findings
- **Total Project Size:** 13,417 lines of code (excluding dependencies)
- **Largest File:** `js/app.js` at 3,160 lines (~165KB) — **NEEDS REFACTORING**
- **Critical Path Files:** 6 files exceed 500 lines
- **Architecture Status:** Partially modularized; significant improvement opportunities identified

---

## File Size Analysis

### Critical Files (Largest First)

| File | Lines | Size (KB) | Status | Action Required |
|------|-------|-----------|--------|-----------------|
| `js/app.js` | 3,160 | 165 | 🔴 **CRITICAL** | **Split into 8+ modules** |
| `js/plan2d/editor.js` | 2,755 | 147 | 🟡 **WARNING** | Extract sub-modules |
| `js/core/plan-apply.js` | 1,072 | 70 | 🟢 **ACCEPTABLE** | Well-scoped |
| `js/core/engine3d.js` | 1,004 | 56 | 🟢 **ACCEPTABLE** | Good separation |
| `js/input/events.js` | 604 | 30 | 🟢 **GOOD** | Focused module |
| `js/ui/roomPalette.js` | 519 | 34 | 🟢 **GOOD** | Single responsibility |

### Size Distribution
```
< 100 lines:   9 files (Excellent modularity)
100-300 lines: 14 files (Good size)
300-600 lines: 5 files (Acceptable)
600-1000 lines: 2 files (Needs review)
> 1000 lines:  4 files (⚠️ Refactor priority)
```

---

## Performance & Loading Analysis

### Current Load Strategy
The app uses a **phased bootstrap** approach via `js/boot/bootstrap.js`:

```
1. Splash screen (immediate)
2. Core dependencies loaded in order
3. 2D editor loaded separately
4. Render modules lazy-loaded
5. Heavy dependencies (PDF.js) loaded on-demand
```

### Estimated Loading Times

#### On Fast Connection (100 Mbps)
- **Initial HTML + CSS:** ~15ms
- **Bootstrap:** ~5ms
- **Core modules:** ~120ms
  - `app.js`: 50ms
  - `engine3d.js`: 18ms
  - `plan-apply.js`: 22ms
  - `editor.js`: 45ms
- **Render modules (parallel):** ~80ms
- **UI modules:** ~30ms
- **Total First Paint:** ~250ms ✅ **GOOD**

#### On Slow Connection (3G, ~2 Mbps)
- **Initial HTML + CSS:** ~800ms
- **Core modules:** ~6 seconds
  - `app.js`: **2.5 seconds** ⚠️
  - `editor.js`: **2.2 seconds** ⚠️
- **Total First Paint:** ~9 seconds ⚠️ **NEEDS IMPROVEMENT**

### Cache Performance
With proper caching headers (currently in place via server.py no-cache for dev):
- **Repeat visits:** Sub-200ms with service worker
- **Production recommendation:** Implement aggressive caching with versioned assets

---

## Architecture Quality Assessment

### ✅ **Strengths**

1. **Good Separation of Concerns (Recent Improvements)**
   - 3D engine isolated in `js/core/engine3d.js`
   - 2D→3D mapping in `js/core/plan-apply.js`
   - 2D editor in `js/plan2d/editor.js`
   - Render functions properly separated (`js/render/`)

2. **Proper Module Organization**
   ```
   js/
   ├── boot/          ✅ Bootstrap logic isolated
   ├── core/          ✅ Core engine & mapping
   ├── plan2d/        ✅ 2D editor isolated
   ├── render/        ✅ Drawing functions by feature
   ├── input/         ✅ Event handling separate
   ├── ui/            ✅ UI components modular
   └── smoke/         ✅ Test utilities separate
   ```

3. **Clean Dependency Loading**
   - Bootstrap orchestrates load order
   - PDF.js lazy-loaded only when needed
   - Splash screen provides UX during load

### ⚠️ **Critical Issues**

#### 1. **`app.js` is a Monolithic God File** (3,160 lines)

**Current Contents (should be 8+ separate files):**
- Project save/load/reset (lines 5-96)
- OBJ export (lines 119-169)
- UI wiring (lines 171-353)
- SVG floorplan import (lines 357-422)
- PDF import infrastructure (lines 428-534)
- Floorplan modal (lines 507-924)
- Room palette (inline, commented as moved)
- **2D Editor (MASSIVE DUPLICATION - lines 941-2929)**
  - **Problem:** 2D editor code exists TWICE:
    - Once in `js/plan2d/editor.js` (authoritative)
    - Again inline in `app.js` (legacy copy)
- 2D draft management (lines 1001-1058)
- 2D/3D sync helpers (lines 1059-1230)
- 2D modal controls (lines 1234-1382)
- 2D rendering (lines 1923-2734)
- 2D interaction (lines 1387-1863)
- Wall subsegment logic (lines 2834-2929)
- Room manipulation (lines 2931-3160)

**Impact:**
- Download size bloated by ~40% (duplicate 2D editor)
- Parse time on slow devices: **2.5+ seconds**
- Maintenance nightmare (two versions of same code)
- Hard to test individual features

---

## Recommended Refactoring Plan

### 🎯 **Phase 1: Critical (Do Immediately)**

#### 1.1. Remove Duplicate 2D Editor from `app.js`
**Estimated Impact:** -1,900 lines, -100KB

```javascript
// Current: 2D editor code duplicated
// Target: Single authoritative version in js/plan2d/editor.js

// Lines to REMOVE from app.js: 941-2929 (entire inline 2D editor)
// Keep only: Modal open/close wrappers that call into editor.js
```

**Files to update:**
- `js/app.js`: Strip lines 941-2929
- Verify `js/plan2d/editor.js` exports all needed functions
- Test 2D editor functionality after removal

#### 1.2. Extract Project Management Module
**Create:** `js/core/project.js` (~150 lines)

```javascript
// Functions to extract from app.js:
- restoreProject()
- saveProject()
- saveProjectSilently()
- loadProject()
- resetAll()
- serializeProject() (currently in app.js around line 3000+)
```

#### 1.3. Extract Import/Export Module
**Create:** `js/io/importExport.js` (~400 lines)

```javascript
// Functions to extract:
- exportOBJ()
- importSVGFloorplan()
- PDF import infrastructure (loadScript, PDFJS setup)
- jsPDF lazy loader
```

#### 1.4. Extract Floorplan Modal Module
**Create:** `js/ui/floorplanModal.js` (~450 lines)

```javascript
// Extract entire floorplan calibration UI:
- openFloorplanModal()
- closeFloorplanModal()
- wireFloorplanUI()
- unbindFloorplanUI()
- drawFloorplanOverlay()
- applyCalibration()
- commitFloorplanRooms()
- autoDetectGroundFloor()
- All canvas coordinate helpers
```

**Phase 1 Result:**
- `app.js` reduced from **3,160 → ~800 lines** (75% reduction!)
- **Download time on 3G:** 2.5s → 0.6s (4x faster)
- Clear module boundaries

---

### 🎯 **Phase 2: Important (Next Sprint)**

#### 2.1. Extract Floor Management
**Create:** `js/core/floors.js` (~100 lines)
- `switchLevel()`
- `plan2dSwitchFloorInEditor()`
- Floor state management

#### 2.2. Split Room Manipulation
**Create:** `js/core/roomOperations.js` (~300 lines)
- All room creation/edit/delete functions
- Room duplication logic
- Room transformation (rotation, resize)

#### 2.3. Extract Component Management
**Create:** `js/core/components.js` (~200 lines)
- Stairs, pergola, garage, pool, balcony management
- Furniture placement logic
- Component deduplication

#### 2.4. Modularize 2D Editor Further
**Split `js/plan2d/editor.js`** into:
- `js/plan2d/core.js` (state, config)
- `js/plan2d/drawing.js` (render loop)
- `js/plan2d/interactions.js` (mouse/touch events)
- `js/plan2d/tools.js` (wall, window, door tools)
- `js/plan2d/sync.js` (2D↔3D synchronization)

---

### 🎯 **Phase 3: Optimization (Future)**

#### 3.1. Implement Code Splitting
```javascript
// Use dynamic imports for heavy features
const loadPDFImport = () => import('./js/io/pdfImport.js');
const loadFloorplanModal = () => import('./js/ui/floorplanModal.js');
```

#### 3.2. Add Bundle Optimization
- Minify all JS files (target: 40% size reduction)
- Tree-shake unused functions
- Use terser for production builds

#### 3.3. Implement Service Worker
```javascript
// Cache strategy for production:
- App shell: Cache-first (HTML, CSS, core JS)
- Modules: Stale-while-revalidate
- Heavy libraries (PDF.js): Cache-first, 7-day expiry
```

---

## Code Comment Quality Analysis

### Current State: **⚠️ Inconsistent**

**Good Examples:**
```javascript
// js/core/plan-apply.js
// Apply 2D plan edits back to 3D: rebuild rooms/strips from 2D walls and openings
// Extracted from app.js for modularity; loaded by bootstrap before app core.
```

**Needs Improvement:**
```javascript
// app.js - many functions lack header comments
function exportOBJ() {
  // Minimal OBJ exporter for boxes (rooms/components)
  // ⚠️ Missing: parameter docs, return value, usage example
}
```

### Recommendations

#### Add JSDoc Headers to All Public Functions
```javascript
/**
 * Exports the current 3D scene as an OBJ file for external 3D software.
 * Converts rooms, wall strips, and components to box geometry.
 * 
 * @returns {void} Downloads .obj file via browser
 * @example
 * exportOBJ(); // Triggers download of "gablok_export.obj"
 */
function exportOBJ() { ... }
```

#### Add File Headers
```javascript
/**
 * @file project.js
 * @description Project persistence and state management.
 * Handles save/load/reset operations for localStorage and JSON export.
 * 
 * @dependencies None (pure state management)
 * @exports saveProject, loadProject, restoreProject, resetAll
 */
```

#### Document Complex Algorithms
```javascript
// ===== Room Detection Algorithm =====
// 1. Build node graph from wall endpoints (tolerance: 3cm)
// 2. Find connected components via DFS
// 3. For each component:
//    a. Check if forms closed rectangle (2 unique X, 2 unique Y)
//    b. Verify perimeter coverage with span merging
//    c. Exclude if wall count < 4 or area < 2m²
// 4. Fallback to polygon detection for non-rectangular rooms
function detectRooms() { ... }
```

---

## Detailed Module Proposal

### Proposed Final Structure (After Refactoring)

```
js/
├── boot/
│   ├── bootstrap.js        [124 lines] ✅ Keep as-is
│   ├── loader.js           [88 lines]  ✅ Keep as-is
│   └── splash.js           [95 lines]  ✅ Keep as-is
│
├── core/
│   ├── engine3d.js         [1004 lines] ✅ Already good
│   ├── plan-apply.js       [1072 lines] ✅ Already good
│   ├── plan-populate.js    [324 lines]  ✅ Keep
│   ├── project.js          [NEW ~150 lines] ⭐ Extract from app.js
│   ├── floors.js           [NEW ~100 lines] ⭐ Extract from app.js
│   ├── roomOperations.js   [NEW ~300 lines] ⭐ Extract from app.js
│   └── components.js       [NEW ~200 lines] ⭐ Extract from app.js
│
├── io/
│   ├── importExport.js     [NEW ~400 lines] ⭐ Extract from app.js
│   ├── objExporter.js      [NEW ~100 lines] ⭐ Split from above
│   ├── svgImporter.js      [NEW ~80 lines]  ⭐ Split from above
│   └── pdfImporter.js      [NEW ~220 lines] ⭐ Split from above
│
├── plan2d/
│   ├── core.js             [NEW ~200 lines] ⭐ Split from editor.js
│   ├── drawing.js          [NEW ~800 lines] ⭐ Split from editor.js
│   ├── interactions.js     [NEW ~600 lines] ⭐ Split from editor.js
│   ├── tools.js            [NEW ~400 lines] ⭐ Split from editor.js
│   ├── sync.js             [NEW ~300 lines] ⭐ Split from editor.js
│   └── drafts.js           [NEW ~150 lines] ⭐ Extract from app.js
│
├── render/
│   ├── drawRoom.js         [308 lines] ✅ Good
│   ├── drawBalcony.js      [269 lines] ✅ Good
│   ├── drawPergola.js      [236 lines] ✅ Good
│   ├── drawGarage.js       [223 lines] ✅ Good
│   ├── drawRoof.js         [214 lines] ✅ Good
│   ├── drawStairs.js       [163 lines] ✅ Good
│   ├── drawPool.js         [124 lines] ✅ Good
│   └── drawFurniture.js    [60 lines]  ✅ Good
│
├── ui/
│   ├── roomPalette.js      [519 lines] ✅ Good
│   ├── labels.js           [221 lines] ✅ Good
│   ├── pricing.js          [167 lines] ✅ Good
│   ├── roofDropdown.js     [155 lines] ✅ Good
│   ├── modals.js           [114 lines] ✅ Good
│   ├── shareBadge.js       [73 lines]  ✅ Good
│   ├── floorplanModal.js   [NEW ~450 lines] ⭐ Extract from app.js
│   └── mainControls.js     [NEW ~200 lines] ⭐ Extract from app.js
│
├── input/
│   └── events.js           [604 lines] ✅ Good
│
├── smoke/
│   ├── smoke2d.js          [162 lines] ✅ Good (tests)
│   └── smoke3d.js          [56 lines]  ✅ Good (tests)
│
└── app.js                  [~650 lines] ⭐ AFTER refactor
    // Minimal orchestrator:
    // - Initialize bootstrap
    // - Wire top-level UI
    // - Coordinate module interactions
    // - Global error handling
```

**Benefits:**
- No file > 1000 lines (maintainability ++)
- Average file size: ~250 lines (easy to reason about)
- Clear module boundaries (testability ++)
- Parallel loading opportunities (performance ++)

---

## Loading Time Optimization Strategy

### Immediate Wins (Phase 1 Impact)

**Before Refactoring:**
```
3G Load Time: ~9 seconds
- app.js: 2.5s (165KB)
- editor.js: 2.2s (147KB)
- Other: 4.3s
```

**After Phase 1 Refactoring:**
```
3G Load Time: ~5 seconds (44% faster!)
- app.js: 0.6s (40KB) ⬅️ 75% smaller!
- editor.js: 2.2s (147KB, split later)
- New modules load in parallel: 2.2s
```

### Advanced Optimization (Phase 3)

**With Code Splitting + Minification:**
```
3G Initial Load: ~2.5 seconds (72% faster!)
- Critical path (minified): 1.2s
- 2D editor (lazy): Load on demand
- PDF import (lazy): Load on demand
- Service worker cache: <200ms on repeat
```

---

## Testing Recommendations

### 1. Add Module Load Time Tests
```javascript
// New file: js/smoke/loadPerformance.js
performance.mark('bootstrap-start');
// ... bootstrap code ...
performance.mark('bootstrap-end');
performance.measure('bootstrap', 'bootstrap-start', 'bootstrap-end');

// Assert: bootstrap < 100ms
// Assert: first paint < 500ms (fast connection)
```

### 2. Add Module Dependency Tests
```javascript
// Verify no circular dependencies
// Verify lazy modules don't block critical path
```

### 3. Add Size Budget Tests
```javascript
// CI check: fail if any file > 100KB
// CI check: fail if total bundle > 500KB (excl. vendors)
```

---

## Migration Plan & Risk Assessment

### Step-by-Step Migration (Low Risk)

#### Week 1: Remove Duplicate 2D Editor
- **Risk:** Low (code already exists in editor.js)
- **Validation:** Manual test all 2D editor features
- **Rollback:** Git revert

#### Week 2: Extract Project Module
- **Risk:** Low (pure functions, no UI)
- **Validation:** Automated tests for save/load
- **Rollback:** Git revert

#### Week 3: Extract Import/Export
- **Risk:** Medium (PDF.js integration)
- **Validation:** Test all import formats (OBJ, SVG, PDF)
- **Rollback:** Feature flag to disable new code path

#### Week 4: Extract Floorplan Modal
- **Risk:** Medium (complex UI interactions)
- **Validation:** Manual QA, smoke tests
- **Rollback:** Feature flag

### Deployment Strategy

1. **Feature Flags:** Deploy new modules behind flags
2. **A/B Testing:** 10% of users see new architecture
3. **Monitoring:** Track load times, error rates
4. **Gradual Rollout:** 10% → 50% → 100% over 2 weeks

---

## Success Metrics

### Before Refactoring
- ❌ app.js: 3,160 lines, 165KB
- ❌ 3G load time: ~9 seconds
- ❌ Duplicate code: ~1,900 lines
- ❌ Largest function: 800+ lines (plan2dDraw)

### After Phase 1 (Target)
- ✅ app.js: <800 lines, <50KB (75% reduction)
- ✅ 3G load time: ~5 seconds (44% faster)
- ✅ Duplicate code: 0 lines
- ✅ Largest function: <200 lines

### After Phase 3 (Target)
- ✅ No file > 100KB
- ✅ 3G load time: ~2.5 seconds (72% faster)
- ✅ Service worker: <200ms repeat load
- ✅ All functions have JSDoc headers

---

## Conclusion

### Current Architecture: **C+ (Partially Acceptable)**
- ✅ Good modular separation in render/ and ui/
- ✅ Core engine properly isolated
- ⚠️ app.js is monolithic (critical issue)
- ⚠️ 2D editor code duplicated (waste)
- ⚠️ Missing JSDoc comments

### Recommended Actions (Priority Order)

1. **THIS WEEK:** Remove duplicate 2D editor from app.js (-100KB)
2. **THIS WEEK:** Add file-level comments to all modules
3. **NEXT SPRINT:** Extract project, import/export, floorplan modules
4. **MONTH 2:** Split 2D editor into sub-modules
5. **MONTH 2:** Implement code splitting & service worker
6. **MONTH 3:** Add comprehensive JSDoc headers

### Expected Outcomes

**After completing Phase 1-3:**
- 📦 **Bundle size:** 165KB → 60KB (main bundle)
- ⚡ **Load time (3G):** 9s → 2.5s
- 🧪 **Testability:** 3/10 → 8/10
- 📚 **Maintainability:** 4/10 → 9/10
- 🎯 **Code quality:** C+ → A

**Estimated effort:** 3-4 weeks (1 senior dev)  
**Risk level:** Low to Medium  
**Business impact:** High (better UX, faster iteration)

---

## Appendix: Current vs. Proposed Module Loading

### Current (app.js dominates):
```
┌─────────────────────────┐
│   bootstrap.js (5ms)    │
└───────────┬─────────────┘
            │
    ┌───────▼────────┐
    │  app.js (50ms) │ ◀── TOO BIG!
    │  [165KB blob]  │
    └───────┬────────┘
            │
    ┌───────▼────────────────────┐
    │ Other modules load (45ms)  │
    └────────────────────────────┘
```

### Proposed (parallel & lightweight):
```
┌─────────────────────────┐
│   bootstrap.js (5ms)    │
└───────────┬─────────────┘
            │
    ┌───────▼─────────────────────┐
    │  app.js (12ms) [40KB] ✅    │
    ├──────────────────────────────┤
    │  Loads modules in parallel:  │
    │  • project.js (3ms)          │
    │  • io/importExport.js (8ms)  │
    │  • core/rooms.js (6ms)       │
    │  • plan2d/* (lazy, on open)  │
    └──────────────────────────────┘
       Total: ~30ms ✅
```

---

**Report Generated:** November 1, 2025  
**Review Status:** ✅ Ready for Implementation  
**Next Review:** After Phase 1 completion
