import { describe, it, expect, vi } from 'vitest';
import { criarStore, lerAutosave } from '../src/store.js';
import { projetoExemplo } from '../src/model/projeto.js';
import { gerarDXF, seqendUnico } from '../src/io/dxf.js';
import { camadaMaterial } from '../src/geo/desenho.js';
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

/** Lê o DXF em objetos { tipo, g: Map(código → [valores]) }. */
function lerDXF(txt) {
  const ls = txt.split('\n'), out = [];
  for (let i = 0; i + 1 < ls.length; i += 2) {
    const c = +ls[i].trim(), v = ls[i + 1];
    if (c === 0) out.push({ tipo: v, g: new Map() });
    else if (out.length) { const g = out.at(-1).g; if (!g.has(c)) g.set(c, []); g.get(c).push(v); }
  }
  return out;
}

describe('DXF', () => {
  const p = projetoExemplo();
  const corte = { id: 'c', nome: "A–A'", p1: [333030, 7394025], p2: [333210, 7394025], lado: -1, faixa: 100 };
  p.cortes.push(corte);
  const bhs = perfilDoCorte(corte, p.furos);
  const dxf = gerarDXF(p, { bhs, corte });
  const ents = lerDXF(dxf);
  const val = (e, c) => e.g.get(c)?.[0];

  it('é um DXF 2007 completo, com acentos', () => {
    expect(dxf).toContain('$ACADVER');
    expect(dxf).toContain('AC1021');
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
    expect(dxf).toContain('PLANTA DE LOCAÇÃO');
  });

  it('contém planta e perfil', () => {
    expect(dxf).toContain("PERFIL A–A'");
    expect(ents.filter((e) => e.tipo === 'CIRCLE' && val(e, 8) === 'PLANTA-FUROS')).toHaveLength(4);
  });

  it('todas as camadas usadas estão declaradas na tabela LAYER', () => {
    const declaradas = new Set(ents.filter((e) => e.tipo === 'LAYER').map((e) => val(e, 2)));
    const usadas = new Set(ents.filter((e) => ['LINE', 'CIRCLE', 'TEXT', 'LWPOLYLINE', 'HATCH', 'INSERT', 'ATTRIB', 'ATTDEF'].includes(e.tipo)).map((e) => val(e, 8)));
    usadas.forEach((l) => expect(declaradas.has(l), l).toBe(true));
  });

  it('um layer por material, com hatch sólido', () => {
    const hatches = ents.filter((e) => e.tipo === 'HATCH');
    expect(hatches.length).toBeGreaterThan(4);
    expect(hatches.every((h) => val(h, 2) === 'SOLID')).toBe(true);
    const geo = geometriaPerfil(bhs, {});
    const mats = new Set(geo.poligonos.map((q) => camadaMaterial(q.solo, q.sec)));
    const camadasHatch = new Set(hatches.map((h) => val(h, 8)));
    mats.forEach((m) => expect(camadasHatch.has(m), m).toBe(true));
  });

  it('cada furo é um bloco com atributos (nome e N-SPT)', () => {
    const ins = ents.filter((e) => e.tipo === 'INSERT');
    expect(ins.map((e) => val(e, 2)).sort()).toEqual(bhs.map((b) => b.name).sort());
    const attribs = ents.filter((e) => e.tipo === 'ATTRIB');
    expect(attribs.some((a) => val(a, 2) === 'NOME' && val(a, 1) === bhs[0].name)).toBe(true);
    expect(attribs.some((a) => /^NSPT_\d\d$/.test(val(a, 2)))).toBe(true);
    expect(ents.filter((e) => e.tipo === 'ATTDEF').length).toBe(attribs.length);
    // um SEQEND por INSERT com atributos
    expect(ents.filter((e) => e.tipo === 'SEQEND').length).toBe(ins.length);
  });

  it('usa as escalas do PDF e textos no estilo ROMANS dimensionados para plotar em 1:Eh', () => {
    const geo = geometriaPerfil(bhs, {});
    const { Eh, Ev } = escalasPerfil(geo, bhs);
    expect(dxf).toContain(`ESC. H 1:${Eh} · V 1:${Ev}`);
    expect(dxf).toContain('romans.shx');
    const nome = ents.find((e) => e.tipo === 'ATTRIB' && val(e, 2) === 'NOME');
    expect(Math.abs(+val(nome, 40) - (3.2 * 0.72 * Eh) / 1000)).toBeLessThan(1e-6);
    expect(val(nome, 7)).toBe('ROMANS');
    expect(dxf).toContain('TRACEJADA');
  });

  it('sem corte gera só a planta', () => {
    const so = gerarDXF(p, { bhs: [] });
    expect(so).toContain('PLANTA');
    expect(so).not.toContain('PERFIL A');
  });

  it('SEQEND único depois dos atributos', () => {
    const t = ['0', 'INSERT', '0', 'ATTRIB', '0', 'SEQEND', '0', 'ATTRIB', '0', 'SEQEND', '0', 'LINE', '0', 'EOF'].join('\n');
    expect(seqendUnico(t)).toBe(['0', 'INSERT', '0', 'ATTRIB', '0', 'ATTRIB', '0', 'SEQEND', '0', 'LINE', '0', 'EOF'].join('\n'));
  });
});
