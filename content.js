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

  // Side panel state
  let panelHost     = null;   // <div> appended to <html> that hosts the Shadow DOM
  let panelShadow   = null;   // ShadowRoot (closed) for full CSS isolation
  let lensResultUrl = null;   // Cached results URL for "Open in new tab" fallback
  let _onPanelEsc   = null;   // Named ESC listener so we can remove it on close

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
      // Multi-colored glowing border on all sides
      boxSizing:       'border-box',
      boxShadow:       'inset 0 0 0 2px rgba(236, 72, 153, 0.8), ' +
                       'inset 0 0 24px rgba(236, 72, 153, 0.6), ' +
                       'inset 0 0 48px rgba(168, 85, 247, 0.4), ' +
                       'inset 0 0 48px rgba(245, 158, 11, 0.4)',
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
    // Glowing gradient stroke
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#a855f7');   // Purple
    gradient.addColorStop(0.5, '#ec4899'); // Pink
    gradient.addColorStop(1, '#f59e0b');   // Yellow

    ctx.strokeStyle = gradient;
    ctx.lineWidth   = 4;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.shadowColor = '#ec4899';           // Pink outer glow
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
        showToast('Searching Google Lens');
        cropAndLensSearch(storedScreenshot, bbox, window.devicePixelRatio || 1);
      } else {
        showToast('Capture failed — reload the extension', 'error', 4000);
        console.warn('[Circle to Search] No screenshot available ΓÇö skipping crop.');
      }
      // Brief pause so the user sees the final glow before the overlay disappears.
      setTimeout(removeOverlay, 200);
    });
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      removeOverlay();
      closeSidePanel();
    }
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

      const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      gradient.addColorStop(0, '#a855f7');
      gradient.addColorStop(0.5, '#ec4899');
      gradient.addColorStop(1, '#f59e0b');

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      ctx.globalAlpha  = alpha;
      ctx.strokeStyle  = gradient;
      ctx.lineWidth    = 4;
      ctx.lineCap      = 'round';
      ctx.shadowColor  = '#ec4899';
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

  // ─── Crop & Lens Search ─────────────────────────────────────────────────────

  /**
   * Crops the pre-captured screenshot to the selection bounding box (DPR-scaled),
   * converts it to a Base64 PNG Data URL, and forwards it to background.js to
   * perform a Google Lens visual search in a new tab.
   *
   * @param {string} screenshotUrl - Base64 PNG data URL of the full tab.
   * @param {{ minX: number, minY: number, width: number, height: number }} bbox - CSS-pixel coords.
   * @param {number} dpr - devicePixelRatio at capture time.
   */
  function cropAndLensSearch(screenshotUrl, bbox, dpr) {
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

      // Open the side panel immediately with the thumbnail preview.
      // The iframe content loads asynchronously once background.js returns the URL.
      openSidePanel(croppedDataUrl);

      // Forward to the service worker for Google Lens upload.
      chrome.runtime.sendMessage(
        { action: 'searchGoogleLens', imageData: croppedDataUrl },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error('[Circle to Search] Lens message error:', chrome.runtime.lastError.message);
            showToast('Err: ' + chrome.runtime.lastError.message, 'error', 6000);
            return;
          }
          if (response?.success) {
            loadLensResultsInPanel(response.url);
          } else {
            console.error('[Circle to Search] Lens search failed:', response?.error);
            showToast('Err: ' + (response?.error || 'Unknown error'), 'error', 6000);
          }
        }
      );
    };

    img.onerror = () => {
      console.error('[Circle to Search] Failed to load screenshot for cropping.');
    };

    img.src = screenshotUrl;
  }

  // --- Results side panel ---------------------------------------------------

  // CSS injected into the Shadow DOM — fully isolated from the host page.
  const PANEL_CSS = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    .panel {
      position: fixed;
      top: 0;
      right: 0;
      width: 420px;
      height: 100vh;
      z-index: 2147483646;
      display: flex;
      flex-direction: column;
      background: #0b0e17;
      box-shadow: -16px 0 56px rgba(0,0,0,0.70);
      transform: translateX(100%);
      transition: transform 0.38s cubic-bezier(0.22, 1, 0.36, 1);
      overflow: hidden;
      font-family: 'Helvetica Neue', 'Segoe UI', system-ui, -apple-system, sans-serif;
    }

    .panel::before {
      content: "";
      position: absolute;
      top: 0; left: 0; bottom: 0;
      width: 2px;
      background: linear-gradient(to bottom, #a855f7, #ec4899, #f59e0b);
      box-shadow: 0 0 14px rgba(236, 72, 153, 0.8);
      z-index: 10;
    }

    .panel.open { transform: translateX(0); }

    /* ---- Header ---- */
    .header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 14px;
      height: 50px;
      flex-shrink: 0;
      border-bottom: 1px solid rgba(255,255,255,0.055);
    }

    .header-title {
      font-size: 10.5px;
      font-weight: 500;
      letter-spacing: 0.09em;
      text-transform: uppercase;
      color: rgba(255,255,255,0.38);
      flex: 1;
    }

    .btn {
      background: transparent;
      border: 1px solid rgba(255,255,255,0.09);
      border-radius: 6px;
      color: rgba(255,255,255,0.55);
      cursor: pointer;
      font-family: inherit;
      font-size: 10.5px;
      font-weight: 500;
      letter-spacing: 0.04em;
      padding: 5px 11px;
      line-height: 1;
      transition: background 0.14s, border-color 0.14s, color 0.14s;
      white-space: nowrap;
    }

    .btn:hover {
      background: rgba(255,255,255,0.07);
      border-color: rgba(255,255,255,0.20);
      color: rgba(255,255,255,0.88);
    }

    .btn-close {
      padding: 4px 9px;
      font-size: 15px;
      border-color: transparent;
    }

    /* ---- Thumbnail ---- */
    .thumb-section {
      padding: 12px 14px;
      border-bottom: 1px solid rgba(255,255,255,0.055);
      flex-shrink: 0;
    }

    .thumb-label {
      font-size: 9px;
      letter-spacing: 0.10em;
      text-transform: uppercase;
      color: rgba(255,255,255,0.26);
      margin-bottom: 7px;
    }

    .thumb-frame {
      border-radius: 7px;
      overflow: hidden;
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.07);
      max-height: 120px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .thumb-frame img {
      max-width: 100%;
      max-height: 120px;
      object-fit: contain;
      display: block;
    }

    /* ---- Content / iframe area ---- */
    .content { flex: 1; position: relative; overflow: hidden; }

    iframe {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      border: none;
      display: block;
    }

    /* ---- Loading state ---- */
    .loading {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 13px;
    }

    .spinner {
      width: 26px;
      height: 26px;
      border: 2px solid rgba(255,255,255,0.08);
      border-top-color: rgba(180,210,255,0.7);
      border-radius: 50%;
      animation: spin 0.72s linear infinite;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    .loading-text {
      font-size: 10.5px;
      color: rgba(255,255,255,0.28);
      letter-spacing: 0.05em;
    }
  `;

  /**
   * Creates and slides in the results side panel via Shadow DOM.
   * @param {string} thumbnailDataUrl - Cropped selection preview.
   */
  function openSidePanel(thumbnailDataUrl) {
    closeSidePanel(); // Dismiss any stale panel first

    panelHost   = document.createElement('div');
    panelHost.id = 'ctsearch-panel-host';
    panelShadow = panelHost.attachShadow({ mode: 'closed' });

    // --- Styles ---
    const styleEl       = document.createElement('style');
    styleEl.textContent = PANEL_CSS;
    panelShadow.appendChild(styleEl);

    // --- Panel shell ---
    const panelEl     = document.createElement('div');
    panelEl.className = 'panel';

    // Header
    const header = document.createElement('div');
    header.className = 'header';

    const title       = document.createElement('span');
    title.className   = 'header-title';
    title.textContent = 'Circle to Search';

    const openTabBtn       = document.createElement('button');
    openTabBtn.className   = 'btn';
    openTabBtn.id          = 'openTabBtn';
    openTabBtn.textContent = 'Open in new tab';
    openTabBtn.addEventListener('click', () => {
      if (lensResultUrl) window.open(lensResultUrl, '_blank');
    });

    const closeBtn       = document.createElement('button');
    closeBtn.className   = 'btn btn-close';
    closeBtn.innerHTML   = '&times;';
    closeBtn.title       = 'Close';
    closeBtn.addEventListener('click', closeSidePanel);

    header.append(title, openTabBtn, closeBtn);

    // Thumbnail
    const thumbSection       = document.createElement('div');
    thumbSection.className   = 'thumb-section';
    const thumbLabel         = document.createElement('div');
    thumbLabel.className     = 'thumb-label';
    thumbLabel.textContent   = 'Selection';
    const thumbFrame         = document.createElement('div');
    thumbFrame.className     = 'thumb-frame';
    const thumbImg           = document.createElement('img');
    thumbImg.src             = thumbnailDataUrl;
    thumbImg.alt             = 'Selected region';
    thumbFrame.appendChild(thumbImg);
    thumbSection.append(thumbLabel, thumbFrame);

    // Content area (loading state initially)
    const contentArea     = document.createElement('div');
    contentArea.className = 'content';
    contentArea.id        = 'panelContent';

    const loadingWrap       = document.createElement('div');
    loadingWrap.className   = 'loading';
    const spinner           = document.createElement('div');
    spinner.className       = 'spinner';
    const loadingText       = document.createElement('span');
    loadingText.className   = 'loading-text';
    loadingText.textContent = 'Searching with Google Lens';
    loadingWrap.append(spinner, loadingText);
    contentArea.appendChild(loadingWrap);

    panelEl.append(header, thumbSection, contentArea);
    panelShadow.appendChild(panelEl);
    document.documentElement.appendChild(panelHost);

    // Slide in (double rAF ensures the browser registers the initial state first)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => panelEl.classList.add('open'));
    });

    // ESC closes panel even after the drawing overlay is gone
    _onPanelEsc = (e) => { if (e.key === 'Escape') closeSidePanel(); };
    document.addEventListener('keydown', _onPanelEsc);
  }

  /**
   * Loads the Google Lens results URL into the panel iframe.
   * Replaces the loading spinner with the iframe.
   * @param {string} url
   */
  function loadLensResultsInPanel(url) {
    if (!panelShadow) return;
    lensResultUrl = url;

    const contentArea = panelShadow.getElementById('panelContent');
    if (!contentArea) return;

    const iframe = document.createElement('iframe');
    iframe.src   = url;
    // Minimal sandbox — enough for Google Lens to navigate and render
    iframe.setAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation-by-user-activation'
    );
    iframe.setAttribute('loading', 'lazy');

    contentArea.innerHTML = '';
    contentArea.appendChild(iframe);
  }

  /**
   * Slides the panel out and removes it from the DOM.
   */
  function closeSidePanel() {
    if (!panelHost) return;

    // Detach ESC listener
    if (_onPanelEsc) {
      document.removeEventListener('keydown', _onPanelEsc);
      _onPanelEsc = null;
    }

    const panelEl = panelShadow?.querySelector('.panel');
    if (panelEl) {
      panelEl.classList.remove('open'); // Trigger slide-out transition
      setTimeout(() => {
        panelHost?.remove();
        panelHost     = null;
        panelShadow   = null;
        lensResultUrl = null;
      }, 420);
    } else {
      panelHost.remove();
      panelHost     = null;
      panelShadow   = null;
      lensResultUrl = null;
    }
  }

  // --- Geometry helpers -------------------------------------------------------


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
