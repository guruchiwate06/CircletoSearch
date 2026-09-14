/**
 * background.js — Service Worker
 *
 * Responsibilities:
 *  1. On Alt+S command: capture the visible tab as a PNG screenshot IMMEDIATELY
 *     (while the activeTab permission token from the keyboard shortcut is fresh),
 *     then forward the screenshot + toggle action to the content script.
 *  2. On "searchGoogleLens" message: receive the cropped Base64 PNG from the
 *     content script, upload it to Google Lens via a multipart POST, follow the
 *     redirect, and open the resulting Lens search page in a new active tab.
 */

// ─── Command: toggle overlay ─────────────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'activate-overlay') return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id) {
    console.warn('[Circle to Search] No active tab found.');
    return;
  }

  // Guard: privileged pages cannot receive content-script messages.
  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) {
    console.warn('[Circle to Search] Cannot inject overlay on a privileged page:', tab.url);
    return;
  }

  // Capture screenshot NOW — activeTab token is live from the keyboard shortcut.
  // Taking it before the overlay appears gives a clean, overlay-free page image.
  let screenshotUrl = null;
  try {
    screenshotUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    console.log('[Circle to Search] Screenshot captured at command time.');
  } catch (err) {
    console.warn('[Circle to Search] captureVisibleTab failed:', err.message);
  }

  const payload = { action: 'toggle-overlay', screenshotUrl };

  try {
    await chrome.tabs.sendMessage(tab.id, payload);
  } catch (err) {
    console.warn('[Circle to Search] Message failed, injecting content script:', err.message);
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js'],
      });
      await chrome.tabs.sendMessage(tab.id, payload);
    } catch (injectionErr) {
      console.error('[Circle to Search] Could not inject content script:', injectionErr.message);
    }
  }
});

// ─── Message: Google Lens visual search ──────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action !== 'searchGoogleLens') return;

  performLensSearch(message.imageData)
    .then((resultUrl) => sendResponse({ success: true, url: resultUrl }))
    .catch((err) => {
      console.error('[Circle to Search] Lens search error:', err.message);
      sendResponse({ success: false, error: err.message });
    });

  // Return true to keep the message channel open for the async response.
  return true;
});

/**
 * Uploads a Base64 PNG to Google Lens via multipart POST, follows the redirect,
 * and opens the Lens results page in a new active tab.
 *
 * The service worker bypasses CORS restrictions because the extension has
 * host_permissions for <all_urls>. No separate CORS proxy is needed.
 *
 * @param {string} imageDataUrl - Base64 PNG data URL (e.g. "data:image/png;base64,...")
 * @returns {Promise<string>} The final Google Lens results URL.
 */
async function performLensSearch(imageDataUrl) {
  // ── 1. Decode the base64 payload into a binary Blob ──────────────────────
  const base64    = imageDataUrl.split(',')[1];
  const binary    = atob(base64);
  const bytes     = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const imageBlob = new Blob([bytes], { type: 'image/png' });

  // ── 2. Build the multipart form Google Lens expects ───────────────────────
  const form = new FormData();
  form.append('encoded_image', imageBlob, 'selection.png');
  form.append('image_content', '');

  // ── 3. POST to the Google Lens v3 upload endpoint ─────────────────────────
  // Google will redirect through several hops to the final search-results URL.
  // fetch() follows redirects automatically; response.url is the final URL.
  const uploadEndpoint =
    `https://lens.google.com/v3/upload?hl=en&re=df&st=${Date.now()}&ep=gsbubb`;

  const response = await fetch(uploadEndpoint, {
    method:   'POST',
    body:     form,
    redirect: 'follow',
  });

  const resultUrl = response.url;

  if (!resultUrl || resultUrl === uploadEndpoint) {
    throw new Error(`Lens upload did not redirect — HTTP ${response.status}`);
  }

  console.log('[Circle to Search] Lens results URL:', resultUrl);

  // ── 4. Open the results in a new foreground tab ───────────────────────────
  await chrome.tabs.create({ url: resultUrl, active: true });

  return resultUrl;
}
