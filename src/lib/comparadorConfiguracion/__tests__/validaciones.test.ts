import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ArchivoAfectado,
  ComparisonReport,
  HallazgoConfiguracion,
  TipoHallazgo,
} from "@/types/configuracion";
import { compararMatrices } from "..";
import { BASE, construirMatriz, filaExcel, filasBase, type CampoSpec, type FilaSpec } from "./fixtures";

function comparar(referencia: FilaSpec[], objetivo: FilaSpec[]): ComparisonReport {
  return compararMatrices(construirMatriz(referencia), construirMatriz(objetivo), {
    nombreReferencia: "referencia.xlsx",
    nombreObjetivo: "objetivo.xlsx",
  });
}

function de(
  reporte: ComparisonReport,
  tipo: TipoHallazgo,
  archivo?: ArchivoAfectado
): HallazgoConfiguracion[] {
  return reporte.hallazgos.filter((h) => h.tipo === tipo && (archivo ? h.archivo === archivo : true));
}

/** Exige que el tipo de hallazgo aparezca exactamente una vez y lo devuelve. */
function unico(
  reporte: ComparisonReport,
  tipo: TipoHallazgo,
  archivo?: ArchivoAfectado
): HallazgoConfiguracion {
  const encontrados = de(reporte, tipo, archivo);
  assert.equal(
    encontrados.length,
    1,
    `se esperaba 1 hallazgo "${tipo}"${archivo ? ` en ${archivo}` : ""}, hubo ${encontrados.length}: ` +
      encontrados.map((h) => h.mensaje).join(" | ")
  );
  return encontrados[0];
}

/** Atajo para mutar una fila de campo de la configuración base. */
function campo(filas: FilaSpec[], indice: number): CampoSpec {
  return filas[indice] as CampoSpec;
}

describe("comparación de dos configuraciones limpias", () => {
  it("no reporta nada cuando los dos archivos son iguales y están bien armados", () => {
    const reporte = comparar(filasBase(), filasBase());

    assert.deepEqual(reporte.hallazgos, []);
    assert.equal(reporte.resumen.errores, 0);
    assert.equal(reporte.resumen.advertencias, 0);
    assert.equal(reporte.resumen.sinErroresBloqueantes, true);
    assert.equal(reporte.resumen.codsCompartidos, 8);
    assert.equal(reporte.objetivo.nombreArchivo, "objetivo.xlsx");
  });
});

describe("validación 1 — integridad de la cadena Depende → Cod.", () => {
  it("detecta la cadena rota cuando el Depende apunta a un Cod. que no existe", () => {
    const objetivo = filasBase();
    campo(objetivo, BASE.condiciones).depende = 999;

    const reporte = comparar(filasBase(), objetivo);
    const hallazgo = unico(reporte, "enlace_roto", "objetivo");

    assert.equal(hallazgo.severidad, "error");
    assert.equal(hallazgo.item?.orden, "6.1.3");
    assert.equal(hallazgo.item?.cod, "202");
    assert.equal(hallazgo.item?.fila, filaExcel(BASE.condiciones));
    assert.equal(hallazgo.seccion, "PROCEDIMIENTO-FABRICACION");
    assert.equal(hallazgo.detalle?.dependeActual, "999");
    // Qué Cod. correspondería según la secuencia, y quién queda huérfano.
    assert.equal(hallazgo.detalle?.dependeEsperado, "201");
    assert.equal(hallazgo.itemRelacionado?.cod, "201");
    assert.equal(hallazgo.itemRelacionado?.orden, "6.1.2");
    assert.match(hallazgo.mensaje, /no existe en ningún ítem del archivo/);
    assert.match(hallazgo.mensaje, /queda huérfano/);

    assert.equal(de(reporte, "enlace_roto", "referencia").length, 0);
    assert.equal(reporte.resumen.sinErroresBloqueantes, false);
  });

  it("distingue el Depende que apunta hacia adelante del que no existe", () => {
    const objetivo = filasBase();
    // 203 existe, pero recién más abajo: no puede ser su predecesor.
    campo(objetivo, BASE.condiciones).depende = 203;

    const hallazgo = unico(comparar(filasBase(), objetivo), "enlace_roto", "objetivo");
    assert.match(hallazgo.mensaje, /existe en el archivo pero recién más abajo/);
  });

  it("detecta el ítem que queda huérfano cuando la cadena lo saltea", () => {
    const objetivo = filasBase();
    // 6.1.4 retoma 201 en vez de 202: 6.1.3 queda fuera de la secuencia.
    campo(objetivo, BASE.horaFinal).depende = 201;

    const reporte = comparar(filasBase(), objetivo);
    const hallazgo = unico(reporte, "item_huerfano", "objetivo");

    assert.equal(hallazgo.severidad, "warning");
    assert.equal(hallazgo.item?.orden, "6.1.4");
    assert.equal(hallazgo.itemRelacionado?.cod, "202");
    assert.equal(hallazgo.itemRelacionado?.fila, filaExcel(BASE.condiciones));
    assert.match(hallazgo.mensaje, /fuera de la secuencia/);
    // El salto no está en la referencia, así que no se da por bueno.
    assert.match(hallazgo.mensaje, /Verificá si el salto es intencional/);
    // No es un enlace roto: el Cod. referenciado sí existe antes.
    assert.equal(de(reporte, "enlace_roto").length, 0);
  });

  it("baja a informativo el salto que la referencia ya trae en la misma posición", () => {
    // Un branch-back que el producto autorizado también tiene es el patrón
    // esperado del registro, no un hallazgo del producto en desarrollo.
    const conSalto = filasBase();
    campo(conSalto, BASE.horaFinal).depende = 201;

    const reporte = comparar(conSalto, conSalto);

    assert.equal(unico(reporte, "item_huerfano", "objetivo").severidad, "info");
    assert.match(unico(reporte, "item_huerfano", "objetivo").mensaje, /mismo salto en esta posición/);
    // En la referencia se sigue informando como advertencia: no tiene contra
    // qué compararse.
    assert.equal(unico(reporte, "item_huerfano", "referencia").severidad, "warning");
    assert.equal(reporte.resumen.sinErroresBloqueantes, true);
  });

  it("informa como rama válida el salto cuyo ítem anterior sigue referenciado", () => {
    const objetivo = filasBase();
    // 6.1.4 retoma 201 salteando a 202, pero un paso posterior vuelve a
    // engancharse a 202: ese salto no deja a nadie fuera de la secuencia.
    campo(objetivo, BASE.horaFinal).depende = 201;
    objetivo.push({ orden: "6.1.5", depende: 202, cod: 204, descripcion: "ENTREGAR LA DOCUMENTACIÓN" });

    const reporte = comparar(filasBase(), objetivo);
    const rama = unico(reporte, "rama_valida", "objetivo");

    assert.equal(rama.severidad, "info");
    assert.equal(rama.item?.orden, "6.1.4");
    assert.equal(rama.itemRelacionado?.cod, "201"); // el Cod. que retoma
    assert.match(rama.mensaje, /Es una rama válida/);

    // Reenganchar la cadena más abajo corre el cabo suelto, no lo elimina:
    // el huérfano que queda es 203, no el 202 que la rama salteó.
    assert.deepEqual(
      de(reporte, "item_huerfano", "objetivo").map((h) => h.itemRelacionado?.cod),
      ["203"]
    );
  });

  it("ignora los Proceso Menor: no participan de la cadena", () => {
    const reporte = comparar(filasBase(), filasBase());
    // Los dos Proceso Menor de la base no tienen Depende y aun así no
    // generan ningún hallazgo de cadena.
    assert.equal(de(reporte, "enlace_roto").length, 0);
    assert.equal(de(reporte, "item_huerfano").length, 0);
  });
});

describe("validación 2 — numeración de la columna Orden", () => {
  it("detecta el salto de numeración dentro de un nivel", () => {
    const objetivo = filasBase();
    campo(objetivo, BASE.horaFinal).orden = "6.1.5";

    const reporte = comparar(filasBase(), objetivo);
    const hallazgo = unico(reporte, "numeracion_salto", "objetivo");

    assert.equal(hallazgo.severidad, "error");
    assert.equal(hallazgo.item?.orden, "6.1.5");
    assert.match(hallazgo.mensaje, /del nivel 6\.1/);
    assert.match(hallazgo.mensaje, /falta 6\.1\.4/);
  });

  it("detecta el Orden duplicado dentro de un nivel", () => {
    const objetivo = filasBase();
    campo(objetivo, BASE.horaFinal).orden = "6.1.3";

    const hallazgo = unico(comparar(filasBase(), objetivo), "numeracion_duplicada", "objetivo");
    assert.equal(hallazgo.severidad, "error");
    assert.match(hallazgo.mensaje, /6\.1\.3 aparece en la fila/);
  });

  it("no marca salto porque una subsección corta reinicie en 1", () => {
    // PRECAUCIONES numera 1, 2 y PROCEDIMIENTO arranca de nuevo en 6.1.1:
    // agrupar por sección es lo que evita el falso positivo.
    const reporte = comparar(filasBase(), filasBase());
    assert.equal(de(reporte, "numeracion_salto").length, 0);
  });

  it("detecta el nivel que no arranca en 1", () => {
    const objetivo = filasBase();
    campo(objetivo, BASE.pesoObtenido).orden = "6.1.2.2";

    const hallazgo = unico(comparar(filasBase(), objetivo), "numeracion_salto", "objetivo");
    assert.match(hallazgo.mensaje, /empieza en 6\.1\.2\.2: falta 6\.1\.2\.1/);
  });
});

describe("validación 3 — Tipo Dato / Val. Inicial / Val. Final / # Decimales", () => {
  it("detecta el rango invertido", () => {
    const objetivo = filasBase();
    campo(objetivo, BASE.temperatura).valInicial = 25;
    campo(objetivo, BASE.temperatura).valFinal = 15;

    const reporte = comparar(filasBase(), objetivo);
    const hallazgo = unico(reporte, "rango_invertido", "objetivo");

    assert.equal(hallazgo.severidad, "error");
    assert.equal(hallazgo.item?.cod, "301");
    assert.match(hallazgo.mensaje, /Val\. Inicial 25 no es menor que Val\. Final 15/);
    assert.equal(de(reporte, "rango_invertido", "referencia").length, 0);
  });

  it("detecta el Rango al que le falta un extremo", () => {
    const objetivo = filasBase();
    campo(objetivo, BASE.temperatura).valFinal = "";

    const hallazgo = unico(comparar(filasBase(), objetivo), "rango_incompleto", "objetivo");
    assert.equal(hallazgo.severidad, "error");
    assert.match(hallazgo.mensaje, /no tiene Val\. Final/);
  });

  it("detecta el Rango cuyo extremo no es un número", () => {
    const objetivo = filasBase();
    campo(objetivo, BASE.temperatura).valFinal = "veinticinco";

    const hallazgo = unico(comparar(filasBase(), objetivo), "rango_incompleto", "objetivo");
    assert.match(hallazgo.mensaje, /no contiene un número/);
  });

  it("detecta los decimales faltantes en un campo numérico", () => {
    const objetivo = filasBase();
    campo(objetivo, BASE.pesoObtenido).decimales = "";

    const reporte = comparar(filasBase(), objetivo);
    const hallazgo = unico(reporte, "decimales_faltantes", "objetivo");

    assert.equal(hallazgo.severidad, "error");
    assert.equal(hallazgo.item?.cod, "300");
    assert.equal(hallazgo.detalle?.campo, "# Decimales");
    assert.match(hallazgo.mensaje, /tipo "Números" y no tiene "# Decimales" definido/);
  });

  it("detecta los decimales faltantes también en un Rango", () => {
    const objetivo = filasBase();
    campo(objetivo, BASE.temperatura).decimales = "";

    const hallazgo = unico(comparar(filasBase(), objetivo), "decimales_faltantes", "objetivo");
    assert.equal(hallazgo.item?.cod, "301");
  });

  it("detecta valores de rango cargados en un tipo que no es Rango", () => {
    const objetivo = filasBase();
    campo(objetivo, BASE.pesoObtenido).valInicial = 1;

    const hallazgo = unico(comparar(filasBase(), objetivo), "valores_en_tipo_no_rango", "objetivo");
    assert.equal(hallazgo.severidad, "error");
    assert.match(hallazgo.mensaje, /tiene Val\. Inicial cargado/);
  });

  it("detecta un Tipo Dato que no existe en la referencia", () => {
    const objetivo = filasBase();
    campo(objetivo, BASE.condiciones).tipoDato = "Rangoo";

    const reporte = comparar(filasBase(), objetivo);
    const hallazgo = unico(reporte, "tipo_dato_desconocido", "objetivo");

    assert.equal(hallazgo.severidad, "warning");
    assert.equal(hallazgo.item?.cod, "202");
    assert.deepEqual(reporte.vocabularioTipoDato.soloEnObjetivo, ["Rangoo"]);
    // La referencia define el vocabulario: nunca se le exige a ella.
    assert.equal(de(reporte, "tipo_dato_desconocido", "referencia").length, 0);
  });
});

describe("validación 4 — cruce por Cod. compartido", () => {
  it("reporta el mismo Cod. configurado distinto en cada archivo", () => {
    const objetivo = filasBase();
    campo(objetivo, BASE.condiciones).tipoDato = "Fecha y Hora";

    const reporte = comparar(filasBase(), objetivo);
    const hallazgo = unico(reporte, "atributos_difieren");

    assert.equal(hallazgo.severidad, "warning");
    assert.equal(hallazgo.archivo, "ambos");
    assert.equal(hallazgo.item?.cod, "202");
    assert.equal(hallazgo.itemRelacionado?.cod, "202");
    assert.equal(hallazgo.detalle?.campo, "Tipo Dato");
    assert.match(hallazgo.mensaje, /referencia: "Realizado por" \/ objetivo: "Fecha y Hora"/);
    assert.match(hallazgo.mensaje, /cambio intencional/);
    // "Fecha y Hora" sí está en el vocabulario de la referencia.
    assert.equal(de(reporte, "tipo_dato_desconocido").length, 0);
  });

  it("no reporta diferencias que son sólo de formato", () => {
    const objetivo = filasBase();
    campo(objetivo, BASE.temperatura).valInicial = "15.0";
    campo(objetivo, BASE.temperatura).tipoDato = "RANGO";

    const reporte = comparar(filasBase(), objetivo);
    assert.equal(de(reporte, "atributos_difieren").length, 0);
  });

  it("reporta el Cod. repetido con atributos distintos dentro del mismo archivo", () => {
    const objetivo = filasBase();
    objetivo.push({
      orden: "6.1.5",
      depende: 203,
      cod: 301, // el mismo Cod. que la temperatura, pero definido distinto
      descripcion: "PESO DEL LOTE (kg):",
      tipoDato: "Números",
      decimales: 3,
    });

    const reporte = comparar(filasBase(), objetivo);
    const hallazgo = unico(reporte, "cod_duplicado_inconsistente", "objetivo");

    assert.equal(hallazgo.severidad, "warning");
    assert.equal(hallazgo.item?.cod, "301");
    assert.match(hallazgo.mensaje, /se repite en el archivo con definiciones distintas/);
    assert.match(hallazgo.mensaje, /Tipo Dato/);
  });

  it("acepta el Cod. repetido cuando está definido igual en todas sus apariciones", () => {
    const objetivo = filasBase();
    objetivo.push({
      orden: "6.1.5",
      depende: 203,
      cod: 301,
      descripcion: "Proceso Menor: TEMPERATURA (15 °C - 25 °C):",
      tipoDato: "Rango",
      valInicial: 15,
      valFinal: 25,
      decimales: 1,
    });

    const reporte = comparar(filasBase(), objetivo);
    assert.equal(de(reporte, "cod_duplicado_inconsistente").length, 0);
  });
});

describe("validación 5 — diff estructural", () => {
  it("lista los ítems que están en un archivo y no en el otro", () => {
    const objetivo = filasBase();
    // Se cambia la temperatura (301) por una humedad relativa (302): un paso
    // eliminado y uno agregado al mismo tiempo.
    objetivo[BASE.temperatura] = {
      orden: "6.1.3.1",
      cod: 302,
      descripcion: "Proceso Menor: HUMEDAD RELATIVA (25 % - 40 %)",
      tipoDato: "Rango",
      valInicial: 25,
      valFinal: 40,
      decimales: 1,
    };

    const reporte = comparar(filasBase(), objetivo);

    const soloReferencia = unico(reporte, "item_solo_en_referencia");
    assert.equal(soloReferencia.severidad, "info");
    assert.equal(soloReferencia.archivo, "referencia");
    assert.equal(soloReferencia.item?.cod, "301");
    assert.equal(soloReferencia.item?.fila, filaExcel(BASE.temperatura));
    assert.match(soloReferencia.mensaje, /no aparece en el archivo objetivo/);

    const soloObjetivo = unico(reporte, "item_solo_en_objetivo");
    assert.equal(soloObjetivo.archivo, "objetivo");
    assert.equal(soloObjetivo.item?.cod, "302");
    assert.match(soloObjetivo.mensaje, /no aparece en la referencia/);

    assert.equal(reporte.resumen.soloEnReferencia, 1);
    assert.equal(reporte.resumen.soloEnObjetivo, 1);
    assert.equal(reporte.resumen.codsCompartidos, 7);
  });
});

describe("resumen del informe", () => {
  it("no bloquea al objetivo por los errores propios de la referencia", () => {
    const referencia = filasBase();
    campo(referencia, BASE.condiciones).depende = 999;

    const reporte = comparar(referencia, filasBase());

    assert.equal(unico(reporte, "enlace_roto", "referencia").severidad, "error");
    assert.equal(de(reporte, "enlace_roto", "objetivo").length, 0);
    assert.equal(reporte.resumen.errores, 1);
    assert.equal(reporte.resumen.sinErroresBloqueantes, true);
  });

  it("cuenta los hallazgos por severidad y por tipo, y los ordena por archivo y fila", () => {
    const objetivo = filasBase();
    campo(objetivo, BASE.condiciones).depende = 999; // error en el objetivo
    campo(objetivo, BASE.temperatura).decimales = ""; // otro error, fila posterior

    const reporte = comparar(filasBase(), objetivo);

    assert.equal(reporte.resumen.errores, 2);
    assert.equal(reporte.resumen.porTipo.enlace_roto, 1);
    assert.equal(reporte.resumen.porTipo.decimales_faltantes, 1);
    assert.equal(reporte.resumen.sinErroresBloqueantes, false);

    const filas = reporte.hallazgos.map((h) => h.item?.fila);
    assert.deepEqual(filas, [filaExcel(BASE.condiciones), filaExcel(BASE.temperatura), filaExcel(BASE.temperatura)]);
  });

  it("identifica cada hallazgo con un id estable", () => {
    const objetivo = filasBase();
    campo(objetivo, BASE.condiciones).depende = 999;

    const primero = comparar(filasBase(), objetivo);
    const segundo = comparar(filasBase(), objetivo);

    assert.deepEqual(
      primero.hallazgos.map((h) => h.id),
      segundo.hallazgos.map((h) => h.id)
    );
    assert.equal(unico(primero, "enlace_roto", "objetivo").id, "enlace_roto:objetivo:6.1.3:202");
  });
});
