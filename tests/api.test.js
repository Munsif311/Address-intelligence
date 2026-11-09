import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import app from "../server/app.js";

test("API routes return JSON responses and preserve API 404 handling", async (t) => {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const origin = `http://127.0.0.1:${server.address().port}`;

  async function requestJson(path, options) {
    const response = await fetch(`${origin}${path}`, options);
    assert.match(response.headers.get("content-type") || "", /application\/json/i, `${path} should return JSON`);
    return { response, body: await response.json() };
  }

  const health = await requestJson("/api/v1/health");
  assert.equal(health.response.status, 200);
  assert.equal(health.body.status, "ok");

  const analytics = await requestJson("/api/v1/analytics");
  assert.equal(analytics.response.status, 200);
  assert.equal(typeof analytics.body.totalSearches, "number");

  const history = await requestJson("/api/v1/search-history");
  assert.equal(history.response.status, 200);
  assert.ok(Array.isArray(history.body.history));

  const invalidPost = (body) => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  for (const [path, body] of [
    ["/api/v1/postcode/validate", {}],
    ["/api/v1/postcode/lookup", {}],
    ["/api/v1/postcode/nearest", {}],
    ["/api/v1/postcode/bulk-lookup", { postcodes: [] }]
  ]) {
    const result = await requestJson(path, invalidPost(body));
    assert.equal(result.response.status, 400, `${path} should validate input`);
    assert.equal(typeof result.body.error, "string");
  }

  const completeness = await requestJson("/api/v1/address/check-completeness", invalidPost({}));
  assert.equal(completeness.response.status, 200);
  assert.equal(completeness.body.completenessStatus, "ADDRESS_INCOMPLETE");

  const parsed = await requestJson("/api/v1/address/parse", invalidPost({ address: "12 Example Road\nLondon\nSW1A 1AA" }));
  assert.equal(parsed.response.status, 200);
  assert.equal(parsed.body.components.postcode, "SW1A 1AA");

  const verification = await requestJson("/api/v1/address/verify", invalidPost({}));
  assert.equal(verification.response.status, 200);
  assert.equal(verification.body.addressVerification.status, "INCOMPLETE_INPUT");

  const missing = await requestJson("/api/v1/not-found");
  assert.equal(missing.response.status, 404);
  assert.equal(missing.body.code, "NOT_FOUND");
});
