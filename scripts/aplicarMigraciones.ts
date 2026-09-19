// Aplica las migraciones de supabase/migrations/ directamente contra la base
// de datos del proyecto, en orden y una sola vez cada una:
//
//   npm run db:push              aplica lo que falte
//   npm run db:push -- --estado  solo informa qué está aplicado y qué falta
//   npm run db:push -- --force   reaplica todas (son idempotentes)
//   npm run db:push -- --sql     imprime el SQL completo sin conectarse
//
// Existe para no tener que abrir el SQL Editor y pegar archivo por archivo.
// Lleva su propia tabla de control (_migraciones_aplicadas), así que se puede
// correr las veces que sea: reconoce lo ya aplicado y no lo repite.
//
// Necesita SUPABASE_DB_URL en .env.local (la cadena de conexión a Postgres,
// NO la URL de la API ni la Service Role Key). Dashboard de Supabase →
// Project Settings → Database → Connection string → URI.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

const CARPETA_MIGRACIONES = path.join(process.cwd(), "supabase", "migrations");
const TABLA_CONTROL = "_migraciones_aplicadas";

const USO = `Uso: npm run db:push [-- --estado | --force | --sql]

  (sin flags)  aplica las migraciones pendientes
  --estado     lista qué está aplicado y qué falta, sin cambiar nada
  --force      reaplica todas las migraciones (son idempotentes)
  --sql        imprime el SQL completo por stdout, sin conectarse a nada
               (útil para pegarlo a mano si no tenés la cadena de conexión)

Requiere SUPABASE_DB_URL en .env.local:
  Supabase → Project Settings → Database → Connection string → URI
  Reemplazá [YOUR-PASSWORD] por la contraseña de la base (si no la tenés,
  se resetea en esa misma página — no es la Service Role Key).`;

/**
 * Lee .env.local sin depender de dotenv. Next.js lo carga solo para la app;
 * un script suelto no lo ve, y no vale la pena sumar una dependencia para
 * parsear pares clave=valor.
 */
function cargarEnvLocal(): void {
  for (const archivo of [".env.local", ".env"]) {
    const ruta = path.join(process.cwd(), archivo);
    if (!existsSync(ruta)) continue;
    for (const linea of readFileSync(ruta, "utf8").split("\n")) {
      const limpia = linea.trim();
      if (!limpia || limpia.startsWith("#")) continue;
      const separador = limpia.indexOf("=");
      if (separador === -1) continue;
      const clave = limpia.slice(0, separador).trim();
      let valor = limpia.slice(separador + 1).trim();
      // Los valores entre comillas son válidos en un .env y las comillas no
      // son parte del valor.
      if (
        (valor.startsWith('"') && valor.endsWith('"')) ||
        (valor.startsWith("'") && valor.endsWith("'"))
      ) {
        valor = valor.slice(1, -1);
      }
      // Lo que ya venga del entorno real manda sobre el archivo.
      if (process.env[clave] === undefined) process.env[clave] = valor;
    }
  }
}

interface Migracion {
  nombre: string;
  sql: string;
}

function leerMigraciones(): Migracion[] {
  if (!existsSync(CARPETA_MIGRACIONES)) {
    throw new Error(`No existe la carpeta ${CARPETA_MIGRACIONES}.`);
  }
  // El prefijo numérico (0001_, 0002_, …) define el orden y el orden importa:
  // 0002 toca una tabla que crea 0001.
  const archivos = readdirSync(CARPETA_MIGRACIONES)
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b, "en"));

  if (archivos.length === 0) {
    throw new Error(`No hay ningún .sql en ${CARPETA_MIGRACIONES}.`);
  }

  return archivos.map((nombre) => ({
    nombre,
    sql: readFileSync(path.join(CARPETA_MIGRACIONES, nombre), "utf8"),
  }));
}

const SQL_TABLA_CONTROL = `create table if not exists ${TABLA_CONTROL} (
  nombre      text primary key,
  aplicada_en timestamptz not null default now()
);
alter table ${TABLA_CONTROL} enable row level security;`;

/** Volcado pegable en el SQL Editor, con el registro de control incluido. */
function imprimirSql(migraciones: Migracion[]): void {
  console.log("-- ============================================================");
  console.log("-- Esquema completo de RMD Reviewer, generado por npm run db:push -- --sql");
  console.log(`-- ${migraciones.length} migraciones, en orden. Todo es idempotente:`);
  console.log("-- se puede ejecutar entero más de una vez sin romper nada.");
  console.log("-- ============================================================\n");
  console.log(SQL_TABLA_CONTROL + "\n");

  for (const { nombre, sql } of migraciones) {
    console.log(`-- ============ ${nombre} ============`);
    console.log(sql.trim());
    console.log(
      `insert into ${TABLA_CONTROL} (nombre) values ('${nombre}') on conflict (nombre) do nothing;\n`
    );
  }
}

/**
 * Supabase sirve Postgres por TLS con un certificado que Node no tiene en su
 * almacén, así que la verificación se desactiva y la conexión igual va
 * cifrada. Para verificarlo de verdad, descargá el certificado de la CA
 * (Project Settings → Database → SSL configuration) y apuntá SUPABASE_DB_CA
 * a ese archivo.
 */
function configuracionSsl(cadena: string): { ca: string } | { rejectUnauthorized: false } | false {
  // Un `sslmode=disable` explícito en la cadena manda: sirve para apuntar a
  // un Postgres local (una copia de la base para probar una migración antes
  // de tocar el proyecto real), que no habla TLS.
  if (/[?&]sslmode=disable\b/i.test(cadena)) return false;
  const rutaCa = process.env.SUPABASE_DB_CA;
  if (rutaCa) return { ca: readFileSync(rutaCa, "utf8") };
  return { rejectUnauthorized: false };
}

function explicarFalloConexion(err: any): string {
  const codigo = err?.code ?? "";
  const mensaje = err?.message ?? String(err);
  if (codigo === "ENOTFOUND" || codigo === "EAI_AGAIN") {
    return `no se resolvió el host de la cadena de conexión (${mensaje}). Revisá que SUPABASE_DB_URL sea la URI de Project Settings → Database.`;
  }
  if (codigo === "28P01") {
    return "la contraseña de la base es incorrecta. Reseteala en Project Settings → Database y actualizá SUPABASE_DB_URL (no es la Service Role Key).";
  }
  if (codigo === "ECONNREFUSED" || codigo === "ETIMEDOUT") {
    return `no se pudo abrir la conexión (${mensaje}). Si estás en una red que bloquea el puerto 5432, usá la cadena del "Session pooler" de esa misma página.`;
  }
  return mensaje;
}

async function aplicar(migraciones: Migracion[], forzar: boolean, soloEstado: boolean): Promise<number> {
  const cadena = process.env.SUPABASE_DB_URL;
  if (!cadena) {
    console.error(
      "Falta SUPABASE_DB_URL en .env.local.\n\n" +
        "Es la cadena de conexión a Postgres, distinta de SUPABASE_URL (la API) y de\n" +
        "SUPABASE_SERVICE_ROLE_KEY. Se saca de:\n\n" +
        "  Supabase → Project Settings → Database → Connection string → URI\n\n" +
        "y se ve así (reemplazando [YOUR-PASSWORD] por la contraseña de la base):\n\n" +
        "  SUPABASE_DB_URL=postgresql://postgres:[YOUR-PASSWORD]@db.<ref>.supabase.co:5432/postgres\n\n" +
        "Si no querés usar la cadena de conexión, corré `npm run db:push -- --sql`\n" +
        "y pegá esa salida una única vez en el SQL Editor."
    );
    return 1;
  }

  const cliente = new Client({ connectionString: cadena, ssl: configuracionSsl(cadena) });

  try {
    await cliente.connect();
  } catch (err: any) {
    console.error(`No se pudo conectar a la base: ${explicarFalloConexion(err)}`);
    return 1;
  }

  try {
    await cliente.query(SQL_TABLA_CONTROL);
    const { rows } = await cliente.query<{ nombre: string }>(
      `select nombre from ${TABLA_CONTROL}`
    );
    const yaAplicadas = new Set(rows.map((r) => r.nombre));

    if (soloEstado) {
      console.log(`\nEstado de las migraciones (${migraciones.length} en total):\n`);
      for (const { nombre } of migraciones) {
        console.log(`  ${yaAplicadas.has(nombre) ? "aplicada " : "PENDIENTE"}  ${nombre}`);
      }
      const pendientes = migraciones.filter((m) => !yaAplicadas.has(m.nombre)).length;
      console.log(
        pendientes === 0
          ? "\nLa base está al día.\n"
          : `\nFaltan ${pendientes}. Corré \`npm run db:push\` para aplicarlas.\n`
      );
      return 0;
    }

    let aplicadas = 0;
    for (const { nombre, sql } of migraciones) {
      if (yaAplicadas.has(nombre) && !forzar) {
        console.log(`  ya estaba   ${nombre}`);
        continue;
      }
      try {
        // Postgres hace DDL transaccional, así que si una migración falla a
        // mitad no queda aplicada por partes.
        await cliente.query("begin");
        await cliente.query(sql);
        await cliente.query(
          `insert into ${TABLA_CONTROL} (nombre) values ($1) on conflict (nombre) do nothing`,
          [nombre]
        );
        await cliente.query("commit");
        console.log(`  aplicada    ${nombre}`);
        aplicadas++;
      } catch (err: any) {
        await cliente.query("rollback").catch(() => {});
        console.error(`\nFalló ${nombre} y se revirtió: ${err?.message ?? err}`);
        console.error("Las migraciones anteriores quedaron aplicadas; corregí esta y volvé a correr.");
        return 1;
      }
    }

    console.log(
      aplicadas === 0
        ? "\nNo había nada pendiente: la base ya estaba al día.\n"
        : `\nListo: ${aplicadas} migración(es) aplicada(s).\n`
    );
    return 0;
  } finally {
    await cliente.end().catch(() => {});
  }
}

async function main(): Promise<void> {
  const banderas = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));

  if (banderas.has("--help") || banderas.has("-h")) {
    console.log(USO);
    process.exit(0);
  }

  cargarEnvLocal();

  let migraciones: Migracion[];
  try {
    migraciones = leerMigraciones();
  } catch (err: any) {
    console.error(err?.message ?? err);
    process.exit(1);
    return;
  }

  if (banderas.has("--sql")) {
    imprimirSql(migraciones);
    process.exit(0);
  }

  process.exit(await aplicar(migraciones, banderas.has("--force"), banderas.has("--estado")));
}

main();
