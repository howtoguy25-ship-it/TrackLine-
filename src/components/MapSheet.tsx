// @gorhom/bottom-sheet's BottomSheet, placed by the screen layout (fix pass 7 §3): full width on
// a phone, the left panel on a landscape phone, tablet or desktop. Same props and ref as
// BottomSheet; only its horizontal placement is added.
import React, { forwardRef } from "react";
import BottomSheet, { type BottomSheetProps } from "@gorhom/bottom-sheet";
import { useSheetPanelStyle } from "@/layout/LayoutContext";

export const MapSheet = forwardRef<BottomSheet, BottomSheetProps>(function MapSheet(props, ref) {
  const panel = useSheetPanelStyle();
  return <BottomSheet ref={ref} {...props} style={[props.style, panel]} />;
});
