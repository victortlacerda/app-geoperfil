import { describe, it, expect } from 'vitest';
import { camadasDesenho } from '../src/geo/horizontes.js';
import { solo } from '../src/model/catalogo.js';

const L = (de, ate, code, sec = '') => ({ de, ate, solo: solo(code), sec });

describe('camadas para o desenho', () => {
  const furo = [L(0, 2, 'ARGS', 'ATR'), L(2, 3, 'SAG', 'COL'), L(3, 4, 'ARP', 'PED'), L(4, 6, 'ARGA', 'COL'), L(6, 9, 'SAR', 'RES'), L(9, 12, 'ARS', 'RES'), L(12, 14, 'ARE', 'RSA')];

  it('blocos saem da sequência e o trecho vai para a camada de cima', () => {
    const { layers, blocos } = camadasDesenho(furo);
    expect(blocos).toEqual([expect.objectContaining({ de: 3, ate: 4, sec: 'PED' })]);
    expect(layers.find((l) => l.solo.code === 'SAG')).toMatchObject({ de: 2, ate: 4 });
    expect(layers.reduce((s, l) => s + l.ate - l.de, 0)).toBe(14); // sem buracos
  });

  it('bloco no topo vai para a camada de baixo', () => {
    const { layers } = camadasDesenho([L(0, 1, 'ARP', 'PED'), L(1, 5, 'ARGS', 'RES')]);
    expect(layers).toEqual([expect.objectContaining({ de: 0, ate: 5 })]);
  });

  it('por horizonte: cor do horizonte e camadas seguidas do mesmo horizonte juntas', () => {
    const { layers } = camadasDesenho(furo, { porHorizonte: true });
    expect(layers.map((l) => `${l.solo.code} ${l.de}-${l.ate}`)).toEqual(['H:ATR 0-2', 'H:COL 2-6', 'H:RES 6-12', 'H:RSA 12-14']);
    expect(layers[1].solo.fill).toBe('#E8231B');
    expect(layers[1].solo.label).toBe('Colúvio / tálus');
  });

  it('sem origem continua pela textura', () => {
    const { layers } = camadasDesenho([L(0, 2, 'ARGS'), L(2, 4, 'SAR', 'RES')], { porHorizonte: true });
    expect(layers.map((l) => l.solo.code)).toEqual(['ARGS', 'H:RES']);
  });
});
