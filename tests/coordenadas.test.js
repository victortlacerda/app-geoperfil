import { describe, it, expect } from 'vitest';
import { utmParaGeo, geoParaUtm, fusoDe, epsgDoFuso, utmPlausivel } from '../src/geo/coordenadas.js';

// Valores de referência calculados com pyproj (EPSG:4674 → EPSG:319xx)
const REF = [
  { nome: 'Marco Zero de São Paulo', lat: -23.55052, lon: -46.63395, fuso: '23S', x: 333221.582, y: 7394585.348 },
  { nome: 'Cristo Redentor', lat: -22.95192, lon: -43.21047, fuso: '23S', x: 683479.559, y: 7460685.056 },
  { nome: 'Praça dos Três Poderes (fuso 23S)', lat: -15.80006, lon: -47.86086, fuso: '23S', x: 193500.342, y: 8251095.923 },
  { nome: 'Praça dos Três Poderes (fuso 22S)', lat: -15.80006, lon: -47.86086, fuso: '22S', x: 836337.786, y: 8250670.135 },
  { nome: 'Ponto no hemisfério norte (18N)', lat: 2.5, lon: -74.5, fuso: '18N', x: 555585.589, y: 276337.455 },
];

describe('conversão UTM SIRGAS 2000 ⇄ geográficas', () => {
  REF.forEach((r) => {
    it(`geo → UTM: ${r.nome}`, () => {
      const { x, y } = geoParaUtm(r.lat, r.lon, r.fuso);
      expect(x).toBeCloseTo(r.x, 2);
      expect(y).toBeCloseTo(r.y, 2);
    });
    it(`UTM → geo: ${r.nome}`, () => {
      const { lat, lon } = utmParaGeo(r.x, r.y, r.fuso);
      expect(lat).toBeCloseTo(r.lat, 7);
      expect(lon).toBeCloseTo(r.lon, 7);
    });
  });

  it('fuso natural pelo ponto', () => {
    expect(fusoDe(-23.55, -46.63)).toBe('23S');
    expect(fusoDe(-15.8, -47.86)).toBe('23S');
    expect(fusoDe(-3.1, -60.0)).toBe('21S');
    expect(fusoDe(2.8, -60.7)).toBe('20N');
  });

  it('códigos EPSG do SIRGAS 2000 / UTM', () => {
    expect(epsgDoFuso('23S')).toBe(31983);
    expect(epsgDoFuso('18S')).toBe(31978);
    expect(epsgDoFuso('25S')).toBe(31985);
    expect(epsgDoFuso('18N')).toBe(31972);
  });

  it('reconhece coordenadas locais que não são UTM', () => {
    expect(utmPlausivel(40, 400, '23S')).toBe(false);
    expect(utmPlausivel(333221, 7394585, '23S')).toBe(true);
  });
});
