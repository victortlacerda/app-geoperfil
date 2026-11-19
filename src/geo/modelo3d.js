// Geometria do modelo 3D (coordenadas reais: x = Leste, y = Norte, z = cota).
// - triangulação de Delaunay dos furos (malha para superfícies e cercas);
// - diagrama de cercas: em cada aresta da malha, o perfil 2D entre os dois furos
//   (mesma correlação/interpolação do perfil 2D) vira um painel vertical;
// - seção do corte ativo: o perfil 2D do corte, colocado no mesmo alinhamento da planta;
// - superfícies trianguladas (TIN) do terreno, do NA e do fundo dos furos.
import { Delaunay } from 'd3-delaunay';
import { resolverFuro, profMax } from '../model/projeto.js';
import { geometriaPerfil } from './perfil2d.js';
import { perfilDoCorte } from './corte.js';

/** Triangulação dos furos: { triangulos: [[i,j,k]], arestas: [[i,j]] } (índices em `furos`). */
export function triangulacao(furos) {
  const n = furos.length;
  if (n < 2) return { triangulos: [], arestas: [] };
  const linhaReta = () => {
    // pontos alinhados (ou só 2): liga em sequência ao longo da maior dimensão
    const xs = furos.map((f) => f.x), ys = furos.map((f) => f.y);
    const porX = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
    const ordem = furos.map((f, i) => i).sort((a, b) => (porX ? furos[a].x - furos[b].x : furos[a].y - furos[b].y));
    return { triangulos: [], arestas: ordem.slice(1).map((k, i) => [ordem[i], k]) };
  };
  if (n === 2) return linhaReta();
  const d = Delaunay.from(furos, (f) => f.x, (f) => f.y);
  if (d.collinear || !d.triangles.length) return linhaReta();
  const triangulos = [], vistas = new Set(), arestas = [];
  for (let t = 0; t < d.triangles.length; t += 3) {
    const tri = [d.triangles[t], d.triangles[t + 1], d.triangles[t + 2]];
    triangulos.push(tri);
    [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]].forEach(([a, b]) => {
      const k = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (!vistas.has(k)) { vistas.add(k); arestas.push(a < b ? [a, b] : [b, a]); }
    });
  }
  return { triangulos, arestas };
}

const mapear = (pts, origem, dir) => pts.map(([d, c]) => [origem[0] + dir[0] * d, origem[1] + dir[1] * d, c]);

/** Painel da cerca entre dois furos: polígonos com coordenadas 2D (d, cota) e 3D. */
export function cerca(fi, fj, { ajustes = {}, modo = 'interpolado' } = {}) {
  const L = Math.hypot(fj.x - fi.x, fj.y - fi.y);
  if (L < 1e-6) return null;
  // respeita o sentido em que os ajustes manuais foram feitos (A>B)
  const inverter = Object.keys(ajustes).some((k) => k.startsWith(`${fj.id}>${fi.id}|`));
  const [a, b] = inverter ? [fj, fi] : [fi, fj];
  const dir = [(b.x - a.x) / L, (b.y - a.y) / L];
  const A = { ...resolverFuro(a), dist: 0 }, B = { ...resolverFuro(b), dist: L };
  const g = geometriaPerfil([A, B], { ajustes, modo });
  return {
    ids: [a.id, b.id], L,
    poligonos: g.poligonos.map((p) => ({ solo: p.solo, sec: p.sec, pts2d: p.pts, pts3d: mapear(p.pts, [a.x, a.y], dir) })),
  };
}

/**
 * Seção do corte no espaço: o mesmo perfil 2D (furos projetados na linha do corte),
 * posicionado ao longo da linha A–A'. Também devolve o plano vertical do corte.
 */
export function secaoDoCorte(corte, furos, { modo = 'interpolado' } = {}) {
  if (!corte) return null;
  const bhs = perfilDoCorte(corte, furos);
  if (bhs.length < 2) return null;
  const [ax, ay] = corte.p1, [bx, by] = corte.p2, L = Math.hypot(bx - ax, by - ay);
  const u = [(bx - ax) / L, (by - ay) / L];
  const primeiro = furos.find((f) => f.id === bhs[0].id);
  const t0 = (primeiro.x - ax) * u[0] + (primeiro.y - ay) * u[1];
  const origem = [ax + u[0] * t0, ay + u[1] * t0];
  const g = geometriaPerfil(bhs, { ajustes: corte.ajustes || {}, modo });
  return {
    bhs, origem, dir: u,
    // normal horizontal apontando para onde o observador do perfil olha (A à esquerda, A' à direita)
    normal: [-u[1], u[0]],
    poligonos: g.poligonos.map((p) => ({ solo: p.solo, sec: p.sec, pts2d: p.pts, pts3d: mapear(p.pts, origem, u) })),
    terreno: mapear(g.terreno, origem, u), na: mapear(g.na, origem, u),
  };
}

/** Superfície triangulada: valor(f) dá a cota em cada furo (null = sem valor). */
export function superficie(furos, tri, valor) {
  const z = furos.map((f) => valor(f));
  return {
    vertices: furos.map((f, i) => [f.x, f.y, z[i]]),
    triangulos: tri.triangulos.filter((t) => t.every((i) => Number.isFinite(z[i]))),
  };
}

export const valores = {
  terreno: (f) => f.cota,
  na: (f) => (f.na > 0 ? f.cota - f.na : null),
  fundo: (f) => f.cota - profMax(f),
};

/** Caixa envolvente do modelo (para enquadrar a câmera). */
export function extensao(furos) {
  const xs = furos.map((f) => f.x), ys = furos.map((f) => f.y);
  const cs = furos.flatMap((f) => [f.cota, f.cota - profMax(f)]);
  return {
    x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys),
    c0: Math.min(...cs), c1: Math.max(...cs),
  };
}
