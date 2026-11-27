// Geometria do corte em planta. Coordenadas em metros.
import { resolverFuro } from '../model/projeto.js';
import { camadasDesenho } from './horizontes.js';

/** Sinal do lado em que (px,py) está em relação à reta A→B (+1, −1 ou 0). */
export function sideOfLine(px, py, ax, ay, bx, by) {
  return Math.sign((bx - ax) * (py - ay) - (by - ay) * (px - ax));
}

/** Projeção de P na reta AB: distância perpendicular, ponto projetado e parâmetro t (0 em A, 1 em B). */
export function projectPoint(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  if (l2 === 0) return { dist: Math.hypot(px - ax, py - ay), px: ax, py: ay, t: 0 };
  const t = ((px - ax) * dx + (py - ay) * dy) / l2;
  const qx = ax + t * dx, qy = ay + t * dy;
  return { dist: Math.hypot(px - qx, py - qy), px: qx, py: qy, t };
}

export const comprimento = (c) => Math.hypot(c.p2[0] - c.p1[0], c.p2[1] - c.p1[1]);

/**
 * Furos incluídos no corte.
 * - incluir = 'lado' (padrão): só os furos do lado clicado (`lado`); 'ambos': dos dois lados.
 * - faixa: distância máxima à linha (m), com a mesma tolerância além das pontas A e A'.
 *   faixa = null não limita a distância.
 */
export function furosNoCorte(corte, furos) {
  const [ax, ay] = corte.p1, [bx, by] = corte.p2;
  const len = comprimento(corte);
  if (len < 1e-9) return [];
  const soUmLado = corte.incluir !== 'ambos' && corte.lado;
  return furos.filter((f) => {
    if (soUmLado) {
      const s = sideOfLine(f.x, f.y, ax, ay, bx, by);
      if (s !== 0 && s !== corte.lado) return false;
    }
    if (corte.faixa === null || corte.faixa === undefined) return true;
    const pr = projectPoint(f.x, f.y, ax, ay, bx, by);
    const s = pr.t * len;
    return pr.dist <= corte.faixa + 1e-9 && s >= -corte.faixa - 1e-9 && s <= len + corte.faixa + 1e-9;
  });
}

/**
 * Furos do corte ordenados de A para A', no formato resolvido usado pelo
 * desenho do perfil, com `dist` = distância ao longo do corte (m),
 * contada a partir do primeiro furo.
 */
/**
 * Furos do corte, resolvidos e ordenados pela distância ao longo da linha.
 * opcoes.porHorizonte: camadas pintadas por horizonte (ver geo/horizontes.js).
 */
export function perfilDoCorte(corte, furos, opcoes = {}) {
  if (!corte) return [];
  const [ax, ay] = corte.p1, [bx, by] = corte.p2;
  const len = comprimento(corte);
  if (len < 1e-9) return [];
  const nx = (bx - ax) / len, ny = (by - ay) / len;
  const sel = furosNoCorte(corte, furos)
    .map((f) => ({ f, t: (f.x - ax) * nx + (f.y - ay) * ny }))
    .sort((a, b) => a.t - b.t);
  if (!sel.length) return [];
  const t0 = sel[0].t;
  return sel.map(({ f, t }) => {
    const b = resolverFuro(f), { layers, blocos } = camadasDesenho(b.layers, opcoes);
    return { ...b, layers, blocos, dist: +(t - t0).toFixed(2) };
  });
}

/** Próximo nome de corte livre: A–A', B–B', ... */
export function proximoNomeCorte(cortes) {
  const usados = new Set(cortes.map((c) => c.nome));
  const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const l of letras) if (!usados.has(`${l}–${l}'`)) return `${l}–${l}'`;
  return `C${cortes.length + 1}–C${cortes.length + 1}'`;
}
