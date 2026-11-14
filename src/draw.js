// ─────────────────────────── Dibujo de las flechas ───────────────────────────
import { CONFIG, ARROW_CONFIG, OVERLAY_ID, SVG_NS } from './config.js';
import { squareToCoords } from './fen.js';
import { markOnce, timeline } from './log.js';
import { state, schedule } from './state.js';

export function getOrCreateOverlay(boardEl) {
  let overlay = boardEl.querySelector('#' + OVERLAY_ID);
  if (!overlay) {
    overlay = document.createElementNS(SVG_NS, 'svg');
    overlay.setAttribute('id', OVERLAY_ID);
    overlay.setAttribute('viewBox', '0 0 100 100');
    overlay.setAttribute('preserveAspectRatio', 'none');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 100;';
    if (getComputedStyle(boardEl).position === 'static') boardEl.style.position = 'relative';
    boardEl.appendChild(overlay);
  }
  return overlay;
}

function svg(tag, attrs) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

// Texto de la evaluación junto a la punta; se marca para poder cambiarlo sin redibujar la flecha
function scoreText(x, y, text, rank) {
  const t = svg('text', {
    x: Math.min(95, Math.max(5, x)), y: Math.min(95, Math.max(5, y)) + 0.5,
    'font-size': '2.2', 'font-weight': 'bold', 'text-anchor': 'middle', fill: '#fff',
    stroke: '#14181f', 'stroke-width': '0.7', 'paint-order': 'stroke', 'data-score-rank': rank
  });
  t.textContent = text;
  return t;
}

// Estilo "colores numerados". k: factor de grosor (1 = normal)
// badgeAt: dónde va el círculo con el número si no puede ir en la casilla de origen (la ocupa otra flecha mejor)
function drawArrow(from, to, config, labelText, rankNum, badgeAt, k) {
  const dx = to.x - from.x; const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy); if (!len) return null;
  const rad = Math.atan2(dy, dx);
  const startX = from.x + Math.cos(rad) * 3.2;
  const startY = from.y + Math.sin(rad) * 3.2;
  const shaftEndX = to.x - Math.cos(rad) * 3.8;
  const shaftEndY = to.y - Math.sin(rad) * 3.8;
  const nx = -Math.sin(rad); const ny = Math.cos(rad);

  const body = svg('g', {});
  body.appendChild(svg('line', {
    x1: startX, y1: startY, x2: shaftEndX, y2: shaftEndY, stroke: config.color,
    'stroke-width': config.width * k, 'stroke-linecap': 'round', opacity: config.opacity
  }));
  const hw = 1.8 * Math.max(0.7, k);
  body.appendChild(svg('polygon', {
    points: `${to.x},${to.y} ${shaftEndX + nx * hw},${shaftEndY + ny * hw} ${shaftEndX - nx * hw},${shaftEndY - ny * hw}`,
    fill: config.headColor, opacity: config.opacity
  }));
  if (labelText) body.appendChild(scoreText(shaftEndX + nx * 4.2, shaftEndY + ny * 4.2, labelText, rankNum));

  // La insignia con el número va en un grupo aparte: render() las pone todas encima de las flechas
  const badge = svg('g', {});
  const bx = badgeAt ? badgeAt.x : from.x; const by = badgeAt ? badgeAt.y : from.y;
  badge.appendChild(svg('circle', { cx: bx, cy: by, r: badgeAt ? '1.9' : '2.4', fill: config.labelBg, stroke: '#fff', 'stroke-width': '0.6' }));
  const txt = svg('text', { x: bx, y: by + (badgeAt ? 0.75 : 0.9), 'font-size': badgeAt ? '2.1' : '2.6', 'font-weight': 'bold', 'text-anchor': 'middle', fill: '#fff' });
  txt.textContent = rankNum;
  badge.appendChild(txt);
  return { body, badge };
}

// Estilos que imitan las flechas que dibuja la propia página (clic derecho en chess.com, motor en Lichess).
// Un solo color, sin círculos numerados (índice 0 = mejor jugada). Solo la mejor va a tamaño completo;
// las demás son claramente más pequeñas y transparentes para que no se confundan con ella.
const NATIVE_STYLES = {
  chesscom: { color: '#ffaa00', other: '#ffaa00', opacity: [0.9, 0.62, 0.52, 0.44, 0.38], scale: [1, 0.55, 0.55, 0.5, 0.46], shaft: 2.75, headW: 6.5, headL: 4.4, start: 4.4, knightL: true },
  lichess: { color: '#003088', other: '#4a4a4a', opacity: [0.55, 0.42, 0.36, 0.3, 0.26], scale: [1.2, 0.68, 0.68, 0.62, 0.56], shaft: 1.95, headW: 6.2, headL: 4.8, start: 1.5, knightL: false }
};

// covered: la flecha va encima de otra más larga del mismo color; se le da borde para que se distinga
// kOverride: factor de grosor fijado desde fuera (grosor según evaluación)
function drawNativeArrow(from, to, st, rank, labelText, covered, kOverride) {
  const i = Math.max(0, Math.min(rank, 5) - 1);
  const k = kOverride != null ? kOverride * st.scale[0] : st.scale[i];
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

  const g = svg('g', {});
  // La opacidad va en el grupo: así el trazo y la punta no se oscurecen donde se pisan
  const shape = svg('g', { opacity: st.opacity[i] });
  shape.appendChild(svg('polyline', {
    points: sx + ',' + sy + (corner ? ' ' + corner.x + ',' + corner.y : '') + ' ' + bx + ',' + by,
    fill: 'none', stroke: color, 'stroke-width': st.shaft * k, 'stroke-linejoin': 'miter', 'stroke-linecap': 'butt'
  }));
  const head = svg('polygon', {
    points: to.x + ',' + to.y + ' ' + (bx - uy * headW / 2) + ',' + (by + ux * headW / 2) + ' ' + (bx + uy * headW / 2) + ',' + (by - ux * headW / 2),
    fill: color
  });
  if (covered) { head.setAttribute('stroke', '#ffffff'); head.setAttribute('stroke-width', '0.5'); head.setAttribute('stroke-linejoin', 'round'); }
  shape.appendChild(head);
  g.appendChild(shape);
  if (labelText) g.appendChild(scoreText(bx - uy * 4.2, by + ux * 4.2, labelText, rank));
  return { body: g, badge: null };
}

// Flecha fina y discontinua (respuesta esperada y variante al pasar el ratón)
function drawThinArrow(from, to, color, num) {
  const dx = to.x - from.x; const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy); if (!len) return null;
  const ux = dx / len; const uy = dy / len;
  const g = svg('g', { opacity: '0.75' });
  const sx = to.x - ux * 3; const sy = to.y - uy * 3;
  g.appendChild(svg('line', { x1: from.x + ux * 2, y1: from.y + uy * 2, x2: sx, y2: sy, stroke: color, 'stroke-width': '1.3', 'stroke-dasharray': '2 1.4' }));
  g.appendChild(svg('polygon', { points: to.x + ',' + to.y + ' ' + (sx - uy * 1.4) + ',' + (sy + ux * 1.4) + ' ' + (sx + uy * 1.4) + ',' + (sy - ux * 1.4), fill: color }));
  if (num) {
    const cx = from.x + dx * 0.5; const cy = from.y + dy * 0.5;
    g.appendChild(svg('circle', { cx, cy, r: '1.7', fill: '#14181f', stroke: color, 'stroke-width': '0.4' }));
    const t = svg('text', { x: cx, y: cy + 0.65, 'font-size': '1.9', 'font-weight': 'bold', 'text-anchor': 'middle', fill: '#fff' });
    t.textContent = num;
    g.appendChild(t);
  }
  return g;
}

// ¿b sale de la misma casilla que a y en la misma dirección? (una tapa a la otra)
function sameRay(a, b) {
  if (a.from.x !== b.from.x || a.from.y !== b.from.y) return false;
  const cross = a.dx * b.dy - a.dy * b.dx;
  const dot = a.dx * b.dx + a.dy * b.dy;
  return Math.abs(cross) < 0.01 && dot > 0;
}

// Grosor según lo que pierde la jugada frente a la mejor: 0 cp → 1, 300 cp o más → 0.35
export function widthFactorForLoss(lossCp) {
  if (lossCp == null || !isFinite(lossCp)) return null;
  const l = Math.max(0, Math.min(300, lossCp));
  return 1 - (l / 300) * 0.65;
}

// Tras una jugada, las flechas anteriores se dejan atenuadas un momento en vez de borrarlas,
// para que el tablero no parpadee mientras llega el análisis de la posición nueva.
let holdSince = 0;
let holdTimer = null;
export function holdArrows(overlay, isFlipped, source) {
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

export function scoresVisible() {
  return state.linesListed ? !!CONFIG.scoresWithLines : !!CONFIG.scoresWatch;
}

function lossOf(a, best) {
  return a.cmp != null && best != null ? best - a.cmp : null;
}

// Dibuja la lista de flechas [{rank, from, to, label, cmp?, pv?}] (más una {reply:true} opcional).
// Si solo cambian los números de evaluación se actualiza el texto sin rehacer las flechas.
export function render(overlay, arrows, isFlipped, source) {
  const all = arrows || [];
  const reply = all.filter(a => a.reply)[0] || null;
  const list = all.filter(a => !a.reply);
  if (list.length) holdSince = 0;
  if (overlay.style.opacity) overlay.style.opacity = '';
  const showScores = scoresVisible();
  const best = list.length && list[0].cmp != null ? list[0].cmp : null;
  const widths = CONFIG.widthByEval ? list.map(a => { const f = widthFactorForLoss(lossOf(a, best)); return f == null ? '' : f.toFixed(2); }) : [];
  // Variante bajo el ratón: la de la flecha cuya casilla de destino está bajo el puntero
  const hovered = CONFIG.pvOnHover && state.hoverSquare ? list.find(a => a.pv && a.pv.length > 1 && a.to === state.hoverSquare) : null;

  const shapeSig = list.length
    ? source + '|' + CONFIG.arrowStyle + (showScores ? 's' : '') + '|' + (isFlipped ? 'f' : 'n') + '|' +
      list.map((a, i) => a.rank + a.from + a.to + (widths[i] ? '~' + widths[i] : '')).join(',') +
      (reply ? '|r' + reply.from + reply.to : '') + (hovered ? '|h' + hovered.pv.slice(0, 7).join('') : '')
    : '';
  const labelSig = showScores ? list.map(a => a.label).join(',') : '';

  if (overlay.getAttribute('data-sig') === shapeSig) {
    if (overlay.getAttribute('data-labels') !== labelSig) {
      overlay.setAttribute('data-labels', labelSig);
      list.forEach(a => {
        const t = overlay.querySelector('text[data-score-rank="' + a.rank + '"]');
        if (t && t.textContent !== a.label) t.textContent = a.label;
      });
    }
    return;
  }
  overlay.setAttribute('data-sig', shapeSig);
  overlay.setAttribute('data-labels', labelSig);
  overlay.setAttribute('data-source', list.length ? source : 'none');
  if (list.length && !('arrows' in timeline)) { markOnce('arrows'); timeline.arrowsFrom = source; }
  while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
  if (!list.length) return;

  // Se dibuja de la peor a la mejor para que la flecha 1 quede encima
  const items = [];
  list.forEach((a, idx) => {
    const config = ARROW_CONFIG[a.rank - 1];
    if (!config) return;
    const from = squareToCoords(a.from, isFlipped);
    const to = squareToCoords(a.to, isFlipped);
    if (!from || !to) return;
    const dx = to.x - from.x; const dy = to.y - from.y;
    items.push({ a, config, from, to, dx, dy, len: dx * dx + dy * dy, k: widths[idx] ? Number(widths[idx]) : null });
  });
  items.sort((x, y) => y.a.rank - x.a.rank);

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
    const rEl = rf && rt ? drawThinArrow(rf, rt, '#c9ccd1') : null;
    if (rEl) overlay.appendChild(rEl); // debajo de las demás flechas
  }

  const nativeStyle = NATIVE_STYLES[CONFIG.arrowStyle] || null;
  const badges = [];
  items.forEach(it => {
    const label = showScores ? it.a.label : '';
    // Si una flecha mejor sale de la misma casilla, el número de esta va sobre su propio trazo
    const shared = items.some(o => o !== it && o.a.rank < it.a.rank && o.from.x === it.from.x && o.from.y === it.from.y);
    const badgeAt = shared ? { x: it.from.x + it.dx * 0.62, y: it.from.y + it.dy * 0.62 } : null;
    const el = nativeStyle
      ? drawNativeArrow(it.from, it.to, nativeStyle, it.a.rank, label, items.some(o => o !== it && o.len > it.len && sameRay(it, o)), it.k)
      : drawArrow(it.from, it.to, it.config, label, it.a.rank, badgeAt, it.k == null ? 1 : it.k);
    if (!el) return;
    overlay.appendChild(el.body);
    if (el.badge) badges.push({ rank: it.a.rank, node: el.badge });
  });
  // Las insignias al final, la del número 1 encima si comparten casilla
  badges.sort((x, y) => y.rank - x.rank).forEach(b => overlay.appendChild(b.node));

  // Variante de la flecha bajo el ratón: las jugadas siguientes, numeradas, encima de todo
  if (hovered) {
    hovered.pv.slice(1, 7).forEach((mv, i) => {
      const f = squareToCoords(mv.slice(0, 2), isFlipped); const t = squareToCoords(mv.slice(2, 4), isFlipped);
      const el = f && t ? drawThinArrow(f, t, i % 2 === 0 ? '#9aa4b2' : '#f0f0f0', String(i + 2)) : null;
      if (el) overlay.appendChild(el);
    });
  }
}
