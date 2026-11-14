// ─────────────────────────── Fair play ───────────────────────────
// El motor propio solo corre donde chess.com mismo ofrece análisis: su switch "Analysis" debe existir
// y estar encendido, y el tablero debe estar en un modo conocido de análisis u observación.
// Ante cualquier duda (API desconocida, modo ilegible) NO se analiza: falla cerrado.
import { CONFIG } from './config.js';
import { SEL } from './selectors.js';
import { getGame, getModeName, isRealBoard } from './board.js';
import { diag, log } from './log.js';

// En la vista Play/Watch el switch Analysis solo existe en la subpestaña de movimientos: al pasar
// a Chat chess.com lo quita de la página aunque el análisis siga encendido. Si la última vez que se
// vio estaba encendido y chess.com sigue mostrando su barra de evaluación, se considera encendido.
let lastSwitchOn = false;

function analysisSwitch() {
  return document.querySelector(SEL.analysisSwitch) || document.querySelector(SEL.watchSwitch);
}

function switchHiddenButOn() {
  return lastSwitchOn && document.querySelector(SEL.evalBar) !== null;
}

export function isWatching(boardEl) {
  return getModeName(boardEl) === 'observing';
}

// ¿Está encendido el análisis de chess.com? Solo cuenta su switch real (ya no cualquier interruptor de la página).
export function isAnalysisActive(boardEl) {
  const toggle = analysisSwitch();
  if (toggle) { lastSwitchOn = toggle.checked; return toggle.checked; }
  return switchHiddenButOn() && isWatching(boardEl);
}

let lastBlockReason = '';
function blocked(reason, extra) {
  if (reason !== lastBlockReason) { lastBlockReason = reason; diag('engineBlocked', Object.assign({ reason }, extra || {})); log('motor propio bloqueado:', reason); }
  return false;
}

export function isFallbackAllowed(boardEl) {
  if (!CONFIG.fallbackEngine) return blocked('disabled');
  const toggle = analysisSwitch();
  // Con el switch oculto (pestaña Chat, etc.) solo se sigue si se está mirando una partida ajena
  if (toggle ? !toggle.checked : !(switchHiddenButOn() && isWatching(boardEl))) return blocked('switchOff');
  // Solo sobre el tablero real, no sobre el marcador que chess.com pinta mientras carga la página
  if (!isRealBoard(boardEl)) return blocked('noBoard');
  const game = getGame(boardEl);
  if (!game) return blocked('noGameApi');
  const mode = getModeName(boardEl);
  if (!mode) return blocked('unknownMode');
  if (CONFIG.fairPlayModes.indexOf(mode) === -1) return blocked('mode', { mode });
  try {
    const variant = typeof game.getVariant === 'function' ? game.getVariant() : null;
    if (variant !== 'chess') return blocked('variant', { variant: String(variant) }); // solo ajedrez estándar
  } catch (e) { return blocked('variantError'); }
  lastBlockReason = '';
  return true;
}

// ─────────────────────────── Mantener Analysis encendido al mirar partidas ───────────────────────────
// chess.com apaga su switch Analysis cuando empieza otra partida (p. ej. una revancha). Si la última vez
// el usuario lo dejó encendido, se vuelve a encender solo, y únicamente mientras se mira una partida ajena.
const KEEP_KEY = 'top3arrows_keep_analysis';
let keepPref = null; // true = el usuario lo dejó encendido, false = lo apagó, null = todavía no eligió
try {
  const saved = localStorage.getItem(KEEP_KEY);
  keepPref = saved === '1' ? true : (saved === '0' ? false : null);
} catch (e) { /* sin almacenamiento */ }
let userSwitchClickAt = 0;
let lastAutoClickAt = 0;
let failedAutoClicks = 0;

export function getKeepPref() { return keepPref; }

export function noteUserSwitchClick() { userSwitchClickAt = Date.now(); }

export function noteSwitchChange(checked) {
  if (Date.now() - userSwitchClickAt < 800) {
    keepPref = !!checked;
    try { localStorage.setItem(KEEP_KEY, keepPref ? '1' : '0'); } catch (e) { /* sin almacenamiento */ }
  }
}

export function keepAnalysisOn(boardEl, prewarm) {
  if (!CONFIG.keepAnalysisOnWhileWatching || keepPref !== true) return;
  const toggle = document.querySelector(SEL.watchSwitch);
  if (!toggle) {
    // chess.com todavía no dibujó el switch: se adelanta el arranque del worker (sin analizar nada)
    if (CONFIG.fallbackEngine && isWatching(boardEl)) prewarm();
    return;
  }
  if (toggle.disabled) return;
  if (toggle.checked) { failedAutoClicks = 0; return; }
  if (!isWatching(boardEl)) return;
  const now = Date.now();
  if (failedAutoClicks >= 3 || now - lastAutoClickAt < 1500 || now - userSwitchClickAt < 1500) return;
  lastAutoClickAt = now;
  failedAutoClicks++;
  diag('autoClickAnalysis', { attempt: failedAutoClicks });
  log('chess.com apagó Analysis; se vuelve a encender');
  toggle.click();
}
