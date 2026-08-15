-- ============================================================
-- Maestro de documentos obsoletos: códigos de Instructivo/Procedimiento/
-- Formato (nomenclatura <I/P/F><área:3 letras>-<letra><3 dígitos>, ej.
-- "IPRO-P200") que el usuario marca como ya no vigentes. Si el RMD en
-- revisión sigue citando alguno de estos códigos, se genera una alerta de
-- coherencia automática — el cruce es determinístico (regex + set lookup),
-- no depende de que el modelo de IA lo note.
-- ============================================================

create table if not exists documentos_obsoletos (
  id            uuid primary key default gen_random_uuid(),
  codigo        text not null,        -- ej. "IPRO-P200"
  motivo        text,                 -- opcional: por qué quedó obsoleto / qué lo reemplaza
  activo        boolean not null default true,
  creado_por    text,
  created_at    timestamptz not null default now()
);

create unique index if not exists idx_documentos_obsoletos_codigo
  on documentos_obsoletos (upper(codigo));
