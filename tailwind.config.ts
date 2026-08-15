import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#F7F7F5",
        ink: "#1C1C1A",
        line: "#DEDDD6",
        muted: "#6B6A63",
        system: {
          DEFAULT: "#2B4C3F", // verde botica oscuro — acento de marca del sistema
          light: "#3E6B58",
          tint: "#EAF0EC",
        },
        severidad: {
          critica: "#B3261E",
          criticaTint: "#FBEAE9",
          alta: "#C77400",
          altaTint: "#FBF1E1",
          media: "#8A6D00",
          mediaTint: "#F8F3DE",
          baja: "#5C6B73",
          bajaTint: "#EEF1F2",
        },
        estado: {
          pendiente: "#6B6A63",
          corregido: "#2B4C3F",
          descartado: "#A6A49B",
        },
      },
      fontFamily: {
        sans: ["var(--font-plex-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-plex-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        DEFAULT: "3px",
        card: "4px",
        lg: "8px",
        xl: "12px",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(28,28,26,0.05), 0 1px 1px rgba(28,28,26,0.03)",
        elevated: "0 8px 24px -4px rgba(28,28,26,0.10), 0 2px 6px -1px rgba(28,28,26,0.06)",
        ring: "0 0 0 3px rgba(43,76,63,0.14)",
      },
      transitionTimingFunction: {
        // easing "resorte": arranca rápido y se asienta suave, sin rebote —
        // se usa en casi toda la UI (equivalente CSS a un spring damping ~1.0)
        spring: "cubic-bezier(0.32, 0.72, 0, 1)",
      },
      keyframes: {
        fadeInUp: {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        scaleIn: {
          "0%": { opacity: "0", transform: "scale(0.98)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        pulseSoft: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
      },
      animation: {
        "fade-in-up": "fadeInUp 0.35s cubic-bezier(0.32,0.72,0,1) both",
        "fade-in": "fadeIn 0.28s ease-out both",
        "scale-in": "scaleIn 0.22s cubic-bezier(0.32,0.72,0,1) both",
        "pulse-soft": "pulseSoft 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
