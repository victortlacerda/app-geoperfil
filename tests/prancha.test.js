import { describe, it, expect } from 'vitest';
import { montarPrancha, pranchaPadrao, quebrar, FORMATOS, NOTAS_PADRAO } from '../src/geo/prancha.js';
import { gerarPranchaDXF } from '../src/io/dxf.js';
import { gerarPranchaPDF } from '../src/io/perfilPDF.js';
import { perfilDoCorte } from '../src/geo/corte.js';
import { projetoExemplo, estiloPadrao } from '../src/model/projeto.js';

const p = projetoExemplo();
p.cortes.push({ id: 'a', nome: "A–A'", p1: [333030, 7394025], p2: [333210, 7394025], lado: -1, faixa: 100 });
p.cortes.push({ id: 'b', nome: 'SP-01/SP-03', p1: [333030, 7393900], p2: [333210, 7394100], lado: 1, faixa: 200, incluir: 'ambos' });
const estilo = estiloPadrao();
const perfis = p.cortes.map((corte) => ({ corte, bhs: perfilDoCorte(corte, p.furos) }));

describe('prancha', () => {
  it('valores padrão', () => {
    const c = pranchaPadrao();
    expect(c.formato).toBe('A1');
    expect(c.notas).toEqual(NOTAS_PADRAO);
    expect(c.revisoes[0].rev).toBe('00');
    expect(pranchaPadrao({ formato: 'B5', exagero: 3 })).toMatchObject({ formato: 'A1', exagero: 1 });
  });

  it('quebra as notas na largura', () => {
    const l = quebrar('uma frase bem comprida que precisa quebrar em mais de uma linha', 30, 2.3);
    expect(l.length).toBeGreaterThan(1);
    expect(l.join(' ')).toBe('uma frase bem comprida que precisa quebrar em mais de uma linha');
  });

  it('monta os cortes numa escala comum, com planta-chave, legenda, notas e carimbo', () => {
    p.projeto.prancha = { formato: 'A1', cliente: 'Cliente X', revisoes: [{ rev: '00', data: '01/12/2026', descricao: 'Emissão inicial', por: 'AB' }] };
    const pr = montarPrancha(p, perfis, { estilo, data: new Date(2026, 11, 1) });
    expect(pr.cabe).toBe(true);
    expect(pr.formato).toEqual(FORMATOS.A1);
    expect(pr.nPerfis).toBe(2);
    const textos = pr.itens.filter((i) => i.t === 'texto').map((i) => i.txt);
    expect(textos).toEqual(expect.arrayContaining(["PERFIL A–A'", 'PERFIL SP-01/SP-03', `ESC. 1:${pr.escala}`, 'PLANTA CHAVE', 'NOTAS', 'LEGENDA', 'Cliente X', 'Emissão inicial', '01/12/2026']));
    // tudo dentro da folha
    pr.itens.forEach((it) => (it.pts || [[it.x, it.y]]).forEach(([x, y]) => {
      expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(pr.formato[0]);
      expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(pr.formato[1]);
    }));
  });

  it('formato menor pede escala maior', () => {
    p.projeto.prancha = { formato: 'A1' };
    const a1 = montarPrancha(p, perfis, { estilo });
    p.projeto.prancha = { formato: 'A3' };
    const a3 = montarPrancha(p, perfis, { estilo });
    expect(a3.escala).toBeGreaterThan(a1.escala);
  });

  it('gera PDF e DXF', () => {
    p.projeto.prancha = { formato: 'A2' };
    const pr = montarPrancha(p, perfis, { estilo });
    const pdf = gerarPranchaPDF(pr);
    expect(pdf.getNumberOfPages()).toBe(1);
    const dxf = gerarPranchaDXF(pr, pr.materiais);
    expect(dxf).toContain('AC1021');
    expect(dxf).toContain('CARIMBO');
    expect((dxf.match(/\nINSERT\n/g) || []).length).toBeGreaterThan(3);
  });
});
