"use client";

import { useCallback, useState } from "react";
import type { ComparisonReport, HallazgoConfiguracion, SeveridadHallazgo } from "@/types/configuracion";
import { leerRespuestaApi } from "@/lib/leerRespuestaApi";

interface Props {
  onVolver: () => void;
}

// Panel de comparación de archivos de "Configuración" (export del sistema
// digital) — referencia (ya autorizada) contra objetivo (en desarrollo).
// Es 100% determinístico: la ruta que consume (/api/comparar-configuracion)
// no llama a ningún modelo de IA, sólo compara celdas y reconstruye la
// cadena Depende → Cod. (ver src/lib/comparadorConfiguracion/).

const SEVERIDAD_ESTILOS: Record<SeveridadHallazgo, string> = {
  error: "bg-severidad-criticaTint text-severidad-critica border-severidad-critica/30",
  warning: "bg-severidad-mediaTint text-severidad-media border-severidad-media/30",
  info: "bg-system-tint text-system border-system/30",
};

const SEVERIDAD_LABEL: Record<SeveridadHallazgo, string> = {
  error: "Error",
  warning: "Aviso",
  info: "Info",
};

const ARCHIVO_LABEL: Record<HallazgoConfiguracion["archivo"], string> = {
  referencia: "Referencia",
  objetivo: "Objetivo",
  ambos: "Cruzado",
};

function BadgeSeveridad({ severidad }: { severidad: SeveridadHallazgo }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-wide ${SEVERIDAD_ESTILOS[severidad]}`}
    >
      {SEVERIDAD_LABEL[severidad]}
    </span>
  );
}

/** Fila de metadatos (Código R.M / Descripción / Estado / Etapa) de un archivo. */
function FilaMetadatos({
  titulo,
  metadatos,
}: {
  titulo: string;
  metadatos: ComparisonReport["referencia"];
}) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3.5 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{titulo}</p>
      <p className="mt-1 text-[13px] font-medium text-ink">
        {metadatos.descripcion ?? "—"}
        {metadatos.codigoRM && <span className="ml-1.5 font-mono text-[12px] text-muted">R.M {metadatos.codigoRM}</span>}
      </p>
      <p className="mt-0.5 text-[12px] text-muted">
        {metadatos.etapa ?? "sin etapa"} · {metadatos.estado ?? "sin estado"} · {metadatos.totalItems} ítems en{" "}
        {metadatos.totalSecciones} secciones
        {metadatos.nombreArchivo && <span className="block truncate text-[11px] text-muted/70">{metadatos.nombreArchivo}</span>}
      </p>
    </div>
  );
}

/** Selector de archivo con el mismo tratamiento visual que el resto de los paneles. */
function CampoArchivo({
  label,
  descripcion,
  file,
  onChange,
}: {
  label: string;
  descripcion: string;
  file: File | null;
  onChange: (file: File | null) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-[12px] font-medium text-ink">{label}</label>
      <p className="mb-1.5 text-[11.5px] leading-snug text-muted">{descripcion}</p>
      <label className="flex min-h-[42px] w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-dashed border-line bg-surface px-3.5 text-[13px] transition-all duration-150 ease-spring hover:border-system">
        <span className={`truncate ${file ? "text-ink" : "text-muted/70"}`}>
          {file ? file.name : "Elegir archivo .xlsx/.xlsm"}
        </span>
        <span className="shrink-0 text-[11px] font-medium text-system">{file ? "Cambiar" : "Elegir"}</span>
        <input
          type="file"
          accept=".xlsx,.xlsm"
          className="hidden"
          onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        />
      </label>
    </div>
  );
}

const FILTROS: Array<{ clave: SeveridadHallazgo | "todos"; label: string }> = [
  { clave: "todos", label: "Todos" },
  { clave: "error", label: "Errores" },
  { clave: "warning", label: "Avisos" },
  { clave: "info", label: "Info" },
];

function TarjetaHallazgo({ hallazgo }: { hallazgo: HallazgoConfiguracion }) {
  return (
    <li className="rounded-lg border border-line bg-surface px-3.5 py-3 shadow-soft">
      <div className="flex flex-wrap items-center gap-1.5">
        <BadgeSeveridad severidad={hallazgo.severidad} />
        <span className="rounded-full border border-line px-2 py-0.5 text-[10.5px] font-medium text-muted">
          {ARCHIVO_LABEL[hallazgo.archivo]}
        </span>
        {hallazgo.item && (
          <span className="ml-auto shrink-0 font-mono text-[11px] text-muted">
            fila {hallazgo.item.fila}
            {hallazgo.item.orden && ` · Orden ${hallazgo.item.orden}`}
            {hallazgo.item.cod && ` · Cod. ${hallazgo.item.cod}`}
          </span>
        )}
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-ink/90">{hallazgo.mensaje}</p>
      {hallazgo.seccion && <p className="mt-1 text-[11px] text-muted">Sección: {hallazgo.seccion}</p>}
    </li>
  );
}

export function PanelComparadorConfiguracion({ onVolver }: Props) {
  const [referencia, setReferencia] = useState<File | null>(null);
  const [objetivo, setObjetivo] = useState<File | null>(null);
  const [comparando, setComparando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reporte, setReporte] = useState<ComparisonReport | null>(null);
  const [filtro, setFiltro] = useState<SeveridadHallazgo | "todos">("todos");

  const puedeComparar = !!referencia && !!objetivo && !comparando;

  const comparar = useCallback(async () => {
    if (!referencia || !objetivo) return;
    setComparando(true);
    setError(null);
    setReporte(null);
    try {
      const formData = new FormData();
      formData.append("referencia", referencia);
      formData.append("objetivo", objetivo);
      const res = await fetch("/api/comparar-configuracion", { method: "POST", body: formData });
      const data = await leerRespuestaApi(res);
      if (!res.ok) throw new Error(data.error ?? "No se pudo comparar los archivos.");
      setReporte(data.reporte);
      setFiltro("todos");
    } catch (err: any) {
      setError(err.message ?? "Ocurrió un error inesperado al comparar.");
    } finally {
      setComparando(false);
    }
  }, [referencia, objetivo]);

  const hallazgosFiltrados = reporte
    ? filtro === "todos"
      ? reporte.hallazgos
      : reporte.hallazgos.filter((h) => h.severidad === filtro)
    : [];

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
          Comparador de Configuración
        </h1>
      </div>

      <div className="inset-seguro-x min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl animate-fade-in-up px-4 py-6 sm:px-6 sm:py-8">
          <p className="mb-6 text-[13px] leading-relaxed text-muted">
            Compara el archivo de <span className="font-mono">Configuración</span> (export del sistema
            digital, hoja única del mismo nombre) de un producto de referencia ya autorizado contra el de
            un producto en desarrollo: enlaces rotos en la cadena Depende → Cod., saltos de numeración,
            columnas Tipo Dato / Val. Inicial / Val. Final / # Decimales inconsistentes, y diferencias
            estructurales entre ambos archivos. 100% determinístico — no interviene ningún modelo de IA,
            así que no consume cuota y el resultado es siempre reproducible.
          </p>

          <div className="rounded-xl border border-line bg-surface p-4 shadow-soft">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <CampoArchivo
                label="Referencia (autorizada)"
                descripcion="El producto ya validado que se usa como línea base."
                file={referencia}
                onChange={setReferencia}
              />
              <CampoArchivo
                label="Objetivo (en desarrollo)"
                descripcion="El producto que estás por enviar a Validaciones."
                file={objetivo}
                onChange={setObjetivo}
              />
            </div>

            <button
              onClick={comparar}
              disabled={!puedeComparar}
              className="mt-4 min-h-[42px] w-full rounded-lg bg-system px-4 text-[13px] font-medium text-white shadow-soft transition-all duration-150 ease-spring hover:bg-system-light hover:shadow-elevated active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {comparando ? "Comparando…" : "Comparar configuraciones"}
            </button>

            {error && <p className="mt-3 text-[12.5px] text-severidad-critica">{error}</p>}
          </div>

          {reporte && (
            <div className="mt-6 animate-fade-in-up space-y-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FilaMetadatos titulo="Referencia" metadatos={reporte.referencia} />
                <FilaMetadatos titulo="Objetivo" metadatos={reporte.objetivo} />
              </div>

              <div
                className={`rounded-xl border px-4 py-3.5 ${
                  reporte.resumen.sinErroresBloqueantes
                    ? "border-system/30 bg-system-tint"
                    : "border-severidad-critica/30 bg-severidad-criticaTint"
                }`}
              >
                <p
                  className={`text-[13px] font-medium ${
                    reporte.resumen.sinErroresBloqueantes ? "text-system" : "text-severidad-critica"
                  }`}
                >
                  {reporte.resumen.sinErroresBloqueantes
                    ? "El archivo objetivo no tiene errores bloqueantes."
                    : "El archivo objetivo tiene errores que hay que corregir antes de enviar a Validaciones."}
                </p>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-ink/80">
                  <span>
                    <span className="font-semibold text-severidad-critica">{reporte.resumen.errores}</span> errores
                  </span>
                  <span>
                    <span className="font-semibold text-severidad-media">{reporte.resumen.advertencias}</span> avisos
                  </span>
                  <span>
                    <span className="font-semibold text-system">{reporte.resumen.informativos}</span> informativos
                  </span>
                  <span className="text-muted">
                    {reporte.resumen.codsCompartidos} Cod. compartidos · {reporte.resumen.soloEnReferencia} sólo en
                    referencia · {reporte.resumen.soloEnObjetivo} sólo en objetivo
                  </span>
                </div>
                {reporte.vocabularioTipoDato.soloEnObjetivo.length > 0 && (
                  <p className="mt-2 text-[12px] text-severidad-media">
                    Tipo Dato que no existe en la referencia:{" "}
                    <span className="font-mono">{reporte.vocabularioTipoDato.soloEnObjetivo.join(", ")}</span> — revisá
                    si es un error de tipeo.
                  </p>
                )}
              </div>

              <div className="scroll-x-limpio flex gap-1.5 overflow-x-auto">
                {FILTROS.map(({ clave, label }) => (
                  <button
                    key={clave}
                    onClick={() => setFiltro(clave)}
                    className={`shrink-0 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-all duration-150 ease-spring ${
                      filtro === clave
                        ? "border-system bg-system-tint text-system"
                        : "border-line text-muted hover:border-system/50"
                    }`}
                  >
                    {label}
                    {clave !== "todos" && (
                      <span className="ml-1 opacity-70">
                        ({reporte.hallazgos.filter((h) => h.severidad === clave).length})
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {hallazgosFiltrados.length === 0 ? (
                <p className="rounded-lg border border-line bg-surface px-3.5 py-4 text-center text-[12.5px] text-muted">
                  Sin hallazgos{filtro !== "todos" ? " en esta categoría" : ""}.
                </p>
              ) : (
                <ul className="space-y-2">
                  {hallazgosFiltrados.map((hallazgo) => (
                    <TarjetaHallazgo key={hallazgo.id} hallazgo={hallazgo} />
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
