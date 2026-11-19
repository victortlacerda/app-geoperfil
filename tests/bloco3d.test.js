import { describe, it, expect } from 'vitest';
import { interpolador, colunaEstratigrafica, modeloBloco, dominio, linhaNoDominio } from '../src/geo/bloco3d.js';
import { projetoExemplo, novoFuro, camadasDoFuro } from '../src/model/projeto.js';

const furo = (nome, x, y, cota, camadas, na = 0) =>
  novoFuro({ nome, x, y, cota, na, camadas: camadas.map(([de, ate, codigo, origem = '']) => ({ de, ate, codigo, origem })) });

describe('interpolador (placa fina)', () => {
  const pts = [{ x: 0, y: 0, v: 10 }, { x: 50, y: 0, v: 14 }, { x: 0, y: 40, v: 7 }, { x: 60, y: 50, v: 20 }, { x: 25, y: 20, v: 9 }];
  const f = interpolador(pts);
  it('passa exatamente pelos pontos', () => pts.forEach((p) => expect(f(p.x, p.y)).toBeCloseTo(p.v, 6)));
  it('reproduz um plano', () => {
    const g = interpolador([[0, 0], [10, 0], [0, 10], [10, 10], [4, 7]].map(([x, y]) => ({ x, y, v: 2 * x - y + 5 })));
    expect(g(3, 3)).toBeCloseTo(8, 6);
    expect(g(20, -5)).toBeCloseTo(50, 6);
  });
  it('1 ponto: constante; alinhados: linear na linha e constante fora das pontas', () => {
    expect(interpolador([{ x: 1, y: 1, v: 5 }])(100, -3)).toBe(5);
    const g = interpolador([{ x: 0, y: 0, v: 0 }, { x: 10, y: 10, v: 10 }, { x: 20, y: 20, v: 30 }]);
    expect(g(5, 5)).toBeCloseTo(5);
    expect(g(15, 15)).toBeCloseTo(20);
    expect(g(15, 5)).toBeCloseTo(10); // projeta na linha
    expect(g(-50, -50)).toBe(0);
  });
});

describe('coluna estratigráfica', () => {
  it('funde as sequências: cada furo é subsequência da coluna, ausência = espessura 0', () => {
    const a = furo('A', 0, 0, 100, [[0, 2, 'ARGS', 'ATR'], [2, 7, 'SAG', 'RES'], [7, 10, 'ARE', 'RES']]);
    const b = furo('B', 30, 0, 102, [[0, 3, 'ARGS', 'ATR'], [3, 6, 'ARGA'], [6, 12, 'SAG', 'RES']]);
    const { unidades, espessuras } = colunaEstratigrafica([a, b]);
    expect(unidades.map((u) => u.chave)).toEqual(['ARGS|ATR', 'ARGA|', 'SAG|RES', 'ARE|RES']);
    expect(espessuras.get(a.id)).toEqual([2, 0, 5, 3]);
    expect(espessuras.get(b.id)).toEqual([3, 3, 6, 0]);
  });
  it('ordem invertida entre furos vira unidades repetidas, sem perder nada', () => {
    const a = furo('A', 0, 0, 100, [[0, 4, 'ARGS'], [4, 8, 'SAG']]);
    const b = furo('B', 30, 0, 100, [[0, 4, 'SAG'], [4, 8, 'ARGS']]);
    const { unidades, espessuras } = colunaEstratigrafica([a, b]);
    expect(unidades.length).toBe(3);
    [a, b].forEach((f) => expect(espessuras.get(f.id).reduce((s, v) => s + v, 0)).toBe(8));
  });
});

describe('modelo em bloco', () => {
  const p = projetoExemplo();
  const m = modeloBloco(p.furos);

  it('domínio envolve os furos com margem', () => {
    p.furos.forEach((f) => {
      expect(f.x).toBeGreaterThan(m.dominio.x0); expect(f.x).toBeLessThan(m.dominio.x1);
      expect(f.y).toBeGreaterThan(m.dominio.y0); expect(f.y).toBeLessThan(m.dominio.y1);
    });
    const d = dominio([novoFuro({ x: 10, y: 10 })]);
    expect(d.x1 - d.x0).toBeGreaterThanOrEqual(30);
  });

  it('em cada furo, os contatos do modelo são os do boletim (o modelo honra as sondagens)', () => {
    p.furos.forEach((f) => {
      const { contatos, na } = m.pontual(f.x, f.y);
      expect(contatos[0]).toBeCloseTo(f.cota, 6);
      // as fronteiras não nulas do modelo, de cima para baixo, coincidem com as do furo
      const doModelo = contatos.filter((c, i) => i === 0 || contatos[i - 1] - c > 1e-6);
      const doFuro = [f.cota, ...camadasDoFuro(f).map((c) => f.cota - c.ate)];
      expect(doModelo.length).toBe(doFuro.length);
      doModelo.forEach((c, i) => expect(c).toBeCloseTo(doFuro[i], 4));
      if (f.na > 0) expect(na).toBeCloseTo(f.cota - f.na, 6);
    });
  });

  it('camadas empilhadas nunca se cruzam e o NA não passa do terreno', () => {
    const N = (m.nx + 1) * (m.ny + 1);
    for (let k = 0; k < N; k++) {
      for (let u = 1; u < m.contatos.length; u++) expect(m.contatos[u][k]).toBeLessThanOrEqual(m.contatos[u - 1][k] + 1e-9);
      expect(m.na[k]).toBeLessThanOrEqual(m.contatos[0][k] + 1e-9);
    }
  });

  it('sem furos com camadas não há modelo', () => {
    expect(modeloBloco([novoFuro({ nome: 'X' })])).toBe(null);
  });
});

describe('linha do corte no domínio', () => {
  const dom = { x0: 0, x1: 100, y0: 0, y1: 50 };
  it('prolonga até as bordas, no sentido p1 → p2', () => {
    expect(linhaNoDominio([20, 25], [30, 25], dom)).toEqual([[0, 25], [100, 25]]);
    expect(linhaNoDominio([30, 25], [20, 25], dom)).toEqual([[100, 25], [0, 25]]);
    const [a, b] = linhaNoDominio([0, 0], [10, 10], dom);
    expect(a).toEqual([0, 0]); expect(b).toEqual([50, 50]);
  });
  it('fora do retângulo: null', () => expect(linhaNoDominio([0, 80], [10, 80], dom)).toBe(null));
});
