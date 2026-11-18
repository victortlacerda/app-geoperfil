import { describe, it, expect } from 'vitest';
import { carregarProjeto, migrarV1, serializar, v1ParaMetros } from '../src/model/migracao.js';
import { perfilDoCorte } from '../src/geo/corte.js';
import { buildZones } from '../src/geo/zonas.js';
import { projetoExemplo } from '../src/model/projeto.js';
import { v1Exemplo, perfilLegado } from './v1-fixture.js';

describe('migração v1 → v2', () => {
  const { projeto, avisos } = carregarProjeto(v1Exemplo());

  it('converte pixels para metros com Norte para cima', () => {
    expect(v1ParaMetros({ x: 80, y: 200 })).toEqual({ x: 40, y: 400 });
    const sp1 = projeto.furos.find((f) => f.nome === 'SP-01');
    expect([sp1.x, sp1.y]).toEqual([40, 400]);
  });

  it('preserva camadas, SPT, cota, NA e profundidade total', () => {
    const sp3 = projeto.furos.find((f) => f.nome === 'SP-03');
    expect(sp3.cota).toBe(845.2);
    expect(sp3.na).toBe(4.5);
    expect(sp3.profTotal).toBe(20);
    expect(sp3.camadas.map((c) => [c.de, c.ate, c.codigo, c.origem])).toEqual([[0, 3, 'SAG', 'ATR'], [3, 8, 'SAR', 'RES'], [8, 18, 'ARE', 'RES'], [18, 20, 'ARGS', 'RSA']]);
    expect(sp3.spt).toHaveLength(20);
    expect(sp3.spt.find((s) => s.prof === 16).n).toBe(50);
  });

  it('converte cortes: lado invertido junto com o eixo Y, faixa mantida', () => {
    const c = projeto.cortes[0];
    expect(c.nome).toBe("A–A'");
    expect(c.p1).toEqual([30, 425]);
    expect(c.lado).toBe(-(1));
    expect(c.faixa).toBe(100);
    expect(avisos[0]).toMatch(/versão 1/);
  });

  it('gera o mesmo perfil que a versão 1 para os 4 furos de exemplo', () => {
    const v1 = v1Exemplo();
    const legado = perfilLegado(v1, v1.cortes[0]);
    const novo = perfilDoCorte(projeto.cortes[0], projeto.furos);
    expect(novo.map((b) => b.name)).toEqual(legado.map((b) => b.name));
    expect(novo.map((b) => b.dist)).toEqual(legado.map((b) => b.dist));
    for (let i = 0; i < novo.length - 1; i++) {
      const zn = buildZones(novo[i], novo[i + 1]).map((z) => [z.cTop, z.cBot, z.lA?.solo.code, z.lB?.solo.code, z.sameP, z.sameS]);
      const zl = buildZones(legado[i], legado[i + 1]).map((z) => [z.cTop, z.cBot, z.lA?.solo.code, z.lB?.solo.code, z.sameP, z.sameS]);
      expect(zn).toEqual(zl);
    }
  });

  it('cortes sem faixa na v1 geram aviso', () => {
    const v1 = v1Exemplo();
    v1.cortes[0].usaBanda = false;
    const r = migrarV1(v1);
    expect(r.projeto.cortes[0].faixa).toBeNull();
    expect(r.avisos.join(' ')).toMatch(/dois lados/);
  });
});

describe('arquivo v2', () => {
  it('salvar e abrir de novo devolve o mesmo projeto', () => {
    const p = projetoExemplo();
    p.cortes.push({ id: 'c1', nome: "A–A'", p1: [0, 400], p2: [220, 400], lado: 1, faixa: 40 });
    const { projeto } = carregarProjeto(JSON.parse(serializar(p)));
    expect(projeto).toEqual(p);
  });

  it('rejeita arquivos desconhecidos', () => {
    expect(() => carregarProjeto({ version: 99 })).toThrow(/não suportada/);
    expect(() => carregarProjeto(null)).toThrow();
  });
});
