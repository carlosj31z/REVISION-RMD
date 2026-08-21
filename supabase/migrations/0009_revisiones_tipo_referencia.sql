-- ============================================================
-- Suma el tercer tipo de revisión: comparación contra un RMD de referencia
-- para sugerir homologación de redacción/orden/estructura (ver "Comparar
-- con RMD Referencia" en la UI y compararRMDvsReferencia en gemini.ts).
-- ============================================================

alter table revisiones drop constraint if exists revisiones_tipo_check;

alter table revisiones
  add constraint revisiones_tipo_check
  check (tipo in ('control_cambio', 'borrador_produccion', 'referencia_homologacion'));
