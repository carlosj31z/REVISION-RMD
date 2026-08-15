"use client";

import { useState, useCallback, useEffect, useRef, forwardRef } from "react";
import { FormularioCarga } from "@/components/FormularioCarga";
import { FormularioComparacionBorrador } from "@/components/FormularioComparacionBorrador";
import { PanelRMDVigente } from "@/components/PanelRMDVigente";
import { PanelDiscrepancias } from "@/components/PanelDiscrepancias";
import { PanelDiferenciasBorrador } from "@/components/PanelDiferenciasBorrador";
import { PanelReglas } from "@/components/PanelReglas";
import { PanelDocumentosObsoletos } from "@/components/PanelDocumentosObsoletos";
import type { SaltoPdf } from "@/components/VisorPdf";
import type {
  RMDExtraido,
  ResultadoRevisionIA,
  ResultadoComparacionBorrador,
  DestinoPdf,
} from "@/types/rmd";

type EstadoSeguimiento = "pendiente" | "corregido_en_sap" | "descartado";
type ModoEntrada = "control_cambios" | "borrador";

type VistaActual =
  | { tipo: "carga" }
  | { tipo: "reglas" }
  | { tipo: "documentosObsoletos" }
  | { tipo: "cargando"; mensaje: string }
  | { tipo: "error"; mensaje: string }
  | {
      tipo: "resultado";
      rmd: RMDExtraido;
      pdfUrl: string;
      resultado: ResultadoRevisionIA;
      revisionId: string | null;
    }
  | {
      tipo: "resultado-borrador";
      rmd: RMDExtraido;
      pdfUrl: string;
      resultado: ResultadoComparacionBorrador;
      revisionId: string | null;
    };

type VistaResultado = Extract<VistaActual, { tipo: "resultado" | "resultado-borrador" }>;

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000; // procesar en bloques para no exceder el límite de argumentos de fromCharCode
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export default function Home() {
  const [modo, setModo] = useState<ModoEntrada>("borrador");
  const [vista, setVista] = useState<VistaActual>({ tipo: "carga" });
  const tabRefs = useRef<Partial<Record<ModoEntrada, HTMLButtonElement | null>>>({});
  const [indicador, setIndicador] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const el = tabRefs.current[modo];
    if (el) setIndicador({ left: el.offsetLeft, width: el.offsetWidth });
  }, [modo]);

  const [pasoResaltado, setPasoResaltado] = useState<string | null>(null);
  const [saltoPdf, setSaltoPdf] = useState<SaltoPdf | null>(null);
  const [estadosSeguimiento, setEstadosSeguimiento] = useState<Record<string, EstadoSeguimiento>>(
    {}
  );
  // Revisión "en pausa": el usuario la minimizó para ir a revisar otro
  // apartado (reglas, documentos obsoletos, cargar otro documento) sin
  // perder el análisis actual. saltoPdf/pasoResaltado/estadosSeguimiento no
  // se tocan al minimizar, así que al restaurar todo queda exactamente
  // donde se dejó.
  const [revisionMinimizada, setRevisionMinimizada] = useState<VistaResultado | null>(null);

  const iniciarRevision = useCallback(
    async (input: {
      rmdFile: File;
      seccion: string;
      etapa: string;
      controlCambioTexto?: string;
      controlCambioFile?: File;
    }) => {
      setEstadosSeguimiento({});
      try {
        setVista({ tipo: "cargando", mensaje: "Extrayendo el RMD vigente…" });

        const formData = new FormData();
        formData.append("file", input.rmdFile);
        const extractRes = await fetch("/api/extract-pdf", { method: "POST", body: formData });
        if (!extractRes.ok) {
          const err = await extractRes.json();
          throw new Error(err.error ?? "No se pudo extraer el PDF del RMD vigente.");
        }
        const { estructura, pdfBase64 } = await extractRes.json();

        setVista({ tipo: "cargando", mensaje: "Comparando contra el Control de Cambio…" });

        let pdfControlCambioBase64: string | undefined;
        if (input.controlCambioFile) {
          pdfControlCambioBase64 = await fileToBase64(input.controlCambioFile);
        }

        const revisionRes = await fetch("/api/revision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rmdVigente: estructura,
            pdfVigenteBase64: pdfBase64,
            controlDeCambioTexto: input.controlCambioTexto,
            pdfControlCambioBase64,
            seccionCodigo: input.seccion,
            etapaCodigo: input.etapa,
          }),
        });

        if (!revisionRes.ok) {
          const err = await revisionRes.json();
          throw new Error(err.error ?? "No se pudo completar la comparación.");
        }

        const data = await revisionRes.json();

        setSaltoPdf(null);
        setVista({
          tipo: "resultado",
          rmd: estructura,
          pdfUrl: URL.createObjectURL(input.rmdFile),
          resultado: data.resultado,
          revisionId: data.revisionId ?? null,
        });
      } catch (err: any) {
        setVista({ tipo: "error", mensaje: err.message ?? "Ocurrió un error inesperado." });
      }
    },
    []
  );

  const iniciarComparacionBorrador = useCallback(
    async (input: {
      rmdVigenteFile: File;
      rmdBorradorFile: File;
      seccion: string;
      etapa: string;
    }) => {
      setEstadosSeguimiento({});
      try {
        setVista({ tipo: "cargando", mensaje: "Extrayendo el RMD vigente…" });

        const formDataVigente = new FormData();
        formDataVigente.append("file", input.rmdVigenteFile);
        const extractVigenteRes = await fetch("/api/extract-pdf", {
          method: "POST",
          body: formDataVigente,
        });
        if (!extractVigenteRes.ok) {
          const err = await extractVigenteRes.json();
          throw new Error(err.error ?? "No se pudo extraer el PDF del RMD vigente.");
        }
        const { estructura: estructuraVigente, pdfBase64: pdfVigenteBase64 } =
          await extractVigenteRes.json();

        setVista({ tipo: "cargando", mensaje: "Extrayendo el borrador de Producción…" });

        const formDataBorrador = new FormData();
        formDataBorrador.append("file", input.rmdBorradorFile);
        const extractBorradorRes = await fetch("/api/extract-pdf", {
          method: "POST",
          body: formDataBorrador,
        });
        if (!extractBorradorRes.ok) {
          const err = await extractBorradorRes.json();
          throw new Error(err.error ?? "No se pudo extraer el PDF del borrador.");
        }
        const { estructura: estructuraBorrador, pdfBase64: pdfBorradorBase64 } =
          await extractBorradorRes.json();

        setVista({ tipo: "cargando", mensaje: "Comparando ambos documentos…" });

        const revisionRes = await fetch("/api/revision-borrador", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rmdVigente: estructuraVigente,
            pdfVigenteBase64,
            rmdBorrador: estructuraBorrador,
            pdfBorradorBase64,
            seccionCodigo: input.seccion,
            etapaCodigo: input.etapa,
          }),
        });

        if (!revisionRes.ok) {
          const err = await revisionRes.json();
          throw new Error(err.error ?? "No se pudo completar la comparación.");
        }

        const data = await revisionRes.json();

        setSaltoPdf(null);
        setVista({
          tipo: "resultado-borrador",
          rmd: estructuraVigente,
          pdfUrl: URL.createObjectURL(input.rmdVigenteFile),
          resultado: data.resultado,
          revisionId: data.revisionId ?? null,
        });
      } catch (err: any) {
        setVista({ tipo: "error", mensaje: err.message ?? "Ocurrió un error inesperado." });
      }
    },
    []
  );

  const cambiarEstadoSeguimiento = useCallback(
    async (pasoId: string, estado: EstadoSeguimiento) => {
      setEstadosSeguimiento((prev) => ({ ...prev, [pasoId]: estado }));

      const revisionId =
        (vista.tipo === "resultado" || vista.tipo === "resultado-borrador") && vista.revisionId;
      if (revisionId) {
        try {
          await fetch(`/api/revision/${revisionId}/decisiones`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pasoId, estado }),
          });
        } catch {
          // Si falla la persistencia, el estado local ya cambió; el analista
          // sigue viendo el badge correcto en pantalla aunque no se haya guardado.
        }
      }
    },
    [vista]
  );

  const irAPasoEnPdf = useCallback(
    (destino: DestinoPdf) => {
      if (vista.tipo !== "resultado" && vista.tipo !== "resultado-borrador") return;

      // Preferimos un paso numérico del procedimiento (resalta la línea
      // exacta); si no hay o no se encontró, probamos con la sección
      // general (Precauciones/Notas Importantes/Equipos), que solo hace
      // scroll + remarca la página completa, sin línea puntual.
      if (destino.pasoId && destino.pasoId !== "N/A") {
        const paso = vista.rmd.procedimiento.find((p) => p.id === destino.pasoId);
        if (paso?.pagina) {
          const pasoId = destino.pasoId;
          setSaltoPdf((prev) => ({ pagina: paso.pagina!, pasoId, token: (prev?.token ?? 0) + 1 }));
          return;
        }
      }

      if (destino.seccionGeneral) {
        const pagina = vista.rmd.paginasSeccionesGenerales[destino.seccionGeneral];
        if (pagina) {
          setSaltoPdf((prev) => ({ pagina, token: (prev?.token ?? 0) + 1 }));
        }
      }
    },
    [vista]
  );

  const volverACarga = useCallback(() => {
    setVista((prev) => {
      if (prev.tipo === "resultado" || prev.tipo === "resultado-borrador") {
        URL.revokeObjectURL(prev.pdfUrl);
      }
      return { tipo: "carga" };
    });
    setSaltoPdf(null);
  }, []);

  const minimizarRevision = useCallback(() => {
    setVista((prev) => {
      if (prev.tipo !== "resultado" && prev.tipo !== "resultado-borrador") return prev;
      setRevisionMinimizada(prev);
      return { tipo: "carga" };
    });
  }, []);

  const restaurarRevision = useCallback(() => {
    setRevisionMinimizada((prev) => {
      if (prev) setVista(prev);
      return null;
    });
  }, []);

  const descartarRevisionMinimizada = useCallback(() => {
    setRevisionMinimizada((prev) => {
      if (prev) URL.revokeObjectURL(prev.pdfUrl);
      return null;
    });
  }, []);

  let contenido: React.ReactNode;

  if (vista.tipo === "carga") {
    contenido = (
      <div className="flex h-screen flex-col">
        <div className="material-chrome-white sticky top-0 z-10 flex items-center justify-between border-b border-line/70 px-5 pt-4 shadow-soft">
          <div className="relative flex gap-1">
            <TabModo
              ref={(el) => {
                tabRefs.current.borrador = el;
              }}
              activo={modo === "borrador"}
              onClick={() => setModo("borrador")}
              label="Borrador de Producción"
            />
            <TabModo
              ref={(el) => {
                tabRefs.current.control_cambios = el;
              }}
              activo={modo === "control_cambios"}
              onClick={() => setModo("control_cambios")}
              label="Control de Cambio"
            />
            {indicador && (
              <div
                className="pointer-events-none absolute bottom-0 h-[2px] rounded-full bg-system transition-all duration-300 ease-spring"
                style={{ left: indicador.left, width: indicador.width }}
              />
            )}
          </div>
          <div className="mb-2 flex items-center gap-1">
            <BotonConfig onClick={() => setVista({ tipo: "reglas" })} label="Reglas permanentes" />
            <BotonConfig
              onClick={() => setVista({ tipo: "documentosObsoletos" })}
              label="Documentos obsoletos"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {modo === "control_cambios" ? (
            <FormularioCarga onIniciarRevision={iniciarRevision} cargando={false} />
          ) : (
            <FormularioComparacionBorrador
              onIniciarComparacion={iniciarComparacionBorrador}
              cargando={false}
            />
          )}
        </div>
      </div>
    );
  } else if (vista.tipo === "reglas") {
    contenido = (
      <div className="h-screen animate-fade-in-up overflow-y-auto bg-paper">
        <PanelReglas onVolver={() => setVista({ tipo: "carga" })} />
      </div>
    );
  } else if (vista.tipo === "documentosObsoletos") {
    contenido = (
      <div className="h-screen animate-fade-in-up overflow-y-auto bg-paper">
        <PanelDocumentosObsoletos onVolver={() => setVista({ tipo: "carga" })} />
      </div>
    );
  } else if (vista.tipo === "cargando") {
    contenido = (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-fade-in-up text-center">
          <div className="mx-auto mb-4 flex h-10 items-center justify-center gap-1.5">
            <span
              className="h-2.5 w-2.5 animate-pulse-soft rounded-full bg-system"
              style={{ animationDelay: "0ms" }}
            />
            <span
              className="h-2.5 w-2.5 animate-pulse-soft rounded-full bg-system"
              style={{ animationDelay: "200ms" }}
            />
            <span
              className="h-2.5 w-2.5 animate-pulse-soft rounded-full bg-system"
              style={{ animationDelay: "400ms" }}
            />
          </div>
          <p key={vista.mensaje} className="animate-fade-in-up text-[13px] text-muted">
            {vista.mensaje}
          </p>
        </div>
      </div>
    );
  } else if (vista.tipo === "error") {
    contenido = (
      <div className="flex h-screen items-center justify-center px-6">
        <div className="max-w-md animate-scale-in rounded-xl border border-severidad-critica/30 bg-severidad-criticaTint px-5 py-4 shadow-elevated">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-severidad-critica shadow-soft">
              <IconoAlerta />
            </span>
            <div>
              <p className="text-[13px] font-medium text-severidad-critica">
                No se pudo completar la revisión
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-severidad-critica/80">
                {vista.mensaje}
              </p>
              <button
                onClick={() => setVista({ tipo: "carga" })}
                className="mt-3 rounded text-[12px] font-medium text-severidad-critica underline decoration-severidad-critica/40 underline-offset-2 transition-opacity hover:opacity-70 active:scale-95"
              >
                Volver a intentar
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  } else {
    contenido = (
      <div className="flex h-screen animate-fade-in flex-col">
        <div className="material-chrome-white sticky top-0 z-10 flex items-center justify-between border-b border-line/70 px-5 py-2.5 shadow-soft">
          <p className="text-[12px] text-muted">
            {vista.rmd.encabezado.producto} · {vista.rmd.encabezado.codigo}
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={minimizarRevision}
              title="Minimizar y revisar otro apartado sin perder este análisis"
              className="rounded px-2 py-1 text-[12px] font-medium text-muted transition-all duration-150 ease-spring hover:bg-paper hover:text-ink active:scale-95"
            >
              — Minimizar
            </button>
            <button
              onClick={volverACarga}
              className="rounded px-2 py-1 text-[12px] font-medium text-system transition-all duration-150 ease-spring hover:bg-system-tint active:scale-95"
            >
              Nueva revisión
            </button>
          </div>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-2 overflow-hidden">
          <PanelRMDVigente pdfUrl={vista.pdfUrl} salto={saltoPdf} />
          {vista.tipo === "resultado" ? (
            <PanelDiscrepancias
              resultado={vista.resultado}
              documentosReferenciados={vista.rmd.documentosReferenciados}
              pasoResaltado={pasoResaltado}
              onHoverPaso={setPasoResaltado}
              onIrAPaso={irAPasoEnPdf}
              estadosSeguimiento={estadosSeguimiento}
              onCambiarEstado={cambiarEstadoSeguimiento}
            />
          ) : (
            <PanelDiferenciasBorrador
              resultado={vista.resultado}
              documentosReferenciados={vista.rmd.documentosReferenciados}
              pasoResaltado={pasoResaltado}
              onHoverPaso={setPasoResaltado}
              onIrAPaso={irAPasoEnPdf}
              estadosSeguimiento={estadosSeguimiento}
              onCambiarEstado={cambiarEstadoSeguimiento}
            />
          )}
        </div>
      </div>
    );
  }

  const mostrarPillMinimizada =
    revisionMinimizada && vista.tipo !== "resultado" && vista.tipo !== "resultado-borrador";

  return (
    <>
      {contenido}
      {mostrarPillMinimizada && (
        <BarraRevisionMinimizada
          nombreProducto={revisionMinimizada!.rmd.encabezado.producto}
          onRestaurar={restaurarRevision}
          onDescartar={descartarRevisionMinimizada}
        />
      )}
    </>
  );
}

const TabModo = forwardRef<
  HTMLButtonElement,
  { activo: boolean; onClick: () => void; label: string }
>(function TabModo({ activo, onClick, label }, ref) {
  return (
    <button
      ref={ref}
      onClick={onClick}
      className={`px-3 pb-3 text-[13px] font-medium transition-colors duration-200 ${
        activo ? "text-system" : "text-muted hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
});

function BotonConfig({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-muted transition-all duration-150 ease-spring hover:bg-white hover:text-system hover:shadow-soft active:scale-95"
    >
      ⚙ {label}
    </button>
  );
}

function IconoAlerta() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

/**
 * Pill flotante persistente: aparece en cualquier pantalla (carga, reglas,
 * documentos obsoletos) mientras haya una revisión minimizada, para que el
 * usuario pueda ir a revisar otro apartado sin perder el análisis en curso.
 */
function BarraRevisionMinimizada({
  nombreProducto,
  onRestaurar,
  onDescartar,
}: {
  nombreProducto: string;
  onRestaurar: () => void;
  onDescartar: () => void;
}) {
  return (
    <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 animate-scale-in items-center gap-3 rounded-full border border-line bg-white py-2 pl-4 pr-2 shadow-elevated">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-system-tint text-system">
        <IconoPausa />
      </span>
      <div className="leading-tight">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
          Revisión en pausa
        </p>
        <p className="max-w-[220px] truncate text-[12.5px] font-medium text-ink">
          {nombreProducto}
        </p>
      </div>
      <button
        onClick={onRestaurar}
        className="rounded-full bg-system px-3 py-1.5 text-[12px] font-medium text-white shadow-soft transition-all duration-150 ease-spring hover:bg-system-light active:scale-95"
      >
        Restaurar
      </button>
      <button
        onClick={onDescartar}
        title="Descartar esta revisión"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted transition-all duration-150 ease-spring hover:bg-severidad-criticaTint hover:text-severidad-critica active:scale-90"
      >
        <IconoX />
      </button>
    </div>
  );
}

function IconoPausa() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

function IconoX() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
