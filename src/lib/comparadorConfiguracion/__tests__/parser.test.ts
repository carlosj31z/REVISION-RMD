import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsearConfiguracion } from "../parser";
import { aNumero, normalizarCodigo, normalizarTexto } from "../normalizar";
import { BASE, construirMatriz, ENCABEZADOS, filaExcel, filasBase } from "./fixtures";

describe("parsearConfiguracion", () => {
  it("lee los metadatos del bloque superior y cuenta ítems y secciones", () => {
    const config = parsearConfiguracion(construirMatriz(filasBase()), "base.xlsx");

    assert.deepEqual(config.metadatos, {
      codigoRM: "2202608952",
      descripcion: "PRODUCTO DE PRUEBA 10mg TAB",
      estado: "Autorizado",
      etapa: "FABRICACION",
      nombreArchivo: "base.xlsx",
      totalItems: 8,
      totalSecciones: 2,
    });
    assert.deepEqual(config.secciones, ["PRECAUCIONES", "PROCEDIMIENTO-FABRICACION"]);
  });

  it("asigna a cada ítem su sección y su fila real del Excel", () => {
    const config = parsearConfiguracion(construirMatriz(filasBase()));

    const primero = config.items[0];
    assert.equal(primero.cod, "100");
    assert.equal(primero.seccion, "PRECAUCIONES");
    assert.equal(primero.fila, filaExcel(BASE.precaucion1));

    const horaFinal = config.items[config.items.length - 1];
    assert.equal(horaFinal.cod, "203");
    assert.equal(horaFinal.seccion, "PROCEDIMIENTO-FABRICACION");
    assert.equal(horaFinal.fila, filaExcel(BASE.horaFinal));
  });

  it("distingue los Proceso Menor por tener un Orden padre en la hoja", () => {
    const config = parsearConfiguracion(construirMatriz(filasBase()));
    const porCod = new Map(config.items.map((i) => [i.cod, i]));

    // "6.1.2.1" cuelga de "6.1.2", que existe como campo.
    assert.equal(porCod.get("300")?.esProcesoMenor, true);
    assert.equal(porCod.get("301")?.esProcesoMenor, true);
    // "6.1.1" tiene dos puntos pero su padre "6.1" no es un campo de la hoja.
    assert.equal(porCod.get("200")?.esProcesoMenor, false);
    assert.equal(porCod.get("100")?.esProcesoMenor, false);
  });

  it("parte el Orden en segmentos numéricos", () => {
    const config = parsearConfiguracion(construirMatriz(filasBase()));
    const porCod = new Map(config.items.map((i) => [i.cod, i]));

    assert.deepEqual(porCod.get("100")?.ordenSegmentos, [1]);
    assert.deepEqual(porCod.get("200")?.ordenSegmentos, [6, 1, 1]);
    assert.deepEqual(porCod.get("300")?.ordenSegmentos, [6, 1, 2, 1]);
  });

  it("normaliza el Depende venga como número o como texto", () => {
    // El export manda el mismo identificador en las tres formas según cómo
    // Excel haya tipado la celda; las tres tienen que enlazar igual.
    const filas = filasBase();
    const config = parsearConfiguracion(
      construirMatriz([
        ...filas,
        { orden: "6.1.5", depende: 203, cod: "204", descripcion: "A" },
        { orden: "6.1.6", depende: " 204 ", cod: "205", descripcion: "B" },
        { orden: "6.1.7", depende: "205.0", cod: "206", descripcion: "C" },
      ])
    );
    const porCod = new Map(config.items.map((i) => [i.cod, i]));

    assert.equal(porCod.get("204")?.depende, "203");
    assert.equal(porCod.get("205")?.depende, "204");
    assert.equal(porCod.get("206")?.depende, "205");
  });

  it("acepta el título de sección en la columna Orden en vez de en la primera", () => {
    // El export cambió de layout entre versiones: el título puede venir en
    // cualquiera de las dos, y el parseo no debe depender de eso.
    const matriz = construirMatriz(filasBase());
    const filaSeccion = matriz[6 + 1 + BASE.precauciones];
    filaSeccion[0] = "";
    filaSeccion[1] = "PRECAUCIONES";

    const config = parsearConfiguracion(matriz);
    assert.deepEqual(config.secciones, ["PRECAUCIONES", "PROCEDIMIENTO-FABRICACION"]);
    assert.equal(config.items[0].seccion, "PRECAUCIONES");
  });

  it("identifica las columnas por su encabezado y no por su posición", () => {
    const matriz = [
      ["Cod.", "Tipo Dato", "Orden", "Depende", "Descripción", "# Decimales"],
      ["500", "Números", "6.1.1", "", "PESO (kg)", 2],
      ["501", "Sin tipo de dato", "6.1.2", "500", "ENTREGAR", ""],
    ];

    const config = parsearConfiguracion(matriz);
    assert.equal(config.items.length, 2);
    assert.equal(config.items[0].cod, "500");
    assert.equal(config.items[0].decimales, "2");
    assert.equal(config.items[1].depende, "500");
    assert.equal(config.items[1].orden, "6.1.2");
  });

  it("falla con un mensaje claro si la hoja no tiene fila de encabezados", () => {
    assert.throws(
      () => parsearConfiguracion([["cualquier", "cosa"], ["sin", "encabezados"]]),
      /no se encontró la fila de encabezados/i
    );
  });

  it("descarta las filas completamente vacías", () => {
    const matriz = construirMatriz(filasBase());
    matriz.splice(9, 0, ["", "", "", "", "", "", "", "", "", "", "", ""]);

    const config = parsearConfiguracion(matriz);
    assert.equal(config.items.length, 8);
  });

  it("no confunde el encabezado de columna 'Descripción' con el metadato 'Descripción:'", () => {
    const config = parsearConfiguracion(construirMatriz(filasBase()));
    assert.equal(config.metadatos.descripcion, "PRODUCTO DE PRUEBA 10mg TAB");
    assert.equal(ENCABEZADOS[4], "Descripción");
  });
});

describe("normalización de celdas", () => {
  it("limpia los saltos de línea escapados y los espacios duros del export", () => {
    assert.equal(normalizarTexto("CALCULO DE_x000D_ RENDIMIENTO"), "CALCULO DE RENDIMIENTO");
    assert.equal(normalizarTexto("CONDICIONES  AMBIENTALES"), "CONDICIONES AMBIENTALES");
    assert.equal(normalizarTexto("TEMPERATURA (15 °C)"), "TEMPERATURA (15 °C)");
    assert.equal(normalizarTexto(null), "");
  });

  it("colapsa las variantes del mismo código a un solo valor", () => {
    assert.equal(normalizarCodigo(108234), "108234");
    assert.equal(normalizarCodigo(" 108234 "), "108234");
    assert.equal(normalizarCodigo("108234.0"), "108234");
    assert.equal(normalizarCodigo("108234,00"), "108234");
    assert.equal(normalizarCodigo(""), "");
  });

  it("interpreta los extremos de rango con coma o punto decimal", () => {
    assert.equal(aNumero("15"), 15);
    assert.equal(aNumero("15,5"), 15.5);
    assert.equal(aNumero("15.5"), 15.5);
    assert.equal(aNumero("1.234,5"), 1234.5);
    assert.equal(aNumero("no es número"), null);
    assert.equal(aNumero(""), null);
  });
});
