// Usage: MAPBOX_TOKEN_FILE=<file holding a pk. token> MAPBOX_GL_DIR=<dir with mapbox-gl installed> node scripts/map-polish-screenshots.js . docs/map-polish
// The token is read from a file and never printed.
/* global mapboxgl */
// Renders TrackLine's built map styles with real Mapbox tiles + live traffic, as the app draws them.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const [repo, out] = process.argv.slice(2);
const token = fs.readFileSync(process.env.MAPBOX_TOKEN_FILE, "utf8").trim();
const lib = fs.readFileSync(path.join(process.env.MAPBOX_GL_DIR, "node_modules/mapbox-gl/dist/mapbox-gl.js"), "utf8");
const css = fs.readFileSync(path.join(process.env.MAPBOX_GL_DIR, "node_modules/mapbox-gl/dist/mapbox-gl.css"), "utf8");
const SHOTS = [
  { z: 11, center: [151.06, -33.88], where: "Sydney west (M4, M5, suburbs)" },
  { z: 13, center: [151.035, -33.915], where: "Bankstown" },
  { z: 15, center: [151.2065, -33.8735], where: "Sydney CBD, Town Hall" },
  { z: 17, center: [151.0345, -33.9175], where: "Stacey St, Bankstown" },
];
(async () => {
  const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  p.on("pageerror", (e) => console.log("pageerror", String(e).slice(0, 200)));
  const log = [];
  for (const scheme of ["light", "dark"]) {
    const style = JSON.parse(fs.readFileSync(path.join(repo, `src/map-v2/styles/trackline-${scheme}.json`), "utf8"));
    for (const s of SHOTS) {
      await p.setContent(`<html><head><style>${css} body{margin:0} #m{width:390px;height:844px}</style></head><body><div id="m"></div><script>${lib}</script></body></html>`);
      const res = await p.evaluate(
        async ({ token, style, s }) => {
          mapboxgl.accessToken = token;
          const map = new mapboxgl.Map({ container: "m", style, center: s.center, zoom: s.z, attributionControl: true, preserveDrawingBuffer: true });
          // The shield plates TrackLineMap draws (map-v2/TrackLineMap.tsx <Images>): 20 pt rounded plates, stretchable.
          const PLATES = { green: "#1F8A3B", blue: "#1E4FA3", white: "#FFFFFF", red: "#C8102E", yellow: "#FFD400", orange: "#E87722", brown: "#7A4A21" };
          for (const [plate, colour] of Object.entries(PLATES)) {
            const c = document.createElement("canvas"); c.width = 40; c.height = 40;
            const g = c.getContext("2d"); g.fillStyle = colour; g.strokeStyle = plate === "white" ? "#1A1A1A" : "#FFFFFF"; g.lineWidth = 3;
            g.beginPath(); g.roundRect(1.5, 1.5, 37, 37, 8); g.fill(); g.stroke();
            map.addImage("tl-shield-" + plate, g.getImageData(0, 0, 40, 40), { pixelRatio: 2, stretchX: [[12, 28]], stretchY: [[12, 28]], content: [8, 8, 32, 32] });
          }
          await new Promise((r) => map.on("load", r));
          const before = map.getLayer("road-label-service") ? "road-label-service" : undefined;
          map.addSource("traffic", { type: "vector", url: "mapbox://mapbox.mapbox-traffic-v1" });
          map.addLayer(
            {
              id: "traffic-lines", type: "line", source: "traffic", "source-layer": "traffic",
              filter: ["match", ["get", "congestion"], ["moderate", "heavy", "severe"], true, false],
              paint: { "line-color": ["match", ["get", "congestion"], "moderate", "#F5A623", "heavy", "#D7263D", "severe", "#8E1B2B", "#00000000"], "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 10, 1, 14, 2, 18, 4.5] },
              layout: { "line-cap": "round", "line-join": "round" },
            },
            before
          );
          await new Promise((r) => { map.once("idle", r); setTimeout(r, 25000); });
          const feats = map.queryRenderedFeatures().length;
          const traffic = map.queryRenderedFeatures({ layers: ["traffic-lines"] }).length;
          return { feats, traffic };
        },
        { token, style, s }
      );
      const name = `z${s.z}-${scheme}.png`;
      await p.screenshot({ path: path.join(out, name) });
      log.push({ name, where: s.where, center: s.center, zoom: s.z, renderedFeatures: res.feats, trafficSegments: res.traffic, takenAt: new Date().toISOString() });
      console.log(name, res.feats, "features,", res.traffic, "traffic segments");
    }
  }
  fs.writeFileSync(path.join(out, "shots.json"), JSON.stringify(log, null, 2));
  await b.close();
})();
