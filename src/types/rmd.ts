// ============================================================
// Tipos compartidos del dominio RMD
// ============================================================

export type SeccionCodigo =
  | "SOLIDOS"
  | "ACONDICIONADO"
  | "CAPSULAS_BLANDAS"
  | "COSMETICOS"
  | "INY_HORMONALES"
  | "MENTHOLATUM"
  | "POLVOS_EFERVESCENTES"
  | "SEMISOLIDOS"
  | "SEMISOLIDOS_HORM"
  | "SOLIDOS_HORMONALES"
  | "SOLIDOS_4";

export type EtapaCodigo = "FABRICACION" | "RECUBRIMIENTO" | "ENVASE" | "ACONDICIONADO";

// Secciones del RMD que no son pasos numerados del procedimiento, pero que
// igual tienen una ubicación concreta en el PDF a la que se puede navegar
// (a diferencia de, por ejemplo, la tabla de insumos o el encabezado).
export type SeccionGeneral =
  | "precauciones"
  | "notas_importantes"
  | "equipos_instrumentos"
  | "condiciones_ambientales";

// Punto de destino al navegar desde una tarjeta de hallazgo hacia el visor
// de PDF: un paso numérico del procedimiento, o una sección general si el
// hallazgo no corresponde a un paso puntual.
export interface DestinoPdf {
  pasoId?: string | null;
  seccionGeneral?: SeccionGeneral | null;
  // Cita textual de lo observado dentro del paso: permite al visor resaltar
  // el fragmento exacto a corregir, no sólo el paso entero.
  textoBuscado?: string | null;
}

// ---------- Estructura extraída de un PDF (sin sección 6 de firmas) ----------

export interface EncabezadoRMD {
  producto: string;
  codigo: string;
  versionFabAlt: string;
  edicionRegManuf: number;
  estado: string;
  fechaEstado: string;
  autorizadoPor: string;
  teorico: string;
}

export interface ItemLista {
  descripcion: string;
  codigo: string;
  codigoReferencia?: string;
}

export interface InsumoItem {
  descripcion: string;
  codigo: string;
  cantidad: string;
  um: string;
}

export interface PasoProcedimiento {
  id: string; // '4.4.23'
  texto: string;
  requiereVB: boolean; // si el paso exige Visto Bueno de jefe/supervisor
  camposControl?: string[]; // ej. ['TEMPERATURA (48-58°C)', 'PRESION (34-40 psi)']
  equiposReferenciados?: string[]; // códigos de equipo mencionados en el texto
  pagina?: number; // página del PDF vigente (1-indexada) donde aparece este paso
}

// Instructivo (I), Procedimiento (P) o Formato (F) citado dentro del RMD.
// Nomenclatura fija: <Tipo:1 letra><Área:3 letras>-<letra><3 dígitos>
// ej. "IPRO-P123" (Instructivo, área Producción), "ICBL-E200" (Instructivo, área Cápsulas Blandas).
export interface DocumentoReferenciado {
  codigo: string; // código completo tal como aparece, ej. "ICBL-E200"
  tipo: "Instructivo" | "Procedimiento" | "Formato";
  area: string; // las 3 letras de área, ej. "CBL", "PRO", "ACO"
  // Paso del procedimiento donde aparece esta cita (el primero que la
  // contiene), o null si no se encontró dentro de ningún paso — permite
  // saltar y resaltar la cita exacta en el PDF si el código termina
  // marcado como obsoleto/vencido (ver detectarDocumentosObsoletosReferenciados).
  pasoId?: string | null;
}

export interface RMDExtraido {
  encabezado: EncabezadoRMD;
  precauciones: string[];
  notasImportantes: string[];
  equiposInstrumentos: ItemLista[];
  insumos: InsumoItem[];
  condicionesAmbientales: string[];
  procedimiento: PasoProcedimiento[]; // secciones 4.1 a 4.5, en orden
  especificacionesProducto?: { ensayo: string; especificacion: string }[];
  documentosReferenciados: DocumentoReferenciado[]; // instructivos/procedimientos/formatos citados
  // Página (1-indexada) donde empieza cada sección general — permite saltar
  // ahí desde una discrepancia/diferencia que no corresponde a un paso
  // numerado. Ausente si el parseo heurístico no encontró esa sección.
  paginasSeccionesGenerales: Partial<Record<SeccionGeneral, number>>;
  // La sección 6 (Verificación de Firmas) se descarta deliberadamente: no aplica a la revisión.
}

// ---------- Contrato ESTRICTO del JSON devuelto por Gemini ----------
// Este es el "schema" que se pasa como responseSchema a la API y contra el
// que se valida la respuesta antes de persistirla.

export type TipoDiscrepancia =
  | "paso_debe_agregarse"      // el CC exige un paso que el RMD vigente no tiene
  | "paso_debe_eliminarse"     // el RMD vigente tiene un paso que el CC dice retirar
  | "paso_debe_modificarse"    // el paso existe pero su contenido ya no coincide con el CC
  | "equipo_debe_agregarse"
  | "equipo_debe_eliminarse"
  | "termino_sin_homologar"    // terminología distinta a la vigente/estandarizada
  | "sin_discrepancia";

// El sistema NO redacta el texto final: tú lo editas en el BTP de SAP.
// Aquí solo se señala QUÉ está mal, DÓNDE (paso/línea exacta) y POR QUÉ,
// para que la corrección en SAP sea rápida y sin ambigüedad.
export interface DiscrepanciaDetectada {
  pasoId: string; // id del paso afectado en el RMD vigente (ej. '4.4.23'), o 'N/A' si aplica a todo el documento
  // Si pasoId es 'N/A' pero el hallazgo sí corresponde a una sección navegable
  // del PDF (Precauciones, Notas Importantes, Equipos/Instrumentos/Materiales),
  // el modelo la indica aquí para poder saltar ahí igual. null en cualquier
  // otro caso (ej. tabla de insumos, encabezado).
  seccionGeneral: SeccionGeneral | null;
  ubicacionReferencia: string; // descripción legible de dónde está, ej. "Sección 4.4, paso de Recubrimiento, línea 'TEMPERATURA DE AIRE CALIENTE'"
  tipoDiscrepancia: TipoDiscrepancia;
  textoVigenteEnRMD: string | null; // qué dice el RMD actual en ese punto (tal cual, sin reescribir)
  queExigeElControlDeCambios: string; // qué exige el CC en ese punto, citado o resumido fielmente
  justificacion: string; // por qué es una discrepancia
  origenControlCambio: string; // fragmento o referencia textual del CC que sustenta la detección
  involucraEquipoRetirado: boolean; // true si el punto en cuestión menciona un equipo marcado inactivo en el maestro
  equiposMencionados: string[];
  nivelConfianza: "alta" | "media" | "baja"; // qué tan seguro está el modelo de esta detección
}

export interface AlertaCoherencia {
  tipo:
    | "equipo_retirado_en_uso"
    | "paso_huerfano"
    | "referencia_cruzada_rota" // un paso cita a otro (ej. "según el paso 4.2.5") que no existe o cuyo contenido ya no corresponde
    | "cantidad_insumo_no_cuadra" // la suma de un insumo mencionado en el procedimiento no coincide con la cantidad de la sección 2
    | "unidad_incoherente"
    | "condicion_ambiental_contradictoria"
    | "campo_control_faltante"
    | "documento_obsoleto_referenciado" // el RMD cita un Instructivo/Procedimiento/Formato marcado como obsoleto
    | "equipo_sin_preparacion_registrada" // un equipo/instrumento/material de la sección 1 no aparece mencionado en el procedimiento (sección 4)
    | "nota_vb_faltante" // un paso exige Visto Bueno (VB) pero no incluye la nota de verificación presencial del jefe/supervisor
    | "falla_redaccion" // error gramatical, palabra mal escrita, frase incoherente o puntuación que cambia el sentido — NUNCA mayúsculas ni tildes
    | "otro";
  descripcion: string;
  pasosAfectados: string[];
  severidad: "critica" | "alta" | "media" | "baja";
  // Destino de navegación en el PDF para poder saltar y resaltar la alerta
  // en amarillo, igual que un paso o una sección general (ver DestinoPdf) —
  // sólo se completan para los tipos donde tiene sentido señalar un punto
  // exacto (falla_redaccion, equipo_retirado_en_uso,
  // equipo_sin_preparacion_registrada, documento_obsoleto_referenciado);
  // en el resto quedan en null y la tarjeta no es clickeable.
  pasoId?: string | null;
  seccionGeneral?: SeccionGeneral | null;
  // Cita textual EXACTA (tal como aparece en el RMD) del fragmento con el
  // problema, para que el visor resalte esa línea puntual en vez de todo
  // el paso/sección — mismo mecanismo que textoBuscado en DiscrepanciaDetectada.
  citaTextual?: string | null;
}

export interface ResultadoRevisionIA {
  resumenEjecutivo: string;
  seccionDetectada: SeccionCodigo | "NO_IDENTIFICADA";
  etapaDetectada: EtapaCodigo | "NO_IDENTIFICADA";
  discrepanciasDetectadas: DiscrepanciaDetectada[];
  alertasCoherencia: AlertaCoherencia[];
  equiposRetiradosDetectados: string[]; // códigos de equipo que el CC marca como retirados
  camposObligatoriosFaltantes: string[]; // ej. 'VERIFICADO POR', 'FECHA/HORA FINAL' sin casilla
  scoreCoherencia: number; // 0-100
  requiereRevisionHumana: boolean;
  // Título y fecha de vencimiento (maestro de documentos vigentes) de cada
  // documentosReferenciados que se pudo cruzar, por código — para mostrarlo
  // sutilmente junto a cada cita sin otra consulta desde el cliente.
  documentosVigentesInfo?: Record<string, InfoVigenciaDocumento>;
  // Estado de calificación (maestro de equipos calificados) de cada código
  // de equiposInstrumentos que se pudo cruzar, por código.
  equiposCalificacionInfo?: Record<string, InfoCalificacionEquipo>;
}

// ---------- Comparación RMD vigente vs. borrador enviado por Producción ----------
// A diferencia del Control de Cambio (una instrucción de qué cambiar), aquí se
// comparan dos documentos RMD completos directamente: el vigente (autorizado hoy)
// contra el borrador que Producción propone como próxima versión.

export type TipoDiferenciaBorrador =
  | "paso_agregado_en_borrador" // el borrador tiene un paso que el vigente no tiene
  | "paso_eliminado_en_borrador" // el vigente tiene un paso que el borrador ya no incluye
  | "paso_modificado" // el paso existe en ambos pero el texto/condiciones cambiaron
  | "paso_renumerado" // mismo contenido, distinto identificador (ej. 4.2.5 -> 4.2.7)
  | "equipo_agregado"
  | "equipo_eliminado"
  | "insumo_agregado"
  | "insumo_eliminado"
  | "termino_sin_homologar" // texto que viola una regla permanente de homologación
  | "sin_diferencia";
  // NOTA: deliberadamente NO existe "encabezado_modificado" — el usuario pidió
  // que el encabezado (código, versión, edición, estado, teórico) no se analice.

export interface DiferenciaBorrador {
  pasoIdVigente: string | null; // id del paso en el RMD vigente, o null si no existe ahí
  pasoIdBorrador: string | null; // id del paso en el borrador, o null si no existe ahí
  // Si ninguno de los dos ids anteriores aplica pero la diferencia sí
  // corresponde a una sección navegable del RMD vigente (Precauciones, Notas
  // Importantes, Equipos/Instrumentos/Materiales), se indica aquí. null en
  // cualquier otro caso.
  seccionGeneral: SeccionGeneral | null;
  ubicacionReferencia: string; // descripción legible de dónde está el cambio
  tipoDiferencia: TipoDiferenciaBorrador;
  textoEnVigente: string | null; // cita fiel de lo que dice el RMD vigente en ese punto
  textoEnBorrador: string | null; // cita fiel de lo que dice el borrador en ese punto
  justificacion: string; // por qué se marca como diferencia
  involucraEquipoRetirado: boolean; // true si el punto menciona un equipo inactivo en el maestro
  equiposMencionados: string[];
  nivelConfianza: "alta" | "media" | "baja";
  // true si la evidencia viene de una anotación manuscrita, texto sobrepuesto en otro color
  // con un editor de PDF, o cualquier contenido que no sea texto impreso original —
  // requiere verificación adicional del analista porque la lectura es menos confiable.
  origenAnotacionInformal: boolean;
}

export interface ResultadoComparacionBorrador {
  resumenEjecutivo: string;
  seccionDetectada: SeccionCodigo | "NO_IDENTIFICADA";
  etapaDetectada: EtapaCodigo | "NO_IDENTIFICADA";
  diferenciasDetectadas: DiferenciaBorrador[];
  alertasCoherencia: AlertaCoherencia[];
  equiposRetiradosDetectados: string[];
  coincidenciaPorcentaje: number; // 0-100, qué tan parecidos son ambos documentos
  requiereRevisionHumana: boolean;
  documentosVigentesInfo?: Record<string, InfoVigenciaDocumento>;
  equiposCalificacionInfo?: Record<string, InfoCalificacionEquipo>;
}

// ---------- Reglas permanentes de homologación ----------
// Instrucciones fijas definidas una sola vez por el usuario (ej. "X debe
// reemplazarse por Y") que se aplican automáticamente en TODAS las revisiones
// futuras de la sección/etapa que indiquen, sin repetirlas en cada Control de
// Cambios. seccionCodigo/etapaCodigo en null significa "aplica a todas".

export interface ReglaHomologacion {
  id: string;
  texto: string;
  seccionCodigo: SeccionCodigo | null;
  etapaCodigo: EtapaCodigo | null;
  activa: boolean;
  creadoPor?: string | null;
  createdAt?: string;
}

// ---------- Documentos obsoletos ----------
// Maestro de códigos de Instructivo/Procedimiento/Formato (nomenclatura
// <I/P/F><área:3 letras>-<letra><3 dígitos>, ej. "IPRO-P200") marcados como
// ya no vigentes. Si un RMD en revisión sigue citando alguno, se genera una
// alertaCoherencia "documento_obsoleto_referenciado" automáticamente.

export interface DocumentoObsoleto {
  id: string;
  codigo: string; // ej. "IPRO-P200"
  motivo?: string | null;
  activo: boolean;
  creadoPor?: string | null;
  createdAt?: string;
}

// ---------- Documentos vigentes (maestro importado desde Excel) ----------
// A diferencia de DocumentoObsoleto (carga manual, caso por caso), este es
// el listado COMPLETO de documentos que la empresa mantiene, importado en
// bloque. Es la fuente principal para saber si un documento sigue vigente
// (vigenteHasta ya pasó o no); documentos_obsoletos queda como respaldo
// secundario para casos que este maestro no cubra.

export interface DocumentoVigente {
  id: string;
  codigo: string; // ej. "FACO-200"
  titulo: string;
  categoria?: string | null;
  revision?: string | null;
  fechaEmision?: string | null; // ISO date
  vigenteHasta?: string | null; // ISO date; null = sin fecha de vencimiento conocida
  actualizadoEn?: string;
}

// Info resumida de vigencia para un documento referenciado en un RMD, tal
// como se adjunta al resultado de una revisión para que la UI la muestre
// sutilmente junto al código (título + hasta cuándo vale), sin necesidad de
// otra consulta desde el cliente.
export interface InfoVigenciaDocumento {
  titulo: string;
  vigenteHasta: string | null;
  vencido: boolean;
}

// ---------- Equipos calificados (maestro importado desde Excel) ----------
// Estado de calificación (OQ/PQ) de cada equipo por su Código SAP, importado
// en bloque desde la hoja "Cronograma" del Excel de Registro de Áreas/
// Sistemas/Equipos a Calificar. Se cruza contra los códigos citados en la
// sección EQUIPOS/INSTRUMENTOS/MATERIALES del RMD: "CALIFICADO" es lo
// esperado, cualquier otro estado genera una alerta.

export interface EquipoCalificado {
  id: string;
  codigoSap: string;
  descripcion?: string | null;
  estado: string; // ej. "CALIFICADO", "PENDIENTE", "EN PROCESO", "INOPERATIVO", "NO CUMPLE"
  actualizadoEn?: string;
}

// Igual que InfoVigenciaDocumento pero para equipos: se adjunta al
// resultado de la revisión para que la UI muestre el estado real sin otra
// consulta desde el cliente.
export interface InfoCalificacionEquipo {
  estado: string;
  calificado: boolean; // true sólo si estado === "CALIFICADO"
}

// ---------- Verificación de corrección (subir RMD corregido) ----------
// El analista corrige el RMD directamente en SAP (BTP) y sube el PDF ya
// corregido. Esto NO vuelve a correr el análisis desde cero: verifica,
// hallazgo por hallazgo de la revisión original, si el documento corregido
// ya lo resuelve — evidencia concreta, no una opinión genérica.

// Hallazgo resumido que se envía a Gemini para verificar: "id" es el índice
// del hallazgo dentro del array original (discrepanciasDetectadas o
// diferenciasDetectadas) tal como estaba en el momento del análisis — sirve
// para volver a enlazar la verificación con la tarjeta correcta en la UI.
export interface HallazgoAVerificar {
  id: number;
  ubicacionReferencia: string;
  descripcion: string;
}

export interface VerificacionHallazgo {
  id: number;
  resuelto: boolean;
  justificacion: string; // qué dice AHORA el RMD corregido en ese punto (evidencia, no opinión)
}

export interface ResultadoVerificacionCorreccion {
  resumenVerificacion: string;
  verificaciones: VerificacionHallazgo[];
}

// ---------- Comparación contra un RMD de referencia (homologación) ----------
// A diferencia de comparar contra un borrador (misma versión del MISMO RMD,
// antes/después) o un Control de Cambio (una instrucción puntual), acá se
// comparan dos RMD DISTINTOS — el que se está evaluando y otro que se toma
// como referencia/modelo (ej. de una línea o producto ya estandarizado) —
// para encontrar pasos con estructura/contenido equivalente y sugerir
// homologar redacción, orden o estructura. No todo paso tiene un
// equivalente razonable en el otro documento: la IA debe usar criterio para
// no forzar homologaciones entre pasos que en realidad son distintos.

export type TipoHomologacionReferencia =
  | "redaccion_puede_homologarse" // el paso existe en ambos con el mismo propósito pero la redacción difiere — se sugiere alinear el texto al de la referencia
  | "paso_faltante_en_rmd" // la referencia tiene un paso equivalente que el RMD evaluado no tiene — se sugiere incluirlo
  | "paso_sobrante_en_rmd" // el RMD evaluado tiene un paso que la referencia no contempla — se sugiere evaluar si corresponde eliminarlo
  | "orden_distinto"; // ambos documentos tienen pasos equivalentes pero en otro orden — se sugiere reordenar

export interface SugerenciaHomologacionReferencia {
  pasoIdRmd: string | null; // paso del RMD evaluado, o null si el paso no existe ahí (hay que incluirlo)
  pasoIdReferencia: string | null; // paso equivalente en la referencia, o null si no tiene equivalente (hay que evaluar eliminarlo)
  seccionGeneral: SeccionGeneral | null; // si la sugerencia no es un paso puntual sino una sección general navegable
  tipo: TipoHomologacionReferencia;
  accionSugerida: "incluir" | "modificar" | "eliminar" | "reordenar";
  textoEnRmd: string | null; // cita fiel de lo que dice hoy el RMD evaluado en ese punto
  textoEnReferencia: string | null; // cita fiel de lo que dice la referencia en su paso equivalente
  justificacion: string; // por qué se sugiere homologar (o no), con criterio — no forzar equivalencias forzadas
  nivelConfianza: "alta" | "media" | "baja";
}

export interface ResultadoComparacionReferencia {
  resumenEjecutivo: string;
  seccionDetectada: SeccionCodigo | "NO_IDENTIFICADA";
  etapaDetectada: EtapaCodigo | "NO_IDENTIFICADA";
  sugerenciasHomologacion: SugerenciaHomologacionReferencia[];
  gradoHomologacion: number; // 0-100, qué tan alineada está la estructura/redacción del RMD con la referencia
  requiereRevisionHumana: boolean;
}
