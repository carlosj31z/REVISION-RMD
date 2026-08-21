import type { SupabaseClient } from "@supabase/supabase-js";
import type { AlertaCoherencia, EquipoCalificado, InfoCalificacionEquipo } from "@/types/rmd";

const ESTADO_CALIFICADO = "CALIFICADO";

export function filaAEquipoCalificado(fila: any): EquipoCalificado {
  return {
    id: fila.id,
    codigoSap: fila.codigo_sap,
    descripcion: fila.descripcion ?? null,
    estado: fila.estado,
    actualizadoEn: fila.actualizado_en,
  };
}

/**
 * Carga del maestro de equipos calificados SOLO los códigos citados en el
 * RMD en revisión — mismo patrón que cargarDocumentosVigentesPorCodigos.
 */
export async function cargarEquiposCalificadosPorCodigos(
  supabase: SupabaseClient,
  codigos: string[]
): Promise<Map<string, EquipoCalificado>> {
  const mapa = new Map<string, EquipoCalificado>();
  if (codigos.length === 0) return mapa;

  const codigosUnicos = [...new Set(codigos.map((c) => c.toUpperCase()))];
  const { data, error } = await supabase
    .from("equipos_calificados")
    .select("id, codigo_sap, descripcion, estado, actualizado_en")
    .in("codigo_sap", codigosUnicos);

  if (error) {
    console.error("Error cargando equipos calificados:", error);
    return mapa;
  }

  for (const fila of data ?? []) {
    mapa.set(fila.codigo_sap.toUpperCase(), filaAEquipoCalificado(fila));
  }
  return mapa;
}

/**
 * Estado de calificación de cada código de equipo que se pudo cruzar — se
 * adjunta al resultado de la revisión para que la UI lo muestre sutilmente
 * sin otra consulta desde el cliente.
 */
export function construirInfoCalificacionEquipos(
  codigosReferenciados: string[],
  calificados: Map<string, EquipoCalificado>
): Record<string, InfoCalificacionEquipo> {
  const info: Record<string, InfoCalificacionEquipo> = {};
  for (const codigo of codigosReferenciados) {
    const equipo = calificados.get(codigo.toUpperCase());
    if (!equipo) continue;
    info[codigo] = { estado: equipo.estado, calificado: equipo.estado === ESTADO_CALIFICADO };
  }
  return info;
}

/**
 * Cruce determinístico: un equipo citado en el RMD (sección EQUIPOS/
 * INSTRUMENTOS/MATERIALES) cuyo estado en el maestro no es "CALIFICADO".
 * Códigos que no aparecen en el maestro se ignoran (no se puede afirmar
 * nada sobre ellos) — sólo alerta cuando SÍ está en el maestro con un
 * estado distinto al esperado.
 */
export function detectarEquiposNoCalificadosReferenciados(
  codigosReferenciados: string[],
  calificados: Map<string, EquipoCalificado>,
  etiquetaDocumento?: string
): AlertaCoherencia[] {
  if (calificados.size === 0 || codigosReferenciados.length === 0) return [];
  const sufijo = etiquetaDocumento ? ` en el ${etiquetaDocumento}` : "";

  const alertas: AlertaCoherencia[] = [];
  const vistos = new Set<string>();
  for (const codigo of codigosReferenciados) {
    const clave = codigo.toUpperCase();
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    const equipo = calificados.get(clave);
    if (!equipo || equipo.estado === ESTADO_CALIFICADO) continue;
    alertas.push({
      tipo: "equipo_retirado_en_uso",
      descripcion: `El equipo ${codigo}${
        equipo.descripcion ? ` (${equipo.descripcion})` : ""
      } no está calificado según el maestro de equipos: su estado actual es "${
        equipo.estado
      }"${sufijo}.`,
      pasosAfectados: [],
      severidad: "critica",
    });
  }
  return alertas;
}
