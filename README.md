# BenzTech

Clean, professional Mercedes-Benz technician tool for generating warranty stories using Grok AI.

## Features
- Scan repair orders (camera + OCR with Tesseract.js) - auto extracts vehicle info AND all A/B/C/D complaint lines
- Home screen with searchable history list of all past ROs (reopen anytime, nothing lost)
- Manage repair lines with full persistence (IndexedDB)
- On line detail page: "ADD XENTRY / DIAGNOSTIC PHOTOS" button for multiple Xentry/Quick Test/Guided Test images
- Robust multi-image analysis: OCR + parse codes, Guided Tests, measurements, components, circuits/pins from Xentry screens; raw OCR sent to AI
- Real Grok API calls using the official senior master technician system prompt, enhanced with RO complaints, Xentry raw data, and examples from your saved history for "learning"
- Clean dark professional UI (PWA-ready)
- Dedicated Settings screen for Grok API key (gear icon top-right on main screen)

## Setup

1. `npm install`
2. `npm run dev`
3. Go to Settings and paste your Grok API key from https://console.x.ai
4. Start scanning repair orders and generating real AI warranty stories.

## Deployment
Works great on Vercel. Push to GitHub and import the repo.

**Important:** Story generation requires internet + a valid Grok API key.
