import type { AlertaCoherencia } from "@/types/rmd";

const SEVERIDAD_ESTILOS: Record<AlertaCoherencia["severidad"], string> = {
  critica: "bg-severidad-criticaTint text-severidad-critica border-severidad-critica/30",
  alta: "bg-severidad-altaTint text-severidad-alta border-severidad-alta/30",
  media: "bg-severidad-mediaTint text-severidad-media border-severidad-media/30",
  baja: "bg-severidad-bajaTint text-severidad-baja border-severidad-baja/30",
};

const SEVERIDAD_LABEL: Record<AlertaCoherencia["severidad"], string> = {
  critica: "Crítica",
  alta: "Alta",
  media: "Media",
  baja: "Baja",
};

export function BadgeSeveridad({ severidad }: { severidad: AlertaCoherencia["severidad"] }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide transition-colors duration-200 ${SEVERIDAD_ESTILOS[severidad]}`}
    >
      {SEVERIDAD_LABEL[severidad]}
    </span>
  );
}

type EstadoSeguimiento = "pendiente" | "corregido_en_sap" | "descartado";

const ESTADO_ESTILOS: Record<EstadoSeguimiento, string> = {
  pendiente: "bg-severidad-criticaTint text-severidad-critica border-severidad-critica/30",
  corregido_en_sap: "bg-system-tint text-system border-system/30",
  descartado: "bg-line/40 text-estado-descartado border-line",
};

const ESTADO_LABEL: Record<EstadoSeguimiento, string> = {
  pendiente: "Pendiente",
  corregido_en_sap: "Corregido en SAP",
  descartado: "Descartado",
};

// Borde izquierdo de la tarjeta completa, para distinguir de un vistazo lo
// pendiente (rojo) de lo ya corregido (verde) sin tener que leer el badge.
// "descartado" queda neutro: ya no está pendiente, pero tampoco es una corrección.
export const BORDE_ESTADO: Record<EstadoSeguimiento, string> = {
  pendiente: "border-l-4 border-l-severidad-critica",
  corregido_en_sap: "border-l-4 border-l-system",
  descartado: "border-l-4 border-l-line",
};

export function BadgeEstado({ estado }: { estado: EstadoSeguimiento }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors duration-200 ${ESTADO_ESTILOS[estado]}`}
    >
      {estado === "corregido_en_sap" && (
        <svg
          viewBox="0 0 16 16"
          width="11"
          height="11"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
        </svg>
      )}
      {ESTADO_LABEL[estado]}
    </span>
  );
}

const CONFIANZA_LABEL: Record<"alta" | "media" | "baja", string> = {
  alta: "Confianza alta",
  media: "Confianza media",
  baja: "Confianza baja",
};

export function BadgeConfianza({ nivel }: { nivel: "alta" | "media" | "baja" }) {
  const opacidad = nivel === "alta" ? "opacity-100" : nivel === "media" ? "opacity-70" : "opacity-45";
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] text-muted ${opacidad}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {CONFIANZA_LABEL[nivel]}
    </span>
  );
}

/**
 * Resultado de la verificación automática al subir el RMD corregido — NO es
 * lo mismo que BadgeEstado (que es la marca manual del analista): esto es
 * el veredicto de la IA al comparar contra el documento corregido. Check
 * verde si ya está resuelto, triángulo naranja si sigue pendiente.
 */
export function BadgeVerificacion({
  resuelto,
  justificacion,
}: {
  resuelto: boolean;
  justificacion?: string;
}) {
  if (resuelto) {
    return (
      <span
        title={justificacion}
        className="inline-flex items-center gap-1 rounded-full border border-system/30 bg-system-tint px-2 py-0.5 text-[11px] font-medium text-system"
      >
        <svg
          viewBox="0 0 16 16"
          width="11"
          height="11"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
        </svg>
        Corregido — verificado
      </span>
    );
  }
  return (
    <span
      title={justificacion}
      className="inline-flex items-center gap-1 rounded-full border border-severidad-alta/30 bg-severidad-altaTint px-2 py-0.5 text-[11px] font-medium text-severidad-alta"
    >
      <svg
        viewBox="0 0 16 16"
        width="11"
        height="11"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M8 1.5 1 13.5h14L8 1.5Z" />
        <path d="M8 6.5v3.5" />
        <path d="M8 12h.01" />
      </svg>
      Sin corregir aún
    </span>
  );
}
