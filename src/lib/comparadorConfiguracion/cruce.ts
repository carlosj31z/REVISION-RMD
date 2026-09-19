import type {
  ArchivoAfectado,
  ConfiguracionParseada,
  HallazgoConfiguracion,
  ItemConfiguracion,
} from "@/types/configuracion";
import { crearHallazgo } from "./hallazgos";
import { aNumero, normalizarClave } from "./normalizar";

// Validaciones 4 y 5 — Cruce por Cod. compartido y diff estructural.
//
// El Cod. es el identificador del campo en el sistema digital y se comparte
// entre productos: si el mismo Cod. está cargado distinto en un producto y
// en otro, o falta, es una diferencia que Validaciones va a preguntar.
// Nada de esto es error por sí solo — el producto en desarrollo puede
// haber cambiado a propósito — por eso son advertencias e informativos.

/** Las cuatro columnas que definen cómo se captura el dato. */
const ATRIBUTOS = [
  { campo: "Tipo Dato", leer: (i: ItemConfiguracion) => i.tipoDato },
  { campo: "Val. Inicial", leer: (i: ItemConfiguracion) => i.valInicial },
  { campo: "Val. Final", leer: (i: ItemConfiguracion) => i.valFinal },
  { campo: "# Decimales", leer: (i: ItemConfiguracion) => i.decimales },
] as const;

/**
 * Dos valores son el mismo dato aunque se escriban distinto: "15" y "15.0"
 * son el mismo extremo de rango, y "Rango" y "RANGO" el mismo tipo. Sin
 * esto el informe se llena de diferencias de formato que no son cambios.
 */
function sonEquivalentes(a: string, b: string): boolean {
  const numeroA = aNumero(a);
  const numeroB = aNumero(b);
  if (numeroA !== null && numeroB !== null) return numeroA === numeroB;
  return normalizarClave(a) === normalizarClave(b);
}

function agruparPorCod(items: ItemConfiguracion[]): Map<string, ItemConfiguracion[]> {
  const mapa = new Map<string, ItemConfiguracion[]>();
  for (const item of items) {
    if (!item.cod) continue;
    const grupo = mapa.get(item.cod);
    if (grupo) grupo.push(item);
    else mapa.set(item.cod, [item]);
  }
  return mapa;
}

function diferencias(a: ItemConfiguracion, b: ItemConfiguracion) {
  return ATRIBUTOS.filter(({ leer }) => !sonEquivalentes(leer(a), leer(b))).map(({ campo, leer }) => ({
    campo,
    valorA: leer(a),
    valorB: leer(b),
  }));
}

function mostrar(valor: string): string {
  return valor === "" ? "(vacío)" : `"${valor}"`;
}

/**
 * Validación 4b — Cod. repetido dentro de un mismo archivo con atributos
 * distintos entre sus propias apariciones. El sistema digital usa un único
 * Cod. por campo: dos definiciones distintas del mismo campo es una
 * inconsistencia interna, sin importar el otro archivo.
 */
export function validarCodsDuplicados(
  config: ConfiguracionParseada,
  archivo: ArchivoAfectado
): HallazgoConfiguracion[] {
  const hallazgos: HallazgoConfiguracion[] = [];

  for (const [cod, apariciones] of agruparPorCod(config.items)) {
    if (apariciones.length < 2) continue;
    const primera = apariciones[0];

    for (let i = 1; i < apariciones.length; i++) {
      const otra = apariciones[i];
      const difs = diferencias(primera, otra);
      if (difs.length === 0) continue;

      const detalleTexto = difs
        .map((d) => `${d.campo} (fila ${primera.fila}: ${mostrar(d.valorA)} / fila ${otra.fila}: ${mostrar(d.valorB)})`)
        .join("; ");

      hallazgos.push(
        crearHallazgo({
          tipo: "cod_duplicado_inconsistente",
          archivo,
          item: otra,
          itemRelacionado: primera,
          mensaje:
            `El Cod. ${cod} se repite en el archivo con definiciones distintas entre sus propias apariciones: ` +
            `${detalleTexto}. El mismo campo debería estar configurado igual en todas sus apariciones.`,
          detalle: { campo: difs.map((d) => d.campo).join(", ") },
          sufijoId: `fila${otra.fila}`,
        })
      );
    }
  }

  return hallazgos;
}

export interface ResultadoCruce {
  hallazgos: HallazgoConfiguracion[];
  codsCompartidos: number;
  soloEnReferencia: number;
  soloEnObjetivo: number;
}

/**
 * Validación 4a — mismo Cod. cargado distinto en cada archivo.
 * Validación 5 — diff estructural: qué Cod. existe sólo en uno de los dos.
 */
export function cruzarArchivos(
  referencia: ConfiguracionParseada,
  objetivo: ConfiguracionParseada
): ResultadoCruce {
  const porCodReferencia = agruparPorCod(referencia.items);
  const porCodObjetivo = agruparPorCod(objetivo.items);
  const hallazgos: HallazgoConfiguracion[] = [];

  let codsCompartidos = 0;
  let soloEnReferencia = 0;
  let soloEnObjetivo = 0;

  for (const [cod, apariciones] of porCodReferencia) {
    const enObjetivo = porCodObjetivo.get(cod);

    if (!enObjetivo) {
      soloEnReferencia++;
      const item = apariciones[0];
      hallazgos.push(
        crearHallazgo({
          tipo: "item_solo_en_referencia",
          archivo: "referencia",
          item,
          mensaje:
            `El Cod. ${cod} (${item.descripcion || "sin descripción"}) está en la referencia ` +
            `(${item.orden || "sin Orden"}, fila ${item.fila}) y no aparece en el archivo objetivo. ` +
            `Verificá si el paso se eliminó a propósito.`,
        })
      );
      continue;
    }

    codsCompartidos++;
    // Se compara la primera aparición de cada archivo: si dentro de un
    // archivo hay apariciones distintas entre sí, eso lo reporta aparte
    // validarCodsDuplicados.
    const itemReferencia = apariciones[0];
    const itemObjetivo = enObjetivo[0];
    const difs = diferencias(itemReferencia, itemObjetivo);
    if (difs.length === 0) continue;

    const detalleTexto = difs
      .map((d) => `${d.campo} (referencia: ${mostrar(d.valorA)} / objetivo: ${mostrar(d.valorB)})`)
      .join("; ");

    hallazgos.push(
      crearHallazgo({
        tipo: "atributos_difieren",
        archivo: "ambos",
        item: itemObjetivo,
        itemRelacionado: itemReferencia,
        mensaje:
          `El Cod. ${cod} (${itemObjetivo.descripcion || "sin descripción"}) está configurado distinto en cada ` +
          `archivo: ${detalleTexto}. Confirmá si es un cambio intencional del producto en desarrollo.`,
        detalle: {
          campo: difs.map((d) => d.campo).join(", "),
          valorReferencia: difs.map((d) => mostrar(d.valorA)).join(", "),
          valorObjetivo: difs.map((d) => mostrar(d.valorB)).join(", "),
        },
      })
    );
  }

  for (const [cod, apariciones] of porCodObjetivo) {
    if (porCodReferencia.has(cod)) continue;
    soloEnObjetivo++;
    const item = apariciones[0];
    hallazgos.push(
      crearHallazgo({
        tipo: "item_solo_en_objetivo",
        archivo: "objetivo",
        item,
        mensaje:
          `El Cod. ${cod} (${item.descripcion || "sin descripción"}) está en el archivo objetivo ` +
          `(${item.orden || "sin Orden"}, fila ${item.fila}) y no aparece en la referencia. ` +
          `Verificá si es un paso agregado a propósito.`,
      })
    );
  }

  return { hallazgos, codsCompartidos, soloEnReferencia, soloEnObjetivo };
}
