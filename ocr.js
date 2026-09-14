let worker = null;

async function initTesseract() {
  if (worker) return worker;
  
  // Create worker using local bundled scripts to bypass CSP
  worker = await Tesseract.createWorker('eng', 1, {
    workerPath: chrome.runtime.getURL('lib/worker.min.js'),
    corePath: chrome.runtime.getURL('lib/tesseract-core.wasm.js'),
    logger: m => console.log('[Tesseract]', m.status, Math.round(m.progress * 100) + '%')
  });
  
  return worker;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'perform_ocr') {
    (async () => {
      try {
        const w = await initTesseract();
        const { data: { text } } = await w.recognize(message.imageData);
        sendResponse({ success: true, text: text.trim() });
      } catch (err) {
        console.error('OCR Error:', err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // Keep channel open for async response
  }
});
