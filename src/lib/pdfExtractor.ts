import { extractText, getDocumentProxy } from "unpdf";
import type {
  RMDExtraido,
  PasoProcedimiento,
  ItemLista,
  InsumoItem,
  DocumentoReferenciado,
  SeccionGeneral,
} from "@/types/rmd";

/**
 * Extrae texto plano página por página de un PDF usando unpdf (basado en pdf.js,
 * corre en el runtime de Node/Edge de Vercel sin dependencias nativas).
 *
 * Nota de diseño: unpdf nos da texto por página, no una tabla estructurada.
 * Por eso este módulo hace un parseo heurístico basado en los patrones fijos
 * que existen en TODOS los RMD de Medifarma (numeración "4.4.23.-", encabezados
 * "PRECAUCIONES", "1.-EQUIPOS / INSTRUMENTOS / MATERIALES", etc.), que son
 * consistentes en los 4 documentos de muestra (FABRICACION, RECUBRIMIENTO,
 * ENVASE, ACONDICIONADO).
 *
 * El PDF crudo se envía TAMBIÉN a Gemini como respaldo visual (ver gemini.ts),
 * así que si el parseo heurístico pierde algo, la IA todavía tiene el layout
 * original para corregirse.
 */

export interface TextoPDFExtraido {
  texto: string;
  // paginaPorLinea[i] = página (1-indexada) de la línea i de texto.split("\n").
  // Permite ubicar en qué página del PDF original quedó cada paso parseado,
  // para poder saltar directo a esa página en el visor (ver PanelRMDVigente).
  paginaPorLinea: number[];
}

export async function extraerTextoPDF(pdfBuffer: ArrayBuffer): Promise<TextoPDFExtraido> {
  const pdf = await getDocumentProxy(new Uint8Array(pdfBuffer));
  // OJO: mergePages:true colapsa TODOS los saltos de línea a espacios
  // (unpdf hace texts.join("\n").replace(/\s+/g, " ")), lo que destruye la
  // estructura de líneas que necesita el parseo heurístico de abajo. Con
  // mergePages:false, cada página conserva sus saltos de línea reales.
  const { text } = await extractText(pdf, { mergePages: false });

  const todasLasLineas: string[] = [];
  const paginaPorLinea: number[] = [];
  text.forEach((textoPagina, idx) => {
    for (const linea of textoPagina.split("\n")) {
      todasLasLineas.push(linea);
      paginaPorLinea.push(idx + 1);
    }
  });

  return { texto: todasLasLineas.join("\n"), paginaPorLinea };
}

// ---------- Parseo heurístico basado en los patrones observados ----------

const RE_PASO = /^(\d\.\d(?:\.\d+)?)\.-\s*(.+)$/;
// Marcadores de inicio de las secciones generales navegables (no numeradas
// como paso). Se reutilizan tanto para extraer su contenido como para saber
// en qué página del PDF empiezan (ver paginaSeccionesGenerales más abajo).
const RE_INICIO_PRECAUCIONES = /PRECAUCIONES/i;
const RE_INICIO_NOTAS_IMPORTANTES = /NOTAS IMPORTANTES DURANTE EL PROCESO/i;
const RE_INICIO_EQUIPOS = /1\.-\s*EQUIPOS\s*\/\s*INSTRUMENTOS\s*\/\s*MATERIALES/i;
const RE_ENCABEZADO_PRODUCTO = /REGISTRO DE MANUFACTURA\s+(\w+)/i;
const RE_CODIGO_VERSION =
  /(\d{10})\s+([\d/]+)\s+(\d+)\s+(Autorizado|Ingresado)\/\s*([\d-]+)\s*\/([A-Z]+)/;
// Nomenclatura fija de documentos citados: <Tipo:I/P/F><Área:3 letras>-<letra><3 dígitos>
// ej. "IPRO-P123" (Instructivo, área Producción), "ICBL-E200" (Instructivo, área Cápsulas Blandas).
const RE_DOCUMENTO_REFERENCIADO = /\b([IPF])([A-Z]{3})-([A-Z]\d{3})\b/g;
const TIPO_DOCUMENTO: Record<"I" | "P" | "F", DocumentoReferenciado["tipo"]> = {
  I: "Instructivo",
  P: "Procedimiento",
  F: "Formato",
};

/**
 * Parsea el texto plano extraído a la estructura RMDExtraido.
 * Descarta deliberadamente la sección "6.-VERIFICACION DE FIRMAS" y todo lo
 * que venga después, según lo indicado: esa sección no participa en la revisión.
 */
export function parsearEstructuraRMD(
  textoCompleto: string,
  paginaPorLinea: number[]
): RMDExtraido {
  // Cortar todo lo que venga desde "6.-VERIFICACION DE FIRMAS" en adelante.
  // Se corta a nivel de línea (no de índice de caracteres) para poder mantener
  // `paginaPorLinea` alineado con las líneas que sobreviven al corte.
  const lineasCrudas = textoCompleto.split("\n");
  const idxFirmas = lineasCrudas.findIndex((l) => /6\.-\s*VERIFICACION DE FIRMAS/i.test(l));
  const finIndice = idxFirmas > -1 ? idxFirmas : lineasCrudas.length;

  const texto = lineasCrudas.slice(0, finIndice).join("\n");

  const lineasConPagina = lineasCrudas
    .slice(0, finIndice)
    .map((l, i) => ({ texto: l.trim(), pagina: paginaPorLinea[i] }))
    .filter((l) => l.texto.length > 0);
  const lineas = lineasConPagina.map((l) => l.texto);

  return {
    encabezado: extraerEncabezado(texto),
    precauciones: extraerBloque(lineas, "PRECAUCIONES", "VERIFICADO POR", RE_INICIO_PRECAUCIONES),
    notasImportantes: extraerBloque(
      lineas,
      "NOTAS IMPORTANTES DURANTE EL PROCESO",
      "VERIFICADO POR",
      RE_INICIO_NOTAS_IMPORTANTES
    ),
    equiposInstrumentos: extraerTablaEquipos(texto),
    insumos: extraerTablaInsumos(texto),
    condicionesAmbientales: extraerBloque(
      lineas,
      "CONDICIONES  AMBIENTALES",
      "4.-PROCEDIMIENTO",
      /CONDICIONES\s+AMBIENTALES/i
    ),
    procedimiento: extraerPasosProcedimiento(lineasConPagina),
    especificacionesProducto: extraerEspecificaciones(texto),
    documentosReferenciados: extraerDocumentosReferenciados(texto),
    paginasSeccionesGenerales: extraerPaginasSeccionesGenerales(lineasConPagina),
  };
}

/**
 * Página (1-indexada) donde arranca cada sección general navegable, buscando
 * el mismo marcador que usan extraerBloque/extraerTablaEquipos para su
 * contenido — así la página siempre corresponde a la sección que realmente
 * se extrajo, no a una coincidencia distinta.
 */
function extraerPaginasSeccionesGenerales(
  lineasConPagina: { texto: string; pagina: number }[]
): Partial<Record<SeccionGeneral, number>> {
  const paginas: Partial<Record<SeccionGeneral, number>> = {};
  const marcadores: [SeccionGeneral, RegExp][] = [
    ["precauciones", RE_INICIO_PRECAUCIONES],
    ["notas_importantes", RE_INICIO_NOTAS_IMPORTANTES],
    ["equipos_instrumentos", RE_INICIO_EQUIPOS],
  ];
  for (const [seccion, regex] of marcadores) {
    const encontrada = lineasConPagina.find((l) => regex.test(l.texto));
    if (encontrada) paginas[seccion] = encontrada.pagina;
  }
  return paginas;
}

function extraerDocumentosReferenciados(texto: string): DocumentoReferenciado[] {
  const vistos = new Map<string, DocumentoReferenciado>();
  for (const m of texto.matchAll(RE_DOCUMENTO_REFERENCIADO)) {
    const [codigoCrudo, tipoLetra, area] = m;
    const codigo = codigoCrudo.toUpperCase();
    if (vistos.has(codigo)) continue;
    vistos.set(codigo, {
      codigo,
      tipo: TIPO_DOCUMENTO[tipoLetra.toUpperCase() as "I" | "P" | "F"],
      area: area.toUpperCase(),
    });
  }
  return Array.from(vistos.values()).sort((a, b) => a.codigo.localeCompare(b.codigo));
}

function extraerEncabezado(texto: string) {
  const matchProducto = texto.match(RE_ENCABEZADO_PRODUCTO);
  const matchCodigo = texto.match(RE_CODIGO_VERSION);

  return {
    producto: extraerNombreProducto(texto),
    codigo: matchCodigo?.[1] ?? "",
    versionFabAlt: matchCodigo?.[2] ?? "",
    edicionRegManuf: matchCodigo ? parseInt(matchCodigo[3], 10) : 0,
    estado: matchCodigo?.[4] ?? "",
    fechaEstado: matchCodigo?.[5] ?? "",
    autorizadoPor: matchCodigo?.[6] ?? "",
    teorico: extraerTeorico(texto),
    etapaDocumento: matchProducto?.[1] ?? "",
  };
}

function extraerNombreProducto(texto: string): string {
  // El nombre de producto aparece como línea sola entre el encabezado de tabla
  // y la fila "Código | Version Fab./Alt. | ..."
  const m = texto.match(/REGISTRO DE MANUFACTURA\s+\w+[^\n]*\n([A-Za-z0-9À-ÿ ./]+)\nOrden/);
  return m?.[1]?.trim() ?? "";
}

function extraerTeorico(texto: string): string {
  const m = texto.match(/Te[oó]rico:\s*([\d.,]+\s*\w*)/i);
  return m?.[1]?.trim() ?? "";
}

function extraerBloque(
  lineas: string[],
  inicioMarcador: string,
  finMarcador: string,
  inicioRegex?: RegExp
): string[] {
  const idxInicio = lineas.findIndex((l) =>
    inicioRegex ? inicioRegex.test(l) : l.toUpperCase().includes(inicioMarcador.toUpperCase())
  );
  if (idxInicio === -1) return [];

  const idxFin = lineas.findIndex(
    (l, i) => i > idxInicio && l.toUpperCase().includes(finMarcador.toUpperCase())
  );
  const fin = idxFin === -1 ? lineas.length : idxFin;

  return lineas
    .slice(idxInicio + 1, fin)
    .filter((l) => l.startsWith("-") || l.startsWith("−"))
    .map((l) => l.replace(/^[-−]\s*/, "").trim());
}

function extraerTablaEquipos(texto: string): ItemLista[] {
  // Patrón observado: "DESCRIPCION    CODIGO    CODIGO_REF" repetido línea a línea
  // dentro del bloque "1.-EQUIPOS / INSTRUMENTOS / MATERIALES".
  const bloque = extraerSeccionCompleta(texto, RE_INICIO_EQUIPOS, /2\.-\s*INSUMOS/i);
  if (!bloque) return [];

  const items: ItemLista[] = [];
  const re = /^([A-ZÀ-ÿ0-9°ºÑ.,()\/\- ]+?)\s+(\d{7,8}|SOL-[\w-]+|ACO-[\w-]+)\s+([\w.\-]+)?$/gm;
  let m;
  while ((m = re.exec(bloque)) !== null) {
    items.push({
      descripcion: m[1].trim(),
      codigo: m[2].trim(),
      codigoReferencia: m[3]?.trim(),
    });
  }
  return items;
}

function extraerTablaInsumos(texto: string): InsumoItem[] {
  const bloque = extraerSeccionCompleta(
    texto,
    /2\.-\s*INSUMOS/i,
    /3\.-\s*CONDICIONES\s+AMBIENTALES/i
  );
  if (!bloque) return [];

  const items: InsumoItem[] = [];
  // Patrón: DESCRIPCION  CODIGO(10 dígitos)  CANTIDAD  UM
  const re = /^([A-ZÀ-ÿ0-9°ºÑ.,()\/\- ]+?)\s+(\d{10})\s+([\d.,\s]+)\s+(kg|g|L|KGP|kg\.)$/gim;
  let m;
  while ((m = re.exec(bloque)) !== null) {
    items.push({
      descripcion: m[1].trim(),
      codigo: m[2].trim(),
      cantidad: m[3].trim(),
      um: m[4].trim(),
    });
  }
  return items;
}

function extraerSeccionCompleta(texto: string, inicioRe: RegExp, finRe: RegExp): string | null {
  const iM = texto.match(inicioRe);
  if (!iM || iM.index === undefined) return null;
  const desde = iM.index + iM[0].length;
  const fM = texto.slice(desde).match(finRe);
  const hasta = fM && fM.index !== undefined ? desde + fM.index : texto.length;
  return texto.slice(desde, hasta);
}

function extraerPasosProcedimiento(
  lineasConPagina: { texto: string; pagina: number }[]
): PasoProcedimiento[] {
  const pasos: PasoProcedimiento[] = [];
  let actual: PasoProcedimiento | null = null;

  for (const { texto: linea, pagina } of lineasConPagina) {
    const m = linea.match(RE_PASO);
    if (m) {
      if (actual) pasos.push(actual);
      actual = {
        id: m[1],
        texto: m[2].trim(),
        requiereVB: false,
        camposControl: [],
        equiposReferenciados: [],
        pagina,
      };
    } else if (actual) {
      // Continuación de texto multilinea del mismo paso
      actual.texto += " " + linea;
      if (/\bVB\b/.test(linea)) actual.requiereVB = true;
    }
  }
  if (actual) pasos.push(actual);

  return pasos;
}

function extraerEspecificaciones(
  texto: string
): { ensayo: string; especificacion: string }[] {
  const bloque = extraerSeccionCompleta(
    texto,
    /ENSAYO\s+ESPECIFICACIONES\s+RESULTADOS/i,
    /VERIFICADO POR/i
  );
  if (!bloque) return [];

  const lineas = bloque
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const especs: { ensayo: string; especificacion: string }[] = [];
  for (const l of lineas) {
    if (/^(CARACTERISTICAS|PRUEBAS)/i.test(l)) continue;
    const partes = l.split(/\s{2,}/);
    if (partes.length >= 2) {
      especs.push({ ensayo: partes[0], especificacion: partes.slice(1).join(" ") });
    }
  }
  return especs;
}
