import { useCallback, useEffect, useRef, useState } from "react";

const API = "/api/v1";
const PROPERTY_VERIFICATION_MESSAGE = "Property not confirmed. Free postcode and place-name data do not include house-level records. Recipient identity and occupancy are not checked.";
const ADDRESS_RECOMMENDATION_MESSAGE = "Confirm the complete delivery address against the customer's order. Free postcode and place-name data cannot verify an individual property.";
const POSTCODE_PROPERTY_MESSAGE = "Postcodes.io validates postcodes, and OS Names can find named roads and places. Neither free source can confirm that a specific house, flat, or building exists.";
const STATUS_LABELS = {
  VALID_POSTCODE: "Valid postcode",
  INVALID_POSTCODE: "Invalid postcode",
  POSTCODE_NOT_FOUND: "Postcode not found",
  ADDRESS_INCOMPLETE: "Address incomplete",
  ADDRESS_COMPLETE: "Address complete",
  API_ERROR: "API error",
  POSTCODE_MATCH: "Postcode confirmed",
  STREET_OR_LOCATION_MATCH: "Street / location found",
  EXACT_MATCH: "Exact match found",
  PARTIAL_MATCH: "Partial match",
  ALTERNATIVE_MATCH: "Alternative address",
  NO_MATCH: "No match found",
  PROVIDER_NOT_CONFIGURED: "Provider not configured",
  PROVIDER_ERROR: "Provider unavailable",
  READY: "Available",
  NOT_SEARCHED: "Not searched",
  SEARCH_COMPLETE: "Checked",
  INCOMPLETE_INPUT: "Address details required"
};
const EMPTY_COMPONENTS = { building: "", street: "", townCity: "", county: "", postcode: "", country: "" };
const THEME_STORAGE_KEY = "data-direct-address-desk-theme";

function getSavedTheme() {
  try {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return ["light", "dark", "system"].includes(savedTheme) ? savedTheme : "system";
  } catch {
    return "system";
  }
}

async function readJsonResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  if (!contentType.toLowerCase().includes("application/json")) {
    const message = text.trim().slice(0, 240);
    throw new Error(message || "The server returned an unexpected response.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("The server returned an invalid JSON response.");
  }
}

async function postJson(path, body, signal) {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) throw new Error(payload?.error || "The request could not be completed.");
  return payload;
}

async function getJson(path, signal) {
  const response = await fetch(`${API}${path}`, { signal });
  const payload = await readJsonResponse(response);
  if (!response.ok) throw new Error(payload?.error || "The request could not be completed.");
  return payload;
}

function Icon({ name, size = 18 }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };
  const paths = {
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    pin: <><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
    check: <><path d="m5 12 4 4L19 6" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></>,
    arrow: <><path d="M7 17 17 7M7 7h10v10" /></>,
    close: <><path d="m18 6-12 12M6 6l12 12" /></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>,
    shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" /><path d="m9 12 2 2 4-4" /></>,
    monitor: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function StatusBadge({ status }) {
  const type = status === "VALID_POSTCODE" || status === "ADDRESS_COMPLETE" || status === "POSTCODE_MATCH" ? "success"
    : status === "API_ERROR" || status === "PROVIDER_ERROR" ? "error"
      : status === "ADDRESS_INCOMPLETE" || status === "STREET_OR_LOCATION_MATCH" || status === "PARTIAL_MATCH" || status === "ALTERNATIVE_MATCH" || status === "NO_MATCH" || status === "PROVIDER_NOT_CONFIGURED" || status === "INCOMPLETE_INPUT" ? "warning" : "neutral";
  return <span className={`badge badge-${type}`}><span className="badge-dot" />{STATUS_LABELS[status] || status}</span>;
}

function MetricCard({ title, value, icon, tone, subtitle }) {
  return <div className="metric-card">
    <div className={`metric-icon ${tone}`}><Icon name={icon} size={19} /></div>
    <div className="metric-label">{title}</div>
    <div className="metric-value">{value}</div>
    <div className="metric-subtitle">{subtitle}</div>
  </div>;
}

function Field({ label, value, onChange, placeholder }) {
  return <label className="field">
    <span>{label}</span>
    <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
  </label>;
}

function ResultNotice({ status, children }) {
  const variant = status === "VALID_POSTCODE" || status === "ADDRESS_COMPLETE" || status === "POSTCODE_MATCH" ? "notice-success"
    : status === "API_ERROR" || status === "PROVIDER_ERROR" ? "notice-error"
      : "notice-warning";
  return <div className={`result-notice ${variant}`}>
    <div className="notice-check"><Icon name={status === "VALID_POSTCODE" ? "check" : "shield"} size={17} /></div>
    <div><strong>{STATUS_LABELS[status] || status}</strong><p>{children}</p></div>
  </div>;
}

function DataRow({ label, value }) {
  return <div className="data-row"><span>{label}</span><strong>{value == null || value === "" ? "—" : value}</strong></div>;
}

export default function App() {
  const [postcode, setPostcode] = useState("");
  const [lookup, setLookup] = useState(null);
  const [nearest, setNearest] = useState(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [nearestLoading, setNearestLoading] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [bulkInput, setBulkInput] = useState("");
  const [bulkResults, setBulkResults] = useState(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [addressText, setAddressText] = useState("");
  const [components, setComponents] = useState(EMPTY_COMPONENTS);
  const [addressResult, setAddressResult] = useState(null);
  const [addressLoading, setAddressLoading] = useState(false);
  const [parseLoading, setParseLoading] = useState(false);
  const [parseError, setParseError] = useState("");
  const [activeTab, setActiveTab] = useState("postcode");
  const [analytics, setAnalytics] = useState({ totalSearches: 0, validPostcodes: 0, invalidPostcodes: 0, incompleteAddresses: 0, apiErrors: 0 });
  const [history, setHistory] = useState([]);
  const [dashboardError, setDashboardError] = useState("");
  const [toast, setToast] = useState("");
  const [themeMode, setThemeMode] = useState(getSavedTheme);
  const lookupController = useRef(null);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const resolvedTheme = themeMode === "system"
        ? (media.matches ? "dark" : "light")
        : themeMode;
      document.documentElement.dataset.theme = resolvedTheme;
    };
    const handleSystemThemeChange = () => {
      if (themeMode === "system") applyTheme();
    };
    applyTheme();
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    } catch {
      // Theme still applies for this session when storage is unavailable.
    }
    media.addEventListener("change", handleSystemThemeChange);
    return () => media.removeEventListener("change", handleSystemThemeChange);
  }, [themeMode]);

  const refreshDashboard = useCallback(async () => {
    try {
      const [metrics, recent] = await Promise.all([
        getJson("/analytics"),
        getJson("/search-history")
      ]);
      setAnalytics(metrics);
      setHistory(recent.history || []);
      setDashboardError("");
    } catch (error) {
      setDashboardError(`Dashboard summary unavailable: ${error.message}`);
    }
  }, []);

  useEffect(() => { refreshDashboard(); }, [refreshDashboard]);

  const handleLookup = async (event) => {
    event?.preventDefault();
    if (!postcode.trim()) {
      setLookupError("Enter a postcode to get started.");
      return;
    }
    lookupController.current?.abort();
    const controller = new AbortController();
    lookupController.current = controller;
    setLookupLoading(true);
    setLookupError("");
    setLookup(null);
    setNearest(null);
    try {
      const result = await postJson("/postcode/lookup", { postcode }, controller.signal);
      setLookup(result);
      refreshDashboard();
    } catch (error) {
      if (error.name !== "AbortError") setLookupError(error.message);
    } finally {
      if (!controller.signal.aborted) setLookupLoading(false);
    }
  };

  const handleNearest = async () => {
    if (!lookup?.normalizedPostcode) return;
    setNearestLoading(true);
    try {
      const result = await postJson("/postcode/nearest", { postcode: lookup.normalizedPostcode });
      setNearest(result);
      refreshDashboard();
    } catch (error) {
      setNearest({ error: error.message, postcodes: [] });
    } finally {
      setNearestLoading(false);
    }
  };

  const parsePastedAddress = async () => {
    if (!addressText.trim()) return;
    setParseLoading(true);
    setParseError("");
    try {
      const result = await postJson("/address/parse", { address: addressText });
      setComponents(result.components);
    } catch (error) {
      setParseError(error.message);
    } finally {
      setParseLoading(false);
    }
  };

  const handleAddressCheck = async (event) => {
    event.preventDefault();
    setAddressLoading(true);
    try {
      const result = await postJson("/address/verify", {
        originalAddress: addressText,
        components
      });
      setAddressResult(result);
      refreshDashboard();
    } catch (error) {
      setAddressResult({ error: error.message });
    } finally {
      setAddressLoading(false);
    }
  };

  const handleBulkLookup = async (event) => {
    event.preventDefault();
    const postcodes = bulkInput.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean);
    if (!postcodes.length) {
      setBulkResults({ error: "Add at least one postcode, separated by a new line or comma." });
      return;
    }
    if (postcodes.length > 100) {
      setBulkResults({ error: "Bulk lookup is limited to 100 postcodes per request." });
      return;
    }
    setBulkLoading(true);
    try {
      const result = await postJson("/postcode/bulk-lookup", { postcodes });
      setBulkResults(result.results);
      refreshDashboard();
    } catch (error) {
      setBulkResults({ error: error.message });
    } finally {
      setBulkLoading(false);
    }
  };

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setToast("Copied to clipboard");
      setTimeout(() => setToast(""), 2200);
    } catch {
      setToast("Clipboard access is unavailable in this browser");
      setTimeout(() => setToast(""), 2800);
    }
  };

  const clearPostcode = () => {
    lookupController.current?.abort();
    setPostcode("");
    setLookup(null);
    setNearest(null);
    setLookupError("");
    setLookupLoading(false);
  };

  const validForMetric = analytics.validPostcodes;
  const invalidForMetric = analytics.invalidPostcodes;

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" aria-label="Data Direct Address Desk home">
        <div className="brand-mark"><Icon name="pin" size={21} /></div>
        <div><strong>data<span>direct</span></strong><small>ADDRESS DESK</small></div>
      </a>
      <div className="side-label">WORKSPACE</div>
      <button className={`nav-item ${activeTab === "postcode" ? "active" : ""}`} onClick={() => setActiveTab("postcode")}>
        <Icon name="search" /><span>Postcode search</span>
      </button>
      <button className={`nav-item ${activeTab === "address" ? "active" : ""}`} onClick={() => setActiveTab("address")}>
        <Icon name="layers" /><span>Address checker</span>
      </button>
      <div className="sidebar-bottom">
        <div className="service-status"><span className="online-dot" /><span>Postcodes.io</span><strong>Online</strong></div>
        <div className="sidebar-note">Postcode intelligence for smarter deliveries.</div>
        <div className="user-chip"><div className="avatar">DD</div><div><strong>Warehouse team</strong><small>Data Direct</small></div><span className="user-menu">···</span></div>
      </div>
    </aside>

    <main className="main-content">
      <header className="topbar">
        <div className="breadcrumb">Operations <span>/</span> <strong>{activeTab === "postcode" ? "Postcode search" : "Address checker"}</strong></div>
        <div className="topbar-right"><span className="topbar-date"><Icon name="clock" size={15} /> Live postcode data</span><div className="theme-picker" role="group" aria-label="Appearance">
          <button type="button" className={`theme-option ${themeMode === "light" ? "selected" : ""}`} aria-pressed={themeMode === "light"} onClick={() => setThemeMode("light")}>Light</button>
          <button type="button" className={`theme-option ${themeMode === "system" ? "selected" : ""}`} aria-pressed={themeMode === "system"} onClick={() => setThemeMode("system")}>System</button>
          <button type="button" className={`theme-option ${themeMode === "dark" ? "selected" : ""}`} aria-pressed={themeMode === "dark"} onClick={() => setThemeMode("dark")}>Dark</button>
        </div><div className="top-avatar">DD</div></div>
      </header>

      <div className="content-wrap">
        <section className="welcome-row">
          <div>
            <div className="eyebrow"><span className="eyebrow-line" /> DELIVERY OPERATIONS</div>
            <h1>Address <span>intelligence.</span></h1>
            <p className="welcome-copy">Find the postcode facts you need. Check the details before the delivery goes out.</p>
          </div>
          <div className="date-pill"><span className="date-dot" /> REAL-TIME LOOKUP</div>
        </section>

        <section className="metrics-grid" aria-label="Search analytics">
          <MetricCard title="Total searches" value={analytics.totalSearches} icon="search" tone="blue" subtitle="Since service started" />
          <MetricCard title="Valid postcodes" value={validForMetric} icon="check" tone="green" subtitle="Confirmed by Postcodes.io" />
          <MetricCard title="Invalid postcodes" value={invalidForMetric} icon="pin" tone="amber" subtitle="Need another look" />
          <MetricCard title="Incomplete addresses" value={analytics.incompleteAddresses} icon="layers" tone="violet" subtitle="Missing key details" />
          <MetricCard title="API errors" value={analytics.apiErrors} icon="shield" tone="amber" subtitle="External service issues" />
        </section>
        {dashboardError && <p className="dashboard-error">{dashboardError}</p>}

        <div className="workspace-grid">
          <section className="panel search-panel">
            <div className="panel-heading">
              <div className="panel-title-wrap"><div className="section-icon"><Icon name={activeTab === "postcode" ? "pin" : "layers"} /></div>
                <div><h2>{activeTab === "postcode" ? "Postcode search" : "Address completeness"}</h2><p>{activeTab === "postcode" ? "Look up a UK postcode and its geographic details." : "Check whether key delivery address fields are present."}</p></div>
              </div>
              <span className="api-tag"><span /> LIVE API</span>
            </div>

            {activeTab === "postcode" ? <>
              <form onSubmit={handleLookup}>
                <label className="input-label" htmlFor="postcode">UK POSTCODE</label>
                <div className="search-input-wrap">
                  <Icon name="search" size={19} />
                  <input id="postcode" value={postcode} onChange={(event) => setPostcode(event.target.value)} placeholder="e.g. SW1A 1AA" autoComplete="postal-code" />
                  {postcode && <button className="inline-clear" type="button" onClick={clearPostcode} aria-label="Clear postcode"><Icon name="close" size={16} /></button>}
                </div>
                {lookupError && <div className="lookup-api-error"><StatusBadge status="API_ERROR" /> <span>{lookupError}</span></div>}
                <div className="form-actions"><span className="input-hint">Enter a postcode with or without a space</span><div className="button-row">
                  <button type="button" className="button button-light" onClick={clearPostcode} disabled={!postcode && !lookup}>Clear</button>
                  <button type="submit" className="button button-primary" disabled={lookupLoading}>{lookupLoading ? <><span className="spinner" /> Searching</> : <><Icon name="search" size={16} /> Search postcode</>}</button>
                </div></div>
              </form>

              {lookup && <div className="lookup-result">
                <div className="result-header"><div><div className="result-overline">POSTCODE RESULT</div><h3>{lookup.data?.postcode || lookup.normalizedPostcode}</h3></div><StatusBadge status={lookup.status} /></div>
                <ResultNotice status={lookup.status}>{lookup.explanation}</ResultNotice>
                <div className="data-grid">
                  <DataRow label="Submitted postcode" value={lookup.submittedPostcode} />
                  <DataRow label="Normalized postcode" value={lookup.normalizedPostcode} />
                </div>
                {lookup.data && <>
                  <div className="data-grid">
                    <DataRow label="Country" value={lookup.data.country} />
                    <DataRow label="Region" value={lookup.data.region} />
                    <DataRow label="Administrative district" value={lookup.data.administrativeDistrict} />
                    <DataRow label="Ward" value={lookup.data.administrativeWard} />
                    <DataRow label="Parliamentary constituency" value={lookup.data.parliamentaryConstituency} />
                    <DataRow label="Latitude / longitude" value={lookup.data.latitude != null && lookup.data.longitude != null ? `${lookup.data.latitude}, ${lookup.data.longitude}` : "—"} />
                  </div>
                  <div className="result-footer">
                    <span><Icon name="shield" size={14} /> Postcode information only — property not verified</span>
                    <button className="text-button" onClick={() => copyText(lookup.data.postcode)}><Icon name="copy" size={15} /> Copy postcode</button>
                  </div>
                  <details className="codes-details"><summary>Geographic identifiers</summary><pre>{JSON.stringify(lookup.data.codes || {}, null, 2)}</pre></details>
                  <div className="nearby-wrap">
                    {!nearest && <button className="button button-light nearby-button" onClick={handleNearest} disabled={nearestLoading}>{nearestLoading ? <><span className="spinner dark" /> Finding nearby postcodes</> : <><Icon name="pin" size={16} /> Show nearby postcodes</>}</button>}
                    {nearest?.error && <p className="field-error">{nearest.error}</p>}
                    {nearest?.postcodes?.length > 0 && <div className="nearby-list"><h4>Nearby postcodes <span>Closest first</span></h4>
                      {nearest.postcodes.slice(0, 5).map((item) => <button key={item.postcode} className="nearby-row" onClick={() => { setPostcode(item.postcode); setLookup(null); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                        <span className="nearby-pin"><Icon name="pin" size={15} /></span><strong>{item.postcode}</strong><span>{item.distance != null ? `${(item.distance / 1000).toFixed(1)} km` : item.district}</span><Icon name="arrow" size={14} />
                      </button>)}
                    </div>}
                  </div>
                </>}
              </div>}

              <div className="bulk-section">
                <div className="bulk-heading"><div><h3>Bulk postcode lookup</h3><p>Check multiple postcodes in one request.</p></div><span className="bulk-limit">UP TO 100</span></div>
                <form onSubmit={handleBulkLookup}>
                  <textarea value={bulkInput} onChange={(event) => setBulkInput(event.target.value)} rows="3" placeholder={"Paste postcodes separated by lines or commas\nSW1A 1AA, M1 1AE"} aria-label="Postcodes for bulk lookup" />
                  <div className="bulk-actions"><span>Postcodes only. No property-level verification.</span><button className="button button-light" type="submit" disabled={bulkLoading}>{bulkLoading ? <><span className="spinner dark" /> Looking up</> : "Check postcodes"}</button></div>
                </form>
                {bulkResults && <div className="bulk-results">
                  {bulkResults.error ? <p className="field-error">{bulkResults.error}</p> : bulkResults.map((item, index) => <div className="bulk-result-row" key={`${item.submittedPostcode}-${index}`}><span>{item.submittedPostcode || "Empty entry"}</span><StatusBadge status={item.status} /><small>{item.explanation}</small></div>)}
                </div>}
              </div>
            </> : <>
              <div className="address-disclaimer"><Icon name="shield" size={16} /><span><strong>Free address checks</strong> — Postcodes.io validates postcodes; OS Names can find roads and places. Neither confirms an individual property.</span></div>
              <p className="address-parse-help">Paste the address you already have, and we’ll split it into the fields below. A postcode can confirm its postal area, but cannot reveal a house or street by itself.</p>
              <label className="input-label" htmlFor="full-address">PASTE A FULL ADDRESS <span className="optional">(optional)</span></label>
              <textarea id="full-address" className="address-textarea" rows="3" value={addressText} onChange={(event) => setAddressText(event.target.value)} placeholder={"12 Example Road\nLondon\nSW1A 1AA"} />
              <button className="parse-button" type="button" onClick={parsePastedAddress} disabled={!addressText.trim() || parseLoading}>{parseLoading ? "Parsing address…" : "Parse address into fields ↓"}</button>
              {parseError && <p className="field-error">{parseError}</p>}
              <form onSubmit={handleAddressCheck}>
                <div className="field-grid">
                  <Field label="House / building name or number" value={components.building} onChange={(value) => setComponents({ ...components, building: value })} placeholder="e.g. 12 or The Old Mill" />
                  <Field label="Street name" value={components.street} onChange={(value) => setComponents({ ...components, street: value })} placeholder="e.g. Example Road" />
                  <Field label="Town / city" value={components.townCity} onChange={(value) => setComponents({ ...components, townCity: value })} placeholder="e.g. London" />
                  <Field label="County" value={components.county} onChange={(value) => setComponents({ ...components, county: value })} placeholder="e.g. Greater London" />
                  <Field label="Postcode" value={components.postcode} onChange={(value) => setComponents({ ...components, postcode: value })} placeholder="e.g. SW1A 1AA" />
                  <Field label="Country" value={components.country} onChange={(value) => setComponents({ ...components, country: value })} placeholder="e.g. United Kingdom" />
                </div>
                <div className="form-actions address-actions"><span className="input-hint">Postcode is needed for postcode validation; other fields are checked when provided.</span><button className="button button-primary" type="submit" disabled={addressLoading}>{addressLoading ? <><span className="spinner" /> Verifying</> : <><Icon name="check" size={16} /> Verify delivery address</>}</button></div>
              </form>
              {addressResult && <div className="address-result">
                {addressResult.error ? <ResultNotice status="API_ERROR">{addressResult.error}</ResultNotice> : <>
                  <div className="result-header"><div><div className="result-overline">ADDRESS VERIFICATION</div><h3>Delivery address</h3></div><StatusBadge status={addressResult.addressVerification?.status || addressResult.completenessStatus} /></div>
                  <ResultNotice status={addressResult.addressVerification?.status || addressResult.completenessStatus}>{addressResult.addressVerification?.explanation || addressResult.explanation}</ResultNotice>
                  <div className="parsed-grid">{Object.entries(addressResult.components).map(([key, value]) => <DataRow key={key} label={key === "townCity" ? "Town / city" : key === "building" ? "House / building" : key[0].toUpperCase() + key.slice(1)} value={value} />)}</div>
                  {addressResult.missingComponents.length > 0 && <div className="missing-box"><strong>Information to add</strong><span>{addressResult.missingComponents.map((key) => key === "townCity" ? "Town / city" : key).join(", ")}</span></div>}
                  {addressResult.postcodeValidation && <div className="postcode-validation-row"><span>Postcode check</span><StatusBadge status={addressResult.postcodeValidation.status} /></div>}
                  {addressResult.addressVerification && <div className="provider-result">
                    <div className="provider-meta"><span>Sources: {addressResult.addressVerification.source}</span><span>OS Names: <StatusBadge status={addressResult.addressVerification.providerStatus} /></span></div>
                    <div className="component-matches">{Object.entries(addressResult.addressVerification.componentMatches || {}).map(([key, matched]) => <span className={matched === true ? "component-match" : matched === false ? "component-difference" : ""} key={key}>{key === "townCity" ? "Town / city" : key === "building" ? "Building" : key}: {matched === true ? "match" : matched === false ? "not matched" : "not verified"}</span>)}</div>
                    {addressResult.addressVerification.candidates?.length > 0 && <div className="provider-candidates">
                      {addressResult.addressVerification.candidates.map((candidate, index) => <div className="provider-candidate" key={candidate.id || `${candidate.name}-${index}`}>
                        <strong>{candidate.name || "Unnamed location"}</strong>
                        <span>{[candidate.localType, candidate.populatedPlace, candidate.postcodeDistrict && `Postcode area ${candidate.postcodeDistrict}`].filter(Boolean).join(" · ")}</span>
                      </div>)}
                    </div>}
                    {addressResult.postcodeValidation?.valid === true && !addressResult.addressVerification.propertyVerified && <>
                      <div className="property-warning"><Icon name="shield" size={16} /><span>{PROPERTY_VERIFICATION_MESSAGE}</span></div>
                      <div className="property-warning"><Icon name="check" size={16} /><span>{ADDRESS_RECOMMENDATION_MESSAGE}</span></div>
                      <div className="property-warning"><Icon name="shield" size={16} /><span>{POSTCODE_PROPERTY_MESSAGE}</span></div>
                    </>}
                  </div>}
                  <div className="result-footer"><span>Original: {addressResult.originalAddress || "Structured fields"}</span><button className="text-button" onClick={() => copyText(Object.values(addressResult.components).filter(Boolean).join(", "))}><Icon name="copy" size={15} /> Copy address</button></div>
                </>}
              </div>}
            </>}
          </section>

          <aside className="right-column">
            <section className="panel guide-panel">
              <div className="side-panel-heading"><div className="mini-icon"><Icon name="shield" size={17} /></div><div><h3>Verification guide</h3><p>Know what the results mean</p></div></div>
              <div className="guide-item"><span className="guide-number">01</span><div><strong>Postcode confirmed</strong><p>Postcodes.io recognizes the postcode and shares geographic information.</p></div></div>
              <div className="guide-item"><span className="guide-number">02</span><div><strong>Address completeness</strong><p>We check that the key delivery fields have been entered.</p></div></div>
              <div className="guide-item"><span className="guide-number">03</span><div><strong>Road / place match</strong><p>OS Names can help confirm a named road or place. Free sources cannot confirm an individual building.</p></div></div>
              <div className="guide-footnote"><Icon name="shield" size={15} /><span>Address records do not verify recipient identity or occupancy.</span></div>
            </section>

            <section className="panel activity-panel">
              <div className="activity-heading"><div><h3>Recent searches</h3><p>Your latest postcode lookups</p></div><span className="history-count">{history.length}</span></div>
              {history.length ? <div className="history-list">{history.slice(0, 5).map((item, index) => <button key={`${item.postcode}-${item.searchedAt}-${index}`} className="history-item" onClick={() => { setActiveTab("postcode"); setPostcode(item.postcode); setLookup(null); }}>
                <div className="history-pin"><Icon name="pin" size={15} /></div><div className="history-main"><strong>{item.postcode}</strong><small>{new Date(item.searchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></div><StatusBadge status={item.status} />
              </button>)}</div> : <div className="empty-history"><div><Icon name="clock" size={19} /></div><strong>No searches yet</strong><span>Your recent postcode searches will appear here.</span></div>}
              <div className="privacy-note"><span className="privacy-lock">⌑</span> Recent postcode history is kept in memory only.</div>
            </section>
          </aside>
        </div>
        <footer className="page-footer"><span>DATA DIRECT <b>·</b> ADDRESS DESK</span><span>Powered by <a href="https://postcodes.io/" target="_blank" rel="noreferrer">Postcodes.io <Icon name="arrow" size={12} /></a></span></footer>
      </div>
    </main>
    {toast && <div className="toast"><Icon name="check" size={16} />{toast}</div>}
  </div>;
}
