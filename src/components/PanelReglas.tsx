"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import type { ReglaHomologacion, SeccionCodigo, EtapaCodigo } from "@/types/rmd";
import type { AnalisisRegla } from "@/lib/analizarRegla";

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

/** Reglas del mismo alcance se aplican juntas, así que se leen mejor juntas:
 *  agrupar por sección/etapa deja ver de un vistazo qué se dispara en cada
 *  combinación, en vez de una lista plana donde el alcance es un pie de nota. */
function claveAlcance(r: ReglaHomologacion): string {
  return `${r.seccionCodigo ?? "TODAS"}|||${r.etapaCodigo ?? "TODAS"}`;
}

function etiquetaAlcance(clave: string): string {
  const [seccion, etapa] = clave.split("|||");
  const s = seccion === "TODAS" ? "Todas las secciones" : seccion.replaceAll("_", " ");
  const e = etapa === "TODAS" ? "todas las etapas" : etapa;
  return `${s} · ${e}`;
}

export function PanelReglas({ onVolver }: Props) {
  const [reglas, setReglas] = useState<ReglaHomologacion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [mostrarInactivas, setMostrarInactivas] = useState(false);

  const [texto, setTexto] = useState("");
  const [seccion, setSeccion] = useState<string>("TODAS");
  const [etapa, setEtapa] = useState<string>("TODAS");
  const [guardando, setGuardando] = useState(false);

  // Flujo de validación: la IA devuelve cómo interpretó la regla y el
  // analista la valida o pide otra vuelta con un comentario.
  const [analisis, setAnalisis] = useState<AnalisisRegla | null>(null);
  const [analizando, setAnalizando] = useState(false);
  const [comentario, setComentario] = useState("");
  const [historial, setHistorial] = useState<
    { textoRegla: string; comentarioUsuario: string }[]
  >([]);

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

  const limpiarFormulario = useCallback(() => {
    setTexto("");
    setSeccion("TODAS");
    setEtapa("TODAS");
    setAnalisis(null);
    setComentario("");
    setHistorial([]);
  }, []);

  const revisarConIA = useCallback(
    async (comentarioPrevio?: string) => {
      if (!texto.trim()) return;
      setAnalizando(true);
      setError(null);
      try {
        const nuevoHistorial = comentarioPrevio
          ? [...historial, { textoRegla: texto.trim(), comentarioUsuario: comentarioPrevio }]
          : historial;

        const res = await fetch("/api/reglas/analizar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            texto: texto.trim(),
            seccionCodigo: seccion === "TODAS" ? null : seccion,
            etapaCodigo: etapa === "TODAS" ? null : etapa,
            historial: nuevoHistorial,
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "No se pudo analizar la regla.");
        const data = await res.json();
        setAnalisis(data.analisis);
        setHistorial(nuevoHistorial);
        setComentario("");
      } catch (err: any) {
        setError(err.message ?? "Ocurrió un error inesperado.");
      } finally {
        setAnalizando(false);
      }
    },
    [texto, seccion, etapa, historial]
  );

  const guardarRegla = useCallback(async () => {
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
      limpiarFormulario();
      await cargarReglas();
    } catch (err: any) {
      setError(err.message ?? "Ocurrió un error inesperado.");
    } finally {
      setGuardando(false);
    }
  }, [texto, seccion, etapa, cargarReglas, limpiarFormulario]);

  const alternarActiva = useCallback(async (regla: ReglaHomologacion) => {
    setReglas((prev) => prev.map((r) => (r.id === regla.id ? { ...r, activa: !r.activa } : r)));
    try {
      await fetch(`/api/reglas/${regla.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activa: !regla.activa }),
      });
    } catch {
      setReglas((prev) => prev.map((r) => (r.id === regla.id ? { ...r, activa: regla.activa } : r)));
    }
  }, []);

  const eliminarRegla = useCallback(
    async (id: string) => {
      if (!confirm("¿Eliminar esta regla permanente? No se puede deshacer.")) return;
      const anterior = reglas;
      setReglas((prev) => prev.filter((r) => r.id !== id));
      try {
        const res = await fetch(`/api/reglas/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error();
      } catch {
        setReglas(anterior);
      }
    },
    [reglas]
  );

  const { grupos, activas, inactivas, totalFiltrado } = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const filtradas = q
      ? reglas.filter(
          (r) =>
            r.texto.toLowerCase().includes(q) ||
            (r.seccionCodigo ?? "").toLowerCase().includes(q) ||
            (r.etapaCodigo ?? "").toLowerCase().includes(q)
        )
      : reglas;

    const act = filtradas.filter((r) => r.activa);
    const inact = filtradas.filter((r) => !r.activa);

    const porAlcance = new Map<string, ReglaHomologacion[]>();
    for (const r of act) {
      const k = claveAlcance(r);
      if (!porAlcance.has(k)) porAlcance.set(k, []);
      porAlcance.get(k)!.push(r);
    }
    // Las de alcance general primero: son las que más revisiones tocan.
    const ordenados = [...porAlcance.entries()].sort(([a], [b]) => {
      const generalA = a.startsWith("TODAS") ? 0 : 1;
      const generalB = b.startsWith("TODAS") ? 0 : 1;
      return generalA - generalB || a.localeCompare(b);
    });

    return { grupos: ordenados, activas: act, inactivas: inact, totalFiltrado: filtradas.length };
  }, [reglas, busqueda]);

  return (
    <div className="h-pantalla flex animate-fade-in flex-col bg-paper">
      {/* Barra fija: antes el botón "Volver" vivía arriba del contenido que
          scrollea junto con la lista de reglas, así que en cuanto había
          varias se iba de pantalla y costaba encontrarlo. Ahora queda
          siempre visible, con el mismo patrón sticky que usa el resto de
          la app (ver page.tsx). */}
      <div className="material-chrome-white inset-seguro-x sticky top-0 z-10 flex shrink-0 items-center justify-between gap-3 border-b border-line/70 px-4 py-3 shadow-soft sm:px-6">
        <button
          onClick={onVolver}
          className="-ml-1.5 flex min-h-[38px] shrink-0 items-center gap-1 rounded-lg px-2.5 text-[13px] font-medium text-system transition-all duration-150 ease-spring hover:bg-system-tint active:scale-95"
        >
          ← Volver
        </button>
        <h1 className="min-w-0 truncate text-[13px] font-semibold text-ink sm:text-[14px]">
          Reglas permanentes de homologación
        </h1>
      </div>

      <div className="inset-seguro-x min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl animate-fade-in-up px-4 py-6 sm:px-6 sm:py-8">
          <p className="mb-6 text-[13px] leading-relaxed text-muted">
            Instrucciones fijas que se aplican solas en todas las revisiones futuras de la
            sección/etapa que indiques. Como nadie las vuelve a leer al aplicarlas, conviene
            revisarlas con la IA antes de guardarlas.
          </p>

          {/* ---------- Redacción de una regla nueva ---------- */}
      <div className="mb-8 rounded-xl border border-line bg-surface p-4 shadow-soft">
        <label className="mb-1.5 block text-[12px] font-medium text-ink">Nueva regla</label>
        <textarea
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            // La redacción cambió: el análisis anterior ya no la describe.
            if (analisis) setAnalisis(null);
          }}
          rows={3}
          placeholder='Ej: El texto "CONTROLAR QUE SUS COMPAÑEROS HAGAN LO MISMO" debe reemplazarse por "CONTROLAR QUE SUS COMPAÑEROS REALICEN LO MISMO".'
          className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2.5 text-[13px] leading-relaxed text-ink placeholder:text-muted/60 transition-all duration-150 ease-spring focus:border-system focus:shadow-ring focus:outline-none"
        />
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted">Sección</label>
            <select
              value={seccion}
              onChange={(e) => setSeccion(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink transition-all duration-150 ease-spring focus:border-system focus:shadow-ring focus:outline-none"
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
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink transition-all duration-150 ease-spring focus:border-system focus:shadow-ring focus:outline-none"
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

        {!analisis && (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button
              onClick={() => revisarConIA()}
              disabled={!texto.trim() || analizando}
              className="min-h-[42px] flex-1 rounded-lg bg-system px-4 text-[13px] font-medium text-white shadow-soft transition-all duration-150 ease-spring hover:bg-system-light hover:shadow-elevated active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {analizando ? "Revisando con IA…" : "Revisar con IA antes de guardar"}
            </button>
            <button
              onClick={guardarRegla}
              disabled={!texto.trim() || guardando}
              title="Guardar sin que la IA verifique su interpretación ni el cruce con otras reglas"
              className="min-h-[42px] rounded-lg border border-line px-4 text-[13px] font-medium text-muted transition-all duration-150 ease-spring hover:border-system hover:text-system active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {guardando ? "Guardando…" : "Guardar directo"}
            </button>
          </div>
        )}

        {analisis && (
          <div className="mt-4 animate-fade-in-up space-y-3 border-t border-line pt-4">
            <Bloque titulo="Así entendí la regla">
              <p className="text-[13px] leading-relaxed text-ink/85">{analisis.interpretacion}</p>
            </Bloque>

            {analisis.loQueHara.length > 0 && (
              <Bloque titulo="Marcaría como hallazgo">
                <ul className="space-y-1">
                  {analisis.loQueHara.map((x, i) => (
                    <li key={i} className="text-[12.5px] leading-snug text-ink/80">
                      <span className="text-system">✓</span> {x}
                    </li>
                  ))}
                </ul>
              </Bloque>
            )}

            {analisis.loQueNoHara.length > 0 && (
              <Bloque titulo="NO marcaría">
                <ul className="space-y-1">
                  {analisis.loQueNoHara.map((x, i) => (
                    <li key={i} className="text-[12.5px] leading-snug text-muted">
                      <span className="text-muted">✕</span> {x}
                    </li>
                  ))}
                </ul>
              </Bloque>
            )}

            {analisis.ambiguedades.length > 0 && (
              <div className="rounded-lg border border-severidad-alta/30 bg-severidad-altaTint px-3 py-2.5">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-severidad-alta">
                  Quedó ambiguo
                </p>
                <ul className="space-y-1">
                  {analisis.ambiguedades.map((a, i) => (
                    <li key={i} className="text-[12.5px] leading-snug text-severidad-alta/90">
                      · {a}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {analisis.conflictos.length > 0 && (
              <div className="rounded-lg border border-severidad-critica/30 bg-severidad-criticaTint px-3 py-2.5">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-severidad-critica">
                  Se cruza con {analisis.conflictos.length} regla
                  {analisis.conflictos.length !== 1 ? "s" : ""} ya existente
                  {analisis.conflictos.length !== 1 ? "s" : ""}
                </p>
                <ul className="space-y-2">
                  {analisis.conflictos.map((c) => (
                    <li key={c.id} className="text-[12.5px] leading-snug">
                      <span className="rounded bg-severidad-critica/15 px-1.5 py-0.5 font-medium text-severidad-critica">
                        {c.tipo === "contradice"
                          ? "La contradice"
                          : c.tipo === "duplica"
                            ? "La duplica"
                            : "Se superpone"}
                      </span>
                      <p className="mt-1 italic text-severidad-critica/80">“{c.texto}”</p>
                      <p className="mt-0.5 text-severidad-critica/90">{c.explicacion}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {analisis.textoSugerido && (
              <div className="rounded-lg border border-system/30 bg-system-tint px-3 py-2.5">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-system">
                  Redacción sugerida
                </p>
                <p className="text-[12.5px] leading-relaxed text-system">
                  {analisis.textoSugerido}
                </p>
                <button
                  onClick={() => {
                    setTexto(analisis.textoSugerido!);
                    setAnalisis(null);
                  }}
                  className="mt-2 min-h-[34px] rounded-lg border border-system px-3 text-[12px] font-medium text-system transition-all duration-150 ease-spring hover:bg-system hover:text-white active:scale-95"
                >
                  Usar esta redacción
                </button>
              </div>
            )}

            <div className="rounded-lg border border-line bg-paper px-3 py-3">
              <p className="mb-2 text-[12px] font-medium text-ink">
                ¿Es esto lo que necesitás que haga la regla?
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  onClick={guardarRegla}
                  disabled={guardando}
                  className="min-h-[38px] flex-1 rounded-lg bg-system px-3 text-[12.5px] font-medium text-white shadow-soft transition-all duration-150 ease-spring hover:bg-system-light active:scale-[0.98] disabled:opacity-40"
                >
                  {guardando ? "Guardando…" : "Sí, está bien interpretada — guardar"}
                </button>
              </div>
              <div className="mt-3">
                <label className="mb-1 block text-[11px] font-medium text-muted">
                  No es lo que quiero: explicá qué falta o qué entendió mal
                </label>
                <textarea
                  value={comentario}
                  onChange={(e) => setComentario(e.target.value)}
                  rows={2}
                  placeholder="Ej: también debe aplicar cuando el término aparece en plural, y solo en pasos de pesada."
                  className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-[12.5px] leading-relaxed text-ink placeholder:text-muted/60 transition-all duration-150 ease-spring focus:border-system focus:shadow-ring focus:outline-none"
                />
                <button
                  onClick={() => revisarConIA(comentario.trim())}
                  disabled={!comentario.trim() || analizando}
                  className="mt-2 min-h-[38px] w-full rounded-lg border border-line px-3 text-[12.5px] font-medium text-muted transition-all duration-150 ease-spring hover:border-system hover:text-system active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {analizando ? "Revisando…" : "Revisar de nuevo con esta aclaración"}
                </button>
              </div>
              {historial.length > 0 && (
                <p className="mt-2 text-[11px] text-muted">
                  Vuelta {historial.length + 1} de esta regla.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {error && (
        <p className="mb-4 animate-fade-in-up rounded-lg border border-severidad-critica/30 bg-severidad-criticaTint px-3 py-2 text-[12.5px] text-severidad-critica">
          {error}
        </p>
      )}

      {/* ---------- Listado ---------- */}
      {reglas.length > 0 && (
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar en las reglas…"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-muted/60 transition-all duration-150 ease-spring focus:border-system focus:shadow-ring focus:outline-none sm:max-w-xs"
          />
          <p className="shrink-0 text-[12px] text-muted">
            {activas.length} activa{activas.length !== 1 ? "s" : ""}
            {inactivas.length > 0 ? ` · ${inactivas.length} desactivada${inactivas.length !== 1 ? "s" : ""}` : ""}
          </p>
        </div>
      )}

      {cargando ? (
        <div className="flex justify-center py-8">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-system" />
        </div>
      ) : reglas.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-surface px-4 py-8 text-center">
          <p className="text-[13px] text-muted">Todavía no agregaste ninguna regla permanente.</p>
        </div>
      ) : totalFiltrado === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-surface px-4 py-8 text-center">
          <p className="text-[13px] text-muted">Ninguna regla coincide con “{busqueda}”.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {grupos.map(([clave, delGrupo]) => (
            <section key={clave}>
              <div className="mb-2 flex items-baseline gap-2">
                <h2 className="text-[12px] font-semibold text-ink">{etiquetaAlcance(clave)}</h2>
                <span className="text-[11px] text-muted">
                  {delGrupo.length} regla{delGrupo.length !== 1 ? "s" : ""}
                </span>
              </div>
              <ul className="space-y-2">
                {delGrupo.map((r, i) => (
                  <FilaRegla
                    key={r.id}
                    regla={r}
                    retraso={Math.min(i, 8) * 30}
                    onAlternar={() => alternarActiva(r)}
                    onEliminar={() => eliminarRegla(r.id)}
                  />
                ))}
              </ul>
            </section>
          ))}

          {inactivas.length > 0 && (
            <section>
              <button
                onClick={() => setMostrarInactivas((v) => !v)}
                className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-muted transition-colors hover:text-ink"
              >
                <span className={`transition-transform duration-200 ${mostrarInactivas ? "rotate-90" : ""}`}>
                  ›
                </span>
                Desactivadas ({inactivas.length}) — no se aplican en las revisiones
              </button>
              {mostrarInactivas && (
                <ul className="space-y-2">
                  {inactivas.map((r, i) => (
                    <FilaRegla
                      key={r.id}
                      regla={r}
                      retraso={Math.min(i, 8) * 30}
                      onAlternar={() => alternarActiva(r)}
                      onEliminar={() => eliminarRegla(r.id)}
                    />
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      )}
        </div>
      </div>
    </div>
  );
}

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{titulo}</p>
      {children}
    </div>
  );
}

function FilaRegla({
  regla,
  retraso,
  onAlternar,
  onEliminar,
}: {
  regla: ReglaHomologacion;
  retraso: number;
  onAlternar: () => void;
  onEliminar: () => void;
}) {
  return (
    <li
      style={{ animationDelay: `${retraso}ms` }}
      className={`toque animate-fade-in-up rounded-lg border bg-surface px-3.5 py-3 shadow-soft transition-all duration-200 ease-spring hover:shadow-elevated ${
        regla.activa ? "border-line" : "border-line/60 opacity-60"
      }`}
    >
      <p className="text-[13px] leading-snug text-ink/85">{regla.texto}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {!regla.activa && (
          <span className="rounded-full bg-paper px-2 py-0.5 text-[11px] font-medium text-muted">
            Desactivada
          </span>
        )}
        <div className="ml-auto flex shrink-0 gap-1.5">
          <button
            onClick={onAlternar}
            className="min-h-[32px] rounded border border-line px-2.5 text-[11px] font-medium text-muted transition-all duration-150 ease-spring hover:border-system hover:text-system active:scale-95"
          >
            {regla.activa ? "Desactivar" : "Activar"}
          </button>
          <button
            onClick={onEliminar}
            className="min-h-[32px] rounded border border-line px-2.5 text-[11px] font-medium text-muted transition-all duration-150 ease-spring hover:border-severidad-critica hover:text-severidad-critica active:scale-95"
          >
            Eliminar
          </button>
        </div>
      </div>
    </li>
  );
}
