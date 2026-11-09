import test from "node:test";
import assert from "node:assert/strict";
import { OsNamesProviderError, searchOsNames } from "../server/services/providers/osNames.js";
import { verifyAddress } from "../server/services/addressVerification.js";
import { parseAddressText } from "../server/services/address.js";

const sampleAddress = {
  components: {
    building: "2",
    street: "BALMERINO ROAD",
    townCity: "DUNDEE",
    postcode: "DD4 8RN",
    country: "UNITED KINGDOM"
  }
};

const osNamesResults = {
  results: [
    { GAZETTEER_ENTRY: { ID: "road-1", NAME1: "BALMERINO ROAD", TYPE: "Road", LOCAL_TYPE: "Named Road", POSTCODE_DISTRICT: "DD4", POPULATED_PLACE: "Dundee", COUNTRY: "Scotland" } },
    { GAZETTEER_ENTRY: { ID: "town-1", NAME1: "DUNDEE", TYPE: "Settlement", LOCAL_TYPE: "City", POSTCODE_DISTRICT: "DD4", POPULATED_PLACE: "Dundee", COUNTRY: "Scotland" } }
  ]
};


test("does not send or verify recipient identity", async () => {
  const parsed = parseAddressText("Roberta Coats\n2 BALMERINO ROAD\nDUNDEE\nDD4 8RN\nUNITED KINGDOM");
  const result = await verifyAddress({
    originalAddress: parsed.original,
    components: parsed.components
  }, {
    postcodeValidator: async (postcode) => ({
      valid: postcode === "DD4 8RN",
      normalizedPostcode: postcode,
      explanation: "Postcode validated."
    }),
    searchProvider: async (components) => {
      assert.equal("recipientName" in components, false);
      return {
        configured: true,
        features: [
          { id: "road-1", name: "BALMERINO ROAD", type: "Road", localType: "Named Road", postcodeDistrict: "DD4", populatedPlace: "Dundee", country: "Scotland" },
          { id: "town-1", name: "DUNDEE", type: "Settlement", localType: "City", postcodeDistrict: "DD4", populatedPlace: "Dundee", country: "Scotland" }
        ]
      };
    }
  });
  assert.equal(result.status, "STREET_OR_LOCATION_MATCH");
  assert.equal(result.propertyVerified, false);
  assert.equal(result.recipientVerified, false);
  assert.equal(result.recommendation, "Confirm the complete delivery address against the customer's order. Free postcode and place-name data cannot verify an individual property.");
  assert.equal(JSON.stringify(result.submittedAddress).includes("Roberta"), false);
});

test("searches OS Names by postcode and road/place using the documented query key", async () => {
  const requestUrls = [];
  const result = await searchOsNames(sampleAddress.components, {
    apiKey: "test-key",
    fetchImpl: async (url) => {
      requestUrls.push(new URL(url));
      return { ok: true, json: async () => osNamesResults };
    }
  });

  assert.deepEqual(requestUrls.map((url) => url.searchParams.get("query")), [
    "DD4 8RN",
    "BALMERINO ROAD, DUNDEE"
  ]);
  assert.equal(requestUrls[0].searchParams.get("key"), "test-key");
  assert.equal(requestUrls[0].searchParams.get("format"), "JSON");
  assert.equal(result.features[0].name, "BALMERINO ROAD");
  assert.equal(result.configured, true);
});

test("reports missing and invalid OS Names credentials without leaking provider details", async () => {
  const missing = await searchOsNames(sampleAddress.components, { apiKey: "" });
  assert.equal(missing.status, "PROVIDER_NOT_CONFIGURED");
  assert.equal(missing.configured, false);

  await assert.rejects(
    searchOsNames(sampleAddress.components, {
      apiKey: "bad-key",
      fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ message: "private provider detail" }) })
    }),
    (error) => error instanceof OsNamesProviderError
      && error.code === "PROVIDER_AUTH_ERROR"
      && !error.message.includes("private provider detail")
  );
});

test("times out an OS Names search explicitly", async () => {
  await assert.rejects(
    searchOsNames(sampleAddress.components, {
      apiKey: "test-key",
      timeoutMs: 5,
      fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      })
    }),
    (error) => error.code === "PROVIDER_TIMEOUT" && error.status === 504
  );
});

test("classifies a valid postcode with a wrong street as a partial match", async () => {
  const result = await verifyAddress({
    components: { ...sampleAddress.components, street: "INCORRECT STREET" }
  }, {
    postcodeValidator: async () => ({
      valid: true,
      normalizedPostcode: "DD4 8RN",
      explanation: "Postcode is valid."
    }),
    searchProvider: async () => ({ configured: true, features: osNamesResults.results.map((item) => item.GAZETTEER_ENTRY).map((feature) => ({
      id: feature.ID,
      name: feature.NAME1,
      type: feature.TYPE,
      localType: feature.LOCAL_TYPE,
      postcodeDistrict: feature.POSTCODE_DISTRICT,
      populatedPlace: feature.POPULATED_PLACE,
      country: feature.COUNTRY
    })) })
  });

  assert.equal(result.status, "PARTIAL_MATCH");
  assert.equal(result.componentMatches.postcode, true);
  assert.equal(result.componentMatches.street, false);
  assert.equal(result.componentMatches.townCity, true);
  assert.equal(result.componentMatches.country, true);
  assert.equal(result.propertyVerified, false);
});

test("keeps a valid postcode result when OS Names is not configured", async () => {
  const result = await verifyAddress(sampleAddress, {
    postcodeValidator: async () => ({
      valid: true,
      normalizedPostcode: "DD4 8RN",
      explanation: "Postcode is valid."
    }),
    providerOptions: { apiKey: "" }
  });
  assert.equal(result.status, "POSTCODE_MATCH");
  assert.equal(result.providerStatus, "PROVIDER_NOT_CONFIGURED");
  assert.equal(result.componentMatches.building, null);
  assert.equal(result.propertyVerified, false);
});

test("returns incomplete, invalid-postcode, and provider-error outcomes explicitly", async () => {
  const incomplete = await verifyAddress({ components: { street: "Example Road" } });
  assert.equal(incomplete.status, "INCOMPLETE_INPUT");

  const invalid = await verifyAddress(sampleAddress, {
    postcodeValidator: async () => ({
      valid: false,
      normalizedPostcode: "ZZ99 9ZZ",
      explanation: "Postcode not recognized."
    }),
    searchProvider: async () => assert.fail("OS Names should not run for an invalid postcode")
  });
  assert.equal(invalid.status, "NO_MATCH");
  assert.equal(invalid.postcodeValidation.status, "INVALID_POSTCODE");

  const failed = await verifyAddress(sampleAddress, {
    postcodeValidator: async () => ({
      valid: true,
      normalizedPostcode: "DD4 8RN",
      explanation: "Postcode is valid."
    }),
    searchProvider: async () => {
      throw new OsNamesProviderError("OS Names timed out.", 504, "PROVIDER_TIMEOUT");
    }
  });
  assert.equal(failed.status, "PROVIDER_ERROR");
  assert.equal(failed.providerError, "PROVIDER_TIMEOUT");
});

test("does not claim property verification for an incomplete address", async () => {
  const result = await verifyAddress({
    components: { street: "BALMERINO ROAD", townCity: "DUNDEE", postcode: "DD4 8RN" }
  }, {
    postcodeValidator: async () => ({
      valid: true,
      normalizedPostcode: "DD4 8RN",
      explanation: "Postcode is valid."
    }),
    searchProvider: async () => ({
      configured: true,
      features: [{
        name: "BALMERINO ROAD",
        type: "Road",
        localType: "Named Road",
        postcodeDistrict: "DD4",
        populatedPlace: "Dundee"
      }]
    })
  });
  assert.equal(result.status, "STREET_OR_LOCATION_MATCH");
  assert.equal(result.missingComponents.includes("building"), true);
  assert.equal(result.propertyVerified, false);
});
