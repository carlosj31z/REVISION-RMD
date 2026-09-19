# RMD Reviewer

Sistema de **detección de discrepancias** entre Registros de Manufactura Digital
(RMD) vigentes y Controles de Cambios, No Conformidades, u órdenes de
homologación de términos.

**Importante sobre el alcance:** este sistema no redacta ni edita el RMD. Su
única función es detectar y localizar (por número de paso, ej. `4.4.23`) dónde
el documento vigente no coincide con lo que exige el Control de Cambios. La
corrección real del documento se hace directamente en SAP (transacción BTP)
por el analista.

## Stack

- **Frontend/Backend:** Next.js 14 (App Router) + TypeScript, un solo repo.
- **Base de datos y almacenamiento:** Supabase (Postgres + Storage).
- **IA:** Google Gemini (`gemini-2.0-flash`), forzado a JSON estructurado vía
  `responseSchema`.
- **Despliegue:** Vercel.

## Setup

### 1. Clonar e instalar

```bash
npm install
```

### 2. Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. Ve a **SQL Editor** y ejecuta el contenido de `supabase/migrations/0001_init.sql`.
3. Ve a **Project Settings → API** y copia:
   - `Project URL` → `SUPABASE_URL`
   - `service_role` key (no la `anon` key) → `SUPABASE_SERVICE_ROLE_KEY`
4. Crea un bucket de Storage llamado `rmd-pdfs` si vas a persistir los PDFs
   originales (opcional para el MVP; el flujo actual no lo requiere para
   funcionar, pero está referenciado en el esquema para cuando lo necesites).

### 3. Sembrar el maestro de equipos y catálogos

El sistema solo puede advertir sobre "equipo retirado" si la tabla `equipos`
tiene datos reales. Un ejemplo mínimo para arrancar con la sección SOLIDOS:

```sql
insert into secciones (codigo, nombre) values
  ('SOLIDOS', 'Sólidos'),
  ('ACONDICIONADO', 'Acondicionado'),
  ('CAPSULAS_BLANDAS', 'Cápsulas Blandas'),
  ('COSMETICOS', 'Cosméticos'),
  ('INY_HORMONALES', 'Inyectables Hormonales'),
  ('MENTHOLATUM', 'Mentholatum'),
  ('POLVOS_EFERVESCENTES', 'Polvos Efervescentes'),
  ('SEMISOLIDOS', 'Semisólidos'),
  ('SEMISOLIDOS_HORM', 'Semisólidos Hormonales'),
  ('SOLIDOS_HORMONALES', 'Sólidos Hormonales'),
  ('SOLIDOS_4', 'Sólidos 4');

insert into etapas (codigo, nombre) values
  ('FABRICACION', 'Fabricación'),
  ('RECUBRIMIENTO', 'Recubrimiento'),
  ('ENVASE', 'Envase'),
  ('ACONDICIONADO', 'Acondicionado');

-- Ejemplo de equipo activo (ajusta seccion_id/etapa_id según tus UUIDs reales)
insert into equipos (codigo, descripcion, codigo_referencia, activo)
values ('10001704', 'BOMBO DE RECUBRIMIENTO JIANGNAN BG150 150kg', 'SOL-E101', true);
```

Cuando un Control de Cambios retire un equipo, actualiza el registro:

```sql
update equipos
set activo = false, retirado_en = now(), retirado_por_cc = 'CC-2026-0042'
where codigo = '10001704';
```

Idealmente esto se hace desde una UI de administración simple (no incluida
en este MVP, pero el esquema ya está listo para construirla como una tabla
CRUD estándar sobre Supabase).

### 4. Variables de entorno

```bash
cp .env.example .env.local
```

Completa `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, y `GEMINI_API_KEY` en
`.env.local`. **Nunca** compartas estas claves en chats, commits, o cualquier
canal de texto plano — si una clave se expone accidentalmente, revócala de
inmediato en el dashboard correspondiente y genera una nueva.

### 5. Desarrollo local

```bash
npm run dev
```

Abre `http://localhost:3000`.

### 6. Despliegue en Vercel

1. Sube el repo a GitHub (verifica que `.env.local` NO esté incluido — el
   `.gitignore` ya lo excluye).
2. Importa el repo en Vercel.
3. En **Settings → Environment Variables**, agrega las mismas tres variables
   de `.env.local`.
4. Despliega.

## Flujo de uso

1. Subes el PDF del RMD vigente.
2. Seleccionas Sección y Etapa (para filtrar el maestro de equipos relevante).
3. Pegas el Control de Cambios como texto, o subes su PDF.
4. El sistema extrae la estructura del RMD (excluyendo la sección 6 de
   Verificación de Firmas, que no aplica a esta revisión), la compara contra
   el Control de Cambios usando Gemini, y valida las menciones a equipos
   contra el maestro de Supabase.
5. Obtienes un panel de dos columnas: el RMD vigente a la izquierda (con los
   pasos que tienen discrepancias resaltados), y la bitácora de hallazgos a
   la derecha, anclada por número de paso.
6. Corriges el documento en SAP (BTP) y marcas cada hallazgo como
   "Corregido en SAP" o "Descartado" para llevar trazabilidad.

## Notas de diseño técnico

- **La IA no tiene la última palabra sobre equipos retirados.** El campo
  `involucraEquipoRetirado` se recalcula en el backend (`gemini.ts`,
  `validarYCompletarResultado`) cruzando contra el maestro real de Supabase,
  independientemente de lo que el modelo haya marcado.
- **Extracción de PDF de doble capa.** El parseo heurístico (`pdfExtractor.ts`)
  arma la estructura para la UI, pero el PDF crudo también se envía a Gemini
  como respaldo visual multimodal, por si el parseo pierde algo por
  variaciones de espaciado o layout.
- **El sistema nunca redacta texto de reemplazo.** El `SYSTEM_PROMPT` en
  `gemini.ts` lo prohíbe explícitamente (regla #1). Si en algún momento ves
  que el modelo empieza a devolver redacciones normativas completas en vez de
  citas/descripciones, es una señal de que el prompt necesita ajuste, no algo
  que debas aceptar como "mejora" — cambia el contrato de responsabilidad del
  sistema.

## Comparador de configuraciones (sin IA)

Aparte del flujo anterior, el repo incluye un módulo **100% determinístico,
sin ninguna llamada a IA**, para comparar el archivo de "Configuración" (el
export del sistema digital) de un producto de referencia ya autorizado contra
el de un producto en desarrollo, antes de mandar el RMD a Validaciones.

- **Módulo:** `src/lib/comparadorConfiguracion/`, con
  `compareConfigurations(referenceBuffer, targetBuffer)` como punto de entrada.
- **Tipos:** `src/types/configuracion.ts` (`ComparisonReport`).
- **Endpoint:** `POST /api/comparar-configuracion` — recibe los dos archivos
  como `multipart/form-data` en los campos `referencia` y `objetivo`, y
  devuelve `{ reporte }` con el `ComparisonReport` en JSON.
- **CLI:**

  ```bash
  npm run compare-config -- referencia.xlsx objetivo.xlsx
  npm run compare-config -- referencia.xlsx objetivo.xlsx --solo-errores
  npm run compare-config -- referencia.xlsx objetivo.xlsx --json > informe.json
  ```

  Termina con código 1 si el archivo objetivo tiene errores, para poder usarlo
  como verificación previa en un script.
- **Tests:** `npm test` (runner nativo de Node vía `tsx`; requiere Node 20+).
  Los casos son hojas sintéticas armadas en código, sin `.xlsx` de fixture.

### Qué valida

1. **Integridad de la cadena `Depende → Cod.`** — el `Depende` de un ítem
   apunta al `Cod.` del ítem que debe completarse justo antes, formando la
   secuencia real de ejecución del registro. Se distingue el *enlace roto*
   (apunta a un `Cod.` que no existe antes: error) del *branch-back* (retoma
   un ítem anterior que sí existe, típico del inicio de una subsección).
2. **Numeración de `Orden`** — que la `N` de cada nivel (`6.4.N`,
   `6.4.31.N`) sea consecutiva, sin saltos ni duplicados. Los `Orden` de un
   solo nivel se agrupan por sección, así que las subsecciones cortas
   (PRECAUCIONES, NOTAS IMPORTANTES, CONDICIONES AMBIENTALES) pueden
   reiniciar en 1 sin que cuente como salto.
3. **Columnas `Tipo Dato` / `Val. Inicial` / `Val. Final` / `# Decimales`** —
   todo `Rango` con los dos extremos numéricos y `Val. Inicial < Val. Final`;
   todo `Rango` y todo `Números` con `# Decimales` definido; los extremos
   vacíos en cualquier tipo que no sea `Rango`; y ningún `Tipo Dato` en el
   objetivo que no exista también en la referencia.
4. **Cruce por `Cod.` compartido** — el mismo `Cod.` configurado distinto en
   cada archivo (advertencia: puede ser un cambio intencional), y el `Cod.`
   repetido dentro de un mismo archivo con definiciones distintas entre sus
   propias apariciones (inconsistencia interna).
5. **Diff estructural** — qué `Cod.` existe sólo en la referencia (paso
   eliminado) y qué `Cod.` sólo en el objetivo (paso agregado).

### Decisiones de diseño del comparador

- **La referencia es la línea base, no un archivo exento.** Se valida también
  a ella y sus hallazgos se informan, pero no bloquean al objetivo:
  `resumen.sinErroresBloqueantes` sólo mira los errores atribuibles al
  archivo objetivo. Un branch-back que la referencia ya trae en la misma
  posición baja a informativo en el objetivo, porque es el patrón esperado
  del registro y no un defecto del producto nuevo.
- **`Cod.` no es único dentro de un archivo.** El mismo campo del sistema
  (ej. "HUMEDAD RELATIVA") se reutiliza en varias etapas, así que un
  `Depende` se resuelve a la **aparición anterior más cercana** de ese `Cod.`,
  y el análisis de huérfanos trabaja por posición y no por código.
- **El núcleo no conoce Excel.** Todo trabaja sobre una matriz de celdas;
  SheetJS queda aislado en `parser.ts` (`leerMatriz`). Eso es lo que permite
  testear con casos sintéticos y cambiar de librería tocando un solo archivo.
- **Las columnas se identifican por su encabezado, no por su posición**, para
  que un cambio de orden en el export falle de forma visible en vez de
  devolver datos corridos. El título de sección se acepta tanto en la
  columna `#` (que es donde viene hoy) como en `Orden`.
