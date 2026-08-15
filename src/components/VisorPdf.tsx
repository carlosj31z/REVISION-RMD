"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

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
}

interface RectanguloResaltado {
  x: number;
  y: number;
  width: number;
  height: number;
  // true  = fragmento exacto señalado por el análisis (resaltado fuerte)
  // false = resto del paso, sólo contexto (amarillo suave)
  foco: boolean;
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

        const rects = await calcularRectangulosResaltado(
          page,
          viewport,
          salto.pasoId,
          salto.textoBuscado ?? undefined
        );
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
        console.error("Error resaltando el paso en el PDF:", err);
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [salto, pdfDoc]);

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

// Ítem de texto del PDF ya convertido a coordenadas de canvas.
interface ItemUbicado {
  str: string;
  x: number; // borde izquierdo, en px de canvas
  yBase: number; // línea base (baseline), en px de canvas
  ancho: number; // ancho real del ítem, en px de canvas
  alto: number; // alto de la fuente, en px de canvas
  ascent: number; // px por encima de la baseline
  fontFamily: string;
}

// Canvas de medición reutilizado: sirve para repartir el ancho REAL de un
// ítem entre sus caracteres respetando las proporciones de una fuente
// proporcional (una "M" ocupa más que una "i"), en vez de asumir que todos
// los caracteres miden lo mismo.
let ctxMedicion: CanvasRenderingContext2D | null | undefined;
function obtenerMedidor(): CanvasRenderingContext2D | null {
  if (ctxMedicion === undefined) {
    ctxMedicion = document.createElement("canvas").getContext("2d");
  }
  return ctxMedicion;
}

/**
 * Fracción [0..1] del ancho del ítem que ocupan sus primeros `n` caracteres.
 * Se normaliza contra el ancho medido del string completo, así que sólo
 * importan las proporciones relativas entre caracteres: aunque la fuente que
 * mide el navegador no sea idéntica a la del PDF, el resultado se escala
 * después al ancho real del ítem y el error queda mínimo.
 */
function fraccionAncho(item: ItemUbicado, n: number): number {
  if (n <= 0) return 0;
  if (n >= item.str.length) return 1;
  const ctx = obtenerMedidor();
  if (!ctx) return n / item.str.length; // sin canvas: reparto uniforme
  ctx.font = `${item.alto}px ${item.fontFamily}`;
  const total = ctx.measureText(item.str).width;
  if (!(total > 0)) return n / item.str.length;
  return ctx.measureText(item.str.slice(0, n)).width / total;
}

// Marcas diacríticas combinantes (los acentos que deja NFD al separarlos).
const DIACRITICOS = /[̀-ͯ]/g;

/**
 * Normaliza texto para comparar (mayúsculas, sin acentos, espacios
 * colapsados) devolviendo además el mapa de índices hacia el texto original,
 * para poder traducir una coincidencia de vuelta a posiciones reales.
 */
function normalizarConMapa(texto: string): { normalizado: string; mapa: number[] } {
  const chars: string[] = [];
  const mapa: number[] = [];
  let veniaEspacio = true; // arranca en true para descartar espacios iniciales
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (/\s/.test(c)) {
      if (!veniaEspacio) {
        chars.push(" ");
        mapa.push(i);
        veniaEspacio = true;
      }
      continue;
    }
    const base = c.normalize("NFD").replace(DIACRITICOS, "") || c;
    chars.push(base[0].toUpperCase());
    mapa.push(i);
    veniaEspacio = false;
  }
  return { normalizado: chars.join(""), mapa };
}

/**
 * Calcula los rectángulos de resaltado, en coordenadas de canvas, para un
 * paso del procedimiento:
 *
 *  - Resalta el paso COMPLETO (desde "<pasoId>.-" hasta el siguiente paso
 *    numerado), sin cortarlo a unas pocas líneas.
 *  - Si se pasa `textoBuscado` (la cita textual que el análisis marcó como
 *    observada) y se encuentra dentro del paso, ese fragmento se devuelve
 *    con `foco: true` para resaltarlo fuerte, y el resto del paso queda como
 *    contexto suave. Si no se encuentra, todo el paso va con `foco: true`.
 */
async function calcularRectangulosResaltado(
  page: PDFPageProxy,
  viewport: { transform: number[]; scale: number },
  pasoId: string,
  textoBuscado?: string
): Promise<RectanguloResaltado[]> {
  const pdfjsLib = await import("pdfjs-dist");
  const contenido = await page.getTextContent();
  const estilos: Record<string, { fontFamily?: string; ascent?: number }> =
    (contenido as any).styles ?? {};

  const items: ItemUbicado[] = [];
  for (const crudo of contenido.items as any[]) {
    if (typeof crudo?.str !== "string" || crudo.str.length === 0) continue;
    const tx = pdfjsLib.Util.transform(viewport.transform, crudo.transform);
    const alto = Math.hypot(tx[2], tx[3]) || 10;
    const estilo = estilos[crudo.fontName] ?? {};
    // pdf.js expone el ascent real de la fuente (0..1). 0.8 es su mismo
    // fallback cuando no hay dato.
    const factorAscent =
      typeof estilo.ascent === "number" && estilo.ascent > 0 && estilo.ascent < 1
        ? estilo.ascent
        : 0.8;
    // Ancho REAL: item.width viene en unidades de usuario del PDF, así que
    // sólo hay que multiplicarlo por la escala del viewport — es exactamente
    // lo que hace la capa de texto oficial de pdf.js (canvasWidth * scale).
    // Multiplicarlo además por Math.hypot(tx[0],tx[1]) —que YA incluye el
    // tamaño de fuente— lo inflaba ~10x y hacía que el resaltado se saliera
    // del margen de la hoja.
    const ancho = (crudo.width ?? 0) * viewport.scale;
    if (![tx[4], tx[5], ancho, alto].every(Number.isFinite)) continue;
    items.push({
      str: crudo.str,
      x: tx[4],
      yBase: tx[5],
      ancho,
      alto,
      ascent: alto * factorAscent,
      fontFamily: estilo.fontFamily ?? "sans-serif",
    });
  }
  if (items.length === 0) return [];

  // Agrupar en líneas físicas por baseline (con tolerancia de subpíxel) y
  // ordenar cada una de izquierda a derecha, para reconstruir el orden de
  // lectura real del documento.
  const TOLERANCIA_Y = 2.5;
  const lineas: { y: number; items: ItemUbicado[] }[] = [];
  for (const it of items) {
    let linea = lineas.find((l) => Math.abs(l.y - it.yBase) < TOLERANCIA_Y);
    if (!linea) {
      linea = { y: it.yBase, items: [] };
      lineas.push(linea);
    }
    linea.items.push(it);
  }
  for (const l of lineas) l.items.sort((a, b) => a.x - b.x);
  lineas.sort((a, b) => a.y - b.y);

  const patron = `${pasoId}.-`;
  const idxInicio = lineas.findIndex((l) => l.items.map((i) => i.str).join("").includes(patron));
  if (idxInicio === -1) return [];

  // Fin del paso: la siguiente línea que arranca con OTRO paso numerado.
  // Sin tope artificial de líneas — el paso se resalta entero.
  const patronNuevoPaso = /^\d+\.\d+(?:\.\d+)?\.-/;
  const MAX_LINEAS_SEGURIDAD = 40; // sólo para no desbocarse ante un PDF atípico
  let idxFin = lineas.length;
  for (let i = idxInicio + 1; i < lineas.length && i < idxInicio + MAX_LINEAS_SEGURIDAD; i++) {
    const textoLinea = lineas[i].items.map((it) => it.str).join("").trim();
    if (patronNuevoPaso.test(textoLinea)) {
      idxFin = i;
      break;
    }
    idxFin = i + 1;
  }

  // Aplanar el paso a una secuencia de caracteres, cada uno sabiendo de qué
  // ítem viene y en qué offset — así cualquier rango de texto se traduce a
  // rectángulos con la misma lógica.
  type Caracter = { item: ItemUbicado; offset: number };
  const caracteres: Caracter[] = [];
  let textoPaso = "";
  for (let i = idxInicio; i < idxFin; i++) {
    for (const item of lineas[i].items) {
      for (let k = 0; k < item.str.length; k++) {
        caracteres.push({ item, offset: k });
        textoPaso += item.str[k];
      }
    }
    // Separador entre líneas (no pertenece a ningún ítem: se omite al pintar).
    caracteres.push({ item: null as unknown as ItemUbicado, offset: -1 });
    textoPaso += " ";
  }

  // El resaltado arranca en el "<pasoId>.-", no antes (la línea puede traer
  // texto de otra columna a la izquierda).
  const desdePaso = Math.max(0, textoPaso.indexOf(patron));

  // Ubicar el fragmento exacto señalado por el análisis dentro del paso.
  let rangoFoco: { desde: number; hasta: number } | null = null;
  if (textoBuscado && textoBuscado.trim().length >= 4) {
    const paso = normalizarConMapa(textoPaso);
    const buscado = normalizarConMapa(textoBuscado);
    if (buscado.normalizado.length >= 4) {
      let pos = paso.normalizado.indexOf(buscado.normalizado);
      // Si la cita completa no aparece (el modelo suele citar de más o
      // reformatear), se prueba con un prefijo significativo.
      if (pos === -1 && buscado.normalizado.length > 24) {
        pos = paso.normalizado.indexOf(buscado.normalizado.slice(0, 24));
      }
      if (pos !== -1) {
        const largo = Math.min(
          buscado.normalizado.length,
          paso.normalizado.length - pos
        );
        const desde = paso.mapa[pos];
        const hasta = (paso.mapa[pos + largo - 1] ?? paso.mapa[paso.mapa.length - 1]) + 1;
        if (Number.isFinite(desde) && Number.isFinite(hasta) && hasta > desde) {
          rangoFoco = { desde, hasta };
        }
      }
    }
  }

  const UMBRAL_FUSION = 4; // px: huecos menores se fusionan en una barra continua

  const rectsDeRango = (desde: number, hasta: number, foco: boolean): RectanguloResaltado[] => {
    // Agrupar caracteres consecutivos que pertenecen al mismo ítem.
    const segmentos: { item: ItemUbicado; ini: number; fin: number }[] = [];
    for (let i = desde; i < hasta && i < caracteres.length; i++) {
      const c = caracteres[i];
      if (!c || !c.item || c.offset < 0) continue; // separador de línea
      const ultimo = segmentos[segmentos.length - 1];
      if (ultimo && ultimo.item === c.item && ultimo.fin === c.offset) {
        ultimo.fin = c.offset + 1;
      } else {
        segmentos.push({ item: c.item, ini: c.offset, fin: c.offset + 1 });
      }
    }

    const salida: RectanguloResaltado[] = [];
    for (const seg of segmentos) {
      // Recortar espacios de los extremos para no pintar aire suelto.
      let ini = seg.ini;
      let fin = seg.fin;
      while (ini < fin && /\s/.test(seg.item.str[ini])) ini++;
      while (fin > ini && /\s/.test(seg.item.str[fin - 1])) fin--;
      if (fin <= ini) continue;

      const x0 = seg.item.x + seg.item.ancho * fraccionAncho(seg.item, ini);
      const x1 = seg.item.x + seg.item.ancho * fraccionAncho(seg.item, fin);
      const y = seg.item.yBase - seg.item.ascent;
      const ancho = x1 - x0;
      if (![x0, y, ancho].every(Number.isFinite) || ancho <= 0) continue;

      const anterior = salida[salida.length - 1];
      // Fusionar sólo dentro de la misma línea (misma baseline).
      if (
        anterior &&
        Math.abs(anterior.y - y) < TOLERANCIA_Y &&
        x0 - (anterior.x + anterior.width) < UMBRAL_FUSION
      ) {
        anterior.width = Math.max(anterior.width, x1 - anterior.x);
        anterior.height = Math.max(anterior.height, seg.item.alto * 1.15);
      } else {
        salida.push({
          x: x0,
          y,
          width: Math.max(ancho, 2),
          height: seg.item.alto * 1.15,
          foco,
        });
      }
    }
    return salida;
  };

  if (!rangoFoco) {
    // Sin fragmento puntual: se resalta el paso entero con intensidad normal.
    return rectsDeRango(desdePaso, caracteres.length, true);
  }

  // Con fragmento: el paso entero queda como contexto suave y el fragmento
  // señalado se dibuja encima con intensidad fuerte.
  return [
    ...rectsDeRango(desdePaso, caracteres.length, false),
    ...rectsDeRango(rangoFoco.desde, rangoFoco.hasta, true),
  ];
}
