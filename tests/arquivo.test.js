import { describe, it, expect } from 'vitest';
import { carregarProjeto, serializar } from '../src/model/arquivo.js';
import { projetoExemplo } from '../src/model/projeto.js';
import { perfilDoCorte } from '../src/geo/corte.js';
import { buildZones } from '../src/geo/zonas.js';

describe('arquivo de projeto', () => {
  it('salvar e abrir de novo devolve o mesmo projeto', () => {
    const p = projetoExemplo();
    p.cortes.push({ id: 'c1', nome: "A–A'", p1: [0, 400], p2: [220, 400], lado: 1, faixa: 40 });
    expect(carregarProjeto(JSON.parse(serializar(p)))).toEqual(p);
  });

  it('completa campos ausentes com valores padrão', () => {
    const p = carregarProjeto({ version: 2, furos: [{ nome: 'SP-01', camadas: [{ de: 0, ate: 1, codigo: 'XYZ' }] }], cortes: [{ p1: [0, 0], p2: [10, 0] }] });
    expect(p.furos[0].camadas[0].codigo).toBe('AREA');
    expect(p.cortes[0]).toMatchObject({ lado: 1, faixa: null });
  });

  it('rejeita arquivos de outra versão ou inválidos', () => {
    expect(() => carregarProjeto({ version: 1, bhData: [] })).toThrow(/não suportada/);
    expect(() => carregarProjeto(null)).toThrow();
  });
});

describe('perfil do projeto de exemplo (regressão)', () => {
  const p = projetoExemplo();
  const corte = { id: 'c', nome: "A–A'", p1: [30, 425], p2: [210, 425], lado: -1, faixa: 100 };
  const bhs = perfilDoCorte(corte, p.furos);

  it('ordem e distâncias ao longo do corte', () => {
    expect(bhs.map((b) => [b.name, b.dist])).toEqual([['SP-01', 0], ['SP-04', 65], ['SP-02', 75], ['SP-03', 155]]);
  });

  it('zonas entre SP-02 e SP-03', () => {
    const z = buildZones(bhs[2], bhs[3]).map((q) => [q.cTop, q.cBot, q.lA?.solo.code ?? null, q.lB?.solo.code ?? null]);
    expect(z).toEqual([
      [845.2, 842.2, null, 'SAG'],
      [842.2, 839, null, 'SAR'],
      [839, 837.5, 'ARGS', 'SAR'],
      [837.5, 837.2, 'ARGA', 'SAR'],
      [837.2, 833, 'ARGA', 'ARE'],
      [833, 827.2, 'ARS', 'ARE'],
      [827.2, 827, 'ARS', 'ARGS'],
      [827, 825.2, null, 'ARGS'],
    ]);
  });
});
