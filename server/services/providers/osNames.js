const OS_NAMES_URL = "https://api.os.uk/search/names/v1/find";
const REQUEST_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();
const pending = new Map();

export class OsNamesProviderError extends Error {
  constructor(message, status = 502, code = "PROVIDER_ERROR") {
    super(message);
    this.name = "OsNamesProviderError";
    this.status = status;
    this.code = code;
  }
}

function getFeature(result) {
  const feature = result?.GAZETTEER_ENTRY;
  if (!feature) return null;
  return {
    id: feature.ID || "",
    name: feature.NAME1 || "",
    type: feature.TYPE || "",
    localType: feature.LOCAL_TYPE || "",
    postcodeDistrict: feature.POSTCODE_DISTRICT || "",
    populatedPlace: feature.POPULATED_PLACE || "",
    county: feature.COUNTY_UNITARY || "",
    region: feature.REGION || "",
    country: feature.COUNTRY || ""
  };
}

async function searchTerm(query, { apiKey, fetchImpl, timeoutMs }) {
  const cacheKey = query;
  const canCache = fetchImpl === globalThis.fetch;
  const cached = canCache ? cache.get(cacheKey) : null;
  if (cached && cached.expiresAt > Date.now()) return cached.features;
  if (canCache && pending.has(cacheKey)) return pending.get(cacheKey);

  const request = (async () => {
    const url = new URL(OS_NAMES_URL);
    url.searchParams.set("query", query);
    url.searchParams.set("format", "JSON");
    url.searchParams.set("maxresults", "10");
    url.searchParams.set("key", apiKey);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        headers: { Accept: "application/json" },
        signal: controller.signal
      });
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new OsNamesProviderError("OS Names returned an unreadable response.", 502, "INVALID_PROVIDER_RESPONSE");
      }
      if (!response.ok) {
        const unauthorized = response.status === 401 || response.status === 403;
        throw new OsNamesProviderError(
          unauthorized
            ? "OS Names could not authorize the request. Check the backend API key and project access."
            : "OS Names could not complete the location search.",
          unauthorized ? 503 : 502,
          unauthorized ? "PROVIDER_AUTH_ERROR" : "PROVIDER_ERROR"
        );
      }
      if (!Array.isArray(payload?.results)) {
        throw new OsNamesProviderError("OS Names returned an incomplete response.", 502, "INVALID_PROVIDER_RESPONSE");
      }

      const features = payload.results.map(getFeature).filter(Boolean);
      if (canCache) cache.set(cacheKey, { features, expiresAt: Date.now() + CACHE_TTL_MS });
      return features;
    } catch (error) {
      if (error instanceof OsNamesProviderError) throw error;
      if (error?.name === "AbortError") {
        throw new OsNamesProviderError("OS Names timed out. Please try the location search again.", 504, "PROVIDER_TIMEOUT");
      }
      throw new OsNamesProviderError("OS Names is unavailable. Please try the location search again.", 502, "PROVIDER_UNAVAILABLE");
    } finally {
      clearTimeout(timeout);
      if (canCache) pending.delete(cacheKey);
    }
  })();

  if (canCache) pending.set(cacheKey, request);
  return request;
}

export async function searchOsNames(input, {
  apiKey = process.env.OS_NAMES_API_KEY,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  timeoutMs = REQUEST_TIMEOUT_MS
} = {}) {
  const verifiedAt = now().toISOString();
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    return {
      provider: "OS Names API",
      source: "Ordnance Survey OS Open Names",
      configured: false,
      status: "PROVIDER_NOT_CONFIGURED",
      verifiedAt,
      explanation: "OS Names location search is not configured. Set OS_NAMES_API_KEY on the backend to enable free road and place searches.",
      features: []
    };
  }

  const postcode = String(input?.postcode || "").trim().replace(/\s+/g, " ");
  const streetAndTown = [input?.street, input?.townCity]
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => value.trim().replace(/\s+/g, " "))
    .join(", ");
  const queries = [...new Set([postcode, streetAndTown].filter(Boolean))];
  if (!queries.length) {
    return {
      provider: "OS Names API",
      source: "Ordnance Survey OS Open Names",
      configured: true,
      status: "NO_QUERY",
      verifiedAt,
      explanation: "Enter a postcode, street, or town to search OS Names.",
      features: []
    };
  }

  const featureGroups = await Promise.all(queries.map((query) =>
    searchTerm(query, { apiKey: apiKey.trim(), fetchImpl, timeoutMs })
  ));
  const features = [...new Map(
    featureGroups.flat().map((feature, index) => [feature.id || `${feature.name}-${index}`, feature])
  ).values()];

  return {
    provider: "OS Names API",
    source: "Ordnance Survey OS Open Names",
    configured: true,
    status: features.length ? "SEARCH_COMPLETE" : "NO_MATCH",
    verifiedAt,
    explanation: features.length
      ? "OS Names returned named roads or places for comparison. It does not contain individual property addresses."
      : "OS Names returned no named-road or place results for these search terms.",
    features
  };
}
