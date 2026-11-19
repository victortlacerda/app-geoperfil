import { describe, it, expect } from 'vitest';
import { triangulacao, cerca, secaoDoCorte, superficie, valores } from '../src/geo/modelo3d.js';
import { projetoExemplo, novoFuro } from '../src/model/projeto.js';
import { perfilDoCorte } from '../src/geo/corte.js';
import { geometriaPerfil } from '../src/geo/perfil2d.js';

describe('modelo 3D', () => {
  const p = projetoExemplo();

  it('triangulação de Delaunay dos 4 furos do exemplo', () => {
    const t = triangulacao(p.furos);
    expect(t.triangulos.length).toBe(2);
    expect(t.arestas.length).toBe(5);
  });

  it('2 furos ou furos alinhados: arestas em sequência, sem triângulos', () => {
    const al = [0, 30, 10, 20].map((x, i) => novoFuro({ nome: 'F' + i, x, y: 0 }));
    expect(triangulacao(al)).toEqual({ triangulos: [], arestas: [[0, 2], [2, 3], [3, 1]] });
    expect(triangulacao(al.slice(0, 2)).arestas).toEqual([[0, 1]]);
  });

  it('cerca entre dois furos: painel vertical na linha que os une', () => {
    const [a, b] = p.furos;
    const c = cerca(a, b);
    expect(c.L).toBeCloseTo(Math.hypot(75, 7.5));
    c.poligonos.forEach((pol) => pol.pts3d.forEach(([x, y]) => {
      // todo ponto do painel está sobre o segmento a–b
      const cruz = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
      expect(Math.abs(cruz)).toBeLessThan(1e-6);
    }));
  });

  it('critério da fase: a seção 3D do corte é o próprio perfil 2D, no alinhamento do corte', () => {
    const corte = { id: 'c', nome: "A–A'", p1: [333030, 7394025], p2: [333210, 7394025], lado: -1, faixa: 100, ajustes: {} };
    const s = secaoDoCorte(corte, p.furos);
    const g2d = geometriaPerfil(perfilDoCorte(corte, p.furos), { ajustes: {} });
    expect(s.poligonos.length).toBe(g2d.poligonos.length);
    s.poligonos.forEach((pol, i) => pol.pts3d.forEach(([x, y, c], k) => {
      const [d2, c2] = g2d.poligonos[i].pts[k];
      expect(y).toBeCloseTo(7394025, 9); // sobre a linha do corte
      expect(x - s.origem[0]).toBeCloseTo(d2, 9); // mesma distância ao longo do corte
      expect(c).toBe(c2); // mesma cota
    }));
  });

  it('cerca respeita o sentido dos ajustes manuais', () => {
    const [a, b] = p.furos;
    const base = cerca(b, a);
    expect(base.ids).toEqual([b.id, a.id]);
    const aj = cerca(b, a, { ajustes: { [`${a.id}>${b.id}|T|x`]: 0.3 } });
    expect(aj.ids).toEqual([a.id, b.id]);
  });

  it('superfícies TIN: terreno e NA (furo sem NA fica de fora)', () => {
    const fs = p.furos.map((f, i) => (i === 3 ? { ...f, na: 0 } : f));
    const t = triangulacao(fs);
    expect(superficie(fs, t, valores.terreno).triangulos.length).toBe(2);
    expect(superficie(fs, t, valores.na).triangulos.length).toBe(t.triangulos.filter((tr) => !tr.includes(3)).length);
    expect(superficie(fs, t, valores.fundo).vertices[0][2]).toBe(842.5 - 15);
  });
});
