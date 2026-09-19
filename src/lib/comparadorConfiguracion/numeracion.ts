import type {
  ArchivoAfectado,
  ConfiguracionParseada,
  HallazgoConfiguracion,
  ItemConfiguracion,
} from "@/types/configuracion";
import { crearHallazgo } from "./hallazgos";
import { ordenPadre } from "./normalizar";

// Validación 2 — Numeración de la columna Orden.
//
// Dentro de un mismo nivel jerárquico (todos los "6.4.N", o todos los
// "6.4.31.N" de un mismo padre) el último número debe ser consecutivo, sin
// saltos ni duplicados. Las subsecciones cortas (PRECAUCIONES, NOTAS
// IMPORTANTES, CONDICIONES AMBIENTALES) numeran 1, 2, 3… y reinician en
// cada una: por eso los Orden de un solo nivel se agrupan por sección y
// reiniciar ahí no cuenta como salto.

interface Grupo {
  /** Cómo se nombra el nivel en los mensajes, ya con preposición: "del nivel 6.4". */
  etiqueta: string;
  /** Prefijo de los Orden del grupo ("6.4."), vacío en los de un solo nivel. */
  prefijo: string;
  items: ItemConfiguracion[];
}

function agruparPorNivel(items: ItemConfiguracion[]): Grupo[] {
  const grupos = new Map<string, Grupo>();

  for (const item of items) {
    if (item.ordenSegmentos.length === 0) continue; // Orden no numérico: no aplica

    const padre = ordenPadre(item.orden);
    const clave = padre ? `padre:${padre}` : `seccion:${item.seccion ?? ""}`;
    let grupo = grupos.get(clave);
    if (!grupo) {
      grupo = {
        etiqueta: padre ? `del nivel ${padre}` : `de la sección ${item.seccion ?? "sin sección"}`,
        prefijo: padre ? `${padre}.` : "",
        items: [],
      };
      grupos.set(clave, grupo);
    }
    grupo.items.push(item);
  }

  return [...grupos.values()];
}

export function validarNumeracion(
  config: ConfiguracionParseada,
  archivo: ArchivoAfectado
): HallazgoConfiguracion[] {
  const hallazgos: HallazgoConfiguracion[] = [];

  for (const grupo of agruparPorNivel(config.items)) {
    const vistos = new Map<number, ItemConfiguracion>();
    let anterior: ItemConfiguracion | null = null;

    for (const item of grupo.items) {
      const numero = item.ordenSegmentos[item.ordenSegmentos.length - 1];

      const duplicado = vistos.get(numero);
      if (duplicado) {
        hallazgos.push(
          crearHallazgo({
            tipo: "numeracion_duplicada",
            archivo,
            item,
            itemRelacionado: duplicado,
            mensaje:
              `Orden duplicado ${grupo.etiqueta}: ${item.orden} aparece en la fila ${duplicado.fila} ` +
              `y otra vez en la fila ${item.fila}.`,
            detalle: { campo: "Orden" },
            sufijoId: `fila${item.fila}`,
          })
        );
        continue;
      }
      vistos.set(numero, item);

      const esperado = anterior === null ? 1 : anterior.ordenSegmentos[anterior.ordenSegmentos.length - 1] + 1;
      if (numero !== esperado) {
        const faltantes: string[] = [];
        for (let n = esperado; n < numero; n++) faltantes.push(`${grupo.prefijo}${n}`);

        const mensaje =
          faltantes.length > 0
            ? anterior === null
              ? `La numeración ${grupo.etiqueta} empieza en ${item.orden}: falta${faltantes.length > 1 ? "n" : ""} ${faltantes.join(", ")}.`
              : `Salto de numeración ${grupo.etiqueta}: después de ${anterior.orden} sigue ${item.orden}, ` +
                `falta${faltantes.length > 1 ? "n" : ""} ${faltantes.join(", ")}.`
            : `La numeración ${grupo.etiqueta} retrocede: ${item.orden} (fila ${item.fila}) aparece después de ` +
              `${anterior?.orden} (fila ${anterior?.fila}).`;

        hallazgos.push(
          crearHallazgo({
            tipo: "numeracion_salto",
            archivo,
            item,
            ...(anterior ? { itemRelacionado: anterior } : {}),
            mensaje,
            detalle: { campo: "Orden" },
          })
        );
      }

      anterior = item;
    }
  }

  return hallazgos;
}
