import type { RMDExtraido } from "@/types/rmd";
import { contencion, normalizarParaComparar, palabrasDistintivas } from "./comparadorRmd/normalizar";

// Acota el maestro de equipos que viaja en el prompt.
//
// Los prompts de comparación incluyen el maestro completo: los equipos
// RETIRADOS y los ACTIVOS. Los retirados son lo que la regla 4 del prompt
// necesita para marcar "involucraEquipoRetirado", y suelen ser pocos: van
// siempre completos. La lista de ACTIVOS, en cambio, no la referencia ninguna
// regla — está como contexto — y crece con el maestro de la planta. Con
// trescientos equipos son trescientas líneas en cada llamada, la mayoría de
// otras líneas de producción que no tienen nada que ver con el documento.
//
// Eso no sólo gasta cuota: mete ruido. Un listado largo de equipos ajenos
// compite por la atención del modelo con el documento que sí hay que revisar.
//
// Por debajo del umbral no se toca nada, así que en un maestro chico el
// comportamiento es exactamente el de antes.

/** Con menos activos que esto, mandar el maestro completo no molesta. */
const UMBRAL_ACOTAR = 60;

/** Desde acá se considera que el texto habla de ese equipo. */
const UMBRAL_MENCION = 0.6;

export interface EquipoDelMaestro {
  codigo: string;
  descripcion: string;
  activo: boolean;
}

export interface MaestroAcotado<T extends EquipoDelMaestro> {
  /** Retirados completos + activos relevantes. */
  equipos: T[];
  /** Cuántos activos quedaron afuera. 0 = no se acotó nada. */
  omitidos: number;
}

/**
 * Deja los equipos retirados completos y, de los activos, sólo los que el
 * documento o el Control de Cambios efectivamente mencionan.
 *
 * `textosAdicionales` es para el texto del Control de Cambios: si el CC pide
 * agregar un equipo que todavía no está en el RMD, ese equipo tiene que llegar
 * al prompt para que el modelo pueda resolver su código sin inventarlo.
 */
export function acotarMaestroEquipos<T extends EquipoDelMaestro>(
  maestro: T[],
  documentos: Array<RMDExtraido | undefined>,
  textosAdicionales: Array<string | undefined> = []
): MaestroAcotado<T> {
  const retirados = maestro.filter((e) => !e.activo);
  const activos = maestro.filter((e) => e.activo);
  if (activos.length <= UMBRAL_ACOTAR) return { equipos: maestro, omitidos: 0 };

  // Todo el texto donde un equipo puede estar mencionado: los pasos, la
  // sección de equipos de cada documento, y el Control de Cambios.
  const fragmentos: string[] = [];
  for (const documento of documentos) {
    if (!documento) continue;
    for (const paso of documento.procedimiento) fragmentos.push(paso.texto);
    for (const equipo of documento.equiposInstrumentos) {
      fragmentos.push(`${equipo.codigo} ${equipo.descripcion}`);
    }
  }
  for (const texto of textosAdicionales) if (texto) fragmentos.push(texto);

  const textoCompleto = normalizarParaComparar(fragmentos.join(" \n "));
  const palabrasDelTexto = new Set(palabrasDistintivas(textoCompleto));

  const relevantes = activos.filter((equipo) => {
    const codigo = equipo.codigo ? normalizarParaComparar(equipo.codigo) : "";
    if (codigo !== "" && textoCompleto.includes(codigo)) return true;
    const claves = palabrasDistintivas(equipo.descripcion);
    return claves.length > 0 && contencion(claves, palabrasDelTexto) >= UMBRAL_MENCION;
  });

  return {
    equipos: [...retirados, ...relevantes],
    omitidos: activos.length - relevantes.length,
  };
}
