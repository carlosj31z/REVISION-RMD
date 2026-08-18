/**
 * Geometría del resaltado de pasos sobre un PDF ya renderizado.
 *
 * Vive fuera de VisorPdf.tsx a propósito: es lógica pura (sin React, sin DOM
 * obligatorio, sin pdfjs-dist) y por lo tanto se puede ejercitar desde Node
 * contra un PDF real, que es la única forma de verificarla — la automatización
 * de navegador disponible no puede scriptear la subida de un archivo.
 */

// Solo el tipo, sin runtime: types/rmd.ts no toca React/DOM/pdfjs, así que
// importarlo acá no compromete el aislamiento "lógica pura" del módulo.
import type { SeccionGeneral } from "@/types/rmd";

export interface RectanguloResaltado {
  x: number;
  y: number;
  width: number;
  height: number;
  // true  = fragmento exacto señalado por el análisis (resaltado fuerte)
  // false = resto del paso, sólo contexto (amarillo suave)
  foco: boolean;
}

// Ítem de texto del PDF ya convertido a coordenadas de canvas.
interface ItemUbicado {
  str: string;
  x: number; // borde izquierdo, en px de canvas
  yBase: number; // línea base (baseline), en px de canvas
  ancho: number; // ancho real del ítem, en px de canvas
  alto: number; // alto de la fuente, en px de canvas
  ascent: number; // px por encima de la baseline
  fontFamily: string;
}

export interface ContenidoTexto {
  items: unknown[];
  styles?: Record<string, { fontFamily?: string; ascent?: number }>;
}

/**
 * Escala de render (fit-to-width). ÚNICA fuente de verdad: la usan tanto el
 * render del canvas como el cálculo del resaltado, para que no puedan
 * desincronizarse. Antes el resaltado la reconstruía leyendo `canvas.width`,
 * que vale 300 (el default de HTML) hasta que la página termina de pintarse:
 * al abrir el modal del borrador —que monta con un salto ya pedido— eso
 * calculaba las marcas a ~0.49 mientras el canvas se pintaba a ~1.36, y todas
 * las marcas colapsaban hacia el borde superior izquierdo de la hoja.
 */
export function calcularEscala(anchoBasePdf: number, anchoContenedor: number): number {
  if (!(anchoBasePdf > 0)) return 1;
  return Math.max(0.4, (anchoContenedor - 32) / anchoBasePdf);
}

/** Multiplicación de matrices 2D, igual que `Util.transform` de pdf.js. */
function transformar(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

// Canvas de medición reutilizado: sirve para repartir el ancho REAL de un
// ítem entre sus caracteres respetando las proporciones de una fuente
// proporcional (una "M" ocupa más que una "i"), en vez de asumir que todos
// los caracteres miden lo mismo. En Node no hay DOM: se cae al reparto
// uniforme, que para verificar geometría de bloques es suficiente.
let ctxMedicion: CanvasRenderingContext2D | null | undefined;
function obtenerMedidor(): CanvasRenderingContext2D | null {
  if (ctxMedicion === undefined) {
    ctxMedicion =
      typeof document === "undefined"
        ? null
        : document.createElement("canvas").getContext("2d");
  }
  return ctxMedicion;
}

/**
 * Fracción [0..1] del ancho del ítem que ocupan sus primeros `n` caracteres.
 * Se normaliza contra el ancho medido del string completo, así que sólo
 * importan las proporciones relativas entre caracteres: aunque la fuente que
 * mide el navegador no sea idéntica a la del PDF, el resultado se escala
 * después al ancho real del ítem y el error queda mínimo.
 */
function fraccionAncho(item: ItemUbicado, n: number): number {
  if (n <= 0) return 0;
  if (n >= item.str.length) return 1;
  const ctx = obtenerMedidor();
  if (!ctx) return n / item.str.length; // sin canvas: reparto uniforme
  ctx.font = `${item.alto}px ${item.fontFamily}`;
  const total = ctx.measureText(item.str).width;
  if (!(total > 0)) return n / item.str.length;
  return ctx.measureText(item.str.slice(0, n)).width / total;
}

// Marcas diacríticas combinantes (los acentos que deja NFD al separarlos).
const DIACRITICOS = /[̀-ͯ]/g;

/**
 * Normaliza texto para comparar (mayúsculas, sin acentos, espacios
 * colapsados) devolviendo además el mapa de índices hacia el texto original,
 * para poder traducir una coincidencia de vuelta a posiciones reales.
 */
function normalizarConMapa(texto: string): { normalizado: string; mapa: number[] } {
  const chars: string[] = [];
  const mapa: number[] = [];
  let veniaEspacio = true; // arranca en true para descartar espacios iniciales
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (/\s/.test(c)) {
      if (!veniaEspacio) {
        chars.push(" ");
        mapa.push(i);
        veniaEspacio = true;
      }
      continue;
    }
    const base = c.normalize("NFD").replace(DIACRITICOS, "") || c;
    chars.push(base[0].toUpperCase());
    mapa.push(i);
    veniaEspacio = false;
  }
  return { normalizado: chars.join(""), mapa };
}

/**
 * Ubica la cita del análisis dentro del texto del paso, tolerando que el
 * modelo reformatee, cite de más, o arranque unas palabras antes/después.
 *
 * Importa que acierte: cuando NO encuentra el fragmento, el visor marca el
 * paso entero en amarillo fuerte, que es justamente el "resalta partes que no
 * corresponden" que reportó el usuario. Por eso se intenta, en orden:
 *   1. la cita completa,
 *   2. prefijos cada vez más cortos (el modelo suele agregar cola),
 *   3. la corrida más larga de palabras consecutivas que sí exista en el paso.
 */
function ubicarFragmento(
  pasoNormalizado: string,
  buscadoNormalizado: string
): { pos: number; largo: number } | null {
  if (buscadoNormalizado.length < 4) return null;

  const exacto = pasoNormalizado.indexOf(buscadoNormalizado);
  if (exacto !== -1) return { pos: exacto, largo: buscadoNormalizado.length };

  for (
    let largo = Math.min(buscadoNormalizado.length, 160);
    largo >= 12;
    largo = Math.floor(largo * 0.75)
  ) {
    const pos = pasoNormalizado.indexOf(buscadoNormalizado.slice(0, largo));
    if (pos !== -1) return { pos, largo };
  }

  const palabras = buscadoNormalizado.split(" ").filter((p) => p.length > 0);
  for (let tam = palabras.length; tam >= 2; tam--) {
    for (let ini = 0; ini + tam <= palabras.length; ini++) {
      const frag = palabras.slice(ini, ini + tam).join(" ");
      if (frag.length < 10) continue;
      const pos = pasoNormalizado.indexOf(frag);
      if (pos !== -1) return { pos, largo: frag.length };
    }
  }

  return null;
}

const TOLERANCIA_Y = 2.5;

interface LineaUbicada {
  y: number;
  items: ItemUbicado[];
}

/**
 * Convierte los items crudos de `page.getTextContent()` a líneas físicas
 * ordenadas por lectura (arriba a abajo, izquierda a derecha), en las mismas
 * coordenadas de canvas que usó el render. Paso compartido tanto por el
 * resaltado de un paso numerado como por el de una sección general — lo
 * único que cambia entre ambos es CÓMO se ubican los índices de inicio/fin
 * dentro de estas líneas.
 */
function construirLineas(
  contenido: ContenidoTexto,
  transformViewport: number[],
  escala: number
): LineaUbicada[] {
  const estilos = contenido.styles ?? {};

  const items: ItemUbicado[] = [];
  for (const crudo of contenido.items as any[]) {
    if (typeof crudo?.str !== "string" || crudo.str.length === 0) continue;
    const tx = transformar(transformViewport, crudo.transform);
    const alto = Math.hypot(tx[2], tx[3]) || 10;
    const estilo = estilos[crudo.fontName] ?? {};
    // pdf.js expone el ascent real de la fuente (0..1). 0.8 es su mismo
    // fallback cuando no hay dato.
    const factorAscent =
      typeof estilo.ascent === "number" && estilo.ascent > 0 && estilo.ascent < 1
        ? estilo.ascent
        : 0.8;
    // Ancho REAL: item.width viene en unidades de usuario del PDF, así que
    // sólo hay que multiplicarlo por la escala del viewport — es exactamente
    // lo que hace la capa de texto oficial de pdf.js (canvasWidth * scale).
    // Multiplicarlo además por Math.hypot(tx[0],tx[1]) —que YA incluye el
    // tamaño de fuente— lo inflaba ~10x y hacía que el resaltado se saliera
    // del margen de la hoja.
    const ancho = (crudo.width ?? 0) * escala;
    if (![tx[4], tx[5], ancho, alto].every(Number.isFinite)) continue;
    items.push({
      str: crudo.str,
      x: tx[4],
      yBase: tx[5],
      ancho,
      alto,
      ascent: alto * factorAscent,
      fontFamily: estilo.fontFamily ?? "sans-serif",
    });
  }
  if (items.length === 0) return [];

  // Agrupar en líneas físicas por baseline (con tolerancia de subpíxel) y
  // ordenar cada una de izquierda a derecha, para reconstruir el orden de
  // lectura real del documento.
  const lineas: LineaUbicada[] = [];
  for (const it of items) {
    let linea = lineas.find((l) => Math.abs(l.y - it.yBase) < TOLERANCIA_Y);
    if (!linea) {
      linea = { y: it.yBase, items: [] };
      lineas.push(linea);
    }
    linea.items.push(it);
  }
  for (const l of lineas) l.items.sort((a, b) => a.x - b.x);
  lineas.sort((a, b) => a.y - b.y);
  return lineas;
}

/**
 * Dado un rango de líneas ya delimitado [idxInicio, idxFin) y un patrón de
 * arranque textual (para no resaltar antes de él, por si la línea trae texto
 * de otra columna a la izquierda), arma los rectángulos de resaltado —
 * opcionalmente con un fragmento puntual (`textoBuscado`) marcado más fuerte
 * dentro del rango, y el resto como contexto suave.
 */
function resaltarRango(
  lineas: LineaUbicada[],
  idxInicio: number,
  idxFin: number,
  patronArranque: string,
  textoBuscado?: string
): RectanguloResaltado[] {
  // Aplanar el rango a una secuencia de caracteres, cada uno sabiendo de qué
  // ítem viene y en qué offset — así cualquier rango de texto se traduce a
  // rectángulos con la misma lógica.
  type Caracter = { item: ItemUbicado | null; offset: number };
  const caracteres: Caracter[] = [];
  let textoRango = "";
  for (let i = idxInicio; i < idxFin; i++) {
    for (const item of lineas[i].items) {
      for (let k = 0; k < item.str.length; k++) {
        caracteres.push({ item, offset: k });
        textoRango += item.str[k];
      }
    }
    // Separador entre líneas (no pertenece a ningún ítem: se omite al pintar).
    caracteres.push({ item: null, offset: -1 });
    textoRango += " ";
  }

  // El resaltado arranca en el patrón (ej. "4.4.5.-" o "PRECAUCIONES"), no
  // antes.
  const desdeInicio = Math.max(0, textoRango.indexOf(patronArranque));

  // Ubicar el fragmento exacto señalado por el análisis dentro del rango.
  let rangoFoco: { desde: number; hasta: number } | null = null;
  if (textoBuscado && textoBuscado.trim().length >= 4) {
    const rango = normalizarConMapa(textoRango);
    const buscado = normalizarConMapa(textoBuscado);
    const hallazgo = ubicarFragmento(rango.normalizado, buscado.normalizado);
    if (hallazgo) {
      const largo = Math.min(hallazgo.largo, rango.normalizado.length - hallazgo.pos);
      const desde = rango.mapa[hallazgo.pos];
      const hasta = (rango.mapa[hallazgo.pos + largo - 1] ?? rango.mapa[rango.mapa.length - 1]) + 1;
      if (Number.isFinite(desde) && Number.isFinite(hasta) && hasta > desde) {
        rangoFoco = { desde, hasta };
      }
    }
  }

  const UMBRAL_FUSION = 4; // px: huecos menores se fusionan en una barra continua

  const rectsDeRango = (desde: number, hasta: number, foco: boolean): RectanguloResaltado[] => {
    // Agrupar caracteres consecutivos que pertenecen al mismo ítem.
    const segmentos: { item: ItemUbicado; ini: number; fin: number }[] = [];
    for (let i = desde; i < hasta && i < caracteres.length; i++) {
      const c = caracteres[i];
      if (!c || !c.item || c.offset < 0) continue; // separador de línea
      const ultimo = segmentos[segmentos.length - 1];
      if (ultimo && ultimo.item === c.item && ultimo.fin === c.offset) {
        ultimo.fin = c.offset + 1;
      } else {
        segmentos.push({ item: c.item, ini: c.offset, fin: c.offset + 1 });
      }
    }

    const salida: RectanguloResaltado[] = [];
    for (const seg of segmentos) {
      // Recortar espacios de los extremos para no pintar aire suelto.
      let ini = seg.ini;
      let fin = seg.fin;
      while (ini < fin && /\s/.test(seg.item.str[ini])) ini++;
      while (fin > ini && /\s/.test(seg.item.str[fin - 1])) fin--;
      if (fin <= ini) continue;

      const x0 = seg.item.x + seg.item.ancho * fraccionAncho(seg.item, ini);
      const x1 = seg.item.x + seg.item.ancho * fraccionAncho(seg.item, fin);
      const y = seg.item.yBase - seg.item.ascent;
      const ancho = x1 - x0;
      if (![x0, y, ancho].every(Number.isFinite) || ancho <= 0) continue;

      const anterior = salida[salida.length - 1];
      // Fusionar sólo dentro de la misma línea (misma baseline).
      if (
        anterior &&
        Math.abs(anterior.y - y) < TOLERANCIA_Y &&
        x0 - (anterior.x + anterior.width) < UMBRAL_FUSION
      ) {
        anterior.width = Math.max(anterior.width, x1 - anterior.x);
        anterior.height = Math.max(anterior.height, seg.item.alto * 1.15);
      } else {
        salida.push({
          x: x0,
          y,
          width: Math.max(ancho, 2),
          height: seg.item.alto * 1.15,
          foco,
        });
      }
    }
    return salida;
  };

  if (!rangoFoco) {
    // Sin fragmento puntual: se resalta el rango entero con intensidad normal.
    return rectsDeRango(desdeInicio, caracteres.length, true);
  }

  // Con fragmento: el rango entero queda como contexto suave y el fragmento
  // señalado se dibuja encima con intensidad fuerte.
  return [
    ...rectsDeRango(desdeInicio, caracteres.length, false),
    ...rectsDeRango(rangoFoco.desde, rangoFoco.hasta, true),
  ];
}

/**
 * Calcula los rectángulos de resaltado, en coordenadas de canvas, para un
 * paso del procedimiento:
 *
 *  - Resalta el paso COMPLETO (desde "<pasoId>.-" hasta el siguiente paso
 *    numerado), sin cortarlo a unas pocas líneas.
 *  - Si se pasa `textoBuscado` (la cita textual que el análisis marcó como
 *    observada) y se encuentra dentro del paso, ese fragmento se devuelve
 *    con `foco: true` para resaltarlo fuerte, y el resto del paso queda como
 *    contexto suave. Si no se encuentra, todo el paso va con `foco: true`.
 *
 * `transformViewport` y `escala` deben venir del MISMO viewport con el que se
 * renderizó el canvas (ver calcularEscala).
 */
export function calcularRectangulosResaltado(
  contenido: ContenidoTexto,
  transformViewport: number[],
  escala: number,
  pasoId: string,
  textoBuscado?: string
): RectanguloResaltado[] {
  const lineas = construirLineas(contenido, transformViewport, escala);
  if (lineas.length === 0) return [];

  const patron = `${pasoId}.-`;
  const idxInicio = lineas.findIndex((l) => l.items.map((i) => i.str).join("").includes(patron));
  if (idxInicio === -1) return [];

  // Fin del paso: la siguiente línea que arranca con OTRO paso numerado.
  // Sin tope artificial de líneas — el paso se resalta entero.
  const patronNuevoPaso = /^\d+\.\d+(?:\.\d+)?\.-/;
  const MAX_LINEAS_SEGURIDAD = 40; // sólo para no desbocarse ante un PDF atípico
  let idxFin = lineas.length;
  for (let i = idxInicio + 1; i < lineas.length && i < idxInicio + MAX_LINEAS_SEGURIDAD; i++) {
    const textoLinea = lineas[i].items.map((it) => it.str).join("").trim();
    if (patronNuevoPaso.test(textoLinea)) {
      idxFin = i;
      break;
    }
    idxFin = i + 1;
  }

  return resaltarRango(lineas, idxInicio, idxFin, patron, textoBuscado);
}

/**
 * Marcadores de inicio de cada sección general navegable, duplicados
 * deliberadamente de pdfExtractor.ts: ese módulo importa "unpdf" (solo
 * server/Node) y este vive en el cliente (junto a VisorPdf), así que no se
 * puede compartir el módulo — hay que mantenerlos sincronizados a mano si
 * cambia el layout de los RMD.
 */
const MARCADOR_INICIO_SECCION: Record<SeccionGeneral, RegExp> = {
  precauciones: /PRECAUCIONES/i,
  notas_importantes: /NOTAS IMPORTANTES DURANTE EL PROCESO/i,
  equipos_instrumentos: /1\.-\s*EQUIPOS\s*\/\s*INSTRUMENTOS\s*\/\s*MATERIALES/i,
  condiciones_ambientales: /CONDICIONES\s+AMBIENTALES/i,
};

// Cualquier otro marcador de sección (o el inicio del procedimiento numerado)
// sirve de límite de fin: sólo hace falta parar antes de que arranque la
// PRÓXIMA sección en la misma página, no reproducir el recorte quirúrgico
// que hace pdfExtractor.ts para construir el texto guardado en BD.
const MARCADOR_FIN_SECCION =
  /PRECAUCIONES|NOTAS IMPORTANTES DURANTE EL PROCESO|1\.-\s*EQUIPOS\s*\/\s*INSTRUMENTOS\s*\/\s*MATERIALES|2\.-\s*INSUMOS|CONDICIONES\s+AMBIENTALES|4\.-\s*PROCEDIMIENTO|VERIFICADO POR/i;

/**
 * Igual que `calcularRectangulosResaltado`, pero para una sección general
 * (Precauciones, Notas Importantes, Equipos/Instrumentos/Materiales o
 * Condiciones Ambientales) en vez de un paso numerado del procedimiento:
 * resalta desde el encabezado de la sección hasta el próximo marcador de
 * sección que aparezca en la misma página (o el final de la página si no
 * hay ninguno), con el mismo sistema de foco/contexto si se pasa una cita.
 */
export function calcularRectangulosResaltadoSeccion(
  contenido: ContenidoTexto,
  transformViewport: number[],
  escala: number,
  seccion: SeccionGeneral,
  textoBuscado?: string
): RectanguloResaltado[] {
  const lineas = construirLineas(contenido, transformViewport, escala);
  if (lineas.length === 0) return [];

  const inicioRegex = MARCADOR_INICIO_SECCION[seccion];

  const idxInicio = lineas.findIndex((l) => inicioRegex.test(l.items.map((i) => i.str).join("")));
  if (idxInicio === -1) return [];

  let idxFin = lineas.length;
  for (let i = idxInicio + 1; i < lineas.length; i++) {
    const textoLinea = lineas[i].items.map((it) => it.str).join("");
    if (MARCADOR_FIN_SECCION.test(textoLinea)) {
      idxFin = i;
      break;
    }
  }

  // El "patrón de arranque" acá no es literal (el encabezado puede traer
  // espaciado/mayúsculas distinto al regex) — al no encontrarlo con
  // indexOf, desdeInicio cae a 0 dentro de resaltarRango, que es
  // exactamente lo que se quiere: resaltar desde el principio del rango.
  return resaltarRango(lineas, idxInicio, idxFin, "", textoBuscado);
}
