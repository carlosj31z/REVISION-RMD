-- ============================================================
-- Maestro de documentos VIGENTES: la lista completa de Instructivos/
-- Procedimientos/Formatos que la empresa mantiene, importada en bloque
-- desde el Excel de control documental (columna E = código, F = título,
-- I = "Validez" = fecha hasta la que vale). A diferencia de
-- documentos_obsoletos (que el analista carga a mano caso por caso), esta
-- tabla se reemplaza completa en cada importación y es la fuente PRINCIPAL
-- para saber si un documento referenciado en un RMD sigue vigente: si
-- vigente_hasta ya pasó, se genera una alerta determinística igual que con
-- los obsoletos manuales (que siguen aplicando como respaldo secundario
-- para casos que este maestro no cubra).
-- ============================================================

create table if not exists documentos_vigentes (
  id              uuid primary key default gen_random_uuid(),
  codigo          text not null,        -- ej. "FACO-200"
  titulo          text not null,
  categoria       text,                 -- letra de categoría del Excel (F/P/I/M/POL)
  revision        text,                 -- número de revisión del Excel, ej. "02"
  fecha_emision   date,
  vigente_hasta   date,                 -- columna "Validez" del Excel; null = sin fecha de vencimiento conocida
  actualizado_en  timestamptz not null default now()
);

create unique index if not exists idx_documentos_vigentes_codigo
  on documentos_vigentes (upper(codigo));
