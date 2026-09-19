// Normalización y similitud de texto para comparar dos RMD.
//
// Dos criterios distintos, a propósito:
//
//  * Para decidir si dos pasos dicen LO MISMO se normalizan mayúsculas,
//    tildes y espacios, pero NO la puntuación. Es la misma política que ya
//    tiene el proyecto: mayúsculas y tildes nunca cuentan como falla de
//    redacción, pero "puntuación que cambia el sentido" sí.
//
//  * Para decidir si dos pasos HABLAN DE LO MISMO (emparejar un paso
//    renumerado con su equivalente) se compara por palabras, ignorando
//    puntuación y orden. Ahí lo que importa es el contenido, no la forma.

/** Texto comparable: sin tildes, en mayúsculas, con espacios colapsados. */
export function normalizarParaComparar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function textosEquivalentes(a: string, b: string): boolean {
  return normalizarParaComparar(a) === normalizarParaComparar(b);
}

/** Palabras significativas del texto, para medir de qué habla. */
export function palabras(texto: string): Set<string> {
  const limpio = normalizarParaComparar(texto).replace(/[^A-Z0-9ÑÜ ]+/g, " ");
  return new Set(limpio.split(/\s+/).filter((p) => p.length > 1));
}

/**
 * Coeficiente de Dice sobre los conjuntos de palabras: 1 = mismas palabras,
 * 0 = ninguna en común.
 *
 * Se eligió esto y no una distancia de edición (Levenshtein) por costo: los
 * pasos sin pareja por id pueden ser decenas en cada documento, y comparar
 * todos contra todos con Levenshtein sobre textos de cientos de caracteres
 * es cuadrático sobre cuadrático. Con conjuntos de palabras cada comparación
 * es lineal, y para "¿es este el mismo paso con otro número?" alcanza de
 * sobra.
 */
export function similitud(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let comunes = 0;
  const [chico, grande] = a.size <= b.size ? [a, b] : [b, a];
  for (const palabra of chico) if (grande.has(palabra)) comunes++;
  return (2 * comunes) / (a.size + b.size);
}

export function similitudTextos(a: string, b: string): number {
  return similitud(palabras(a), palabras(b));
}

/**
 * Posiciones que NO forman parte de la subsecuencia creciente más larga:
 * son las que están fuera de orden respecto del otro documento.
 *
 * Se le pasa, para cada elemento común en el orden del documento A, la
 * posición que ese mismo elemento tiene en el documento B. Si esas
 * posiciones ya vienen crecientes, los dos documentos llevan el mismo orden
 * y no hay nada que reportar.
 */
export function indicesFueraDeOrden(posicionesEnB: number[]): Set<number> {
  const n = posicionesEnB.length;
  if (n === 0) return new Set();

  // Subsecuencia creciente más larga por "paciencia", O(n log n), guardando
  // predecesores para poder reconstruirla.
  const colas: number[] = []; // índice del último elemento de cada montón
  const previo = new Array<number>(n).fill(-1);

  for (let i = 0; i < n; i++) {
    let bajo = 0;
    let alto = colas.length;
    while (bajo < alto) {
      const medio = (bajo + alto) >> 1;
      if (posicionesEnB[colas[medio]] < posicionesEnB[i]) bajo = medio + 1;
      else alto = medio;
    }
    if (bajo > 0) previo[i] = colas[bajo - 1];
    colas[bajo] = i;
  }

  const enOrden = new Set<number>();
  let cursor = colas.length > 0 ? colas[colas.length - 1] : -1;
  while (cursor !== -1) {
    enOrden.add(cursor);
    cursor = previo[cursor];
  }

  const fuera = new Set<number>();
  for (let i = 0; i < n; i++) if (!enOrden.has(i)) fuera.add(i);
  return fuera;
}

/**
 * Palabras que no distinguen a un equipo o insumo de otro: sirven para armar
 * la frase pero no para reconocerlo dentro de un texto.
 */
const PALABRAS_GENERICAS = new Set([
  "DEL",
  "LAS",
  "LOS",
  "UNA",
  "CON",
  "PARA",
  "POR",
  "SEGUN",
  "MODELO",
  "TIPO",
  "MARCA",
  "NRO",
  "NUMERO",
]);

/** Las palabras con las que se puede reconocer algo dentro de un texto. */
export function palabrasDistintivas(texto: string): string[] {
  return normalizarParaComparar(texto)
    .replace(/[^A-Z0-9ÑÜ ]+/g, " ")
    .split(/\s+/)
    .filter((palabra) => palabra.length >= 3 && !PALABRAS_GENERICAS.has(palabra));
}

/**
 * Qué proporción de las palabras de `aguja` aparecen en `pajar`.
 *
 * Se usa contención y no una similitud simétrica porque los dos lados tienen
 * tamaños muy distintos: el nombre de un equipo contra el texto de un paso.
 * Dice daría siempre un valor bajo aunque el equipo esté claramente
 * mencionado.
 */
export function contencion(aguja: string[], pajar: Set<string>): number {
  if (aguja.length === 0) return 0;
  let presentes = 0;
  for (const palabra of aguja) if (pajar.has(palabra)) presentes++;
  return presentes / aguja.length;
}
