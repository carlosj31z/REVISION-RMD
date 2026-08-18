import { NextRequest, NextResponse } from "next/server";
import { extraerTextoPDF, parsearEstructuraRMD } from "@/lib/pdfExtractor";
import { necesitaOCR, extraerEstructuraPorOCR } from "@/lib/ocrExtractor";

export const runtime = "nodejs";
// El OCR de un escaneo de ~12 páginas no entra en 60 s. Sólo se dispara
// cuando el PDF no tiene capa de texto; la ruta rápida sigue siendo casi
// instantánea.
export const maxDuration = 300;

/**
 * POST /api/extract-pdf
 * Recibe un PDF (multipart/form-data, campo "file") y devuelve:
 *  - la estructura RMD parseada (heurística, sección 6 excluida)
 *  - el texto plano completo (para depuración / fallback)
 *  - el PDF en base64 (para reenviarlo como respaldo visual a Gemini)
 *  - origenExtraccion: "texto" si salió del texto embebido, "ocr" si el PDF
 *    era un escaneo y hubo que reconstruir la estructura leyéndolo con IA.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "Falta el archivo PDF en el campo 'file'." },
        { status: 400 }
      );
    }

    if (file.type !== "application/pdf") {
      return NextResponse.json(
        { error: `Tipo de archivo no soportado: ${file.type}. Solo se aceptan PDFs.` },
        { status: 400 }
      );
    }

    const buffer = await file.arrayBuffer();
    // Ojo: extraerTextoPDF() transfiere/"detacha" el ArrayBuffer al pasarlo a
    // pdf.js, así que hay que sacar el base64 ANTES de llamar a esa función.
    const base64 = Buffer.from(buffer).toString("base64");
    const { texto: textoCompleto, paginaPorLinea, numPaginas } = await extraerTextoPDF(buffer);

    // Escaneo: sin capa de texto no hay nada que parsear. La estructura vacía
    // que salía antes no rompía nada a la vista, pero dejaba sin insumo al
    // cruce de documentos obsoletos, a la navegación por paso del visor y al
    // cuadre de cantidades de insumos. Se reconstruye leyendo el PDF con IA.
    if (necesitaOCR(textoCompleto)) {
      try {
        const { estructura, pasosDetectados } = await extraerEstructuraPorOCR(base64, numPaginas);
        return NextResponse.json({
          estructura,
          textoCompleto,
          pdfBase64: base64,
          nombreArchivo: file.name,
          origenExtraccion: "ocr",
          pasosDetectados,
        });
      } catch (err: any) {
        // Que falle el OCR no debe impedir la revisión: el PDF igual se le
        // adjunta al modelo, que puede leerlo visualmente aunque la
        // estructura vaya vacía. Se avisa para que el analista sepa que las
        // verificaciones que dependen de la estructura no van a correr.
        console.error("OCR falló, se continúa con estructura vacía:", err);
        return NextResponse.json({
          estructura: parsearEstructuraRMD(textoCompleto, paginaPorLinea),
          textoCompleto,
          pdfBase64: base64,
          nombreArchivo: file.name,
          origenExtraccion: "ocr_fallido",
          avisoExtraccion:
            "El PDF es un escaneo y no se pudo reconstruir su estructura: " +
            `${err.message ?? "error desconocido"}. La revisión continúa leyendo el PDF ` +
            "visualmente, pero el cruce de documentos obsoletos y el salto por paso no estarán disponibles.",
        });
      }
    }

    const estructura = parsearEstructuraRMD(textoCompleto, paginaPorLinea);

    return NextResponse.json({
      estructura,
      textoCompleto,
      pdfBase64: base64,
      nombreArchivo: file.name,
      origenExtraccion: "texto",
    });
  } catch (err: any) {
    console.error("Error extrayendo PDF:", err);
    return NextResponse.json(
      { error: `Error al procesar el PDF: ${err.message ?? "error desconocido"}` },
      { status: 500 }
    );
  }
}
