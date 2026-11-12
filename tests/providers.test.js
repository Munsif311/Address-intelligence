/**
 * Unit tests — osNames.js and addressVerification.js
 * Runner: node --test   (Node 20+ built-in test runner)
 *
 * Both modules accept dependency-injection hooks so we never hit real APIs.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

// ─── mock helpers ────────────────────────────────────────────────────────────

function makeFetch(status, body) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
  });
}

function makeOsPayload(names = []) {
  return {
    results: names.map((name) => ({
      GAZETTEER_ENTRY: {
        ID: name,
        NAME1: name,
        TYPE: "Named Road",
        LOCAL_TYPE: "Named Road",
        POSTCODE_DISTRICT: "SW1A",
        POPULATED_PLACE: "London",
        COUNTY_UNITARY: "Greater London",
        REGION: "London",
        COUNTRY: "England",
      },
    })),
  };
}

// A minimal validatePostcode stub that always returns valid
const alwaysValidPostcode = async (value) => ({
  submittedPostcode: value,
  normalizedPostcode: value.trim().toUpperCase(),
  valid: true,
  status: "VALID_POSTCODE",
  explanation: "stub — valid",
});

const alwaysInvalidPostcode = async (value) => ({
  submittedPostcode: value,
  normalizedPostcode: "",
  valid: false,
  status: "INVALID_POSTCODE",
  explanation: "stub — invalid",
});

const throwingPostcodeValidator = async () => {
  const err = new Error("Postcodes.io is unavailable.");
  err.status = 502;
  err.code = "UPSTREAM_UNAVAILABLE";
  throw err;
};

// A minimal searchProvider stub that returns features
function makeSearchProvider(features = []) {
  return async () => ({
    provider: "OS Names API",
    source: "Ordnance Survey OS Open Names",
    configured: true,
    status: features.length ? "SEARCH_COMPLETE" : "NO_MATCH",
    verifiedAt: new Date().toISOString(),
    explanation: "stub",
    features,
  });
}

function makeUnconfiguredProvider() {
  return async () => ({
    provider: "OS Names API",
    source: "Ordnance Survey OS Open Names",
    configured: false,
    status: "PROVIDER_NOT_CONFIGURED",
    verifiedAt: new Date().toISOString(),
    explanation: "not configured",
    features: [],
  });
}

function makeThrowingProvider(message = "OS Names failed") {
  return async () => {
    const { OsNamesProviderError } = await import("../server/services/providers/osNames.js");
    throw new OsNamesProviderError(message, 502, "PROVIDER_ERROR");
  };
}

const sampleComponents = {
  building: "12",
  street: "High Street",
  townCity: "London",
  county: "Greater London",
  postcode: "SW1A 1AA",
  country: "United Kingdom",
};

// ============================================================================
// osNames.js — searchOsNames
// ============================================================================
describe("searchOsNames — no API key", () => {
  let searchOsNames;
  before(async () => {
    ({ searchOsNames } = await import("../server/services/providers/osNames.js"));
  });

  it("returns configured:false when no API key set", async () => {
    const result = await searchOsNames(sampleComponents, { apiKey: "", fetchImpl: makeFetch(200, makeOsPayload()) });
    assert.equal(result.configured, false);
    assert.equal(result.status, "PROVIDER_NOT_CONFIGURED");
    assert.deepEqual(result.features, []);
  });

  it("returns configured:false for whitespace-only key", async () => {
    const result = await searchOsNames(sampleComponents, { apiKey: "   ", fetchImpl: makeFetch(200, makeOsPayload()) });
    assert.equal(result.configured, false);
  });

  it("returns configured:false when apiKey is undefined", async () => {
    // Don't pass the option — it falls back to process.env.OS_NAMES_API_KEY which won't be set in test
    const result = await searchOsNames(sampleComponents, { apiKey: undefined, fetchImpl: makeFetch(200, makeOsPayload()) });
    assert.equal(result.configured, false);
  });
});

describe("searchOsNames — with API key", () => {
  let searchOsNames;
  before(async () => {
    ({ searchOsNames } = await import("../server/services/providers/osNames.js"));
  });

  it("returns features when OS Names responds successfully", async () => {
    const payload = makeOsPayload(["High Street", "Baker Street"]);
    const result = await searchOsNames(sampleComponents, {
      apiKey: "test-key",
      fetchImpl: makeFetch(200, payload),
    });
    assert.equal(result.configured, true);
    assert.ok(result.features.length >= 1);
    assert.ok(result.features.every((f) => typeof f.name === "string"));
  });

  it("returns configured:true with empty features when no results", async () => {
    const result = await searchOsNames(sampleComponents, {
      apiKey: "test-key",
      fetchImpl: makeFetch(200, makeOsPayload()),
    });
    assert.equal(result.configured, true);
    assert.deepEqual(result.features, []);
  });

  it("throws OsNamesProviderError on 401 Unauthorized", async () => {
    const { OsNamesProviderError } = await import("../server/services/providers/osNames.js");
    await assert.rejects(
      () => searchOsNames(sampleComponents, {
        apiKey: "bad-key",
        fetchImpl: makeFetch(401, { error: "Unauthorized" }),
      }),
      (err) => {
        assert.ok(err instanceof OsNamesProviderError);
        assert.equal(err.code, "PROVIDER_AUTH_ERROR");
        return true;
      }
    );
  });

  it("throws OsNamesProviderError on 403 Forbidden", async () => {
    const { OsNamesProviderError } = await import("../server/services/providers/osNames.js");
    await assert.rejects(
      () => searchOsNames(sampleComponents, {
        apiKey: "bad-key",
        fetchImpl: makeFetch(403, { error: "Forbidden" }),
      }),
      (err) => err instanceof OsNamesProviderError && err.code === "PROVIDER_AUTH_ERROR"
    );
  });

  it("throws OsNamesProviderError when response has no results array", async () => {
    const { OsNamesProviderError } = await import("../server/services/providers/osNames.js");
    await assert.rejects(
      () => searchOsNames(sampleComponents, {
        apiKey: "test-key",
        fetchImpl: makeFetch(200, { unexpected: true }),
      }),
      (err) => err instanceof OsNamesProviderError && err.code === "INVALID_PROVIDER_RESPONSE"
    );
  });

  it("throws OsNamesProviderError on 502 upstream error", async () => {
    const { OsNamesProviderError } = await import("../server/services/providers/osNames.js");
    await assert.rejects(
      () => searchOsNames(sampleComponents, {
        apiKey: "test-key",
        fetchImpl: makeFetch(502, { error: "Bad Gateway" }),
      }),
      (err) => err instanceof OsNamesProviderError
    );
  });

  it("returns NO_QUERY status when no postcode or street given", async () => {
    const result = await searchOsNames(
      { building: "12", street: "", townCity: "", postcode: "", country: "" },
      { apiKey: "test-key", fetchImpl: makeFetch(200, makeOsPayload()) }
    );
    assert.equal(result.status, "NO_QUERY");
  });
});

// ============================================================================
// addressVerification.js — verifyAddress
// ============================================================================
describe("verifyAddress — no postcode", () => {
  let verifyAddress;
  before(async () => {
    ({ verifyAddress } = await import("../server/services/addressVerification.js"));
  });

  it("returns INCOMPLETE_INPUT when postcode is missing", async () => {
    const result = await verifyAddress(
      { components: { ...sampleComponents, postcode: "" } },
      { postcodeValidator: alwaysValidPostcode, searchProvider: makeSearchProvider() }
    );
    assert.equal(result.status, "INCOMPLETE_INPUT");
    assert.equal(result.providerStatus, "NOT_SEARCHED");
  });
});

describe("verifyAddress — invalid postcode", () => {
  let verifyAddress;
  before(async () => {
    ({ verifyAddress } = await import("../server/services/addressVerification.js"));
  });

  it("returns NO_MATCH when postcode is invalid", async () => {
    const result = await verifyAddress(
      { components: sampleComponents },
      { postcodeValidator: alwaysInvalidPostcode, searchProvider: makeSearchProvider() }
    );
    assert.equal(result.status, "NO_MATCH");
    assert.equal(result.componentMatches.postcode, false);
  });
});

describe("verifyAddress — postcode validator throws", () => {
  let verifyAddress;
  before(async () => {
    ({ verifyAddress } = await import("../server/services/addressVerification.js"));
  });

  it("returns PROVIDER_ERROR when postcodes.io is unavailable", async () => {
    const result = await verifyAddress(
      { components: sampleComponents },
      { postcodeValidator: throwingPostcodeValidator, searchProvider: makeSearchProvider() }
    );
    assert.equal(result.status, "PROVIDER_ERROR");
  });
});

describe("verifyAddress — OS Names provider error", () => {
  let verifyAddress;
  before(async () => {
    ({ verifyAddress } = await import("../server/services/addressVerification.js"));
  });

  it("returns PROVIDER_ERROR when OS Names throws", async () => {
    const result = await verifyAddress(
      { components: sampleComponents },
      {
        postcodeValidator: alwaysValidPostcode,
        searchProvider: makeThrowingProvider(),
      }
    );
    assert.equal(result.status, "PROVIDER_ERROR");
    assert.equal(result.componentMatches.postcode, true); // postcode still validated
  });
});

describe("verifyAddress — OS Names not configured", () => {
  let verifyAddress;
  before(async () => {
    ({ verifyAddress } = await import("../server/services/addressVerification.js"));
  });

  it("returns POSTCODE_MATCH when OS Names is not configured", async () => {
    const result = await verifyAddress(
      { components: sampleComponents },
      {
        postcodeValidator: alwaysValidPostcode,
        searchProvider: makeUnconfiguredProvider(),
      }
    );
    assert.equal(result.status, "POSTCODE_MATCH");
    assert.equal(result.propertyVerified, false);
  });
});

describe("verifyAddress — street match found", () => {
  let verifyAddress;
  before(async () => {
    ({ verifyAddress } = await import("../server/services/addressVerification.js"));
  });

  it("returns STREET_OR_LOCATION_MATCH when street feature matches", async () => {
    // The feature name must normalize-match the submitted street
    const features = [
      {
        id: "feat-1",
        name: "High Street",
        type: "Named Road",
        localType: "Named Road",
        postcodeDistrict: "SW1A",
        populatedPlace: "London",
        county: "Greater London",
        region: "London",
        country: "England",
      },
    ];
    const result = await verifyAddress(
      { components: sampleComponents },
      {
        postcodeValidator: alwaysValidPostcode,
        searchProvider: makeSearchProvider(features),
      }
    );
    assert.equal(result.status, "STREET_OR_LOCATION_MATCH");
    assert.equal(result.propertyVerified, false);
  });
});

describe("verifyAddress — partial match", () => {
  let verifyAddress;
  before(async () => {
    ({ verifyAddress } = await import("../server/services/addressVerification.js"));
  });

  it("returns PARTIAL_MATCH when features found but street does not match", async () => {
    const features = [
      {
        id: "feat-2",
        name: "Different Road",        // won't match "High Street"
        type: "Named Road",
        localType: "Named Road",
        postcodeDistrict: "SW1A",
        populatedPlace: "London",
        county: "Greater London",
        region: "London",
        country: "England",
      },
    ];
    const result = await verifyAddress(
      { components: sampleComponents },
      {
        postcodeValidator: alwaysValidPostcode,
        searchProvider: makeSearchProvider(features),
      }
    );
    assert.equal(result.status, "PARTIAL_MATCH");
  });
});

describe("verifyAddress — output shape", () => {
  let verifyAddress;
  before(async () => {
    ({ verifyAddress } = await import("../server/services/addressVerification.js"));
  });

  it("always sets recipientVerified and propertyVerified to false", async () => {
    const result = await verifyAddress(
      { components: sampleComponents },
      {
        postcodeValidator: alwaysValidPostcode,
        searchProvider: makeSearchProvider(),
      }
    );
    assert.equal(result.recipientVerified, false);
    assert.equal(result.propertyVerified, false);
  });

  it("includes verifiedAt ISO string", async () => {
    const now = new Date("2024-01-01T12:00:00.000Z");
    const result = await verifyAddress(
      { components: sampleComponents },
      {
        postcodeValidator: alwaysValidPostcode,
        searchProvider: makeSearchProvider(),
        now: () => now,
      }
    );
    assert.equal(result.verifiedAt, now.toISOString());
  });

  it("includes candidates array (empty when no features)", async () => {
    const result = await verifyAddress(
      { components: sampleComponents },
      {
        postcodeValidator: alwaysValidPostcode,
        searchProvider: makeSearchProvider([]),
      }
    );
    assert.ok(Array.isArray(result.candidates));
  });

  it("strips extra whitespace from components", async () => {
    const result = await verifyAddress(
      { components: { ...sampleComponents, street: "  High   Street  " } },
      {
        postcodeValidator: alwaysValidPostcode,
        searchProvider: makeSearchProvider(),
      }
    );
    assert.equal(result.submittedAddress.street, "High Street");
  });

  it("lists missingComponents when required fields are absent", async () => {
    const result = await verifyAddress(
      { components: { ...sampleComponents, building: "", street: "" } },
      {
        postcodeValidator: alwaysValidPostcode,
        searchProvider: makeSearchProvider(),
      }
    );
    assert.ok(result.missingComponents.includes("building"));
    assert.ok(result.missingComponents.includes("street"));
  });
});
