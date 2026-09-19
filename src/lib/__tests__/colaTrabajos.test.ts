import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { encolarSiElTiempoLoResuelve, esperaMinutos } from "../colaTrabajos";
import { ProveedoresAgotadosError, loResuelveElTiempo } from "../llmFallback";

// El cliente nunca se llega a usar en estos casos: las tres condiciones que se
// prueban se deciden ANTES de tocar la base.
const SIN_BASE = null as unknown as SupabaseClient;

const DATOS = {
  operacion: "revision" as const,
  payload: { rmdVigente: {} },
};

describe("esperaMinutos", () => {
  it("arranca corto y se estira hasta cuatro horas", () => {
    // Una saturación puede durar minutos; la cuota DIARIA no se libera hasta
    // el reinicio, así que no tiene sentido insistir cada rato.
    assert.equal(esperaMinutos(0), 10);
    assert.equal(esperaMinutos(1), 30);
    assert.equal(esperaMinutos(2), 60);
    assert.equal(esperaMinutos(3), 120);
    assert.equal(esperaMinutos(9), 120);
  });
});

describe("loResuelveElTiempo", () => {
  it("reconoce los fallos que se arreglan esperando", () => {
    for (const err of [
      { status: 429, message: "Too Many Requests" },
      { status: 503, message: "Service Unavailable" },
      { status: 504, message: "Gateway Timeout" },
      { message: "Quota exceeded for quota metric" },
      { message: "The model is overloaded. Please try again later." },
      { message: "resource has been exhausted" },
    ]) {
      assert.equal(loResuelveElTiempo(err), true, JSON.stringify(err));
    }
  });

  it("no toma por transitorio lo que mañana va a fallar igual", () => {
    for (const err of [
      { status: 400, message: "Invalid JSON payload" },
      { status: 401, message: "API key not valid" },
      { status: 404, message: "model not found" },
      { message: "Unexpected token in JSON at position 0" },
    ]) {
      assert.equal(loResuelveElTiempo(err), false, JSON.stringify(err));
    }
  });
});

describe("encolarSiElTiempoLoResuelve", () => {
  it("no encola un error que no viene de agotar los proveedores", async () => {
    const resultado = await encolarSiElTiempoLoResuelve(SIN_BASE, new Error("el PDF está roto"), DATOS);
    assert.equal(resultado, null);
  });

  it("no encola si ningún proveedor falló por cuota o saturación", async () => {
    // Reintentarlo mañana daría exactamente el mismo error: mejor que el
    // analista lo vea ahora.
    const err = new ProveedoresAgotadosError("compararRMDvsControlCambios", ["Gemini: API key not valid"], false);
    assert.equal(await encolarSiElTiempoLoResuelve(SIN_BASE, err, DATOS), null);
  });

  it("no encola cuando la llamada ya es un reintento del worker", async () => {
    // La reprogramación la lleva el worker: si la ruta encolara de nuevo, cada
    // reintento fallido duplicaría el trabajo en la cola.
    const err = new ProveedoresAgotadosError("compararRMDvsControlCambios", ["Gemini: quota exceeded"], true);
    assert.equal(
      await encolarSiElTiempoLoResuelve(SIN_BASE, err, { ...DATOS, yaEsReintento: true }),
      null
    );
  });
});

describe("ProveedoresAgotadosError", () => {
  it("lista los fallos en orden y conserva si vuelve a servir más tarde", () => {
    const err = new ProveedoresAgotadosError(
      "compararRMDvsBorrador",
      ["Gemini (GEMINI_API_KEY): quota exceeded", "Groq: 503"],
      true
    );

    assert.equal(err.name, "ProveedoresAgotadosError");
    assert.equal(err.vuelveAServirMasTarde, true);
    assert.deepEqual(err.errores.length, 2);
    assert.match(err.message, /Los 2 proveedor\(es\) de IA configurados fallaron/);
    assert.match(err.message, /1\. Gemini/);
    assert.ok(err instanceof Error, "tiene que seguir siendo un Error para los catch de siempre");
  });
});
