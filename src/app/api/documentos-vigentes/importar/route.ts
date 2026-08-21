import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getSupabaseServerClient } from "@/lib/supabaseClient";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Reemplaza COMPLETO el maestro de documentos_vigentes en cada importación
 * (en vez de acumular con upsert): el Excel de origen es la lista completa
 * vigente a hoy, así que un código que ya no aparece ahí debe dejar de
 * contar como vigente acá también, no quedar pegado de una importación
 * anterior.
 */

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita tildes (marcas diacríticas que deja NFD)
    .toLowerCase()
    .trim();
}

// El Excel de origen (ver 26-08-2026, columna E=código y F=título que pidió
// el usuario) trae además Categoría, Revisión, Fecha y Validez — se
// aprovechan si están, pero código+título son los únicos obligatorios.
interface ColumnasDetectadas {
  codigo: number;
  titulo: number;
  categoria?: number;
  revision?: number;
  fechaEmision?: number;
  vigenteHasta?: number;
}

function detectarColumnas(filas: any[][]): { fila: number; columnas: ColumnasDetectadas } | null {
  for (let f = 0; f < Math.min(10, filas.length); f++) {
    const fila = filas[f];
    if (!fila) continue;
    const columnas: Partial<ColumnasDetectadas> = {};
    for (let c = 0; c < fila.length; c++) {
      const texto = normalizar(String(fila[c] ?? ""));
      if (!texto) continue;
      if (texto.includes("identificador") || texto.includes("codigo")) columnas.codigo = c;
      else if (texto.includes("titulo") || texto.includes("nombre")) columnas.titulo = c;
      else if (texto.includes("categoria")) columnas.categoria = c;
      else if (texto.includes("revision")) columnas.revision = c;
      else if (texto.includes("valid") || texto.includes("vigen")) columnas.vigenteHasta = c;
      else if (texto === "fecha" || texto.includes("emision")) columnas.fechaEmision = c;
    }
    if (columnas.codigo != null && columnas.titulo != null) {
      return { fila: f, columnas: columnas as ColumnasDetectadas };
    }
  }
  return null;
}

function celdaAFecha(valor: any): string | null {
  if (valor == null || valor === "") return null;
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null;
    return valor.toISOString().slice(0, 10);
  }
  if (typeof valor === "number" && valor > 0) {
    // Serial de Excel: días desde 1899-12-30 (incluye el bug del año bisiesto 1900).
    const ms = Math.round((valor - 25569) * 86400 * 1000);
    const fecha = new Date(ms);
    if (Number.isNaN(fecha.getTime())) return null;
    return fecha.toISOString().slice(0, 10);
  }
  if (typeof valor === "string") {
    const fecha = new Date(valor);
    if (!Number.isNaN(fecha.getTime())) return fecha.toISOString().slice(0, 10);
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
    const hoja = libro.Sheets[libro.SheetNames[0]];
    if (!hoja) {
      return NextResponse.json({ error: "El archivo no tiene ninguna hoja." }, { status: 400 });
    }

    const filas: any[][] = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: "" });
    const deteccion = detectarColumnas(filas);
    if (!deteccion) {
      return NextResponse.json(
        {
          error:
            'No se encontraron las columnas "Identificador"/"Código" y "Título"/"Nombre" en ' +
            "las primeras filas del archivo. Revisá que sea el Excel correcto.",
        },
        { status: 400 }
      );
    }
    const { fila: filaEncabezado, columnas } = deteccion;

    const registros: {
      codigo: string;
      titulo: string;
      categoria: string | null;
      revision: string | null;
      fecha_emision: string | null;
      vigente_hasta: string | null;
    }[] = [];
    let omitidos = 0;
    const vistos = new Set<string>();

    for (let f = filaEncabezado + 1; f < filas.length; f++) {
      const fila = filas[f];
      if (!fila) continue;
      const codigo = String(fila[columnas.codigo] ?? "").trim().toUpperCase();
      const titulo = String(fila[columnas.titulo] ?? "").trim();
      if (!codigo || !titulo) {
        if (codigo || titulo) omitidos++; // fila con algo pero incompleta
        continue;
      }
      if (vistos.has(codigo)) continue; // duplicado dentro del mismo archivo: se queda la primera
      vistos.add(codigo);
      registros.push({
        codigo,
        titulo,
        categoria: columnas.categoria != null ? String(fila[columnas.categoria] ?? "").trim() || null : null,
        revision: columnas.revision != null ? String(fila[columnas.revision] ?? "").trim() || null : null,
        fecha_emision: columnas.fechaEmision != null ? celdaAFecha(fila[columnas.fechaEmision]) : null,
        vigente_hasta: columnas.vigenteHasta != null ? celdaAFecha(fila[columnas.vigenteHasta]) : null,
      });
    }

    if (registros.length === 0) {
      return NextResponse.json(
        { error: "No se encontró ninguna fila válida (con código y título) para importar." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseServerClient();

    // Reemplazo completo: se borra todo el maestro anterior antes de insertar
    // el nuevo (ver nota arriba). El filtro "not is null" es un truco estándar
    // de PostgREST para expresar "borrar todas las filas" sin condición real.
    const { error: errorBorrado } = await supabase
      .from("documentos_vigentes")
      .delete()
      .not("id", "is", null);
    if (errorBorrado) {
      return NextResponse.json(
        { error: `No se pudo limpiar el maestro anterior: ${errorBorrado.message}` },
        { status: 500 }
      );
    }

    // Inserción en bloques: un solo insert con miles de filas puede exceder
    // límites de tamaño de request/PostgREST.
    const TAMANO_BLOQUE = 500;
    for (let i = 0; i < registros.length; i += TAMANO_BLOQUE) {
      const bloque = registros.slice(i, i + TAMANO_BLOQUE);
      const { error: errorInsert } = await supabase.from("documentos_vigentes").insert(bloque);
      if (errorInsert) {
        return NextResponse.json(
          {
            error: `Se cargaron ${i} de ${registros.length} filas y falló el resto: ${errorInsert.message}`,
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      importados: registros.length,
      totalFilas: filas.length - filaEncabezado - 1,
      omitidos,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Error al importar el Excel: ${err.message ?? "error desconocido"}` },
      { status: 500 }
    );
  }
}
