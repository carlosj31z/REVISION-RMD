import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Todos los tokens de color viven en variables CSS (ver globals.css) —
      // así :root vs. :root[data-theme="dark"] cambia toda la paleta sin
      // tocar una sola clase de Tailwind en los componentes. El patrón
      // rgb(var(--x) / <alpha-value>) preserva los modificadores de opacidad
      // de Tailwind (ej. "border-line/70") funcionando igual en ambos temas.
      colors: {
        paper: "rgb(var(--color-paper) / <alpha-value>)",
        ink: "rgb(var(--color-ink) / <alpha-value>)",
        line: "rgb(var(--color-line) / <alpha-value>)",
        muted: "rgb(var(--color-muted) / <alpha-value>)",
        surface: "rgb(var(--color-surface) / <alpha-value>)", // reemplaza los bg-white usados como fondo de tarjeta/input
        system: {
          DEFAULT: "rgb(var(--color-system) / <alpha-value>)", // verde botica — acento de marca del sistema
          light: "rgb(var(--color-system-light) / <alpha-value>)",
          tint: "rgb(var(--color-system-tint) / <alpha-value>)",
        },
        severidad: {
          critica: "rgb(var(--color-severidad-critica) / <alpha-value>)",
          criticaTint: "rgb(var(--color-severidad-critica-tint) / <alpha-value>)",
          alta: "rgb(var(--color-severidad-alta) / <alpha-value>)",
          altaTint: "rgb(var(--color-severidad-alta-tint) / <alpha-value>)",
          media: "rgb(var(--color-severidad-media) / <alpha-value>)",
          mediaTint: "rgb(var(--color-severidad-media-tint) / <alpha-value>)",
          baja: "rgb(var(--color-severidad-baja) / <alpha-value>)",
          bajaTint: "rgb(var(--color-severidad-baja-tint) / <alpha-value>)",
        },
        estado: {
          pendiente: "rgb(var(--color-estado-pendiente) / <alpha-value>)",
          corregido: "rgb(var(--color-estado-corregido) / <alpha-value>)",
          descartado: "rgb(var(--color-estado-descartado) / <alpha-value>)",
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
        // Color/opacidad de sombra también por variable: una sombra oscura al
        // 5% es invisible sobre fondo oscuro, así que el tema dark usa negro
        // puro con más opacidad (ver --shadow-* en globals.css).
        soft: "0 1px 2px rgb(var(--shadow-color) / var(--shadow-a1)), 0 1px 1px rgb(var(--shadow-color) / var(--shadow-a2))",
        elevated:
          "0 8px 24px -4px rgb(var(--shadow-color) / var(--shadow-a3)), 0 2px 6px -1px rgb(var(--shadow-color) / var(--shadow-a4))",
        ring: "0 0 0 3px rgb(var(--color-system) / 0.14)",
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
