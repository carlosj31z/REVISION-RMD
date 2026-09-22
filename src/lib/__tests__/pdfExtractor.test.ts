import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsearEstructuraRMD } from "../pdfExtractor";

// Construye un texto mínimo de RMD (encabezado + un paso de procedimiento que
// cita el código) para poder correr parsearEstructuraRMD de punta a punta,
// igual que lo vería el parseo real de un PDF.
function textoConCita(codigo: string): string {
  return [
    "REGISTRO DE MANUFACTURA FABRICACION",
    "PRODUCTO X 10mg TAB",
    "Orden",
    "4.-PROCEDIMIENTO",
    `4.1.-Verificar que se use el formato ${codigo} antes de iniciar.`,
    "6.-VERIFICACION DE FIRMAS",
  ].join("\n");
}

describe("extraerDocumentosReferenciados (vía parsearEstructuraRMD)", () => {
  it("reconoce áreas de 3 letras (caso histórico)", () => {
    const { documentosReferenciados } = parsearEstructuraRMD(textoConCita("FACO-200"), []);
    assert.equal(documentosReferenciados.length, 1);
    assert.deepEqual(documentosReferenciados[0], {
      codigo: "FACO-200",
      tipo: "Formato",
      area: "ACO",
      pasoId: "4.1",
    });
  });

  it("reconoce áreas con dígito en la 3ª posición (GV1/GV2/PV1/PV2, reales del maestro de Documentos vigentes)", () => {
    // Ejemplos reales tomados de la Lista de Documentos: "Gran Volumen 1"
    // (GV1) y "Línea de Gotas Oftálmicas y Línea de Bolsas" (PV2).
    const casos: { codigo: string; tipo: "Formato" | "Instructivo" | "Procedimiento"; area: string }[] = [
      { codigo: "FGV1-203", tipo: "Formato", area: "GV1" },
      { codigo: "IGV1-E201", tipo: "Instructivo", area: "GV1" },
      { codigo: "PPV2-200", tipo: "Procedimiento", area: "PV2" },
    ];
    for (const caso of casos) {
      const { documentosReferenciados } = parsearEstructuraRMD(textoConCita(caso.codigo), []);
      assert.equal(documentosReferenciados.length, 1, `no se reconoció ${caso.codigo}`);
      assert.equal(documentosReferenciados[0].codigo, caso.codigo);
      assert.equal(documentosReferenciados[0].tipo, caso.tipo);
      assert.equal(documentosReferenciados[0].area, caso.area);
    }
  });

  it("el dígito de área sólo se admite en la 3ª posición, no en la 1ª/2ª", () => {
    // "F1RO-200"/"FP1O-200" no son códigos reales del maestro — si esto
    // empezara a matchear sería un indicio de que la regex se relajó de más.
    const { documentosReferenciados } = parsearEstructuraRMD(
      textoConCita("F1RO-200") + "\n" + textoConCita("FP1O-201"),
      []
    );
    assert.equal(documentosReferenciados.length, 0);
  });

  it("no confunde POL/M (fuera de alcance) con I/P/F", () => {
    const { documentosReferenciados } = parsearEstructuraRMD(textoConCita("POLGV1-203"), []);
    // "POLGV1-203" no matchea la forma <I|P|F><3 caract.>-... porque la letra
    // inicial esperada es una sola (I/P/F) — "POL..." queda fuera tal como antes.
    assert.equal(documentosReferenciados.length, 0);
  });
});
