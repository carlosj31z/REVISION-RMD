"use client";

import { useEffect } from "react";
import { VisorPdf, type SaltoPdf } from "./VisorPdf";

interface Props {
  pdfUrl: string;
  salto: SaltoPdf;
  onClose: () => void;
}

/** Modal que muestra el PDF del borrador de Producción, saltando directo al
 * punto donde se originó una diferencia — sin reemplazar el visor principal
 * (que sigue mostrando el RMD vigente). */
export function ModalVisorBorrador({ pdfUrl, salto, onClose }: Props) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-ink/40 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[88vh] w-full max-w-4xl animate-scale-in flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-elevated"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
              Vista del borrador de Producción
            </p>
            <p className="text-[13px] font-semibold text-ink">
              {salto.pasoId ? `Paso ${salto.pasoId}` : `Página ${salto.pagina}`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded px-2 py-1 text-[12px] font-medium text-muted transition-all duration-150 ease-spring hover:bg-paper hover:text-ink active:scale-95"
          >
            ✕ Cerrar
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <VisorPdf pdfUrl={pdfUrl} salto={salto} />
        </div>
      </div>
    </div>
  );
}
