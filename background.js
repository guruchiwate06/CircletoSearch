/**
 * background.js — Service Worker
 *
 * Responsibilities:
 *  1. Listen for the "activate-overlay" keyboard command (Alt+S) and tell the
 *     active tab's content script to toggle the selection overlay.
 *  2. Listen for a "capture-screenshot" message from the content script,
 *     take a PNG screenshot of the visible tab, and send it back together
 *     with the selection coordinates so content.js can crop it.
 *  3. Listen for a "download-image" message from the content script and
 *     trigger a browser download of the cropped Data URL (verification step).
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

  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'toggle-overlay' });
  } catch (err) {
    // Content script may not be ready yet — inject it programmatically then retry.
    console.warn('[Circle to Search] Message failed, injecting content script:', err.message);
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js'],
      });
      await chrome.tabs.sendMessage(tab.id, { action: 'toggle-overlay' });
    } catch (injectionErr) {
      console.error('[Circle to Search] Could not inject content script:', injectionErr.message);
    }
  }
});

// ─── Message handler ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // ── Screenshot request ──────────────────────────────────────────────────────
  if (message.action === 'capture-screenshot') {
    const { bbox, devicePixelRatio } = message;

    // captureVisibleTab requires the tab's windowId (sender.tab.windowId).
    const windowId = sender.tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT;

    chrome.tabs.captureVisibleTab(windowId, { format: 'png' })
      .then((dataUrl) => {
        sendResponse({
          success:         true,
          screenshotUrl:   dataUrl,
          bbox,
          devicePixelRatio,
        });
      })
      .catch((err) => {
        console.error('[Circle to Search] captureVisibleTab failed:', err.message);
        sendResponse({ success: false, error: err.message });
      });

    // Return true to keep the message channel open for the async response.
    return true;
  }

  // ── Download cropped image (verification) ───────────────────────────────────
  if (message.action === 'download-image') {
    chrome.downloads.download({
      url:      message.dataUrl,
      filename: 'cropped-selection.png',
      saveAs:   false,
    });
    // No async response needed.
    return false;
  }
});
