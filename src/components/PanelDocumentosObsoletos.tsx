"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { DocumentoObsoleto, DocumentoVigente } from "@/types/rmd";
import { leerRespuestaApi } from "@/lib/leerRespuestaApi";

interface Props {
  onVolver: () => void;
}

interface ResumenVigentes {
  total: number;
  actualizadoEn: string | null;
}

function formatearFecha(iso?: string | null): string {
  if (!iso) return "—";
  const [anio, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${anio}`;
}

/**
 * Detalle "si el usuario quiere" del maestro: nunca lista las ~3300 filas de
 * una (ver /api/documentos-vigentes/buscar), sólo busca por código o título
 * a pedido. Colapsado por defecto — la carga del Excel de arriba es la
 * acción principal de este panel.
 */
function BuscadorDocumentosVigentes({ total }: { total: number }) {
  const [abierto, setAbierto] = useState(false);
  const [termino, setTermino] = useState("");
  const [resultados, setResultados] = useState<DocumentoVigente[]>([]);
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
        const res = await fetch(`/api/documentos-vigentes/buscar?q=${encodeURIComponent(termino.trim())}`, {
          cache: "no-store",
          signal: controlador.signal,
        });
        const data = await leerRespuestaApi(res);
        if (!res.ok) throw new Error(data.error ?? "No se pudo buscar.");
        setResultados(data.documentos);
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
        {abierto ? "Ocultar buscador" : `Ver detalle de los ${total} documentos cargados`}
      </button>

      {abierto && (
        <div className="mt-2.5 animate-fade-in-up">
          <input
            value={termino}
            onChange={(e) => setTermino(e.target.value)}
            placeholder="Buscar por código o título (ej. IPRO-P200, esterilización)…"
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
                      <th className="px-2.5 py-1.5 font-semibold">Código</th>
                      <th className="px-2.5 py-1.5 font-semibold">Título</th>
                      <th className="px-2.5 py-1.5 font-semibold">Vigente hasta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultados.map((d) => (
                      <tr key={d.id} className="border-t border-line">
                        <td className="whitespace-nowrap px-2.5 py-1.5 font-mono text-ink/80">{d.codigo}</td>
                        <td className="px-2.5 py-1.5 text-ink/80">{d.titulo}</td>
                        <td className="whitespace-nowrap px-2.5 py-1.5 text-muted">
                          {formatearFecha(d.vigenteHasta)}
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

function ImportadorDocumentosVigentes() {
  const [resumen, setResumen] = useState<ResumenVigentes | null>(null);
  const [cargandoResumen, setCargandoResumen] = useState(true);
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const cargarResumen = useCallback(async () => {
    setCargandoResumen(true);
    try {
      const res = await fetch("/api/documentos-vigentes", { cache: "no-store" });
      const data = await leerRespuestaApi(res);
      if (!res.ok) throw new Error(data.error ?? "No se pudo cargar el resumen.");
      setResumen(data);
    } catch (err: any) {
      // No es crítico para el resto del panel: se ve solo acá arriba.
      setError(err.message ?? "No se pudo cargar el resumen de documentos vigentes.");
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
        const res = await fetch("/api/documentos-vigentes/importar", {
          method: "POST",
          body: formData,
        });
        const data = await leerRespuestaApi(res);
        if (!res.ok) throw new Error(data.error ?? "No se pudo importar el archivo.");
        setResultado(
          `${data.importados} documentos cargados` +
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
    <div className="mb-8 rounded-xl border border-line bg-surface p-4 shadow-soft">
      <h2 className="text-[13px] font-semibold text-ink">Documentos vigentes (maestro)</h2>
      <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
        Cargá acá el Excel completo con todos los Instructivos/Procedimientos/Formatos vigentes
        (columna con el código y columna con el título; si trae una columna de vigencia/validez,
        también se usa). Reemplaza todo lo cargado antes — es la lista completa a hoy, no un
        agregado. Éste es el indicador PRINCIPAL para saber si un documento sigue vigente; lo que
        se agrega abajo a mano queda como respaldo secundario.
      </p>

      <p className="mt-3 text-[12px] text-muted">
        {cargandoResumen ? (
          "Consultando lo ya cargado…"
        ) : resumen && resumen.total > 0 ? (
          <>
            <span className="font-medium text-ink">{resumen.total}</span> documentos cargados
            {resumen.actualizadoEn && (
              <> · última importación: {new Date(resumen.actualizadoEn).toLocaleString()}</>
            )}
          </>
        ) : (
          "Todavía no se cargó ningún documento vigente."
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

      {resultado && (
        <p className="mt-2.5 text-[12.5px] text-severidad-baja">✓ {resultado}</p>
      )}
      {error && <p className="mt-2.5 text-[12.5px] text-severidad-critica">{error}</p>}

      <BuscadorDocumentosVigentes total={resumen?.total ?? 0} />
    </div>
  );
}

export function PanelDocumentosObsoletos({ onVolver }: Props) {
  const [documentos, setDocumentos] = useState<DocumentoObsoleto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [codigo, setCodigo] = useState("");
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargarDocumentos = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await fetch("/api/documentos-obsoletos");
      if (!res.ok)
        throw new Error((await leerRespuestaApi(res)).error ?? "No se pudieron cargar los documentos.");
      const data = await leerRespuestaApi(res);
      setDocumentos(data.documentos);
    } catch (err: any) {
      setError(err.message ?? "Ocurrió un error inesperado.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargarDocumentos();
  }, [cargarDocumentos]);

  const agregarDocumento = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!codigo.trim()) return;
      setGuardando(true);
      setError(null);
      try {
        const res = await fetch("/api/documentos-obsoletos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ codigo: codigo.trim(), motivo: motivo.trim() || undefined }),
        });
        if (!res.ok) throw new Error((await leerRespuestaApi(res)).error ?? "No se pudo registrar el documento.");
        setCodigo("");
        setMotivo("");
        await cargarDocumentos();
      } catch (err: any) {
        setError(err.message ?? "Ocurrió un error inesperado.");
      } finally {
        setGuardando(false);
      }
    },
    [codigo, motivo, cargarDocumentos]
  );

  const alternarActivo = useCallback(async (doc: DocumentoObsoleto) => {
    setDocumentos((prev) =>
      prev.map((d) => (d.id === doc.id ? { ...d, activo: !d.activo } : d))
    );
    try {
      await fetch(`/api/documentos-obsoletos/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo: !doc.activo }),
      });
    } catch {
      setDocumentos((prev) =>
        prev.map((d) => (d.id === doc.id ? { ...d, activo: doc.activo } : d))
      );
    }
  }, []);

  const eliminarDocumento = useCallback(
    async (id: string) => {
      if (!confirm("¿Eliminar este documento obsoleto? No se puede deshacer.")) return;
      const anterior = documentos;
      setDocumentos((prev) => prev.filter((d) => d.id !== id));
      try {
        const res = await fetch(`/api/documentos-obsoletos/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error();
      } catch {
        setDocumentos(anterior);
      }
    },
    [documentos]
  );

  return (
    <div className="h-pantalla flex animate-fade-in flex-col bg-paper">
      {/* Barra fija: el botón "Volver" antes vivía arriba de la lista y
          scrolleaba junto con ella, así que con varios documentos se iba de
          pantalla. Ahora queda siempre visible (mismo patrón sticky que el
          resto de la app, ver page.tsx). */}
      <div className="material-chrome-white inset-seguro-x sticky top-0 z-10 flex shrink-0 items-center justify-between gap-3 border-b border-line/70 px-4 py-3 shadow-soft sm:px-6">
        <button
          onClick={onVolver}
          className="-ml-1.5 flex min-h-[38px] shrink-0 items-center gap-1 rounded-lg px-2.5 text-[13px] font-medium text-system transition-all duration-150 ease-spring hover:bg-system-tint active:scale-95"
        >
          ← Volver
        </button>
        <h1 className="min-w-0 truncate text-[13px] font-semibold text-ink sm:text-[14px]">
          Documentos vigentes
        </h1>
      </div>

      <div className="inset-seguro-x min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl animate-fade-in-up px-4 py-6 sm:px-6 sm:py-8">
          <ImportadorDocumentosVigentes />

          <h2 className="mb-1.5 text-[13px] font-semibold text-ink">
            Documentos obsoletos (manual)
          </h2>
          <p className="mb-6 text-[13px] leading-relaxed text-muted">
            Códigos de Instructivo, Procedimiento o Formato que ya no están vigentes (ej.{" "}
            <span className="font-mono">IPRO-P200</span>). Si un RMD sigue citando alguno, se
            genera automáticamente una alerta en la revisión — este listado es el respaldo
            secundario del maestro de arriba, para casos que el Excel no cubra.
          </p>

          <form onSubmit={agregarDocumento} className="mb-8 rounded-xl border border-line bg-surface p-4 shadow-soft">
        <label className="mb-1.5 block text-[12px] font-medium text-ink">Código del documento</label>
        <input
          value={codigo}
          onChange={(e) => setCodigo(e.target.value.toUpperCase())}
          placeholder="Ej: IPRO-P200"
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-[13px] text-ink placeholder:font-sans placeholder:text-muted/60 transition-all duration-150 ease-spring focus:border-system focus:shadow-ring focus:outline-none"
        />
        <label className="mb-1.5 mt-3 block text-[12px] font-medium text-ink">
          Motivo <span className="font-normal text-muted">(opcional)</span>
        </label>
        <textarea
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          rows={2}
          placeholder="Ej: Reemplazado por IPRO-P250 desde 2026."
          className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2.5 text-[13px] leading-relaxed text-ink placeholder:text-muted/60 transition-all duration-150 ease-spring focus:border-system focus:shadow-ring focus:outline-none"
        />
        <button
          type="submit"
          disabled={!codigo.trim() || guardando}
          className="mt-3 w-full rounded-lg bg-system px-4 py-2.5 text-[13px] font-medium text-white shadow-soft transition-all duration-150 ease-spring hover:bg-system-light hover:shadow-elevated active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:shadow-soft disabled:active:scale-100"
        >
          {guardando ? "Guardando…" : "Agregar documento obsoleto"}
        </button>
      </form>

      {error && (
        <p className="mb-4 animate-fade-in-up rounded-lg border border-severidad-critica/30 bg-severidad-criticaTint px-3 py-2 text-[12.5px] text-severidad-critica">
          {error}
        </p>
      )}

      {cargando ? (
        <div className="flex justify-center py-8">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-system" />
        </div>
      ) : documentos.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-surface px-4 py-8 text-center">
          <p className="text-[13px] text-muted">Todavía no registraste ningún documento obsoleto.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {documentos.map((d, i) => (
            <li
              key={d.id}
              style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
              className={`animate-fade-in-up rounded-lg border bg-surface px-3.5 py-3 shadow-soft transition-all duration-200 ease-spring hover:shadow-elevated ${
                d.activo ? "border-line" : "border-line/60 opacity-50"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-[13px] font-semibold text-ink">{d.codigo}</p>
                  {d.motivo && (
                    <p className="mt-1 text-[12.5px] leading-snug text-ink/70">{d.motivo}</p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button
                    onClick={() => alternarActivo(d)}
                    className="rounded border border-line px-2 py-1 text-[11px] font-medium text-muted transition-all duration-150 ease-spring hover:border-system hover:text-system active:scale-95"
                  >
                    {d.activo ? "Desactivar" : "Activar"}
                  </button>
                  <button
                    onClick={() => eliminarDocumento(d.id)}
                    className="rounded border border-line px-2 py-1 text-[11px] font-medium text-muted transition-all duration-150 ease-spring hover:border-severidad-critica hover:text-severidad-critica active:scale-95"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
        </div>
      </div>
    </div>
  );
}
