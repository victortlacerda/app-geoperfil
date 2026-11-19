import { describe, it, expect, vi } from 'vitest';
import { criarStore, lerAutosave } from '../src/store.js';
import { projetoExemplo } from '../src/model/projeto.js';
import { gerarDXF } from '../src/io/dxf.js';
import { escalasPerfil } from '../src/io/escalas.js';
import { geometriaPerfil } from '../src/geo/perfil2d.js';
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
    s.commit((d) => { d.furos[0].metros[0].codigo = 'ARE'; });
    expect(antes.furos[0].metros[0].codigo).toBe('ARGS');
  });

  it('agrupa alterações seguidas com a mesma chave em um passo', () => {
    const s = criarStore(projetoExemplo());
    for (let i = 0; i < 5; i++) s.commit((d) => { d.furos[0].x += 1; }, { agrupar: 'mover' });
    s.desfazer();
    expect(s.doc.furos[0].x).toBe(333040);
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
  const corte = { id: 'c', nome: "A–A'", p1: [333030, 7394025], p2: [333210, 7394025], lado: -1, faixa: 100 };
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
    expect((dxf.match(/\nCIRCLE\n8\nFUROS\n/g) || []).length).toBe(4);
  });

  it('todas as camadas usadas estão declaradas na tabela LAYER', () => {
    const declaradas = new Set([...dxf.matchAll(/0\nLAYER\n2\n([^\n]+)\n/g)].map((m) => m[1]));
    const usadas = new Set([...dxf.matchAll(/\n(?:LINE|CIRCLE|TEXT|POLYLINE|VERTEX|SEQEND|SOLID)\n8\n([^\n]+)\n/g)].map((m) => m[1]));
    usadas.forEach((l) => expect(declaradas.has(l), l).toBe(true));
  });

  it('usa as escalas do PDF e textos dimensionados para plotar em 1:Eh', () => {
    const geo = geometriaPerfil(bhs, {});
    const { Eh, Ev } = escalasPerfil(geo, bhs);
    expect(dxf).toContain(`Escala horizontal 1:${Eh} - vertical 1:${Ev}`);
    // o nome do furo tem 3 mm no papel
    const m = dxf.match(/\n40\n([\d.]+)\n1\nSP-01\n/g).map((t) => +t.split('\n')[2]);
    expect(m.some((h) => Math.abs(h - (3 * Eh) / 1000) < 1e-6)).toBe(true);
    expect(dxf).toContain('0\nSTYLE\n2\nGEOPERFIL');
    expect(dxf).toContain('0\nLTYPE\n2\nTRACEJADA');
  });

  it('nenhum texto de rótulo cai sobre a régua de SPT', () => {
    const geo = geometriaPerfil(bhs, {});
    const { Eh, Ev, cBase } = escalasPerfil(geo, bhs);
    const kv = Eh / Ev, u = Eh / 1000;
    const rot = [...dxf.matchAll(/0\nTEXT\n8\nROTULOS\n10\n([-\d.]+)\n20\n([-\d.]+)\n30\n0.0\n40\n([\d.]+)\n1\n([^\n]+)\n/g)]
      .map((m) => ({ x: +m[1], y: +m[2], h: +m[3], t: m[4] }));
    expect(rot.length).toBeGreaterThan(3);
    rot.forEach((r) => bhs.forEach((b) => {
      const prof = Math.max(...b.layers.map((l) => l.ate));
      const w = r.t.length * r.h * 0.66;
      const naFaixaY = r.y > (b.cota - prof - cBase) * kv && r.y < (b.cota - cBase) * kv;
      const naFaixaX = r.x + w / 2 > b.dist - 0.9 * u && r.x - w / 2 < b.dist + 0.9 * u;
      expect(naFaixaY && naFaixaX, `${r.t} sobre ${b.name}`).toBe(false);
    }));
  });

  it('sem corte gera só a planta', () => {
    const so = gerarDXF(p, { bhs: [] });
    expect(so).toContain('PLANTA');
    expect(so).not.toContain('PERFIL GEOLOGICO');
  });
});
