import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getSupabaseServerClient } from "@/lib/supabaseClient";

export const runtime = "nodejs";
export const maxDuration = 60;

const HOJA_ESPERADA = "Cronograma";
// Valores placeholder del Excel de origen que significan "todavía sin
// completar", no un código real — se descartan igual que una fila vacía.
const CODIGOS_PLACEHOLDER = new Set(["COMPLETAR", "NO INDICA"]);

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita tildes (marcas diacríticas que deja NFD)
    .toLowerCase()
    .trim();
}

interface ColumnasDetectadas {
  codigo: number;
  estado: number;
  descripcion?: number;
}

/**
 * El encabezado real está lejos de la fila 0 (la hoja trae varias filas de
 * título/departamento arriba) y la hoja repite la palabra "ESTADO" en más
 * de una columna (una genérica de operatividad, y "ESTADO GENERAL" que es
 * la de calificación que pidió el usuario) — por eso el match de estado
 * exige las dos palabras, no sólo "estado", para no agarrar la columna
 * equivocada. "sap" es suficientemente específico para el código porque
 * sólo aparece en el encabezado "CÓDIGO SAP" (a diferencia de "código", que
 * también aparece en "CODIGO MIF").
 */
function detectarColumnas(filas: any[][]): { fila: number; columnas: ColumnasDetectadas } | null {
  for (let f = 0; f < Math.min(30, filas.length); f++) {
    const fila = filas[f];
    if (!fila) continue;
    const columnas: Partial<ColumnasDetectadas> = {};
    for (let c = 0; c < fila.length; c++) {
      const texto = normalizar(String(fila[c] ?? ""));
      if (!texto) continue;
      if (texto.includes("sap")) columnas.codigo = c;
      else if (texto.includes("estado") && texto.includes("general")) columnas.estado = c;
      else if (texto.includes("descripcion")) columnas.descripcion = c;
    }
    if (columnas.codigo != null && columnas.estado != null) {
      return { fila: f, columnas: columnas as ColumnasDetectadas };
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const archivo = formData.get("file");
    if (!(archivo instanceof File)) {
      return NextResponse.json({ error: "Falta el archivo Excel a importar." }, { status: 400 });
    }

    const buffer = Buffer.from(await archivo.arrayBuffer());
    const libro = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const hoja = libro.Sheets[HOJA_ESPERADA];
    if (!hoja) {
      return NextResponse.json(
        {
          error: `El archivo no tiene ninguna hoja llamada "${HOJA_ESPERADA}" (hojas encontradas: ${libro.SheetNames.join(", ")}).`,
        },
        { status: 400 }
      );
    }

    const filas: any[][] = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: "" });
    const deteccion = detectarColumnas(filas);
    if (!deteccion) {
      return NextResponse.json(
        {
          error:
            'No se encontraron las columnas "CÓDIGO SAP" y "ESTADO GENERAL" en la hoja ' +
            `"${HOJA_ESPERADA}". Revisá que sea el Excel correcto.`,
        },
        { status: 400 }
      );
    }
    const { fila: filaEncabezado, columnas } = deteccion;

    const registros: { codigo_sap: string; descripcion: string | null; estado: string }[] = [];
    let omitidos = 0;
    const vistos = new Set<string>();

    for (let f = filaEncabezado + 1; f < filas.length; f++) {
      const fila = filas[f];
      if (!fila) continue;
      const codigo = String(fila[columnas.codigo] ?? "").trim().toUpperCase();
      const estado = String(fila[columnas.estado] ?? "").trim().toUpperCase();
      if (!codigo || CODIGOS_PLACEHOLDER.has(codigo) || !estado) {
        if (codigo && !CODIGOS_PLACEHOLDER.has(codigo)) omitidos++; // tenía código pero sin estado
        continue;
      }
      // El cronograma repite el mismo código en bloques de ciclos distintos
      // (ej. una fila con el ciclo vigente y otra con uno de hace años,
      // ya superado) — se queda la PRIMERA aparición, que en este archivo
      // es siempre la más reciente/vigente.
      if (vistos.has(codigo)) continue;
      vistos.add(codigo);
      registros.push({
        codigo_sap: codigo,
        descripcion:
          columnas.descripcion != null ? String(fila[columnas.descripcion] ?? "").trim() || null : null,
        estado,
      });
    }

    if (registros.length === 0) {
      return NextResponse.json(
        { error: "No se encontró ninguna fila válida (con código SAP y estado) para importar." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseServerClient();

    // Reemplazo completo, igual que documentos_vigentes: el Excel es la
    // foto vigente a hoy, no un agregado.
    const { error: errorBorrado } = await supabase
      .from("equipos_calificados")
      .delete()
      .not("id", "is", null);
    if (errorBorrado) {
      return NextResponse.json(
        { error: `No se pudo limpiar el maestro anterior: ${errorBorrado.message}` },
        { status: 500 }
      );
    }

    const TAMANO_BLOQUE = 500;
    for (let i = 0; i < registros.length; i += TAMANO_BLOQUE) {
      const bloque = registros.slice(i, i + TAMANO_BLOQUE);
      const { error: errorInsert } = await supabase.from("equipos_calificados").insert(bloque);
      if (errorInsert) {
        return NextResponse.json(
          {
            error: `Se cargaron ${i} de ${registros.length} filas y falló el resto: ${errorInsert.message}`,
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ importados: registros.length, omitidos });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Error al importar el Excel: ${err.message ?? "error desconocido"}` },
      { status: 500 }
    );
  }
}
