const UK_POSTCODE_PATTERN = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;

export function parseAddressText(value) {
  const original = typeof value === "string" ? value.trim() : "";
  const allLines = original
    .split(/\r?\n|,/)
    .map((part) => part.trim().replace(/^[,;.\s]+|[,;.\s]+$/g, ""))
    .filter(Boolean);
  const countryNames = /^(?:country\s*:\s*)?(?:united kingdom|great britain|england|scotland|wales|northern ireland|uk|gb)$/i;
  const countryLine = allLines.find((line) => countryNames.test(line));
  const country = countryLine ? countryLine.replace(/^country\s*:\s*/i, "") : "";
  const lines = allLines
    .filter((line) => !countryNames.test(line) && !/^recipient\s*:/i.test(line))
    .map((line) => line.replace(/^(?:address(?:\s*line)?\s*[12]?|town(?:\/city)?|city|postcode|post\s*code)\s*:\s*/i, "").trim())
    .filter(Boolean);
  const postcodeMatch = original.match(/(?:postcode|post\s*code)\s*:\s*([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})/i)
    || original.match(UK_POSTCODE_PATTERN);
  const postcode = postcodeMatch?.[1]?.replace(/\s+/g, " ").toUpperCase() || "";
  const withoutPostcode = lines
    .map((line) => line.replace(UK_POSTCODE_PATTERN, "").trim())
    .filter(Boolean);
  if (
    withoutPostcode.length >= 3
    && !/^\d+[A-Z]?(?:[-/]\d+[A-Z]?)?\b/i.test(withoutPostcode[0])
    && /^\d+[A-Z]?(?:[-/]\d+[A-Z]?)?\s+/i.test(withoutPostcode[1])
  ) {
    withoutPostcode.shift();
  }

  const components = {
    building: "",
    street: "",
    townCity: "",
    county: "",
    postcode,
    country
  };

  if (withoutPostcode.length >= 4) {
    components.building = withoutPostcode[0];
    components.street = withoutPostcode[1];
    components.townCity = withoutPostcode[2];
    components.county = withoutPostcode.slice(3).join(", ");
  } else if (withoutPostcode.length === 3) {
    const buildingAndStreet = withoutPostcode[0].match(/^(\d+[A-Z]?(?:[-/]\d+[A-Z]?)?)\s+(.+)$/i);
    if (buildingAndStreet) {
      components.building = buildingAndStreet[1];
      components.street = buildingAndStreet[2];
      components.townCity = withoutPostcode[1];
      components.county = withoutPostcode.slice(2).join(", ");
    } else {
      components.building = withoutPostcode[0];
      components.street = withoutPostcode[1];
      components.townCity = withoutPostcode[2];
    }
  } else if (withoutPostcode.length === 2) {
    const buildingAndStreet = withoutPostcode[0].match(/^(\d+[A-Z]?(?:[-/]\d+[A-Z]?)?)\s+(.+)$/i);
    if (buildingAndStreet) {
      components.building = buildingAndStreet[1];
      components.street = buildingAndStreet[2];
      components.townCity = withoutPostcode[1];
    } else {
      components.building = withoutPostcode[0];
      components.street = withoutPostcode[1];
    }
  } else if (withoutPostcode.length === 1) {
    const first = withoutPostcode[0];
    const buildingAndStreet = first.match(/^(\d+[A-Z]?(?:[-/]\d+[A-Z]?)?)\s+(.+)$/i);
    if (buildingAndStreet) {
      components.building = buildingAndStreet[1];
      components.street = buildingAndStreet[2];
    } else {
      components.building = first;
    }
  }

  return { original, components };
}

export function checkAddressCompleteness(input) {
  const hasComponents = input && typeof input === "object" && input.components && typeof input.components === "object";
  const parsed = hasComponents
    ? {
        original: typeof input.originalAddress === "string" ? input.originalAddress.trim() : "",
        components: input.components
      }
    : parseAddressText(input?.address);

  const components = Object.fromEntries(
    ["building", "street", "townCity", "county", "postcode", "country"].map((key) => [
      key,
      typeof parsed.components[key] === "string" ? parsed.components[key].trim().replace(/\s+/g, " ") : ""
    ])
  );
  const required = ["building", "street", "townCity", "postcode", "country"];
  const missing = required.filter((key) => !components[key]);
  return {
    originalAddress: parsed.original || [
      components.building,
      components.street,
      components.townCity,
      components.county,
      components.postcode,
      components.country
    ].filter(Boolean).join(", "),
    components,
    missingComponents: missing,
    optionalMissingComponents: components.county ? [] : ["county"],
    complete: missing.length === 0,
    completenessStatus: missing.length ? "ADDRESS_INCOMPLETE" : "ADDRESS_COMPLETE",
    explanation: missing.length
      ? `Missing required information: ${missing.join(", ")}.`
      : "All required address components are present. This is a completeness check, not property verification.",
    verificationLimitation: "Postcodes.io validates postcodes, and OS Names can find named roads and places. Neither free source can confirm that a specific house, flat, or building exists."
  };
}
