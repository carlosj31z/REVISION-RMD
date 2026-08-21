import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/documentos-vigentes
 * Resumen del maestro (cuántos documentos hay cargados y cuándo se importó
 * la última vez) — nunca las filas completas, que pueden ser miles; el
 * cruce por código pasa por cargarDocumentosVigentesPorCodigos en el
 * servidor, no por el cliente.
 */
export async function GET() {
  try {
    const supabase = getSupabaseServerClient();

    const { count, error: errorConteo } = await supabase
      .from("documentos_vigentes")
      .select("*", { count: "exact", head: true });
    if (errorConteo) {
      return NextResponse.json({ error: errorConteo.message }, { status: 500 });
    }

    let actualizadoEn: string | null = null;
    if (count && count > 0) {
      const { data, error: errorFecha } = await supabase
        .from("documentos_vigentes")
        .select("actualizado_en")
        .order("actualizado_en", { ascending: false })
        .limit(1)
        .single();
      if (!errorFecha) actualizadoEn = data?.actualizado_en ?? null;
    }

    return NextResponse.json({ total: count ?? 0, actualizadoEn });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Error al consultar documentos vigentes: ${err.message ?? "error desconocido"}` },
      { status: 500 }
    );
  }
}
