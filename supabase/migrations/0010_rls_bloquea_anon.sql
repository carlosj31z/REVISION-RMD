-- ============================================================
-- Cierra el acceso de la clave `anon` a todas las tablas.
--
-- En Supabase, una tabla creada por SQL nace con RLS DESHABILITADO, y los
-- roles `anon`/`authenticated` tienen permisos por defecto sobre el esquema
-- public. Traducido: con RLS apagado, cualquiera que tenga la clave `anon`
-- (que es pública por diseño — va en el frontend) puede leer, escribir y
-- borrar CUALQUIER tabla de este proyecto vía la API REST. El dashboard lo
-- marca como "Unrestricted".
--
-- Esta app no necesita ese acceso: no hay cliente de Supabase en el
-- navegador (no existe ninguna variable NEXT_PUBLIC_SUPABASE_*), todas las
-- consultas salen de rutas de API del servidor con la Service Role Key, y
-- ese rol ignora RLS por definición. Entonces habilitar RLS SIN crear
-- ninguna política deja las tablas exactamente como deben estar: el
-- servidor sigue trabajando igual, y la clave `anon` no llega a nada.
--
-- Si algún día se agrega un cliente en el navegador, ahí sí habrá que
-- escribir políticas explícitas para lo que ese cliente deba ver.
-- ============================================================

alter table secciones             enable row level security;
alter table etapas                enable row level security;
alter table seccion_etapas        enable row level security;
alter table equipos               enable row level security;
alter table insumos               enable row level security;
alter table documentos            enable row level security;
alter table controles_cambio      enable row level security;
alter table revisiones            enable row level security;
alter table revision_decisiones   enable row level security;
alter table reglas_homologacion   enable row level security;
alter table documentos_obsoletos  enable row level security;
alter table documentos_vigentes   enable row level security;
alter table equipos_calificados   enable row level security;
alter table uso_ia                enable row level security;

-- Verificación (opcional, para correr a mano en el SQL Editor): esta consulta
-- debe devolver 0 filas. Cada fila que devuelva es una tabla que la clave
-- pública todavía puede leer y escribir.
--
--   select tablename
--   from pg_tables
--   where schemaname = 'public' and not rowsecurity;
