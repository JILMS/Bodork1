import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bodor: {
          // Slightly lifted palette: still dark but readable, with
          // higher-contrast text and a warmer accent.
          bg: "#0e131a",
          panel: "#161e2a",
          accent: "#ff7a2c",
          line: "#27313f",
          text: "#f1f5f9",
          muted: "#94a3b8",
          good: "#34d399",
          warn: "#fbbf24",
          bad: "#f87171",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      borderRadius: {
        lg: "0.6rem",
      },
    },
  },
  plugins: [],
};

export default config;
