import { NextRequest, NextResponse } from "next/server";
import { verificarCorreccionRMD } from "@/lib/gemini";
import type { RMDExtraido, HallazgoAVerificar } from "@/types/rmd";

export const runtime = "nodejs";
export const maxDuration = 120;

interface VerificarCorreccionRequestBody {
  rmdCorregido: RMDExtraido;
  pdfCorregidoBase64?: string;
  hallazgos: HallazgoAVerificar[];
}

/**
 * POST /api/verificar-correccion
 * El analista ya corrigió el RMD en SAP y sube el PDF corregido: esto NO
 * vuelve a analizar el documento desde cero, verifica puntualmente cada
 * hallazgo de la revisión original contra el documento corregido.
 */
export async function POST(req: NextRequest) {
  try {
    const body: VerificarCorreccionRequestBody = await req.json();

    if (!body.rmdCorregido) {
      return NextResponse.json(
        { error: "Falta 'rmdCorregido' (estructura extraída del PDF corregido)." },
        { status: 400 }
      );
    }
    if (!body.hallazgos || body.hallazgos.length === 0) {
      return NextResponse.json(
        { error: "Falta 'hallazgos': la lista de observaciones a verificar." },
        { status: 400 }
      );
    }

    const resultado = await verificarCorreccionRMD({
      rmdCorregido: body.rmdCorregido,
      pdfCorregidoBase64: body.pdfCorregidoBase64,
      hallazgos: body.hallazgos,
    });

    return NextResponse.json({ resultado });
  } catch (err: any) {
    console.error("Error en /api/verificar-correccion:", err);
    return NextResponse.json(
      { error: `Error al verificar la corrección: ${err.message ?? "error desconocido"}` },
      { status: 500 }
    );
  }
}
