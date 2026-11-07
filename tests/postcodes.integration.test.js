import test from "node:test";
import assert from "node:assert/strict";
import { bulkLookupPostcodes, findNearestPostcodes, lookupPostcode, validatePostcode } from "../server/services/postcodes.js";
import { checkAddressCompleteness } from "../server/services/address.js";

test("live Postcodes.io validation and lookup for a known postcode", async () => {
  const validation = await validatePostcode("sw1a1aa");
  assert.equal(validation.valid, true);
  assert.equal(validation.normalizedPostcode, "SW1A 1AA");
  const lookup = await lookupPostcode("SW1A 1AA");
  assert.equal(lookup.status, "VALID_POSTCODE");
  assert.equal(lookup.data.postcode, "SW1A 1AA");
  assert.equal(lookup.propertyVerified, false);

  const dundee = await lookupPostcode("DD4 8RN");
  assert.equal(dundee.status, "VALID_POSTCODE");
  assert.equal(dundee.data.postcode, "DD4 8RN");
  assert.equal(dundee.propertyVerified, false);
});

test("live Postcodes.io rejects a random postcode and supports bulk / nearby lookups", async () => {
  const invalid = await lookupPostcode("ZZ99 9ZZ");
  assert.equal(invalid.status, "INVALID_POSTCODE");

  const bulk = await bulkLookupPostcodes(["SW1A 1AA", "ZZ99 9ZZ"]);
  assert.equal(bulk.length, 2);
  assert.equal(bulk[0].status, "VALID_POSTCODE");
  assert.notEqual(bulk[1].status, "VALID_POSTCODE");

  const nearby = await findNearestPostcodes("SW1A 1AA");
  assert.equal(nearby.status, "VALID_POSTCODE");
  assert.ok(nearby.postcodes.length > 0);
});

test("address completeness stays distinct from a live postcode result", async () => {
  const result = checkAddressCompleteness({
    components: { building: "12", street: "", townCity: "London", county: "", postcode: "SW1A 1AA", country: "United Kingdom" }
  });
  const validation = await validatePostcode(result.components.postcode);
  assert.equal(validation.valid, true);
  assert.equal(result.completenessStatus, "ADDRESS_INCOMPLETE");
  assert.deepEqual(result.missingComponents, ["street"]);
  assert.match(result.verificationLimitation, /can confirm that a specific house/i);
});

test("a complete address with an invalid postcode remains unverified", async () => {
  const result = checkAddressCompleteness({
    components: { building: "12", street: "Example Road", townCity: "London", county: "", postcode: "ZZ99 9ZZ", country: "United Kingdom" }
  });
  const validation = await validatePostcode(result.components.postcode);
  assert.equal(result.completenessStatus, "ADDRESS_COMPLETE");
  assert.equal(validation.valid, false);
  assert.match(result.verificationLimitation, /can confirm that a specific house/i);
});

test("reports external service unavailability explicitly", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("offline test"); };
  try {
    await assert.rejects(
      lookupPostcode("AB1 2CD"),
      (error) => error.code === "UPSTREAM_UNAVAILABLE" && error.status === 502
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
