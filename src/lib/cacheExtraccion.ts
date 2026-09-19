import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RMDExtraido } from "@/types/rmd";

// Caché de extracciones por OCR.
//
// /api/extract-pdf sólo llama al modelo cuando el PDF es un escaneo sin capa de
// texto: ahí hay que reconstruir la estructura leyéndolo visualmente, y en un
// escaneo de doce páginas eso es de las operaciones más caras del sistema.
//
// Sin caché, volver a subir el MISMO archivo la repite entera — y subir el mismo
// RMD dos veces es lo normal en este flujo: una para revisar contra el Control
// de Cambios y otra, más tarde, para verificar la corrección.
//
// La clave es el SHA-256 del archivo y no su nombre: dos archivos con el mismo
// nombre pueden ser distintos, y el mismo archivo puede llegar con otro nombre.
// No hace falta invalidar nada, porque el mismo PDF siempre da la misma
// estructura; si algún día cambia el parseo del OCR, se borra la tabla y se
// vuelve a llenar sola.

export function huellaPdf(contenido: Buffer): string {
  return createHash("sha256").update(contenido).digest("hex");
}

/**
 * La tabla la crea la migración 0015. Si todavía no se aplicó, la caché se
 * desactiva sola en vez de romper la extracción.
 */
let soporteCache: boolean | null = null;

async function baseSoportaCache(supabase: SupabaseClient): Promise<boolean> {
  if (soporteCache !== null) return soporteCache;
  const { error } = await supabase.from("extracciones_ocr").select("hash_pdf").limit(0);
  soporteCache = !error;
  if (error) {
    console.warn(
      "[cacheExtraccion] La tabla extracciones_ocr no existe todavía, así que cada escaneo va a " +
        "volver a pasar por OCR. Aplicá la migración 0015 (npm run db:push) para activar la caché."
    );
  }
  return soporteCache;
}

export interface ExtraccionCacheada {
  estructura: RMDExtraido;
  pasosDetectados: number | null;
}

export async function buscarExtraccionOcr(
  supabase: SupabaseClient,
  hashPdf: string
): Promise<ExtraccionCacheada | null> {
  if (!(await baseSoportaCache(supabase))) return null;

  const { data, error } = await supabase
    .from("extracciones_ocr")
    .select("estructura, pasos_detectados")
    .eq("hash_pdf", hashPdf)
    .maybeSingle();

  if (error || !data?.estructura) return null;
  return {
    estructura: data.estructura as RMDExtraido,
    pasosDetectados: data.pasos_detectados ?? null,
  };
}

export async function guardarExtraccionOcr(
  supabase: SupabaseClient,
  hashPdf: string,
  estructura: RMDExtraido,
  pasosDetectados: number | null,
  nombreArchivo: string
): Promise<void> {
  if (!(await baseSoportaCache(supabase))) return;

  // upsert y no insert: dos pestañas pueden subir el mismo escaneo a la vez y
  // la segunda no tiene por qué fallar por una clave duplicada.
  const { error } = await supabase.from("extracciones_ocr").upsert(
    {
      hash_pdf: hashPdf,
      estructura,
      pasos_detectados: pasosDetectados,
      nombre_archivo: nombreArchivo,
    },
    { onConflict: "hash_pdf" }
  );
  if (error) console.error("No se pudo guardar la extracción por OCR en caché:", error);
}
