/**
 * Lee una respuesta de fetch como JSON, sin asumir que SIEMPRE lo es.
 *
 * Hasta ahora, cada llamada a una ruta propia hacía `await res.json()`
 * directo, confiando en que el servidor siempre respondía con el
 * `{ error: "..." }` que arman nuestras propias rutas. Eso se rompe cuando
 * la respuesta viene de la PLATAFORMA de hosting en vez de nuestro código —
 * el caso típico es un timeout de la función serverless (documentos
 * escaneados largos pueden tardar varios minutos en el OCR): Vercel corta
 * la ejecución y devuelve su propia página de error en texto plano/HTML
 * ("An error occurred with your deployment..."), no JSON. `JSON.parse` de
 * eso revienta con "Unexpected token 'A'... is not valid JSON" — un mensaje
 * que no le dice nada al usuario sobre qué pasó en realidad.
 *
 * Se usa en TODOS los `fetch` a rutas propias, tanto para respuestas OK
 * como de error: cualquiera de las dos puede venir de la plataforma en vez
 * de nuestro código si el corte pasó antes de que nuestra ruta respondiera.
 */
export async function leerRespuestaApi(res: Response): Promise<any> {
  const texto = await res.text();
  try {
    return JSON.parse(texto);
  } catch {
    const pareceTimeout =
      res.status === 504 ||
      res.status === 502 ||
      /timeout|timed out|FUNCTION_INVOCATION/i.test(texto);
    const mensaje = pareceTimeout
      ? "El servidor tardó demasiado en responder — típico con documentos escaneados largos o " +
        "con la IA con alta demanda. Probá con un documento más chico, o esperá un momento y " +
        "volvé a intentarlo."
      : `El servidor devolvió una respuesta inesperada (HTTP ${res.status}): ` +
        `${texto.trim().slice(0, 200) || "(respuesta vacía)"}`;
    throw new Error(mensaje);
  }
}
