import { NextRequest, NextResponse } from "next/server";
import {
  compararRMDvsBorrador,
  verificarCorreccionVsBorrador,
  verificarCumplimientoSolo,
  type EquipoMaestro,
} from "@/lib/gemini";
import { getSupabaseServerClient } from "@/lib/supabaseClient";
import { cargarReglasAplicables } from "@/lib/reglas";
import { aDiferenciasBorrador, detectarTerminosSinHomologar, separarReglas } from "@/lib/reglasReemplazo";
import { diferenciasMecanicas, fusionarConMecanicas } from "@/lib/comparadorRmd/borrador";
import { detectarAlertasCoherencia } from "@/lib/coherenciaRmd";
import { encolarSiElTiempoLoResuelve } from "@/lib/colaTrabajos";
import { decidirAdjuntarPdfRmd } from "@/lib/adjuntarPdf";
import { buscarRevisionEnCache, huellaEntrada, huellaParaGuardar } from "@/lib/cacheRevisiones";
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
import type { RMDExtraido, ResultadoComparacionBorrador, SeccionCodigo, EtapaCodigo } from "@/types/rmd";

export const runtime = "nodejs";
export const maxDuration = 120;

interface RevisionBorradorRequestBody {
  rmdVigente: RMDExtraido;
  pdfVigenteBase64?: string;
  // Opcional: si no viene, se entiende que el usuario quiere verificar el
  // RMD (en "rmdVigente") por sí solo contra las reglas permanentes y los
  // documentos obsoletos, sin comparar contra ningún borrador de Producción.
  rmdBorrador?: RMDExtraido;
  pdfBorradorBase64?: string;
  // "vigente_vs_borrador" (por defecto): el primer documento todavía NO está
  // corregido y se listan los cambios que el borrador propone.
  // "corregido_vs_borrador": el primer documento YA fue corregido por el
  // analista y lo que se verifica es cuáles indicaciones del borrador siguen
  // pendientes. Son tareas inversas: usar el prompt equivocado hacía que todo
  // apareciera como pendiente aunque ya estuviera aplicado.
  modo?: "vigente_vs_borrador" | "corregido_vs_borrador";
  documentoId?: string;
  seccionCodigo?: string;
  etapaCodigo?: string;
  creadoPor?: string;
  // Adjunta el PDF del RMD vigente al modelo aunque el parseo se vea completo
  // (el del borrador va siempre: es donde están las anotaciones manuscritas).
  forzarPdf?: boolean;
  // Lo pone el worker de la cola al reintentar (ver /api/trabajos/procesar).
  _trabajoId?: string;
}

/**
 * POST /api/revision-borrador
 * Con rmdBorrador: compara el RMD vigente contra un borrador de la próxima
 * versión enviado por Producción (dos documentos RMD completos).
 * Sin rmdBorrador: audita el RMD por sí solo (reglas permanentes, citas
 * cruzadas, cuadre de insumos, equipos retirados, documentos obsoletos) —
 * ver verificarCumplimientoSolo en lib/gemini.ts.
 */
export async function POST(req: NextRequest) {
  try {
    const body: RevisionBorradorRequestBody = await req.json();

    if (!body.rmdVigente) {
      return NextResponse.json(
        { error: "Falta 'rmdVigente' (estructura extraída del PDF)." },
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
    // Las reglas de reemplazo de término se verifican por búsqueda de texto:
    // no van al prompt y no se pueden pasar por alto.
    const { libres: reglasLibres, reemplazos } = separarReglas(reglas);

    // Diferencias mecánicas entre los dos documentos: qué paso se agregó, se
    // quitó, se renumeró o cambió de texto. Sirve de red de seguridad sobre
    // lo que devuelva el modelo, y permite saltear la llamada si no hay nada
    // mecánico que reportar ni reglas de texto libre que interpretar.
    const mecanicas =
      body.rmdBorrador && body.modo !== "corregido_vs_borrador"
        ? diferenciasMecanicas(body.rmdVigente, body.rmdBorrador)
        : null;

    // El término sin homologar se busca en el documento que se está
    // proponiendo: el borrador si hay, el vigente si se revisa solo.
    const documentoDeTerminos = body.rmdBorrador ?? body.rmdVigente;
    const terminosSinHomologar = aDiferenciasBorrador(
      detectarTerminosSinHomologar(documentoDeTerminos, reemplazos),
      body.rmdBorrador ? "borrador" : "vigente"
    );

    const decisionPdf = decidirAdjuntarPdfRmd(body.rmdVigente, body.forzarPdf);

    // Maestros de los cruces determinísticos, cargados una sola vez: entran en
    // la huella de la caché y se reusan más abajo para los cruces. Así un
    // cambio en un maestro que estos documentos usan invalida la revisión
    // guardada, y la foto que se hashea es exactamente la que se cruzó.
    const codigosReferenciados = [
      ...body.rmdVigente.documentosReferenciados,
      ...(body.rmdBorrador?.documentosReferenciados ?? []),
    ].map((d) => d.codigo);
    const codigosEquipos = [
      ...body.rmdVigente.equiposInstrumentos,
      ...(body.rmdBorrador?.equiposInstrumentos ?? []),
    ].map((e) => e.codigo);
    const documentosObsoletos = await cargarDocumentosObsoletosActivos(supabase);
    const documentosVigentes = await cargarDocumentosVigentesPorCodigos(
      supabase,
      codigosReferenciados
    );
    const equiposCalificados = await cargarEquiposCalificadosPorCodigos(supabase, codigosEquipos);

    const huella = huellaEntrada({
      operacion: "compararRMDvsBorrador",
      modo: body.modo ?? "vigente_vs_borrador",
      rmdVigente: body.rmdVigente,
      rmdBorrador: body.rmdBorrador ?? null,
      // El PDF del borrador es parte de la entrada: las anotaciones
      // manuscritas sólo están ahí.
      pdfBorrador: body.pdfBorradorBase64 ?? null,
      adjuntaPdfVigente: decisionPdf.adjuntar,
      equiposMaestro,
      reglas,
      documentosObsoletos,
      documentosVigentes,
      equiposCalificados,
    });
    const cacheado = await buscarRevisionEnCache<ResultadoComparacionBorrador>(
      supabase,
      "borrador_produccion",
      huella,
      "compararRMDvsBorrador"
    );

    if (cacheado) {
      return NextResponse.json({
        resultado: cacheado.resultado,
        advertenciasEquipos: cacheado.resultado.diferenciasDetectadas.filter(
          (d) => d.involucraEquipoRetirado
        ),
        persistido: true,
        revisionId: cacheado.revisionId,
        desdeCache: true,
        analizadoEn: cacheado.creadoEn,
      });
    }

    const comparar =
      body.modo === "corregido_vs_borrador" ? verificarCorreccionVsBorrador : compararRMDvsBorrador;

    // Si los dos documentos son mecánicamente idénticos y no queda ninguna
    // regla que necesite interpretación, el modelo no tiene nada que aportar.
    const puedeSaltearModelo =
      mecanicas !== null && mecanicas.diferencias.length === 0 && reglasLibres.length === 0;

    let resultadoIA: ResultadoComparacionBorrador;
    let usoModelo = true;
    let mecanicasAgregadas = 0;

    if (puedeSaltearModelo) {
      usoModelo = false;
      resultadoIA = {
        resumenEjecutivo:
          "El borrador no propone ninguna diferencia respecto del RMD vigente: los pasos, equipos e insumos " +
          "coinciden uno a uno (comparación textual, ignorando mayúsculas y tildes). No se consultó al modelo " +
          "porque no quedaba nada que interpretar.",
        seccionDetectada: (body.seccionCodigo as SeccionCodigo) ?? "NO_IDENTIFICADA",
        etapaDetectada: (body.etapaCodigo as EtapaCodigo) ?? "NO_IDENTIFICADA",
        diferenciasDetectadas: [],
        alertasCoherencia: [],
        equiposRetiradosDetectados: [],
        coincidenciaPorcentaje: mecanicas.coincidenciaPorcentaje,
        requiereRevisionHumana: false,
      };
    } else {
      try {
      resultadoIA = body.rmdBorrador
        ? await comparar({
            rmdVigente: body.rmdVigente,
            pdfVigenteBase64: decisionPdf.adjuntar ? body.pdfVigenteBase64 : undefined,
            rmdBorrador: body.rmdBorrador,
            // El PDF del borrador va siempre: es donde están las anotaciones
            // manuscritas y el texto sobrepuesto que el modelo necesita ver
            // para marcar origenAnotacionInformal.
            pdfBorradorBase64: body.pdfBorradorBase64,
            equiposMaestro,
            reglas: reglasLibres,
          })
        : await verificarCumplimientoSolo({
            rmd: body.rmdVigente,
            pdfBase64: decisionPdf.adjuntar ? body.pdfVigenteBase64 : undefined,
            equiposMaestro,
            reglas: reglasLibres,
          });
      } catch (err) {
        // Proveedores saturados o sin cuota: a la cola, con la entrada completa.
        const encolado = await encolarSiElTiempoLoResuelve(supabase, err, {
          operacion: "revision_borrador",
          payload: body as unknown as Record<string, unknown>,
          huella,
          creadoPor: body.creadoPor,
          yaEsReintento: Boolean(body._trabajoId),
        });
        if (encolado) return NextResponse.json({ encolado: true, ...encolado }, { status: 202 });
        throw err;
      }

      // Red de seguridad: se agrega toda diferencia mecánica sobre la que el
      // modelo no dijo nada. Mismo patrón que el recálculo de equipos
      // retirados — el modelo propone, el código valida.
      if (mecanicas) {
        const fusion = fusionarConMecanicas(resultadoIA.diferenciasDetectadas, mecanicas.diferencias);
        resultadoIA.diferenciasDetectadas = fusion.diferencias;
        mecanicasAgregadas = fusion.agregadas;
      }
    }

    if (terminosSinHomologar.length > 0) {
      resultadoIA.diferenciasDetectadas = [
        ...resultadoIA.diferenciasDetectadas,
        ...terminosSinHomologar,
      ];
    }

    // Coherencia mecánica en cada documento: citas internas rotas, equipos sin
    // preparación, notas de V°B° faltantes y cuadre de cantidades. El prompt ya
    // no le pide nada de esto al modelo (ver coherenciaRmd.ts).
    const alertasMecanicas = body.rmdBorrador
      ? [
          ...detectarAlertasCoherencia(body.rmdVigente, "RMD vigente"),
          ...detectarAlertasCoherencia(body.rmdBorrador, "borrador de Producción"),
        ]
      : detectarAlertasCoherencia(body.rmdVigente);
    if (alertasMecanicas.length > 0) {
      resultadoIA.alertasCoherencia = [...resultadoIA.alertasCoherencia, ...alertasMecanicas];
    }

    // Documentos obsoletos: cruce determinístico. Si no hay borrador, solo
    // se cruza el único documento recibido.
    const alertasDocumentosObsoletos = body.rmdBorrador
      ? [
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
        ]
      : detectarDocumentosObsoletosReferenciados(
          body.rmdVigente.documentosReferenciados,
          documentosObsoletos
        );
    if (alertasDocumentosObsoletos.length > 0) {
      resultadoIA.alertasCoherencia = [
        ...resultadoIA.alertasCoherencia,
        ...alertasDocumentosObsoletos,
      ];
    }

    // Documentos vigentes (maestro importado del Excel): fuente PRINCIPAL de
    // vigencia — si vigente_hasta ya pasó, alerta igual que un obsoleto
    // manual, y además se adjunta título+fecha de cada documento cruzado
    // para que la UI lo muestre junto al código sin otra consulta.
    const alertasVencidos = body.rmdBorrador
      ? [
          ...detectarDocumentosVencidosReferenciados(
            body.rmdVigente.documentosReferenciados,
            documentosVigentes,
            "RMD vigente"
          ),
          ...detectarDocumentosVencidosReferenciados(
            body.rmdBorrador.documentosReferenciados,
            documentosVigentes,
            "borrador de Producción"
          ),
        ]
      : detectarDocumentosVencidosReferenciados(
          body.rmdVigente.documentosReferenciados,
          documentosVigentes
        );
    if (alertasVencidos.length > 0) {
      resultadoIA.alertasCoherencia = [...resultadoIA.alertasCoherencia, ...alertasVencidos];
    }
    resultadoIA.documentosVigentesInfo = construirInfoDocumentosVigentes(
      [...body.rmdVigente.documentosReferenciados, ...(body.rmdBorrador?.documentosReferenciados ?? [])],
      documentosVigentes
    );

    // Equipos calificados (maestro importado del Excel de OQ/PQ): mismo
    // cruce que en /api/revision, contra los códigos de EQUIPOS/
    // INSTRUMENTOS/MATERIALES de ambos documentos si hay borrador.
    const alertasNoCalificados = body.rmdBorrador
      ? [
          ...detectarEquiposNoCalificadosReferenciados(
            body.rmdVigente.equiposInstrumentos.map((e) => e.codigo),
            equiposCalificados,
            "RMD vigente"
          ),
          ...detectarEquiposNoCalificadosReferenciados(
            body.rmdBorrador.equiposInstrumentos.map((e) => e.codigo),
            equiposCalificados,
            "borrador de Producción"
          ),
        ]
      : detectarEquiposNoCalificadosReferenciados(
          body.rmdVigente.equiposInstrumentos.map((e) => e.codigo),
          equiposCalificados
        );
    if (alertasNoCalificados.length > 0) {
      resultadoIA.alertasCoherencia = [...resultadoIA.alertasCoherencia, ...alertasNoCalificados];
    }
    resultadoIA.equiposCalificacionInfo = construirInfoCalificacionEquipos(
      codigosEquipos,
      equiposCalificados
    );

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
        ...(await huellaParaGuardar(supabase, huella)),
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
      desdeCache: false,
      usoModelo,
      // Cuántas diferencias mecánicas se agregaron porque el modelo no las
      // había reportado: si esto crece seguido, el prompt necesita revisión.
      diferenciasMecanicasAgregadas: mecanicasAgregadas,
      pdfVigenteAdjuntado: decisionPdf.adjuntar,
    });
  } catch (err: any) {
    console.error("Error en /api/revision-borrador:", err);
    return NextResponse.json(
      { error: `Error al procesar la comparación: ${err.message ?? "error desconocido"}` },
      { status: 500 }
    );
  }
}
