// Constructor de hojas "Configuración" sintéticas para los tests.
//
// El núcleo del comparador trabaja sobre una matriz de celdas, no sobre un
// archivo, así que los casos se arman en código: no hace falta versionar
// .xlsx binarios y cada caso se lee como lo que prueba.
//
// La disposición imita al export real: metadatos en C/D de las filas 2 a 5,
// encabezados en la fila 7, datos desde la fila 8, y el título de sección en
// la columna A.

import type { CeldaCruda } from "../normalizar";

export const ENCABEZADOS = [
  "#",
  "Orden",
  "Depende",
  "Cod.",
  "Descripción",
  "Tipo Dato",
  "Proc. Menor Opcional",
  "Val. Inicial",
  "Val. Final",
  "# Decimales",
  "Flag CC",
  "Flag Mov",
];

/** Primera fila de datos en el Excel: metadatos 2-5, encabezados 7. */
export const PRIMERA_FILA_DATOS = 8;

export interface CampoSpec {
  orden: string | number;
  /** Cod. del predecesor. Se omite en los Proceso Menor y en el primer ítem. */
  depende?: string | number;
  cod: string | number;
  descripcion?: string;
  tipoDato?: string;
  valInicial?: string | number;
  valFinal?: string | number;
  decimales?: string | number;
}

export interface SeccionSpec {
  seccion: string;
}

export type FilaSpec = CampoSpec | SeccionSpec;

export interface MetadatosSpec {
  codigoRM?: string;
  descripcion?: string;
  estado?: string;
  etapa?: string;
}

function esSeccion(fila: FilaSpec): fila is SeccionSpec {
  return "seccion" in fila;
}

/** Dónde cae en el Excel la fila de datos número `indice` (0-indexado). */
export function filaExcel(indice: number): number {
  return PRIMERA_FILA_DATOS + indice;
}

export function construirMatriz(filas: FilaSpec[], metadatos: MetadatosSpec = {}): CeldaCruda[][] {
  const {
    codigoRM = "2202608952",
    descripcion = "PRODUCTO DE PRUEBA 10mg TAB",
    estado = "Autorizado",
    etapa = "FABRICACION",
  } = metadatos;

  const matriz: CeldaCruda[][] = [
    [], // fila 1
    ["", "", "Código R.M:", codigoRM],
    ["", "", "Descripción:", descripcion],
    ["", "", "Estado:", estado],
    ["", "", "Etapa:", etapa],
    [], // fila 6
    ENCABEZADOS,
  ];

  for (const fila of filas) {
    if (esSeccion(fila)) {
      matriz.push([fila.seccion, "", "", "", "", "", "", "", "", "", "", ""]);
      continue;
    }
    matriz.push([
      "",
      fila.orden,
      fila.depende ?? "",
      fila.cod,
      fila.descripcion ?? "",
      fila.tipoDato ?? "Sin tipo de dato",
      "",
      fila.valInicial ?? "",
      fila.valFinal ?? "",
      fila.decimales ?? "",
      "NO",
      "NO",
    ]);
  }

  return matriz;
}

/**
 * Configuración base limpia: no dispara ningún hallazgo. Cada caso de prueba
 * arranca de acá y cambia sólo lo que quiere probar, para que el hallazgo
 * esperado no se confunda con ruido de fondo.
 *
 * La cadena es 100 → 101 → 200 → 201 → 202 → 203, y los dos Proceso Menor
 * (300 bajo 6.1.2, 301 bajo 6.1.3) quedan fuera de la cadena a propósito.
 */
export function filasBase(): FilaSpec[] {
  return [
    { seccion: "PRECAUCIONES" },
    { orden: 1, cod: 100, descripcion: "USAR EL UNIFORME COMPLETO", tipoDato: "Verificación Check" },
    { orden: 2, depende: 100, cod: 101, descripcion: "CONTROLAR QUE SUS COMPAÑEROS LO HAGAN", tipoDato: "Verificación Check" },
    { seccion: "PROCEDIMIENTO-FABRICACION" },
    { orden: "6.1.1", depende: 101, cod: 200, descripcion: "FECHA / HORA INICIO :", tipoDato: "Fecha y Hora" },
    { orden: "6.1.2", depende: 200, cod: 201, descripcion: "PESAR EL PRINCIPIO ACTIVO", tipoDato: "Realizado por" },
    { orden: "6.1.2.1", cod: 300, descripcion: "Proceso Menor: PESO OBTENIDO (kg):", tipoDato: "Números", decimales: 3 },
    { orden: "6.1.3", depende: 201, cod: 202, descripcion: "CONDICIONES AMBIENTALES:", tipoDato: "Realizado por" },
    { orden: "6.1.3.1", cod: 301, descripcion: "Proceso Menor: TEMPERATURA (15 °C - 25 °C):", tipoDato: "Rango", valInicial: 15, valFinal: 25, decimales: 1 },
    { orden: "6.1.4", depende: 202, cod: 203, descripcion: "FECHA / HORA FINAL:", tipoDato: "Fecha y Hora" },
  ];
}

/** Índice (0-indexado) de cada fila de datos de filasBase(), para poder mutarla. */
export const BASE = {
  precauciones: 0,
  precaucion1: 1,
  precaucion2: 2,
  seccionFabricacion: 3,
  horaInicio: 4,
  pesar: 5,
  pesoObtenido: 6,
  condiciones: 7,
  temperatura: 8,
  horaFinal: 9,
} as const;
