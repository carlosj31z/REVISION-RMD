import { NextRequest, NextResponse } from "next/server";
import { extraerTextoPDF, parsearEstructuraRMD } from "@/lib/pdfExtractor";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/extract-pdf
 * Recibe un PDF (multipart/form-data, campo "file") y devuelve:
 *  - la estructura RMD parseada (heurística, sección 6 excluida)
 *  - el texto plano completo (para depuración / fallback)
 *  - el PDF en base64 (para reenviarlo como respaldo visual a Gemini)
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
    const { texto: textoCompleto, paginaPorLinea } = await extraerTextoPDF(buffer);
    const estructura = parsearEstructuraRMD(textoCompleto, paginaPorLinea);

    return NextResponse.json({
      estructura,
      textoCompleto,
      pdfBase64: base64,
      nombreArchivo: file.name,
    });
  } catch (err: any) {
    console.error("Error extrayendo PDF:", err);
    return NextResponse.json(
      { error: `Error al procesar el PDF: ${err.message ?? "error desconocido"}` },
      { status: 500 }
    );
  }
}
