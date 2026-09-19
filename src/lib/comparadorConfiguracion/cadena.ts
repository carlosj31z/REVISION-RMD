import type {
  ArchivoAfectado,
  ConfiguracionParseada,
  HallazgoConfiguracion,
  ItemConfiguracion,
} from "@/types/configuracion";
import { crearHallazgo, etiquetaItem, referenciaItem } from "./hallazgos";

// Validación 1 — Integridad de la cadena Depende → Cod.
//
// El Depende de un ítem apunta al Cod. del ítem que debe completarse justo
// antes: es una lista enlazada que define el orden real de ejecución del
// registro digital, distinto del orden de filas de la hoja. Sólo participan
// de la cadena las filas con Depende no vacío — los Proceso Menor y las
// filas puramente informativas quedan fuera por diseño.

interface EslabonCadena {
  item: ItemConfiguracion;
  /** Índice dentro de items[] — identifica la posición, no el código. */
  indice: number;
  /** Índice del ítem al que resuelve su Depende, o null si no resuelve. */
  destino: number | null;
}

/**
 * Un Cod. NO es único dentro de un archivo: el mismo campo del sistema
 * (ej. "HUMEDAD RELATIVA") se reutiliza en varias etapas del registro. Por
 * eso un Depende se resuelve a la aparición ANTERIOR MÁS CERCANA de ese
 * Cod., que es la que el sistema digital toma como predecesor real.
 */
function resolverDepende(
  posicionesPorCod: Map<string, number[]>,
  depende: string,
  indiceActual: number
): number | null {
  const posiciones = posicionesPorCod.get(depende);
  if (!posiciones) return null;
  let destino: number | null = null;
  for (const posicion of posiciones) {
    if (posicion >= indiceActual) break;
    destino = posicion;
  }
  return destino;
}

function construirCadena(items: ItemConfiguracion[]): EslabonCadena[] {
  const posicionesPorCod = new Map<string, number[]>();
  items.forEach((item, indice) => {
    if (!item.cod) return;
    const posiciones = posicionesPorCod.get(item.cod);
    if (posiciones) posiciones.push(indice);
    else posicionesPorCod.set(item.cod, [indice]);
  });

  return items
    .map((item, indice) => ({ item, indice }))
    .filter(({ item }) => item.depende !== "")
    .map(({ item, indice }) => ({
      item,
      indice,
      destino: resolverDepende(posicionesPorCod, item.depende, indice),
    }));
}

/**
 * Claves con las que se reconoce una no-adyacencia concreta. Se emiten dos
 * porque entre dos productos puede cambiar la numeración (Orden) sin que
 * cambie el campo (Cod.), o al revés.
 */
function clavesPatron(item: ItemConfiguracion): string[] {
  return [`orden:${item.orden}->${item.depende}`, `cod:${item.cod}->${item.depende}`];
}

/**
 * Releva las no-adyacencias que la referencia ya tiene y que, por venir de
 * un producto autorizado, se dan por buenas. Sirven de línea base para no
 * volver a marcarlas como advertencia en el archivo objetivo.
 */
export function relevarPatronesCadena(config: ConfiguracionParseada): Set<string> {
  const cadena = construirCadena(config.items);
  const patrones = new Set<string>();
  for (let i = 1; i < cadena.length; i++) {
    const actual = cadena[i];
    const anterior = cadena[i - 1];
    // Un enlace roto nunca es patrón aceptado: es un defecto de la
    // referencia, y copiarlo al objetivo tampoco lo vuelve correcto.
    if (actual.item.depende === anterior.item.cod || actual.destino === null) continue;
    for (const clave of clavesPatron(actual.item)) patrones.add(clave);
  }
  return patrones;
}

export function validarCadena(
  config: ConfiguracionParseada,
  archivo: ArchivoAfectado,
  patronesAceptados: Set<string> = new Set()
): HallazgoConfiguracion[] {
  const { items } = config;
  const cadena = construirCadena(items);
  if (cadena.length === 0) return [];

  // Un ítem está referenciado si algún Depende resuelve a SU posición (no
  // sólo a su código): con códigos repetidos, la posición es lo único que
  // distingue la ocurrencia que realmente quedó enlazada.
  const referenciados = new Set<number>();
  for (const eslabon of cadena) {
    if (eslabon.destino !== null) referenciados.add(eslabon.destino);
  }

  const existeEnAlgunLado = new Set(items.map((i) => i.cod).filter(Boolean));
  const hallazgos: HallazgoConfiguracion[] = [];

  for (let i = 0; i < cadena.length; i++) {
    const { item, destino } = cadena[i];
    const anterior = i > 0 ? cadena[i - 1].item : null;

    if (anterior && item.depende === anterior.cod) continue; // adyacencia esperada
    if (!anterior && destino !== null) continue; // primer eslabón, con predecesor válido

    // --- Caso 1: el Depende no resuelve a ningún ítem anterior ---
    if (destino === null) {
      const apuntaHaciaAdelante = existeEnAlgunLado.has(item.depende);
      const motivo = apuntaHaciaAdelante
        ? `el Cod. ${item.depende} existe en el archivo pero recién más abajo, así que no puede ser su predecesor`
        : `el Cod. ${item.depende} no existe en ningún ítem del archivo`;
      const consecuencia = anterior
        ? ` Según la secuencia debería depender del Cod. ${anterior.cod} (ítem ${referenciaItem(anterior)}), que queda huérfano: ningún ítem posterior lo referencia.`
        : "";

      hallazgos.push(
        crearHallazgo({
          tipo: "enlace_roto",
          archivo,
          item,
          ...(anterior ? { itemRelacionado: anterior } : {}),
          mensaje:
            `Enlace roto en ${etiquetaItem(item)}: depende del Cod. ${item.depende}, pero ${motivo}.` +
            consecuencia,
          detalle: {
            campo: "Depende",
            dependeActual: item.depende,
            ...(anterior ? { dependeEsperado: anterior.cod } : {}),
          },
        })
      );
      continue;
    }

    if (!anterior) continue;

    // --- Caso 2: branch-back (el Depende sí existe antes, pero no es el inmediato) ---
    const itemDestino = items[destino];
    const anteriorQuedaHuerfano = !referenciados.has(cadena[i - 1].indice);
    const esPatronAceptado = clavesPatron(item).some((clave) => patronesAceptados.has(clave));

    if (!anteriorQuedaHuerfano) {
      hallazgos.push(
        crearHallazgo({
          tipo: "rama_valida",
          archivo,
          item,
          itemRelacionado: itemDestino,
          mensaje:
            `${etiquetaItem(item)} retoma el Cod. ${item.depende} (ítem ${referenciaItem(itemDestino)}) en vez del ítem ` +
            `inmediatamente anterior ${etiquetaItem(anterior)}. Es una rama válida: el ítem anterior sigue ` +
            `referenciado por otro ítem, así que nadie queda fuera de la secuencia.`,
          detalle: { campo: "Depende", dependeActual: item.depende, dependeEsperado: anterior.cod },
        })
      );
      continue;
    }

    const notaPatron = esPatronAceptado
      ? " El archivo de referencia tiene exactamente el mismo salto en esta posición, así que es el patrón esperado del registro."
      : " Verificá si el salto es intencional (inicio de subsección que retoma un punto de control común) o si al ítem anterior le falta quien lo referencie.";

    hallazgos.push(
      crearHallazgo({
        tipo: "item_huerfano",
        archivo,
        item,
        itemRelacionado: anterior,
        severidad: esPatronAceptado ? "info" : undefined,
        mensaje:
          `${etiquetaItem(item)} depende del Cod. ${item.depende} (ítem ${referenciaItem(itemDestino)}), que existe antes ` +
          `pero no es el ítem inmediatamente anterior. Eso deja a ${etiquetaItem(anterior)} fuera de la ` +
          `secuencia: ningún ítem lo referencia como Depende.` +
          notaPatron,
        detalle: { campo: "Depende", dependeActual: item.depende, dependeEsperado: anterior.cod },
      })
    );
  }

  return hallazgos;
}
