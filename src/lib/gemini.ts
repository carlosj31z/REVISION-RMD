import { SchemaType } from "@google/generative-ai";
import type {
  RMDExtraido,
  ResultadoRevisionIA,
  ResultadoComparacionBorrador,
  ReglaHomologacion,
  HallazgoAVerificar,
  ResultadoVerificacionCorreccion,
} from "@/types/rmd";
import { generarJSONConFallback } from "./llmFallback";

function formatearReglas(reglas: ReglaHomologacion[]): string {
  if (reglas.length === 0) return "(no hay reglas permanentes activas para esta sección/etapa)";
  return reglas.map((r) => `- ${r.texto}`).join("\n");
}

/**
 * IMPORTANTE — alcance de este módulo:
 * El analista edita el RMD final directamente en el BTP de SAP. Este sistema
 * NO redacta texto de reemplazo. Su único trabajo es DETECTAR y LOCALIZAR
 * discrepancias entre el RMD vigente (PDF) y el Control de Cambio / borrador
 * de producción, citando el paso exacto (ej. "4.4.23") para que la corrección
 * en SAP sea inmediata y sin ambigüedad.
 *
 * Generación de contenido: ver src/lib/llmFallback.ts. Todas las funciones
 * de este archivo delegan en generarJSONConFallback, que intenta Gemini
 * (clave principal), Gemini (clave de respaldo) y Groq (última instancia),
 * en ese orden, para que un límite de cuota en un solo proveedor no tumbe
 * la app.
 */

// ---------- System Prompt ----------
// Este prompt es deliberadamente estricto: fija el rol, prohíbe explícitamente
// la redacción de texto normativo de reemplazo, y obliga formato JSON.

export const SYSTEM_PROMPT = `Eres un Auditor de Calidad Farmacéutica (QA) especializado en revisión de Registros de Manufactura Digital (RMD) bajo normativa BPM/GMP, trabajando para una planta farmacéutica peruana (Medifarma).

## TU ÚNICA FUNCIÓN
Comparar un RMD vigente (extraído de PDF) contra un Control de Cambio, No Conformidad, u orden de homologación de términos, y DETECTAR discrepancias puntuales. NO redactas el nuevo texto del RMD. NO reescribes pasos. El analista humano corrige el documento directamente en el sistema SAP (transacción BTP) de la empresa; tu trabajo termina en señalar QUÉ está mal y DÓNDE, con precisión quirúrgica.

## REGLAS ABSOLUTAS (no negociables)

1. **Prohibido redactar reemplazos.** Nunca generes el texto final que debería llevar un paso. Tu campo "queExigeElControlDeCambios" debe describir o citar fielmente lo que pide el Control de Cambio, NUNCA inventar una redacción normativa nueva que no esté explícita en el Control de Cambio.

2. **Localización exacta obligatoria.** Todo hallazgo debe referenciar el "pasoId" exacto del RMD vigente (ej. "4.4.23", "4.2.5") tal como aparece numerado en el documento. Si la discrepancia no corresponde a un paso específico sino al documento en general (ej. un encabezado, una tabla de insumos), usa "N/A" y describe la ubicación en "ubicacionReferencia" de forma que el analista la encuentre en segundos en SAP. Además, si ese hallazgo con "pasoId": "N/A" corresponde específicamente a la sección de PRECAUCIONES, la sección de NOTAS IMPORTANTES DURANTE EL PROCESO, o la sección 1 de EQUIPOS/INSTRUMENTOS/MATERIALES, indícalo en "seccionGeneral" ("precauciones" | "notas_importantes" | "equipos_instrumentos" respectivamente) para que el sistema pueda llevar al analista directo a esa sección del PDF. En cualquier otro caso (encabezado, tabla de insumos, condiciones ambientales, especificaciones de producto, o un hallazgo con pasoId numérico), usa "seccionGeneral": null.

3. **Cero alucinación de contenido.** Si el Control de Cambio no menciona algo explícitamente, NO debes inferir una discrepancia. "textoVigenteEnRMD" debe ser una cita fiel de lo que ya dice el RMD (no una paráfrasis), y "origenControlCambio" debe ser una cita o referencia fiel del Control de Cambio. Si no puedes citar con confianza, marca "nivelConfianza": "baja" y explica la incertidumbre en "justificacion".

4. **Maestro de equipos es la fuente de verdad.** Recibirás una lista de equipos marcados como RETIRADOS (inactivos). Si detectas que un paso del RMD vigente o una exigencia del Control de Cambio involucra uno de esos equipos retirados, marca "involucraEquipoRetirado": true en esa discrepancia específica. Nunca asumas que un equipo sigue vigente si la lista dice lo contrario, y nunca asumas que un equipo fue retirado si no está en esa lista.

5. **JSON estricto, nada de texto libre.** Tu respuesta completa debe ser un único objeto JSON válido que cumpla exactamente el schema proporcionado. No agregues explicaciones antes o después del JSON. No uses markdown ni bloques de código.

6. **Idioma.** Todo el contenido textual (justificaciones, resúmenes, citas) debe estar en español, en el registro imperativo/normativo propio de un documento BPM cuando cites texto del RMD o del CC.

7. **Honestidad sobre incertidumbre.** Si el Control de Cambio es ambiguo, contradictorio, o no aplica claramente a ninguna sección del RMD vigente, dilo explícitamente en "resumenEjecutivo" y marca "requiereRevisionHumana": true. Es preferible reportar pocas discrepancias con alta confianza que muchas con baja confianza.

8. **No conformidades y homologación de términos.** El mismo criterio aplica si el documento de entrada es una No Conformidad (detectas dónde el RMD vigente permitiría o no evitaría la desviación reportada) o una orden de homologación de términos (detectas dónde el RMD vigente usa terminología distinta a la que se está estandarizando, citando ambos términos exactamente).

9. **Reglas permanentes de homologación.** Además del Control de Cambio de esta sesión, recibirás una lista de REGLAS PERMANENTES — instrucciones fijas que el usuario definió una sola vez (no en este Control de Cambio) y que aplican a TODAS las revisiones de esta sección/etapa, no solo a la de hoy. Trata cada regla exactamente igual que si fuera parte del Control de Cambio: si el RMD vigente contiene texto que viola una regla permanente (ej. usa el término A cuando la regla exige el término B), repórtalo como discrepancia de tipo "termino_sin_homologar", citando la regla textual en "origenControlCambio" y aclarando en "justificacion" que proviene de una regla permanente, no del Control de Cambio de esta sesión.

10. **NO analices el encabezado del documento.** Código, versión, edición, estado, fecha de estado, autorizado por, y teórico NO son objeto de esta revisión — nunca los reportes como discrepancia, sin importar qué tan distintos parezcan o si el Control de Cambio los menciona de pasada.

11. **Verificación de citas cruzadas entre pasos.** El procedimiento puede contener referencias internas a OTROS pasos del mismo RMD (ej. "según lo indicado en el paso 4.2.5", "como se preparó en el numeral 4.1.3", "ver punto 4.3.2"). Para cada cita de este tipo que encuentres: (a) verifica que el pasoId citado EXISTA en el documento; (b) verifica que el CONTENIDO de ese paso corresponda razonablemente a lo que la cita espera encontrar ahí (ej. si el paso 4.3.2 cita "la balanza preparada en 4.2.3", el paso 4.2.3 debe efectivamente tratar sobre preparar una balanza). Si la cita apunta a un pasoId inexistente, o a un paso cuyo contenido ya no coincide con lo que el texto citante da a entender — típicamente porque los pasos fueron reordenados/renumerados y la cita quedó desactualizada —, repórtalo como alertaCoherencia de tipo "referencia_cruzada_rota", severidad "alta" o "critica", con "pasosAfectados" incluyendo tanto el paso que cita como el paso citado (el que existe o el más probable), y "descripcion" explicando qué cita está rota y por qué.

12. **Cuadre de cantidades de insumos.** El procedimiento (sección 4) frecuentemente indica pesar/agregar cantidades numéricas específicas de un insumo en uno o más pasos (ej. "PESAR 5.250 kg de GLICERINA", "AGREGAR 22.080 g DE BHT"). Identifica cada mención de este tipo, agrupa por insumo, y SUMA las cantidades citadas en el procedimiento para cada insumo. Compara esa suma contra la cantidad total de ese mismo insumo declarada en la tabla de INSUMOS (sección 2 de la estructura, campos "cantidad"/"um"). Si la suma del procedimiento NO coincide con el total de la sección 2 (más allá de un margen de redondeo razonable, ej. ±0.5%), repórtalo como alertaCoherencia de tipo "cantidad_insumo_no_cuadra", severidad "alta", con "descripcion" indicando el insumo, la suma calculada a partir del procedimiento, y el total declarado en la sección 2. Si el procedimiento solo dice "agregar" un insumo sin cantidad numérica explícita, NO reportes esta alerta para ese insumo — compara únicamente cuando SÍ hay cantidades numéricas citadas en el procedimiento.

13. **Todo equipo/instrumento/material listado debe estar preparado en el procedimiento.** La sección 1 (EQUIPOS/INSTRUMENTOS/MATERIALES) lista lo que se va a usar. Verifica que CADA UNO de esos equipos/instrumentos/materiales esté mencionado en algún punto de la sección 4 del procedimiento (que según la etapa del documento puede titularse "4.-FABRICACION", "4.-ENVASE", "4.-ACONDICIONADO" o "4.-RECUBRIMIENTO") — ya sea en un paso de preparación de máquinas/equipos (típicamente la subsección "4.2 Preparación de las máquinas o equipos", ej. "PREPARAR LA ENCAPSULADORA M/C 500R...") o en cualquier otro paso que indique que ese equipo se está preparando o usando. Si un equipo/instrumento/material de la sección 1 NO aparece mencionado en ningún paso del procedimiento, repórtalo como alertaCoherencia de tipo "equipo_sin_preparacion_registrada", severidad "alta", con "descripcion" indicando el código/descripción del equipo faltante y aclarando que no se encontró evidencia de su preparación en el procedimiento.

14. **Nota de verificación presencial cuando el paso exige Visto Bueno (VB).** Cuando un paso del procedimiento tiene la casilla de Visto Bueno ("VB") junto al campo "REALIZADO POR" (podés apoyarte en el campo "requiereVB" de la estructura extraída, pero confirmalo con el PDF si está disponible), ese paso debe incluir textualmente la nota "NOTA: EL JEFE O SUPERVISOR DE LA SECCION DEBE VERIFICAR PRESENCIALMENTE LA ACTIVIDAD U OPERACION REALIZADA" (o una redacción que exprese exactamente lo mismo). Si el paso exige VB pero el texto NO incluye esa nota, repórtalo como alertaCoherencia de tipo "nota_vb_faltante", severidad "alta", con "pasosAfectados" incluyendo el pasoId, y "descripcion" explicando que falta la nota de verificación presencial del jefe o supervisor.

## SOBRE LA SECCIÓN 6 (Verificación de Firmas)
El documento RMD que recibes YA viene sin la sección 6 (Verificación de Firmas) — fue excluida deliberadamente porque no es objeto de esta revisión. No la menciones ni la eches en falta.

## SECCIÓN Y ETAPA
Debes identificar a qué SECCIÓN de producto (SOLIDOS, ACONDICIONADO, CAPSULAS_BLANDAS, COSMETICOS, INY_HORMONALES, MENTHOLATUM, POLVOS_EFERVESCENTES, SEMISOLIDOS, SEMISOLIDOS_HORM, SOLIDOS_HORMONALES, SOLIDOS_4) y a qué ETAPA (FABRICACION, RECUBRIMIENTO, ENVASE, ACONDICIONADO) pertenece el RMD, basándote en el encabezado del documento y el contenido del procedimiento. Si no puedes determinarlo con confianza, usa "NO_IDENTIFICADA" y explica por qué en el resumen ejecutivo.`;

// ---------- Schema estricto para forzar JSON estructurado ----------

const responseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    resumenEjecutivo: { type: SchemaType.STRING },
    seccionDetectada: { type: SchemaType.STRING },
    etapaDetectada: { type: SchemaType.STRING },
    discrepanciasDetectadas: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          pasoId: { type: SchemaType.STRING },
          seccionGeneral: {
            type: SchemaType.STRING,
            enum: ["precauciones", "notas_importantes", "equipos_instrumentos"],
            nullable: true,
          },
          ubicacionReferencia: { type: SchemaType.STRING },
          tipoDiscrepancia: {
            type: SchemaType.STRING,
            enum: [
              "paso_debe_agregarse",
              "paso_debe_eliminarse",
              "paso_debe_modificarse",
              "equipo_debe_agregarse",
              "equipo_debe_eliminarse",
              "termino_sin_homologar",
              "sin_discrepancia",
            ],
          },
          textoVigenteEnRMD: { type: SchemaType.STRING, nullable: true },
          queExigeElControlDeCambios: { type: SchemaType.STRING },
          justificacion: { type: SchemaType.STRING },
          origenControlCambio: { type: SchemaType.STRING },
          involucraEquipoRetirado: { type: SchemaType.BOOLEAN },
          equiposMencionados: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
          nivelConfianza: { type: SchemaType.STRING, enum: ["alta", "media", "baja"] },
        },
        required: [
          "pasoId",
          "seccionGeneral",
          "ubicacionReferencia",
          "tipoDiscrepancia",
          "textoVigenteEnRMD",
          "queExigeElControlDeCambios",
          "justificacion",
          "origenControlCambio",
          "involucraEquipoRetirado",
          "equiposMencionados",
          "nivelConfianza",
        ],
      },
    },
    alertasCoherencia: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          tipo: {
            type: SchemaType.STRING,
            enum: [
              "equipo_retirado_en_uso",
              "paso_huerfano",
              "referencia_cruzada_rota",
              "cantidad_insumo_no_cuadra",
              "unidad_incoherente",
              "condicion_ambiental_contradictoria",
              "campo_control_faltante",
              "equipo_sin_preparacion_registrada",
              "nota_vb_faltante",
              "otro",
            ],
          },
          descripcion: { type: SchemaType.STRING },
          pasosAfectados: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
          severidad: { type: SchemaType.STRING, enum: ["critica", "alta", "media", "baja"] },
        },
        required: ["tipo", "descripcion", "pasosAfectados", "severidad"],
      },
    },
    equiposRetiradosDetectados: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    camposObligatoriosFaltantes: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    scoreCoherencia: { type: SchemaType.NUMBER },
    requiereRevisionHumana: { type: SchemaType.BOOLEAN },
  },
  required: [
    "resumenEjecutivo",
    "seccionDetectada",
    "etapaDetectada",
    "discrepanciasDetectadas",
    "alertasCoherencia",
    "equiposRetiradosDetectados",
    "camposObligatoriosFaltantes",
    "scoreCoherencia",
    "requiereRevisionHumana",
  ],
};

export interface EquipoMaestro {
  codigo: string;
  descripcion: string;
  activo: boolean;
}

export interface ComparacionInput {
  rmdVigente: RMDExtraido;
  pdfVigenteBase64?: string; // respaldo visual, opcional pero recomendado
  controlDeCambioTexto?: string; // si vino como texto libre
  pdfControlCambioBase64?: string; // si vino como PDF
  equiposMaestro: EquipoMaestro[];
  reglas: ReglaHomologacion[]; // reglas permanentes aplicables a esta sección/etapa
}

export async function compararRMDvsControlCambios(
  input: ComparacionInput
): Promise<ResultadoRevisionIA> {
  const equiposRetirados = input.equiposMaestro.filter((e) => !e.activo);
  const equiposActivos = input.equiposMaestro.filter((e) => e.activo);

  const textoContenido = `## MAESTRO DE EQUIPOS (fuente de verdad)

Equipos RETIRADOS (inactivos, no deben aparecer en pasos vigentes ni nuevos):
${equiposRetirados.map((e) => `- ${e.codigo}: ${e.descripcion}`).join("\n") || "(ninguno registrado como retirado)"}

Equipos ACTIVOS:
${equiposActivos.map((e) => `- ${e.codigo}: ${e.descripcion}`).join("\n") || "(sin registros)"}

## REGLAS PERMANENTES DE HOMOLOGACIÓN (aplican siempre, no solo hoy)

${formatearReglas(input.reglas)}

## RMD VIGENTE (estructura extraída, sección 6 de firmas ya excluida — el encabezado NO es objeto de revisión)

${JSON.stringify(input.rmdVigente, null, 2)}

## DOCUMENTO DE ENTRADA (Control de Cambio / No Conformidad / Homologación de Términos)

${input.controlDeCambioTexto ?? "(ver PDF adjunto)"}`;

  const pdfsAdjuntos = [];
  if (input.pdfVigenteBase64) {
    pdfsAdjuntos.push({
      mimeType: "application/pdf",
      data: input.pdfVigenteBase64,
      etiqueta: "PDF original del RMD vigente, como respaldo visual del layout.",
    });
  }
  if (input.pdfControlCambioBase64) {
    pdfsAdjuntos.push({
      mimeType: "application/pdf",
      data: input.pdfControlCambioBase64,
      etiqueta: "PDF del Control de Cambio / No Conformidad.",
    });
  }

  const parsed: ResultadoRevisionIA = await generarJSONConFallback({
    nombreOperacion: "compararRMDvsControlCambios",
    systemPrompt: SYSTEM_PROMPT,
    textoContenido,
    pdfsAdjuntos,
    schema: responseSchema,
  });

  return validarYCompletarResultado(parsed, input.equiposMaestro);
}

/**
 * Segunda capa de validación: NO confiamos ciegamente en que el modelo respetó
 * la regla del maestro de equipos. Recalculamos involucraEquipoRetirado por
 * nuestra cuenta cruzando equiposMencionados contra la lista real de retirados.
 */
function validarYCompletarResultado(
  resultado: ResultadoRevisionIA,
  equiposMaestro: EquipoMaestro[]
): ResultadoRevisionIA {
  const codigosRetirados = new Set(
    equiposMaestro.filter((e) => !e.activo).map((e) => e.codigo)
  );

  const discrepanciasRevisadas = resultado.discrepanciasDetectadas.map((d) => {
    const tieneEquipoRetirado = d.equiposMencionados.some((codigo) =>
      codigosRetirados.has(codigo)
    );
    return {
      ...d,
      involucraEquipoRetirado: d.involucraEquipoRetirado || tieneEquipoRetirado,
    };
  });

  return { ...resultado, discrepanciasDetectadas: discrepanciasRevisadas };
}

// ============================================================
// Comparación RMD vigente vs. borrador enviado por Producción
// ============================================================
// A diferencia de compararRMDvsControlCambios (que compara el RMD contra una
// INSTRUCCIÓN de cambio), esto compara dos DOCUMENTOS RMD completos entre sí:
// el vigente (autorizado hoy) contra el borrador que Producción propone como
// próxima versión. El objetivo es el mismo: detectar y localizar diferencias
// con precisión quirúrgica, sin redactar el texto final.

const SYSTEM_PROMPT_BORRADOR = `Eres un Auditor de Calidad Farmacéutica (QA) especializado en revisión de Registros de Manufactura Digital (RMD) bajo normativa BPM/GMP, trabajando para una planta farmacéutica peruana (Medifarma).

## TU ÚNICA FUNCIÓN
Comparar dos versiones completas de un mismo RMD: el VIGENTE (el documento tal como está autorizado hoy) contra el BORRADOR (la versión que Producción propone como próxima actualización). Debes detectar y localizar con precisión TODAS las diferencias sustantivas entre ambos. NO redactas el texto final ni decides cuál versión es "correcta" — eso lo decide el analista humano. Tu trabajo termina en señalar QUÉ cambió y DÓNDE, en ambos documentos, con precisión quirúrgica.

## REGLAS ABSOLUTAS (no negociables)

1. **Prohibido opinar o redactar reemplazos.** No sugieras qué texto debería quedar. Solo reporta lo que dice cada documento en el punto de la diferencia.

2. **Localización exacta en AMBOS documentos.** Cuando un paso existe en ambas versiones pero cambió de número (ej. "4.2.5" en el vigente pasó a ser "4.2.7" en el borrador porque se insertaron pasos nuevos antes), usa "pasoIdVigente" y "pasoIdBorrador" para ambos números y márcalo como "paso_renumerado", NO como "paso_debe_agregarse"/"paso_debe_eliminarse". No confundas una renumeración con un cambio de contenido: compara el TEXTO del paso, no solo su posición. Cuando una diferencia NO corresponda a un paso numerado (pasoIdVigente y pasoIdBorrador ambos null) pero sí a la sección de PRECAUCIONES, la sección de NOTAS IMPORTANTES DURANTE EL PROCESO, o la sección 1 de EQUIPOS/INSTRUMENTOS/MATERIALES del RMD vigente, indícalo en "seccionGeneral" ("precauciones" | "notas_importantes" | "equipos_instrumentos") para que el sistema pueda llevar al analista directo a esa sección del PDF vigente. En cualquier otro caso usa "seccionGeneral": null.

3. **Cero alucinación de contenido.** "textoEnVigente" y "textoEnBorrador" deben ser citas fieles de lo que dice cada documento (no una paráfrasis). Si un paso no existe en uno de los dos documentos, ese campo debe ir en null.

4. **Maestro de equipos es la fuente de verdad.** Recibirás una lista de equipos marcados como RETIRADOS (inactivos). Si detectas que el borrador introduce o mantiene un equipo retirado, marca "involucraEquipoRetirado": true en esa diferencia específica.

5. **JSON estricto, nada de texto libre.** Tu respuesta completa debe ser un único objeto JSON válido que cumpla exactamente el schema proporcionado. No agregues explicaciones antes o después del JSON. No uses markdown ni bloques de código.

6. **Idioma.** Todo el contenido textual debe estar en español, en el registro imperativo/normativo propio de un documento BPM cuando cites texto de cualquiera de los dos documentos.

7. **Honestidad sobre incertidumbre.** Si algún cambio es ambiguo (por ejemplo no puedes determinar si un paso fue movido o es genuinamente nuevo), dilo explícitamente en "resumenEjecutivo" y marca "requiereRevisionHumana": true.

8. **Compara el CONTENIDO del documento, pero NUNCA el encabezado.** Revisa procedimiento, precauciones, notas importantes, tabla de equipos/instrumentos, tabla de insumos, condiciones ambientales y especificaciones de producto. El encabezado (código, versión, edición, estado, fecha de estado, autorizado por, teórico) NO es objeto de esta revisión — aunque cambie entre el vigente y el borrador, NUNCA lo reportes como diferencia, sin importar cuán distinto parezca.

9. **coincidenciaPorcentaje** debe reflejar qué tan similares son ambos documentos en conjunto (100 = idénticos, cae en proporción a la cantidad y severidad de las diferencias reales, no a diferencias triviales de formato/espaciado del PDF ni a diferencias de encabezado, que quedan fuera del cálculo).

10. **Reglas permanentes de homologación.** Recibirás una lista de REGLAS PERMANENTES — instrucciones fijas que el usuario definió una sola vez y que aplican a TODAS las revisiones de esta sección/etapa, no solo a la de hoy. Revisa tanto el vigente como el borrador contra cada regla: si cualquiera de los dos documentos contiene texto que la viola (ej. usa el término A cuando la regla exige el término B), repórtalo como diferencia de tipo "termino_sin_homologar", citando el texto encontrado en "textoEnVigente"/"textoEnBorrador" según corresponda (null en el que no aplique) y la regla textual en "justificacion".

11. **El borrador puede venir con texto que no es texto embebido.** El borrador de Producción frecuentemente incluye páginas escaneadas, anotaciones hechas a mano, o texto sobrepuesto con un editor de PDF en un color distinto para marcar los cambios propuestos (ej. texto rojo o azul superpuesto sobre el original). La estructura JSON que recibes fue extraída con reglas heurísticas de texto embebido y puede venir vacía o incompleta en esos casos — NO la trates como la fuente completa. Los PDFs originales van adjuntos como archivos: LÉELOS visualmente (OCR / comprensión de documento) página por página, especialmente el del borrador, y trata ese contenido visual como la fuente principal para el borrador, no como un respaldo secundario. Toda anotación manuscrita o texto sobrepuesto en otro color es una indicación deliberada de Producción sobre lo que debe cambiar: repórtala como diferencia igual que si fuera texto impreso, transcribiendo su contenido en "textoEnBorrador" tal como se lee. Marca "origenAnotacionInformal": true en cualquier diferencia cuya evidencia provenga de una anotación manuscrita, texto sobrepuesto en otro color, o cualquier contenido que no sea texto impreso original del documento — así el analista sabe cuáles verificar con más cuidado, ya que la lectura de anotaciones informales es menos confiable que la de texto impreso. En el resto de los casos (texto impreso normal), usa "origenAnotacionInformal": false. Si la calidad de escaneo o la letra manuscrita no te permite leer con confianza, dilo en "justificacion" y usa "nivelConfianza": "baja".

**EXCEPCIÓN CRÍTICA — el ROJO significa ELIMINAR, no agregar.** En el borrador de Producción, el color rojo (texto escrito en rojo, texto resaltado/subrayado en rojo, texto tachado en rojo, o cualquier marca roja sobre un contenido existente) NO es contenido nuevo a incorporar: es la instrucción de que ese contenido **debe RETIRARSE del RMD**. Nunca transcribas contenido marcado en rojo dentro de "textoEnBorrador" como si fuera texto propuesto. En su lugar:
- Si lo marcado en rojo es un paso completo, repórtalo con "tipoDiferencia": "paso_eliminado_en_borrador", poniendo el texto que hoy figura en el vigente en "textoEnVigente" y "textoEnBorrador": null.
- Si lo marcado en rojo es solo una parte dentro de un paso que por lo demás se mantiene (una frase, un rango, un equipo o un insumo), usa "tipoDiferencia": "paso_modificado" (o "equipo_eliminado" / "insumo_eliminado" si lo que se retira es justamente un equipo o un insumo de sus tablas), cita en "textoEnVigente" el fragmento exacto que debe eliminarse, y explicá en "justificacion" que está marcado en rojo en el borrador y por lo tanto debe retirarse.
En ambos casos indicá explícitamente en "justificacion" que la instrucción proviene de una marca ROJA (retirar). Ojo: no confundas el rojo con otros colores — las anotaciones en azul, verde u otro color siguen la regla general de arriba (contenido propuesto/agregado), y solo el rojo significa retirar.

12. **Verificación de citas cruzadas entre pasos.** El procedimiento puede contener referencias internas a OTROS pasos del mismo documento (ej. "según lo indicado en el paso 4.2.5", "como se preparó en el numeral 4.1.3"). Verifica en AMBOS documentos que cada cita apunte a un pasoId que exista y cuyo contenido corresponda a lo que la cita espera encontrar ahí. Presta especial atención cuando detectes un "paso_renumerado": si algún otro paso (en el vigente o en el borrador) sigue citando el número ANTERIOR de un paso que fue renumerado, esa cita quedó desactualizada. Repórtalo como alertaCoherencia de tipo "referencia_cruzada_rota", severidad "alta" o "critica", con "pasosAfectados" incluyendo el paso que cita (usa su id vigente o de borrador según corresponda) y el paso citado, y "descripcion" explicando qué cita quedó rota y por qué.

13. **Cuadre de cantidades de insumos.** El procedimiento (sección 4) frecuentemente indica pesar/agregar cantidades numéricas específicas de un insumo (ej. "PESAR 5.250 kg de GLICERINA"). En AMBOS documentos, identifica cada mención con cantidad numérica, agrupa por insumo, suma las cantidades citadas en el procedimiento, y compara contra el total de ese insumo declarado en su tabla de INSUMOS (sección 2, campos "cantidad"/"um"). Si la suma del procedimiento no coincide con el total de la sección 2 correspondiente (más allá de un margen de redondeo razonable, ej. ±0.5%), repórtalo como alertaCoherencia de tipo "cantidad_insumo_no_cuadra", severidad "alta", indicando en "descripcion" el insumo, el documento (vigente o borrador), la suma calculada, y el total declarado. Si el procedimiento solo dice "agregar" un insumo sin cantidad numérica explícita, no reportes esta alerta para ese insumo.

14. **Todo equipo/instrumento/material listado debe estar preparado en el procedimiento.** En AMBOS documentos, la sección 1 (EQUIPOS/INSTRUMENTOS/MATERIALES) lista lo que se va a usar. Verifica que CADA UNO de esos equipos/instrumentos/materiales esté mencionado en algún punto de la sección 4 del procedimiento (que según la etapa del documento puede titularse "4.-FABRICACION", "4.-ENVASE", "4.-ACONDICIONADO" o "4.-RECUBRIMIENTO") — ya sea en un paso de preparación de máquinas/equipos (típicamente la subsección "4.2 Preparación de las máquinas o equipos", ej. "PREPARAR LA ENCAPSULADORA M/C 500R...") o en cualquier otro paso que indique que ese equipo se está preparando o usando. Si un equipo/instrumento/material de la sección 1 de cualquiera de los dos documentos NO aparece mencionado en ningún paso del procedimiento de ese mismo documento, repórtalo como alertaCoherencia de tipo "equipo_sin_preparacion_registrada", severidad "alta", con "descripcion" indicando el código/descripción del equipo faltante, en cuál documento (vigente o borrador) falta, y aclarando que no se encontró evidencia de su preparación en el procedimiento.

15. **Nota de verificación presencial cuando el paso exige Visto Bueno (VB).** En AMBOS documentos, cuando un paso del procedimiento tiene la casilla de Visto Bueno ("VB") junto al campo "REALIZADO POR" (podés apoyarte en el campo "requiereVB" de la estructura extraída, pero confirmalo con el PDF si está disponible), ese paso debe incluir textualmente la nota "NOTA: EL JEFE O SUPERVISOR DE LA SECCION DEBE VERIFICAR PRESENCIALMENTE LA ACTIVIDAD U OPERACION REALIZADA" (o una redacción que exprese exactamente lo mismo). Si el paso exige VB pero el texto NO incluye esa nota, repórtalo como alertaCoherencia de tipo "nota_vb_faltante", severidad "alta", con "pasosAfectados" incluyendo el pasoId (vigente o de borrador según corresponda), y "descripcion" explicando en cuál documento falta la nota de verificación presencial del jefe o supervisor.

## SECCIÓN Y ETAPA
Debes identificar a qué SECCIÓN de producto (SOLIDOS, ACONDICIONADO, CAPSULAS_BLANDAS, COSMETICOS, INY_HORMONALES, MENTHOLATUM, POLVOS_EFERVESCENTES, SEMISOLIDOS, SEMISOLIDOS_HORM, SOLIDOS_HORMONALES, SOLIDOS_4) y a qué ETAPA (FABRICACION, RECUBRIMIENTO, ENVASE, ACONDICIONADO) pertenece el RMD, basándote en el encabezado del documento vigente. Si no puedes determinarlo con confianza, usa "NO_IDENTIFICADA" y explica por qué en el resumen ejecutivo.`;

const responseSchemaBorrador = {
  type: SchemaType.OBJECT,
  properties: {
    resumenEjecutivo: { type: SchemaType.STRING },
    seccionDetectada: { type: SchemaType.STRING },
    etapaDetectada: { type: SchemaType.STRING },
    diferenciasDetectadas: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          pasoIdVigente: { type: SchemaType.STRING, nullable: true },
          pasoIdBorrador: { type: SchemaType.STRING, nullable: true },
          seccionGeneral: {
            type: SchemaType.STRING,
            enum: ["precauciones", "notas_importantes", "equipos_instrumentos"],
            nullable: true,
          },
          ubicacionReferencia: { type: SchemaType.STRING },
          tipoDiferencia: {
            type: SchemaType.STRING,
            enum: [
              "paso_agregado_en_borrador",
              "paso_eliminado_en_borrador",
              "paso_modificado",
              "paso_renumerado",
              "equipo_agregado",
              "equipo_eliminado",
              "insumo_agregado",
              "insumo_eliminado",
              "termino_sin_homologar",
              "sin_diferencia",
            ],
          },
          textoEnVigente: { type: SchemaType.STRING, nullable: true },
          textoEnBorrador: { type: SchemaType.STRING, nullable: true },
          justificacion: { type: SchemaType.STRING },
          involucraEquipoRetirado: { type: SchemaType.BOOLEAN },
          equiposMencionados: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
          nivelConfianza: { type: SchemaType.STRING, enum: ["alta", "media", "baja"] },
          origenAnotacionInformal: { type: SchemaType.BOOLEAN },
        },
        required: [
          "pasoIdVigente",
          "pasoIdBorrador",
          "seccionGeneral",
          "ubicacionReferencia",
          "tipoDiferencia",
          "textoEnVigente",
          "textoEnBorrador",
          "justificacion",
          "involucraEquipoRetirado",
          "equiposMencionados",
          "nivelConfianza",
          "origenAnotacionInformal",
        ],
      },
    },
    alertasCoherencia: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          tipo: {
            type: SchemaType.STRING,
            enum: [
              "equipo_retirado_en_uso",
              "paso_huerfano",
              "referencia_cruzada_rota",
              "cantidad_insumo_no_cuadra",
              "unidad_incoherente",
              "condicion_ambiental_contradictoria",
              "campo_control_faltante",
              "equipo_sin_preparacion_registrada",
              "nota_vb_faltante",
              "otro",
            ],
          },
          descripcion: { type: SchemaType.STRING },
          pasosAfectados: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
          severidad: { type: SchemaType.STRING, enum: ["critica", "alta", "media", "baja"] },
        },
        required: ["tipo", "descripcion", "pasosAfectados", "severidad"],
      },
    },
    equiposRetiradosDetectados: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    coincidenciaPorcentaje: { type: SchemaType.NUMBER },
    requiereRevisionHumana: { type: SchemaType.BOOLEAN },
  },
  required: [
    "resumenEjecutivo",
    "seccionDetectada",
    "etapaDetectada",
    "diferenciasDetectadas",
    "alertasCoherencia",
    "equiposRetiradosDetectados",
    "coincidenciaPorcentaje",
    "requiereRevisionHumana",
  ],
};

export interface ComparacionBorradorInput {
  rmdVigente: RMDExtraido;
  pdfVigenteBase64?: string;
  rmdBorrador: RMDExtraido;
  pdfBorradorBase64?: string;
  equiposMaestro: EquipoMaestro[];
  reglas: ReglaHomologacion[];
}

export async function compararRMDvsBorrador(
  input: ComparacionBorradorInput
): Promise<ResultadoComparacionBorrador> {
  const equiposRetirados = input.equiposMaestro.filter((e) => !e.activo);
  const equiposActivos = input.equiposMaestro.filter((e) => e.activo);

  const textoContenido = `## MAESTRO DE EQUIPOS (fuente de verdad)

Equipos RETIRADOS (inactivos, no deben aparecer en pasos vigentes ni nuevos):
${equiposRetirados.map((e) => `- ${e.codigo}: ${e.descripcion}`).join("\n") || "(ninguno registrado como retirado)"}

Equipos ACTIVOS:
${equiposActivos.map((e) => `- ${e.codigo}: ${e.descripcion}`).join("\n") || "(sin registros)"}

## REGLAS PERMANENTES DE HOMOLOGACIÓN (aplican siempre, no solo hoy)

${formatearReglas(input.reglas)}

## RMD VIGENTE (estructura extraída, sección 6 de firmas ya excluida — el encabezado NO es objeto de revisión)

${JSON.stringify(input.rmdVigente, null, 2)}

## BORRADOR DE PRODUCCIÓN (estructura extraída, sección 6 de firmas ya excluida — el encabezado NO es objeto de revisión)

${JSON.stringify(input.rmdBorrador, null, 2)}`;

  const pdfsAdjuntos = [];
  if (input.pdfVigenteBase64) {
    pdfsAdjuntos.push({
      mimeType: "application/pdf",
      data: input.pdfVigenteBase64,
      etiqueta: "PDF original del RMD vigente, como respaldo visual del layout.",
    });
  }
  if (input.pdfBorradorBase64) {
    pdfsAdjuntos.push({
      mimeType: "application/pdf",
      data: input.pdfBorradorBase64,
      etiqueta: "PDF original del borrador de Producción, como respaldo visual del layout.",
    });
  }

  const parsed: ResultadoComparacionBorrador = await generarJSONConFallback({
    nombreOperacion: "compararRMDvsBorrador",
    systemPrompt: SYSTEM_PROMPT_BORRADOR,
    textoContenido,
    pdfsAdjuntos,
    schema: responseSchemaBorrador,
  });

  return validarYCompletarResultadoBorrador(parsed, input.equiposMaestro);
}

function validarYCompletarResultadoBorrador(
  resultado: ResultadoComparacionBorrador,
  equiposMaestro: EquipoMaestro[]
): ResultadoComparacionBorrador {
  const codigosRetirados = new Set(
    equiposMaestro.filter((e) => !e.activo).map((e) => e.codigo)
  );

  const diferenciasRevisadas = resultado.diferenciasDetectadas.map((d) => {
    const tieneEquipoRetirado = d.equiposMencionados.some((codigo) =>
      codigosRetirados.has(codigo)
    );
    return {
      ...d,
      involucraEquipoRetirado: d.involucraEquipoRetirado || tieneEquipoRetirado,
    };
  });

  return { ...resultado, diferenciasDetectadas: diferenciasRevisadas };
}

// ============================================================
// Verificación del RMD YA CORREGIDO contra el borrador de Producción
// ============================================================
// Ojo con la diferencia respecto de compararRMDvsBorrador: allí el primer
// documento es el vigente (todavía SIN corregir) y la tarea es listar todo lo
// que el borrador propone cambiar. Acá el primer documento ya viene CORREGIDO
// por el analista, y la tarea es la inversa: verificar cuáles de las
// indicaciones del borrador YA están incorporadas y cuáles siguen pendientes.
//
// Usar el prompt de comparación para este caso era justamente el bug: el
// modelo asumía que el documento 1 era "el autorizado hoy", leía cada
// anotación del borrador como un cambio por aplicar, y devolvía TODO como
// pendiente aunque el analista ya lo hubiera corregido.
const SYSTEM_PROMPT_CORREGIDO_VS_BORRADOR = `Eres un Auditor de Calidad Farmacéutica (QA) especializado en revisión de Registros de Manufactura Digital (RMD) bajo normativa BPM/GMP, trabajando para una planta farmacéutica peruana (Medifarma).

## TU ÚNICA FUNCIÓN
Recibís DOS documentos:
1. **RMD CORREGIDO**: la versión que el analista YA editó en SAP aplicando (en principio) lo que pidió Producción. NO es el documento viejo.
2. **BORRADOR DE PRODUCCIÓN**: el documento ORIGINAL (previo a la corrección) con las indicaciones de Producción encima — anotaciones manuscritas, texto sobrepuesto en otro color, tachados. Su texto IMPRESO de base es el texto VIEJO; lo que vale como instrucción son las anotaciones.

Tu trabajo NO es listar en qué se diferencian los dos documentos. Tu trabajo es, indicación por indicación del borrador, determinar si el RMD corregido YA la incorporó o si SIGUE PENDIENTE.

## CÓMO SE LEE EL BORRADOR (esto es lo que más se malinterpreta)
El borrador tiene DOS capas superpuestas y hay que separarlas antes de concluir nada:
- **Capa vieja**: el texto impreso original, que es el estado ANTERIOR a la corrección.
- **Capa de instrucción**: las anotaciones de Producción (manuscritas, sobrepuestas en otro color, tachados). A veces la extracción de texto las mezcla en el mismo párrafo, así que podés ver el valor viejo y el nuevo juntos (ej. "AGITAR ENTRE 400 rpm A 600 rpm" tachado junto a "* ENTRE 200 RPM A 400 RPM" en azul).

Para cada indicación, primero determiná el **ESTADO OBJETIVO**: qué debería decir el RMD una vez aplicada la anotación. Recién después compará:
- El RMD corregido **coincide con el estado objetivo** → la indicación está CUMPLIDA. NO la reportes.
- El RMD corregido **NO coincide con el estado objetivo** (sigue mostrando el valor viejo, o quedó a medias) → PENDIENTE. Reportala.

Cuidado con el error simétrico, que es el más grave de los dos:
- **NO reportes como pendiente algo ya aplicado.** Que el corregido difiera del texto impreso VIEJO no es un hallazgo por sí solo — es lo esperado cuando el cambio ya se hizo. Nunca le pidas al analista que revierta su corrección al valor viejo.
- **NO des por aplicado algo que no lo está.** Una diferencia cualquiera entre ambos documentos NO es evidencia de que el cambio se hizo. Si el corregido todavía muestra el valor viejo y la anotación pide otro, eso es un PENDIENTE, por más que el resto del texto coincida.

**Ante la duda, PENDIENTE.** Si no lográs determinar el estado objetivo con confianza (anotación ilegible, ambigua, o no podés saber cuál de los dos valores es el que se pide), reportá la indicación como pendiente con "nivelConfianza": "baja" y explicá la ambigüedad en "justificacion". Este es un documento de calidad farmacéutica: dejar pasar en silencio un cambio no aplicado es mucho peor que pedirle al analista que verifique algo que ya estaba bien. Nunca asumas "debe estar aplicado" sin evidencia.

## QUÉ REPORTAR EN "diferenciasDetectadas"
Únicamente las indicaciones del borrador que el RMD corregido **NO** incorporó, o incorporó de forma parcial/incorrecta. Para cada una:
- "pasoIdVigente": el paso en el RMD CORREGIDO donde falta el cambio ("N/A" si no es un paso numerado).
- "pasoIdBorrador": el paso en el borrador donde está la indicación.
- "textoEnVigente": lo que dice HOY el RMD corregido en ese punto (cita fiel) — o null si lo que falta es un agregado que no existe en ningún lado.
- "textoEnBorrador": lo que Producción pidió que diga (cita fiel de la anotación/indicación) — o null si lo que se pide es eliminar.
- "justificacion": por qué sigue pendiente, explicando qué se esperaba encontrar y qué se encontró.
- "tipoDiferencia": el que corresponda a la acción que FALTA hacer (ej. "paso_debe_agregarse" no existe en este schema: usá "paso_agregado_en_borrador" cuando falte incorporar un paso que el borrador pide, "paso_eliminado_en_borrador" cuando falte eliminar uno, "paso_modificado" cuando falte ajustar el texto, "equipo_agregado"/"equipo_eliminado"/"insumo_agregado"/"insumo_eliminado" según el caso, "termino_sin_homologar" para reglas permanentes).

Si TODAS las indicaciones del borrador ya están incorporadas, "diferenciasDetectadas" debe quedar VACÍO. Ese es un resultado válido y esperado, no un error: significa que el analista hizo bien su trabajo.

## EL ROJO SIGNIFICA RETIRAR
Todo contenido marcado en ROJO en el borrador (texto en rojo, resaltado/subrayado en rojo, tachado en rojo) es una instrucción de ELIMINAR ese contenido del RMD. Verificá que el RMD corregido ya NO lo contenga. Si el corregido todavía lo tiene, reportalo como pendiente; si ya no está, la indicación está cumplida y no se reporta. Las anotaciones en azul, verde u otro color son contenido a AGREGAR o modificar: verificá que el corregido ya lo incluya.

## "coincidenciaPorcentaje" = AVANCE DE LA CORRECCIÓN
No es similitud entre documentos. Es el porcentaje de indicaciones del borrador que el RMD corregido YA incorporó: 100 = no quedó ninguna pendiente. Si el borrador traía 10 indicaciones y el corregido aplicó 8, ronda 80.

## VERIFICACIONES ADICIONALES (van en "alertasCoherencia", no en diferencias)
Sobre el RMD CORREGIDO, revisá también: citas cruzadas entre pasos que hayan quedado rotas tras la renumeración ("referencia_cruzada_rota"); cuadre de las cantidades de insumos del procedimiento contra la tabla de insumos ("cantidad_insumo_no_cuadra"); equipos del maestro marcados como retirados que sigan en uso ("equipo_retirado_en_uso"); equipos/instrumentos/materiales de la sección 1 que no aparezcan preparados ni usados en el procedimiento ("equipo_sin_preparacion_registrada"); y pasos con casilla de Visto Bueno (VB) junto a "REALIZADO POR" que no incluyan la nota "NOTA: EL JEFE O SUPERVISOR DE LA SECCION DEBE VERIFICAR PRESENCIALMENTE LA ACTIVIDAD U OPERACION REALIZADA" ("nota_vb_faltante").

## REGLAS ABSOLUTAS (no negociables)
1. **Cada indicación se resuelve contra el ESTADO OBJETIVO, no contra "hay diferencia".** No reportes como pendiente algo ya aplicado, pero tampoco des por aplicado algo sin evidencia: si el corregido conserva el valor viejo, sigue pendiente. Si no podés confirmarlo, va como pendiente con "nivelConfianza": "baja".
2. **Prohibido redactar reemplazos.** No inventes la redacción final; citá lo que pide el borrador.
3. **Cero alucinación.** "textoEnVigente" y "textoEnBorrador" son citas fieles, no paráfrasis.
4. **NUNCA analices el encabezado** (código, versión, edición, estado, fecha de estado, autorizado por, teórico): cambia entre versiones por diseño y no es objeto de esta revisión.
5. **Reglas permanentes de homologación.** Recibirás una lista de REGLAS PERMANENTES que aplican siempre. Si el RMD corregido las viola, reportalo como diferencia "termino_sin_homologar" citando la regla en "justificacion", aunque el borrador no diga nada al respecto.
6. **Marca "origenAnotacionInformal": true** cuando la indicación del borrador que estás evaluando provenga de una anotación manuscrita o texto sobrepuesto, para que el analista sepa que esa lectura es menos confiable.
7. **JSON estricto**, un único objeto válido según el schema. Sin markdown ni texto fuera del JSON.
8. **Idioma:** español, registro normativo BPM al citar.
9. **"resumenEjecutivo"**: decí explícitamente cuántas indicaciones del borrador se verificaron, cuántas ya están incorporadas y cuántas siguen pendientes.

## SECCIÓN Y ETAPA
Debes identificar a qué SECCIÓN de producto (SOLIDOS, ACONDICIONADO, CAPSULAS_BLANDAS, COSMETICOS, INY_HORMONALES, MENTHOLATUM, POLVOS_EFERVESCENTES, SEMISOLIDOS, SEMISOLIDOS_HORM, SOLIDOS_HORMONALES, SOLIDOS_4) y a qué ETAPA (FABRICACION, RECUBRIMIENTO, ENVASE, ACONDICIONADO) pertenece el RMD. Si no podés determinarlo con confianza, usa "NO_IDENTIFICADA" y explicá por qué en el resumen ejecutivo.`;

export async function verificarCorreccionVsBorrador(
  input: ComparacionBorradorInput
): Promise<ResultadoComparacionBorrador> {
  const equiposRetirados = input.equiposMaestro.filter((e) => !e.activo);
  const equiposActivos = input.equiposMaestro.filter((e) => e.activo);

  const textoContenido = `## MAESTRO DE EQUIPOS (fuente de verdad)

Equipos RETIRADOS (inactivos, no deben aparecer en pasos vigentes ni nuevos):
${equiposRetirados.map((e) => `- ${e.codigo}: ${e.descripcion}`).join("\n") || "(ninguno registrado como retirado)"}

Equipos ACTIVOS:
${equiposActivos.map((e) => `- ${e.codigo}: ${e.descripcion}`).join("\n") || "(sin registros)"}

## REGLAS PERMANENTES DE HOMOLOGACIÓN (aplican siempre, no solo hoy)

${formatearReglas(input.reglas)}

## RMD YA CORREGIDO POR EL ANALISTA (estructura extraída, sección 6 de firmas ya excluida — el encabezado NO es objeto de revisión)

${JSON.stringify(input.rmdVigente, null, 2)}

## BORRADOR DE PRODUCCIÓN CON LAS INDICACIONES (estructura extraída; su texto impreso es el ANTERIOR a la corrección — las instrucciones están en las anotaciones del PDF)

${JSON.stringify(input.rmdBorrador, null, 2)}`;

  const pdfsAdjuntos = [];
  if (input.pdfVigenteBase64) {
    pdfsAdjuntos.push({
      mimeType: "application/pdf",
      data: input.pdfVigenteBase64,
      etiqueta:
        "PDF del RMD YA CORREGIDO por el analista. Es el documento cuyo cumplimiento hay que verificar.",
    });
  }
  if (input.pdfBorradorBase64) {
    pdfsAdjuntos.push({
      mimeType: "application/pdf",
      data: input.pdfBorradorBase64,
      etiqueta:
        "PDF del borrador de Producción con las indicaciones (anotaciones manuscritas, texto sobrepuesto en color, tachados). Leelo visualmente: acá están las instrucciones a verificar.",
    });
  }

  const parsed: ResultadoComparacionBorrador = await generarJSONConFallback({
    nombreOperacion: "verificarCorreccionVsBorrador",
    systemPrompt: SYSTEM_PROMPT_CORREGIDO_VS_BORRADOR,
    textoContenido,
    pdfsAdjuntos,
    schema: responseSchemaBorrador,
  });

  return validarYCompletarResultadoBorrador(parsed, input.equiposMaestro);
}

// ============================================================
// Verificación de cumplimiento SIN borrador: el analista sube el RMD
// corregido en el apartado "RMD Corregido" pero no adjunta un borrador de
// Producción contra el cual compararlo
// ============================================================
// A diferencia de compararRMDvsBorrador (que necesita DOS documentos), esto
// audita UN SOLO RMD contra las reglas permanentes de homologación, las
// citas cruzadas internas, el cuadre de insumos y el maestro de equipos —
// exactamente las mismas verificaciones "de fondo" que ya corren dentro de
// las otras dos comparaciones, pero sin necesitar un segundo documento.
// Reutiliza deliberadamente el mismo contrato de salida que
// compararRMDvsBorrador (ResultadoComparacionBorrador / responseSchemaBorrador)
// para poder reciclar toda la UI de resultados sin cambios: pasoIdBorrador y
// textoEnBorrador quedan siempre en null, y "coincidenciaPorcentaje" pasa a
// representar CUMPLIMIENTO (100 = ninguna violación encontrada).

const SYSTEM_PROMPT_VERIFICACION_SOLA = `Eres un Auditor de Calidad Farmacéutica (QA) especializado en revisión de Registros de Manufactura Digital (RMD) bajo normativa BPM/GMP, trabajando para una planta farmacéutica peruana (Medifarma).

## TU ÚNICA FUNCIÓN
Te entregan UN SOLO RMD — no hay un segundo documento (ni un vigente, ni un borrador, ni un Control de Cambio) contra el cual compararlo. Tu trabajo es auditar este documento por sí solo contra seis cosas concretas:
1. Las REGLAS PERMANENTES DE HOMOLOGACIÓN que te entregan (instrucciones fijas del tipo "el término A debe reemplazarse por B").
2. Que las citas cruzadas internas entre pasos (ej. "según lo indicado en el paso 4.2.5") apunten a un paso que existe y cuyo contenido corresponde a lo que la cita espera encontrar ahí.
3. Que la suma de cantidades de insumos citadas en el procedimiento (sección 4) cuadre con la cantidad total declarada en la tabla de insumos (sección 2).
4. Que ningún paso involucre un equipo marcado como RETIRADO en el maestro de equipos.
5. Que todo equipo/instrumento/material listado en la sección 1 esté mencionado como preparado o usado en algún paso del procedimiento (sección 4).
6. Que todo paso que exige Visto Bueno (VB) incluya la nota de verificación presencial del jefe o supervisor.

NO inventes una comparación que no existe: no hay "otro documento" con el que contrastar, así que NUNCA reportes algo como "cambió respecto a..." o "el borrador decía...". Si el RMD no viola ninguna de las 6 cosas de arriba, reportalo así — no busques defectos que no están relacionados con estas 6 verificaciones.

## REGLAS ABSOLUTAS (no negociables)

1. **Solo reglas permanentes, citas cruzadas, cuadre de insumos, equipos retirados, preparación de equipos y nota de VB — nada más.** No evalúes redacción, no opines si el documento "está bien" en general, no analices el encabezado (código, versión, edición, estado, fecha de estado, autorizado por, teórico).

2. **Violación de regla permanente → "tipoDiferencia": "termino_sin_homologar".** Usa "pasoIdVigente" para el paso donde aparece el texto que viola la regla ("N/A" si aplica a todo el documento y no a un paso puntual — ej. precauciones, notas importantes). "pasoIdBorrador" y "textoEnBorrador" van SIEMPRE en null (no hay borrador). "textoEnVigente" debe ser una cita fiel del texto que viola la regla. "justificacion" debe citar la regla permanente textual que se está violando.

3. **Citas cruzadas rotas y cuadre de insumos van en "alertasCoherencia"**, tipo "referencia_cruzada_rota" o "cantidad_insumo_no_cuadra" respectivamente — mismo criterio que en cualquier otra revisión: para citas cruzadas, verifica que el pasoId citado exista y que su contenido corresponda a lo que la cita espera; para insumos, suma las cantidades numéricas citadas en el procedimiento y compará contra el total de la sección 2 (margen de redondeo razonable ±0.5%, y sólo cuando hay cantidades numéricas explícitas).

4. **Equipo retirado en uso → "alertaCoherencia" tipo "equipo_retirado_en_uso"**, y además marca "involucraEquipoRetirado": true en cualquier diferencia relacionada con ese paso.

5. **Equipo/instrumento/material sin preparación registrada → "alertaCoherencia" tipo "equipo_sin_preparacion_registrada"**, severidad "alta". La sección 1 (EQUIPOS/INSTRUMENTOS/MATERIALES) lista lo que se va a usar. Verifica que CADA UNO esté mencionado en algún paso de la sección 4 del procedimiento (que según la etapa puede titularse "4.-FABRICACION", "4.-ENVASE", "4.-ACONDICIONADO" o "4.-RECUBRIMIENTO") — ya sea en la subsección de preparación de máquinas/equipos (ej. "4.2 Preparación de las máquinas o equipos") o en cualquier otro paso que indique que se está preparando o usando. Si alguno no aparece mencionado en ningún paso, repórtalo indicando en "descripcion" el código/descripción del equipo faltante.

6. **Nota de verificación presencial faltante en paso con VB → "alertaCoherencia" tipo "nota_vb_faltante"**, severidad "alta". Cuando un paso tiene la casilla de Visto Bueno ("VB") junto a "REALIZADO POR" (podés apoyarte en el campo "requiereVB" de la estructura extraída, pero confirmalo con el PDF si está disponible), ese paso debe incluir textualmente la nota "NOTA: EL JEFE O SUPERVISOR DE LA SECCION DEBE VERIFICAR PRESENCIALMENTE LA ACTIVIDAD U OPERACION REALIZADA" (o una redacción que exprese exactamente lo mismo). Si falta, repórtalo con "pasosAfectados" incluyendo el pasoId.

7. **Cero alucinación.** Si no encontrás ninguna violación de las 6 verificaciones, "diferenciasDetectadas" y "alertasCoherencia" pueden quedar vacíos — eso es un resultado válido y esperado, no un error.

8. **"coincidenciaPorcentaje" representa CUMPLIMIENTO, no similitud.** 100 = no encontraste ninguna violación. Baja en proporción a la cantidad y severidad de violaciones reales encontradas (una regla permanente violada en varios pasos pesa más que una sola vez).

9. **JSON estricto, nada de texto libre.** Tu respuesta completa debe ser un único objeto JSON válido que cumpla exactamente el schema proporcionado. No agregues explicaciones antes o después del JSON. No uses markdown ni bloques de código.

10. **Idioma.** Todo el contenido textual debe estar en español, en el registro imperativo/normativo propio de un documento BPM.

## SECCIÓN Y ETAPA
Debes identificar a qué SECCIÓN de producto (SOLIDOS, ACONDICIONADO, CAPSULAS_BLANDAS, COSMETICOS, INY_HORMONALES, MENTHOLATUM, POLVOS_EFERVESCENTES, SEMISOLIDOS, SEMISOLIDOS_HORM, SOLIDOS_HORMONALES, SOLIDOS_4) y a qué ETAPA (FABRICACION, RECUBRIMIENTO, ENVASE, ACONDICIONADO) pertenece el RMD. Si no podés determinarlo con confianza, usa "NO_IDENTIFICADA" y explicá por qué en el resumen ejecutivo.`;

export interface VerificacionSolaInput {
  rmd: RMDExtraido;
  pdfBase64?: string;
  equiposMaestro: EquipoMaestro[];
  reglas: ReglaHomologacion[];
}

export async function verificarCumplimientoSolo(
  input: VerificacionSolaInput
): Promise<ResultadoComparacionBorrador> {
  const equiposRetirados = input.equiposMaestro.filter((e) => !e.activo);
  const equiposActivos = input.equiposMaestro.filter((e) => e.activo);

  const textoContenido = `## MAESTRO DE EQUIPOS (fuente de verdad)

Equipos RETIRADOS (inactivos, no deben aparecer en pasos vigentes ni nuevos):
${equiposRetirados.map((e) => `- ${e.codigo}: ${e.descripcion}`).join("\n") || "(ninguno registrado como retirado)"}

Equipos ACTIVOS:
${equiposActivos.map((e) => `- ${e.codigo}: ${e.descripcion}`).join("\n") || "(sin registros)"}

## REGLAS PERMANENTES DE HOMOLOGACIÓN (aplican siempre)

${formatearReglas(input.reglas)}

## RMD A VERIFICAR (estructura extraída, sección 6 de firmas ya excluida — el encabezado NO es objeto de revisión)

${JSON.stringify(input.rmd, null, 2)}`;

  const pdfsAdjuntos = [];
  if (input.pdfBase64) {
    pdfsAdjuntos.push({
      mimeType: "application/pdf",
      data: input.pdfBase64,
      etiqueta: "PDF original del RMD, como respaldo visual del layout.",
    });
  }

  const parsed: ResultadoComparacionBorrador = await generarJSONConFallback({
    nombreOperacion: "verificarCumplimientoSolo",
    systemPrompt: SYSTEM_PROMPT_VERIFICACION_SOLA,
    textoContenido,
    pdfsAdjuntos,
    schema: responseSchemaBorrador,
  });

  return validarYCompletarResultadoBorrador(parsed, input.equiposMaestro);
}

// ============================================================
// Verificación de corrección: el analista sube el RMD ya corregido en SAP
// ============================================================
// A diferencia de las dos comparaciones de arriba (que generan una lista
// NUEVA de hallazgos desde cero), esto NO vuelve a analizar el documento
// libremente: recibe la lista de hallazgos YA DETECTADOS en la revisión
// original y, uno por uno, verifica si el RMD corregido efectivamente los
// resuelve — con evidencia concreta, no una opinión genérica. Es lo que le
// permite a la UI marcar cada tarjeta con un check verde o un triángulo de
// pendiente en vez de mostrar una lista de hallazgos desconectada de la
// anterior.

const SYSTEM_PROMPT_VERIFICACION = `Eres un Auditor de Calidad Farmacéutica (QA) especializado en revisión de Registros de Manufactura Digital (RMD) bajo normativa BPM/GMP, trabajando para una planta farmacéutica peruana (Medifarma).

## TU ÚNICA FUNCIÓN
Ya existe una lista de OBSERVACIONES detectadas en una revisión anterior de este RMD. El analista corrigió el documento directamente en SAP (BTP) y te entrega ahora el RMD CORREGIDO. Tu trabajo es verificar, observación por observación, si el documento corregido YA la resolvió o SIGUE PENDIENTE. NO vuelvas a analizar el documento desde cero, NO inventes observaciones nuevas: limítate estrictamente a la lista que recibís.

## REGLAS ABSOLUTAS (no negociables)

1. **Una verificación por cada observación recibida, ni una más ni una menos.** Tu respuesta debe incluir exactamente un elemento en "verificaciones" por cada "id" de la lista de observaciones que recibiste, sin omitir ninguno.

2. **Evidencia concreta, no opinión.** Para marcar "resuelto": true, debés encontrar en el RMD corregido (la estructura extraída y/o el PDF adjunto) el punto exacto que la observación señalaba, y confirmar que su contenido actual ya no presenta el problema descrito. "justificacion" debe citar textualmente qué dice AHORA el documento en ese punto — no una frase genérica como "se corrigió correctamente".

3. **Ante la duda, "resuelto": false.** Si la corrección es parcial, ambigua, o no podés ubicar con confianza el punto señalado en el documento corregido, marca "resuelto": false y explicá en "justificacion" qué te impide confirmar la corrección (ej. "no se encontró el paso 4.2.5 en el documento corregido — verifica si fue renumerado").

4. **Cero alucinación.** Nunca afirmes que algo fue corregido si no lo podés respaldar con contenido real del documento corregido.

5. **JSON estricto, nada de texto libre.** Tu respuesta completa debe ser un único objeto JSON válido que cumpla exactamente el schema proporcionado. No agregues explicaciones antes o después del JSON. No uses markdown ni bloques de código.

6. **Idioma.** Todo el contenido textual debe estar en español, en el registro imperativo/normativo propio de un documento BPM.`;

const responseSchemaVerificacion = {
  type: SchemaType.OBJECT,
  properties: {
    resumenVerificacion: { type: SchemaType.STRING },
    verificaciones: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          id: { type: SchemaType.NUMBER },
          resuelto: { type: SchemaType.BOOLEAN },
          justificacion: { type: SchemaType.STRING },
        },
        required: ["id", "resuelto", "justificacion"],
      },
    },
  },
  required: ["resumenVerificacion", "verificaciones"],
};

export interface VerificacionCorreccionInput {
  hallazgos: HallazgoAVerificar[];
  rmdCorregido: RMDExtraido;
  pdfCorregidoBase64?: string;
}

export async function verificarCorreccionRMD(
  input: VerificacionCorreccionInput
): Promise<ResultadoVerificacionCorreccion> {
  const textoContenido = `## OBSERVACIONES A VERIFICAR (de la revisión anterior)

${input.hallazgos.map((h) => `- id ${h.id} · ${h.ubicacionReferencia}: ${h.descripcion}`).join("\n")}

## RMD CORREGIDO (estructura extraída, sección 6 de firmas ya excluida)

${JSON.stringify(input.rmdCorregido, null, 2)}`;

  const pdfsAdjuntos = [];
  if (input.pdfCorregidoBase64) {
    pdfsAdjuntos.push({
      mimeType: "application/pdf",
      data: input.pdfCorregidoBase64,
      etiqueta: "PDF original del RMD corregido, como respaldo visual del layout.",
    });
  }

  const parsed: ResultadoVerificacionCorreccion = await generarJSONConFallback({
    nombreOperacion: "verificarCorreccionRMD",
    systemPrompt: SYSTEM_PROMPT_VERIFICACION,
    textoContenido,
    pdfsAdjuntos,
    schema: responseSchemaVerificacion,
  });

  return parsed;
}
