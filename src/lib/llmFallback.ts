import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

/**
 * Orquestación de proveedores de IA con respaldo automático.
 *
 * Orden de intento: Gemini (clave principal) → Gemini (clave de respaldo) →
 * Groq (última instancia). Gemini va primero porque todo el prompting de este
 * proyecto depende de dos capacidades que Groq no tiene: responseSchema (JSON
 * Schema forzado de verdad, no solo "modo JSON") y lectura VISUAL de los PDF
 * adjuntos (necesaria, por ejemplo, para leer anotaciones manuscritas o texto
 * sobrepuesto en el borrador de Producción — ver regla 11 de
 * SYSTEM_PROMPT_BORRADOR en gemini.ts). Groq queda como última instancia: si
 * ambas claves de Gemini fallan (cuota agotada, 500, lo que sea), Groq igual
 * responde usando solo el texto ya extraído del PDF (sin la lectura visual),
 * con el schema descrito en el prompt en vez de forzado por la API — es un
 * resultado degradado pero muchísimo mejor que no tener respuesta.
 *
 * Cualquier error del proveedor en turno (no solo cuota agotada) dispara el
 * salto al siguiente: así el sistema queda resiliente ante cualquier corte,
 * no solo el caso puntual de "se acabó la cuota".
 */

// Groq rota su catálogo y da de baja modelos sin aviso: "llama-3.3-70b-versatile"
// funcionaba y dejó de existir (HTTP 404 model_not_found), lo que dejó el
// respaldo de última instancia inservible sin que nada lo señalara. Queda
// configurable por entorno para poder cambiarlo sin tocar código ni
// redesplegar. Modelos vigentes se listan en GET /openai/v1/models.
const GROQ_MODEL = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";

function esErrorTransitorio(err: any): boolean {
  const status = err?.status ?? err?.response?.status;
  if (status !== 503 && status !== 429) return false;
  // Cuota DIARIA agotada (ej. "GenerateRequestsPerDayPerProjectPerModel"):
  // no se va a liberar en los pocos segundos que dura el backoff, así que
  // reintentar con la MISMA clave sólo quema tiempo antes de pasar a la
  // siguiente. Un 429 de límite por minuto, en cambio, sí conviene
  // reintentarlo un momento antes de saltar de clave.
  const msg = String(err?.message ?? "");
  if (status === 429 && /PerDay/i.test(msg)) return false;
  return true;
}

async function conReintentos<T>(fn: () => Promise<T>, intentos = 5): Promise<T> {
  for (let i = 0; i < intentos; i++) {
    try {
      return await fn();
    } catch (err) {
      const esUltimoIntento = i === intentos - 1;
      if (esUltimoIntento || !esErrorTransitorio(err)) throw err;
      const esperaBase = Math.min(1000 * 2 ** i, 10000);
      const esperaMs = esperaBase + Math.random() * 500;
      await new Promise((resolve) => setTimeout(resolve, esperaMs));
    }
  }
  throw new Error("unreachable");
}

function mensajeError(err: any): string {
  const status = err?.status ?? err?.response?.status;
  const msg = err?.message ?? String(err);
  return status ? `[HTTP ${status}] ${msg}` : msg;
}

function parsearJSON(raw: string, operacion: string, proveedor: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(
      `${proveedor} devolvió una respuesta que no es JSON válido para "${operacion}". Esto no ` +
        `debería ocurrir con el formato forzado activo; revisa el modelo o los límites de tokens. ` +
        `Respuesta cruda: ${raw.slice(0, 500)}`
    );
  }
}

/** Convierte el schema estilo Gemini (SchemaType) a una notación legible para incluir en el prompt de Groq, que no soporta JSON Schema real. */
function describirSchemaParaPrompt(schema: any, indent = ""): string {
  if (schema.type === SchemaType.OBJECT) {
    const propiedades = schema.properties as Record<string, any>;
    const requeridos: string[] = schema.required ?? [];
    const lineas = Object.entries(propiedades).map(([clave, sub]) => {
      const opcional = !requeridos.includes(clave) ? " (opcional)" : "";
      return `${indent}  "${clave}"${opcional}: ${describirSchemaParaPrompt(sub, indent + "  ")}`;
    });
    return `{\n${lineas.join(",\n")}\n${indent}}`;
  }
  if (schema.type === SchemaType.ARRAY) {
    return `[ ${describirSchemaParaPrompt(schema.items, indent)}, ... ]`;
  }
  if (schema.type === SchemaType.STRING) {
    const base = schema.enum ? (schema.enum as string[]).map((v) => `"${v}"`).join(" | ") : "string";
    return schema.nullable ? `${base} | null` : base;
  }
  if (schema.type === SchemaType.NUMBER) return schema.nullable ? "number | null" : "number";
  if (schema.type === SchemaType.BOOLEAN) return schema.nullable ? "boolean | null" : "boolean";
  return "any";
}

export interface PdfAdjunto {
  mimeType: string;
  data: string;
  etiqueta: string;
}

export interface GenerarJSONArgs {
  nombreOperacion: string;
  systemPrompt: string;
  textoContenido: string;
  pdfsAdjuntos?: PdfAdjunto[];
  schema: any;
  /**
   * true = la operación DEPENDE de leer visualmente el PDF adjunto, así que
   * Groq queda excluido de la cadena de respaldo.
   *
   * No es una optimización: Groq no ve los PDF, pero igual responde un JSON
   * válido según el schema — con los arreglos vacíos. En una transcripción por
   * OCR eso se veía como un éxito con "0 insumos, 0 equipos, 33 de 93 pasos"
   * en vez de un error, que es la peor falla posible en un documento de
   * calidad regulada. Ante la duda, mejor fallar fuerte que devolver un
   * documento a medias sin avisar.
   */
  requiereVisionDocumento?: boolean;
}

async function generarConGemini(apiKey: string, args: GenerarJSONArgs): Promise<any> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-flash-latest",
    systemInstruction: args.systemPrompt,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: args.schema,
      temperature: 0.1,
    },
  });

  const parts: any[] = [{ text: args.textoContenido }];
  for (const pdf of args.pdfsAdjuntos ?? []) {
    parts.push({ inlineData: { mimeType: pdf.mimeType, data: pdf.data } });
    parts.push({ text: `↑ ${pdf.etiqueta}` });
  }

  const result = await conReintentos(() =>
    model.generateContent({ contents: [{ role: "user", parts }] })
  );

  return parsearJSON(result.response.text(), args.nombreOperacion, "Gemini");
}

async function generarConGroq(apiKey: string, args: GenerarJSONArgs): Promise<any> {
  const schemaTexto = describirSchemaParaPrompt(args.schema);
  const systemPromptConSchema = `${args.systemPrompt}

## FORMATO DE SALIDA (proveedor de respaldo, sin JSON Schema forzado por la API)
Respondé ÚNICAMENTE un objeto JSON válido, sin texto adicional antes o después, sin markdown ni bloques de código, que cumpla EXACTAMENTE esta forma (tipos y enums indicados con "|"):
${schemaTexto}

## LIMITACIÓN DE ESTE PROVEEDOR DE RESPALDO
No tenés acceso visual a los PDF adjuntos — solo al texto ya extraído en la estructura JSON que te entregan más abajo. Si el caso requiere leer una anotación manuscrita, texto sobrepuesto en otro color, o cualquier contenido que la extracción de texto plano no pudo capturar, no lo inventes: marcá "nivelConfianza": "baja" (si el campo existe en el schema) y explicá la limitación en la justificación correspondiente.`;

  const resp = await conReintentos(() =>
    fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPromptConSchema },
          { role: "user", content: args.textoContenido },
        ],
      }),
    })
  );

  if (!resp.ok) {
    const cuerpo = await resp.text().catch(() => "");
    const pista =
      resp.status === 404 && cuerpo.includes("model_not_found")
        ? ` — el modelo "${GROQ_MODEL}" ya no existe en Groq: definí GROQ_MODEL con uno vigente (GET https://api.groq.com/openai/v1/models).`
        : "";
    const err: any = new Error(
      `Groq respondió HTTP ${resp.status}: ${cuerpo.slice(0, 300)}${pista}`
    );
    err.status = resp.status;
    throw err;
  }

  const data = await resp.json();
  const raw = data?.choices?.[0]?.message?.content;
  if (typeof raw !== "string") {
    throw new Error("Groq no devolvió contenido de texto en la respuesta.");
  }

  return parsearJSON(raw, args.nombreOperacion, "Groq");
}

/**
 * Punto de entrada único usado por todas las funciones de gemini.ts. Prueba
 * cada proveedor configurado en orden hasta que uno responda; si todos
 * fallan, lanza un error agregado con el detalle de cada intento.
 */
// Claves de Gemini en orden de intento. GEMINI_API_KEY es la principal;
// las demás son respaldo ante cuota agotada (cada API key de Google AI
// Studio tiene su propio tope diario en el nivel gratuito, así que varias
// claves multiplican el tope real, no solo dan tolerancia a fallas).
// GEMINI_API_KEY_BACKUP_3 en adelante también funcionan si algún día hace
// falta una quinta clave: no hay que tocar código, sólo agregar la variable.
const VARIABLES_CLAVES_GEMINI = [
  "GEMINI_API_KEY",
  "GEMINI_API_KEY_BACKUP",
  "GEMINI_API_KEY_BACKUP_2",
  "GEMINI_API_KEY_BACKUP_3",
] as const;

function clavesGeminiConfiguradas(): { etiqueta: string; clave: string }[] {
  const extra = Object.keys(process.env)
    .filter((k) => /^GEMINI_API_KEY_BACKUP_\d+$/.test(k) && !VARIABLES_CLAVES_GEMINI.includes(k as any))
    .sort();
  return [...VARIABLES_CLAVES_GEMINI, ...extra]
    .map((variable) => ({ etiqueta: variable, clave: process.env[variable] ?? "" }))
    .filter((c) => c.clave);
}

export async function generarJSONConFallback(args: GenerarJSONArgs): Promise<any> {
  const errores: string[] = [];

  const clavesGemini = clavesGeminiConfiguradas();
  const claveGroq = process.env.GROQ_API_KEY;

  for (const { etiqueta, clave } of clavesGemini) {
    try {
      return await generarConGemini(clave, args);
    } catch (err) {
      errores.push(`Gemini (${etiqueta}): ${mensajeError(err)}`);
    }
  }

  if (claveGroq && !args.requiereVisionDocumento) {
    try {
      return await generarConGroq(claveGroq, args);
    } catch (err) {
      errores.push(`Groq (última instancia): ${mensajeError(err)}`);
    }
  } else if (claveGroq) {
    errores.push(
      "Groq (última instancia): omitido a propósito — esta operación necesita leer el PDF " +
        "visualmente y Groq no lo ve; responder con él daría un resultado vacío disfrazado de éxito."
    );
  }

  if (errores.length === 0) {
    throw new Error(
      "No hay ninguna clave de IA configurada. Define al menos GEMINI_API_KEY en las variables " +
        "de entorno (.env.local o el dashboard de Vercel). GEMINI_API_KEY_BACKUP y GROQ_API_KEY " +
        "son opcionales, pero recomendadas como respaldo ante límites de cuota."
    );
  }

  throw new Error(
    `[${args.nombreOperacion}] Los ${errores.length} proveedor(es) de IA configurados fallaron, en orden:\n` +
      errores.map((e, i) => `  ${i + 1}. ${e}`).join("\n")
  );
}
