import type { Config } from "tailwindcss";

// Mesmos nomes de token do Studio PGBA (brand.*, surface.*, font-display,
// font-body): o "Gerar" pede páginas usando esses tokens. Troque os
// valores pela identidade visual do cliente — os nomes ficam.
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
          DEFAULT: "#f8fafc",
          raised: "#ffffff",
        },
      },
      fontFamily: {
        display: ["'Space Grotesk'", "system-ui", "sans-serif"],
        body: ["'DM Sans'", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "0.75rem",
      },
    },
  },
  plugins: [],
} satisfies Config;
