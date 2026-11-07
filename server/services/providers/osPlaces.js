const OS_PLACES_URL = "https://api.os.uk/search/places/v1/find";
const REQUEST_TIMEOUT_MS = 8000;

export class AddressProviderError extends Error {
  constructor(message, status = 502, code = "ADDRESS_PROVIDER_ERROR") {
    super(message);
    this.name = "AddressProviderError";
    this.status = status;
    this.code = code;
  }
}

function normalized(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function makeSearchComponents(input) {
  const components = {
    building: String(input?.building || "").trim().replace(/\s+/g, " "),
    street: String(input?.street || "").trim().replace(/\s+/g, " "),
    townCity: String(input?.townCity || "").trim().replace(/\s+/g, " "),
    postcode: String(input?.postcode || "").trim().replace(/\s+/g, " ").toUpperCase(),
    country: String(input?.country || "").trim().replace(/\s+/g, " ")
  };
  if (!components.street) {
    const splitBuilding = components.building.match(/^(\d+[A-Z]?(?:[-/]\d+[A-Z]?)?)\s+(.+)$/i);
    if (splitBuilding) {
      components.building = splitBuilding[1];
      components.street = splitBuilding[2];
    }
  }
  return components;
}

function getAddressRecord(result) {
  const record = result?.DPA || result?.LPI;
  if (!record) return null;
  if (result.DPA) {
    return {
      uprn: record.UPRN || "",
      address: record.ADDRESS || "",
      building: [
        record.SUB_BUILDING_NAME,
        record.BUILDING_NAME,
        record.BUILDING_NUMBER
      ].filter(Boolean).join(" "),
      buildingNumber: record.BUILDING_NUMBER || "",
      buildingName: record.BUILDING_NAME || "",
      subBuildingName: record.SUB_BUILDING_NAME || "",
      street: [record.DEPENDENT_THOROUGHFARE_NAME, record.THOROUGHFARE_NAME].filter(Boolean).join(", "),
      townCity: record.POST_TOWN || "",
      postcode: record.POSTCODE || "",
      country: record.COUNTRY_CODE_DESCRIPTION || record.COUNTRY_CODE || "",
      matchScore: record.MATCH ?? null,
      matchDescription: record.MATCH_DESCRIPTION || ""
    };
  }
  return {
    uprn: record.UPRN || "",
    address: record.ADDRESS || "",
    building: [record.SAO_TEXT, record.PAO_TEXT].filter(Boolean).join(" "),
    buildingNumber: [record.SAO_START_NUMBER, record.PAO_START_NUMBER].filter(Boolean).join(" "),
    buildingName: [record.ORGANISATION, record.PAO_TEXT].filter(Boolean).join(" "),
    subBuildingName: record.SAO_TEXT || "",
    street: record.STREET_DESCRIPTION || "",
    townCity: record.TOWN_NAME || "",
    postcode: record.POSTCODE_LOCATOR || "",
    country: record.COUNTRY_CODE_DESCRIPTION || record.COUNTRY_CODE || "",
    matchScore: record.MATCH ?? null,
    matchDescription: record.MATCH_DESCRIPTION || ""
  };
}

function countryMatches(inputCountry, recordCountry) {
  const input = normalized(inputCountry);
  const record = normalized(recordCountry);
  if (!input || !record) return false;
  const ukNames = new Set(["UNITEDKINGDOM", "UK", "GREATBRITAIN", "GB", "ENGLAND", "SCOTLAND", "WALES", "NORTHERNIRELAND"]);
  return input === record || (ukNames.has(input) && ukNames.has(record));
}

function compareRecord(components, record) {
  const expectedBuilding = normalized(components.building);
  const candidateBuildings = [
    record.building,
    record.buildingNumber,
    record.buildingName,
    record.subBuildingName,
    [record.buildingNumber, record.street].filter(Boolean).join(" ")
  ].map(normalized).filter(Boolean);
  const candidateStreets = [
    record.street,
    ...String(record.street || "").split(",")
  ].map(normalized).filter(Boolean);
  const matches = {
    building: candidateBuildings.includes(expectedBuilding),
    street: candidateStreets.includes(normalized(components.street)),
    townCity: normalized(components.townCity) === normalized(record.townCity),
    postcode: normalized(components.postcode) === normalized(record.postcode),
    country: countryMatches(components.country, record.country)
  };
  const matchedCount = Object.values(matches).filter(Boolean).length;
  return { matches, matchedCount };
}

function classifyRecords(components, records) {
  if (!records.length) {
    return {
      status: "NO_MATCH",
      explanation: "The address provider returned no matching address records. This does not establish that the property does not exist."
    };
  }

  const compared = records.map((record) => ({ record, ...compareRecord(components, record) }));
  compared.sort((a, b) => b.matchedCount - a.matchedCount || (b.record.matchScore || 0) - (a.record.matchScore || 0));
  const exact = compared.find((entry) => Object.values(entry.matches).every(Boolean));
  if (exact) {
    return {
      status: "EXACT_MATCH",
      explanation: "The address provider returned a record matching all submitted address components."
    };
  }

  const best = compared[0];
  if (best.matches.postcode && best.matchedCount >= 3) {
    return {
      status: "PARTIAL_MATCH",
      explanation: "A provider record matches some submitted address components, but at least one component differs. Review the differences."
    };
  }
  return {
    status: "ALTERNATIVE_MATCH",
    explanation: "The provider returned possible alternative address records. None exactly match all submitted components."
  };
}

export async function searchOsPlaces(input, {
  apiKey = process.env.OS_PLACES_API_KEY,
  fetchImpl = globalThis.fetch,
  now = () => new Date()
} = {}) {
  const verifiedAt = now().toISOString();
  if (!apiKey) {
    return {
      provider: "OS Places API",
      source: "Ordnance Survey AddressBase Premium",
      verifiedAt,
      configured: false,
      status: "PROVIDER_NOT_CONFIGURED",
      explanation: "Address-level verification is not configured. Set OS_PLACES_API_KEY on the backend to enable OS Places searches.",
      candidates: []
    };
  }

  const components = makeSearchComponents(input);
  const query = [components.building, components.street, components.townCity, components.postcode]
    .filter(Boolean)
    .join(", ");
  const url = new URL(OS_PLACES_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("maxresults", "10");
  url.searchParams.set("dataset", "DPA");
  url.searchParams.set("key", apiKey);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new AddressProviderError("OS Places returned an unreadable response.", 502, "INVALID_PROVIDER_RESPONSE");
    }
    if (!response.ok) {
      const code = response.status === 401 || response.status === 403
        ? "ADDRESS_PROVIDER_AUTH_ERROR"
        : "ADDRESS_PROVIDER_ERROR";
      const status = response.status === 401 || response.status === 403 ? 503 : 502;
      throw new AddressProviderError(
        status === 503
          ? "OS Places could not authorize the request. Check the backend API key and project access."
          : "OS Places could not complete the address search.",
        status,
        code
      );
    }
    if (!Array.isArray(payload?.results)) {
      throw new AddressProviderError("OS Places returned an incomplete response.", 502, "INVALID_PROVIDER_RESPONSE");
    }

    const candidates = payload.results.map(getAddressRecord).filter(Boolean);
    const classification = classifyRecords(components, candidates);
    return {
      provider: "OS Places API",
      source: `Ordnance Survey OS Places API (${payload.header?.dataset || "DPA"})`,
      verifiedAt,
      configured: true,
      ...classification,
      propertyRecordMatched: classification.status === "EXACT_MATCH",
      recipientVerified: false,
      candidates: candidates.slice(0, 5).map((candidate) => ({
        ...candidate,
        componentMatches: compareRecord(components, candidate).matches
      }))
    };
  } catch (error) {
    if (error instanceof AddressProviderError) throw error;
    if (error?.name === "AbortError") {
      throw new AddressProviderError("OS Places timed out. Please try the address search again.", 504, "ADDRESS_PROVIDER_TIMEOUT");
    }
    throw new AddressProviderError("OS Places is unavailable. Please try the address search again.", 502, "ADDRESS_PROVIDER_UNAVAILABLE");
  } finally {
    clearTimeout(timeout);
  }
}
