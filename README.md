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
2. Ve a **Project Settings → API** y copia a `.env.local`:
   - `Project URL` → `SUPABASE_URL`
   - `service_role` key (no la `anon` key) → `SUPABASE_SERVICE_ROLE_KEY`
3. Ve a **Project Settings → Database → Connection string → URI**, reemplaza
   `[YOUR-PASSWORD]` por la contraseña de la base (no es la `service_role`
   key; si no la tienes, se resetea en esa misma página) y ponla en
   `.env.local` como `SUPABASE_DB_URL`.
4. Aplica el esquema completo:

   ```bash
   npm run db:push
   ```

   Aplica todo lo que falte de `supabase/migrations/` en orden, lleva su
   propia tabla de control (`_migraciones_aplicadas`) y se puede correr las
   veces que sea: reconoce lo ya aplicado y no lo repite. Útil también para
   reconstruir el proyecto desde cero si hay que rehacerlo.

   ```bash
   npm run db:push -- --estado   # qué está aplicado y qué falta, sin tocar nada
   npm run db:push -- --force    # reaplica todas (son idempotentes)
   npm run db:push -- --sql      # imprime el SQL completo, sin conectarse
   ```

   Si no quieres usar la cadena de conexión, `--sql` genera un único bloque
   pegable en el SQL Editor con el mismo resultado.

No hace falta crear ningún bucket de Storage: el flujo actual no persiste los
PDFs (las columnas `storage_path_pdf` del esquema están para cuando se
necesite).

### 3. Cargar los maestros

El esquema queda vacío salvo los catálogos fijos (`secciones` y `etapas`, que
siembra la migración `0011`). Los maestros con datos reales se cargan así:

| Maestro | Cómo se carga |
| --- | --- |
| `documentos_vigentes` | Importando el Excel de control documental desde el panel **Documentos vigentes** de la UI |
| `equipos_calificados` | Importando el Excel de calificaciones desde el panel **Equipos calificados** de la UI |
| `documentos_obsoletos` | A mano desde su panel en la UI |
| `reglas_homologacion` | A mano desde el panel **Reglas** de la UI |
| `equipos` / `insumos` | Por SQL (todavía sin UI de administración) |

El sistema solo puede advertir sobre "equipo retirado" si la tabla `equipos`
tiene datos reales:

```sql
insert into equipos (codigo, descripcion, codigo_referencia, activo)
values ('10001704', 'BOMBO DE RECUBRIMIENTO JIANGNAN BG150 150kg', 'SOL-E101', true);
```

Cuando un Control de Cambios retire un equipo, actualiza el registro en vez
de borrarlo:

```sql
update equipos
set activo = false, retirado_en = now(), retirado_por_cc = 'CC-2026-0042'
where codigo = '10001704';
```

### 3b. Sobre RLS y la clave `anon`

La migración `0010` habilita Row Level Security en todas las tablas **sin
crear ninguna política**. No es un detalle cosmético: en Supabase una tabla
creada por SQL nace con RLS apagado y los roles `anon`/`authenticated`
tienen permisos por defecto sobre el esquema `public`, así que cualquiera con
la clave `anon` (que es pública por diseño) podría leer y escribir todas las
tablas vía la API REST.

Esta app no necesita ese acceso: no hay cliente de Supabase en el navegador y
todas las consultas salen de rutas de API del servidor con la `service_role`
key, que ignora RLS. Con RLS habilitado y cero políticas, el servidor sigue
funcionando igual y la clave pública no llega a nada.

Si algún día se agrega un cliente en el navegador, habrá que escribir
políticas explícitas para lo que ese cliente deba ver.

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

## Consumo de cuota de IA

La cuota gratuita de Gemini se agota rápido y el servicio se satura a ciertas
horas, así que el proyecto reduce deliberadamente cuándo hace falta el modelo.
Estas son las decisiones, ordenadas por lo que ahorran:

| Qué | Dónde | Efecto |
| --- | --- | --- |
| **Caché por huella de la entrada** | `src/lib/cacheRevisiones.ts` | Una entrada ya analizada devuelve el resultado guardado, sin llamada |
| **Homologación contra RMD de referencia, 100% determinística** | `src/lib/comparadorRmd/homologacion.ts` | `/api/revision-referencia` no consume cuota |
| **Verificación de correcciones por búsqueda de texto** | `src/lib/comparadorRmd/verificacion.ts` | `/api/verificar-correccion` no consume cuota |
| **Reglas de término verificadas sin modelo** | `src/lib/reglasReemplazo.ts` | Esas reglas salen del prompt y no se pueden pasar por alto |
| **El PDF crudo se adjunta sólo si el parseo quedó corto** | `src/lib/adjuntarPdf.ts` | Menos tokens por llamada en las rutas que sí usan el modelo |
| **Se saltea el modelo si los documentos son idénticos** | `/api/revision-borrador` | Cero llamadas cuando no hay nada que interpretar |
| **Cuatro verificaciones de coherencia hechas por código** | `src/lib/coherenciaRmd.ts` | Salen del prompt (~600 tokens menos) y ya no dependen de que el modelo no se distraiga |
| **El maestro de equipos viaja acotado al documento** | `src/lib/maestroEquipos.ts` | Con un maestro grande, cientos de líneas menos por llamada |

`/api/estado-ia` muestra cuántas llamadas se ahorraron por caché. Para ver
dónde se va la cuota realmente:

```sql
select operacion,
       count(*) filter (where exito) as ok,
       count(*) filter (where not exito) as fallidas
from uso_ia
where proveedor <> 'cache'
group by 1 order by ok desc;
```

### Cómo funciona la caché

La huella es un SHA-256 de todo lo que determina el resultado: la estructura
del RMD, el Control de Cambios, las reglas aplicables, el maestro de equipos
**y los maestros de los cruces determinísticos** (documentos obsoletos,
documentos vigentes de los códigos citados, equipos calificados de los equipos
citados). Incluir los maestros es lo que la hace correcta: si cambia un maestro
que este documento efectivamente usa, la huella cambia y la revisión se rehace.
Si sólo se hasheara el prompt, un documento que venció después de la corrida
seguiría devolviéndose sin su alerta.

`REVISION_CACHE_OFF=1` la apaga. Si la migración `0012` no se aplicó, la caché
se desactiva sola en vez de romper el guardado.

### Coherencia: qué verifica el código y qué el modelo

Cuatro alertas de coherencia las calcula `coherenciaRmd.ts` y los prompts
piden explícitamente **no** reportarlas, así que no hay duplicados:

| Alerta | Cómo se verifica |
| --- | --- |
| `referencia_cruzada_rota` | Citas internas ("según el paso 4.2.5") contra los pasos que existen. Exige la palabra clave para no confundir una cita con cualquier número con puntos, y acepta la cita a una subsección que sí tiene pasos |
| `equipo_sin_preparacion_registrada` | Cada ítem de la sección 1 contra el texto de todos los pasos, por código o por contención de sus palabras distintivas |
| `nota_vb_faltante` | El campo `requiereVB` contra las dos partes irreemplazables de la nota, no la frase completa: una redacción equivalente no cuenta como faltante |
| `cantidad_insumo_no_cuadra` | Suma las cantidades del procedimiento por insumo y las compara contra la sección 2, con conversión de unidades y 0,5% de tolerancia |

Son justo las que un modelo hace peor: sumar doce cantidades sin equivocarse,
recorrer treinta equipos sin saltarse ninguno, confirmar una nota literal.

El cuadre de cantidades es deliberadamente conservador y **se abstiene** si
algún paso menciona el insumo sin cantidad, si un paso menciona dos insumos a
la vez, o si un paso trae dos cantidades de la misma dimensión: ahí no se puede
saber qué número va con qué insumo, y un falso "no cuadra" en un documento GMP
es peor que no decir nada. También descarta unidades compuestas — "34 KG/CM2"
es una presión, no una masa.

**Detalle de lectura de cantidades:** en estos RMD el separador decimal es el
punto y las cantidades de insumo se escriben con tres decimales, así que
"5.250 kg" son 5,25 kg y no 5250 kg. Lo confirma `# Decimales = 3` en la
configuración de los campos de insumo del sistema digital.

De la regla de citas cruzadas, al modelo le queda la mitad que sí necesita
criterio: que el paso citado exista lo verifica el código; que su **contenido**
siga correspondiendo a lo que la cita da a entender sigue siendo suyo.

### Qué sigue necesitando el modelo, y por qué

- **`/api/revision` (RMD vs Control de Cambios).** Leer un CC en prosa y
  mapearlo a pasos numerados es el trabajo semántico real y es el valor del
  producto. No se toca.
- **`/api/revision-borrador`.** Juzgar si un cambio propuesto cumple las reglas
  permanentes, y leer anotaciones manuscritas del PDF del borrador
  (`origenAnotacionInformal`), necesita el modelo. Lo mecánico (qué paso se
  agregó, se quitó, se renumeró o cambió de texto) se calcula aparte y se usa
  como red de seguridad: si el modelo no reportó una diferencia mecánica, se
  agrega igual, y la respuesta dice cuántas hubo.
- **OCR de PDFs escaneados.** Es una tarea de visión.

Lo que se evaluó y se decidió NO hacer: recortar el prompt de
`/api/revision-borrador` a los pasos que cambiaron. Sería el mayor ahorro de
esa ruta, pero ese prompt está escrito para recibir dos documentos completos y
con documentos recortados reportaría como "paso eliminado" todo lo filtrado.
Requiere reescribir el prompt y validarlo contra documentos reales.

### Lo determinístico frente al modelo

Las comparaciones determinísticas nunca inventan equivalencias y son
reproducibles, pero tampoco dicen "estos dos pasos redactados distinto
significan lo mismo, ignoralo". Por eso reportan la diferencia con las dos
citas al lado y el criterio queda en el analista. En
`/api/revision-referencia` y `/api/verificar-correccion`, `usarIA: true` en el
body vuelve al camino con modelo cuando se quiere ese juicio semántico.

En la homologación, `nivelConfianza` cambia de significado respecto de la
versión con modelo: la detección determinística siempre es certera, así que el
campo indica si el hallazgo **amerita acción**. Un paso que la referencia no
tiene y que no se parece a nada suele ser legítimamente propio del producto
(confianza baja); uno con el mismo número y otra redacción casi siempre hay que
homologarlo (alta). La justificación siempre dice cuál de los dos casos es.

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
