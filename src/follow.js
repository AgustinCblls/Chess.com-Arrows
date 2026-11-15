// ─────────────────────────── Seguir la profundidad de chess.com (función pura) ───────────────────────────
// Con la opción activa, el motor propio no se detiene en "Profundidad máx." / "Tiempo de búsqueda":
// sigue hasta alcanzar la profundidad que muestra chess.com (depth=N) y solo para cuando chess.com
// también dejó de subir. Si chess.com sigue subiendo después, la búsqueda se retoma.
// Límites de seguridad para no dejar el procesador ocupado indefinidamente:
export const FOLLOW_MAX_DEPTH = 40;
export const FOLLOW_MAX_MS = 60000;

// s: { target, stable, ourDepth, searching, stopSent, done, capped, maxDepth }
//   target: profundidad que muestra chess.com (null si no se ve); stable: chess.com dejó de subir
// Devuelve 'stop' (parar la búsqueda actual), 'extend' (seguir buscando la misma posición) o null.
export function followAction(s) {
  const target = s.target != null ? Math.min(s.target, FOLLOW_MAX_DEPTH) : s.maxDepth;
  const stable = s.target != null ? !!s.stable : true;
  const reached = s.ourDepth >= target;
  if (s.searching) return reached && stable && !s.stopSent ? 'stop' : null;
  if (s.done && !s.capped && !reached && s.ourDepth < FOLLOW_MAX_DEPTH) return 'extend';
  return null;
}
