import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseClient";
import { filaADocumentoObsoleto } from "@/lib/documentosObsoletos";

export const runtime = "nodejs";

interface ActualizarDocumentoObsoletoBody {
  codigo?: string;
  motivo?: string | null;
  activo?: boolean;
}

/**
 * PATCH /api/documentos-obsoletos/[id]
 * Edita un documento obsoleto existente (código, motivo, o activar/desactivar).
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body: ActualizarDocumentoObsoletoBody = await req.json();
    const cambios: Record<string, unknown> = {};
    if (body.codigo !== undefined) cambios.codigo = body.codigo.trim().toUpperCase();
    if (body.motivo !== undefined) cambios.motivo = body.motivo?.trim() || null;
    if (body.activo !== undefined) cambios.activo = body.activo;

    if (Object.keys(cambios).length === 0) {
      return NextResponse.json({ error: "No se envió ningún cambio." }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("documentos_obsoletos")
      .update(cambios)
      .eq("id", params.id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ documento: filaADocumentoObsoleto(data) });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Error al actualizar el documento obsoleto: ${err.message ?? "error desconocido"}` },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/documentos-obsoletos/[id]
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("documentos_obsoletos").delete().eq("id", params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Error al eliminar el documento obsoleto: ${err.message ?? "error desconocido"}` },
      { status: 500 }
    );
  }
}
