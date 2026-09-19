import type {
  HallazgoAVerificar,
  RMDExtraido,
  ResultadoVerificacionCorreccion,
  VerificacionHallazgo,
} from "@/types/rmd";
import { normalizarParaComparar } from "./normalizar";

// Verificación determinística de que un hallazgo se corrigió.
//
// El analista corrigió el RMD en SAP y sube el PDF corregido. La pregunta no
// es "analizá el documento de nuevo" sino, hallazgo por hallazgo: ¿el texto
// que se observó sigue ahí o ya no? Eso es búsqueda de texto, no
// interpretación.
//
// La asimetría importa y es deliberada:
//
//   * Si la cita observada sigue apareciendo TEXTUALMENTE en su paso, el
//     hallazgo NO está resuelto. Eso es certero: nadie tocó ese texto.
//   * Si ya no aparece, el punto observado efectivamente cambió, y la
//     evidencia que se devuelve es lo que el paso dice AHORA — que es
//     exactamente lo que el contrato pide en `justificacion` ("qué dice ahora
//     el RMD corregido en ese punto (evidencia, no opinión)"). Si esa
//     redacción nueva además CUMPLE lo que pedía el Control de Cambios es un
//     juicio que sigue siendo del analista, y el texto nuevo está a la vista
//     para que lo haga.
//
// Ante cualquier caso que no se pueda decidir con evidencia se devuelve
// `resuelto: false` y se dice por qué: equivocarse hacia "todavía no" es
// molesto, equivocarse hacia "ya está" haría firmar algo sin corregir.

export interface ResultadoVerificacionDeterministica {
  resultado: ResultadoVerificacionCorreccion;
  /** Hallazgos que no se pudieron decidir con evidencia textual. */
  noVerificables: HallazgoAVerificar[];
}

/** ¿Aparece la cita observada dentro de este texto? */
function contiene(texto: string, cita: string): boolean {
  return normalizarParaComparar(texto).includes(normalizarParaComparar(cita));
}

function recortar(texto: string, maximo = 300): string {
  const limpio = texto.trim();
  return limpio.length <= maximo ? limpio : `${limpio.slice(0, maximo)}…`;
}

export function verificarCorreccionDeterministica(
  rmdCorregido: RMDExtraido,
  hallazgos: HallazgoAVerificar[]
): ResultadoVerificacionDeterministica {
  const porId = new Map(rmdCorregido.procedimiento.map((p) => [p.id, p]));
  const verificaciones: VerificacionHallazgo[] = [];
  const noVerificables: HallazgoAVerificar[] = [];

  for (const hallazgo of hallazgos) {
    const pasoId = hallazgo.pasoId && hallazgo.pasoId !== "N/A" ? hallazgo.pasoId : null;
    const cita = hallazgo.textoVigente?.trim() || null;

    // Sin un paso y una cita no hay nada que buscar: el hallazgo estaba
    // anclado a todo el documento, o a una sección general.
    if (!pasoId || !cita) {
      noVerificables.push(hallazgo);
      verificaciones.push({
        id: hallazgo.id,
        resuelto: false,
        justificacion:
          "No se puede verificar automáticamente: la observación no está anclada a un paso concreto con " +
          `una cita textual (${hallazgo.ubicacionReferencia}). Revisala a mano en el documento corregido.`,
      });
      continue;
    }

    const paso = porId.get(pasoId);

    if (!paso) {
      // El paso ya no está. Si la observación pedía eliminarlo, está
      // resuelta; si pedía modificarlo, desapareció algo que debía seguir.
      // Sin saber cuál de las dos, la respuesta segura es "revisalo".
      const enOtroPaso = rmdCorregido.procedimiento.find((p) => contiene(p.texto, cita));
      verificaciones.push({
        id: hallazgo.id,
        resuelto: false,
        justificacion: enOtroPaso
          ? `El paso ${pasoId} ya no existe en el documento corregido, pero el texto observado aparece ahora en el paso ${enOtroPaso.id}: se renumeró en vez de corregirse.`
          : `El paso ${pasoId} ya no existe en el documento corregido y el texto observado no aparece en ningún otro paso. Si la observación pedía eliminarlo, está resuelta; confirmalo a mano.`,
      });
      continue;
    }

    if (contiene(paso.texto, cita)) {
      verificaciones.push({
        id: hallazgo.id,
        resuelto: false,
        justificacion: `El paso ${pasoId} sigue diciendo textualmente lo observado: "${recortar(cita)}". No se modificó.`,
      });
      continue;
    }

    // El texto observado ya no está en ese paso: el punto se tocó.
    const reapareceEn = rmdCorregido.procedimiento.find(
      (p) => p.id !== pasoId && contiene(p.texto, cita)
    );
    verificaciones.push({
      id: hallazgo.id,
      resuelto: !reapareceEn,
      justificacion: reapareceEn
        ? `El texto observado ya no está en el paso ${pasoId}, pero sigue apareciendo en el paso ${reapareceEn.id}: se movió en vez de corregirse.`
        : `El paso ${pasoId} ya no contiene el texto observado. Ahora dice: "${recortar(paso.texto)}".`,
    });
  }

  const resueltos = verificaciones.filter((v) => v.resuelto).length;
  const pendientes = verificaciones.length - resueltos;

  return {
    resultado: {
      resumenVerificacion:
        `${resueltos} de ${verificaciones.length} observación(es) con el texto observado ya modificado en el ` +
        `documento corregido; ${pendientes} sin modificar o sin poder verificarse automáticamente` +
        (noVerificables.length > 0 ? ` (${noVerificables.length} sin un paso y una cita para buscar)` : "") +
        ". Verificación determinística por búsqueda de texto: confirma si el punto observado cambió, no si " +
        "la redacción nueva cumple lo que pedía el Control de Cambios.",
      verificaciones,
    },
    noVerificables,
  };
}
