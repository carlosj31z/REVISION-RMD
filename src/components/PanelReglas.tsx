"use client";

import { useEffect, useState, useCallback } from "react";
import type { ReglaHomologacion, SeccionCodigo, EtapaCodigo } from "@/types/rmd";

const SECCIONES = [
  "SOLIDOS",
  "ACONDICIONADO",
  "CAPSULAS_BLANDAS",
  "COSMETICOS",
  "INY_HORMONALES",
  "MENTHOLATUM",
  "POLVOS_EFERVESCENTES",
  "SEMISOLIDOS",
  "SEMISOLIDOS_HORM",
  "SOLIDOS_HORMONALES",
  "SOLIDOS_4",
] as const;

const ETAPAS = ["FABRICACION", "RECUBRIMIENTO", "ENVASE", "ACONDICIONADO"] as const;

interface Props {
  onVolver: () => void;
}

export function PanelReglas({ onVolver }: Props) {
  const [reglas, setReglas] = useState<ReglaHomologacion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [texto, setTexto] = useState("");
  const [seccion, setSeccion] = useState<string>("TODAS");
  const [etapa, setEtapa] = useState<string>("TODAS");
  const [guardando, setGuardando] = useState(false);

  const cargarReglas = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await fetch("/api/reglas");
      if (!res.ok) throw new Error((await res.json()).error ?? "No se pudieron cargar las reglas.");
      const data = await res.json();
      setReglas(data.reglas);
    } catch (err: any) {
      setError(err.message ?? "Ocurrió un error inesperado.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargarReglas();
  }, [cargarReglas]);

  const agregarRegla = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!texto.trim()) return;
      setGuardando(true);
      setError(null);
      try {
        const res = await fetch("/api/reglas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            texto: texto.trim(),
            seccionCodigo: seccion === "TODAS" ? null : (seccion as SeccionCodigo),
            etapaCodigo: etapa === "TODAS" ? null : (etapa as EtapaCodigo),
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "No se pudo crear la regla.");
        setTexto("");
        setSeccion("TODAS");
        setEtapa("TODAS");
        await cargarReglas();
      } catch (err: any) {
        setError(err.message ?? "Ocurrió un error inesperado.");
      } finally {
        setGuardando(false);
      }
    },
    [texto, seccion, etapa, cargarReglas]
  );

  const alternarActiva = useCallback(
    async (regla: ReglaHomologacion) => {
      setReglas((prev) =>
        prev.map((r) => (r.id === regla.id ? { ...r, activa: !r.activa } : r))
      );
      try {
        await fetch(`/api/reglas/${regla.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ activa: !regla.activa }),
        });
      } catch {
        // Revertir si falla
        setReglas((prev) =>
          prev.map((r) => (r.id === regla.id ? { ...r, activa: regla.activa } : r))
        );
      }
    },
    []
  );

  const eliminarRegla = useCallback(async (id: string) => {
    if (!confirm("¿Eliminar esta regla permanente? No se puede deshacer.")) return;
    const anterior = reglas;
    setReglas((prev) => prev.filter((r) => r.id !== id));
    try {
      const res = await fetch(`/api/reglas/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setReglas(anterior);
    }
  }, [reglas]);

  return (
    <div className="mx-auto max-w-2xl animate-fade-in-up px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-system">
            Configuración
          </p>
          <h1 className="mt-1 text-[22px] font-semibold leading-tight tracking-[-0.01em] text-ink">
            Reglas permanentes de homologación
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            Instrucciones fijas (ej. "X debe reemplazarse por Y") que se aplican automáticamente
            en todas las revisiones futuras de la sección/etapa que indiques, sin tener que
            repetirlas cada vez en el Control de Cambio.
          </p>
        </div>
        <button
          onClick={onVolver}
          className="shrink-0 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-system transition-all duration-150 ease-spring hover:bg-system-tint active:scale-95"
        >
          ← Volver
        </button>
      </div>

      <form onSubmit={agregarRegla} className="mb-8 rounded-xl border border-line bg-white p-4 shadow-soft">
        <label className="mb-1.5 block text-[12px] font-medium text-ink">Nueva regla</label>
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={3}
          placeholder='Ej: El texto "CONTROLAR QUE SUS COMPAÑEROS HAGAN LO MISMO" debe reemplazarse por "CONTROLAR QUE SUS COMPAÑEROS REALICEN LO MISMO".'
          className="w-full resize-none rounded-lg border border-line bg-white px-3 py-2.5 text-[13px] leading-relaxed text-ink placeholder:text-muted/60 transition-all duration-150 ease-spring focus:border-system focus:shadow-ring focus:outline-none"
        />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted">Sección</label>
            <select
              value={seccion}
              onChange={(e) => setSeccion(e.target.value)}
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-[13px] text-ink transition-all duration-150 ease-spring focus:border-system focus:shadow-ring focus:outline-none"
            >
              <option value="TODAS">Todas las secciones</option>
              {SECCIONES.map((s) => (
                <option key={s} value={s}>
                  {s.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted">Etapa</label>
            <select
              value={etapa}
              onChange={(e) => setEtapa(e.target.value)}
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-[13px] text-ink transition-all duration-150 ease-spring focus:border-system focus:shadow-ring focus:outline-none"
            >
              <option value="TODAS">Todas las etapas</option>
              {ETAPAS.map((et) => (
                <option key={et} value={et}>
                  {et}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button
          type="submit"
          disabled={!texto.trim() || guardando}
          className="mt-3 w-full rounded-lg bg-system px-4 py-2.5 text-[13px] font-medium text-white shadow-soft transition-all duration-150 ease-spring hover:bg-system-light hover:shadow-elevated active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:shadow-soft disabled:active:scale-100"
        >
          {guardando ? "Guardando…" : "Agregar regla"}
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
      ) : reglas.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-white px-4 py-8 text-center">
          <p className="text-[13px] text-muted">Todavía no agregaste ninguna regla permanente.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {reglas.map((r, i) => (
            <li
              key={r.id}
              style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
              className={`animate-fade-in-up rounded-lg border bg-white px-3.5 py-3 shadow-soft transition-all duration-200 ease-spring hover:shadow-elevated ${
                r.activa ? "border-line" : "border-line/60 opacity-50"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-[13px] leading-snug text-ink/85">{r.texto}</p>
                <div className="flex shrink-0 gap-1.5">
                  <button
                    onClick={() => alternarActiva(r)}
                    className="rounded border border-line px-2 py-1 text-[11px] font-medium text-muted transition-all duration-150 ease-spring hover:border-system hover:text-system active:scale-95"
                  >
                    {r.activa ? "Desactivar" : "Activar"}
                  </button>
                  <button
                    onClick={() => eliminarRegla(r.id)}
                    className="rounded border border-line px-2 py-1 text-[11px] font-medium text-muted transition-all duration-150 ease-spring hover:border-severidad-critica hover:text-severidad-critica active:scale-95"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
              <div className="mt-2 flex gap-x-3 font-mono text-[11px] text-muted">
                <span>{r.seccionCodigo ?? "Todas las secciones"}</span>
                <span>·</span>
                <span>{r.etapaCodigo ?? "Todas las etapas"}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
