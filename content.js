/**
 * content.js — Circle to Search Overlay
 *
 * Injects a full-screen canvas when activated. The user draws a freehand
 * shape; on mouseup the bounding-box coordinates are calculated and logged.
 * All event listeners are named and removed on cleanup — no stray handlers.
 */

(function () {
  'use strict';

  // ─── State ──────────────────────────────────────────────────────────────────

  let overlayActive = false;
  let canvas        = null;
  let ctx           = null;
  let isDrawing     = false;
  let points        = [];          // Collected pointer positions for the current stroke

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
    canvas.addEventListener('mouseup',   _onMouseUp);
    document.addEventListener('keydown', _onKeyDown);

    document.documentElement.appendChild(canvas);
  }

  function removeOverlay() {
    if (!overlayActive) return;
    overlayActive = false;

    if (canvas) {
      canvas.removeEventListener('mousedown', _onMouseDown);
      canvas.removeEventListener('mousemove', _onMouseMove);
      canvas.removeEventListener('mouseup',   _onMouseUp);
      canvas.remove();
      canvas = null;
      ctx    = null;
    }

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

    if (points.length > 1) {
      const bbox = computeBoundingBox(points);
      console.log('[Circle to Search] Bounding box:', bbox);
    }

    // Hold the finished stroke briefly, then dismiss
    setTimeout(removeOverlay, 650);
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') removeOverlay();
  }

  // ─── Smooth stroke rendering ─────────────────────────────────────────────────

  /**
   * Re-draws the entire stroke on every mousemove using mid-point
   * quadratic Bezier curves, producing a smooth, continuous line
   * rather than straight segments between raw pointer samples.
   */
  function renderStroke() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (points.length < 2) return;

    // Re-apply styles after clearRect (shadowBlur can reset in some browsers)
    applyDrawingStyles();

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length - 1; i++) {
      const cpX  = points[i].x;
      const cpY  = points[i].y;
      const endX = (points[i].x + points[i + 1].x) / 2;
      const endY = (points[i].y + points[i + 1].y) / 2;
      ctx.quadraticCurveTo(cpX, cpY, endX, endY);
    }

    // Line to the final point
    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }

  // ─── Bounding box ────────────────────────────────────────────────────────────

  /**
   * Returns the axis-aligned bounding box of the drawn path.
   * @param {{ x: number, y: number }[]} pts
   * @returns {{ minX: number, minY: number, width: number, height: number }}
   */
  function computeBoundingBox(pts) {
    let minX = Infinity,  minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const { x, y } of pts) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }

    return {
      minX:   Math.round(minX),
      minY:   Math.round(minY),
      width:  Math.round(maxX - minX),
      height: Math.round(maxY - minY),
    };
  }

  // ─── Message listener ────────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.action !== 'toggle-overlay') return;
    overlayActive ? removeOverlay() : createOverlay();
  });

})();
