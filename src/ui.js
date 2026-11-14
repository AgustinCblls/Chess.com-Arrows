// ─────────────────────────── Panel de ajustes ───────────────────────────
// El bloque de ajustes vive dentro de la ventana de ajustes de chess.com (pestaña Analysis/Computer).
// Va dentro de un Shadow DOM: los estilos de chess.com no le afectan y los suyos no se escapan.
// Si no hay sesión (el engranaje de chess.com abre el aviso de registro) o con ownGearButton,
// se muestra además un engranaje propio sobre el tablero que abre el mismo bloque flotando.
import {
  CONFIG, SETTING_DEFS, BOOL_SETTINGS, ARROW_STYLES, SETTING_DEFAULTS, ENGINE_SETTINGS,
  isValidSetting, saveSettings
} from './config.js';
import { SEL } from './selectors.js';
import { pickLang, strings } from './i18n.js';
import { state, schedule } from './state.js';
import { getMainBoard } from './board.js';
import { isAnalysisActive } from './fairplay.js';

const CSS = `
:host { all: initial; }
.box { font: 13px/1.3 system-ui, sans-serif; color: inherit; }
.title { font-weight: 600; margin-bottom: 10px; }
.row { margin-bottom: 8px; }
.head { display: flex; justify-content: space-between; margin-bottom: 2px; }
.val { color: #9fd36a; font-variant-numeric: tabular-nums; }
input[type=range] { width: 100%; margin: 0; accent-color: #81b64c; cursor: pointer; }
label.check { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; cursor: pointer; }
input[type=checkbox] { margin: 0; accent-color: #81b64c; cursor: pointer; flex: none; }
select { width: 100%; box-sizing: border-box; background: #3c3a37; color: #e8e6e3; border: 1px solid #5a5856; border-radius: 4px; padding: 4px 6px; font: inherit; cursor: pointer; }
.status { color: #a8a6a2; font-size: 12px; min-height: 16px; margin-bottom: 8px; }
button { background: #3c3a37; color: #e8e6e3; border: 0; border-radius: 4px; padding: 4px 10px; font: inherit; cursor: pointer; }
.modal { margin-bottom: 16px; padding-bottom: 14px; border-bottom: 1px solid rgba(255,255,255,.12); font-size: 14px; color: rgba(255,255,255,.85); }
.panel { position: fixed; z-index: 1001; width: 250px; box-sizing: border-box; padding: 10px 12px; border-radius: 6px; background: #262421; color: #e8e6e3; box-shadow: 0 4px 16px rgba(0,0,0,.5); }
.gear { position: fixed; z-index: 1000; width: 20px; height: 20px; border-radius: 4px; display: flex; align-items: center; justify-content: center; background: rgba(20,24,31,.55); color: #fff; font: 14px/1 sans-serif; cursor: pointer; opacity: .5; user-select: none; }
.gear:hover, .gear.open { opacity: 1; }
`;

export function createUI(Engine) {
  const T = strings(pickLang(document.documentElement.lang, navigator.language));

  let box = null, statusEl = null, styleSel = null, open = false, applyTimer = null, engineDirty = false;
  let modalHost = null, modalWrap = null, floatHost = null, gear = null, panel = null;
  const boolBoxes = {};
  const rows = {};

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function shadowHost(id) {
    const host = document.createElement('div');
    host.id = id;
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);
    return { host, root };
  }

  function sliderPos(def) { return def.values ? def.values.indexOf(CONFIG[def.key]) : CONFIG[def.key]; }

  function syncRows() {
    SETTING_DEFS.forEach(def => {
      const r = rows[def.key];
      if (!r) return;
      r.input.value = String(sliderPos(def));
      r.value.textContent = def.fmt(CONFIG[def.key]);
    });
    BOOL_SETTINGS.forEach(k => { if (boolBoxes[k]) boolBoxes[k].checked = !!CONFIG[k]; });
    if (styleSel) styleSel.value = CONFIG.arrowStyle;
  }

  // needEngine: el cambio afecta al cálculo (no solo al dibujo) y hay que repetir el análisis
  function changed(needEngine) {
    if (needEngine) engineDirty = true;
    saveSettings();
    syncRows();
    // Mientras se arrastra el deslizador no se reinicia el motor en cada paso
    clearTimeout(applyTimer);
    applyTimer = setTimeout(() => { applyTimer = null; if (engineDirty) { engineDirty = false; Engine.reconfigure(); } schedule(); }, 250);
  }

  function buildBox() {
    if (box) return;
    box = el('div', 'box');

    const styleRow = el('div', 'row');
    styleRow.appendChild(el('div', '', T.arrowStyle));
    styleSel = el('select');
    ARROW_STYLES.forEach(s => { const o = el('option', '', T['style_' + s]); o.value = s; styleSel.appendChild(o); });
    styleSel.addEventListener('change', () => {
      if (ARROW_STYLES.indexOf(styleSel.value) === -1) return;
      CONFIG.arrowStyle = styleSel.value;
      changed(false);
    });
    styleRow.appendChild(styleSel);
    box.appendChild(styleRow);

    SETTING_DEFS.forEach(def => {
      const row = el('div', 'row');
      const head = el('div', 'head');
      head.appendChild(el('span', '', T[def.key]));
      const value = el('span', 'val');
      head.appendChild(value);
      const input = el('input');
      input.type = 'range';
      input.min = String(def.values ? 0 : def.min);
      input.max = String(def.values ? def.values.length - 1 : def.max);
      input.step = String(def.values ? 1 : def.step);
      input.setAttribute('aria-label', T[def.key]);
      input.addEventListener('input', () => {
        const n = Number(input.value);
        const v = def.values ? def.values[n] : n;
        if (!isValidSetting(def, v) || v === CONFIG[def.key]) return;
        CONFIG[def.key] = v;
        changed(ENGINE_SETTINGS.indexOf(def.key) !== -1);
      });
      row.appendChild(head); row.appendChild(input);
      box.appendChild(row);
      rows[def.key] = { input, value };
    });

    BOOL_SETTINGS.forEach(k => {
      const boolRow = el('label', 'check');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.addEventListener('change', () => { CONFIG[k] = cb.checked; changed(false); });
      boolRow.appendChild(cb);
      boolRow.appendChild(el('span', '', T[k]));
      box.appendChild(boolRow);
      boolBoxes[k] = cb;
    });

    statusEl = el('div', 'status');
    statusEl.setAttribute('aria-live', 'polite');
    box.appendChild(statusEl);
    const reset = el('button', '', T.reset);
    reset.type = 'button';
    reset.addEventListener('click', () => {
      SETTING_DEFS.forEach(def => { CONFIG[def.key] = SETTING_DEFAULTS[def.key]; });
      BOOL_SETTINGS.forEach(k => { CONFIG[k] = SETTING_DEFAULTS[k]; });
      CONFIG.arrowStyle = SETTING_DEFAULTS.arrowStyle;
      changed(true);
    });
    box.appendChild(reset);
    syncRows();
  }

  function buildModalHost() {
    if (modalHost) return;
    const s = shadowHost('top3arrows-settings-section');
    modalHost = s.host;
    modalWrap = el('div', 'modal');
    modalWrap.appendChild(el('div', 'title', T.title));
    s.root.appendChild(modalWrap);
  }

  function buildFloat() {
    if (floatHost) return;
    const s = shadowHost('top3arrows-settings-float');
    floatHost = s.host;
    gear = el('div', 'gear', '⚙');
    gear.title = T.title;
    gear.setAttribute('role', 'button');
    gear.addEventListener('click', e => { e.stopPropagation(); open = !open; sync(); });
    panel = el('div', 'panel');
    panel.appendChild(el('div', 'title', T.title));
    panel.style.display = 'none';
    s.root.appendChild(gear);
    s.root.appendChild(panel);
    document.body.appendChild(floatHost);
    // Un clic fuera del panel lo cierra (el evento llega retargeteado al host del Shadow DOM)
    document.addEventListener('mousedown', e => {
      if (open && e.target !== floatHost) { open = false; sync(); }
    }, true);
  }

  function statusText() {
    if (state.lastSource === 'dom') return T.dom;
    if (state.lastSource === 'engine' || state.lastSource === 'dom+engine') {
      const s = Engine.status();
      const name = (/stockfish[-. ]?(\d+)/i.exec(s.label) || [])[1];
      return T.own + (name ? ' · Stockfish ' + name : '') + (s.depth ? ' · ' + T.depth + ' ' + s.depth : '');
    }
    return T.idle;
  }

  function updateStatus() {
    if (!statusEl) return;
    const txt = statusText();
    if (statusEl.textContent !== txt) statusEl.textContent = txt;
  }

  // chess.com tiene tres ventanas de ajustes distintas (Events, Play/Watch y la página de Análisis).
  // La pestaña del motor se reconoce en todas, y en cualquier idioma, por su desplegable con "Stockfish".
  // chess.com redibuja esa ventana al cambiar de pestaña, así que se comprueba en cada pasada.
  function syncModal() {
    let content = null;
    const hosts = document.querySelectorAll(SEL.settingsHosts);
    for (let i = 0; i < hosts.length && !content; i++) {
      const opts = hosts[i].querySelectorAll('select option');
      for (let j = 0; j < opts.length; j++) {
        if (/stockfish/i.test(opts[j].textContent || '')) { content = hosts[i]; break; }
      }
    }
    if (!content) {
      if (modalHost && modalHost.parentNode) {
        modalHost.parentNode.removeChild(modalHost);
        if (panel && box) panel.appendChild(box);
      }
      return;
    }
    buildBox();
    buildModalHost();
    if (box.parentNode !== modalWrap) modalWrap.appendChild(box);
    if (modalHost.parentNode !== content || content.firstChild !== modalHost) content.insertBefore(modalHost, content.firstChild);
    updateStatus();
  }

  // Profundidad del motor propio junto al "depth=N" de chess.com (que es la de su motor)
  function syncDepthTag() {
    let tag = document.getElementById('top3arrows-depth');
    const host = CONFIG.showDepthTag ? document.querySelector(SEL.evalDepthTagHost) : null;
    const d = (state.lastSource === 'engine' || state.lastSource === 'dom+engine') ? Engine.status().depth : null;
    if (!host || !host.parentNode || !d) { if (tag && tag.parentNode) tag.parentNode.removeChild(tag); return; }
    if (!tag) { tag = document.createElement('span'); tag.style.opacity = '.8'; tag.id = 'top3arrows-depth'; }
    if (host.nextSibling !== tag) host.parentNode.insertBefore(tag, host.nextSibling);
    const txt = ' | ' + T.tag + ' d=' + d;
    if (tag.textContent !== txt) tag.textContent = txt;
  }

  function hideFloat() {
    open = false;
    if (gear) { gear.style.display = 'none'; panel.style.display = 'none'; }
  }

  function sync() {
    syncModal();
    syncDepthTag();
    // Sin sesión, el engranaje del tablero de chess.com abre el aviso de registro en vez de sus ajustes
    const guest = document.querySelector(SEL.guestMarker) !== null;
    if (!CONFIG.ownGearButton && !guest) { hideFloat(); return; }
    const boardEl = getMainBoard();
    const active = !!boardEl && isAnalysisActive(boardEl) && (state.lastSource !== 'none' && state.lastSource !== 'off' || open);
    if (!active) { hideFloat(); return; }
    buildBox();
    buildFloat();
    const r = boardEl.getBoundingClientRect();
    if (r.width < 50) { gear.style.display = 'none'; panel.style.display = 'none'; return; }
    gear.style.display = 'flex';
    gear.style.left = Math.round(r.right - 23) + 'px';
    gear.style.top = Math.round(r.top + 3) + 'px';
    gear.classList.toggle('open', open);
    if (open && box.parentNode !== panel && !(modalHost && modalHost.parentNode)) panel.appendChild(box);
    panel.style.display = open ? 'block' : 'none';
    if (open) {
      panel.style.left = Math.max(4, Math.round(r.right - 253)) + 'px';
      panel.style.top = Math.round(r.top + 27) + 'px';
      updateStatus();
    }
  }

  // Aviso visible (una vez) si chess.com cambió algo esencial
  function selfCheckWarning(missing) {
    return T.selfCheck + ' ' + missing.join(', ');
  }

  return { sync, selfCheckWarning };
}
