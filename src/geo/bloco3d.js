// Modelo geológico 3D em bloco (coordenadas reais: x = Leste, y = Norte, z = cota).
//
// 1. Coluna estratigráfica comum: as sequências de camadas dos furos são fundidas
//    numa só (supersequência comum, pela maior subsequência comum), de modo que
//    cada furo seja uma subsequência dela. Unidade ausente num furo = espessura 0.
// 2. Interpolação: cota do terreno, espessura de cada unidade e cota do NA são
//    interpoladas com spline de placa fina (thin plate spline), suave e exata nos
//    furos. As camadas são empilhadas do terreno para baixo, então nunca se cruzam.
// 3. Malha regular sobre um retângulo que envolve os furos com uma margem.
import { camadasDoFuro, profMax } from '../model/projeto.js';

// ── álgebra ──

/** Resolve A·x = b (eliminação de Gauss com pivotamento parcial). A é n×n (array de arrays). */
function resolver(A, b) {
  const n = b.length, M = A.map((l, i) => [...l, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let i = c + 1; i < n; i++) if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let i = c + 1; i < n; i++) {
      const f = M[i][c] / M[c][c];
      if (f) for (let k = c; k <= n; k++) M[i][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let k = i + 1; k < n; k++) s -= M[i][k] * x[k];
    x[i] = s / M[i][i];
  }
  return x;
}

/**
 * Interpolador suave por spline de placa fina: f(x, y), exato nos pontos.
 * 1 ponto → constante; pontos alinhados → linear ao longo da linha (constante
 * fora das pontas). Pontos repetidos na mesma posição são promediados.
 * @param pts [{ x, y, v }]
 */
export function interpolador(pts) {
  const unicos = new Map();
  pts.forEach((p) => {
    const k = `${p.x.toFixed(3)}|${p.y.toFixed(3)}`;
    const u = unicos.get(k) || { x: p.x, y: p.y, s: 0, n: 0 };
    u.s += p.v; u.n++; unicos.set(k, u);
  });
  const P = [...unicos.values()].map((u) => ({ x: u.x, y: u.y, v: u.s / u.n }));
  const n = P.length;
  if (!n) return () => NaN;
  if (n === 1) return () => P[0].v;
  // normaliza as coordenadas (condicionamento)
  const mx = P.reduce((s, p) => s + p.x, 0) / n, my = P.reduce((s, p) => s + p.y, 0) / n;
  const esc = Math.max(...P.map((p) => Math.hypot(p.x - mx, p.y - my)), 1e-9);
  const Q = P.map((p) => ({ x: (p.x - mx) / esc, y: (p.y - my) / esc, v: p.v }));
  // alinhados? (menor autovalor da covariância ≈ 0)
  const sxx = Q.reduce((s, p) => s + p.x * p.x, 0), syy = Q.reduce((s, p) => s + p.y * p.y, 0), sxy = Q.reduce((s, p) => s + p.x * p.y, 0);
  const tr = sxx + syy, det = sxx * syy - sxy * sxy, l2 = tr / 2 - Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  if (l2 / (tr || 1) < 1e-6) {
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(ang), uy = Math.sin(ang);
    const L = Q.map((p) => ({ t: p.x * ux + p.y * uy, v: p.v })).sort((a, b) => a.t - b.t);
    return (x, y) => {
      const t = ((x - mx) / esc) * ux + ((y - my) / esc) * uy;
      if (t <= L[0].t) return L[0].v;
      if (t >= L[n - 1].t) return L[n - 1].v;
      let i = 1;
      while (L[i].t < t) i++;
      const a = L[i - 1], b = L[i];
      return b.t - a.t < 1e-12 ? b.v : a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
    };
  }
  const U = (r2) => (r2 < 1e-24 ? 0 : 0.5 * r2 * Math.log(r2)); // r² ln r
  const N = n + 3, A = Array.from({ length: N }, () => new Array(N).fill(0)), b = new Array(N).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) A[i][j] = U((Q[i].x - Q[j].x) ** 2 + (Q[i].y - Q[j].y) ** 2);
    A[i][i] += 1e-9;
    A[i][n] = A[n][i] = 1; A[i][n + 1] = A[n + 1][i] = Q[i].x; A[i][n + 2] = A[n + 2][i] = Q[i].y;
    b[i] = Q[i].v;
  }
  const w = resolver(A, b);
  if (!w) return () => Q.reduce((s, p) => s + p.v, 0) / n;
  return (x, y) => {
    const qx = (x - mx) / esc, qy = (y - my) / esc;
    let s = w[n] + w[n + 1] * qx + w[n + 2] * qy;
    for (let i = 0; i < n; i++) s += w[i] * U((qx - Q[i].x) ** 2 + (qy - Q[i].y) ** 2);
    return s;
  };
}

// ── coluna estratigráfica ──

// a camada é identificada pela classificação primária: o mesmo solo se liga entre os
// furos mesmo com origem diferente (a cor no desenho também é só pela primária)
const chave = (c) => c.codigo;

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
 * Coluna estratigráfica comum aos furos.
 * @returns { unidades: [{ chave, codigo, origem }], espessuras: Map(furoId → number[]) }
 */
export function colunaEstratigrafica(furos) {
  // camadas seguidas do mesmo solo (só a origem muda) viram uma
  const juntar = (cam) => cam.reduce((out, c) => {
    const u = out.at(-1);
    if (u && u.codigo === c.codigo && Math.abs(u.ate - c.de) < 1e-9) { u.ate = c.ate; if (c.ate - c.de > u.maior) { u.maior = c.ate - c.de; u.origem = c.origem; } } else out.push({ ...c, maior: c.ate - c.de });
    return out;
  }, []);
  const seqs = furos.map((f) => ({ f, cam: juntar(camadasDoFuro(f).filter((c) => c.ate > c.de)) })).filter((s) => s.cam.length);
  if (!seqs.length) return { unidades: [], espessuras: new Map() };
  // funde a partir do furo com mais camadas, depois pelo mais próximo dos já fundidos
  const resto = [...seqs].sort((a, b) => b.cam.length - a.cam.length);
  const usados = [resto.shift()];
  let G = usados[0].cam.map(chave);
  while (resto.length) {
    let k = 0, dk = Infinity;
    resto.forEach((s, i) => {
      const d = Math.min(...usados.map((u) => Math.hypot(u.f.x - s.f.x, u.f.y - s.f.y)));
      if (d < dk) { dk = d; k = i; }
    });
    const s = resto.splice(k, 1)[0];
    G = fundir(G, s.cam.map(chave));
    usados.push(s);
  }
  const unidades = G.map((k) => ({ chave: k, codigo: k, origens: {} }));
  const espessuras = new Map();
  seqs.forEach(({ f, cam }) => {
    const e = new Array(G.length).fill(0);
    lcs(G, cam.map(chave)).forEach(([gi, ci]) => {
      e[gi] = cam[ci].ate - cam[ci].de;
      const o = cam[ci].origem || '';
      unidades[gi].origens[o] = (unidades[gi].origens[o] || 0) + e[gi];
    });
    espessuras.set(f.id, e);
  });
  // origem predominante (por espessura), só para informação
  unidades.forEach((u) => { u.origem = Object.entries(u.origens).sort((a, b) => b[1] - a[1])[0]?.[0] || ''; });
  return { unidades, espessuras };
}

// ── modelo em bloco ──

/** Furos com camadas lançadas (os que entram no modelo). */
export const furosDoModelo = (furos) => furos.filter((f) => camadasDoFuro(f).length && profMax(f) > 0);

/**
 * Retângulo do modelo: envolve os furos com margem de 20% do maior lado (mín. 8 m);
 * com um furo só ou furos alinhados, garante uma largura mínima.
 */
export function dominio(furos, { margem } = {}) {
  const xs = furos.map((f) => f.x), ys = furos.map((f) => f.y);
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const vao = Math.max(x1 - x0, y1 - y0);
  const m = margem ?? Math.max(vao * 0.2, 8);
  const minimo = Math.max(vao * 0.5, 30);
  if (x1 - x0 < minimo) { const c = (x0 + x1) / 2; x0 = c - minimo / 2; x1 = c + minimo / 2; }
  if (y1 - y0 < minimo) { const c = (y0 + y1) / 2; y0 = c - minimo / 2; y1 = c + minimo / 2; }
  return { x0: x0 - m, x1: x1 + m, y0: y0 - m, y1: y1 + m };
}

/**
 * Monta o modelo em bloco.
 * @returns {
 *   dominio, nx, ny, xs, ys, unidades,
 *   contatos: Float64Array[]  // nU + 1 superfícies na malha (0 = terreno, nU = base)
 *   na: Float64Array | null,
 *   pontual(x, y) → { contatos: number[], na }   // avaliação exata (seção do corte)
 * }
 */
export function modeloBloco(furosTodos, { resolucao = 80, margem, extras = [] } = {}) {
  const furos = furosDoModelo(furosTodos);
  if (!furos.length) return null;
  const { unidades, espessuras } = colunaEstratigrafica(furos);
  const nU = unidades.length;
  const dom = dominio(furos, { margem });

  // pontos de dados: cada furo na sua posição e, opcionalmente, repetido em outras
  // posições (furos projetados na linha do corte, como no Perfil 2D). Uma cópia
  // muito perto de outro ponto é descartada, para não criar conflito.
  const porId = new Map(furos.map((f) => [f.id, f]));
  const dmin = Math.max(1, Math.hypot(dom.x1 - dom.x0, dom.y1 - dom.y0) * 0.01);
  const pontos = furos.map((f) => ({ f, x: f.x, y: f.y }));
  extras.forEach((e) => {
    const f = porId.get(e.id);
    if (f && !pontos.some((p) => Math.hypot(p.x - e.x, p.y - e.y) < dmin && !(p.f === f && Math.hypot(p.x - e.x, p.y - e.y) < 1e-6))) pontos.push({ f, x: e.x, y: e.y, extra: true });
  });

  const fTer = interpolador(pontos.map(({ f, x, y }) => ({ x, y, v: f.cota })));
  const cotas = furos.map((f) => f.cota);
  const terMin = Math.min(...cotas), terMax = Math.max(...cotas), terPad = Math.max((terMax - terMin) * 0.5, 2);
  const fEsp = unidades.map((u, k) => {
    const max = Math.max(...furos.map((f) => espessuras.get(f.id)[k]));
    return { f: interpolador(pontos.map(({ f, x, y }) => ({ x, y, v: espessuras.get(f.id)[k] }))), max: max * 1.25 };
  });
  const comNA = pontos.filter(({ f }) => f.na > 0);
  const fNA = comNA.length ? interpolador(comNA.map(({ f, x, y }) => ({ x, y, v: f.cota - f.na }))) : null;

  const pontual = (x, y) => {
    const t = Math.min(terMax + terPad, Math.max(terMin - terPad, fTer(x, y)));
    const c = [t];
    fEsp.forEach(({ f, max }) => c.push(c.at(-1) - Math.min(max, Math.max(0, f(x, y)))));
    const na = fNA ? Math.min(fNA(x, y), t) : null;
    return { contatos: c, na };
  };

  const W = dom.x1 - dom.x0, D = dom.y1 - dom.y0, passo = Math.max(W, D) / resolucao;
  const nx = Math.max(2, Math.round(W / passo)), ny = Math.max(2, Math.round(D / passo));
  const xs = Array.from({ length: nx + 1 }, (_, i) => dom.x0 + (W * i) / nx);
  const ys = Array.from({ length: ny + 1 }, (_, j) => dom.y0 + (D * j) / ny);
  const contatos = Array.from({ length: nU + 1 }, () => new Float64Array((nx + 1) * (ny + 1)));
  const na = fNA ? new Float64Array((nx + 1) * (ny + 1)) : null;
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
  return { dominio: dom, nx, ny, xs, ys, unidades, contatos, na, pontual, naMalha, furos, pontos };
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
