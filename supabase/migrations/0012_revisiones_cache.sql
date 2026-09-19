-- ============================================================
-- Caché de revisiones por huella de la entrada.
--
-- Hoy cada corrida gasta una llamada al modelo aunque la entrada sea
-- idéntica a una ya analizada: reabrir un documento, reintentar a la mañana
-- después de que el servicio estuvo saturado, o volver a correr lo mismo
-- tras un ajuste de la UI. Con la cuota gratuita eso es caro y además
-- innecesario: misma entrada, misma salida.
--
-- `hash_entrada` guarda un SHA-256 de todo lo que determina el resultado
-- (estructura del RMD, texto del Control de Cambios, reglas aplicables,
-- maestro de equipos, y el tipo de revisión). Antes de llamar al modelo se
-- busca una revisión previa con la misma huella; si existe, se devuelve su
-- `resultado_ia` tal cual.
--
-- Es NULL en las revisiones viejas y en las que se corran con la caché
-- desactivada, así que el índice es parcial: no ocupa espacio por filas que
-- nunca se van a consultar.
-- ============================================================

alter table revisiones add column if not exists hash_entrada text;

-- El orden de columnas sigue el patrón de la consulta: se busca por huella y
-- tipo, y se toma la más reciente.
create index if not exists idx_revisiones_hash_entrada
  on revisiones (hash_entrada, tipo, created_at desc)
  where hash_entrada is not null;
