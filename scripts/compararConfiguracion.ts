// CLI del comparador de configuraciones de RMD, para correrlo suelto sin
// pasar por la UI:
//
//   npm run compare-config -- referencia.xlsx objetivo.xlsx
//   npm run compare-config -- referencia.xlsx objetivo.xlsx --json > informe.json
//   npm run compare-config -- referencia.xlsx objetivo.xlsx --solo-errores
//
// Termina con código 1 si el archivo objetivo tiene errores, para poder
// usarlo como verificación previa antes de mandar el RMD a Validaciones.

import { readFileSync } from "node:fs";
import { compareConfigurations } from "@/lib/comparadorConfiguracion";
import type {
  ComparisonReport,
  HallazgoConfiguracion,
  SeveridadHallazgo,
} from "@/types/configuracion";

const USO = `Uso: npm run compare-config -- <referencia.xlsx> <objetivo.xlsx> [--json] [--solo-errores]

  <referencia.xlsx>  configuración del producto ya autorizado/validado
  <objetivo.xlsx>    configuración del producto en desarrollo
  --json             imprime el ComparisonReport crudo en JSON
  --solo-errores     omite las advertencias e informativos`;

const ETIQUETA_SEVERIDAD: Record<SeveridadHallazgo, string> = {
  error: "ERROR  ",
  warning: "AVISO  ",
  info: "INFO   ",
};

const ETIQUETA_ARCHIVO = {
  referencia: "referencia",
  objetivo: "objetivo",
  ambos: "cruzado",
} as const;

function imprimirHallazgo(hallazgo: HallazgoConfiguracion): void {
  const fila = hallazgo.item ? `fila ${hallazgo.item.fila}` : "sin fila";
  console.log(
    `${ETIQUETA_SEVERIDAD[hallazgo.severidad]} [${ETIQUETA_ARCHIVO[hallazgo.archivo]} · ${fila}] ${hallazgo.tipo}`
  );
  console.log(`         ${hallazgo.mensaje}`);
  if (hallazgo.seccion) console.log(`         Sección: ${hallazgo.seccion}`);
  console.log("");
}

function imprimirInforme(reporte: ComparisonReport, soloErrores: boolean): void {
  const { referencia, objetivo, resumen } = reporte;

  console.log("");
  console.log("COMPARADOR DE CONFIGURACIONES DE RMD");
  console.log("=".repeat(72));
  console.log(
    `Referencia: ${referencia.descripcion ?? "?"} · R.M ${referencia.codigoRM ?? "?"} · ` +
      `${referencia.etapa ?? "?"} · ${referencia.estado ?? "?"} · ${referencia.totalItems} ítems`
  );
  console.log(
    `Objetivo:   ${objetivo.descripcion ?? "?"} · R.M ${objetivo.codigoRM ?? "?"} · ` +
      `${objetivo.etapa ?? "?"} · ${objetivo.estado ?? "?"} · ${objetivo.totalItems} ítems`
  );
  console.log("=".repeat(72));
  console.log("");

  const hallazgos = soloErrores
    ? reporte.hallazgos.filter((h) => h.severidad === "error")
    : reporte.hallazgos;

  if (hallazgos.length === 0) {
    console.log(soloErrores ? "Sin errores." : "Sin hallazgos.");
    console.log("");
  } else {
    for (const hallazgo of hallazgos) imprimirHallazgo(hallazgo);
  }

  console.log("-".repeat(72));
  console.log(
    `Errores: ${resumen.errores} · Advertencias: ${resumen.advertencias} · Informativos: ${resumen.informativos}`
  );
  console.log(
    `Cod. compartidos: ${resumen.codsCompartidos} · sólo en referencia: ${resumen.soloEnReferencia} · ` +
      `sólo en objetivo: ${resumen.soloEnObjetivo}`
  );
  if (reporte.vocabularioTipoDato.soloEnObjetivo.length > 0) {
    console.log(
      `Tipo Dato que no existe en la referencia: ${reporte.vocabularioTipoDato.soloEnObjetivo.join(", ")}`
    );
  }
  console.log(
    resumen.sinErroresBloqueantes
      ? "Resultado: el archivo objetivo no tiene errores."
      : "Resultado: el archivo objetivo tiene errores que hay que corregir."
  );
  console.log("");
}

function main(): void {
  const argumentos = process.argv.slice(2);
  const banderas = new Set(argumentos.filter((a) => a.startsWith("--")));
  const rutas = argumentos.filter((a) => !a.startsWith("--"));

  const pidioAyuda = banderas.has("--help") || banderas.has("-h");
  if (pidioAyuda || rutas.length !== 2) {
    console.log(USO);
    // Pedir la ayuda no es un error; invocar mal el comando sí.
    process.exit(pidioAyuda ? 0 : 1);
  }

  const [rutaReferencia, rutaObjetivo] = rutas;
  let reporte: ComparisonReport;
  try {
    reporte = compareConfigurations(readFileSync(rutaReferencia), readFileSync(rutaObjetivo), {
      nombreReferencia: rutaReferencia,
      nombreObjetivo: rutaObjetivo,
    });
  } catch (err: any) {
    console.error(`No se pudo comparar: ${err?.message ?? err}`);
    process.exit(1);
    return;
  }

  if (banderas.has("--json")) console.log(JSON.stringify(reporte, null, 2));
  else imprimirInforme(reporte, banderas.has("--solo-errores"));

  process.exit(reporte.resumen.sinErroresBloqueantes ? 0 : 1);
}

main();
