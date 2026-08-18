"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { calcularEscala, calcularRectangulosResaltado } from "@/lib/resaltadoPdf";

export interface SaltoPdf {
  pagina: number;
  // Ausente = navegación a "solo página" (ej. una sección general como
  // Precauciones, sin un patrón de línea puntual que buscar): se hace scroll
  // a la página y se remarca su borde, sin intentar resaltar una línea.
  pasoId?: string;
  // Cita textual de lo que el análisis marcó como observado dentro del paso.
  // Si se encuentra en el PDF, ese fragmento exacto se resalta fuerte y el
  // resto del paso queda en un amarillo suave de contexto.
  textoBuscado?: string | null;
  token: number; // fuerza reaccionar aunque se pida el mismo paso dos veces seguidas
}

interface Props {
  pdfUrl: string;
  salto: SaltoPdf | null;
  /**
   * Se dispara cuando el navegador invalidó el blob detrás de `pdfUrl` (ej.
   * tras minimizar la ventana y volver a abrirla: Chrome puede liberar de
   * memoria un blob en segundo plano). El padre debe generar una URL blob:
   * NUEVA a partir del archivo original y pasarla como `pdfUrl` — este
   * componente no guarda el File, sólo detecta el síntoma.
   */
  onBlobInvalido?: () => void;
}

/**
 * pdf.js reporta la pérdida de un blob: como un ResponseException con
 * status 0 (ver network.js del paquete: "Unexpected server response (0)
 * while retrieving PDF..."), que es justamente el mensaje que vio el
 * usuario al reabrir la ventana minimizada. status 0 en un fetch normal
 * suele ser CORS, pero para una URL blob: sólo significa una cosa: el
 * navegador ya no tiene el blob registrado detrás de esa URL.
 */
function esBlobInvalidado(err: any): boolean {
  return err?.name === "ResponseException" && err?.status === 0;
}

/**
 * Visor de PDF renderizado con pdf.js (canvas), en vez del visor nativo del
 * navegador. Se eligió deliberadamente sobre <iframe src="...pdf#page=N">
 * porque la navegación por fragmento #page= no es confiable con URLs blob:,
 * y porque el resaltado de texto solo es posible si controlamos el render.
 *
 * Muestra TODAS las páginas en una sola columna scrolleable (no paginado):
 * el analista se desplaza libremente, y un clic en una diferencia hace
 * scroll automático hasta la página/línea correspondiente.
 */
export function VisorPdf({ pdfUrl, salto, onBlobInvalido }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const paginaRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const overlayRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const renderTasksRef = useRef<Map<number, { promise: Promise<void>; cancel: () => void }>>(
    new Map()
  );

  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPaginas, setNumPaginas] = useState(0);
  // null = todavía no medimos el ancho real del contenedor. Arrancar en null
  // (en vez de un valor por defecto como 800) evita que la página 1 se
  // renderice una vez con un ancho inventado y luego OTRA vez con el ancho
  // real apenas dispara el ResizeObserver — ese doble render sobre el mismo
  // canvas era la causa del frame corrupto/"volteado" que se veía al abrir
  // un PDF por primera vez.
  const [anchoContenedor, setAnchoContenedor] = useState<number | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Páginas ya pintadas CON la escala actual. El resaltado no puede calcularse
  // antes de que su página esté renderizada: hasta entonces el canvas mide
  // 300px (el default de HTML) y cualquier escala derivada de él estaría mal.
  const [paginasRenderizadas, setPaginasRenderizadas] = useState<ReadonlySet<number>>(
    () => new Set()
  );
  // Cuenta fallos consecutivos de blob invalidado, para no pedir una
  // recuperación infinita si por algún motivo el archivo original tampoco
  // se puede releer (ej. el propio File quedó corrupto, no sólo la URL).
  const fallosBlobRef = useRef(0);
  // Ref (no prop directa) porque este callback se usa desde efectos cuyas
  // dependencias no incluyen onBlobInvalido: sin esto, un onBlobInvalido
  // recreado en cada render del padre podría quedar obsoleto dentro del
  // efecto hasta que otra dependencia lo volviera a disparar.
  const onBlobInvalidoRef = useRef(onBlobInvalido);
  useEffect(() => {
    onBlobInvalidoRef.current = onBlobInvalido;
  }, [onBlobInvalido]);

  /**
   * pdf.js NO sólo puede fallar al cargar el documento: una URL blob: admite
   * range requests, así que `getDocument()` suele completarse con apenas el
   * índice del archivo, y el resto de las páginas se piden de a poco al
   * renderizarlas o al resaltar un paso. Si el blob se invalidó DESPUÉS de
   * la carga inicial (el caso real reportado: minimizar la ventana y volver
   * más tarde), el fallo aparece recién ahí, no en la carga. Por eso este
   * chequeo se repite en los tres puntos donde pdf.js toca la red: la carga
   * inicial, el render de cada página, y la lectura de texto para resaltar.
   */
  function intentarRecuperarBlob(err: any): boolean {
    if (!esBlobInvalidado(err) || !onBlobInvalidoRef.current || fallosBlobRef.current >= 2) {
      return false;
    }
    fallosBlobRef.current += 1;
    onBlobInvalidoRef.current();
    return true;
  }

  // Cargar el documento (una vez por pdfUrl). Import dinámico: pdfjs-dist toca
  // globals de navegador (DOMMatrix, etc.) que no existen durante el SSR de
  // Next.js, así que no puede importarse de forma estática en un componente
  // cliente — solo dentro de un efecto, que corre exclusivamente en el navegador.
  useEffect(() => {
    let cancelado = false;
    setError(null);
    setCargando(true);
    setPdfDoc(null);

    import("pdfjs-dist")
      .then((pdfjsLib) => {
        // Ruta estática servida tal cual desde public/ (copiada ahí en
        // postinstall, ver scripts/copy-pdf-worker.js) — NO usar
        // `new URL(..., import.meta.url)` acá: eso hace que webpack empaquete
        // el worker como asset y Next.js rompe el build de producción
        // ("'import.meta' cannot be used outside of module code"), porque
        // pdfjs-dist v6 distribuye el worker como módulo ESM puro y Terser
        // no lo procesa como tal.
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        return pdfjsLib.getDocument({ url: pdfUrl }).promise;
      })
      .then((doc) => {
        if (cancelado) return;
        fallosBlobRef.current = 0;
        setPdfDoc(doc);
        setNumPaginas(doc.numPages);
        setCargando(false);
      })
      .catch((err) => {
        if (cancelado) return;
        // El blob detrás de esta URL ya no existe (típico tras minimizar la
        // ventana y volver: el navegador lo liberó de memoria). Si hay forma
        // de pedir una URL nueva, delegamos la recuperación al padre en vez
        // de mostrar el error crudo de pdf.js — el archivo original sigue
        // intacto. El spinner de carga sigue visible: en cuanto el padre
        // entregue el pdfUrl nuevo, este mismo efecto se vuelve a disparar.
        if (intentarRecuperarBlob(err)) return;
        setError(err?.message ?? "No se pudo cargar el PDF.");
        setCargando(false);
      });

    return () => {
      cancelado = true;
    };
  }, [pdfUrl]);

  // Medir el ancho disponible para ajustar la escala del render (fit-to-width).
  // Se mide de inmediato (no solo vía el observer) para tener el ancho real
  // desde el primer render de cada página.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setAnchoContenedor(el.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const ancho = entries[0]?.contentRect.width;
      if (ancho) setAnchoContenedor(ancho);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Renderizar todas las páginas (en orden) cuando cambia el documento o el
  // ancho disponible. Se hace de forma secuencial y perezosa por página para
  // no bloquear el hilo principal de una sola vez.
  useEffect(() => {
    if (!pdfDoc || anchoContenedor == null) return;
    let cancelado = false;
    // Cambió el documento o la escala: lo ya pintado deja de ser válido.
    setPaginasRenderizadas(new Set());

    (async () => {
      for (let num = 1; num <= pdfDoc.numPages; num++) {
        if (cancelado) return;
        const canvas = canvasRefs.current.get(num);
        if (!canvas) continue;
        try {
          const page = await pdfDoc.getPage(num);
          if (cancelado) return;
          const viewportBase = page.getViewport({ scale: 1 });
          const escala = calcularEscala(viewportBase.width, anchoContenedor);
          const viewport = page.getViewport({ scale: escala });

          const ctx = canvas.getContext("2d");
          if (!ctx) continue;

          // Si ya había un render en vuelo para esta misma página (ej. el
          // ancho cambió de nuevo antes de que terminara), cancelarlo antes
          // de tocar las dimensiones del canvas — reasignar canvas.width
          // mientras un render anterior sigue pintando produce un frame
          // corrupto/deformado.
          renderTasksRef.current.get(num)?.cancel();

          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;

          const overlay = overlayRefs.current.get(num);
          if (overlay) {
            overlay.style.width = `${viewport.width}px`;
            overlay.style.height = `${viewport.height}px`;
          }

          const tarea = page.render({ canvasContext: ctx, viewport, canvas });
          renderTasksRef.current.set(num, tarea);
          await tarea.promise;
          if (renderTasksRef.current.get(num) === tarea) renderTasksRef.current.delete(num);
          if (cancelado) return;
          // Recién ahora esta página tiene su tamaño definitivo: habilita al
          // efecto de salto a calcular el resaltado con la escala correcta.
          setPaginasRenderizadas((prev) => {
            if (prev.has(num)) return prev;
            const siguiente = new Set(prev);
            siguiente.add(num);
            return siguiente;
          });
        } catch (err: any) {
          // Cancelar una tarea a propósito (arriba) hace que su promesa
          // rechace con esto — es el flujo esperado, no un error real.
          if (err?.name === "RenderingCancelledException") continue;
          // El blob se invalidó a mitad de camino (páginas ya visibles OK,
          // una posterior falla al pedirla). Frenar el resto del recorrido
          // y esperar a que el padre entregue un pdfUrl nuevo — seguir
          // pidiendo páginas contra la misma URL muerta solo acumularía
          // el mismo error por cada una que falte.
          if (intentarRecuperarBlob(err)) return;
          if (!cancelado) console.error(`Error renderizando página ${num} del PDF:`, err);
        }
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [pdfDoc, anchoContenedor]);

  // Cuando se pide "saltar" a un paso: hacer scroll a esa página y dibujar el
  // resaltado sobre la línea donde empieza ese paso (no el párrafo completo).
  useEffect(() => {
    if (!salto || !pdfDoc || anchoContenedor == null) return;
    // Esperar a que la página destino esté pintada: antes de eso el canvas
    // todavía mide 300px y el resaltado saldría a una escala equivocada. Al
    // completarse el render, paginasRenderizadas cambia y este efecto se
    // vuelve a disparar solo.
    if (!paginasRenderizadas.has(salto.pagina)) return;
    let cancelado = false;

    for (const [num, overlay] of overlayRefs.current) {
      if (num !== salto.pagina) overlay.innerHTML = "";
    }
    for (const pagina of paginaRefs.current.values()) {
      pagina.classList.remove("pagina-flash");
    }

    (async () => {
      paginaRefs.current.get(salto.pagina)?.scrollIntoView({ block: "start", behavior: "smooth" });

      const overlay = overlayRefs.current.get(salto.pagina);
      const canvas = canvasRefs.current.get(salto.pagina);
      const paginaEl = paginaRefs.current.get(salto.pagina);
      if (!overlay || !canvas) return;
      overlay.innerHTML = "";

      if (!salto.pasoId) {
        // Navegación a "solo página" (ej. una sección general sin patrón de
        // línea puntual, como Precauciones): ya hicimos scroll arriba, solo
        // falta remarcar el borde para que el usuario sepa dónde mirar.
        paginaEl?.classList.add("pagina-flash");
        setTimeout(() => paginaEl?.classList.remove("pagina-flash"), 1900);
        return;
      }

      try {
        const page = await pdfDoc.getPage(salto.pagina);
        if (cancelado) return;
        const viewportBase = page.getViewport({ scale: 1 });
        // MISMA escala que usó el render (misma función, mismo insumo), en vez
        // de reconstruirla desde canvas.width: así no pueden desincronizarse.
        const escala = calcularEscala(viewportBase.width, anchoContenedor);
        const viewport = page.getViewport({ scale: escala });

        const contenido = await page.getTextContent();
        if (cancelado) return;
        const rects = calcularRectangulosResaltado(
          contenido as any,
          viewport.transform,
          escala,
          salto.pasoId,
          salto.textoBuscado ?? undefined
        );

        if (rects.length === 0) {
          // No se pudo localizar la línea exacta (común en borradores con
          // texto de imagen/OCR): ya hicimos scroll a la página correcta,
          // así que remarcamos el borde de toda la página con un flash para
          // que el usuario sepa dónde mirar aunque no haya línea puntual.
          paginaEl?.classList.add("pagina-flash");
          setTimeout(() => paginaEl?.classList.remove("pagina-flash"), 1900);
          return;
        }

        let marcaAncla: HTMLDivElement | null = null;
        const marcasFoco: HTMLDivElement[] = [];
        const marcas: HTMLDivElement[] = [];
        for (const r of rects) {
          // Recorte defensivo: la marca nunca debe poder salirse del área
          // real de la página, sin importar de dónde venga el cálculo.
          const x = Math.max(0, Math.min(r.x, viewport.width - 2));
          const y = Math.max(0, Math.min(r.y, viewport.height - 2));
          const width = Math.max(2, Math.min(r.width, viewport.width - x));
          const height = Math.max(2, Math.min(r.height, viewport.height - y));

          const marca = document.createElement("div");
          marca.style.position = "absolute";
          marca.style.left = `${x}px`;
          marca.style.top = `${y}px`;
          marca.style.width = `${width}px`;
          marca.style.height = `${height}px`;
          if (r.foco) {
            marca.style.background = "rgba(255, 214, 10, 0.45)";
            marca.style.borderBottom = "2px solid rgba(224, 168, 0, 0.95)";
          } else {
            // Contexto: el paso entero sigue marcado, pero en un tono suave
            // que no compite con el fragmento puntual a corregir.
            marca.style.background = "rgba(255, 214, 10, 0.15)";
          }
          marca.style.borderRadius = "1px";
          marca.style.pointerEvents = "none";
          marca.style.opacity = "0";
          marca.style.transform = "scaleY(0.7)";
          marca.style.transformOrigin = "center";
          marca.style.transition = "opacity 220ms cubic-bezier(0.32,0.72,0,1), transform 220ms cubic-bezier(0.32,0.72,0,1)";
          overlay.appendChild(marca);
          marcas.push(marca);
          if (r.foco) {
            marcasFoco.push(marca);
            marcaAncla ??= marca;
          }
        }
        // Si no hubo fragmento puntual, el ancla es la primera marca del paso.
        marcaAncla ??= marcas[0] ?? null;

        // Doble rAF: fuerza al navegador a pintar el estado inicial (opacidad 0)
        // antes de animar al estado final, para que la transición se vea.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            for (const m of marcas) {
              m.style.opacity = "1";
              m.style.transform = "scaleY(1)";
            }
          });
        });
        setTimeout(() => {
          marcaAncla?.scrollIntoView({ block: "center", behavior: "smooth" });
        }, 300);
        // Pulso breve sólo sobre el fragmento señalado (o sobre todo el paso
        // si no se identificó uno): ayuda a ubicar la zona de un vistazo.
        const marcasPulso = marcasFoco.length > 0 ? marcasFoco : marcas;
        setTimeout(() => {
          for (const m of marcasPulso) m.classList.add("marca-pulso");
        }, 550);
        setTimeout(() => {
          for (const m of marcasPulso) m.classList.remove("marca-pulso");
        }, 1950);
      } catch (err) {
        if (intentarRecuperarBlob(err)) return;
        console.error("Error resaltando el paso en el PDF:", err);
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [salto, pdfDoc, anchoContenedor, paginasRenderizadas]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="material-chrome-white z-10 flex shrink-0 items-center justify-end border-b border-line/70 px-3 py-1.5 shadow-soft">
        <a
          href={pdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded px-1.5 py-0.5 text-[11px] font-medium text-system transition-all duration-150 ease-spring hover:bg-system-tint active:scale-95"
        >
          Abrir en pestaña nueva ↗
        </a>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto bg-paper p-4">
        {error ? (
          <div className="flex h-full animate-fade-in-up items-center justify-center px-6 text-center">
            <p className="text-[13px] text-severidad-critica">{error}</p>
          </div>
        ) : cargando || anchoContenedor == null ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 animate-pulse-soft rounded-full bg-system" style={{ animationDelay: "0ms" }} />
              <span className="h-2 w-2 animate-pulse-soft rounded-full bg-system" style={{ animationDelay: "200ms" }} />
              <span className="h-2 w-2 animate-pulse-soft rounded-full bg-system" style={{ animationDelay: "400ms" }} />
            </div>
          </div>
        ) : (
          <div className="mx-auto flex w-fit animate-fade-in flex-col items-center gap-4">
            {Array.from({ length: numPaginas }, (_, i) => i + 1).map((num) => (
              <div
                key={num}
                ref={(el) => {
                  if (el) paginaRefs.current.set(num, el);
                  else paginaRefs.current.delete(num);
                }}
                // bg-white a propósito (no bg-surface): simula la hoja de
                // papel del PDF, que es blanca sin importar el tema de la app.
                className="relative bg-white shadow-elevated"
              >
                <canvas
                  ref={(el) => {
                    if (el) canvasRefs.current.set(num, el);
                    else canvasRefs.current.delete(num);
                  }}
                  className="block"
                />
                <div
                  ref={(el) => {
                    if (el) overlayRefs.current.set(num, el);
                    else overlayRefs.current.delete(num);
                  }}
                  className="pointer-events-none absolute inset-0"
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
