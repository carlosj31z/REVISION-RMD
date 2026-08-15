-- ============================================================
-- Reglas permanentes de homologación: instrucciones fijas que el usuario
-- define una sola vez (ej. "X debe reemplazarse por Y") y que se aplican
-- automáticamente en TODAS las revisiones futuras de la sección/etapa que
-- indique — sin tener que repetirlas en el Control de Cambios cada vez.
-- ============================================================

create table if not exists reglas_homologacion (
  id            uuid primary key default gen_random_uuid(),
  texto         text not null,        -- la regla en lenguaje natural
  seccion_codigo text,                -- null = aplica a TODAS las secciones
  etapa_codigo  text,                 -- null = aplica a TODAS las etapas
  activa        boolean not null default true,
  creado_por    text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_reglas_seccion_etapa
  on reglas_homologacion(seccion_codigo, etapa_codigo);
