"use client";

import { useState, useCallback } from "react";
import { Campo, InputArchivo, BotonPrimario } from "@/components/ui/FormPrimitives";

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
  onIniciarComparacion: (input: {
    rmdVigenteFile: File;
    rmdBorradorFile?: File;
    seccion: string;
    etapa: string;
  }) => void;
  cargando: boolean;
  // "vigente" (por defecto): flujo normal, el documento autorizado hoy vs.
  // el borrador que propone Producción — acá el borrador es obligatorio.
  // "corregido": atajo para cuando el analista ya armó su propia versión
  // corregida/actualizada. El borrador es OPCIONAL: si lo adjunta, se
  // compara contra él; si NO lo adjunta, se entiende que quiere verificar
  // el RMD corregido por sí solo contra las reglas permanentes y que no
  // cite documentos obsoletos (ver PanelDiferenciasBorrador/verificarCumplimientoSolo).
  variante?: "vigente" | "corregido";
}

const COPIA_POR_VARIANTE = {
  vigente: {
    eyebrow: "Comparar con borrador",
    titulo: "RMD vigente vs. borrador de Producción",
    descripcion:
      "Compara el documento autorizado hoy contra la próxima versión que propone " +
      "Producción. Detecta pasos agregados, eliminados, modificados o renumerados, " +
      "y cambios en equipos, insumos o encabezado — no redacta el RMD final.",
    labelPrimerDocumento: "RMD vigente (PDF)",
    descripcionPrimerDocumento: "El documento tal como está autorizado hoy.",
    placeholderPrimerDocumento: "Selecciona el PDF del RMD vigente",
  },
  corregido: {
    eyebrow: "Verificar RMD corregido",
    titulo: "RMD corregido vs. borrador de Producción",
    descripcion:
      "Si ya editaste el RMD en SAP aplicando lo que pidió Producción, subilo acá " +
      "para verificar qué indicaciones del borrador ya quedaron incorporadas y cuáles " +
      "siguen pendientes. Lo que ya aplicaste no vuelve a aparecer como observación.",
    labelPrimerDocumento: "RMD corregido (PDF)",
    descripcionPrimerDocumento: "El documento ya actualizado que querés confirmar.",
    placeholderPrimerDocumento: "Selecciona el PDF del RMD corregido",
  },
} as const;

export function FormularioComparacionBorrador({
  onIniciarComparacion,
  cargando,
  variante = "vigente",
}: Props) {
  const [rmdVigenteFile, setRmdVigenteFile] = useState<File | null>(null);
  const [rmdBorradorFile, setRmdBorradorFile] = useState<File | null>(null);
  const [seccion, setSeccion] = useState<string>("SOLIDOS");
  const [etapa, setEtapa] = useState<string>("FABRICACION");
  const copia = COPIA_POR_VARIANTE[variante];
  const borradorOpcional = variante === "corregido";

  const puedeEnviar = !!rmdVigenteFile && (!!rmdBorradorFile || borradorOpcional);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!puedeEnviar || !rmdVigenteFile) return;
      onIniciarComparacion({
        rmdVigenteFile,
        rmdBorradorFile: rmdBorradorFile ?? undefined,
        seccion,
        etapa,
      });
    },
    [rmdVigenteFile, rmdBorradorFile, seccion, etapa, puedeEnviar, onIniciarComparacion]
  );

  return (
    <form onSubmit={handleSubmit} className="inset-seguro-x mx-auto max-w-2xl animate-fade-in-up px-4 py-7 sm:px-6 sm:py-10">
      <div className="mb-8">
        <p className="text-[11px] font-medium uppercase tracking-wide text-system">
          {copia.eyebrow}
        </p>
        <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.01em] text-ink">
          {copia.titulo}
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">{copia.descripcion}</p>
      </div>

      <div className="space-y-6">
        <Campo label={copia.labelPrimerDocumento} descripcion={copia.descripcionPrimerDocumento}>
          <InputArchivo
            file={rmdVigenteFile}
            onChange={setRmdVigenteFile}
            accept="application/pdf"
            placeholder={copia.placeholderPrimerDocumento}
          />
        </Campo>

        <Campo
          label={`Borrador de Producción (PDF)${borradorOpcional ? " — opcional" : ""}`}
          descripcion={
            borradorOpcional
              ? "Si lo adjuntás, se compara el RMD corregido contra este borrador."
              : "La versión propuesta que Producción envió para la próxima actualización."
          }
        >
          <InputArchivo
            file={rmdBorradorFile}
            onChange={setRmdBorradorFile}
            accept="application/pdf"
            placeholder="Selecciona el PDF del borrador"
          />
          {borradorOpcional && !rmdBorradorFile && (
            <p className="mt-2 rounded-lg border border-system/25 bg-system-tint px-3 py-2 text-[12px] leading-relaxed text-system">
              Sin borrador: se va a verificar que el RMD corregido cumpla las{" "}
              <strong className="font-semibold">reglas permanentes</strong> y que no cite{" "}
              <strong className="font-semibold">documentos obsoletos</strong> — no se compara
              contra ningún otro documento.
            </p>
          )}
        </Campo>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo label="Sección">
            <select
              value={seccion}
              onChange={(e) => setSeccion(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink transition-all duration-150 ease-spring focus:border-system focus:shadow-ring focus:outline-none"
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
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink transition-all duration-150 ease-spring focus:border-system focus:shadow-ring focus:outline-none"
            >
              {ETAPAS.map((et) => (
                <option key={et} value={et}>
                  {et}
                </option>
              ))}
            </select>
          </Campo>
        </div>
      </div>

      <BotonPrimario disabled={!puedeEnviar || cargando}>
        {cargando
          ? "Procesando…"
          : borradorOpcional && !rmdBorradorFile
            ? "Verificar cumplimiento"
            : "Comparar documentos"}
      </BotonPrimario>
    </form>
  );
}
