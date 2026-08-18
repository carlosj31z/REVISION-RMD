import { SchemaType } from "@google/generative-ai";
import { generarJSONConFallback } from "./llmFallback";
import type { ReglaHomologacion } from "@/types/rmd";

/**
 * Asistente de redacción de reglas permanentes.
 *
 * Una regla permanente se escribe una vez y después se aplica sola a TODAS las
 * revisiones de su sección/etapa. Eso la vuelve peligrosa cuando queda
 * ambigua: nadie la vuelve a leer, y una interpretación distinta de la
 * buscada se propaga en silencio a cada revisión. Acá la IA devuelve cómo
 * entendió la regla ANTES de guardarla, señala qué le quedó ambiguo, y avisa
 * si choca o se superpone con alguna regla ya existente.
 *
 * No decide nada: el analista valida o pide otra vuelta hasta que la
 * redacción diga lo que necesita.
 */

export interface ReglaEnConflicto {
  id: string;
  texto: string;
  tipo: "contradice" | "duplica" | "se_superpone";
  explicacion: string;
}

export interface AnalisisRegla {
  interpretacion: string;
  loQueHara: string[];
  loQueNoHara: string[];
  ambiguedades: string[];
  conflictos: ReglaEnConflicto[];
  necesitaAjuste: boolean;
  textoSugerido: string | null;
}

const schemaAnalisis = {
  type: SchemaType.OBJECT,
  properties: {
    interpretacion: { type: SchemaType.STRING },
    loQueHara: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    loQueNoHara: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    ambiguedades: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    conflictos: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          id: { type: SchemaType.STRING },
          texto: { type: SchemaType.STRING },
          tipo: {
            type: SchemaType.STRING,
            enum: ["contradice", "duplica", "se_superpone"],
          },
          explicacion: { type: SchemaType.STRING },
        },
        required: ["id", "texto", "tipo", "explicacion"],
      },
    },
    necesitaAjuste: { type: SchemaType.BOOLEAN },
    textoSugerido: { type: SchemaType.STRING, nullable: true },
  },
  required: [
    "interpretacion",
    "loQueHara",
    "loQueNoHara",
    "ambiguedades",
    "conflictos",
    "necesitaAjuste",
    "textoSugerido",
  ],
};

const SYSTEM_PROMPT_REGLA = `Sos un Auditor de Calidad Farmacéutica (QA) que ayuda a redactar REGLAS PERMANENTES de homologación para revisiones de RMD en una planta peruana (Medifarma).

## QUÉ ES UNA REGLA PERMANENTE
Una instrucción fija que el analista escribe UNA vez y que después se aplica automáticamente a TODAS las revisiones futuras de la sección/etapa indicada (ej. "el término X debe reemplazarse por Y", "todo paso de pesada debe registrar la balanza usada"). Nadie la vuelve a leer al aplicarla: si quedó ambigua, esa ambigüedad se propaga sola a cada revisión.

## TU TRABAJO
Devolver, ANTES de que la regla se guarde:
1. **interpretacion**: cómo entendiste la regla, en una o dos frases, en tus palabras. Tiene que ser lo bastante concreta como para que el analista note enseguida si entendiste otra cosa. Nada de repetir la regla textualmente: eso no le sirve para detectar un malentendido.
2. **loQueHara**: 2 a 4 ejemplos CONCRETOS de texto de RMD que esta regla marcaría como hallazgo. Usá redacción realista de un RMD (mayúsculas, registro imperativo).
3. **loQueNoHara**: 1 a 3 ejemplos concretos de texto parecido que la regla NO marcaría. Es lo que mejor revela un malentendido de alcance.
4. **ambiguedades**: qué te quedó sin definir y podría hacer que la apliques distinto de lo esperado (ej. "no aclara si aplica también al plural", "no dice si el reemplazo es sensible a mayúsculas"). Vacío si de verdad no hay ninguna.
5. **conflictos**: contra la lista de reglas YA EXISTENTES que recibís, marcá las que:
   - "contradice": piden cosas incompatibles sobre el mismo texto (ej. una exige A→B y la otra B→A).
   - "duplica": dicen lo mismo con otras palabras.
   - "se_superpone": comparten parte del alcance y podrían pisarse en algunos casos.
   Usá el "id" EXACTO que viene en la lista. Si no hay conflicto con ninguna, devolvé un arreglo vacío.
6. **necesitaAjuste**: true si la regla, tal como está escrita, es ambigua o conflictiva al punto de que aplicarla sería riesgoso.
7. **textoSugerido**: si necesitaAjuste es true, una reescritura de la regla que conserve exactamente la intención del analista pero cierre la ambigüedad. Si no hace falta, null.

## REGLAS ABSOLUTAS
1. **No cambies la intención.** Tu reescritura precisa lo que el analista quiso decir; no agrega exigencias nuevas ni amplía el alcance por tu cuenta. Si no podés inferir la intención con confianza, no sugieras texto: mejor listá la ambigüedad y que él la resuelva.
2. **Sé honesto y concreto sobre lo que no entendiste.** Una regla que aprobás sin señalar su ambigüedad se aplica sola a cada revisión futura.
3. **No inventes conflictos.** Sólo reportá choques reales contra las reglas de la lista, citando su id.
4. **JSON estricto**, un único objeto válido según el schema. Sin markdown ni texto fuera del JSON.
5. **Idioma:** español.`;

export interface AnalizarReglaInput {
  textoRegla: string;
  seccionCodigo: string | null;
  etapaCodigo: string | null;
  reglasExistentes: ReglaHomologacion[];
  /** Vueltas anteriores de la conversación, para que la IA no repita lo ya
   *  aclarado cuando el analista corrige y pide revisar de nuevo. */
  historial?: { textoRegla: string; comentarioUsuario: string }[];
}

export async function analizarRegla(input: AnalizarReglaInput): Promise<AnalisisRegla> {
  const alcance = `${input.seccionCodigo ?? "TODAS las secciones"} / ${input.etapaCodigo ?? "TODAS las etapas"}`;

  // Sólo tiene sentido cruzar contra reglas que puedan coincidir en alcance:
  // una regla de ACONDICIONADO no puede chocar con una de SOLIDOS.
  const relevantes = input.reglasExistentes.filter((r) => {
    const mismaSeccion =
      !r.seccionCodigo || !input.seccionCodigo || r.seccionCodigo === input.seccionCodigo;
    const mismaEtapa = !r.etapaCodigo || !input.etapaCodigo || r.etapaCodigo === input.etapaCodigo;
    return mismaSeccion && mismaEtapa;
  });

  const historial =
    input.historial && input.historial.length > 0
      ? `\n\n## VUELTAS ANTERIORES DE ESTA MISMA REGLA\n${input.historial
          .map(
            (h, i) =>
              `${i + 1}. Redacción: "${h.textoRegla}"\n   El analista respondió: "${h.comentarioUsuario}"`
          )
          .join("\n")}\n\nTené en cuenta lo que ya aclaró: no vuelvas a preguntar lo mismo.`
      : "";

  const textoContenido = `## REGLA PROPUESTA

"${input.textoRegla}"

Alcance: ${alcance}

## REGLAS PERMANENTES YA EXISTENTES QUE COMPARTEN ALCANCE

${
  relevantes.length > 0
    ? relevantes
        .map(
          (r) =>
            `- id: ${r.id}\n  texto: "${r.texto}"\n  alcance: ${r.seccionCodigo ?? "TODAS"} / ${r.etapaCodigo ?? "TODAS"}${r.activa ? "" : "  (DESACTIVADA)"}`
        )
        .join("\n")
    : "(no hay ninguna otra regla que comparta alcance con esta)"
}${historial}`;

  return await generarJSONConFallback({
    nombreOperacion: "analizarRegla",
    systemPrompt: SYSTEM_PROMPT_REGLA,
    textoContenido,
    schema: schemaAnalisis,
  });
}
