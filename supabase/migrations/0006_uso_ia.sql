-- ============================================================
-- Registro de uso de cada proveedor de IA (Gemini clave principal, Gemini
-- clave de respaldo, Groq). Google no expone un endpoint para consultar la
-- cuota restante de una API key en tiempo real — solo se entera uno al
-- recibir un 429 ("Quota exceeded"). Como el proyecto es el único
-- consumidor de estas claves, llevar la cuenta nosotros mismos de cada
-- llamada (éxito o fallo) es la única forma confiable de mostrarle al
-- usuario cuánto lleva usado hoy antes de que se quede sin cuota.
-- ============================================================

create table if not exists uso_ia (
  id          uuid primary key default gen_random_uuid(),
  proveedor   text not null,     -- 'gemini_principal' | 'gemini_respaldo' | 'groq'
  operacion   text not null,     -- nombreOperacion pasado a generarJSONConFallback, para depurar
  exito       boolean not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_uso_ia_proveedor_fecha
  on uso_ia (proveedor, created_at);
