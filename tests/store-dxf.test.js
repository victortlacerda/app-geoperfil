import { describe, it, expect, vi } from 'vitest';
import { criarStore, lerAutosave } from '../src/store.js';
import { projetoExemplo } from '../src/model/projeto.js';
import { gerarDXF } from '../src/io/dxf.js';
import { perfilDoCorte } from '../src/geo/corte.js';
import { extensaoCotas } from '../src/geo/zonas.js';

const memoria = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

describe('store', () => {
  it('desfaz e refaz alterações', () => {
    const s = criarStore(projetoExemplo());
    s.commit((d) => { d.furos[0].cota = 1; });
    s.commit((d) => { d.furos[0].cota = 2; });
    expect(s.doc.furos[0].cota).toBe(2);
    s.desfazer(); expect(s.doc.furos[0].cota).toBe(1);
    s.desfazer(); expect(s.doc.furos[0].cota).toBe(842.5);
    expect(s.podeDesfazer).toBe(false);
    s.refazer(); expect(s.doc.furos[0].cota).toBe(1);
  });

  it('não altera versões anteriores do projeto (imutável por cópia)', () => {
    const s = criarStore(projetoExemplo());
    const antes = s.doc;
    s.commit((d) => { d.furos[0].camadas[0].codigo = 'ARE'; });
    expect(antes.furos[0].camadas[0].codigo).toBe('ARGS');
  });

  it('agrupa alterações seguidas com a mesma chave em um passo', () => {
    const s = criarStore(projetoExemplo());
    for (let i = 0; i < 5; i++) s.commit((d) => { d.furos[0].x += 1; }, { agrupar: 'mover' });
    s.desfazer();
    expect(s.doc.furos[0].x).toBe(40);
  });

  it('nova alteração apaga o refazer', () => {
    const s = criarStore(projetoExemplo());
    s.commit((d) => { d.furos.pop(); });
    s.desfazer();
    s.commit((d) => { d.furos[0].na = 9; });
    expect(s.podeRefazer).toBe(false);
  });

  it('salva automaticamente no storage', () => {
    vi.useFakeTimers();
    const st = memoria();
    const s = criarStore(projetoExemplo(), { storage: st });
    s.commit((d) => { d.projeto.nome = 'Obra X'; });
    expect(lerAutosave(st)).toBeNull();
    vi.advanceTimersByTime(500);
    expect(lerAutosave(st).projeto.nome).toBe('Obra X');
    vi.useRealTimers();
  });
});

describe('DXF', () => {
  const p = projetoExemplo();
  const corte = { id: 'c', nome: "A–A'", p1: [30, 425], p2: [210, 425], lado: -1, faixa: 100 };
  p.cortes.push(corte);
  const bhs = perfilDoCorte(corte, p.furos);
  const dxf = gerarDXF(p, { bhs, ext: extensaoCotas(bhs), maxDist: Math.max(...bhs.map((b) => b.dist)), corte });

  it('é um DXF R12 completo e só ASCII', () => {
    expect(dxf.startsWith('0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009')).toBe(true);
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
    expect(/^[\x09\x0A\x0D\x20-\x7E]*$/.test(dxf)).toBe(true);
  });

  it('contém planta e perfil', () => {
    expect(dxf).toContain('PLANTA DE LOCACAO');
    expect(dxf).toContain("PERFIL GEOLOGICO - CORTE A-A'");
    expect((dxf.match(/\nCIRCLE\n/g) || []).length).toBe(4);
  });

  it('todas as camadas usadas estão declaradas na tabela LAYER', () => {
    const declaradas = new Set([...dxf.matchAll(/0\nLAYER\n2\n([^\n]+)\n/g)].map((m) => m[1]));
    const usadas = new Set([...dxf.matchAll(/\n(?:LINE|CIRCLE|TEXT|POLYLINE|VERTEX|SEQEND)\n8\n([^\n]+)\n/g)].map((m) => m[1]));
    usadas.forEach((l) => expect(declaradas.has(l), l).toBe(true));
  });

  it('sem corte gera só a planta', () => {
    const so = gerarDXF(p, { bhs: [] });
    expect(so).toContain('PLANTA');
    expect(so).not.toContain('PERFIL');
  });
});
