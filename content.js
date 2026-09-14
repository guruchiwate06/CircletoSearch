/**
 * content.js — Circle to Search Overlay
 *
 * Injects a full-screen canvas when activated. The user draws a freehand
 * shape; on mouseup the extension:
 *   1. Real-time smoothing: renders the stroke with mid-point quadratic Bézier
 *      curves during mousemove for a fluid, Google-like feel.
 *   2. Self-correction: on mouseup, computes the centroid + bounding box of all
 *      captured points, clears the raw path, and animates a clean glowing ellipse
 *      that snaps into place with a pulse (snap → glow → fade, ~600 ms total).
 *   3. Requests a screenshot from background.js, crops it to the corrected
 *      bounding box (DPR-scaled for Retina / 4K), and downloads the result.
 * All event listeners are named and removed on cleanup — no stray handlers.
 */

(function () {
  'use strict';

  // ─── State ──────────────────────────────────────────────────────────────────

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

  // ─── Overlay lifecycle ───────────────────────────────────────────────────────

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
    // mouseup on window — fires even if the cursor leaves the canvas during
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

    // mouseup was registered on window, not canvas — remove it there.
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

  // ─── Canvas styling ──────────────────────────────────────────────────────────

  function applyDrawingStyles() {
    // Glowing light-blue stroke — mimics Google Circle to Search
    ctx.strokeStyle = '#38BDF8';           // Sky-blue
    ctx.lineWidth   = 3.5;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.shadowColor = '#7DD3FC';           // Softer outer glow
    ctx.shadowBlur  = 16;
  }

  // ─── Drawing handlers ────────────────────────────────────────────────────────

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

    // Phase 1 — snap raw stroke into clean ellipse with pulse animation (~600 ms).
    // Phase 2 — once animation ends, crop the pre-captured screenshot and download.
    animateSnapToEllipse({ cx, cy, rx: width / 2, ry: height / 2 }, () => {
      if (storedScreenshot) {
        cropAndDownload(storedScreenshot, bbox, window.devicePixelRatio || 1);
      } else {
        console.warn('[Circle to Search] No screenshot available — skipping crop.');
      }
      // Brief pause so the user sees the final glow before the overlay disappears.
      setTimeout(removeOverlay, 200);
    });
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') removeOverlay();
  }

  // ─── Real-time stroke smoothing ───────────────────────────────────────────────

  /**
   * Re-draws the entire stroke on every mousemove using mid-point quadratic
   * Bézier curves. Each segment curves through the midpoint of consecutive
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

  // ─── Snap-to-ellipse animation ────────────────────────────────────────────────

  /**
   * Clears the raw stroke and animates a polished, glowing ellipse that
   * "snaps" into place over ~600 ms in three phases:
   *
   *   Phase A (0 – 150 ms)  — ellipse scales up from 0 → 1 (snap-in).
   *   Phase B (150 – 400 ms) — shadowBlur pulses from 16 → 40 (glow peak).
   *   Phase C (400 – 600 ms) — shadowBlur settles back to 16 (calm glow).
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
     * Ease-out cubic: fast start, gradual finish — good for a "snap" feel.
     * @param {number} t  Progress in [0, 1].
     */
    function easeOutCubic(t) {
      return 1 - Math.pow(1 - t, 3);
    }

    /**
     * Draw a single ellipse frame.
     * @param {number} scale   Radii multiplier (0 → 1 during snap-in).
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
        // Phase A — snap in.
        const t = elapsed / SNAP_MS;
        scale = easeOutCubic(t);
        blur  = 16;
        alpha = 1;
      } else if (elapsed < SNAP_MS + GLOW_MS) {
        // Phase B — glow pulse.
        const t = (elapsed - SNAP_MS) / GLOW_MS;
        scale = 1;
        // Pulse blur 16 → 40 → 16 using a sine wave.
        blur  = 16 + 24 * Math.sin(t * Math.PI);
        alpha = 1;
      } else {
        // Phase C — settle.
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

  // ─── Crop → download ─────────────────────────────────────────────────────────

  /**
   * Loads the pre-captured screenshot, crops it to the selection bounding box
   * (accounting for devicePixelRatio), and triggers a browser download directly
   * from the content script via a hidden <a download> anchor + Blob URL.
   *
   * NOTE: chrome.downloads.download() rejects data: URLs in MV3 — we avoid
   * that entire path by using URL.createObjectURL() here instead.
   *
   * @param {string} screenshotUrl - Base64 PNG data URL of the full tab.
   * @param {{ minX: number, minY: number, width: number, height: number }} bbox - CSS-pixel coords.
   * @param {number} dpr - devicePixelRatio at capture time.
   */
  function cropAndDownload(screenshotUrl, bbox, dpr) {
    const img = new Image();

    img.onload = () => {
      // Scale CSS-pixel coordinates to physical device pixels.
      const sx = Math.round(bbox.minX  * dpr);
      const sy = Math.round(bbox.minY  * dpr);
      const sw = Math.round(bbox.width  * dpr);
      const sh = Math.round(bbox.height * dpr);

      // Guard against a zero-area or out-of-bounds crop.
      if (sw <= 0 || sh <= 0) {
        console.warn('[Circle to Search] Crop area is empty — nothing to download.');
        return;
      }

      // Off-screen canvas — never added to the DOM.
      const offscreen = document.createElement('canvas');
      offscreen.width  = sw;
      offscreen.height = sh;

      const offCtx = offscreen.getContext('2d');

      // drawImage(img, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight)
      offCtx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

      const croppedDataUrl = offscreen.toDataURL('image/png');
      console.log('[Circle to Search] Cropped image ready. Size:', sw, 'x', sh, 'px');

      // Convert data URL → Blob → object URL so the <a> download works reliably.
      // chrome.downloads.download() does not accept data: URLs in MV3.
      const byteString = atob(croppedDataUrl.split(',')[1]);
      const mimeType   = 'image/png';
      const byteArray  = new Uint8Array(byteString.length);
      for (let i = 0; i < byteString.length; i++) {
        byteArray[i] = byteString.charCodeAt(i);
      }
      const blob    = new Blob([byteArray], { type: mimeType });
      const blobUrl = URL.createObjectURL(blob);

      // Trigger download via hidden anchor — works from content scripts.
      const a      = document.createElement('a');
      a.href       = blobUrl;
      a.download   = 'cropped-selection.png';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      // Release the object URL after a tick so the browser can process the click.
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      console.log('[Circle to Search] Download triggered.');
    };

    img.onerror = () => {
      console.error('[Circle to Search] Failed to load screenshot for cropping.');
    };

    img.src = screenshotUrl;
  }

  // ─── Geometry helpers ─────────────────────────────────────────────────────────

  /**
   * Computes the axis-aligned bounding box AND the centroid (center of mass)
   * of the drawn path points.
   *
   * @param {{ x: number, y: number }[]} pts
   * @returns {{
   *   minX: number, minY: number,
   *   maxX: number, maxY: number,
   *   width: number, height: number,
   *   cx: number, cy: number   ← geometric center of the bounding box
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

  // ─── Message listener ────────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.action !== 'toggle-overlay') return;

    if (overlayActive) {
      removeOverlay();
    } else {
      // Store the pre-captured screenshot sent by background.js.
      // It was taken the moment Alt+S was pressed — clean, no overlay visible.
      storedScreenshot = message.screenshotUrl || null;
      if (!storedScreenshot) {
        console.warn('[Circle to Search] No screenshot in toggle message — crop will be skipped.');
      }
      createOverlay();
    }
  });

})();
