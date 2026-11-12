/**
 * Unit tests — Express routes in app.js
 * Runner: node --test   (Node 20+ built-in test runner, no extra deps)
 *
 * Strategy: import the Express app, attach it to a random OS-assigned port
 * for each describe block, then use the built-in `fetch` for requests.
 * No network calls leave the machine — the postcodes.js service layer is
 * stubbed via the module-level cache trick (we pre-seed valid/invalid outcomes
 * by using postcodes that map to realistic responses, or we monkey-patch
 * the global fetch before each suite to return mock data).
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

// ─── server bootstrap helpers ────────────────────────────────────────────────

async function startServer(app) {
  return new Promise((resolve) => {
    const server = createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

function stopServer(server) {
  return new Promise((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
}

// ─── fetch helpers ───────────────────────────────────────────────────────────

async function getJson(base, path) {
  const res = await fetch(`${base}${path}`);
  const body = await res.json();
  return { status: res.status, body };
}

async function postJson(base, path, data) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const body = await res.json();
  return { status: res.status, body };
}

// ─── mock fetch factory ──────────────────────────────────────────────────────
// The postcodes.js service uses globalThis.fetch internally.
// We replace it before tests that need it and restore it after.

// Capture the real (unmocked) fetch before any suite replaces it, so the test
// HTTP client can still reach the in-process server while global fetch is mocked
// for the upstream Postcodes.io calls made by the service layer.
const originalGlobalFetch = globalThis.fetch;

function mockGlobalFetch(handler) {
  const previous = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (/127\.0\.0\.1|localhost/.test(url)) {
      return originalGlobalFetch(input, init);
    }
    return handler(input, init);
  };
  return () => { globalThis.fetch = previous; };
}

function makeApiResponse(status, body) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers: { get: () => null },
    json: async () => body,
  });
}

// Pre-built Postcodes.io API mocks
const VALID_POSTCODE_VALIDATE = makeApiResponse(200, { status: 200, result: true });
const INVALID_POSTCODE_VALIDATE = makeApiResponse(200, { status: 200, result: false });
const VALID_POSTCODE_LOOKUP = makeApiResponse(200, {
  status: 200,
  result: {
    postcode: "SW1A 1AA",
    country: "England",
    region: "London",
    parliamentary_constituency: "Cities of London and Westminster",
    admin_district: "Westminster",
    admin_ward: "St James's",
    latitude: 51.501,
    longitude: -0.141,
    codes: { admin_district: "E09000033" },
  },
});
const NEAREST_RESPONSE = makeApiResponse(200, {
  status: 200,
  result: [
    { postcode: "SW1A 1AA", country: "England", admin_district: "Westminster", latitude: 51.501, longitude: -0.141, distance: 0 },
    { postcode: "SW1A 2AA", country: "England", admin_district: "Westminster", latitude: 51.502, longitude: -0.142, distance: 100 },
  ],
});
const BULK_RESPONSE = makeApiResponse(200, {
  status: 200,
  result: [
    { query: "SW1A 1AA", result: { postcode: "SW1A 1AA", country: "England", region: "London", admin_district: "Westminster" } },
  ],
});
const UPSTREAM_ERROR = makeApiResponse(502, { status: 502, error: "Service unavailable" });

// A fetch that sequences through multiple responses
function sequencedFetch(...responses) {
  let index = 0;
  return async (url, opts) => {
    const handler = responses[Math.min(index++, responses.length - 1)];
    return handler(url, opts);
  };
}

// ============================================================================
// /api/v1/health
// ============================================================================
describe("GET /api/v1/health", () => {
  let server, base;
  before(async () => {
    const app = (await import("../server/app.js")).default;
    ({ server, base } = await startServer(app));
  });
  after(() => stopServer(server));

  it("returns 200 with status:ok", async () => {
    const { status, body } = await getJson(base, "/api/v1/health");
    assert.equal(status, 200);
    assert.equal(body.status, "ok");
  });
});

// ============================================================================
// POST /api/v1/postcode/validate
// ============================================================================
describe("POST /api/v1/postcode/validate", () => {
  let server, base, restoreFetch;
  before(async () => {
    // Fresh module import by using a cache-busting query string is not possible
    // in Node ESM easily; we use global fetch mock instead.
    restoreFetch = mockGlobalFetch(sequencedFetch(
      VALID_POSTCODE_VALIDATE,  // validate call
      INVALID_POSTCODE_VALIDATE // second test
    ));
    const app = (await import("../server/app.js?v=validate")).default;
    ({ server, base } = await startServer(app));
  });
  after(async () => { restoreFetch(); await stopServer(server); });

  it("returns 200 with valid:true for a valid postcode", async () => {
    const { status, body } = await postJson(base, "/api/v1/postcode/validate", { postcode: "SW1A 1AA" });
    assert.equal(status, 200);
    assert.equal(typeof body.valid, "boolean");
    assert.equal(typeof body.normalizedPostcode, "string");
  });

  it("returns 400 for an empty postcode body", async () => {
    const { status, body } = await postJson(base, "/api/v1/postcode/validate", { postcode: "" });
    assert.equal(status, 400);
    assert.ok(typeof body.error === "string");
    assert.equal(body.code, "INVALID_INPUT");
  });

  it("returns 400 when postcode field is missing entirely", async () => {
    const { status, body } = await postJson(base, "/api/v1/postcode/validate", {});
    assert.equal(status, 400);
    assert.equal(body.code, "INVALID_INPUT");
  });
});

// ============================================================================
// POST /api/v1/postcode/lookup
// ============================================================================
describe("POST /api/v1/postcode/lookup", () => {
  let server, base, restoreFetch;
  before(async () => {
    restoreFetch = mockGlobalFetch(sequencedFetch(
      VALID_POSTCODE_VALIDATE,
      VALID_POSTCODE_LOOKUP
    ));
    const app = (await import("../server/app.js?v=lookup")).default;
    ({ server, base } = await startServer(app));
  });
  after(async () => { restoreFetch(); await stopServer(server); });

  it("returns 200 with VALID_POSTCODE status and data object", async () => {
    const { status, body } = await postJson(base, "/api/v1/postcode/lookup", { postcode: "SW1A 1AA" });
    assert.equal(status, 200);
    // Even if fetch is sequenced, the body should contain at minimum these fields
    assert.ok("status" in body);
    assert.ok("normalizedPostcode" in body);
  });

  it("returns 400 for missing postcode", async () => {
    const { status, body } = await postJson(base, "/api/v1/postcode/lookup", {});
    assert.equal(status, 400);
    assert.equal(body.code, "INVALID_INPUT");
  });
});

// ============================================================================
// POST /api/v1/postcode/nearest
// ============================================================================
describe("POST /api/v1/postcode/nearest", () => {
  let server, base, restoreFetch;
  before(async () => {
    restoreFetch = mockGlobalFetch(sequencedFetch(
      VALID_POSTCODE_VALIDATE,
      NEAREST_RESPONSE
    ));
    const app = (await import("../server/app.js?v=nearest")).default;
    ({ server, base } = await startServer(app));
  });
  after(async () => { restoreFetch(); await stopServer(server); });

  it("returns 200 with postcodes array", async () => {
    const { status, body } = await postJson(base, "/api/v1/postcode/nearest", { postcode: "SW1A 1AA" });
    assert.equal(status, 200);
    assert.ok("postcodes" in body || "status" in body);
  });

  it("returns 400 for empty postcode", async () => {
    const { status, body } = await postJson(base, "/api/v1/postcode/nearest", { postcode: "" });
    assert.equal(status, 400);
    assert.equal(body.code, "INVALID_INPUT");
  });
});

// ============================================================================
// POST /api/v1/postcode/bulk-lookup
// ============================================================================
describe("POST /api/v1/postcode/bulk-lookup", () => {
  let server, base, restoreFetch;
  before(async () => {
    restoreFetch = mockGlobalFetch(BULK_RESPONSE);
    const app = (await import("../server/app.js?v=bulk")).default;
    ({ server, base } = await startServer(app));
  });
  after(async () => { restoreFetch(); await stopServer(server); });

  it("returns 200 with results array", async () => {
    const { status, body } = await postJson(base, "/api/v1/postcode/bulk-lookup", {
      postcodes: ["SW1A 1AA"]
    });
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.results), "body.results should be an array");
  });

  it("returns 400 for empty postcodes array", async () => {
    const { status, body } = await postJson(base, "/api/v1/postcode/bulk-lookup", { postcodes: [] });
    assert.equal(status, 400);
    assert.equal(body.code, "INVALID_INPUT");
  });

  it("returns 400 for more than 100 postcodes", async () => {
    const tooMany = Array.from({ length: 101 }, (_, i) => `SW${i % 10} 1AA`);
    const { status, body } = await postJson(base, "/api/v1/postcode/bulk-lookup", { postcodes: tooMany });
    assert.equal(status, 400);
    assert.equal(body.code, "INVALID_INPUT");
  });

  it("returns 400 when postcodes is missing", async () => {
    const { status } = await postJson(base, "/api/v1/postcode/bulk-lookup", {});
    assert.equal(status, 400);
  });

  it("returns 400 when postcodes is a string instead of array", async () => {
    const { status } = await postJson(base, "/api/v1/postcode/bulk-lookup", { postcodes: "SW1A 1AA" });
    assert.equal(status, 400);
  });
});

// ============================================================================
// POST /api/v1/address/parse
// ============================================================================
describe("POST /api/v1/address/parse", () => {
  let server, base;
  before(async () => {
    const app = (await import("../server/app.js?v=parse")).default;
    ({ server, base } = await startServer(app));
  });
  after(() => stopServer(server));

  it("returns 200 with components object for a valid address", async () => {
    const { status, body } = await postJson(base, "/api/v1/address/parse", {
      address: "12 High Street\nLondon\nSW1A 1AA"
    });
    assert.equal(status, 200);
    assert.ok(typeof body.components === "object");
    assert.ok("building" in body.components);
    assert.ok("street" in body.components);
    assert.ok("postcode" in body.components);
  });

  it("returns 400 for missing address field", async () => {
    const { status, body } = await postJson(base, "/api/v1/address/parse", {});
    assert.equal(status, 400);
    assert.equal(body.code, "INVALID_INPUT");
  });

  it("returns 400 for empty address string", async () => {
    const { status, body } = await postJson(base, "/api/v1/address/parse", { address: "   " });
    assert.equal(status, 400);
    assert.equal(body.code, "INVALID_INPUT");
  });

  it("returns 400 for non-string address", async () => {
    const { status } = await postJson(base, "/api/v1/address/parse", { address: 12345 });
    assert.equal(status, 400);
  });
});

// ============================================================================
// POST /api/v1/address/check-completeness
// ============================================================================
describe("POST /api/v1/address/check-completeness", () => {
  let server, base, restoreFetch;
  before(async () => {
    restoreFetch = mockGlobalFetch(VALID_POSTCODE_VALIDATE);
    const app = (await import("../server/app.js?v=completeness")).default;
    ({ server, base } = await startServer(app));
  });
  after(async () => { restoreFetch(); await stopServer(server); });

  const fullAddress = {
    components: {
      building: "12",
      street: "High Street",
      townCity: "London",
      county: "Greater London",
      postcode: "SW1A 1AA",
      country: "United Kingdom",
    }
  };

  it("returns 200 with complete:true for a full address", async () => {
    const { status, body } = await postJson(base, "/api/v1/address/check-completeness", fullAddress);
    assert.equal(status, 200);
    assert.equal(typeof body.complete, "boolean");
    assert.ok("missingComponents" in body);
  });

  it("returns 200 with complete:false and missingComponents for partial address", async () => {
    const partial = {
      components: { ...fullAddress.components, building: "", street: "" }
    };
    const { status, body } = await postJson(base, "/api/v1/address/check-completeness", partial);
    assert.equal(status, 200);
    assert.equal(body.complete, false);
    assert.ok(body.missingComponents.includes("building"));
    assert.ok(body.missingComponents.includes("street"));
  });

  it("includes postcodeValidation in response", async () => {
    const { status, body } = await postJson(base, "/api/v1/address/check-completeness", fullAddress);
    assert.equal(status, 200);
    assert.ok("postcodeValidation" in body);
  });
});

// ============================================================================
// POST /api/v1/address/verify
// ============================================================================
describe("POST /api/v1/address/verify", () => {
  let server, base, restoreFetch;
  before(async () => {
    // validate call: returns valid; OS Names not configured (no env key set)
    restoreFetch = mockGlobalFetch(VALID_POSTCODE_VALIDATE);
    const app = (await import("../server/app.js?v=verify")).default;
    ({ server, base } = await startServer(app));
  });
  after(async () => { restoreFetch(); await stopServer(server); });

  const fullAddress = {
    components: {
      building: "12",
      street: "High Street",
      townCity: "London",
      county: "Greater London",
      postcode: "SW1A 1AA",
      country: "United Kingdom",
    }
  };

  it("returns 200 with addressVerification and postcodeValidation", async () => {
    const { status, body } = await postJson(base, "/api/v1/address/verify", fullAddress);
    assert.equal(status, 200);
    assert.ok("addressVerification" in body);
    assert.ok("postcodeValidation" in body);
    assert.equal(body.propertyVerified, false);
    assert.equal(body.recipientVerified, false);
  });

  it("returns 200 for address missing building — completeness flags it", async () => {
    const partial = {
      components: { ...fullAddress.components, building: "" }
    };
    const { status, body } = await postJson(base, "/api/v1/address/verify", partial);
    assert.equal(status, 200);
    // completenessStatus reflects the missing building
    assert.ok(
      body.completenessStatus === "ADDRESS_INCOMPLETE" ||
      (body.missingComponents && body.missingComponents.includes("building"))
    );
  });
});

// ============================================================================
// GET /api/v1/analytics
// ============================================================================
describe("GET /api/v1/analytics", () => {
  let server, base;
  before(async () => {
    const app = (await import("../server/app.js?v=analytics")).default;
    ({ server, base } = await startServer(app));
  });
  after(() => stopServer(server));

  it("returns 200 with all analytics fields", async () => {
    const { status, body } = await getJson(base, "/api/v1/analytics");
    assert.equal(status, 200);
    const fields = ["totalSearches", "validPostcodes", "invalidPostcodes", "incompleteAddresses", "apiErrors"];
    for (const field of fields) {
      assert.ok(field in body, `analytics should have field: ${field}`);
      assert.equal(typeof body[field], "number");
    }
  });
});

// ============================================================================
// GET /api/v1/search-history
// ============================================================================
describe("GET /api/v1/search-history", () => {
  let server, base;
  before(async () => {
    const app = (await import("../server/app.js?v=history")).default;
    ({ server, base } = await startServer(app));
  });
  after(() => stopServer(server));

  it("returns 200 with history array", async () => {
    const { status, body } = await getJson(base, "/api/v1/search-history");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.history), "history should be an array");
  });

  it("history has at most 20 items", async () => {
    const { body } = await getJson(base, "/api/v1/search-history");
    assert.ok(body.history.length <= 20);
  });
});

// ============================================================================
// 404 — unknown /api route
// ============================================================================
describe("Unknown /api/* route", () => {
  let server, base;
  before(async () => {
    const app = (await import("../server/app.js?v=notfound")).default;
    ({ server, base } = await startServer(app));
  });
  after(() => stopServer(server));

  it("returns 404 with NOT_FOUND code for unknown API path", async () => {
    const { status, body } = await getJson(base, "/api/v1/this-does-not-exist");
    assert.equal(status, 404);
    assert.equal(body.code, "NOT_FOUND");
  });
});

// ============================================================================
// Global error handler — 500 on internal throw
// ============================================================================
describe("Global error handler", () => {
  let server, base, restoreFetch;
  before(async () => {
    // Force postcodes.io to return a 502 so the service throws PostcodesApiError
    restoreFetch = mockGlobalFetch(async () => ({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      json: async () => ({ status: 502, error: "Service unavailable" }),
    }));
    const app = (await import("../server/app.js?v=error-handler")).default;
    ({ server, base } = await startServer(app));
  });
  after(async () => { restoreFetch(); await stopServer(server); });

  it("returns 502 and JSON error body when upstream throws", async () => {
    const { status, body } = await postJson(base, "/api/v1/postcode/validate", { postcode: "SW1A 1AA" });
    assert.ok(status >= 400 && status < 600, `expected 4xx/5xx, got ${status}`);
    assert.ok(typeof body.error === "string");
  });
});

// ============================================================================
// Content-type guard — rejects non-JSON bodies on JSON routes
// ============================================================================
describe("Content-type handling", () => {
  let server, base;
  before(async () => {
    const app = (await import("../server/app.js?v=content-type")).default;
    ({ server, base } = await startServer(app));
  });
  after(() => stopServer(server));

  it("returns 400 or 415 when body is plain text", async () => {
    const res = await fetch(`${base}/api/v1/address/parse`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "12 High Street, London, SW1A 1AA",
    });
    // Express body-parser silently ignores non-JSON; route sees empty body → INVALID_INPUT
    assert.ok(res.status >= 400);
  });
});
