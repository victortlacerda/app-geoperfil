import { describe, it, expect } from 'vitest';
import { escalaPadrao, escolherEscalas, gerarPerfilPDF } from '../src/io/perfilPDF.js';
import { projetoExemplo } from '../src/model/projeto.js';
import { perfilDoCorte } from '../src/geo/corte.js';
import { extensaoCotas } from '../src/geo/zonas.js';

describe('PDF do perfil', () => {
  it('escalas padrão', () => {
    expect(escalaPadrao(155, 370)).toBe(500);
    expect(escalaPadrao(1200, 370)).toBe(5000);
    const e = escolherEscalas(155, 25, 370, 200);
    expect(e).toEqual({ Eh: 500, Ev: 125, exagero: 4 });
    expect(escolherEscalas(10, 60, 370, 200).exagero).toBe(1); // nunca comprime a vertical
  });

  it('gera o A3 do corte de exemplo com carimbo', () => {
    const p = projetoExemplo();
    const corte = { id: 'c', nome: "A–A'", p1: [333030, 7394025], p2: [333210, 7394025], lado: -1, faixa: 100 };
    p.cortes.push(corte);
    const bhs = perfilDoCorte(corte, p.furos);
    const pdf = gerarPerfilPDF(p, { bhs, ext: extensaoCotas(bhs), corte }, { data: new Date(2026, 10, 18) });
    expect(pdf.getNumberOfPages()).toBe(1);
    const txt = new TextDecoder('latin1').decode(pdf.output('arraybuffer'));
    expect(txt).toContain('PERFIL GEOT');
    expect(txt).toMatch(/1:500/);
    expect(txt).toContain('SP-03');
  });

  it('recusa corte com menos de 2 furos', () => {
    expect(() => gerarPerfilPDF(projetoExemplo(), { bhs: [] })).toThrow(/2 furos/);
  });
});
