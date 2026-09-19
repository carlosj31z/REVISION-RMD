import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseClient";
import {
  marcarCompletado,
  registrarFallo,
  tomarTrabajosParaReintentar,
  TRABAJOS_POR_CORRIDA,
  type TrabajoEncolado,
} from "@/lib/colaTrabajos";
import { POST as ejecutarRevision } from "@/app/api/revision/route";
import { POST as ejecutarRevisionBorrador } from "@/app/api/revision-borrador/route";

export const runtime = "nodejs";
// Cada trabajo es una llamada al modelo, que puede tardar hasta dos minutos.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Reintenta los trabajos que quedaron en cola porque todos los proveedores de
 * IA estaban saturados o sin cuota (ver colaTrabajos.ts).
 *
 * Se invoca desde un cron. En Vercel se configura en vercel.json y Vercel manda
 * `Authorization: Bearer $CRON_SECRET`; con un cron externo se puede pasar el
 * mismo secreto como ?secreto=. Sin secreto configurado sólo funciona en
 * desarrollo: un endpoint abierto que gasta cuota de IA es un problema, no una
 * comodidad.
 *
 * Cómo ejecuta cada trabajo: llamando al handler de la ruta original con el
 * payload guardado. Es deliberado — así el reintento corre EXACTAMENTE el mismo
 * pipeline que el intento original (maestros, cruces determinísticos, caché,
 * persistencia) sin una segunda copia de esa lógica que se pueda desincronizar.
 * El campo `_trabajoId` en el body le dice a la ruta que no vuelva a encolar:
 * la reprogramación la lleva el worker.
 */
function autorizado(req: NextRequest): { ok: boolean; motivo?: string } {
  const secreto = process.env.CRON_SECRET;

  if (!secreto) {
    if (process.env.NODE_ENV === "production") {
      return {
        ok: false,
        motivo:
          "Falta CRON_SECRET en las variables de entorno. Definila en Vercel y volvé a desplegar: " +
          "sin secreto este endpoint quedaría abierto y cualquiera podría gastar la cuota de IA.",
      };
    }
    return { ok: true };
  }

  const enviado =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    req.nextUrl.searchParams.get("secreto") ??
    "";
  return enviado === secreto ? { ok: true } : { ok: false, motivo: "Secreto inválido." };
}

function requestDeReintento(trabajo: TrabajoEncolado): NextRequest {
  return new NextRequest(new URL("http://cola.local/api/reintento"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...trabajo.payload, _trabajoId: trabajo.id }),
  });
}

async function procesar(trabajo: TrabajoEncolado): Promise<{ id: string; resultado: string }> {
  const supabase = getSupabaseServerClient();
  const handler = trabajo.operacion === "revision" ? ejecutarRevision : ejecutarRevisionBorrador;

  try {
    const respuesta = await handler(requestDeReintento(trabajo));
    const cuerpo = await respuesta.json();

    if (!respuesta.ok || cuerpo?.error) {
      const { reprogramado } = await registrarFallo(
        supabase,
        trabajo,
        String(cuerpo?.error ?? `HTTP ${respuesta.status}`)
      );
      return { id: trabajo.id, resultado: reprogramado ? "reprogramado" : "fallido" };
    }

    await marcarCompletado(supabase, trabajo.id, cuerpo, cuerpo?.revisionId ?? null);
    return { id: trabajo.id, resultado: "completado" };
  } catch (err: any) {
    const { reprogramado } = await registrarFallo(
      supabase,
      trabajo,
      err?.message ?? "error desconocido"
    );
    return { id: trabajo.id, resultado: reprogramado ? "reprogramado" : "fallido" };
  }
}

async function correr(req: NextRequest) {
  const permiso = autorizado(req);
  if (!permiso.ok) {
    return NextResponse.json({ error: permiso.motivo }, { status: 401 });
  }

  try {
    const supabase = getSupabaseServerClient();
    const trabajos = await tomarTrabajosParaReintentar(supabase, TRABAJOS_POR_CORRIDA);

    if (trabajos.length === 0) {
      return NextResponse.json({ procesados: 0, detalle: [] });
    }

    // En serie a propósito: si la cuota está justa, dos llamadas en paralelo se
    // pisan entre sí y las dos fallan.
    const detalle: Array<{ id: string; resultado: string }> = [];
    for (const trabajo of trabajos) detalle.push(await procesar(trabajo));

    return NextResponse.json({ procesados: detalle.length, detalle });
  } catch (err: any) {
    console.error("Error procesando la cola de trabajos:", err);
    return NextResponse.json(
      { error: `Error procesando la cola: ${err?.message ?? "error desconocido"}` },
      { status: 500 }
    );
  }
}

// GET para que lo pueda invocar el cron de Vercel (que usa GET) y POST para
// disparar una corrida a mano.
export async function GET(req: NextRequest) {
  return correr(req);
}

export async function POST(req: NextRequest) {
  return correr(req);
}
