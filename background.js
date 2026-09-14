/**
 * background.js — Service Worker
 *
 * Responsibilities:
 *  1. On Alt+S command: capture the visible tab as a PNG screenshot IMMEDIATELY
 *     (while the activeTab permission token from the keyboard shortcut is fresh),
 *     then forward the screenshot + toggle action to the content script.
 *  2. On "searchGoogleLens" message: receive the cropped Base64 PNG from content.js,
 *     upload it to Google Lens, follow the redirect, and return the results URL
 *     so content.js can display it inside the in-page side panel iframe.
 *     No new tab is opened — the panel handles display entirely.
 */

// --- Command: toggle overlay -------------------------------------------------

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
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tab.id, payload);
    } catch (injectionErr) {
      console.error('[Circle to Search] Could not inject content script:', injectionErr.message);
    }
  }
});

let creatingOffscreen;

async function setupOffscreenDocument(path) {
  if (await chrome.offscreen.hasDocument()) return;
  if (creatingOffscreen) {
    await creatingOffscreen;
  } else {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: path,
      reasons: [chrome.offscreen.Reason.DOM_PARSER],
      justification: 'Run Tesseract.js OCR'
    });
    await creatingOffscreen;
    creatingOffscreen = null;
  }
}

// --- Message Listener --------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'searchGoogleLens') {
    performLensSearch(message.imageData)
      .then((resultUrl) => sendResponse({ success: true, url: resultUrl }))
      .catch((err) => {
        console.error('[Circle to Search] Lens search error:', err.message);
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep channel open
  }

  if (message.action === 'extract_text') {
    setupOffscreenDocument('ocr.html')
      .then(() => chrome.runtime.sendMessage({ action: 'perform_ocr', imageData: message.imageData }))
      .then(response => sendResponse(response))
      .catch(err => {
        console.error('[Circle to Search] OCR routing error:', err.message);
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep channel open
  }
});

/**
 * Uploads the cropped Base64 PNG to Google Lens via multipart POST,
 * follows all redirects, and returns the final results page URL.
 *
 * content.js loads this URL into the in-page side panel iframe.
 * No chrome.tabs.create() is called here.
 *
 * @param {string} imageDataUrl - data:image/png;base64,... string.
 * @returns {Promise<string>} Final Google Lens search results URL.
 */
async function performLensSearch(imageDataUrl) {
  // 1. Decode base64 to binary
  const base64 = imageDataUrl.split(',')[1];
  const binary = atob(base64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  // 2. Build multipart/form-data manually.
  // This bypasses a known Chrome MV3 bug where fetch() with FormData + Blob fails in Service Workers.
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
  
  const header = `--${boundary}\r\nContent-Disposition: form-data; name="encoded_image"; filename="selection.png"\r\nContent-Type: image/png\r\n\r\n`;
  const footer = `\r\n--${boundary}\r\nContent-Disposition: form-data; name="image_content"\r\n\r\n\r\n--${boundary}--\r\n`;

  const headerBytes = new TextEncoder().encode(header);
  const footerBytes = new TextEncoder().encode(footer);

  const body = new Uint8Array(headerBytes.length + bytes.length + footerBytes.length);
  body.set(headerBytes, 0);
  body.set(bytes, headerBytes.length);
  body.set(footerBytes, headerBytes.length + bytes.length);

  // 3. POST and follow redirects; response.url is the final results page
  const uploadEndpoint =
    `https://lens.google.com/v3/upload?hl=en&re=df&st=${Date.now()}&ep=gsbubb`;

  const response = await fetch(uploadEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`
    },
    body: body,
    redirect: 'follow',
    referrerPolicy: 'no-referrer'
  });

  const resultUrl = response.url;
  if (!resultUrl || resultUrl === uploadEndpoint) {
    throw new Error(`Lens upload did not redirect — HTTP ${response.status}`);
  }

  console.log('[Circle to Search] Lens results URL:', resultUrl);
  return resultUrl;
}
