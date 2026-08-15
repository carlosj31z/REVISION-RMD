-- ============================================================
-- revisiones.documento_id debe poder ser NULL: el endpoint
-- POST /api/revision permite guardar una revisión "suelta" sin
-- documento_id asociado (uso pensado para pruebas rápidas / análisis
-- ad-hoc antes de que exista un registro en `documentos`).
-- ============================================================

alter table revisiones alter column documento_id drop not null;
