# Firstline

A short email. A real connection.

**[Open Firstline](https://firstline-q9go.onrender.com)** · [Source on GitHub](https://github.com/vineetsaini007/firstline)

Firstline turns a resume and a job description into a concise, personal cold email. An Apple-inspired workspace puts real experience, job context, and an editable draft side by side.

## Features

- Company, position, job description, recipient, career stage, and extra context.
- PDF, DOCX, and TXT resume uploads, processed in memory. Extracted text is editable before generation.
- Professional, warm, and confident tones; 60–90 or 90–120 word drafts.
- Free OpenRouter models only. Default: `openrouter/free`. Paid model IDs are rejected and provider token prices are capped at zero.
- Editable subject and body, alternative subjects, new versions, short drafts, copy, and text download.
- Explicit JD-to-experience connections in the email, with expandable verbatim JD/resume evidence and the corresponding email sentence. The server checks that source quotes and the cited sentence exist.
- Clearly labeled fictional example for exploring the product without an API key.
- Calmer desktop layout with collapsible context steps, a scrollable input area, and a visible generate action; natural page scrolling on mobile. Accessible labels and controls, reduced-motion support, and no external fonts or trackers.
- Server-side API key, validation, request limits, optional shared password, and security headers.

## Local development

Requires Node.js 22.3 or later.

```sh
npm ci
cp .env.example .env
# Add your OPENROUTER_API_KEY in .env
npm run dev
```

On PowerShell, use `Copy-Item .env.example .env` instead of `cp`.

Visit http://localhost:3000. Without an API key, the interface, example, and resume parsing work; live AI generation returns an explicit setup message. No synthetic response is passed off as AI.

## OpenRouter setup

Create an API key at [OpenRouter](https://openrouter.ai/settings/keys). Store it in the server environment as `OPENROUTER_API_KEY`. Never commit it or put it in client code.

`OPENROUTER_MODEL=openrouter/free` routes to an available free model. To select one explicitly, use an available OpenRouter model ID ending in `:free`. The application rejects paid model IDs and does not use paid fallback models.

The free plan currently has a 50-request daily allowance and provider capacity can vary. The app defaults to a conservative 45-request daily cap. Failed requests also consume the app cap. Its counter and per-IP rate limits are in memory and reset on process restart, so they are not an account-wide quota guarantee. OpenRouter independently enforces account limits. Free models can be slower or temporarily unavailable; the UI reports this without switching to paid inference. See [current pricing](https://openrouter.ai/pricing/) and [limits](https://openrouter.ai/docs/api_reference/limits).

## Deploy to Render

The repository contains a `render.yaml` Blueprint for a free Node web service.

1. In Render, create a Blueprint from this GitHub repository, or create a Web Service.
2. Use build command `npm ci --omit=dev` and start command `npm start`.
3. Add `OPENROUTER_API_KEY` as a secret environment variable.
4. Set `OPENROUTER_MODEL` to `openrouter/free`.
5. Recommended for a personal workspace: set a long, unique `APP_PASSWORD`. This protects generation and uploads through an HttpOnly session cookie. This is shared workspace access, not individual user accounts.
6. Use `/api/health` for the health check. The app binds to `0.0.0.0` and Render’s `PORT`.
7. Deploy and verify real generation with a fictional resume before using personal data.

The free Render service can sleep after inactivity; the first visit may take longer. Pushes to `main` automatically deploy once the service is linked. No database is required. Add Neon only if future features need accounts or durable history.

## Project structure

```text
public/             HTML, styles, icons, and browser interactions
server/             Express routes, resume extraction, and AI generation
test/               API integration and upload-format tests
.env.example        Configuration names, no credentials
.node-version       Node runtime version
render.yaml         Render deployment configuration
package-lock.json   Reproducible dependencies
```

Only source, configuration templates, documentation, and tests belong in Git. `node_modules`, `.env`, local logs, uploaded resumes, drafts, and temporary assets are excluded or never written.

## Verification

```sh
npm run check
npm test
npm audit --omit=dev
```

Tests use an injected mock provider and real PDF/DOCX/TXT extraction. They do not call OpenRouter or consume your quota. They cover authentication, input validation, free-only model routing, daily/per-IP limits, cross-site request rejection, provider failures, output validation, and upload boundaries. Live inference requires a configured key and is a separate deployment verification step.

The first Render deployment was verified on October 10, 2026 with fictional applicant data. OpenRouter returned a real 56-word draft using `nvidia/nemotron-3-super-120b-a12b:free`; copy and text download were verified in the deployed app. The default router may select a different free model on subsequent requests.

Mammoth’s unused command-line parser is overridden to argparse 2 to avoid the older parser’s vulnerable `sprintf-js` dependency. The actual document conversion path is covered by a real DOCX extraction test.

## Privacy and limits

Firstline parses uploads in memory and does not persist resumes, context, drafts, or content logs. Refreshing the tab clears its context. On generation, supplied text is sent to OpenRouter and the selected model provider; their policies apply. Remove sensitive information before sending. Copy/download are initiated by the user. No email is automatically sent and no resume is automatically attached.

PDFs must contain extractable text and have 20 pages or fewer. Scanned PDFs need pasted resume text. Files must be at most 5 MB. Legacy `.doc` files are unsupported.

The prompt selects evidence against the specific JD and requires an explicit connection in the email body. The server verifies verbatim source quotes, a shared JD focus phrase, and the cited sentence in the body. These checks establish traceability, not semantic correctness: AI can still misinterpret evidence, so review all claims before sending. Firstline does not predict or guarantee interviews. The server rejects malformed, truncated, overly long, or ungrounded drafts; it does not retry automatically or quietly return a template.
