import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseClient";
import { filaADocumentoObsoleto } from "@/lib/documentosObsoletos";

export const runtime = "nodejs";

const RE_CODIGO_DOCUMENTO = /^[IPF][A-Z]{3}-[A-Z]\d{3}$/;

/**
 * GET /api/documentos-obsoletos
 * GET /api/documentos-obsoletos?soloActivos=true
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseServerClient();
    const soloActivos = req.nextUrl.searchParams.get("soloActivos") === "true";

    let query = supabase
      .from("documentos_obsoletos")
      .select("*")
      .order("created_at", { ascending: false });
    if (soloActivos) query = query.eq("activo", true);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ documentos: (data ?? []).map(filaADocumentoObsoleto) });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Error al listar documentos obsoletos: ${err.message ?? "error desconocido"}` },
      { status: 500 }
    );
  }
}

interface CrearDocumentoObsoletoBody {
  codigo: string;
  motivo?: string;
  creadoPor?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body: CrearDocumentoObsoletoBody = await req.json();
    const codigo = body.codigo?.trim().toUpperCase();
    if (!codigo) {
      return NextResponse.json({ error: "Falta el código del documento." }, { status: 400 });
    }
    if (!RE_CODIGO_DOCUMENTO.test(codigo)) {
      return NextResponse.json(
        {
          error:
            "El código no respeta la nomenclatura esperada (ej. \"IPRO-P200\"): " +
            "una letra I/P/F, 3 letras de área, un guión, una letra y 3 dígitos.",
        },
        { status: 400 }
      );
    }

    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("documentos_obsoletos")
      .insert({
        codigo,
        motivo: body.motivo?.trim() || null,
        creado_por: body.creadoPor ?? null,
      })
      .select()
      .single();

    if (error) {
      const mensaje =
        error.code === "23505"
          ? `El documento ${codigo} ya está registrado como obsoleto.`
          : error.message;
      return NextResponse.json({ error: mensaje }, { status: 500 });
    }

    return NextResponse.json({ documento: filaADocumentoObsoleto(data) });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Error al crear el documento obsoleto: ${err.message ?? "error desconocido"}` },
      { status: 500 }
    );
  }
}
