import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseClient";

export const runtime = "nodejs";

interface ActualizarReglaBody {
  texto?: string;
  seccionCodigo?: string | null;
  etapaCodigo?: string | null;
  activa?: boolean;
}

/**
 * PATCH /api/reglas/[id]
 * Edita una regla existente (texto, alcance, o activar/desactivar).
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body: ActualizarReglaBody = await req.json();
    const cambios: Record<string, unknown> = {};
    if (body.texto !== undefined) cambios.texto = body.texto.trim();
    if (body.seccionCodigo !== undefined) cambios.seccion_codigo = body.seccionCodigo;
    if (body.etapaCodigo !== undefined) cambios.etapa_codigo = body.etapaCodigo;
    if (body.activa !== undefined) cambios.activa = body.activa;

    if (Object.keys(cambios).length === 0) {
      return NextResponse.json({ error: "No se envió ningún cambio." }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("reglas_homologacion")
      .update(cambios)
      .eq("id", params.id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ regla: data });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Error al actualizar la regla: ${err.message ?? "error desconocido"}` },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/reglas/[id]
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("reglas_homologacion").delete().eq("id", params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Error al eliminar la regla: ${err.message ?? "error desconocido"}` },
      { status: 500 }
    );
  }
}
