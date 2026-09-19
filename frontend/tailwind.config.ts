import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Cores fixas usadas nos componentes builder (dark sidebar/preview)
        brand: {
          50:  "#f2f6ff",
          100: "#e1e9ff",
          300: "#a9beff",
          500: "#4c6fff",
          700: "#2f4bd6",
          900: "#1b2c8f",
        },
        surface: {
          DEFAULT: "var(--surface)",
          raised:  "var(--elevated)",
        },

        // Tokens semânticos — todos referenciados via CSS var oklch
        background:  "var(--background)",
        foreground:  "var(--foreground)",
        elevated:    "var(--elevated)",
        border:      "var(--border)",
        input:       "var(--input)",
        ring:        "var(--ring)",

        primary: {
          DEFAULT:    "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT:    "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        muted: {
          DEFAULT:    "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT:    "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        destructive: {
          DEFAULT:    "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        success: {
          DEFAULT:    "var(--success)",
          foreground: "var(--success-foreground)",
        },
        warning: {
          DEFAULT:    "var(--warning)",
          foreground: "var(--warning-foreground)",
        },
        card: {
          DEFAULT:    "var(--card)",
          foreground: "var(--card-foreground)",
        },
        popover: {
          DEFAULT:    "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        sidebar: {
          DEFAULT:               "var(--sidebar)",
          foreground:            "var(--sidebar-foreground)",
          primary:               "var(--sidebar-primary)",
          "primary-foreground":  "var(--sidebar-primary-foreground)",
          accent:                "var(--sidebar-accent)",
          "accent-foreground":   "var(--sidebar-accent-foreground)",
          border:                "var(--sidebar-border)",
          ring:                  "var(--sidebar-ring)",
        },
        chart: {
          1: "var(--chart-1)",
          2: "var(--chart-2)",
          3: "var(--chart-3)",
          4: "var(--chart-4)",
          5: "var(--chart-5)",
        },
      },
      fontFamily: {
        display: ["'Space Grotesk'", "sans-serif"],
        body:    ["'DM Sans'", "sans-serif"],
        mono:    ["'JetBrains Mono'", "'Fira Code'", "ui-monospace", "monospace"],
      },
      borderRadius: {
        card: "0.75rem",
        lg:   "var(--radius)",
        md:   "calc(var(--radius) - 2px)",
        sm:   "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        panel: "var(--shadow-panel)",
        glow:  "var(--shadow-glow)",
      },
    },
  },
  plugins: [],
} satisfies Config;
