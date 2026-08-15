-- ============================================================
-- Distingue revisiones de tipo "Control de Cambios" (instrucción de qué
-- cambiar) de revisiones de tipo "Borrador de Producción" (comparación
-- directa de dos versiones completas del RMD).
-- ============================================================

alter table revisiones
  add column if not exists tipo text not null default 'control_cambio'
  check (tipo in ('control_cambio', 'borrador_produccion'));
