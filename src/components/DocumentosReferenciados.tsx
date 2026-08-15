"use client";

import { useState } from "react";
import type { DocumentoReferenciado } from "@/types/rmd";

const ORDEN_TIPOS: DocumentoReferenciado["tipo"][] = ["Instructivo", "Procedimiento", "Formato"];

export function DocumentosReferenciados({ documentos }: { documentos: DocumentoReferenciado[] }) {
  const [abierto, setAbierto] = useState(false);
  if (documentos.length === 0) return null;

  return (
    <div className="mb-5 rounded-lg border border-line bg-surface transition-shadow duration-200 hover:shadow-soft">
      <button
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2.5 text-left"
      >
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          Documentos referenciados ({documentos.length})
        </h3>
        <span className="flex items-center gap-1 text-[10px] text-muted">
          {abierto ? "ocultar" : "ver todos"}
          <IconoChevron abierto={abierto} />
        </span>
      </button>
      <div
        className={`grid transition-all duration-300 ease-spring ${
          abierto ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div className="space-y-3 border-t border-line px-3 py-2.5">
            {ORDEN_TIPOS.map((tipo) => {
              const items = documentos.filter((d) => d.tipo === tipo);
              if (items.length === 0) return null;
              return (
                <div key={tipo}>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-system">
                    {tipo}s ({items.length})
                  </p>
                  <ul className="flex flex-wrap gap-1.5">
                    {items.map((d) => (
                      <li
                        key={d.codigo}
                        className="rounded-full border border-line bg-paper px-2.5 py-1 font-mono text-[11px] text-ink/80 transition-colors duration-150 hover:border-system/50"
                      >
                        {d.codigo}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
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
