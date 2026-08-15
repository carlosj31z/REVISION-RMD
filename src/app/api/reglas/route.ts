import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseClient";
import type { ReglaHomologacion, SeccionCodigo, EtapaCodigo } from "@/types/rmd";

export const runtime = "nodejs";

function filaAregla(fila: any): ReglaHomologacion {
  return {
    id: fila.id,
    texto: fila.texto,
    seccionCodigo: fila.seccion_codigo ?? null,
    etapaCodigo: fila.etapa_codigo ?? null,
    activa: fila.activa,
    creadoPor: fila.creado_por ?? null,
    createdAt: fila.created_at,
  };
}

/**
 * GET /api/reglas
 * GET /api/reglas?seccion=CAPSULAS_BLANDAS&etapa=FABRICACION&soloActivas=true
 *
 * Sin filtros: devuelve TODAS las reglas (para la pantalla de administración).
 * Con seccion/etapa: devuelve solo las reglas aplicables a esa combinación
 * (seccion_codigo/etapa_codigo NULL en la fila = aplica a todas), que es lo
 * que consumen /api/revision y /api/revision-borrador antes de llamar a Gemini.
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseServerClient();
    const seccion = req.nextUrl.searchParams.get("seccion");
    const etapa = req.nextUrl.searchParams.get("etapa");
    const soloActivas = req.nextUrl.searchParams.get("soloActivas") === "true";

    let query = supabase.from("reglas_homologacion").select("*").order("created_at", {
      ascending: false,
    });

    if (soloActivas) query = query.eq("activa", true);
    if (seccion) query = query.or(`seccion_codigo.is.null,seccion_codigo.eq.${seccion}`);
    if (etapa) query = query.or(`etapa_codigo.is.null,etapa_codigo.eq.${etapa}`);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ reglas: (data ?? []).map(filaAregla) });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Error al listar reglas: ${err.message ?? "error desconocido"}` },
      { status: 500 }
    );
  }
}

interface CrearReglaBody {
  texto: string;
  seccionCodigo?: SeccionCodigo | null;
  etapaCodigo?: EtapaCodigo | null;
  creadoPor?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body: CrearReglaBody = await req.json();
    if (!body.texto || !body.texto.trim()) {
      return NextResponse.json({ error: "Falta el texto de la regla." }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("reglas_homologacion")
      .insert({
        texto: body.texto.trim(),
        seccion_codigo: body.seccionCodigo ?? null,
        etapa_codigo: body.etapaCodigo ?? null,
        creado_por: body.creadoPor ?? null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ regla: filaAregla(data) });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Error al crear la regla: ${err.message ?? "error desconocido"}` },
      { status: 500 }
    );
  }
}
