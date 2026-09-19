import type {
  DiferenciaBorrador,
  DiscrepanciaDetectada,
  ReglaHomologacion,
  RMDExtraido,
  SeccionGeneral,
} from "@/types/rmd";

// Reglas de homologación de término, verificadas sin modelo.
//
// Una regla como "donde diga MEZCLADORA DOBLE CONO debe decir MEZCLADORA DE
// DOBLE CONO" no necesita interpretación: es buscar un término. Hasta ahora
// todas las reglas viajaban como texto libre dentro del prompt, así que
// verificarlas costaba una llamada al modelo y dependía de que el modelo no
// se salteara ninguna. Las reglas con tipo "reemplazo_termino" se verifican
// acá, no ocupan lugar en el prompt, y no se pueden pasar por alto.
//
// Las reglas "libre" siguen yendo al modelo: son las que de verdad necesitan
// criterio.

export interface ReglaReemplazo {
  id: string;
  texto: string;
  terminoOrigen: string;
  terminoDestino: string;
}

export function separarReglas(reglas: ReglaHomologacion[]): {
  libres: ReglaHomologacion[];
  reemplazos: ReglaReemplazo[];
} {
  const libres: ReglaHomologacion[] = [];
  const reemplazos: ReglaReemplazo[] = [];

  for (const regla of reglas) {
    const origen = regla.terminoOrigen?.trim();
    const destino = regla.terminoDestino?.trim();
    if (regla.tipo === "reemplazo_termino" && origen && destino) {
      reemplazos.push({ id: regla.id, texto: regla.texto, terminoOrigen: origen, terminoDestino: destino });
    } else {
      libres.push(regla);
    }
  }

  return { libres, reemplazos };
}

/**
 * Normaliza sin cambiar la longitud: cada carácter de entrada produce
 * exactamente uno de salida. Eso permite buscar sobre el texto normalizado y
 * después recortar la cita del texto ORIGINAL usando las mismas posiciones,
 * que es lo que necesita el visor de PDF para resaltar la frase exacta y no
 * el paso entero.
 */
function normalizarPreservandoPosiciones(texto: string): string {
  let salida = "";
  for (const caracter of texto) {
    const sinTilde = caracter.normalize("NFD").replace(/[̀-ͯ]/g, "");
    salida += (sinTilde.length === 1 ? sinTilde : caracter).toUpperCase();
  }
  return salida;
}

function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * El término como palabra completa: "TAMIZ" no debe coincidir dentro de
 * "TAMIZADO". Se usan lookarounds en vez de \b porque el término puede
 * empezar o terminar en un carácter que no es de palabra (ej. "N° 20").
 */
function regexTermino(termino: string): RegExp {
  // Se escapa primero y se flexibiliza el espaciado después: así los
  // metacaracteres del término quedan literales, y un espacio doble o un
  // salto de línea en el documento no impide la coincidencia.
  const patron = escaparRegex(normalizarPreservandoPosiciones(termino).trim()).replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![A-Z0-9])${patron}(?![A-Z0-9])`, "g");
}

interface Coincidencia {
  inicio: number;
  fin: number;
}

function buscarTodas(textoNormalizado: string, termino: string): Coincidencia[] {
  const coincidencias: Coincidencia[] = [];
  const regex = regexTermino(termino);
  let match: RegExpExecArray | null;
  while ((match = regex.exec(textoNormalizado)) !== null) {
    coincidencias.push({ inicio: match.index, fin: match.index + match[0].length });
    if (match.index === regex.lastIndex) regex.lastIndex++; // término vacío: no trabar el bucle
  }
  return coincidencias;
}

/** Ventana de contexto alrededor de la coincidencia, para citar la frase. */
const CONTEXTO = 60;

export interface HallazgoTermino {
  regla: ReglaReemplazo;
  pasoId: string | null;
  seccionGeneral: SeccionGeneral | null;
  ubicacion: string;
  /** Cita del texto ORIGINAL alrededor del término encontrado. */
  cita: string;
}

function buscarEnTexto(
  texto: string,
  reemplazos: ReglaReemplazo[],
  pasoId: string | null,
  seccionGeneral: SeccionGeneral | null,
  ubicacion: string
): HallazgoTermino[] {
  if (!texto) return [];
  const normalizado = normalizarPreservandoPosiciones(texto);
  const salida: HallazgoTermino[] = [];

  for (const regla of reemplazos) {
    const enOrigen = buscarTodas(normalizado, regla.terminoOrigen);
    if (enOrigen.length === 0) continue;

    // Si el término correcto CONTIENE al incorrecto (ej. "TAMIZ" → "TAMIZ DE
    // ACERO"), el texto ya corregido daría un falso positivo: se descartan
    // las coincidencias que caen dentro de una del término correcto.
    const enDestino = buscarTodas(normalizado, regla.terminoDestino);
    const dentroDelDestino = (c: Coincidencia) =>
      enDestino.some((d) => c.inicio >= d.inicio && c.fin <= d.fin);

    const real = enOrigen.find((c) => !dentroDelDestino(c));
    if (!real) continue;

    const desde = Math.max(0, real.inicio - CONTEXTO);
    const hasta = Math.min(texto.length, real.fin + CONTEXTO);
    const cita = texto.slice(desde, hasta).trim();

    salida.push({
      regla,
      pasoId,
      seccionGeneral,
      ubicacion,
      // Si por alguna razón el recorte perdió el término (texto con
      // caracteres fuera del plano básico), se cita el texto completo antes
      // que una cita que no contiene lo observado.
      cita: normalizarPreservandoPosiciones(cita).includes(
        normalizarPreservandoPosiciones(regla.terminoOrigen)
      )
        ? cita
        : texto.trim(),
    });
  }

  return salida;
}

/**
 * Todos los lugares del RMD donde un término que debía estar homologado
 * sigue escrito de la forma vieja.
 */
export function detectarTerminosSinHomologar(
  rmd: RMDExtraido,
  reemplazos: ReglaReemplazo[]
): HallazgoTermino[] {
  if (reemplazos.length === 0) return [];

  const hallazgos: HallazgoTermino[] = [];

  for (const paso of rmd.procedimiento) {
    hallazgos.push(...buscarEnTexto(paso.texto, reemplazos, paso.id, null, `Paso ${paso.id}`));
  }

  const secciones: Array<[string[], SeccionGeneral, string]> = [
    [rmd.precauciones, "precauciones", "PRECAUCIONES"],
    [rmd.notasImportantes, "notas_importantes", "NOTAS IMPORTANTES"],
    [rmd.condicionesAmbientales, "condiciones_ambientales", "CONDICIONES AMBIENTALES"],
  ];
  for (const [lineas, seccion, nombre] of secciones) {
    lineas.forEach((linea, indice) => {
      hallazgos.push(...buscarEnTexto(linea, reemplazos, null, seccion, `${nombre}, línea ${indice + 1}`));
    });
  }

  for (const equipo of rmd.equiposInstrumentos) {
    hallazgos.push(
      ...buscarEnTexto(
        equipo.descripcion,
        reemplazos,
        null,
        "equipos_instrumentos",
        `EQUIPOS/INSTRUMENTOS/MATERIALES, código ${equipo.codigo}`
      )
    );
  }

  return hallazgos;
}

function justificacion(hallazgo: HallazgoTermino): string {
  return (
    `Regla permanente de homologación: donde diga "${hallazgo.regla.terminoOrigen}" debe decir ` +
    `"${hallazgo.regla.terminoDestino}". El término sin homologar sigue apareciendo en ${hallazgo.ubicacion}. ` +
    "Verificación determinística por búsqueda de término, no interpretación del modelo."
  );
}

/** Para /api/revision, que reporta DiscrepanciaDetectada. */
export function aDiscrepancias(hallazgos: HallazgoTermino[]): DiscrepanciaDetectada[] {
  return hallazgos.map((hallazgo) => ({
    pasoId: hallazgo.pasoId ?? "N/A",
    seccionGeneral: hallazgo.seccionGeneral,
    ubicacionReferencia: hallazgo.ubicacion,
    tipoDiscrepancia: "termino_sin_homologar",
    textoVigenteEnRMD: hallazgo.cita,
    queExigeElControlDeCambios: `Debe decir "${hallazgo.regla.terminoDestino}" en vez de "${hallazgo.regla.terminoOrigen}".`,
    justificacion: justificacion(hallazgo),
    // El origen no es un Control de Cambios puntual sino una regla permanente
    // que el analista definió una vez y aplica a todas las revisiones.
    origenControlCambio: `Regla permanente: ${hallazgo.regla.texto}`,
    involucraEquipoRetirado: false,
    equiposMencionados: [],
    // La detección es una búsqueda de texto: o el término está o no está.
    nivelConfianza: "alta",
  }));
}

/**
 * Para /api/revision-borrador, que reporta DiferenciaBorrador. `donde` dice
 * en cuál de los dos documentos se encontró el término, para no citar el
 * mismo texto en las dos columnas como si estuviera en ambos.
 */
export function aDiferenciasBorrador(
  hallazgos: HallazgoTermino[],
  donde: "vigente" | "borrador"
): DiferenciaBorrador[] {
  return hallazgos.map((hallazgo) => ({
    pasoIdVigente: donde === "vigente" ? hallazgo.pasoId : null,
    pasoIdBorrador: donde === "borrador" ? hallazgo.pasoId : null,
    seccionGeneral: hallazgo.seccionGeneral,
    ubicacionReferencia:
      donde === "borrador" ? `${hallazgo.ubicacion} (borrador)` : `${hallazgo.ubicacion} (RMD vigente)`,
    tipoDiferencia: "termino_sin_homologar",
    textoEnVigente: donde === "vigente" ? hallazgo.cita : null,
    textoEnBorrador: donde === "borrador" ? hallazgo.cita : null,
    justificacion: justificacion(hallazgo),
    involucraEquipoRetirado: false,
    equiposMencionados: [],
    nivelConfianza: "alta",
    origenAnotacionInformal: false,
  }));
}
