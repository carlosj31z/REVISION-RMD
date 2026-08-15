import { NextRequest, NextResponse } from "next/server";
import { compararRMDvsBorrador, type EquipoMaestro } from "@/lib/gemini";
import { getSupabaseServerClient } from "@/lib/supabaseClient";
import { cargarReglasAplicables } from "@/lib/reglas";
import {
  cargarDocumentosObsoletosActivos,
  detectarDocumentosObsoletosReferenciados,
} from "@/lib/documentosObsoletos";
import type { RMDExtraido } from "@/types/rmd";

export const runtime = "nodejs";
export const maxDuration = 120;

interface RevisionBorradorRequestBody {
  rmdVigente: RMDExtraido;
  pdfVigenteBase64?: string;
  rmdBorrador: RMDExtraido;
  pdfBorradorBase64?: string;
  documentoId?: string;
  seccionCodigo?: string;
  etapaCodigo?: string;
  creadoPor?: string;
}

/**
 * POST /api/revision-borrador
 * Compara el RMD vigente contra un borrador de la próxima versión enviado
 * por Producción (dos documentos RMD completos, no una instrucción de
 * cambio). Misma orquestación que /api/revision: maestro de equipos +
 * Gemini + persistencia en `revisiones` (tipo = 'borrador_produccion').
 */
export async function POST(req: NextRequest) {
  try {
    const body: RevisionBorradorRequestBody = await req.json();

    if (!body.rmdVigente) {
      return NextResponse.json(
        { error: "Falta 'rmdVigente' (estructura extraída del PDF vigente)." },
        { status: 400 }
      );
    }
    if (!body.rmdBorrador) {
      return NextResponse.json(
        { error: "Falta 'rmdBorrador' (estructura extraída del PDF del borrador de Producción)." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseServerClient();

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
    }
    const equiposMaestro: EquipoMaestro[] = equiposData ?? [];
    const reglas = await cargarReglasAplicables(supabase, body.seccionCodigo, body.etapaCodigo);

    const resultadoIA = await compararRMDvsBorrador({
      rmdVigente: body.rmdVigente,
      pdfVigenteBase64: body.pdfVigenteBase64,
      rmdBorrador: body.rmdBorrador,
      pdfBorradorBase64: body.pdfBorradorBase64,
      equiposMaestro,
      reglas,
    });

    // Documentos obsoletos: cruce determinístico contra ambos documentos.
    const documentosObsoletos = await cargarDocumentosObsoletosActivos(supabase);
    const alertasDocumentosObsoletos = [
      ...detectarDocumentosObsoletosReferenciados(
        body.rmdVigente.documentosReferenciados,
        documentosObsoletos,
        "RMD vigente"
      ),
      ...detectarDocumentosObsoletosReferenciados(
        body.rmdBorrador.documentosReferenciados,
        documentosObsoletos,
        "borrador de Producción"
      ),
    ];
    if (alertasDocumentosObsoletos.length > 0) {
      resultadoIA.alertasCoherencia = [
        ...resultadoIA.alertasCoherencia,
        ...alertasDocumentosObsoletos,
      ];
    }

    const advertenciasEquipos = resultadoIA.diferenciasDetectadas.filter(
      (d) => d.involucraEquipoRetirado
    );

    const { data: revisionGuardada, error: insertError } = await supabase
      .from("revisiones")
      .insert({
        documento_id: body.documentoId ?? null,
        tipo: "borrador_produccion",
        estado: "en_revision",
        resultado_ia: resultadoIA,
        score_coherencia: resultadoIA.coincidenciaPorcentaje,
        advertencias_equipos: advertenciasEquipos,
        creado_por: body.creadoPor ?? null,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Error guardando revisión en Supabase:", insertError);
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
    console.error("Error en /api/revision-borrador:", err);
    return NextResponse.json(
      { error: `Error al procesar la comparación: ${err.message ?? "error desconocido"}` },
      { status: 500 }
    );
  }
}
