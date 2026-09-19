import type {
  ArchivoAfectado,
  DetalleHallazgo,
  HallazgoConfiguracion,
  ItemConfiguracion,
  SeveridadHallazgo,
  TipoHallazgo,
  UbicacionItem,
} from "@/types/configuracion";

/** Severidad por defecto de cada clase de hallazgo. */
const SEVERIDAD_POR_TIPO: Record<TipoHallazgo, SeveridadHallazgo> = {
  enlace_roto: "error",
  item_huerfano: "warning",
  rama_valida: "info",
  numeracion_salto: "error",
  numeracion_duplicada: "error",
  rango_incompleto: "error",
  rango_invertido: "error",
  decimales_faltantes: "error",
  valores_en_tipo_no_rango: "error",
  tipo_dato_desconocido: "warning",
  atributos_difieren: "warning",
  cod_duplicado_inconsistente: "warning",
  item_solo_en_referencia: "info",
  item_solo_en_objetivo: "info",
};

export function aUbicacion(item: ItemConfiguracion): UbicacionItem {
  return {
    fila: item.fila,
    seccion: item.seccion,
    orden: item.orden,
    cod: item.cod,
    descripcion: item.descripcion,
    esProcesoMenor: item.esProcesoMenor,
  };
}

/** Etiqueta corta de un ítem para los mensajes: "6.4.7 (Cod. 157075)". */
export function etiquetaItem(item: ItemConfiguracion | UbicacionItem): string {
  const orden = item.orden || "sin Orden";
  return item.cod ? `${orden} (Cod. ${item.cod})` : orden;
}

/**
 * Cómo se nombra un ítem al que otro mensaje hace referencia. Las
 * subsecciones cortas numeran 1, 2, 3… y reinician, así que un Orden de un
 * solo nivel no ubica nada por sí mismo: se le agrega la sección.
 */
export function referenciaItem(item: ItemConfiguracion): string {
  if (!item.orden) return `fila ${item.fila}`;
  if (item.ordenSegmentos.length === 1 && item.seccion) return `${item.orden} de ${item.seccion}`;
  return item.orden;
}

interface EntradaHallazgo {
  tipo: TipoHallazgo;
  archivo: ArchivoAfectado;
  item: ItemConfiguracion | null;
  mensaje: string;
  itemRelacionado?: ItemConfiguracion;
  detalle?: DetalleHallazgo;
  /** Sobrescribe la severidad por defecto (ej. un patrón ya aceptado en la referencia). */
  severidad?: SeveridadHallazgo;
  /** Distingue dos hallazgos del mismo tipo sobre el mismo ítem. */
  sufijoId?: string;
}

export function crearHallazgo(entrada: EntradaHallazgo): HallazgoConfiguracion {
  const { tipo, archivo, item, mensaje, itemRelacionado, detalle, severidad, sufijoId } = entrada;
  const id = [tipo, archivo, item ? item.orden || `fila${item.fila}` : "general", item?.cod ?? "", sufijoId ?? ""]
    .filter((parte) => parte !== "")
    .join(":");

  return {
    id,
    tipo,
    severidad: severidad ?? SEVERIDAD_POR_TIPO[tipo],
    archivo,
    seccion: item?.seccion ?? null,
    item: item ? aUbicacion(item) : null,
    ...(itemRelacionado ? { itemRelacionado: aUbicacion(itemRelacionado) } : {}),
    mensaje,
    ...(detalle ? { detalle } : {}),
  };
}
