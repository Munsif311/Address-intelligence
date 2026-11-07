import test from "node:test";
import assert from "node:assert/strict";
import { normalizePostcode } from "../server/services/postcodes.js";
import { checkAddressCompleteness, parseAddressText } from "../server/services/address.js";

test("normalizes postcode case and spacing", () => {
  assert.equal(normalizePostcode("sw1a1aa"), "SW1A 1AA");
  assert.equal(normalizePostcode("  SW1A   1AA "), "SW1A 1AA");
  assert.equal(normalizePostcode("M11AE"), "M1 1AE");
});

test("rejects empty or unsafe postcode input before making a request", () => {
  assert.equal(normalizePostcode(""), "");
  assert.equal(normalizePostcode("SW1A/1AA"), "");
  assert.equal(normalizePostcode("12345678"), "");
});

test("parses a multiline address without asserting property verification", () => {
  const result = parseAddressText("12 Example Road\nLondon\nSW1A 1AA");
  assert.equal(result.components.building, "12");
  assert.equal(result.components.street, "Example Road");
  assert.equal(result.components.townCity, "London");
  assert.equal(result.components.postcode, "SW1A 1AA");
});

test("parses building and street from a single address line", () => {
  const result = parseAddressText("12 Example Road, London, SW1A 1AA");
  assert.equal(result.components.building, "12");
  assert.equal(result.components.street, "Example Road");
  assert.equal(result.components.townCity, "London");
});

test("parses a comma-separated address with a separate building number", () => {
  const result = parseAddressText("12, Example Road, London, Greater London, SW1A 1AA");
  assert.deepEqual(result.components, {
    building: "12",
    street: "Example Road",
    townCity: "London",
    county: "Greater London",
    postcode: "SW1A 1AA",
    country: ""
  });
});

test("parses an address without making up absent components", () => {
  const result = parseAddressText("The Old Mill, Mill Lane, Bristol, BS1 4ST");
  assert.deepEqual(result.components, {
    building: "The Old Mill",
    street: "Mill Lane",
    townCity: "Bristol",
    county: "",
    postcode: "BS1 4ST",
    country: ""
  });
});

test("parses labelled address details and omits recipient name from address components", () => {
  const result = parseAddressText("Recipient: Roberta Coats\nAddress: 2 BALMERINO ROAD\nTown: DUNDEE\nPostcode: DD4 8RN\nCountry: UNITED KINGDOM");
  assert.deepEqual(result.components, {
    building: "2",
    street: "BALMERINO ROAD",
    townCity: "DUNDEE",
    county: "",
    postcode: "DD4 8RN",
    country: "UNITED KINGDOM"
  });
  assert.equal(JSON.stringify(result.components).includes("Roberta"), false);
});

test("marks missing required fields while treating county as optional", () => {
  const incomplete = checkAddressCompleteness({ components: { building: "12", street: "", townCity: "London", county: "", postcode: "SW1A 1AA", country: "United Kingdom" } });
  assert.equal(incomplete.completenessStatus, "ADDRESS_INCOMPLETE");
  assert.deepEqual(incomplete.missingComponents, ["street"]);
  assert.deepEqual(incomplete.optionalMissingComponents, ["county"]);

  const complete = checkAddressCompleteness({ components: { building: "12", street: "Example Road", townCity: "London", county: "", postcode: "SW1A 1AA", country: "United Kingdom" } });
  assert.equal(complete.completenessStatus, "ADDRESS_COMPLETE");
  assert.match(complete.verificationLimitation, /can confirm that a specific house/i);
});
