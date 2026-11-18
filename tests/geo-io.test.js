import { describe, it, expect } from 'vitest';
import { exportarGeoJSON, exportarKML, lerGeoJSON, lerKML, aplicarPontos } from '../src/io/geo.js';
import { projetoExemplo, novoProjeto, novoFuro } from '../src/model/projeto.js';
import { utmParaGeo } from '../src/geo/coordenadas.js';

describe('GeoJSON e KML', () => {
  const p = projetoExemplo();
  p.cortes.push({ id: 'c', nome: "A–A'", p1: [333020, 7393995], p2: [333230, 7393995], lado: 1, faixa: 40, incluir: 'lado' });

  it('exporta GeoJSON em lat/long com os dados do furo', () => {
    const gj = JSON.parse(exportarGeoJSON(p));
    expect(gj.type).toBe('FeatureCollection');
    const sp1 = gj.features.find((f) => f.properties.nome === 'SP-01');
    const g = utmParaGeo(333040, 7394000, '23S');
    expect(sp1.geometry.coordinates[0]).toBeCloseTo(g.lon, 7);
    expect(sp1.geometry.coordinates[1]).toBeCloseTo(g.lat, 7);
    expect(sp1.properties).toMatchObject({ cota: 842.5, fuso_utm: '23S', utm_e: 333040 });
    expect(sp1.properties.camadas).toMatch(/ARGS/);
    expect(gj.features.filter((f) => f.geometry.type === 'LineString')).toHaveLength(1);
  });

  it('ida e volta: exportar e importar devolve as mesmas coordenadas (mm)', () => {
    const q = novoProjeto(); q.projeto.crs = 'utm';
    aplicarPontos(q, lerGeoJSON(exportarGeoJSON(p)));
    p.furos.forEach((f) => {
      const r = q.furos.find((k) => k.nome === f.nome);
      expect(r.x).toBeCloseTo(f.x, 2);
      expect(r.y).toBeCloseTo(f.y, 2);
    });
    const k = novoProjeto(); k.projeto.crs = 'utm';
    aplicarPontos(k, lerKML(exportarKML(p)));
    expect(k.furos.map((f) => f.nome)).toEqual(['SP-01', 'SP-02', 'SP-03', 'SP-04']);
    expect(k.furos[2].x).toBeCloseTo(333195, 2);
  });

  it('KML do Google Earth com CDATA, altitude e espaços', () => {
    const kml = `<kml><Document><Placemark><name><![CDATA[SP 10 & cia]]></name><Point>
      <coordinates>
        -46.63395,-23.55052,0
      </coordinates></Point></Placemark><Placemark><name>linha</name><LineString><coordinates>-46,-23 -46.1,-23.1</coordinates></LineString></Placemark></Document></kml>`;
    expect(lerKML(kml)).toEqual([{ nome: 'SP 10 & cia', lat: -23.55052, lon: -46.63395 }]);
  });

  it('pontos atualizam furos de mesmo nome e criam os novos', () => {
    const q = projetoExemplo();
    const r = aplicarPontos(q, [{ nome: 'SP-01', lat: -23.55052, lon: -46.63395 }, { nome: 'SP-99', lat: -23.551, lon: -46.634 }]);
    expect(r).toMatchObject({ novos: 1, atualizados: 1 });
    expect(q.furos[0].x).toBeCloseTo(333221.582, 2);
  });

  it('projeto local passa a UTM no fuso do primeiro ponto, com aviso', () => {
    const q = novoProjeto(); q.furos.push(novoFuro({ nome: 'L1', x: 10, y: 20 }));
    const r = aplicarPontos(q, [{ nome: 'BSB', lat: -15.80006, lon: -47.86086 }]);
    expect(q.projeto).toMatchObject({ crs: 'utm', fusoUTM: '23S' });
    expect(r.avisos.join(' ')).toMatch(/coordenadas locais antigas/);
  });

  it('projeto local não exporta (sem localização real)', () => {
    expect(() => exportarGeoJSON(novoProjeto())).toThrow(/coordenadas locais/);
  });
});
