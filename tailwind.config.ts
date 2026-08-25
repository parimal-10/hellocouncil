import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0f172a",
        muted: "#64748b",
        line: "#e2e8f0",
        panel: "#f6f8fb",
        accent: "#0f766e",
        accentSoft: "#ccfbf1",
        success: "#15803d",
        info: "#1d4ed8",
        warning: "#b45309",
        danger: "#dc2626",
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)",
        pop: "0 4px 12px 0 rgb(15 23 42 / 0.08)",
      },
    },
  },
  plugins: [],
};

export default config;
