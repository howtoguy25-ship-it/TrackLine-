import React, { forwardRef } from "react";
import type { SimpleBottomSheetRef } from "@/components/SimpleBottomSheet";
import { NearbyPlacesSheet, type NearbyPin } from "@/components/places/NearbyPlacesSheet";
import type { LatLng } from "@/utils/polyline";

// Food and drink near you (restaurants, cafes, takeaway, bakeries) from Google Places (New).
// Tapping a row opens the place page (photos, hours, reviews, routes). See
// components/places/NearbyPlacesSheet.tsx.
interface Props {
  location: LatLng | null;
  onViewDetails: (placeId: string) => void;
  onSheetChange?: (index: number) => void;
  onPinsChange?: (pins: NearbyPin[]) => void;
}

export const RestaurantsSheet = forwardRef<SimpleBottomSheetRef, Props>(function RestaurantsSheet({ location, onViewDetails, onSheetChange, onPinsChange }, ref) {
  return <NearbyPlacesSheet ref={ref} category="food" location={location} onViewDetails={onViewDetails} onSheetChange={onSheetChange} onPinsChange={onPinsChange} />;
});
