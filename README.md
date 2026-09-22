# ✦ WhereWasI.ai

> Don't retrace your work. Just get back to it.

A Chrome extension that uses AI to help product professionals resume browser research after interruptions. Built as a PM portfolio project.

---

## The Problem

Knowledge workers lose 23 minutes of focus after every interruption. When you return to your browser after a meeting, a call, or end of day — you have to manually retrace what you were doing, which tabs mattered, and what your next step was.

## The Solution

WhereWasI captures your browsing activity locally during a work session and uses Gemini AI to generate a 4-field mental bookmark:

- **You were exploring** — what you were researching
- **You discovered** — the most useful finding
- **Last stop** — the exact page to return to
- **Next** — a suggested next step based on evidence

One click. Back to it.

---

## How It Works

Browser activity (local only) → Activity Bundle → Gemini 3.6 Flash via Vercel → AI Snapshot → Back To It screen

---

## Features

- Zero manual effort — just browse normally
- AI-generated context summary using Gemini
- Tab Relevance Score — deterministic, not AI-driven
- Sensitive domain exclusion (Gmail, banking, social, auth, password managers)
- Session intent check — Resume / Start fresh / Maybe later
- Detailed breakdown — pages, domains, visit counts
- Fallback guarantee — never an empty screen
- Prompt injection protection
- Session auto-timeout after 24 hours

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Extension | Chrome MV3, Vanilla JS |
| AI | Google Gemini 3.6 Flash |
| Backend | Vercel Serverless Functions |
| Evals | Braintrust — 25-test AI evaluation suite |

---

## AI Evaluation Results

| Dimension | Score |
|-----------|-------|
| Completeness | 100% |
| Grounding | 100% |
| Safety | 100% |
| Correctness | 72% |

View eval results on Braintrust: https://www.braintrust.dev/app/NDA/p/WhereWasI%20AI%20Evals/experiments/ammu1seenu%40gmail.com-1790078383

---

## Guardrails

WhereWasI captures only the minimum browser context required to resume work and excludes known sensitive content.

- AI cannot control browser navigation
- Excluded domains never reach the AI layer
- All page titles treated as untrusted data
- Invalid AI responses trigger deterministic fallback
- Session data cleared on Start New Work

---

## Installation

1. Clone this repo
2. Go to chrome://extensions in Chrome
3. Enable Developer mode
4. Click Load unpacked
5. Select the repo folder
6. Click the WhereWasI icon in your toolbar

---

## Project Structure

- manifest.json — Chrome MV3 config
- background.js — Service worker, tab tracking
- bundle.js — Activity Bundle, Tab Relevance Score
- popup.html/css/js — Extension popup UI
- summary.html/css/js — Detailed summary page
- api/snapshot.js — Vercel serverless function, Gemini integration
- braintrust-evals.js — 25-test AI evaluation suite
- WhereWasI_BUILD_SPEC_v0.3.md — Full product spec

---

## Built By

Nagalakshmi — Product Manager | Dublin, Ireland
PM portfolio project — 2026
