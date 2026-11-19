import { describe, it, expect } from 'vitest';
import { dentro, recortarSegmento, hachuraPoligono, furarHachura } from '../src/io/hachura.js';
import { solo } from '../src/model/catalogo.js';

const cunha = [[0, 0], [10, 0], [0, 4]]; // triângulo

describe('hachura em polígono', () => {
  it('ponto dentro / fora', () => {
    expect(dentro(1, 1, cunha)).toBe(true);
    expect(dentro(9, 3, cunha)).toBe(false);
  });

  it('recorta segmento ao polígono', () => {
    const [s] = recortarSegmento([-5, 1, 20, 1], cunha);
    expect(s[0]).toBeCloseTo(0); expect(s[2]).toBeCloseTo(7.5);
    expect(recortarSegmento([-5, 9, 20, 9], cunha)).toEqual([]);
  });

  it('polígono côncavo gera dois trechos', () => {
    const U = [[0, 0], [10, 0], [10, 10], [7, 10], [7, 3], [3, 3], [3, 10], [0, 10]];
    expect(recortarSegmento([-1, 5, 11, 5], U)).toHaveLength(2);
  });

  it('todas as linhas e pontos da hachura ficam dentro da cunha', () => {
    for (const code of ['ARGS', 'SAR', 'ARE', 'ARP']) {
      const { linhas, pontos } = hachuraPoligono(cunha, solo(code), 'RES', 0.5);
      expect(linhas.length + pontos.length).toBeGreaterThan(0);
      linhas.forEach(([a, b, c, d]) => expect(dentro((a + c) / 2, (b + d) / 2, cunha)).toBe(true));
      pontos.forEach(([x, y]) => expect(dentro(x, y, cunha)).toBe(true));
    }
  });

  it('polígono degenerado não gera nada', () => {
    expect(hachuraPoligono([[0, 0], [5, 0], [5, 0]], solo('ARGS'), '')).toEqual({ linhas: [], pontos: [] });
  });
});

describe('furarHachura', () => {
  it('abre o vão do retângulo nas linhas e tira os pontos de dentro', () => {
    const r = furarHachura({ linhas: [[0, 1, 10, 1], [0, 5, 10, 5]], pontos: [[5, 1], [1, 1]] }, [[4, 0, 6, 2]]);
    expect(r.linhas).toEqual([[0, 1, 4, 1], [6, 1, 10, 1], [0, 5, 10, 5]]);
    expect(r.pontos).toEqual([[1, 1]]);
  });
  it('linha inteira dentro some', () => {
    expect(furarHachura({ linhas: [[4.5, 1, 5.5, 1]], pontos: [] }, [[4, 0, 6, 2]]).linhas).toEqual([]);
  });
});
