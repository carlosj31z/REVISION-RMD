import type {
  RMDExtraido,
  ResultadoComparacionReferencia,
  SeccionGeneral,
  SugerenciaHomologacionReferencia,
} from "@/types/rmd";
import { compararRmd, type DiffLineas, type DiffRmd } from "./diff";

// Comparación contra un RMD de referencia, sin modelo de IA.
//
// Esta comparación busca pasos con estructura o contenido equivalente entre
// el RMD que se evalúa y uno ya estandarizado, para sugerir homologar
// redacción, orden o estructura. Nada de eso necesita interpretar lenguaje:
// es emparejar pasos y comparar textos. Devuelve exactamente el mismo
// contrato que devolvía el modelo (ResultadoComparacionReferencia), así que
// la UI no cambia.
//
// Lo que el modelo sí hacía y esto no: decidir que dos pasos redactados
// distinto "significan lo mismo, ignoralo". Acá siempre se reporta la
// diferencia con las dos citas al lado, y el criterio queda en el analista —
// que es quien firma. A cambio, no inventa equivalencias y el informe es
// reproducible.
//
// Qué se compara y qué no:
//   * procedimiento, precauciones, notas importantes y condiciones
//     ambientales: sí. Son el cuerpo del registro y el texto repetido que un
//     RMD de referencia justamente sirve para estandarizar.
//   * insumos: no. Cambian por fórmula, así que entre dos productos
//     distintos toda diferencia sería ruido esperable.
//   * equipos: sólo cuando el MISMO código está descrito distinto. Que un
//     producto use otros equipos es normal; que el mismo equipo se llame de
//     dos formas es justamente lo que hay que homologar.

/** Orden natural del documento: estas secciones van antes del procedimiento. */
const ORDEN_SECCION: Record<SeccionGeneral, number> = {
  precauciones: -4,
  notas_importantes: -3,
  condiciones_ambientales: -2,
  equipos_instrumentos: -1,
};

interface SugerenciaOrdenada {
  sugerencia: SugerenciaHomologacionReferencia;
  /** Posición en el documento evaluado, para listar en orden de trabajo. */
  orden: number;
}

/**
 * Qué significa nivelConfianza acá. En la versión con modelo era "qué tan
 * seguro está el modelo de la detección". Determinísticamente la detección es
 * siempre certera — el texto está o no está —, así que el campo se usa para
 * lo que de verdad queda incierto: si el hallazgo AMERITA acción. Un paso que
 * la referencia no tiene y que no se parece a nada suele ser legítimamente
 * propio del producto; uno con el mismo número y otra redacción casi siempre
 * hay que homologarlo. La justificación siempre dice cuál de los dos casos es.
 */
function confianzaPorSimilitud(similitud: number): "alta" | "media" | "baja" {
  if (similitud >= 0.9) return "alta";
  if (similitud >= 0.6) return "media";
  return "baja";
}

/**
 * Un paso sin pareja se juzga por lo más cercano que haya enfrente: si existe
 * algo medianamente parecido, probablemente sean el mismo paso del proceso
 * escrito muy distinto y vale mirarlo; si no hay nada parecido, entre dos
 * productos distintos eso es lo habitual y casi nunca hay que hacer nada.
 */
function describirCandidato(
  candidato: { paso: { id: string }; similitud: number } | null,
  dondeBuscar: string
): { texto: string; confianza: "alta" | "media" | "baja" } {
  if (candidato && candidato.similitud >= 0.5) {
    return {
      confianza: "media",
      texto:
        `Lo más parecido en ${dondeBuscar} es el paso ${candidato.paso.id} ` +
        `(${Math.round(candidato.similitud * 100)}% de palabras en común), que no alcanza para tratarlos como ` +
        "el mismo paso: revisá si conviene homologarlos.",
    };
  }
  const cuanCerca =
    candidato && candidato.similitud > 0
      ? ` (lo más cercano, el paso ${candidato.paso.id}, comparte ${Math.round(candidato.similitud * 100)}% de las palabras)`
      : "";
  return {
    confianza: "baja",
    texto:
      `No hay nada parecido en ${dondeBuscar}${cuanCerca}. Entre productos distintos eso es lo habitual, ` +
      "porque cada uno tiene su fórmula, equipos y tiempos: sólo corresponde actuar si esperabas que los dos " +
      "documentos llevaran este paso.",
  };
}

function sugerenciasDeLineas(
  diff: DiffLineas,
  seccion: SeccionGeneral,
  nombreSeccion: string
): SugerenciaOrdenada[] {
  const salida: SugerenciaOrdenada[] = [];
  const orden = ORDEN_SECCION[seccion];

  for (const linea of diff.soloEnB) {
    salida.push({
      orden,
      sugerencia: {
        pasoIdRmd: null,
        pasoIdReferencia: null,
        seccionGeneral: seccion,
        tipo: "paso_faltante_en_rmd",
        accionSugerida: "incluir",
        textoEnRmd: null,
        textoEnReferencia: linea,
        justificacion: `La referencia incluye esta línea en ${nombreSeccion} y el RMD evaluado no tiene ninguna equivalente.`,
        nivelConfianza: "alta",
      },
    });
  }

  for (const linea of diff.soloEnA) {
    salida.push({
      orden,
      sugerencia: {
        pasoIdRmd: null,
        pasoIdReferencia: null,
        seccionGeneral: seccion,
        tipo: "paso_sobrante_en_rmd",
        accionSugerida: "eliminar",
        textoEnRmd: linea,
        textoEnReferencia: null,
        justificacion: `El RMD evaluado tiene esta línea en ${nombreSeccion} y la referencia no contempla nada equivalente: evaluá si corresponde mantenerla.`,
        nivelConfianza: "alta",
      },
    });
  }

  for (const par of diff.redaccionDistinta) {
    salida.push({
      orden,
      sugerencia: {
        pasoIdRmd: null,
        pasoIdReferencia: null,
        seccionGeneral: seccion,
        tipo: "redaccion_puede_homologarse",
        accionSugerida: "modificar",
        textoEnRmd: par.a,
        textoEnReferencia: par.b,
        justificacion: `Misma línea de ${nombreSeccion} con redacción distinta (${Math.round(par.similitud * 100)}% de palabras en común): se puede alinear a la referencia.`,
        nivelConfianza: confianzaPorSimilitud(par.similitud),
      },
    });
  }

  return salida;
}

function sugerenciasDePasos(diff: DiffRmd, rmd: RMDExtraido, referencia: RMDExtraido): SugerenciaOrdenada[] {
  const posicionEnRmd = new Map(rmd.procedimiento.map((p, i) => [p.id, i]));
  const posicionEnReferencia = new Map(referencia.procedimiento.map((p, i) => [p.id, i]));

  /**
   * Dónde listar un paso que el RMD evaluado no tiene: justo después del
   * último paso de la referencia que sí existe en el RMD, que es el lugar
   * donde habría que insertarlo.
   */
  function ordenParaFaltante(idReferencia: string): number {
    const posReferencia = posicionEnReferencia.get(idReferencia) ?? 0;
    let orden = 0;
    for (let i = posReferencia - 1; i >= 0; i--) {
      const anclaje = posicionEnRmd.get(referencia.procedimiento[i].id);
      if (anclaje !== undefined) {
        orden = anclaje;
        break;
      }
    }
    return orden + 0.5;
  }

  const salida: SugerenciaOrdenada[] = [];

  for (const par of diff.pasos) {
    // Paso alineado: mismo id, mismo texto, misma posición. Nada que sugerir.
    if (par.a && par.b && par.textoIgual && !par.fueraDeOrden && par.emparejadoPor === "id") continue;

    if (par.a && !par.b) {
      const cercano = describirCandidato(par.mejorCandidato, "la referencia");
      salida.push({
        orden: posicionEnRmd.get(par.a.id) ?? 0,
        sugerencia: {
          pasoIdRmd: par.a.id,
          pasoIdReferencia: null,
          seccionGeneral: null,
          tipo: "paso_sobrante_en_rmd",
          accionSugerida: "eliminar",
          textoEnRmd: par.a.texto,
          textoEnReferencia: null,
          justificacion: `La referencia no tiene un paso equivalente a este. ${cercano.texto}`,
          nivelConfianza: cercano.confianza,
        },
      });
      continue;
    }

    if (!par.a && par.b) {
      const cercano = describirCandidato(par.mejorCandidato, "el RMD evaluado");
      salida.push({
        orden: ordenParaFaltante(par.b.id),
        sugerencia: {
          pasoIdRmd: null,
          pasoIdReferencia: par.b.id,
          seccionGeneral: null,
          tipo: "paso_faltante_en_rmd",
          accionSugerida: "incluir",
          textoEnRmd: null,
          textoEnReferencia: par.b.texto,
          justificacion: `La referencia tiene el paso ${par.b.id} y el RMD evaluado no tiene ninguno equivalente. ${cercano.texto}`,
          nivelConfianza: cercano.confianza,
        },
      });
      continue;
    }

    if (!par.a || !par.b) continue;

    const renumerado = par.emparejadoPor === "texto";
    const notaRenumerado = renumerado
      ? ` El emparejamiento es por contenido, no por número: en el RMD es ${par.a.id} y en la referencia ${par.b.id}.`
      : "";

    if (par.textoIgual) {
      // Mismo texto pero distinto número o distinta posición relativa.
      salida.push({
        orden: posicionEnRmd.get(par.a.id) ?? 0,
        sugerencia: {
          pasoIdRmd: par.a.id,
          pasoIdReferencia: par.b.id,
          seccionGeneral: null,
          tipo: "orden_distinto",
          accionSugerida: "reordenar",
          textoEnRmd: par.a.texto,
          textoEnReferencia: par.b.texto,
          justificacion: renumerado
            ? `El paso dice exactamente lo mismo que el ${par.b.id} de la referencia pero está numerado ${par.a.id}.${notaRenumerado}`
            : `El texto coincide con el ${par.b.id} de la referencia, pero aparece en otra posición de la secuencia.`,
          nivelConfianza: "alta",
        },
      });
      continue;
    }

    const porcentaje = Math.round(par.similitud * 100);
    salida.push({
      orden: posicionEnRmd.get(par.a.id) ?? 0,
      sugerencia: {
        pasoIdRmd: par.a.id,
        pasoIdReferencia: par.b.id,
        seccionGeneral: null,
        tipo: "redaccion_puede_homologarse",
        accionSugerida: "modificar",
        textoEnRmd: par.a.texto,
        textoEnReferencia: par.b.texto,
        // Dos pasos con el mismo número pero contenido casi sin relación no
        // son "el mismo paso redactado distinto": lo más probable es que ese
        // número corresponda a otra cosa en cada documento. Decirlo así vale
        // más que sugerir alinear una redacción que no aplica.
        justificacion:
          par.similitud < 0.3
            ? `El paso ${par.a.id} existe en los dos documentos pero su contenido casi no coincide ` +
              `(${porcentaje}% de palabras en común): revisá si ese número corresponde al mismo punto del ` +
              `proceso en los dos.${notaRenumerado}`
            : `El paso existe en los dos documentos con ${porcentaje}% de palabras en común, pero la ` +
              `redacción difiere: se puede alinear a la de la referencia.${notaRenumerado}`,
        nivelConfianza: confianzaPorSimilitud(par.similitud),
      },
    });
  }

  return salida;
}

function sugerenciasDeEquipos(diff: DiffRmd): SugerenciaOrdenada[] {
  return diff.equiposInstrumentos.descripcionDistinta.map(({ a, b }) => ({
    orden: ORDEN_SECCION.equipos_instrumentos,
    sugerencia: {
      pasoIdRmd: null,
      pasoIdReferencia: null,
      seccionGeneral: "equipos_instrumentos" as SeccionGeneral,
      tipo: "redaccion_puede_homologarse" as const,
      accionSugerida: "modificar" as const,
      textoEnRmd: `${a.codigo} — ${a.descripcion}`,
      textoEnReferencia: `${b.codigo} — ${b.descripcion}`,
      justificacion: `El equipo ${a.codigo} está descrito distinto en cada documento: conviene usar una sola forma.`,
      nivelConfianza: "alta" as const,
    },
  }));
}

function armarResumen(
  sugerencias: SugerenciaHomologacionReferencia[],
  grado: number,
  totalPasosRmd: number,
  totalPasosReferencia: number
): string {
  if (sugerencias.length === 0) {
    return (
      `El RMD evaluado está alineado con la referencia: sus ${totalPasosRmd} pasos coinciden en texto y ` +
      "en orden, y no se encontró nada que homologar."
    );
  }

  const cuenta = (tipo: SugerenciaHomologacionReferencia["tipo"]) =>
    sugerencias.filter((s) => s.tipo === tipo).length;

  const partes = [
    [cuenta("redaccion_puede_homologarse"), "con redacción homologable"],
    [cuenta("paso_faltante_en_rmd"), "que la referencia tiene y el RMD no"],
    [cuenta("paso_sobrante_en_rmd"), "sin equivalente en la referencia"],
    [cuenta("orden_distinto"), "en distinto orden o con distinta numeración"],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, texto]) => `${n} ${texto}`);

  return (
    `${sugerencias.length} punto(s) a homologar entre el RMD evaluado (${totalPasosRmd} pasos) y la ` +
    `referencia (${totalPasosReferencia} pasos): ${partes.join(", ")}. ` +
    `Grado de alineación de los pasos: ${grado}%. ` +
    "Comparación determinística: cada punto sale de comparar los textos, sin interpretación de un modelo, " +
    "así que el criterio de cuáles corresponde homologar queda en el analista."
  );
}

export function compararContraReferencia(
  rmd: RMDExtraido,
  referencia: RMDExtraido
): ResultadoComparacionReferencia {
  const diff = compararRmd(rmd, referencia);

  const ordenadas = [
    ...sugerenciasDeLineas(diff.precauciones, "precauciones", "PRECAUCIONES"),
    ...sugerenciasDeLineas(diff.notasImportantes, "notas_importantes", "NOTAS IMPORTANTES"),
    ...sugerenciasDeLineas(diff.condicionesAmbientales, "condiciones_ambientales", "CONDICIONES AMBIENTALES"),
    ...sugerenciasDeEquipos(diff),
    ...sugerenciasDePasos(diff, rmd, referencia),
  ].sort((x, y) => x.orden - y.orden);

  const sugerencias = ordenadas.map((o) => o.sugerencia);

  return {
    resumenEjecutivo: armarResumen(
      sugerencias,
      diff.gradoCoincidencia,
      rmd.procedimiento.length,
      referencia.procedimiento.length
    ),
    // La sección y la etapa no se pueden deducir del documento extraído, y
    // esta comparación no las recibe: el contrato admite NO_IDENTIFICADA y la
    // UI de homologación no las usa.
    seccionDetectada: "NO_IDENTIFICADA",
    etapaDetectada: "NO_IDENTIFICADA",
    sugerenciasHomologacion: sugerencias,
    gradoHomologacion: diff.gradoCoincidencia,
    // Todo lo que sale de acá es un señalamiento, no un veredicto: si hay
    // algo listado, lo decide el analista.
    requiereRevisionHumana: sugerencias.length > 0,
  };
}
