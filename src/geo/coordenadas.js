// Conversão entre UTM (SIRGAS 2000) e coordenadas geográficas (latitude/longitude).
import proj4 from 'proj4';

/** Fusos UTM que cobrem o Brasil. */
export const FUSOS = [
  ...[18, 19, 20, 21, 22, 23, 24, 25].map((z) => `${z}S`),
  ...[18, 19, 20, 21, 22].map((z) => `${z}N`),
];
export const FUSO_PADRAO = '23S';

function partes(fuso) {
  const m = /^(\d{1,2})([NS])$/.exec(String(fuso || '').toUpperCase());
  if (!m) throw new Error(`Fuso UTM inválido: ${fuso}`);
  return { zona: +m[1], sul: m[2] === 'S' };
}

/** Código EPSG do SIRGAS 2000 / UTM (ex.: 23S → 31983). */
export function epsgDoFuso(fuso) {
  const { zona, sul } = partes(fuso);
  return sul ? 31960 + zona : 31954 + zona;
}

const cache = new Map();
function conversor(fuso) {
  const f = String(fuso).toUpperCase();
  if (!cache.has(f)) {
    const { zona, sul } = partes(f);
    const def = `+proj=utm +zone=${zona}${sul ? ' +south' : ''} +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`;
    cache.set(f, proj4('+proj=longlat +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs', def));
  }
  return cache.get(f);
}

/** UTM (x = Leste, y = Norte) → { lat, lon } em graus. */
export function utmParaGeo(x, y, fuso) {
  const [lon, lat] = conversor(fuso).inverse([x, y]);
  return { lat, lon };
}

/** { lat, lon } em graus → UTM { x, y } no fuso informado. */
export function geoParaUtm(lat, lon, fuso) {
  const [x, y] = conversor(fuso).forward([lon, lat]);
  return { x, y };
}

/** Fuso UTM natural de um ponto. */
export function fusoDe(lat, lon) {
  const zona = Math.min(60, Math.max(1, Math.floor((lon + 180) / 6) + 1));
  return `${zona}${lat < 0 ? 'S' : 'N'}`;
}

/** O projeto usa coordenadas UTM reais (e pode mostrar mapa)? */
export const ehGeorreferenciado = (projeto) => projeto?.projeto?.crs === 'utm';

/** Coordenadas UTM plausíveis para o fuso (descarta coordenadas locais pequenas). */
export function utmPlausivel(x, y, fuso) {
  const { sul } = partes(fuso);
  return x > 100000 && x < 900000 && (sul ? y > 1000000 && y <= 10000000 : y >= 0 && y < 9400000);
}

export const fmtGraus = (v, casas = 6) => (Number.isFinite(v) ? v.toFixed(casas) : '—');
