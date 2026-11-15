import { describe, it, expect } from 'vitest';
import {
  normalizeSan, findMoveSource, localizedSanToEnglish, resolveLineMove, detectNotation, learnPieceLetters, translateWithMap,
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

// Posición del informe (Total Chess, jugada 25, juegan blancas): Rd1, Te1, Th1, Dh4.
// En español "Re2" es rey a e2; en inglés "Re2" es torre a e2, y las dos son legales.
describe('letras en otro idioma que también existen en inglés (R = Rey / Rook)', () => {
  const legal = {
    bySan: new Map([
      ['Ke2', { from: 'd1', to: 'e2' }], ['Re2', { from: 'e1', to: 'e2' }],
      ['Qf2', { from: 'h4', to: 'f2' }], ['Qg3', { from: 'h4', to: 'g3' }], ['Kc1', { from: 'd1', to: 'c1' }]
    ]),
    list: [], turnWhite: true
  };
  const es = ['25.Re2 Da2 26.Tb1 Ad8 27.Dg3 Tb7 28.Cf2 Aa5 29.Ae3 e5', '25.Df2 Da1+ 26.Re2 Dxb2 27.cxb4 Axb4 28.Rf1', '25.Dg3 Da1+ 26.Re2 Dxb2 27.Rf2 Dxc3 28.Rg2 Rb7 29.Tc1'];
  const line = (moveText, extra) => Object.assign({ moveText, isWhite: true, hasMoveNumber: true }, extra);

  it('detecta que las líneas están en español', () => {
    expect(detectNotation(es, 'es')).toBe('local');
    expect(detectNotation(['25.Re2Da226.Tb1Ad8'], 'es')).toBe('local'); // sin espacios entre jugadas
    expect(detectNotation(['25.Re2 Qa2 26.Rb1 Bd8 27.Nf3'], 'es')).toBe('en');
    expect(detectNotation(['25.Re2 e5'], 'es')).toBeNull();
    expect(detectNotation(es, 'en')).toBe('local'); // hay letras que no son inglesas
  });
  it('página en español: "Re2" es el rey de d1 a e2, no la torre', () => {
    expect(resolveLineMove(line('25.Re2'), legal, {}, 'es', 'local')).toEqual({ from: 'd1', to: 'e2' });
    expect(resolveLineMove(line('25.Df2'), legal, {}, 'es', 'local')).toEqual({ from: 'h4', to: 'f2' });
  });
  it('sin saber el idioma de las líneas, manda el de la página', () => {
    expect(resolveLineMove(line('25.Re2'), legal, {}, 'es', null)).toEqual({ from: 'd1', to: 'e2' });
  });
  it('página en español con líneas en inglés: "Re2" es la torre', () => {
    expect(resolveLineMove(line('25.Re2'), legal, {}, 'es', 'en')).toEqual({ from: 'e1', to: 'e2' });
  });
  it('página en inglés: "Re2" es la torre', () => {
    expect(resolveLineMove(line('25.Re2'), legal, {}, 'en', 'en')).toEqual({ from: 'e1', to: 'e2' });
  });
  it('la letra que sale de un figurín ya está en inglés', () => {
    expect(resolveLineMove(line('25.Re2', { figurine: true }), legal, {}, 'es', 'local')).toEqual({ from: 'e1', to: 'e2' });
  });
  it('sin API del tablero también traduce antes de calcular por geometría', () => {
    const pieces = { d1: 'wk', e1: 'wr', h1: 'wr', c8: 'bk' };
    expect(resolveLineMove(line('25.Re2'), null, pieces, 'es', 'local')).toEqual({ from: 'd1', to: 'e2' });
  });
});

describe('idiomas sin tabla: se aprende de la lista de jugadas de la página', () => {
  // Misma posición del informe; lista de jugadas de la partida en ruso (Кр = rey, Ф = dama, Л = torre,
  // С = alfil, К = caballo) y las mismas jugadas en inglés, como las da game.getHistorySANs()
  const displayed = ['e4', 'g6', 'd4', 'Сg7', 'Кc3', 'd6', 'Сe3', 'Кf6', 'Фd2', 'O-O', 'Крd1', 'Лe8'];
  const english = ['e4', 'g6', 'd4', 'Bg7', 'Nc3', 'd6', 'Be3', 'Nf6', 'Qd2', 'O-O', 'Kd1', 'Re8'];
  const legal = {
    bySan: new Map([['Ke2', { from: 'd1', to: 'e2' }], ['Re2', { from: 'e1', to: 'e2' }], ['Qf2', { from: 'h4', to: 'f2' }], ['Nf2', { from: 'h3', to: 'f2' }], ['Qg3', { from: 'h4', to: 'g3' }]]),
    list: [{ san: 'Ke2', from: 'd1', to: 'e2' }, { san: 'Re2', from: 'e1', to: 'e2' }, { san: 'Qf2', from: 'h4', to: 'f2' }, { san: 'Nf2', from: 'h3', to: 'f2' }, { san: 'Qg3', from: 'h4', to: 'g3' }],
    turnWhite: true
  };
  const line = moveText => ({ moveText, isWhite: true, hasMoveNumber: true });

  it('aprende el significado de cada letra, incluso de dos letras', () => {
    expect(learnPieceLetters(displayed, english)).toEqual({ 'С': 'B', 'К': 'N', 'Ф': 'Q', 'Кр': 'K', 'Л': 'R' });
  });
  it('no aprende nada de una lista que no corresponde', () => {
    expect(learnPieceLetters(['Лe2', 'Лe2'], ['Re2', 'Ke2'])).toBeNull();
    expect(learnPieceLetters(['e4'], ['e4'])).toBeNull();
  });
  it('traduce con lo aprendido, también la coronación', () => {
    const map = learnPieceLetters(displayed, english);
    expect(translateWithMap('Крe2', map)).toBe('Ke2');
    expect(translateWithMap('e8=Ф', map)).toBe('e8=Q');
    expect(translateWithMap('Жe2', map)).toBeNull();
  });
  it('si una sola pieza llega a la casilla, vale en cualquier idioma sin traducir', () => {
    expect(resolveLineMove(line('25.Фg3'), legal, {}, 'ru', 'local', null)).toEqual({ from: 'h4', to: 'g3' });
  });
  it('si varias piezas llegan a la misma casilla, decide lo aprendido', () => {
    const map = learnPieceLetters(displayed, english);
    expect(resolveLineMove(line('25.Крe2'), legal, {}, 'ru', 'local', map)).toEqual({ from: 'd1', to: 'e2' });
    expect(resolveLineMove(line('25.Лe2'), legal, {}, 'ru', 'local', map)).toEqual({ from: 'e1', to: 'e2' });
    expect(resolveLineMove(line('25.Кf2'), legal, {}, 'ru', 'local', map)).toEqual({ from: 'h3', to: 'f2' });
  });
  it('lo aprendido manda sobre la tabla (español aprendido de la página)', () => {
    const map = learnPieceLetters(['Ag7', 'Re2', 'Te8'], ['Bg7', 'Ke2', 'Re8']);
    expect(resolveLineMove(line('25.Re2'), legal, {}, 'es', null, map)).toEqual({ from: 'd1', to: 'e2' });
  });
  it('sin forma de entender la letra, no dibuja nada (antes de tomarla por un peón)', () => {
    expect(resolveLineMove(line('25.Крe2'), legal, {}, 'ru', 'local', null)).toBeNull();
    expect(resolveLineMove(line('25.Крe2'), null, { d1: 'wk', e1: 'wr' }, 'ru', 'local', null)).toBeNull();
  });
  it('detecta letras no inglesas en idiomas sin tabla', () => {
    expect(detectNotation(['25.Крe2 Фa2 26.Лb1'], 'ru')).toBe('local');
    expect(detectNotation(['25.Ke2 Qa2 26.Rb1'], 'ru')).toBe('en');
  });
});
