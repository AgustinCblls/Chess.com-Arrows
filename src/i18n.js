// Textos de la interfaz. El idioma sale de la página de chess.com (o del navegador).
// Para añadir un idioma basta con otra entrada aquí; lo que falte se toma del inglés.
// (Las extensiones con "world": "MAIN" no tienen acceso a chrome.i18n, por eso va dentro del script.)
const STRINGS = {
  en: {
    title: 'Arrows · settings', multiPv: 'Arrows', maxTimeMs: 'Search time', maxDepth: 'Max depth', hashMb: 'Memory',
    ownEngineOnly: 'Ignore chess.com\'s lines (own engine only)', showReply: 'Show the expected reply (grey arrow)',
    scoresWatch: 'Evaluation next to the arrows while watching games (Watch)', scoresWithLines: 'Evaluation next to the arrows where chess.com lists lines (Events, Analysis)',
    widthByEval: 'Arrow width follows the evaluation', pvOnHover: 'Show the line when the mouse is on an arrow\'s target square',
    arrowStyle: 'Arrow style', style_color: 'Numbered colours', style_chesscom: 'Like chess.com (orange)', style_lichess: 'Like Lichess (blue and grey)',
    hideWorseBy: 'Hide arrows worse by', tag: 'arrows', own: 'Own engine', depth: 'depth',
    dom: 'Arrows read from chess.com\'s engine lines. If you ask for more than chess.com lists, the script\'s own engine adds the missing ones with these settings.',
    idle: 'No analysis right now.', reset: 'Reset',
    selfCheck: 'chess.com changed its page; some parts were not found:'
  },
  es: {
    title: 'Flechas · ajustes', multiPv: 'Flechas', maxTimeMs: 'Tiempo de búsqueda', maxDepth: 'Profundidad máx.', hashMb: 'Memoria',
    ownEngineOnly: 'Ignorar las líneas de chess.com (solo motor propio)', showReply: 'Mostrar la respuesta esperada (flecha gris)',
    scoresWatch: 'Evaluación junto a las flechas al mirar partidas (Watch)', scoresWithLines: 'Evaluación junto a las flechas donde chess.com lista líneas (Events, Análisis)',
    widthByEval: 'Grosor de la flecha según la evaluación', pvOnHover: 'Ver la variante al pasar el ratón por la casilla de destino',
    arrowStyle: 'Estilo de las flechas', style_color: 'Colores numerados', style_chesscom: 'Como chess.com (naranja)', style_lichess: 'Como Lichess (azul y gris)',
    hideWorseBy: 'Ocultar flechas peores por', tag: 'flechas', own: 'Motor propio', depth: 'profundidad',
    dom: 'Flechas leídas de las líneas de chess.com. Si pides más de las que chess.com lista, las que faltan las calcula el motor propio con estos ajustes.',
    idle: 'Sin análisis en este momento.', reset: 'Restablecer',
    selfCheck: 'chess.com cambió su página; no se encontró:'
  }
};

export function pickLang(pageLang, navLang) {
  const l = String(pageLang || navLang || 'en').slice(0, 2).toLowerCase();
  return STRINGS[l] ? l : 'en';
}

export function strings(lang) {
  return Object.assign({}, STRINGS.en, STRINGS[lang] || {});
}

export const LANGS = Object.keys(STRINGS);
