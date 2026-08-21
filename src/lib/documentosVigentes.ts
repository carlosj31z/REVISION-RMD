import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AlertaCoherencia,
  DocumentoReferenciado,
  DocumentoVigente,
  InfoVigenciaDocumento,
} from "@/types/rmd";

export function filaADocumentoVigente(fila: any): DocumentoVigente {
  return {
    id: fila.id,
    codigo: fila.codigo,
    titulo: fila.titulo,
    categoria: fila.categoria ?? null,
    revision: fila.revision ?? null,
    fechaEmision: fila.fecha_emision ?? null,
    vigenteHasta: fila.vigente_hasta ?? null,
    actualizadoEn: fila.actualizado_en,
  };
}

/**
 * Carga del maestro de vigentes SOLO los códigos que aparecen citados en el
 * RMD en revisión (nunca las ~3300 filas completas) — se cruza por código,
 * igual que con documentos_obsoletos, así que no hace falta traer más.
 */
export async function cargarDocumentosVigentesPorCodigos(
  supabase: SupabaseClient,
  codigos: string[]
): Promise<Map<string, DocumentoVigente>> {
  const mapa = new Map<string, DocumentoVigente>();
  if (codigos.length === 0) return mapa;

  const codigosUnicos = [...new Set(codigos.map((c) => c.toUpperCase()))];
  const { data, error } = await supabase
    .from("documentos_vigentes")
    .select("id, codigo, titulo, categoria, revision, fecha_emision, vigente_hasta, actualizado_en")
    .in("codigo", codigosUnicos);

  if (error) {
    console.error("Error cargando documentos vigentes:", error);
    return mapa;
  }

  for (const fila of data ?? []) {
    mapa.set(fila.codigo.toUpperCase(), filaADocumentoVigente(fila));
  }
  return mapa;
}

const HOY_ISO = () => new Date().toISOString().slice(0, 10);

/**
 * Info de vigencia (título + hasta cuándo vale) de cada documento
 * referenciado que se pudo cruzar contra el maestro — se adjunta al
 * resultado de la revisión para que la UI la muestre sutilmente sin otra
 * consulta desde el cliente.
 */
export function construirInfoDocumentosVigentes(
  documentosReferenciados: DocumentoReferenciado[],
  vigentes: Map<string, DocumentoVigente>
): Record<string, InfoVigenciaDocumento> {
  const hoy = HOY_ISO();
  const info: Record<string, InfoVigenciaDocumento> = {};
  for (const doc of documentosReferenciados) {
    const vigente = vigentes.get(doc.codigo.toUpperCase());
    if (!vigente) continue;
    info[doc.codigo] = {
      titulo: vigente.titulo,
      vigenteHasta: vigente.vigenteHasta ?? null,
      vencido: !!vigente.vigenteHasta && vigente.vigenteHasta < hoy,
    };
  }
  return info;
}

/**
 * Cruce determinístico principal: un documento referenciado cuyo
 * vigente_hasta ya pasó según el maestro importado del Excel. Se suma a (no
 * reemplaza) las alertas de documentos_obsoletos cargados a mano — ver nota
 * en la migración 0007.
 */
export function detectarDocumentosVencidosReferenciados(
  documentosReferenciados: DocumentoReferenciado[],
  vigentes: Map<string, DocumentoVigente>,
  etiquetaDocumento?: string
): AlertaCoherencia[] {
  if (vigentes.size === 0 || documentosReferenciados.length === 0) return [];
  const hoy = HOY_ISO();
  const sufijo = etiquetaDocumento ? ` en el ${etiquetaDocumento}` : "";

  const alertas: AlertaCoherencia[] = [];
  for (const doc of documentosReferenciados) {
    const vigente = vigentes.get(doc.codigo.toUpperCase());
    if (!vigente?.vigenteHasta || vigente.vigenteHasta >= hoy) continue;
    alertas.push({
      tipo: "documento_obsoleto_referenciado",
      descripcion: `El documento ${doc.codigo} (${vigente.titulo}) venció el ${formatearFecha(
        vigente.vigenteHasta
      )} según el maestro de documentos vigentes, pero sigue siendo referenciado${sufijo}.`,
      pasosAfectados: [],
      severidad: "critica",
    });
  }
  return alertas;
}

function formatearFecha(iso: string): string {
  const [anio, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${anio}`;
}
