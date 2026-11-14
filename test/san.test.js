import { describe, it, expect } from 'vitest';
import {
  normalizeSan, findMoveSource, localizedSanToEnglish, resolveLineMove,
  parseScoreText, comparableScore, hasMoveNumber, isWhiteMoveText
} from '../src/san.js';

// FEN (solo la parte de piezas) → { e2: 'wp', ... }
function piecesFrom(fenBoard) {
  const out = {};
  fenBoard.split('/').forEach((row, i) => {
    let col = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { col += Number(ch); continue; }
      const color = ch === ch.toUpperCase() ? 'w' : 'b';
      out[String.fromCharCode(97 + col) + (8 - i)] = color + ch.toLowerCase();
      col++;
    }
  });
  return out;
}
const START = piecesFrom('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');

describe('normalizeSan', () => {
  it('quita número de jugada, jaques y anotaciones', () => {
    expect(normalizeSan('12...Nxe4+!?')).toBe('Nxe4');
    expect(normalizeSan('3. e4')).toBe('e4');
    expect(normalizeSan('0-0-0#')).toBe('O-O-O');
    expect(normalizeSan('0-0')).toBe('O-O');
  });
});

describe('findMoveSource', () => {
  it('peones: avance simple y doble', () => {
    expect(findMoveSource('e4', true, START)).toEqual({ from: 'e2', to: 'e4' });
    expect(findMoveSource('d5', false, START)).toEqual({ from: 'd7', to: 'd5' });
    expect(findMoveSource('e3', true, START)).toEqual({ from: 'e2', to: 'e3' });
  });
  it('caballos', () => {
    expect(findMoveSource('Nf3', true, START)).toEqual({ from: 'g1', to: 'f3' });
    expect(findMoveSource('Nc6', false, START)).toEqual({ from: 'b8', to: 'c6' });
  });
  it('enroques', () => {
    expect(findMoveSource('O-O', true, {})).toEqual({ from: 'e1', to: 'g1' });
    expect(findMoveSource('O-O-O', false, {})).toEqual({ from: 'e8', to: 'c8' });
  });
  it('respeta piezas que bloquean el camino', () => {
    // Torres en a1 y h1, alfil en d1 tapa a la de a1: Re1 solo puede ser la de h1
    const p = piecesFrom('4k3/8/8/8/8/8/8/R2B3R');
    p.e1 = undefined; delete p.e1;
    expect(findMoveSource('Rf1', true, p)).toEqual({ from: 'h1', to: 'f1' });
  });
  it('desambiguación por columna y por fila', () => {
    const p = piecesFrom('4k3/8/8/8/8/8/8/R3K2R');
    expect(findMoveSource('Rad1', true, p)).toEqual({ from: 'a1', to: 'd1' });
    const q = piecesFrom('4k3/8/8/R7/8/8/8/R3K3');
    expect(findMoveSource('R1a3', true, q)).toEqual({ from: 'a1', to: 'a3' });
    expect(findMoveSource('R5a3', true, q)).toEqual({ from: 'a5', to: 'a3' });
  });
  it('captura de peón y coronación', () => {
    const p = piecesFrom('3rk3/4P3/8/8/8/8/8/4K3');
    expect(findMoveSource('exd8=Q', true, p)).toEqual({ from: 'e7', to: 'd8' });
    expect(findMoveSource('e8=Q', true, piecesFrom('k7/4P3/8/8/8/8/8/4K3'))).toEqual({ from: 'e7', to: 'e8' });
  });
  it('captura al paso', () => {
    const p = piecesFrom('4k3/8/8/3pP3/8/8/8/4K3');
    expect(findMoveSource('exd6', true, p)).toEqual({ from: 'e5', to: 'd6' });
  });
});

describe('localizedSanToEnglish', () => {
  it('español, alemán y francés', () => {
    expect(localizedSanToEnglish('Ce7', 'es')).toBe('Ne7');
    expect(localizedSanToEnglish('Dxd5', 'es-ES')).toBe('Qxd5');
    expect(localizedSanToEnglish('Se7', 'de')).toBe('Ne7');
    expect(localizedSanToEnglish('Fb5', 'fr')).toBe('Bb5');
    expect(localizedSanToEnglish('e8=D', 'es')).toBe('e8=Q');
  });
  it('sin cambios o idioma desconocido → null', () => {
    expect(localizedSanToEnglish('e4', 'es')).toBeNull();
    expect(localizedSanToEnglish('Ce7', 'xx')).toBeNull();
  });
});

describe('resolveLineMove', () => {
  const legal = {
    bySan: new Map([['Nf6', { from: 'g8', to: 'f6' }], ['e5', { from: 'e7', to: 'e5' }], ['O-O', { from: 'e8', to: 'h8' }]]),
    list: [{ san: 'Nf6', from: 'g8', to: 'f6' }, { san: 'e5', from: 'e7', to: 'e5' }],
    turnWhite: false
  };
  it('usa las jugadas legales de chess.com', () => {
    expect(resolveLineMove({ moveText: '1...Nf6', isWhite: false, hasMoveNumber: true }, legal, {}, 'en')).toEqual({ from: 'g8', to: 'f6' });
  });
  it('enroque como rey-a-torre se dibuja rey a g8', () => {
    expect(resolveLineMove({ moveText: 'O-O', isWhite: true, hasMoveNumber: false }, legal, {}, 'en')).toEqual({ from: 'e8', to: 'g8' });
  });
  it('traduce letras de otro idioma', () => {
    expect(resolveLineMove({ moveText: 'Cf6', isWhite: true, hasMoveNumber: false }, legal, {}, 'es')).toEqual({ from: 'g8', to: 'f6' });
  });
  it('línea vieja (otro turno, con número de jugada) → null', () => {
    expect(resolveLineMove({ moveText: '2.Nc3', isWhite: true, hasMoveNumber: true }, legal, START, 'en')).toBeNull();
  });
  it('sin número de jugada, el turno sale del FEN y no del texto', () => {
    const l2 = { bySan: new Map(), list: [], turnWhite: false };
    expect(resolveLineMove({ moveText: 'Nc6', isWhite: true, hasMoveNumber: false }, l2, START, 'en')).toEqual({ from: 'b8', to: 'c6' });
  });
});

describe('parseScoreText / comparableScore', () => {
  it('centipeones y mates', () => {
    expect(parseScoreText('+0.36')).toEqual({ type: 'cp', value: 36 });
    expect(parseScoreText('-1.2')).toEqual({ type: 'cp', value: -120 });
    expect(parseScoreText('−2.50')).toEqual({ type: 'cp', value: -250 });
    expect(parseScoreText('M3')).toEqual({ type: 'mate', value: 3 });
    expect(parseScoreText('-M2')).toEqual({ type: 'mate', value: -2 });
    expect(parseScoreText('#-4')).toEqual({ type: 'mate', value: -4 });
    expect(parseScoreText('')).toBeNull();
  });
  it('un mate a favor vale más que cualquier ventaja, y uno más corto más', () => {
    expect(comparableScore({ type: 'mate', value: 2 })).toBeGreaterThan(comparableScore({ type: 'mate', value: 5 }));
    expect(comparableScore({ type: 'mate', value: 5 })).toBeGreaterThan(comparableScore({ type: 'cp', value: 2000 }));
    expect(comparableScore({ type: 'mate', value: -5 })).toBeLessThan(comparableScore({ type: 'cp', value: -2000 }));
  });
});

describe('turno desde el texto', () => {
  it('detecta número de jugada', () => {
    expect(hasMoveNumber('12...Nf6')).toBe(true);
    expect(hasMoveNumber('3.e4')).toBe(true);
    expect(hasMoveNumber('Nf6')).toBe(false);
    expect(isWhiteMoveText('12...Nf6')).toBe(false);
  });
});
