import * as XLSX from "xlsx";
import type { ConfiguracionParseada, ItemConfiguracion } from "@/types/configuracion";
import {
  normalizarClave,
  normalizarCodigo,
  normalizarOrden,
  normalizarTexto,
  ordenPadre,
  segmentosDeOrden,
  type CeldaCruda,
} from "./normalizar";

const HOJA_ESPERADA = "Configuración";

/** Cada columna de la fila de encabezados, ya identificada. */
type ClaveColumna =
  | "numero"
  | "orden"
  | "depende"
  | "cod"
  | "descripcion"
  | "tipoDato"
  | "procMenorOpcional"
  | "valInicial"
  | "valFinal"
  | "decimales"
  | "flagCC"
  | "flagMov";

type MapaColumnas = Partial<Record<ClaveColumna, number>>;

/**
 * Sin estas cuatro no se puede reconstruir nada: la cadena necesita Cod. y
 * Depende, y las validaciones de columnas necesitan Orden y Tipo Dato.
 */
const COLUMNAS_OBLIGATORIAS: ClaveColumna[] = ["orden", "depende", "cod", "tipoDato"];

/**
 * Identifica una columna por su encabezado. Se hace por contenido y no por
 * posición fija para que un cambio de orden de columnas en el export no
 * rompa el parseo silenciosamente (devolvería datos corridos, que es peor
 * que fallar).
 */
function identificarColumna(encabezado: string): ClaveColumna | null {
  const clave = normalizarClave(encabezado).replace(/\./g, "").trim();
  if (!clave) return null;
  if (clave === "#") return "numero";
  if (clave === "orden") return "orden";
  if (clave === "depende") return "depende";
  if (clave === "cod" || clave === "codigo") return "cod";
  if (clave === "descripcion") return "descripcion";
  if (clave.startsWith("tipo dato") || clave.startsWith("tipo de dato")) return "tipoDato";
  if (clave.includes("menor")) return "procMenorOpcional";
  if (clave.startsWith("val inicial") || clave.startsWith("valor inicial")) return "valInicial";
  if (clave.startsWith("val final") || clave.startsWith("valor final")) return "valFinal";
  if (clave.includes("decimales")) return "decimales";
  if (clave.startsWith("flag cc")) return "flagCC";
  if (clave.startsWith("flag mov")) return "flagMov";
  return null;
}

function detectarEncabezado(
  matriz: CeldaCruda[][]
): { fila: number; columnas: MapaColumnas } | null {
  const limite = Math.min(30, matriz.length);
  for (let f = 0; f < limite; f++) {
    const fila = matriz[f];
    if (!fila) continue;
    const columnas: MapaColumnas = {};
    for (let c = 0; c < fila.length; c++) {
      const clave = identificarColumna(normalizarTexto(fila[c]));
      // La primera aparición gana: si el export repitiera un encabezado, la
      // columna de la izquierda es la real.
      if (clave && columnas[clave] === undefined) columnas[clave] = c;
    }
    if (COLUMNAS_OBLIGATORIAS.every((k) => columnas[k] !== undefined)) {
      return { fila: f, columnas };
    }
  }
  return null;
}

/**
 * Metadatos del bloque superior (Código R.M / Descripción / Estado / Etapa).
 * Se busca la etiqueta en cualquier columna por encima del encabezado y se
 * toma el primer valor no vacío a su derecha, en vez de leer C/D fijo.
 */
function extraerMetadatos(matriz: CeldaCruda[][], filaEncabezado: number) {
  const metadatos = {
    codigoRM: null as string | null,
    descripcion: null as string | null,
    estado: null as string | null,
    etapa: null as string | null,
  };

  for (let f = 0; f < filaEncabezado; f++) {
    const fila = matriz[f];
    if (!fila) continue;
    for (let c = 0; c < fila.length; c++) {
      const etiqueta = normalizarClave(fila[c]).replace(/:\s*$/, "").trim();
      if (!etiqueta) continue;
      let destino: keyof typeof metadatos | null = null;
      if (etiqueta.startsWith("codigo r")) destino = "codigoRM";
      else if (etiqueta === "descripcion") destino = "descripcion";
      else if (etiqueta === "estado") destino = "estado";
      else if (etiqueta === "etapa") destino = "etapa";
      if (!destino || metadatos[destino] !== null) continue;

      for (let siguiente = c + 1; siguiente < fila.length; siguiente++) {
        const valor = normalizarTexto(fila[siguiente]);
        if (valor) {
          metadatos[destino] = valor;
          break;
        }
      }
    }
  }
  return metadatos;
}

interface FilaCruda {
  fila: number;
  orden: string;
  cod: string;
  celdas: CeldaCruda[];
  primerTexto: string;
}

function leerCelda(fila: CeldaCruda[], indice: number | undefined): CeldaCruda {
  return indice === undefined ? "" : fila[indice];
}

/**
 * Convierte la matriz de celdas en la lista de campos del registro.
 *
 * Se distinguen dos clases de fila: el encabezado de sección (sin Cod. y sin
 * Orden numérico — el texto puede venir en la columna "#" o en "Orden" según
 * la versión del export) y el campo real. Las filas vacías se descartan.
 */
export function parsearConfiguracion(
  matriz: CeldaCruda[][],
  nombreArchivo?: string
): ConfiguracionParseada {
  const deteccion = detectarEncabezado(matriz);
  if (!deteccion) {
    throw new Error(
      'No se encontró la fila de encabezados de la hoja "Configuración" ' +
        "(se esperan al menos las columnas Orden, Depende, Cod. y Tipo Dato)."
    );
  }
  const { fila: filaEncabezado, columnas } = deteccion;

  // Primera pasada: separar secciones de campos y juntar todos los Orden,
  // que es lo que después permite saber qué campo es un Proceso Menor.
  const crudas: FilaCruda[] = [];
  const secciones: string[] = [];
  const seccionPorFila = new Map<number, string | null>();
  let seccionActual: string | null = null;

  for (let f = filaEncabezado + 1; f < matriz.length; f++) {
    const fila = matriz[f];
    if (!fila) continue;
    const numeroFila = f + 1; // la matriz arranca en la fila 1 del Excel

    const orden = normalizarOrden(leerCelda(fila, columnas.orden));
    const cod = normalizarCodigo(leerCelda(fila, columnas.cod));
    const primerTexto = normalizarTexto(fila.find((celda) => normalizarTexto(celda) !== ""));

    if (!primerTexto) continue; // fila completamente vacía

    // Sin Cod. y sin un Orden numérico no puede ser un campo: es el título
    // de la sección ("PRECAUCIONES", "PROCEDIMIENTO-FABRICACION", …).
    if (!cod && segmentosDeOrden(orden).length === 0) {
      seccionActual = orden || primerTexto;
      secciones.push(seccionActual);
      continue;
    }

    seccionPorFila.set(numeroFila, seccionActual);
    crudas.push({ fila: numeroFila, orden, cod, celdas: fila, primerTexto });
  }

  const ordenes = new Set(crudas.map((c) => c.orden).filter(Boolean));

  const items: ItemConfiguracion[] = crudas.map((cruda) => {
    const { celdas } = cruda;
    const descripcion = normalizarTexto(leerCelda(celdas, columnas.descripcion));
    const padre = ordenPadre(cruda.orden);
    return {
      fila: cruda.fila,
      seccion: seccionPorFila.get(cruda.fila) ?? null,
      orden: cruda.orden,
      ordenSegmentos: segmentosDeOrden(cruda.orden),
      depende: normalizarCodigo(leerCelda(celdas, columnas.depende)),
      cod: cruda.cod,
      descripcion,
      tipoDato: normalizarTexto(leerCelda(celdas, columnas.tipoDato)),
      procMenorOpcional: normalizarTexto(leerCelda(celdas, columnas.procMenorOpcional)),
      valInicial: normalizarTexto(leerCelda(celdas, columnas.valInicial)),
      valFinal: normalizarTexto(leerCelda(celdas, columnas.valFinal)),
      decimales: normalizarTexto(leerCelda(celdas, columnas.decimales)),
      flagCC: normalizarTexto(leerCelda(celdas, columnas.flagCC)),
      flagMov: normalizarTexto(leerCelda(celdas, columnas.flagMov)),
      // Es Proceso Menor si cuelga de un Orden que existe como campo
      // ("6.4.31.5" bajo "6.4.31"). El prefijo de la descripción es el
      // respaldo para cuando el padre no está en la hoja.
      esProcesoMenor:
        (padre !== "" && ordenes.has(padre)) ||
        normalizarClave(descripcion).startsWith("proceso menor"),
    };
  });

  const metadatos = extraerMetadatos(matriz, filaEncabezado);

  return {
    metadatos: {
      ...metadatos,
      nombreArchivo: nombreArchivo ?? null,
      totalItems: items.length,
      totalSecciones: secciones.length,
    },
    items,
    secciones,
  };
}

/**
 * Extrae la hoja "Configuración" de un .xlsx/.xlsm como matriz de celdas.
 * Es el único punto del módulo que conoce la librería de Excel: todo el
 * resto trabaja sobre la matriz, que es lo que permite testear con casos
 * sintéticos sin archivos binarios.
 */
export function leerMatriz(buffer: Buffer): CeldaCruda[][] {
  const libro = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const nombreHoja =
    libro.SheetNames.find((n) => normalizarClave(n) === normalizarClave(HOJA_ESPERADA)) ??
    null;
  if (!nombreHoja) {
    throw new Error(
      `El archivo no tiene ninguna hoja llamada "${HOJA_ESPERADA}" ` +
        `(hojas encontradas: ${libro.SheetNames.join(", ")}).`
    );
  }
  return XLSX.utils.sheet_to_json<CeldaCruda[]>(libro.Sheets[nombreHoja], {
    header: 1,
    raw: true,
    defval: "",
    blankrows: true, // se conservan para que el índice siga coincidiendo con la fila del Excel
  });
}
