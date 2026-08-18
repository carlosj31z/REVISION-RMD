import { NextRequest, NextResponse } from "next/server";
import { generarNomenclaturaControlCambio } from "@/lib/nomenclaturaControlCambio";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/control-cambio/nomenclatura
 * multipart/form-data con "texto" (string) o "file" (PDF) — igual al toggle
 * texto/PDF que ya usa FormularioCarga para el Control de Cambio. No
 * requiere ningún RMD: arma la nomenclatura a partir del Control de Cambio
 * solo.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const texto = formData.get("texto");
    const file = formData.get("file");

    const textoLimpio = typeof texto === "string" ? texto.trim() : "";
    const tieneArchivo = file instanceof File;

    if (!textoLimpio && !tieneArchivo) {
      return NextResponse.json(
        { error: "Pegá el texto del Control de Cambio o adjuntá su PDF." },
        { status: 400 }
      );
    }

    let pdfBase64: string | undefined;
    if (tieneArchivo) {
      if ((file as File).type !== "application/pdf") {
        return NextResponse.json(
          { error: `Tipo de archivo no soportado: ${(file as File).type}. Solo se aceptan PDFs.` },
          { status: 400 }
        );
      }
      const buffer = await (file as File).arrayBuffer();
      pdfBase64 = Buffer.from(buffer).toString("base64");
    }

    const nomenclatura = await generarNomenclaturaControlCambio({
      texto: textoLimpio || undefined,
      pdfBase64,
    });

    return NextResponse.json({ nomenclatura });
  } catch (err: any) {
    console.error("Error en /api/control-cambio/nomenclatura:", err);
    return NextResponse.json(
      { error: `No se pudo generar la nomenclatura: ${err.message ?? "error desconocido"}` },
      { status: 500 }
    );
  }
}
