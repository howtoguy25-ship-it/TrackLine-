import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { LiveShareView } from "./components/LiveShareView";
import { DriveLinkView } from "./components/DriveLinkView";

// No router in this app -- it has been a single monolithic page throughout its history, so a
// plain pathname check for the one new route (a shared live-trip link, /live/<shareId>) is
// less risk than pulling in react-router-dom for a single conditional render. Anything else
// falls through to the real app unchanged.
const liveShareMatch = window.location.pathname.match(/^\/live\/([A-Za-z0-9_-]+)\/?$/);
// The second standalone route: a shared "drive to this place" link (/drive?lat=..&lng=..).
const isDriveLink = /^\/drive\/?$/.test(window.location.pathname);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {liveShareMatch ? <LiveShareView shareId={liveShareMatch[1]} /> : isDriveLink ? <DriveLinkView /> : <App />}
    </ErrorBoundary>
  </React.StrictMode>
);
