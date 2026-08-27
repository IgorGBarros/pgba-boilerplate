import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f2f6ff",
          500: "#4c6fff",
          700: "#2f4bd6",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
