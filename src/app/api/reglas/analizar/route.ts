import { NextRequest, NextResponse } from "next/server";
import { analizarRegla } from "@/lib/analizarRegla";
import { getSupabaseServerClient } from "@/lib/supabaseClient";
import type { ReglaHomologacion } from "@/types/rmd";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/reglas/analizar
 * Analiza una regla ANTES de guardarla: devuelve cómo la interpretó la IA,
 * qué le quedó ambiguo y con qué reglas existentes choca. No persiste nada.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const texto = String(body.texto ?? "").trim();

    if (!texto) {
      return NextResponse.json({ error: "Falta el texto de la regla." }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("reglas_homologacion")
      .select("id, texto, seccion_codigo, etapa_codigo, activa")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error cargando reglas para el cruce:", error);
    }

    const reglasExistentes: ReglaHomologacion[] = (data ?? []).map((r: any) => ({
      id: r.id,
      texto: r.texto,
      seccionCodigo: r.seccion_codigo,
      etapaCodigo: r.etapa_codigo,
      activa: r.activa,
    }));

    // Una regla en edición no debe reportarse como conflicto consigo misma.
    const paraCruzar = body.excluirId
      ? reglasExistentes.filter((r) => r.id !== body.excluirId)
      : reglasExistentes;

    const analisis = await analizarRegla({
      textoRegla: texto,
      seccionCodigo: body.seccionCodigo ?? null,
      etapaCodigo: body.etapaCodigo ?? null,
      reglasExistentes: paraCruzar,
      historial: Array.isArray(body.historial) ? body.historial : undefined,
    });

    return NextResponse.json({ analisis });
  } catch (err: any) {
    console.error("Error en /api/reglas/analizar:", err);
    return NextResponse.json(
      { error: `No se pudo analizar la regla: ${err.message ?? "error desconocido"}` },
      { status: 500 }
    );
  }
}
