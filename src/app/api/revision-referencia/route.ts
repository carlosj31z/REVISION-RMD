import { NextRequest, NextResponse } from "next/server";
import { compararRMDvsReferencia } from "@/lib/gemini";
import { compararContraReferencia } from "@/lib/comparadorRmd/homologacion";
import { getSupabaseServerClient } from "@/lib/supabaseClient";
import type { RMDExtraido, ResultadoComparacionReferencia } from "@/types/rmd";

export const runtime = "nodejs";
export const maxDuration = 120;

interface RevisionReferenciaRequestBody {
  rmd: RMDExtraido;
  pdfBase64?: string;
  rmdReferencia: RMDExtraido;
  pdfReferenciaBase64?: string;
  documentoId?: string;
  creadoPor?: string;
  /**
   * Pide la comparación con modelo de IA en vez de la determinística. Apagado
   * por defecto: la comparación de estructura y redacción no necesita
   * interpretar lenguaje, y cada corrida con modelo consume cuota. Se deja
   * disponible para cuando el analista quiera además el criterio semántico
   * ("estos dos pasos redactados distinto significan lo mismo"), que es lo
   * único que el modelo aporta acá.
   */
  usarIA?: boolean;
}

/**
 * POST /api/revision-referencia
 * Compara el RMD a evaluar contra un RMD de referencia (de otro producto o
 * línea) para sugerir homologación de redacción/orden/estructura donde
 * corresponda — deliberadamente NO corre los cruces de reglas permanentes/
 * documentos/equipos de las otras dos rutas: es un análisis de estructura
 * entre dos documentos, no una auditoría de cumplimiento.
 *
 * Por defecto la comparación es 100% determinística (ver
 * comparadorRmd/homologacion.ts): emparejar pasos y comparar textos no
 * requiere un modelo, y así esta ruta dejó de consumir cuota de Gemini.
 * Con `usarIA: true` se usa el camino anterior con modelo.
 */
export async function POST(req: NextRequest) {
  try {
    const body: RevisionReferenciaRequestBody = await req.json();

    if (!body.rmd) {
      return NextResponse.json(
        { error: "Falta 'rmd' (estructura extraída del RMD a evaluar)." },
        { status: 400 }
      );
    }
    if (!body.rmdReferencia) {
      return NextResponse.json(
        { error: "Falta 'rmdReferencia' (estructura extraída del RMD de referencia)." },
        { status: 400 }
      );
    }

    let resultadoIA: ResultadoComparacionReferencia;
    if (body.usarIA) {
      resultadoIA = await compararRMDvsReferencia({
        rmd: body.rmd,
        pdfBase64: body.pdfBase64,
        rmdReferencia: body.rmdReferencia,
        pdfReferenciaBase64: body.pdfReferenciaBase64,
      });
    } else {
      resultadoIA = compararContraReferencia(body.rmd, body.rmdReferencia);
    }

    const supabase = getSupabaseServerClient();
    const { data: revisionGuardada, error: insertError } = await supabase
      .from("revisiones")
      .insert({
        documento_id: body.documentoId ?? null,
        tipo: "referencia_homologacion",
        estado: "en_revision",
        resultado_ia: resultadoIA,
        score_coherencia: resultadoIA.gradoHomologacion,
        creado_por: body.creadoPor ?? null,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Error guardando revisión en Supabase:", insertError);
      return NextResponse.json({
        resultado: resultadoIA,
        persistido: false,
        usoIA: body.usarIA === true,
        avisoPersistencia: `No se pudo guardar la revisión en la base de datos: ${insertError.message}`,
      });
    }

    return NextResponse.json({
      resultado: resultadoIA,
      persistido: true,
      revisionId: revisionGuardada.id,
      usoIA: body.usarIA === true,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Error al comparar contra la referencia: ${err.message ?? "error desconocido"}` },
      { status: 500 }
    );
  }
}
