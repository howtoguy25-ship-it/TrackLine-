import React, { forwardRef } from "react";
import type { SimpleBottomSheetRef } from "@/components/SimpleBottomSheet";
import { NearbyPlacesSheet, type NearbyPin } from "@/components/places/NearbyPlacesSheet";
import type { LatLng } from "@/utils/polyline";

// Petrol stations near you: Google Places (New) with live prices for your fuel type (NSW
// FuelCheck through our server, or Google's own station prices elsewhere). See
// components/places/NearbyPlacesSheet.tsx.
export type FuelStationPin = NearbyPin;

interface Props {
  location: LatLng | null;
  onViewDetails: (placeId: string) => void;
  onSheetChange?: (index: number) => void;
  onStationsChange?: (pins: FuelStationPin[]) => void;
}

export const FuelStationsSheet = forwardRef<SimpleBottomSheetRef, Props>(function FuelStationsSheet({ location, onViewDetails, onSheetChange, onStationsChange }, ref) {
  return <NearbyPlacesSheet ref={ref} category="fuel" location={location} onViewDetails={onViewDetails} onSheetChange={onSheetChange} onPinsChange={onStationsChange} />;
});
