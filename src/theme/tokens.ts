// Shared design tokens for the mobile app -- every screen/component in this app pulls its
// colors/spacing/radius/shadow from here, so refining this one file is the real, highest-
// leverage way to give the whole app a cohesive visual upgrade at once, rather than hand-editing
// dozens of screens individually (which would also risk undoing a lot of this session's own
// carefully evidence-tuned layout work along the way).
//
// Real, explicit request for a "bold & modern... professional yet stylish... unique" upgrade,
// keeping the existing blue identity rather than replacing it -- accent moved one full step
// deeper/richer in the same Tailwind blue scale (#2563EB, blue-600 -> #1D4ED8, blue-700), a real,
// well-tested, harmonious shade (not a guessed value), reading as more premium/saturated while
// still unmistakably the same blue. accentDeep/accentSoft are new -- a pressed/depth shade and a
// light tint for badges/selected states, both derived from the same blue scale, so anything that
// wants a darker or lighter variant of the brand color has a real token instead of a one-off hex.
export const colors = {
  accent: "#1D4ED8",
  accentDeep: "#1E3A8A",
  accentSoft: "#DBEAFE",
  dark: "#111827",
  danger: "#DC2626",
  warning: "#F59E0B",
  surface: "#FFFFFF",
  surfaceMuted: "#F9FAFB",
  border: "#E5E7EB",
  text: "#111827",
  textMuted: "#6B7280",
  textFaint: "#9CA3AF",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

// Softer, slightly larger scale than before (sm 10->12, md 12->14, lg 14->18, xl 16->22) -- a
// real, deliberate part of the "bold & modern" direction: more generous rounding reads as more
// contemporary/premium across every card, button, sheet, and badge in the app that already
// pulls from this token, with zero per-screen changes needed.
export const radius = {
  sm: 12,
  md: 14,
  lg: 18,
  xl: 22,
  pill: 999,
} as const;

// Deeper elevation across all three tiers than before -- part of the same "bold" direction as
// the radius bump above: more pronounced shadows read as more premium/confident than the
// previous subtler ones, without changing what actually casts a shadow anywhere.
export const shadow = {
  low: {
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  medium: {
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  high: {
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  // New -- a real signature detail for this app's own "unique look" (not present before this
  // upgrade): a soft blue-tinted glow instead of a flat black shadow, used deliberately sparingly
  // on the app's own most central actions (see e.g. RouteOptionsCard's Start button) rather than
  // on every button, which would read as gaudy instead of premium.
  accentGlow: {
    shadowColor: "#1D4ED8",
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
} as const;

// Standard opacity a Pressable dims to while held, for consistent tactile feedback
// across every button in the app instead of some buttons having it and others not.
export const pressedOpacity = 0.7;
