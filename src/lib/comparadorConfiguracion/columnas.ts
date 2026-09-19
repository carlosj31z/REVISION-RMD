import type {
  ArchivoAfectado,
  ConfiguracionParseada,
  HallazgoConfiguracion,
} from "@/types/configuracion";
import { crearHallazgo, etiquetaItem } from "./hallazgos";
import { aNumero, normalizarClave } from "./normalizar";

// Validación 3 — Coherencia de Tipo Dato / Val. Inicial / Val. Final / # Decimales.
//
// Son las cuatro columnas que definen cómo el sistema digital captura y
// valida el dato en planta: un rango mal cargado deja pasar una lectura
// fuera de especificación, y un campo numérico sin decimales redondea sin
// avisar. Todo lo de acá se verifica archivo por archivo, sin comparar.

const TIPO_RANGO = "rango";
const TIPO_NUMEROS = "numeros";

function esTipo(tipoDato: string, esperado: string): boolean {
  return normalizarClave(tipoDato) === esperado;
}

export function validarColumnas(
  config: ConfiguracionParseada,
  archivo: ArchivoAfectado,
  /** Vocabulario de Tipo Dato de la referencia. Sin él no se valida el vocabulario. */
  vocabularioReferencia?: Set<string>
): HallazgoConfiguracion[] {
  const hallazgos: HallazgoConfiguracion[] = [];

  for (const item of config.items) {
    const esRango = esTipo(item.tipoDato, TIPO_RANGO);
    const esNumeros = esTipo(item.tipoDato, TIPO_NUMEROS);
    const tieneInicial = item.valInicial !== "";
    const tieneFinal = item.valFinal !== "";

    if (esRango) {
      const inicial = aNumero(item.valInicial);
      const final = aNumero(item.valFinal);

      if (!tieneInicial || !tieneFinal) {
        const faltan = [!tieneInicial ? "Val. Inicial" : null, !tieneFinal ? "Val. Final" : null]
          .filter(Boolean)
          .join(" y ");
        hallazgos.push(
          crearHallazgo({
            tipo: "rango_incompleto",
            archivo,
            item,
            mensaje: `${etiquetaItem(item)} es de tipo "Rango" pero no tiene ${faltan}. Sin los dos extremos el sistema no puede validar la lectura.`,
            detalle: { campo: faltan },
          })
        );
      } else if (inicial === null || final === null) {
        const noNumericos = [inicial === null ? "Val. Inicial" : null, final === null ? "Val. Final" : null]
          .filter(Boolean)
          .join(" y ");
        hallazgos.push(
          crearHallazgo({
            tipo: "rango_incompleto",
            archivo,
            item,
            mensaje:
              `${etiquetaItem(item)} es de tipo "Rango" pero ${noNumericos} no contiene un número ` +
              `(Val. Inicial: "${item.valInicial}", Val. Final: "${item.valFinal}").`,
            detalle: { campo: noNumericos },
          })
        );
      } else if (inicial >= final) {
        hallazgos.push(
          crearHallazgo({
            tipo: "rango_invertido",
            archivo,
            item,
            mensaje:
              `${etiquetaItem(item)} tiene el rango invertido o nulo: Val. Inicial ${item.valInicial} ` +
              `no es menor que Val. Final ${item.valFinal}.`,
            detalle: { campo: "Val. Inicial / Val. Final" },
          })
        );
      }
    } else if (tieneInicial || tieneFinal) {
      // Los extremos sólo tienen sentido en un Rango: cargados en otro tipo
      // el sistema los ignora, y la revisión visual da por validado algo
      // que en realidad no se valida.
      const cargados = [tieneInicial ? "Val. Inicial" : null, tieneFinal ? "Val. Final" : null]
        .filter(Boolean)
        .join(" y ");
      hallazgos.push(
        crearHallazgo({
          tipo: "valores_en_tipo_no_rango",
          archivo,
          item,
          mensaje:
            `${etiquetaItem(item)} es de tipo "${item.tipoDato || "(vacío)"}" pero tiene ${cargados} cargado. ` +
            `Esas columnas deben quedar vacías en todo campo que no sea "Rango".`,
          detalle: { campo: cargados },
        })
      );
    }

    if ((esRango || esNumeros) && item.decimales === "") {
      hallazgos.push(
        crearHallazgo({
          tipo: "decimales_faltantes",
          archivo,
          item,
          mensaje: `${etiquetaItem(item)} es de tipo "${item.tipoDato}" y no tiene "# Decimales" definido.`,
          detalle: { campo: "# Decimales" },
        })
      );
    }

    // Un Tipo Dato que la referencia no usa suele ser un tipeo o un tipo
    // inventado: el sistema lo acepta pero después no valida como se espera.
    // La comparación ignora mayúsculas y tildes ("Formula" no se marca
    // contra "Fórmula"): esas diferencias vienen de la codificación del
    // export, no de haber elegido otro tipo en el sistema.
    if (vocabularioReferencia && item.tipoDato !== "" && !vocabularioReferencia.has(normalizarClave(item.tipoDato))) {
      hallazgos.push(
        crearHallazgo({
          tipo: "tipo_dato_desconocido",
          archivo,
          item,
          mensaje:
            `${etiquetaItem(item)} usa el Tipo Dato "${item.tipoDato}", que no aparece en ningún ítem del ` +
            `archivo de referencia. Revisá que no sea un error de tipeo.`,
          detalle: { campo: "Tipo Dato", valorObjetivo: item.tipoDato },
        })
      );
    }
  }

  return hallazgos;
}

/** Valores de Tipo Dato usados en un archivo, normalizados para comparar. */
export function vocabularioTipoDato(config: ConfiguracionParseada): Set<string> {
  const vocabulario = new Set<string>();
  for (const item of config.items) {
    if (item.tipoDato !== "") vocabulario.add(normalizarClave(item.tipoDato));
  }
  return vocabulario;
}

/** Los mismos valores pero tal como se escriben, para mostrarlos en el informe. */
export function vocabularioTipoDatoLegible(config: ConfiguracionParseada): string[] {
  const porClave = new Map<string, string>();
  for (const item of config.items) {
    if (item.tipoDato !== "") porClave.set(normalizarClave(item.tipoDato), item.tipoDato);
  }
  return [...porClave.values()].sort((a, b) => a.localeCompare(b, "es"));
}
