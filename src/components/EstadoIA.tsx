"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { leerRespuestaApi } from "@/lib/leerRespuestaApi";

// Confirmado empíricamente en esta misma sesión de trabajo (el 429 real de
// Gemini cita "GenerateRequestsPerDayPerProjectPerModel-FreeTier", "quotaValue":"20"):
// el nivel gratuito de Gemini permite 20 llamadas/día por clave y modelo. Si
// el proyecto pasa a un plan pago, este número deja de aplicar — por eso se
// etiqueta como "nivel gratuito" en vez de presentarlo como un límite fijo.
const LIMITE_DIARIO_GEMINI_GRATIS = 20;

interface ProveedorEstado {
  etiqueta: string;
  llamadas: number;
  exitosas: number;
  fallidas: number;
}

interface RespuestaEstadoIA {
  disponible: boolean;
  motivo?: string;
  desde?: string;
  actualizado?: string;
  proveedores: ProveedorEstado[];
}

function nombreLegible(etiqueta: string): string {
  if (etiqueta === "GEMINI_API_KEY") return "Gemini — clave principal";
  if (etiqueta === "GROQ_API_KEY") return "Groq — última instancia";
  const m = etiqueta.match(/^GEMINI_API_KEY_BACKUP_?(\d*)$/);
  if (m) return `Gemini — respaldo${m[1] ? ` ${m[1]}` : ""}`;
  return etiqueta;
}

function esGemini(etiqueta: string): boolean {
  return etiqueta.startsWith("GEMINI_API_KEY");
}

export function EstadoIA() {
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [estado, setEstado] = useState<RespuestaEstadoIA | null>(null);
  // Posición calculada del popover, no CSS "absolute" relativo al botón: los
  // dos lugares donde vive este botón (headers de la app) están dentro de
  // una fila con overflow-x-auto en móvil (para que las pestañas/acciones
  // quepan deslizando) — un popover "absolute" ahí adentro se recortaría o
  // scrollearía junto con la fila. "fixed" anclado a coordenadas reales del
  // botón escapa de ese recorte sin depender de dónde se use el componente.
  const [posicion, setPosicion] = useState<{ top: number; right: number } | null>(null);
  const botonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await fetch("/api/estado-ia");
      const data = await leerRespuestaApi(res);
      setEstado(data);
    } catch (err: any) {
      setError(err.message ?? "No se pudo cargar el estado de la IA.");
    } finally {
      setCargando(false);
    }
  }, []);

  const alternar = useCallback(() => {
    setAbierto((v) => {
      const nuevoValor = !v;
      if (nuevoValor) {
        const r = botonRef.current?.getBoundingClientRect();
        if (r) setPosicion({ top: r.bottom + 6, right: window.innerWidth - r.right });
        cargar();
      }
      return nuevoValor;
    });
  }, [cargar]);

  // Cerrar al hacer clic afuera — mismo comportamiento esperable de
  // cualquier menú desplegable. Se compara contra el botón Y el panel por
  // separado porque ahora son hermanos, no un contenedor único con ambos.
  useEffect(() => {
    if (!abierto) return;
    const onClickFuera = (e: MouseEvent) => {
      const objetivo = e.target as Node;
      if (botonRef.current?.contains(objetivo)) return;
      if (panelRef.current?.contains(objetivo)) return;
      setAbierto(false);
    };
    document.addEventListener("mousedown", onClickFuera);
    return () => document.removeEventListener("mousedown", onClickFuera);
  }, [abierto]);

  return (
    <>
      <button
        ref={botonRef}
        onClick={alternar}
        title="Cuánto se usó hoy de cada proveedor de IA"
        className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-muted transition-all duration-150 ease-spring hover:bg-surface hover:text-system hover:shadow-soft active:scale-95"
      >
        📊 Estado IA
      </button>

      {abierto && posicion && (
        <div
          ref={panelRef}
          style={{ position: "fixed", top: posicion.top, right: Math.max(8, posicion.right) }}
          className="z-50 w-72 max-w-[calc(100vw-16px)] animate-scale-in rounded-xl border border-line bg-surface p-3 shadow-elevated">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              Uso de hoy
            </p>
            <button
              onClick={cargar}
              disabled={cargando}
              className="rounded px-1.5 py-0.5 text-[11px] font-medium text-system transition-colors hover:bg-system-tint disabled:opacity-40"
            >
              {cargando ? "…" : "↻ Actualizar"}
            </button>
          </div>

          {error && (
            <p className="rounded-lg border border-severidad-critica/30 bg-severidad-criticaTint px-2.5 py-2 text-[11.5px] text-severidad-critica">
              {error}
            </p>
          )}

          {!error && cargando && !estado && (
            <p className="px-1 py-2 text-[12px] text-muted">Cargando…</p>
          )}

          {!error && estado && !estado.disponible && (
            <p className="rounded-lg border border-line bg-paper px-2.5 py-2 text-[11.5px] leading-relaxed text-muted">
              {estado.motivo ?? "No disponible."}
              {estado.motivo?.includes("uso_ia") || estado.motivo?.includes("leer el uso") ? (
                <>
                  {" "}
                  Corré la migración{" "}
                  <code className="rounded bg-severidad-critica/10 px-1 font-mono text-[10.5px]">
                    supabase/migrations/0006_uso_ia.sql
                  </code>
                  .
                </>
              ) : null}
            </p>
          )}

          {!error && estado?.disponible && (
            <>
              <ul className="space-y-2.5">
                {estado.proveedores.map((p) => {
                  const limite = esGemini(p.etiqueta) ? LIMITE_DIARIO_GEMINI_GRATIS : null;
                  const pct = limite ? Math.min(100, (p.llamadas / limite) * 100) : 0;
                  const color =
                    limite && p.llamadas >= limite
                      ? "bg-severidad-critica"
                      : limite && pct >= 70
                        ? "bg-severidad-alta"
                        : "bg-system";
                  return (
                    <li key={p.etiqueta}>
                      <div className="mb-1 flex items-baseline justify-between gap-2">
                        <span className="truncate text-[12px] font-medium text-ink">
                          {nombreLegible(p.etiqueta)}
                        </span>
                        <span className="shrink-0 font-mono text-[11.5px] text-muted">
                          {p.llamadas}
                          {limite ? `/${limite}` : ""}
                        </span>
                      </div>
                      {limite ? (
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-paper">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${color}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      ) : (
                        <p className="text-[10.5px] text-muted">sin límite diario conocido</p>
                      )}
                      {p.fallidas > 0 && (
                        <p className="mt-0.5 text-[10.5px] text-severidad-alta">
                          {p.fallidas} de esas llamadas fallaron
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-[10.5px] leading-snug text-muted/80">
                Conteo propio desde medianoche UTC — Google no expone la cuota real de una
                clave, así que esto es una estimación, no un dato oficial. La cuota gratuita de
                Gemini se reinicia a medianoche hora del Pacífico (EE. UU.).
              </p>
            </>
          )}
        </div>
      )}
    </>
  );
}
