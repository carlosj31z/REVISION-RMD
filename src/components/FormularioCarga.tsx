"use client";

import { useState, useCallback } from "react";
import { Campo, InputArchivo, ToggleModo, BotonPrimario } from "@/components/ui/FormPrimitives";

const SECCIONES = [
  "SOLIDOS",
  "ACONDICIONADO",
  "CAPSULAS_BLANDAS",
  "COSMETICOS",
  "INY_HORMONALES",
  "MENTHOLATUM",
  "POLVOS_EFERVESCENTES",
  "SEMISOLIDOS",
  "SEMISOLIDOS_HORM",
  "SOLIDOS_HORMONALES",
  "SOLIDOS_4",
] as const;

const ETAPAS = ["FABRICACION", "RECUBRIMIENTO", "ENVASE", "ACONDICIONADO"] as const;

interface Props {
  onIniciarRevision: (input: {
    rmdFile: File;
    seccion: string;
    etapa: string;
    controlCambioTexto?: string;
    controlCambioFile?: File;
  }) => void;
  cargando: boolean;
}

export function FormularioCarga({ onIniciarRevision, cargando }: Props) {
  const [rmdFile, setRmdFile] = useState<File | null>(null);
  const [seccion, setSeccion] = useState<string>("SOLIDOS");
  const [etapa, setEtapa] = useState<string>("FABRICACION");
  const [modoCC, setModoCC] = useState<"texto" | "pdf">("texto");
  const [ccTexto, setCcTexto] = useState("");
  const [ccFile, setCcFile] = useState<File | null>(null);

  const puedeEnviar = rmdFile && (ccTexto.trim().length > 0 || ccFile);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!rmdFile || !puedeEnviar) return;
      onIniciarRevision({
        rmdFile,
        seccion,
        etapa,
        controlCambioTexto: modoCC === "texto" ? ccTexto : undefined,
        controlCambioFile: modoCC === "pdf" ? ccFile ?? undefined : undefined,
      });
    },
    [rmdFile, seccion, etapa, modoCC, ccTexto, ccFile, puedeEnviar, onIniciarRevision]
  );

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-2xl animate-fade-in-up px-6 py-10">
      <div className="mb-8">
        <p className="text-[11px] font-medium uppercase tracking-wide text-system">
          Revisión de RMD
        </p>
        <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.01em] text-ink">
          Detectar discrepancias contra un Control de Cambio
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          Este sistema detecta y localiza discrepancias — no redacta el RMD. La corrección final
          la haces tú directamente en SAP (BTP).
        </p>
      </div>

      <div className="space-y-6">
        <Campo label="RMD vigente (PDF)" descripcion="El documento tal como está autorizado hoy.">
          <InputArchivo
            file={rmdFile}
            onChange={setRmdFile}
            accept="application/pdf"
            placeholder="Selecciona el PDF del RMD vigente"
          />
        </Campo>

        <div className="grid grid-cols-2 gap-4">
          <Campo label="Sección">
            <select
              value={seccion}
              onChange={(e) => setSeccion(e.target.value)}
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-[13px] text-ink transition-all duration-150 ease-spring focus:border-system focus:shadow-ring focus:outline-none"
            >
              {SECCIONES.map((s) => (
                <option key={s} value={s}>
                  {s.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </Campo>
          <Campo label="Etapa">
            <select
              value={etapa}
              onChange={(e) => setEtapa(e.target.value)}
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-[13px] text-ink transition-all duration-150 ease-spring focus:border-system focus:shadow-ring focus:outline-none"
            >
              {ETAPAS.map((et) => (
                <option key={et} value={et}>
                  {et}
                </option>
              ))}
            </select>
          </Campo>
        </div>

        <Campo
          label="Control de Cambio / No Conformidad / Homologación de términos"
          descripcion="Puede ser texto libre o un PDF con las instrucciones."
        >
          <div className="mb-2 flex w-fit gap-1 rounded-lg border border-line bg-paper p-0.5">
            <ToggleModo activo={modoCC === "texto"} onClick={() => setModoCC("texto")} label="Texto" />
            <ToggleModo activo={modoCC === "pdf"} onClick={() => setModoCC("pdf")} label="PDF" />
          </div>

          {modoCC === "texto" ? (
            <textarea
              value={ccTexto}
              onChange={(e) => setCcTexto(e.target.value)}
              rows={6}
              placeholder="Pega aquí el contenido del Control de Cambio, No Conformidad, u orden de homologación de términos..."
              className="w-full resize-none rounded-lg border border-line bg-white px-3 py-2.5 text-[13px] leading-relaxed text-ink placeholder:text-muted/60 transition-all duration-150 ease-spring focus:border-system focus:shadow-ring focus:outline-none"
            />
          ) : (
            <InputArchivo
              file={ccFile}
              onChange={setCcFile}
              accept="application/pdf"
              placeholder="Selecciona el PDF del Control de Cambio"
            />
          )}
        </Campo>
      </div>

      <BotonPrimario disabled={!puedeEnviar || cargando}>
        {cargando ? "Analizando…" : "Analizar discrepancias"}
      </BotonPrimario>
    </form>
  );
}
