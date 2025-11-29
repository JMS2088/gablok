# Critical Lesson Learned - November 29, 2025

## The Failure

A "3D object off-center" bug took 4+ hours to fix due to poor debugging methodology.

## What Went Wrong

1. **Made assumptions instead of reading code thoroughly**
   - Assumed the issue was in camera targeting when it was in canvas sizing
   - Didn't trace the complete rendering pipeline before making changes

2. **Fixed symptoms, not root causes**
   - Added `autoCenterCameraY()` - unnecessary complexity
   - Tweaked camera.targetY values - treating symptoms
   - The actual bug: double pixel-ratio multiplication + `object-fit: cover` cropping

3. **Incremental guessing instead of systematic audit**
   - Made small changes, tested, failed, repeat
   - Should have mapped the entire data flow FIRST

4. **Ignored the full stack**
   - HTML structure
   - CSS layout and computed styles (`!important` overrides, `object-fit`)
   - JavaScript canvas sizing
   - Three.js renderer configuration (`setPixelRatio` + `setSize` interaction)
   - Camera aspect ratio and projection
   - Scene geometry placement

## The Correct Approach

When told to "check everything," that means:

### 1. Map the Complete Pipeline
```
Container dimensions (CSS)
    ↓
Canvas element sizing (JS + CSS)
    ↓
Renderer buffer size (Three.js setSize)
    ↓
Pixel ratio handling (setPixelRatio)
    ↓
Camera aspect ratio
    ↓
Projection matrix
    ↓
Scene geometry bounds
    ↓
Final rendered output
```

### 2. Read ALL Relevant Code Before Changing Anything
- Don't skim - read line by line
- Understand the math
- Check for conflicting configurations

### 3. Verify Each Layer
- Console log dimensions at every step
- Check CSS computed values in DevTools
- Verify aspect ratios match throughout

### 4. Question Every Multiplication
- Pixel ratios are a common source of bugs
- Watch for double-application of scaling factors

## The Actual Bugs Found

1. **Double pixel ratio**: Code calculated `width * pixelRatio` then passed to `renderer.setSize()` which ALSO applies `renderer.setPixelRatio()` internally

2. **CSS cropping**: `object-fit: cover` was cropping the oversized canvas buffer, cutting off content from edges

3. **Conflicting styles**: CSS had `width: 100% !important` overriding JS-set dimensions

## Time Cost

4+ hours of user's time wasted due to sloppy debugging.

## The Standard

**Every pixel matters.** 

When debugging visual issues:
- Audit the complete rendering stack
- Read all code involved, not just suspected areas
- Verify math at every transformation step
- Don't make changes until root cause is understood
- One focused fix, not multiple guesses
