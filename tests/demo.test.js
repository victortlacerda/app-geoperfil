import { describe, it, expect } from 'vitest';
import { projetoDemo } from '../src/model/demo.js';
import { perfilDoCorte } from '../src/geo/corte.js';
import { camadasDoFuro } from '../src/model/projeto.js';

describe('projeto de exemplo', () => {
  const p = projetoDemo();
  it('10 furos em UTM, 2 mistos com REC/RQD, matacões e paradas', () => {
    expect(p.furos).toHaveLength(10);
    expect(p.projeto.crs).toBe('utm');
    expect(p.furos.filter((f) => f.mista).map((f) => f.nome).sort()).toEqual(['SM-01', 'SM-02']);
    expect(p.furos.find((f) => f.nome === 'SM-01').metros.filter((m) => m.rqd).length).toBe(7);
    expect(p.furos.filter((f) => camadasDoFuro(f).some((c) => c.origem === 'PED')).map((f) => f.nome).sort()).toEqual(['SM-02', 'SP-03', 'SP-06', 'SP-07']);
    expect(p.furos.find((f) => f.nome === 'SP-07').na).toBe(0);
    expect(p.furos.find((f) => f.nome === 'SM-02').parada).toBe('projeto');
  });
  it('cortes prontos com furos', () => {
    expect(p.cortes.map((c) => perfilDoCorte(c, p.furos).length)).toEqual([4, 3]);
  });
});
