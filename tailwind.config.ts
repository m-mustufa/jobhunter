import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0a0f1c",
        surface: "#111827",
        raised: "#161f33",
        line: "#243049",
        soft: "#8b98b4",
        bright: "#e8edf7",
        beacon: "#f2b13c",
        beaconDim: "#7a5a1e",
        good: "#5ecb8f",
        partial: "#e0793c",
        weak: "#c9506a",
      },
      fontFamily: {
        display: ["Space Grotesk", "ui-sans-serif", "system-ui", "sans-serif"],
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      keyframes: {
        pulseDot: {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.4", transform: "scale(0.7)" },
        },
        sweep: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(200%)" },
        },
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        flashHighlight: {
          "0%": { boxShadow: "0 0 0 0 rgba(242,177,60,0.7)" },
          "70%": { boxShadow: "0 0 0 10px rgba(242,177,60,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(242,177,60,0)" },
        },
      },
      animation: {
        pulseDot: "pulseDot 1.6s ease-in-out infinite",
        sweep: "sweep 1.4s ease-in-out infinite",
        fadeIn: "fadeIn 0.15s ease",
        // Plays twice then stops — a brief "look here" ping, not a
        // permanent loop, for drawing the eye to something that just
        // changed (e.g. a prompt the client needs to re-copy).
        flashHighlight: "flashHighlight 1s ease-out 2",
      },
    },
  },
  plugins: [],
};
export default config;
