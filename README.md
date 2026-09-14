# Desktop Circle to Search

A powerful, desktop-style "Circle to Search" Chrome Extension that brings intelligent, on-screen text extraction, translation, and visual search directly to your browser. 

Simply hit `Alt + S` and draw a circle around anything on your screen!

## ✨ Features

- **Gemini AI Aesthetics**: Experience a premium interface with breathing glows and neon laser borders that adapt and shift through the signature Gemini AI color palette (Deep Blue, Sparkle Purple, Peach).
- **Intelligent Intent Auto-Detection**: Uses in-browser OCR (Tesseract.js) to instantly extract text from your selection and automatically routes you to the correct tool:
  - 🧮 **Math Solver**: Detects equations and automatically solves them.
  - 🌐 **Translate**: Detects foreign characters and translates them instantly.
  - 📝 **Copy Text**: Extracts standard text so you can copy it to your clipboard.
  - 🔍 **Visual Search**: Falls back to Google Lens for image-based reverse searching.
- **Action Chips**: A sleek, horizontally scrolling navigation bar allows you to seamlessly switch between tools at any time.
- **Privacy First**: OCR processing happens entirely locally within the browser via an Offscreen Document, bypassing strict CSPs without compromising security.

## 🚀 Installation

1. Clone or download this repository.
2. Open Google Chrome (or any Chromium-based browser) and navigate to `chrome://extensions`.
3. Enable **Developer mode** using the toggle in the top right corner.
4. Click **Load unpacked** and select the folder containing this extension.
5. Hit `Alt + S` on any webpage to start searching!

## 🛠️ Built With

- Manifest V3
- HTML / CSS / Vanilla JavaScript
- `Tesseract.js` for local Optical Character Recognition
- `chrome.offscreen` API
- `declarativeNetRequest`

## 🤝 Credits

- Created and conceptualized by **guruchiwate06**.
- Co-developed with the help of **Antigravity AI**.
