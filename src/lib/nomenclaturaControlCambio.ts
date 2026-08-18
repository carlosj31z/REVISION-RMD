import { SchemaType } from "@google/generative-ai";
import { generarJSONConFallback } from "./llmFallback";

/**
 * Generador de la nomenclatura estándar de Control de Cambio.
 *
 * Formato objetivo (ejemplo real de la planta):
 * "26-202-CC/G.Guevara/2026-06-25; Baja de la Codificadora Domino A200 N° 2
 * (COS-E37) de la sección de Cosméticos; máquina; moderado."
 *
 * Tres de los seis campos (código, fecha, título) son extracción directa del
 * documento. Los otros tres exigen juicio: el formato corto del aprobador
 * (inicial del nombre + primer apellido — hay que separar nombres y
 * apellidos correctamente, y un correo puede firmar distinto de cómo figura
 * en el "Desde"), a cuál de las 6M impacta, y el grado de impacto. Por eso
 * este es un caso de "que la IA lo revise": no hay una regla mecánica para
 * las últimas dos, y el resultado queda editable en la UI antes de usarse.
 */

export type Categoria6M = "MANO_DE_OBRA" | "MAQUINA" | "MEDIO_AMBIENTE" | "MATERIAL" | "METODO" | "MEDIDA";
export type GradoImpacto = "CRITICO" | "MODERADO" | "MENOR";

export const ETIQUETA_6M: Record<Categoria6M, string> = {
  MANO_DE_OBRA: "Mano de obra",
  MAQUINA: "Máquina",
  MEDIO_AMBIENTE: "Medio Ambiente",
  MATERIAL: "Material",
  METODO: "Método",
  MEDIDA: "Medida",
};

export const ETIQUETA_GRADO: Record<GradoImpacto, string> = {
  CRITICO: "Crítico",
  MODERADO: "Moderado",
  MENOR: "Menor",
};

export interface NomenclaturaControlCambio {
  codigo: string;
  aprobadorNombreCompleto: string;
  aprobadorFormatoCorto: string; // ej. "G.Guevara"
  fechaAprobacion: string | null; // YYYY-MM-DD
  titulo: string;
  categoria6M: Categoria6M;
  justificacion6M: string;
  gradoImpacto: GradoImpacto;
  justificacionGrado: string;
  advertencias: string[];
}

const schemaNomenclatura = {
  type: SchemaType.OBJECT,
  properties: {
    codigo: { type: SchemaType.STRING },
    aprobadorNombreCompleto: { type: SchemaType.STRING },
    aprobadorFormatoCorto: { type: SchemaType.STRING },
    fechaAprobacion: { type: SchemaType.STRING, nullable: true },
    titulo: { type: SchemaType.STRING },
    categoria6M: {
      type: SchemaType.STRING,
      enum: ["MANO_DE_OBRA", "MAQUINA", "MEDIO_AMBIENTE", "MATERIAL", "METODO", "MEDIDA"],
    },
    justificacion6M: { type: SchemaType.STRING },
    gradoImpacto: { type: SchemaType.STRING, enum: ["CRITICO", "MODERADO", "MENOR"] },
    justificacionGrado: { type: SchemaType.STRING },
    advertencias: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
  },
  required: [
    "codigo",
    "aprobadorNombreCompleto",
    "aprobadorFormatoCorto",
    "fechaAprobacion",
    "titulo",
    "categoria6M",
    "justificacion6M",
    "gradoImpacto",
    "justificacionGrado",
    "advertencias",
  ],
};

const SYSTEM_PROMPT_NOMENCLATURA = `Sos un Auditor de Calidad Farmacéutica (QA) que arma la nomenclatura estándar de identificación de Controles de Cambio para una planta peruana (Medifarma).

## FORMATO OBJETIVO (ejemplo real ya usado en la planta)
"26-202-CC/G.Guevara/2026-06-25; Baja de la Codificadora Domino A200 N° 2 (COS-E37) de la sección de Cosméticos; máquina; moderado."

Se arma así: <código>/<Inicial del nombre>.<primer apellido>/<fecha AAAA-MM-DD>; <título>; <categoría 6M>; <grado de impacto>. Fijate que los separadores son PUNTO Y COMA, no coma — importa porque el propio título puede traer comas (ej. nombres de sección, ubicaciones), y el punto y coma evita ambigüedad entre esas comas internas y los separadores de campo. Vos solo devolvés los campos por separado en el JSON; el armado final del string con estos separadores lo hace el sistema, no hace falta que lo repliques en ningún campo de texto.

## QUÉ EXTRAER DE CADA CAMPO

1. **codigo**: el código del Control de Cambio tal como aparece en el documento (ej. "26-202-CC"). Suele estar en el asunto/título junto con "CONTROL DE CAMBIO".

2. **aprobadorNombreCompleto** y **aprobadorFormatoCorto**: quién comunica/firma la APROBACIÓN del control de cambio — normalmente quien envía el correo y firma al final (no necesariamente el primer nombre que aparece en el documento; si hay varias personas mencionadas, priorizá a quien explícitamente aprueba o comunica la aprobación). El formato corto es: inicial del PRIMER nombre de pila, un punto, y el PRIMER apellido (el paterno, no el materno) — ej. "Giancarlo Guevara Valenzuela" → "G.Guevara". Prestá atención a nombres compuestos (ej. "Jhair Jose Luis" — el primer nombre de pila es "Jhair") y a la convención peruana de dos apellidos (el primer apellido es el que corresponde acortar, no el segundo).

3. **fechaAprobacion**: la fecha en que se aprobó/comunicó el control de cambio, en formato AAAA-MM-DD. Los correos suelen traerla en español y con el día de la semana abreviado (ej. "Jue 25 Jun 2026" → "2026-06-25"). Si hay varias fechas en el documento (fecha de creación, fechas de plan de acción, etc.), usá la de la comunicación de la APROBACIÓN, no una fecha de plan futuro. Si no podés determinarla con confianza, poné null y explicá por qué en "advertencias".

4. **titulo**: el título/descripción del control de cambio tal como aparece (ej. "Baja de la Codificadora Domino A200 N° 2 (COS-E37) de la sección de Cosméticos"), sin repetir el código ni la palabra "CONTROL DE CAMBIO".

5. **categoria6M**: a cuál de las 6M impacta principalmente el cambio — Mano de obra (personal, capacitación, roles), Máquina (equipos, instrumentos), Medio Ambiente (condiciones ambientales, instalaciones), Material (insumos, materia prima, empaque), Método (procedimientos, procesos, forma de hacer las cosas) o Medida (parámetros de control, especificaciones, unidades de medición). Elegí UNA sola, la más directamente afectada por el cambio descrito. Explicá tu elección en "justificacion6M" citando qué parte del documento la sustenta.

6. **gradoImpacto**: qué tan crítico es el cambio para la calidad del producto y el paciente final —
   - **Crítico**: afecta directamente la calidad, seguridad o eficacia del producto; requiere validación extensa, revalidación de proceso, o tiene riesgo regulatorio alto.
   - **Moderado**: requiere actualizar documentación y/o procesos en varias secciones, con un plan de acción formal, pero no compromete directamente la calidad del producto ya liberado ni exige revalidación completa — típico de bajas/altas de equipos redundantes, actualizaciones administrativas con varios responsables, o cambios que se gestionan con un cronograma de semanas.
   - **Menor**: cambios administrativos, cosméticos o de formato, con impacto acotado a un solo documento o sección, sin plan de acción extenso.
   Explicá tu elección en "justificacionGrado", considerando la cantidad de acciones/documentos involucrados, los plazos del plan de acción si están presentes, y si el cambio compromete directamente la calidad del producto.

## REGLAS ABSOLUTAS

1. **Esto es una PROPUESTA, no una decisión final.** "categoria6M" y "gradoImpacto" en particular son juicios de QA que el analista humano tiene que confirmar o corregir — nunca falsees seguridad que no tenés. Si el documento es ambiguo, decilo en "justificacion6M"/"justificacionGrado" y en "advertencias".

2. **Cero alucinación.** Cada campo debe basarse en contenido real del documento. Si no podés determinar el código, el aprobador o el título con confianza, decilo en "advertencias" en vez de inventar un valor plausible.

3. **JSON estricto**, un único objeto válido según el schema. Sin markdown ni texto fuera del JSON.

4. **Idioma:** español.`;

export interface NomenclaturaInput {
  texto?: string;
  pdfBase64?: string;
}

export async function generarNomenclaturaControlCambio(
  input: NomenclaturaInput
): Promise<NomenclaturaControlCambio> {
  const textoContenido = input.texto
    ? `## CONTROL DE CAMBIO (texto)\n\n${input.texto}`
    : "## CONTROL DE CAMBIO\n\n(ver PDF adjunto)";

  const pdfsAdjuntos = input.pdfBase64
    ? [
        {
          mimeType: "application/pdf",
          data: input.pdfBase64,
          etiqueta: "PDF/correo del Control de Cambio a partir del cual armar la nomenclatura.",
        },
      ]
    : undefined;

  return await generarJSONConFallback({
    nombreOperacion: "generarNomenclaturaControlCambio",
    systemPrompt: SYSTEM_PROMPT_NOMENCLATURA,
    textoContenido,
    pdfsAdjuntos,
    schema: schemaNomenclatura,
    // Solo hace falta cuando viene PDF: sin vision, el modelo no puede leer
    // ni el diseño del correo (Desde/Fecha) ni un control de cambio
    // escaneado — y devolver campos vacíos "con éxito" sería peor que fallar.
    requiereVisionDocumento: !!pdfsAdjuntos,
  });
}
