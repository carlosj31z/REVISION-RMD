import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// dynamic="force-dynamic" evita que el SERVIDOR reuse una respuesta vieja,
// pero sin un Cache-Control explícito el navegador (o el CDN de Vercel
// delante) puede quedarse con la primera respuesta igual — ver el mismo
// fix en /api/estado-ia, donde esto causó que el conteo quedara pegado en
// 0 pese a que el servidor ya calculaba el número correcto en cada pedido.
function sinCache(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
  });
}

/**
 * GET /api/equipos-calificados
 * Resumen del maestro (cuántos equipos hay cargados y cuándo se importó la
 * última vez) — nunca las filas completas.
 */
export async function GET() {
  try {
    const supabase = getSupabaseServerClient();

    // OJO: "count: exact, head: true" (pedir sólo el header Content-Range,
    // sin body) devolvía count=0 en producción pese a que la tabla sí tenía
    // filas reales — un select normal las traía sin problema. En vez de
    // depender de esa combinación puntual, se pide "actualizado_en" de
    // TODAS las filas (liviano, una sola columna) y se cuenta el array.
    const { data: filas, error: errorConteo } = await supabase
      .from("equipos_calificados")
      .select("actualizado_en");
    if (errorConteo) {
      return sinCache({ error: errorConteo.message }, 500);
    }

    const total = filas?.length ?? 0;
    const actualizadoEn =
      total > 0
        ? filas!.reduce((max, f) => (f.actualizado_en > max ? f.actualizado_en : max), filas![0].actualizado_en)
        : null;

    return sinCache({ total, actualizadoEn });
  } catch (err: any) {
    return sinCache(
      { error: `Error al consultar equipos calificados: ${err.message ?? "error desconocido"}` },
      500
    );
  }
}
