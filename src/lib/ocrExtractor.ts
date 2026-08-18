import { SchemaType } from "@google/generative-ai";
import { generarJSONConFallback } from "./llmFallback";
import type { RMDExtraido } from "@/types/rmd";

/**
 * Extracción de estructura para RMD ESCANEADOS.
 *
 * El parseo heurístico de pdfExtractor.ts trabaja sobre el texto embebido del
 * PDF. Un borrador escaneado no tiene ninguno: son imágenes, una por página
 * (verificado sobre un borrador real de Acondicionado: 12 páginas, 12
 * imágenes, 0 fuentes → 0 caracteres extraídos). Con la estructura vacía se
 * caían en silencio tres cosas que NO dependen del modelo sino de ella:
 *   - el cruce determinístico de documentos obsoletos (documentosReferenciados),
 *   - la navegación del visor a un paso (procedimiento[].pagina),
 *   - el cuadre de cantidades de insumos (insumos[] vs. el procedimiento).
 *
 * Acá se reconstruye esa misma estructura leyendo el PDF visualmente. Es más
 * lento y más caro que el parseo de texto, así que sólo se usa cuando el
 * documento realmente no trae texto (ver decidirSiNecesitaOCR).
 */

/** Bajo este umbral de caracteres se asume que el PDF no tiene capa de texto
 *  utilizable: un RMD real de una sola página ya supera holgadamente esto. */
const MINIMO_CARACTERES_UTILES = 200;

export function necesitaOCR(textoExtraido: string): boolean {
  return textoExtraido.replace(/\s+/g, "").length < MINIMO_CARACTERES_UTILES;
}

const itemLista = {
  type: SchemaType.OBJECT,
  properties: {
    descripcion: { type: SchemaType.STRING },
    codigo: { type: SchemaType.STRING },
  },
  required: ["descripcion", "codigo"],
};

const schemaOCR = {
  type: SchemaType.OBJECT,
  properties: {
    encabezado: {
      type: SchemaType.OBJECT,
      properties: {
        producto: { type: SchemaType.STRING },
        codigo: { type: SchemaType.STRING },
        versionFabAlt: { type: SchemaType.STRING },
        edicionRegManuf: { type: SchemaType.NUMBER },
        estado: { type: SchemaType.STRING },
        fechaEstado: { type: SchemaType.STRING },
        autorizadoPor: { type: SchemaType.STRING },
        teorico: { type: SchemaType.STRING },
      },
      required: [
        "producto",
        "codigo",
        "versionFabAlt",
        "edicionRegManuf",
        "estado",
        "fechaEstado",
        "autorizadoPor",
        "teorico",
      ],
    },
    precauciones: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    notasImportantes: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    equiposInstrumentos: { type: SchemaType.ARRAY, items: itemLista },
    insumos: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          descripcion: { type: SchemaType.STRING },
          codigo: { type: SchemaType.STRING },
          cantidad: { type: SchemaType.STRING },
          um: { type: SchemaType.STRING },
        },
        required: ["descripcion", "codigo", "cantidad", "um"],
      },
    },
    condicionesAmbientales: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    procedimiento: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          id: { type: SchemaType.STRING },
          texto: { type: SchemaType.STRING },
          requiereVB: { type: SchemaType.BOOLEAN },
          pagina: { type: SchemaType.NUMBER },
        },
        required: ["id", "texto", "requiereVB", "pagina"],
      },
    },
    documentosReferenciados: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          codigo: { type: SchemaType.STRING },
          tipo: {
            type: SchemaType.STRING,
            enum: ["Instructivo", "Procedimiento", "Formato"],
          },
          area: { type: SchemaType.STRING },
        },
        required: ["codigo", "tipo", "area"],
      },
    },
    paginaPrecauciones: { type: SchemaType.NUMBER, nullable: true },
    paginaNotasImportantes: { type: SchemaType.NUMBER, nullable: true },
    paginaEquiposInstrumentos: { type: SchemaType.NUMBER, nullable: true },
  },
  required: [
    "encabezado",
    "precauciones",
    "notasImportantes",
    "equiposInstrumentos",
    "insumos",
    "condicionesAmbientales",
    "procedimiento",
    "documentosReferenciados",
    "paginaPrecauciones",
    "paginaNotasImportantes",
    "paginaEquiposInstrumentos",
  ],
};

const SYSTEM_PROMPT_OCR = `Sos un transcriptor de documentos de manufactura farmacéutica (RMD) para una planta peruana (Medifarma).

## TU ÚNICA FUNCIÓN
El PDF adjunto es un RMD ESCANEADO: son imágenes de páginas, sin texto seleccionable. Tu trabajo es TRANSCRIBIRLO a una estructura JSON, leyéndolo visualmente página por página. NO analizás, NO opinás, NO corregís: transcribís lo que ves.

## ALCANCE DE ESTA LLAMADA
Se te va a indicar un RANGO DE PÁGINAS. Transcribí ÚNICAMENTE el contenido de esas páginas y ninguna otra: el resto del documento lo transcriben otras llamadas en paralelo y después se unen. Si una sección no aparece en tu rango, devolvé su arreglo vacío (o null en las páginas de sección), sin inventar nada.

## REGLAS ABSOLUTAS

1. **Transcribí, no interpretes.** El texto de cada paso va tal como está impreso, respetando el registro imperativo en mayúsculas propio del documento. No resumas, no reformules, no completes lo que no se lee.

2. **El texto IMPRESO manda para "texto".** Un borrador suele traer anotaciones a mano (manuscritas, resaltadas, tachadas, en otro color). En el campo "texto" de cada paso va SOLO lo impreso. Las anotaciones NO se transcriben acá: el análisis posterior las lee aparte, directamente del PDF. Si un tramo impreso está tachado a mano, igual transcribilo — que esté tachado es una instrucción, no una ausencia.

3. **"pagina" es obligatorio y tiene que ser exacto.** Para cada paso, indicá el número de página (1-indexado) del PDF donde aparece su numeral. De este dato depende que el visor pueda saltar al paso: si te equivocás, el analista termina en la página incorrecta. Si un paso se parte entre dos páginas, usá la del numeral.

4. **Numeración literal.** "id" es el numeral tal cual figura ("4.4.23", "4.2.5"). No lo renumeres ni lo normalices. Si una página no tiene pasos numerados, no inventes ninguno.

5. **requiereVB** es true sólo si ese paso muestra la casilla de Visto Bueno ("VB") junto al campo "REALIZADO POR".

6. **Sección 2 (INSUMOS) completa y fiel.** Transcribí cada fila con su descripción, código, cantidad y unidad EXACTAS como figuran, incluyendo separadores de miles y decimales tal cual se leen (ej. "12 468.000", "0.052"). Estas cifras se usan después para cuadrarlas contra el procedimiento: un dígito mal transcripto genera una alerta falsa.

7. **Documentos referenciados.** Recogé todo código con la forma <I|P|F><3 letras de área>-<letra opcional><3 dígitos> (ej. "IPRO-P123", "FPRO-205", "PDSG-202") que aparezca en cualquier parte del documento. "tipo" sale de la primera letra: I=Instructivo, P=Procedimiento, F=Formato. "area" son las 3 letras siguientes.

8. **La sección 6 (VERIFICACION DE FIRMAS) se ignora por completo.** No la transcribas ni la menciones.

9. **Páginas de secciones generales.** Indicá en qué página empiezan PRECAUCIONES, NOTAS IMPORTANTES DURANTE EL PROCESO y la sección 1 de EQUIPOS/INSTRUMENTOS/MATERIALES. Si alguna no existe en el documento, poné null.

10. **Nada inventado.** Si un campo del encabezado no se lee con confianza, poné una cadena vacía en vez de adivinar. Es preferible un campo vacío que un dato falso: esto alimenta una revisión de calidad regulada.

11. **JSON estricto.** Un único objeto JSON válido según el schema. Sin markdown ni texto fuera del JSON.`;

export interface ResultadoOCR {
  estructura: RMDExtraido;
  /** Cuántos pasos se pudieron transcribir: sirve para avisar si el escaneo
   *  salió tan pobre que el resultado no es confiable. */
  pasosDetectados: number;
}

/** Páginas por llamada. El costo del OCR lo domina la GENERACIÓN del texto,
 *  no la lectura: transcribir 12 páginas de corrido tardó 373 s, por encima
 *  del techo de ejecución de la plataforma. Repartirlas en llamadas
 *  paralelas sobre el mismo PDF corta ese tiempo sin partir el archivo. */
const PAGINAS_POR_LLAMADA = 3;

/** El modelo suele devolver el numeral con el separador pegado ("4.1.1.-").
 *  El visor arma su patrón de búsqueda como `${id}.-`, así que un id sin
 *  normalizar no encontraría nunca el paso en el PDF. */
function normalizarIdPaso(id: string): string {
  return String(id ?? "")
    .trim()
    .replace(/[.\-\s]+$/, "");
}

function fusionar(partes: any[]): RMDExtraido {
  const vacio = { producto: "", codigo: "", versionFabAlt: "", edicionRegManuf: 0, estado: "", fechaEstado: "", autorizadoPor: "", teorico: "" };
  // El encabezado vive en la página 1, así que sólo un bloque lo trae.
  const encabezado = partes.map((p) => p?.encabezado).find((e) => e?.producto || e?.codigo) ?? vacio;

  const unicos = <T,>(items: T[], clave: (t: T) => string): T[] => {
    const vistos = new Set<string>();
    return items.filter((it) => {
      const k = clave(it);
      if (!k || vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });
  };

  const juntar = (campo: string) => partes.flatMap((p) => p?.[campo] ?? []);

  const pasos = juntar("procedimiento")
    .map((p: any) => ({
      id: normalizarIdPaso(p.id),
      texto: p.texto,
      requiereVB: !!p.requiereVB,
      pagina: typeof p.pagina === "number" && p.pagina > 0 ? p.pagina : undefined,
    }))
    .filter((p: any) => p.id.length > 0);

  const primeraPagina = (campo: string) =>
    partes.map((p) => p?.[campo]).find((v) => typeof v === "number" && v > 0);

  return {
    encabezado,
    precauciones: [...new Set(juntar("precauciones"))] as string[],
    notasImportantes: [...new Set(juntar("notasImportantes"))] as string[],
    equiposInstrumentos: unicos(juntar("equiposInstrumentos"), (e: any) => `${e.codigo}|${e.descripcion}`),
    insumos: unicos(juntar("insumos"), (i: any) => `${i.codigo}|${i.descripcion}`),
    condicionesAmbientales: [...new Set(juntar("condicionesAmbientales"))] as string[],
    // Un paso puede aparecer citado en dos bloques (arrastre entre páginas):
    // se queda el primero, que es el que trae su numeral real.
    procedimiento: unicos(pasos, (p: any) => p.id),
    documentosReferenciados: unicos(juntar("documentosReferenciados"), (d: any) => d.codigo),
    paginasSeccionesGenerales: {
      ...(primeraPagina("paginaPrecauciones") ? { precauciones: primeraPagina("paginaPrecauciones")! } : {}),
      ...(primeraPagina("paginaNotasImportantes") ? { notas_importantes: primeraPagina("paginaNotasImportantes")! } : {}),
      ...(primeraPagina("paginaEquiposInstrumentos") ? { equipos_instrumentos: primeraPagina("paginaEquiposInstrumentos")! } : {}),
    },
  };
}

export async function extraerEstructuraPorOCR(
  pdfBase64: string,
  numPaginas: number
): Promise<ResultadoOCR> {
  const bloques: [number, number][] = [];
  for (let desde = 1; desde <= numPaginas; desde += PAGINAS_POR_LLAMADA) {
    bloques.push([desde, Math.min(desde + PAGINAS_POR_LLAMADA - 1, numPaginas)]);
  }

  // Concurrencia acotada: con 6 bloques en vuelo a la vez Gemini empezó a
  // devolver 503. Con 4 (la configuración medida: 12 páginas en 4 bloques,
  // 253 s) responde bien; el tope sólo entra en juego en documentos largos.
  const EN_PARALELO = 4;
  const partes: any[] = [];
  for (let i = 0; i < bloques.length; i += EN_PARALELO) {
    const tanda = await Promise.all(
      bloques.slice(i, i + EN_PARALELO).map(([desde, hasta]) =>
        generarJSONConFallback({
        nombreOperacion: `extraerEstructuraPorOCR(p.${desde}-${hasta})`,
        systemPrompt: SYSTEM_PROMPT_OCR,
        textoContenido:
          `Transcribí ÚNICAMENTE las páginas ${desde} a ${hasta} (ambas inclusive) del RMD ` +
          `escaneado adjunto, que tiene ${numPaginas} páginas en total. Ignorá por completo el ` +
          `resto: otras llamadas se encargan de ellas. En "pagina" usá SIEMPRE el número de ` +
          `página real dentro del documento completo (entre ${desde} y ${hasta}), no una ` +
          `numeración relativa al rango.`,
          pdfsAdjuntos: [
            {
              mimeType: "application/pdf",
              data: pdfBase64,
              etiqueta:
                "RMD escaneado (imágenes, sin texto embebido). Leelo visualmente para transcribirlo.",
            },
          ],
          schema: schemaOCR,
          // Sin esto, un bloque que falle en Gemini termina resuelto por Groq
          // —que no ve el PDF— y devuelve un JSON válido con todo vacío: la
          // transcripción parecería exitosa habiendo perdido páginas enteras.
          requiereVisionDocumento: true,
        })
      )
    );
    partes.push(...tanda);
  }

  const estructura = fusionar(partes);
  return { estructura, pasosDetectados: estructura.procedimiento.length };
}
