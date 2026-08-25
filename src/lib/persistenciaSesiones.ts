"use client";

/**
 * Persistencia de las revisiones abiertas en IndexedDB — guarda tanto los
 * PDF originales (como File, IndexedDB los soporta nativamente vía
 * structured clone) como el resto del estado de cada sesión, para que
 * sobrevivan a algo más que una simple invalidación de blob URL:
 *
 * El fix anterior (regenerar la blob URL desde el File cuando pdf.js
 * reporta "Unexpected server response (0)") sólo alcanza mientras la
 * PESTAÑA sigue viva en memoria. Si el navegador la tiene mucho tiempo en
 * segundo plano bajo presión de memoria, puede llegar a DESCARTARLA por
 * completo (no sólo el blob: toda la página se recarga desde cero al
 * volver) — ahí ya no hay ningún File en memoria del que regenerar nada,
 * porque el estado de React entero se perdió. IndexedDB sobrevive a eso: es
 * disco, no memoria de la pestaña.
 *
 * Vive fuera de page.tsx a propósito (mismo criterio que resaltadoPdf.ts):
 * lógica de storage aislada, sin JSX, más fácil de razonar y de probar.
 */

import type { SesionRevision, VistaResultado } from "@/app/page";

const DB_NOMBRE = "rmd-reviewer-sesiones";
const DB_VERSION = 1;
const STORE = "sesiones";

function abrirDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NOMBRE, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Los blob: URL (pdfUrl/pdfBorradorUrl/pdfReferenciaUrl) no sobreviven a un
// recargado ni tienen sentido guardados — se regeneran desde el File al
// leer (ver reconstruirVista). Todo lo demás de la vista viaja tal cual:
// es JSON plano salvo por los File, que IndexedDB clona nativamente.
function quitarBlobUrls(vista: VistaResultado): any {
  const { pdfUrl, ...resto } = vista as any;
  if (resto.pdfBorradorUrl !== undefined) delete resto.pdfBorradorUrl;
  if (resto.pdfReferenciaUrl !== undefined) delete resto.pdfReferenciaUrl;
  return resto;
}

function reconstruirVista(vistaGuardada: any): VistaResultado {
  const vista = { ...vistaGuardada, pdfUrl: URL.createObjectURL(vistaGuardada.archivoVigente) };
  if (vista.tipo === "resultado-borrador" && vista.archivoBorrador) {
    vista.pdfBorradorUrl = URL.createObjectURL(vista.archivoBorrador);
  }
  if (vista.tipo === "resultado-referencia") {
    vista.pdfReferenciaUrl = URL.createObjectURL(vista.archivoReferencia);
  }
  return vista as VistaResultado;
}

/** Guarda (o actualiza) una sesión completa — se llama en cada cambio real
 *  de `sesiones` en page.tsx, no sólo al crearla. */
export async function guardarSesion(sesion: SesionRevision): Promise<void> {
  try {
    const db = await abrirDB();
    const registro = { ...sesion, vista: quitarBlobUrls(sesion.vista) };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(registro);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    // No bloquea la app: si falla (modo incógnito con storage deshabilitado,
    // cuota de disco agotada, etc.) la sesión sigue funcionando en memoria
    // como antes, sólo que sin la red de seguridad extra.
    console.error("No se pudo guardar la sesión en IndexedDB:", err);
  }
}

export async function eliminarSesion(id: string): Promise<void> {
  try {
    const db = await abrirDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.error("No se pudo eliminar la sesión de IndexedDB:", err);
  }
}

/** Se llama una sola vez al montar la app: recupera todas las sesiones
 *  guardadas y regenera sus blob URL a partir de los File persistidos. */
export async function cargarSesionesGuardadas(): Promise<SesionRevision[]> {
  try {
    const db = await abrirDB();
    const registros = await new Promise<any[]>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();

    const sesiones: SesionRevision[] = [];
    for (const registro of registros) {
      try {
        sesiones.push({ ...registro, vista: reconstruirVista(registro.vista) });
      } catch (err) {
        // Un registro individual corrupto no debe tirar abajo el resto de
        // las sesiones recuperadas.
        console.error("No se pudo reconstruir una sesión guardada:", err);
      }
    }
    return sesiones.sort((a, b) => a.creadaEn - b.creadaEn);
  } catch (err) {
    console.error("No se pudieron cargar las sesiones guardadas de IndexedDB:", err);
    return [];
  }
}
