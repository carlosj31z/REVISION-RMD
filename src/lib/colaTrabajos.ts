import type { SupabaseClient } from "@supabase/supabase-js";
import { ProveedoresAgotadosError } from "./llmFallback";

// Cola de trabajos de IA con reintento diferido.
//
// El problema no es de cuota sino de horario: el servicio se satura a ciertas
// horas y la cuota diaria se agota. Hasta ahora, cuando fallaban los cinco
// proveedores configurados el analista recibía un error y tenía que volver a
// subir todo más tarde a mano. Ahora el trabajo queda encolado con su entrada
// completa y un worker lo reintenta solo, con espera creciente.
//
// Lo que NO hace: reintentar dentro de la misma request. Eso ya lo hace
// llmFallback con las cinco claves y unos segundos de backoff. Acá la escala es
// otra — la cuota diaria de Gemini se reinicia a medianoche del Pacífico, así
// que el reintento útil puede estar a quince horas de distancia.

export type OperacionEncolable = "revision" | "revision_borrador";

export type EstadoTrabajo = "pendiente" | "procesando" | "completado" | "fallido";

export interface TrabajoEncolado {
  id: string;
  operacion: OperacionEncolable;
  estado: EstadoTrabajo;
  payload: Record<string, unknown>;
  huella: string | null;
  resultado: Record<string, unknown> | null;
  revisionId: string | null;
  intentos: number;
  ultimoError: string | null;
  proximoIntento: string;
  createdAt: string;
}

/**
 * Espera antes del próximo intento, en minutos, según cuántos ya fallaron.
 * Arranca corto (una saturación puede durar minutos) y se estira hasta cuatro
 * horas, porque si lo que se agotó es la cuota DIARIA no hay nada que hacer
 * hasta que se reinicie.
 */
export function esperaMinutos(intentos: number): number {
  const escala = [10, 30, 60, 120];
  return escala[Math.min(intentos, escala.length - 1)] ?? 240;
}

/**
 * Cuántos intentos antes de darlo por fallido. Con la espera de arriba, doce
 * intentos cubren más de un día: alcanza para pasar el reinicio de la cuota
 * diaria incluso si el trabajo se encoló justo después de agotarla.
 */
const MAX_INTENTOS = 12;

/** Cuántos trabajos procesa cada corrida del worker (cada uno es una llamada). */
export const TRABAJOS_POR_CORRIDA = 2;

/**
 * La tabla la crea la migración 0014. Si todavía no se aplicó, la cola se
 * desactiva sola en vez de romper la revisión: se comprueba una vez por
 * proceso, igual que la caché.
 */
let soporteCola: boolean | null = null;

async function baseSoportaCola(supabase: SupabaseClient): Promise<boolean> {
  if (soporteCola !== null) return soporteCola;
  const { error } = await supabase.from("trabajos_ia").select("id").limit(0);
  soporteCola = !error;
  if (error) {
    console.warn(
      "[colaTrabajos] La tabla trabajos_ia no existe todavía, así que un fallo de todos los " +
        "proveedores va a devolver error en vez de encolarse. Aplicá la migración 0014 " +
        "(npm run db:push) para activar el reintento diferido."
    );
  }
  return soporteCola;
}

function filaATrabajo(fila: any): TrabajoEncolado {
  return {
    id: fila.id,
    operacion: fila.operacion,
    estado: fila.estado,
    payload: fila.payload ?? {},
    huella: fila.huella ?? null,
    resultado: fila.resultado ?? null,
    revisionId: fila.revision_id ?? null,
    intentos: fila.intentos ?? 0,
    ultimoError: fila.ultimo_error ?? null,
    proximoIntento: fila.proximo_intento,
    createdAt: fila.created_at,
  };
}

export interface DatosEncolar {
  operacion: OperacionEncolable;
  payload: Record<string, unknown>;
  huella?: string;
  creadoPor?: string | null;
  /** Por qué se encoló, para mostrárselo al analista. */
  motivo: string;
}

/**
 * Deja el trabajo en cola para reintentarlo. Devuelve null si la cola no está
 * disponible: en ese caso quien llama tiene que devolver el error como antes.
 */
export async function encolarTrabajo(
  supabase: SupabaseClient,
  datos: DatosEncolar
): Promise<{ id: string; proximoIntentoEnMinutos: number } | null> {
  if (!(await baseSoportaCola(supabase))) return null;

  const minutos = esperaMinutos(0);
  const { data, error } = await supabase
    .from("trabajos_ia")
    .insert({
      operacion: datos.operacion,
      payload: datos.payload,
      huella: datos.huella ?? null,
      creado_por: datos.creadoPor ?? null,
      ultimo_error: datos.motivo,
      proximo_intento: new Date(Date.now() + minutos * 60_000).toISOString(),
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("No se pudo encolar el trabajo:", error);
    return null;
  }
  return { id: data.id, proximoIntentoEnMinutos: minutos };
}

export async function obtenerTrabajo(
  supabase: SupabaseClient,
  id: string
): Promise<TrabajoEncolado | null> {
  if (!(await baseSoportaCola(supabase))) return null;
  const { data, error } = await supabase.from("trabajos_ia").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return filaATrabajo(data);
}

/**
 * Toma los trabajos a los que ya les toca reintentar y los marca como
 * "procesando" en el mismo movimiento.
 *
 * El update condicional por estado es el candado: si dos corridas del worker se
 * solapan, sólo una se queda con cada trabajo. Y como al tomarlo se empuja
 * `proximo_intento` hacia adelante, un trabajo que quede colgado en
 * "procesando" (la función se murió a mitad) vuelve a estar disponible después
 * de esa espera en vez de quedar trabado para siempre.
 */
export async function tomarTrabajosParaReintentar(
  supabase: SupabaseClient,
  limite = TRABAJOS_POR_CORRIDA
): Promise<TrabajoEncolado[]> {
  if (!(await baseSoportaCola(supabase))) return [];

  const ahora = new Date().toISOString();
  const { data, error } = await supabase
    .from("trabajos_ia")
    .select("*")
    .in("estado", ["pendiente", "procesando"])
    .lte("proximo_intento", ahora)
    .order("proximo_intento", { ascending: true })
    .limit(limite);

  if (error || !data) return [];

  const tomados: TrabajoEncolado[] = [];
  for (const fila of data) {
    const trabajo = filaATrabajo(fila);
    const siguienteEspera = esperaMinutos(trabajo.intentos);
    const { data: ganado } = await supabase
      .from("trabajos_ia")
      .update({
        estado: "procesando",
        proximo_intento: new Date(Date.now() + siguienteEspera * 60_000).toISOString(),
        actualizado_en: new Date().toISOString(),
      })
      .eq("id", trabajo.id)
      .eq("estado", trabajo.estado)
      .select("id")
      .maybeSingle();
    if (ganado) tomados.push(trabajo);
  }

  return tomados;
}

export async function marcarCompletado(
  supabase: SupabaseClient,
  id: string,
  resultado: Record<string, unknown>,
  revisionId: string | null
): Promise<void> {
  await supabase
    .from("trabajos_ia")
    .update({
      estado: "completado",
      resultado,
      revision_id: revisionId,
      ultimo_error: null,
      actualizado_en: new Date().toISOString(),
    })
    .eq("id", id);
}

/**
 * Registra el fallo y reprograma, o lo da por perdido si ya se intentó
 * demasiadas veces.
 */
export async function registrarFallo(
  supabase: SupabaseClient,
  trabajo: TrabajoEncolado,
  mensajeError: string
): Promise<{ reprogramado: boolean }> {
  const intentos = trabajo.intentos + 1;
  const agotado = intentos >= MAX_INTENTOS;

  await supabase
    .from("trabajos_ia")
    .update({
      estado: agotado ? "fallido" : "pendiente",
      intentos,
      ultimo_error: mensajeError.slice(0, 2000),
      proximo_intento: new Date(Date.now() + esperaMinutos(intentos) * 60_000).toISOString(),
      actualizado_en: new Date().toISOString(),
    })
    .eq("id", trabajo.id);

  return { reprogramado: !agotado };
}

/** Cuántos trabajos hay esperando, para mostrarlo en el estado de la IA. */
export async function contarPendientes(supabase: SupabaseClient): Promise<number> {
  if (!(await baseSoportaCola(supabase))) return 0;
  const { data, error } = await supabase
    .from("trabajos_ia")
    .select("id")
    .in("estado", ["pendiente", "procesando"]);
  if (error || !data) return 0;
  return data.length;
}

/** Lo que la ruta le devuelve a la UI cuando el trabajo quedó en cola. */
export interface RespuestaEncolado {
  trabajoId: string;
  proximoIntentoEnMinutos: number;
  mensaje: string;
}

/**
 * Encola el trabajo si el fallo es de los que el tiempo resuelve, y devuelve
 * null si no corresponde encolarlo — en ese caso quien llama tiene que
 * propagar el error como siempre.
 *
 * No encola cuando: el fallo no es de todos los proveedores, cuando ninguno
 * falló por cuota o saturación (reintentar mañana daría lo mismo), cuando la
 * llamada YA viene de un reintento del worker (la reprogramación la lleva el
 * worker, no la ruta), o cuando la cola no está disponible.
 */
export async function encolarSiElTiempoLoResuelve(
  supabase: SupabaseClient,
  err: unknown,
  datos: {
    operacion: OperacionEncolable;
    payload: Record<string, unknown>;
    huella?: string;
    creadoPor?: string | null;
    yaEsReintento?: boolean;
  }
): Promise<RespuestaEncolado | null> {
  if (datos.yaEsReintento) return null;
  if (!(err instanceof ProveedoresAgotadosError) || !err.vuelveAServirMasTarde) return null;

  const encolado = await encolarTrabajo(supabase, {
    operacion: datos.operacion,
    payload: datos.payload,
    huella: datos.huella,
    creadoPor: datos.creadoPor,
    motivo: err.message,
  });
  if (!encolado) return null;

  return {
    trabajoId: encolado.id,
    proximoIntentoEnMinutos: encolado.proximoIntentoEnMinutos,
    mensaje:
      "Los proveedores de IA están saturados o sin cuota en este momento. El análisis quedó en " +
      `cola y se reintenta solo, el primer intento en ~${encolado.proximoIntentoEnMinutos} minutos. ` +
      "No hace falta volver a subir los archivos.",
  };
}
