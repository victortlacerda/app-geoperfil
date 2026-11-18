import { describe, it, expect } from 'vitest';
import { sideOfLine, projectPoint, furosNoCorte, perfilDoCorte, proximoNomeCorte } from '../src/geo/corte.js';
import { niceStep, buildZones, layerAtCota, extensaoCotas } from '../src/geo/zonas.js';
import { novoFuro, projetoExemplo, resolverFuro } from '../src/model/projeto.js';

describe('geometria do corte', () => {
  it('sideOfLine indica o lado da reta', () => {
    expect(sideOfLine(0, 1, 0, 0, 10, 0)).toBe(1);
    expect(sideOfLine(0, -1, 0, 0, 10, 0)).toBe(-1);
    expect(sideOfLine(5, 0, 0, 0, 10, 0)).toBe(0);
  });

  it('projectPoint devolve distância perpendicular e parâmetro t', () => {
    const p = projectPoint(5, 3, 0, 0, 10, 0);
    expect(p.dist).toBeCloseTo(3);
    expect(p.t).toBeCloseTo(0.5);
    expect([p.px, p.py]).toEqual([5, 0]);
  });

  const furos = [
    novoFuro({ nome: 'acima', x: 50, y: 20 }),
    novoFuro({ nome: 'abaixo', x: 60, y: -25 }),
    novoFuro({ nome: 'longe', x: 50, y: 80 }),
    novoFuro({ nome: 'alem-da-ponta', x: 160, y: 0 }),
    novoFuro({ nome: 'ponta-tolerada', x: 120, y: 0 }),
  ];
  const corte = { p1: [0, 0], p2: [100, 0], lado: 1, faixa: 30, incluir: 'ambos' };

  it('por padrão só entram os furos do lado clicado', () => {
    const umLado = { p1: [0, 0], p2: [100, 0], lado: 1, faixa: 30 };
    expect(furosNoCorte(umLado, furos).map((f) => f.nome)).toEqual(['acima', 'ponta-tolerada']);
    expect(furosNoCorte({ ...umLado, lado: -1 }, furos).map((f) => f.nome)).toEqual(['abaixo', 'ponta-tolerada']);
  });

  it('um lado, sem limite de distância: todos os furos daquele lado', () => {
    expect(furosNoCorte({ p1: [0, 0], p2: [100, 0], lado: 1, faixa: null }, furos).map((f) => f.nome)).toEqual(['acima', 'longe', 'alem-da-ponta', 'ponta-tolerada']);
  });

  it('opção dois lados: faixa simétrica inclui furos dos dois lados da linha', () => {
    const nomes = furosNoCorte(corte, furos).map((f) => f.nome);
    expect(nomes).toContain('acima');
    expect(nomes).toContain('abaixo');
    expect(nomes).not.toContain('longe');
  });

  it('a faixa também limita a extensão além das pontas', () => {
    const nomes = furosNoCorte(corte, furos).map((f) => f.nome);
    expect(nomes).toContain('ponta-tolerada');
    expect(nomes).not.toContain('alem-da-ponta');
  });

  it('faixa null inclui todos os furos', () => {
    expect(furosNoCorte({ ...corte, faixa: null }, furos)).toHaveLength(furos.length);
  });

  it('perfilDoCorte ordena de A para A\' e mede a distância a partir do primeiro furo', () => {
    const bhs = perfilDoCorte(corte, furos);
    expect(bhs.map((b) => b.name)).toEqual(['acima', 'abaixo', 'ponta-tolerada']);
    expect(bhs.map((b) => b.dist)).toEqual([0, 10, 70]);
  });

  it('inverter A e A\' inverte a ordem', () => {
    const bhs = perfilDoCorte({ ...corte, p1: [100, 0], p2: [0, 0] }, furos);
    expect(bhs.map((b) => b.name)).toEqual(['ponta-tolerada', 'abaixo', 'acima']);
  });

  it('nomes de corte seguem A–A\', B–B\'', () => {
    expect(proximoNomeCorte([])).toBe("A–A'");
    expect(proximoNomeCorte([{ nome: "A–A'" }])).toBe("B–B'");
  });
});

describe('zonas do perfil', () => {
  it('niceStep arredonda para 1, 2, 5 × 10^n', () => {
    expect(niceStep(0.7)).toBe(0.5);
    expect(niceStep(1.2)).toBe(1);
    expect(niceStep(2.4)).toBe(2);
    expect(niceStep(37)).toBe(50);
    expect(niceStep(0)).toBe(1);
  });

  it('buildZones separa trechos por contato e compara materiais', () => {
    const [a, b] = projetoExemplo().furos.map(resolverFuro);
    const zonas = buildZones(a, b);
    expect(zonas[0].cTop).toBe(842.5);
    // topo de SP-01 (842,5) acima da boca de SP-02 (839,0): só lA existe
    expect(zonas[0].lA.solo.code).toBe('ARGS');
    expect(zonas[0].lB).toBeNull();
    // em toda zona com os dois furos, sameP só se o código é igual
    zonas.filter((z) => z.lA && z.lB).forEach((z) => expect(z.sameP).toBe(z.lA.solo.code === z.lB.solo.code));
  });

  it('layerAtCota acha a camada pela cota', () => {
    const a = resolverFuro(projetoExemplo().furos[0]);
    expect(layerAtCota(a, 842.5 - 3).solo.code).toBe('ARGA');
    expect(layerAtCota(a, 900)).toBeNull();
  });

  it('extensaoCotas tem folga acima e abaixo', () => {
    const bhs = projetoExemplo().furos.map(resolverFuro);
    const { minCota, maxCota } = extensaoCotas(bhs);
    expect(maxCota).toBeGreaterThan(845.2);
    expect(minCota).toBeLessThan(845.2 - 20);
  });
});
