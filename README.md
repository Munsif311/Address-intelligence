# Address-intelligence

## Data Direct Address Desk

A standalone UK postcode and address checking application for warehouse operations. The React interface uses a small Node.js REST API with Postcodes.io for postcode validation and the free Ordnance Survey OS Names API for road and place searches.

> **Verification limitation:** Postcodes.io validates postcodes; OS Names searches named roads and places. Neither source contains individual property addresses, so this application does not claim to verify a house or flat. Neither provider verifies recipient identity or occupancy.

## Requirements

- Node.js 20.0 or later
- npm
- Network access to `api.postcodes.io`

## Run locally

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal (normally `http://localhost:5173`). The frontend proxies `/api` requests to the Node API on port 3001.

For a production-style local run:

```bash
npm run build
npm start
```

Open `http://localhost:3001`. Set `PORT` to change the backend port.

## Features

- Postcode validation and lookup, including geographic identifiers and coordinates.
- Nearby postcode suggestions, loaded only when requested.
- Bulk postcode lookup through the official Postcodes.io bulk endpoint (up to 100 entries).
- Address completeness check with a best-effort parser for pasted multiline or comma-separated address text; parsed fields should be checked by the operator.
- Address checking combines Postcodes.io postcode validation with OS Names road/place matching when an OS Names key is configured.
- Light, dark, and system appearance modes, with the selected preference saved in the browser.
- Copy-to-clipboard support, loading/error states, recent postcode searches, and operational counters.
- In-memory, five-minute upstream response caching and concurrent request coalescing.
- API errors and timeouts are reported explicitly. Postcodes.io requires no key; OS Names is free and uses a server-side key.

The address completeness endpoint checks house/building, street, town/city, postcode, and country. County is displayed but optional. OS Names can help confirm a named road or place, but does not support searches for a specific house number or delivery address.

The parse action separates components from an address the operator already has; it does not search for or discover property addresses from a postcode. Postcodes.io does not provide house, street, or full delivery-address records.

### Configure free OS Names searches

OS Names searches Ordnance Survey's free OS Open Names data. Create an OS Data Hub API project with OS Names access, then add its key to a `.env` file in the project root:

```dotenv
OS_NAMES_API_KEY=your-os-names-api-key
```

Create a `.env` file in the project root and add the key. The backend loads `.env` at startup; restart it after adding or changing the key. Or set the variable in PowerShell before starting the app:

```powershell
$env:OS_NAMES_API_KEY = "your-os-names-api-key"
npm run dev
```

Configure `OS_NAMES_API_KEY` in the deployment platform's secret manager in production. Never put it in React/Vite variables, source control, browser code, or logs. Without a key, postcode validation still works and the response states that OS Names location search is not configured.

Address results distinguish postcode validation from street/place matching using the free Postcodes.io and OS Names sources.
## REST API

All routes return JSON. See [docs/API.md](docs/API.md) for request/response shapes and examples.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/health` | Service health |
| `POST` | `/api/v1/postcode/validate` | Validate a postcode |
| `POST` | `/api/v1/postcode/lookup` | Validate and retrieve postcode details |
| `POST` | `/api/v1/postcode/nearest` | Retrieve nearby postcodes |
| `POST` | `/api/v1/postcode/bulk-lookup` | Look up 1–100 postcodes |
| `POST` | `/api/v1/address/check-completeness` | Check required address fields and validate an included postcode |
| `POST` | `/api/v1/address/parse` | Parse supplied address text into components |
| `POST` | `/api/v1/address/verify` | Validate postcode and compare road/place names using OS Names |
| `GET` | `/api/v1/search-history` | Most recent postcode searches |
| `GET` | `/api/v1/analytics` | Search counters |

This REST API is independent of the frontend so it can be integrated behind the Data Direct WMS. Before exposing it beyond a trusted network, deploy it behind the organization's authentication, authorization, TLS, and rate-limiting controls.

## Testing

```bash
npm test
npm run test:integration
```

`npm test` runs deterministic local tests for normalization, parsing, and completeness. `npm run test:integration` calls the live Postcodes.io API using real responses, including a known valid postcode, an invalid/random postcode, bulk lookup, and nearby postcode search. The integration suite requires internet access and may be affected by external service availability.

## Privacy and storage

No database is required. Search counters and a bounded history of postcode searches are kept in process memory and reset on restart. Pasted street/building details are not written to search history or logs. Upstream responses are cached in memory for five minutes.

## Architecture

- `src/`: React user interface.
- `server/services/postcodes.js`: Postcodes.io client, normalization, cache, and postcode response mapping.
- `server/services/address.js`: address parser and completeness rules.
- `server/services/addressVerification.js`: postcode, road, and place comparison without property-match claims.
- `server/services/providers/osNames.js`: OS Names API client, timeouts, caching, and response mapping.
- `server/index.js`: versioned REST API and in-memory dashboard data.

## Vercel deployment

Deploy from the repository root so Vercel includes the Vite app and the `api/` function. `api/[...path].js` forwards API requests to the shared Express application. The production build uses `npm run build` and publishes `dist/`, while API routes are served as a Node.js function.
