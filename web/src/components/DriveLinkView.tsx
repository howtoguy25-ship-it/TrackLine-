import "../App.css";
import "./DriveLinkView.css";

// The page a shared "drive to this place" link opens (tracklinemaps.com/drive?lat=..&lng=..,
// see main.tsx's path check; the app builds these in its src/services/driveLink.ts).
//
// It deliberately loads nothing -- no map, no sign-in, no network request -- so it appears
// instantly on whatever phone the link was sent to. Its whole job is two buttons: hand the
// destination to TrackLine if it's installed, or to the phone's usual maps app if it isn't.

interface Target {
  lat: number;
  lng: number;
  name: string;
  address: string;
}

// Mirrors parseDriveLink in the app. The name and address come from the link, which anyone can
// write, so they're only ever rendered as text (React escapes them) and never as markup.
function readTarget(search: string): Target | null {
  const params = new URLSearchParams(search);
  const latText = params.get("lat") ?? "";
  const lngText = params.get("lng") ?? "";
  if (!/^-?\d+(\.\d+)?$/.test(latText) || !/^-?\d+(\.\d+)?$/.test(lngText)) return null;
  const lat = Number(latText);
  const lng = Number(lngText);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  const clean = (value: string | null) => (value ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  return { lat, lng, name: clean(params.get("name")) || "Shared destination", address: clean(params.get("addr")) };
}

export function DriveLinkView() {
  const target = readTarget(window.location.search);

  if (!target) {
    return (
      <div className="drive-link-root">
        <div className="drive-link-card">
          <div className="drive-link-title">Link not available</div>
          <div className="drive-link-body">This link doesn&apos;t point to a place we can read.</div>
        </div>
      </div>
    );
  }

  const query =
    `lat=${target.lat.toFixed(6)}&lng=${target.lng.toFixed(6)}&name=${encodeURIComponent(target.name)}` +
    (target.address ? `&addr=${encodeURIComponent(target.address)}` : "");
  const appLink = `trackline://drive?${query}`;
  const mapsLink = `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}`;

  return (
    <div className="drive-link-root">
      <div className="drive-link-card">
        <div className="drive-link-eyebrow">Drive to</div>
        <div className="drive-link-title">{target.name}</div>
        {target.address && <div className="drive-link-body">{target.address}</div>}
        <a className="drive-link-button drive-link-button-primary" href={appLink}>
          Open in TrackLine
        </a>
        <a className="drive-link-button" href={mapsLink} rel="noopener noreferrer">
          Open in Google Maps instead
        </a>
        <div className="drive-link-hint">
          &quot;Open in TrackLine&quot; needs the TrackLine app installed on this phone.
        </div>
      </div>
    </div>
  );
}
