import type { AlertaCoherencia, InsumoItem, PasoProcedimiento, RMDExtraido } from "@/types/rmd";
import {
  contencion,
  normalizarParaComparar,
  palabrasDistintivas,
} from "./comparadorRmd/normalizar";

// Alertas de coherencia que se calculan con código, no con el modelo.
//
// Cuatro de las verificaciones que el prompt le pedía al modelo no necesitan
// interpretar nada: son aritmética, pertenencia a un conjunto y búsqueda de
// texto. Y son, además, justo las que un modelo de lenguaje hace PEOR —
// sumar doce cantidades de un documento, recorrer treinta equipos sin saltarse
// ninguno, o confirmar que una nota literal está presente. El código las hace
// perfectas y siempre igual.
//
// Pasarlas acá tiene dos efectos: el prompt se acorta (esas cuatro reglas eran
// párrafos largos en los dos prompts de comparación) y los hallazgos dejan de
// depender de que el modelo no se distraiga. Los prompts ahora dicen
// explícitamente que NO reporten estos cuatro tipos, así que no hay duplicados.

/** Desde acá se considera que el paso habla de ese equipo o insumo. */
const UMBRAL_MENCION = 0.6;

function palabrasDelPaso(paso: PasoProcedimiento): Set<string> {
  return new Set(palabrasDistintivas(paso.texto));
}

// ============================================================
// 1. Citas internas a pasos que no existen
// ============================================================

// "según el paso 4.2.5", "como se preparó en el numeral 4.1.3", "ver punto 4.3.2".
// Se exige la palabra clave (paso/numeral/punto/ítem) para no confundir una
// cita con cualquier número con puntos del texto — una concentración, un
// código o una medida.
const CITA_INTERNA = /\b(?:PASOS?|NUMERAL(?:ES)?|PUNTOS?|ITEMS?)\s+(?:N[°º]?\s*)?(\d+(?:\.\d+)+)/g;

export function detectarCitasInternasRotas(
  rmd: RMDExtraido,
  etiquetaDocumento?: string
): AlertaCoherencia[] {
  const idsExistentes = new Set(rmd.procedimiento.map((p) => p.id));
  const sufijo = etiquetaDocumento ? ` en el ${etiquetaDocumento}` : "";
  const alertas: AlertaCoherencia[] = [];

  for (const paso of rmd.procedimiento) {
    const texto = normalizarParaComparar(paso.texto);
    const vistas = new Set<string>();

    for (const match of texto.matchAll(CITA_INTERNA)) {
      const citado = match[1];
      if (vistas.has(citado)) continue;
      vistas.add(citado);

      // Una cita a "4.2" cuando los pasos son "4.2.1", "4.2.2"… es una
      // referencia a la subsección, no a un paso inexistente.
      const existe =
        idsExistentes.has(citado) ||
        [...idsExistentes].some((id) => id.startsWith(`${citado}.`));
      if (existe) continue;

      alertas.push({
        tipo: "referencia_cruzada_rota",
        descripcion:
          `El paso ${paso.id}${sufijo} cita al paso ${citado}, que no existe en el documento. ` +
          "Típicamente pasa cuando los pasos se renumeran y la cita queda apuntando al número viejo.",
        pasosAfectados: [paso.id],
        severidad: "alta",
        pasoId: paso.id,
        seccionGeneral: null,
        citaTextual: match[0],
      });
    }
  }

  return alertas;
}

// ============================================================
// 2. Equipos listados que no se preparan en el procedimiento
// ============================================================

export function detectarEquiposSinPreparacion(
  rmd: RMDExtraido,
  etiquetaDocumento?: string
): AlertaCoherencia[] {
  if (rmd.equiposInstrumentos.length === 0 || rmd.procedimiento.length === 0) return [];

  const pasos = rmd.procedimiento.map((paso) => ({
    paso,
    palabras: palabrasDelPaso(paso),
    texto: normalizarParaComparar(paso.texto),
  }));
  const sufijo = etiquetaDocumento ? ` del ${etiquetaDocumento}` : "";
  const alertas: AlertaCoherencia[] = [];

  for (const equipo of rmd.equiposInstrumentos) {
    const claves = palabrasDistintivas(equipo.descripcion);
    // Sin palabras con las que reconocerlo no se puede afirmar nada: mejor no
    // alertar que alertar sobre una descripción vacía o puramente genérica.
    if (claves.length === 0) continue;

    const codigo = equipo.codigo ? normalizarParaComparar(equipo.codigo) : "";
    const preparado = pasos.some(
      ({ palabras, texto }) =>
        (codigo !== "" && texto.includes(codigo)) || contencion(claves, palabras) >= UMBRAL_MENCION
    );
    if (preparado) continue;

    alertas.push({
      tipo: "equipo_sin_preparacion_registrada",
      descripcion:
        `${equipo.codigo ? `${equipo.codigo} — ` : ""}${equipo.descripcion} está listado en ` +
        `EQUIPOS/INSTRUMENTOS/MATERIALES${sufijo} pero no se encontró ningún paso del procedimiento ` +
        "que lo mencione, así que no hay evidencia de su preparación o uso.",
      pasosAfectados: [],
      severidad: "alta",
      pasoId: null,
      // El equipo está en la sección 1, no en un paso: el visor salta ahí.
      seccionGeneral: "equipos_instrumentos",
      citaTextual: equipo.codigo || equipo.descripcion,
    });
  }

  return alertas;
}

// ============================================================
// 3. Nota de verificación presencial cuando el paso exige V°B°
// ============================================================

/**
 * La nota exigida es "NOTA: EL JEFE O SUPERVISOR DE LA SECCION DEBE VERIFICAR
 * PRESENCIALMENTE LA ACTIVIDAD U OPERACION REALIZADA". Se busca por sus dos
 * partes irreemplazables en vez de la frase completa, para que una redacción
 * equivalente no cuente como faltante.
 */
function tieneNotaVerificacionPresencial(texto: string): boolean {
  const normalizado = normalizarParaComparar(texto);
  return (
    normalizado.includes("PRESENCIALMENTE") &&
    (normalizado.includes("JEFE") || normalizado.includes("SUPERVISOR"))
  );
}

export function detectarNotaVbFaltante(
  rmd: RMDExtraido,
  etiquetaDocumento?: string
): AlertaCoherencia[] {
  const sufijo = etiquetaDocumento ? ` en el ${etiquetaDocumento}` : "";

  return rmd.procedimiento
    .filter((paso) => paso.requiereVB && !tieneNotaVerificacionPresencial(paso.texto))
    .map((paso) => ({
      tipo: "nota_vb_faltante" as const,
      descripcion:
        `El paso ${paso.id}${sufijo} exige Visto Bueno pero su texto no incluye la nota de ` +
        "verificación presencial del jefe o supervisor de sección.",
      pasosAfectados: [paso.id],
      severidad: "alta" as const,
      pasoId: paso.id,
      seccionGeneral: null,
      citaTextual: null,
    }));
}

// ============================================================
// 4. Cuadre de cantidades de insumos
// ============================================================

/** Unidades reconocidas, llevadas a una base común por dimensión. */
const UNIDADES: Record<string, { dimension: "MASA" | "VOLUMEN"; aBase: number }> = {
  KG: { dimension: "MASA", aBase: 1000 },
  G: { dimension: "MASA", aBase: 1 },
  MG: { dimension: "MASA", aBase: 0.001 },
  L: { dimension: "VOLUMEN", aBase: 1000 },
  LT: { dimension: "VOLUMEN", aBase: 1000 },
  ML: { dimension: "VOLUMEN", aBase: 1 },
};

// El lookahead descarta "34 KG/CM2" (una presión, no una masa) y cualquier
// unidad compuesta: sólo cuenta cuando la unidad termina ahí.
const CANTIDAD_CON_UNIDAD = /(\d+(?:[.,]\d+)?)\s*(KG|MG|ML|LT|G|L)(?![/A-Z0-9])/g;

/**
 * En estos documentos el separador decimal es el punto y las cantidades de
 * insumo se escriben con tres decimales: "5.250 kg" son 5,25 kg, no 5250 kg.
 * Lo confirma la configuración de los campos de insumo en el sistema digital,
 * donde "# Decimales" es 3.
 */
export function aCantidad(texto: string): number | null {
  const limpio = texto.replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(limpio)) return null;
  const numero = Number(limpio);
  return Number.isFinite(numero) ? numero : null;
}

function dimensionDe(um: string): "MASA" | "VOLUMEN" | null {
  return UNIDADES[normalizarParaComparar(um).replace(/[^A-Z]/g, "")]?.dimension ?? null;
}

function aBase(cantidad: number, unidad: string): number | null {
  const info = UNIDADES[unidad];
  return info ? cantidad * info.aBase : null;
}

interface CantidadEnPaso {
  valor: number;
  dimension: "MASA" | "VOLUMEN";
  textoOriginal: string;
}

function cantidadesDelPaso(texto: string): CantidadEnPaso[] {
  const normalizado = normalizarParaComparar(texto);
  const salida: CantidadEnPaso[] = [];

  for (const match of normalizado.matchAll(CANTIDAD_CON_UNIDAD)) {
    const cantidad = aCantidad(match[1]);
    const enBase = cantidad === null ? null : aBase(cantidad, match[2]);
    if (enBase === null) continue;
    salida.push({
      valor: enBase,
      dimension: UNIDADES[match[2]].dimension,
      textoOriginal: match[0],
    });
  }

  return salida;
}

/** Diferencia aceptada entre la suma del procedimiento y el total declarado. */
const TOLERANCIA = 0.005;

/**
 * Suma las cantidades que el procedimiento indica para cada insumo y las
 * compara contra el total declarado en la sección 2.
 *
 * Es deliberadamente CONSERVADOR: sólo reporta cuando la atribución es
 * inequívoca. Se descarta el insumo si algún paso lo menciona sin una cantidad
 * en su misma dimensión (el procedimiento dice "agregar" sin número), si un
 * paso menciona dos insumos a la vez, o si un paso trae dos cantidades de la
 * misma dimensión — en todos esos casos no se puede saber qué número va con
 * qué insumo, y un falso "no cuadra" en un documento GMP es peor que no
 * decir nada.
 */
export function detectarCantidadesQueNoCuadran(
  rmd: RMDExtraido,
  etiquetaDocumento?: string
): AlertaCoherencia[] {
  if (rmd.insumos.length === 0 || rmd.procedimiento.length === 0) return [];

  interface Acumulado {
    insumo: InsumoItem;
    claves: string[];
    dimension: "MASA" | "VOLUMEN";
    suma: number;
    pasos: string[];
    descartado: boolean;
    motivoDescarte: string;
  }

  const seguimiento: Acumulado[] = [];
  for (const insumo of rmd.insumos) {
    const dimension = dimensionDe(insumo.um);
    const claves = palabrasDistintivas(insumo.descripcion);
    // Sin unidad reconocible o sin palabras con las que reconocerlo, no hay
    // nada que cuadrar.
    if (!dimension || claves.length === 0) continue;
    seguimiento.push({
      insumo,
      claves,
      dimension,
      suma: 0,
      pasos: [],
      descartado: false,
      motivoDescarte: "",
    });
  }
  if (seguimiento.length === 0) return [];

  for (const paso of rmd.procedimiento) {
    const palabras = palabrasDelPaso(paso);
    const mencionados = seguimiento.filter(
      (item) => contencion(item.claves, palabras) >= UMBRAL_MENCION
    );
    if (mencionados.length === 0) continue;

    if (mencionados.length > 1) {
      for (const item of mencionados) {
        item.descartado = true;
        item.motivoDescarte = `el paso ${paso.id} menciona más de un insumo a la vez`;
      }
      continue;
    }

    const item = mencionados[0];
    const cantidades = cantidadesDelPaso(paso.texto).filter((c) => c.dimension === item.dimension);

    if (cantidades.length === 0) {
      item.descartado = true;
      item.motivoDescarte = `el paso ${paso.id} lo menciona sin una cantidad numérica`;
      continue;
    }
    if (cantidades.length > 1) {
      item.descartado = true;
      item.motivoDescarte = `el paso ${paso.id} trae más de una cantidad y no se puede saber cuál le corresponde`;
      continue;
    }

    item.suma += cantidades[0].valor;
    item.pasos.push(paso.id);
  }

  const sufijo = etiquetaDocumento ? ` del ${etiquetaDocumento}` : "";
  const alertas: AlertaCoherencia[] = [];

  for (const item of seguimiento) {
    if (item.descartado || item.pasos.length === 0) continue;

    const declarado = aCantidad(item.insumo.cantidad);
    const declaradoEnBase =
      declarado === null
        ? null
        : aBase(declarado, normalizarParaComparar(item.insumo.um).replace(/[^A-Z]/g, ""));
    if (declaradoEnBase === null || declaradoEnBase === 0) continue;

    const desvio = Math.abs(item.suma - declaradoEnBase) / declaradoEnBase;
    if (desvio <= TOLERANCIA) continue;

    // Se muestra en la unidad declarada, que es la que el analista tiene a la
    // vista en la sección 2.
    const factor = UNIDADES[normalizarParaComparar(item.insumo.um).replace(/[^A-Z]/g, "")].aBase;
    const sumaEnUnidadDeclarada = item.suma / factor;

    alertas.push({
      tipo: "cantidad_insumo_no_cuadra",
      descripcion:
        `${item.insumo.descripcion}${item.insumo.codigo ? ` (${item.insumo.codigo})` : ""}: el ` +
        `procedimiento${sufijo} suma ${sumaEnUnidadDeclarada.toFixed(3)} ${item.insumo.um} entre ` +
        `los pasos ${item.pasos.join(", ")}, y la tabla de INSUMOS declara ` +
        `${item.insumo.cantidad} ${item.insumo.um}. Diferencia de ${(desvio * 100).toFixed(1)}%.`,
      pasosAfectados: item.pasos,
      severidad: "alta",
      pasoId: item.pasos[0] ?? null,
      seccionGeneral: null,
      citaTextual: null,
    });
  }

  return alertas;
}

// ============================================================

/**
 * Las cuatro verificaciones mecánicas de coherencia, en un solo lugar.
 * `etiquetaDocumento` distingue el origen cuando se corren sobre dos
 * documentos (ej. "borrador de Producción"), igual que los cruces de
 * documentos obsoletos y equipos calificados.
 */
export function detectarAlertasCoherencia(
  rmd: RMDExtraido,
  etiquetaDocumento?: string
): AlertaCoherencia[] {
  return [
    ...detectarCitasInternasRotas(rmd, etiquetaDocumento),
    ...detectarEquiposSinPreparacion(rmd, etiquetaDocumento),
    ...detectarNotaVbFaltante(rmd, etiquetaDocumento),
    ...detectarCantidadesQueNoCuadran(rmd, etiquetaDocumento),
  ];
}
