import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { huellaEntrada } from "../cacheRevisiones";
import { decidirAdjuntarPdfRmd } from "../adjuntarPdf";
import { acotarMaestroEquipos } from "../maestroEquipos";
import type { RMDExtraido } from "@/types/rmd";

// Las dos piezas que bajan el consumo de cuota sin cambiar lo que el modelo
// devuelve: la huella con la que se reconoce una entrada ya analizada, y la
// decisión de adjuntar o no el PDF crudo.

/** RMD parseado completo: el caso en que el PDF no hace falta. */
function rmdCompleto(): RMDExtraido {
  return {
    encabezado: {
      producto: "TRI AZIT 500mg TAB NUC",
      codigo: "5000002229",
      versionFabAlt: "2002/2",
      edicionRegManuf: 6,
      estado: "Autorizado",
      fechaEstado: "2026-01-15",
      autorizadoPor: "QA",
      teorico: "100000 TAB",
    },
    precauciones: ["USAR EL UNIFORME COMPLETO"],
    notasImportantes: ["RESPETAR LAS TEMPERATURAS INDICADAS"],
    equiposInstrumentos: [{ descripcion: "MOLINO FITZ MILL", codigo: "10001704" }],
    insumos: [{ descripcion: "AZITROMICINA", codigo: "1000000370", cantidad: "50.000", um: "kg" }],
    condicionesAmbientales: ["TEMPERATURA (15 °C - 25 °C)"],
    procedimiento: Array.from({ length: 20 }, (_, i) => ({
      id: `4.4.${i + 1}`,
      texto: `PASO NUMERO ${i + 1} CON TEXTO SUFICIENTEMENTE LARGO PARA SER REAL`,
      requiereVB: false,
    })),
    documentosReferenciados: [{ codigo: "IPRO-P212", tipo: "Instructivo", area: "PRO" }],
    paginasSeccionesGenerales: {},
  };
}

describe("huellaEntrada", () => {
  it("da la misma huella para la misma entrada, sin importar el orden de las claves", () => {
    const a = huellaEntrada({ rmd: { pasos: 3, producto: "X" }, reglas: [] });
    const b = huellaEntrada({ reglas: [], rmd: { producto: "X", pasos: 3 } });
    assert.equal(a, b);
  });

  it("cambia si cambia cualquier parte de la entrada", () => {
    const base = { rmd: rmdCompleto(), reglas: [], cc: "cambiar el paso 4.4.3" };
    const huella = huellaEntrada(base);

    assert.notEqual(huella, huellaEntrada({ ...base, cc: "cambiar el paso 4.4.4" }));
    assert.notEqual(huella, huellaEntrada({ ...base, reglas: [{ id: "r1", texto: "X por Y" }] }));
  });

  it("distingue maestros distintos que llegan como Map", () => {
    // Object.entries() de un Map devuelve siempre [], así que sin tratar el
    // Map aparte dos maestros distintos hashearían igual y la caché
    // devolvería el resultado de otro documento.
    const vacio = new Map<string, unknown>();
    const conUno = new Map<string, unknown>([["FPRO-201", { vigenteHasta: "2026-01-01" }]]);
    const conOtro = new Map<string, unknown>([["FPRO-201", { vigenteHasta: "2027-01-01" }]]);

    const h1 = huellaEntrada({ documentosVigentes: vacio });
    const h2 = huellaEntrada({ documentosVigentes: conUno });
    const h3 = huellaEntrada({ documentosVigentes: conOtro });

    assert.notEqual(h1, h2);
    assert.notEqual(h2, h3);
  });

  it("ignora el orden en que el maestro vino de la consulta", () => {
    // El orden de inserción de un Map depende del orden de filas que devolvió
    // Supabase, que no está garantizado: no puede cambiar la huella.
    const unOrden = new Map([
      ["A", 1],
      ["B", 2],
    ]);
    const otroOrden = new Map([
      ["B", 2],
      ["A", 1],
    ]);
    assert.equal(
      huellaEntrada({ maestro: unOrden }),
      huellaEntrada({ maestro: otroOrden })
    );
  });

  it("trata undefined y una clave ausente como lo mismo", () => {
    assert.equal(huellaEntrada({ a: 1, b: undefined }), huellaEntrada({ a: 1 }));
  });

  it("no confunde un null con un string vacío ni con un cero", () => {
    const conNull = huellaEntrada({ cc: null });
    assert.notEqual(conNull, huellaEntrada({ cc: "" }));
    assert.notEqual(conNull, huellaEntrada({ cc: 0 }));
  });
});

describe("decidirAdjuntarPdfRmd", () => {
  it("no adjunta el PDF cuando el parseo trajo todo", () => {
    const decision = decidirAdjuntarPdfRmd(rmdCompleto());
    assert.equal(decision.adjuntar, false);
    assert.match(decision.motivo, /20 pasos y todas las secciones esperadas/);
  });

  it("adjunta el PDF si se detectaron pocos pasos", () => {
    const rmd = rmdCompleto();
    rmd.procedimiento = rmd.procedimiento.slice(0, 5);
    const decision = decidirAdjuntarPdfRmd(rmd);
    assert.equal(decision.adjuntar, true);
    assert.match(decision.motivo, /sólo 5 pasos/);
  });

  it("adjunta el PDF si falta cualquiera de las secciones esperadas", () => {
    for (const campo of [
      "equiposInstrumentos",
      "insumos",
      "precauciones",
      "notasImportantes",
      "condicionesAmbientales",
    ] as const) {
      const rmd = rmdCompleto();
      (rmd[campo] as unknown[]) = [];
      const decision = decidirAdjuntarPdfRmd(rmd);
      assert.equal(decision.adjuntar, true, `debería adjuntar si falta ${campo}`);
    }
  });

  it("adjunta el PDF si muchos pasos quedaron con texto sospechosamente corto", () => {
    const rmd = rmdCompleto();
    // 5 de 20 (25%) por encima del 15% que se tolera.
    for (let i = 0; i < 5; i++) rmd.procedimiento[i].texto = "OK";
    const decision = decidirAdjuntarPdfRmd(rmd);
    assert.equal(decision.adjuntar, true);
    assert.match(decision.motivo, /5 de 20 pasos con texto muy corto/);
  });

  it("tolera algún paso corto aislado sin mandar el PDF", () => {
    const rmd = rmdCompleto();
    // 2 de 20 (10%) está dentro de lo esperable: hay pasos que son un título.
    rmd.procedimiento[0].texto = "OK";
    rmd.procedimiento[1].texto = "SI";
    assert.equal(decidirAdjuntarPdfRmd(rmd).adjuntar, false);
  });

  it("adjunta siempre si el analista pidió análisis a fondo", () => {
    const decision = decidirAdjuntarPdfRmd(rmdCompleto(), true);
    assert.equal(decision.adjuntar, true);
    assert.match(decision.motivo, /explícitamente/);
  });
});

describe("acotarMaestroEquipos", () => {
  /** Maestro grande: por debajo del umbral no se acota nada. */
  function maestroDe(cantidadActivos: number, retirados: string[] = []) {
    return [
      ...retirados.map((descripcion, i) => ({
        codigo: `R${i}`,
        descripcion,
        activo: false,
      })),
      ...Array.from({ length: cantidadActivos }, (_, i) => ({
        codigo: `A${i}`,
        descripcion: `EQUIPO AJENO NUMERO ${i} DE OTRA LINEA`,
        activo: true,
      })),
    ];
  }

  it("no toca un maestro chico: mismo comportamiento que antes", () => {
    const maestro = maestroDe(10);
    const { equipos, omitidos } = acotarMaestroEquipos(maestro, [rmdCompleto()]);
    assert.equal(omitidos, 0);
    assert.deepEqual(equipos, maestro);
  });

  it("en un maestro grande conserva TODOS los retirados", () => {
    // Son los que la regla 4 del prompt necesita para marcar
    // involucraEquipoRetirado: nunca se pueden acotar.
    const maestro = maestroDe(80, ["BOMBO VIEJO", "ENCAPSULADORA RETIRADA"]);
    const { equipos } = acotarMaestroEquipos(maestro, [rmdCompleto()]);

    const retirados = equipos.filter((e) => !e.activo);
    assert.equal(retirados.length, 2);
  });

  it("conserva el activo que el documento menciona y deja afuera el resto", () => {
    const maestro = [
      ...maestroDe(80),
      { codigo: "10001704", descripcion: "MOLINO FITZ MILL", activo: true },
    ];
    const rmd = rmdCompleto();
    rmd.procedimiento[0].texto = "PREPARAR EL MOLINO FITZ MILL SEGUN INSTRUCTIVO ISOL-E202";

    const { equipos, omitidos } = acotarMaestroEquipos(maestro, [rmd]);
    const codigos = equipos.map((e) => e.codigo);

    assert.ok(codigos.includes("10001704"), "el equipo mencionado tiene que llegar al prompt");
    assert.equal(omitidos, 80, "los 80 equipos ajenos no viajan");
  });

  it("conserva el activo citado por su código en un paso", () => {
    const maestro = [
      ...maestroDe(80),
      { codigo: "99887766", descripcion: "UN NOMBRE QUE EL PASO NO USA", activo: true },
    ];
    const rmd = rmdCompleto();
    rmd.procedimiento[0].texto = "PREPARAR EL EQUIPO 99887766 ANTES DE INICIAR EL PROCESO";

    const { equipos } = acotarMaestroEquipos(maestro, [rmd]);
    assert.ok(equipos.some((e) => e.codigo === "99887766"));
  });

  it("conserva el activo que menciona el Control de Cambios aunque no esté en el RMD", () => {
    // Si el CC pide agregar un equipo que el RMD todavía no tiene, ese equipo
    // tiene que llegar al prompt para que el modelo no le invente el código.
    const maestro = [
      ...maestroDe(80),
      { codigo: "55554444", descripcion: "CODIFICADORA DOMINO A200", activo: true },
    ];

    const { equipos } = acotarMaestroEquipos(
      maestro,
      [rmdCompleto()],
      ["Instalar la CODIFICADORA DOMINO A200 en la línea de envase."]
    );
    assert.ok(equipos.some((e) => e.codigo === "55554444"));
  });

  it("tolera documentos ausentes", () => {
    const { equipos } = acotarMaestroEquipos(maestroDe(80), [undefined], [undefined]);
    assert.equal(equipos.length, 0, "sin documento no hay activo relevante, y no hay retirados");
  });
});
