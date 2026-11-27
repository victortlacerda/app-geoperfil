// Modelo geológico 3D em bloco (coordenadas reais: x = Leste, y = Norte, z = cota).
//
// 1. Colunas de dados: os furos e, ao longo de cada corte, colunas virtuais tiradas
//    do Perfil 2D (com os ajustes manuais de contatos). Assim o 2D e o 3D ficam
//    ligados: o que muda no perfil muda no modelo.
// 2. Coluna estratigráfica comum: as sequências de camadas das colunas são fundidas
//    numa só (supersequência comum, pela maior subsequência comum), de modo que
//    cada coluna seja uma subsequência dela. Unidade ausente = espessura 0.
// 3. Interpolação: cota do terreno e do NA por spline de placa fina (suave e exata
//    nas colunas); espessura de cada unidade linear na triangulação das colunas
//    (exata e sem ultrapassar os valores; na linha de um corte, igual ao 2D).
//    As camadas são empilhadas do terreno para baixo, então nunca se cruzam.
// 4. Malha regular sobre um retângulo que envolve as colunas com uma margem.
import { Delaunay } from 'd3-delaunay';
import { camadasDoFuro, profMax, resolverFuro } from '../model/projeto.js';
import { camadasDesenho } from './horizontes.js';
import { perfilDoCorte } from './corte.js';
import { geometriaPerfil } from './perfil2d.js';

// ── álgebra ──

/** Fatoração LU com pivotamento parcial de A (n×n); devolve resolver(b) ou null se singular. */
function fatorar(A) {
  const n = A.length, M = A.map((l) => Float64Array.from(l)), piv = Array.from({ length: n }, (_, i) => i);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let i = c + 1; i < n; i++) if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]]; [piv[c], piv[p]] = [piv[p], piv[c]];
    for (let i = c + 1; i < n; i++) {
      const f = (M[i][c] /= M[c][c]);
      if (f) for (let k = c + 1; k < n; k++) M[i][k] -= f * M[c][k];
    }
  }
  return (b) => {
    const y = piv.map((i) => b[i]);
    for (let i = 0; i < n; i++) for (let k = 0; k < i; k++) y[i] -= M[i][k] * y[k];
    for (let i = n - 1; i >= 0; i--) { for (let k = i + 1; k < n; k++) y[i] -= M[i][k] * y[k]; y[i] /= M[i][i]; }
    return y;
  };
}

/**
 * Spline de placa fina sobre um conjunto fixo de pontos [{x, y}], para vários
 * campos de valores ao mesmo tempo (a fatoração é feita uma vez só).
 * 1 ponto → constante; pontos alinhados → linear ao longo da linha (constante
 * fora das pontas).
 * @returns { campo(valores) → c, avaliar(x, y, [c…]) → [v…] }
 */
export function criarTPS(pts) {
  const n = pts.length;
  if (n === 1) return { campo: (v) => ({ c: v[0] }), avaliar: (x, y, cs) => cs.map((c) => c.c) };
  const mx = pts.reduce((s, p) => s + p.x, 0) / n, my = pts.reduce((s, p) => s + p.y, 0) / n;
  const esc = Math.max(...pts.map((p) => Math.hypot(p.x - mx, p.y - my)), 1e-9);
  const Q = pts.map((p) => ({ x: (p.x - mx) / esc, y: (p.y - my) / esc }));
  const sxx = Q.reduce((s, p) => s + p.x * p.x, 0), syy = Q.reduce((s, p) => s + p.y * p.y, 0), sxy = Q.reduce((s, p) => s + p.x * p.y, 0);
  const tr = sxx + syy, det = sxx * syy - sxy * sxy, l2 = tr / 2 - Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  if (l2 / (tr || 1) < 1e-6) {
    // alinhados: interpolação linear ao longo da direção principal
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(ang), uy = Math.sin(ang);
    const ordem = Q.map((p, i) => ({ t: p.x * ux + p.y * uy, i })).sort((a, b) => a.t - b.t);
    return {
      campo: (v) => ({ L: ordem.map((o) => ({ t: o.t, v: v[o.i] })) }),
      avaliar: (x, y, cs) => {
        const t = ((x - mx) / esc) * ux + ((y - my) / esc) * uy;
        return cs.map(({ L }) => {
          if (t <= L[0].t) return L[0].v;
          if (t >= L[n - 1].t) return L[n - 1].v;
          let i = 1;
          while (L[i].t < t) i++;
          const a = L[i - 1], b = L[i];
          return b.t - a.t < 1e-12 ? b.v : a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
        });
      },
    };
  }
  const U = (r2) => (r2 < 1e-24 ? 0 : 0.5 * r2 * Math.log(r2)); // r² ln r
  const N = n + 3, A = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) A[i][j] = U((Q[i].x - Q[j].x) ** 2 + (Q[i].y - Q[j].y) ** 2);
    A[i][i] += 1e-9;
    A[i][n] = A[n][i] = 1; A[i][n + 1] = A[n + 1][i] = Q[i].x; A[i][n + 2] = A[n + 2][i] = Q[i].y;
  }
  const resolver = fatorar(A);
  const k = new Float64Array(n);
  return {
    campo: (v) => {
      if (!resolver) return { media: v.reduce((s, x) => s + x, 0) / n };
      return { w: resolver([...v, 0, 0, 0]) };
    },
    avaliar: (x, y, cs) => {
      const qx = (x - mx) / esc, qy = (y - my) / esc;
      for (let i = 0; i < n; i++) k[i] = U((qx - Q[i].x) ** 2 + (qy - Q[i].y) ** 2);
      return cs.map((c) => {
        if (!c.w) return c.media;
        const w = c.w;
        let s = w[n] + w[n + 1] * qx + w[n + 2] * qy;
        for (let i = 0; i < n; i++) s += w[i] * k[i];
        return s;
      });
    },
  };
}

/**
 * Interpolação linear sobre a triangulação de Delaunay dos pontos, para vários
 * campos de uma vez: exata nos pontos e sem ultrapassar os valores (não cria
 * pontas). Fora da envoltória, vale o ponto mais próximo da borda dela.
 * Pontos alinhados ou menos de 3 → mesmo comportamento de criarTPS.
 */
export function criarLinear(pts) {
  const n = pts.length;
  const d = n >= 3 ? Delaunay.from(pts, (p) => p.x, (p) => p.y) : null;
  if (!d || d.collinear || !d.triangles.length) return criarTPS(pts);
  const T = d.triangles, nt = T.length / 3, X = pts.map((p) => p.x), Y = pts.map((p) => p.y);
  const caixa = new Float64Array(nt * 4);
  for (let t = 0; t < nt; t++) {
    const a = T[3 * t], b = T[3 * t + 1], c = T[3 * t + 2];
    caixa.set([Math.min(X[a], X[b], X[c]), Math.min(Y[a], Y[b], Y[c]), Math.max(X[a], X[b], X[c]), Math.max(Y[a], Y[b], Y[c])], 4 * t);
  }
  const casco = [...d.hull];
  /** Onde está (x, y): [[índice, peso], …]. */
  const localizar = (x, y) => {
    for (let t = 0; t < nt; t++) {
      const e = 1e-9;
      if (x < caixa[4 * t] - e || y < caixa[4 * t + 1] - e || x > caixa[4 * t + 2] + e || y > caixa[4 * t + 3] + e) continue;
      const a = T[3 * t], b = T[3 * t + 1], c = T[3 * t + 2];
      const det = (Y[b] - Y[c]) * (X[a] - X[c]) + (X[c] - X[b]) * (Y[a] - Y[c]);
      if (Math.abs(det) < 1e-12) continue;
      const l1 = ((Y[b] - Y[c]) * (x - X[c]) + (X[c] - X[b]) * (y - Y[c])) / det;
      const l2 = ((Y[c] - Y[a]) * (x - X[c]) + (X[a] - X[c]) * (y - Y[c])) / det;
      const l3 = 1 - l1 - l2;
      if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) return [[a, l1], [b, l2], [c, l3]];
    }
    // fora: ponto mais próximo na borda da envoltória
    let melhor = null, dm = Infinity;
    for (let i = 0; i < casco.length; i++) {
      const a = casco[i], b = casco[(i + 1) % casco.length];
      const dx = X[b] - X[a], dy = Y[b] - Y[a], L2 = dx * dx + dy * dy || 1e-12;
      const t = Math.max(0, Math.min(1, ((x - X[a]) * dx + (y - Y[a]) * dy) / L2));
      const dd = (x - X[a] - dx * t) ** 2 + (y - Y[a] - dy * t) ** 2;
      if (dd < dm) { dm = dd; melhor = [[a, 1 - t], [b, t]]; }
    }
    return melhor;
  };
  return {
    campo: (v) => ({ v }),
    avaliar: (x, y, cs) => {
      const w = localizar(x, y);
      return cs.map(({ v }) => w.reduce((s, [i, p]) => s + v[i] * p, 0));
    },
  };
}

/**
 * Interpolador suave por spline de placa fina: f(x, y), exato nos pontos.
 * Pontos repetidos na mesma posição são promediados.
 * @param pts [{ x, y, v }]
 */
export function interpolador(pts) {
  const unicos = new Map();
  pts.forEach((p) => {
    const k = `${p.x.toFixed(3)}|${p.y.toFixed(3)}`;
    const u = unicos.get(k) || { x: p.x, y: p.y, s: 0, n: 0 };
    u.s += p.v; u.n++; unicos.set(k, u);
  });
  const P = [...unicos.values()];
  if (!P.length) return () => NaN;
  const t = criarTPS(P), c = t.campo(P.map((u) => u.s / u.n));
  return (x, y) => t.avaliar(x, y, [c])[0];
}

// ── colunas (furos reais e colunas virtuais tiradas dos perfis 2D) ──

// a camada é identificada pela classificação primária: o mesmo solo se liga entre
// as colunas mesmo com origem diferente (a cor no desenho também é só pela primária)
const chave = (c) => c.codigo;

/** Camadas seguidas do mesmo solo (só a origem muda) viram uma. */
function juntar(cam) {
  return cam.reduce((out, c) => {
    const u = out.at(-1);
    if (u && u.codigo === c.codigo) { u.esp += c.esp; if (c.esp > u.maior) { u.maior = c.esp; u.origem = c.origem; } } else out.push({ ...c, maior: c.esp });
    return out;
  }, []).filter((c) => c.esp > 1e-6);
}

/**
 * Furo → coluna { id, x, y, cota, na (cota do NA ou null), cam: [{ codigo, origem, esp }], blocos }.
 * As camadas são as mesmas do Perfil 2D (geo/horizontes.js): pedregulho/blocos vira
 * bloco solto e, com porHorizonte, a unidade é o horizonte (aterro, colúvio…).
 */
export function colunaDoFuro(f, { porHorizonte = false } = {}) {
  const { layers, blocos } = camadasDesenho(resolverFuro(f).layers, { porHorizonte });
  const cam = juntar(layers.filter((c) => c.ate > c.de).map((c) => ({ codigo: c.solo.code, origem: c.sec || '', esp: c.ate - c.de })));
  if (blocos.length) return { id: f.id, nome: f.nome, x: f.x, y: f.y, cota: f.cota, na: f.na > 0 ? f.cota - f.na : null, cam, real: true, blocos };
  return { id: f.id, nome: f.nome, x: f.x, y: f.y, cota: f.cota, na: f.na > 0 ? f.cota - f.na : null, cam, real: true };
}

const interpLinha = (pts, d) => {
  if (!pts.length || d < pts[0][0] - 1e-9 || d > pts.at(-1)[0] + 1e-9) return null;
  for (let i = 1; i < pts.length; i++) {
    const [d0, c0] = pts[i - 1], [d1, c1] = pts[i];
    if (d <= d1 + 1e-9) return d1 - d0 < 1e-12 ? c1 : c0 + ((c1 - c0) * (d - d0)) / (d1 - d0);
  }
  return pts.at(-1)[1];
};

/** Intervalo de cotas [baixo, cima] em que a vertical d corta o polígono, ou null. */
function corteVertical(pts, d) {
  const cs = [];
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
    if (Math.abs(x1 - x0) < 1e-9) { if (Math.abs(x0 - d) < 1e-9) cs.push(y0, y1); continue; }
    if (d >= Math.min(x0, x1) - 1e-9 && d <= Math.max(x0, x1) + 1e-9) cs.push(y0 + ((y1 - y0) * (d - x0)) / (x1 - x0));
  }
  if (cs.length < 2) return null;
  const lo = Math.min(...cs), hi = Math.max(...cs);
  return hi - lo > 1e-6 ? [lo, hi] : null;
}

/**
 * Colunas virtuais ao longo de um corte, tiradas do Perfil 2D dele (com os ajustes
 * manuais de contatos): nas posições dos furos, nos vértices dos polígonos (pontas
 * de acunhamento, transições) e a cada trecho do vão. Assim o 3D reproduz o 2D
 * na linha de cada corte.
 */
export function colunasDoCorte(corte, furos, { porHorizonte = false } = {}) {
  const bhs = perfilDoCorte(corte, furos, { porHorizonte });
  if (bhs.length < 2) return [];
  // o modo do corte (reta, suave ou degrau) vale também no 3D
  const geo = geometriaPerfil(bhs, { ajustes: corte.ajustes || {}, modo: corte.modo || 'interpolado' });
  const [ax, ay] = corte.p1, [bx, by] = corte.p2, L = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / L, uy = (by - ay) / L;
  const t0 = (bhs[0].x - ax) * ux + (bhs[0].y - ay) * uy;
  // estações nos furos e a cada passo do vão. O passo não é menor que 1,5 m: no 2D
  // a transição lateral é uma parede vertical (salto de espessura em distância
  // zero), que a superfície suave não reproduz sem oscilar; com o passo ela vira
  // uma rampa curta no 3D.
  const tot = geo.totDist, passo = Math.max(1.5, tot / 40);
  const lista = bhs.map((b) => b.dist);
  for (let d = passo; d < tot; d += passo) if (lista.every((q) => Math.abs(q - d) > passo / 2)) lista.push(+d.toFixed(3));
  lista.sort((a, b) => a - b);
  const furoEm = new Map(bhs.map((b) => [b.dist, b]));
  const porId = new Map(furos.map((f) => [f.id, f]));
  const camadasEm = (d) => geo.poligonos.map((p) => ({ p, r: corteVertical(p.pts, d) })).filter((o) => o.r).sort((a, b) => b.r[1] - a.r[1])
    .map(({ p, r }) => ({ codigo: p.solo.code, origem: p.sec || '', esp: r[1] - r[0] }));
  return lista.map((d) => {
    const b = furoEm.get(d), pos = { x: ax + ux * (t0 + d), y: ay + uy * (t0 + d) };
    const na = geo.na.length > 1 ? interpLinha(geo.na, d) : null;
    // na posição do furo, as camadas do próprio furo (ali os polígonos dos dois
    // lados encostam na mesma vertical e seriam contados duas vezes)
    if (b) { const c = colunaDoFuro(porId.get(b.id), { porHorizonte }); delete c.blocos; return { ...c, ...pos, id: `${corte.id}@${d}`, corte: corte.id, furo: b.id, real: false, na: c.na ?? na }; }
    const topo = interpLinha(geo.terreno, d);
    if (topo == null) return null;
    let cam = camadasEm(d);
    // numa vertical que coincide com a parede de uma transição, olha um pouco ao lado
    const base = interpLinha(geo.fundo, d);
    if (base != null && cam.reduce((s, c) => s + c.esp, 0) > topo - base + 1e-3) cam = camadasEm(d + 1e-3);
    return { id: `${corte.id}@${d}`, corte: corte.id, furo: null, ...pos, cota: topo, na, cam: juntar(cam) };
  }).filter((c) => c && c.cam.length);
}

/** Alinhamento pela maior subsequência comum: pares [i, j] com a[i] === b[j]. */
function lcs(a, b) {
  const n = a.length, m = b.length, T = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) T[i][j] = a[i] === b[j] ? T[i + 1][j + 1] + 1 : Math.max(T[i + 1][j], T[i][j + 1]);
  const pares = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { pares.push([i, j]); i++; j++; } else if (T[i + 1][j] >= T[i][j + 1]) i++; else j++;
  }
  return pares;
}

/** Menor supersequência comum de a e b (fundindo pela LCS). */
function fundir(a, b) {
  const out = [];
  let i = 0, j = 0;
  for (const [pi, pj] of lcs(a, b)) {
    while (i < pi) out.push(a[i++]);
    while (j < pj) out.push(b[j++]);
    out.push(a[i]); i++; j++;
  }
  while (i < a.length) out.push(a[i++]);
  while (j < b.length) out.push(b[j++]);
  return out;
}

/**
 * Coluna estratigráfica comum: cada coluna (furo ou coluna virtual) é uma
 * subsequência dela. Aceita furos ou colunas.
 * @returns { unidades: [{ chave, codigo, origem }], espessuras: Map(id → number[]) }
 */
export function colunaEstratigrafica(entrada) {
  const cols = entrada.map((c) => (c.cam ? c : colunaDoFuro(c))).filter((c) => c.cam.length);
  if (!cols.length) return { unidades: [], espessuras: new Map() };
  // funde as sequências distintas: primeiro a dos furos com mais camadas, depois
  // pela proximidade das já fundidas
  const seqs = new Map();
  cols.forEach((c) => { const k = c.cam.map(chave).join('>'); if (!seqs.has(k)) seqs.set(k, { c, seq: c.cam.map(chave) }); });
  const resto = [...seqs.values()].sort((a, b) => (b.c.real ? 1 : 0) - (a.c.real ? 1 : 0) || b.seq.length - a.seq.length);
  const usados = [resto.shift()];
  let G = usados[0].seq;
  while (resto.length) {
    let k = 0, dk = Infinity;
    resto.forEach((s, i) => {
      const d = Math.min(...usados.map((u) => Math.hypot(u.c.x - s.c.x, u.c.y - s.c.y)));
      if (d < dk) { dk = d; k = i; }
    });
    const s = resto.splice(k, 1)[0];
    G = fundir(G, s.seq);
    usados.push(s);
  }
  const unidades = G.map((k) => ({ chave: k, codigo: k, origens: {} }));
  const espessuras = new Map();
  cols.forEach((c) => {
    const e = new Array(G.length).fill(0);
    lcs(G, c.cam.map(chave)).forEach(([gi, ci]) => {
      e[gi] = c.cam[ci].esp;
      if (c.real) { const o = c.cam[ci].origem || ''; unidades[gi].origens[o] = (unidades[gi].origens[o] || 0) + e[gi]; }
    });
    espessuras.set(c.id, e);
  });
  unidades.forEach((u) => { u.origem = Object.entries(u.origens).sort((a, b) => b[1] - a[1])[0]?.[0] || ''; });
  return { unidades, espessuras };
}

// ── modelo em bloco ──

/** Furos com camadas lançadas (os que entram no modelo). */
export const furosDoModelo = (furos) => furos.filter((f) => camadasDoFuro(f).length && profMax(f) > 0);

/**
 * Retângulo do modelo: envolve os pontos com margem de 20% do maior lado (mín. 8 m);
 * com um ponto só ou pontos alinhados, garante uma largura mínima.
 */
export function dominio(pontos, { margem } = {}) {
  const xs = pontos.map((f) => f.x), ys = pontos.map((f) => f.y);
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const vao = Math.max(x1 - x0, y1 - y0);
  const m = margem ?? Math.max(vao * 0.2, 8);
  const minimo = Math.max(vao * 0.5, 30);
  if (x1 - x0 < minimo) { const c = (x0 + x1) / 2; x0 = c - minimo / 2; x1 = c + minimo / 2; }
  if (y1 - y0 < minimo) { const c = (y0 + y1) / 2; y0 = c - minimo / 2; y1 = c + minimo / 2; }
  return { x0: x0 - m, x1: x1 + m, y0: y0 - m, y1: y1 + m };
}

/**
 * Monta o modelo em bloco a partir dos furos e dos perfis 2D dos cortes.
 * Colunas virtuais muito perto de um furo de fora do corte, ou de uma coluna de
 * outro corte, são descartadas (o furo real prevalece; o primeiro corte também).
 * @returns {
 *   dominio, nx, ny, xs, ys, unidades, colunas,
 *   contatos: Float64Array[]  // nU + 1 superfícies na malha (0 = terreno, nU = base)
 *   na: Float64Array | null,
 *   pontual(x, y) → { contatos, na }   // avaliação exata
 *   naMalha(x, y) → { contatos, na }   // bilinear na malha (coerente com o desenho)
 * }
 */
export function modeloBloco(furosTodos, { cortes = [], resolucao = 100, margem, porHorizonte = false } = {}) {
  const furos = furosDoModelo(furosTodos);
  if (!furos.length) return null;
  const reais = furos.map((f) => colunaDoFuro(f, { porHorizonte }));
  const dom0 = dominio(reais, { margem });
  const dmin = Math.max(1, Math.hypot(dom0.x1 - dom0.x0, dom0.y1 - dom0.y0) * 0.01);
  const colunas = [...reais];
  cortes.forEach((corte) => {
    const virt = colunasDoCorte(corte, furosTodos, { porHorizonte });
    const ids = new Set(virt.map((v) => v.furo).filter(Boolean));
    const antes = colunas.length;
    virt.forEach((v) => {
      const conflito = colunas.some((c, i) => {
        const d = Math.hypot(c.x - v.x, c.y - v.y);
        if (c.real) return d < dmin && !ids.has(c.id) || d < 1e-6;
        return i < antes && d < dmin; // coluna de outro corte
      });
      if (!conflito) colunas.push(v);
    });
  });
  const { unidades, espessuras } = colunaEstratigrafica(colunas);
  const nU = unidades.length;
  const dom = dominio(colunas, { margem });

  // terreno: superfície suave; espessuras: lineares na triangulação (exatas nas
  // colunas, sem ultrapassar os valores; na linha de cada corte, igual ao 2D)
  const tps = criarTPS(colunas), lin = criarLinear(colunas);
  const cTer = tps.campo(colunas.map((c) => c.cota));
  const cEsp = unidades.map((u, k) => lin.campo(colunas.map((c) => espessuras.get(c.id)[k])));
  const maxEsp = unidades.map((u, k) => Math.max(...colunas.map((c) => espessuras.get(c.id)[k])) * 1.25);
  const cotas = colunas.map((c) => c.cota);
  const terMin = Math.min(...cotas), terMax = Math.max(...cotas), terPad = Math.max((terMax - terMin) * 0.5, 2);
  const comNA = colunas.filter((c) => c.na != null);
  const tpsNA = comNA.length ? criarTPS(comNA) : null, cNA = tpsNA ? tpsNA.campo(comNA.map((c) => c.na)) : null;

  const pontual = (x, y) => {
    const t = Math.min(terMax + terPad, Math.max(terMin - terPad, tps.avaliar(x, y, [cTer])[0]));
    const v = lin.avaliar(x, y, cEsp);
    const c = [t];
    for (let k = 0; k < nU; k++) c.push(c[k] - Math.min(maxEsp[k], Math.max(0, v[k])));
    const na = tpsNA ? Math.min(tpsNA.avaliar(x, y, [cNA])[0], t) : null;
    return { contatos: c, na };
  };

  const W = dom.x1 - dom.x0, D = dom.y1 - dom.y0, passo = Math.max(W, D) / resolucao;
  const nx = Math.max(2, Math.round(W / passo)), ny = Math.max(2, Math.round(D / passo));
  const xs = Array.from({ length: nx + 1 }, (_, i) => dom.x0 + (W * i) / nx);
  const ys = Array.from({ length: ny + 1 }, (_, j) => dom.y0 + (D * j) / ny);
  const contatos = Array.from({ length: nU + 1 }, () => new Float64Array((nx + 1) * (ny + 1)));
  const na = tpsNA ? new Float64Array((nx + 1) * (ny + 1)) : null;
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const k = j * (nx + 1) + i, p = pontual(xs[i], ys[j]);
      p.contatos.forEach((v, u) => { contatos[u][k] = v; });
      if (na) na[k] = p.na;
    }
  }
  /** Valores na malha por interpolação bilinear (coerente com as superfícies desenhadas). */
  const naMalha = (x, y) => {
    const fx = Math.min(nx - 1e-9, Math.max(0, ((x - dom.x0) / W) * nx)), fy = Math.min(ny - 1e-9, Math.max(0, ((y - dom.y0) / D) * ny));
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
    const q = (A) => {
      const a = A[j * (nx + 1) + i], b = A[j * (nx + 1) + i + 1], c = A[(j + 1) * (nx + 1) + i], d = A[(j + 1) * (nx + 1) + i + 1];
      return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    };
    return { contatos: contatos.map(q), na: na ? q(na) : null };
  };
  return { dominio: dom, nx, ny, xs, ys, unidades, contatos, na, pontual, naMalha, furos, colunas };
}

/**
 * Segmento da linha (p1→p2, prolongada) dentro do retângulo do modelo:
 * [[xa, ya], [xb, yb]] na ordem de p1 para p2, ou null.
 */
export function linhaNoDominio(p1, p2, dom) {
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
  let t0 = -Infinity, t1 = Infinity;
  for (const [p, q0, q1] of [[dx, dom.x0 - p1[0], dom.x1 - p1[0]], [dy, dom.y0 - p1[1], dom.y1 - p1[1]]]) {
    if (Math.abs(p) < 1e-12) { if (q0 > 0 || q1 < 0) return null; continue; }
    const a = q0 / p, b = q1 / p;
    t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b));
  }
  if (!(t1 > t0)) return null;
  return [[p1[0] + dx * t0, p1[1] + dy * t0], [p1[0] + dx * t1, p1[1] + dy * t1]];
}
