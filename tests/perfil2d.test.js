import { describe, it, expect } from 'vitest';
import { correlacionar, sequenciaDoVao, geometriaPerfil, camadasContinuas } from '../src/geo/perfil2d.js';
import { solo } from '../src/model/catalogo.js';

const furo = (id, dist, cota, camadas, na = 0) => ({
  id, name: id, dist, cota, na,
  layers: camadas.map(([de, ate, code, sec = '']) => ({ de, ate, solo: solo(code), sec })),
});
const area = (pts) => Math.abs(pts.reduce((s, [x1, y1], i) => { const [x2, y2] = pts[(i + 1) % pts.length]; return s + x1 * y2 - x2 * y1; }, 0)) / 2;
const cotaEm = (pts, d) => pts.filter(([x]) => Math.abs(x - d) < 1e-9).map(([, y]) => y);

describe('correlação de camadas', () => {
  it('casa a maior sequência comum, na ordem', () => {
    const A = furo('A', 0, 100, [[0, 2, 'ARGS', 'ATR'], [2, 5, 'ARGA'], [5, 9, 'SAR'], [9, 12, 'ARE']]);
    const B = furo('B', 50, 98, [[0, 1, 'ARGS', 'ATR'], [1, 6, 'SAR'], [6, 10, 'ARE']]);
    expect(correlacionar(A, B)).toEqual([[0, 0], [2, 1], [3, 2]]);
  });

  it('no empate, prefere a correlação com cotas mais próximas', () => {
    // B tem uma camada de ARE só; em A há ARE no topo e no fundo: casa com a de cota mais próxima
    const A = furo('A', 0, 100, [[0, 2, 'ARE'], [2, 10, 'SAR'], [10, 12, 'ARE']]);
    const B = furo('B', 50, 100, [[0, 9, 'SAG'], [9, 13, 'ARE']]);
    expect(correlacionar(A, B)).toEqual([[2, 1]]);
  });

  it('lacunas sem classificação viram uma camada vazia', () => {
    const A = furo('A', 0, 100, [[3, 6, 'SAR']]);
    expect(camadasContinuas(A).map((l) => (l.solo ? l.solo.code : '∅'))).toEqual(['∅', 'SAR']);
  });
});

describe('geometria interpolada', () => {
  const A = furo('A', 0, 100, [[0, 2, 'ARGS', 'ATR'], [2, 5, 'ARGA'], [5, 9, 'SAR'], [9, 12, 'ARE']], 3);
  const B = furo('B', 40, 96, [[0, 1, 'ARGS', 'ATR'], [1, 6, 'SAR'], [6, 10, 'ARE']], 2);
  const g = geometriaPerfil([A, B]);
  const poli = (code) => g.poligonos.find((p) => p.solo.code === code);

  it('contatos de camadas casadas ligam em linha reta (sem degrau)', () => {
    const sar = poli('SAR');
    // topo do SAR: 95 em A e em B; base: 91 em A, 90 em B. No meio, a ARGA (3 m em A) some:
    // o que ela ocupava na interpolação linear (1,5 m) vai metade para ARGS e metade para SAR.
    expect(Math.max(...cotaEm(sar.pts, 0))).toBeCloseTo(95);
    expect(Math.min(...cotaEm(sar.pts, 0))).toBeCloseTo(91);
    expect(Math.max(...cotaEm(sar.pts, 40))).toBeCloseTo(95);
    expect(Math.min(...cotaEm(sar.pts, 40))).toBeCloseTo(90);
    expect(cotaEm(sar.pts, 20).map((c) => +c.toFixed(6)).sort()).toEqual([90.5, 95.75]);
    expect(Math.min(...cotaEm(poli('ARE').pts, 20))).toBeCloseTo(87); // fundo reto: (88 + 86) / 2
  });

  it('camada sem par acunha no meio do vão', () => {
    const arga = poli('ARGA');
    expect(Math.max(...arga.pts.map(([d]) => d))).toBeCloseTo(20);
    const ponta = cotaEm(arga.pts, 20);
    expect(Math.max(...ponta) - Math.min(...ponta)).toBeCloseTo(0);
    expect(g.pontas.map((p) => p.codigo)).toEqual(['ARGA']);
  });

  it('o fundo do perfil liga os fundos dos furos, e as áreas batem com as espessuras', () => {
    const base = g.poligonos.flatMap((p) => p.pts).filter(([d]) => d === 40);
    expect(Math.min(...base.map(([, c]) => c))).toBeCloseTo(86);
    // área total = trapézio entre terreno e fundo
    const total = g.poligonos.reduce((s, p) => s + area(p.pts), 0);
    expect(total).toBeCloseTo(((12 + 10) / 2) * 40, 6);
  });

  it('ajuste manual move a ponta do acunhamento', () => {
    const [p] = g.pontas;
    const g2 = geometriaPerfil([A, B], { ajustes: { [p.chave]: 0.8 } });
    expect(Math.max(...g2.poligonos.find((q) => q.solo.code === 'ARGA').pts.map(([d]) => d))).toBeCloseTo(32);
    const total = g2.poligonos.reduce((s, q) => s + area(q.pts), 0);
    expect(total).toBeCloseTo(((12 + 10) / 2) * 40, 6); // terreno e fundo continuam retos
  });

  it('camada só no fundo do furo mais profundo afina até o outro furo', () => {
    const P = furo('P', 0, 100, [[0, 4, 'SAR'], [4, 10, 'ARE']]);
    const Q = furo('Q', 30, 100, [[0, 5, 'SAR']]);
    const seq = sequenciaDoVao(P, Q);
    expect(seq.at(-1)).toMatchObject({ tipo: 'A', ponta: 1 });
    const are = geometriaPerfil([P, Q]).poligonos.find((x) => x.solo.code === 'ARE');
    expect(Math.max(...are.pts.map(([d]) => d))).toBeCloseTo(30);
  });

  it('sem camada em comum: transição lateral no meio do vão, com uma alça', () => {
    const P = furo('P', 0, 100, [[0, 5, 'ARE']]);
    const Q = furo('Q', 20, 100, [[0, 5, 'ARGS']]);
    const gq = geometriaPerfil([P, Q]);
    expect(gq.pontas.map((p) => p.tipo)).toEqual(['T']);
    expect(Math.max(...gq.poligonos.find((p) => p.solo.code === 'ARE').pts.map(([d]) => d))).toBeCloseTo(10);
    expect(Math.min(...gq.poligonos.find((p) => p.solo.code === 'ARGS').pts.map(([d]) => d))).toBeCloseTo(10);
    expect(gq.poligonos.reduce((s, p) => s + area(p.pts), 0)).toBeCloseTo(100, 6);
    const g2 = geometriaPerfil([P, Q], { ajustes: { [gq.pontas[0].chave]: 0.3 } });
    expect(Math.max(...g2.poligonos.find((p) => p.solo.code === 'ARE').pts.map(([d]) => d))).toBeCloseTo(6);
  });

  it('camadas sem par dos dois lados no fundo: transição lateral, fundo reto', () => {
    const P = furo('P', 0, 100, [[0, 2, 'ARGS', 'ATR'], [2, 6, 'SAR'], [6, 9, 'ARE']]);
    const Q = furo('Q', 30, 98, [[0, 2, 'ARGS', 'ATR'], [2, 10, 'SAG']]);
    const gq = geometriaPerfil([P, Q]);
    const total = gq.poligonos.reduce((s, p) => s + area(p.pts), 0);
    expect(total).toBeCloseTo(((9 + 10) / 2) * 30, 6);
    expect(Math.max(...gq.poligonos.find((p) => p.solo.code === 'SAR').pts.map(([d]) => d))).toBeCloseTo(15);
  });

  it('modo degrau mantém a troca no meio do vão', () => {
    const gd = geometriaPerfil([A, B], { modo: 'degrau' });
    expect(gd.pontas).toEqual([]);
    expect(gd.poligonos.every((p) => p.pts.every(([d]) => [0, 20, 40].includes(d)))).toBe(true);
  });

  it('terreno e NA ligam os furos', () => {
    expect(g.terreno).toEqual([[0, 100], [40, 96]]);
    expect(g.na).toEqual([[0, 97], [40, 94]]);
  });
});
