"use client";

/**
 * Genera una captura recortada de una página del PDF con el mismo resaltado
 * amarillo que el visor en pantalla, para usar en el informe exportable (ver
 * exportarInformeCorrecciones.ts). Reutiliza la MISMA geometría que
 * VisorPdf.tsx (calcularRectangulosResaltado/Seccion) para que la captura
 * marque exactamente lo mismo que el analista ve al hacer clic en la
 * tarjeta — sin esto, cualquier drift entre ambos cálculos confundiría más
 * de lo que ayuda.
 */

import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  calcularEscala,
  calcularRectangulosResaltado,
  calcularRectangulosResaltadoSeccion,
  type RectanguloResaltado,
} from "./resaltadoPdf";
import type { SeccionGeneral } from "@/types/rmd";

export interface SaltoCaptura {
  pagina: number;
  pasoId?: string | null;
  seccionGeneral?: SeccionGeneral | null;
  textoBuscado?: string | null;
}

// Ancho de referencia para la captura: más nítido que la pantalla típica
// (donde el visor ajusta al ancho del contenedor), para que el texto se lea
// bien incluso ya recortado e insertado en el PDF del informe.
const ANCHO_CAPTURA = 1400;
// Margen alrededor del fragmento señalado (o del rango completo si no hay
// fragmento puntual): alcanza para mostrar el renglón anterior/siguiente
// como contexto sin arrastrar el paso entero si es muy largo — el objetivo
// es una captura rápida de leer, no exhaustiva.
const MARGEN_X = 40;
const MARGEN_Y = 90;

let workerConfigurado = false;

export interface CapturaResaltado {
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * Carga el documento UNA sola vez para reutilizar entre varias capturas —
 * el informe puede tener una docena de hallazgos, y volver a parsear el PDF
 * entero por cada uno (como hacía la primera versión) lo hacía notoriamente
 * lento sin necesidad.
 */
export async function cargarDocumentoPdf(file: File): Promise<PDFDocumentProxy> {
  const pdfjsLib = await import("pdfjs-dist");
  if (!workerConfigurado) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    workerConfigurado = true;
  }
  const buffer = await file.arrayBuffer();
  return pdfjsLib.getDocument({ data: buffer }).promise;
}

export async function capturarResaltadoPdf(
  file: File,
  salto: SaltoCaptura
): Promise<CapturaResaltado | null> {
  const doc = await cargarDocumentoPdf(file);
  return capturarResaltadoPagina(doc, salto);
}

export async function capturarResaltadoPagina(
  doc: PDFDocumentProxy,
  salto: SaltoCaptura
): Promise<CapturaResaltado | null> {
  if (!salto.pasoId && !salto.seccionGeneral) return null;

  try {
    if (salto.pagina < 1 || salto.pagina > doc.numPages) return null;

    const page = await doc.getPage(salto.pagina);
    const viewportBase = page.getViewport({ scale: 1 });
    const escala = calcularEscala(viewportBase.width, ANCHO_CAPTURA);
    const viewport = page.getViewport({ scale: escala });

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;

    const contenido = await page.getTextContent();
    const rects = salto.pasoId
      ? calcularRectangulosResaltado(
          contenido as any,
          viewport.transform,
          escala,
          salto.pasoId,
          salto.textoBuscado ?? undefined
        )
      : calcularRectangulosResaltadoSeccion(
          contenido as any,
          viewport.transform,
          escala,
          salto.seccionGeneral!,
          salto.textoBuscado ?? undefined
        );

    if (rects.length === 0) return null;

    for (const r of rects) {
      ctx.fillStyle = r.foco ? "rgba(255, 214, 10, 0.5)" : "rgba(255, 214, 10, 0.18)";
      ctx.fillRect(r.x, r.y, r.width, r.height);
      if (r.foco) {
        ctx.strokeStyle = "rgba(196, 130, 0, 0.95)";
        ctx.lineWidth = 2.5;
        ctx.strokeRect(r.x + 1, r.y + 1, r.width - 2, r.height - 2);
      }
    }

    // Recorta alrededor del fragmento puntual si se encontró (más útil para
    // identificar rápido la corrección); si no, alrededor de todo el rango
    // resaltado (el paso/sección entera, que ya viene con un tope razonable
    // de líneas — ver calcularRectangulosResaltado).
    const focales = rects.filter((r) => r.foco);
    const base = focales.length > 0 ? focales : rects;
    const caja = cajaDelimitadora(base);

    const cropX = Math.max(0, caja.minX - MARGEN_X);
    const cropY = Math.max(0, caja.minY - MARGEN_Y);
    const cropW = Math.min(canvas.width, caja.maxX + MARGEN_X) - cropX;
    const cropH = Math.min(canvas.height, caja.maxY + MARGEN_Y) - cropY;
    if (cropW <= 0 || cropH <= 0) {
      return { dataUrl: canvas.toDataURL("image/jpeg", 0.88), width: canvas.width, height: canvas.height };
    }

    const recorte = document.createElement("canvas");
    recorte.width = cropW;
    recorte.height = cropH;
    const ctxRecorte = recorte.getContext("2d");
    if (!ctxRecorte) {
      return { dataUrl: canvas.toDataURL("image/jpeg", 0.88), width: canvas.width, height: canvas.height };
    }
    ctxRecorte.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    return { dataUrl: recorte.toDataURL("image/jpeg", 0.9), width: cropW, height: cropH };
  } catch (err) {
    console.error("No se pudo generar la captura resaltada para el informe:", err);
    return null;
  }
}

function cajaDelimitadora(rects: RectanguloResaltado[]) {
  return {
    minX: Math.min(...rects.map((r) => r.x)),
    maxX: Math.max(...rects.map((r) => r.x + r.width)),
    minY: Math.min(...rects.map((r) => r.y)),
    maxY: Math.max(...rects.map((r) => r.y + r.height)),
  };
}
