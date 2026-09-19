-- ============================================================
-- Cola de trabajos de IA con reintento diferido.
--
-- El problema que resuelve no es de cuota sino de horario: la cuota gratuita
-- de Gemini se satura a ciertas horas y hasta ahora, cuando fallaban los cinco
-- proveedores configurados, el analista recibía un error y tenía que volver a
-- subir todo más tarde a mano. Ahora el trabajo queda encolado con su entrada
-- completa y el software reintenta solo.
--
-- `payload` guarda el body original de la request, así que el reintento corre
-- exactamente la misma revisión — incluido el PDF en base64 cuando viene, que
-- es lo que hace el jsonb grande. Es a propósito: un reintento que corriera con
-- menos información que el intento original daría un resultado distinto al que
-- el analista pidió.
--
-- `huella` es la misma de la caché (migración 0012): cuando el trabajo se
-- completa, la revisión queda guardada con esa huella, así que si el analista
-- vuelve a subir el mismo documento lo recibe al instante y sin llamada.
--
-- `proximo_intento` es lo que permite el backoff: cada fallo lo empuja más
-- lejos en el tiempo en vez de martillar un servicio que ya dijo que no.
-- ============================================================

create table if not exists trabajos_ia (
  id              uuid primary key default gen_random_uuid(),
  operacion       text not null,      -- 'revision' | 'revision_borrador'
  estado          text not null default 'pendiente'
                  check (estado in ('pendiente', 'procesando', 'completado', 'fallido')),
  payload         jsonb not null,     -- body original de la request
  huella          text,               -- huella de caché, para reusar el resultado
  resultado       jsonb,              -- respuesta completa cuando se completa
  revision_id     uuid references revisiones(id),
  intentos        int not null default 0,
  ultimo_error    text,
  proximo_intento timestamptz not null default now(),
  creado_por      text,
  created_at      timestamptz not null default now(),
  actualizado_en  timestamptz not null default now()
);

-- El worker pide exactamente esto: los trabajos que ya les toca reintentar.
create index if not exists idx_trabajos_ia_por_tomar
  on trabajos_ia (proximo_intento)
  where estado in ('pendiente', 'procesando');

-- Para que la UI encuentre el trabajo de una revisión ya resuelta por huella.
create index if not exists idx_trabajos_ia_huella
  on trabajos_ia (huella)
  where huella is not null;

alter table trabajos_ia enable row level security;
