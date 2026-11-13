// ==UserScript==
// @name         Chess.com - Top 3 Analysis Arrows
// @namespace    https://github.com/hediondom/Chess.com-Arrows
// @version      9.1.0
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
    multiPv: 3,                 // líneas que calcula el motor alternativo
    maxDepth: 18,               // el motor alternativo se detiene al llegar a esta profundidad...
    maxTimeMs: 8000,            // ...o tras este tiempo por posición (lo que ocurra primero)
    minDepthToDraw: 8,          // no dibujar hasta esta profundidad (evita flechas que saltan)
    graceEngineSeenMs: 100,     // espera cuando el motor de chess.com ya trabaja y la página no tiene panel de líneas
    graceNoPanelMs: 1000,       // espera máxima antes de usar el motor si la página no tiene panel de líneas
    graceEmptyPanelMs: 3000,    // espera si el panel de líneas existe pero está vacío
    engineBootTimeoutsMs: [2500, 6000, 12000], // si el worker no responde se reintenta el mismo motor con más margen; luego se pasa al siguiente
    engineIdleKillMs: 60000,    // apaga el worker del motor tras este tiempo sin usarse
    debug: false                // true = mensajes detallados en la consola
  };

  const ARROW_CONFIG = [
    { rank: 1, color: '#00d26a', headColor: '#00b058', opacity: 0.88, width: 3.2, labelBg: '#00d26a' },
    { rank: 2, color: '#38bdf8', headColor: '#0284c7', opacity: 0.78, width: 2.6, labelBg: '#0284c7' },
    { rank: 3, color: '#fb923c', headColor: '#ea580c', opacity: 0.68, width: 2.2, labelBg: '#fb923c' }
  ];

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
      for (const m of moves) {
        if (!m || typeof m.san !== 'string' || typeof m.from !== 'string' || typeof m.to !== 'string') continue;
        const key = normalizeSan(m.san);
        if (!bySan.has(key)) bySan.set(key, { from: m.from, to: m.to });
      }
      const turnField = fen.split(' ')[1];
      const result = { bySan, turnWhite: turnField === 'w' ? true : (turnField === 'b' ? false : null) };
      legalCache = { fen, info: result };
      return result;
    } catch (e) { return null; }
  }

  function resolveLineMove(line, legal, pieces) {
    const san = normalizeSan(line.moveText);
    if (!san) return null;
    if (legal) {
      const m = legal.bySan.get(san);
      if (m) {
        if (san === 'O-O' || san === 'O-O-O') return { from: m.from, to: (san === 'O-O' ? 'g' : 'c') + m.from[1] };
        return { from: m.from, to: m.to };
      }
      // La línea es de otra posición (chess.com todavía no la actualizó): no dibujar flechas viejas
      if (legal.turnWhite !== null && legal.turnWhite !== line.isWhite) return null;
    }
    return findMoveSource(line.moveText, line.isWhite, pieces);
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
      if (idx >= 3) return;
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
      if (idx >= 3) return;
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

  // VERIFICAR SI EL ANÁLISIS ESTÁ ENCENDIDO (COMPATIBLE CON TODAS LAS PÁGINAS)
  function isAnalysisActive() {
    // Busca el ID 'analysis' (Events/Análisis) o 'evaluationSettings' (Play)
    const toggle = document.getElementById('analysis') || document.getElementById('evaluationSettings');
    if (toggle) return toggle.checked;
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
    if (!toggle || !toggle.checked) return false;
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
    log('chess.com apagó Analysis; se vuelve a encender');
    toggle.click();
  }

  // ─────────────────────────── Motor alternativo (Stockfish en un Web Worker) ───────────────────────────
  const Engine = (function () {
    let worker = null;
    let state = 'off';        // off | booting | ready
    let label = '';
    let bootSeq = 0;
    let bootTimer = null, idleTimer = null, stopTimer = null, commitTimer = null;
    let candidates = null, candIdx = 0, deadUntil = 0, crashes = 0;
    let bootAttempt = 0, bootCount = 0;

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
      clearTimeout(bootTimer); clearTimeout(stopTimer); clearTimeout(commitTimer);
      bootTimer = stopTimer = commitTimer = null;
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
        if (line === 'uciok') {
          post('setoption name MultiPV value ' + CONFIG.multiPv);
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
        if (searching && !discard) parseInfo(line);
        return;
      }
      if (line.lastIndexOf('bestmove', 0) === 0) {
        clearTimeout(stopTimer); stopTimer = null;
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
      pending.set(rank, { rank, move: pv[1], type: sc[1], value: parseInt(sc[2], 10), depth: d ? parseInt(d[1], 10) : 0 });
      if (!commitTimer) commitTimer = setTimeout(() => { commitTimer = null; if (flushCommit()) onUpdate(); }, 40);
    }

    // Pasa a "result" las líneas recibidas (el motor las envía en ráfagas de multiPv líneas)
    function flushCommit() {
      clearTimeout(commitTimer); commitTimer = null;
      if (!result || discard || !pending.size) return false;
      // A mitad de una iteración una jugada puede figurar en dos puestos: se conserva el mejor
      const seenMoves = new Set();
      const lines = Array.from(pending.values())
        .sort((a, b) => a.rank - b.rank)
        .filter(l => !seenMoves.has(l.move) && seenMoves.add(l.move));
      result.lines = lines;
      result.depth = lines[0].depth;
      return true;
    }

    function start(fen) {
      searching = true; discard = false; searchFen = fen;
      pending = new Map();
      result = { fen, turn: fen.split(' ')[1] === 'b' ? 'b' : 'w', depth: 0, lines: [], done: false };
      log('analizando', fen);
      post('position fen ' + fen);
      post('go depth ' + CONFIG.maxDepth + ' movetime ' + CONFIG.maxTimeMs);
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
          warn('el motor no respondió a "stop"; se reinicia');
          killWorker();
          if (wantedFen) boot();
        }
      }, 5000);
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

    return { request, release, prewarm, getResult, status, setOnUpdate: fn => { onUpdate = fn; } };
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

  function drawArrow(fromCoords, toCoords, config, labelText, rankNum) {
    const g = document.createElementNS(SVG_NS, 'g');
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

    const circ = document.createElementNS(SVG_NS, 'circle');
    circ.setAttribute('cx', fromCoords.x); circ.setAttribute('cy', fromCoords.y); circ.setAttribute('r', '2.4');
    circ.setAttribute('fill', config.labelBg); circ.setAttribute('stroke', '#fff'); circ.setAttribute('stroke-width', '0.6');
    g.appendChild(circ);

    const txtRank = document.createElementNS(SVG_NS, 'text');
    txtRank.setAttribute('x', fromCoords.x); txtRank.setAttribute('y', fromCoords.y + 0.9);
    txtRank.setAttribute('font-size', '2.6'); txtRank.setAttribute('font-weight', 'bold'); txtRank.setAttribute('text-anchor', 'middle'); txtRank.setAttribute('fill', '#fff');
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
      g.appendChild(txtScore);
    }
    return g;
  }

  // Dibuja la lista de flechas [{rank, from, to, label}]; solo toca el DOM si algo cambió
  function render(overlay, arrows, isFlipped, source) {
    const list = arrows || [];
    const sig = list.length
      ? source + '|' + (isFlipped ? 'f' : 'n') + '|' + list.map(a => a.rank + a.from + a.to + '=' + a.label).join(',')
      : '';
    if (overlay.getAttribute('data-sig') === sig) return;
    overlay.setAttribute('data-sig', sig);
    overlay.setAttribute('data-source', list.length ? source : 'none');
    if (list.length && !('arrows' in timeline)) { markOnce('arrows'); timeline.arrowsFrom = source; }
    while (overlay.firstChild) overlay.removeChild(overlay.firstChild);

    // Se dibuja de la peor a la mejor para que la flecha 1 quede encima
    list.slice().sort((a, b) => b.rank - a.rank).forEach(a => {
      const config = ARROW_CONFIG[a.rank - 1];
      if (!config) return;
      const from = squareToCoords(a.from, isFlipped);
      const to = squareToCoords(a.to, isFlipped);
      if (from && to) {
        const el = drawArrow(from, to, config, a.label, a.rank);
        if (el) overlay.appendChild(el);
      }
    });
  }

  // ─────────────────────────── Bucle principal ───────────────────────────
  let scheduled = false;
  let noLinesSince = 0;   // desde cuándo el análisis está activo sin líneas en la página
  let depthSeenSince = 0; // desde cuándo se ve trabajar al motor de chess.com sin panel de líneas
  let graceTimer = null;
  let graceTimerDue = 0;
  let lastSource = 'none';
  let lastError = '';

  function resetWait() { noLinesSince = 0; depthSeenSince = 0; }

  function update() {
    scheduled = false;
    try { updateInner(); }
    catch (e) {
      const msg = String(e && e.message || e);
      if (msg !== lastError) { lastError = msg; warn('error al actualizar:', e); }
    }
  }

  function updateInner() {
    const boardEl = getMainBoard();
    if (!boardEl) { resetWait(); lastSource = 'none'; Engine.release(); return; }
    if (getGame(boardEl)) markOnce('board');

    keepAnalysisOn(boardEl);

    const overlay = getOrCreateOverlay(boardEl);
    if (!isAnalysisActive()) {
      resetWait(); lastSource = 'off';
      Engine.release();
      render(overlay, null, false, 'off');
      return;
    }
    markOnce('analysisOn');

    const isFlipped = boardEl.classList.contains('flipped');

    // 1) Camino normal: chess.com muestra las líneas de su motor → se leen del DOM
    const lines = getAnalysisLines();
    if (lines.length) {
      resetWait(); lastSource = 'dom';
      Engine.release();
      const pieces = getBoardPieces(boardEl);
      const legal = getLegalInfo(boardEl);
      const arrows = [];
      lines.forEach(line => {
        const move = resolveLineMove(line, legal, pieces);
        if (move) arrows.push({ rank: line.rank, from: move.from, to: move.to, label: line.score });
      });
      render(overlay, arrows, isFlipped, 'dom');
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
      render(overlay, null, isFlipped, 'engine'); // posición nueva: se borran las flechas anteriores
      return;
    }
    const whiteToMove = res.turn !== 'b';
    const arrows = res.lines.slice(0, 3).map(l => ({
      rank: l.rank,
      from: l.move.slice(0, 2),
      to: l.move.slice(2, 4),
      label: formatEngineScore(l, whiteToMove)
    }));
    render(overlay, arrows, isFlipped, 'engine');
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

    document.addEventListener('change', e => {
      const t = e.target;
      if (!t) return;
      if (t.id === 'evaluationSettings' && Date.now() - userSwitchClickAt < 800) setKeepPref(t.checked);
      if (t.id === 'analysis' || t.id === 'evaluationSettings' || classNameOf(t).indexOf('cc-switch-checkbox') !== -1) schedule();
    });

    const WATCHED = 'wc-evaluation-lines, wc-chess-board, chess-board, .board, .engine-lines-engine-lines-redesign, .evaluation-settings-component, .analysis-options-component';
    const WATCHED_CLASSES = ['evaluation-lines-node', 'evaluation-lines-component', 'engine-line-node', 'engine-line-component', 'piece'];
    const MOUNTS = '#evaluationSettings, #analysis, wc-evaluation-lines, wc-chess-board';
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

    setInterval(schedule, 500);
    schedule();
  }

  PAGE.__top3ArrowsHybrid = {
    version: '9.1.0',
    config: CONFIG,
    refresh: update,
    // timeline: ms desde que empezó a cargar la página hasta cada etapa (script, board, analysisOn, engineBoot, engineReady, arrows)
    status: () => ({ source: lastSource, keepAnalysis: keepPref, timeline: Object.assign({}, timeline), engine: Engine.status() })
  };

  info('v9.1.0 cargado.');

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
