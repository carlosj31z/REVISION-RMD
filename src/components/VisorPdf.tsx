"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

export interface SaltoPdf {
  pagina: number;
  // Ausente = navegación a "solo página" (ej. una sección general como
  // Precauciones, sin un patrón de línea puntual que buscar): se hace scroll
  // a la página y se remarca su borde, sin intentar resaltar una línea.
  pasoId?: string;
  token: number; // fuerza reaccionar aunque se pida el mismo paso dos veces seguidas
}

interface Props {
  pdfUrl: string;
  salto: SaltoPdf | null;
}

interface RectanguloResaltado {
  x: number;
  y: number;
  width: number;
  height: number;
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
export function VisorPdf({ pdfUrl, salto }: Props) {
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
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url
        ).toString();
        return pdfjsLib.getDocument({ url: pdfUrl }).promise;
      })
      .then((doc) => {
        if (cancelado) return;
        setPdfDoc(doc);
        setNumPaginas(doc.numPages);
        setCargando(false);
      })
      .catch((err) => {
        if (cancelado) return;
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

    (async () => {
      for (let num = 1; num <= pdfDoc.numPages; num++) {
        if (cancelado) return;
        const canvas = canvasRefs.current.get(num);
        if (!canvas) continue;
        try {
          const page = await pdfDoc.getPage(num);
          if (cancelado) return;
          const viewportBase = page.getViewport({ scale: 1 });
          const escala = Math.max(0.4, (anchoContenedor - 32) / viewportBase.width);
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
        } catch (err: any) {
          // Cancelar una tarea a propósito (arriba) hace que su promesa
          // rechace con esto — es el flujo esperado, no un error real.
          if (err?.name === "RenderingCancelledException") continue;
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
    if (!salto || !pdfDoc) return;
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
        // Reconstruir la MISMA escala ya usada al renderizar esta página
        // (leyendo el tamaño real del canvas) para que el resaltado quede
        // perfectamente alineado con lo que ya está dibujado.
        const escala = canvas.width > 0 ? canvas.width / viewportBase.width : 1;
        const viewport = page.getViewport({ scale: escala });

        const rects = await buscarRectangulosPaso(page, viewport, salto.pasoId);
        if (cancelado) return;

        if (rects.length === 0) {
          // No se pudo localizar la línea exacta (común en borradores con
          // texto de imagen/OCR): ya hicimos scroll a la página correcta,
          // así que remarcamos el borde de toda la página con un flash para
          // que el usuario sepa dónde mirar aunque no haya línea puntual.
          paginaEl?.classList.add("pagina-flash");
          setTimeout(() => paginaEl?.classList.remove("pagina-flash"), 1900);
          return;
        }

        let primeraMarca: HTMLDivElement | null = null;
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
          marca.style.background = "rgba(255, 214, 10, 0.32)";
          marca.style.borderBottom = "2px solid rgba(224, 168, 0, 0.85)";
          marca.style.borderRadius = "1px";
          marca.style.pointerEvents = "none";
          marca.style.opacity = "0";
          marca.style.transform = "scaleY(0.7)";
          marca.style.transformOrigin = "center";
          marca.style.transition = "opacity 220ms cubic-bezier(0.32,0.72,0,1), transform 220ms cubic-bezier(0.32,0.72,0,1)";
          overlay.appendChild(marca);
          marcas.push(marca);
          primeraMarca ??= marca;
        }
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
          primeraMarca?.scrollIntoView({ block: "center", behavior: "smooth" });
        }, 300);
        // Pulso breve: ayuda a ubicar la zona de un vistazo aunque el
        // recuadro no cubra perfectamente cada palabra.
        setTimeout(() => {
          for (const m of marcas) m.classList.add("marca-pulso");
        }, 550);
        setTimeout(() => {
          for (const m of marcas) m.classList.remove("marca-pulso");
        }, 1950);
      } catch (err) {
        console.error("Error resaltando el paso en el PDF:", err);
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [salto, pdfDoc]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
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

/**
 * Busca la LÍNEA física de la página donde empieza el patrón "<pasoId>.-" (el
 * mismo patrón que usa el parseo heurístico del lado servidor) y devuelve los
 * rectángulos, en coordenadas de canvas, que cubren esa línea — y a lo sumo
 * unas pocas líneas más si el paso sigue sin toparse con el siguiente paso
 * numerado, para evitar resaltar el bloque de texto entero.
 */
async function buscarRectangulosPaso(
  page: PDFPageProxy,
  viewport: { transform: number[] },
  pasoId: string
): Promise<RectanguloResaltado[]> {
  const pdfjsLib = await import("pdfjs-dist");
  const contenido = await page.getTextContent();
  const items = contenido.items.filter(
    (it): it is typeof it & { str: string; transform: number[]; width: number } =>
      typeof (it as any).str === "string" && (it as any).str.length > 0
  );

  const itemsConTx = items.map((item) => ({
    item,
    tx: pdfjsLib.Util.transform(viewport.transform, item.transform),
  }));

  // Agrupar los ítems en líneas físicas por coordenada Y (con tolerancia de
  // subpíxel), y ordenar cada línea de izquierda a derecha para reconstruir
  // el texto en orden de lectura.
  type Grupo = { y: number; items: typeof itemsConTx };
  const lineas: Grupo[] = [];
  const TOLERANCIA_Y = 2.5;
  for (const it of itemsConTx) {
    const y = it.tx[5];
    let linea = lineas.find((l) => Math.abs(l.y - y) < TOLERANCIA_Y);
    if (!linea) {
      linea = { y, items: [] };
      lineas.push(linea);
    }
    linea.items.push(it);
  }
  for (const l of lineas) l.items.sort((a, b) => a.tx[4] - b.tx[4]);
  lineas.sort((a, b) => a.y - b.y);

  const patron = `${pasoId}.-`;
  const idxLineaInicio = lineas.findIndex((l) =>
    l.items.map((i) => i.item.str).join("").includes(patron)
  );
  if (idxLineaInicio === -1) return [];

  const rects: RectanguloResaltado[] = [];
  const patronNuevoPaso = /^\d\.\d(?:\.\d+)?\.-/;
  const MAX_LINEAS = 4; // tope: nunca resaltar más de unas pocas líneas
  const UMBRAL_FUSION = 6; // px: gaps menores a esto se fusionan en una sola caja continua

  for (let i = idxLineaInicio; i < lineas.length && i < idxLineaInicio + MAX_LINEAS; i++) {
    const linea = lineas[i];
    const textoLinea = linea.items.map((it) => it.item.str).join("");

    // Si una línea posterior empieza con OTRO paso numerado, ahí termina el bloque.
    if (i > idxLineaInicio && patronNuevoPaso.test(textoLinea.trim())) break;

    // Offset (en caracteres, dentro del texto concatenado de la línea) donde
    // empieza lo que hay que resaltar: el inicio exacto del patrón "<id>.-"
    // en la primera línea, o el principio de la línea en las siguientes.
    const offsetInicio = i === idxLineaInicio ? textoLinea.indexOf(patron) : 0;

    let cursor = 0; // índice de carácter acumulado a través de los ítems de la línea
    let cajaActual: RectanguloResaltado | null = null;

    for (const { item, tx } of linea.items) {
      const inicioItem = cursor;
      cursor += item.str.length;
      if (cursor <= offsetInicio) continue; // ítem entero antes del punto de inicio: se omite

      const alturaTexto = Math.hypot(tx[2], tx[3]) || 10;
      const escalaAncho = Math.hypot(tx[0], tx[1]) || 1;
      const anchoPorChar = item.str.length > 0 ? (item.width * escalaAncho) / item.str.length : 0;

      // Parte del ítem que realmente cae dentro del rango a resaltar (puede
      // ser el ítem completo, o solo su cola si el patrón empieza a mitad).
      const charsAntes = Math.max(0, offsetInicio - inicioItem);
      const strRelevante = item.str.slice(charsAntes);

      // Recortar espacios en blanco al inicio/fin para no pintar aire entre palabras.
      const trimInicio = strRelevante.length - strRelevante.trimStart().length;
      const strVisible = strRelevante.trim();
      if (strVisible.length === 0) continue; // ítem en blanco: nada que resaltar

      const x = tx[4] + (charsAntes + trimInicio) * anchoPorChar;
      const y = tx[5] - alturaTexto * 0.82;
      const ancho = strVisible.length * anchoPorChar;
      if (![x, y, ancho, alturaTexto].every(Number.isFinite)) continue;

      const anchoClamp = Math.min(Math.max(ancho, 2), 3000); // tope defensivo ante transforms atípicos

      // Fusionar con la caja anterior de la misma línea si están casi pegadas,
      // para dibujar una sola barra continua en vez de fragmentos con costuras.
      if (cajaActual && x - (cajaActual.x + cajaActual.width) < UMBRAL_FUSION) {
        cajaActual.width = Math.max(cajaActual.width, x + anchoClamp - cajaActual.x);
        cajaActual.height = Math.max(cajaActual.height, alturaTexto * 1.05);
      } else {
        cajaActual = { x, y, width: anchoClamp, height: alturaTexto * 1.05 };
        rects.push(cajaActual);
      }
    }
  }

  return rects;
}
