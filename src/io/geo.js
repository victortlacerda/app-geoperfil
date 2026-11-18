// GeoJSON e KML: exportar furos e cortes em WGS84 / SIRGAS 2000 (lat/long) e importar pontos como furos.
import { utmParaGeo, geoParaUtm, fusoDe, ehGeorreferenciado, FUSO_PADRAO } from '../geo/coordenadas.js';
import { camadasDoFuro, profMax, novoFuro, num } from '../model/projeto.js';
import { paradaLabel, secLabel } from '../model/catalogo.js';

const r8 = (v) => +v.toFixed(8);
const fmt = (v) => (+v.toFixed(2)).toString().replace('.', ',');

function exigirGeo(projeto) {
  if (!ehGeorreferenciado(projeto)) throw new Error('O projeto usa coordenadas locais. Escolha "UTM SIRGAS 2000" na planta para exportar com localização real.');
}

const resumoCamadas = (f) => camadasDoFuro(f).map((c) => `${fmt(c.de)}–${fmt(c.ate)} m ${c.codigo}${c.origem ? ' (' + secLabel(c.origem) + ')' : ''}`).join('; ');

export function exportarGeoJSON(projeto) {
  exigirGeo(projeto);
  const fz = projeto.projeto.fusoUTM;
  const pt = (x, y) => { const g = utmParaGeo(x, y, fz); return [r8(g.lon), r8(g.lat)]; };
  const features = [
    ...projeto.furos.map((f) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: pt(f.x, f.y) },
      properties: {
        tipo: 'furo', nome: f.nome, cota: f.cota, na: f.na, prof_total: profMax(f),
        parada: paradaLabel(f.parada), utm_e: f.x, utm_n: f.y, fuso_utm: fz, camadas: resumoCamadas(f),
      },
    })),
    ...projeto.cortes.map((c) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [pt(...c.p1), pt(...c.p2)] },
      properties: { tipo: 'corte', nome: c.nome, faixa_m: c.faixa, incluir: c.incluir === 'ambos' ? 'dois lados' : 'um lado' },
    })),
  ];
  return JSON.stringify({ type: 'FeatureCollection', name: projeto.projeto.nome, features }, null, 2);
}

const xml = (s) => String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);

export function exportarKML(projeto) {
  exigirGeo(projeto);
  const fz = projeto.projeto.fusoUTM;
  const c3 = (x, y) => { const g = utmParaGeo(x, y, fz); return `${r8(g.lon)},${r8(g.lat)},0`; };
  const furos = projeto.furos.map((f) => `
    <Placemark>
      <name>${xml(f.nome)}</name>
      <styleUrl>#furo</styleUrl>
      <description>${xml([`Cota da boca: ${fmt(f.cota)} m`, `NA: ${f.na ? fmt(f.na) + ' m' : '—'}`, `Profundidade: ${fmt(profMax(f))} m`, f.parada ? paradaLabel(f.parada) : '', `UTM ${fz}: E ${f.x} · N ${f.y}`, resumoCamadas(f)].filter(Boolean).join('\n'))}</description>
      <Point><coordinates>${c3(f.x, f.y)}</coordinates></Point>
    </Placemark>`).join('');
  const cortes = projeto.cortes.map((c) => `
    <Placemark>
      <name>${xml(c.nome)}</name>
      <styleUrl>#corte</styleUrl>
      <LineString><tessellate>1</tessellate><coordinates>${c3(...c.p1)} ${c3(...c.p2)}</coordinates></LineString>
    </Placemark>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${xml(projeto.projeto.nome)}</name>
    <Style id="furo"><IconStyle><color>ffd16615</color><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle></Style>
    <Style id="corte"><LineStyle><color>ffd16615</color><width>3</width></LineStyle></Style>
    <Folder><name>Furos de sondagem</name>${furos}
    </Folder>
    <Folder><name>Cortes</name>${cortes}
    </Folder>
  </Document>
</kml>
`;
}

// ── leitura ──────────────────────────────────────────────

/** Pontos de um GeoJSON: [{ nome, lat, lon, cota? }]. */
export function lerGeoJSON(texto) {
  const d = typeof texto === 'string' ? JSON.parse(texto) : texto;
  const feats = d.type === 'FeatureCollection' ? d.features : d.type === 'Feature' ? [d] : [];
  const pontos = [];
  feats.forEach((ft, i) => {
    if (ft?.geometry?.type !== 'Point') return;
    const [lon, lat] = ft.geometry.coordinates || [];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const p = ft.properties || {};
    const nome = String(p.nome ?? p.name ?? p.Name ?? p.NOME ?? p.furo ?? p.id ?? `P-${String(i + 1).padStart(2, '0')}`).trim();
    const cota = num(p.cota ?? p.Cota ?? p.elevation, NaN);
    pontos.push({ nome, lat, lon, ...(Number.isFinite(cota) ? { cota } : {}) });
  });
  return pontos;
}

const desxml = (s) => String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();

/** Pontos de um KML (Google Earth): [{ nome, lat, lon }]. */
export function lerKML(texto) {
  const pontos = [];
  const blocos = String(texto).match(/<Placemark\b[\s\S]*?<\/Placemark>/gi) || [];
  blocos.forEach((b, i) => {
    const ponto = /<Point\b[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/i.exec(b);
    if (!ponto) return;
    const [lon, lat] = ponto[1].trim().split(/[\s]+/)[0].split(',').map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const nome = /<name>([\s\S]*?)<\/name>/i.exec(b);
    pontos.push({ nome: nome ? desxml(nome[1]) : `P-${String(i + 1).padStart(2, '0')}`, lat, lon });
  });
  return pontos;
}

/**
 * Garante que o projeto está em UTM. Se estava em coordenadas locais, passa para
 * UTM SIRGAS 2000 no fuso do ponto informado. Retorna o fuso e se houve mudança.
 */
export function garantirUTM(projeto, lat, lon) {
  if (ehGeorreferenciado(projeto)) return { fuso: projeto.projeto.fusoUTM || FUSO_PADRAO, mudou: false };
  projeto.projeto.crs = 'utm';
  projeto.projeto.fusoUTM = Number.isFinite(lat) ? fusoDe(lat, lon) : FUSO_PADRAO;
  return { fuso: projeto.projeto.fusoUTM, mudou: true };
}

/** Aplica pontos (lat/long) ao projeto: atualiza furos de mesmo nome ou cria novos. */
export function aplicarPontos(projeto, pontos) {
  const res = { novos: 0, atualizados: 0, avisos: [] };
  if (!pontos.length) return res;
  const locais = projeto.furos.filter((f) => !pontos.some((p) => p.nome === f.nome)).length;
  const { fuso, mudou } = garantirUTM(projeto, pontos[0].lat, pontos[0].lon);
  if (mudou) {
    res.avisos.push(`O projeto passou a usar UTM SIRGAS 2000, fuso ${fuso}.`);
    if (locais) res.avisos.push(`${locais} furo(s) que já existiam continuam com as coordenadas locais antigas; ajuste-os.`);
  }
  pontos.forEach((p) => {
    const { x, y } = geoParaUtm(p.lat, p.lon, fuso);
    const xy = { x: +x.toFixed(3), y: +y.toFixed(3) };
    const f = projeto.furos.find((q) => q.nome === p.nome);
    if (f) { Object.assign(f, xy); if (p.cota !== undefined) f.cota = p.cota; res.atualizados++; }
    else { projeto.furos.push(novoFuro({ nome: p.nome, ...xy, cota: p.cota })); res.novos++; }
  });
  return res;
}
