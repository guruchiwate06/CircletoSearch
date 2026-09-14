/**
 * content.js ΓÇö Circle to Search Overlay
 *
 * Injects a full-screen canvas when activated. The user draws a freehand
 * shape; on mouseup the extension:
 *   1. Real-time smoothing: renders the stroke with mid-point quadratic B├⌐zier
 *      curves during mousemove for a fluid, Google-like feel.
 *   2. Self-correction: on mouseup, computes the centroid + bounding box of all
 *      captured points, clears the raw path, and animates a clean glowing ellipse
 *      that snaps into place with a pulse (snap ΓåÆ glow ΓåÆ fade, ~600 ms total).
 *   3. Requests a screenshot from background.js, crops it to the corrected
 *      bounding box (DPR-scaled for Retina / 4K), and downloads the result.
 * All event listeners are named and removed on cleanup ΓÇö no stray handlers.
 */

(function () {
  'use strict';

  // ΓöÇΓöÇΓöÇ State ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

  let overlayActive = false;
  let canvas        = null;
  let ctx           = null;
  let isDrawing       = false;
  let points          = [];          // Collected pointer positions for the current stroke
  let animFrameId     = null;        // requestAnimationFrame handle for snap animation
  let storedScreenshot = null;       // Pre-captured PNG from background.js (taken at Alt+S time)

  // Stored so they can be passed to removeEventListener verbatim
  let _onMouseDown = null;
  let _onMouseMove = null;
  let _onMouseUp   = null;
  let _onKeyDown   = null;

  // ΓöÇΓöÇΓöÇ Toast notification ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

  /**
   * Shows a brief floating notification pill at the top-centre of the viewport.
   * Slides down on entry, slides up on exit. No emojis — clean, typographic only.
   *
   * @param {string} text
   * @param {'info'|'error'} [type='info']
   * @param {number} [duration=2000]
   */
  function showToast(text, type = 'info', duration = 2000) {
    const pill = document.createElement('div');
    pill.textContent = text;

    const isError = type === 'error';

    Object.assign(pill.style, {
      // Layout
      position:          'fixed',
      top:               '28px',
      left:              '50%',
      zIndex:            '2147483647',
      pointerEvents:     'none',
      whiteSpace:        'nowrap',

      // Start off-screen (slides in)
      transform:         'translateX(-50%) translateY(-14px)',
      opacity:           '0',

      // Pill shape
      padding:           '11px 26px',
      borderRadius:      '999px',

      // Typography — Helvetica Neue on Mac, Segoe UI on Windows, clean system-ui fallback
      fontFamily:        "'Helvetica Neue', 'Segoe UI', system-ui, -apple-system, sans-serif",
      fontSize:          '11px',
      fontWeight:        '500',
      letterSpacing:     '0.10em',
      textTransform:     'uppercase',
      color:             isError ? '#fca5a5' : 'rgba(255, 255, 255, 0.92)',

      // Frosted-glass background
      background:        isError
        ? 'rgba(30, 8, 8, 0.88)'
        : 'rgba(8, 12, 20, 0.86)',
      backdropFilter:    'blur(24px) saturate(1.6)',
      WebkitBackdropFilter: 'blur(24px) saturate(1.6)',

      // Border — hairline, no color accent
      border:            isError
        ? '1px solid rgba(248, 113, 113, 0.35)'
        : '1px solid rgba(255, 255, 255, 0.10)',

      // Shadow
      boxShadow:         '0 12px 40px rgba(0, 0, 0, 0.55), 0 1px 0 rgba(255,255,255,0.06) inset',

      // Transition
      transition:        'opacity 0.35s ease, transform 0.35s cubic-bezier(0.22, 1, 0.36, 1)',
    });

    document.documentElement.appendChild(pill);

    // Slide in on the next frame so the browser registers the initial state first.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        pill.style.opacity   = '1';
        pill.style.transform = 'translateX(-50%) translateY(0)';
      });
    });

    // Slide out then remove.
    setTimeout(() => {
      pill.style.opacity   = '0';
      pill.style.transform = 'translateX(-50%) translateY(-10px)';
      setTimeout(() => pill.remove(), 400);
    }, duration);
  }

  // ΓöÇΓöÇΓöÇ Overlay lifecycle ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

  function createOverlay() {
    if (overlayActive) return;
    overlayActive = true;
    isDrawing     = false;
    points        = [];

    // Build the canvas element
    canvas = document.createElement('canvas');
    canvas.id = 'desktop-circle-search-overlay';

    // Fixed, full-viewport, top z-index
    Object.assign(canvas.style, {
      position:        'fixed',
      top:             '0',
      left:            '0',
      width:           '100vw',
      height:          '100vh',
      zIndex:          '2147483647',
      cursor:          'crosshair',
      // Subtle dark wash so the glowing stroke pops against any page
      background:      'rgba(0, 0, 0, 0.18)',
      // Prevent the canvas from swallowing text selection on the page beneath
      userSelect:      'none',
      touchAction:     'none',
    });

    // Match actual device pixels
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;

    ctx = canvas.getContext('2d');
    applyDrawingStyles();

    // Register named listeners
    _onMouseDown = handleMouseDown;
    _onMouseMove = handleMouseMove;
    _onMouseUp   = handleMouseUp;
    _onKeyDown   = handleKeyDown;

    canvas.addEventListener('mousedown', _onMouseDown);
    canvas.addEventListener('mousemove', _onMouseMove);
    // mouseup on window ΓÇö fires even if the cursor leaves the canvas during
    // a fast circular stroke, preventing the overlay from getting stuck.
    window.addEventListener('mouseup',   _onMouseUp);
    document.addEventListener('keydown', _onKeyDown);

    document.documentElement.appendChild(canvas);
  }

  function removeOverlay() {
    if (!overlayActive) return;
    overlayActive = false;

    // Cancel any in-flight snap animation.
    if (animFrameId !== null) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }

    // mouseup was registered on window, not canvas ΓÇö remove it there.
    window.removeEventListener('mouseup', _onMouseUp);

    if (canvas) {
      canvas.removeEventListener('mousedown', _onMouseDown);
      canvas.removeEventListener('mousemove', _onMouseMove);
      canvas.remove();
      canvas = null;
      ctx    = null;
    }

    storedScreenshot = null;

    document.removeEventListener('keydown', _onKeyDown);

    _onMouseDown = null;
    _onMouseMove = null;
    _onMouseUp   = null;
    _onKeyDown   = null;

    isDrawing = false;
    points    = [];
  }

  // ΓöÇΓöÇΓöÇ Canvas styling ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

  function applyDrawingStyles() {
    // Glowing light-blue stroke ΓÇö mimics Google Circle to Search
    ctx.strokeStyle = '#38BDF8';           // Sky-blue
    ctx.lineWidth   = 3.5;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.shadowColor = '#7DD3FC';           // Softer outer glow
    ctx.shadowBlur  = 16;
  }

  // ΓöÇΓöÇΓöÇ Drawing handlers ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

  function handleMouseDown(e) {
    // Only respond to primary button
    if (e.button !== 0) return;

    isDrawing = true;
    points    = [{ x: e.clientX, y: e.clientY }];

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    ctx.moveTo(e.clientX, e.clientY);
  }

  function handleMouseMove(e) {
    if (!isDrawing) return;

    points.push({ x: e.clientX, y: e.clientY });
    renderStroke();
  }

  function handleMouseUp(e) {
    if (!isDrawing) return;

    isDrawing = false;
    points.push({ x: e.clientX, y: e.clientY });

    if (points.length < 2) {
      removeOverlay();
      return;
    }

    const { minX, minY, width, height, cx, cy } = computeBoundingBox(points);
    const bbox = { minX, minY, width, height };
    console.log('[Circle to Search] Corrected bbox:', bbox, '  centroid:', { cx, cy });

    // Phase 1 ΓÇö snap raw stroke into clean ellipse with pulse animation (~600 ms).
    // Phase 2 ΓÇö once animation ends, crop the pre-captured screenshot and download.
    animateSnapToEllipse({ cx, cy, rx: width / 2, ry: height / 2 }, () => {
      if (storedScreenshot) {
        showToast('Selection captured');
        cropToMemory(storedScreenshot, bbox, window.devicePixelRatio || 1);
      } else {
        showToast('Capture failed — reload the extension', 'error', 4000);
        console.warn('[Circle to Search] No screenshot available ΓÇö skipping crop.');
      }
      // Brief pause so the user sees the final glow before the overlay disappears.
      setTimeout(removeOverlay, 200);
    });
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') removeOverlay();
  }

  // ΓöÇΓöÇΓöÇ Real-time stroke smoothing ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

  /**
   * Re-draws the entire stroke on every mousemove using mid-point quadratic
   * B├⌐zier curves. Each segment curves through the midpoint of consecutive
   * samples rather than drawing straight lines between raw pointer positions,
   * producing a smooth, fluid line in real-time.
   */
  function renderStroke() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (points.length < 2) return;

    // Re-apply styles after clearRect (shadowBlur resets in some browsers).
    applyDrawingStyles();

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length - 1; i++) {
      // Control point = raw sample; end point = midpoint to next sample.
      const cpX  = points[i].x;
      const cpY  = points[i].y;
      const endX = (points[i].x + points[i + 1].x) / 2;
      const endY = (points[i].y + points[i + 1].y) / 2;
      ctx.quadraticCurveTo(cpX, cpY, endX, endY);
    }

    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }

  // ΓöÇΓöÇΓöÇ Snap-to-ellipse animation ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

  /**
   * Clears the raw stroke and animates a polished, glowing ellipse that
   * "snaps" into place over ~600 ms in three phases:
   *
   *   Phase A (0 ΓÇô 150 ms)  ΓÇö ellipse scales up from 0 ΓåÆ 1 (snap-in).
   *   Phase B (150 ΓÇô 400 ms) ΓÇö shadowBlur pulses from 16 ΓåÆ 40 (glow peak).
   *   Phase C (400 ΓÇô 600 ms) ΓÇö shadowBlur settles back to 16 (calm glow).
   *
   * @param {{ cx: number, cy: number, rx: number, ry: number }} ellipse
   * @param {() => void} onComplete  Called once when the animation finishes.
   */
  function animateSnapToEllipse({ cx, cy, rx, ry }, onComplete) {
    const SNAP_MS  = 150;   // Phase A duration
    const GLOW_MS  = 250;   // Phase B duration
    const SETTLE_MS = 200;  // Phase C duration
    const TOTAL_MS = SNAP_MS + GLOW_MS + SETTLE_MS;

    const startTime = performance.now();

    /**
     * Ease-out cubic: fast start, gradual finish ΓÇö good for a "snap" feel.
     * @param {number} t  Progress in [0, 1].
     */
    function easeOutCubic(t) {
      return 1 - Math.pow(1 - t, 3);
    }

    /**
     * Draw a single ellipse frame.
     * @param {number} scale   Radii multiplier (0 ΓåÆ 1 during snap-in).
     * @param {number} blur    shadowBlur value.
     * @param {number} alpha   Global opacity (reserved for future fade-out).
     */
    function drawEllipseFrame(scale, blur, alpha) {
      if (!ctx || !canvas) return;  // Guard: overlay may have been force-closed.

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      ctx.globalAlpha  = alpha;
      ctx.strokeStyle  = '#38BDF8';
      ctx.lineWidth    = 3.5;
      ctx.lineCap      = 'round';
      ctx.shadowColor  = '#7DD3FC';
      ctx.shadowBlur   = blur;

      ctx.beginPath();
      // canvas ellipse: (cx, cy, radiusX, radiusY, rotation, startAngle, endAngle)
      ctx.ellipse(cx, cy, Math.max(1, rx * scale), Math.max(1, ry * scale), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    function tick(now) {
      if (!canvas) return;  // Overlay was dismissed mid-animation.

      const elapsed = now - startTime;
      const progress = Math.min(elapsed / TOTAL_MS, 1);

      let scale, blur, alpha;

      if (elapsed < SNAP_MS) {
        // Phase A ΓÇö snap in.
        const t = elapsed / SNAP_MS;
        scale = easeOutCubic(t);
        blur  = 16;
        alpha = 1;
      } else if (elapsed < SNAP_MS + GLOW_MS) {
        // Phase B ΓÇö glow pulse.
        const t = (elapsed - SNAP_MS) / GLOW_MS;
        scale = 1;
        // Pulse blur 16 ΓåÆ 40 ΓåÆ 16 using a sine wave.
        blur  = 16 + 24 * Math.sin(t * Math.PI);
        alpha = 1;
      } else {
        // Phase C ΓÇö settle.
        scale = 1;
        blur  = 16;
        alpha = 1;
      }

      drawEllipseFrame(scale, blur, alpha);

      if (progress < 1) {
        animFrameId = requestAnimationFrame(tick);
      } else {
        animFrameId = null;
        onComplete();
      }
    }

    animFrameId = requestAnimationFrame(tick);
  }

  // ΓöÇΓöÇΓöÇ Crop ΓåÆ memory ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

  /**
   * Loads the pre-captured screenshot, crops it to the selection bounding box
   * (DPR-scaled for Retina / 4K), and stores the result as a Base64 Data URL
   * in `window.currentCroppedImage`. No file is written to disk.
   *
   * @param {string} screenshotUrl - Base64 PNG data URL of the full tab.
   * @param {{ minX: number, minY: number, width: number, height: number }} bbox - CSS-pixel coords.
   * @param {number} dpr - devicePixelRatio at capture time.
   */
  function cropToMemory(screenshotUrl, bbox, dpr) {
    const img = new Image();

    img.onload = () => {
      // Scale CSS-pixel coordinates to physical device pixels.
      const sx = Math.round(bbox.minX  * dpr);
      const sy = Math.round(bbox.minY  * dpr);
      const sw = Math.round(bbox.width  * dpr);
      const sh = Math.round(bbox.height * dpr);

      // Guard against a zero-area or out-of-bounds crop.
      if (sw <= 0 || sh <= 0) {
        console.warn('[Circle to Search] Crop area is empty ΓÇö nothing to download.');
        return;
      }

      // Off-screen canvas ΓÇö never added to the DOM.
      const offscreen = document.createElement('canvas');
      offscreen.width  = sw;
      offscreen.height = sh;

      const offCtx = offscreen.getContext('2d');

      // drawImage(img, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight)
      offCtx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

      const croppedDataUrl = offscreen.toDataURL('image/png');

      // Store in memory ΓÇö no file download.
      window.currentCroppedImage = croppedDataUrl;
      console.log('Cropped image ready in memory:', window.currentCroppedImage);
    };

    img.onerror = () => {
      console.error('[Circle to Search] Failed to load screenshot for cropping.');
    };

    img.src = screenshotUrl;
  }

  // ΓöÇΓöÇΓöÇ Geometry helpers ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

  /**
   * Computes the axis-aligned bounding box AND the centroid (center of mass)
   * of the drawn path points.
   *
   * @param {{ x: number, y: number }[]} pts
   * @returns {{
   *   minX: number, minY: number,
   *   maxX: number, maxY: number,
   *   width: number, height: number,
   *   cx: number, cy: number   ΓåÉ geometric center of the bounding box
   * }}
   */
  function computeBoundingBox(pts) {
    let minX = Infinity,  minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    let sumX = 0, sumY = 0;

    for (const { x, y } of pts) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      sumX += x;
      sumY += y;
    }

    const width  = maxX - minX;
    const height = maxY - minY;

    return {
      minX:   Math.round(minX),
      minY:   Math.round(minY),
      maxX:   Math.round(maxX),
      maxY:   Math.round(maxY),
      width:  Math.round(width),
      height: Math.round(height),
      // Geometric center of the bounding box (used for ellipse placement).
      cx:     minX + width  / 2,
      cy:     minY + height / 2,
    };
  }

  // ΓöÇΓöÇΓöÇ Message listener ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.action !== 'toggle-overlay') return;

    if (overlayActive) {
      removeOverlay();
    } else {
      // Store the pre-captured screenshot sent by background.js.
      // It was taken the moment Alt+S was pressed ΓÇö clean, no overlay visible.
      storedScreenshot = message.screenshotUrl || null;
      if (storedScreenshot) {
        showToast('Draw to capture');
      } else {
        showToast('Capture unavailable — reload the extension', 'error', 4000);
        console.warn('[Circle to Search] No screenshot in toggle message ΓÇö crop will be skipped.');
      }
      createOverlay();
    }
  });

})();
