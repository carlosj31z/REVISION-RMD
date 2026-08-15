import type { SupabaseClient } from "@supabase/supabase-js";
import type { AlertaCoherencia, DocumentoObsoleto, DocumentoReferenciado } from "@/types/rmd";

export function filaADocumentoObsoleto(fila: any): DocumentoObsoleto {
  return {
    id: fila.id,
    codigo: fila.codigo,
    motivo: fila.motivo ?? null,
    activo: fila.activo,
    creadoPor: fila.creado_por ?? null,
    createdAt: fila.created_at,
  };
}

/**
 * Carga los documentos obsoletos ACTIVOS. Se usa antes de comparar (tanto en
 * /api/revision como en /api/revision-borrador) para cruzarlos contra los
 * documentosReferenciados que ya extrajo pdfExtractor.ts por regex.
 */
export async function cargarDocumentosObsoletosActivos(
  supabase: SupabaseClient
): Promise<DocumentoObsoleto[]> {
  const { data, error } = await supabase
    .from("documentos_obsoletos")
    .select("*")
    .eq("activo", true);

  if (error) {
    console.error("Error cargando documentos obsoletos:", error);
    return [];
  }

  return (data ?? []).map(filaADocumentoObsoleto);
}

/**
 * Cruza los documentos citados en un RMD contra el maestro de obsoletos y
 * genera alertas determinísticamente (código a código) — a diferencia del
 * resto de alertasCoherencia, esta NO depende de que el modelo de IA la note,
 * porque documentosReferenciados ya viene de una extracción regex confiable.
 */
export function detectarDocumentosObsoletosReferenciados(
  documentosReferenciados: DocumentoReferenciado[],
  obsoletos: DocumentoObsoleto[],
  etiquetaDocumento?: string // ej. "borrador de Producción", para distinguir el origen en revision-borrador
): AlertaCoherencia[] {
  if (obsoletos.length === 0 || documentosReferenciados.length === 0) return [];
  const mapaObsoletos = new Map(obsoletos.map((o) => [o.codigo.toUpperCase(), o]));

  const alertas: AlertaCoherencia[] = [];
  for (const doc of documentosReferenciados) {
    const obsoleto = mapaObsoletos.get(doc.codigo.toUpperCase());
    if (!obsoleto) continue;
    const sufijo = etiquetaDocumento ? ` en el ${etiquetaDocumento}` : "";
    alertas.push({
      tipo: "documento_obsoleto_referenciado",
      descripcion: `El documento ${doc.codigo} (${doc.tipo}) está marcado como obsoleto${
        obsoleto.motivo ? `: ${obsoleto.motivo}` : ""
      }, pero sigue siendo referenciado${sufijo}.`,
      pasosAfectados: [],
      severidad: "alta",
    });
  }
  return alertas;
}
