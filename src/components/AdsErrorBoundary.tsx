import React from "react";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

// Google Mobile Ads' hooks/components (useAppOpenAd, <BannerAd>) call into a native module
// directly during render -- if that native module has any registration problem in a given
// build, it throws synchronously during render, and an uncaught render error crashes the
// *entire* app, not just the ad. Ads are not core functionality; navigation, the map, and
// alerts are. This boundary means a problem with ads can only ever cost you the ad, never
// the whole app.
export class AdsErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.warn("[ads] render error caught by AdsErrorBoundary — ads disabled for this session", error);
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}
