"use client";

import { useEffect, useState, useCallback } from "react";
import type { DocumentoObsoleto } from "@/types/rmd";

interface Props {
  onVolver: () => void;
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
        throw new Error((await res.json()).error ?? "No se pudieron cargar los documentos.");
      const data = await res.json();
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
        if (!res.ok) throw new Error((await res.json()).error ?? "No se pudo registrar el documento.");
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
          Documentos obsoletos
        </h1>
      </div>

      <div className="inset-seguro-x min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl animate-fade-in-up px-4 py-6 sm:px-6 sm:py-8">
          <p className="mb-6 text-[13px] leading-relaxed text-muted">
            Códigos de Instructivo, Procedimiento o Formato que ya no están vigentes (ej.{" "}
            <span className="font-mono">IPRO-P200</span>). Si un RMD sigue citando alguno, se
            genera automáticamente una alerta en la revisión.
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
