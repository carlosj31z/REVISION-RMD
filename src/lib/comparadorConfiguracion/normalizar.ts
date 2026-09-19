// Normalización de celdas del Excel de Configuración.
//
// La hoja viene de un export del sistema digital y las mismas columnas
// llegan a veces como número y a veces como texto (un Cod. puede venir como
// 108234 o como "108234"), con espacios de más, con saltos de línea
// codificados (_x000D_) y con espacios duros. Todo lo que se compare tiene
// que pasar por acá primero, o la comparación falla por formato y no por
// contenido.

/** Valor crudo tal como lo entrega la librería de Excel. */
export type CeldaCruda = string | number | boolean | Date | null | undefined;

/**
 * Texto legible de una celda: sin los escapes de salto de línea que deja el
 * export, sin espacios duros y con los espacios múltiples colapsados.
 * Conserva mayúsculas y tildes — el texto se muestra tal cual en la UI.
 */
export function normalizarTexto(valor: CeldaCruda): string {
  if (valor === null || valor === undefined) return "";
  if (valor instanceof Date) return valor.toISOString();
  return String(valor)
    .replace(/_x000[dD]_/g, " ") // retorno de carro escapado por el export
    .replace(/ /g, " ") // espacio duro
    .replace(/\s+/g, " ")
    .trim();
}

/** Igual que normalizarTexto pero sin tildes y en minúsculas: para comparar etiquetas. */
export function normalizarClave(valor: CeldaCruda): string {
  return normalizarTexto(valor)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // marcas diacríticas que deja NFD
    .toLowerCase();
}

/**
 * Un Cod. o un Depende listo para comparar. El mismo identificador puede
 * llegar como número (108234) o como texto ("108234", " 108234 ",
 * "108234.0" cuando Excel lo guardó como decimal) — todas esas formas tienen
 * que colapsar al mismo string o la cadena Depende → Cod. se rompe sola.
 */
export function normalizarCodigo(valor: CeldaCruda): string {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "number") {
    return Number.isFinite(valor) ? String(valor) : "";
  }
  const texto = normalizarTexto(valor).replace(/\s+/g, "");
  // "108234.0" / "108234,00" → "108234": es el mismo identificador.
  const soloDecimalesCero = /^(\d+)[.,]0+$/.exec(texto);
  return soloDecimalesCero ? soloDecimalesCero[1] : texto;
}

/**
 * El Orden ("6.4.31.5", o "1" en las subsecciones cortas). Excel devuelve
 * los de un solo nivel como número, así que hay que re-textualizarlos.
 */
export function normalizarOrden(valor: CeldaCruda): string {
  if (typeof valor === "number" && Number.isInteger(valor)) return String(valor);
  return normalizarTexto(valor).replace(/\s+/g, "");
}

/** Los números del Orden: "6.4.31.5" → [6,4,31,5]. Vacío si no es un Orden numérico. */
export function segmentosDeOrden(orden: string): number[] {
  if (!/^\d+(\.\d+)*$/.test(orden)) return [];
  return orden.split(".").map((s) => Number(s));
}

/** El Orden del padre: "6.4.31.5" → "6.4.31". Vacío si es de un solo nivel. */
export function ordenPadre(orden: string): string {
  const punto = orden.lastIndexOf(".");
  return punto === -1 ? "" : orden.slice(0, punto);
}

/**
 * Val. Inicial / Val. Final como número, para poder verificar que el rango
 * no esté invertido. Acepta coma decimal (la planta trabaja con locale
 * es-PE) y separador de miles. Devuelve null si no es un número.
 */
export function aNumero(valor: CeldaCruda): number | null {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  const texto = normalizarTexto(valor).replace(/\s+/g, "");
  if (!texto) return null;
  // "1.234,56" (miles con punto) vs "1234.56" (decimal con punto).
  const conComaDecimal = /^-?\d{1,3}(\.\d{3})*,\d+$/.test(texto);
  const candidato = conComaDecimal
    ? texto.replace(/\./g, "").replace(",", ".")
    : texto.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(candidato)) return null;
  const numero = Number(candidato);
  return Number.isFinite(numero) ? numero : null;
}
