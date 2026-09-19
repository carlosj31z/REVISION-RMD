import type { InsumoItem, ItemLista, PasoProcedimiento, RMDExtraido } from "@/types/rmd";
import {
  indicesFueraDeOrden,
  palabras,
  similitud,
  similitudTextos,
  textosEquivalentes,
} from "./normalizar";

// Diff determinístico entre dos RMD ya extraídos.
//
// Es el motor que usan las tres comparaciones que no necesitan interpretar
// lenguaje: homologación contra un RMD de referencia, diferencias contra un
// borrador de producción, y verificación de que un hallazgo se corrigió.
// Ninguna de esas tres necesita un modelo para saber QUÉ cambió — sólo para
// opinar sobre si el cambio está bien, que es otra pregunta.
//
// Todo lo de acá es puro: mismas entradas, mismo diff, sin red.

/**
 * Debajo de esta similitud de palabras, dos pasos sin pareja por id se
 * consideran pasos distintos y no se emparejan. Alto a propósito: emparejar
 * mal dos pasos produce una sugerencia sin sentido, que es peor que no
 * emparejarlos y reportarlos como agregado y eliminado por separado.
 */
const UMBRAL_EMPAREJAR_POR_TEXTO = 0.8;

export interface PasoEmparejado {
  /** Paso del primer documento (el que se evalúa), o null si no existe ahí. */
  a: PasoProcedimiento | null;
  /** Paso del segundo documento (referencia o borrador), o null. */
  b: PasoProcedimiento | null;
  /** "id" = mismo identificador; "texto" = renumerado; "ninguno" = sin pareja. */
  emparejadoPor: "id" | "texto" | "ninguno";
  /** Los dos textos dicen lo mismo (ignorando mayúsculas, tildes y espacios). */
  textoIgual: boolean;
  /** 0..1 por palabras compartidas. 1 cuando el texto es equivalente. */
  similitud: number;
  /** Emparejados, pero en distinta posición relativa dentro del documento. */
  fueraDeOrden: boolean;
  /**
   * Sólo para los pasos sin pareja: el paso MÁS parecido del otro documento,
   * aunque no haya alcanzado el umbral para emparejarlos, con su similitud.
   *
   * Sirve para graduar la confianza del hallazgo. Entre dos RMD de productos
   * distintos, la mayoría de los pasos legítimamente no tiene equivalente
   * (cada producto tiene su fórmula, equipos y tiempos), así que un paso sin
   * nada parecido enfrente casi nunca es un problema; uno que sí tiene un
   * candidato cercano pero no igual, sí merece una mirada.
   */
  mejorCandidato: { paso: PasoProcedimiento; similitud: number } | null;
}

export interface DiffLineas {
  soloEnA: string[];
  soloEnB: string[];
  /** Líneas parecidas pero no idénticas: candidatas a homologar redacción. */
  redaccionDistinta: Array<{ a: string; b: string; similitud: number }>;
}

export interface DiffItems {
  soloEnA: ItemLista[];
  soloEnB: ItemLista[];
  /** Mismo código, descripción distinta. */
  descripcionDistinta: Array<{ a: ItemLista; b: ItemLista }>;
}

export interface DiffInsumos {
  soloEnA: InsumoItem[];
  soloEnB: InsumoItem[];
}

export interface DiffRmd {
  pasos: PasoEmparejado[];
  precauciones: DiffLineas;
  notasImportantes: DiffLineas;
  condicionesAmbientales: DiffLineas;
  equiposInstrumentos: DiffItems;
  /**
   * Sólo agregados y quitados, por código. Un cambio de cantidad no se
   * reporta acá porque el contrato de diferencias no tiene un tipo para eso
   * (hay insumo_agregado e insumo_eliminado, no "insumo_modificado").
   */
  insumos: DiffInsumos;
  /** 0..100: proporción de pasos que coinciden en texto y en posición. */
  gradoCoincidencia: number;
}

/** Primera aparición de cada id: un id repetido sería un defecto del RMD. */
function indexarPorId(pasos: PasoProcedimiento[]): Map<string, PasoProcedimiento> {
  const mapa = new Map<string, PasoProcedimiento>();
  for (const paso of pasos) if (!mapa.has(paso.id)) mapa.set(paso.id, paso);
  return mapa;
}

/**
 * Empareja los pasos sin id en común por parecido de contenido, que es cómo
 * se detecta un paso renumerado. Codicioso sobre el mejor par disponible:
 * se toma la pareja más parecida de todas, se saca del juego, y se repite.
 */
interface Emparejamiento {
  pares: Array<{ a: PasoProcedimiento; b: PasoProcedimiento; similitud: number }>;
  restanA: Array<{ paso: PasoProcedimiento; mejorCandidato: { paso: PasoProcedimiento; similitud: number } | null }>;
  restanB: Array<{ paso: PasoProcedimiento; mejorCandidato: { paso: PasoProcedimiento; similitud: number } | null }>;
}

function emparejarPorTexto(
  sinParejaA: PasoProcedimiento[],
  sinParejaB: PasoProcedimiento[]
): Emparejamiento {
  const palabrasA = sinParejaA.map((p) => palabras(p.texto));
  const palabrasB = sinParejaB.map((p) => palabras(p.texto));

  // Se calcula la matriz completa una sola vez: sirve para emparejar y,
  // después, para saber cuál era el candidato más cercano de los que no
  // llegaron al umbral.
  const mejorParaA: Array<{ j: number; s: number } | null> = sinParejaA.map(() => null);
  const mejorParaB: Array<{ i: number; s: number } | null> = sinParejaB.map(() => null);
  const candidatos: Array<{ i: number; j: number; s: number }> = [];

  for (let i = 0; i < sinParejaA.length; i++) {
    for (let j = 0; j < sinParejaB.length; j++) {
      const s = similitud(palabrasA[i], palabrasB[j]);
      if (s >= UMBRAL_EMPAREJAR_POR_TEXTO) candidatos.push({ i, j, s });
      if (!mejorParaA[i] || s > mejorParaA[i]!.s) mejorParaA[i] = { j, s };
      if (!mejorParaB[j] || s > mejorParaB[j]!.s) mejorParaB[j] = { i, s };
    }
  }
  candidatos.sort((x, y) => y.s - x.s);

  const usadosA = new Set<number>();
  const usadosB = new Set<number>();
  const pares: Array<{ a: PasoProcedimiento; b: PasoProcedimiento; similitud: number }> = [];
  for (const { i, j, s } of candidatos) {
    if (usadosA.has(i) || usadosB.has(j)) continue;
    usadosA.add(i);
    usadosB.add(j);
    pares.push({ a: sinParejaA[i], b: sinParejaB[j], similitud: s });
  }

  return {
    pares,
    restanA: sinParejaA
      .map((paso, i) => ({
        paso,
        i,
        mejorCandidato: mejorParaA[i] ? { paso: sinParejaB[mejorParaA[i]!.j], similitud: mejorParaA[i]!.s } : null,
      }))
      .filter(({ i }) => !usadosA.has(i))
      .map(({ paso, mejorCandidato }) => ({ paso, mejorCandidato })),
    restanB: sinParejaB
      .map((paso, j) => ({
        paso,
        j,
        mejorCandidato: mejorParaB[j] ? { paso: sinParejaA[mejorParaB[j]!.i], similitud: mejorParaB[j]!.s } : null,
      }))
      .filter(({ j }) => !usadosB.has(j))
      .map(({ paso, mejorCandidato }) => ({ paso, mejorCandidato })),
  };
}

function compararPasos(
  pasosA: PasoProcedimiento[],
  pasosB: PasoProcedimiento[]
): PasoEmparejado[] {
  const porIdA = indexarPorId(pasosA);
  const porIdB = indexarPorId(pasosB);

  const emparejados: PasoEmparejado[] = [];

  // 1. Mismo id en los dos documentos.
  const idsComunes: string[] = [];
  for (const paso of pasosA) {
    const par = porIdB.get(paso.id);
    if (!par) continue;
    idsComunes.push(paso.id);
    const igual = textosEquivalentes(paso.texto, par.texto);
    emparejados.push({
      a: paso,
      b: par,
      emparejadoPor: "id",
      textoIgual: igual,
      similitud: igual ? 1 : similitudTextos(paso.texto, par.texto),
      fueraDeOrden: false, // se calcula abajo, cuando se conocen todos
      mejorCandidato: null,
    });
  }

  // 2. De los ids comunes, cuáles están en distinto orden relativo.
  const posicionEnB = new Map<string, number>();
  pasosB.forEach((paso, indice) => {
    if (!posicionEnB.has(paso.id)) posicionEnB.set(paso.id, indice);
  });
  const fuera = indicesFueraDeOrden(idsComunes.map((id) => posicionEnB.get(id) ?? 0));
  idsComunes.forEach((_, indice) => {
    if (fuera.has(indice)) emparejados[indice].fueraDeOrden = true;
  });

  // 3. Los que quedaron sin pareja por id: se intenta emparejar por contenido
  //    (un paso renumerado) y lo que sobre es agregado o eliminado.
  //
  //    Ojo con el alcance: el emparejamiento por id va primero, así que un
  //    texto que se movió a otro número mientras ALGUIEN MÁS ocupó el número
  //    viejo no se ve como renumerado — el número viejo ya quedó emparejado
  //    con su nuevo contenido y se reporta como modificado. Es lo correcto:
  //    el mismo número es el mismo lugar del registro, y decir "se modificó
  //    4.4.2" describe mejor lo que el analista va a ver en SAP que inventar
  //    un movimiento entre dos pasos que no comparten nada.
  const sinParejaA = pasosA.filter((p) => !porIdB.has(p.id));
  const sinParejaB = pasosB.filter((p) => !porIdA.has(p.id));
  const { pares, restanA, restanB } = emparejarPorTexto(sinParejaA, sinParejaB);

  for (const { a, b, similitud: s } of pares) {
    emparejados.push({
      a,
      b,
      emparejadoPor: "texto",
      textoIgual: textosEquivalentes(a.texto, b.texto),
      similitud: s,
      // Emparejados por texto: el id cambió, así que hablar de "fuera de
      // orden" no aporta nada sobre el renumerado en sí.
      fueraDeOrden: false,
      mejorCandidato: null,
    });
  }
  for (const { paso, mejorCandidato } of restanA) {
    emparejados.push({
      a: paso,
      b: null,
      emparejadoPor: "ninguno",
      textoIgual: false,
      similitud: 0,
      fueraDeOrden: false,
      mejorCandidato,
    });
  }
  for (const { paso, mejorCandidato } of restanB) {
    emparejados.push({
      a: null,
      b: paso,
      emparejadoPor: "ninguno",
      textoIgual: false,
      similitud: 0,
      fueraDeOrden: false,
      mejorCandidato,
    });
  }

  return emparejados;
}

function compararLineas(lineasA: string[], lineasB: string[]): DiffLineas {
  const normA = lineasA.map((l) => ({ original: l, palabras: palabras(l) }));
  const normB = lineasB.map((l) => ({ original: l, palabras: palabras(l) }));

  const usadosB = new Set<number>();
  const soloEnA: string[] = [];
  const redaccionDistinta: Array<{ a: string; b: string; similitud: number }> = [];

  for (const linea of normA) {
    let mejor = -1;
    let mejorS = 0;
    for (let j = 0; j < normB.length; j++) {
      if (usadosB.has(j)) continue;
      if (textosEquivalentes(linea.original, normB[j].original)) {
        mejor = j;
        mejorS = 1;
        break;
      }
      const s = similitud(linea.palabras, normB[j].palabras);
      if (s > mejorS) {
        mejor = j;
        mejorS = s;
      }
    }

    if (mejor === -1 || mejorS < UMBRAL_EMPAREJAR_POR_TEXTO) {
      soloEnA.push(linea.original);
      continue;
    }
    usadosB.add(mejor);
    if (mejorS < 1) {
      redaccionDistinta.push({ a: linea.original, b: normB[mejor].original, similitud: mejorS });
    }
  }

  return {
    soloEnA,
    soloEnB: normB.filter((_, j) => !usadosB.has(j)).map((l) => l.original),
    redaccionDistinta,
  };
}

function compararItems(itemsA: ItemLista[], itemsB: ItemLista[]): DiffItems {
  const porCodigoB = new Map(itemsB.filter((i) => i.codigo).map((i) => [i.codigo, i]));
  const porCodigoA = new Map(itemsA.filter((i) => i.codigo).map((i) => [i.codigo, i]));

  const soloEnA: ItemLista[] = [];
  const descripcionDistinta: Array<{ a: ItemLista; b: ItemLista }> = [];
  for (const item of itemsA) {
    const par = item.codigo ? porCodigoB.get(item.codigo) : undefined;
    if (!par) {
      soloEnA.push(item);
      continue;
    }
    if (!textosEquivalentes(item.descripcion, par.descripcion)) {
      descripcionDistinta.push({ a: item, b: par });
    }
  }

  return {
    soloEnA,
    soloEnB: itemsB.filter((i) => !i.codigo || !porCodigoA.has(i.codigo)),
    descripcionDistinta,
  };
}

/**
 * Cuánto coinciden los dos documentos, en porcentaje. Se mide sobre los
 * pasos del procedimiento porque son el cuerpo del RMD: un paso cuenta como
 * coincidente sólo si dice lo mismo Y está en la misma posición relativa.
 */
function calcularGradoCoincidencia(pasos: PasoEmparejado[]): number {
  const total = pasos.length;
  if (total === 0) return 100;
  const alineados = pasos.filter((p) => p.textoIgual && !p.fueraDeOrden).length;
  return Math.round((alineados / total) * 100);
}

function compararInsumos(insumosA: InsumoItem[], insumosB: InsumoItem[]): DiffInsumos {
  const codigosA = new Set(insumosA.map((i) => i.codigo).filter(Boolean));
  const codigosB = new Set(insumosB.map((i) => i.codigo).filter(Boolean));
  return {
    soloEnA: insumosA.filter((i) => !i.codigo || !codigosB.has(i.codigo)),
    soloEnB: insumosB.filter((i) => !i.codigo || !codigosA.has(i.codigo)),
  };
}

export function compararRmd(a: RMDExtraido, b: RMDExtraido): DiffRmd {
  const pasos = compararPasos(a.procedimiento, b.procedimiento);
  return {
    pasos,
    precauciones: compararLineas(a.precauciones, b.precauciones),
    notasImportantes: compararLineas(a.notasImportantes, b.notasImportantes),
    condicionesAmbientales: compararLineas(a.condicionesAmbientales, b.condicionesAmbientales),
    equiposInstrumentos: compararItems(a.equiposInstrumentos, b.equiposInstrumentos),
    insumos: compararInsumos(a.insumos, b.insumos),
    gradoCoincidencia: calcularGradoCoincidencia(pasos),
  };
}
