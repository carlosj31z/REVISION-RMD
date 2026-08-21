"use client";

import { useState, useCallback } from "react";
import { Campo, InputArchivo, BotonPrimario } from "@/components/ui/FormPrimitives";

interface Props {
  onIniciarComparacion: (input: { rmdFile: File; rmdReferenciaFile: File }) => void;
  cargando: boolean;
}

/**
 * A diferencia de FormularioComparacionBorrador (misma versión del RMD,
 * antes/después), acá ambos PDF son documentos DISTINTOS por diseño — no
 * hay noción de "sección/etapa" compartida a priori, así que no se piden:
 * la IA identifica la del RMD evaluado a partir de su propio encabezado.
 */
export function FormularioComparacionReferencia({ onIniciarComparacion, cargando }: Props) {
  const [rmdFile, setRmdFile] = useState<File | null>(null);
  const [rmdReferenciaFile, setRmdReferenciaFile] = useState<File | null>(null);

  const puedeEnviar = !!rmdFile && !!rmdReferenciaFile;

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!puedeEnviar || !rmdFile || !rmdReferenciaFile) return;
      onIniciarComparacion({ rmdFile, rmdReferenciaFile });
    },
    [rmdFile, rmdReferenciaFile, puedeEnviar, onIniciarComparacion]
  );

  return (
    <form onSubmit={handleSubmit} className="inset-seguro-x mx-auto max-w-2xl animate-fade-in-up px-4 py-7 sm:px-6 sm:py-10">
      <div className="mb-8">
        <p className="text-[11px] font-medium uppercase tracking-wide text-system">
          Comparar con RMD Referencia
        </p>
        <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.01em] text-ink">
          Homologar contra un RMD de referencia
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          Compara el RMD a evaluar contra otro RMD que uses como modelo (de otra línea o
          producto ya estandarizado). Busca pasos con el mismo propósito y sugiere homologar
          redacción, orden o estructura donde tenga sentido — no asume que ambos documentos
          deban terminar siendo idénticos: la mayoría de los pasos son específicos de cada
          producto y no tienen equivalente en el otro.
        </p>
      </div>

      <div className="space-y-6">
        <Campo label="RMD a evaluar (PDF)" descripcion="El documento que querés homologar.">
          <InputArchivo
            file={rmdFile}
            onChange={setRmdFile}
            accept="application/pdf"
            placeholder="Selecciona el PDF del RMD a evaluar"
          />
        </Campo>

        <Campo
          label="RMD de referencia (PDF)"
          descripcion="El documento que se toma como modelo a seguir."
        >
          <InputArchivo
            file={rmdReferenciaFile}
            onChange={setRmdReferenciaFile}
            accept="application/pdf"
            placeholder="Selecciona el PDF del RMD de referencia"
          />
        </Campo>
      </div>

      <BotonPrimario disabled={!puedeEnviar || cargando}>
        {cargando ? "Procesando…" : "Comparar y homologar"}
      </BotonPrimario>
    </form>
  );
}
