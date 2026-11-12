import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import app from "./app.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Port validation ──────────────────────────────────────────────────────────
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("ERROR: PORT must be an integer between 1 and 65535.");
  process.exit(1);
}

// ─── Production frontend check ────────────────────────────────────────────────
// The Express app serves the built React frontend from dist/.
// If dist/index.html is missing the user forgot to run "npm run build".
const distIndex = path.resolve(__dirname, "../dist/index.html");
if (!existsSync(distIndex)) {
  console.warn(
    "\n⚠  WARNING: dist/index.html not found.\n" +
    "   The React frontend has not been built yet.\n" +
    "   Run:  npm run build\n" +
    "   The API endpoints will still respond, but the UI will not load.\n"
  );
}

// ─── Start server ─────────────────────────────────────────────────────────────
const server = app.listen(port, "127.0.0.1", () => {
  const url = `http://localhost:${port}`;
  console.log(`\n✓  Data Direct Address Desk`);
  console.log(`   Listening on ${url}`);
  if (existsSync(distIndex)) {
    console.log(`   Open ${url} in your browser.\n`);
  } else {
    console.log(`   API available at ${url}/api/v1/health\n`);
  }
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────
function shutdown(signal) {
  console.log(`\n${signal} received — shutting down gracefully…`);
  server.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });
  // Force-exit after 5 s if connections are still open
  setTimeout(() => {
    console.error("Forced exit after timeout.");
    process.exit(1);
  }, 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
