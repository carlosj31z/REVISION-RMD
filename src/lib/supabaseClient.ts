import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Cliente de servidor: usa la Service Role Key, NUNCA se expone al navegador.
// Se instancia perezosamente para evitar fallos de build cuando las env vars
// aún no están configuradas (ej. en preview deployments).
let _client: SupabaseClient | null = null;

export function getSupabaseServerClient(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en las variables de entorno. " +
        "Defínelas en .env.local (desarrollo) o en el dashboard de Vercel (producción)."
    );
  }

  _client = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  return _client;
}
