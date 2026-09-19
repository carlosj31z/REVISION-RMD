-- ============================================================
-- Caché de extracciones por OCR.
--
-- /api/extract-pdf sólo llama al modelo cuando el PDF es un escaneo sin capa
-- de texto: ahí hay que reconstruir la estructura leyéndolo visualmente, y en
-- un escaneo de doce páginas eso es de las operaciones más caras del sistema.
-- Sin caché, volver a subir el MISMO archivo la repite entera — y subir el
-- mismo RMD dos veces es lo normal: una para revisar contra el Control de
-- Cambios y otra para verificar la corrección.
--
-- La clave es el SHA-256 del archivo, no su nombre: dos archivos con el mismo
-- nombre pueden ser distintos, y el mismo archivo puede llegar con otro nombre.
--
-- No hace falta invalidar nada: el mismo PDF siempre tiene la misma estructura.
-- Si algún día cambia el parseo del OCR, se borra la tabla y se vuelve a
-- llenar sola.
-- ============================================================

create table if not exists extracciones_ocr (
  hash_pdf         text primary key,   -- SHA-256 del archivo
  estructura       jsonb not null,
  pasos_detectados int,
  nombre_archivo   text,               -- sólo informativo, para depurar
  created_at       timestamptz not null default now()
);

alter table extracciones_ocr enable row level security;
