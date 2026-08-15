-- ============================================================
-- RMD Reviewer — Esquema inicial de Supabase (Postgres)
-- ============================================================

-- ---------- Catálogos maestros ----------

create table if not exists secciones (
  id            uuid primary key default gen_random_uuid(),
  codigo        text unique not null,     -- 'SOLIDOS', 'ACONDICIONADO', 'CAPSULAS_BLANDAS', ...
  nombre        text not null,
  created_at    timestamptz not null default now()
);

create table if not exists etapas (
  id            uuid primary key default gen_random_uuid(),
  codigo        text unique not null,     -- 'FABRICACION', 'RECUBRIMIENTO', 'ENVASE', 'ACONDICIONADO'
  nombre        text not null,
  created_at    timestamptz not null default now()
);

-- Qué etapas aplican a qué sección (ej. ACONDICIONADO como sección solo usa etapa ACONDICIONADO;
-- SOLIDOS como sección usa FABRICACION, RECUBRIMIENTO, ENVASE)
create table if not exists seccion_etapas (
  seccion_id    uuid references secciones(id) on delete cascade,
  etapa_id      uuid references etapas(id) on delete cascade,
  primary key (seccion_id, etapa_id)
);

-- Maestro de equipos: fuente de verdad de qué equipos/instrumentos existen y están vigentes.
-- Si un Control de Cambios retira un equipo, se marca activo=false y la IA no debe
-- proponer texto que lo mencione en pasos nuevos.
create table if not exists equipos (
  id            uuid primary key default gen_random_uuid(),
  codigo        text unique not null,        -- ej. '10001704'
  descripcion   text not null,               -- ej. 'BOMBO DE RECUBRIMIENTO JIANGNAN BG150 150kg'
  codigo_referencia text,                    -- ej. 'SOL-E101'
  seccion_id    uuid references secciones(id),
  etapa_id      uuid references etapas(id),
  activo        boolean not null default true,
  retirado_en   timestamptz,
  retirado_por_cc text,                      -- referencia al control de cambios que lo retiró
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Maestro de insumos (mismo criterio que equipos, útil para detectar insumos discontinuados)
create table if not exists insumos (
  id            uuid primary key default gen_random_uuid(),
  codigo        text unique not null,
  descripcion   text not null,
  activo        boolean not null default true,
  retirado_en   timestamptz,
  retirado_por_cc text,
  created_at    timestamptz not null default now()
);

-- ---------- Documentos ----------

create table if not exists documentos (
  id                uuid primary key default gen_random_uuid(),
  producto          text not null,           -- 'TRI AZIT 500mg TAB NUC'
  codigo_documento  text not null,           -- '5000002229'
  version_actual    text,                    -- '2002/2'
  edicion_actual    int,                     -- 6
  seccion_id        uuid references secciones(id),
  etapa_id          uuid references etapas(id),
  storage_path_pdf  text not null,           -- ruta en Supabase Storage del PDF original
  texto_extraido    jsonb,                   -- estructura extraída (secciones 1-5, sin la 6)
  created_at        timestamptz not null default now()
);

-- ---------- Control de Cambios ----------

create table if not exists controles_cambio (
  id                uuid primary key default gen_random_uuid(),
  documento_id      uuid references documentos(id),
  codigo_cc         text,                    -- código interno del CC si existe
  tipo_entrada      text not null check (tipo_entrada in ('pdf','texto')),
  storage_path_pdf  text,                    -- si vino como PDF
  contenido_texto   text,                    -- si vino como texto libre
  contenido_extraido jsonb,                  -- normalizado por la IA/parser
  created_at        timestamptz not null default now()
);

-- ---------- Revisiones (el corazón del sistema) ----------

create table if not exists revisiones (
  id                  uuid primary key default gen_random_uuid(),
  documento_id        uuid references documentos(id),
  control_cambio_id    uuid references controles_cambio(id),
  estado              text not null default 'borrador'
                       check (estado in ('borrador','en_revision','aprobado','rechazado')),
  resultado_ia        jsonb not null,        -- JSON completo devuelto por Gemini (ver contrato abajo)
  score_coherencia     numeric,               -- 0-100, calculado a partir del resultado_ia
  advertencias_equipos jsonb,                 -- equipos retirados detectados en el texto propuesto
  creado_por           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Trazabilidad de seguimiento: qué discrepancias detectadas ya fueron corregidas
-- en SAP (BTP) por el analista. Este sistema NO edita el RMD; solo detecta y
-- permite marcar el avance de la corrección real, hecha fuera del sistema.
create table if not exists revision_decisiones (
  id             uuid primary key default gen_random_uuid(),
  revision_id    uuid references revisiones(id) on delete cascade,
  paso_id        text not null,      -- ej. '4.4.23', o 'N/A' si aplica a todo el documento
  estado         text not null default 'pendiente'
                 check (estado in ('pendiente','corregido_en_sap','descartado')),
  comentario     text,               -- ej. nota de por qué se descartó, o referencia al cambio hecho en SAP
  marcado_por    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_documentos_seccion_etapa on documentos(seccion_id, etapa_id);
create index if not exists idx_equipos_activo on equipos(activo);
create index if not exists idx_revisiones_documento on revisiones(documento_id);
