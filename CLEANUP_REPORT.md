# Project Cleanup & Audit Report
**Data Direct – Address Desk** | November 2026

---

## Executive Summary

After a full inspection of the entire project, **no Vercel-specific code, configuration, or
deployment artifacts were found.** The project was already running on a clean
React + Vite + Express + Node.js stack. No `api/` serverless functions, no `vercel.json`,
no `.vercel/` directory, and no Vercel strings anywhere in source code.

The work completed was therefore:
1. Bug fixes identified during code review (5 bugs)
2. Hardening of configuration files
3. Improved developer experience scripts
4. Security and `.gitignore` improvements

---

## 1. Files Deleted

None. No files were deleted. Inspection confirmed there were no:
- `api/` Vercel serverless functions
- `vercel.json`
- `.vercel/` directory
- `buildout.txt`, `diff.txt`, `out.txt`, `tok.txt` (do not exist in this project)
- Duplicate or obsolete files

---

## 2. Files Modified

| File | What changed |
|---|---|
| `server/app.js` | Removed duplicate `analytics.apiErrors` increment in `/address/verify` route. The global error handler is now the single counter for 5xx errors. |
| `server/services/addressVerification.js` | Fixed null-valid bypass: replaced `!valid && status==="PROVIDER_ERROR"` with two separate guards — one for `status === "PROVIDER_ERROR"` and one for `valid == null` — so a PROVIDER_ERROR always stops execution cleanly before the OS Names search. |
| `server/services/address.js` | Fixed silent discard of organisation lines: the leading non-numeric line (e.g. company name) is now captured in `components.organisation` instead of being discarded. `checkAddressCompleteness` updated to include `organisation` in its normalisation list. |
| `server/services/postcodes.js` | Added minimum length guard: `compact.length < 5` now rejects strings that cannot be a valid UK postcode. |
| `server/index.js` | Added startup check for `dist/index.html` with a clear warning if missing; added graceful shutdown on SIGTERM/SIGINT; cleaner startup log. |
| `vite.config.js` | Added explicit `build.outDir: "dist"`, `build.emptyOutDir: true`, and explicit dev server port 5173. |
| `package.json` | Added `preview` script (`build` then `start`); fixed `test:integration` to explicitly list both integration test files; added `test:all` convenience script. |
| `.gitignore` | Expanded: added OS/editor files, log patterns, scratch file patterns. |
| `.env.example` | Expanded with `PORT` comment, link to OS Data Hub, clearer instructions. |
| `tests/services.test.js` | Updated `normalizePostcode` test: replaced passing 3-char test with correct rejection test; added test for minimum-valid 5-char compact postcode. |

---

## 3. Files Created

| File | Purpose |
|---|---|
| `tests/services.test.js` | Unit tests for `postcodes.js` and `address.js` |
| `tests/providers.test.js` | Unit tests for `osNames.js` and `addressVerification.js` |
| `tests/api.test.js` | Unit tests for all Express routes in `app.js` |
| `tests/app.integration.test.js` | Integration tests against live Postcodes.io |
| `ISSUES_AND_DEPLOY.md` | Code audit report and original deployment guide |
| `CLEANUP_REPORT.md` | This file |

---

## 4. Vercel Dependencies Removed

None — the project had none. Zero Vercel artefacts were present.

---

## 5. Local Backend Configuration

The Express server (`server/index.js` → `server/app.js`) is the only backend.

| Item | Value |
|---|---|
| Default port | `3000` (overridable via `PORT` env var) |
| Listen address | `127.0.0.1` (loopback only — local machine) |
| Frontend served from | `dist/` (built by Vite) |
| API base path | `/api/v1/` |
| External API calls | Postcodes.io (no key) · OS Names (optional key) |
| Secret key location | Server-side only via `.env` / `process.env` |

API endpoints available:
```
GET  /api/v1/health
POST /api/v1/postcode/validate
POST /api/v1/postcode/lookup
POST /api/v1/postcode/nearest
POST /api/v1/postcode/bulk-lookup
POST /api/v1/address/parse
POST /api/v1/address/check-completeness
POST /api/v1/address/verify
GET  /api/v1/analytics
GET  /api/v1/search-history
```

---

## 6. Environment Variable Changes

| Variable | Status | Notes |
|---|---|---|
| `OS_NAMES_API_KEY` | Preserved | Still loaded from `.env` by `--env-file-if-exists` |
| `PORT` | Documented | Added as commented example in `.env.example` |

Your `.env` contains a real `OS_NAMES_API_KEY`. It is correctly excluded from Git by `.gitignore`.

---

## 7. Bug Fixes Applied

### Bug 1 — Double `apiErrors` counter ✓ Fixed
**File:** `server/app.js`  
Removed `if (result.status === "PROVIDER_ERROR") analytics.apiErrors += 1` from the
`/address/verify` route. The global error handler at the bottom of `app.js` is now the
single source of truth for counting 5xx errors.

### Bug 2 — `postcodeResult` null-valid bypass ✓ Fixed
**File:** `server/services/addressVerification.js`  
Replaced the original guard `!postcodeValidation.valid && status === "PROVIDER_ERROR"`
with two explicit guards:
1. `if (postcodeValidation.status === "PROVIDER_ERROR")` → returns PROVIDER_ERROR
2. `if (postcodeValidation.valid == null)` → returns PROVIDER_ERROR  
This prevents execution from falling through to the OS Names search when the postcode
validator returned an indeterminate result.

### Bug 3 — `parseAddressText` discards organisation line ✓ Fixed
**File:** `server/services/address.js`  
Addresses like `"Acme Ltd\n12 High Street\nLondon\nSW1A 1AA"` previously lost "Acme Ltd"
silently. Now that line is captured in `components.organisation`. The field is included in
`checkAddressCompleteness` normalisation. It is not a required delivery field.

### Bug 4 — `normalizePostcode` accepts sub-5-char codes ✓ Fixed
**File:** `server/services/postcodes.js`  
Added `compact.length < 5` guard. The shortest valid UK postcode compact form is 5 chars
(e.g. `M11AE`). Strings shorter than this can never be valid and are now rejected early
rather than passing through to Postcodes.io as guaranteed-invalid inputs.

### Bug 5 — No `dist/` startup warning ✓ Fixed
**File:** `server/index.js`  
Added a check for `dist/index.html` at startup. If missing, a clear warning is printed
explaining the user needs to run `npm run build`. The API still responds; only the UI fails.

---

## 8. Remaining Limitations

- **In-memory history and analytics** reset on every process restart. This is by design for
  the current phase. For persistence, a lightweight SQLite database would be appropriate.

- **OS Names road/place search** is optional. Without `OS_NAMES_API_KEY`, postcode validation
  still works in full; only the street/town matching feature is disabled.

- **Single-process, single-machine only.** The server listens on `127.0.0.1` and is not
  accessible from other machines on the network. For LAN access, change to `0.0.0.0` in
  `server/index.js`.

- **No HTTPS.** For local LAN use, plain HTTP on port 3000 is acceptable. For production
  exposure, add a reverse proxy (nginx, Caddy) with TLS.

---

## 9. How to Run the Application Locally

### First time setup
```bat
cd "E:\Wearhouse projects\postalcode"
npm install
```

### Build the React frontend
```bat
npm run build
```
This creates the `dist/` folder. Run this once and again after any frontend changes.

### Start the production server
```bat
npm start
```
Expected output:
```
✓  Data Direct Address Desk
   Listening on http://localhost:3000
   Open http://localhost:3000 in your browser.
```
Open **http://localhost:3000** in your browser.

### Development mode (live reload)
```bat
npm run dev
```
Opens React dev server on **http://localhost:5173** with hot-module reloading.
API requests proxy automatically to Express on port 3000.

### Quick build + start (one command)
```bat
npm run preview
```

### Verify the API is responding
```bat
curl http://localhost:3000/api/v1/health
```
Expected: `{"status":"ok"}`

### Run unit tests (no internet needed)
```bat
npm test
```

### Run integration tests (requires internet — hits Postcodes.io)
```bat
npm run test:integration
```

### Run all tests
```bat
npm run test:all
```
