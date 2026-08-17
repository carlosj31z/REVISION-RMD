import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// Corre ANTES de la hidratación (strategy="beforeInteractive") para fijar
// data-theme antes del primer paint — evita el flash del tema equivocado
// al cargar. Prioriza lo que el usuario eligió a mano (localStorage);
// si nunca eligió, respeta la preferencia del sistema operativo.
const SCRIPT_TEMA_INICIAL = `
(function () {
  try {
    var guardado = localStorage.getItem('tema');
    var tema = guardado === 'light' || guardado === 'dark'
      ? guardado
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', tema);
  } catch (e) {}
})();
`;

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Revisión de RMD — Control de Cambio",
  description:
    "Detección de discrepancias entre Registros de Manufactura Digital y Controles de Cambio.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // La app ocupa toda la pantalla y ancla barras arriba y abajo: sin
  // viewport-fit=cover, en teléfonos con notch//barra gestual el sistema
  // reserva franjas y las barras quedan flotando. Con cover, el layout
  // llega al borde y cada barra compensa con env(safe-area-inset-*).
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "rgb(247 247 245)" },
    { media: "(prefers-color-scheme: dark)", color: "rgb(20 21 19)" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={`${plexSans.variable} ${plexMono.variable} font-sans bg-paper text-ink antialiased`}>
        <Script id="tema-inicial" strategy="beforeInteractive">
          {SCRIPT_TEMA_INICIAL}
        </Script>
        {children}
      </body>
    </html>
  );
}
