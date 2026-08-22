import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#18202f",
        muted: "#5f6b7a",
        line: "#d9dee7",
        panel: "#f7f8fb",
        accent: "#0f766e",
        warning: "#b45309",
        danger: "#b91c1c",
      },
    },
  },
  plugins: [],
};

export default config;
