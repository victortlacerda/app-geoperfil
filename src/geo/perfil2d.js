// Geometria do perfil 2D: correlação de camadas entre furos vizinhos e
// contatos interpolados, com acunhamento das camadas que não têm par.
//
// Entre os furos A (t = 0) e B (t = 1), a coluna em cada posição t é empilhada
// a partir do terreno (interpolado em linha reta):
//  - camada casada (existe nos dois): espessura (1 − t)·hA + t·hB;
//  - camada só de A: hA·(1 − t / pontaA), some na ponta (padrão: meio do vão);
//  - camada só de B: hB·(t − pontaB) / (1 − pontaB) (padrão: meio do vão);
//  - camadas no fundo de um furo, abaixo da última camada casada, afinam até o
//    outro furo (ponta = 1 ou 0), de modo que o fundo do perfil liga os fundos dos furos;
//  - trecho com camadas sem par dos dois lados: transição lateral (as de A até a
//    transição, as de B depois dela, dividindo o espaço entre as camadas vizinhas).
// O espaço que uma cunha deixa de ocupar vai para as camadas casadas vizinhas, de modo
// que terreno e fundo continuam retos. Pontas e transições podem ser ajustadas à mão.
import { buildZones, cotasContato, extensaoCotas } from './zonas.js';

const chaveCamada = (l) => (l.solo ? `${l.solo.code}|${l.sec || ''}` : '∅');
const meio = (b, l) => b.cota - (l.de + l.ate) / 2;

/** Camadas do furo de cima para baixo, com as lacunas (sem classificação) explícitas. */
export function camadasContinuas(b) {
  const out = [];
  let prof = 0;
  [...b.layers].sort((x, y) => x.de - y.de).forEach((l) => {
    if (l.de > prof + 1e-9) out.push({ de: prof, ate: l.de, solo: null, sec: '' });
    out.push(l);
    prof = Math.max(prof, l.ate);
  });
  return out;
}

/**
 * Correlação entre as camadas de A e de B: pares [ia, ib] em ordem.
 * Maximiza o número de camadas casadas; no empate, a menor soma das diferenças de cota.
 */
export function correlacionar(A, B, La = camadasContinuas(A), Lb = camadasContinuas(B)) {
  const n = La.length, m = Lb.length;
  const melhor = (p, q) => (p.n !== q.n ? (p.n > q.n ? p : q) : p.c <= q.c ? p : q);
  const T = Array.from({ length: n + 1 }, () => Array(m + 1).fill(null));
  for (let i = 0; i <= n; i++) for (let j = 0; j <= m; j++) {
    if (!i || !j) { T[i][j] = { n: 0, c: 0, de: null }; continue; }
    let r = melhor({ n: T[i - 1][j].n, c: T[i - 1][j].c, de: [i - 1, j] }, { n: T[i][j - 1].n, c: T[i][j - 1].c, de: [i, j - 1] });
    if (chaveCamada(La[i - 1]) === chaveCamada(Lb[j - 1])) {
      const base = T[i - 1][j - 1];
      r = melhor({ n: base.n + 1, c: base.c + Math.abs(meio(A, La[i - 1]) - meio(B, Lb[j - 1])), de: [i - 1, j - 1], par: true }, r);
    }
    T[i][j] = r;
  }
  const pares = [];
  for (let i = n, j = m; i > 0 && j > 0;) {
    const r = T[i][j];
    if (r.par) pares.push([i - 1, j - 1]);
    [i, j] = r.de;
  }
  return pares.reverse();
}

export const chaveAjuste = (A, B, lado, idx, l) => `${A.id}>${B.id}|${lado}|${idx}|${chaveCamada(l)}`;

/** Sequência empilhada do vão A–B, com a ponta de cada camada sem par. */
export function sequenciaDoVao(A, B, ajustes = {}) {
  const La = camadasContinuas(A), Lb = camadasContinuas(B);
  const pares = correlacionar(A, B, La, Lb);
  const seq = [];
  let ia = 0, ib = 0;
  const soA = (i, fundo) => {
    const k = chaveAjuste(A, B, 'A', i, La[i]);
    seq.push({ tipo: 'A', l: La[i], h: La[i].ate - La[i].de, ponta: clamp(ajustes[k] ?? (fundo ? 1 : 0.5), 0.02, 1), padrao: fundo ? 1 : 0.5, chave: k });
  };
  const soB = (j, fundo) => {
    const k = chaveAjuste(A, B, 'B', j, Lb[j]);
    seq.push({ tipo: 'B', l: Lb[j], h: Lb[j].ate - Lb[j].de, ponta: clamp(ajustes[k] ?? (fundo ? 0 : 0.5), 0, 0.98), padrao: fundo ? 0 : 0.5, chave: k });
  };
  pares.forEach(([pa, pb]) => {
    while (ia < pa) soA(ia++, false);
    while (ib < pb) soB(ib++, false);
    seq.push({ tipo: 'M', l: La[pa], lb: Lb[pb], hA: La[pa].ate - La[pa].de, hB: Lb[pb].ate - Lb[pb].de });
    ia = pa + 1; ib = pb + 1;
  });
  while (ia < La.length) soA(ia++, true);
  while (ib < Lb.length) soB(ib++, true);
  // trechos com camadas sem par dos dois lados: transição lateral
  for (let i = 0; i < seq.length;) {
    if (seq[i].tipo === 'M') { i++; continue; }
    let j = i;
    while (j < seq.length && seq[j].tipo !== 'M') j++;
    const g = seq.slice(i, j);
    if (g.some((it) => it.tipo === 'A') && g.some((it) => it.tipo === 'B')) {
      const chave = `${A.id}>${B.id}|T|${g.map((it) => `${it.tipo}:${chaveCamada(it.l)}`).join(',')}`;
      const grupo = { chave, ponta: clamp(ajustes[chave] ?? 0.5, 0.05, 0.95), padrao: 0.5,
        somaA: g.filter((it) => it.tipo === 'A').reduce((sm, it) => sm + it.h, 0),
        somaB: g.filter((it) => it.tipo === 'B').reduce((sm, it) => sm + it.h, 0) };
      g.forEach((it) => { it.grupo = grupo; it.ponta = grupo.ponta; });
    }
    i = j;
  }
  return seq;
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const linear = (it, t) => (1 - t) * (it.tipo === 'B' ? 0 : it.hA ?? it.h) + t * (it.tipo === 'A' ? 0 : it.hB ?? it.h);

function propria(it, t, lado) {
  if (it.tipo === 'M') return linear(it, t);
  if (it.grupo) return 0; // calculada pelo grupo (transição lateral)
  if (it.tipo === 'A') return t >= it.ponta ? 0 : it.h * (1 - t / it.ponta);
  return t <= it.ponta ? 0 : it.h * ((t - it.ponta) / (1 - it.ponta));
}

const faixaT = (item) => (item.tipo === 'M' ? [0, 1] : item.tipo === 'A' ? [0, item.ponta] : [item.ponta, 1]);

/**
 * Espessuras de toda a sequência na posição t (lado '-' ou '+' = limite à esquerda
 * ou à direita, nas transições laterais). As cunhas que deixam espaço (em relação à
 * interpolação linear) passam esse espaço às camadas casadas vizinhas, metade para cada.
 */
function espessuras(seq, t, lado = '-') {
  const h = seq.map((it) => propria(it, t, lado));
  let i = 0;
  while (i < seq.length) {
    if (seq[i].tipo === 'M') { i++; continue; }
    let j = i;
    while (j < seq.length && seq[j].tipo !== 'M') j++;
    let espaco = 0;
    for (let k = i; k < j; k++) espaco += linear(seq[k], t);
    const grupo = seq[i].grupo;
    if (grupo) {
      // transição lateral: as camadas de um lado dividem todo o espaço do trecho
      const ladoA = t < grupo.ponta || (t === grupo.ponta && lado === '-');
      for (let k = i; k < j; k++) {
        const it = seq[k];
        if (it.tipo === 'A' && ladoA) h[k] = espaco * (it.h / grupo.somaA);
        if (it.tipo === 'B' && !ladoA) h[k] = espaco * (it.h / grupo.somaB);
      }
    } else {
      let falta = 0;
      for (let k = i; k < j; k++) falta += linear(seq[k], t) - h[k];
      const cima = i - 1 >= 0 ? i - 1 : null, baixo = j < seq.length ? j : null;
      if (cima !== null && baixo !== null) { h[cima] += falta / 2; h[baixo] += falta / 2; }
      else if (cima !== null) h[cima] += falta;
      else if (baixo !== null) h[baixo] += falta;
    }
    i = j;
  }
  return h;
}

/** Cotas de topo e base de cada camada da sequência na posição t. */
function empilhar(seq, cotaTopo, t, lado = '-') {
  let c = cotaTopo;
  return espessuras(seq, t, lado).map((h) => { const r = { topo: c, base: c - h }; c -= h; return r; });
}

/**
 * Geometria completa do perfil.
 * @param bhs furos do corte (perfilDoCorte), ordenados por distância
 * @param opcoes { ajustes, modo: 'interpolado' | 'degrau' }
 * @returns { poligonos, pontas, terreno, na, fundo, ext, totDist }
 *   poligonos: [{ solo, sec, pts: [[dist, cota]], rotulo: { d, c, h } }]
 *   pontas: [{ chave, d, c, padrao, ponta, vao }] — alças de acunhamento editáveis
 */
export function geometriaPerfil(bhs, { ajustes = {}, modo = 'interpolado' } = {}) {
  const poligonos = [], pontas = [];
  for (let i = 0; i < bhs.length - 1; i++) {
    const A = bhs[i], B = bhs[i + 1];
    if (!A.layers.length || !B.layers.length) continue;
    const dA = A.dist, dB = B.dist, D = (t) => dA + t * (dB - dA), topo = (t) => (1 - t) * A.cota + t * B.cota;
    if (modo === 'degrau') {
      const xm = (dA + dB) / 2;
      buildZones(A, B).forEach((z) => {
        const ret = (x0, x1, l) => poligonos.push({ solo: l.solo, sec: l.sec, pts: [[x0, z.cTop], [x1, z.cTop], [x1, z.cBot], [x0, z.cBot]], rotulo: { d: (x0 + x1) / 2, c: (z.cTop + z.cBot) / 2, h: z.cTop - z.cBot } });
        if (z.sameP && z.sameS) ret(dA, dB, z.lA);
        else { if (z.lA) ret(dA, xm, z.lA); if (z.lB) ret(xm, dB, z.lB); }
      });
      continue;
    }
    const seq = sequenciaDoVao(A, B, ajustes);
    const ts = [...new Set([0, 0.5, 1, ...seq.filter((s) => s.tipo !== 'M').map((s) => s.ponta)])].sort((a, b) => a - b);
    const pilha = (t, lado) => empilhar(seq, topo(t), t, lado);
    const cache = new Map(ts.flatMap((t) => [[`${t}-`, pilha(t, '-')], [`${t}+`, pilha(t, '+')]]));
    seq.forEach((it, k) => {
      const [t0, t1] = faixaT(it);
      const lado = it.tipo === 'B' ? '+' : '-';
      const tt = ts.filter((t) => t >= t0 - 1e-12 && t <= t1 + 1e-12);
      const cima = tt.map((t) => [D(t), cache.get(`${t}${lado}`)[k].topo]);
      const baixo = tt.map((t) => [D(t), cache.get(`${t}${lado}`)[k].base]).reverse();
      const tm = it.tipo === 'M' ? 0.5 : (t0 + t1) / 2;
      const em = pilha(tm, lado)[k];
      if (it.l.solo) poligonos.push({ solo: it.l.solo, sec: it.l.sec, pts: [...cima, ...baixo], rotulo: { d: D(tm), c: (em.topo + em.base) / 2, h: em.topo - em.base } });
      if (it.tipo !== 'M' && it.l.solo && !it.grupo) {
        const tp = it.ponta, c = cache.get(`${tp}${lado}`)[k].topo;
        pontas.push({ chave: it.chave, d: D(tp), c, ponta: tp, padrao: it.padrao, tipo: it.tipo, vao: [dA, dB], codigo: it.l.solo.code });
      }
    });
    // alça de cada transição lateral, no meio do trecho
    const grupos = [...new Set(seq.filter((it) => it.grupo).map((it) => it.grupo))];
    grupos.forEach((g) => {
      const ks = seq.map((it, k) => (it.grupo === g ? k : -1)).filter((k) => k >= 0);
      const p = cache.get(`${g.ponta}-`);
      const c = (p[ks[0]].topo + p[ks.at(-1)].base) / 2;
      pontas.push({ chave: g.chave, d: D(g.ponta), c, ponta: g.ponta, padrao: g.padrao, tipo: 'T', vao: [dA, dB], codigo: 'transição' });
    });
  }
  const terreno = bhs.map((b) => [b.dist, b.cota]);
  const na = bhs.filter((b) => b.na > 0).map((b) => [b.dist, b.cota - b.na]);
  const fundo = bhs.map((b) => [b.dist, b.cota - (b.layers.length ? Math.max(...b.layers.map((l) => l.ate)) : 0)]);
  const totDist = bhs.length ? Math.max(...bhs.map((b) => b.dist)) : 0;
  return { poligonos, pontas, terreno, na, fundo, ext: extensaoCotas(bhs), totDist };
}

/** Contatos de camada nos furos (para marcar profundidades). */
export const contatosDoFuro = (b) => cotasContato(b, b).filter((c) => c < b.cota);
