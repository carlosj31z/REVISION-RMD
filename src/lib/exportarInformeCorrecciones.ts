"use client";

/**
 * Arma y descarga un PDF con las correcciones detectadas en una revisión —
 * pensado para que el analista se lo pase a quien va a corregir en SAP sin
 * que tenga que abrir la app: cada hallazgo lleva su ubicación, la cita
 * exacta y una captura del PDF con el fragmento resaltado en amarillo (ver
 * capturarResaltadoPdf.ts), para identificar el punto de un vistazo.
 *
 * Deliberadamente NO incluye el resumen ejecutivo de la IA: el pedido fue
 * un listado accionable, no una narrativa.
 */

import { jsPDF } from "jspdf";
import type {
  ResultadoRevisionIA,
  ResultadoComparacionBorrador,
  DiscrepanciaDetectada,
  DiferenciaBorrador,
  AlertaCoherencia,
} from "@/types/rmd";
import { cargarDocumentoPdf, capturarResaltadoPagina, type SaltoCaptura } from "./capturarResaltadoPdf";

export interface ItemInformeCorreccion {
  etiquetaBadge: string; // "CRÍTICA" | "ALTA" | "CONFIANZA ALTA" | etc.
  colorBadge: [number, number, number]; // RGB 0-255
  tipoLabel: string;
  ubicacion: string;
  detalles: { label: string; valor: string }[];
  destino: SaltoCaptura | null;
}

const TIPO_DISCREPANCIA_LABEL: Record<DiscrepanciaDetectada["tipoDiscrepancia"], string> = {
  paso_debe_agregarse: "Falta un paso",
  paso_debe_eliminarse: "Paso a eliminar",
  paso_debe_modificarse: "Paso a modificar",
  equipo_debe_agregarse: "Falta un equipo",
  equipo_debe_eliminarse: "Equipo a retirar",
  termino_sin_homologar: "Término sin homologar",
  sin_discrepancia: "Sin discrepancia",
};

const TIPO_DIFERENCIA_LABEL: Record<DiferenciaBorrador["tipoDiferencia"], string> = {
  paso_agregado_en_borrador: "Paso nuevo en el borrador",
  paso_eliminado_en_borrador: "Paso ausente en el borrador",
  paso_modificado: "Paso modificado",
  paso_renumerado: "Paso renumerado",
  equipo_agregado: "Equipo agregado",
  equipo_eliminado: "Equipo eliminado",
  insumo_agregado: "Insumo agregado",
  insumo_eliminado: "Insumo eliminado",
  termino_sin_homologar: "Término sin homologar",
  sin_diferencia: "Sin diferencia",
};

const TIPO_ALERTA_LABEL: Record<AlertaCoherencia["tipo"], string> = {
  equipo_retirado_en_uso: "Equipo retirado en uso",
  paso_huerfano: "Paso huérfano",
  referencia_cruzada_rota: "Cita de paso rota",
  cantidad_insumo_no_cuadra: "Cantidad de insumo no cuadra",
  unidad_incoherente: "Unidad incoherente",
  condicion_ambiental_contradictoria: "Condición ambiental contradictoria",
  campo_control_faltante: "Campo de control faltante",
  documento_obsoleto_referenciado: "Documento obsoleto/vencido referenciado",
  equipo_sin_preparacion_registrada: "Equipo sin preparación registrada",
  nota_vb_faltante: "Nota de verificación presencial (VB) faltante",
  falla_redaccion: "Falla de redacción",
  otro: "Otro",
};

const COLOR_SEVERIDAD: Record<AlertaCoherencia["severidad"], [number, number, number]> = {
  critica: [200, 40, 45],
  alta: [205, 120, 20],
  media: [175, 140, 10],
  baja: [90, 100, 110],
};

const COLOR_CONFIANZA: Record<"alta" | "media" | "baja", [number, number, number]> = {
  alta: [40, 130, 90],
  media: [175, 140, 10],
  baja: [90, 100, 110],
};

function ubicacionDesdePasoSeccion(pasoId: string | null | undefined, seccionGeneral: string | null | undefined): string {
  if (pasoId && pasoId !== "N/A") return `Paso ${pasoId}`;
  if (seccionGeneral) return `Sección: ${etiquetaSeccion(seccionGeneral)}`;
  return "Sin ubicación puntual";
}

function etiquetaSeccion(s: string): string {
  const mapa: Record<string, string> = {
    precauciones: "Precauciones",
    notas_importantes: "Notas importantes durante el proceso",
    equipos_instrumentos: "Equipos / Instrumentos / Materiales",
    condiciones_ambientales: "Condiciones ambientales",
  };
  return mapa[s] ?? s;
}

export function itemsDesdeResultadoRevision(resultado: ResultadoRevisionIA): ItemInformeCorreccion[] {
  const items: ItemInformeCorreccion[] = [];

  for (const d of resultado.discrepanciasDetectadas) {
    if (d.tipoDiscrepancia === "sin_discrepancia") continue;
    const detalles: { label: string; valor: string }[] = [];
    if (d.textoVigenteEnRMD) detalles.push({ label: "Texto vigente en el RMD", valor: d.textoVigenteEnRMD });
    detalles.push({ label: "Qué exige el Control de Cambio", valor: d.queExigeElControlDeCambios });
    detalles.push({ label: "Justificación", valor: d.justificacion });
    if (d.equiposMencionados.length > 0) {
      detalles.push({ label: "Equipos mencionados", valor: d.equiposMencionados.join(", ") });
    }
    items.push({
      etiquetaBadge: `CONFIANZA ${d.nivelConfianza.toUpperCase()}`,
      colorBadge: COLOR_CONFIANZA[d.nivelConfianza],
      tipoLabel: TIPO_DISCREPANCIA_LABEL[d.tipoDiscrepancia],
      ubicacion: d.ubicacionReferencia || ubicacionDesdePasoSeccion(d.pasoId, d.seccionGeneral),
      detalles,
      destino: { pagina: 0, pasoId: d.pasoId, seccionGeneral: d.seccionGeneral, textoBuscado: d.textoVigenteEnRMD },
    });
  }

  items.push(...itemsDesdeAlertas(resultado.alertasCoherencia));
  return items;
}

export function itemsDesdeResultadoBorrador(resultado: ResultadoComparacionBorrador): ItemInformeCorreccion[] {
  const items: ItemInformeCorreccion[] = [];

  for (const d of resultado.diferenciasDetectadas) {
    if (d.tipoDiferencia === "sin_diferencia") continue;
    const detalles: { label: string; valor: string }[] = [];
    if (d.textoEnVigente) detalles.push({ label: "Texto en el RMD vigente", valor: d.textoEnVigente });
    if (d.textoEnBorrador) detalles.push({ label: "Texto en el borrador", valor: d.textoEnBorrador });
    detalles.push({ label: "Justificación", valor: d.justificacion });
    if (d.equiposMencionados.length > 0) {
      detalles.push({ label: "Equipos mencionados", valor: d.equiposMencionados.join(", ") });
    }
    if (d.origenAnotacionInformal) {
      detalles.push({
        label: "Origen",
        valor: "Leído de una anotación manuscrita o texto sobrepuesto — verificar contra el PDF original.",
      });
    }
    items.push({
      etiquetaBadge: `CONFIANZA ${d.nivelConfianza.toUpperCase()}`,
      colorBadge: COLOR_CONFIANZA[d.nivelConfianza],
      tipoLabel: TIPO_DIFERENCIA_LABEL[d.tipoDiferencia],
      ubicacion: d.ubicacionReferencia || ubicacionDesdePasoSeccion(d.pasoIdVigente, d.seccionGeneral),
      detalles,
      destino: { pagina: 0, pasoId: d.pasoIdVigente, seccionGeneral: d.seccionGeneral, textoBuscado: d.textoEnVigente },
    });
  }

  items.push(...itemsDesdeAlertas(resultado.alertasCoherencia));
  return items;
}

function itemsDesdeAlertas(alertas: AlertaCoherencia[]): ItemInformeCorreccion[] {
  return alertas.map((a) => ({
    etiquetaBadge: a.severidad.toUpperCase(),
    colorBadge: COLOR_SEVERIDAD[a.severidad],
    tipoLabel: TIPO_ALERTA_LABEL[a.tipo],
    ubicacion: ubicacionDesdePasoSeccion(a.pasoId, a.seccionGeneral) + (a.pasosAfectados.length > 0 ? ` (${a.pasosAfectados.join(", ")})` : ""),
    detalles: [{ label: "Detalle", valor: a.descripcion }],
    destino: { pagina: 0, pasoId: a.pasoId, seccionGeneral: a.seccionGeneral, textoBuscado: a.citaTextual },
  }));
}

const MARGEN = 15;
const ANCHO_UTIL = 210 - MARGEN * 2; // A4 mm
const ALTO_PAGINA = 297;

function resolverPagina(destino: SaltoCaptura | null, rmd: { procedimiento: { id: string; pagina?: number }[]; paginasSeccionesGenerales: Partial<Record<string, number>> }): SaltoCaptura | null {
  if (!destino) return null;
  if (destino.pasoId && destino.pasoId !== "N/A") {
    const paso = rmd.procedimiento.find((p) => p.id === destino.pasoId);
    if (paso?.pagina) return { ...destino, pagina: paso.pagina };
    return null;
  }
  if (destino.seccionGeneral) {
    const pagina = rmd.paginasSeccionesGenerales[destino.seccionGeneral];
    if (pagina) return { ...destino, pagina };
  }
  return null;
}

export interface OpcionesInforme {
  nombreArchivo: string;
  titulo: string; // ej. "Producto — CODIGO"
  subtitulo: string; // ej. "Control de Cambio · 12 correcciones"
  items: ItemInformeCorreccion[];
  archivoPdf: File;
  rmd: { procedimiento: { id: string; pagina?: number }[]; paginasSeccionesGenerales: Partial<Record<string, number>> };
  onProgreso?: (hecho: number, total: number) => void;
}

export async function generarInformeCorrecciones(opciones: OpcionesInforme): Promise<void> {
  const { nombreArchivo, titulo, subtitulo, items, archivoPdf, rmd, onProgreso } = opciones;
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(titulo, MARGEN, 22);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(100, 100, 100);
  doc.text(subtitulo, MARGEN, 29);
  doc.setFontSize(9);
  doc.text(`Generado el ${new Date().toLocaleString("es-PE")}`, MARGEN, 34);
  doc.setTextColor(0, 0, 0);

  let y = 42;

  // Cargado una sola vez: reutilizarlo por hallazgo evita re-parsear el PDF
  // entero una docena de veces (esa era la versión lenta).
  const docPdf = await cargarDocumentoPdf(archivoPdf);

  const asegurarEspacio = (alturaNecesaria: number) => {
    if (y + alturaNecesaria > ALTO_PAGINA - MARGEN) {
      doc.addPage();
      y = MARGEN;
    }
  };

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    onProgreso?.(i, items.length);

    asegurarEspacio(22);

    // Badge de severidad/confianza
    doc.setFillColor(...item.colorBadge);
    const anchoBadge = doc.getTextWidth(item.etiquetaBadge) + 6;
    doc.roundedRect(MARGEN, y, anchoBadge, 6, 1, 1, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");
    doc.text(item.etiquetaBadge, MARGEN + 3, y + 4.3);

    doc.setTextColor(20, 20, 20);
    doc.setFontSize(11.5);
    doc.text(item.tipoLabel, MARGEN + anchoBadge + 4, y + 4.3);
    y += 9;

    doc.setFont("helvetica", "italic");
    doc.setFontSize(10);
    doc.setTextColor(70, 70, 70);
    asegurarEspacio(6);
    doc.text(item.ubicacion, MARGEN, y);
    y += 6;

    doc.setFont("helvetica", "normal");
    doc.setTextColor(30, 30, 30);
    for (const det of item.detalles) {
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      asegurarEspacio(5);
      doc.text(`${det.label}:`, MARGEN, y);
      y += 4.5;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      const lineas = doc.splitTextToSize(det.valor, ANCHO_UTIL);
      for (const linea of lineas) {
        asegurarEspacio(4.6);
        doc.text(linea, MARGEN, y);
        y += 4.6;
      }
      y += 1.5;
    }

    // Captura resaltada del PDF, si el hallazgo tiene un punto localizable.
    const destinoConPagina = resolverPagina(item.destino, rmd);
    if (destinoConPagina) {
      const captura = await capturarResaltadoPagina(docPdf, destinoConPagina);
      if (captura) {
        const anchoImg = ANCHO_UTIL * 0.85;
        const altoImg = (captura.height / captura.width) * anchoImg;
        const altoMax = 110; // no dejar que una captura muy alta domine la página
        const escalaExtra = altoImg > altoMax ? altoMax / altoImg : 1;
        const wFinal = anchoImg * escalaExtra;
        const hFinal = altoImg * escalaExtra;
        asegurarEspacio(hFinal + 6);
        doc.setDrawColor(220, 220, 220);
        doc.rect(MARGEN, y, wFinal + 2, hFinal + 2);
        doc.addImage(captura.dataUrl, "JPEG", MARGEN + 1, y + 1, wFinal, hFinal);
        y += hFinal + 8;
      }
    }

    y += 3;
    if (i < items.length - 1) {
      asegurarEspacio(4);
      doc.setDrawColor(230, 230, 230);
      doc.line(MARGEN, y, 210 - MARGEN, y);
      y += 6;
    }
  }

  onProgreso?.(items.length, items.length);
  doc.save(nombreArchivo);
}
