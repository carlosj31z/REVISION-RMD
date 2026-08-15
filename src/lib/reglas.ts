import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReglaHomologacion } from "@/types/rmd";

/**
 * Carga las reglas permanentes de homologación ACTIVAS que aplican a una
 * sección/etapa dada (una regla con seccion_codigo/etapa_codigo en NULL
 * aplica a todas). Se usa antes de llamar a Gemini, tanto en /api/revision
 * como en /api/revision-borrador.
 */
export async function cargarReglasAplicables(
  supabase: SupabaseClient,
  seccionCodigo?: string,
  etapaCodigo?: string
): Promise<ReglaHomologacion[]> {
  let query = supabase.from("reglas_homologacion").select("*").eq("activa", true);
  if (seccionCodigo) {
    query = query.or(`seccion_codigo.is.null,seccion_codigo.eq.${seccionCodigo}`);
  }
  if (etapaCodigo) {
    query = query.or(`etapa_codigo.is.null,etapa_codigo.eq.${etapaCodigo}`);
  }

  const { data, error } = await query;
  if (error) {
    console.error("Error cargando reglas de homologación:", error);
    return [];
  }

  return (data ?? []).map((fila: any) => ({
    id: fila.id,
    texto: fila.texto,
    seccionCodigo: fila.seccion_codigo ?? null,
    etapaCodigo: fila.etapa_codigo ?? null,
    activa: fila.activa,
    creadoPor: fila.creado_por ?? null,
    createdAt: fila.created_at,
  }));
}
