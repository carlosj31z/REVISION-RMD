import { NextRequest, NextResponse } from "next/server";
import { compararRMDvsControlCambios, type EquipoMaestro } from "@/lib/gemini";
import { getSupabaseServerClient } from "@/lib/supabaseClient";
import { cargarReglasAplicables } from "@/lib/reglas";
import { aDiscrepancias, detectarTerminosSinHomologar, separarReglas } from "@/lib/reglasReemplazo";
import {
  cargarDocumentosObsoletosActivos,
  detectarDocumentosObsoletosReferenciados,
} from "@/lib/documentosObsoletos";
import {
  cargarDocumentosVigentesPorCodigos,
  construirInfoDocumentosVigentes,
  detectarDocumentosVencidosReferenciados,
} from "@/lib/documentosVigentes";
import {
  cargarEquiposCalificadosPorCodigos,
  construirInfoCalificacionEquipos,
  detectarEquiposNoCalificadosReferenciados,
} from "@/lib/equiposCalificados";
import { extraerTextoPDF, parsearEstructuraRMD } from "@/lib/pdfExtractor";
import { buscarRevisionEnCache, huellaEntrada, huellaParaGuardar } from "@/lib/cacheRevisiones";
import { decidirAdjuntarPdfRmd } from "@/lib/adjuntarPdf";
import type { RMDExtraido, ResultadoRevisionIA } from "@/types/rmd";

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
  // Análisis a fondo: adjunta el PDF al modelo aunque el parseo se vea
  // completo (ver decidirAdjuntarPdfRmd). Cuesta bastante más cuota.
  forzarPdf?: boolean;
}

/**
 * POST /api/revision
 * Orquesta la comparación completa:
 *  1. Carga desde Supabase el maestro de equipos (fuente de verdad), las
 *     reglas permanentes y los maestros de los cruces determinísticos.
 *  2. Si esta misma entrada ya se analizó, devuelve el resultado guardado sin
 *     gastar una llamada al modelo (ver cacheRevisiones.ts).
 *  3. Si no, llama a Gemini con el RMD vigente + Control de Cambio + maestro
 *     de equipos, adjuntando el PDF sólo si el parseo quedó corto.
 *  4. Corre los cruces determinísticos y persiste el resultado en `revisiones`.
 *  5. Devuelve el resultado estructurado para la UI de Diff-Check.
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
    //     Las de reemplazo de término se verifican por búsqueda de texto más
    //     abajo, así que no se le mandan al modelo: sólo viajan al prompt las
    //     que necesitan interpretación.
    const reglas = await cargarReglasAplicables(supabase, body.seccionCodigo, body.etapaCodigo);
    const { libres: reglasLibres, reemplazos } = separarReglas(reglas);

    // 1c. Maestros de los cruces determinísticos. Se cargan ANTES de llamar
    //     al modelo porque entran en la huella de la caché: si cambia un
    //     maestro que este documento efectivamente usa, la revisión guardada
    //     deja de servir y hay que rehacerla. Los cruces se corren más abajo.
    const codigosDocumentos = body.rmdVigente.documentosReferenciados.map((d) => d.codigo);
    const codigosEquipos = body.rmdVigente.equiposInstrumentos.map((e) => e.codigo);
    const documentosObsoletos = await cargarDocumentosObsoletosActivos(supabase);
    const documentosVigentes = await cargarDocumentosVigentesPorCodigos(
      supabase,
      codigosDocumentos
    );
    const equiposCalificados = await cargarEquiposCalificadosPorCodigos(supabase, codigosEquipos);

    // 1d. El PDF crudo sólo se adjunta si el parseo quedó corto: es lo que más
    //     cuota consume de cada llamada y aporta sólo cuando falta algo.
    const decisionPdf = decidirAdjuntarPdfRmd(body.rmdVigente, body.forzarPdf);

    // 1e. ¿Esta misma entrada ya se analizó? Entonces no se gasta cuota.
    const huella = huellaEntrada({
      operacion: "compararRMDvsControlCambios",
      rmdVigente: body.rmdVigente,
      controlDeCambioTexto: body.controlDeCambioTexto ?? null,
      // El PDF del Control de Cambios puede ser la única fuente de su texto,
      // así que su contenido es parte de la entrada.
      pdfControlCambio: body.pdfControlCambioBase64 ?? null,
      adjuntaPdfVigente: decisionPdf.adjuntar,
      equiposMaestro,
      reglas,
      documentosObsoletos,
      documentosVigentes,
      equiposCalificados,
    });
    const cacheado = await buscarRevisionEnCache<ResultadoRevisionIA>(
      supabase,
      "control_cambio",
      huella,
      "compararRMDvsControlCambios"
    );

    if (cacheado) {
      // Los cruces determinísticos ya están dentro del resultado guardado, y
      // la huella garantiza que ningún maestro que este documento use cambió
      // desde entonces: devolverlo tal cual equivale a recalcular todo.
      return NextResponse.json({
        resultado: cacheado.resultado,
        advertenciasEquipos: cacheado.resultado.discrepanciasDetectadas.filter(
          (d) => d.involucraEquipoRetirado
        ),
        persistido: true,
        revisionId: cacheado.revisionId,
        desdeCache: true,
        analizadoEn: cacheado.creadoEn,
      });
    }

    // 2. Comparación con Gemini
    const resultadoIA = await compararRMDvsControlCambios({
      rmdVigente: body.rmdVigente,
      pdfVigenteBase64: decisionPdf.adjuntar ? body.pdfVigenteBase64 : undefined,
      controlDeCambioTexto: body.controlDeCambioTexto,
      pdfControlCambioBase64: body.pdfControlCambioBase64,
      equiposMaestro,
      reglas: reglasLibres,
    });

    // 2a. Reglas de reemplazo de término: búsqueda determinística, no depende
    //     de que el modelo no se saltee ninguna.
    const terminosSinHomologar = detectarTerminosSinHomologar(body.rmdVigente, reemplazos);
    if (terminosSinHomologar.length > 0) {
      resultadoIA.discrepanciasDetectadas = [
        ...resultadoIA.discrepanciasDetectadas,
        ...aDiscrepancias(terminosSinHomologar),
      ];
    }

    // 2b. Documentos obsoletos: cruce determinístico (no depende del modelo)
    //     entre lo citado en el RMD vigente y el maestro de obsoletos.
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

    // 2d. Equipos calificados (maestro importado del Excel de OQ/PQ): cruce
    //     determinístico contra los códigos citados en EQUIPOS/INSTRUMENTOS/
    //     MATERIALES — "CALIFICADO" es lo esperado, cualquier otro estado alerta.
    const alertasNoCalificados = detectarEquiposNoCalificadosReferenciados(
      codigosEquipos,
      equiposCalificados
    );
    if (alertasNoCalificados.length > 0) {
      resultadoIA.alertasCoherencia = [...resultadoIA.alertasCoherencia, ...alertasNoCalificados];
    }
    resultadoIA.equiposCalificacionInfo = construirInfoCalificacionEquipos(
      codigosEquipos,
      equiposCalificados
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
        ...(await huellaParaGuardar(supabase, huella)),
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
      desdeCache: false,
      pdfAdjuntado: decisionPdf.adjuntar,
      motivoPdf: decisionPdf.motivo,
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
