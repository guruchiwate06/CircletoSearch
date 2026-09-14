/**
 * background.js — Service Worker
 *
 * Responsibilities:
 *  1. On Alt+S command: capture the visible tab as a PNG screenshot IMMEDIATELY
 *     (while the activeTab permission token from the keyboard shortcut is fresh),
 *     then forward both the screenshot and the toggle action to the content script.
 *     This avoids the ~600 ms delay caused by the snap animation expiring the token.
 *  2. On "download-image" message: trigger a browser download of the cropped PNG.
 *     Content scripts cannot call chrome.downloads directly.
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

  // ── Capture screenshot NOW — activeTab token is live from the keyboard shortcut.
  // Taking it here (before the overlay appears) also gives a clean page image
  // with no drawing overlay visible in the crop.
  let screenshotUrl = null;
  try {
    screenshotUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    console.log('[Circle to Search] Screenshot captured at command time.');
  } catch (err) {
    console.warn('[Circle to Search] captureVisibleTab failed:', err.message);
    // Continue — the overlay will still show; crop simply won't download.
  }

  const payload = { action: 'toggle-overlay', screenshotUrl };

  try {
    await chrome.tabs.sendMessage(tab.id, payload);
  } catch (err) {
    // Content script may not be ready — inject it programmatically then retry.
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
