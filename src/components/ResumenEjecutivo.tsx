"use client";

import { useState } from "react";

/**
 * Resumen ejecutivo generado por Gemini. Colapsado por defecto: suele
 * repetir información que ya está detallada en las tarjetas de abajo, así
 * que no debe ser lo primero que ocupe espacio en el panel — el analista lo
 * abre solo si lo necesita.
 */
export function ResumenEjecutivo({ texto }: { texto: string }) {
  const [abierto, setAbierto] = useState(false);
  if (!texto) return null;

  return (
    <div className="mb-4 animate-fade-in-up rounded-lg border border-line bg-white transition-shadow duration-200 hover:shadow-soft">
      <button
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2.5 text-left"
      >
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          Resumen ejecutivo
        </h3>
        <span className="flex items-center gap-1 text-[10px] text-muted">
          {abierto ? "ocultar" : "ver"}
          <IconoChevron abierto={abierto} />
        </span>
      </button>
      <div
        className={`grid transition-all duration-300 ease-spring ${
          abierto ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <p className="border-t border-line px-3 py-2.5 text-[13px] leading-relaxed text-ink/80">
            {texto}
          </p>
        </div>
      </div>
    </div>
  );
}

function IconoChevron({ abierto }: { abierto: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="10"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 transition-transform duration-200 ease-spring ${abierto ? "rotate-180" : ""}`}
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
