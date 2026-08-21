"use client";

import { GeneradorNomenclatura } from "@/components/GeneradorNomenclatura";
import { GeneradorNomenclaturaCarpetaAmarilla } from "@/components/GeneradorNomenclaturaCarpetaAmarilla";

interface Props {
  onVolver: () => void;
}

export function PanelNomenclaturas({ onVolver }: Props) {
  return (
    <div className="h-pantalla flex animate-fade-in flex-col bg-paper">
      <div className="material-chrome-white inset-seguro-x sticky top-0 z-10 flex shrink-0 items-center justify-between gap-3 border-b border-line/70 px-4 py-3 shadow-soft sm:px-6">
        <button
          onClick={onVolver}
          className="-ml-1.5 flex min-h-[38px] shrink-0 items-center gap-1 rounded-lg px-2.5 text-[13px] font-medium text-system transition-all duration-150 ease-spring hover:bg-system-tint active:scale-95"
        >
          ← Volver
        </button>
        <h1 className="min-w-0 truncate text-[13px] font-semibold text-ink sm:text-[14px]">
          Nomenclaturas
        </h1>
      </div>

      <div className="inset-seguro-x min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl animate-fade-in-up px-0 py-6 sm:py-8">
          <p className="mx-auto mb-6 max-w-2xl px-4 text-[13px] leading-relaxed text-muted sm:px-6">
            Generadores de identificadores estándar — no requieren un RMD.
          </p>
          <GeneradorNomenclatura />
          <GeneradorNomenclaturaCarpetaAmarilla />
        </div>
      </div>
    </div>
  );
}
