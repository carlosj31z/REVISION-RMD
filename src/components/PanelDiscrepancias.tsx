"use client";

import { useState } from "react";
import type {
  ResultadoRevisionIA,
  DiscrepanciaDetectada,
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
  resultado: ResultadoRevisionIA;
  documentosReferenciados: DocumentoReferenciado[];
  pasoResaltado: string | null;
  onHoverPaso: (pasoId: string | null) => void;
  onIrAPaso: (destino: DestinoPdf) => void;
  estadosSeguimiento: Record<string, EstadoSeguimiento>;
  onCambiarEstado: (pasoId: string, estado: EstadoSeguimiento) => void;
  verificacionCorreccion: Record<string, Verificacion>;
}

const TIPO_LABEL: Record<DiscrepanciaDetectada["tipoDiscrepancia"], string> = {
  paso_debe_agregarse: "Falta un paso",
  paso_debe_eliminarse: "Paso a eliminar",
  paso_debe_modificarse: "Paso a modificar",
  equipo_debe_agregarse: "Falta un equipo",
  equipo_debe_eliminarse: "Equipo a retirar",
  termino_sin_homologar: "Término sin homologar",
  sin_discrepancia: "Sin discrepancia",
};

// Misma clave para render, seguimiento y verificación: "N/A" se repite en
// cualquier hallazgo que no sea un paso puntual (precauciones, notas
// importantes, equipos, encabezado, insumos...), así que se desambigua con
// el índice DEL ARRAY COMPLETO (no del filtrado) — es el mismo criterio que
// usa subirRmdCorregido en page.tsx al mapear la verificación de vuelta a
// cada tarjeta; si difirieran, la verificación automática apuntaría a la
// tarjeta equivocada.
function claveDiscrepancia(d: DiscrepanciaDetectada, indiceCompleto: number): string {
  return d.pasoId !== "N/A" ? d.pasoId : `na-${indiceCompleto}`;
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
  equipo_sin_preparacion_registrada: "Equipo sin preparación registrada",
  nota_vb_faltante: "Nota de verificación presencial (VB) faltante",
  otro: "Otro",
};

export function PanelDiscrepancias({
  resultado,
  documentosReferenciados,
  pasoResaltado,
  onHoverPaso,
  onIrAPaso,
  estadosSeguimiento,
  onCambiarEstado,
  verificacionCorreccion,
}: Props) {
  const discrepanciasReales = resultado.discrepanciasDetectadas.filter(
    (d) => d.tipoDiscrepancia !== "sin_discrepancia"
  );
  const verificaciones = Object.values(verificacionCorreccion);
  const totalCorregidas = verificaciones.filter((v) => v.resuelto).length;

  // Score en vivo: arranca en el que calculó la IA en el análisis original y
  // se acerca a 100 en proporción a cuántos hallazgos ya están marcados
  // "Corregido en SAP" — a mano o automáticamente al subir el RMD corregido.
  const corregidosEnSap = resultado.discrepanciasDetectadas.filter((d, i) => {
    if (d.tipoDiscrepancia === "sin_discrepancia") return false;
    return estadosSeguimiento[claveDiscrepancia(d, i)] === "corregido_en_sap";
  }).length;
  const scoreActual =
    discrepanciasReales.length === 0
      ? resultado.scoreCoherencia
      : resultado.scoreCoherencia +
        (corregidosEnSap / discrepanciasReales.length) * (100 - resultado.scoreCoherencia);

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="material-chrome-white z-10 border-b border-line/70 px-4 py-3.5 shadow-soft sm:px-5 sm:py-4">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
          Hallazgos del control de cambios
        </p>
        <div className="mt-1.5 flex items-center gap-3">
          <ScoreCoherencia scoreActual={scoreActual} scoreOriginal={resultado.scoreCoherencia} />
          <span className="text-[12px] text-muted">
            {discrepanciasReales.length} discrepancia
            {discrepanciasReales.length !== 1 ? "s" : ""} detectada
            {discrepanciasReales.length !== 1 ? "s" : ""}
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

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-24 sm:px-5 lg:pb-4">
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
                className="animate-fade-in-up rounded-lg border border-line bg-surface px-3 py-2.5 transition-shadow duration-200 hover:shadow-soft"
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

        {discrepanciasReales.length === 0 ? (
          <div className="animate-scale-in rounded-lg border border-dashed border-line bg-surface px-4 py-10 text-center">
            <span className="mx-auto mb-2.5 flex h-9 w-9 items-center justify-center rounded-full bg-system-tint text-system">
              <IconoCheck />
            </span>
            <p className="text-[13px] text-muted">
              No se detectaron discrepancias entre el RMD vigente y el Control de Cambio.
            </p>
          </div>
        ) : (
          <ol className="space-y-2.5">
            {resultado.discrepanciasDetectadas.map((d, i) => {
              if (d.tipoDiscrepancia === "sin_discrepancia") return null;
              const pasoClave = claveDiscrepancia(d, i);
              return (
                <TarjetaDiscrepancia
                  key={`${pasoClave}-${i}`}
                  discrepancia={d}
                  activo={pasoResaltado === pasoClave}
                  onHover={() => onHoverPaso(pasoClave)}
                  onLeave={() => onHoverPaso(null)}
                  onIrAPaso={() =>
                    onIrAPaso({
                      pasoId: d.pasoId,
                      seccionGeneral: d.seccionGeneral,
                      // Lo que HOY dice el RMD en ese punto: es exactamente
                      // el fragmento que hay que corregir.
                      textoBuscado: d.textoVigenteEnRMD,
                    })
                  }
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

function ScoreCoherencia({ scoreActual, scoreOriginal }: { scoreActual: number; scoreOriginal: number }) {
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
      <span className="text-[11px] text-muted">/100 coherencia</span>
      {redondeado !== Math.round(scoreOriginal) && (
        <span className="text-[11px] text-muted/70">(inicial: {Math.round(scoreOriginal)})</span>
      )}
    </div>
  );
}

function TarjetaDiscrepancia({
  discrepancia,
  activo,
  onHover,
  onLeave,
  onIrAPaso,
  estado,
  onCambiarEstado,
  retraso,
  verificacion,
}: {
  discrepancia: DiscrepanciaDetectada;
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
      className={`group animate-fade-in-up cursor-pointer rounded-lg border bg-surface px-3.5 py-3 shadow-soft transition-all duration-200 ease-spring hover:shadow-elevated ${BORDE_ESTADO[estado]} ${
        activo ? "border-system shadow-elevated" : "border-line"
      } ${discrepancia.involucraEquipoRetirado ? "ring-1 ring-severidad-critica/40" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded font-mono text-[12px] font-semibold text-system transition-colors group-hover:underline">
            {discrepancia.pasoId}
          </span>
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
            {TIPO_LABEL[discrepancia.tipoDiscrepancia]}
          </span>
        </div>
        <BadgeConfianza nivel={discrepancia.nivelConfianza} />
      </div>

      <p className="mt-1.5 text-[13px] leading-snug text-ink/80">{discrepancia.ubicacionReferencia}</p>

      {discrepancia.involucraEquipoRetirado && (
        <p className="mt-2 rounded-lg border border-severidad-critica/30 bg-severidad-criticaTint px-2 py-1.5 text-[12px] font-medium text-severidad-critica">
          ⚠ Involucra un equipo marcado como retirado en el maestro de equipos.
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
        {expandido ? "Ocultar detalle" : "Ver detalle y cita del control de cambio"}
      </button>

      <div
        className={`grid transition-all duration-300 ease-spring ${
          expandido ? "mt-2 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div className="space-y-2 border-t border-line pt-2.5">
            {discrepancia.textoVigenteEnRMD && (
              <DetalleCampo label="Texto vigente en el RMD" valor={discrepancia.textoVigenteEnRMD} />
            )}
            <DetalleCampo
              label="Qué exige el Control de Cambio"
              valor={discrepancia.queExigeElControlDeCambios}
            />
            <DetalleCampo label="Justificación" valor={discrepancia.justificacion} />
            <DetalleCampo label="Cita / referencia del CC" valor={discrepancia.origenControlCambio} mono />
            {discrepancia.equiposMencionados.length > 0 && (
              <DetalleCampo
                label="Equipos mencionados"
                valor={discrepancia.equiposMencionados.join(", ")}
                mono
              />
            )}
          </div>
        </div>
      </div>

      <div
        onClick={(e) => e.stopPropagation()}
        className="toque mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-2.5"
      >
        <BadgeEstado estado={estado} />
        {verificacion && (
          <BadgeVerificacion resuelto={verificacion.resuelto} justificacion={verificacion.justificacion} />
        )}
        <div className="ml-auto flex shrink-0 gap-1">
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
      className={`min-h-[32px] rounded border px-2.5 text-[11px] font-medium transition-all duration-150 ease-spring active:scale-95 ${
        activo
          ? "border-system bg-system text-white"
          : "border-line bg-surface text-muted hover:border-system hover:text-system"
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
