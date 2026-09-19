import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AlertaCoherencia, RMDExtraido } from "@/types/rmd";
import {
  aCantidad,
  detectarAlertasCoherencia,
  detectarCantidadesQueNoCuadran,
  detectarCitasInternasRotas,
  detectarEquiposSinPreparacion,
  detectarNotaVbFaltante,
} from "../coherenciaRmd";

interface PasoSpec {
  id: string;
  texto: string;
  requiereVB?: boolean;
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
    procedimiento: pasos.map((p) => ({
      id: p.id,
      texto: p.texto,
      requiereVB: p.requiereVB ?? false,
    })),
    documentosReferenciados: [],
    paginasSeccionesGenerales: {},
    ...extra,
  };
}

const NOTA_VB =
  "NOTA: EL JEFE O SUPERVISOR DE LA SECCION DEBE VERIFICAR PRESENCIALMENTE LA ACTIVIDAD U OPERACION REALIZADA";

describe("citas internas a pasos que no existen", () => {
  it("no alerta cuando el paso citado existe", () => {
    const alertas = detectarCitasInternasRotas(
      rmd([
        { id: "4.2.5", texto: "PREPARAR LA BALANZA CALIBRADA" },
        { id: "4.3.2", texto: "USAR LA BALANZA PREPARADA EN EL PASO 4.2.5" },
      ])
    );
    assert.deepEqual(alertas, []);
  });

  it("alerta cuando el paso citado no existe y cita el fragmento exacto", () => {
    const alertas = detectarCitasInternasRotas(
      rmd([
        { id: "4.2.6", texto: "PREPARAR LA BALANZA CALIBRADA" },
        { id: "4.3.2", texto: "USAR LA BALANZA PREPARADA EN EL PASO 4.2.5" },
      ])
    );

    assert.equal(alertas.length, 1);
    assert.equal(alertas[0].tipo, "referencia_cruzada_rota");
    assert.equal(alertas[0].severidad, "alta");
    assert.equal(alertas[0].pasoId, "4.3.2");
    assert.deepEqual(alertas[0].pasosAfectados, ["4.3.2"]);
    assert.equal(alertas[0].citaTextual, "PASO 4.2.5");
    assert.match(alertas[0].descripcion, /cita al paso 4\.2\.5, que no existe/);
  });

  it("acepta la cita a una subsección que sí tiene pasos", () => {
    // "según la sección 4.2" no es una cita rota: 4.2 no es un paso, pero
    // 4.2.1 existe.
    const alertas = detectarCitasInternasRotas(
      rmd([
        { id: "4.2.1", texto: "PREPARAR EL EQUIPO" },
        { id: "4.3.1", texto: "PROCEDER SEGUN EL NUMERAL 4.2" },
      ])
    );
    assert.deepEqual(alertas, []);
  });

  it("reconoce las variantes paso / numeral / punto / ítem", () => {
    const alertas = detectarCitasInternasRotas(
      rmd([
        { id: "4.1.1", texto: "VER EL PASO 9.9.9" },
        { id: "4.1.2", texto: "VER EL NUMERAL 9.9.8" },
        { id: "4.1.3", texto: "VER EL PUNTO 9.9.7" },
        { id: "4.1.4", texto: "VER EL ÍTEM 9.9.6" },
      ])
    );
    assert.equal(alertas.length, 4);
  });

  it("no confunde un número cualquiera con una cita", () => {
    const alertas = detectarCitasInternasRotas(
      rmd([
        { id: "4.1.1", texto: "MEZCLAR 15.5 MINUTOS A 1.200 RPM SEGUN ISOL-E204 VIGENTE" },
      ])
    );
    assert.deepEqual(alertas, []);
  });

  it("no repite la misma cita rota dos veces en el mismo paso", () => {
    const alertas = detectarCitasInternasRotas(
      rmd([{ id: "4.1.1", texto: "VER EL PASO 9.9.9 Y TAMBIEN EL PASO 9.9.9" }])
    );
    assert.equal(alertas.length, 1);
  });
});

describe("equipos listados que no se preparan", () => {
  const equipos = [
    { descripcion: "MOLINO FITZ MILL", codigo: "10001704" },
    { descripcion: "MEZCLADORA DOBLE CONO (MODELO: MPC - 285)", codigo: "10002000" },
  ];

  it("no alerta si el equipo se menciona por su descripción", () => {
    const alertas = detectarEquiposSinPreparacion(
      rmd(
        [
          { id: "4.2.1", texto: "PREPARAR EL MOLINO FITZ MILL N 1 SEGUN INSTRUCTIVO" },
          { id: "4.2.2", texto: "PREPARAR LA MEZCLADORA DOBLE CONO SEGUN INSTRUCTIVO" },
        ],
        { equiposInstrumentos: equipos }
      )
    );
    assert.deepEqual(alertas, []);
  });

  it("no alerta si el equipo se menciona por su código", () => {
    const alertas = detectarEquiposSinPreparacion(
      rmd(
        [
          { id: "4.2.1", texto: "PREPARAR EL EQUIPO 10001704 SEGUN INSTRUCTIVO" },
          { id: "4.2.2", texto: "PREPARAR EL EQUIPO 10002000 SEGUN INSTRUCTIVO" },
        ],
        { equiposInstrumentos: equipos }
      )
    );
    assert.deepEqual(alertas, []);
  });

  it("alerta sobre el equipo que no aparece en ningún paso", () => {
    const alertas = detectarEquiposSinPreparacion(
      rmd([{ id: "4.2.1", texto: "PREPARAR EL MOLINO FITZ MILL N 1" }], {
        equiposInstrumentos: equipos,
      })
    );

    assert.equal(alertas.length, 1);
    assert.equal(alertas[0].tipo, "equipo_sin_preparacion_registrada");
    assert.equal(alertas[0].seccionGeneral, "equipos_instrumentos");
    assert.equal(alertas[0].pasoId, null);
    assert.equal(alertas[0].citaTextual, "10002000");
    assert.match(alertas[0].descripcion, /MEZCLADORA DOBLE CONO/);
  });

  it("distingue el origen cuando se comparan dos documentos", () => {
    const alertas = detectarEquiposSinPreparacion(
      rmd([{ id: "4.2.1", texto: "UN PASO CUALQUIERA" }], { equiposInstrumentos: [equipos[0]] }),
      "borrador de Producción"
    );
    assert.match(alertas[0].descripcion, /del borrador de Producción/);
  });

  it("no alerta sobre una descripción sin palabras con las que reconocerla", () => {
    const alertas = detectarEquiposSinPreparacion(
      rmd([{ id: "4.2.1", texto: "UN PASO" }], {
        equiposInstrumentos: [{ descripcion: "DEL - / TIPO", codigo: "" }],
      })
    );
    assert.deepEqual(alertas, []);
  });
});

describe("nota de verificación presencial cuando el paso exige V°B°", () => {
  it("no alerta si la nota está", () => {
    const alertas = detectarNotaVbFaltante(
      rmd([{ id: "4.4.1", texto: `COMPRIMIR EL PRODUCTO. ${NOTA_VB}`, requiereVB: true }])
    );
    assert.deepEqual(alertas, []);
  });

  it("alerta si el paso exige V°B° y no tiene la nota", () => {
    const alertas = detectarNotaVbFaltante(
      rmd([{ id: "4.4.1", texto: "COMPRIMIR EL PRODUCTO SEGUN ESPECIFICACIONES", requiereVB: true }])
    );

    assert.equal(alertas.length, 1);
    assert.equal(alertas[0].tipo, "nota_vb_faltante");
    assert.equal(alertas[0].pasoId, "4.4.1");
    assert.match(alertas[0].descripcion, /no incluye la nota de verificación presencial/);
  });

  it("acepta una redacción equivalente de la nota", () => {
    const alertas = detectarNotaVbFaltante(
      rmd([
        {
          id: "4.4.1",
          texto: "COMPRIMIR. EL SUPERVISOR DEBE CONSTATAR PRESENCIALMENTE LA OPERACION.",
          requiereVB: true,
        },
      ])
    );
    assert.deepEqual(alertas, []);
  });

  it("no alerta si el paso no exige V°B°", () => {
    const alertas = detectarNotaVbFaltante(
      rmd([{ id: "4.4.1", texto: "COMPRIMIR EL PRODUCTO", requiereVB: false }])
    );
    assert.deepEqual(alertas, []);
  });
});

describe("cuadre de cantidades de insumos", () => {
  const talco = { descripcion: "TALCO", codigo: "1000000972", cantidad: "8.000", um: "kg" };

  it("no alerta cuando la suma del procedimiento cuadra con la sección 2", () => {
    const alertas = detectarCantidadesQueNoCuadran(
      rmd(
        [
          { id: "4.4.1", texto: "PESAR 4.000 KG DE TALCO" },
          { id: "4.4.5", texto: "AGREGAR 4.000 KG DE TALCO A LA MEZCLA" },
        ],
        { insumos: [talco] }
      )
    );
    assert.deepEqual(alertas, []);
  });

  it("alerta cuando la suma no cuadra, con los dos números a la vista", () => {
    const alertas = detectarCantidadesQueNoCuadran(
      rmd(
        [
          { id: "4.4.1", texto: "PESAR 4.000 KG DE TALCO" },
          { id: "4.4.5", texto: "AGREGAR 2.000 KG DE TALCO A LA MEZCLA" },
        ],
        { insumos: [talco] }
      )
    );

    assert.equal(alertas.length, 1);
    assert.equal(alertas[0].tipo, "cantidad_insumo_no_cuadra");
    assert.equal(alertas[0].severidad, "alta");
    assert.deepEqual(alertas[0].pasosAfectados, ["4.4.1", "4.4.5"]);
    assert.match(alertas[0].descripcion, /suma 6\.000 kg/);
    assert.match(alertas[0].descripcion, /declara 8\.000 kg/);
    assert.match(alertas[0].descripcion, /25\.0%/);
  });

  it("convierte unidades antes de comparar", () => {
    const alertas = detectarCantidadesQueNoCuadran(
      rmd(
        [
          { id: "4.4.1", texto: "PESAR 4000 G DE TALCO" },
          { id: "4.4.5", texto: "AGREGAR 4000 G DE TALCO" },
        ],
        { insumos: [talco] }
      )
    );
    assert.deepEqual(alertas, [], "8000 g son los 8.000 kg declarados");
  });

  it("tolera una diferencia de redondeo de hasta 0,5%", () => {
    const alertas = detectarCantidadesQueNoCuadran(
      rmd([{ id: "4.4.1", texto: "PESAR 7.990 KG DE TALCO" }], { insumos: [talco] })
    );
    assert.deepEqual(alertas, [], "7,99 contra 8 es 0,125%: dentro de la tolerancia");
  });

  it("se abstiene si algún paso menciona el insumo sin cantidad", () => {
    // El prompt original decía lo mismo: si el procedimiento sólo dice
    // "agregar" sin número, no se puede sumar y no se reporta.
    const alertas = detectarCantidadesQueNoCuadran(
      rmd(
        [
          { id: "4.4.1", texto: "PESAR 4.000 KG DE TALCO" },
          { id: "4.4.5", texto: "AGREGAR EL TALCO RESTANTE A LA MEZCLA" },
        ],
        { insumos: [talco] }
      )
    );
    assert.deepEqual(alertas, []);
  });

  it("se abstiene si un paso menciona dos insumos a la vez", () => {
    const alertas = detectarCantidadesQueNoCuadran(
      rmd([{ id: "4.4.1", texto: "PESAR 4.000 KG DE TALCO Y 2.000 KG DE ESTEARATO" }], {
        insumos: [
          talco,
          { descripcion: "ESTEARATO", codigo: "1000000949", cantidad: "2.000", um: "kg" },
        ],
      })
    );
    assert.deepEqual(alertas, []);
  });

  it("se abstiene si un paso trae dos cantidades de la misma dimensión", () => {
    const alertas = detectarCantidadesQueNoCuadran(
      rmd([{ id: "4.4.1", texto: "PESAR 4.000 KG DE TALCO EN UN RECIPIENTE DE 2.000 KG" }], {
        insumos: [talco],
      })
    );
    assert.deepEqual(alertas, []);
  });

  it("no cuenta una unidad compuesta como si fuera una masa", () => {
    // Si "34 KG/CM2" se contara como 34 kg, el paso tendría dos cantidades y
    // el insumo se descartaría sin alerta. Que la alerta aparezca prueba que
    // sólo se contó la cantidad real.
    const alertas = detectarCantidadesQueNoCuadran(
      rmd(
        [
          {
            id: "4.4.1",
            texto: "PESAR 10.000 KG DE TALCO Y AJUSTAR LA PRESION HIDRAULICA A 34 KG/CM2",
          },
        ],
        { insumos: [{ ...talco, cantidad: "44.000" }] }
      )
    );

    assert.equal(alertas.length, 1);
    assert.match(alertas[0].descripcion, /suma 10\.000 kg/);
  });

  it("ignora los insumos cuya unidad no se reconoce", () => {
    const alertas = detectarCantidadesQueNoCuadran(
      rmd([{ id: "4.4.1", texto: "USAR 5 UNIDADES DE LA ETIQUETA" }], {
        insumos: [{ descripcion: "ETIQUETA", codigo: "E1", cantidad: "1000", um: "UN" }],
      })
    );
    assert.deepEqual(alertas, []);
  });
});

describe("aCantidad", () => {
  it("lee el punto como separador decimal, que es la convención del RMD", () => {
    // "# Decimales = 3" en la configuración de los campos de insumo: "5.250 kg"
    // son 5,25 kg y no 5250 kg.
    assert.equal(aCantidad("5.250"), 5.25);
    assert.equal(aCantidad("50.000"), 50);
    assert.equal(aCantidad("2500"), 2500);
    assert.equal(aCantidad("5,250"), 5.25);
    assert.equal(aCantidad("no es número"), null);
    assert.equal(aCantidad(""), null);
  });
});

describe("las cuatro verificaciones juntas", () => {
  it("devuelve un solo listado y no se pisan entre sí", () => {
    const alertas: AlertaCoherencia[] = detectarAlertasCoherencia(
      rmd(
        [
          { id: "4.2.1", texto: "PREPARAR EL MOLINO FITZ MILL" },
          { id: "4.4.1", texto: "PESAR 4.000 KG DE TALCO SEGUN EL PASO 9.9.9", requiereVB: true },
        ],
        {
          equiposInstrumentos: [{ descripcion: "BALANZA ANALITICA", codigo: "999" }],
          insumos: [{ descripcion: "TALCO", codigo: "T1", cantidad: "8.000", um: "kg" }],
        }
      )
    );

    const tipos = alertas.map((a) => a.tipo).sort();
    assert.deepEqual(tipos, [
      "cantidad_insumo_no_cuadra",
      "equipo_sin_preparacion_registrada",
      "nota_vb_faltante",
      "referencia_cruzada_rota",
    ]);
  });

  it("no devuelve nada sobre un documento vacío", () => {
    assert.deepEqual(detectarAlertasCoherencia(rmd([])), []);
  });
});
