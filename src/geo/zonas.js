// Zonas entre dois furos vizinhos do perfil (mesma lógica da versão 1:
// a troca de material acontece no meio do vão). Fase 4 troca por contatos interpolados.

export function niceStep(r) {
  if (!(r > 0) || !Number.isFinite(r)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(r)));
  const f = r / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}

export function layerAtCota(b, cota) {
  const d = b.cota - cota;
  if (d < 0) return null;
  return b.layers.find((l) => d >= l.de && d < l.ate) || null;
}

/** Cotas de todos os contatos dos dois furos, da mais alta para a mais baixa. */
export function cotasContato(bhA, bhB) {
  return [...new Set([
    bhA.cota, ...bhA.layers.map((l) => bhA.cota - l.ate),
    bhB.cota, ...bhB.layers.map((l) => bhB.cota - l.ate),
  ])].sort((a, b) => b - a);
}

export function buildZones(bhA, bhB) {
  const all = cotasContato(bhA, bhB);
  return all.slice(0, -1).map((cTop, i) => {
    const cBot = all[i + 1], mid = (cTop + cBot) / 2;
    const lA = layerAtCota(bhA, mid), lB = layerAtCota(bhB, mid);
    if (!lA && !lB) return null;
    const sameP = !!(lA && lB && lA.solo.code === lB.solo.code);
    const sameS = sameP && lA.sec === lB.sec;
    return { cTop, cBot, lA, lB, sameP, sameS };
  }).filter(Boolean);
}

/** Extensão vertical (cotas) do perfil, com folga em cima e embaixo. */
export function extensaoCotas(bhs) {
  if (!bhs.length) return { minCota: 820, maxCota: 850 };
  const minCota = Math.min(...bhs.map((b) => b.cota - Math.max(0, ...b.layers.map((l) => l.ate))));
  const maxCota = Math.max(...bhs.map((b) => b.cota));
  const span = maxCota - minCota || 1;
  return { minCota: minCota - span * 0.12, maxCota: maxCota + span * 0.08 };
}
