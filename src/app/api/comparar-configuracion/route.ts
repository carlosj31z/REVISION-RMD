import { NextRequest, NextResponse } from "next/server";
import { compareConfigurations } from "@/lib/comparadorConfiguracion";

export const runtime = "nodejs";
export const maxDuration = 60;

const CAMPO_REFERENCIA = "referencia";
const CAMPO_OBJETIVO = "objetivo";

/**
 * POST /api/comparar-configuracion
 *
 * Recibe los dos archivos de "Configuración" (multipart/form-data, campos
 * "referencia" y "objetivo") y devuelve el ComparisonReport en JSON.
 *
 * Deliberadamente NO llama a Gemini ni a ningún otro modelo: el informe sale
 * entero de reglas y comparación de celdas, así que es reproducible y se
 * puede auditar paso por paso ante Validaciones.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const referencia = formData.get(CAMPO_REFERENCIA);
    const objetivo = formData.get(CAMPO_OBJETIVO);

    if (!(referencia instanceof File)) {
      return NextResponse.json(
        {
          error:
            `Falta el archivo de configuración del producto de referencia (campo "${CAMPO_REFERENCIA}").`,
        },
        { status: 400 }
      );
    }
    if (!(objetivo instanceof File)) {
      return NextResponse.json(
        {
          error:
            `Falta el archivo de configuración del producto en desarrollo (campo "${CAMPO_OBJETIVO}").`,
        },
        { status: 400 }
      );
    }

    const [bufferReferencia, bufferObjetivo] = await Promise.all([
      referencia.arrayBuffer().then((b) => Buffer.from(b)),
      objetivo.arrayBuffer().then((b) => Buffer.from(b)),
    ]);

    const reporte = compareConfigurations(bufferReferencia, bufferObjetivo, {
      nombreReferencia: referencia.name,
      nombreObjetivo: objetivo.name,
    });

    return NextResponse.json({ reporte });
  } catch (err: any) {
    // Un archivo sin la hoja "Configuración" o sin fila de encabezados es un
    // error del usuario al elegir el archivo, no una falla del servidor.
    const mensaje = err?.message ?? "error desconocido";
    const esArchivoInvalido = /hoja|encabezados/i.test(String(mensaje));
    return NextResponse.json(
      { error: `Error al comparar las configuraciones: ${mensaje}` },
      { status: esArchivoInvalido ? 400 : 500 }
    );
  }
}
