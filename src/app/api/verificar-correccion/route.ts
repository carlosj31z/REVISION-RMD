import { NextRequest, NextResponse } from "next/server";
import { verificarCorreccionRMD } from "@/lib/gemini";
import { verificarCorreccionDeterministica } from "@/lib/comparadorRmd/verificacion";
import type { RMDExtraido, HallazgoAVerificar } from "@/types/rmd";

export const runtime = "nodejs";
export const maxDuration = 120;

interface VerificarCorreccionRequestBody {
  rmdCorregido: RMDExtraido;
  pdfCorregidoBase64?: string;
  hallazgos: HallazgoAVerificar[];
  /**
   * Usa el modelo en vez de la verificación por búsqueda de texto. Apagado
   * por defecto: comprobar si una cita sigue estando en un paso no necesita
   * interpretar lenguaje. Se deja disponible para los hallazgos que no están
   * anclados a un paso con cita (la respuesta informa cuántos son), donde lo
   * determinístico no puede decidir y el modelo sí puede opinar.
   */
  usarIA?: boolean;
}

/**
 * POST /api/verificar-correccion
 * El analista ya corrigió el RMD en SAP y sube el PDF corregido: esto NO
 * vuelve a analizar el documento desde cero, verifica puntualmente cada
 * hallazgo de la revisión original contra el documento corregido.
 *
 * Por defecto la verificación es determinística: busca la cita textual de
 * cada hallazgo en su paso del documento corregido (ver
 * comparadorRmd/verificacion.ts), así que esta ruta dejó de consumir cuota.
 * Con `usarIA: true` se usa el camino anterior con modelo.
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

    if (body.usarIA) {
      const resultado = await verificarCorreccionRMD({
        rmdCorregido: body.rmdCorregido,
        pdfCorregidoBase64: body.pdfCorregidoBase64,
        hallazgos: body.hallazgos,
      });
      return NextResponse.json({ resultado, usoIA: true });
    }

    const { resultado, noVerificables } = verificarCorreccionDeterministica(
      body.rmdCorregido,
      body.hallazgos
    );

    return NextResponse.json({
      resultado,
      usoIA: false,
      // Para que la UI pueda ofrecer el análisis con modelo sólo sobre estas,
      // en vez de gastar una llamada por el lote entero.
      noVerificables: noVerificables.length,
    });
  } catch (err: any) {
    console.error("Error en /api/verificar-correccion:", err);
    return NextResponse.json(
      { error: `Error al verificar la corrección: ${err.message ?? "error desconocido"}` },
      { status: 500 }
    );
  }
}
