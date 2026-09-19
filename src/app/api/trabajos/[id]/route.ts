import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseClient";
import { obtenerTrabajo } from "@/lib/colaTrabajos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/trabajos/<id>
 * Estado de un trabajo que quedó en cola por saturación de los proveedores de
 * IA. La UI lo consulta cada tanto mientras la pestaña está abierta; cuando el
 * estado es "completado" viene el resultado listo para mostrar, igual que si la
 * revisión hubiera salido en el primer intento.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const trabajo = await obtenerTrabajo(getSupabaseServerClient(), params.id);

    if (!trabajo) {
      return NextResponse.json(
        { error: "No existe ningún trabajo con ese identificador." },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        id: trabajo.id,
        estado: trabajo.estado,
        intentos: trabajo.intentos,
        proximoIntento: trabajo.proximoIntento,
        // El error del último intento sirve para que el analista entienda por
        // qué sigue esperando (cuota agotada, servicio saturado).
        ultimoError: trabajo.estado === "completado" ? null : trabajo.ultimoError,
        resultado: trabajo.estado === "completado" ? trabajo.resultado : null,
        revisionId: trabajo.revisionId,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: `Error al consultar el trabajo: ${err?.message ?? "error desconocido"}` },
      { status: 500 }
    );
  }
}
