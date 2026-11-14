// ==UserScript==
// @name         Chess.com - Top 3 Analysis Arrows
// @namespace    https://github.com/hediondom/Chess.com-Arrows
// @version      9.6.6
// @description  Top-3 engine move arrows for chess.com analysis and watched games. Uses chess.com's own Stockfish in a Web Worker, so no extra app or Stockfish install is needed.
// @homepageURL  https://github.com/hediondom/Chess.com-Arrows
// @supportURL   https://github.com/hediondom/Chess.com-Arrows/issues
// @downloadURL  https://github.com/hediondom/Chess.com-Arrows/raw/main/chess_analysis_arrows.user.js
// @updateURL    https://github.com/hediondom/Chess.com-Arrows/raw/main/chess_analysis_arrows.user.js
// @match        https://www.chess.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const PAGE = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;
  if (PAGE.__top3ArrowsHybrid) return; // evita que el script se cargue dos veces

  // ─────────────────────────── Configuración ───────────────────────────
  const CONFIG = {
    fallbackEngine: true,       // false = comportarse como la v6 (solo leer las líneas de chess.com)
    keepAnalysisOnWhileWatching: true, // al mirar partidas, vuelve a encender el switch Analysis si chess.com lo apaga (p. ej. en una revancha)
    // Estos cuatro se cambian también desde el panel de ajustes (engranaje sobre el tablero) y se recuerdan
    multiPv: 3,                 // flechas: líneas que calcula el motor alternativo y máximo que se dibuja (1-5)
    maxDepth: 18,               // el motor alternativo se detiene al llegar a esta profundidad...
    maxTimeMs: 8000,            // ...o tras este tiempo por posición (lo que ocurra primero)
    hashMb: 16,                 // memoria (tabla hash) del motor alternativo, en MB
    ownGearButton: false,       // true = además, engranaje propio flotante en la esquina del tablero (por si chess.com cambia su ventana de ajustes)
    arrowStyle: 'chesscom',      // 'color' = flechas de colores numeradas; 'chesscom' = como las flechas naranjas de chess.com; 'lichess' = como las de Lichess. También en el panel
    scoresWatch: true,          // número de evaluación junto a cada flecha donde chess.com NO lista líneas (partidas que miras en Watch). También en el panel
    scoresWithLines: false,     // lo mismo donde chess.com SÍ lista sus líneas a la derecha (Events, Análisis). También en el panel
    ownEngineOnly: false,
    showReply: false,           // flecha gris con la respuesta esperada del rival a la mejor jugada. También en el panel
    hideWorseBy: 0,             // oculta las flechas que pierden más de estos centipeones frente a la mejor (0 = no ocultar). También en el panel
    hideAtGameEnd: true,        // sin flechas en la posición final de una partida terminada
    hotkey: 'a',                // Alt + esta tecla oculta o muestra las flechas ('' = sin atajo)
    showDepthTag: true,         // muestra la profundidad del motor propio junto al "depth=N" de chess.com      // true = flechas siempre del motor propio (como en Watch); las líneas de chess.com solo se usan mientras calcula. También en el panel
    minDepthToDraw: 8,          // no dibujar hasta esta profundidad (evita flechas que saltan)
    graceEngineSeenMs: 100,     // espera cuando el motor de chess.com ya trabaja y la página no tiene panel de líneas
    graceNoPanelMs: 1000,       // espera máxima antes de usar el motor si la página no tiene panel de líneas
    graceEmptyPanelMs: 3000,    // espera si el panel de líneas existe pero está vacío
    engineBootTimeoutsMs: [2500, 6000, 12000], // si el worker no responde se reintenta el mismo motor con más margen; luego se pasa al siguiente
    engineStopTimeoutMs: 700,   // si el motor no deja la búsqueda anterior en este tiempo, se reinicia el worker (tarda ~0,2 s)
    engineSilenceMs: 1500,      // si tras pedir un análisis el motor no dice nada en este tiempo, se reinicia el worker
    engineIdleKillMs: 60000,    // apaga el worker del motor tras este tiempo sin usarse
    debug: false                // true = mensajes detallados en la consola
  };

  const ARROW_CONFIG = [
    { rank: 1, color: '#00d26a', headColor: '#00b058', opacity: 0.88, width: 3.2, labelBg: '#00d26a' },
    { rank: 2, color: '#38bdf8', headColor: '#0284c7', opacity: 0.78, width: 2.6, labelBg: '#0284c7' },
    { rank: 3, color: '#fb923c', headColor: '#ea580c', opacity: 0.68, width: 2.2, labelBg: '#fb923c' },
    { rank: 4, color: '#a78bfa', headColor: '#7c3aed', opacity: 0.62, width: 2.0, labelBg: '#7c3aed' },
    { rank: 5, color: '#f472b6', headColor: '#db2777', opacity: 0.58, width: 1.8, labelBg: '#db2777' }
  ];

  // Ajustes que el usuario puede mover desde el panel; se guardan en localStorage
  const SETTINGS_KEY = 'top3arrows_settings';
  const HASH_STEPS = [16, 32, 64, 128, 256, 512];
  const SETTING_DEFS = [
    { key: 'multiPv', min: 1, max: 5, step: 1, fmt: v => String(v) },
    { key: 'maxTimeMs', min: 1000, max: 30000, step: 1000, fmt: v => (v / 1000) + ' s' },
    { key: 'maxDepth', min: 10, max: 40, step: 1, fmt: v => String(v) },
    { key: 'hashMb', values: HASH_STEPS, fmt: v => v + ' MB' },
    { key: 'hideWorseBy', values: [0, 50, 100, 150, 200, 300], fmt: v => v ? (v / 100).toFixed(1) : '—' }
  ];
  const BOOL_SETTINGS = ['scoresWatch', 'scoresWithLines', 'showReply', 'ownEngineOnly'];
  const ARROW_STYLES = ['chesscom', 'color', 'lichess'];
  const SETTING_DEFAULTS = { multiPv: 3, maxTimeMs: 8000, maxDepth: 18, hashMb: 16, hideWorseBy: 0, ownEngineOnly: false, scoresWatch: true, scoresWithLines: false, showReply: false, arrowStyle: 'chesscom' };
  function isValidSetting(def, v) {
    if (typeof v !== 'number' || !isFinite(v)) return false;
    return def.values ? def.values.indexOf(v) !== -1 : (v >= def.min && v <= def.max && v % def.step === 0);
  }
  (function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
      if (saved && typeof saved === 'object') {
        SETTING_DEFS.forEach(def => { if (isValidSetting(def, saved[def.key])) CONFIG[def.key] = saved[def.key]; });
        BOOL_SETTINGS.forEach(k => { if (typeof saved[k] === 'boolean') CONFIG[k] = saved[k]; });
        if (ARROW_STYLES.indexOf(saved.arrowStyle) !== -1) CONFIG.arrowStyle = saved.arrowStyle;
      }
    } catch (e) { /* ajustes dañados o sin almacenamiento: quedan los de CONFIG */ }
  })();
  function saveSettings() {
    try {
      const out = {};
      SETTING_DEFS.forEach(def => { out[def.key] = CONFIG[def.key]; });
      BOOL_SETTINGS.forEach(k => { out[k] = !!CONFIG[k]; });
      out.arrowStyle = CONFIG.arrowStyle;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(out));
    } catch (e) { /* sin almacenamiento: duran hasta recargar */ }
  }

  const OVERLAY_ID = 'chess-top3-hybrid-arrows-overlay';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const TAG = '[Top3 Arrows]';

  // Último recurso si no se encuentra el Stockfish de chess.com (versión fija, verificada por hash)
  const CDN_ENGINE = {
    url: 'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js',
    integrity: 'sha384-VtbI9eXlyH0iLETxBo+yJZD0egEZcin9R4ntQlcrrKjRYSTQmdhoiY/jGV9SGw4Q'
  };

  function log() { if (CONFIG.debug) console.log.apply(console, [TAG].concat([].slice.call(arguments))); }
  function info() { console.info.apply(console, [TAG].concat([].slice.call(arguments))); }
  function warn() { console.warn.apply(console, [TAG].concat([].slice.call(arguments))); }

  // Momento (ms desde que empezó a cargar la página) en que ocurrió cada etapa por primera vez
  const timeline = {};
  function markOnce(name) { if (!(name in timeline)) timeline[name] = Math.round(performance.now()); }
  // ─────────────────────────── Diagnóstico ───────────────────────────
  // Registro de lo que va ocurriendo (cambios de partida, switch, motor, flechas) con su hora.
  // Se guarda en sessionStorage para que sobreviva a una recarga de la página.
  // En la consola: __top3ArrowsHybrid.log()
  const DIAG_KEY = 'top3arrows_log';
  let diagLog = [];
  try { diagLog = JSON.parse(sessionStorage.getItem(DIAG_KEY) || '[]') || []; } catch (e) { diagLog = []; }
  if (!Array.isArray(diagLog)) diagLog = [];
  let diagSaveTimer = null;
  function diagSave() {
    clearTimeout(diagSaveTimer); diagSaveTimer = null;
    try { sessionStorage.setItem(DIAG_KEY, JSON.stringify(diagLog)); } catch (e) { /* sin almacenamiento */ }
  }
  function diag(ev, data) {
    diagLog.push(Object.assign({ t: Date.now(), ev }, data || {}));
    if (diagLog.length > 400) diagLog.splice(0, diagLog.length - 400);
    if (!diagSaveTimer) diagSaveTimer = setTimeout(diagSave, 300);
  }
  let diagPrev = {};
  function diagSnapshot() {
    const boardEl = getMainBoard();
    const game = boardEl ? getGame(boardEl) : null;
    let mode = null, over = null, fen = null;
    try {
      if (game) {
        mode = typeof game.getMode === 'function' ? game.getMode().name : null;
        over = typeof game.isGameOver === 'function' ? game.isGameOver() : null;
        fen = typeof game.getFEN === 'function' ? String(game.getFEN()).split(' ').slice(0, 2).join(' ') : null;
      }
    } catch (e) { /* tablero a medio cargar */ }
    const sw = document.getElementById('evaluationSettings') || document.getElementById('analysis');
    const ov = boardEl ? boardEl.querySelector('#' + OVERLAY_ID) : null;
    const cur = {
      path: location.pathname,
      board: boardEl ? (boardEl.tagName || '').toLowerCase() : 'none',
      mode, over,
      sw: sw ? (sw.checked ? 'on' : 'off') : 'none',
      bar: document.querySelector('wc-evaluation-bar') !== null,
      src: lastSource,
      eng: Engine.status().state,
      arrows: ov && ov.getAttribute('data-sig') ? 1 : 0,
      fen
    };
    const changed = {};
    let any = false;
    for (const k in cur) { if (cur[k] !== diagPrev[k]) { changed[k] = cur[k]; any = true; } }
    if (any) { diag('state', changed); diagPrev = cur; }
  }
  function diagText() {
    let prev = 0;
    return diagLog.map(e => {
      const d = new Date(e.t);
      const rest = Object.keys(e).filter(k => k !== 't' && k !== 'ev').map(k => k + '=' + e[k]).join(' ');
      const line = d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0') + (prev ? ' (+' + (e.t - prev) + ' ms) ' : ' ') + e.ev + ' ' + rest;
      prev = e.t;
      return line;
    }).join('\n');
  }
  window.addEventListener('pagehide', diagSave);
  (function () {
    let navType = '';
    try { const nav = performance.getEntriesByType('navigation')[0]; navType = nav ? nav.type : ''; } catch (e) { /* sin API */ }
    diag('scriptLoaded', { nav: navType, msSinceNavigation: Math.round(performance.now()), path: location.pathname });
  })();
  markOnce('script');

  // ─────────────────────────── Tablero ───────────────────────────
  // Tablero principal: el real de chess.com; si hubiera varios, el más grande en pantalla
  function getMainBoard() {
    const boards = document.querySelectorAll('wc-chess-board, chess-board');
    if (boards.length === 1) return boards[0];
    if (boards.length > 1) {
      let best = null, bestArea = 0;
      for (let i = 0; i < boards.length; i++) {
        const r = boards[i].getBoundingClientRect();
        const area = r.width * r.height;
        if (area > bestArea) { bestArea = area; best = boards[i]; }
      }
      return best || boards[0];
    }
    return document.querySelector('.board'); // marcador mientras carga la página o diseños antiguos
  }

  function squareToCoords(square, isFlipped) {
    if (!square || square.length < 2) return null;
    let col = square.charCodeAt(0) - 97;
    let rank = parseInt(square[1], 10);
    if (isNaN(rank) || col < 0 || col > 7 || rank < 1 || rank > 8) return null;
    if (isFlipped) { col = 7 - col; rank = 9 - rank; }
    return { x: col * 12.5 + 6.25, y: (8 - rank) * 12.5 + 6.25 };
  }

  function classNameOf(el) {
    const c = el.className;
    return typeof c === 'string' ? c : (c && typeof c.baseVal === 'string' ? c.baseVal : '');
  }

  // LEE LAS PIEZAS DEL TABLERO
  function getBoardPieces(boardEl) {
    const pieces = {};
    boardEl.querySelectorAll('.piece').forEach(el => {
      const classes = [...el.classList];
      const pc = classes.find(c => /^[wb][prnbqk]$/.test(c));
      const sq = classes.find(c => /^square-\d\d$/.test(c));
      if (pc && sq) {
        const n = sq.replace('square-', '');
        pieces[`${String.fromCharCode(96 + parseInt(n[0], 10))}${parseInt(n[1], 10)}`] = pc;
      }
    });
    return pieces;
  }

  // Objeto "game" que chess.com expone en el tablero (FEN exacto, jugadas legales, modo)
  function getGame(boardEl) {
    try {
      const g = boardEl.game || (boardEl.wrappedJSObject && boardEl.wrappedJSObject.game);
      return g && typeof g === 'object' ? g : null;
    } catch (e) { return null; }
  }

  // ─────────────────────────── SAN → origen/destino ───────────────────────────
  function normalizeSan(text) {
    return String(text)
      .replace(/\s+/g, '')
      .replace(/^\d+\.+/, '')
      .replace(/^\.+/, '')
      .replace(/[+#?!]/g, '')
      .replace('0-0-0', 'O-O-O')
      .replace('0-0', 'O-O');
  }

  function isPathClear(fromCol, fromRank, toCol, toRank, pieces) {
    const stepCol = Math.sign(toCol - fromCol);
    const stepRank = Math.sign(toRank - fromRank);
    let c = fromCol + stepCol;
    let r = fromRank + stepRank;
    while (c !== toCol || r !== toRank) {
      if (pieces[String.fromCharCode(97 + c) + r]) return false;
      c += stepCol; r += stepRank;
    }
    return true;
  }

  // ENCUENTRA EL ORIGEN Y DESTINO DEL MOVIMIENTO (por geometría, sin la API del tablero)
  function findMoveSource(sanText, isWhite, pieces) {
    const san = normalizeSan(sanText);
    if (!san) return null;

    const color = isWhite ? 'w' : 'b';
    if (san.includes('O-O-O')) return { from: isWhite ? 'e1' : 'e8', to: isWhite ? 'c1' : 'c8' };
    if (san.includes('O-O')) return { from: isWhite ? 'e1' : 'e8', to: isWhite ? 'g1' : 'g8' };

    const toMatch = san.match(/([a-h][1-8])/g);
    if (!toMatch) return null;
    const to = toMatch[toMatch.length - 1];
    const toCol = to.charCodeAt(0) - 97;
    const toRank = parseInt(to[1], 10);

    let requiredPiece = 'p';
    if (san.startsWith('N')) requiredPiece = 'n';
    else if (san.startsWith('B')) requiredPiece = 'b';
    else if (san.startsWith('R')) requiredPiece = 'r';
    else if (san.startsWith('Q')) requiredPiece = 'q';
    else if (san.startsWith('K')) requiredPiece = 'k';

    const isCapture = san.includes('x');
    const strict = []; // respeta piezas que bloquean el camino
    const loose = [];  // solo geometría (como la v6), por si la lectura del tablero falla

    for (const [sq, p] of Object.entries(pieces)) {
      if (p[0] !== color || p[1] !== requiredPiece) continue;

      const fromCol = sq.charCodeAt(0) - 97;
      const fromRank = parseInt(sq[1], 10);
      const dx = toCol - fromCol;
      const dy = toRank - fromRank;
      if (dx === 0 && dy === 0) continue;

      if (requiredPiece === 'p') {
        const dir = isWhite ? 1 : -1;
        if (isCapture) {
          if (Math.abs(dx) === 1 && dy === dir && (san[0] === 'x' || san[0] === sq[0])) { strict.push(sq); loose.push(sq); }
        } else if (dx === 0 && dy === dir) {
          strict.push(sq); loose.push(sq);
        } else if (dx === 0 && dy === 2 * dir) {
          loose.push(sq);
          if (fromRank === (isWhite ? 2 : 7) && !pieces[sq[0] + (fromRank + dir)]) strict.push(sq);
        }
      } else if (requiredPiece === 'n') {
        if ((Math.abs(dx) === 1 && Math.abs(dy) === 2) || (Math.abs(dx) === 2 && Math.abs(dy) === 1)) { strict.push(sq); loose.push(sq); }
      } else if (requiredPiece === 'k') {
        if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) { strict.push(sq); loose.push(sq); }
      } else {
        const straight = dx === 0 || dy === 0;
        const diagonal = Math.abs(dx) === Math.abs(dy);
        const reaches = requiredPiece === 'b' ? diagonal : requiredPiece === 'r' ? straight : (straight || diagonal);
        if (reaches) {
          loose.push(sq);
          if (isPathClear(fromCol, fromRank, toCol, toRank, pieces)) strict.push(sq);
        }
      }
    }

    const candidates = strict.length ? strict : loose;
    if (candidates.length > 1) {
      // "Nbd7" -> "b", "R1e2" -> "1", "Rfxe1" -> "f"
      const disambig = san.replace(/=[QRBN]$/, '').slice(1, -2).replace('x', '');
      if (disambig) {
        const exactMatch = candidates.find(sq => sq.includes(disambig));
        if (exactMatch) return { from: exactMatch, to };
      }
    }
    return candidates.length > 0 ? { from: candidates[0], to } : null;
  }

  // Jugadas legales de la posición actual según chess.com, indexadas por SAN
  let legalCache = { fen: null, info: null };
  function getLegalInfo(boardEl) {
    const game = getGame(boardEl);
    if (!game || typeof game.getLegalMoves !== 'function' || typeof game.getFEN !== 'function') return null;
    try {
      const fen = game.getFEN();
      if (typeof fen !== 'string') return null;
      if (legalCache.fen === fen) return legalCache.info;
      const moves = game.getLegalMoves();
      if (!Array.isArray(moves)) return null;
      const bySan = new Map();
      const list = [];
      for (const m of moves) {
        if (!m || typeof m.san !== 'string' || typeof m.from !== 'string' || typeof m.to !== 'string') continue;
        const key = normalizeSan(m.san);
        if (!bySan.has(key)) bySan.set(key, { from: m.from, to: m.to });
        list.push({ san: key, from: m.from, to: m.to });
      }
      const turnField = fen.split(' ')[1];
      const result = { bySan, list, turnWhite: turnField === 'w' ? true : (turnField === 'b' ? false : null) };
      legalCache = { fen, info: result };
      return result;
    } catch (e) { return null; }
  }

  // Con chess.com en otro idioma las líneas usan las letras de pieza de ese idioma ("Ce7" = caballo a e7).
  // Letras de rey, dama, torre, alfil y caballo, en ese orden.
  const PIECE_LETTERS = { es: 'RDTAC', fr: 'RDTFC', de: 'KDTLS', it: 'RDTAC', pt: 'RDTBC', nl: 'KDTLP', pl: 'KHWGS', tr: 'ŞVKFA' };
  function localizedSanToEnglish(san) {
    const lang = (document.documentElement.lang || '').slice(0, 2).toLowerCase();
    const letters = PIECE_LETTERS[lang];
    if (!letters) return null;
    const tr = c => { const i = letters.indexOf(c); return i === -1 ? null : 'KQRBN'[i]; };
    let out = san;
    if (/^[^a-hO0-9x]/.test(out)) {
      const p = tr(out[0]);
      if (!p) return null;
      out = p + out.slice(1);
    }
    const promo = /=(.)$/.exec(out);
    if (promo) {
      const p = tr(promo[1]);
      if (!p) return null;
      out = out.slice(0, -1) + p;
    }
    return out === san ? null : out;
  }

  function resolveLineMove(line, legal, pieces) {
    let san = normalizeSan(line.moveText);
    if (!san) return null;
    let moveText = line.moveText;
    if (legal) {
      let m = legal.bySan.get(san);
      if (!m) {
        // 1) Traducir las letras según el idioma de la página
        const en = localizedSanToEnglish(san);
        if (en && legal.bySan.has(en)) { m = legal.bySan.get(en); san = en; }
        if (en) moveText = en;
      }
      if (!m && /^[^a-hO0-9x]/.test(san)) {
        // 2) Idioma sin tabla: vale si una sola jugada legal de pieza coincide en todo menos en la letra
        const rest = san.replace(/^[^a-h0-9x]+/, '');
        const same = legal.list.filter(l => /^[KQRBN]/.test(l.san) && l.san.slice(1) === rest);
        if (same.length === 1) m = same[0];
      }
      if (m) {
        if (san === 'O-O' || san === 'O-O-O') return { from: m.from, to: (san === 'O-O' ? 'g' : 'c') + m.from[1] };
        return { from: m.from, to: m.to };
      }
      // La línea es de otra posición (chess.com todavía no la actualizó): no dibujar flechas viejas
      if (legal.turnWhite !== null && legal.turnWhite !== line.isWhite) return null;
    }
    else {
      const en = localizedSanToEnglish(san);
      if (en) moveText = en;
    }
    return findMoveSource(moveText, line.isWhite, pieces);
  }

  // ─────────────────────────── Líneas que muestra chess.com ───────────────────────────
  const FIGURINES = [['knight', 'N'], ['bishop', 'B'], ['rook', 'R'], ['queen', 'Q'], ['king', 'K']];
  const SAN_RE = /^(\d+\.+)?(O-O(-O)?|0-0(-0)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](=[QRBN])?)[+#]?[!?]*$/;

  function figurineLetter(el) {
    const d = el.getAttribute('data-figurine');
    if (d) return d;
    const cls = classNameOf(el);
    for (let i = 0; i < FIGURINES.length; i++) {
      if (cls.indexOf(FIGURINES[i][0] + '-white') !== -1 || cls.indexOf(FIGURINES[i][0] + '-black') !== -1) return FIGURINES[i][1];
    }
    return '';
  }

  // Texto de una jugada respetando el orden del DOM y convirtiendo figurines a letra
  function sanTextOf(el) {
    let out = '';
    const kids = el.childNodes;
    for (let i = 0; i < kids.length; i++) {
      const n = kids[i];
      if (n.nodeType === 3) out += n.nodeValue;
      else if (n.nodeType === 1) {
        const cls = classNameOf(n);
        if (n.hasAttribute('data-figurine') || cls.indexOf('move-san-figurine') !== -1 || cls.indexOf('icon-font-chess') !== -1) out += figurineLetter(n);
        else out += sanTextOf(n);
      }
    }
    return out;
  }

  // Composición de la v6 para la página de Análisis (respaldo)
  function legacyEngineNodeText(firstMoveEl) {
    const preEl = firstMoveEl.querySelector('.move-san-premove');
    const preMove = preEl ? preEl.textContent : '';
    const figurineEl = firstMoveEl.querySelector('.move-san-figurine');
    const pieceLetter = figurineEl ? figurineLetter(figurineEl) : '';
    const sanEl = firstMoveEl.querySelector('.move-san-san');
    let san = sanEl ? sanEl.textContent : '';
    if (!san) {
      const spans = firstMoveEl.querySelectorAll('span');
      for (const s of spans) {
        if (!s.className && s.textContent.trim()) { san = s.textContent.trim(); break; }
      }
    }
    // En una coronación ("e8=" + figurín) la letra de la pieza va al final
    const combined = san.trim().endsWith('=') ? (preMove + san + pieceLetter) : (preMove + pieceLetter + san);
    return combined.replace(/\s+/g, '');
  }

  function isWhiteMoveText(moveText) {
    return !moveText.includes('...') && !/^\d+\.\.\./.test(moveText);
  }

  // LEER LAS LÍNEAS DEL MOTOR (COMPATIBLE CON EVENTOS, PLAY Y ANÁLISIS)
  function getAnalysisLines() {
    const lines = [];

    // Estructura 1: Events y Play (evaluation-lines-component)
    const evalComponents = document.querySelectorAll('wc-evaluation-lines .evaluation-lines-component, .evaluation-lines-component');
    evalComponents.forEach((comp, idx) => {
      if (idx >= CONFIG.multiPv) return;
      const scoreEl = comp.querySelector('.evaluation-lines-score');
      const score = scoreEl ? scoreEl.textContent.trim() : '';
      const firstMoveEl = comp.querySelector('.evaluation-lines-node[data-move-index="0"]') || comp.querySelector('.evaluation-lines-node');
      const moveText = firstMoveEl ? sanTextOf(firstMoveEl).replace(/\s+/g, '') : '';
      if (moveText) lines.push({ rank: idx + 1, score, moveText, isWhite: isWhiteMoveText(moveText) });
    });
    if (lines.length > 0) return lines;

    // Estructura 2: Página de Análisis (engine-line-component)
    let engineComponents = [...document.querySelectorAll('.engine-line-component')];
    // La fila "X is a book move / is best" trae su propia línea: si están las líneas reales, se ignora
    const mainComponents = engineComponents.filter(c => !c.classList.contains('analysis-feedback-row-engine'));
    if (mainComponents.length) engineComponents = mainComponents;

    engineComponents.forEach((comp, idx) => {
      if (idx >= CONFIG.multiPv) return;
      const scoreEl = comp.querySelector('.score-text-score');
      const score = scoreEl ? scoreEl.textContent.trim() : '';
      const firstMoveEl = comp.querySelector('.engine-line-node');
      if (!firstMoveEl) return;

      let moveText = sanTextOf(firstMoveEl).replace(/\s+/g, '');
      if (!SAN_RE.test(moveText)) {
        const legacy = legacyEngineNodeText(firstMoveEl);
        if (legacy) moveText = legacy;
      }
      if (moveText) lines.push({ rank: idx + 1, score, moveText, isWhite: isWhiteMoveText(moveText) });
    });

    return lines;
  }

  function hasLinesPanel() {
    return document.querySelector('wc-evaluation-lines, .evaluation-lines-component, .engine-lines-engine-lines-redesign, .engine-line-component') !== null;
  }

  // En la vista Play/Watch el switch Analysis solo existe en la subpestaña de movimientos: al pasar
  // a Chat o a otra pestaña chess.com lo quita de la página aunque el análisis siga encendido.
  // Si la última vez que se vio estaba encendido y chess.com sigue mostrando su barra de evaluación
  // (la retira al apagar el análisis), se considera encendido.
  let lastSwitchOn = false;
  function switchHiddenButOn() {
    return lastSwitchOn && document.querySelector('wc-evaluation-bar') !== null;
  }

  // VERIFICAR SI EL ANÁLISIS ESTÁ ENCENDIDO (COMPATIBLE CON TODAS LAS PÁGINAS)
  function isAnalysisActive() {
    // Busca el ID 'analysis' (Events/Análisis) o 'evaluationSettings' (Play)
    const toggle = document.getElementById('analysis') || document.getElementById('evaluationSettings');
    if (toggle) { lastSwitchOn = toggle.checked; return toggle.checked; }
    if (switchHiddenButOn()) return true;
    // Respaldo por si cambian el ID en el futuro (la clase lleva un sufijo que chess.com regenera)
    const anySwitch = document.querySelector('input[type="checkbox"][class*="cc-switch-checkbox"]');
    if (anySwitch) return anySwitch.checked;
    return false;
  }

  // El motor de chess.com ya está calculando: muestra "depth=N" junto al switch
  function chessComEngineShowsDepth() {
    const el = document.querySelector('wc-evaluation-depth, .analysis-options-depth');
    return !!el && /=\s*\d/.test(el.textContent || '');
  }

  // ─────────────────────────── Posición para el motor alternativo ───────────────────────────
  function isPlausibleFen(fen) {
    if (typeof fen !== 'string') return false;
    const parts = fen.trim().split(/\s+/);
    if (parts.length < 2 || (parts[1] !== 'w' && parts[1] !== 'b')) return false;
    return parts[0].split('/').length === 8 && parts[0].indexOf('K') !== -1 && parts[0].indexOf('k') !== -1;
  }

  // Reconstruye el FEN leyendo el DOM (solo si la API del tablero no está disponible)
  function buildFenFromDom(boardEl) {
    const pieces = getBoardPieces(boardEl);
    let hasWhiteKing = false, hasBlackKing = false;
    for (const p of Object.values(pieces)) { if (p === 'wk') hasWhiteKing = true; else if (p === 'bk') hasBlackKing = true; }
    if (!hasWhiteKing || !hasBlackKing) return null;

    const rows = [];
    for (let r = 8; r >= 1; r--) {
      let row = '', empty = 0;
      for (let c = 0; c < 8; c++) {
        const p = pieces[String.fromCharCode(97 + c) + r];
        if (p) {
          if (empty) { row += empty; empty = 0; }
          row += p[0] === 'w' ? p[1].toUpperCase() : p[1];
        } else empty++;
      }
      if (empty) row += empty;
      rows.push(row);
    }

    // 1) Turno según la jugada seleccionada en la lista de movimientos
    let turn = null;
    const selected = document.querySelector('.node .selected, .node.selected');
    const selectedNode = selected && selected.closest('.node');
    if (selectedNode) {
      if (selectedNode.classList.contains('white-move')) turn = 'b';
      else if (selectedNode.classList.contains('black-move')) turn = 'w';
    }

    // 2) Última jugada (casillas resaltadas): turno y captura al paso
    let ep = '-';
    const highlighted = [];
    boardEl.querySelectorAll('.highlight').forEach(el => {
      const m = /(?:^|\s)square-(\d)(\d)(?:\s|$)/.exec(classNameOf(el));
      if (m) highlighted.push(String.fromCharCode(96 + parseInt(m[1], 10)) + m[2]);
    });
    if (highlighted.length === 2) {
      const occupied = highlighted.filter(sq => pieces[sq]);
      if (occupied.length === 1) {
        const to = occupied[0];
        const from = highlighted[0] === to ? highlighted[1] : highlighted[0];
        const moved = pieces[to];
        if (!turn) turn = moved[0] === 'w' ? 'b' : 'w';
        if (moved[1] === 'p' && moved[0] !== turn && from[0] === to[0] && Math.abs(parseInt(to[1], 10) - parseInt(from[1], 10)) === 2) {
          ep = to[0] + ((parseInt(to[1], 10) + parseInt(from[1], 10)) / 2);
        }
      }
    }

    // 3) Reloj activo
    if (!turn) {
      const clock = document.querySelector('.clock-component.clock-player-turn');
      if (clock) turn = clock.classList.contains('clock-black') ? 'b' : (clock.classList.contains('clock-white') ? 'w' : null);
    }
    if (!turn) turn = 'w';

    let castling = '';
    if (pieces.e1 === 'wk') { if (pieces.h1 === 'wr') castling += 'K'; if (pieces.a1 === 'wr') castling += 'Q'; }
    if (pieces.e8 === 'bk') { if (pieces.h8 === 'br') castling += 'k'; if (pieces.a8 === 'br') castling += 'q'; }

    return rows.join('/') + ' ' + turn + ' ' + (castling || '-') + ' ' + ep + ' 0 1';
  }

  function getPositionFen(boardEl) {
    const game = getGame(boardEl);
    if (game && typeof game.getFEN === 'function') {
      try {
        const fen = game.getFEN();
        if (isPlausibleFen(fen)) return fen.trim();
      } catch (e) { /* se usa el DOM */ }
    }
    return buildFenFromDom(boardEl);
  }

  // El motor alternativo solo corre donde chess.com mismo ofrece análisis:
  // su switch "Analysis" debe existir y estar encendido, y nunca durante una partida propia en curso.
  function isFallbackAllowed(boardEl) {
    if (!CONFIG.fallbackEngine) return false;
    const toggle = document.getElementById('analysis') || document.getElementById('evaluationSettings');
    // Con el switch oculto (pestaña Chat, etc.) solo se sigue si se está mirando una partida ajena
    if (toggle ? !toggle.checked : !(switchHiddenButOn() && isWatching(boardEl))) return false;
    // Solo sobre el tablero real, no sobre el marcador que chess.com pinta mientras carga la página
    const tag = (boardEl.tagName || '').toLowerCase();
    if (tag !== 'wc-chess-board' && tag !== 'chess-board') return false;
    const game = getGame(boardEl);
    if (game) {
      try {
        const mode = typeof game.getMode === 'function' ? game.getMode() : null;
        if (mode && mode.name === 'playing') return false;
        const variant = typeof game.getVariant === 'function' ? game.getVariant() : null;
        if (variant && variant !== 'chess') return false; // solo ajedrez estándar
      } catch (e) { /* sin datos de modo: manda el switch */ }
    }
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

  function setKeepPref(on) {
    keepPref = !!on;
    try { localStorage.setItem(KEEP_KEY, keepPref ? '1' : '0'); } catch (e) { /* sin almacenamiento */ }
  }

  function isWatching(boardEl) {
    const game = getGame(boardEl);
    try {
      const mode = game && typeof game.getMode === 'function' ? game.getMode() : null;
      return !!(mode && mode.name === 'observing');
    } catch (e) { return false; }
  }

  function keepAnalysisOn(boardEl) {
    if (!CONFIG.keepAnalysisOnWhileWatching || keepPref !== true) return;
    const toggle = document.getElementById('evaluationSettings');
    if (!toggle) {
      // chess.com todavía no dibujó el switch: se adelanta el arranque del worker (sin analizar nada)
      if (CONFIG.fallbackEngine && isWatching(boardEl)) Engine.prewarm();
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

  // ─────────────────────────── Motor alternativo (Stockfish en un Web Worker) ───────────────────────────
  const Engine = (function () {
    let worker = null;
    let state = 'off';        // off | booting | ready
    let label = '';
    let bootSeq = 0;
    let bootTimer = null, idleTimer = null, stopTimer = null, commitTimer = null, silenceTimer = null;
    let silentKills = 0;
    let candidates = null, candIdx = 0, deadUntil = 0, crashes = 0;
    let bootAttempt = 0, bootCount = 0;
    let optsDirty = false, hashMax = Infinity;

    let searching = false;    // hay un "go" en curso (se espera su "bestmove")
    let discard = false;      // la búsqueda en curso ya no interesa (se envió "stop")
    let searchFen = null;
    let wantedFen = null;
    let pending = new Map();
    let result = null;        // { fen, turn, depth, lines: [{rank, move, type, value, depth}], done }
    let onUpdate = function () {};

    function findEngineCandidates() {
      const urls = [];
      const push = u => { if (typeof u === 'string' && u && urls.indexOf(u) === -1) urls.push(u); };
      const isolated = !!PAGE.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined';

      // chess.com publica en su configuración las rutas del Stockfish que usa para la barra de evaluación
      try {
        const fc = PAGE.chesscom && PAGE.chesscom.featuresConfig;
        if (fc && typeof fc === 'object') {
          const releases = Object.keys(fc)
            .filter(k => /^stockfish_release/i.test(k))
            .map(k => fc[k])
            .filter(r => r && typeof r === 'object')
            .sort((a, b) => (Number(b.version) || 0) - (Number(a.version) || 0));
          for (const r of releases) {
            const p = r.lite && r.lite.paths;
            if (!p) continue;
            push(p.singleThreaded && p.singleThreaded.loader);
            if (isolated) push(p.multiThreaded && p.multiThreaded.loader);
          }
          for (const r of releases) {
            const p = r.lite && r.lite.paths;
            if (p) push(p.asm);
          }
        }
      } catch (e) { /* se intenta la búsqueda genérica */ }

      // Si cambian los nombres de la configuración: buscar cualquier ruta del motor dentro de window.chesscom
      if (!urls.length) {
        try {
          const found = [];
          const seen = new Set();
          let budget = 20000;
          (function walk(o, depth) {
            if (!o || typeof o !== 'object' || depth > 6 || seen.has(o) || budget <= 0) return;
            seen.add(o);
            let keys;
            try { keys = Object.keys(o); } catch (e) { return; }
            for (const k of keys) {
              if (--budget <= 0) return;
              let v;
              try { v = o[k]; } catch (e) { continue; }
              if (typeof v === 'string') {
                if (/assets-chess-engine\/Stockfish\/stockfish[\w.-]*\.js$/i.test(v)) found.push(v);
              } else if (v && typeof v === 'object') walk(v, depth + 1);
            }
          })(PAGE.chesscom, 0);
          found.filter(u => /lite-single/i.test(u)).forEach(push);
          if (isolated) found.filter(u => /lite/i.test(u) && !/single|asm/i.test(u)).forEach(push);
          found.filter(u => /asm/i.test(u)).forEach(push);
        } catch (e) { /* queda el CDN */ }
      }

      const list = urls.map(u => ({ label: u, create: () => new Worker(u) }));
      list.push({
        label: CDN_ENGINE.url,
        create: () => fetch(CDN_ENGINE.url, { integrity: CDN_ENGINE.integrity, credentials: 'omit' })
          .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
          .then(b => new Worker(URL.createObjectURL(new Blob([b], { type: 'application/javascript' }))))
      });
      return list;
    }

    function post(cmd) {
      try { if (worker) worker.postMessage(cmd); } catch (e) { warn('no se pudo enviar "' + cmd + '" al motor:', e); }
    }

    function killWorker() {
      bootSeq++;
      clearTimeout(bootTimer); clearTimeout(stopTimer); clearTimeout(commitTimer); clearTimeout(silenceTimer);
      bootTimer = stopTimer = commitTimer = silenceTimer = null;
      if (worker) { try { worker.terminate(); } catch (e) { /* ya terminado */ } }
      worker = null;
      searching = false; discard = false; searchFen = null;
      state = 'off';
    }

    function boot() {
      if (state !== 'off' || Date.now() < deadUntil) return;
      if (!candidates) candidates = findEngineCandidates();
      if (candIdx >= candidates.length) {
        candIdx = 0; bootAttempt = 0;
        deadUntil = Date.now() + 30000;
        warn('ningún motor alternativo respondió; se reintenta en 30 s');
        return;
      }
      const cand = candidates[candIdx];
      const seq = ++bootSeq;
      const timeouts = CONFIG.engineBootTimeoutsMs;
      const limit = timeouts[Math.min(bootAttempt, timeouts.length - 1)];
      state = 'booting';
      hashMax = Infinity;
      label = cand.label;
      bootCount++;
      markOnce('engineBoot');
      log('arrancando motor (intento ' + (bootAttempt + 1) + '):', label);
      bootTimer = setTimeout(() => { if (seq === bootSeq) bootTimedOut(limit); }, limit);
      Promise.resolve()
        .then(() => cand.create())
        .then(w => {
          if (seq !== bootSeq) { try { w.terminate(); } catch (e) { /* nada */ } return; }
          worker = w;
          w.onmessage = ev => { if (seq === bootSeq) onMessage(ev.data); };
          w.onerror = ev => {
            if (ev && ev.preventDefault) ev.preventDefault();
            if (seq === bootSeq) onWorkerError(ev && ev.message);
          };
          post('uci');
        })
        .catch(err => { if (seq === bootSeq) failCandidate((err && err.message) || String(err)); });
    }

    // El worker no respondió a tiempo. A veces se queda colgado si arranca mientras la página carga,
    // así que primero se reintenta el mismo motor con más margen y solo después se pasa al siguiente.
    function bootTimedOut(limit) {
      bootAttempt++;
      if (bootAttempt < CONFIG.engineBootTimeoutsMs.length) {
        log('el motor no respondió en ' + limit + ' ms; se reintenta');
        killWorker();
        boot();
      } else {
        failCandidate('sin respuesta');
      }
    }

    function failCandidate(reason) {
      warn('el motor "' + label + '" no arrancó (' + reason + '); se prueba el siguiente');
      killWorker();
      candIdx++; bootAttempt = 0;
      boot();
    }

    function onWorkerError(message) {
      if (state === 'booting') { failCandidate(message || 'error'); return; }
      warn('el motor falló:', message || 'error');
      crashes++;
      killWorker();
      result = null;
      if (crashes >= 2) { crashes = 0; candIdx++; bootAttempt = 0; }
      if (wantedFen) boot();
    }

    function onMessage(data) {
      const text = typeof data === 'string' ? data : (data && typeof data.data === 'string' ? data.data : '');
      if (!text) return;
      if (text.indexOf('\n') === -1) { handleLine(text.trim()); return; }
      const parts = text.split('\n');
      for (let i = 0; i < parts.length; i++) handleLine(parts[i].trim());
    }

    function handleLine(line) {
      if (!line) return;
      if (state === 'booting') {
        const hm = /^option name Hash .*\bmax (\d+)/.exec(line);
        if (hm) hashMax = parseInt(hm[1], 10);
        if (line === 'uciok') {
          applyOptions();
          post('isready');
        } else if (line === 'readyok') {
          clearTimeout(bootTimer); bootTimer = null;
          state = 'ready';
          bootAttempt = 0;
          markOnce('engineReady');
          info('motor alternativo listo:', label);
          pump();
        }
        return;
      }
      if (state !== 'ready') return;
      if (line.lastIndexOf('info ', 0) === 0) {
        if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; silentKills = 0; }
        if (searching && !discard) parseInfo(line);
        return;
      }
      if (line.lastIndexOf('bestmove', 0) === 0) {
        clearTimeout(stopTimer); stopTimer = null;
        clearTimeout(silenceTimer); silenceTimer = null;
        const stale = discard;
        searching = false; discard = false;
        if (!stale && result && result.fen === searchFen) {
          flushCommit();
          result.done = true;
          crashes = 0;
          onUpdate();
        }
        pump();
      }
    }

    function parseInfo(line) {
      const pv = / pv ([a-h][1-8][a-h][1-8][qrbn]?)/.exec(line);
      if (!pv) return;
      if (line.indexOf('bound') !== -1) return; // lowerbound/upperbound: valores provisionales
      const sc = / score (cp|mate) (-?\d+)/.exec(line);
      if (!sc) return;
      const d = / depth (\d+)/.exec(line);
      const mp = / multipv (\d+)/.exec(line);
      const rank = mp ? parseInt(mp[1], 10) : 1;
      if (rank < 1 || rank > CONFIG.multiPv) return;
      const depth = d ? parseInt(d[1], 10) : 0;
      const rp = / pv [a-h][1-8][a-h][1-8][qrbn]? ([a-h][1-8][a-h][1-8])/.exec(line);
      let atDepth = pending.get(depth);
      if (!atDepth) { atDepth = new Map(); pending.set(depth, atDepth); }
      atDepth.set(rank, { rank, move: pv[1], reply: rp ? rp[1] : null, type: sc[1], value: parseInt(sc[2], 10), depth });
      if (!commitTimer) commitTimer = setTimeout(() => { commitTimer = null; if (flushCommit()) onUpdate(); }, 40);
    }

    // Pasa a "result" las líneas recibidas (el motor las envía en ráfagas de multiPv líneas)
    function flushCommit() {
      clearTimeout(commitTimer); commitTimer = null;
      if (!result || discard || !pending.size) return false;
      // A mitad de una iteración una jugada puede figurar en dos puestos: se conserva el mejor
      // Solo se usan líneas de una misma profundidad ya completa: si la búsqueda se corta a mitad de una
      // pasada, mezclar profundidades deja las flechas en un orden que no cuadra con sus números.
      const depths = Array.from(pending.keys()).sort((a, b) => b - a);
      let chosen = depths[depths.length - 1];
      for (let i = 0; i < depths.length; i++) {
        const size = pending.get(depths[i]).size;
        let lowerMax = 0;
        for (let j = i + 1; j < depths.length; j++) lowerMax = Math.max(lowerMax, pending.get(depths[j]).size);
        const complete = i + 1 < depths.length ? size >= lowerMax : size >= CONFIG.multiPv;
        if (complete) { chosen = depths[i]; break; }
      }
      depths.forEach(dd => { if (dd < chosen) pending.delete(dd); });
      const seenMoves = new Set();
      const lines = Array.from(pending.get(chosen).values())
        .sort((a, b) => a.rank - b.rank)
        .filter(l => !seenMoves.has(l.move) && seenMoves.add(l.move));
      result.lines = lines;
      result.depth = lines[0].depth;
      return true;
    }

    // Envía al motor los ajustes actuales (solo se llama cuando no hay una búsqueda en curso)
    function applyOptions() {
      optsDirty = false;
      post('setoption name MultiPV value ' + CONFIG.multiPv);
      post('setoption name Hash value ' + Math.max(1, Math.min(CONFIG.hashMb, hashMax)));
    }

    // El usuario cambió un ajuste: se descarta el análisis actual y se repite con los valores nuevos
    function reconfigure() {
      optsDirty = true;
      result = null;
      clearTimeout(commitTimer); commitTimer = null;
      if (state !== 'ready') return;
      if (searching) { interrupt(); return; } // al llegar "bestmove", pump() vuelve a empezar
      pump();
    }

    function start(fen) {
      if (optsDirty) applyOptions();
      searching = true; discard = false; searchFen = fen;
      pending = new Map();
      result = { fen, turn: fen.split(' ')[1] === 'b' ? 'b' : 'w', depth: 0, lines: [], done: false };
      log('analizando', fen);
      post('position fen ' + fen);
      post('go depth ' + CONFIG.maxDepth + ' movetime ' + CONFIG.maxTimeMs);
      // Vigilancia: a veces el worker se queda sin responder (visto al empezar una revancha). Si no dice
      // nada enseguida se reinicia; tras tres seguidas se trata como un fallo del motor.
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        silenceTimer = null;
        if (!searching || discard || searchFen !== fen) return;
        silentKills++;
        diag('engineSilent', { n: silentKills });
        if (silentKills >= 3) { silentKills = 0; onWorkerError('sin respuesta'); return; }
        warn('el motor no responde; se reinicia');
        killWorker();
        result = null;
        if (wantedFen) boot();
      }, CONFIG.engineSilenceMs);
    }

    function pump() {
      if (state !== 'ready' || searching || !wantedFen) return;
      if (result && result.fen === wantedFen) return; // ya analizada
      start(wantedFen);
    }

    function interrupt() {
      if (!searching || discard) return;
      discard = true;
      result = null;
      clearTimeout(commitTimer); commitTimer = null;
      post('stop');
      clearTimeout(stopTimer);
      stopTimer = setTimeout(() => {
        stopTimer = null;
        if (searching && discard) {
          diag('engineStopTimeout', {});
          warn('el motor no respondió a "stop"; se reinicia');
          killWorker();
          if (wantedFen) boot();
        }
      }, CONFIG.engineStopTimeoutMs);
    }

    function request(fen) {
      clearTimeout(idleTimer); idleTimer = null;
      wantedFen = fen;
      if (state === 'off') { boot(); return; }
      if (state !== 'ready') return; // arrancando: pump() al estar listo
      if (searching) {
        if (!discard && searchFen !== fen) interrupt();
        return;
      }
      pump();
    }

    function armIdleTimer() {
      if (state !== 'off' && !idleTimer) {
        idleTimer = setTimeout(() => {
          idleTimer = null;
          if (wantedFen === null && state !== 'off') { log('motor apagado por inactividad'); killWorker(); result = null; }
        }, CONFIG.engineIdleKillMs);
      }
    }

    // Arranca el worker sin analizar nada, para que esté listo cuando haga falta
    function prewarm() {
      if (state === 'off') boot();
      if (wantedFen === null) armIdleTimer();
    }

    function release() {
      if (wantedFen !== null) {
        wantedFen = null;
        if (state === 'ready' && searching) interrupt();
      }
      armIdleTimer();
    }

    function getResult(fen) {
      return result && result.fen === fen && result.lines.length ? result : null;
    }

    function status() {
      return {
        state, label, boots: bootCount, searching, discard, searchFen, wantedFen,
        depth: result ? result.depth : null,
        done: result ? result.done : null,
        lines: result ? result.lines.map(l => l.rank + ':' + l.move + ' ' + l.type + ' ' + l.value + ' d' + l.depth) : []
      };
    }

    return { request, release, prewarm, reconfigure, getResult, status, setOnUpdate: fn => { onUpdate = fn; } };
  })();

  function formatEngineScore(line, whiteToMove) {
    const v = whiteToMove ? line.value : -line.value; // chess.com muestra la evaluación desde el lado blanco
    if (line.type === 'mate') return (v < 0 ? '-M' : '+M') + Math.abs(v);
    const pawns = v / 100;
    return (pawns > 0 ? '+' : '') + pawns.toFixed(2);
  }

  // ─────────────────────────── Dibujo ───────────────────────────
  function getOrCreateOverlay(boardEl) {
    let overlay = boardEl.querySelector('#' + OVERLAY_ID);
    if (!overlay) {
      overlay = document.createElementNS(SVG_NS, 'svg');
      overlay.setAttribute('id', OVERLAY_ID);
      overlay.setAttribute('viewBox', '0 0 100 100');
      overlay.setAttribute('preserveAspectRatio', 'none');
      overlay.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 100;';
      if (getComputedStyle(boardEl).position === 'static') boardEl.style.position = 'relative';
      boardEl.appendChild(overlay);
    }
    return overlay;
  }

  // badgeAt: dónde va el círculo con el número si no puede ir en la casilla de origen (la ocupa otra flecha mejor)
  function drawArrow(fromCoords, toCoords, config, labelText, rankNum, badgeAt) {
    let g = document.createElementNS(SVG_NS, 'g');
    const dx = toCoords.x - fromCoords.x; const dy = toCoords.y - fromCoords.y;
    const len = Math.sqrt(dx * dx + dy * dy); if (!len) return null;
    const rad = Math.atan2(dy, dx);

    const startX = fromCoords.x + Math.cos(rad) * 3.2;
    const startY = fromCoords.y + Math.sin(rad) * 3.2;
    const endX = toCoords.x; const endY = toCoords.y;
    const shaftEndX = endX - Math.cos(rad) * 3.8;
    const shaftEndY = endY - Math.sin(rad) * 3.8;

    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', startX); line.setAttribute('y1', startY);
    line.setAttribute('x2', shaftEndX); line.setAttribute('y2', shaftEndY);
    line.setAttribute('stroke', config.color); line.setAttribute('stroke-width', config.width);
    line.setAttribute('stroke-linecap', 'round'); line.setAttribute('opacity', config.opacity);
    g.appendChild(line);

    const nx = -Math.sin(rad); const ny = Math.cos(rad);
    const poly = document.createElementNS(SVG_NS, 'polygon');
    poly.setAttribute('points', `${endX},${endY} ${shaftEndX + nx * 1.8},${shaftEndY + ny * 1.8} ${shaftEndX - nx * 1.8},${shaftEndY - ny * 1.8}`);
    poly.setAttribute('fill', config.headColor); poly.setAttribute('opacity', config.opacity);
    g.appendChild(poly);

    // La insignia con el número va en un grupo aparte: render() las pone todas encima de las flechas
    const body = g;
    g = document.createElementNS(SVG_NS, 'g');

    const circ = document.createElementNS(SVG_NS, 'circle');
    const bx = badgeAt ? badgeAt.x : fromCoords.x; const by = badgeAt ? badgeAt.y : fromCoords.y;
    circ.setAttribute('cx', bx); circ.setAttribute('cy', by); circ.setAttribute('r', badgeAt ? '1.9' : '2.4');
    circ.setAttribute('fill', config.labelBg); circ.setAttribute('stroke', '#fff'); circ.setAttribute('stroke-width', '0.6');
    g.appendChild(circ);

    const txtRank = document.createElementNS(SVG_NS, 'text');
    txtRank.setAttribute('x', bx); txtRank.setAttribute('y', by + (badgeAt ? 0.75 : 0.9));
    txtRank.setAttribute('font-size', badgeAt ? '2.1' : '2.6'); txtRank.setAttribute('font-weight', 'bold'); txtRank.setAttribute('text-anchor', 'middle'); txtRank.setAttribute('fill', '#fff');
    txtRank.textContent = rankNum;
    g.appendChild(txtRank);

    if (labelText) {
      const lx = Math.min(95, Math.max(5, shaftEndX + nx * 4.2));
      const ly = Math.min(95, Math.max(5, shaftEndY + ny * 4.2));
      const txtScore = document.createElementNS(SVG_NS, 'text');
      txtScore.setAttribute('x', lx); txtScore.setAttribute('y', ly + 0.5);
      txtScore.setAttribute('font-size', '2.2'); txtScore.setAttribute('font-weight', 'bold'); txtScore.setAttribute('text-anchor', 'middle'); txtScore.setAttribute('fill', '#fff');
      // Borde oscuro para que el número se lea también sobre casillas claras
      txtScore.setAttribute('stroke', '#14181f'); txtScore.setAttribute('stroke-width', '0.7'); txtScore.setAttribute('paint-order', 'stroke');
      txtScore.textContent = labelText;
      body.appendChild(txtScore);
    }
    return { body, badge: g };
  }

  // Estilos que imitan las flechas que dibuja la propia página (clic derecho en chess.com, motor en Lichess).
  // Un solo color, sin círculos numerados (índice 0 = mejor jugada). Solo la mejor va a tamaño completo;  // las demás son claramente más pequeñas y transparentes para que no se confundan con ella.
  const NATIVE_STYLES = {
    chesscom: { color: '#ffaa00', other: '#ffaa00', opacity: [0.9, 0.62, 0.52, 0.44, 0.38], scale: [1, 0.55, 0.55, 0.5, 0.46], shaft: 2.75, headW: 6.5, headL: 4.4, start: 4.4, knightL: true },
    lichess: { color: '#003088', other: '#4a4a4a', opacity: [0.55, 0.42, 0.36, 0.3, 0.26], scale: [1.2, 0.68, 0.68, 0.62, 0.56], shaft: 1.95, headW: 6.2, headL: 4.8, start: 1.5, knightL: false }
  };

  // covered: la flecha va encima de otra más larga del mismo color; se le da borde para que se distinga
  function drawNativeArrow(from, to, st, rank, labelText, covered) {
    const i = Math.max(0, Math.min(rank, 5) - 1);
    const k = st.scale[i];
    const dx = to.x - from.x; const dy = to.y - from.y;
    if (!dx && !dy) return null;
    const adx = Math.abs(dx); const ady = Math.abs(dy);
    // chess.com dibuja el salto de caballo en L: primero el tramo largo, luego gira
    const isKnight = st.knightL && Math.abs(Math.max(adx, ady) - 25) < 0.5 && Math.abs(Math.min(adx, ady) - 12.5) < 0.5;
    const corner = isKnight ? (adx > ady ? { x: to.x, y: from.y } : { x: from.x, y: to.y }) : null;
    const a = corner || from; // inicio del último tramo
    const lx = to.x - a.x; const ly = to.y - a.y;
    const ll = Math.sqrt(lx * lx + ly * ly);
    const ux = lx / ll; const uy = ly / ll;
    const headL = st.headL * k; const headW = st.headW * k;
    const bx = to.x - ux * headL; const by = to.y - uy * headL; // base de la punta
    const fx = (corner ? corner.x : to.x) - from.x; const fy = (corner ? corner.y : to.y) - from.y;
    const fl = Math.sqrt(fx * fx + fy * fy);
    const sx = from.x + fx / fl * st.start; const sy = from.y + fy / fl * st.start;
    const color = rank === 1 ? st.color : st.other;

    const g = document.createElementNS(SVG_NS, 'g');
    // La opacidad va en el grupo: así el trazo y la punta no se oscurecen donde se pisan
    const shape = document.createElementNS(SVG_NS, 'g');
    shape.setAttribute('opacity', st.opacity[i]);
    const line = document.createElementNS(SVG_NS, 'polyline');
    line.setAttribute('points', sx + ',' + sy + (corner ? ' ' + corner.x + ',' + corner.y : '') + ' ' + bx + ',' + by);
    line.setAttribute('fill', 'none'); line.setAttribute('stroke', color); line.setAttribute('stroke-width', st.shaft * k);
    line.setAttribute('stroke-linejoin', 'miter'); line.setAttribute('stroke-linecap', 'butt');
    shape.appendChild(line);
    const head = document.createElementNS(SVG_NS, 'polygon');
    head.setAttribute('points', to.x + ',' + to.y + ' ' + (bx - uy * headW / 2) + ',' + (by + ux * headW / 2) + ' ' + (bx + uy * headW / 2) + ',' + (by - ux * headW / 2));
    head.setAttribute('fill', color);
    if (covered) {
      head.setAttribute('stroke', '#ffffff'); head.setAttribute('stroke-width', '0.5'); head.setAttribute('stroke-linejoin', 'round');
    }
    shape.appendChild(head);
    g.appendChild(shape);

    if (labelText) {
      const txt = document.createElementNS(SVG_NS, 'text');
      txt.setAttribute('x', Math.min(95, Math.max(5, bx - uy * 4.2))); txt.setAttribute('y', Math.min(95, Math.max(5, by + ux * 4.2)) + 0.5);
      txt.setAttribute('font-size', '2.2'); txt.setAttribute('font-weight', 'bold'); txt.setAttribute('text-anchor', 'middle'); txt.setAttribute('fill', '#fff');
      txt.setAttribute('stroke', '#14181f'); txt.setAttribute('stroke-width', '0.7'); txt.setAttribute('paint-order', 'stroke');
      txt.textContent = labelText;
      g.appendChild(txt);
    }
    return { body: g, badge: null };
  }

  // Respuesta esperada del rival a la mejor jugada: flecha gris, fina y discontinua, sin número
  function drawReplyArrow(from, to) {
    const dx = to.x - from.x; const dy = to.y - from.y;
    const len = Math.sqrt(dx * dx + dy * dy); if (!len) return null;
    const ux = dx / len; const uy = dy / len;
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('opacity', '0.7');
    const sx = to.x - ux * 3; const sy = to.y - uy * 3;
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', from.x + ux * 2); line.setAttribute('y1', from.y + uy * 2);
    line.setAttribute('x2', sx); line.setAttribute('y2', sy);
    line.setAttribute('stroke', '#c9ccd1'); line.setAttribute('stroke-width', '1.3'); line.setAttribute('stroke-dasharray', '2 1.4');
    g.appendChild(line);
    const poly = document.createElementNS(SVG_NS, 'polygon');
    poly.setAttribute('points', to.x + ',' + to.y + ' ' + (sx - uy * 1.4) + ',' + (sy + ux * 1.4) + ' ' + (sx + uy * 1.4) + ',' + (sy - ux * 1.4));
    poly.setAttribute('fill', '#c9ccd1');
    g.appendChild(poly);
    return g;
  }

  // ¿b sale de la misma casilla que a y en la misma dirección? (una tapa a la otra)
  function sameRay(a, b) {
    if (a.from.x !== b.from.x || a.from.y !== b.from.y) return false;
    const cross = a.dx * b.dy - a.dy * b.dx;
    const dot = a.dx * b.dx + a.dy * b.dy;
    return Math.abs(cross) < 0.01 && dot > 0;
  }

  // Tras una jugada, las flechas anteriores se dejan atenuadas un momento en vez de borrarlas,
  // para que el tablero no parpadee mientras llega el análisis de la posición nueva.
  let holdSince = 0;
  let linesListed = false; // chess.com muestra ahora su panel de líneas (lo actualiza el bucle principal)
  let holdTimer = null;
  function holdArrows(overlay, isFlipped, source) {
    const now = Date.now();
    if (overlay.getAttribute('data-sig')) {
      if (!holdSince) holdSince = now;
      if (now - holdSince < 600) {
        overlay.style.opacity = '0.35';
        if (!holdTimer) holdTimer = setTimeout(() => { holdTimer = null; schedule(); }, 620);
        return;
      }
    }
    render(overlay, null, isFlipped, source);
  }

  function scoresVisible() {
    return linesListed ? !!CONFIG.scoresWithLines : !!CONFIG.scoresWatch;
  }

  // Dibuja la lista de flechas [{rank, from, to, label}]; solo toca el DOM si algo cambió
  function render(overlay, arrows, isFlipped, source) {
    const all = arrows || [];
    const reply = all.filter(a => a.reply)[0] || null;
    const list = all.filter(a => !a.reply);
    if (list.length) holdSince = 0;
    if (overlay.style.opacity) overlay.style.opacity = '';
    const sig = list.length
      ? source + '|' + CONFIG.arrowStyle + (scoresVisible() ? 's' : '') + '|' + (isFlipped ? 'f' : 'n') + '|' + list.map(a => a.rank + a.from + a.to + '=' + a.label).join(',') + (reply ? '|r' + reply.from + reply.to : '')
      : '';
    if (overlay.getAttribute('data-sig') === sig) return;
    overlay.setAttribute('data-sig', sig);
    overlay.setAttribute('data-source', list.length ? source : 'none');
    if (list.length && !('arrows' in timeline)) { markOnce('arrows'); timeline.arrowsFrom = source; }
    while (overlay.firstChild) overlay.removeChild(overlay.firstChild);

    // Se dibuja de la peor a la mejor para que la flecha 1 quede encima
    const items = [];
    list.slice().sort((a, b) => b.rank - a.rank).forEach(a => {
      const config = ARROW_CONFIG[a.rank - 1];
      if (!config) return;
      const from = squareToCoords(a.from, isFlipped);
      const to = squareToCoords(a.to, isFlipped);
      if (!from || !to) return;
      const dx = to.x - from.x; const dy = to.y - from.y;
      items.push({ a, config, from, to, dx, dy, len: dx * dx + dy * dy });
    });

    // Flechas que salen de la misma casilla por la misma línea (p. ej. torre a c1, e1 y f1):
    // la más larga va debajo y la más corta encima, así se ve un tramo de cada color.
    for (let pass = 0; pass < items.length; pass++) {
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          if (items[i].len < items[j].len && sameRay(items[i], items[j])) {
            const t = items[i]; items[i] = items[j]; items[j] = t;
          }
        }
      }
    }

    if (reply) {
      const rf = squareToCoords(reply.from, isFlipped); const rt = squareToCoords(reply.to, isFlipped);
      const rEl = rf && rt ? drawReplyArrow(rf, rt) : null;
      if (rEl) overlay.appendChild(rEl); // debajo de las demás flechas
    }

    const nativeStyle = NATIVE_STYLES[CONFIG.arrowStyle] || null;
    const badges = [];
    items.forEach(it => {
      const label = scoresVisible() ? it.a.label : '';
      // Si una flecha mejor sale de la misma casilla, el número de esta va sobre su propio trazo
      const shared = items.some(o => o !== it && o.a.rank < it.a.rank && o.from.x === it.from.x && o.from.y === it.from.y);
      const badgeAt = shared ? { x: it.from.x + it.dx * 0.62, y: it.from.y + it.dy * 0.62 } : null;
      const el = nativeStyle
        ? drawNativeArrow(it.from, it.to, nativeStyle, it.a.rank, label, items.some(o => o !== it && o.len > it.len && sameRay(it, o)))
        : drawArrow(it.from, it.to, it.config, label, it.a.rank, badgeAt);
      if (!el) return;
      overlay.appendChild(el.body);
      if (el.badge) badges.push({ rank: it.a.rank, node: el.badge });
    });
    // Las insignias al final, la del número 1 encima si comparten casilla
    badges.sort((x, y) => y.rank - x.rank).forEach(b => overlay.appendChild(b.node));
  }

  // ─────────────────────────── Panel de ajustes ───────────────────────────
  // Un engranaje en la esquina superior derecha del tablero abre un panel con deslizadores.
  // Va colgado de <body> (no dentro del tablero) para que sus clics no lleguen al tablero.
  const UI = (function () {
    // Mismo idioma que la página de chess.com (o el del navegador si no lo indica)
    const ES = /^es/i.test(document.documentElement.lang || navigator.language || '');
    const T = ES
      ? { title: 'Flechas · ajustes', multiPv: 'Flechas', maxTimeMs: 'Tiempo de búsqueda', maxDepth: 'Profundidad máx.', hashMb: 'Memoria',
          ownEngineOnly: 'Ignorar las líneas de chess.com (solo motor propio)', showReply: 'Mostrar la respuesta esperada (flecha gris)', scoresWatch: 'Evaluación junto a las flechas al mirar partidas (Watch)', scoresWithLines: 'Evaluación junto a las flechas donde chess.com lista líneas (Events, Análisis)',
          arrowStyle: 'Estilo de las flechas', style_color: 'Colores numerados', style_chesscom: 'Como chess.com (naranja)', style_lichess: 'Como Lichess (azul y gris)', hideWorseBy: 'Ocultar flechas peores por', tag: 'flechas',
          own: 'Motor propio', depth: 'profundidad', dom: 'Flechas leídas de las líneas de chess.com. Si pides más de las que chess.com lista, las que faltan las calcula el motor propio con estos ajustes.', idle: 'Sin análisis en este momento.', reset: 'Restablecer' }
      : { title: 'Arrows · settings', multiPv: 'Arrows', maxTimeMs: 'Search time', maxDepth: 'Max depth', hashMb: 'Memory',
          ownEngineOnly: 'Ignore chess.com\'s lines (own engine only)', showReply: 'Show the expected reply (grey arrow)', scoresWatch: 'Evaluation next to the arrows while watching games (Watch)', scoresWithLines: 'Evaluation next to the arrows where chess.com lists lines (Events, Analysis)',
          arrowStyle: 'Arrow style', style_color: 'Numbered colours', style_chesscom: 'Like chess.com (orange)', style_lichess: 'Like Lichess (blue and grey)', hideWorseBy: 'Hide arrows worse by', tag: 'arrows',
          own: 'Own engine', depth: 'depth', dom: 'Arrows read from chess.com\'s engine lines. If you ask for more than chess.com lists, the script\'s own engine adds the missing ones with these settings.', idle: 'No analysis right now.', reset: 'Reset' };
    const DEFAULTS = SETTING_DEFAULTS;

    let btn = null, panel = null, box = null, modalSection = null, statusEl = null, styleSel = null, open = false, applyTimer = null, engineDirty = false;
    const boolBoxes = {};
    const rows = {};

    function el(tag, css, text) {
      const n = document.createElement(tag);
      if (css) n.style.cssText = css;
      if (text != null) n.textContent = text;
      return n;
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

    function build() {
      if (box) return;
      box = el('div', '');
      btn = el('div', 'position:fixed;z-index:1000;width:20px;height:20px;border-radius:4px;display:none;align-items:center;justify-content:center;' +
        'background:rgba(20,24,31,.55);color:#fff;font:14px/1 sans-serif;cursor:pointer;opacity:.5;user-select:none;', '⚙');
      btn.id = 'top3arrows-settings-button';
      btn.title = T.title;
      btn.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
      btn.addEventListener('mouseleave', () => { if (!open) btn.style.opacity = '.5'; });
      btn.addEventListener('click', e => { e.stopPropagation(); open = !open; sync(); });

      panel = el('div', 'position:fixed;z-index:1001;width:250px;box-sizing:border-box;padding:10px 12px;border-radius:6px;display:none;' +
        'background:#262421;color:#e8e6e3;font:13px/1.3 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.5);');
      panel.id = 'top3arrows-settings-panel';
      panel.appendChild(el('div', 'font-weight:600;margin-bottom:8px;', T.title));

      const styleRow = el('div', 'margin-bottom:10px;');
      styleRow.appendChild(el('div', 'margin-bottom:3px;', T.arrowStyle));
      styleSel = el('select', 'width:100%;box-sizing:border-box;background:#3c3a37;color:#e8e6e3;border:1px solid #5a5856;border-radius:4px;padding:4px 6px;font:inherit;cursor:pointer;');
      ARROW_STYLES.forEach(s => { const o = el('option', '', T['style_' + s]); o.value = s; styleSel.appendChild(o); });
      styleSel.addEventListener('change', () => {
        if (ARROW_STYLES.indexOf(styleSel.value) === -1) return;
        CONFIG.arrowStyle = styleSel.value;
        changed(false);
      });
      styleRow.appendChild(styleSel);
      box.appendChild(styleRow);

      SETTING_DEFS.forEach(def => {
        const row = el('div', 'margin-bottom:8px;');
        const head = el('div', 'display:flex;justify-content:space-between;margin-bottom:2px;');
        head.appendChild(el('span', '', T[def.key]));
        const value = el('span', 'color:#9fd36a;font-variant-numeric:tabular-nums;');
        head.appendChild(value);
        const input = el('input', 'width:100%;margin:0;accent-color:#81b64c;cursor:pointer;');
        input.type = 'range';
        input.min = String(def.values ? 0 : def.min);
        input.max = String(def.values ? def.values.length - 1 : def.max);
        input.step = String(def.values ? 1 : def.step);
        input.addEventListener('input', () => {
          const n = Number(input.value);
          const v = def.values ? def.values[n] : n;
          if (!isValidSetting(def, v) || v === CONFIG[def.key]) return;
          CONFIG[def.key] = v;
          changed(def.key !== 'hideWorseBy');
        });
        row.appendChild(head); row.appendChild(input);
        box.appendChild(row);
        rows[def.key] = { input, value };
      });

      BOOL_SETTINGS.forEach(k => {
        const boolRow = el('label', 'display:flex;align-items:center;gap:6px;margin-bottom:8px;cursor:pointer;');
        const cb = el('input', 'margin:0;accent-color:#81b64c;cursor:pointer;');
        cb.type = 'checkbox';
        cb.addEventListener('change', () => { CONFIG[k] = cb.checked; changed(false); });
        boolRow.appendChild(cb);
        boolRow.appendChild(el('span', '', T[k]));
        box.appendChild(boolRow);
        boolBoxes[k] = cb;
      });

      statusEl = el('div', 'color:#a8a6a2;font-size:12px;min-height:16px;margin-bottom:8px;');
      box.appendChild(statusEl);
      const reset = el('button', 'background:#3c3a37;color:#e8e6e3;border:0;border-radius:4px;padding:4px 10px;font:inherit;cursor:pointer;', T.reset);
      reset.type = 'button';
      reset.addEventListener('click', () => {
        SETTING_DEFS.forEach(def => { CONFIG[def.key] = DEFAULTS[def.key]; });
        BOOL_SETTINGS.forEach(k => { CONFIG[k] = DEFAULTS[k]; });
        CONFIG.arrowStyle = DEFAULTS.arrowStyle;
        changed(true);
      });
      box.appendChild(reset);
      panel.appendChild(box);

      // Bloque que se inserta en la ventana de ajustes de chess.com (pestaña Analysis)
      modalSection = el('div', 'margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid rgba(255,255,255,.12);font-size:14px;color:rgba(255,255,255,.85);');
      modalSection.id = 'top3arrows-settings-section';
      modalSection.appendChild(el('div', 'font-weight:600;margin-bottom:10px;', T.title));

      document.body.appendChild(btn);
      document.body.appendChild(panel);
      // Un clic fuera del panel lo cierra
      document.addEventListener('mousedown', e => {
        if (open && !panel.contains(e.target) && !btn.contains(e.target)) { open = false; sync(); }
      }, true);
      syncRows();
    }

    function statusText() {
      if (lastSource === 'dom') return T.dom;
      if (lastSource === 'engine') {
        const s = Engine.status();
        const name = (/stockfish[-.]?(\d+)/i.exec(s.label) || [])[1];
        return T.own + (name ? ' · Stockfish ' + name : '') + (s.depth ? ' · ' + T.depth + ' ' + s.depth : '');
      }
      return T.idle;
    }

    // Los ajustes viven dentro de la ventana de ajustes de chess.com (el engranaje del tablero o el de
    // la barra Analysis), al principio de su pestaña Analysis. chess.com redibuja esa ventana al
    // cambiar de pestaña, así que se comprueba en cada pasada.
    function syncModal() {
      // chess.com tiene tres ventanas de ajustes distintas (Events, Play/Watch y la página de Análisis).
      // La pestaña del motor se reconoce en todas, y en cualquier idioma, por su desplegable con "Stockfish".
      let content = null;
      const hosts = document.querySelectorAll('.settings-modal-content-content, .settings-engine-component');
      for (let i = 0; i < hosts.length && !content; i++) {
        const opts = hosts[i].querySelectorAll('select option');
        for (let j = 0; j < opts.length; j++) {
          if (/stockfish/i.test(opts[j].textContent || '')) { content = hosts[i]; break; }
        }
      }
      if (!content) {
        if (modalSection && modalSection.parentNode) {
          modalSection.parentNode.removeChild(modalSection);
          panel.appendChild(box);
        }
        return;
      }
      build();
      if (box.parentNode !== modalSection) modalSection.appendChild(box);
      if (modalSection.parentNode !== content || content.firstChild !== modalSection) content.insertBefore(modalSection, content.firstChild);
      const txt = statusText();
      if (statusEl.textContent !== txt) statusEl.textContent = txt;
    }

    // Profundidad del motor propio junto al "depth=N" de chess.com (que es la de su motor)
    function syncDepthTag() {
      let tag = document.getElementById('top3arrows-depth');
      const host = CONFIG.showDepthTag ? document.querySelector('wc-evaluation-depth') : null;
      const d = lastSource === 'engine' ? Engine.status().depth : null;
      if (!host || !host.parentNode || !d) { if (tag && tag.parentNode) tag.parentNode.removeChild(tag); return; }
      if (!tag) { tag = el('span', 'opacity:.8;'); tag.id = 'top3arrows-depth'; }
      if (host.nextSibling !== tag) host.parentNode.insertBefore(tag, host.nextSibling);
      const txt = ' | ' + T.tag + ' d=' + d;
      if (tag.textContent !== txt) tag.textContent = txt;
    }

    // Coloca (u oculta) el engranaje y el panel según el estado actual
    function sync() {
      syncModal();
      syncDepthTag();
      // Sin sesión, el engranaje del tablero de chess.com abre el aviso de registro en vez de sus ajustes:
      // ahí se muestra el engranaje propio.
      const guest = document.querySelector('a[href*="/register"]') !== null;
      if (!CONFIG.ownGearButton && !guest) {
        open = false;
        if (btn) { btn.style.display = 'none'; panel.style.display = 'none'; }
        return;
      }
      const boardEl = getMainBoard();
      const active = !!boardEl && isAnalysisActive() && (lastSource === 'dom' || lastSource === 'engine' || open);
      if (!active) {
        open = false;
        if (btn) { btn.style.display = 'none'; panel.style.display = 'none'; }
        return;
      }
      build();
      const r = boardEl.getBoundingClientRect();
      if (r.width < 50) { btn.style.display = 'none'; panel.style.display = 'none'; return; }
      btn.style.display = 'flex';
      btn.style.left = Math.round(r.right - 23) + 'px';
      btn.style.top = Math.round(r.top + 3) + 'px';
      btn.style.opacity = open ? '1' : (btn.matches(':hover') ? '1' : '.5');
      panel.style.display = open ? 'block' : 'none';
      if (open) {
        panel.style.left = Math.max(4, Math.round(r.right - 253)) + 'px';
        panel.style.top = Math.round(r.top + 27) + 'px';
        const txt = statusText();
        if (statusEl.textContent !== txt) statusEl.textContent = txt;
      }
    }

    return { sync };
  })();

  // ─────────────────────────── Bucle principal ───────────────────────────
  let scheduled = false;
  let noLinesSince = 0;   // desde cuándo el análisis está activo sin líneas en la página
  let depthSeenSince = 0; // desde cuándo se ve trabajar al motor de chess.com sin panel de líneas
  let graceTimer = null;
  let graceTimerDue = 0;
  let lastSource = 'none';
  let lastError = '';

  let arrowsHidden = false; // Alt + tecla (CONFIG.hotkey) oculta o muestra las flechas; no se guarda

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

  function update() {
    scheduled = false;
    try { updateInner(); }
    catch (e) {
      const msg = String(e && e.message || e);
      if (msg !== lastError) { lastError = msg; warn('error al actualizar:', e); }
    }
    try { UI.sync(); } catch (e) { log('panel de ajustes:', e); }
    try { diagSnapshot(); } catch (e) { /* el diagnóstico nunca debe romper nada */ }
  }

  function updateInner() {
    const boardEl = getMainBoard();
    if (!boardEl) { resetWait(); lastSource = 'none'; Engine.release(); return; }
    if (getGame(boardEl)) markOnce('board');

    keepAnalysisOn(boardEl);

    const overlay = getOrCreateOverlay(boardEl);
    if (arrowsHidden || !isAnalysisActive()) {
      resetWait(); lastSource = 'off';
      Engine.release();
      render(overlay, null, false, 'off');
      return;
    }
    markOnce('analysisOn');

    const isFlipped = boardEl.classList.contains('flipped');

    // Partida terminada y tablero en su última jugada: no hay nada que sugerir
    if (CONFIG.hideAtGameEnd && isFinishedAtEnd(boardEl)) {
      resetWait(); lastSource = 'none';
      Engine.release();
      render(overlay, null, isFlipped, 'none');
      return;
    }

    // 1) Camino normal: chess.com muestra las líneas de su motor → se leen del DOM
    const lines = getAnalysisLines();
    linesListed = lines.length > 0;

    // 0) "Usar siempre el motor propio": igual que en Watch, todas las flechas salen del mismo motor
    //    y respetan los ajustes del panel. Mientras calcula se muestran las líneas de chess.com (paso 1).
    const preferOwn = CONFIG.ownEngineOnly && lines.length > 0 && isFallbackAllowed(boardEl);
    if (preferOwn) {
      const fen = getPositionFen(boardEl);
      const res = fen ? Engine.getResult(fen) : null;
      if (fen) Engine.request(fen);
      if (res && (res.depth >= CONFIG.minDepthToDraw || res.done)) {
        resetWait(); lastSource = 'engine';
        render(overlay, engineArrows(res), isFlipped, 'engine');
        return;
      }
    }

    if (lines.length) {
      resetWait(); lastSource = 'dom';
      const pieces = getBoardPieces(boardEl);
      const legal = getLegalInfo(boardEl);
      const arrows = [];
      lines.forEach(line => {
        const move = resolveLineMove(line, legal, pieces);
        // chess.com a veces repite una jugada en dos líneas mientras las actualiza: se dibuja una sola vez
        if (move && !arrows.some(a => a.from === move.from && a.to === move.to)) arrows.push({ rank: line.rank, from: move.from, to: move.to, label: line.score });
      });

      // chess.com lista menos líneas que las flechas pedidas en el panel (su ajuste "Engine Lines"
      // suele ser 3): las que faltan se completan con el motor propio, sin repetir jugadas.
      let source = 'dom';
      const fen = preferOwn ? getPositionFen(boardEl)
        : (arrows.length && arrows.length < CONFIG.multiPv && isFallbackAllowed(boardEl)) ? getPositionFen(boardEl) : null;
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
            arrows.push({ rank: ++rank, from: key.slice(0, 2), to: key.slice(2, 4), label: formatEngineScore(l, whiteToMove) });
          }
          source = 'dom+engine';
        }
      } else {
        Engine.release();
      }
      render(overlay, arrows, isFlipped, source);
      return;
    }

    // 2) chess.com no muestra líneas (p. ej. pestaña Watch: solo barra de evaluación) → motor alternativo
    if (!isFallbackAllowed(boardEl)) {
      resetWait(); lastSource = 'none';
      Engine.release();
      render(overlay, null, isFlipped, 'none');
      return;
    }

    // Se espera un momento por si chess.com todavía está cargando sus propias líneas.
    // En la vista Play/Watch (la que suele traer solo la barra) se arranca ya el worker,
    // para que esté listo cuando termine la espera.
    const now = Date.now();
    if (!noLinesSince) noLinesSince = now;
    if (document.getElementById('evaluationSettings')) Engine.prewarm();
    const panel = hasLinesPanel();
    // Si el motor de chess.com ya trabaja y la página no tiene panel de líneas, es que solo
    // va a mostrar la barra de evaluación: no hace falta agotar la espera máxima.
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
      lastSource = 'none';
      render(overlay, null, isFlipped, 'none');
      return;
    }

    const fen = getPositionFen(boardEl);
    if (!fen) {
      lastSource = 'none';
      Engine.release();
      render(overlay, null, isFlipped, 'none');
      return;
    }

    lastSource = 'engine';
    Engine.request(fen);
    const res = Engine.getResult(fen);
    if (!res || (res.depth < CONFIG.minDepthToDraw && !res.done)) {
      holdArrows(overlay, isFlipped, 'engine'); // posición nueva: las flechas anteriores se atenúan un instante y luego se borran
      return;
    }
    render(overlay, engineArrows(res), isFlipped, 'engine');
  }

  function engineArrows(res) {
    const whiteToMove = res.turn !== 'b';
    // Valor comparable entre líneas (desde el lado que mueve); un mate vale más que cualquier ventaja
    const cp = l => l.type === 'mate' ? (l.value > 0 ? 100000 - l.value : -100000 - l.value) : l.value;
    let lines = res.lines.slice(0, CONFIG.multiPv);
    if (CONFIG.hideWorseBy > 0 && lines.length) {
      const best = cp(lines[0]);
      lines = lines.filter((l, i) => i === 0 || best - cp(l) <= CONFIG.hideWorseBy);
    }
    const arrows = lines.map(l => ({
      rank: l.rank,
      from: l.move.slice(0, 2),
      to: l.move.slice(2, 4),
      label: formatEngineScore(l, whiteToMove)
    }));
    if (CONFIG.showReply && lines.length && lines[0].reply) {
      arrows.push({ reply: true, rank: 0, from: lines[0].reply.slice(0, 2), to: lines[0].reply.slice(2, 4), label: '' });
    }
    return arrows;
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(update);
  }

  function init() {
    Engine.setOnUpdate(schedule);

    // Un clic real del usuario sobre el switch Analysis de la vista Play/Watch fija su preferencia.
    // Los clics que hace este script (o chess.com) no cuentan: no son eventos de confianza.
    document.addEventListener('click', e => {
      if (!e.isTrusted) return;
      const t = e.target;
      if (t && t.closest && (t.id === 'evaluationSettings' || t.closest('label[for="evaluationSettings"]'))) userSwitchClickAt = Date.now();
    }, true);

    document.addEventListener('keydown', e => {
      if (!CONFIG.hotkey || !e.altKey || e.ctrlKey || e.metaKey || e.repeat) return;
      if (String(e.key).toLowerCase() !== String(CONFIG.hotkey).toLowerCase()) return;
      const k = e.target;
      if (k && (k.isContentEditable || /^(input|textarea|select)$/i.test(k.tagName || ''))) return; // no mientras se escribe (chat, buscador)
      arrowsHidden = !arrowsHidden;
      e.preventDefault();
      schedule();
    });

    document.addEventListener('change', e => {
      const t = e.target;
      if (!t) return;
      if (t.id === 'evaluationSettings' && Date.now() - userSwitchClickAt < 800) setKeepPref(t.checked);
      if (t.id === 'analysis' || t.id === 'evaluationSettings' || classNameOf(t).indexOf('cc-switch-checkbox') !== -1) schedule();
    });

    const WATCHED = 'wc-evaluation-lines, wc-chess-board, chess-board, .board, .engine-lines-engine-lines-redesign, .evaluation-settings-component, .analysis-options-component, .settings-modal-container-component';
    const WATCHED_CLASSES = ['evaluation-lines-node', 'evaluation-lines-component', 'engine-line-node', 'engine-line-component', 'piece'];
    const MOUNTS = '#evaluationSettings, #analysis, wc-evaluation-lines, wc-chess-board, .settings-modal-container-component';
    const obs = new MutationObserver(mutations => {
      for (let i = 0; i < mutations.length; i++) {
        const m = mutations[i];
        const t = m.target;
        const el = t && (t.nodeType === 1 ? t : t.parentElement);
        if (!el || !el.closest) continue;
        if (el.closest('#' + OVERLAY_ID)) continue; // cambios hechos por este script
        const cl = el.classList;
        if (el.closest(WATCHED) || (cl && WATCHED_CLASSES.some(c => cl.contains(c)))) {
          schedule();
          return;
        }
        // chess.com acaba de montar el switch, el panel de líneas o el tablero
        const added = m.addedNodes;
        for (let j = 0; added && j < added.length; j++) {
          const n = added[j];
          if (n.nodeType === 1 && (n.matches(MOUNTS) || n.querySelector(MOUNTS))) { schedule(); return; }
        }
      }
    });

    obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'checked'] });

    // El engranaje sigue al tablero al desplazar o redimensionar
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);

    setInterval(schedule, 500);
    schedule();
  }

  PAGE.__top3ArrowsHybrid = {
    version: '9.6.6',
    config: CONFIG,
    refresh: update,
    // timeline: ms desde que empezó a cargar la página hasta cada etapa (script, board, analysisOn, engineBoot, engineReady, arrows)
    log: () => diagText(),
    clearLog: () => { diagLog = []; diagPrev = {}; diagSave(); },
    status: () => ({ source: lastSource, keepAnalysis: keepPref, timeline: Object.assign({}, timeline), engine: Engine.status() })
  };

  info('v9.6.6 cargado.');

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
