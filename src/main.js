import { CONFIG, VERSION, OVERLAY_ID, loadSettings } from './config.js';
import { SEL, selfCheck } from './selectors.js';
import { info, warn, log, diag, diagSave, diagText, diagClear, markOnce, timeline } from './log.js';
import { state, setScheduler } from './state.js';
import {
  getMainBoard, getGame, getModeName, isFlipped, getBoardPieces, getLegalInfo, getPositionFen,
  getAnalysisLines, hasLinesPanel, chessComEngineShowsDepth, chessComDepth, learnedPieceLetters, classNameOf
} from './board.js';
import { resolveLineMove, detectNotation, learnPieceLetters, parseScoreText, comparableScore } from './san.js';
import { fenTurnWhite, coordsToSquare } from './fen.js';
import { formatEngineScore } from './uci.js';
import {
  isAnalysisActive, isFallbackAllowed, keepAnalysisOn, getKeepPref, noteUserSwitchClick, noteSwitchChange
} from './fairplay.js';
import { createEngine } from './engine.js';
import { getOrCreateOverlay, render, holdArrows } from './draw.js';
import { createUI } from './ui.js';

const PAGE = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;

(function main() {
  if (PAGE.__top3ArrowsHybrid) return; // evita que el script se cargue dos veces (userscript + extensión)

  loadSettings();
  const Engine = createEngine(PAGE);
  const UI = createUI(Engine);

  (function () {
    let navType = '';
    try { const nav = performance.getEntriesByType('navigation')[0]; navType = nav ? nav.type : ''; } catch (e) { /* sin API */ }
    diag('scriptLoaded', { nav: navType, msSinceNavigation: Math.round(performance.now()), path: location.pathname, v: VERSION });
  })();
  markOnce('script');
  window.addEventListener('pagehide', diagSave);

  // ─────────────────────────── Diagnóstico de estado ───────────────────────────
  let diagPrev = {};
  function diagSnapshot(boardEl) {
    const game = boardEl ? getGame(boardEl) : null;
    let over = null, fen = null;
    try {
      if (game) {
        over = typeof game.isGameOver === 'function' ? game.isGameOver() : null;
        fen = typeof game.getFEN === 'function' ? String(game.getFEN()).split(' ').slice(0, 2).join(' ') : null;
      }
    } catch (e) { /* tablero a medio cargar */ }
    const sw = document.querySelector(SEL.watchSwitch) || document.querySelector(SEL.analysisSwitch);
    const ov = boardEl ? boardEl.querySelector('#' + OVERLAY_ID) : null;
    const cur = {
      path: location.pathname,
      board: boardEl ? (boardEl.tagName || '').toLowerCase() : 'none',
      mode: boardEl ? getModeName(boardEl) : null, over,
      sw: sw ? (sw.checked ? 'on' : 'off') : 'none',
      bar: document.querySelector(SEL.evalBar) !== null,
      src: state.lastSource,
      eng: Engine.status().state,
      arrows: ov && ov.getAttribute('data-sig') ? 1 : 0,
      fen
    };
    const changed = {};
    let any = false;
    for (const k in cur) { if (cur[k] !== diagPrev[k]) { changed[k] = cur[k]; any = true; } }
    if (any) { diag('state', changed); diagPrev = cur; }
  }

  // ─────────────────────────── Bucle principal ───────────────────────────
  let scheduled = false;
  let noLinesSince = 0;   // desde cuándo el análisis está activo sin líneas en la página
  let depthSeenSince = 0; // desde cuándo se ve trabajar al motor de chess.com sin panel de líneas
  let graceTimer = null;
  let graceTimerDue = 0;
  let lastError = '';
  let selfChecked = false;

  function resetWait() { noLinesSince = 0; depthSeenSince = 0; }

  function isFinishedAtEnd(boardEl) {
    const game = getGame(boardEl);
    if (!game) return false;
    try {
      if (typeof game.isGameOver !== 'function' || typeof game.isAtEndOfLine !== 'function') return false;
      if (!game.isGameOver() || !game.isAtEndOfLine()) return false;
      // Solo en la línea principal: al final de una variante propia sí interesa el análisis
      const ids = typeof game.getNodeIds === 'function' ? game.getNodeIds() : null;
      return !ids || ids.line === 0 || ids.line === undefined;
    } catch (e) { return false; }
  }

  function runSelfCheck(boardEl) {
    if (selfChecked || !boardEl || !(boardEl.tagName || '').toLowerCase().includes('chess-board')) return;
    selfChecked = true;
    const missing = selfCheck(document, getGame(boardEl));
    if (missing.length) { warn(UI.selfCheckWarning(missing)); diag('selfCheck', { missing: missing.join('; ') }); }
  }

  let currentBoard = null;
  function update() {
    scheduled = false;
    let boardEl = null;
    try { boardEl = getMainBoard(); currentBoard = boardEl; updateInner(boardEl); }
    catch (e) {
      const msg = String(e && e.message || e);
      if (msg !== lastError) { lastError = msg; warn('error al actualizar:', e); }
    }
    try { UI.sync(); } catch (e) { log('panel de ajustes:', e); }
    try { diagSnapshot(boardEl); } catch (e) { /* el diagnóstico nunca debe romper nada */ }
    try { observeTargets(boardEl); adjustPolling(boardEl); } catch (e) { /* nada */ }
  }

  // Convierte una línea de chess.com en flecha: origen/destino y evaluación comparable (lado que mueve)
  function domArrows(boardEl, lines) {
    const pieces = getBoardPieces(boardEl);
    let legal = getLegalInfo(boardEl);
    if (!legal) {
      // Sin la API del tablero: el turno se toma del FEN reconstruido, no del texto de la línea
      const tw = fenTurnWhite(getPositionFen(boardEl));
      if (tw !== null) lines.forEach(l => { if (!l.hasMoveNumber) l.isWhite = tw; });
    }
    const turnWhite = legal ? legal.turnWhite : null;
    const lang = document.documentElement.lang || '';
    // Idioma de las letras, mirando todas las jugadas de todas las líneas (no solo la primera)
    const notation = detectNotation(lines.filter(l => !l.figurine).map(l => l.fullText), lang);
    // Qué significa cada letra en este idioma, aprendido de la lista de jugadas de la partida
    const learned = learnedPieceLetters(boardEl, learnPieceLetters);
    const arrows = [];
    lines.forEach(line => {
      const move = resolveLineMove(line, legal, pieces, lang, notation, learned);
      // chess.com a veces repite una jugada en dos líneas mientras las actualiza: se dibuja una sola vez
      if (!move || arrows.some(a => a.from === move.from && a.to === move.to)) return;
      const sc = parseScoreText(line.score);
      let cmp = null;
      if (sc && turnWhite !== null) cmp = comparableScore({ type: sc.type, value: turnWhite ? sc.value : -sc.value });
      arrows.push({ rank: line.rank, from: move.from, to: move.to, label: line.score, cmp });
    });
    return arrows;
  }

  function engineLineArrow(l, rank, whiteToMove) {
    return {
      rank, from: l.move.slice(0, 2), to: l.move.slice(2, 4),
      label: formatEngineScore(l, whiteToMove), cmp: comparableScore(l), pv: l.pv
    };
  }

  // Quita las flechas que pierden más de hideWorseBy frente a la mejor (sirve para las dos fuentes)
  function applyHideWorse(arrows) {
    if (!(CONFIG.hideWorseBy > 0) || !arrows.length || arrows[0].cmp == null) return arrows;
    const best = arrows[0].cmp;
    return arrows.filter((a, i) => i === 0 || a.cmp == null || best - a.cmp <= CONFIG.hideWorseBy);
  }

  function engineArrows(res) {
    const whiteToMove = res.turn !== 'b';
    const lines = res.lines.slice(0, CONFIG.multiPv);
    const arrows = applyHideWorse(lines.map(l => engineLineArrow(l, l.rank, whiteToMove)));
    if (CONFIG.showReply && lines.length && lines[0].reply) {
      arrows.push({ reply: true, rank: 0, from: lines[0].reply.slice(0, 2), to: lines[0].reply.slice(2, 4), label: '' });
    }
    return arrows;
  }

  // "Seguir la profundidad de chess.com": se le pasa al motor la profundidad que muestra chess.com
  // y si dejó de subir (sin cambios durante FOLLOW_STABLE_MS)
  const FOLLOW_STABLE_MS = 1500;
  let ccDepth = null, ccDepthAt = 0, followTimer = null;
  function syncFollowDepth() {
    if (!CONFIG.followChessComDepth) return;
    const d = chessComDepth();
    const now = Date.now();
    if (d !== ccDepth) { ccDepth = d; ccDepthAt = now; }
    const stable = now - ccDepthAt >= FOLLOW_STABLE_MS;
    Engine.setTargetDepth(d, stable);
    // Volver a mirar cuando se cumpla el plazo, aunque la página no cambie
    if (!stable && !followTimer) followTimer = setTimeout(() => { followTimer = null; schedule(); }, FOLLOW_STABLE_MS - (now - ccDepthAt) + 20);
  }

  function updateInner(boardEl) {
    if (!boardEl) { resetWait(); state.lastSource = 'none'; Engine.release(); return; }
    if (getGame(boardEl)) { markOnce('board'); runSelfCheck(boardEl); }

    keepAnalysisOn(boardEl, () => Engine.prewarm());
    syncFollowDepth();

    const overlay = getOrCreateOverlay(boardEl);
    if (state.arrowsHidden || !isAnalysisActive(boardEl)) {
      resetWait(); state.lastSource = 'off';
      Engine.release();
      render(overlay, null, false, 'off');
      return;
    }
    markOnce('analysisOn');

    const flipped = isFlipped(boardEl);

    // Partida terminada y tablero en su última jugada: no hay nada que sugerir
    if (CONFIG.hideAtGameEnd && isFinishedAtEnd(boardEl)) {
      resetWait(); state.lastSource = 'none';
      Engine.release();
      render(overlay, null, flipped, 'none');
      return;
    }

    // 1) Camino normal: chess.com muestra las líneas de su motor → se leen del DOM
    const lines = getAnalysisLines();
    state.linesListed = lines.length > 0;
    const allowed = lines.length > 0 && (CONFIG.ownEngineOnly || lines.length < CONFIG.multiPv || CONFIG.showReply) ? isFallbackAllowed(boardEl) : false;

    // 0) "Ignorar las líneas de chess.com": igual que en Watch, todas las flechas salen del motor propio.
    //    Mientras calcula se muestran las líneas de chess.com (paso 1).
    if (CONFIG.ownEngineOnly && allowed) {
      const fen = getPositionFen(boardEl);
      const res = fen ? Engine.getResult(fen) : null;
      if (fen) Engine.request(fen);
      if (res && (res.depth >= CONFIG.minDepthToDraw || res.done)) {
        resetWait(); state.lastSource = 'engine';
        render(overlay, engineArrows(res), flipped, 'engine');
        return;
      }
    }

    if (lines.length) {
      resetWait(); state.lastSource = 'dom';
      const arrows = domArrows(boardEl, lines);

      // Si chess.com lista menos líneas que las flechas pedidas (su ajuste "Engine Lines" suele ser 3),
      // o se quiere la respuesta esperada, el motor propio completa lo que falta, sin repetir jugadas.
      let source = 'dom';
      let reply = null;
      const fen = allowed && arrows.length ? getPositionFen(boardEl) : null;
      if (fen) {
        Engine.request(fen);
        const res = Engine.getResult(fen);
        if (res && (res.depth >= CONFIG.minDepthToDraw || res.done)) {
          const used = new Set(arrows.map(a => a.from + a.to));
          const whiteToMove = res.turn !== 'b';
          let rank = arrows.reduce((m, a) => Math.max(m, a.rank), 0);
          for (let i = 0; i < res.lines.length && rank < CONFIG.multiPv; i++) {
            const l = res.lines[i];
            const key = l.move.slice(0, 4);
            if (used.has(key)) continue;
            used.add(key);
            arrows.push(engineLineArrow(l, ++rank, whiteToMove));
          }
          // Respuesta esperada: la del motor propio, solo si su mejor jugada coincide con la de chess.com
          const top = res.lines[0];
          if (CONFIG.showReply && top && top.reply && arrows[0] && top.move.slice(0, 4) === arrows[0].from + arrows[0].to) {
            reply = { reply: true, rank: 0, from: top.reply.slice(0, 2), to: top.reply.slice(2, 4), label: '' };
          }
          source = 'dom+engine';
        }
      } else {
        Engine.release();
      }
      const out = applyHideWorse(arrows);
      if (reply) out.push(reply);
      state.lastSource = source;
      render(overlay, out, flipped, source);
      return;
    }

    // 2) chess.com no muestra líneas (p. ej. pestaña Watch: solo barra de evaluación) → motor propio
    if (!isFallbackAllowed(boardEl)) {
      resetWait(); state.lastSource = 'none';
      Engine.release();
      render(overlay, null, flipped, 'none');
      return;
    }

    // Se espera un momento por si chess.com todavía está cargando sus propias líneas.
    // En la vista Play/Watch (la que suele traer solo la barra) se arranca ya el worker.
    const now = Date.now();
    if (!noLinesSince) noLinesSince = now;
    if (document.querySelector(SEL.watchSwitch)) Engine.prewarm();
    const panel = hasLinesPanel();
    // Si el motor de chess.com ya trabaja y la página no tiene panel de líneas, solo va a mostrar
    // la barra de evaluación: no hace falta agotar la espera máxima.
    if (!panel && chessComEngineShowsDepth()) { if (!depthSeenSince) depthSeenSince = now; }
    else depthSeenSince = 0;
    const waitLeft = Math.min(
      (panel ? CONFIG.graceEmptyPanelMs : CONFIG.graceNoPanelMs) - (now - noLinesSince),
      depthSeenSince ? CONFIG.graceEngineSeenMs - (now - depthSeenSince) : Infinity
    );
    if (waitLeft > 0) {
      const due = now + waitLeft + 20;
      if (!graceTimer || due < graceTimerDue - 10) {
        clearTimeout(graceTimer);
        graceTimerDue = due;
        graceTimer = setTimeout(() => { graceTimer = null; schedule(); }, waitLeft + 20);
      }
      state.lastSource = 'none';
      render(overlay, null, flipped, 'none');
      return;
    }

    const fen = getPositionFen(boardEl);
    if (!fen) {
      state.lastSource = 'none';
      Engine.release();
      render(overlay, null, flipped, 'none');
      return;
    }

    state.lastSource = 'engine';
    Engine.request(fen);
    const res = Engine.getResult(fen);
    if (!res || (res.depth < CONFIG.minDepthToDraw && !res.done)) {
      holdArrows(overlay, flipped, 'engine'); // posición nueva: las flechas anteriores se atenúan un instante
      return;
    }
    render(overlay, engineArrows(res), flipped, 'engine');
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(update);
  }
  setScheduler(schedule);

  // ─────────────────────────── Observadores ───────────────────────────
  // Uno general, barato (solo altas y bajas de nodos), para enterarse de que chess.com monta el tablero,
  // el switch o el panel de líneas; y uno detallado (atributos y texto) solo sobre esas zonas.
  function isOwnNode(el) {
    return el.closest('#' + OVERLAY_ID + ', #top3arrows-depth, #top3arrows-settings-section, #top3arrows-settings-float');
  }

  const detailObs = new MutationObserver(mutations => {
    for (let i = 0; i < mutations.length; i++) {
      const t = mutations[i].target;
      const el = t && (t.nodeType === 1 ? t : t.parentElement);
      if (el && el.closest && !isOwnNode(el)) { schedule(); return; }
    }
  });
  let observed = [];
  function observeTargets(boardEl) {
    const targets = [];
    if (boardEl) targets.push(boardEl);
    document.querySelectorAll(SEL.linesPanel + ', ' + SEL.watchSwitch + ', ' + SEL.analysisSwitch + ', ' + SEL.evalDepth).forEach(n => {
      if (!targets.some(t => t.contains(n))) targets.push(n);
    });
    if (targets.length === observed.length && targets.every((t, i) => t === observed[i])) return;
    detailObs.disconnect();
    targets.forEach(t => detailObs.observe(t, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'checked'] }));
    observed = targets;
  }

  const mountObs = new MutationObserver(mutations => {
    for (let i = 0; i < mutations.length; i++) {
      const m = mutations[i];
      const t = m.target;
      const el = t && (t.nodeType === 1 ? t : t.parentElement);
      if (!el || !el.closest || isOwnNode(el)) continue;
      if (el.closest(SEL.watched) || (el.classList && SEL.watchedClasses.some(c => el.classList.contains(c)))) { schedule(); return; }
      const added = m.addedNodes;
      for (let j = 0; added && j < added.length; j++) {
        const n = added[j];
        if (n.nodeType === 1 && (n.matches(SEL.mounts) || n.querySelector(SEL.mounts))) { schedule(); return; }
      }
      const removed = m.removedNodes;
      for (let j = 0; removed && j < removed.length; j++) {
        if (observed.indexOf(removed[j]) !== -1) { schedule(); return; }
      }
    }
  });

  // Sondeo de seguridad: cada 0,5 s mientras hay tablero con análisis; cada 2 s si no lo hay
  let pollTimer = null, pollMs = 0;
  function adjustPolling(boardEl) {
    const want = boardEl && state.lastSource !== 'off' && state.lastSource !== 'none' ? 500 : 2000;
    if (want === pollMs) return;
    clearInterval(pollTimer);
    pollMs = want;
    pollTimer = setInterval(schedule, want);
  }

  // Ratón sobre el tablero → casilla, para ver la variante de una flecha
  function onMouseMove(e) {
    if (!CONFIG.pvOnHover) return;
    const b = currentBoard;
    let sq = null;
    if (b && b.contains && (e.target === b || b.contains(e.target))) {
      const r = b.getBoundingClientRect();
      if (r.width > 0) sq = coordsToSquare((e.clientX - r.left) / r.width * 100, (e.clientY - r.top) / r.height * 100, isFlipped(b));
    }
    if (sq !== state.hoverSquare) { state.hoverSquare = sq; schedule(); }
  }

  function init() {
    Engine.setOnUpdate(schedule);

    // Un clic real del usuario sobre el switch Analysis de la vista Play/Watch fija su preferencia.
    // Los clics que hace este script (o chess.com) no cuentan: no son eventos de confianza.
    document.addEventListener('click', e => {
      if (!e.isTrusted) return;
      const t = e.target;
      if (t && t.closest && (t.id === 'evaluationSettings' || t.closest('label[for="evaluationSettings"]'))) noteUserSwitchClick();
    }, true);

    // Alt + tecla: se compara la tecla física (e.code) porque en macOS Option+A escribe "å"
    document.addEventListener('keydown', e => {
      if (!CONFIG.hotkey || !e.altKey || e.ctrlKey || e.metaKey || e.repeat) return;
      const hk = String(CONFIG.hotkey).toLowerCase();
      const codeMatch = /^[a-z]$/.test(hk) ? e.code === 'Key' + hk.toUpperCase() : (/^[0-9]$/.test(hk) && e.code === 'Digit' + hk);
      if (!codeMatch && String(e.key).toLowerCase() !== hk) return;
      const k = e.target;
      if (k && (k.isContentEditable || /^(input|textarea|select)$/i.test(k.tagName || ''))) return; // no mientras se escribe
      state.arrowsHidden = !state.arrowsHidden;
      e.preventDefault();
      schedule();
    });

    document.addEventListener('change', e => {
      const t = e.target;
      if (!t) return;
      if (t.id === 'evaluationSettings') noteSwitchChange(t.checked);
      if (t.id === 'analysis' || t.id === 'evaluationSettings' || classNameOf(t).indexOf('cc-switch-checkbox') !== -1) schedule();
    });

    document.addEventListener('mousemove', onMouseMove, { passive: true });
    mountObs.observe(document.body, { childList: true, subtree: true });

    // El engranaje propio sigue al tablero al desplazar o redimensionar
    window.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);

    adjustPolling(null);
    schedule();
  }

  // API de consola de solo lectura: la página no puede cambiar la configuración a través de ella
  const api = {
    version: VERSION,
    config: () => JSON.parse(JSON.stringify(CONFIG)),
    refresh: () => update(),
    // timeline: ms desde que empezó a cargar la página hasta cada etapa
    log: () => diagText(),
    clearLog: () => { diagClear(); diagPrev = {}; },
    status: () => ({ source: state.lastSource, keepAnalysis: getKeepPref(), timeline: Object.assign({}, timeline), engine: Engine.status() }),
    testReserveEngine: () => { Engine.forceReserveOnly(); return 'probando los motores de reserva; mira status().engine'; }
  };
  try {
    Object.defineProperty(PAGE, '__top3ArrowsHybrid', { value: Object.freeze(api), writable: false, configurable: false, enumerable: false });
  } catch (e) { PAGE.__top3ArrowsHybrid = Object.freeze(api); }

  info('v' + VERSION + ' cargado.');

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
