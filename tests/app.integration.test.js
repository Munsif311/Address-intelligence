/**
 * Integration tests — real network calls to Postcodes.io
 * Runner: node --test tests/*.integration.test.js
 *
 * These tests require internet access.
 * They do NOT require OS_NAMES_API_KEY; OS Names tests are skipped if key absent.
 *
 * Run:  npm run test:integration
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

// ─── server helpers ───────────────────────────────────────────────────────────

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

async function postJson(base, path, data) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const body = await res.json();
  return { status: res.status, body };
}

async function getJson(base, path) {
  const res = await fetch(`${base}${path}`);
  const body = await res.json();
  return { status: res.status, body };
}

// ─── shared server ────────────────────────────────────────────────────────────
let server, base;

before(async () => {
  const app = (await import("../server/app.js")).default;
  ({ server, base } = await startServer(app));
});

after(() => stopServer(server));

// ============================================================================
// Health check
// ============================================================================
describe("[integration] Health endpoint", () => {
  it("responds with status:ok", async () => {
    const { status, body } = await getJson(base, "/api/v1/health");
    assert.equal(status, 200);
    assert.equal(body.status, "ok");
  });
});

// ============================================================================
// Postcode — validate (live Postcodes.io)
// ============================================================================
describe("[integration] POST /api/v1/postcode/validate", () => {
  it("confirms SW1A 1AA is valid", async () => {
    const { status, body } = await postJson(base, "/api/v1/postcode/validate", { postcode: "SW1A 1AA" });
    assert.equal(status, 200);
    assert.equal(body.valid, true);
    assert.equal(body.normalizedPostcode, "SW1A 1AA");
  });

  it("confirms ZZ99 9ZZ is invalid", async () => {
    const { status, body } = await postJson(base, "/api/v1/postcode/validate", { postcode: "ZZ99 9ZZ" });
    assert.equal(status, 200);
    assert.equal(body.valid, false);
  });

  it("returns 400 for gibberish input", async () => {
    const { status, body } = await postJson(base, "/api/v1/postcode/validate", { postcode: "!!!!" });
    assert.equal(status, 400);
    assert.equal(body.code, "INVALID_INPUT");
  });
});

// ============================================================================
// Postcode — lookup (live Postcodes.io)
// ============================================================================
describe("[integration] POST /api/v1/postcode/lookup", () => {
  it("returns VALID_POSTCODE with geographic data for SW1A 1AA", async () => {
    const { status, body } = await postJson(base, "/api/v1/postcode/lookup", { postcode: "SW1A 1AA" });
    assert.equal(status, 200);
    assert.equal(body.status, "VALID_POSTCODE");
    assert.ok(body.data, "should have data object");
    assert.ok(typeof body.data.country === "string");
    assert.ok(typeof body.data.latitude === "number");
    assert.ok(typeof body.data.longitude === "number");
    assert.equal(body.propertyVerified, false);
  });

  it("returns INVALID_POSTCODE for ZZ99 9ZZ", async () => {
    const { status, body } = await postJson(base, "/api/v1/postcode/lookup", { postcode: "ZZ99 9ZZ" });
    assert.equal(status, 200);
    assert.equal(body.status, "INVALID_POSTCODE");
    assert.equal(body.data, null);
  });

  it("normalizes postcode without space", async () => {
    const { status, body } = await postJson(base, "/api/v1/postcode/lookup", { postcode: "sw1a1aa" });
    assert.equal(status, 200);
    assert.equal(body.normalizedPostcode, "SW1A 1AA");
  });
});

// ============================================================================
// Postcode — nearest (live Postcodes.io)
// ============================================================================
describe("[integration] POST /api/v1/postcode/nearest", () => {
  it("returns postcodes array for SW1A 1AA", async () => {
    const { status, body } = await postJson(base, "/api/v1/postcode/nearest", { postcode: "SW1A 1AA" });
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.postcodes));
    assert.ok(body.postcodes.length > 0, "should have at least one nearby postcode");
    const first = body.postcodes[0];
    assert.ok(typeof first.postcode === "string");
    assert.ok(typeof first.distance === "number");
  });

  it("returns INVALID_POSTCODE for invalid postcode", async () => {
    const { status, body } = await postJson(base, "/api/v1/postcode/nearest", { postcode: "ZZ99 9ZZ" });
    assert.equal(status, 200);
    assert.equal(body.status, "INVALID_POSTCODE");
    assert.deepEqual(body.postcodes, []);
  });
});

// ============================================================================
// Postcode — bulk lookup (live Postcodes.io)
// ============================================================================
describe("[integration] POST /api/v1/postcode/bulk-lookup", () => {
  it("returns results for a mix of valid and invalid postcodes", async () => {
    const { status, body } = await postJson(base, "/api/v1/postcode/bulk-lookup", {
      postcodes: ["SW1A 1AA", "ZZ99 9ZZ", "EC1A 1BB"]
    });
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.results));
    assert.equal(body.results.length, 3);

    const valid = body.results.find((r) => r.submittedPostcode === "SW1A 1AA");
    assert.ok(valid, "should have result for SW1A 1AA");
    assert.equal(valid.status, "VALID_POSTCODE");

    const invalid = body.results.find((r) => r.submittedPostcode === "ZZ99 9ZZ");
    assert.ok(invalid, "should have result for ZZ99 9ZZ");
    assert.ok(invalid.status !== "VALID_POSTCODE");
  });

  it("handles all-invalid batch gracefully", async () => {
    const { status, body } = await postJson(base, "/api/v1/postcode/bulk-lookup", {
      postcodes: ["ZZ99 9ZZ", "NOTREAL"]
    });
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.results));
    for (const r of body.results) {
      assert.notEqual(r.status, "VALID_POSTCODE");
    }
  });
});

// ============================================================================
// Address — parse (pure logic, no network)
// ============================================================================
describe("[integration] POST /api/v1/address/parse", () => {
  it("parses a multiline UK address", async () => {
    const { status, body } = await postJson(base, "/api/v1/address/parse", {
      address: "10 Downing Street\nLondon\nSW1A 2AA\nUnited Kingdom"
    });
    assert.equal(status, 200);
    assert.ok(typeof body.components === "object");
    assert.equal(body.components.postcode, "SW1A 2AA");
    assert.ok(body.components.country.toLowerCase().includes("united kingdom"));
  });
});

// ============================================================================
// Address — check-completeness (live postcode validation)
// ============================================================================
describe("[integration] POST /api/v1/address/check-completeness", () => {
  it("marks a full address as complete with valid postcode", async () => {
    const { status, body } = await postJson(base, "/api/v1/address/check-completeness", {
      components: {
        building: "10",
        street: "Downing Street",
        townCity: "London",
        county: "Greater London",
        postcode: "SW1A 2AA",
        country: "United Kingdom",
      }
    });
    assert.equal(status, 200);
    assert.equal(body.complete, true);
    assert.equal(body.completenessStatus, "ADDRESS_COMPLETE");
    assert.ok(body.postcodeValidation);
    assert.equal(body.postcodeValidation.valid, true);
  });

  it("marks incomplete when building is missing", async () => {
    const { status, body } = await postJson(base, "/api/v1/address/check-completeness", {
      components: {
        building: "",
        street: "Downing Street",
        townCity: "London",
        county: "",
        postcode: "SW1A 2AA",
        country: "United Kingdom",
      }
    });
    assert.equal(status, 200);
    assert.equal(body.complete, false);
    assert.ok(body.missingComponents.includes("building"));
  });
});

// ============================================================================
// Address — verify (live Postcodes.io; OS Names depends on env key)
// ============================================================================
describe("[integration] POST /api/v1/address/verify", () => {
  it("returns valid postcode and propertyVerified:false", async () => {
    const { status, body } = await postJson(base, "/api/v1/address/verify", {
      components: {
        building: "10",
        street: "Downing Street",
        townCity: "London",
        county: "Greater London",
        postcode: "SW1A 2AA",
        country: "United Kingdom",
      }
    });
    assert.equal(status, 200);
    assert.ok(body.addressVerification, "should have addressVerification");
    assert.ok(body.postcodeValidation, "should have postcodeValidation");
    assert.equal(body.propertyVerified, false);
    assert.equal(body.recipientVerified, false);
    // Postcode should be valid
    assert.equal(body.postcodeValidation.valid, true);
  });

  it("returns NO_MATCH for invalid postcode", async () => {
    const { status, body } = await postJson(base, "/api/v1/address/verify", {
      components: {
        building: "1",
        street: "Fake Street",
        townCity: "Nowhere",
        county: "",
        postcode: "ZZ99 9ZZ",
        country: "United Kingdom",
      }
    });
    assert.equal(status, 200);
    assert.equal(body.addressVerification.status, "NO_MATCH");
    assert.equal(body.postcodeValidation.valid, false);
  });

  it("returns INCOMPLETE_INPUT when postcode is omitted", async () => {
    const { status, body } = await postJson(base, "/api/v1/address/verify", {
      components: {
        building: "1",
        street: "Example Road",
        townCity: "London",
        county: "",
        postcode: "",
        country: "United Kingdom",
      }
    });
    assert.equal(status, 200);
    assert.equal(body.addressVerification.status, "INCOMPLETE_INPUT");
  });
});

// ============================================================================
// Analytics accumulation
// ============================================================================
describe("[integration] Analytics accumulate correctly", () => {
  it("totalSearches increases after a lookup", async () => {
    const { body: before } = await getJson(base, "/api/v1/analytics");
    await postJson(base, "/api/v1/postcode/lookup", { postcode: "SW1A 1AA" });
    const { body: after } = await getJson(base, "/api/v1/analytics");
    assert.ok(after.totalSearches > before.totalSearches, "totalSearches should have increased");
  });
});

// ============================================================================
// Search history populated after lookup
// ============================================================================
describe("[integration] Search history", () => {
  it("contains a recent lookup entry", async () => {
    await postJson(base, "/api/v1/postcode/lookup", { postcode: "EC1A 1BB" });
    const { body } = await getJson(base, "/api/v1/search-history");
    assert.ok(Array.isArray(body.history));
    const entry = body.history.find((h) => h.postcode === "EC1A 1BB");
    assert.ok(entry, "history should contain the postcode we just looked up");
    assert.ok(typeof entry.searchedAt === "string");
    assert.ok(typeof entry.status === "string");
  });
});