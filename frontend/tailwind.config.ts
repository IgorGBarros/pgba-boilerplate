import type { Config } from "tailwindcss";

// Tokens são CSS vars com cor pronta (hex/oklch) — sem isto, `bg-success/10`,
// `border-destructive/30`… não geravam CSS nenhum (Tailwind só aplica opacidade
// a cor com `<alpha-value>`). color-mix mistura o token com transparente.
const v = (name: string) => `color-mix(in srgb, var(${name}) calc(<alpha-value> * 100%), transparent)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
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
          DEFAULT: v("--surface"),
          raised:  v("--elevated"),
        },

        // Tokens semânticos — todos referenciados via CSS var oklch
        background:  v("--background"),
        foreground:  v("--foreground"),
        elevated:    v("--elevated"),
        border:      v("--border"),
        input:       v("--input"),
        ring:        v("--ring"),

        primary: {
          DEFAULT:    v("--primary"),
          foreground: v("--primary-foreground"),
        },
        secondary: {
          DEFAULT:    v("--secondary"),
          foreground: v("--secondary-foreground"),
        },
        muted: {
          DEFAULT:    v("--muted"),
          foreground: v("--muted-foreground"),
        },
        accent: {
          DEFAULT:    v("--accent"),
          foreground: v("--accent-foreground"),
        },
        destructive: {
          DEFAULT:    v("--destructive"),
          foreground: v("--destructive-foreground"),
        },
        success: {
          DEFAULT:    v("--success"),
          foreground: v("--success-foreground"),
        },
        warning: {
          DEFAULT:    v("--warning"),
          foreground: v("--warning-foreground"),
        },
        card: {
          DEFAULT:    v("--card"),
          foreground: v("--card-foreground"),
        },
        popover: {
          DEFAULT:    v("--popover"),
          foreground: v("--popover-foreground"),
        },
        sidebar: {
          DEFAULT:               v("--sidebar"),
          foreground:            v("--sidebar-foreground"),
          primary:               v("--sidebar-primary"),
          "primary-foreground":  v("--sidebar-primary-foreground"),
          accent:                v("--sidebar-accent"),
          "accent-foreground":   v("--sidebar-accent-foreground"),
          border:                v("--sidebar-border"),
          ring:                  v("--sidebar-ring"),
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
        // var(): a família escolhida na engrenagem (ThemeContext) vale no app todo
        display: ["var(--font-display, 'Space Grotesk')", "sans-serif"],
        body:    ["var(--font-body, 'DM Sans')", "sans-serif"],
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
