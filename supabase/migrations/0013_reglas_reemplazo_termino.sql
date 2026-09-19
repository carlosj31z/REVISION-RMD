-- ============================================================
-- Reglas de homologación estructuradas: "el término X se escribe Y".
--
-- Las reglas de hoy son texto libre que se le pasa al prompt, así que
-- verificar una regla del tipo "donde diga MEZCLADORA DOBLE CONO debe decir
-- MEZCLADORA DE DOBLE CONO" cuesta una llamada al modelo — cuando en
-- realidad es una búsqueda literal sobre el texto de los pasos.
--
-- Con `tipo = 'reemplazo_termino'` la regla pasa a tener los dos términos en
-- columnas propias y se aplica de forma determinística (búsqueda por palabra
-- completa, sin distinguir mayúsculas ni tildes, igual que el resto de los
-- cruces del proyecto). Esas reglas dejan de ocupar espacio en el prompt: el
-- modelo solo recibe las de `tipo = 'libre'`, que son las que de verdad
-- necesitan interpretación.
--
-- `tipo` arranca en 'libre' para que todas las reglas que ya existan sigan
-- comportándose exactamente igual que antes.
-- ============================================================

alter table reglas_homologacion
  add column if not exists tipo text not null default 'libre';

alter table reglas_homologacion
  add column if not exists termino_origen text;

alter table reglas_homologacion
  add column if not exists termino_destino text;

alter table reglas_homologacion drop constraint if exists reglas_homologacion_tipo_check;
alter table reglas_homologacion
  add constraint reglas_homologacion_tipo_check
  check (tipo in ('libre', 'reemplazo_termino'));

-- Una regla de reemplazo sin los dos términos no se puede aplicar, y dejarla
-- entrar significaría una regla que el usuario cree activa y que en la
-- práctica nunca detecta nada.
alter table reglas_homologacion drop constraint if exists reglas_homologacion_terminos_check;
alter table reglas_homologacion
  add constraint reglas_homologacion_terminos_check
  check (
    tipo <> 'reemplazo_termino'
    or (
      termino_origen is not null and btrim(termino_origen) <> ''
      and termino_destino is not null and btrim(termino_destino) <> ''
    )
  );
