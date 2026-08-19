import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseClient";
import { listarProveedoresConfigurados } from "@/lib/llmFallback";

export const runtime = "nodejs";
// Sin esto, Next.js cachea la respuesta de este GET la primera vez que se
// pide (Full Route Cache: no lee cookies/headers/searchParams, así que
// calificaba para cachearse) y sigue sirviendo esa foto vieja sin volver a
// consultar Supabase — el conteo se quedaba pegado en 0 aunque ya hubiera
// llamadas registradas. Confirmado en vivo: el primer pedido dio 0, se
// insertó una fila real, y el segundo pedido (mismo proceso de dev, sin
// reiniciar) siguió dando 0 hasta agregar esta línea.
export const dynamic = "force-dynamic";

// dynamic="force-dynamic" evita que Next.js reuse una respuesta vieja en el
// SERVIDOR, pero no le dice al navegador (ni a un CDN delante, como el de
// Vercel) que no debe guardar esta respuesta — sin un Cache-Control
// explícito, un GET sin headers puede quedar cacheado ahí igual, y el
// contador se ve pegado en un valor viejo por más que el servidor sí esté
// calculando el número correcto en cada pedido.
function sinCache(body: unknown) {
  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
  });
}

/**
 * GET /api/estado-ia
 * Cuenta cuántas llamadas se le hicieron hoy a cada proveedor de IA
 * configurado (Gemini clave principal / respaldos, Groq), para que el
 * analista sepa si se está por quedar sin cuota antes de que le falle un
 * documento a mitad de camino.
 *
 * OJO con lo que esto NO es: Google no expone la cuota restante real de una
 * API key — este conteo es NUESTRO, de las llamadas que pasaron por esta
 * app desde medianoche UTC de hoy. Si la misma clave se usa en otro lado,
 * o el reinicio real de Google (medianoche hora del Pacífico) no coincide
 * con medianoche UTC, el número puede no ser exacto — es una estimación
 * útil, no un valor oficial de Google.
 */
export async function GET() {
  const proveedoresConfigurados = listarProveedoresConfigurados();

  if (proveedoresConfigurados.length === 0) {
    return sinCache({
      disponible: false,
      motivo: "No hay ninguna clave de IA configurada.",
      proveedores: [],
    });
  }

  let supabase;
  try {
    supabase = getSupabaseServerClient();
  } catch (err: any) {
    // Supabase no configurado: no es un error de la app, es un despliegue sin
    // esas env vars. El resto de la app también dependería de esto, pero acá
    // conviene degradar con un mensaje claro en vez de un 500.
    return sinCache({
      disponible: false,
      motivo: "Supabase no está configurado, así que no se puede contar el uso.",
      proveedores: [],
    });
  }

  const inicioDeHoyUTC = new Date();
  inicioDeHoyUTC.setUTCHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from("uso_ia")
    .select("proveedor, exito")
    .gte("created_at", inicioDeHoyUTC.toISOString());

  if (error) {
    // Típicamente: la tabla uso_ia todavía no existe porque no se corrió la
    // migración 0006_uso_ia.sql. Se avisa en vez de romper la página.
    return sinCache({
      disponible: false,
      motivo: `No se pudo leer el uso registrado: ${error.message}`,
      proveedores: [],
    });
  }

  const conteos = new Map<string, { llamadas: number; exitosas: number }>();
  for (const fila of data ?? []) {
    const actual = conteos.get(fila.proveedor) ?? { llamadas: 0, exitosas: 0 };
    actual.llamadas += 1;
    if (fila.exito) actual.exitosas += 1;
    conteos.set(fila.proveedor, actual);
  }

  // Se listan TODOS los proveedores configurados, no sólo los que ya
  // tuvieron alguna llamada hoy — 0 llamadas es información válida (todavía
  // no se usó, no que no exista).
  const proveedores = proveedoresConfigurados.map((etiqueta) => {
    const c = conteos.get(etiqueta) ?? { llamadas: 0, exitosas: 0 };
    return { etiqueta, llamadas: c.llamadas, exitosas: c.exitosas, fallidas: c.llamadas - c.exitosas };
  });

  return sinCache({
    disponible: true,
    desde: inicioDeHoyUTC.toISOString(),
    actualizado: new Date().toISOString(),
    proveedores,
  });
}
