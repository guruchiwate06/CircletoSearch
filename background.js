/**
 * background.js — Service Worker
 *
 * Listens for the "activate-overlay" keyboard command (Alt+S) and
 * forwards a toggle message to the content script running in the
 * currently active tab.
 */

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'activate-overlay') return;

  // Query the focused, active tab in the current window.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id) {
    console.warn('[Circle to Search] No active tab found.');
    return;
  }

  // Guard: chrome:// and edge:// pages cannot receive content-script messages.
  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) {
    console.warn('[Circle to Search] Cannot inject overlay on a privileged page:', tab.url);
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'toggle-overlay' });
  } catch (err) {
    // Content script may not yet be ready (e.g. page still loading).
    // Attempt to inject it programmatically as a fallback, then retry.
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
