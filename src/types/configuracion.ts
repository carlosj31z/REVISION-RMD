// ============================================================
// Tipos del comparador de configuraciones de RMD
// ============================================================
// El archivo de "Configuración" es el export del sistema digital para un
// producto: una hoja con la lista completa de campos del registro, el orden
// en que se ejecutan (cadena Depende → Cod.) y cómo se captura cada dato.
//
// Este módulo es 100% determinístico: no interviene ningún modelo de IA.
// Todo hallazgo sale de comparar celdas y reconstruir la cadena.

export type SeveridadHallazgo = "error" | "warning" | "info";

/**
 * A qué archivo pertenece la fila de `item`. "ambos" es un hallazgo cruzado:
 * ahí `item` es el del archivo objetivo y `itemRelacionado` el de la referencia.
 */
export type ArchivoAfectado = "referencia" | "objetivo" | "ambos";

export type TipoHallazgo =
  // 1 — Integridad de la cadena Depende → Cod.
  | "enlace_roto" //                  error:   Depende apunta a un Cod. que no existe antes
  | "item_huerfano" //                warning: un ítem quedó fuera de la secuencia
  | "rama_valida" //                  info:    branch-back a un Cod. anterior existente
  // 2 — Numeración (columna Orden)
  | "numeracion_salto" //             error:   falta un número en la secuencia del nivel
  | "numeracion_duplicada" //         error:   dos ítems con el mismo Orden en el nivel
  // 3 — Columnas Tipo Dato / Val. Inicial / Val. Final / # Decimales
  | "rango_incompleto" //             error:   Rango sin Val. Inicial y/o Val. Final válidos
  | "rango_invertido" //              error:   Val. Inicial >= Val. Final
  | "decimales_faltantes" //          error:   Rango o Números sin # Decimales
  | "valores_en_tipo_no_rango" //     error:   ini/fin cargados en un tipo que no es Rango
  | "tipo_dato_desconocido" //        warning: Tipo Dato que no aparece en la referencia
  // 4 — Cruce entre archivos / consistencia interna
  | "atributos_difieren" //           warning: mismo Cod., distintos atributos entre archivos
  | "cod_duplicado_inconsistente" //  warning: Cod. repetido en un archivo con atributos distintos
  // 5 — Diff estructural
  | "item_solo_en_referencia" //      info:    paso que el objetivo no tiene
  | "item_solo_en_objetivo"; //       info:    paso que la referencia no tiene

// ---------- Estructura parseada de la hoja "Configuración" ----------

/** Una fila de dato de la hoja (no un encabezado de sección). */
export interface ItemConfiguracion {
  /** Fila real del Excel, 1-indexada — para poder ubicarla al corregir. */
  fila: number;
  /** Encabezado de sección bajo el que cae, ej. "PROCEDIMIENTO-FABRICACION". */
  seccion: string | null;
  orden: string; // "6.4.31.5"
  /** Orden partido en números: [6,4,31,5]. Vacío si el Orden no es numérico. */
  ordenSegmentos: number[];
  /** Cod. del ítem que debe completarse justo antes. Vacío = fuera de la cadena. */
  depende: string;
  cod: string;
  descripcion: string;
  tipoDato: string;
  procMenorOpcional: string;
  valInicial: string;
  valFinal: string;
  decimales: string;
  flagCC: string;
  flagMov: string;
  /**
   * Subcampo que cuelga de un campo padre (ej. "6.4.31.5" bajo "6.4.31").
   * No participa de la cadena: no tiene Depende propio.
   */
  esProcesoMenor: boolean;
}

export interface MetadatosConfiguracion {
  codigoRM: string | null; //    "2202608952"
  descripcion: string | null; // "CORIFAN 4mg TAB"
  estado: string | null; //      "Autorizado"
  etapa: string | null; //       "FABRICACION"
  nombreArchivo: string | null;
  totalItems: number;
  totalSecciones: number;
}

export interface ConfiguracionParseada {
  metadatos: MetadatosConfiguracion;
  items: ItemConfiguracion[];
  /** Encabezados de sección en el orden en que aparecen en la hoja. */
  secciones: string[];
}

// ---------- Hallazgos ----------

/** Ubicación de un ítem dentro de su archivo, para encontrarlo al corregir. */
export interface UbicacionItem {
  fila: number;
  seccion: string | null;
  orden: string;
  cod: string;
  descripcion: string;
  esProcesoMenor: boolean;
}

export interface DetalleHallazgo {
  /** Columna involucrada, ej. "Tipo Dato", "Val. Inicial", "# Decimales". */
  campo?: string;
  dependeActual?: string;
  /** Qué Depende correspondería según la adyacencia esperada. */
  dependeEsperado?: string;
  valorReferencia?: string;
  valorObjetivo?: string;
}

export interface HallazgoConfiguracion {
  /** Estable entre corridas: permite deduplicar o hacer seguimiento por hallazgo. */
  id: string;
  tipo: TipoHallazgo;
  severidad: SeveridadHallazgo;
  archivo: ArchivoAfectado;
  seccion: string | null;
  /** Ítem afectado. Null en hallazgos que no apuntan a una fila concreta. */
  item: UbicacionItem | null;
  /** El ítem que queda huérfano, o el par del mismo Cod. en el otro archivo. */
  itemRelacionado?: UbicacionItem;
  /** Mensaje autoexplicativo en español, listo para mostrar en la UI. */
  mensaje: string;
  detalle?: DetalleHallazgo;
}

export interface ResumenComparacion {
  errores: number;
  advertencias: number;
  informativos: number;
  porTipo: Partial<Record<TipoHallazgo, number>>;
  codsCompartidos: number;
  soloEnReferencia: number;
  soloEnObjetivo: number;
  /**
   * True cuando no hay ningún error atribuible al archivo objetivo. Los
   * errores propios de la referencia se informan igual (y cuentan en
   * `errores`) pero no bloquean: son defectos del producto ya autorizado.
   */
  sinErroresBloqueantes: boolean;
}

export interface ComparisonReport {
  generadoEn: string; // ISO 8601
  referencia: MetadatosConfiguracion;
  objetivo: MetadatosConfiguracion;
  /** Ordenados: objetivo → cruzados → referencia, y dentro de cada grupo por fila. */
  hallazgos: HallazgoConfiguracion[];
  resumen: ResumenComparacion;
  vocabularioTipoDato: {
    referencia: string[];
    objetivo: string[];
    /** Los sospechosos de tipeo o de tipo inventado. */
    soloEnObjetivo: string[];
  };
}
