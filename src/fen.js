// ─────────────────────────── FEN y coordenadas (funciones puras) ───────────────────────────

export function isPlausibleFen(fen) {
  if (typeof fen !== 'string') return false;
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 2 || (parts[1] !== 'w' && parts[1] !== 'b')) return false;
  return parts[0].split('/').length === 8 && parts[0].indexOf('K') !== -1 && parts[0].indexOf('k') !== -1;
}

export function fenTurnWhite(fen) {
  const t = typeof fen === 'string' ? fen.trim().split(/\s+/)[1] : null;
  return t === 'w' ? true : (t === 'b' ? false : null);
}

// Casilla → centro en un tablero de 100×100 unidades
export function squareToCoords(square, isFlipped) {
  if (!square || square.length < 2) return null;
  let col = square.charCodeAt(0) - 97;
  let rank = parseInt(square[1], 10);
  if (isNaN(rank) || col < 0 || col > 7 || rank < 1 || rank > 8) return null;
  if (isFlipped) { col = 7 - col; rank = 9 - rank; }
  return { x: col * 12.5 + 6.25, y: (8 - rank) * 12.5 + 6.25 };
}

// Punto (0-100, 0-100) dentro del tablero → casilla
export function coordsToSquare(x, y, isFlipped) {
  if (!(x >= 0 && x < 100 && y >= 0 && y < 100)) return null;
  let col = Math.floor(x / 12.5);
  let rank = 8 - Math.floor(y / 12.5);
  if (isFlipped) { col = 7 - col; rank = 9 - rank; }
  return String.fromCharCode(97 + col) + rank;
}

// Construye un FEN a partir de las piezas leídas del tablero.
// hints: { turn: 'w'|'b'|null, lastMove: {from, to}|null }
export function piecesToFen(pieces, hints) {
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

  let turn = (hints && hints.turn) || null;
  let ep = '-';
  const lm = hints && hints.lastMove;
  if (lm && pieces[lm.to]) {
    const moved = pieces[lm.to];
    if (!turn) turn = moved[0] === 'w' ? 'b' : 'w';
    if (moved[1] === 'p' && moved[0] !== turn && lm.from[0] === lm.to[0] && Math.abs(parseInt(lm.to[1], 10) - parseInt(lm.from[1], 10)) === 2) {
      ep = lm.to[0] + ((parseInt(lm.to[1], 10) + parseInt(lm.from[1], 10)) / 2);
    }
  }
  if (!turn) turn = 'w';

  let castling = '';
  if (pieces.e1 === 'wk') { if (pieces.h1 === 'wr') castling += 'K'; if (pieces.a1 === 'wr') castling += 'Q'; }
  if (pieces.e8 === 'bk') { if (pieces.h8 === 'br') castling += 'k'; if (pieces.a8 === 'br') castling += 'q'; }

  return rows.join('/') + ' ' + turn + ' ' + (castling || '-') + ' ' + ep + ' 0 1';
}

// Dos casillas resaltadas (última jugada) → {from, to}, usando cuál de las dos está ocupada
export function lastMoveFromHighlights(highlighted, pieces) {
  if (highlighted.length !== 2) return null;
  const occupied = highlighted.filter(sq => pieces[sq]);
  if (occupied.length !== 1) return null;
  const to = occupied[0];
  return { from: highlighted[0] === to ? highlighted[1] : highlighted[0], to };
}
