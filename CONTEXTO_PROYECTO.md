# CONTEXTO DEL PROYECTO — RMD Reviewer

Este documento resume todas las decisiones tomadas hasta ahora para que puedas
continuar el desarrollo en Claude Code sin perder contexto. Pégaselo a Claude
Code como primer mensaje al abrir el proyecto, o guárdalo como
`CONTEXTO_PROYECTO.md` en la raíz del repo y dile "lee CONTEXTO_PROYECTO.md
antes de empezar".

## Qué es este proyecto

Sistema de **detección de discrepancias** entre Registros de Manufactura
Digital (RMD) — documentos BPM/GMP de una planta farmacéutica peruana
(Medifarma) — y Controles de Cambios, No Conformidades, u órdenes de
homologación de términos.

**Decisión de alcance crítica (no revertir sin confirmar con el usuario):**
El sistema **NO redacta ni edita el RMD**. Su única función es detectar y
localizar (por número de paso exacto, ej. `4.4.23`) dónde el RMD vigente no
coincide con lo que exige el Control de Cambios. La corrección real del
documento la hace el analista (Carlos) directamente en SAP, transacción BTP.
Esto se decidió a mitad de desarrollo — la primera versión del diseño incluía
"redacción de reemplazo" (`CambioPropuesto` con `textoPropuesto`), y se
reemplazó por `DiscrepanciaDetectada` sin ese campo. Si ves código o
documentación que aún hable de "cambios propuestos" con texto de reemplazo,
es vestigio de la versión anterior y debe corregirse.

## Usuario y contexto de uso

- Carlos, analista de documentación técnica / QA-DOC en Medifarma, trabaja
  con RMDs de sección SOLIDOS (Fabricación, Recubrimiento, Envase,
  Acondicionado) entre otras secciones (ver lista abajo).
- Ya tiene experiencia construyendo herramientas internas similares
  (SAP materiales, RMD Pendientes de Autorización) como single-file HTML +
  Supabase. Este proyecto es más ambicioso: Next.js completo.
- Windows + PowerShell. Tuvo que resolver `ExecutionPolicy` para correr npm
  (`Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`).
- **`npm run build` ya compiló exitosamente** (verificado en su máquina,
  captura de pantalla confirmada: "Compiled successfully", 3 rutas API +
  página principal generadas sin errores).

## Stack confirmado (decisión explícita del usuario, no cambiar sin preguntar)

- **Frontend + Backend:** Next.js 14 (App Router) + TypeScript, un solo repo.
  Se descartó Streamlit/FastAPI original porque no encaja bien con Vercel.
- **Base de datos y storage:** Supabase (Postgres + Storage).
- **IA:** Google Gemini (`gemini-2.0-flash` en el código actual), vía
  `@google/generative-ai`, forzado a JSON con `responseSchema`.
- **Despliegue:** Vercel.
- **Extracción de PDF:** doble capa — `unpdf` (parseo heurístico en
  `src/lib/pdfExtractor.ts`) + el PDF crudo en base64 enviado también a
  Gemini como respaldo visual multimodal, porque el parseo por regex es
  frágil ante variaciones de espaciado.

## ⚠️ Seguridad — pendiente crítico sin resolver

El usuario compartió una clave de API de Gemini en texto plano dentro del
chat de Claude.ai al inicio de esta conversación. **Se le advirtió
explícitamente que la revocara y generara una nueva**, pero no hay
confirmación de que lo haya hecho. Si eres Claude Code retomando este
proyecto: **antes de tocar cualquier archivo de configuración, pregunta al
usuario si ya revocó esa clave**. Nunca debe quedar escrita en ningún archivo
del repo — solo en `.env.local` (gitignoreado) o en variables de entorno de
Vercel.

## Modelo de datos (Supabase) — ya definido, ejecutado o pendiente de ejecutar

Archivo: `supabase/migrations/0001_init.sql`

Tablas:
- `secciones` — SOLIDOS, ACONDICIONADO, CAPSULAS_BLANDAS, COSMETICOS,
  INY_HORMONALES, MENTHOLATUM, POLVOS_EFERVESCENTES, SEMISOLIDOS,
  SEMISOLIDOS_HORM, SOLIDOS_HORMONALES, SOLIDOS_4.
- `etapas` — FABRICACION, RECUBRIMIENTO, ENVASE, ACONDICIONADO.
- `seccion_etapas` — tabla puente (confirmado con el usuario: sección y etapa
  son conceptos independientes, sin solapamiento, aunque "ACONDICIONADO"
  existe como nombre en ambos catálogos).
- `equipos` — **maestro de equipos, fuente de verdad**. Tiene `activo:
  boolean`. Cuando un Control de Cambios retira un equipo, se marca
  `activo = false`, nunca se borra la fila.
- `insumos` — mismo criterio que equipos.
- `documentos` — un RMD subido, con su `texto_extraido jsonb`.
- `controles_cambio` — el CC asociado a un documento, texto o PDF.
- `revisiones` — el resultado de comparar un documento contra un CC. Guarda
  el JSON completo de Gemini en `resultado_ia jsonb`.
- `revision_decisiones` — trazabilidad de seguimiento. Campo `estado`:
  `pendiente | corregido_en_sap | descartado`. **Importante:** este NO es un
  historial de ediciones de texto (eso se descartó), es solo un checklist de
  "¿ya lo corregí en SAP?" por cada discrepancia detectada, identificada por
  `paso_id`.

**Decisión confirmada con el usuario:** cuando el sistema detecta que una
discrepancia involucra un equipo marcado como retirado, **no bloquea nada**:
guarda igual, pero la marca con severidad crítica (rojo) para que el usuario
decida. Ver `involucraEquipoRetirado` en los tipos.

## Contrato de tipos (`src/types/rmd.ts`)

Tipo central: `ResultadoRevisionIA`, con `discrepanciasDetectadas:
DiscrepanciaDetectada[]`. Cada discrepancia tiene:
- `pasoId` (ej. "4.4.23", o "N/A" si aplica a todo el documento)
- `tipoDiscrepancia` (paso_debe_agregarse | paso_debe_eliminarse |
  paso_debe_modificarse | equipo_debe_agregarse | equipo_debe_eliminarse |
  termino_sin_homologar | sin_discrepancia)
- `textoVigenteEnRMD` — cita fiel de lo que YA dice el RMD (no paráfrasis)
- `queExigeElControlDeCambios` — qué exige el CC (descripción/cita, NUNCA una
  redacción normativa nueva inventada por el modelo)
- `justificacion`, `origenControlCambio`, `involucraEquipoRetirado`,
  `equiposMencionados`, `nivelConfianza`

También existe `AlertaCoherencia` (para hallazgos que no son discrepancias
puntuales de un paso: equipo retirado en uso, paso huérfano, referencia
cruzada rota, unidad incoherente, condición ambiental contradictoria, campo
de control faltante).

## System Prompt de Gemini (`src/lib/gemini.ts`)

El prompt tiene **8 reglas absolutas**, la más importante siendo la Regla #1:
"Prohibido redactar reemplazos" — el modelo nunca debe generar texto
normativo nuevo, solo describir/citar lo que el CC exige. Regla #4 obliga a
respetar el maestro de equipos como fuente de verdad.

**Capa de validación adicional (no confiar ciegamente en el LLM):** la
función `validarYCompletarResultado()` en `gemini.ts` recalcula
`involucraEquipoRetirado` en el backend, cruzando `equiposMencionados` contra
la lista real de equipos inactivos de Supabase — independientemente de lo
que el modelo haya marcado. Este patrón (LLM propone, código valida) debe
mantenerse si se agregan más reglas de negocio duras.

## Endpoints existentes

- `POST /api/extract-pdf` — recibe PDF (`multipart/form-data`, campo
  `file`), devuelve `{ estructura, textoCompleto, pdfBase64, nombreArchivo }`.
  La extracción excluye deliberadamente la sección 6 (Verificación de
  Firmas) — confirmado con el usuario que no aplica a la revisión.
- `POST /api/revision` — recibe `rmdVigente`, `controlDeCambioTexto` o
  `pdfControlCambioBase64`, `seccionCodigo`, `etapaCodigo`. Carga el maestro
  de equipos filtrado por sección, llama a Gemini, persiste en `revisiones`,
  devuelve el resultado.
- `GET /api/revision?id=<uuid>` — recupera una revisión guardada.
- `POST /api/revision/[id]/decisiones` — marca el estado de seguimiento
  (`pendiente | corregido_en_sap | descartado`) de una discrepancia
  puntual, identificada por `pasoId`.
- `GET /api/revision/[id]/decisiones` — lista las decisiones de una revisión.

## UI (diseño intencional, no genérico — ver razones abajo)

Paleta: fondo `#F7F7F5` (papel), texto `#1C1C1A`, acento `#2B4C3F` (verde
botica oscuro — se eligió deliberadamente para NO parecer un dashboard SaaS
genérico ni usar los colores "default de IA" como terracota/morado).
Severidades con colores semánticos (crítica=rojo, alta=naranja,
media=ámbar oscuro, baja=gris azulado). Tipografía: IBM Plex Sans (cuerpo) +
IBM Plex Mono (códigos de paso, para reforzar que son referencias técnicas
exactas, no prosa).

Layout: dos paneles fijos, 50/50.
- Izquierda (`PanelRMDVigente.tsx`): el RMD vigente completo, con cada paso
  numerado. Los pasos con discrepancia se resaltan.
- Derecha (`PanelDiscrepancias.tsx`): bitácora de hallazgos, cada uno anclado
  por `pasoId`, con badges de severidad/confianza/estado, y botones para
  marcar "Corregido en SAP" / "Descartar".
- **Signature interaction:** al pasar el mouse sobre un paso a la izquierda,
  su discrepancia correspondiente se resalta a la derecha (y viceversa), vía
  estado compartido `pasoResaltado` en `page.tsx`. Esto no es decorativo:
  resuelve el problema real de "encontrar rápido en SAP dónde corregir".

Confirmado con el usuario: listado plano de discrepancias (no agrupado por
tipo ni reordenado por severidad) — el orden natural por paso es el que
sirve para trabajar en SAP.

## Estado actual — qué falta

1. **Seguridad:** confirmar que el usuario revocó la clave de Gemini expuesta
   y generó una nueva. No continuar sin preguntar esto primero.
2. **Supabase:** el usuario aún no confirmó si ya creó el proyecto, corrió el
   SQL de `0001_init.sql`, ni sembró datos en el maestro de equipos. Sin
   datos reales en `equipos`, la detección de "equipo retirado" no tiene
   nada contra qué validar.
3. **`.env.local`:** falta confirmar que existe con `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY` reales (nunca compartir
   estos valores en texto).
4. **Prueba end-to-end real:** nunca se ha corrido `npm run dev` con datos
   reales — no se ha probado subir uno de los PDFs de TRI AZIT + un Control
   de Cambios real contra el prompt de Gemini. Es el siguiente paso lógico
   antes de construir más features.
5. **No construido aún:** UI de administración del maestro de equipos (hoy
   solo se edita vía SQL directo en Supabase). El usuario preguntó por esto
   pero no se ha decidido si es prioridad inmediata.
6. **Sin probar:** el parseo heurístico de `pdfExtractor.ts` nunca se corrió
   contra los PDFs reales que el usuario compartió (TRI AZIT — Fabricación,
   Recubrimiento, Envase, Acondicionado). Los regex se escribieron mirando
   el texto extraído manualmente de esos PDFs en el chat, pero no hay
   garantía de que `unpdf` extraiga el texto con el mismo espaciado/saltos
   de línea. Esto es la pieza de mayor riesgo técnico del proyecto.

## PDFs de referencia usados para diseñar el parser

Cuatro RMDs de "TRI AZIT 500mg" (azitromicina), sección SOLIDOS, plantas
Medifarma:
- FABRICACION (TAB NUC) — 18 páginas, el más largo y complejo (dos
  fracciones de granulación, secado, compresión).
- RECUBRIMIENTO (TAB REC) — 10 páginas.
- ENVASE (TAB B1MM) — 9 páginas (blísteres).
- ACONDICIONADO (TAB B3 CJA x3) — 10 páginas (encajado en cajas).

Todos comparten estructura fija: encabezado Medifarma, Precauciones, Notas
Importantes, sección 1 (Equipos/Instrumentos/Materiales), sección 2
(Insumos), sección 3 (Condiciones Ambientales), sección 4 (Procedimiento,
con sub-numeración tipo `4.4.23.-`), sección 5 (Especificaciones de Producto
en Proceso), sección 6 (Verificación de Firmas — **excluida** de la
revisión).

## Próximos pasos sugeridos (en orden)

1. Confirmar seguridad de la clave de Gemini.
2. Terminar de configurar Supabase (correr SQL, sembrar equipos de prueba
   para SOLIDOS con datos reales tomados de los PDFs de TRI AZIT).
3. Correr `npm run dev` y probar el flujo completo con un PDF real +  un
   Control de Cambios inventado mínimo, para validar que:
   a) el parseo de `pdfExtractor.ts` extrae algo razonable,
   b) Gemini responde con JSON válido conforme al schema,
   c) la UI renderiza correctamente el resaltado cruzado.
4. Ajustar el parser o el prompt según lo que falle en el paso 3 (es
   altamente probable que algo falle ahí — es la parte menos probada).
5. Decidir si se construye la UI de administración del maestro de equipos.
