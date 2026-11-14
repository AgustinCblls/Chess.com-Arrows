// ─────────────────────────── Selectores de chess.com ───────────────────────────
// Todo lo que el script busca en la página está aquí: si chess.com cambia su HTML,
// se corrige en un solo sitio. selfCheck() avisa en la consola de los que faltan.
export const SEL = {
  boards: 'wc-chess-board, chess-board',
  boardPlaceholder: '.board',
  piece: '.piece',
  highlight: '.highlight',
  analysisSwitch: '#analysis',             // Events y página de Análisis
  watchSwitch: '#evaluationSettings',      // vista Play/Watch
  evalBar: 'wc-evaluation-bar',
  evalDepth: 'wc-evaluation-depth, .analysis-options-depth',
  evalDepthTagHost: 'wc-evaluation-depth',
  // Estructura 1: Events y Play
  evalLinesComponents: 'wc-evaluation-lines .evaluation-lines-component, .evaluation-lines-component',
  evalLinesScore: '.evaluation-lines-score',
  evalLinesNode: '.evaluation-lines-node',
  evalLinesFirstNode: '.evaluation-lines-node[data-move-index="0"]',
  // Estructura 2: página de Análisis
  engineLineComponent: '.engine-line-component',
  engineLineFeedbackClass: 'analysis-feedback-row-engine',
  engineLineScore: '.score-text-score',
  engineLineNode: '.engine-line-node',
  linesPanel: 'wc-evaluation-lines, .evaluation-lines-component, .engine-lines-engine-lines-redesign, .engine-line-component',
  // Lista de jugadas y reloj (solo para reconstruir el FEN sin la API del tablero)
  selectedMove: '.node .selected, .node.selected',
  activeClock: '.clock-component.clock-player-turn',
  // Ventana de ajustes de chess.com
  settingsHosts: '.settings-modal-content-content, .settings-engine-component',
  guestMarker: 'a[href*="/register"]',
  // Para el MutationObserver
  watched: 'wc-evaluation-lines, wc-chess-board, chess-board, .board, .engine-lines-engine-lines-redesign, .evaluation-settings-component, .analysis-options-component, .settings-modal-container-component',
  watchedClasses: ['evaluation-lines-node', 'evaluation-lines-component', 'engine-line-node', 'engine-line-component', 'piece'],
  mounts: '#evaluationSettings, #analysis, wc-evaluation-lines, wc-chess-board, .settings-modal-container-component'
};

// Comprueba, una vez que hay tablero, que lo esencial sigue existiendo. Devuelve la lista de lo que falta.
export function selfCheck(doc, game) {
  const missing = [];
  if (!doc.querySelector(SEL.boards)) missing.push('tablero (' + SEL.boards + ')');
  if (game) {
    ['getFEN', 'getLegalMoves', 'getMode'].forEach(fn => { if (typeof game[fn] !== 'function') missing.push('game.' + fn + '()'); });
  } else missing.push('API del tablero (board.game)');
  return missing;
}
