import React, { forwardRef } from "react";
import type { SimpleBottomSheetRef } from "@/components/SimpleBottomSheet";
import { NearbyPlacesSheet, type NearbyPin } from "@/components/places/NearbyPlacesSheet";
import type { PlaceDetails } from "@/services/places";
import type { LatLng } from "@/utils/polyline";

// Hotels near you from Google Places (New). The old row "Directions" button moved into the place
// page a row opens (View routes there). See components/places/NearbyPlacesSheet.tsx.
interface Props {
  location: LatLng | null;
  /** Kept for callers; routes now start from the place page. */
  onSelect?: (place: PlaceDetails) => void;
  onViewDetails: (placeId: string) => void;
  onSheetChange?: (index: number) => void;
  onPinsChange?: (pins: NearbyPin[]) => void;
}

export const HotelsSheet = forwardRef<SimpleBottomSheetRef, Props>(function HotelsSheet({ location, onViewDetails, onSheetChange, onPinsChange }, ref) {
  return <NearbyPlacesSheet ref={ref} category="hotel" location={location} onViewDetails={onViewDetails} onSheetChange={onSheetChange} onPinsChange={onPinsChange} />;
});
