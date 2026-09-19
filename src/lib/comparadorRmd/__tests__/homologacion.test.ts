import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RMDExtraido, SugerenciaHomologacionReferencia } from "@/types/rmd";
import { compararContraReferencia } from "../homologacion";
import { compararRmd } from "../diff";
import { indicesFueraDeOrden, similitudTextos, textosEquivalentes } from "../normalizar";

interface PasoSpec {
  id: string;
  texto: string;
}

function rmd(pasos: PasoSpec[], extra: Partial<RMDExtraido> = {}): RMDExtraido {
  return {
    encabezado: {
      producto: "PRODUCTO X 10mg TAB",
      codigo: "5000000000",
      versionFabAlt: "2002/1",
      edicionRegManuf: 1,
      estado: "Autorizado",
      fechaEstado: "2026-01-01",
      autorizadoPor: "QA",
      teorico: "100000 TAB",
    },
    precauciones: [],
    notasImportantes: [],
    equiposInstrumentos: [],
    insumos: [],
    condicionesAmbientales: [],
    procedimiento: pasos.map((p) => ({ id: p.id, texto: p.texto, requiereVB: false })),
    documentosReferenciados: [],
    paginasSeccionesGenerales: {},
    ...extra,
  };
}

/** Tres pasos idénticos, base de la mayoría de los casos. */
function pasosBase(): PasoSpec[] {
  return [
    { id: "4.4.1", texto: "PESAR EL PRINCIPIO ACTIVO EN LA BALANZA CALIBRADA" },
    { id: "4.4.2", texto: "TAMIZAR POR TAMIZ DE ACERO INOXIDABLE N 20" },
    { id: "4.4.3", texto: "CARGAR EN LA MEZCLADORA DOBLE CONO Y MEZCLAR 15 MINUTOS" },
  ];
}

function deTipo(
  resultado: { sugerenciasHomologacion: SugerenciaHomologacionReferencia[] },
  tipo: SugerenciaHomologacionReferencia["tipo"]
): SugerenciaHomologacionReferencia[] {
  return resultado.sugerenciasHomologacion.filter((s) => s.tipo === tipo);
}

function unica(
  resultado: { sugerenciasHomologacion: SugerenciaHomologacionReferencia[] },
  tipo: SugerenciaHomologacionReferencia["tipo"]
): SugerenciaHomologacionReferencia {
  const encontradas = deTipo(resultado, tipo);
  assert.equal(
    encontradas.length,
    1,
    `se esperaba 1 sugerencia "${tipo}", hubo ${encontradas.length}: ` +
      resultado.sugerenciasHomologacion.map((s) => `${s.tipo}/${s.pasoIdRmd ?? s.pasoIdReferencia}`).join(", ")
  );
  return encontradas[0];
}

describe("comparación contra RMD de referencia", () => {
  it("no sugiere nada cuando los dos documentos son iguales", () => {
    const resultado = compararContraReferencia(rmd(pasosBase()), rmd(pasosBase()));

    assert.deepEqual(resultado.sugerenciasHomologacion, []);
    assert.equal(resultado.gradoHomologacion, 100);
    assert.equal(resultado.requiereRevisionHumana, false);
    assert.match(resultado.resumenEjecutivo, /está alineado con la referencia/);
  });

  it("marca el paso que la referencia tiene y el RMD no", () => {
    const evaluado = pasosBase();
    const referencia = [
      ...pasosBase(),
      { id: "4.4.4", texto: "REGISTRAR EL PESO OBTENIDO EN EL FORMATO FPRO-243" },
    ];

    const resultado = compararContraReferencia(rmd(evaluado), rmd(referencia));
    const sugerencia = unica(resultado, "paso_faltante_en_rmd");

    assert.equal(sugerencia.accionSugerida, "incluir");
    assert.equal(sugerencia.pasoIdRmd, null);
    assert.equal(sugerencia.pasoIdReferencia, "4.4.4");
    assert.equal(sugerencia.textoEnRmd, null);
    assert.match(sugerencia.textoEnReferencia ?? "", /FPRO-243/);
    assert.equal(sugerencia.nivelConfianza, "alta");
  });

  it("marca el paso que el RMD tiene y la referencia no", () => {
    const evaluado = [...pasosBase(), { id: "4.4.4", texto: "APLICAR UN PASO PROPIO DE ESTE PRODUCTO" }];

    const resultado = compararContraReferencia(rmd(evaluado), rmd(pasosBase()));
    const sugerencia = unica(resultado, "paso_sobrante_en_rmd");

    assert.equal(sugerencia.accionSugerida, "eliminar");
    assert.equal(sugerencia.pasoIdRmd, "4.4.4");
    assert.equal(sugerencia.pasoIdReferencia, null);
    assert.match(sugerencia.justificacion, /evaluá si corresponde mantenerlo/);
  });

  it("marca el mismo paso con redacción distinta", () => {
    const evaluado = pasosBase();
    evaluado[2].texto = "CARGAR EN LA MEZCLADORA DE DOBLE CONO Y MEZCLAR POR 15 MINUTOS";

    const resultado = compararContraReferencia(rmd(evaluado), rmd(pasosBase()));
    const sugerencia = unica(resultado, "redaccion_puede_homologarse");

    assert.equal(sugerencia.accionSugerida, "modificar");
    assert.equal(sugerencia.pasoIdRmd, "4.4.3");
    assert.equal(sugerencia.pasoIdReferencia, "4.4.3");
    assert.match(sugerencia.textoEnRmd ?? "", /DE DOBLE CONO/);
    assert.match(sugerencia.textoEnReferencia ?? "", /MEZCLADORA DOBLE CONO/);
    assert.match(sugerencia.justificacion, /% de palabras en común/);
  });

  it("no marca diferencias de mayúsculas, tildes ni espacios", () => {
    // Política del proyecto: mayúsculas y tildes nunca cuentan como falla.
    const evaluado = pasosBase();
    evaluado[0].texto = "pesar  el principio activo en la balanza calibráda";

    const resultado = compararContraReferencia(rmd(evaluado), rmd(pasosBase()));
    assert.deepEqual(resultado.sugerenciasHomologacion, []);
    assert.equal(resultado.gradoHomologacion, 100);
  });

  it("sí marca un cambio de puntuación", () => {
    // "puntuación que cambia el sentido" sí es una falla para el proyecto.
    const evaluado = pasosBase();
    evaluado[1].texto = "TAMIZAR POR TAMIZ DE ACERO INOXIDABLE N 20.";

    const resultado = compararContraReferencia(rmd(evaluado), rmd(pasosBase()));
    assert.equal(deTipo(resultado, "redaccion_puede_homologarse").length, 1);
  });

  it("reconoce un paso renumerado por su contenido", () => {
    const evaluado = pasosBase();
    evaluado[2].id = "4.4.7"; // mismo texto, otro número

    const resultado = compararContraReferencia(rmd(evaluado), rmd(pasosBase()));
    const sugerencia = unica(resultado, "orden_distinto");

    assert.equal(sugerencia.accionSugerida, "reordenar");
    assert.equal(sugerencia.pasoIdRmd, "4.4.7");
    assert.equal(sugerencia.pasoIdReferencia, "4.4.3");
    assert.match(sugerencia.justificacion, /numerado 4\.4\.7/);
    // No se reporta como agregado + eliminado: se emparejó.
    assert.equal(deTipo(resultado, "paso_faltante_en_rmd").length, 0);
    assert.equal(deTipo(resultado, "paso_sobrante_en_rmd").length, 0);
  });

  it("no empareja dos pasos que hablan de cosas distintas", () => {
    const evaluado = [
      pasosBase()[0],
      { id: "9.9.9", texto: "LIMPIAR Y SANITIZAR LA SALA AL FINALIZAR EL PROCESO" },
    ];
    const referencia = [pasosBase()[0], { id: "8.8.8", texto: "ENVASAR EL PRODUCTO EN BLISTER DE ALUMINIO" }];

    const resultado = compararContraReferencia(rmd(evaluado), rmd(referencia));
    assert.equal(deTipo(resultado, "paso_sobrante_en_rmd").length, 1);
    assert.equal(deTipo(resultado, "paso_faltante_en_rmd").length, 1);
    assert.equal(deTipo(resultado, "orden_distinto").length, 0);
  });

  it("detecta que dos pasos están en orden distinto", () => {
    const referencia = pasosBase();
    const evaluado = [referencia[0], referencia[2], referencia[1]];

    const resultado = compararContraReferencia(rmd(evaluado), rmd(referencia));
    const sugerencias = deTipo(resultado, "orden_distinto");

    assert.equal(sugerencias.length, 1, "sólo el paso que se movió, no los dos");
    assert.equal(sugerencias[0].accionSugerida, "reordenar");
    assert.match(sugerencias[0].justificacion, /aparece en otra posición/);
    assert.ok(resultado.gradoHomologacion < 100);
  });

  it("lista las sugerencias en el orden del documento evaluado", () => {
    const evaluado = [
      { id: "4.4.1", texto: "PESAR EL PRINCIPIO ACTIVO EN LA BALANZA CALIBRADA" },
      { id: "4.4.2", texto: "UN PASO QUE LA REFERENCIA NO TIENE PARA NADA" },
      { id: "4.4.3", texto: "CARGAR EN LA MEZCLADORA DOBLE CONO Y MEZCLAR 16 MINUTOS" },
    ];
    const referencia = pasosBase();

    const resultado = compararContraReferencia(
      rmd(evaluado, { precauciones: ["USAR GUANTES"] }),
      rmd(referencia, { precauciones: ["USAR GUANTES", "USAR LENTES DE SEGURIDAD"] })
    );

    // Primero PRECAUCIONES (va antes en el documento), después los pasos por
    // su posición en el RMD evaluado. 4.4.2 comparte número en los dos
    // documentos, así que se empareja por id y sale una sola tarjeta.
    const orden = resultado.sugerenciasHomologacion.map((s) => s.seccionGeneral ?? s.pasoIdRmd ?? s.pasoIdReferencia);
    assert.deepEqual(orden, ["precauciones", "4.4.2", "4.4.3"]);

    const mismoNumeroOtroContenido = resultado.sugerenciasHomologacion.find((s) => s.pasoIdRmd === "4.4.2");
    assert.match(mismoNumeroOtroContenido?.justificacion ?? "", /casi no coincide/);
    assert.equal(mismoNumeroOtroContenido?.nivelConfianza, "baja");
  });

  it("compara precauciones, notas y condiciones ambientales", () => {
    const resultado = compararContraReferencia(
      rmd(pasosBase(), {
        precauciones: ["USAR EL UNIFORME COMPLETO"],
        notasImportantes: ["RESPETAR LOS TIEMPOS DE MEZCLA INDICADOS EN CADA PASO"],
        condicionesAmbientales: ["TEMPERATURA (15 C - 25 C)"],
      }),
      rmd(pasosBase(), {
        precauciones: ["USAR EL UNIFORME COMPLETO", "USAR PROTECTORES AUDITIVOS"],
        notasImportantes: ["RESPETAR ESTRICTAMENTE LOS TIEMPOS DE MEZCLA INDICADOS EN CADA PASO"],
        condicionesAmbientales: ["HUMEDAD RELATIVA (25 % - 40 %)"],
      })
    );

    const faltante = deTipo(resultado, "paso_faltante_en_rmd");
    assert.ok(
      faltante.some((s) => s.seccionGeneral === "precauciones" && /PROTECTORES/.test(s.textoEnReferencia ?? "")),
      "la precaución que falta debe reportarse con su sección"
    );
    assert.ok(
      deTipo(resultado, "redaccion_puede_homologarse").some((s) => s.seccionGeneral === "notas_importantes"),
      "la nota reescrita debe reportarse como redacción homologable"
    );
    // La condición ambiental es otra cosa, no una reescritura: agregada + sobrante.
    assert.ok(faltante.some((s) => s.seccionGeneral === "condiciones_ambientales"));
    assert.ok(
      deTipo(resultado, "paso_sobrante_en_rmd").some((s) => s.seccionGeneral === "condiciones_ambientales")
    );
  });

  it("marca el mismo equipo descrito distinto, pero no los equipos distintos", () => {
    const resultado = compararContraReferencia(
      rmd(pasosBase(), {
        equiposInstrumentos: [
          { descripcion: "MEZCLADORA DOBLE CONO", codigo: "10001704" },
          { descripcion: "EQUIPO PROPIO DE ESTE PRODUCTO", codigo: "99999999" },
        ],
      }),
      rmd(pasosBase(), {
        equiposInstrumentos: [
          { descripcion: "MEZCLADORA DE DOBLE CONO MPC-285", codigo: "10001704" },
          { descripcion: "OTRO EQUIPO DE LA REFERENCIA", codigo: "88888888" },
        ],
      })
    );

    const sugerencias = resultado.sugerenciasHomologacion.filter(
      (s) => s.seccionGeneral === "equipos_instrumentos"
    );
    assert.equal(sugerencias.length, 1, "sólo el código compartido con descripción distinta");
    assert.equal(sugerencias[0].tipo, "redaccion_puede_homologarse");
    assert.match(sugerencias[0].justificacion, /10001704 está descrito distinto/);
  });

  it("no reporta diferencias de insumos: cambian por fórmula", () => {
    const resultado = compararContraReferencia(
      rmd(pasosBase(), {
        insumos: [{ descripcion: "AZITROMICINA", codigo: "1000000370", cantidad: "50.000", um: "kg" }],
      }),
      rmd(pasosBase(), {
        insumos: [{ descripcion: "CLORFENAMINA", codigo: "1000000999", cantidad: "2.000", um: "kg" }],
      })
    );
    assert.deepEqual(resultado.sugerenciasHomologacion, []);
  });

  it("resume con el conteo por tipo y aclara que es determinístico", () => {
    const evaluado = [...pasosBase(), { id: "4.4.4", texto: "UN PASO EXTRA SIN EQUIVALENTE EN LA REFERENCIA" }];

    const resultado = compararContraReferencia(rmd(evaluado), rmd(pasosBase()));
    assert.match(resultado.resumenEjecutivo, /1 sin equivalente en la referencia/);
    assert.match(resultado.resumenEjecutivo, /Comparación determinística/);
    assert.equal(resultado.requiereRevisionHumana, true);
  });

  it("no revienta con documentos vacíos", () => {
    const resultado = compararContraReferencia(rmd([]), rmd([]));
    assert.deepEqual(resultado.sugerenciasHomologacion, []);
    assert.equal(resultado.gradoHomologacion, 100);
  });
});

describe("motor de diff", () => {
  it("cuenta el grado de coincidencia sobre los pasos", () => {
    const evaluado = [...pasosBase()];
    evaluado[0] = { id: "4.4.1", texto: "UN TEXTO COMPLETAMENTE DISTINTO PARA ESTE PASO" };

    const diff = compararRmd(rmd(evaluado), rmd(pasosBase()));
    // 2 de 3 pasos alineados.
    assert.equal(diff.gradoCoincidencia, 67);
  });

  it("empareja por id antes que por texto", () => {
    const diff = compararRmd(
      rmd([{ id: "4.4.1", texto: "TEXTO A" }]),
      rmd([{ id: "4.4.1", texto: "TEXTO B" }])
    );
    assert.equal(diff.pasos.length, 1);
    assert.equal(diff.pasos[0].emparejadoPor, "id");
    assert.equal(diff.pasos[0].textoIgual, false);
  });
});

describe("utilidades de comparación", () => {
  it("considera equivalentes textos que sólo difieren en forma", () => {
    assert.equal(textosEquivalentes("Mezclar  15 minutos", "MEZCLAR 15 MINUTOS"), true);
    assert.equal(textosEquivalentes("Fórmula", "FORMULA"), true);
    assert.equal(textosEquivalentes("Mezclar 15 minutos", "Mezclar 16 minutos"), false);
  });

  it("mide similitud por palabras compartidas", () => {
    assert.equal(similitudTextos("PESAR EL ACTIVO", "PESAR EL ACTIVO"), 1);
    assert.equal(similitudTextos("PESAR EL ACTIVO", "ENVASAR EN BLISTER"), 0);
    assert.ok(similitudTextos("CARGAR EN LA MEZCLADORA DOBLE CONO", "CARGAR EN LA MEZCLADORA DE DOBLE CONO") > 0.8);
  });

  it("encuentra los elementos fuera de orden y no marca los que están bien", () => {
    // Mismo orden: nada fuera de lugar.
    assert.deepEqual([...indicesFueraDeOrden([0, 1, 2, 3])], []);
    // El 0 al final: un solo elemento movido.
    assert.deepEqual([...indicesFueraDeOrden([1, 2, 3, 0])], [3]);
    // Invertido: la subsecuencia creciente más larga tiene 1 elemento.
    assert.equal(indicesFueraDeOrden([3, 2, 1, 0]).size, 3);
    assert.deepEqual([...indicesFueraDeOrden([])], []);
  });
});
