"use client";

import { useState } from "react";
import type { ResultadoComparacionReferencia, SugerenciaHomologacionReferencia, DestinoPdf } from "@/types/rmd";
import { BadgeConfianza } from "./Badges";
import { ResumenEjecutivo } from "./ResumenEjecutivo";

interface Props {
  resultado: ResultadoComparacionReferencia;
  pasoResaltado: string | null;
  onHoverPaso: (pasoId: string | null) => void;
  onIrAPaso: (destino: DestinoPdf) => void;
  // Abre el modal "ver en la referencia" saltando al punto exacto de esa
  // sugerencia dentro del PDF de referencia (no del evaluado).
  onVerEnReferencia: (destino: DestinoPdf) => void;
}

const TIPO_LABEL: Record<SugerenciaHomologacionReferencia["tipo"], string> = {
  redaccion_puede_homologarse: "Redacción homologable",
  paso_faltante_en_rmd: "Falta en el RMD evaluado",
  paso_sobrante_en_rmd: "Sin equivalente en la referencia",
  orden_distinto: "Orden distinto",
};

const ACCION_LABEL: Record<SugerenciaHomologacionReferencia["accionSugerida"], string> = {
  incluir: "Incluir",
  modificar: "Modificar",
  eliminar: "Eliminar",
  reordenar: "Reordenar",
};

const ACCION_COLOR: Record<SugerenciaHomologacionReferencia["accionSugerida"], string> = {
  incluir: "border-system/40 bg-system-tint text-system",
  modificar: "border-severidad-media/40 bg-severidad-mediaTint text-severidad-media",
  eliminar: "border-severidad-critica/40 bg-severidad-criticaTint text-severidad-critica",
  reordenar: "border-severidad-alta/40 bg-severidad-altaTint text-severidad-alta",
};

// Misma idea que claveDiferencia en PanelDiferenciasBorrador: desambigua
// sugerencias sin pasoIdRmd (ej. paso faltante) con el índice del array.
function claveSugerencia(s: SugerenciaHomologacionReferencia, indice: number): string {
  return s.pasoIdRmd ?? `sin-paso-${indice}`;
}

export function PanelHomologacionReferencia({
  resultado,
  pasoResaltado,
  onHoverPaso,
  onIrAPaso,
  onVerEnReferencia,
}: Props) {
  const sugerencias = resultado.sugerenciasHomologacion;

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="material-chrome-white z-10 border-b border-line/70 px-4 py-3.5 shadow-soft sm:px-5 sm:py-4">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
          Homologación contra el RMD de referencia
        </p>
        <div className="mt-1.5 flex items-center gap-3">
          <ScoreHomologacion score={resultado.gradoHomologacion} />
          <span className="text-[12px] text-muted">
            {sugerencias.length} sugerenci{sugerencias.length !== 1 ? "as" : "a"} de homologación
          </span>
        </div>
        {resultado.requiereRevisionHumana && (
          <p className="mt-2 rounded-lg border border-severidad-alta/30 bg-severidad-altaTint px-2.5 py-1.5 text-[12px] text-severidad-alta">
            Este resultado requiere tu revisión directa: el modelo señaló ambigüedad.
          </p>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-24 sm:px-5 lg:pb-4">
        <ResumenEjecutivo texto={resultado.resumenEjecutivo} />

        {sugerencias.length === 0 ? (
          <div className="animate-scale-in rounded-lg border border-dashed border-line bg-surface px-4 py-10 text-center">
            <span className="mx-auto mb-2.5 flex h-9 w-9 items-center justify-center rounded-full bg-system-tint text-system">
              <IconoCheck />
            </span>
            <p className="text-[13px] text-muted">
              No se encontraron pasos con equivalencia clara que valga la pena homologar contra
              la referencia.
            </p>
          </div>
        ) : (
          <ol className="space-y-2.5">
            {sugerencias.map((s, i) => {
              const clave = claveSugerencia(s, i);
              return (
                <TarjetaSugerencia
                  key={`${clave}-${i}`}
                  sugerencia={s}
                  activo={pasoResaltado !== null && pasoResaltado === clave}
                  onHover={() => onHoverPaso(clave)}
                  onLeave={() => onHoverPaso(null)}
                  onIrAPaso={() =>
                    onIrAPaso({
                      pasoId: s.pasoIdRmd,
                      seccionGeneral: s.seccionGeneral,
                      textoBuscado: s.textoEnRmd,
                    })
                  }
                  onVerEnReferencia={
                    s.pasoIdReferencia
                      ? () =>
                          onVerEnReferencia({
                            pasoId: s.pasoIdReferencia,
                            seccionGeneral: null,
                            textoBuscado: s.textoEnReferencia,
                          })
                      : null
                  }
                  retraso={Math.min(i, 8) * 25}
                />
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

function ScoreHomologacion({ score }: { score: number }) {
  const redondeado = Math.round(score);
  const color =
    redondeado >= 80 ? "text-system" : redondeado >= 50 ? "text-severidad-alta" : "text-severidad-critica";
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={`font-mono text-2xl font-semibold tabular-nums ${color}`}>{redondeado}</span>
      <span className="text-[11px] text-muted">% de homologación</span>
    </div>
  );
}

function TarjetaSugerencia({
  sugerencia,
  activo,
  onHover,
  onLeave,
  onIrAPaso,
  onVerEnReferencia,
  retraso,
}: {
  sugerencia: SugerenciaHomologacionReferencia;
  activo: boolean;
  onHover: () => void;
  onLeave: () => void;
  onIrAPaso: () => void;
  onVerEnReferencia: (() => void) | null;
  retraso: number;
}) {
  const [expandido, setExpandido] = useState(false);
  const esNavegable = !!(sugerencia.pasoIdRmd || sugerencia.seccionGeneral);

  return (
    <li
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      onClick={esNavegable ? onIrAPaso : undefined}
      title={esNavegable ? "Ver en el PDF" : undefined}
      style={{ animationDelay: `${retraso}ms` }}
      className={`group animate-fade-in-up rounded-lg border bg-surface px-3.5 py-3 shadow-soft transition-all duration-200 ease-spring hover:shadow-elevated ${
        esNavegable ? "cursor-pointer" : ""
      } ${activo ? "border-system shadow-elevated" : "border-line"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded font-mono text-[12px] font-semibold text-system transition-colors group-hover:underline">
            {sugerencia.pasoIdRmd ?? "—"}
            {sugerencia.pasoIdReferencia ? ` ↔ ref. ${sugerencia.pasoIdReferencia}` : ""}
          </span>
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
            {TIPO_LABEL[sugerencia.tipo]}
          </span>
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${ACCION_COLOR[sugerencia.accionSugerida]}`}
          >
            {ACCION_LABEL[sugerencia.accionSugerida]}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {onVerEnReferencia && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onVerEnReferencia();
              }}
              title="Ver en la referencia"
              className="rounded p-1 text-muted transition-all duration-150 ease-spring hover:bg-system-tint hover:text-system active:scale-95"
            >
              <IconoOjo />
            </button>
          )}
          <BadgeConfianza nivel={sugerencia.nivelConfianza} />
        </div>
      </div>

      <p className="mt-1.5 text-[13px] leading-snug text-ink/80">{sugerencia.justificacion}</p>

      {(sugerencia.textoEnRmd || sugerencia.textoEnReferencia) && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpandido((v) => !v);
            }}
            className="mt-2 flex items-center gap-1 text-[12px] font-medium text-system hover:underline"
          >
            <IconoChevron abierto={expandido} />
            {expandido ? "Ocultar detalle" : "Ver detalle y cita de ambos documentos"}
          </button>

          <div
            className={`grid transition-all duration-300 ease-spring ${
              expandido ? "mt-2 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
            }`}
          >
            <div className="overflow-hidden">
              <div className="space-y-2 border-t border-line pt-2.5">
                {sugerencia.textoEnRmd && (
                  <DetalleCampo label="Texto en el RMD evaluado" valor={sugerencia.textoEnRmd} />
                )}
                {sugerencia.textoEnReferencia && (
                  <DetalleCampo label="Texto en la referencia" valor={sugerencia.textoEnReferencia} />
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </li>
  );
}

function DetalleCampo({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-0.5 text-[12.5px] leading-snug text-ink/80">{valor}</p>
    </div>
  );
}

function IconoOjo() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconoChevron({ abierto }: { abierto: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 transition-transform duration-200 ease-spring ${abierto ? "rotate-90" : ""}`}
      aria-hidden="true"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function IconoCheck() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
