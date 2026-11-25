import React from "react";
import {
  Text as RNText,
  TextInput as RNTextInput,
  StyleSheet,
  type StyleProp,
  type TextProps,
  type TextInputProps,
  type TextStyle,
} from "react-native";
import { isRubikReady, rubikFamilyForWeight } from "@/theme/typography";
import { SurfaceSchemeContext, darkText, darkTextOverrides } from "@/components/ui/surfaceScheme";

// Drop-in replacements for React Native's Text and TextInput that render in Rubik.
//
// Every screen imports Text/TextInput from here instead of from "react-native"; nothing else
// about how they're used changes. The wrapper reads the fontWeight a style asks for, picks the
// Rubik file that really is that weight (see theme/typography.ts), and then clears fontWeight so
// neither platform tries to embolden an already-bold face.
//
// A style that names its own fontFamily is left exactly as written.

function withRubik<T extends TextStyle>(style: StyleProp<T>): StyleProp<T> {
  if (!isRubikReady()) return style;
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  if (flat.fontFamily) return style;
  const rubik = { fontFamily: rubikFamilyForWeight(flat.fontWeight), fontWeight: "normal" } as unknown as T;
  return [style, rubik];
}

/** Inside a dark SurfaceScheme, light-theme text colours become their dark-theme ones. */
function withScheme<T extends TextStyle>(style: StyleProp<T>, dark: boolean): StyleProp<T> {
  if (!dark) return style;
  const extra = darkTextOverrides(StyleSheet.flatten(style) as Record<string, unknown>);
  return extra ? [style, extra as T] : style;
}

export const Text = React.forwardRef<RNText, TextProps>(function Text({ style, ...rest }, ref) {
  const dark = React.useContext(SurfaceSchemeContext) === "dark";
  return <RNText ref={ref} {...rest} style={withScheme(withRubik(style), dark)} />;
});
// Lets `Text` keep working as a TYPE too (useRef<Text>), exactly as the React Native export does.
// eslint-disable-next-line @typescript-eslint/no-redeclare
export type Text = RNText;

export const TextInput = React.forwardRef<RNTextInput, TextInputProps>(function TextInput(
  { style, placeholderTextColor, ...rest },
  ref
) {
  const dark = React.useContext(SurfaceSchemeContext) === "dark";
  return (
    <RNTextInput
      ref={ref}
      {...rest}
      placeholderTextColor={dark ? (darkText(placeholderTextColor) as string | undefined) : placeholderTextColor}
      style={withScheme(withRubik(style), dark)}
    />
  );
});
// eslint-disable-next-line @typescript-eslint/no-redeclare
export type TextInput = RNTextInput;
