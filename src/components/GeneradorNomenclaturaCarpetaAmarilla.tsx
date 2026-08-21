"use client";

import { useState, useCallback, useMemo } from "react";
import { Campo } from "@/components/ui/FormPrimitives";

const PRIORIDADES = ["1", "2", "3"] as const;
// Tal como aparece en el ejemplo real ("...-C1-..."): sin ".0" final para
// los valores enteros, a diferencia de FI/FA que sí lo llevan siempre.
const COMPLEJIDADES = ["0.5", "1", "1.5", "2", "2.5", "3"] as const;
const FASES = ["1", "1R", "2", "2R"] as const;

function construirNomenclatura(campos: {
  fechaISO: string; // YYYYMMDD, ya sin guiones
  iniciales: string;
  prioridad: string;
  complejidad: string;
  fase: string;
}): string {
  const iniciales = campos.iniciales.trim().toUpperCase().slice(0, 2);
  if (!campos.fechaISO || iniciales.length !== 2) return "";
  return `${campos.fechaISO}${iniciales}-${campos.prioridad}-C${campos.complejidad}-FI1.0-FA1.0-F${campos.fase}`;
}

export function GeneradorNomenclaturaCarpetaAmarilla() {
  const [abierto, setAbierto] = useState(false);
  const [fecha, setFecha] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [iniciales, setIniciales] = useState("");
  const [prioridad, setPrioridad] = useState<(typeof PRIORIDADES)[number]>("1");
  const [complejidad, setComplejidad] = useState<(typeof COMPLEJIDADES)[number]>("1");
  const [fase, setFase] = useState<(typeof FASES)[number]>("1");
  const [copiado, setCopiado] = useState(false);

  const fechaISO = fecha.replaceAll("-", "");

  const nomenclatura = useMemo(
    () => construirNomenclatura({ fechaISO, iniciales, prioridad, complejidad, fase }),
    [fechaISO, iniciales, prioridad, complejidad, fase]
  );

  const copiar = useCallback(async () => {
    if (!nomenclatura) return;
    try {
      await navigator.clipboard.writeText(nomenclatura);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    } catch {
      // Sin permiso de portapapeles: el texto ya queda seleccionable.
    }
  }, [nomenclatura]);

  return (
    <div className="mx-auto mb-2 max-w-2xl px-4 sm:px-6">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-left shadow-soft transition-all duration-150 ease-spring hover:shadow-elevated"
      >
        <span>
          <span className="block text-[13px] font-semibold text-ink">
            Generar nomenclatura de Carpeta Amarilla
          </span>
          <span className="block text-[11.5px] text-muted">
            Fecha + iniciales, prioridad, complejidad y fase — ej.{" "}
            <span className="font-mono">20260814DV-2-C1-FI1.0-FA1.0-F2</span>
          </span>
        </span>
        <span
          className={`shrink-0 text-[13px] text-muted transition-transform duration-200 ${abierto ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>

      {abierto && (
        <div className="mt-2 animate-fade-in-up rounded-xl border border-line bg-surface p-4 shadow-soft">
          <div className="rounded-lg border border-system/30 bg-system-tint px-3 py-2.5">
            <div className="flex items-start justify-between gap-2">
              <p className="select-all font-mono text-[13px] leading-relaxed text-system">
                {nomenclatura || "Completá los campos de abajo."}
              </p>
              <button
                type="button"
                onClick={copiar}
                disabled={!nomenclatura}
                className="shrink-0 rounded-lg border border-system/40 px-2.5 py-1 text-[11.5px] font-medium text-system transition-all duration-150 ease-spring hover:bg-system hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {copiado ? "Copiado ✓" : "Copiar"}
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Campo label="Fecha de ingreso del registro">
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink transition-all duration-150 ease-spring focus:border-system focus:shadow-ring focus:outline-none"
              />
            </Campo>
            <Campo
              label="Iniciales (nombre + apellido)"
              descripcion='Ej. "Diana Vargas" → "DV"'
            >
              <input
                value={iniciales}
                onChange={(e) => setIniciales(e.target.value.toUpperCase().slice(0, 2))}
                placeholder="DV"
                maxLength={2}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-[13px] uppercase text-ink placeholder:font-sans placeholder:normal-case placeholder:text-muted/60 transition-all duration-150 ease-spring focus:border-system focus:shadow-ring focus:outline-none"
              />
            </Campo>
            <Campo label="Prioridad">
              <select
                value={prioridad}
                onChange={(e) => setPrioridad(e.target.value as (typeof PRIORIDADES)[number])}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink transition-all duration-150 ease-spring focus:border-system focus:shadow-ring focus:outline-none"
              >
                {PRIORIDADES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo label="Nivel de complejidad">
              <select
                value={complejidad}
                onChange={(e) => setComplejidad(e.target.value as (typeof COMPLEJIDADES)[number])}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink transition-all duration-150 ease-spring focus:border-system focus:shadow-ring focus:outline-none"
              >
                {COMPLEJIDADES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo label="Fase del RMD">
              <select
                value={fase}
                onChange={(e) => setFase(e.target.value as (typeof FASES)[number])}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink transition-all duration-150 ease-spring focus:border-system focus:shadow-ring focus:outline-none"
              >
                {FASES.map((f) => (
                  <option key={f} value={f}>
                    F{f}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo label="Factor de ingreso / autorización" descripcion="Siempre fijos.">
              <p className="flex h-[38px] items-center rounded-lg border border-line bg-paper px-3 font-mono text-[13px] text-muted">
                FI1.0 · FA1.0
              </p>
            </Campo>
          </div>
        </div>
      )}
    </div>
  );
}
