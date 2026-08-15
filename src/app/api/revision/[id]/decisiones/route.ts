import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseClient";

export const runtime = "nodejs";

interface DecisionBody {
  pasoId: string;
  estado: "pendiente" | "corregido_en_sap" | "descartado";
  comentario?: string;
  marcadoPor?: string;
}

/**
 * POST /api/revision/[id]/decisiones
 * Marca el estado de seguimiento de una discrepancia puntual.
 * Este sistema NO edita el RMD: solo registra que el analista ya aplicó
 * (o descartó) la corrección directamente en el BTP de SAP.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body: DecisionBody = await req.json();

    if (!body.pasoId || !body.estado) {
      return NextResponse.json(
        { error: "Faltan campos requeridos: 'pasoId' y 'estado'." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseServerClient();

    // Upsert manual: si ya existe una decisión para este paso en esta revisión, se actualiza.
    const { data: existente } = await supabase
      .from("revision_decisiones")
      .select("id")
      .eq("revision_id", params.id)
      .eq("paso_id", body.pasoId)
      .maybeSingle();

    if (existente) {
      const { data, error } = await supabase
        .from("revision_decisiones")
        .update({
          estado: body.estado,
          comentario: body.comentario ?? null,
          marcado_por: body.marcadoPor ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existente.id)
        .select()
        .single();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json(data);
    }

    const { data, error } = await supabase
      .from("revision_decisiones")
      .insert({
        revision_id: params.id,
        paso_id: body.pasoId,
        estado: body.estado,
        comentario: body.comentario ?? null,
        marcado_por: body.marcadoPor ?? null,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Error al registrar la decisión: ${err.message ?? "error desconocido"}` },
      { status: 500 }
    );
  }
}

/**
 * GET /api/revision/[id]/decisiones
 * Lista todas las decisiones de seguimiento de una revisión.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("revision_decisiones")
    .select("*")
    .eq("revision_id", params.id)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
