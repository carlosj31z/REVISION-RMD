-- ============================================================
-- Maestro de equipos calificados: estado de calificación (OQ/PQ) de cada
-- equipo por su Código SAP, importado en bloque desde la hoja "Cronograma"
-- del Excel de Registro de Áreas/Sistemas/Equipos a Calificar (columna
-- "CÓDIGO SAP" y "ESTADO GENERAL"). Se cruza contra los códigos de equipo
-- citados en la sección 1 (EQUIPOS/INSTRUMENTOS/MATERIALES) de cada RMD: si
-- un equipo referenciado no figura como CALIFICADO acá, se genera una
-- alerta determinística con el estado real (PENDIENTE, EN PROCESO,
-- INOPERATIVO, NO CUMPLE, etc.). Se reemplaza completo en cada importación,
-- igual que documentos_vigentes — es la foto vigente a hoy, no un agregado.
-- ============================================================

create table if not exists equipos_calificados (
  id              uuid primary key default gen_random_uuid(),
  codigo_sap      text not null,
  descripcion     text,
  estado          text not null,   -- ej. "CALIFICADO", "PENDIENTE", "EN PROCESO", "INOPERATIVO", "NO CUMPLE"
  actualizado_en  timestamptz not null default now()
);

create unique index if not exists idx_equipos_calificados_codigo
  on equipos_calificados (upper(codigo_sap));
