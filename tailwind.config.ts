import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bodor: {
          bg: "#0b0f14",
          panel: "#121820",
          accent: "#ff6b1a",
          line: "#1f2a36",
          text: "#e6edf3",
          muted: "#8b96a3",
        },
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
