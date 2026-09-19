import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DiferenciaBorrador, ReglaHomologacion, RMDExtraido } from "@/types/rmd";
import {
  aDiferenciasBorrador,
  aDiscrepancias,
  detectarTerminosSinHomologar,
  separarReglas,
  type ReglaReemplazo,
} from "../reglasReemplazo";
import { diferenciasMecanicas, fusionarConMecanicas } from "../comparadorRmd/borrador";

function rmd(extra: Partial<RMDExtraido> = {}): RMDExtraido {
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
    procedimiento: [],
    documentosReferenciados: [],
    paginasSeccionesGenerales: {},
    ...extra,
  };
}

function regla(extra: Partial<ReglaHomologacion> = {}): ReglaHomologacion {
  return {
    id: "r1",
    texto: "homologar el nombre de la mezcladora",
    seccionCodigo: null,
    etapaCodigo: null,
    activa: true,
    tipo: "reemplazo_termino",
    terminoOrigen: "MEZCLADORA DOBLE CONO",
    terminoDestino: "MEZCLADORA DE DOBLE CONO",
    ...extra,
  };
}

const REEMPLAZO: ReglaReemplazo = {
  id: "r1",
  texto: "homologar el nombre de la mezcladora",
  terminoOrigen: "MEZCLADORA DOBLE CONO",
  terminoDestino: "MEZCLADORA DE DOBLE CONO",
};

describe("separarReglas", () => {
  it("manda al modelo sólo las reglas que necesitan interpretación", () => {
    const { libres, reemplazos } = separarReglas([
      regla(),
      regla({ id: "r2", tipo: "libre", terminoOrigen: null, terminoDestino: null, texto: "revisar criterio X" }),
    ]);

    assert.equal(reemplazos.length, 1);
    assert.equal(reemplazos[0].terminoOrigen, "MEZCLADORA DOBLE CONO");
    assert.equal(libres.length, 1);
    assert.equal(libres[0].id, "r2");
  });

  it("trata como libre una regla de reemplazo a la que le falta un término", () => {
    // Así nunca se pierde silenciosamente: si no se puede verificar por
    // búsqueda, al menos el modelo la ve.
    const { libres, reemplazos } = separarReglas([regla({ terminoDestino: "  " })]);
    assert.equal(reemplazos.length, 0);
    assert.equal(libres.length, 1);
  });

  it("trata como libre una regla sin tipo (las que ya existían)", () => {
    const { libres, reemplazos } = separarReglas([
      { id: "v", texto: "regla vieja", seccionCodigo: null, etapaCodigo: null, activa: true },
    ]);
    assert.equal(reemplazos.length, 0);
    assert.equal(libres.length, 1);
  });
});

describe("detectarTerminosSinHomologar", () => {
  it("encuentra el término en un paso y cita la frase, no el paso entero", () => {
    const hallazgos = detectarTerminosSinHomologar(
      rmd({
        procedimiento: [
          {
            id: "4.4.3",
            texto:
              "CARGAR EL PRODUCTO EN LA MEZCLADORA DOBLE CONO (MODELO MPC-285) Y MEZCLAR DURANTE 15 MINUTOS SEGUN INSTRUCTIVO",
            requiereVB: false,
          },
        ],
      }),
      [REEMPLAZO]
    );

    assert.equal(hallazgos.length, 1);
    assert.equal(hallazgos[0].pasoId, "4.4.3");
    assert.equal(hallazgos[0].ubicacion, "Paso 4.4.3");
    assert.match(hallazgos[0].cita, /MEZCLADORA DOBLE CONO/);
    assert.ok(hallazgos[0].cita.length < 160, "la cita debe ser una ventana, no el paso completo");
  });

  it("no coincide dentro de otra palabra", () => {
    const hallazgos = detectarTerminosSinHomologar(
      rmd({ procedimiento: [{ id: "4.4.1", texto: "TAMIZADO PREVIO DEL ACTIVO", requiereVB: false }] }),
      [{ id: "r", texto: "t", terminoOrigen: "TAMIZ", terminoDestino: "TAMIZ DE ACERO" }]
    );
    assert.deepEqual(hallazgos, []);
  });

  it("no marca el texto que ya está corregido cuando el término correcto contiene al viejo", () => {
    const reemplazo: ReglaReemplazo = {
      id: "r",
      texto: "t",
      terminoOrigen: "TAMIZ",
      terminoDestino: "TAMIZ DE ACERO",
    };

    const corregido = detectarTerminosSinHomologar(
      rmd({ procedimiento: [{ id: "4.4.1", texto: "PASAR POR TAMIZ DE ACERO N 20", requiereVB: false }] }),
      [reemplazo]
    );
    assert.deepEqual(corregido, [], "ya dice el término correcto: no hay nada que homologar");

    const sinCorregir = detectarTerminosSinHomologar(
      rmd({ procedimiento: [{ id: "4.4.1", texto: "PASAR POR TAMIZ N 20", requiereVB: false }] }),
      [reemplazo]
    );
    assert.equal(sinCorregir.length, 1);
  });

  it("ignora mayúsculas, tildes y espacios de más", () => {
    const hallazgos = detectarTerminosSinHomologar(
      rmd({ procedimiento: [{ id: "4.4.1", texto: "usar la mezcladora  doblé cono", requiereVB: false }] }),
      [REEMPLAZO]
    );
    assert.equal(hallazgos.length, 1);
  });

  it("trata los metacaracteres del término como texto literal", () => {
    const hallazgos = detectarTerminosSinHomologar(
      rmd({ procedimiento: [{ id: "4.4.1", texto: "USAR EL TAMIZ N° 20 (0.85 mm) LIMPIO", requiereVB: false }] }),
      [{ id: "r", texto: "t", terminoOrigen: "N° 20 (0.85 mm)", terminoDestino: "N° 20 (0.850 mm)" }]
    );
    assert.equal(hallazgos.length, 1);
    assert.match(hallazgos[0].cita, /N° 20 \(0\.85 mm\)/);
  });

  it("busca también en precauciones, notas, condiciones y equipos", () => {
    const hallazgos = detectarTerminosSinHomologar(
      rmd({
        precauciones: ["REVISAR LA MEZCLADORA DOBLE CONO ANTES DE USARLA"],
        notasImportantes: ["LA MEZCLADORA DOBLE CONO SE LIMPIA AL FINAL"],
        condicionesAmbientales: ["MEZCLADORA DOBLE CONO EN SALA CLIMATIZADA"],
        equiposInstrumentos: [{ descripcion: "MEZCLADORA DOBLE CONO MPC-285", codigo: "10001704" }],
      }),
      [REEMPLAZO]
    );

    assert.deepEqual(
      hallazgos.map((h) => h.seccionGeneral),
      ["precauciones", "notas_importantes", "condiciones_ambientales", "equipos_instrumentos"]
    );
    assert.match(hallazgos[3].ubicacion, /código 10001704/);
  });

  it("no hace nada si no hay reglas de reemplazo", () => {
    assert.deepEqual(
      detectarTerminosSinHomologar(
        rmd({ procedimiento: [{ id: "4.4.1", texto: "MEZCLADORA DOBLE CONO", requiereVB: false }] }),
        []
      ),
      []
    );
  });
});

describe("mapeo de los hallazgos de término a los contratos existentes", () => {
  const hallazgos = detectarTerminosSinHomologar(
    rmd({ procedimiento: [{ id: "4.4.3", texto: "CARGAR EN LA MEZCLADORA DOBLE CONO", requiereVB: false }] }),
    [REEMPLAZO]
  );

  it("como discrepancia para /api/revision", () => {
    const [discrepancia] = aDiscrepancias(hallazgos);
    assert.equal(discrepancia.tipoDiscrepancia, "termino_sin_homologar");
    assert.equal(discrepancia.pasoId, "4.4.3");
    assert.equal(discrepancia.nivelConfianza, "alta");
    assert.match(discrepancia.queExigeElControlDeCambios, /Debe decir "MEZCLADORA DE DOBLE CONO"/);
    assert.match(discrepancia.origenControlCambio, /^Regla permanente:/);
    assert.match(discrepancia.justificacion, /Verificación determinística/);
  });

  it("como diferencia de borrador, citando sólo la columna que corresponde", () => {
    const [enBorrador] = aDiferenciasBorrador(hallazgos, "borrador");
    assert.equal(enBorrador.tipoDiferencia, "termino_sin_homologar");
    assert.equal(enBorrador.pasoIdBorrador, "4.4.3");
    assert.equal(enBorrador.pasoIdVigente, null);
    assert.equal(enBorrador.textoEnVigente, null);
    assert.ok(enBorrador.textoEnBorrador);
    assert.match(enBorrador.ubicacionReferencia, /\(borrador\)$/);

    const [enVigente] = aDiferenciasBorrador(hallazgos, "vigente");
    assert.equal(enVigente.pasoIdVigente, "4.4.3");
    assert.equal(enVigente.textoEnBorrador, null);
  });
});

describe("diferencias mecánicas contra el borrador", () => {
  const vigente = rmd({
    procedimiento: [
      { id: "4.4.1", texto: "PESAR EL PRINCIPIO ACTIVO", requiereVB: false },
      { id: "4.4.2", texto: "TAMIZAR POR MALLA N 20", requiereVB: false },
      { id: "4.4.3", texto: "MEZCLAR DURANTE 15 MINUTOS", requiereVB: false },
    ],
    equiposInstrumentos: [{ descripcion: "BALANZA", codigo: "111" }],
    insumos: [{ descripcion: "ACTIVO", codigo: "AAA", cantidad: "1.000", um: "kg" }],
  });

  it("no reporta nada si los documentos son iguales", () => {
    const { diferencias, coincidenciaPorcentaje } = diferenciasMecanicas(vigente, vigente);
    assert.deepEqual(diferencias, []);
    assert.equal(coincidenciaPorcentaje, 100);
  });

  it("reporta paso agregado, eliminado, modificado y renumerado", () => {
    // 4.4.2 pasa a llamarse 4.4.9 con el mismo texto (renumerado), 4.4.3
    // cambia de texto (modificado) y 4.4.4 es nuevo (agregado). El número
    // viejo 4.4.2 NO lo ocupa otro paso: si lo ocupara, el emparejamiento por
    // id iría primero y eso se vería como modificado, no como renumerado.
    const borrador = rmd({
      procedimiento: [
        { id: "4.4.1", texto: "PESAR EL PRINCIPIO ACTIVO", requiereVB: false },
        { id: "4.4.9", texto: "TAMIZAR POR MALLA N 20", requiereVB: false },
        { id: "4.4.3", texto: "MEZCLAR DURANTE 20 MINUTOS", requiereVB: false },
        { id: "4.4.4", texto: "REGISTRAR EL RESULTADO EN EL FORMATO CORRESPONDIENTE", requiereVB: false },
      ],
      equiposInstrumentos: [{ descripcion: "BALANZA NUEVA", codigo: "222" }],
      insumos: [],
    });

    const { diferencias } = diferenciasMecanicas(vigente, borrador);
    const tipos = diferencias.map((d) => d.tipoDiferencia);

    assert.ok(tipos.includes("paso_renumerado"), "4.4.2 -> 4.4.9 con el mismo texto");
    assert.ok(tipos.includes("paso_modificado"), "4.4.3 cambió de texto entre documentos");
    assert.ok(tipos.includes("paso_agregado_en_borrador"), "4.4.4 es nuevo");
    assert.ok(tipos.includes("equipo_agregado"));
    assert.ok(tipos.includes("equipo_eliminado"));
    assert.ok(tipos.includes("insumo_eliminado"));

    const renumerado = diferencias.find((d) => d.tipoDiferencia === "paso_renumerado");
    assert.equal(renumerado?.pasoIdVigente, "4.4.2");
    assert.equal(renumerado?.pasoIdBorrador, "4.4.9");
    assert.match(renumerado?.ubicacionReferencia ?? "", /4\.4\.2 del vigente, 4\.4\.9 en el borrador/);
  });

  it("reporta el paso que el borrador ya no incluye", () => {
    const borrador = rmd({ procedimiento: vigente.procedimiento.slice(0, 2), equiposInstrumentos: vigente.equiposInstrumentos, insumos: vigente.insumos });
    const { diferencias } = diferenciasMecanicas(vigente, borrador);
    const eliminado = diferencias.find((d) => d.tipoDiferencia === "paso_eliminado_en_borrador");
    assert.equal(eliminado?.pasoIdVigente, "4.4.3");
    assert.equal(eliminado?.textoEnBorrador, null);
  });
});

describe("fusión con lo que reportó el modelo", () => {
  function delModelo(pasoId: string): DiferenciaBorrador {
    return {
      pasoIdVigente: pasoId,
      pasoIdBorrador: pasoId,
      seccionGeneral: null,
      ubicacionReferencia: `Paso ${pasoId}`,
      tipoDiferencia: "paso_modificado",
      textoEnVigente: "antes",
      textoEnBorrador: "después",
      justificacion: "lo vio el modelo",
      involucraEquipoRetirado: false,
      equiposMencionados: [],
      nivelConfianza: "alta",
      origenAnotacionInformal: false,
    };
  }

  const mecanicas: DiferenciaBorrador[] = [delModelo("4.4.1"), delModelo("4.4.7")];

  it("no duplica el punto que el modelo ya reportó", () => {
    const { diferencias, agregadas } = fusionarConMecanicas([delModelo("4.4.1")], mecanicas);
    assert.equal(agregadas, 1, "sólo se agrega 4.4.7");
    assert.equal(diferencias.length, 2);
    assert.equal(diferencias[1].pasoIdVigente, "4.4.7");
  });

  it("agrega todo cuando el modelo no reportó nada", () => {
    const { diferencias, agregadas } = fusionarConMecanicas([], mecanicas);
    assert.equal(agregadas, 2);
    assert.equal(diferencias.length, 2);
  });

  it("no agrega nada si el modelo ya cubrió todos los puntos", () => {
    const { agregadas } = fusionarConMecanicas(mecanicas, mecanicas);
    assert.equal(agregadas, 0);
  });
});
