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

const GROQ_MODEL = "llama-3.3-70b-versatile";

function esErrorTransitorio(err: any): boolean {
  const status = err?.status ?? err?.response?.status;
  return status === 503 || status === 429;
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
    const err: any = new Error(`Groq respondió HTTP ${resp.status}: ${cuerpo.slice(0, 300)}`);
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
export async function generarJSONConFallback(args: GenerarJSONArgs): Promise<any> {
  const errores: string[] = [];

  const claveGeminiPrincipal = process.env.GEMINI_API_KEY;
  const claveGeminiRespaldo = process.env.GEMINI_API_KEY_BACKUP;
  const claveGroq = process.env.GROQ_API_KEY;

  if (claveGeminiPrincipal) {
    try {
      return await generarConGemini(claveGeminiPrincipal, args);
    } catch (err) {
      errores.push(`Gemini (clave principal): ${mensajeError(err)}`);
    }
  }

  if (claveGeminiRespaldo) {
    try {
      return await generarConGemini(claveGeminiRespaldo, args);
    } catch (err) {
      errores.push(`Gemini (clave de respaldo): ${mensajeError(err)}`);
    }
  }

  if (claveGroq) {
    try {
      return await generarConGroq(claveGroq, args);
    } catch (err) {
      errores.push(`Groq (última instancia): ${mensajeError(err)}`);
    }
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
