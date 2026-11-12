# Code Audit, Test Suite & Local Deployment Guide
**Data Direct – Address Desk** | November 2026

---

## 1. Issues Found in Code Review

### 1.1 `server/services/postcodes.js`

**BUG — cache is never invalidated on error**
`requestJson` stores only successful responses in the cache, but the `pending` map entry
is deleted in the `finally` block even when the promise rejects. That is correct. However,
if two requests race and the first fails, the second (waiting on the same pending promise)
will also receive the rejection. This is intentional deduplication, but callers have no
way to force a retry without a process restart — the failed result is not cached, so a
subsequent fresh call will work. This is acceptable behaviour but should be documented.

**ISSUE — `normalizePostcode` accepts strings like `"AB1"` (3 chars) without a space**
Postcodes shorter than 4 chars are returned as-is (e.g. `"M11"`). The UK postcode format
always has an outward code + a 3-char inward code. Anything shorter than 5 chars is not
a real postcode. The function does not reject these; it passes them through to the API,
which will return invalid. This is not a crash but can produce confusing UX messages.
Recommendation: add a minimum length check (`compact.length < 5`).

**ISSUE — bulk lookup silently drops all-whitespace entries**
`bulkLookupPostcodes` calls `normalizePostcode` on each entry and filters out falsy results.
An entry like `"  "` (spaces only) is filtered before the upstream call and gets a
`"INVALID_POSTCODE"` status row back, which is correct — but the explanation says
"unsupported characters" rather than "empty entry". Minor wording inconsistency.

---

### 1.2 `server/services/address.js`

**BUG — `parseAddressText` can silently drop the first line of a multiline address**
Lines 22-28: if the first remaining line does NOT start with a building number but the
*second* line does, the first line is stripped away (the `shift()`). This was designed
for headers like "Recipient Name" but also fires when a named address starts with the
business name, e.g.:

```
Acme Ltd
12 High Street
London
SW1A 1AA
```

The business name line ("Acme Ltd") gets dropped. Users who paste real-world addresses
with a company name on line 1 will lose that line silently. The `components.building`
will then hold "12" but the company name is gone entirely.
**Recommendation:** preserve the dropped line in a separate `organisation` field or
include it in `building`.

**ISSUE — `checkAddressCompleteness` requires `country` as mandatory**
`required = ["building", "street", "townCity", "postcode", "country"]` — `country` is
listed as required, but many UK warehouse workflows only capture a postcode. This means
any address that omits country will be marked incomplete even if all delivery-critical
fields are present. This aligns with the stated requirements but may surprise operators.

---

### 1.3 `server/services/addressVerification.js`

**BUG — `postcodeResult` swallows non-400 errors from the validator**
Lines 85-105: if `validatePostcode` throws an error that is *not* status 400, the catch
block still returns `{ status: "PROVIDER_ERROR", valid: null }` and execution continues.
The calling code at line 154 only short-circuits on `"PROVIDER_ERROR"` when
`!postcodeValidation.valid`. Because `valid` is `null` (not `false`), the condition
`postcodeValidation.valid === false` on line 166 does NOT fire, and execution falls
through to the OS Names search with an unvalidated postcode. This can cause a confusing
`POSTCODE_MATCH` status even when the postcode API was actually unavailable.
**Recommendation:** explicitly handle `valid === null` as a separate branch before
calling `searchProvider`.

**ISSUE — `compareFeatures` returns `null` (not checked) for building**
`componentMatches.building` is always `null` because individual properties cannot be
verified with free data. This is intentional and correctly documented. No action needed
beyond ensuring the UI always renders "not verified" for building.

---

### 1.4 `server/services/providers/osNames.js`

**ISSUE — module-level cache is shared across all requests**
`const cache = new Map()` and `const pending = new Map()` are process-level singletons.
In a multi-tenant or high-traffic scenario this is fine. However, if the OS Names API key
rotates at runtime, the stale cache will continue returning results authorised with the
old key for up to 5 minutes. Not a defect in the current single-tenant setup.

**ISSUE — `searchTerm` only caches when `fetchImpl === globalThis.fetch`**
This means test overrides that pass a custom `fetchImpl` bypass the cache entirely,
which is actually desirable for testing but could surprise a developer who injects a
custom fetch wrapper in production.

---

### 1.5 `server/app.js`

**BUG — analytics `apiErrors` counter double-counts**
The global error handler (line 163-170) increments `analytics.apiErrors` for every 500+
error. The `/api/v1/address/verify` route (line 138) also increments it when
`result.status === "PROVIDER_ERROR"`. If a provider error propagates as a 500, it will
be counted twice. Recommendation: pick one place — the route handler OR the global error
handler — to increment the counter.

**BUG — bulk lookup does not call `recordPostcode` helper**
Single lookups use `recordPostcode(result)` which correctly limits history to 100 entries.
The bulk route (lines 67-83) manually `unshift`s into history inside the loop but only
calls `history.splice(100)` once after the loop. If 100+ postcodes are submitted, the
history array can temporarily exceed 100 entries mid-loop. Low severity but inconsistent.

**ISSUE — `app.get("*", ...)` SPA fallback fires for ALL non-API routes**
The catch-all on line 157 tries to send `dist/index.html`. In development (`npm run dev`)
the `dist/` directory does not exist, so the `sendFile` callback calls `next()`. This is
handled gracefully, but in production if `dist/` is missing Express will silently serve
nothing. Recommendation: add an explicit check that `dist/index.html` exists on startup
and log a clear error if not.

**ISSUE — in-memory history and analytics reset on every process restart**
History and analytics live in module-level variables. A process restart (crash, deploy)
loses all data. This is by design for the current phase but should be noted for future
persistence work.

---

### 1.6 `src/App.jsx` (frontend)

**ISSUE — `getSavedTheme` reads `localStorage` at module evaluation time**
`useState(getSavedTheme)` passes the function as the initializer, which is correct — it
runs lazily. No bug, but worth noting that `localStorage` exceptions (e.g. in an iframe
with blocked storage) are silently swallowed and default to `"system"`.

**ISSUE — `readJsonResponse` checks content-type with a regex but `response.text()` is
called before the check**
If the server returns a very large non-JSON error body, the entire text is buffered before
the content-type check rejects it. Not a real-world problem given Express response sizes,
but slightly inefficient.

---

## 2. Test Suite

Three test files have been created for `npm test` and one for `npm run test:integration`.

| File | Type | What it covers |
|---|---|---|
| `tests/services.test.js` | Unit | `normalizePostcode`, `validatePostcode` input validation, `bulkLookupPostcodes` input validation, `parseAddressText`, `checkAddressCompleteness` |
| `tests/providers.test.js` | Unit | `searchOsNames` (no key, with key, error branches), `verifyAddress` (all status paths) |
| `tests/api.test.js` | Unit | Every Express route via in-process HTTP server + mocked global fetch |
| `tests/app.integration.test.js` | Integration | Live Postcodes.io calls, analytics accumulation, search history population |

### Run unit tests (no network required)
```
npm test
```

### Run integration tests (requires internet)
```
npm run test:integration
```

### Run with OS Names enabled (optional)
```
set OS_NAMES_API_KEY=your_key_here
npm run test:integration
```

---

## 3. Local Deployment

### Prerequisites
- Node.js 20 or higher (`node --version`)
- npm (`npm --version`)
- Git (optional)

### Step 1 — Install dependencies (already done if node_modules exists)
```
cd "E:\Wearhouse projects\postalcode"
npm install
```

### Step 2 — Build the React frontend
```
npm run build
```
This creates `dist/` with the compiled frontend. The Express server in production serves
files from this folder.

### Step 3 — Start the production server
```
npm start
```
The server listens on `http://localhost:3000` by default.

To use a different port:
```
set PORT=8080
npm start
```

### Step 4 — (Optional) OS Names API key
If you have an Ordnance Survey OS Open Names API key, create a `.env` file in the project
root:
```
OS_NAMES_API_KEY=your_key_here
```
The server reads this automatically via `--env-file-if-exists=.env`. Without the key,
the address checker still works for postcode validation but skips the road/place search.

### Step 5 — Development mode (live reload)
```
npm run dev
```
This starts the Express server on port 3000 with `--watch` and the Vite dev server on
port 5173 concurrently. The Vite dev server proxies `/api` calls to Express.
Open `http://localhost:5173` in your browser during development.

### Step 6 — Verify everything is running
```
curl http://localhost:3000/api/v1/health
# Expected: {"status":"ok"}
```

---

## 4. Recommended Fixes (Priority Order)

1. **Fix the double `apiErrors` counter** (`app.js`) — pick the global handler as the
   single source of truth and remove the per-route increment.
2. **Fix `postcodeResult` null-valid branch** (`addressVerification.js`) — add an
   explicit `valid === null` check so PROVIDER_ERROR stops execution cleanly.
3. **Fix `parseAddressText` dropping organisation lines** (`address.js`) — capture the
   dropped line in an `organisation` or `notes` field instead of discarding it.
4. **Add minimum-length guard to `normalizePostcode`** (`postcodes.js`) — reject inputs
   shorter than 5 chars.
5. **Add startup check for `dist/`** (`app.js`) — log a clear warning on start if
   `dist/index.html` does not exist.
