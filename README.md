# Shades of You

A clean beauty e-commerce website built for Indian skin. Single-page app with no backend.

## Features

- Login / Sign Up / Guest access with localStorage persistence
- Product shop with category filters
- Shopping cart with checkout (Card, UPI, Wallet, COD)
- Coupon codes: `GLOW10`, `SOY20`, `WELCOME15`
- AI-powered Skin Quiz and chatbot (Sage) via Google Gemini
- Free dermatologist consultation booking
- Order history saved per user

## Tech

HTML · CSS · Vanilla JavaScript · Google Gemini API

## Run Locally

Just open `index.html` in a browser, or use a local server to avoid CORS issues:

```bash
python -m http.server 8000
```

## Chatbot Setup

1. Get a free API key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Click the chat bubble on the site
3. Paste your key via the 🔑 icon — stored only in your browser

## Files

```
index.html    # All pages (SPA)
style.css     # Styles
script.js     # All logic
```
