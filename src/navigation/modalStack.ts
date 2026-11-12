// Which screens are presented as native modals, and a check for the trap that comes with them.
//
// react-native-screens' native stack on iOS keeps every ordinary ("push") screen on the base
// navigation controller and presents modal screens on top of it. A push screen opened while a
// modal is showing therefore goes UNDER the modal: the button that opened it shows its press
// feedback and then nothing visible happens -- and if that screen has an autoFocus field, its
// keyboard pops up over the modal for no apparent reason. That is exactly how the Main menu used
// to break (it was a transparentModal), so:
//   - the Main menu is an ordinary screen now (it is an opaque full-screen panel anyway);
//   - any screen opened from a modal screen must itself be a modal (listed here);
//   - in development, screensHiddenBehindModal() warns about any route that slipped through.
//
// No React Native imports, so this is unit-tested directly (__tests__/navigation.test.ts).

export type ModalPresentation = "modal" | "fullScreenModal" | "transparentModal";

/** Screens presented as native modals. Everything else is an ordinary push screen. */
export const MODAL_SCREENS: Readonly<Record<string, ModalPresentation>> = {
  // Full-screen camera; its own orientation rule needs a modal (see RootNavigator).
  VehicleDetection: "fullScreenModal",
  // Opened from the dashcam ("Run REV Check"), so it must be presented above it.
  RevCheck: "modal",
  // Opened from REV Check.
  DocumentScan: "modal",
};

export function isModalScreen(name: string): boolean {
  return MODAL_SCREENS[name] !== undefined;
}

/**
 * The push screens in a stack (bottom to top) that sit above a modal -- on iOS these are drawn
 * underneath that modal, invisible. Empty when the stack is fine.
 */
export function screensHiddenBehindModal(routeNames: readonly string[]): string[] {
  const hidden: string[] = [];
  let modalSeen = false;
  routeNames.forEach((name, i) => {
    if (i > 0 && isModalScreen(name)) modalSeen = true;
    else if (modalSeen && !isModalScreen(name)) hidden.push(name);
  });
  return hidden;
}
