import { describe, it, expect } from 'vitest';
import { isPlausibleFen, fenTurnWhite, squareToCoords, coordsToSquare, piecesToFen, lastMoveFromHighlights } from '../src/fen.js';
import { parseInfoLine, createLineCollector, formatEngineScore } from '../src/uci.js';
import { applySavedSettings, CONFIG } from '../src/config.js';

describe('fen', () => {
  it('isPlausibleFen / fenTurnWhite', () => {
    const f = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    expect(isPlausibleFen(f)).toBe(true);
    expect(isPlausibleFen('8/8/8/8/8/8/8/8 w - - 0 1')).toBe(false);
    expect(fenTurnWhite(f)).toBe(false);
  });
  it('coordenadas ida y vuelta, también girado', () => {
    for (const flipped of [false, true]) {
      for (const sq of ['a1', 'h8', 'e4', 'c7']) {
        const c = squareToCoords(sq, flipped);
        expect(coordsToSquare(c.x, c.y, flipped)).toBe(sq);
      }
    }
    expect(squareToCoords('a8', false)).toEqual({ x: 6.25, y: 6.25 });
    expect(coordsToSquare(-1, 5, false)).toBeNull();
  });
  it('piecesToFen: turno y captura al paso desde la última jugada', () => {
    const pieces = { e1: 'wk', e8: 'bk', e4: 'wp', h1: 'wr' };
    const lm = lastMoveFromHighlights(['e2', 'e4'], pieces);
    expect(lm).toEqual({ from: 'e2', to: 'e4' });
    expect(piecesToFen(pieces, { turn: null, lastMove: lm })).toBe('4k3/8/8/8/4P3/8/8/4K2R b K e3 0 1');
    expect(piecesToFen({ e1: 'wk' }, {})).toBeNull();
  });
});

describe('uci', () => {
  it('parseInfoLine lee la variante completa', () => {
    const l = parseInfoLine('info depth 16 seldepth 26 multipv 2 score cp -8 nodes 1 nps 1 time 1 pv g1f3 b8c6 f1b5', 3);
    expect(l).toMatchObject({ rank: 2, move: 'g1f3', reply: 'b8c6', type: 'cp', value: -8, depth: 16 });
    expect(l.pv).toEqual(['g1f3', 'b8c6', 'f1b5']);
    expect(parseInfoLine('info depth 10 multipv 1 score cp 20 lowerbound pv e2e4', 3)).toBeNull();
    expect(parseInfoLine('info depth 10 multipv 4 score cp 20 pv e2e4', 3)).toBeNull();
    expect(parseInfoLine('info depth 10 currmove e2e4', 3)).toBeNull();
    expect(parseInfoLine('info depth 5 multipv 1 score mate -3 pv e7e8q', 3)).toMatchObject({ move: 'e7e8q', type: 'mate', value: -3 });
  });
  it('el colector no mezcla una profundidad a medias con la anterior', () => {
    const c = createLineCollector(() => 3);
    const add = (d, r, m) => c.add({ depth: d, rank: r, move: m, type: 'cp', value: 0, pv: [m] });
    add(10, 1, 'e2e4'); add(10, 2, 'd2d4'); add(10, 3, 'g1f3');
    add(11, 1, 'd2d4'); // la 11 todavía no está completa
    expect(c.commit().map(l => l.move)).toEqual(['e2e4', 'd2d4', 'g1f3']);
    add(11, 2, 'e2e4'); add(11, 3, 'c2c4');
    const out = c.commit();
    expect(out.map(l => l.move)).toEqual(['d2d4', 'e2e4', 'c2c4']);
    expect(out[0].depth).toBe(11);
  });
  it('una jugada repetida en dos puestos se queda solo en el mejor', () => {
    const c = createLineCollector(() => 2);
    c.add({ depth: 8, rank: 1, move: 'e2e4' }); c.add({ depth: 8, rank: 2, move: 'e2e4' });
    expect(c.commit().length).toBe(1);
  });
  it('formatEngineScore pasa al punto de vista de las blancas', () => {
    expect(formatEngineScore({ type: 'cp', value: 36 }, true)).toBe('+0.36');
    expect(formatEngineScore({ type: 'cp', value: 36 }, false)).toBe('-0.36');
    expect(formatEngineScore({ type: 'mate', value: 2 }, false)).toBe('-M2');
    expect(formatEngineScore({ type: 'cp', value: 0 }, true)).toBe('0.00');
  });
});

describe('ajustes guardados', () => {
  it('solo acepta valores válidos', () => {
    const t = Object.assign({}, CONFIG);
    applySavedSettings(t, { multiPv: 9, maxDepth: 22, hashMb: 100, arrowStyle: 'lichess', widthByEval: true, scoresWatch: 'yes' });
    expect(t.multiPv).toBe(CONFIG.multiPv);
    expect(t.maxDepth).toBe(22);
    expect(t.hashMb).toBe(CONFIG.hashMb);
    expect(t.arrowStyle).toBe('lichess');
    expect(t.widthByEval).toBe(true);
    expect(t.scoresWatch).toBe(CONFIG.scoresWatch);
  });
});
