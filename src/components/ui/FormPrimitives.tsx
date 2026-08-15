"use client";

import { useCallback, useId, useState } from "react";

export function Campo({
  label,
  descripcion,
  children,
}: {
  label: string;
  descripcion?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[12px] font-medium text-ink">{label}</label>
      {descripcion && <p className="mb-2 text-[11.5px] text-muted">{descripcion}</p>}
      {children}
    </div>
  );
}

function formatearTamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * Selector de archivo con soporte de arrastrar-y-soltar. El estado visual
 * responde de inmediato al arrastre (dragenter), no solo al soltar, para que
 * la zona se sienta receptiva mientras el archivo está en vuelo.
 */
export function InputArchivo({
  file,
  onChange,
  accept,
  placeholder,
}: {
  file: File | null;
  onChange: (f: File | null) => void;
  accept: string;
  placeholder: string;
}) {
  const inputId = useId();
  const [arrastrando, setArrastrando] = useState(false);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      setArrastrando(false);
      const dropped = e.dataTransfer.files?.[0];
      if (dropped) onChange(dropped);
    },
    [onChange]
  );

  if (file) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-line bg-white px-3.5 py-3 shadow-soft transition-all duration-200 ease-spring">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-system-tint text-system">
          <IconoPdf />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-ink">{file.name}</p>
          <p className="text-[11px] text-muted">{formatearTamano(file.size)}</p>
        </div>
        <label
          htmlFor={inputId}
          className="shrink-0 cursor-pointer rounded px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-system transition-colors hover:bg-system-tint active:scale-95"
        >
          Cambiar
        </label>
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label="Quitar archivo"
          title="Quitar archivo"
          className="shrink-0 rounded p-1 text-muted transition-all duration-150 ease-spring hover:bg-severidad-criticaTint hover:text-severidad-critica active:scale-90"
        >
          <IconoX />
        </button>
        <input
          id={inputId}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        />
      </div>
    );
  }

  return (
    <label
      htmlFor={inputId}
      onDragOver={(e) => {
        e.preventDefault();
        if (!arrastrando) setArrastrando(true);
      }}
      onDragLeave={() => setArrastrando(false)}
      onDrop={onDrop}
      className={`flex cursor-pointer items-center gap-3 rounded-lg border border-dashed px-3.5 py-3.5 text-[13px] transition-all duration-200 ease-spring ${
        arrastrando
          ? "scale-[1.01] border-system bg-system-tint text-system shadow-soft"
          : "border-line bg-white text-muted hover:border-system/60 hover:bg-system-tint/40 hover:text-system"
      }`}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
          arrastrando ? "bg-white text-system" : "bg-paper text-muted"
        }`}
      >
        <IconoSubir />
      </span>
      <span className="flex-1">
        <span className="block font-medium">{placeholder}</span>
        <span className="block text-[11px] opacity-70">Arrastra el PDF aquí o hace clic para elegirlo</span>
      </span>
      <input
        id={inputId}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
    </label>
  );
}

export function ToggleModo({
  activo,
  onClick,
  label,
}: {
  activo: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-3 py-1 text-[11px] font-medium transition-all duration-200 ease-spring active:scale-95 ${
        activo ? "bg-white text-system shadow-soft" : "text-muted hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

export function BotonPrimario({
  children,
  disabled,
  type = "submit",
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  type?: "submit" | "button";
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className="mt-8 w-full rounded-lg bg-system px-4 py-3 text-[13px] font-medium text-white shadow-soft transition-all duration-150 ease-spring hover:bg-system-light hover:shadow-elevated active:scale-[0.98] active:shadow-soft disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:shadow-soft disabled:active:scale-100"
    >
      {children}
    </button>
  );
}

function IconoPdf() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

function IconoSubir() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 15V3" />
      <path d="m7 8 5-5 5 5" />
      <path d="M20 15v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4" />
    </svg>
  );
}

function IconoX() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
