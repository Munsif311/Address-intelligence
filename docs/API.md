# Data Direct Address Desk API

Base path: `/api/v1`. Requests and responses use JSON. Postcode fields are normalized to uppercase with standard spacing before querying Postcodes.io.

## `POST /postcode/validate`

Request:

```json
{ "postcode": "sw1a1aa" }
```

Response:

```json
{
  "submittedPostcode": "sw1a1aa",
  "normalizedPostcode": "SW1A 1AA",
  "valid": true,
  "explanation": "Postcodes.io recognizes this as a valid UK postcode."
}
```

## `POST /postcode/lookup`

Request: `{ "postcode": "SW1A 1AA" }`

Response includes `status` (`VALID_POSTCODE`, `INVALID_POSTCODE`, or `POSTCODE_NOT_FOUND`), `submittedPostcode`, `normalizedPostcode`, an explanation, and either postcode `data` or `null`. The successful data includes country, region, constituency, administrative district and ward, coordinates, and geographic `codes`. A successful result explicitly has `propertyVerified: false`.

## `POST /postcode/nearest`

Request: `{ "postcode": "SW1A 1AA" }`

Response includes a status and `postcodes`, ordered as returned by Postcodes.io. Each item can include postcode, country, district, coordinates, and distance.

## `POST /postcode/bulk-lookup`

Request:

```json
{ "postcodes": ["SW1A 1AA", "ZZ99 9ZZ"] }
```

Accepts 1–100 values. Response is `{ "results": [...] }`; each input has its own status, explanation, normalized value when available, and postcode data when found.

## `POST /address/check-completeness`

Either send structured components:

```json
{
  "originalAddress": "12 Example Road, London, SW1A 1AA",
  "components": {
    "building": "12",
    "street": "Example Road",
    "townCity": "London",
    "county": "",
    "postcode": "SW1A 1AA",
    "country": "United Kingdom"
  }
}
```

Or send a pasted address as `{ "address": "12 Example Road\nLondon\nSW1A 1AA" }`; the parser is best-effort and the returned components should be checked by the operator.

The response includes `components`, `missingComponents`, optional missing fields, `completenessStatus` (`ADDRESS_COMPLETE` or `ADDRESS_INCOMPLETE`), and `verificationLimitation`. If a postcode is present, `postcodeValidation` reports its API validation status. Address completeness does not verify property existence.

## `POST /address/parse`

Request: `{ "address": "12 Example Road\nLondon\nSW1A 1AA" }`

Returns the original text and best-effort parsed components. Parsing is a convenience for formatting an address already supplied by the operator; it does not search address records or infer missing components.

## `POST /address/verify`

Uses Postcodes.io to validate the postcode and, when configured, the backend-only `OS_NAMES_API_KEY` to search OS Names for a postcode and road/place names. OS Names uses the free OS Open Names data; its API key must never be sent by the client. A missing key does not prevent postcode validation.

Request:

```json
{
  "originalAddress": "2 BALMERINO ROAD, DUNDEE, DD4 8RN, UNITED KINGDOM",
  "components": {
    "building": "2",
    "street": "BALMERINO ROAD",
    "townCity": "DUNDEE",
    "county": "",
    "postcode": "DD4 8RN",
    "country": "UNITED KINGDOM"
  }
}
```

The response contains the address completeness result, a Postcodes.io `postcodeValidation`, and `addressVerification`. Address result statuses are `POSTCODE_MATCH`, `STREET_OR_LOCATION_MATCH`, `PARTIAL_MATCH`, `NO_MATCH`, `INCOMPLETE_INPUT`, `PROVIDER_NOT_CONFIGURED`, and `PROVIDER_ERROR`. A valid postcode remains useful when the optional OS Names key is absent. `addressVerification` contains source, `verifiedAt`, named-road/place candidates, per-component match flags, mismatches, and unverified components. Building, country, or other unsupported components remain unverified; they are not treated as matches. `propertyVerified` is always false for the free integration; `recipientVerified` is always false. A no-match result does not prove that the property exists.

OS Names supports searches for named places, roads, and postcodes, but not specific delivery addresses such as a house number. Recipient names are not sent to either provider. Provider failures are represented by `PROVIDER_ERROR` while preserving the postcode result when available.

## `GET /search-history` and `/analytics`

Search history contains only normalized postcode, result status, and timestamp. It is process-memory-only and bounded to 100 records; the endpoint returns up to 20. Analytics returns `totalSearches`, `validPostcodes`, `invalidPostcodes`, `incompleteAddresses`, and `apiErrors`. All data resets when the process restarts.

## Errors

Errors use a non-2xx response and the shape:

```json
{ "error": "Human-readable message", "code": "UPSTREAM_TIMEOUT" }
```

Malformed input returns HTTP 400. External service unavailability returns HTTP 502, and timeout returns HTTP 504. The API does not expose upstream stack traces or store submitted address components. Address provider authentication failures return `ADDRESS_PROVIDER_AUTH_ERROR` and require server-side configuration.
