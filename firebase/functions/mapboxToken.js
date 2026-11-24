// The server Mapbox token, or null while it's the deploy's "unset" placeholder (or empty): then
// updatePresence skips road-snapping and keeps the real fixes. No dependencies, so the app's
// tests can check it without the functions' packages installed.
function mapboxServerTokenFrom(value) {
  const v = String(value || "").trim();
  return v && v !== "unset" ? v : null;
}
module.exports = { mapboxServerTokenFrom };
