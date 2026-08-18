"use client";

import { useState, useCallback, useMemo } from "react";
import { Campo, InputArchivo, ToggleModo } from "@/components/ui/FormPrimitives";
import {
  ETIQUETA_6M,
  ETIQUETA_GRADO,
  type Categoria6M,
  type GradoImpacto,
  type NomenclaturaControlCambio,
} from "@/lib/nomenclaturaControlCambio";

const OPCIONES_6M = Object.keys(ETIQUETA_6M) as Categoria6M[];
const OPCIONES_GRADO = Object.keys(ETIQUETA_GRADO) as GradoImpacto[];

/** Arma el string final a partir de los campos editables — nunca del texto
 *  crudo que devolvió la IA, para que corregir un campo en la UI se refleje
 *  de inmediato sin tener que volver a llamarla. */
function construirNomenclatura(campos: {
  codigo: string;
  aprobadorFormatoCorto: string;
  fechaAprobacion: string;
  titulo: string;
  categoria6M: Categoria6M;
  gradoImpacto: GradoImpacto;
}): string {
  const partes = [campos.codigo, campos.aprobadorFormatoCorto, campos.fechaAprobacion]
    .map((p) => p.trim())
    .filter(Boolean);
  const cabecera = partes.join("/");
  // Punto y coma en todos los separadores de la cola, no coma: título; 6M;
  // grado — así se distingue de cualquier coma que pueda venir dentro del
  // propio título (ej. "Cosméticos, Línea 2").
  const cola = [
    campos.titulo.trim(),
    ETIQUETA_6M[campos.categoria6M].toLowerCase(),
    ETIQUETA_GRADO[campos.gradoImpacto].toLowerCase(),
  ]
    .filter(Boolean)
    .join("; ");
  if (!cabecera && !cola) return "";
  return `${cabecera}${cabecera && cola ? "; " : ""}${cola}${cola ? "." : ""}`;
}

export function GeneradorNomenclatura() {
  const [abierto, setAbierto] = useState(false);
  const [modo, setModo] = useState<"texto" | "pdf">("pdf");
  const [texto, setTexto] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<NomenclaturaControlCambio | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [verJustificacion, setVerJustificacion] = useState(false);

  // Campos editables, sembrados con lo que propuso la IA. El analista puede
  // corregir cualquiera sin volver a llamarla — el string se recalcula solo.
  const [codigo, setCodigo] = useState("");
  const [aprobador, setAprobador] = useState("");
  const [fecha, setFecha] = useState("");
  const [titulo, setTitulo] = useState("");
  const [categoria6M, setCategoria6M] = useState<Categoria6M>("MAQUINA");
  const [gradoImpacto, setGradoImpacto] = useState<GradoImpacto>("MODERADO");

  const puedeGenerar = texto.trim().length > 0 || !!file;

  const generar = useCallback(async () => {
    if (!puedeGenerar) return;
    setGenerando(true);
    setError(null);
    setCopiado(false);
    try {
      const formData = new FormData();
      if (modo === "texto") formData.append("texto", texto);
      if (modo === "pdf" && file) formData.append("file", file);

      const res = await fetch("/api/control-cambio/nomenclatura", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "No se pudo generar la nomenclatura.");
      const { nomenclatura } = (await res.json()) as { nomenclatura: NomenclaturaControlCambio };

      setResultado(nomenclatura);
      setCodigo(nomenclatura.codigo);
      setAprobador(nomenclatura.aprobadorFormatoCorto);
      setFecha(nomenclatura.fechaAprobacion ?? "");
      setTitulo(nomenclatura.titulo);
      setCategoria6M(nomenclatura.categoria6M);
      setGradoImpacto(nomenclatura.gradoImpacto);
    } catch (err: any) {
      setError(err.message ?? "Ocurrió un error inesperado.");
    } finally {
      setGenerando(false);
    }
  }, [modo, texto, file, puedeGenerar]);

  const nomenclaturaFinal = useMemo(
    () => construirNomenclatura({ codigo, aprobadorFormatoCorto: aprobador, fechaAprobacion: fecha, titulo, categoria6M, gradoImpacto }),
    [codigo, aprobador, fecha, titulo, categoria6M, gradoImpacto]
  );

  const copiar = useCallback(async () => {
    if (!nomenclaturaFinal) return;
    try {
      await navigator.clipboard.writeText(nomenclaturaFinal);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    } catch {
      // Sin permiso de portapapeles: el texto ya queda seleccionable en el
      // campo de solo lectura, así que el analista lo copia a mano.
    }
  }, [nomenclaturaFinal]);

  const reiniciar = useCallback(() => {
    setResultado(null);
    setTexto("");
    setFile(null);
    setError(null);
    setCopiado(false);
    setVerJustificacion(false);
  }, []);

  return (
    <div className="mx-auto mb-2 max-w-2xl px-4 sm:px-6">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-left shadow-soft transition-all duration-150 ease-spring hover:shadow-elevated"
      >
        <span>
          <span className="block text-[13px] font-semibold text-ink">
            Generar nomenclatura del Control de Cambio
          </span>
          <span className="block text-[11.5px] text-muted">
            Arma el identificador estándar (código/aprobador/fecha; título; 6M; grado) a partir
            del correo o PDF del Control de Cambio — sin necesidad de un RMD.
          </span>
        </span>
        <span
          className={`shrink-0 text-[13px] text-muted transition-transform duration-200 ${abierto ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>

      {abierto && (
        <div className="mt-2 animate-fade-in-up rounded-xl border border-line bg-surface p-4 shadow-soft">
          {!resultado ? (
            <>
              <Campo
                label="Control de Cambio"
                descripcion="El correo/documento que comunica la aprobación — texto libre o PDF."
              >
                <div className="mb-2 flex w-fit gap-1 rounded-lg border border-line bg-paper p-0.5">
                  <ToggleModo activo={modo === "pdf"} onClick={() => setModo("pdf")} label="PDF" />
                  <ToggleModo activo={modo === "texto"} onClick={() => setModo("texto")} label="Texto" />
                </div>
                {modo === "pdf" ? (
                  <InputArchivo
                    file={file}
                    onChange={setFile}
                    accept="application/pdf"
                    placeholder="Selecciona el PDF o correo exportado del Control de Cambio"
                  />
                ) : (
                  <textarea
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    rows={6}
                    placeholder="Pega aquí el correo o el texto del Control de Cambio..."
                    className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2.5 text-[13px] leading-relaxed text-ink placeholder:text-muted/60 transition-all duration-150 ease-spring focus:border-system focus:shadow-ring focus:outline-none"
                  />
                )}
              </Campo>

              {error && (
                <p className="mt-3 rounded-lg border border-severidad-critica/30 bg-severidad-criticaTint px-3 py-2 text-[12.5px] text-severidad-critica">
                  {error}
                </p>
              )}

              <button
                type="button"
                onClick={generar}
                disabled={!puedeGenerar || generando}
                className="mt-4 min-h-[42px] w-full rounded-lg bg-system px-4 text-[13px] font-medium text-white shadow-soft transition-all duration-150 ease-spring hover:bg-system-light hover:shadow-elevated active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {generando ? "Leyendo el Control de Cambio…" : "Generar nomenclatura"}
              </button>
            </>
          ) : (
            <div className="animate-fade-in-up space-y-4">
              <div className="rounded-lg border border-system/30 bg-system-tint px-3 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="select-all text-[13px] leading-relaxed text-system">
                    {nomenclaturaFinal || "Completá los campos de abajo."}
                  </p>
                  <button
                    type="button"
                    onClick={copiar}
                    disabled={!nomenclaturaFinal}
                    className="shrink-0 rounded-lg border border-system/40 px-2.5 py-1 text-[11.5px] font-medium text-system transition-all duration-150 ease-spring hover:bg-system hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {copiado ? "Copiado ✓" : "Copiar"}
                  </button>
                </div>
              </div>

              {resultado.advertencias.length > 0 && (
                <div className="rounded-lg border border-severidad-alta/30 bg-severidad-altaTint px-3 py-2.5">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-severidad-alta">
                    Revisar antes de usar
                  </p>
                  <ul className="space-y-1">
                    {resultado.advertencias.map((a, i) => (
                      <li key={i} className="text-[12.5px] leading-snug text-severidad-alta/90">
                        · {a}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Campo label="Código">
                  <input
                    value={codigo}
                    onChange={(e) => setCodigo(e.target.value)}
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink transition-all duration-150 ease-spring focus:border-system focus:shadow-ring focus:outline-none"
                  />
                </Campo>
                <Campo label="Aprobador (Inicial.Apellido)">
                  <input
                    value={aprobador}
                    onChange={(e) => setAprobador(e.target.value)}
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink transition-all duration-150 ease-spring focus:border-system focus:shadow-ring focus:outline-none"
                  />
                  {resultado.aprobadorNombreCompleto && (
                    <p className="mt-1 text-[11px] text-muted">
                      Detectado: {resultado.aprobadorNombreCompleto}
                    </p>
                  )}
                </Campo>
                <Campo label="Fecha de aprobación">
                  <input
                    type="date"
                    value={fecha}
                    onChange={(e) => setFecha(e.target.value)}
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink transition-all duration-150 ease-spring focus:border-system focus:shadow-ring focus:outline-none"
                  />
                </Campo>
                <Campo label="Impacta principalmente a (6M)">
                  <select
                    value={categoria6M}
                    onChange={(e) => setCategoria6M(e.target.value as Categoria6M)}
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink transition-all duration-150 ease-spring focus:border-system focus:shadow-ring focus:outline-none"
                  >
                    {OPCIONES_6M.map((c) => (
                      <option key={c} value={c}>
                        {ETIQUETA_6M[c]}
                      </option>
                    ))}
                  </select>
                </Campo>
                <div className="sm:col-span-2">
                  <Campo label="Título">
                    <textarea
                      value={titulo}
                      onChange={(e) => setTitulo(e.target.value)}
                      rows={2}
                      className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-[13px] leading-relaxed text-ink transition-all duration-150 ease-spring focus:border-system focus:shadow-ring focus:outline-none"
                    />
                  </Campo>
                </div>
                <Campo label="Grado de impacto">
                  <select
                    value={gradoImpacto}
                    onChange={(e) => setGradoImpacto(e.target.value as GradoImpacto)}
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink transition-all duration-150 ease-spring focus:border-system focus:shadow-ring focus:outline-none"
                  >
                    {OPCIONES_GRADO.map((g) => (
                      <option key={g} value={g}>
                        {ETIQUETA_GRADO[g]}
                      </option>
                    ))}
                  </select>
                </Campo>
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => setVerJustificacion((v) => !v)}
                  className="text-[12px] font-medium text-system hover:underline"
                >
                  {verJustificacion ? "Ocultar" : "Ver"} por qué la IA eligió esta 6M y este grado
                </button>
                {verJustificacion && (
                  <div className="mt-2 space-y-2 rounded-lg border border-line bg-paper px-3 py-2.5">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                        6M — {ETIQUETA_6M[resultado.categoria6M]}
                      </p>
                      <p className="mt-0.5 text-[12.5px] leading-snug text-ink/80">
                        {resultado.justificacion6M}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                        Grado — {ETIQUETA_GRADO[resultado.gradoImpacto]}
                      </p>
                      <p className="mt-0.5 text-[12.5px] leading-snug text-ink/80">
                        {resultado.justificacionGrado}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={reiniciar}
                className="w-full rounded-lg border border-line px-4 py-2 text-[12.5px] font-medium text-muted transition-all duration-150 ease-spring hover:border-system hover:text-system active:scale-[0.98]"
              >
                Generar otra
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
