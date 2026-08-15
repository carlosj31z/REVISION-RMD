import type { Metadata } from "next";
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
