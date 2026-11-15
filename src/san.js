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

// ¿En qué letras están escritas las líneas de chess.com? Algunas letras existen en los dos idiomas
// con otro significado (en español R es Rey; en inglés, Rook = torre), así que no basta con mirar
// una jugada: se cuentan las letras que solo existen en el idioma de la página (español: D, T, A, C)
// y las que solo existen en inglés (K, Q, B, N) en todas las jugadas visibles.
// Devuelve 'local', 'en' o null si no hay forma de saberlo.
export function detectNotation(texts, lang) {
  // Idioma sin tabla (ruso, etc.): cualquier mayúscula que no sea inglesa cuenta como letra local
  const letters = PIECE_LETTERS[String(lang || '').slice(0, 2).toLowerCase()] || null;
  let local = 0, en = 0;
  const count = c => {
    if (!c) return;
    const inEn = 'KQRBN'.indexOf(c) !== -1;
    const inLocal = letters ? letters.indexOf(c) !== -1 : !inEn;
    if (inLocal && !inEn) local++;
    else if (inEn && !inLocal) en++;
  };
  // Una mayúscula seguida de una casilla ("Tb1", "Dxd5", "Cbd7") o tras "=" en una coronación.
  // El texto puede venir sin espacios entre jugadas ("25.Re2Da226.Tb1"), por eso se busca con regex.
  (texts || []).forEach(t => {
    const s = String(t || '');
    let m;
    const piece = /(\p{Lu})(?=[a-h]?[1-8]?x?[a-h][1-8])/gu;
    while ((m = piece.exec(s))) count(m[1]);
    const promo = /=(\p{Lu})/gu;
    while ((m = promo.exec(s))) count(m[1]);
  });
  return local > en ? 'local' : (en > local ? 'en' : null);
}

export function hasLocalLetters(lang) {
  return !!PIECE_LETTERS[String(lang || '').slice(0, 2).toLowerCase()];
}

// ─────────── Leer las letras de pieza sin depender del idioma ───────────
// Letras que preceden a la casilla ("Кр" en "Кре2", "R" en "Re2") y el resto de la jugada
function splitPiece(san) {
  const m = /^([^a-h0-9x]*)(.*)$/u.exec(san);
  return { lead: m[1], rest: m[2] };
}

// Aprende qué significa cada letra en el idioma de la página comparando la lista de jugadas de la
// partida tal como la muestra chess.com (displayed) con las mismas jugadas en inglés (english,
// de game.getHistorySANs()). Sirve para cualquier idioma, sin tabla. Devuelve {letra: 'KQRBN'} o null.
export function learnPieceLetters(displayed, english) {
  const map = {};
  let n = 0;
  for (let i = 0; i < Math.min(displayed.length, english.length); i++) {
    if (displayed[i] == null || english[i] == null) continue;
    const d = splitPiece(normalizeSan(displayed[i]));
    const e = normalizeSan(english[i]);
    if (!/^[KQRBN]/.test(e) || !d.lead || d.rest !== e.slice(1)) continue;
    if (map[d.lead] && map[d.lead] !== e[0]) return null; // contradicción: la lista no corresponde
    map[d.lead] = e[0];
    n++;
  }
  return n ? map : null;
}

// Pasa una jugada a letras inglesas con un mapa {letra local: letra inglesa}
export function translateWithMap(san, map) {
  if (!map) return null;
  const { lead, rest } = splitPiece(san);
  let out = san;
  if (lead) {
    if (!map[lead]) return null;
    out = map[lead] + rest;
  }
  const promo = /=(\p{L}+)$/u.exec(out);
  if (promo && !/^[QRBN]$/.test(promo[1])) {
    if (!map[promo[1]]) return null;
    out = out.slice(0, promo.index) + '=' + map[promo[1]];
  }
  return out === san ? null : out;
}

// Resuelve la primera jugada de una línea de chess.com a {from, to}, en este orden:
//  1. Figurines (iconos de pieza): su letra ya está en inglés.
//  2. Una sola jugada legal coincide en todo salvo la letra de pieza ("?e2" → solo una pieza llega a e2):
//     vale en cualquier idioma, sin traducir nada.
//  3. Si varias piezas llegan a la misma casilla (en español "Re2" = rey, en inglés "Re2" = torre),
//     decide la letra: con lo aprendido de la lista de jugadas de la página (learned), con la tabla
//     del idioma de la página, o en inglés si las líneas están en inglés (notation === 'en').
// legal: { bySan: Map, list, turnWhite } de las jugadas legales (o null sin API del tablero)
// notation: 'local' | 'en' | null, de detectNotation(). learned: de learnPieceLetters() o null.
export function resolveLineMove(line, legal, pieces, lang, notation, learned) {
  let san = normalizeSan(line.moveText);
  if (!san) return null;
  // El turno real (del FEN) manda sobre lo que se deduce del texto de la línea
  const isWhite = legal && legal.turnWhite !== null && legal.turnWhite !== undefined ? legal.turnWhite : line.isWhite;

  // Cómo pasar la letra a inglés, de lo más fiable a lo menos
  const toEnglish = s => {
    if (line.figurine || notation === 'en') return s;
    return translateWithMap(s, learned) || (hasLocalLetters(lang) ? localizedSanToEnglish(s, lang) : null) || s;
  };

  if (legal) {
    const { lead, rest } = splitPiece(san);
    let m = null;
    if (!lead || line.figurine) {
      // Peones, enroques y figurines: ya están en inglés (salvo la letra de una coronación)
      m = legal.bySan.get(san) || legal.bySan.get(toEnglish(san)) || null;
    } else {
      const same = legal.list.filter(l => /^[KQRBN]/.test(l.san) && l.san.slice(1) === rest);
      if (same.length === 1) m = same[0];
      else m = legal.bySan.get(toEnglish(san)) || null; // varias piezas llegan (o la lista no está): decide la letra
    }
    if (m) {
      if (san === 'O-O' || san === 'O-O-O') return { from: m.from, to: (san === 'O-O' ? 'g' : 'c') + m.from[1] };
      return { from: m.from, to: m.to };
    }
    // La línea es de otra posición (chess.com todavía no la actualizó): no dibujar flechas viejas
    if (line.hasMoveNumber && legal.turnWhite !== null && legal.turnWhite !== line.isWhite) return null;
  }
  // Último recurso, por geometría. Si la letra sigue sin entenderse no se dibuja nada
  // (si no, una pieza desconocida se tomaría por un peón y la flecha saldría de cualquier lado).
  const en = toEnglish(san);
  const lead = splitPiece(en).lead;
  if (lead && !/^[KQRBN]$/.test(lead) && !/^O/.test(en)) return null;
  return findMoveSource(en, isWhite, pieces);
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
