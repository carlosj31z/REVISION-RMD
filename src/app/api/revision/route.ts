import { NextRequest, NextResponse } from "next/server";
import { compararRMDvsControlCambios, type EquipoMaestro } from "@/lib/gemini";
import { getSupabaseServerClient } from "@/lib/supabaseClient";
import { cargarReglasAplicables } from "@/lib/reglas";
import {
  cargarDocumentosObsoletosActivos,
  detectarDocumentosObsoletosReferenciados,
} from "@/lib/documentosObsoletos";
import {
  cargarDocumentosVigentesPorCodigos,
  construirInfoDocumentosVigentes,
  detectarDocumentosVencidosReferenciados,
} from "@/lib/documentosVigentes";
import { extraerTextoPDF, parsearEstructuraRMD } from "@/lib/pdfExtractor";
import type { RMDExtraido } from "@/types/rmd";

export const runtime = "nodejs";
export const maxDuration = 120;

interface RevisionRequestBody {
  rmdVigente: RMDExtraido;
  pdfVigenteBase64?: string;
  controlDeCambioTexto?: string;
  pdfControlCambioBase64?: string;
  documentoId?: string; // si ya existe un registro en `documentos`, para asociar la revisión
  seccionCodigo?: string;
  etapaCodigo?: string;
  creadoPor?: string;
}

/**
 * POST /api/revision
 * Orquesta la comparación completa:
 *  1. Carga el maestro de equipos vigente desde Supabase (fuente de verdad).
 *  2. Llama a Gemini con el RMD vigente + Control de Cambio + maestro de equipos.
 *  3. Persiste el resultado en `revisiones`.
 *  4. Devuelve el resultado estructurado para la UI de Diff-Check.
 */
export async function POST(req: NextRequest) {
  try {
    const body: RevisionRequestBody = await req.json();

    if (!body.rmdVigente) {
      return NextResponse.json(
        { error: "Falta 'rmdVigente' (estructura extraída del PDF)." },
        { status: 400 }
      );
    }
    if (!body.controlDeCambioTexto && !body.pdfControlCambioBase64) {
      return NextResponse.json(
        {
          error:
            "Falta el Control de Cambio: envía 'controlDeCambioTexto' (texto libre) o 'pdfControlCambioBase64' (PDF).",
        },
        { status: 400 }
      );
    }

    const supabase = getSupabaseServerClient();

    // 1. Maestro de equipos vigente — filtrado por sección/etapa si se conoce,
    //    para no saturar el prompt con equipos de otras líneas de producción.
    let equiposQuery = supabase.from("equipos").select("codigo, descripcion, activo");
    if (body.seccionCodigo) {
      const { data: seccion } = await supabase
        .from("secciones")
        .select("id")
        .eq("codigo", body.seccionCodigo)
        .single();
      if (seccion) equiposQuery = equiposQuery.eq("seccion_id", seccion.id);
    }
    const { data: equiposData, error: equiposError } = await equiposQuery;

    if (equiposError) {
      console.error("Error cargando maestro de equipos:", equiposError);
      // No abortamos: seguimos sin maestro de equipos, pero avisamos en la respuesta.
    }
    const equiposMaestro: EquipoMaestro[] = equiposData ?? [];

    // 1b. Reglas permanentes de homologación aplicables a esta sección/etapa.
    const reglas = await cargarReglasAplicables(supabase, body.seccionCodigo, body.etapaCodigo);

    // 2. Comparación con Gemini
    const resultadoIA = await compararRMDvsControlCambios({
      rmdVigente: body.rmdVigente,
      pdfVigenteBase64: body.pdfVigenteBase64,
      controlDeCambioTexto: body.controlDeCambioTexto,
      pdfControlCambioBase64: body.pdfControlCambioBase64,
      equiposMaestro,
      reglas,
    });

    // 2b. Documentos obsoletos: cruce determinístico (no depende del modelo)
    //     entre lo citado en el RMD vigente y el maestro de obsoletos.
    const documentosObsoletos = await cargarDocumentosObsoletosActivos(supabase);
    const alertasDocumentosObsoletos = detectarDocumentosObsoletosReferenciados(
      body.rmdVigente.documentosReferenciados,
      documentosObsoletos
    );
    if (alertasDocumentosObsoletos.length > 0) {
      resultadoIA.alertasCoherencia = [
        ...resultadoIA.alertasCoherencia,
        ...alertasDocumentosObsoletos,
      ];
    }

    // 2c. Documentos vigentes (maestro importado del Excel): fuente
    //     PRINCIPAL de vigencia — ver detectarDocumentosVencidosReferenciados.
    const documentosVigentes = await cargarDocumentosVigentesPorCodigos(
      supabase,
      body.rmdVigente.documentosReferenciados.map((d) => d.codigo)
    );
    const alertasVencidos = detectarDocumentosVencidosReferenciados(
      body.rmdVigente.documentosReferenciados,
      documentosVigentes
    );
    if (alertasVencidos.length > 0) {
      resultadoIA.alertasCoherencia = [...resultadoIA.alertasCoherencia, ...alertasVencidos];
    }
    resultadoIA.documentosVigentesInfo = construirInfoDocumentosVigentes(
      body.rmdVigente.documentosReferenciados,
      documentosVigentes
    );

    // 3. Persistir la revisión (si no hay documentoId, se guarda igual como
    //    revisión "suelta"; documentoId es opcional para permitir pruebas rápidas)
    const advertenciasEquipos = resultadoIA.discrepanciasDetectadas.filter(
      (d) => d.involucraEquipoRetirado
    );

    const { data: revisionGuardada, error: insertError } = await supabase
      .from("revisiones")
      .insert({
        documento_id: body.documentoId ?? null,
        estado: "en_revision",
        resultado_ia: resultadoIA,
        score_coherencia: resultadoIA.scoreCoherencia,
        advertencias_equipos: advertenciasEquipos,
        creado_por: body.creadoPor ?? null,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Error guardando revisión en Supabase:", insertError);
      // Devolvemos el resultado igual: el analista no debería perder el análisis
      // por un fallo de persistencia, pero lo marcamos explícitamente.
      return NextResponse.json({
        resultado: resultadoIA,
        advertenciasEquipos,
        persistido: false,
        avisoPersistencia: `No se pudo guardar la revisión en la base de datos: ${insertError.message}`,
      });
    }

    return NextResponse.json({
      resultado: resultadoIA,
      advertenciasEquipos,
      persistido: true,
      revisionId: revisionGuardada.id,
    });
  } catch (err: any) {
    console.error("Error en /api/revision:", err);
    return NextResponse.json(
      { error: `Error al procesar la revisión: ${err.message ?? "error desconocido"}` },
      { status: 500 }
    );
  }
}

/**
 * GET /api/revision?id=<uuid>
 * Recupera una revisión ya guardada (para volver a abrirla en la UI).
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Falta el parámetro 'id'." }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("revisiones")
    .select("*, revision_decisiones(*)")
    .eq("id", id)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }

  return NextResponse.json(data);
}
