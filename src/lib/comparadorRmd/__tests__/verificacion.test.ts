import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { HallazgoAVerificar, RMDExtraido } from "@/types/rmd";
import { verificarCorreccionDeterministica } from "../verificacion";

function rmdConPasos(pasos: Array<{ id: string; texto: string }>): RMDExtraido {
  return {
    encabezado: {
      producto: "PRODUCTO X 10mg TAB",
      codigo: "5000000000",
      versionFabAlt: "2002/1",
      edicionRegManuf: 2,
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
    procedimiento: pasos.map((p) => ({ ...p, requiereVB: false })),
    documentosReferenciados: [],
    paginasSeccionesGenerales: {},
  };
}

function hallazgo(extra: Partial<HallazgoAVerificar> = {}): HallazgoAVerificar {
  return {
    id: 0,
    ubicacionReferencia: "Sección 4.4, paso de mezcla",
    descripcion: "paso_debe_modificarse: el CC exige 20 minutos de mezcla",
    pasoId: "4.4.3",
    textoVigente: "MEZCLAR DURANTE 15 MINUTOS",
    ...extra,
  };
}

describe("verificación determinística de correcciones", () => {
  it("marca como NO resuelto el hallazgo cuyo texto sigue textualmente igual", () => {
    const { resultado, noVerificables } = verificarCorreccionDeterministica(
      rmdConPasos([{ id: "4.4.3", texto: "CARGAR Y MEZCLAR DURANTE 15 MINUTOS EN LA MEZCLADORA" }]),
      [hallazgo()]
    );

    assert.equal(resultado.verificaciones.length, 1);
    assert.equal(resultado.verificaciones[0].resuelto, false);
    assert.match(resultado.verificaciones[0].justificacion, /sigue diciendo textualmente/);
    assert.deepEqual(noVerificables, []);
  });

  it("marca como resuelto cuando el texto observado ya no está, y muestra qué dice ahora", () => {
    const { resultado } = verificarCorreccionDeterministica(
      rmdConPasos([{ id: "4.4.3", texto: "CARGAR Y MEZCLAR DURANTE 20 MINUTOS EN LA MEZCLADORA" }]),
      [hallazgo()]
    );

    assert.equal(resultado.verificaciones[0].resuelto, true);
    // La evidencia es el texto nuevo, no una opinión sobre si cumple.
    assert.match(resultado.verificaciones[0].justificacion, /Ahora dice: "CARGAR Y MEZCLAR DURANTE 20 MINUTOS/);
  });

  it("no se deja engañar por mayúsculas, tildes ni espacios", () => {
    const { resultado } = verificarCorreccionDeterministica(
      rmdConPasos([{ id: "4.4.3", texto: "Cargar y  mezclar durante 15 minutos en la mezcladóra" }]),
      [hallazgo()]
    );
    // El texto es el mismo con otra forma: el hallazgo sigue sin corregirse.
    assert.equal(resultado.verificaciones[0].resuelto, false);
  });

  it("avisa cuando el paso desapareció del documento corregido", () => {
    const { resultado } = verificarCorreccionDeterministica(
      rmdConPasos([{ id: "4.4.1", texto: "OTRO PASO SIN RELACION" }]),
      [hallazgo()]
    );

    assert.equal(resultado.verificaciones[0].resuelto, false);
    assert.match(resultado.verificaciones[0].justificacion, /ya no existe/);
    assert.match(resultado.verificaciones[0].justificacion, /confirmalo a mano/);
  });

  it("detecta que el paso se renumeró en vez de corregirse", () => {
    const { resultado } = verificarCorreccionDeterministica(
      rmdConPasos([{ id: "4.4.7", texto: "CARGAR Y MEZCLAR DURANTE 15 MINUTOS EN LA MEZCLADORA" }]),
      [hallazgo()]
    );

    assert.equal(resultado.verificaciones[0].resuelto, false);
    assert.match(resultado.verificaciones[0].justificacion, /se renumeró en vez de corregirse/);
    assert.match(resultado.verificaciones[0].justificacion, /paso 4\.4\.7/);
  });

  it("detecta que el texto se movió a otro paso en vez de corregirse", () => {
    const { resultado } = verificarCorreccionDeterministica(
      rmdConPasos([
        { id: "4.4.3", texto: "CARGAR EN LA MEZCLADORA" },
        { id: "4.4.4", texto: "MEZCLAR DURANTE 15 MINUTOS" },
      ]),
      [hallazgo()]
    );

    assert.equal(resultado.verificaciones[0].resuelto, false);
    assert.match(resultado.verificaciones[0].justificacion, /se movió en vez de corregirse/);
  });

  it("no puede verificar un hallazgo sin paso o sin cita, y lo dice", () => {
    const casos: HallazgoAVerificar[] = [
      hallazgo({ id: 1, pasoId: null }),
      hallazgo({ id: 2, pasoId: "N/A" }),
      hallazgo({ id: 3, textoVigente: null }),
      hallazgo({ id: 4, textoVigente: "   " }),
    ];

    const { resultado, noVerificables } = verificarCorreccionDeterministica(
      rmdConPasos([{ id: "4.4.3", texto: "MEZCLAR DURANTE 20 MINUTOS" }]),
      casos
    );

    assert.equal(noVerificables.length, 4);
    for (const verificacion of resultado.verificaciones) {
      assert.equal(verificacion.resuelto, false);
      assert.match(verificacion.justificacion, /No se puede verificar automáticamente/);
    }
    assert.match(resultado.resumenVerificacion, /4 sin un paso y una cita para buscar/);
  });

  it("conserva el id de cada hallazgo para poder reenlazarlo con su tarjeta", () => {
    const { resultado } = verificarCorreccionDeterministica(
      rmdConPasos([{ id: "4.4.3", texto: "MEZCLAR DURANTE 20 MINUTOS" }]),
      [hallazgo({ id: 7 }), hallazgo({ id: 11, pasoId: "9.9.9" })]
    );

    assert.deepEqual(
      resultado.verificaciones.map((v) => v.id),
      [7, 11]
    );
  });

  it("resume el conteo y aclara el alcance de la verificación", () => {
    const { resultado } = verificarCorreccionDeterministica(
      rmdConPasos([
        { id: "4.4.3", texto: "MEZCLAR DURANTE 20 MINUTOS" },
        { id: "4.4.5", texto: "TAMIZAR POR MALLA N 20" },
      ]),
      [hallazgo({ id: 0 }), hallazgo({ id: 1, pasoId: "4.4.5", textoVigente: "TAMIZAR POR MALLA N 20" })]
    );

    assert.match(resultado.resumenVerificacion, /^1 de 2 observación\(es\)/);
    assert.match(resultado.resumenVerificacion, /no si la redacción nueva cumple/);
  });
});
