// ─────────────────────────── Lectura del tablero y de las líneas de chess.com ───────────────────────────
import { CONFIG } from './config.js';
import { SEL } from './selectors.js';
import { normalizeSan, SAN_RE, isWhiteMoveText, hasMoveNumber } from './san.js';
import { isPlausibleFen, piecesToFen, lastMoveFromHighlights } from './fen.js';

export function classNameOf(el) {
  const c = el.className;
  return typeof c === 'string' ? c : (c && typeof c.baseVal === 'string' ? c.baseVal : '');
}

// Tablero principal: el real de chess.com; si hubiera varios, el más grande en pantalla
export function getMainBoard() {
  const boards = document.querySelectorAll(SEL.boards);
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
  return document.querySelector(SEL.boardPlaceholder); // marcador mientras carga la página o diseños antiguos
}

export function isRealBoard(boardEl) {
  const tag = (boardEl && boardEl.tagName || '').toLowerCase();
  return tag === 'wc-chess-board' || tag === 'chess-board';
}

// Objeto "game" que chess.com expone en el tablero (FEN exacto, jugadas legales, modo)
export function getGame(boardEl) {
  try {
    const g = boardEl.game || (boardEl.wrappedJSObject && boardEl.wrappedJSObject.game);
    return g && typeof g === 'object' ? g : null;
  } catch (e) { return null; }
}

// Nombre del modo del tablero ('playing', 'observing', 'analysis'...) o null si no se puede saber
export function getModeName(boardEl) {
  const game = boardEl ? getGame(boardEl) : null;
  if (!game || typeof game.getMode !== 'function') return null;
  try {
    const m = game.getMode();
    return m && typeof m.name === 'string' ? m.name : null;
  } catch (e) { return null; }
}

export function isFlipped(boardEl) {
  const game = getGame(boardEl);
  try {
    const o = game && typeof game.getOptions === 'function' ? game.getOptions() : null;
    if (o && typeof o.flipped === 'boolean') return o.flipped;
  } catch (e) { /* se usa la clase */ }
  return boardEl.classList.contains('flipped');
}

const SQUARE_CLASS_RE = /^square-(\d)(\d)$/;
function squareFromClass(n) { return String.fromCharCode(96 + parseInt(n[0], 10)) + parseInt(n[1], 10); }

export function getBoardPieces(boardEl) {
  const pieces = {};
  boardEl.querySelectorAll(SEL.piece).forEach(el => {
    const classes = [...el.classList];
    const pc = classes.find(c => /^[wb][prnbqk]$/.test(c));
    const sq = classes.find(c => SQUARE_CLASS_RE.test(c));
    if (pc && sq) pieces[squareFromClass(sq.replace('square-', ''))] = pc;
  });
  return pieces;
}

// Jugadas legales de la posición actual según chess.com, indexadas por SAN
let legalCache = { fen: null, info: null };
export function getLegalInfo(boardEl) {
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

// Reconstruye el FEN leyendo el DOM (solo si la API del tablero no está disponible)
export function buildFenFromDom(boardEl) {
  const pieces = getBoardPieces(boardEl);

  // 1) Turno según la jugada seleccionada en la lista de movimientos
  let turn = null;
  const selected = document.querySelector(SEL.selectedMove);
  const selectedNode = selected && selected.closest('.node');
  if (selectedNode) {
    if (selectedNode.classList.contains('white-move')) turn = 'b';
    else if (selectedNode.classList.contains('black-move')) turn = 'w';
  }

  // 2) Última jugada (casillas resaltadas): turno y captura al paso
  const highlighted = [];
  boardEl.querySelectorAll(SEL.highlight).forEach(el => {
    const m = /(?:^|\s)square-(\d)(\d)(?:\s|$)/.exec(classNameOf(el));
    if (m) highlighted.push(squareFromClass(m[1] + m[2]));
  });
  const lastMove = lastMoveFromHighlights(highlighted, pieces);

  // 3) Reloj activo
  if (!turn && !lastMove) {
    const clock = document.querySelector(SEL.activeClock);
    if (clock) turn = clock.classList.contains('clock-black') ? 'b' : (clock.classList.contains('clock-white') ? 'w' : null);
  }
  return piecesToFen(pieces, { turn, lastMove });
}

export function getPositionFen(boardEl) {
  const game = getGame(boardEl);
  if (game && typeof game.getFEN === 'function') {
    try {
      const fen = game.getFEN();
      if (isPlausibleFen(fen)) return fen.trim();
    } catch (e) { /* se usa el DOM */ }
  }
  return buildFenFromDom(boardEl);
}

// ─────────────────────────── Líneas que muestra chess.com ───────────────────────────
const FIGURINES = [['knight', 'N'], ['bishop', 'B'], ['rook', 'R'], ['queen', 'Q'], ['king', 'K']];

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
export function sanTextOf(el) {
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

// Composición antigua de la página de Análisis (respaldo)
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

function makeLine(idx, score, moveText) {
  return { rank: idx + 1, score, moveText, isWhite: isWhiteMoveText(moveText), hasMoveNumber: hasMoveNumber(moveText) };
}

// Líneas del motor de chess.com (Events, Play y Análisis)
export function getAnalysisLines() {
  const lines = [];

  // Estructura 1: Events y Play
  document.querySelectorAll(SEL.evalLinesComponents).forEach((comp, idx) => {
    if (idx >= CONFIG.multiPv) return;
    const scoreEl = comp.querySelector(SEL.evalLinesScore);
    const score = scoreEl ? scoreEl.textContent.trim() : '';
    const firstMoveEl = comp.querySelector(SEL.evalLinesFirstNode) || comp.querySelector(SEL.evalLinesNode);
    const moveText = firstMoveEl ? sanTextOf(firstMoveEl).replace(/\s+/g, '') : '';
    if (moveText) lines.push(makeLine(idx, score, moveText));
  });
  if (lines.length > 0) return lines;

  // Estructura 2: página de Análisis
  let engineComponents = [...document.querySelectorAll(SEL.engineLineComponent)];
  // La fila "X is a book move / is best" trae su propia línea: si están las líneas reales, se ignora
  const mainComponents = engineComponents.filter(c => !c.classList.contains(SEL.engineLineFeedbackClass));
  if (mainComponents.length) engineComponents = mainComponents;

  engineComponents.forEach((comp, idx) => {
    if (idx >= CONFIG.multiPv) return;
    const scoreEl = comp.querySelector(SEL.engineLineScore);
    const score = scoreEl ? scoreEl.textContent.trim() : '';
    const firstMoveEl = comp.querySelector(SEL.engineLineNode);
    if (!firstMoveEl) return;
    let moveText = sanTextOf(firstMoveEl).replace(/\s+/g, '');
    if (!SAN_RE.test(moveText)) {
      const legacy = legacyEngineNodeText(firstMoveEl);
      if (legacy) moveText = legacy;
    }
    if (moveText) lines.push(makeLine(idx, score, moveText));
  });

  return lines;
}

export function hasLinesPanel() {
  return document.querySelector(SEL.linesPanel) !== null;
}

// El motor de chess.com ya está calculando: muestra "depth=N" junto al switch
export function chessComEngineShowsDepth() {
  const el = document.querySelector(SEL.evalDepth);
  return !!el && /=\s*\d/.test(el.textContent || '');
}
