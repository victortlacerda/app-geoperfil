// Projeto no formato salvo pela versão 1 (os 4 furos de exemplo do app antigo)
// e uma cópia fiel do cálculo de perfil da versão 1, para comparar resultados.
import { SOLOS } from '../src/model/catalogo.js';

export function v1Exemplo() {
  const L = (de, ate, soloCode, sec) => ({ de, ate, soloCode, sec, cor: '#000000' });
  return {
    version: 1,
    bhData: [
      { name: 'SP-01', x: 80, y: 200, cota: 842.5, limite: 15, na: 3.2,
        layers: [L(0, 2, 'ARGS', 'ATR'), L(2, 5.5, 'ARGA', 'RES'), L(5.5, 9, 'AREA', 'RES'), L(9, 14, 'SAR', 'RES'), L(14, 15, 'SAG', 'RFR')],
        spt: { 1: 3, 2: 4, 3: 5, 4: 6, 5: 8, 6: 9, 7: 11, 8: 15, 9: 18, 10: 22, 11: 28, 12: 35, 13: 42, 14: 50, 15: 50 } },
      { name: 'SP-02', x: 230, y: 185, cota: 839.0, limite: 12, na: 2.8,
        layers: [L(0, 1.5, 'ARGS', 'ATR'), L(1.5, 6, 'ARGA', 'RES'), L(6, 12, 'ARS', 'RES')],
        spt: { 1: 2, 2: 3, 3: 4, 4: 5, 5: 7, 6: 10, 7: 14, 8: 20, 9: 26, 10: 34, 11: 40, 12: 48 } },
      { name: 'SP-03', x: 390, y: 195, cota: 845.2, limite: 20, na: 4.5,
        layers: [L(0, 3, 'SAG', 'ATR'), L(3, 8, 'SAR', 'RES'), L(8, 18, 'ARE', 'RES'), L(18, 20, 'ARGS', 'RSA')],
        spt: { 1: 4, 2: 5, 3: 6, 4: 7, 5: 9, 6: 12, 7: 16, 8: 20, 9: 25, 10: 30, 11: 35, 12: 38, 13: 42, 14: 45, 15: 48, 16: 50, 17: 50, 18: 50, 19: 50, 20: 50 } },
      { name: 'SP-04', x: 210, y: 310, cota: 840.0, limite: 10, na: 3.0,
        layers: [L(0, 2, 'ARGS', 'ATR'), L(2, 7, 'SAG', 'RES'), L(7, 10, 'ARE', 'RES')],
        spt: { 1: 3, 2: 4, 3: 6, 4: 8, 5: 10, 6: 13, 7: 18, 8: 24, 9: 32, 10: 40 } },
    ],
    cortes: [
      { name: "A–A'", pt1: { x: 60, y: 150 }, pt2: { x: 420, y: 150 }, side: 1, usaBanda: true, bandaM: 100, bhNames: ['SP-01', 'SP-02', 'SP-03', 'SP-04'] },
    ],
    activeCorteIdx: 0,
  };
}

// ── cópia do código da versão 1 (legacy/index.html) ──
const PX_TO_M = 0.5;
const pxToM = (v) => +(v * PX_TO_M).toFixed(2);
const sideOfLine = (px, py, ax, ay, bx, by) => Math.sign((bx - ax) * (py - ay) - (by - ay) * (px - ax));
function projectPoint(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  if (l2 === 0) return { dist: Math.hypot(px - ax, py - ay), px: ax, py: ay, t: 0 };
  const t = ((px - ax) * dx + (py - ay) * dy) / l2, qx = ax + t * dx, qy = ay + t * dy;
  return { dist: Math.hypot(px - qx, py - qy), px: qx, py: qy, t };
}

export function perfilLegado(v1, c) {
  const bhData = v1.bhData.map((b) => ({
    ...b, layers: b.layers.map((l) => ({ de: l.de, ate: l.ate, solo: SOLOS.find((s) => s.code === l.soloCode), sec: l.sec })),
  }));
  const incl = bhData.filter((bh) => {
    const s = sideOfLine(bh.x, bh.y, c.pt1.x, c.pt1.y, c.pt2.x, c.pt2.y);
    if (s !== c.side) return false;
    if (c.usaBanda) return projectPoint(bh.x, bh.y, c.pt1.x, c.pt1.y, c.pt2.x, c.pt2.y).dist <= c.bandaM / PX_TO_M;
    return true;
  });
  const dx = c.pt2.x - c.pt1.x, dy = c.pt2.y - c.pt1.y, len = Math.hypot(dx, dy), nx = dx / len, ny = dy / len;
  const wT = incl.map((b) => ({ ...b, _t: (b.x - c.pt1.x) * nx + (b.y - c.pt1.y) * ny })).sort((a, b) => a._t - b._t);
  const t0 = wT[0]._t;
  return wT.map(({ _t, ...rest }) => ({ ...rest, dist: Math.max(0, pxToM(_t - t0)) }));
}
