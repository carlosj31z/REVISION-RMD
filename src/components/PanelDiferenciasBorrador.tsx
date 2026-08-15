"use client";

import { useState } from "react";
import type {
  ResultadoComparacionBorrador,
  DiferenciaBorrador,
  DocumentoReferenciado,
  AlertaCoherencia,
  DestinoPdf,
} from "@/types/rmd";
import { BadgeSeveridad, BadgeConfianza, BadgeEstado, BadgeVerificacion, BORDE_ESTADO } from "./Badges";
import { DocumentosReferenciados } from "./DocumentosReferenciados";
import { ResumenEjecutivo } from "./ResumenEjecutivo";

type EstadoSeguimiento = "pendiente" | "corregido_en_sap" | "descartado";
type Verificacion = { resuelto: boolean; justificacion: string };

interface Props {
  resultado: ResultadoComparacionBorrador;
  documentosReferenciados: DocumentoReferenciado[];
  pasoResaltado: string | null;
  onHoverPaso: (pasoId: string | null) => void;
  onIrAPaso: (destino: DestinoPdf) => void;
  estadosSeguimiento: Record<string, EstadoSeguimiento>;
  onCambiarEstado: (pasoId: string, estado: EstadoSeguimiento) => void;
  verificacionCorreccion: Record<string, Verificacion>;
}

const TIPO_LABEL: Record<DiferenciaBorrador["tipoDiferencia"], string> = {
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

// Misma clave para render, seguimiento y verificación (ver claveDiscrepancia
// en PanelDiscrepancias.tsx): se desambigua con el índice DEL ARRAY
// COMPLETO, el mismo que usa subirRmdCorregido en page.tsx.
function claveDiferencia(d: DiferenciaBorrador, indiceCompleto: number): string {
  return d.pasoIdVigente ?? d.pasoIdBorrador ?? `sin-paso-${indiceCompleto}`;
}

const TIPO_ALERTA_LABEL: Record<AlertaCoherencia["tipo"], string> = {
  equipo_retirado_en_uso: "Equipo retirado en uso",
  paso_huerfano: "Paso huérfano",
  referencia_cruzada_rota: "Cita de paso rota",
  cantidad_insumo_no_cuadra: "Cantidad de insumo no cuadra",
  unidad_incoherente: "Unidad incoherente",
  condicion_ambiental_contradictoria: "Condición ambiental contradictoria",
  campo_control_faltante: "Campo de control faltante",
  documento_obsoleto_referenciado: "Documento obsoleto referenciado",
  otro: "Otro",
};

export function PanelDiferenciasBorrador({
  resultado,
  documentosReferenciados,
  pasoResaltado,
  onHoverPaso,
  onIrAPaso,
  estadosSeguimiento,
  onCambiarEstado,
  verificacionCorreccion,
}: Props) {
  const diferenciasReales = resultado.diferenciasDetectadas.filter(
    (d) => d.tipoDiferencia !== "sin_diferencia"
  );
  const verificaciones = Object.values(verificacionCorreccion);
  const totalCorregidas = verificaciones.filter((v) => v.resuelto).length;

  // Score en vivo: arranca en el % de coincidencia que calculó la IA y se
  // acerca a 100 en proporción a cuántas diferencias ya están marcadas
  // "Corregido en SAP" — a mano o automáticamente al subir el RMD corregido.
  const corregidosEnSap = resultado.diferenciasDetectadas.filter((d, i) => {
    if (d.tipoDiferencia === "sin_diferencia") return false;
    return estadosSeguimiento[claveDiferencia(d, i)] === "corregido_en_sap";
  }).length;
  const scoreActual =
    diferenciasReales.length === 0
      ? resultado.coincidenciaPorcentaje
      : resultado.coincidenciaPorcentaje +
        (corregidosEnSap / diferenciasReales.length) * (100 - resultado.coincidenciaPorcentaje);

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="material-chrome-white z-10 border-b border-line/70 px-5 py-4 shadow-soft">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
          Diferencias vs. borrador de Producción
        </p>
        <div className="mt-1.5 flex items-center gap-3">
          <ScoreCoincidencia scoreActual={scoreActual} scoreOriginal={resultado.coincidenciaPorcentaje} />
          <span className="text-[12px] text-muted">
            {diferenciasReales.length} diferencia
            {diferenciasReales.length !== 1 ? "s" : ""} detectada
            {diferenciasReales.length !== 1 ? "s" : ""}
          </span>
        </div>
        {verificaciones.length > 0 && (
          <p className="mt-2 text-[12px] text-muted">
            Última verificación: <span className="font-medium text-system">{totalCorregidas} corregidas</span>
            {" · "}
            <span className="font-medium text-severidad-alta">
              {verificaciones.length - totalCorregidas} pendientes
            </span>
          </p>
        )}
        {resultado.requiereRevisionHumana && (
          <p className="mt-2 rounded-lg border border-severidad-alta/30 bg-severidad-altaTint px-2.5 py-1.5 text-[12px] text-severidad-alta">
            Este resultado requiere tu revisión directa: el modelo señaló ambigüedad.
          </p>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <ResumenEjecutivo texto={resultado.resumenEjecutivo} />

        <DocumentosReferenciados documentos={documentosReferenciados} />

        {resultado.alertasCoherencia.length > 0 && (
          <div className="mb-5 space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              Alertas de coherencia
            </h3>
            {resultado.alertasCoherencia.map((alerta, i) => (
              <div
                key={i}
                className="animate-fade-in-up rounded-lg border border-line bg-white px-3 py-2.5 transition-shadow duration-200 hover:shadow-soft"
                style={{ animationDelay: `${Math.min(i, 6) * 30}ms` }}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <BadgeSeveridad severidad={alerta.severidad} />
                    <span className="text-[11px] font-medium text-muted">
                      {TIPO_ALERTA_LABEL[alerta.tipo]}
                    </span>
                  </div>
                  {alerta.pasosAfectados.length > 0 && (
                    <span className="font-mono text-[11px] text-muted">
                      {alerta.pasosAfectados.join(", ")}
                    </span>
                  )}
                </div>
                <p className="text-[13px] leading-snug text-ink/80">{alerta.descripcion}</p>
              </div>
            ))}
          </div>
        )}

        {diferenciasReales.length === 0 ? (
          <div className="animate-scale-in rounded-lg border border-dashed border-line bg-white px-4 py-10 text-center">
            <span className="mx-auto mb-2.5 flex h-9 w-9 items-center justify-center rounded-full bg-system-tint text-system">
              <IconoCheck />
            </span>
            <p className="text-[13px] text-muted">
              No se detectaron diferencias entre el RMD vigente y el borrador de Producción.
            </p>
          </div>
        ) : (
          <ol className="space-y-2.5">
            {resultado.diferenciasDetectadas.map((d, i) => {
              if (d.tipoDiferencia === "sin_diferencia") return null;
              const pasoClave = claveDiferencia(d, i);
              return (
                <TarjetaDiferencia
                  key={`${pasoClave}-${i}`}
                  diferencia={d}
                  activo={pasoResaltado !== null && pasoResaltado === pasoClave}
                  onHover={() => onHoverPaso(pasoClave)}
                  onLeave={() => onHoverPaso(null)}
                  onIrAPaso={() => onIrAPaso({ pasoId: d.pasoIdVigente, seccionGeneral: d.seccionGeneral })}
                  estado={estadosSeguimiento[pasoClave] ?? "pendiente"}
                  onCambiarEstado={(estado) => onCambiarEstado(pasoClave, estado)}
                  retraso={Math.min(i, 8) * 25}
                  verificacion={verificacionCorreccion[pasoClave]}
                />
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

function ScoreCoincidencia({ scoreActual, scoreOriginal }: { scoreActual: number; scoreOriginal: number }) {
  const redondeado = Math.round(scoreActual);
  const color =
    redondeado >= 80 ? "text-system" : redondeado >= 50 ? "text-severidad-alta" : "text-severidad-critica";
  return (
    <div className="flex items-baseline gap-1.5">
      <span
        key={redondeado}
        className={`animate-scale-in font-mono text-2xl font-semibold tabular-nums transition-colors duration-300 ${color}`}
      >
        {redondeado}
      </span>
      <span className="text-[11px] text-muted">% de coincidencia</span>
      {redondeado !== Math.round(scoreOriginal) && (
        <span className="text-[11px] text-muted/70">(inicial: {Math.round(scoreOriginal)})</span>
      )}
    </div>
  );
}

function TarjetaDiferencia({
  diferencia,
  activo,
  onHover,
  onLeave,
  onIrAPaso,
  estado,
  onCambiarEstado,
  retraso,
  verificacion,
}: {
  diferencia: DiferenciaBorrador;
  activo: boolean;
  onHover: () => void;
  onLeave: () => void;
  onIrAPaso: () => void;
  estado: EstadoSeguimiento;
  onCambiarEstado: (estado: EstadoSeguimiento) => void;
  retraso: number;
  verificacion?: Verificacion;
}) {
  const [expandido, setExpandido] = useState(false);

  return (
    <li
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      onClick={onIrAPaso}
      title="Ver en el PDF"
      style={{ animationDelay: `${retraso}ms` }}
      className={`group animate-fade-in-up cursor-pointer rounded-lg border bg-white px-3.5 py-3 shadow-soft transition-all duration-200 ease-spring hover:shadow-elevated ${BORDE_ESTADO[estado]} ${
        activo ? "border-system shadow-elevated" : "border-line"
      } ${diferencia.involucraEquipoRetirado ? "ring-1 ring-severidad-critica/40" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded font-mono text-[12px] font-semibold text-system transition-colors group-hover:underline">
            {diferencia.pasoIdVigente ?? diferencia.pasoIdBorrador ?? "—"}
            {diferencia.pasoIdVigente &&
            diferencia.pasoIdBorrador &&
            diferencia.pasoIdBorrador !== diferencia.pasoIdVigente
              ? ` → ${diferencia.pasoIdBorrador}`
              : ""}
          </span>
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
            {TIPO_LABEL[diferencia.tipoDiferencia]}
          </span>
        </div>
        <BadgeConfianza nivel={diferencia.nivelConfianza} />
      </div>

      <p className="mt-1.5 text-[13px] leading-snug text-ink/80">{diferencia.ubicacionReferencia}</p>

      {diferencia.involucraEquipoRetirado && (
        <p className="mt-2 rounded-lg border border-severidad-critica/30 bg-severidad-criticaTint px-2 py-1.5 text-[12px] font-medium text-severidad-critica">
          ⚠ Involucra un equipo marcado como retirado en el maestro de equipos.
        </p>
      )}

      {diferencia.origenAnotacionInformal && (
        <p className="mt-2 rounded-lg border border-severidad-media/30 bg-severidad-mediaTint px-2 py-1.5 text-[12px] font-medium text-severidad-media">
          ✎ Leído de una anotación manuscrita o texto sobrepuesto — verifica contra el PDF original.
        </p>
      )}

      <button
        onClick={(e) => {
          e.stopPropagation();
          setExpandido((v) => !v);
        }}
        className="mt-2 flex items-center gap-1 text-[12px] font-medium text-system hover:underline"
      >
        <IconoChevron abierto={expandido} />
        {expandido ? "Ocultar detalle" : "Ver detalle y cita de ambos documentos"}
      </button>

      <div
        className={`grid transition-all duration-300 ease-spring ${
          expandido ? "mt-2 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div className="space-y-2 border-t border-line pt-2.5">
            {diferencia.textoEnVigente && (
              <DetalleCampo label="Texto en el RMD vigente" valor={diferencia.textoEnVigente} />
            )}
            {diferencia.textoEnBorrador && (
              <DetalleCampo label="Texto en el borrador" valor={diferencia.textoEnBorrador} />
            )}
            <DetalleCampo label="Justificación" valor={diferencia.justificacion} />
            {diferencia.equiposMencionados.length > 0 && (
              <DetalleCampo
                label="Equipos mencionados"
                valor={diferencia.equiposMencionados.join(", ")}
                mono
              />
            )}
          </div>
        </div>
      </div>

      <div
        onClick={(e) => e.stopPropagation()}
        className="mt-3 flex items-center gap-2 border-t border-line pt-2.5"
      >
        <BadgeEstado estado={estado} />
        {verificacion && (
          <BadgeVerificacion resuelto={verificacion.resuelto} justificacion={verificacion.justificacion} />
        )}
        <div className="ml-auto flex gap-1">
          <BotonEstado
            label="Corregido en SAP"
            activo={estado === "corregido_en_sap"}
            onClick={() => onCambiarEstado(estado === "corregido_en_sap" ? "pendiente" : "corregido_en_sap")}
          />
          <BotonEstado
            label="Descartar"
            activo={estado === "descartado"}
            onClick={() => onCambiarEstado(estado === "descartado" ? "pendiente" : "descartado")}
          />
        </div>
      </div>
    </li>
  );
}

function DetalleCampo({ label, valor, mono }: { label: string; valor: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-0.5 text-[12.5px] leading-snug text-ink/80 ${mono ? "font-mono" : ""}`}>
        {valor}
      </p>
    </div>
  );
}

function BotonEstado({
  label,
  activo,
  onClick,
}: {
  label: string;
  activo: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={activo ? `Quitar marca de "${label}"` : label}
      className={`rounded border px-2 py-1 text-[11px] font-medium transition-all duration-150 ease-spring active:scale-95 ${
        activo
          ? "border-system bg-system text-white"
          : "border-line bg-white text-muted hover:border-system hover:text-system"
      }`}
    >
      {label}
    </button>
  );
}

function IconoChevron({ abierto }: { abierto: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 transition-transform duration-200 ease-spring ${abierto ? "rotate-90" : ""}`}
      aria-hidden="true"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function IconoCheck() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
