// ─────────────────────────── SAN → origen/destino (funciones puras) ───────────────────────────

export function normalizeSan(text) {
  return String(text)
    .replace(/\s+/g, '')
    .replace(/^\d+\.+/, '')
    .replace(/^\.+/, '')
    .replace(/[+#?!]/g, '')
    .replace('0-0-0', 'O-O-O')
    .replace('0-0', 'O-O');
}

export const SAN_RE = /^(\d+\.+)?(O-O(-O)?|0-0(-0)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](=[QRBN])?)[+#]?[!?]*$/;

export function isPathClear(fromCol, fromRank, toCol, toRank, pieces) {
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

// Origen y destino de una jugada SAN por geometría, sin la API del tablero.
// pieces: { e2: 'wp', g8: 'bn', ... }
export function findMoveSource(sanText, isWhite, pieces) {
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
  const loose = [];  // solo geometría, por si la lectura del tablero falla

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

// Con chess.com en otro idioma las líneas usan las letras de pieza de ese idioma ("Ce7" = caballo a e7).
// Letras de rey, dama, torre, alfil y caballo, en ese orden.
export const PIECE_LETTERS = { es: 'RDTAC', fr: 'RDTFC', de: 'KDTLS', it: 'RDTAC', pt: 'RDTBC', nl: 'KDTLP', pl: 'KHWGS', tr: 'ŞVKFA' };

export function localizedSanToEnglish(san, lang) {
  const letters = PIECE_LETTERS[String(lang || '').slice(0, 2).toLowerCase()];
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

// Resuelve la primera jugada de una línea de chess.com a {from, to}.
// legal: { bySan: Map, list, turnWhite } de las jugadas legales (o null sin API del tablero)
export function resolveLineMove(line, legal, pieces, lang) {
  let san = normalizeSan(line.moveText);
  if (!san) return null;
  let moveText = line.moveText;
  // El turno real (del FEN) manda sobre lo que se deduce del texto de la línea
  const isWhite = legal && legal.turnWhite !== null && legal.turnWhite !== undefined ? legal.turnWhite : line.isWhite;
  if (legal) {
    let m = legal.bySan.get(san);
    if (!m) {
      // 1) Traducir las letras según el idioma de la página
      const en = localizedSanToEnglish(san, lang);
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
    if (line.hasMoveNumber && legal.turnWhite !== null && legal.turnWhite !== line.isWhite) return null;
  } else {
    const en = localizedSanToEnglish(san, lang);
    if (en) moveText = en;
  }
  return findMoveSource(moveText, isWhite, pieces);
}

export function isWhiteMoveText(moveText) {
  return !moveText.includes('...') && !/^\d+\.\.\./.test(moveText);
}

// ¿El texto trae número de jugada ("12." o "12...")? Solo entonces dice algo fiable sobre el turno.
export function hasMoveNumber(moveText) {
  return /^\d+\.+/.test(moveText) || moveText.includes('...');
}

// Evaluación de chess.com ("+0.36", "-1.2", "M3", "-M2", "#-4") → centipeones desde el lado blanco
export function parseScoreText(text) {
  const s = String(text || '').trim().replace(/−/g, '-').replace(/\s+/g, '');
  const mate = /^([+-]?)(?:M|#)([+-]?)(\d+)$/i.exec(s);
  if (mate) {
    const neg = mate[1] === '-' || mate[2] === '-';
    const n = parseInt(mate[3], 10);
    return { type: 'mate', value: neg ? -n : n };
  }
  const num = /^([+-]?\d+(?:[.,]\d+)?)$/.exec(s);
  if (num) return { type: 'cp', value: Math.round(parseFloat(num[1].replace(',', '.')) * 100) };
  return null;
}

// Valor comparable entre líneas, desde el lado que mueve; un mate vale más que cualquier ventaja
export function comparableScore(score) {
  if (!score) return null;
  return score.type === 'mate' ? (score.value > 0 ? 100000 - score.value : -100000 - score.value) : score.value;
}
