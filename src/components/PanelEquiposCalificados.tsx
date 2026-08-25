"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { EquipoCalificado } from "@/types/rmd";
import { leerRespuestaApi } from "@/lib/leerRespuestaApi";

interface Props {
  onVolver: () => void;
}

interface Resumen {
  total: number;
  actualizadoEn: string | null;
}

const COLOR_ESTADO: Record<string, string> = {
  CALIFICADO: "text-system",
  "EN PROCESO": "text-severidad-media",
  PENDIENTE: "text-severidad-alta",
  INOPERATIVO: "text-severidad-critica",
  "NO CUMPLE": "text-severidad-critica",
};

/**
 * Detalle "si el usuario quiere" del maestro — mismo patrón que
 * BuscadorDocumentosVigentes en PanelDocumentosObsoletos.tsx: nunca lista
 * el maestro completo de una, sólo busca por código SAP o descripción.
 */
function BuscadorEquiposCalificados({ total }: { total: number }) {
  const [abierto, setAbierto] = useState(false);
  const [termino, setTermino] = useState("");
  const [resultados, setResultados] = useState<EquipoCalificado[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limite, setLimite] = useState<number | null>(null);

  useEffect(() => {
    if (!abierto || termino.trim().length < 2) {
      setResultados([]);
      setError(null);
      return;
    }
    const controlador = new AbortController();
    const timeout = setTimeout(async () => {
      setBuscando(true);
      setError(null);
      try {
        const res = await fetch(`/api/equipos-calificados/buscar?q=${encodeURIComponent(termino.trim())}`, {
          cache: "no-store",
          signal: controlador.signal,
        });
        const data = await leerRespuestaApi(res);
        if (!res.ok) throw new Error(data.error ?? "No se pudo buscar.");
        setResultados(data.equipos);
        setLimite(data.limite ?? null);
      } catch (err: any) {
        if (err.name !== "AbortError") setError(err.message ?? "No se pudo buscar.");
      } finally {
        setBuscando(false);
      }
    }, 300);
    return () => {
      clearTimeout(timeout);
      controlador.abort();
    };
  }, [abierto, termino]);

  if (total === 0) return null;

  return (
    <div className="mt-3 border-t border-line pt-3">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="text-[12px] font-medium text-system hover:underline"
      >
        {abierto ? "Ocultar buscador" : `Ver detalle de los ${total} equipos cargados`}
      </button>

      {abierto && (
        <div className="mt-2.5 animate-fade-in-up">
          <input
            value={termino}
            onChange={(e) => setTermino(e.target.value)}
            placeholder="Buscar por código SAP o nombre del equipo…"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-muted/60 transition-all duration-150 ease-spring focus:border-system focus:shadow-ring focus:outline-none"
          />

          {error && <p className="mt-2 text-[12px] text-severidad-critica">{error}</p>}

          {termino.trim().length >= 2 && (
            <div className="mt-2 max-h-80 overflow-y-auto rounded-lg border border-line">
              {buscando ? (
                <p className="px-3 py-3 text-[12px] text-muted">Buscando…</p>
              ) : resultados.length === 0 ? (
                <p className="px-3 py-3 text-[12px] text-muted">Sin resultados.</p>
              ) : (
                <table className="w-full text-left text-[12px]">
                  <thead className="sticky top-0 bg-paper text-[10px] uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-2.5 py-1.5 font-semibold">Código SAP</th>
                      <th className="px-2.5 py-1.5 font-semibold">Equipo</th>
                      <th className="px-2.5 py-1.5 font-semibold">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultados.map((e) => (
                      <tr key={e.id} className="border-t border-line">
                        <td className="whitespace-nowrap px-2.5 py-1.5 font-mono text-ink/80">{e.codigoSap}</td>
                        <td className="px-2.5 py-1.5 text-ink/80">{e.descripcion ?? "—"}</td>
                        <td
                          className={`whitespace-nowrap px-2.5 py-1.5 font-medium ${COLOR_ESTADO[e.estado] ?? "text-muted"}`}
                        >
                          {e.estado}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
          {limite != null && resultados.length === limite && (
            <p className="mt-1.5 text-[11px] text-muted">
              Se muestran los primeros {limite} resultados — afiná la búsqueda para ver menos.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function PanelEquiposCalificados({ onVolver }: Props) {
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [cargandoResumen, setCargandoResumen] = useState(true);
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const cargarResumen = useCallback(async () => {
    setCargandoResumen(true);
    try {
      const res = await fetch("/api/equipos-calificados", { cache: "no-store" });
      const data = await leerRespuestaApi(res);
      if (!res.ok) throw new Error(data.error ?? "No se pudo cargar el resumen.");
      setResumen(data);
    } catch (err: any) {
      setError(err.message ?? "No se pudo cargar el resumen de equipos calificados.");
    } finally {
      setCargandoResumen(false);
    }
  }, []);

  useEffect(() => {
    cargarResumen();
  }, [cargarResumen]);

  const importar = useCallback(
    async (archivo: File) => {
      setImportando(true);
      setError(null);
      setResultado(null);
      try {
        const formData = new FormData();
        formData.append("file", archivo);
        const res = await fetch("/api/equipos-calificados/importar", {
          method: "POST",
          body: formData,
        });
        const data = await leerRespuestaApi(res);
        if (!res.ok) throw new Error(data.error ?? "No se pudo importar el archivo.");
        setResultado(
          `${data.importados} equipos cargados` +
            (data.omitidos > 0 ? ` (${data.omitidos} filas omitidas por estar incompletas).` : ".")
        );
        await cargarResumen();
      } catch (err: any) {
        setError(err.message ?? "Ocurrió un error inesperado al importar.");
      } finally {
        setImportando(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [cargarResumen]
  );

  return (
    <div className="h-pantalla flex animate-fade-in flex-col bg-paper">
      <div className="material-chrome-white inset-seguro-x sticky top-0 z-10 flex shrink-0 items-center justify-between gap-3 border-b border-line/70 px-4 py-3 shadow-soft sm:px-6">
        <button
          onClick={onVolver}
          className="-ml-1.5 flex min-h-[38px] shrink-0 items-center gap-1 rounded-lg px-2.5 text-[13px] font-medium text-system transition-all duration-150 ease-spring hover:bg-system-tint active:scale-95"
        >
          ← Volver
        </button>
        <h1 className="min-w-0 truncate text-[13px] font-semibold text-ink sm:text-[14px]">
          Equipos calificados
        </h1>
      </div>

      <div className="inset-seguro-x min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl animate-fade-in-up px-4 py-6 sm:px-6 sm:py-8">
          <p className="mb-6 text-[13px] leading-relaxed text-muted">
            Cargá acá el Excel de Registro de Áreas/Sistemas/Equipos a Calificar (hoja{" "}
            <span className="font-mono">Cronograma</span>, columnas{" "}
            <span className="font-mono">CÓDIGO SAP</span> y{" "}
            <span className="font-mono">ESTADO GENERAL</span>). Cuando un equipo citado en la
            sección de Equipos/Instrumentos/Materiales de un RMD no figure como{" "}
            <span className="font-mono">CALIFICADO</span>, se genera una alerta automática con su
            estado real (pendiente, en proceso, inoperativo, etc.). Reemplaza todo lo cargado
            antes — es la foto vigente a hoy, no un agregado.
          </p>

          <div className="rounded-xl border border-line bg-surface p-4 shadow-soft">
            <p className="text-[12px] text-muted">
              {cargandoResumen ? (
                "Consultando lo ya cargado…"
              ) : resumen && resumen.total > 0 ? (
                <>
                  <span className="font-medium text-ink">{resumen.total}</span> equipos cargados
                  {resumen.actualizadoEn && (
                    <> · última importación: {new Date(resumen.actualizadoEn).toLocaleString()}</>
                  )}
                </>
              ) : (
                "Todavía no se cargó ningún equipo calificado."
              )}
            </p>

            <label className="mt-3 flex min-h-[38px] w-fit cursor-pointer items-center gap-2 rounded-lg bg-system px-4 text-[13px] font-medium text-white shadow-soft transition-all duration-150 ease-spring hover:bg-system-light hover:shadow-elevated active:scale-[0.98] aria-disabled:cursor-not-allowed aria-disabled:opacity-40">
              {importando ? "Importando…" : "Elegir Excel e importar"}
              <input
                ref={inputRef}
                type="file"
                accept=".xls,.xlsx"
                disabled={importando}
                onChange={(e) => {
                  const archivo = e.target.files?.[0];
                  if (archivo) importar(archivo);
                }}
                className="hidden"
              />
            </label>

            {resultado && <p className="mt-2.5 text-[12.5px] text-severidad-baja">✓ {resultado}</p>}
            {error && <p className="mt-2.5 text-[12.5px] text-severidad-critica">{error}</p>}

            <BuscadorEquiposCalificados total={resumen?.total ?? 0} />
          </div>
        </div>
      </div>
    </div>
  );
}
