import { validatePostcode } from "./postcodes.js";
import { OsNamesProviderError, searchOsNames } from "./providers/osNames.js";

const ADDRESS_FIELDS = ["building", "street", "townCity", "county", "postcode", "country"];
const REQUIRED_ADDRESS_COMPONENTS = ["building", "street", "townCity", "postcode", "country"];

function normalized(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function postcodeDistrict(postcode) {
  return normalized(postcode).replace(/\d[A-Z]{2}$/, "");
}

function isRoad(feature) {
  return /road|named|numbered|street/i.test(`${feature.type} ${feature.localType}`);
}

function isSettlement(feature) {
  return /town|city|village|hamlet|settlement|populated/i.test(`${feature.type} ${feature.localType}`);
}

function countriesMatch(submitted, providerCountry) {
  const expected = normalized(submitted);
  const actual = normalized(providerCountry);
  if (!expected || !actual) return false;
  const ukNames = new Set(["UNITEDKINGDOM", "UK", "GREATBRITAIN", "GB", "ENGLAND", "SCOTLAND", "WALES", "NORTHERNIRELAND"]);
  return expected === actual || (ukNames.has(expected) && ukNames.has(actual));
}

function compareFeatures(components, features, postcodeValidation) {
  const submittedStreet = normalized(components.street);
  const submittedTown = normalized(components.townCity);
  const submittedDistrict = postcodeDistrict(components.postcode);
  const roads = features.filter(isRoad);
  const settlements = features.filter(isSettlement);
  const countryFeatures = features.filter((feature) => feature.country);
  const countyFeatures = features.filter((feature) => feature.county);
  const streetMatched = Boolean(submittedStreet && roads.some((feature) => {
    const sameStreet = normalized(feature.name) === submittedStreet;
    const sameDistrict = normalized(feature.postcodeDistrict) === submittedDistrict;
    const sameTown = normalized(feature.populatedPlace) === submittedTown;
    return sameStreet && (sameDistrict || sameTown);
  }));
  const townMatched = Boolean(submittedTown && settlements.some((feature) =>
    normalized(feature.name) === submittedTown
    || normalized(feature.populatedPlace) === submittedTown
  ));
  const postcodeMatched = postcodeValidation.valid === true;
  const componentMatches = {
    building: null,
    street: submittedStreet && roads.length ? streetMatched : null,
    townCity: submittedTown && settlements.length ? townMatched : null,
    postcode: postcodeValidation.valid == null ? null : postcodeMatched,
    county: components.county && countyFeatures.length
      ? countyFeatures.some((feature) => normalized(feature.county) === normalized(components.county))
      : null,
    country: components.country && countryFeatures.length
      ? countryFeatures.some((feature) => countriesMatch(components.country, feature.country))
      : null
  };
  return {
    componentMatches,
    streetMatched,
    townMatched,
    hasRoadResults: roads.length > 0,
    hasSettlementResults: settlements.length > 0,
    hasLocationResults: roads.length > 0 || settlements.length > 0
  };
}

function postcodeResult(input, validator) {
  if (!input) {
    return Promise.resolve({
      status: "NOT_PROVIDED",
      valid: null,
      normalizedPostcode: "",
      explanation: "A postcode is needed for postcode validation."
    });
  }
  return Promise.resolve().then(() => validator(input)).catch((error) => {
    if (error.status === 400) {
      return {
        status: "INVALID_POSTCODE",
        valid: false,
        normalizedPostcode: "",
        explanation: error.message
      };
    }
    return {
      status: "PROVIDER_ERROR",
      valid: null,
      normalizedPostcode: "",
      explanation: "Postcodes.io could not validate the postcode. Please try again."
    };
  }).then((validation) => ({
    status: validation.status || (validation.valid ? "VALID_POSTCODE" : "INVALID_POSTCODE"),
    valid: validation.valid,
    normalizedPostcode: validation.normalizedPostcode,
    explanation: validation.explanation
  }));
}

export async function verifyAddress(input, {
  searchProvider = searchOsNames,
  postcodeValidator = validatePostcode,
  providerOptions,
  now = () => new Date()
} = {}) {
  const components = Object.fromEntries(
    ADDRESS_FIELDS.map((field) => [
      field,
      typeof input?.components?.[field] === "string"
        ? input.components[field].trim().replace(/\s+/g, " ")
        : ""
    ])
  );
  const missingComponents = REQUIRED_ADDRESS_COMPONENTS.filter((field) => !components[field]);
  const common = {
    submittedAddress: components,
    recipientVerified: false,
    propertyVerified: false,
    missingComponents,
    componentMatches: {
      building: null,
      street: null,
      townCity: null,
      postcode: null,
      county: null,
      country: null
    },
    candidates: [],
    verifiedAt: now().toISOString()
  };

  const postcodeValidation = await postcodeResult(components.postcode, postcodeValidator);
  if (!components.postcode) {
    return {
      ...common,
      status: "INCOMPLETE_INPUT",
      provider: "Postcodes.io; OS Names API",
      source: "Postcodes.io; Ordnance Survey OS Open Names",
      postcodeValidation,
      providerStatus: "NOT_SEARCHED",
      explanation: "Enter a postcode to validate it. Add a street or town for a location search.",
      recommendation: "Check the postcode and address against the customer's order details."
    };
  }

  // Guard: postcode validator returned PROVIDER_ERROR (valid may be null or false)
  if (postcodeValidation.status === "PROVIDER_ERROR") {
    return {
      ...common,
      status: "PROVIDER_ERROR",
      provider: "Postcodes.io",
      source: "Postcodes.io",
      postcodeValidation,
      providerStatus: "PROVIDER_ERROR",
      explanation: postcodeValidation.explanation,
      recommendation: "Retry the postcode check before processing the delivery."
    };
  }
  // Guard: valid===null means the validator could not determine validity — stop here
  if (postcodeValidation.valid == null) {
    return {
      ...common,
      status: "PROVIDER_ERROR",
      provider: "Postcodes.io",
      source: "Postcodes.io",
      postcodeValidation,
      providerStatus: "PROVIDER_ERROR",
      explanation: "Postcode validation returned an indeterminate result. Please try again.",
      recommendation: "Retry the postcode check before processing the delivery."
    };
  }
  if (postcodeValidation.valid === false) {
    return {
      ...common,
      status: "NO_MATCH",
      provider: "Postcodes.io",
      source: "Postcodes.io",
      postcodeValidation,
      providerStatus: "NOT_SEARCHED",
      componentMatches: { ...common.componentMatches, postcode: false },
      mismatchedComponents: ["postcode"],
      unverifiedComponents: ADDRESS_FIELDS.filter((field) => field !== "postcode"),
      explanation: "Postcodes.io does not recognize this as a valid UK postcode, so location matching was not run.",
      recommendation: "Check the postcode for typing errors. The submitted building and street have not been verified."
    };
  }

  let names;
  try {
    names = await searchProvider(components, providerOptions);
  } catch (error) {
    const providerError = error instanceof OsNamesProviderError
      ? error
      : new OsNamesProviderError("OS Names could not complete the location search.");
    return {
      ...common,
      status: "PROVIDER_ERROR",
      provider: "Postcodes.io; OS Names API",
      source: "Postcodes.io; Ordnance Survey OS Open Names",
      postcodeValidation,
      providerStatus: "PROVIDER_ERROR",
      providerError: providerError.code,
      componentMatches: { ...common.componentMatches, postcode: true },
      mismatchedComponents: [],
      unverifiedComponents: ADDRESS_FIELDS.filter((field) => field !== "postcode"),
      explanation: `${providerError.message} The postcode is valid, but the road and place search could not be completed.`,
      recommendation: "Retry the location search. Confirm the building and street against the customer's order details."
    };
  }

  const features = names.features || [];
  const comparison = compareFeatures(components, features, postcodeValidation);
  const mismatchedComponents = Object.entries(comparison.componentMatches)
    .filter(([, matched]) => matched === false)
    .map(([field]) => field);
  const unverifiedComponents = Object.entries(comparison.componentMatches)
    .filter(([, matched]) => matched == null)
    .map(([field]) => field);
  const status = !names.configured
    ? "POSTCODE_MATCH"
    : comparison.streetMatched
      ? "STREET_OR_LOCATION_MATCH"
      : comparison.townMatched && !components.street
        ? "STREET_OR_LOCATION_MATCH"
        : comparison.hasLocationResults
          ? "PARTIAL_MATCH"
          : "POSTCODE_MATCH";
  const locationExplanation = status === "STREET_OR_LOCATION_MATCH"
    ? "The postcode is valid and OS Names found a matching road or place. The building or flat is not verified."
    : status === "PARTIAL_MATCH"
      ? "The postcode is valid, but OS Names results did not confirm every submitted street or town component. Review the differences."
      : !names.configured
        ? "The postcode is valid. OS Names location search is not configured, and the building or street has not been verified."
        : "The postcode is valid. OS Names found no matching road or place; this does not prove that the property does not exist.";

  return {
    ...common,
    status,
    provider: names.configured ? "Postcodes.io; OS Names API" : "Postcodes.io",
    source: names.configured ? "Postcodes.io; Ordnance Survey OS Open Names" : "Postcodes.io",
    postcodeValidation,
    providerStatus: names.configured ? "READY" : names.status,
    componentMatches: comparison.componentMatches,
    mismatchedComponents,
    unverifiedComponents,
    candidates: features.slice(0, 5).map((feature) => ({
      ...feature,
      componentMatches: {
        street: components.street ? normalized(feature.name) === normalized(components.street) : null,
        townCity: components.townCity
          ? normalized(feature.name) === normalized(components.townCity)
            || normalized(feature.populatedPlace) === normalized(components.townCity)
          : null,
        county: components.county && feature.county ? normalized(components.county) === normalized(feature.county) : null,
        country: components.country && feature.country ? countriesMatch(components.country, feature.country) : null
      }
    })),
    propertyVerified: false,
    recipientVerified: false,
    explanation: locationExplanation,
    recommendation: "Confirm the complete delivery address against the customer's order. Free postcode and place-name data cannot verify an individual property."
  };
}
