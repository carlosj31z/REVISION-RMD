import type { DiferenciaBorrador, RMDExtraido } from "@/types/rmd";
import { compararRmd, type DiffRmd } from "./diff";

// Diferencias mecánicas entre el RMD vigente y el borrador de Producción.
//
// A diferencia de la homologación contra una referencia, acá el modelo NO se
// reemplaza: comparar dos versiones del mismo RMD necesita criterio para lo
// importante (si el cambio propuesto cumple las reglas permanentes, si viene
// de una anotación manuscrita, si genera una incoherencia). Lo que sí es
// puramente mecánico es QUÉ cambió, y eso se calcula acá para dos cosas:
//
//   1. Como red de seguridad: una diferencia mecánica que el modelo no
//      reportó se agrega igual. Es el mismo patrón que el proyecto ya usa con
//      los equipos retirados — el modelo propone, el código valida.
//   2. Para saltear la llamada cuando los dos documentos son mecánicamente
//      idénticos y no hay reglas de texto libre que interpretar: ahí no hay
//      nada que el modelo pueda aportar.
//
// Deliberadamente NO se recorta el prompt a los pasos que cambiaron. Sería el
// ahorro más grande, pero el prompt de comparación está escrito para recibir
// dos documentos COMPLETOS: si se le mandan recortados, va a reportar como
// "paso eliminado" todo lo que se filtró. Hacerlo bien exige reescribir ese
// prompt y validarlo contra documentos reales, no solo que compile.

/** Un reordenamiento puro no tiene tipo en el contrato, así que no se reporta. */
function mecanicasDePasos(diff: DiffRmd): DiferenciaBorrador[] {
  const salida: DiferenciaBorrador[] = [];

  for (const par of diff.pasos) {
    if (par.a && !par.b) {
      salida.push({
        pasoIdVigente: par.a.id,
        pasoIdBorrador: null,
        seccionGeneral: null,
        ubicacionReferencia: `Paso ${par.a.id} del RMD vigente`,
        tipoDiferencia: "paso_eliminado_en_borrador",
        textoEnVigente: par.a.texto,
        textoEnBorrador: null,
        justificacion:
          "El borrador no incluye este paso ni ninguno con contenido equivalente (comparación textual).",
        involucraEquipoRetirado: false,
        equiposMencionados: [],
        nivelConfianza: "alta",
        origenAnotacionInformal: false,
      });
      continue;
    }

    if (!par.a && par.b) {
      salida.push({
        pasoIdVigente: null,
        pasoIdBorrador: par.b.id,
        seccionGeneral: null,
        ubicacionReferencia: `Paso ${par.b.id} del borrador`,
        tipoDiferencia: "paso_agregado_en_borrador",
        textoEnVigente: null,
        textoEnBorrador: par.b.texto,
        justificacion: "El borrador agrega este paso: no existe en el RMD vigente (comparación textual).",
        involucraEquipoRetirado: false,
        equiposMencionados: [],
        nivelConfianza: "alta",
        origenAnotacionInformal: false,
      });
      continue;
    }

    if (!par.a || !par.b) continue;
    if (par.textoIgual && par.emparejadoPor === "id") continue; // igual y en su lugar

    const renumerado = par.emparejadoPor === "texto";
    salida.push({
      pasoIdVigente: par.a.id,
      pasoIdBorrador: par.b.id,
      seccionGeneral: null,
      ubicacionReferencia: renumerado
        ? `Paso ${par.a.id} del vigente, ${par.b.id} en el borrador`
        : `Paso ${par.a.id}`,
      tipoDiferencia: par.textoIgual ? "paso_renumerado" : "paso_modificado",
      textoEnVigente: par.a.texto,
      textoEnBorrador: par.b.texto,
      justificacion: par.textoIgual
        ? `Mismo contenido con otro número: ${par.a.id} en el vigente y ${par.b.id} en el borrador.`
        : `El texto del paso cambió (${Math.round(par.similitud * 100)}% de palabras en común)` +
          (renumerado ? ` y además se renumeró a ${par.b.id}.` : "."),
      involucraEquipoRetirado: false,
      equiposMencionados: [],
      nivelConfianza: "alta",
      origenAnotacionInformal: false,
    });
  }

  return salida;
}

function mecanicasDeListas(diff: DiffRmd): DiferenciaBorrador[] {
  const salida: DiferenciaBorrador[] = [];

  const base = {
    pasoIdVigente: null,
    pasoIdBorrador: null,
    justificacion: "",
    involucraEquipoRetirado: false,
    nivelConfianza: "alta" as const,
    origenAnotacionInformal: false,
  };

  for (const equipo of diff.equiposInstrumentos.soloEnA) {
    salida.push({
      ...base,
      seccionGeneral: "equipos_instrumentos",
      ubicacionReferencia: `EQUIPOS/INSTRUMENTOS/MATERIALES, código ${equipo.codigo}`,
      tipoDiferencia: "equipo_eliminado",
      textoEnVigente: `${equipo.codigo} — ${equipo.descripcion}`,
      textoEnBorrador: null,
      justificacion: "El equipo está en el RMD vigente y el borrador ya no lo lista.",
      equiposMencionados: [equipo.codigo],
    });
  }
  for (const equipo of diff.equiposInstrumentos.soloEnB) {
    salida.push({
      ...base,
      seccionGeneral: "equipos_instrumentos",
      ubicacionReferencia: `EQUIPOS/INSTRUMENTOS/MATERIALES, código ${equipo.codigo}`,
      tipoDiferencia: "equipo_agregado",
      textoEnVigente: null,
      textoEnBorrador: `${equipo.codigo} — ${equipo.descripcion}`,
      justificacion: "El borrador agrega este equipo: no está en el RMD vigente.",
      equiposMencionados: [equipo.codigo],
    });
  }
  for (const insumo of diff.insumos.soloEnA) {
    salida.push({
      ...base,
      seccionGeneral: null,
      ubicacionReferencia: `INSUMOS, código ${insumo.codigo}`,
      tipoDiferencia: "insumo_eliminado",
      textoEnVigente: `${insumo.codigo} — ${insumo.descripcion} (${insumo.cantidad} ${insumo.um})`,
      textoEnBorrador: null,
      justificacion: "El insumo está en el RMD vigente y el borrador ya no lo lista.",
      equiposMencionados: [],
    });
  }
  for (const insumo of diff.insumos.soloEnB) {
    salida.push({
      ...base,
      seccionGeneral: null,
      ubicacionReferencia: `INSUMOS, código ${insumo.codigo}`,
      tipoDiferencia: "insumo_agregado",
      textoEnVigente: null,
      textoEnBorrador: `${insumo.codigo} — ${insumo.descripcion} (${insumo.cantidad} ${insumo.um})`,
      justificacion: "El borrador agrega este insumo: no está en el RMD vigente.",
      equiposMencionados: [],
    });
  }

  return salida;
}

export interface DiferenciasMecanicas {
  diferencias: DiferenciaBorrador[];
  /** 0..100 de coincidencia de los pasos, calculado sobre los documentos completos. */
  coincidenciaPorcentaje: number;
}

export function diferenciasMecanicas(
  vigente: RMDExtraido,
  borrador: RMDExtraido
): DiferenciasMecanicas {
  const diff = compararRmd(vigente, borrador);
  return {
    diferencias: [...mecanicasDePasos(diff), ...mecanicasDeListas(diff)],
    coincidenciaPorcentaje: diff.gradoCoincidencia,
  };
}

/**
 * Agrega las diferencias mecánicas que el modelo no reportó.
 *
 * Conservador a propósito: si el modelo ya dijo ALGO sobre ese paso o ese
 * código, no se agrega nada, aunque lo haya clasificado distinto. Duplicar
 * una tarjeta para el mismo punto es peor que confiar en la del modelo, que
 * además viene con el criterio sobre reglas y anotaciones.
 */
export function fusionarConMecanicas(
  delModelo: DiferenciaBorrador[],
  mecanicas: DiferenciaBorrador[]
): { diferencias: DiferenciaBorrador[]; agregadas: number } {
  const puntosReportados = new Set<string>();
  for (const diferencia of delModelo) {
    if (diferencia.pasoIdVigente) puntosReportados.add(`paso:${diferencia.pasoIdVigente}`);
    if (diferencia.pasoIdBorrador) puntosReportados.add(`paso:${diferencia.pasoIdBorrador}`);
    for (const codigo of diferencia.equiposMencionados) puntosReportados.add(`cod:${codigo}`);
    // Los insumos y equipos sin paso se identifican por su ubicación, que en
    // las mecánicas lleva el código dentro.
    puntosReportados.add(`ubic:${diferencia.ubicacionReferencia.trim().toUpperCase()}`);
  }

  const faltantes = mecanicas.filter((mecanica) => {
    const claves = [
      mecanica.pasoIdVigente ? `paso:${mecanica.pasoIdVigente}` : null,
      mecanica.pasoIdBorrador ? `paso:${mecanica.pasoIdBorrador}` : null,
      ...mecanica.equiposMencionados.map((c) => `cod:${c}`),
      `ubic:${mecanica.ubicacionReferencia.trim().toUpperCase()}`,
    ].filter((c): c is string => c !== null);
    return !claves.some((clave) => puntosReportados.has(clave));
  });

  return {
    diferencias: [...delModelo, ...faltantes],
    agregadas: faltantes.length,
  };
}
