/**
 * Global smooth vertical wheel scrolling (tweened).
 *
 * Goal: make mouse-wheel scrolling feel smooth/elegant without breaking:
 * - trackpads (already smooth)
 * - textareas / inputs / contenteditable (native scrolling)
 * - prefers-reduced-motion users
 */
(function () {
  if (window.__gablokSmoothScrollTweenInstalled) return;
  window.__gablokSmoothScrollTweenInstalled = true;

  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
  } catch (_ePRM) {}

  var scrollerStates = new WeakMap();

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function isEditableTarget(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    var tag = (el.tagName || '').toLowerCase();
    if (tag === 'textarea') return true;
    if (tag === 'input') {
      var type = (el.getAttribute('type') || '').toLowerCase();
      // Allow native wheel behavior in inputs (number/date etc).
      return type !== 'checkbox' && type !== 'radio' && type !== 'button' && type !== 'submit';
    }
    if (tag === 'select') return true;
    return false;
  }

  function hasScrollableY(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    try {
      var style = window.getComputedStyle(el);
      var overflowY = style && style.overflowY;
      if (overflowY !== 'auto' && overflowY !== 'scroll') return false;
    } catch (_eStyle) {
      return false;
    }
    return el.scrollHeight > el.clientHeight + 1;
  }

  function findScrollableAncestor(startEl) {
    var el = startEl;
    while (el && el !== document.documentElement) {
      if (hasScrollableY(el)) return el;
      el = el.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function getState(scroller) {
    var st = scrollerStates.get(scroller);
    if (!st) {
      st = { target: scroller.scrollTop || 0, raf: 0, lastTs: 0 };
      scrollerStates.set(scroller, st);
    }
    return st;
  }

  function step(scroller, st, ts) {
    if (!st.lastTs) st.lastTs = ts;
    var dt = ts - st.lastTs;
    st.lastTs = ts;

    // Exponential smoothing. Larger dt => slightly larger step.
    var current = scroller.scrollTop;
    var diff = st.target - current;

    if (Math.abs(diff) < 0.5) {
      scroller.scrollTop = st.target;
      st.raf = 0;
      return;
    }

    // Base smoothing factor (per ~16ms frame). Clamp to keep stable.
    var alpha = 0.18;
    if (dt > 16) alpha = clamp(alpha + (dt - 16) * 0.003, 0.18, 0.34);

    scroller.scrollTop = current + diff * alpha;
    st.raf = window.requestAnimationFrame(function (t) {
      step(scroller, st, t);
    });
  }

  function animateTo(scroller, st) {
    if (st.raf) return;
    st.raf = window.requestAnimationFrame(function (t) {
      step(scroller, st, t);
    });
  }

  function normalizeWheelDelta(ev, scroller) {
    var deltaY = ev.deltaY;
    if (!deltaY) return 0;

    // If this looks like a trackpad (tiny deltas), prefer native.
    if (ev.deltaMode === 0 && Math.abs(deltaY) < 12) return null;

    // Convert to pixels.
    if (ev.deltaMode === 1) {
      // Lines
      deltaY *= 16;
    } else if (ev.deltaMode === 2) {
      // Pages
      deltaY *= (scroller && scroller.clientHeight ? scroller.clientHeight : window.innerHeight) * 0.9;
    }

    return deltaY;
  }

  function onWheel(ev) {
    try {
      if (!ev || ev.defaultPrevented) return;
      if (ev.ctrlKey || ev.metaKey) return; // allow zoom/gestures

      var target = ev.target;
      if (isEditableTarget(target)) return;

      // If inside an explicitly editable ancestor, don't hijack.
      var editableAncestor = target && target.closest && target.closest('textarea,input,select,[contenteditable="true"]');
      if (editableAncestor) return;

      var scroller = findScrollableAncestor(target);
      if (!scroller) return;

      // If already at extremes and user keeps scrolling, let browser handle overscroll.
      var st = getState(scroller);
      st.target = scroller.scrollTop;

      var normalized = normalizeWheelDelta(ev, scroller);
      if (normalized === null) return; // trackpad-ish
      if (!normalized) return;

      var maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      var nextTarget = clamp(st.target + normalized, 0, maxScroll);

      // If there's nowhere to scroll, let it bubble.
      if (maxScroll <= 0 || nextTarget === st.target) return;

      ev.preventDefault();
      st.target = nextTarget;
      animateTo(scroller, st);
    } catch (_eWheel) {
      // Fail open (native scroll)
    }
  }

  // Capture-phase + non-passive so we can preventDefault.
  window.addEventListener('wheel', onWheel, { passive: false, capture: true });
})();
