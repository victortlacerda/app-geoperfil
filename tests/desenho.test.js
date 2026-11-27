import { describe, it, expect } from 'vitest';
import { textoSPT, formaBloco, marcasTopoRochoso, desenharPerfil, legendaPerfil } from '../src/geo/desenho.js';
import { geometriaPerfil } from '../src/geo/perfil2d.js';
import { perfilDoCorte } from '../src/geo/corte.js';
import { novoFuro } from '../src/model/projeto.js';

describe('peças do desenho', () => {
  it('N-SPT em golpes/30 cm', () => {
    expect(textoSPT(12, true)).toBe('12/30');
    expect(textoSPT('30/12', true)).toBe('30/12');
    expect(textoSPT(12, false)).toBe('12');
    expect(textoSPT('', true)).toBe('');
  });

  it('forma do bloco é sempre a mesma para a mesma semente', () => {
    expect(formaBloco(0, 0, 5, 3, 'SM-01')).toEqual(formaBloco(0, 0, 5, 3, 'SM-01'));
    expect(formaBloco(0, 0, 5, 3, 'SM-01').pts).toHaveLength(13);
  });

  it('marcas do topo rochoso ao longo da linha', () => {
    const m = marcasTopoRochoso([[0, 0], [100, 0]], 10, 2);
    expect(m.length).toBe(10);
  });
});

describe('desenharPerfil', () => {
  const metros = (lista) => lista.map(([m, codigo, origem, spt, rec]) => ({ m, ...(codigo ? { codigo, origem } : {}), spt: spt == null ? '' : String(spt), ...(rec != null ? { rec: String(rec) } : {}) }));
  const furos = [
    novoFuro({ id: 'a', nome: 'SM-01', x: 0, y: 0, cota: 50, profTotal: 6, mista: true,
      metros: metros([[1, 'ARGS', 'ATR', 5], [2, null, null, 7], [3, 'SAR', 'PED', 30], [4, 'SAR', 'RES', 12], [5, 'ARE', 'RSA', null, 60], [6, null, null, null, 80]]) }),
    novoFuro({ id: 'b', nome: 'SM-02', x: 20, y: 0, cota: 51, profTotal: 6,
      metros: metros([[1, 'ARGS', 'ATR', 6], [2, 'SAR', 'RES', 10], [3, null, null, 14], [4, null, null, 20], [5, 'ARE', 'RSA', null], [6, null, null, null]]) }),
  ];
  const corte = { id: 'c', nome: 'A', p1: [-1, 0], p2: [21, 0], lado: 1, faixa: 5 };
  const bhs = perfilDoCorte(corte, furos, { porHorizonte: true });
  const geo = geometriaPerfil(bhs, {});
  const { itens } = desenharPerfil({
    bhs, geo, corte, estilo: { cor: 'horizonte', spt30: true }, axis: 'cota', mm: 1,
    X: (d) => 20 + d * 5, Y: (c) => 20 + (52 - c) * 5, janela: { d0: -1, d1: 21, c0: 43, c1: 52 }, cTopo: 52,
    mostrar: { na: true, spt: true, rotulos: true, hachura: false },
    naProjeto: 48.5, referencias: [{ nome: 'Fundo de escavação', cota: 46 }],
  });
  const textos = itens.filter((i) => i.t === 'texto').map((i) => i.txt);

  it('pedregulho vira bloco fora da sequência', () => {
    expect(bhs[0].blocos).toHaveLength(1);
    expect(itens.some((i) => i.camada === 'BLOCOS')).toBe(true);
  });
  it('sondagem mista com N-SPT e REC', () => {
    expect(textos).toContain('5/30');
    expect(textos).toContain('60%');
    expect(itens.some((i) => i.atrib === 'REC_05')).toBe(true);
  });
  it('NA de projeto, referência e topo rochoso', () => {
    expect(textos).toContain('N.A.: 48,50');
    expect(textos.some((t) => /FUNDO DE ESCAVAÇÃO 46,00/.test(t))).toBe(true);
    expect(itens.some((i) => i.camada === 'TOPO-ROCHOSO')).toBe(true);
  });
  it('legenda por horizonte', () => {
    const leg = legendaPerfil(bhs, geo, { estilo: { cor: 'horizonte', spt30: true }, naProjeto: 48.5, referencias: [{ nome: 'x', cota: 46 }] });
    const nomes = leg.map((e) => e.texto);
    expect(nomes).toEqual(expect.arrayContaining(['Aterro', 'Solo residual', 'Rocha sã', 'Pedregulho / blocos', 'Topo rochoso', 'Nível d\'água de projeto']));
  });

  it('origem não informada: tracejado no furo, asterisco no rótulo e nota na legenda', () => {
    const fs = [
      novoFuro({ id: 'a', nome: 'SP-04', x: 0, y: 0, cota: 50, profTotal: 4, metros: metros([[1, 'ARGS', 'ATR', 3], [2, null, null, 4], [3, 'SAG', 'RES', 8], [4, null, null, 10]]) }),
      novoFuro({ id: 'b', nome: 'SP-06', x: 20, y: 0, cota: 51, profTotal: 4, metros: metros([[1, 'ARGS', '-', 2], [2, null, null, 3], [3, 'SAG', '-', 9], [4, null, null, 12]]) }),
    ];
    const c = { id: 'c', nome: 'B', p1: [-1, 0], p2: [21, 0], lado: 1, faixa: 5 };
    const b2 = perfilDoCorte(c, fs), g2 = geometriaPerfil(b2, {});
    const { itens: it2 } = desenharPerfil({ bhs: b2, geo: g2, corte: c, estilo: {}, axis: 'cota', mm: 1,
      X: (d) => 20 + d * 5, Y: (cc) => 20 + (52 - cc) * 10, janela: { d0: -1, d1: 21, c0: 46, c1: 52 }, cTopo: 52, mostrar: { rotulos: true } });
    expect(it2.filter((i) => i.camada === 'ORIGEM-NAO-INFORMADA')).toHaveLength(2);
    expect(it2.some((i) => i.t === 'texto' && i.txt === 'Solo residual*')).toBe(true);
    const leg = legendaPerfil(b2, g2, {});
    expect(leg.some((e) => /Sem origem no boletim \(SP-06\)/.test(e.texto))).toBe(true);
  });
});
