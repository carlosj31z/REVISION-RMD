-- ============================================================
-- Siembra los dos catálogos fijos: secciones y etapas.
--
-- Son los mismos valores que declara SeccionCodigo / EtapaCodigo en
-- src/types/rmd.ts, así que si acá faltara alguno la UI ofrecería una
-- sección que la base no reconoce. /api/revision resuelve el UUID de la
-- sección por su `codigo` para filtrar el maestro de equipos: sin estas
-- filas el filtro se cae en silencio (el `if (seccion)` del route lo deja
-- pasar) y el prompt se arma con los equipos de TODAS las líneas.
--
-- Va como migración y no como un bloque suelto del README para que quede
-- dentro de lo que aplica `npm run db:push`, sin pasos manuales.
--
-- Los `on conflict do nothing` hacen que se pueda correr las veces que sea
-- sin duplicar ni fallar.
--
-- NO se siembran acá:
--   * equipos / insumos — son datos reales de planta. Cargalos vos; el
--     README muestra el INSERT y el UPDATE de retiro por Control de Cambio.
--   * documentos_vigentes / equipos_calificados — se llenan importando los
--     Excel desde los paneles que ya existen en la UI, no por SQL.
--   * seccion_etapas — el mapeo real sección↔etapa no está documentado en
--     el repo más allá de dos casos, y hoy ninguna consulta lee esta tabla.
--     Preferible vacía que con un mapeo inventado.
-- ============================================================

insert into secciones (codigo, nombre) values
  ('SOLIDOS',              'Sólidos'),
  ('ACONDICIONADO',        'Acondicionado'),
  ('CAPSULAS_BLANDAS',     'Cápsulas Blandas'),
  ('COSMETICOS',           'Cosméticos'),
  ('INY_HORMONALES',       'Inyectables Hormonales'),
  ('MENTHOLATUM',          'Mentholatum'),
  ('POLVOS_EFERVESCENTES', 'Polvos Efervescentes'),
  ('SEMISOLIDOS',          'Semisólidos'),
  ('SEMISOLIDOS_HORM',     'Semisólidos Hormonales'),
  ('SOLIDOS_HORMONALES',   'Sólidos Hormonales'),
  ('SOLIDOS_4',            'Sólidos 4')
on conflict (codigo) do nothing;

insert into etapas (codigo, nombre) values
  ('FABRICACION',   'Fabricación'),
  ('RECUBRIMIENTO', 'Recubrimiento'),
  ('ENVASE',        'Envase'),
  ('ACONDICIONADO', 'Acondicionado')
on conflict (codigo) do nothing;
