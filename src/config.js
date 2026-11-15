// ─────────────────────────── Configuración ───────────────────────────
export const VERSION = typeof __VERSION__ !== 'undefined' ? __VERSION__ : 'dev';

export const CONFIG = {
  fallbackEngine: true,       // false = solo leer las líneas que muestra chess.com
  keepAnalysisOnWhileWatching: true, // al mirar partidas, vuelve a encender el switch Analysis si chess.com lo apaga (p. ej. en una revancha)
  // Fair play: el motor propio solo corre si el tablero está en uno de estos modos.
  // Si el modo no se puede leer (chess.com cambió su API) el motor NO arranca.
  fairPlayModes: ['analysis', 'observing', 'review'],
  // Estos se cambian también desde el panel de ajustes y se recuerdan en el navegador
  multiPv: 3,                 // flechas: líneas que calcula el motor propio y máximo que se dibuja (1-5)
  maxDepth: 18,               // el motor propio se detiene al llegar a esta profundidad...
  maxTimeMs: 8000,            // ...o tras este tiempo por posición (lo que ocurra primero)
  hashMb: 16,                 // memoria (tabla hash) del motor propio, en MB
  arrowStyle: 'chesscom',     // 'color' = colores numerados; 'chesscom' = naranja como chess.com; 'lichess' = azul y gris
  scoresWatch: true,          // evaluación junto a cada flecha donde chess.com NO lista líneas (Watch)
  scoresWithLines: false,     // lo mismo donde chess.com SÍ lista sus líneas (Events, Análisis)
  ownEngineOnly: false,       // true = todas las flechas del motor propio; las líneas de chess.com solo se usan mientras calcula
  showReply: false,           // flecha gris con la respuesta esperada del rival a la mejor jugada
  hideWorseBy: 0,             // oculta las flechas que pierden más de estos centipeones frente a la mejor (0 = no ocultar)
  widthByEval: false,         // el grosor de cada flecha depende de cuánto pierde frente a la mejor (como Lichess)
  followChessComDepth: true,  // el motor propio busca hasta la profundidad que muestra chess.com (ignora máx. y tiempo; tope 40 / 60 s)
  pvOnHover: false,           // al pasar el ratón por la casilla de destino de una flecha se ve su variante
  ownGearButton: false,       // true = además, engranaje propio flotante en la esquina del tablero
  hideAtGameEnd: true,        // sin flechas en la posición final de una partida terminada
  hotkey: 'a',                // Alt + esta tecla oculta o muestra las flechas ('' = sin atajo)
  showDepthTag: true,         // muestra la profundidad del motor propio junto al "depth=N" de chess.com
  minDepthToDraw: 8,          // no dibujar hasta esta profundidad (evita flechas que saltan)
  graceEngineSeenMs: 100,     // espera cuando el motor de chess.com ya trabaja y la página no tiene panel de líneas
  graceNoPanelMs: 1000,       // espera máxima antes de usar el motor si la página no tiene panel de líneas
  graceEmptyPanelMs: 3000,    // espera si el panel de líneas existe pero está vacío
  engineBootTimeoutsMs: [2500, 6000, 12000], // si el worker no responde se reintenta con más margen; luego se pasa al siguiente
  engineStopTimeoutMs: 700,   // si el motor no deja la búsqueda anterior en este tiempo, se reinicia el worker
  engineSilenceMs: 1500,      // si tras pedir un análisis el motor no dice nada en este tiempo, se reinicia el worker
  engineIdleKillMs: 60000,    // apaga el worker del motor tras este tiempo sin usarse
  debug: false                // true = mensajes detallados en la consola
};

export const ARROW_CONFIG = [
  { rank: 1, color: '#00d26a', headColor: '#00b058', opacity: 0.88, width: 3.2, labelBg: '#00d26a' },
  { rank: 2, color: '#38bdf8', headColor: '#0284c7', opacity: 0.78, width: 2.6, labelBg: '#0284c7' },
  { rank: 3, color: '#fb923c', headColor: '#ea580c', opacity: 0.68, width: 2.2, labelBg: '#fb923c' },
  { rank: 4, color: '#a78bfa', headColor: '#7c3aed', opacity: 0.62, width: 2.0, labelBg: '#7c3aed' },
  { rank: 5, color: '#f472b6', headColor: '#db2777', opacity: 0.58, width: 1.8, labelBg: '#db2777' }
];

// Ajustes que el usuario puede mover desde el panel; se guardan en localStorage
export const SETTINGS_KEY = 'top3arrows_settings';
export const HASH_STEPS = [16, 32, 64, 128, 256, 512];
export const SETTING_DEFS = [
  { key: 'multiPv', min: 1, max: 5, step: 1, fmt: v => String(v) },
  { key: 'maxTimeMs', min: 1000, max: 30000, step: 1000, fmt: v => (v / 1000) + ' s' },
  { key: 'maxDepth', min: 10, max: 40, step: 1, fmt: v => String(v) },
  { key: 'hashMb', values: HASH_STEPS, fmt: v => v + ' MB' },
  { key: 'hideWorseBy', values: [0, 50, 100, 150, 200, 300], fmt: v => v ? (v / 100).toFixed(1) : '—' }
];
export const BOOL_SETTINGS = ['scoresWatch', 'scoresWithLines', 'showReply', 'ownEngineOnly', 'widthByEval', 'pvOnHover', 'followChessComDepth'];
export const ARROW_STYLES = ['chesscom', 'color', 'lichess'];
export const SETTING_DEFAULTS = {
  multiPv: 3, maxTimeMs: 8000, maxDepth: 18, hashMb: 16, hideWorseBy: 0,
  ownEngineOnly: false, scoresWatch: true, scoresWithLines: false, showReply: false,
  widthByEval: false, pvOnHover: false, followChessComDepth: true, arrowStyle: 'chesscom'
};
// Ajustes que cambian lo que calcula el motor (los demás solo cambian el dibujo)
export const ENGINE_SETTINGS = ['multiPv', 'maxTimeMs', 'maxDepth', 'hashMb', 'followChessComDepth'];

export function isValidSetting(def, v) {
  if (typeof v !== 'number' || !isFinite(v)) return false;
  return def.values ? def.values.indexOf(v) !== -1 : (v >= def.min && v <= def.max && v % def.step === 0);
}

export function applySavedSettings(target, saved) {
  if (!saved || typeof saved !== 'object') return;
  SETTING_DEFS.forEach(def => { if (isValidSetting(def, saved[def.key])) target[def.key] = saved[def.key]; });
  BOOL_SETTINGS.forEach(k => { if (typeof saved[k] === 'boolean') target[k] = saved[k]; });
  if (ARROW_STYLES.indexOf(saved.arrowStyle) !== -1) target.arrowStyle = saved.arrowStyle;
}

export function loadSettings() {
  try { applySavedSettings(CONFIG, JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null')); }
  catch (e) { /* ajustes dañados o sin almacenamiento: quedan los de CONFIG */ }
}

export function saveSettings() {
  try {
    const out = {};
    SETTING_DEFS.forEach(def => { out[def.key] = CONFIG[def.key]; });
    BOOL_SETTINGS.forEach(k => { out[k] = !!CONFIG[k]; });
    out.arrowStyle = CONFIG.arrowStyle;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(out));
  } catch (e) { /* sin almacenamiento: duran hasta recargar */ }
}

const SF19_JS_SRI = 'sha384-pClHpoYzU9B1wX2kT00j+V2XlzmcDQIcmB3Nd52uMUM9kTU7s6Uu3t5MxVO7sQcv';
const SF19_WASM_SRI = 'sha384-DvvftEPxgCzGbRwiixCoW4FasRWXnos4yh1FKhm4JUE3SPhNfpMEE1lVCBV0wlVf';

// Compilación para tiendas de extensiones (Firefox AMO): no puede descargar código de fuera del paquete.
export const IS_STORE_BUILD = __STORE_BUILD__ === true; // lo define esbuild (y vitest.config.js en los tests)

// Stockfish 19 lite incluido en la extensión (carpeta engine/). bridge.js, que corre en el contexto
// de la extensión, publica en <html data-top3arrows-engine-base> la URL de esa carpeta. La página
// podría falsear ese atributo, pero los archivos se verifican por hash antes de usarse.
export const BUNDLED_ENGINE = {
  label: 'Stockfish 19 lite (bundled)',
  baseAttr: 'data-top3arrows-engine-base',
  js: 'stockfish-19-lite-single.js',
  jsIntegrity: SF19_JS_SRI,
  wasm: 'stockfish-19-lite-single.wasm',
  wasmIntegrity: SF19_WASM_SRI
};

// Motores de reserva si no se encuentra el Stockfish de chess.com (versiones fijas, verificadas por hash).
// Se prueban en este orden. No existen en la compilación para tiendas.
export const CDN_ENGINES = __STORE_BUILD__ === true ? [] : [
  {
    label: 'Stockfish 19 lite (unpkg)',
    js: 'https://unpkg.com/stockfish@19.0.1/bin/stockfish-19-lite-single.js',
    jsIntegrity: SF19_JS_SRI,
    wasm: 'https://unpkg.com/stockfish@19.0.1/bin/stockfish-19-lite-single.wasm',
    wasmIntegrity: SF19_WASM_SRI
  },
  {
    label: 'stockfish.js 10.0.2 (cdnjs)',
    js: 'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js',
    jsIntegrity: 'sha384-VtbI9eXlyH0iLETxBo+yJZD0egEZcin9R4ntQlcrrKjRYSTQmdhoiY/jGV9SGw4Q'
  }
];

export const OVERLAY_ID = 'chess-top3-hybrid-arrows-overlay';
export const SVG_NS = 'http://www.w3.org/2000/svg';
export const TAG = '[Top3 Arrows]';
