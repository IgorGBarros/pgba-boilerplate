import type { Config } from "tailwindcss";

// Tokens de design do PGBA Boilerplate. Uma vertical/cliente deve
// SOBRESCREVER estes valores (nunca deixar o default do Tailwind puro) —
// ver frontend/.agent/SKILL.md, seção "Tokens de design".
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f2f6ff",
          100: "#e1e9ff",
          300: "#a9beff",
          500: "#4c6fff",
          700: "#2f4bd6",
          900: "#1b2c8f",
        },
        surface: {
          DEFAULT: "#0b0d12",
          raised: "#12151c",
        },
      },
      fontFamily: {
        display: ["'Space Grotesk'", "sans-serif"],
        body: ["'Inter'", "sans-serif"],
      },
      borderRadius: {
        card: "0.75rem",
      },
    },
  },
  plugins: [],
} satisfies Config;
