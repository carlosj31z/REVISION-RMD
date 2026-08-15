// Copia el worker de pdfjs-dist a public/ para que se sirva como archivo
// estático tal cual, sin pasar por el bundler de webpack. pdfjs-dist v6
// distribuye pdf.worker.min.mjs como módulo ESM puro (usa import.meta); si
// webpack lo empaqueta como asset vía `new URL(..., import.meta.url)`,
// Next.js corre Terser sobre ese chunk y falla con
// "'import.meta' cannot be used outside of module code" en el build de
// producción (no ocurre en `next dev`, solo en `next build`/Vercel).
// Se corre automáticamente en postinstall para que siempre quede
// sincronizado con la versión de pdfjs-dist instalada.

const fs = require("fs");
const path = require("path");

const origen = path.join(
  __dirname,
  "..",
  "node_modules",
  "pdfjs-dist",
  "build",
  "pdf.worker.min.mjs"
);
const carpetaDestino = path.join(__dirname, "..", "public");
const destino = path.join(carpetaDestino, "pdf.worker.min.mjs");

if (!fs.existsSync(origen)) {
  console.warn(
    "[copy-pdf-worker] No se encontró node_modules/pdfjs-dist/build/pdf.worker.min.mjs — " +
      "¿cambió la estructura del paquete pdfjs-dist? Revisar VisorPdf.tsx."
  );
  process.exit(0);
}

fs.mkdirSync(carpetaDestino, { recursive: true });
fs.copyFileSync(origen, destino);
console.log("[copy-pdf-worker] pdf.worker.min.mjs copiado a public/");
