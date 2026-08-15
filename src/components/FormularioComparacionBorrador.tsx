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
    rmdBorradorFile: File;
    seccion: string;
    etapa: string;
  }) => void;
  cargando: boolean;
  // "vigente" (por defecto): flujo normal, el documento autorizado hoy vs.
  // el borrador que propone Producción. "corregido": atajo para cuando el
  // analista ya armó su propia versión corregida/actualizada y solo quiere
  // confirmar que coincide con lo que Producción propuso, sin pasar primero
  // por la comparación contra el vigente.
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
    eyebrow: "Verificar contra el borrador",
    titulo: "RMD corregido vs. borrador de Producción",
    descripcion:
      "Si ya armaste tu propia versión corregida/actualizada del RMD, subila acá " +
      "directamente para confirmar que coincide con lo que Producción propuso en su " +
      "borrador — sin pasar primero por la comparación contra el vigente.",
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

  const puedeEnviar = !!rmdVigenteFile && !!rmdBorradorFile;

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!puedeEnviar || !rmdVigenteFile || !rmdBorradorFile) return;
      onIniciarComparacion({ rmdVigenteFile, rmdBorradorFile, seccion, etapa });
    },
    [rmdVigenteFile, rmdBorradorFile, seccion, etapa, puedeEnviar, onIniciarComparacion]
  );

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-2xl animate-fade-in-up px-6 py-10">
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
          label="Borrador de Producción (PDF)"
          descripcion="La versión propuesta que Producción envió para la próxima actualización."
        >
          <InputArchivo
            file={rmdBorradorFile}
            onChange={setRmdBorradorFile}
            accept="application/pdf"
            placeholder="Selecciona el PDF del borrador"
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
      </div>

      <BotonPrimario disabled={!puedeEnviar || cargando}>
        {cargando ? "Comparando…" : "Comparar documentos"}
      </BotonPrimario>
    </form>
  );
}
