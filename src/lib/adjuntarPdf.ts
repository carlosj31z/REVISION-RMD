import type { RMDExtraido } from "@/types/rmd";

// ¿Hace falta mandarle el PDF al modelo?
//
// El PDF crudo en base64 viaja como respaldo visual multimodal para cubrir lo
// que el parseo heurístico pueda perder por variaciones de espaciado o layout
// (ver pdfExtractor.ts). Hasta ahora se adjuntaba SIEMPRE, y en un RMD de
// Fabricación de 18 páginas ese adjunto es de lejos lo que más cuota consume
// de cada llamada.
//
// Pero el respaldo sólo aporta cuando el parseo efectivamente quedó corto. Si
// la estructura extraída trae todas las secciones y decenas de pasos con
// texto completo, el PDF es tokens gastados en información que el modelo ya
// tiene en el JSON.
//
// El criterio es deliberadamente CONSERVADOR: ante cualquier señal de parseo
// pobre se adjunta. Se prefiere gastar cuota de más en un documento dudoso
// que perder un hallazgo por no haber mandado el respaldo.
//
// Esto NO aplica al PDF del Control de Cambios (ahí el PDF puede ser la única
// fuente del texto, así que siempre va) ni al PDF del borrador en
// /api/revision-borrador (es donde viven las anotaciones manuscritas y el
// texto sobrepuesto que el modelo tiene que ver para marcar
// origenAnotacionInformal).

/** Debajo de esto, la estructura no parece un RMD completo. */
const MINIMO_PASOS = 12;
/** Un paso con menos texto que esto casi siempre es una línea mal cortada. */
const MINIMO_CARACTERES_PASO = 15;
/** Proporción de pasos demasiado cortos que ya delata un parseo pobre. */
const MAXIMA_PROPORCION_PASOS_CORTOS = 0.15;

export interface DecisionPdf {
  adjuntar: boolean;
  /** Legible, para poder mostrarlo en la respuesta y auditar la decisión. */
  motivo: string;
}

export function decidirAdjuntarPdfRmd(
  rmd: RMDExtraido,
  /** El analista pidió análisis a fondo: se adjunta sin evaluar nada. */
  forzar = false
): DecisionPdf {
  if (forzar) {
    return { adjuntar: true, motivo: "El analista pidió adjuntar el PDF explícitamente." };
  }

  const faltantes: string[] = [];
  if (rmd.procedimiento.length < MINIMO_PASOS) {
    faltantes.push(`sólo ${rmd.procedimiento.length} pasos de procedimiento`);
  }
  if (rmd.equiposInstrumentos.length === 0) faltantes.push("sin equipos/instrumentos");
  if (rmd.insumos.length === 0) faltantes.push("sin insumos");
  if (rmd.precauciones.length === 0) faltantes.push("sin precauciones");
  if (rmd.notasImportantes.length === 0) faltantes.push("sin notas importantes");
  if (rmd.condicionesAmbientales.length === 0) faltantes.push("sin condiciones ambientales");

  const pasosCortos = rmd.procedimiento.filter(
    (p) => p.texto.trim().length < MINIMO_CARACTERES_PASO
  ).length;
  if (
    rmd.procedimiento.length > 0 &&
    pasosCortos / rmd.procedimiento.length > MAXIMA_PROPORCION_PASOS_CORTOS
  ) {
    faltantes.push(`${pasosCortos} de ${rmd.procedimiento.length} pasos con texto muy corto`);
  }

  if (faltantes.length > 0) {
    return {
      adjuntar: true,
      motivo: `El parseo quedó incompleto (${faltantes.join(", ")}): se adjunta el PDF como respaldo visual.`,
    };
  }

  return {
    adjuntar: false,
    motivo:
      `El parseo trajo ${rmd.procedimiento.length} pasos y todas las secciones esperadas, ` +
      "así que no se adjunta el PDF y la llamada consume mucha menos cuota.",
  };
}
