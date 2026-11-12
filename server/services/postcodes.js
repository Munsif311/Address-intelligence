const API_BASE = "https://api.postcodes.io";
const CACHE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5000;
const cache = new Map();
const pending = new Map();

export class PostcodesApiError extends Error {
  constructor(message, status = 502, code = "UPSTREAM_ERROR") {
    super(message);
    this.name = "PostcodesApiError";
    this.status = status;
    this.code = code;
  }
}

export function normalizePostcode(value) {
  if (typeof value !== "string") return "";
  const compact = value.trim().replace(/\s+/g, "").toUpperCase();
  // UK postcodes are at least 5 chars compact (e.g. M11AE) and at most 7 (e.g. SW1A1AA)
  if (!compact || compact.length < 5 || compact.length > 7 || !/^[A-Z0-9]+$/.test(compact)) return "";
  return compact.length > 3
    ? `${compact.slice(0, -3)} ${compact.slice(-3)}`
    : compact;
}

let activeFetch = globalThis.fetch;

function resetCacheIfFetchChanged() {
  if (globalThis.fetch !== activeFetch) {
    cache.clear();
    pending.clear();
    activeFetch = globalThis.fetch;
  }
}

async function requestJson(path, { method = "GET", body } = {}) {
  resetCacheIfFetchChanged();
  const key = `${method}:${path}:${body ? JSON.stringify(body) : ""}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (pending.has(key)) return pending.get(key);

  const request = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        method,
        headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new PostcodesApiError("Postcodes.io returned an unreadable response.", 502, "INVALID_UPSTREAM_RESPONSE");
      }

      if (!response.ok && response.status !== 404) {
        throw new PostcodesApiError(
          payload?.error || "Postcodes.io could not complete the request.",
          502,
          "UPSTREAM_ERROR"
        );
      }
      if (payload?.status == null) {
        throw new PostcodesApiError("Postcodes.io returned an incomplete response.", 502, "INVALID_UPSTREAM_RESPONSE");
      }

      cache.set(key, { value: payload, expiresAt: Date.now() + CACHE_TTL_MS });
      return payload;
    } catch (error) {
      if (error instanceof PostcodesApiError) throw error;
      if (error?.name === "AbortError") {
        throw new PostcodesApiError("Postcodes.io timed out. Please try again.", 504, "UPSTREAM_TIMEOUT");
      }
      throw new PostcodesApiError("Postcodes.io is currently unavailable. Please try again shortly.", 502, "UPSTREAM_UNAVAILABLE");
    } finally {
      clearTimeout(timeout);
      pending.delete(key);
    }
  })();
  pending.set(key, request);
  return request;
}

function requirePostcode(value) {
  const postcode = normalizePostcode(value);
  if (!postcode) {
    const error = new Error("Enter a UK postcode using letters and numbers.");
    error.status = 400;
    error.code = "INVALID_INPUT";
    throw error;
  }
  return postcode;
}

export async function validatePostcode(value) {
  const postcode = requirePostcode(value);
  const payload = await requestJson(`/postcodes/${encodeURIComponent(postcode)}/validate`);
  return {
    submittedPostcode: value,
    normalizedPostcode: postcode,
    valid: payload.result === true,
    explanation: payload.result === true
      ? "Postcodes.io recognizes this as a valid UK postcode."
      : "Postcodes.io does not recognize this as a valid UK postcode."
  };
}

export async function lookupPostcode(value) {
  const validation = await validatePostcode(value);
  if (!validation.valid) {
    return {
      ...validation,
      status: "INVALID_POSTCODE",
      data: null,
      explanation: "This postcode is not valid according to Postcodes.io. Check the characters and spacing."
    };
  }

  const payload = await requestJson(`/postcodes/${encodeURIComponent(validation.normalizedPostcode)}`);
  if (!payload.result) {
    return {
      ...validation,
      status: "POSTCODE_NOT_FOUND",
      data: null,
      explanation: "The postcode format is valid, but Postcodes.io did not return a matching postcode record."
    };
  }

  const result = payload.result;
  return {
    ...validation,
    status: "VALID_POSTCODE",
    data: {
      postcode: result.postcode,
      country: result.country,
      region: result.region,
      parliamentaryConstituency: result.parliamentary_constituency,
      administrativeDistrict: result.admin_district,
      administrativeWard: result.admin_ward,
      latitude: result.latitude,
      longitude: result.longitude,
      codes: result.codes
    },
    propertyVerified: false,
    explanation: "The postcode is valid. Postcodes.io does not verify individual properties or delivery addresses."
  };
}

export async function findNearestPostcodes(value) {
  const postcode = requirePostcode(value);
  const validation = await validatePostcode(postcode);
  if (!validation.valid) {
    return { ...validation, status: "INVALID_POSTCODE", postcodes: [] };
  }

  const payload = await requestJson(`/postcodes/${encodeURIComponent(postcode)}/nearest`);
  return {
    ...validation,
    status: payload.result?.length ? "VALID_POSTCODE" : "POSTCODE_NOT_FOUND",
    postcodes: (payload.result || []).map((item) => ({
      postcode: item.postcode,
      country: item.country,
      district: item.admin_district,
      latitude: item.latitude,
      longitude: item.longitude,
      distance: item.distance
    }))
  };
}

export async function bulkLookupPostcodes(values) {
  if (!Array.isArray(values) || values.length === 0 || values.length > 100) {
    const error = new Error("Provide between 1 and 100 postcodes.");
    error.status = 400;
    error.code = "INVALID_INPUT";
    throw error;
  }
  const normalized = values.map((value) => normalizePostcode(value));
  const accepted = normalized.filter(Boolean);
  const unique = [...new Set(accepted)];

  let upstreamResults = [];
  if (unique.length) {
    const payload = await requestJson("/postcodes", {
      method: "POST",
      body: { postcodes: unique }
    });
    upstreamResults = payload.result || [];
  }

  const resultsByQuery = new Map(
    upstreamResults.map((item) => [normalizePostcode(item.query), item])
  );
  return values.map((submittedPostcode, index) => {
    const postcode = normalized[index];
    if (!postcode) {
      return {
        submittedPostcode,
        normalizedPostcode: null,
        status: "INVALID_POSTCODE",
        explanation: "This entry is empty or contains unsupported characters.",
        data: null
      };
    }
    const item = resultsByQuery.get(postcode);
    if (!item?.result) {
      return {
        submittedPostcode,
        normalizedPostcode: postcode,
        status: item?.error ? "INVALID_POSTCODE" : "POSTCODE_NOT_FOUND",
        explanation: item?.error || "Postcodes.io did not return a matching postcode record.",
        data: null
      };
    }
    return {
      submittedPostcode,
      normalizedPostcode: postcode,
      status: "VALID_POSTCODE",
      explanation: "The postcode is valid. This does not verify an individual property.",
      data: {
        postcode: item.result.postcode,
        country: item.result.country,
        region: item.result.region,
        district: item.result.admin_district
      }
    };
  });
}
