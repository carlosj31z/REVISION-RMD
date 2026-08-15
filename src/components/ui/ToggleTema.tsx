"use client";

import { useEffect, useState } from "react";

/**
 * Alterna data-theme en <html> (ver layout.tsx para el script anti-flash que
 * lo fija antes del primer paint) y persiste la elección en localStorage.
 * El ícono arranca invisible un frame hasta confirmar el tema real en el
 * cliente, para no mostrar brevemente el ícono equivocado.
 */
export function ToggleTema() {
  const [oscuro, setOscuro] = useState(false);
  const [montado, setMontado] = useState(false);

  useEffect(() => {
    setOscuro(document.documentElement.getAttribute("data-theme") === "dark");
    setMontado(true);
  }, []);

  const alternar = () => {
    const nuevo = oscuro ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", nuevo);
    try {
      localStorage.setItem("tema", nuevo);
    } catch {
      // localStorage puede fallar en navegación privada estricta; el tema
      // igual cambia para esta sesión, solo no se recuerda la próxima vez.
    }
    setOscuro(!oscuro);
  };

  return (
    <button
      onClick={alternar}
      title={oscuro ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      aria-label={oscuro ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-all duration-150 ease-spring hover:bg-paper hover:text-ink active:scale-90 ${
        montado ? "opacity-100" : "opacity-0"
      }`}
    >
      {oscuro ? <IconoSol /> : <IconoLuna />}
    </button>
  );
}

function IconoSol() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

function IconoLuna() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401Z" />
    </svg>
  );
}
