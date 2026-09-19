import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// Caché de revisiones por huella de la entrada.
//
// Cada llamada al modelo consume cuota, y la cuota gratuita de Gemini se
// agota rápido — además de saturarse a ciertas horas. Pero una parte de esas
// llamadas es redundante: reabrir un documento, reintentar después de que el
// servicio falló, o volver a correr lo mismo tras un ajuste de la UI repite
// una entrada ya analizada. Misma entrada, misma salida.
//
// La huella es un SHA-256 de TODO lo que determina el resultado, incluidos
// los maestros que alimentan los cruces determinísticos (documentos
// obsoletos/vigentes, equipos calificados). Eso es deliberado: así un cambio
// en un maestro que este documento efectivamente usa invalida su caché, y el
// resultado guardado nunca queda desactualizado respecto de los maestros.
// Si en cambio sólo se hasheara el prompt, un documento que venció después
// de la corrida seguiría devolviéndose sin su alerta.

/** Permite forzar corridas nuevas sin tocar código: REVISION_CACHE_OFF=1 */
function cacheApagadaPorEntorno(): boolean {
  return process.env.REVISION_CACHE_OFF === "1";
}

/**
 * JSON con las claves de cada objeto ordenadas. Sin esto, dos entradas
 * equivalentes que sólo difieran en el orden en que se serializaron las
 * propiedades darían huellas distintas y la caché no acertaría nunca.
 */
function serializarEstable(valor: unknown): string {
  if (valor === null || valor === undefined) return "null";
  if (Array.isArray(valor)) return `[${valor.map(serializarEstable).join(",")}]`;
  if (valor instanceof Date) return JSON.stringify(valor.toISOString());
  // Los maestros llegan como Map (cargarDocumentosVigentesPorCodigos,
  // cargarEquiposCalificadosPorCodigos) y Object.entries() de un Map da
  // SIEMPRE un array vacío: sin este caso, dos maestros distintos hashearían
  // igual y la caché devolvería resultados de otra cosa. Se ordena por clave
  // porque el orden de inserción depende del orden en que vino la consulta.
  if (valor instanceof Map) {
    const entradas = [...valor.entries()]
      .map(([k, v]) => [serializarEstable(k), serializarEstable(v)] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `Map{${entradas.map(([k, v]) => `${k}:${v}`).join(",")}}`;
  }
  if (valor instanceof Set) {
    return `Set[${[...valor.values()].map(serializarEstable).sort().join(",")}]`;
  }
  if (typeof valor === "object") {
    const entradas = Object.entries(valor as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entradas.map(([k, v]) => `${JSON.stringify(k)}:${serializarEstable(v)}`).join(",")}}`;
  }
  return JSON.stringify(valor);
}

export function huellaEntrada(partes: Record<string, unknown>): string {
  return createHash("sha256").update(serializarEstable(partes)).digest("hex");
}

/**
 * La columna `hash_entrada` la agrega la migración 0012. Si todavía no se
 * aplicó, la caché se desactiva sola en vez de romper la revisión: se
 * comprueba una vez por proceso con una consulta que no trae filas.
 */
let soporteCache: boolean | null = null;

async function baseSoportaCache(supabase: SupabaseClient): Promise<boolean> {
  if (soporteCache !== null) return soporteCache;
  const { error } = await supabase.from("revisiones").select("hash_entrada").limit(0);
  soporteCache = !error;
  if (error) {
    console.warn(
      "[cacheRevisiones] La columna revisiones.hash_entrada no existe todavía, así que la " +
        "caché queda desactivada y cada revisión va a gastar una llamada al modelo. " +
        "Aplicá la migración 0012 (npm run db:push) para activarla."
    );
  }
  return soporteCache;
}

/** Deja constancia del acierto para que /api/estado-ia pueda mostrar el ahorro. */
function registrarAcierto(supabase: SupabaseClient, operacion: string): void {
  // Fire-and-forget, igual que registrarUso en llmFallback: es diagnóstico,
  // nunca una dependencia del flujo.
  try {
    supabase
      .from("uso_ia")
      .insert({ proveedor: "cache", operacion, exito: true })
      .then(
        () => {},
        () => {}
      );
  } catch {
    // Sin Supabase configurado no hay nada que registrar y tampoco importa.
  }
}

export interface RevisionCacheada<T> {
  resultado: T;
  revisionId: string;
  creadoEn: string;
}

/**
 * Busca una revisión previa con la misma huella y el mismo tipo. Devuelve
 * null si no hay, si la caché está apagada, o ante cualquier error: nunca
 * puede impedir que la revisión se corra de verdad.
 */
export async function buscarRevisionEnCache<T>(
  supabase: SupabaseClient,
  tipo: string,
  huella: string,
  operacion: string
): Promise<RevisionCacheada<T> | null> {
  if (cacheApagadaPorEntorno()) return null;
  if (!(await baseSoportaCache(supabase))) return null;

  const { data, error } = await supabase
    .from("revisiones")
    .select("id, resultado_ia, created_at")
    .eq("hash_entrada", huella)
    .eq("tipo", tipo)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.resultado_ia) return null;

  registrarAcierto(supabase, operacion);
  return {
    resultado: data.resultado_ia as T,
    revisionId: data.id,
    creadoEn: data.created_at,
  };
}

/**
 * La huella con la que hay que guardar la revisión nueva, o undefined si la
 * base todavía no soporta la caché (así el insert no falla por una columna
 * que no existe).
 */
export async function huellaParaGuardar(
  supabase: SupabaseClient,
  huella: string
): Promise<{ hash_entrada: string } | Record<string, never>> {
  if (cacheApagadaPorEntorno()) return {};
  if (!(await baseSoportaCache(supabase))) return {};
  return { hash_entrada: huella };
}
