import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseClient";
import { filaAEquipoCalificado } from "@/lib/equiposCalificados";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMITE = 100;

/**
 * GET /api/equipos-calificados/buscar?q=texto
 * Mismo patrón que /api/documentos-vigentes/buscar: búsqueda por código SAP
 * o descripción, nunca el maestro completo de una.
 */
export async function GET(req: NextRequest) {
  try {
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
    if (q.length < 2) {
      return NextResponse.json(
        { equipos: [], error: null },
        { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
      );
    }

    const seguro = q.replace(/[,()]/g, " ").trim();

    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("equipos_calificados")
      .select("id, codigo_sap, descripcion, estado, actualizado_en")
      .or(`codigo_sap.ilike.%${seguro}%,descripcion.ilike.%${seguro}%`)
      .order("codigo_sap", { ascending: true })
      .limit(LIMITE);

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500, headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
      );
    }

    return NextResponse.json(
      { equipos: (data ?? []).map(filaAEquipoCalificado), limite: LIMITE },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: `Error al buscar equipos calificados: ${err.message ?? "error desconocido"}` },
      { status: 500, headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
  }
}
