-- ============================================================
-- Suma el tercer tipo de revisión: comparación contra un RMD de referencia
-- para sugerir homologación de redacción/orden/estructura (ver "Comparar
-- con RMD Referencia" en la UI y compararRMDvsReferencia en gemini.ts).
--
-- "add column if not exists" de abajo repite la 0003 a propósito: si esa
-- migración nunca se corrió (la columna "tipo" no existe todavía), esta
-- migración fallaría con "column tipo does not exist" al intentar tocar el
-- constraint. Repetirla acá hace que 0009 funcione sola, la hayas corrido
-- antes o no.
-- ============================================================

alter table revisiones
  add column if not exists tipo text not null default 'control_cambio';

alter table revisiones drop constraint if exists revisiones_tipo_check;

alter table revisiones
  add constraint revisiones_tipo_check
  check (tipo in ('control_cambio', 'borrador_produccion', 'referencia_homologacion'));
