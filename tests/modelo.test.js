import { describe, it, expect } from 'vitest';
import {
  novoFuro, setCampoMetro, camadasDoFuro, linhasEfetivas, numLinhas, nDoMetro, lerGolpe,
  aplicarCamadas, sptPorMetro, sptTextos, resolverFuro, projetoExemplo,
} from '../src/model/projeto.js';
import { resolverCodigo, resolverOrigem, solo, definirCoresProjeto } from '../src/model/catalogo.js';
import { aplicarCelula, colarBloco } from '../src/views/camadas.js';
import { gerarBoletimPDF } from '../src/io/boletim.js';

const camadas = (f) => camadasDoFuro(f).map((c) => [c.de, c.ate, c.codigo, c.origem]);

describe('boletim metro a metro: classificação', () => {
  it('metros vazios repetem a classificação de cima (AREA no 1 m e no 5 m = uma camada)', () => {
    const f = novoFuro({ profTotal: 8.45 });
    setCampoMetro(f, 1, 'codigo', 'AREA');
    setCampoMetro(f, 5, 'codigo', 'AREA');
    expect(camadas(f)).toEqual([[0, 8.45, 'AREA', '']]);
  });

  it('nova classificação abre nova camada', () => {
    const f = novoFuro({ profTotal: 8 });
    setCampoMetro(f, 1, 'codigo', 'AREA');
    setCampoMetro(f, 5, 'codigo', 'ARGS');
    expect(camadas(f)).toEqual([[0, 4, 'AREA', ''], [4, 8, 'ARGS', '']]);
  });

  it('sem classificação padrão: metros antes da primeira classificação ficam vazios', () => {
    const f = novoFuro({ profTotal: 6 });
    setCampoMetro(f, 3, 'codigo', 'SAR');
    expect(camadas(f)).toEqual([[2, 6, 'SAR', '']]);
    expect(linhasEfetivas(f).slice(0, 2).map((l) => l.codigo)).toEqual(['', '']);
  });

  it('secundária continua enquanto a primária é a mesma, recomeça quando muda e "-" encerra', () => {
    const f = novoFuro({ profTotal: 9 });
    setCampoMetro(f, 1, 'codigo', 'ARGS'); setCampoMetro(f, 1, 'origem', 'ATR');
    setCampoMetro(f, 3, 'codigo', 'ARGS'); // mesma primária: segue Aterro
    setCampoMetro(f, 5, 'codigo', 'SAR'); // mudou: secundária volta a vazia
    setCampoMetro(f, 7, 'origem', 'RES');
    setCampoMetro(f, 8, 'origem', '-');
    expect(camadas(f)).toEqual([[0, 4, 'ARGS', 'ATR'], [4, 6, 'SAR', ''], [6, 7, 'SAR', 'RES'], [7, 9, 'SAR', '']]);
  });

  it('sem prof. limite, a camada vai até o último metro preenchido', () => {
    const f = novoFuro();
    setCampoMetro(f, 1, 'codigo', 'AREA');
    setCampoMetro(f, 5, 'codigo', 'AREA');
    expect(camadas(f)).toEqual([[0, 5, 'AREA', '']]);
    expect(linhasEfetivas(f, { minimo: 10 }).slice(4, 7).map((l) => l.codigo)).toEqual(['AREA', '', '']);
    setCampoMetro(f, 8, 'spt', '12');
    expect(camadas(f)).toEqual([[0, 8, 'AREA', '']]);
  });

  it('descrição da camada é a primeira digitada dentro dela', () => {
    const f = novoFuro({ profTotal: 4 });
    setCampoMetro(f, 1, 'codigo', 'ARE');
    setCampoMetro(f, 2, 'desc', 'Areia fina, fofa');
    expect(camadasDoFuro(f)[0].descricao).toBe('Areia fina, fofa');
  });

  it('apagar todos os campos remove o metro da lista', () => {
    const f = novoFuro();
    setCampoMetro(f, 2, 'codigo', 'ARE');
    setCampoMetro(f, 2, 'codigo', '');
    expect(f.metros).toEqual([]);
  });

  it('número de linhas segue a profundidade limite (fração vira uma linha a mais)', () => {
    const f = novoFuro({ profTotal: 10.45 });
    expect(numLinhas(f)).toBe(11);
    expect(linhasEfetivas(f).at(-1)).toMatchObject({ m: 11, de: 10, ate: 10.45 });
    expect(numLinhas(novoFuro(), { minimo: 10 })).toBe(10);
  });

  it('camadas com profundidades quaisquer viram metros (pelo meio de cada metro) só nas mudanças', () => {
    const f = novoFuro({ profTotal: 6 });
    aplicarCamadas(f, [{ de: 0, ate: 2.4, codigo: 'ARGS', origem: 'ATR' }, { de: 2.4, ate: 6, codigo: 'ARE' }]);
    expect(f.metros.map((r) => [r.m, r.codigo, r.origem])).toEqual([[1, 'ARGS', 'ATR'], [3, 'ARE', '-']]);
    expect(camadas(f)).toEqual([[0, 2, 'ARGS', 'ATR'], [2, 6, 'ARE', '']]);
  });

  it('o que se digita é interpretado pelo código ou pelo nome', () => {
    expect(resolverCodigo('area')).toBe('AREA');
    expect(resolverCodigo('Areia arg')).toBe('AREA');
    expect(resolverCodigo('argila s')).toBe('ARGS');
    expect(resolverCodigo('areia')).toBeNull(); // ambíguo
    expect(resolverCodigo('xyz')).toBeNull();
    expect(resolverCodigo('')).toBe('');
    expect(resolverOrigem('aterro')).toBe('ATR');
    expect(resolverOrigem('Solo residual')).toBe('RES');
    expect(resolverOrigem('—')).toBe('-');
    expect(resolverOrigem('residual')).toBe('RES');
    expect(resolverOrigem('rocha')).toBeNull(); // ambíguo
    expect(resolverOrigem('qualquer')).toBeNull();
  });

  it('mesma classificação tem sempre a mesma cor, inclusive a cor trocada no projeto', () => {
    expect(solo('ARE').fill).toBe(solo('are').fill);
    definirCoresProjeto({ ARE: '#123456' });
    expect(solo('ARE').fill).toBe('#123456');
    definirCoresProjeto({});
  });
});

describe('N-SPT', () => {
  it('metro a metro: número ou penetração incompleta', () => {
    expect(nDoMetro({ spt: '12' })).toEqual({ texto: '12', valor: 12 });
    expect(nDoMetro({ spt: '30/12' })).toEqual({ texto: '30/12', valor: 50, parcial: true });
    expect(nDoMetro({ spt: 'abc' })).toBeNull();
    expect(lerGolpe('7 / 10')).toEqual({ g: 7, p: 10 });
  });

  it('golpes por 15 cm: N = 2º + 3º trechos', () => {
    expect(nDoMetro({ golpes: ['3', '4', '5'] })).toEqual({ texto: '9', valor: 9 });
    expect(nDoMetro({ golpes: ['30/10', '', ''] })).toMatchObject({ texto: '30/10', parcial: true });
    expect(nDoMetro({ golpes: ['12', '18', '30/5'] })).toMatchObject({ texto: '30/5', valor: 50 });
    expect(nDoMetro({ golpes: ['3', '4', ''] })).toBeNull();
  });

  it('mapas por metro para gráficos e rótulos', () => {
    const f = novoFuro();
    setCampoMetro(f, 1, 'spt', '4'); setCampoMetro(f, 2, 'g0', '2'); setCampoMetro(f, 2, 'g1', '3'); setCampoMetro(f, 2, 'g2', '3');
    setCampoMetro(f, 3, 'spt', '30/8');
    expect(sptPorMetro(f)).toEqual({ 1: 4, 2: 6, 3: 50 });
    expect(sptTextos(f)).toEqual({ 1: '4', 2: '6', 3: '30/8' });
  });

  it('impenetrável vem do critério de parada', () => {
    const p = projetoExemplo();
    expect(resolverFuro(p.furos[0]).imp).toBe(true);
    expect(resolverFuro(p.furos[1]).imp).toBe(false);
  });
});

describe('edição da grade', () => {
  it('células validam o que é digitado', () => {
    const f = novoFuro();
    expect(aplicarCelula(f, 1, 'codigo', 'areia s')).toBeNull();
    expect(f.metros[0].codigo).toBe('ARS');
    expect(aplicarCelula(f, 1, 'codigo', 'xx')).toMatch(/não é uma classificação/);
    expect(aplicarCelula(f, 1, 'spt', '1a')).toMatch(/SPT/);
    expect(aplicarCelula(f, 1, 'origem', 'aterro')).toBeNull();
    expect(f.metros[0].origem).toBe('ATR');
  });

  it('digitar N metro a metro apaga os golpes, e vice-versa', () => {
    const f = novoFuro();
    aplicarCelula(f, 1, 'g0', '2'); aplicarCelula(f, 1, 'g1', '2'); aplicarCelula(f, 1, 'g2', '3');
    expect(sptTextos(f)[1]).toBe('5');
    aplicarCelula(f, 1, 'spt', '7');
    expect(f.metros[0].golpes).toBeUndefined();
    expect(sptTextos(f)[1]).toBe('7');
  });

  it('colar do Excel preenche várias linhas e colunas a partir da célula', () => {
    const f = novoFuro({ profTotal: 4 });
    const r = colarBloco(f, 1, 'codigo', 'ARGS\tAterro\tArgila mole\t3\r\n\t\t\t4\nARE\tresidual\t\t9\nzz\t\t\t12\n', 'metro');
    expect(r.linhas).toBe(4);
    expect(r.erros).toHaveLength(1);
    expect(camadas(f)).toEqual([[0, 2, 'ARGS', 'ATR'], [2, 4, 'ARE', 'RES']]);
    expect(sptTextos(f)).toEqual({ 1: '3', 2: '4', 3: '9', 4: '12' });
  });
});

describe('boletim em PDF', () => {
  it('gera um PDF de uma página com os dados do furo', () => {
    const p = projetoExemplo();
    const pdf = gerarBoletimPDF(p, p.furos[0], { data: new Date(2026, 10, 18) });
    expect(pdf.getNumberOfPages()).toBe(1);
    const txt = new TextDecoder('latin1').decode(pdf.output('arraybuffer'));
    expect(txt.startsWith('%PDF')).toBe(true);
    expect(txt).toContain('SP-01');
    expect(txt).toContain('30/10');
  });

  it('modo golpes também gera', () => {
    const p = projetoExemplo();
    p.projeto.modoSPT = 'golpes';
    expect(() => gerarBoletimPDF(p, p.furos[1])).not.toThrow();
  });
});
