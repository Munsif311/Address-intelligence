import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  bulkLookupPostcodes,
  findNearestPostcodes,
  lookupPostcode,
  normalizePostcode,
  validatePostcode
} from "./services/postcodes.js";
import { checkAddressCompleteness, parseAddressText } from "./services/address.js";
import { verifyAddress } from "./services/addressVerification.js";

const app = express();
const history = [];
const analytics = {
  totalSearches: 0,
  validPostcodes: 0,
  invalidPostcodes: 0,
  incompleteAddresses: 0,
  apiErrors: 0
};
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));

function recordPostcode(result) {
  analytics.totalSearches += 1;
  if (result.status === "VALID_POSTCODE") analytics.validPostcodes += 1;
  if (result.status === "INVALID_POSTCODE" || result.status === "POSTCODE_NOT_FOUND") analytics.invalidPostcodes += 1;
  if (result.status === "API_ERROR") analytics.apiErrors += 1;
  if (result.normalizedPostcode) {
    history.unshift({
      postcode: result.normalizedPostcode,
      status: result.status,
      searchedAt: new Date().toISOString()
    });
    history.splice(100);
  }
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

app.get("/api/v1/health", (_req, res) => res.json({ status: "ok" }));

app.post("/api/v1/postcode/validate", asyncRoute(async (req, res) => {
  const result = await validatePostcode(req.body?.postcode);
  recordPostcode({ ...result, status: result.valid ? "VALID_POSTCODE" : "INVALID_POSTCODE" });
  res.json(result);
}));

app.post("/api/v1/postcode/lookup", asyncRoute(async (req, res) => {
  const result = await lookupPostcode(req.body?.postcode);
  recordPostcode(result);
  res.json(result);
}));

app.post("/api/v1/postcode/nearest", asyncRoute(async (req, res) => {
  const result = await findNearestPostcodes(req.body?.postcode);
  recordPostcode(result);
  res.json(result);
}));

app.post("/api/v1/postcode/bulk-lookup", asyncRoute(async (req, res) => {
  const results = await bulkLookupPostcodes(req.body?.postcodes);
  analytics.totalSearches += results.length;
  for (const result of results) {
    if (result.status === "VALID_POSTCODE") analytics.validPostcodes += 1;
    else analytics.invalidPostcodes += 1;
    if (result.normalizedPostcode) {
      history.unshift({
        postcode: result.normalizedPostcode,
        status: result.status,
        searchedAt: new Date().toISOString()
      });
    }
  }
  history.splice(100);
  res.json({ results });
}));

app.post("/api/v1/address/check-completeness", asyncRoute(async (req, res) => {
  const result = checkAddressCompleteness(req.body);
  if (!result.complete) analytics.incompleteAddresses += 1;
  if (result.components.postcode) {
    try {
      const validation = await validatePostcode(result.components.postcode);
      result.postcodeValidation = {
        status: validation.valid ? "VALID_POSTCODE" : "INVALID_POSTCODE",
        valid: validation.valid,
        normalizedPostcode: validation.normalizedPostcode,
        explanation: validation.explanation
      };
    } catch (error) {
      if (error.status === 400) {
        result.postcodeValidation = {
          status: "INVALID_POSTCODE",
          valid: false,
          normalizedPostcode: normalizePostcode(result.components.postcode),
          explanation: error.message
        };
      } else {
        throw error;
      }
    }
  } else {
    result.postcodeValidation = {
      status: "NOT_PROVIDED",
      valid: null,
      explanation: "No postcode was provided to validate."
    };
  }
  result.propertyVerified = false;
  result.completenessStatus = result.complete ? "ADDRESS_COMPLETE" : "ADDRESS_INCOMPLETE";
  res.json(result);
}));

app.post("/api/v1/address/parse", (req, res) => {
  if (typeof req.body?.address !== "string" || !req.body.address.trim()) {
    return res.status(400).json({
      error: "Paste a full address before parsing.",
      code: "INVALID_INPUT"
    });
  }
  res.json(parseAddressText(req.body.address));
});

app.post("/api/v1/address/verify", asyncRoute(async (req, res) => {
  const result = await verifyAddress(req.body);
  const completeness = checkAddressCompleteness({
    originalAddress: req.body?.originalAddress,
    components: req.body?.components
  });
  if (!completeness.complete) analytics.incompleteAddresses += 1;
  // apiErrors is counted once by the global error handler for 5xx responses.
  // Provider errors returned as 200-with-status are tracked via addressVerification.status.
  res.json({
    ...completeness,
    postcodeValidation: result.postcodeValidation,
    addressVerification: result,
    propertyVerified: result.propertyVerified,
    recipientVerified: false
  });
}));

app.get("/api/v1/search-history", (_req, res) => res.json({ history: history.slice(0, 20) }));
app.get("/api/v1/analytics", (_req, res) => res.json({ ...analytics }));

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "API endpoint not found.", code: "NOT_FOUND" });
});

const distPath = path.resolve(__dirname, "../dist");
app.use(express.static(distPath));
app.get("*", (_req, res, next) => {
  res.sendFile(path.join(distPath, "index.html"), (error) => {
    if (error) next();
  });
});

app.use((error, _req, res, _next) => {
  const status = Number(error.status) || 500;
  if (status >= 500) analytics.apiErrors += 1;
  res.status(status).json({
    error: error.message,
    code: error.code || (status >= 500 ? "API_ERROR" : "INVALID_INPUT")
  });
});

export default app;
export { app };
