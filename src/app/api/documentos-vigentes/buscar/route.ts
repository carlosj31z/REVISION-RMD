import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseClient";
import { filaADocumentoVigente } from "@/lib/documentosVigentes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMITE = 100;

/**
 * GET /api/documentos-vigentes/buscar?q=texto
 * Búsqueda por código o título para el detalle "si el usuario quiere" del
 * panel de Documentos vigentes — nunca lista el maestro completo (~3300
 * filas) de una: exige un término de búsqueda de al menos 2 caracteres.
 */
export async function GET(req: NextRequest) {
  try {
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
    if (q.length < 2) {
      return NextResponse.json(
        { documentos: [], error: null },
        { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
      );
    }

    // "," y "(" ")" tienen significado especial en la sintaxis de filtro de
    // PostgREST que arma .or() — se neutralizan para que un término de
    // búsqueda no pueda inyectar condiciones extra en el filtro.
    const seguro = q.replace(/[,()]/g, " ").trim();

    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("documentos_vigentes")
      .select("id, codigo, titulo, categoria, revision, fecha_emision, vigente_hasta, actualizado_en")
      .or(`codigo.ilike.%${seguro}%,titulo.ilike.%${seguro}%`)
      .order("codigo", { ascending: true })
      .limit(LIMITE);

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500, headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
      );
    }

    return NextResponse.json(
      { documentos: (data ?? []).map(filaADocumentoVigente), limite: LIMITE },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: `Error al buscar documentos vigentes: ${err.message ?? "error desconocido"}` },
      { status: 500, headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
  }
}
