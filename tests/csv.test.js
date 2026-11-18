import { describe, it, expect } from 'vitest';
import { lerCSV, detectarSeparador, interpretarTabela, aplicarImportacao, normalizarCabecalho, MODELO_CSV, MODELO_XLSX } from '../src/io/csv.js';
import { novoProjeto, novoFuro, sptPorMetro, camadasDoFuro } from '../src/model/projeto.js';

describe('leitura de CSV', () => {
  it('detecta o separador', () => {
    expect(detectarSeparador('a;b;c\n1;2;3')).toBe(';');
    expect(detectarSeparador('a,b,c')).toBe(',');
    expect(detectarSeparador('a\tb')).toBe('\t');
  });

  it('aceita aspas, CRLF e linhas vazias', () => {
    expect(lerCSV('furo;obs\r\n"SP-01";"texto; com ""aspas"""\r\n\r\n', 'auto')).toEqual([['furo', 'obs'], ['SP-01', 'texto; com "aspas"']]);
  });

  it('normaliza cabeçalhos com acento e espaços', () => {
    expect(normalizarCabecalho('Até (m)')).toBe('ate_m');
    expect(normalizarCabecalho('Nível d\'água')).toBe('nivel_d_agua');
  });
});

describe('interpretação de tabelas', () => {
  it('lê pelo cabeçalho, em qualquer ordem e com nomes alternativos', () => {
    const { registros } = interpretarTabela([['Sondagem', 'Topo', 'Base', 'Solo', 'Leste', 'Norte'], ['SP-9', '0', '2,5', 'ARE', '100', '200']]);
    expect(registros).toEqual([{ furo: 'SP-9', de: '0', ate: '2,5', primario: 'ARE', x: '100', y: '200' }]);
  });

  it('sem a coluna "furo" não importa nada', () => {
    expect(interpretarTabela([['SP-01', '0', '2', 'ARGS', 'ATR', '3']]).registros).toEqual([]);
  });
});

describe('aplicação da importação', () => {
  it('cria furos com coordenadas, camadas e SPT por profundidade', () => {
    const p = novoProjeto();
    const { registros } = interpretarTabela(lerCSV(MODELO_CSV));
    const r = aplicarImportacao(p, registros);
    expect(r.furosNovos).toBe(2);
    const sp1 = p.furos.find((f) => f.nome === 'SP-01');
    expect([sp1.x, sp1.y, sp1.cota, sp1.na]).toEqual([333120.45, 7394210.8, 842.5, 3.2]);
    expect(camadasDoFuro(sp1).map((c) => [c.de, c.ate, c.codigo, c.origem])).toEqual([[0, 2, 'ARGS', 'ATR'], [2, 6, 'ARGA', 'RES'], [6, 9, 'AREA', 'RES']]);
    expect(sptPorMetro(sp1)).toEqual({ 1: 3, 2: 4, 3: 5, 4: 6 });
    expect(r.avisos).toEqual([]);
  });

  it('N-SPT sem profundidade é ignorado com aviso', () => {
    const p = novoProjeto();
    const r = aplicarImportacao(p, [{ furo: 'SP-01', x: '0', y: '0', de: '2', ate: '5.5', nspt: '5' }]);
    expect(sptPorMetro(p.furos[0])).toEqual({});
    expect(r.avisos.join(' ')).toMatch(/prof/);
  });

  it('atualiza furos existentes sem duplicar camadas', () => {
    const p = novoProjeto();
    p.furos.push(novoFuro({ nome: 'SP-01', x: 10, y: 20, camadas: [{ de: 0, ate: 2, codigo: 'ARE' }] }));
    const r = aplicarImportacao(p, [{ furo: 'SP-01', de: '0', ate: '2', primario: 'ARGS' }, { furo: 'SP-01', de: '2', ate: '4', primario: 'SAR' }]);
    expect(r.furosAtualizados).toBe(1);
    expect(camadasDoFuro(p.furos[0]).map((c) => c.codigo)).toEqual(['ARGS', 'SAR']);
    expect([p.furos[0].x, p.furos[0].y]).toEqual([10, 20]);
  });

  it('avisa sobre códigos desconhecidos, furos sem coordenadas e camadas inválidas', () => {
    const p = novoProjeto();
    const r = aplicarImportacao(p, [{ furo: 'X1', de: '0', ate: '1', primario: 'ZZZ' }, { furo: 'X1', de: '3', ate: '2' }]);
    expect(r.avisos.join(' ')).toMatch(/ZZZ/);
    expect(r.avisos.join(' ')).toMatch(/Sem coordenadas/);
    expect(r.avisos.join(' ')).toMatch(/linhas: 2/);
  });

  it('planilha com abas furos / camadas / spt', () => {
    const p = novoProjeto();
    const regs = Object.values(MODELO_XLSX).flatMap((linhas) => interpretarTabela(linhas.map((l) => l.map(String))).registros);
    aplicarImportacao(p, regs);
    const sp1 = p.furos.find((f) => f.nome === 'SP-01');
    expect(sp1.profTotal).toBe(15);
    expect(camadasDoFuro(sp1)).toHaveLength(2);
    expect(sptPorMetro(sp1)).toEqual({ 1: 3, 2: 4 });
  });
});
