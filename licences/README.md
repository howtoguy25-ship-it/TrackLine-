# Brand logos on the map

TrackLine's brand & popular-place badges (src/map/poiBadges.ts) use **our own category icons**
(fuel, cart, cup, fork, bag, H, P) next to the place's name. No brand logo is shown.

A real brand logo may be added **only** for a signed partner. Each one needs:

1. the logo file, supplied by the brand, saved in this folder;
2. the brand's written permission to show it in TrackLine, saved next to it (PDF or email export);
3. one entry in `PARTNER_LOGOS` (src/map/poiBadges.ts), keyed by Mapbox's standardized `brand`
   value, and the image registered as `logo:<brand>`.

The map style already tries `logo:<brand>` first and falls back to our badge, so nothing else
changes. There are no signed partners yet, so `PARTNER_LOGOS` is empty. No scraped logos.

Promoted pins (paid placement) are not built; this hook is where they would attach.
