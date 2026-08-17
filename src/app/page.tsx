"use client";

import { useState, useCallback, useEffect, useRef, forwardRef } from "react";
import { FormularioCarga } from "@/components/FormularioCarga";
import { FormularioComparacionBorrador } from "@/components/FormularioComparacionBorrador";
import { PanelRMDVigente } from "@/components/PanelRMDVigente";
import { PanelDiscrepancias } from "@/components/PanelDiscrepancias";
import { PanelDiferenciasBorrador } from "@/components/PanelDiferenciasBorrador";
import { ModalVisorBorrador } from "@/components/ModalVisorBorrador";
import { PanelReglas } from "@/components/PanelReglas";
import { PanelDocumentosObsoletos } from "@/components/PanelDocumentosObsoletos";
import { ToggleTema } from "@/components/ui/ToggleTema";
import type { SaltoPdf } from "@/components/VisorPdf";
import type {
  RMDExtraido,
  ResultadoRevisionIA,
  ResultadoComparacionBorrador,
  DestinoPdf,
} from "@/types/rmd";

type EstadoSeguimiento = "pendiente" | "corregido_en_sap" | "descartado";
type ModoEntrada = "control_cambios" | "borrador" | "corregido_vs_borrador";

type VistaResultado =
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
      // false = se subió el RMD "corregido" sin borrador: el resultado es
      // una verificación de cumplimiento (reglas permanentes + documentos
      // obsoletos), no una comparación contra otro documento.
      conBorrador: boolean;
      // true = el documento subido YA estaba corregido, así que las tarjetas
      // son "indicaciones del borrador todavía pendientes", no "cambios
      // propuestos". Cambia el prompt usado y las etiquetas del panel.
      esCorregido: boolean;
      // Presentes solo cuando conBorrador es true: permiten abrir el modal
      // "ver en el borrador" desde una tarjeta de diferencia, sin necesidad
      // de volver a subir el archivo.
      pdfBorradorUrl?: string;
      rmdBorrador?: RMDExtraido;
    };

/**
 * Una revisión abierta. El analista puede tener varias a la vez y alternar
 * entre ellas sin perder el avance de ninguna: por eso el checklist manual
 * (estadosSeguimiento) y la verificación automática viven DENTRO de la
 * sesión y no en un estado global compartido.
 *
 * Ojo: los PDF se guardan como blob URL, que solo existe mientras viva la
 * pestaña. Por eso las sesiones no se pueden persistir en localStorage ni
 * sobrevivir a un recargado — de ahí la advertencia al usuario.
 */
interface SesionRevision {
  id: string;
  vista: VistaResultado;
  estadosSeguimiento: Record<string, EstadoSeguimiento>;
  verificacionCorreccion: Record<string, { resuelto: boolean; justificacion: string }>;
  // El analista la marca cuando considera cerrada la revisión. Las
  // finalizadas siguen consultables, pero ya no cuentan como "en proceso".
  finalizada: boolean;
  creadaEn: number;
}

type VistaActual =
  | { tipo: "carga" }
  | { tipo: "reglas" }
  | { tipo: "documentosObsoletos" }
  | { tipo: "cargando"; mensaje: string }
  | { tipo: "error"; mensaje: string }
  // Muestra la sesión activa (ver sesionActivaId).
  | { tipo: "sesion" };

function liberarPdfs(v: VistaResultado) {
  URL.revokeObjectURL(v.pdfUrl);
  if (v.tipo === "resultado-borrador" && v.pdfBorradorUrl) {
    URL.revokeObjectURL(v.pdfBorradorUrl);
  }
}

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
  // Salto pendiente dentro del modal "ver en el borrador" — no null = modal abierto.
  const [modalBorrador, setModalBorrador] = useState<SaltoPdf | null>(null);
  // Todas las revisiones abiertas. El analista puede tener varias en paralelo
  // y volver a cualquiera cuando quiera; cada una guarda su propio avance.
  const [sesiones, setSesiones] = useState<SesionRevision[]>([]);
  const [sesionActivaId, setSesionActivaId] = useState<string | null>(null);
  const [listaSesionesAbierta, setListaSesionesAbierta] = useState(false);

  // Verificación automática al subir el RMD ya corregido en SAP: por cada
  // observación original (misma clave que estadosSeguimiento) guarda si la
  // IA confirmó que el documento corregido ya la resuelve.
  const [verificandoCorreccion, setVerificandoCorreccion] = useState(false);
  const [errorVerificacion, setErrorVerificacion] = useState<string | null>(null);

  const sesionActiva = sesiones.find((s) => s.id === sesionActivaId) ?? null;
  const sesionesEnProceso = sesiones.filter((s) => !s.finalizada);

  // Los PDF viven como blob URL, que muere con la pestaña: no hay forma de
  // restaurar una revisión tras recargar. Avisamos antes de perder trabajo.
  useEffect(() => {
    if (sesionesEnProceso.length === 0) return;
    const alSalir = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", alSalir);
    return () => window.removeEventListener("beforeunload", alSalir);
  }, [sesionesEnProceso.length]);

  const actualizarSesion = useCallback(
    (id: string, cambio: (s: SesionRevision) => SesionRevision) => {
      setSesiones((prev) => prev.map((s) => (s.id === id ? cambio(s) : s)));
    },
    []
  );

  const abrirNuevaSesion = useCallback((vistaResultado: VistaResultado) => {
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `sesion-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setSesiones((prev) => [
      ...prev,
      {
        id,
        vista: vistaResultado,
        estadosSeguimiento: {},
        verificacionCorreccion: {},
        finalizada: false,
        creadaEn: Date.now(),
      },
    ]);
    setSesionActivaId(id);
    setSaltoPdf(null);
    setModalBorrador(null);
    setErrorVerificacion(null);
    setVista({ tipo: "sesion" });
  }, []);

  const iniciarRevision = useCallback(
    async (input: {
      rmdFile: File;
      seccion: string;
      etapa: string;
      controlCambioTexto?: string;
      controlCambioFile?: File;
    }) => {
      setErrorVerificacion(null);
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

        abrirNuevaSesion({
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
    [abrirNuevaSesion]
  );

  const iniciarComparacionBorrador = useCallback(
    async (input: {
      rmdVigenteFile: File;
      rmdBorradorFile?: File;
      seccion: string;
      etapa: string;
      // "vigente": el primer documento todavía NO está corregido — se listan
      // los cambios que el borrador propone.
      // "corregido": el primer documento YA fue corregido por el analista — se
      // verifica cuáles indicaciones del borrador siguen pendientes. Son
      // tareas inversas y usan prompts distintos (ver /api/revision-borrador).
      variante?: "vigente" | "corregido";
    }) => {
      const etiquetaPrimerDocumento =
        input.variante === "corregido" ? "el RMD corregido" : "el RMD vigente";
      setErrorVerificacion(null);
      try {
        setVista({ tipo: "cargando", mensaje: `Extrayendo ${etiquetaPrimerDocumento}…` });

        const formDataVigente = new FormData();
        formDataVigente.append("file", input.rmdVigenteFile);
        const extractVigenteRes = await fetch("/api/extract-pdf", {
          method: "POST",
          body: formDataVigente,
        });
        if (!extractVigenteRes.ok) {
          const err = await extractVigenteRes.json();
          throw new Error(err.error ?? `No se pudo extraer el PDF de ${etiquetaPrimerDocumento}.`);
        }
        const { estructura: estructuraVigente, pdfBase64: pdfVigenteBase64 } =
          await extractVigenteRes.json();

        let estructuraBorrador: any = null;
        let pdfBorradorBase64: string | undefined;
        if (input.rmdBorradorFile) {
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
          const data = await extractBorradorRes.json();
          estructuraBorrador = data.estructura;
          pdfBorradorBase64 = data.pdfBase64;
        }

        const esCorregido = input.variante === "corregido";
        setVista({
          tipo: "cargando",
          mensaje: !estructuraBorrador
            ? "Verificando reglas permanentes y documentos obsoletos…"
            : esCorregido
              ? "Verificando qué indicaciones del borrador ya están aplicadas…"
              : "Comparando ambos documentos…",
        });

        const revisionRes = await fetch("/api/revision-borrador", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rmdVigente: estructuraVigente,
            pdfVigenteBase64,
            rmdBorrador: estructuraBorrador ?? undefined,
            pdfBorradorBase64,
            modo: esCorregido ? "corregido_vs_borrador" : "vigente_vs_borrador",
            seccionCodigo: input.seccion,
            etapaCodigo: input.etapa,
          }),
        });

        if (!revisionRes.ok) {
          const err = await revisionRes.json();
          throw new Error(err.error ?? "No se pudo completar la comparación.");
        }

        const data = await revisionRes.json();

        abrirNuevaSesion({
          tipo: "resultado-borrador",
          rmd: estructuraVigente,
          pdfUrl: URL.createObjectURL(input.rmdVigenteFile),
          resultado: data.resultado,
          revisionId: data.revisionId ?? null,
          conBorrador: !!estructuraBorrador,
          esCorregido,
          pdfBorradorUrl: input.rmdBorradorFile
            ? URL.createObjectURL(input.rmdBorradorFile)
            : undefined,
          rmdBorrador: estructuraBorrador ?? undefined,
        });
      } catch (err: any) {
        setVista({ tipo: "error", mensaje: err.message ?? "Ocurrió un error inesperado." });
      }
    },
    [abrirNuevaSesion]
  );

  const cambiarEstadoSeguimiento = useCallback(
    async (pasoId: string, estado: EstadoSeguimiento) => {
      const sesion = sesionActiva;
      if (!sesion) return;
      actualizarSesion(sesion.id, (s) => ({
        ...s,
        estadosSeguimiento: { ...s.estadosSeguimiento, [pasoId]: estado },
      }));

      const revisionId = sesion.vista.revisionId;
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
    [sesionActiva, actualizarSesion]
  );

  const subirRmdCorregido = useCallback(
    async (file: File) => {
      const sesion = sesionActiva;
      if (!sesion) return;
      const vistaActual = sesion.vista;

      setVerificandoCorreccion(true);
      setErrorVerificacion(null);
      try {
        const formData = new FormData();
        formData.append("file", file);
        const extractRes = await fetch("/api/extract-pdf", { method: "POST", body: formData });
        if (!extractRes.ok) {
          const err = await extractRes.json();
          throw new Error(err.error ?? "No se pudo extraer el PDF corregido.");
        }
        const { estructura, pdfBase64 } = await extractRes.json();

        // Reconstruir la misma "clave" que usan los paneles para cada
        // tarjeta (pasoId real, o un id sintético para los que no tienen uno
        // — ver PanelDiscrepancias/PanelDiferenciasBorrador), así la
        // verificación se puede enlazar de vuelta con la tarjeta correcta.
        const clavePorId = new Map<number, string>();
        const hallazgos: { id: number; ubicacionReferencia: string; descripcion: string }[] = [];

        if (vistaActual.tipo === "resultado") {
          vistaActual.resultado.discrepanciasDetectadas.forEach((d, i) => {
            if (d.tipoDiscrepancia === "sin_discrepancia") return;
            clavePorId.set(i, d.pasoId !== "N/A" ? d.pasoId : `na-${i}`);
            hallazgos.push({
              id: i,
              ubicacionReferencia: d.ubicacionReferencia,
              descripcion: `${d.tipoDiscrepancia}: ${d.queExigeElControlDeCambios}`,
            });
          });
        } else {
          vistaActual.resultado.diferenciasDetectadas.forEach((d, i) => {
            if (d.tipoDiferencia === "sin_diferencia") return;
            clavePorId.set(i, d.pasoIdVigente ?? d.pasoIdBorrador ?? `sin-paso-${i}`);
            hallazgos.push({
              id: i,
              ubicacionReferencia: d.ubicacionReferencia,
              descripcion: `${d.tipoDiferencia}: ${d.justificacion}`,
            });
          });
        }

        if (hallazgos.length === 0) {
          throw new Error("Esta revisión no tiene observaciones pendientes para verificar.");
        }

        const verifRes = await fetch("/api/verificar-correccion", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rmdCorregido: estructura,
            pdfCorregidoBase64: pdfBase64,
            hallazgos,
          }),
        });
        if (!verifRes.ok) {
          const err = await verifRes.json();
          throw new Error(err.error ?? "No se pudo verificar la corrección.");
        }
        const { resultado: resultadoVerificacion } = await verifRes.json();

        const nuevaVerificacion: Record<string, { resuelto: boolean; justificacion: string }> = {};
        for (const v of resultadoVerificacion.verificaciones as {
          id: number;
          resuelto: boolean;
          justificacion: string;
        }[]) {
          const clave = clavePorId.get(v.id);
          if (!clave) continue;
          nuevaVerificacion[clave] = { resuelto: v.resuelto, justificacion: v.justificacion };
          // Sincroniza el checklist manual: si la IA confirma que ya está
          // resuelto, lo marca "Corregido en SAP" (con su persistencia ya
          // existente). Si sigue pendiente, no toca lo que el analista haya
          // marcado a mano — solo agrega el triángulo de aviso.
          if (v.resuelto) cambiarEstadoSeguimiento(clave, "corregido_en_sap");
        }

        setSaltoPdf(null);
        // Solo se reemplaza el PDF principal: el del borrador (si lo hay)
        // sigue siendo válido y su blob no debe liberarse acá.
        URL.revokeObjectURL(vistaActual.pdfUrl);
        const pdfUrl = URL.createObjectURL(file);
        actualizarSesion(sesion.id, (s) => ({
          ...s,
          vista: { ...s.vista, rmd: estructura, pdfUrl },
          verificacionCorreccion: { ...s.verificacionCorreccion, ...nuevaVerificacion },
        }));
      } catch (err: any) {
        setErrorVerificacion(err.message ?? "Ocurrió un error inesperado al verificar la corrección.");
      } finally {
        setVerificandoCorreccion(false);
      }
    },
    [sesionActiva, cambiarEstadoSeguimiento, actualizarSesion]
  );

  const irAPasoEnPdf = useCallback(
    (destino: DestinoPdf) => {
      if (!sesionActiva) return;
      const vista = sesionActiva.vista;

      // Preferimos un paso numérico del procedimiento (resalta la línea
      // exacta); si no hay o no se encontró, probamos con la sección
      // general (Precauciones/Notas Importantes/Equipos), que solo hace
      // scroll + remarca la página completa, sin línea puntual.
      if (destino.pasoId && destino.pasoId !== "N/A") {
        const paso = vista.rmd.procedimiento.find((p) => p.id === destino.pasoId);
        if (paso?.pagina) {
          const pasoId = destino.pasoId;
          const textoBuscado = destino.textoBuscado ?? null;
          setSaltoPdf((prev) => ({
            pagina: paso.pagina!,
            pasoId,
            textoBuscado,
            token: (prev?.token ?? 0) + 1,
          }));
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
    [sesionActiva]
  );

  // Igual que irAPasoEnPdf, pero resuelve la ubicación contra la estructura
  // del BORRADOR (no la del vigente) y abre el modal en vez de navegar en el
  // visor principal. Solo aplica cuando la vista actual comparó contra un
  // borrador real (conBorrador) y su PDF sigue en memoria.
  const verEnBorrador = useCallback(
    (destino: DestinoPdf) => {
      const vista = sesionActiva?.vista;
      if (vista?.tipo !== "resultado-borrador" || !vista.rmdBorrador || !vista.pdfBorradorUrl) return;
      const rmdBorrador = vista.rmdBorrador;

      if (destino.pasoId && destino.pasoId !== "N/A") {
        const paso = rmdBorrador.procedimiento.find((p) => p.id === destino.pasoId);
        if (paso?.pagina) {
          const pasoId = destino.pasoId;
          const textoBuscado = destino.textoBuscado ?? null;
          setModalBorrador((prev) => ({
            pagina: paso.pagina!,
            pasoId,
            textoBuscado,
            token: (prev?.token ?? 0) + 1,
          }));
          return;
        }
      }

      if (destino.seccionGeneral) {
        const pagina = rmdBorrador.paginasSeccionesGenerales[destino.seccionGeneral];
        if (pagina) {
          setModalBorrador((prev) => ({ pagina, token: (prev?.token ?? 0) + 1 }));
        }
      }
    },
    [sesionActiva]
  );

  /** Deja la sesión abierta (con todo su avance) y vuelve a la pantalla de carga. */
  const irAPantallaCarga = useCallback(() => {
    setSesionActivaId(null);
    setSaltoPdf(null);
    setModalBorrador(null);
    setErrorVerificacion(null);
    setVista({ tipo: "carga" });
  }, []);

  const abrirSesion = useCallback((id: string) => {
    setSesionActivaId(id);
    setSaltoPdf(null);
    setModalBorrador(null);
    setErrorVerificacion(null);
    setListaSesionesAbierta(false);
    setVista({ tipo: "sesion" });
  }, []);

  /** Marcar como terminada: sigue consultable, pero ya no cuenta como "en proceso". */
  const alternarFinalizada = useCallback(
    (id: string) => {
      actualizarSesion(id, (s) => ({ ...s, finalizada: !s.finalizada }));
    },
    [actualizarSesion]
  );

  const cerrarSesion = useCallback(
    (id: string) => {
      setSesiones((prev) => {
        const s = prev.find((x) => x.id === id);
        if (s) liberarPdfs(s.vista);
        return prev.filter((x) => x.id !== id);
      });
      setSesionActivaId((actual) => {
        if (actual !== id) return actual;
        setVista({ tipo: "carga" });
        setSaltoPdf(null);
        setModalBorrador(null);
        return null;
      });
    },
    []
  );

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
                tabRefs.current.corregido_vs_borrador = el;
              }}
              activo={modo === "corregido_vs_borrador"}
              onClick={() => setModo("corregido_vs_borrador")}
              label="RMD Corregido"
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
            <ToggleTema />
          </div>
        </div>
        {sesionesEnProceso.length > 0 && (
          <div className="border-b border-severidad-alta/20 bg-severidad-altaTint px-5 py-2">
            <p className="text-[12px] leading-relaxed text-severidad-alta">
              Tenés {sesionesEnProceso.length}{" "}
              {sesionesEnProceso.length === 1 ? "revisión" : "revisiones"} en proceso. Se
              mantienen abiertas mientras no cierres ni recargues esta pestaña —{" "}
              <strong className="font-semibold">al recargar se pierden</strong>, porque los PDF
              solo viven en la sesión del navegador.
            </p>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          {modo === "control_cambios" ? (
            <FormularioCarga onIniciarRevision={iniciarRevision} cargando={false} />
          ) : modo === "borrador" ? (
            <FormularioComparacionBorrador
              onIniciarComparacion={iniciarComparacionBorrador}
              cargando={false}
              variante="vigente"
            />
          ) : (
            <FormularioComparacionBorrador
              onIniciarComparacion={(input) =>
                iniciarComparacionBorrador({ ...input, variante: "corregido" })
              }
              cargando={false}
              variante="corregido"
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
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface text-severidad-critica shadow-soft">
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
  } else if (sesionActiva) {
    const vr = sesionActiva.vista;
    contenido = (
      <div className="flex h-screen animate-fade-in flex-col">
        <div className="material-chrome-white sticky top-0 z-10 flex items-center justify-between border-b border-line/70 px-5 py-2.5 shadow-soft">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-[12px] text-muted">
              {vr.rmd.encabezado.producto} · {vr.rmd.encabezado.codigo}
            </p>
            {sesionActiva.finalizada && (
              <span className="shrink-0 rounded-full bg-system-tint px-2 py-0.5 text-[11px] font-medium text-system">
                Finalizada
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <BotonSubirCorregido
              verificando={verificandoCorreccion}
              onSeleccionar={subirRmdCorregido}
            />
            <button
              onClick={() => alternarFinalizada(sesionActiva.id)}
              title={
                sesionActiva.finalizada
                  ? "Reabrir esta revisión"
                  : "Marcar esta revisión como terminada (se sigue pudiendo consultar)"
              }
              className={`rounded px-2 py-1 text-[12px] font-medium transition-all duration-150 ease-spring active:scale-95 ${
                sesionActiva.finalizada
                  ? "text-muted hover:bg-paper hover:text-ink"
                  : "text-system hover:bg-system-tint"
              }`}
            >
              {sesionActiva.finalizada ? "Reabrir" : "✓ Finalizar"}
            </button>
            <button
              onClick={irAPantallaCarga}
              title="Volver al inicio sin cerrar esta revisión: queda abierta para retomarla"
              className="rounded px-2 py-1 text-[12px] font-medium text-muted transition-all duration-150 ease-spring hover:bg-paper hover:text-ink active:scale-95"
            >
              — Dejar abierta
            </button>
            <ToggleTema />
          </div>
        </div>
        {errorVerificacion && (
          <div className="flex animate-fade-in-up items-center justify-between gap-3 border-b border-severidad-critica/20 bg-severidad-criticaTint px-5 py-2">
            <p className="text-[12.5px] text-severidad-critica">{errorVerificacion}</p>
            <button
              onClick={() => setErrorVerificacion(null)}
              className="shrink-0 rounded px-1.5 py-0.5 text-[12px] text-severidad-critica/70 transition-colors hover:bg-surface/50 hover:text-severidad-critica"
            >
              ✕
            </button>
          </div>
        )}
        <div className="grid min-h-0 flex-1 grid-cols-2 overflow-hidden">
          <PanelRMDVigente pdfUrl={vr.pdfUrl} salto={saltoPdf} />
          {vr.tipo === "resultado" ? (
            <PanelDiscrepancias
              resultado={vr.resultado}
              documentosReferenciados={vr.rmd.documentosReferenciados}
              pasoResaltado={pasoResaltado}
              onHoverPaso={setPasoResaltado}
              onIrAPaso={irAPasoEnPdf}
              estadosSeguimiento={sesionActiva.estadosSeguimiento}
              onCambiarEstado={cambiarEstadoSeguimiento}
              verificacionCorreccion={sesionActiva.verificacionCorreccion}
            />
          ) : (
            <PanelDiferenciasBorrador
              resultado={vr.resultado}
              documentosReferenciados={vr.rmd.documentosReferenciados}
              pasoResaltado={pasoResaltado}
              onHoverPaso={setPasoResaltado}
              onIrAPaso={irAPasoEnPdf}
              estadosSeguimiento={sesionActiva.estadosSeguimiento}
              onCambiarEstado={cambiarEstadoSeguimiento}
              verificacionCorreccion={sesionActiva.verificacionCorreccion}
              conBorrador={vr.conBorrador}
              esCorregido={vr.esCorregido}
              onVerEnBorrador={verEnBorrador}
              puedeVerBorrador={!!vr.pdfBorradorUrl}
            />
          )}
        </div>
        {vr.tipo === "resultado-borrador" && modalBorrador && vr.pdfBorradorUrl && (
          <ModalVisorBorrador
            pdfUrl={vr.pdfBorradorUrl}
            salto={modalBorrador}
            onClose={() => setModalBorrador(null)}
          />
        )}
      </div>
    );
  } else {
    // vista.tipo === "sesion" pero la sesión ya no existe (se cerró).
    contenido = null;
  }

  return (
    <>
      {contenido}
      {vista.tipo !== "sesion" && sesiones.length > 0 && (
        <BarraSesiones
          sesiones={sesiones}
          abierta={listaSesionesAbierta}
          onAlternarLista={() => setListaSesionesAbierta((v) => !v)}
          onAbrir={abrirSesion}
          onAlternarFinalizada={alternarFinalizada}
          onCerrar={cerrarSesion}
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
      className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-muted transition-all duration-150 ease-spring hover:bg-surface hover:text-system hover:shadow-soft active:scale-95"
    >
      ⚙ {label}
    </button>
  );
}

/**
 * Botón que abre el selector de archivo del RMD ya corregido en SAP. Al
 * elegir un PDF, dispara la verificación automática (ver subirRmdCorregido
 * en el componente Home) que marca cada observación como corregida o
 * pendiente comparando contra el documento nuevo.
 */
function BotonSubirCorregido({
  verificando,
  onSeleccionar,
}: {
  verificando: boolean;
  onSeleccionar: (file: File) => void;
}) {
  return (
    <label
      title="Subir el RMD ya corregido en SAP para verificar qué observaciones quedaron resueltas"
      className={`flex items-center gap-1.5 rounded border px-2.5 py-1 text-[12px] font-medium transition-all duration-150 ease-spring ${
        verificando
          ? "cursor-not-allowed border-line text-muted/50"
          : "cursor-pointer border-line text-system hover:border-system hover:bg-system-tint active:scale-95"
      }`}
    >
      {verificando ? (
        <>
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-line border-t-system" />
          Verificando…
        </>
      ) : (
        <>↑ Subir RMD corregido</>
      )}
      <input
        type="file"
        accept="application/pdf"
        disabled={verificando}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onSeleccionar(file);
        }}
      />
    </label>
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
/**
 * Barra flotante con TODAS las revisiones abiertas. El analista puede tener
 * varias en paralelo, volver a cualquiera, y marcarlas como finalizadas
 * cuando lo decida.
 */
function BarraSesiones({
  sesiones,
  abierta,
  onAlternarLista,
  onAbrir,
  onAlternarFinalizada,
  onCerrar,
}: {
  sesiones: SesionRevision[];
  abierta: boolean;
  onAlternarLista: () => void;
  onAbrir: (id: string) => void;
  onAlternarFinalizada: (id: string) => void;
  onCerrar: (id: string) => void;
}) {
  const enProceso = sesiones.filter((s) => !s.finalizada).length;

  return (
    <div className="fixed bottom-5 left-1/2 z-50 w-[min(92vw,460px)] -translate-x-1/2 animate-scale-in">
      {abierta && (
        <div className="mb-2 max-h-[52vh] overflow-y-auto rounded-xl border border-line bg-surface p-2 shadow-elevated">
          {enProceso > 0 && (
            <p className="mb-2 rounded-lg border border-severidad-alta/25 bg-severidad-altaTint px-3 py-2 text-[11.5px] leading-relaxed text-severidad-alta">
              ⚠ No recargues ni cierres la pestaña: las revisiones viven solo en esta
              sesión del navegador y se perderían las {enProceso} que están en proceso.
            </p>
          )}
          <ul className="space-y-1">
            {sesiones.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-2 rounded-lg border border-line bg-paper px-2.5 py-2"
              >
                <div className="min-w-0 flex-1 leading-tight">
                  <p className="truncate text-[12.5px] font-medium text-ink">
                    {s.vista.rmd.encabezado.producto}
                  </p>
                  <p className="truncate font-mono text-[11px] text-muted">
                    {s.vista.rmd.encabezado.codigo}
                    {" · "}
                    <span className={s.finalizada ? "text-system" : "text-severidad-alta"}>
                      {s.finalizada ? "Finalizada" : "En proceso"}
                    </span>
                  </p>
                </div>
                <button
                  onClick={() => onAbrir(s.id)}
                  className="shrink-0 rounded-full bg-system px-2.5 py-1 text-[11.5px] font-medium text-white shadow-soft transition-all duration-150 ease-spring hover:bg-system-light active:scale-95"
                >
                  Abrir
                </button>
                <button
                  onClick={() => onAlternarFinalizada(s.id)}
                  title={s.finalizada ? "Reabrir" : "Marcar como finalizada"}
                  className="shrink-0 rounded-full px-2 py-1 text-[11.5px] font-medium text-muted transition-all duration-150 ease-spring hover:bg-system-tint hover:text-system active:scale-95"
                >
                  {s.finalizada ? "Reabrir" : "✓"}
                </button>
                <button
                  onClick={() => onCerrar(s.id)}
                  title="Cerrar y descartar esta revisión"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted transition-all duration-150 ease-spring hover:bg-severidad-criticaTint hover:text-severidad-critica active:scale-90"
                >
                  <IconoX />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        onClick={onAlternarLista}
        className="flex w-full items-center gap-3 rounded-full border border-line bg-surface py-2 pl-4 pr-4 shadow-elevated transition-all duration-150 ease-spring hover:shadow-soft active:scale-[0.99]"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-system-tint text-system">
          <IconoPausa />
        </span>
        <span className="min-w-0 flex-1 text-left leading-tight">
          <span className="block text-[11px] font-medium uppercase tracking-wide text-muted">
            Revisiones abiertas
          </span>
          <span className="block truncate text-[12.5px] font-medium text-ink">
            {sesiones.length} en total
            {enProceso > 0 ? ` · ${enProceso} en proceso` : " · todas finalizadas"}
          </span>
        </span>
        <span className="shrink-0 text-[12px] text-muted">{abierta ? "▾" : "▴"}</span>
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
