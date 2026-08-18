"use client";

import { useEffect } from "react";
import { VisorPdf, type SaltoPdf } from "./VisorPdf";

interface Props {
  pdfUrl: string;
  salto: SaltoPdf;
  onClose: () => void;
  onBlobInvalido?: () => void;
}

/** Modal que muestra el PDF del borrador de Producción, saltando directo al
 * punto donde se originó una diferencia — sin reemplazar el visor principal
 * (que sigue mostrando el RMD vigente). */
export function ModalVisorBorrador({ pdfUrl, salto, onClose, onBlobInvalido }: Props) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-ink/40 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      {/* A pantalla completa en móvil: recortarlo con márgenes dejaría el PDF
          en un ancho donde no se puede leer nada. */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="pb-seguro flex h-full w-full animate-scale-in flex-col overflow-hidden border-line bg-surface shadow-elevated sm:h-[88vh] sm:max-w-4xl sm:rounded-xl sm:border"
      >
        <div className="inset-seguro-x flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
              Vista del borrador de Producción
            </p>
            <p className="truncate text-[13px] font-semibold text-ink">
              {salto.pasoId ? `Paso ${salto.pasoId}` : `Página ${salto.pagina}`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="min-h-[40px] shrink-0 rounded px-3 text-[12px] font-medium text-muted transition-all duration-150 ease-spring hover:bg-paper hover:text-ink active:scale-95"
          >
            ✕ Cerrar
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <VisorPdf pdfUrl={pdfUrl} salto={salto} onBlobInvalido={onBlobInvalido} />
        </div>
      </div>
    </div>
  );
}
