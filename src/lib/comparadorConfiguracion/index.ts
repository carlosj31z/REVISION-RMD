import type {
  ArchivoAfectado,
  ComparisonReport,
  ConfiguracionParseada,
  HallazgoConfiguracion,
  ResumenComparacion,
  TipoHallazgo,
} from "@/types/configuracion";
import { relevarPatronesCadena, validarCadena } from "./cadena";
import { validarColumnas, vocabularioTipoDato, vocabularioTipoDatoLegible } from "./columnas";
import { cruzarArchivos, validarCodsDuplicados } from "./cruce";
import { leerMatriz, parsearConfiguracion } from "./parser";
import { validarNumeracion } from "./numeracion";
import { normalizarClave, type CeldaCruda } from "./normalizar";

// Comparador de configuraciones de RMD.
//
// Compara el export de "Configuración" de un producto de referencia (ya
// autorizado) contra el de un producto en desarrollo, para detectar errores
// de enlace, inconsistencias de columnas y diferencias estructurales antes
// de mandar el RMD a Validaciones.
//
// Es 100% determinístico: no interviene ningún modelo de IA, no sale a la
// red y la misma pareja de archivos devuelve siempre el mismo informe.

export interface OpcionesComparacion {
  nombreReferencia?: string;
  nombreObjetivo?: string;
}

/** Primero lo que hay que revisar (el objetivo), al final el contexto (la referencia). */
const PRIORIDAD_ARCHIVO: Record<ArchivoAfectado, number> = {
  objetivo: 0,
  ambos: 1,
  referencia: 2,
};

function ordenarHallazgos(hallazgos: HallazgoConfiguracion[]): HallazgoConfiguracion[] {
  return [...hallazgos].sort((a, b) => {
    const porArchivo = PRIORIDAD_ARCHIVO[a.archivo] - PRIORIDAD_ARCHIVO[b.archivo];
    if (porArchivo !== 0) return porArchivo;
    const porFila = (a.item?.fila ?? 0) - (b.item?.fila ?? 0);
    if (porFila !== 0) return porFila;
    return a.tipo.localeCompare(b.tipo);
  });
}

function resumir(
  hallazgos: HallazgoConfiguracion[],
  cruce: { codsCompartidos: number; soloEnReferencia: number; soloEnObjetivo: number }
): ResumenComparacion {
  const porTipo: Partial<Record<TipoHallazgo, number>> = {};
  let errores = 0;
  let advertencias = 0;
  let informativos = 0;

  for (const hallazgo of hallazgos) {
    porTipo[hallazgo.tipo] = (porTipo[hallazgo.tipo] ?? 0) + 1;
    if (hallazgo.severidad === "error") errores++;
    else if (hallazgo.severidad === "warning") advertencias++;
    else informativos++;
  }

  return {
    errores,
    advertencias,
    informativos,
    porTipo,
    codsCompartidos: cruce.codsCompartidos,
    soloEnReferencia: cruce.soloEnReferencia,
    soloEnObjetivo: cruce.soloEnObjetivo,
    // Los errores propios de la referencia no bloquean al objetivo: son
    // defectos del producto ya autorizado, útiles como aviso pero ajenos a
    // lo que se está por enviar a Validaciones.
    sinErroresBloqueantes: !hallazgos.some((h) => h.severidad === "error" && h.archivo !== "referencia"),
  };
}

/**
 * Corre las cinco validaciones sobre dos configuraciones ya parseadas.
 * Es el punto de entrada que usan los tests, con casos sintéticos.
 */
export function compararConfiguraciones(
  referencia: ConfiguracionParseada,
  objetivo: ConfiguracionParseada
): ComparisonReport {
  // La referencia define qué se considera normal: su vocabulario de Tipo
  // Dato y sus saltos de cadena son la línea base contra la que se mide el
  // objetivo. Por eso se relevan antes de validar.
  const vocabularioReferencia = vocabularioTipoDato(referencia);
  const patronesCadena = relevarPatronesCadena(referencia);

  const cruce = cruzarArchivos(referencia, objetivo);

  const hallazgos = [
    // 1 — Integridad de la cadena
    ...validarCadena(referencia, "referencia"),
    ...validarCadena(objetivo, "objetivo", patronesCadena),
    // 2 — Numeración
    ...validarNumeracion(referencia, "referencia"),
    ...validarNumeracion(objetivo, "objetivo"),
    // 3 — Columnas (el vocabulario sólo se exige al objetivo: lo define la referencia)
    ...validarColumnas(referencia, "referencia"),
    ...validarColumnas(objetivo, "objetivo", vocabularioReferencia),
    // 4 — Consistencia interna y cruce por Cod.
    ...validarCodsDuplicados(referencia, "referencia"),
    ...validarCodsDuplicados(objetivo, "objetivo"),
    // 4a y 5 — Cruce y diff estructural
    ...cruce.hallazgos,
  ];

  const vocabularioObjetivo = vocabularioTipoDatoLegible(objetivo);

  return {
    generadoEn: new Date().toISOString(),
    referencia: referencia.metadatos,
    objetivo: objetivo.metadatos,
    hallazgos: ordenarHallazgos(hallazgos),
    resumen: resumir(hallazgos, cruce),
    vocabularioTipoDato: {
      referencia: vocabularioTipoDatoLegible(referencia),
      objetivo: vocabularioObjetivo,
      soloEnObjetivo: vocabularioObjetivo.filter((tipo) => !vocabularioReferencia.has(normalizarClave(tipo))),
    },
  };
}

/** Compara dos hojas ya leídas como matriz de celdas. */
export function compararMatrices(
  matrizReferencia: CeldaCruda[][],
  matrizObjetivo: CeldaCruda[][],
  opciones: OpcionesComparacion = {}
): ComparisonReport {
  return compararConfiguraciones(
    parsearConfiguracion(matrizReferencia, opciones.nombreReferencia),
    parsearConfiguracion(matrizObjetivo, opciones.nombreObjetivo)
  );
}

/**
 * Punto de entrada principal: recibe los dos .xlsx/.xlsm como Buffer y
 * devuelve el informe completo.
 */
export function compareConfigurations(
  referenceBuffer: Buffer,
  targetBuffer: Buffer,
  opciones: OpcionesComparacion = {}
): ComparisonReport {
  return compararMatrices(leerMatriz(referenceBuffer), leerMatriz(targetBuffer), opciones);
}

export { leerMatriz, parsearConfiguracion } from "./parser";
