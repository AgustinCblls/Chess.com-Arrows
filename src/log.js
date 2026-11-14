import { CONFIG, TAG } from './config.js';

export function log(...args) { if (CONFIG.debug) console.log(TAG, ...args); }
export function info(...args) { console.info(TAG, ...args); }
export function warn(...args) { console.warn(TAG, ...args); }

// Momento (ms desde que empezó a cargar la página) en que ocurrió cada etapa por primera vez
export const timeline = {};
export function markOnce(name) { if (!(name in timeline)) timeline[name] = Math.round(performance.now()); }

// ─────────────────────────── Diagnóstico ───────────────────────────
// Registro de lo que va ocurriendo (cambios de partida, switch, motor, flechas) con su hora.
// Se guarda en sessionStorage para que sobreviva a una recarga. En la consola: __top3ArrowsHybrid.log()
const DIAG_KEY = 'top3arrows_log';
let diagLog = [];
try { diagLog = JSON.parse(sessionStorage.getItem(DIAG_KEY) || '[]') || []; } catch (e) { diagLog = []; }
if (!Array.isArray(diagLog)) diagLog = [];
let diagSaveTimer = null;

export function diagSave() {
  clearTimeout(diagSaveTimer); diagSaveTimer = null;
  try { sessionStorage.setItem(DIAG_KEY, JSON.stringify(diagLog)); } catch (e) { /* sin almacenamiento */ }
}

export function diag(ev, data) {
  diagLog.push(Object.assign({ t: Date.now(), ev }, data || {}));
  if (diagLog.length > 400) diagLog.splice(0, diagLog.length - 400);
  if (!diagSaveTimer) diagSaveTimer = setTimeout(diagSave, 300);
}

export function diagClear() { diagLog = []; diagSave(); }

export function diagText() {
  let prev = 0;
  return diagLog.map(e => {
    const d = new Date(e.t);
    const rest = Object.keys(e).filter(k => k !== 't' && k !== 'ev').map(k => k + '=' + e[k]).join(' ');
    const line = d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0') + (prev ? ' (+' + (e.t - prev) + ' ms) ' : ' ') + e.ev + ' ' + rest;
    prev = e.t;
    return line;
  }).join('\n');
}
