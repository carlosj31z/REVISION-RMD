"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { leerRespuestaApi } from "@/lib/leerRespuestaApi";

interface Props {
  onVolver: () => void;
}

interface Resumen {
  total: number;
  actualizadoEn: string | null;
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
          </div>
        </div>
      </div>
    </div>
  );
}
