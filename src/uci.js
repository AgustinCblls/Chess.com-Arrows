// ─────────────────────────── Salida UCI del motor (funciones puras) ───────────────────────────

// Una línea "info ..." → { rank, move, reply, pv, type, value, depth } o null si no sirve
export function parseInfoLine(line, maxRank) {
  const pvm = / pv ((?:[a-h][1-8][a-h][1-8][qrbn]?\s*)+)/.exec(line);
  if (!pvm) return null;
  if (line.indexOf(' lowerbound') !== -1 || line.indexOf(' upperbound') !== -1) return null; // valores provisionales
  const sc = / score (cp|mate) (-?\d+)/.exec(line);
  if (!sc) return null;
  const d = / depth (\d+)/.exec(line);
  const mp = / multipv (\d+)/.exec(line);
  const rank = mp ? parseInt(mp[1], 10) : 1;
  if (rank < 1 || rank > maxRank) return null;
  const pv = pvm[1].trim().split(/\s+/);
  return {
    rank,
    move: pv[0],
    reply: pv[1] || null,
    pv,
    type: sc[1],
    value: parseInt(sc[2], 10),
    depth: d ? parseInt(d[1], 10) : 0
  };
}

// Junta las líneas que va mandando el motor por profundidad y devuelve las de la profundidad
// completa más alta. Si la búsqueda se corta a mitad de una pasada, mezclar profundidades deja
// las flechas en un orden que no cuadra con sus números.
export function createLineCollector(getMultiPv) {
  let pending = new Map();
  return {
    reset() { pending = new Map(); },
    size() { return pending.size; },
    add(info) {
      let atDepth = pending.get(info.depth);
      if (!atDepth) { atDepth = new Map(); pending.set(info.depth, atDepth); }
      atDepth.set(info.rank, info);
    },
    // Devuelve las líneas elegidas (ordenadas por puesto, sin jugadas repetidas) o null
    commit() {
      if (!pending.size) return null;
      const depths = Array.from(pending.keys()).sort((a, b) => b - a);
      let chosen = depths[depths.length - 1];
      for (let i = 0; i < depths.length; i++) {
        const size = pending.get(depths[i]).size;
        let lowerMax = 0;
        for (let j = i + 1; j < depths.length; j++) lowerMax = Math.max(lowerMax, pending.get(depths[j]).size);
        const complete = i + 1 < depths.length ? size >= lowerMax : size >= getMultiPv();
        if (complete) { chosen = depths[i]; break; }
      }
      depths.forEach(dd => { if (dd < chosen) pending.delete(dd); });
      // A mitad de una iteración una jugada puede figurar en dos puestos: se conserva el mejor
      const seenMoves = new Set();
      const lines = Array.from(pending.get(chosen).values())
        .sort((a, b) => a.rank - b.rank)
        .filter(l => !seenMoves.has(l.move) && seenMoves.add(l.move));
      return lines.length ? lines : null;
    }
  };
}

// Evaluación (desde el lado que mueve, como la da UCI) → texto desde el lado blanco, como chess.com
export function formatEngineScore(line, whiteToMove) {
  const v = whiteToMove ? line.value : -line.value;
  if (line.type === 'mate') return (v < 0 ? '-M' : '+M') + Math.abs(v);
  const pawns = v / 100;
  return (pawns > 0 ? '+' : '') + pawns.toFixed(2);
}
