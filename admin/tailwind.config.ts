import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#0A84FF", dark: "#00559F" },
        ink: "#101828",
      },
    },
  },
  plugins: [],
} satisfies Config;
