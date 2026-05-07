import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1a1a1a",
        paper: "#fbf8f1",
        accent: "#7a4b2a"
      },
      fontFamily: {
        serif: ["Georgia", "ui-serif", "serif"]
      }
    }
  },
  plugins: []
};

export default config;
