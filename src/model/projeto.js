// Modelo de dados v2. Tudo em metros; x = Leste, y = Norte (Norte para cima).
import { solo, SOLO_PADRAO } from './catalogo.js';

export const VERSAO = 2;

let seq = 0;
export const uid = (p = 'id') => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function novoFuro(dados = {}) {
  return {
    id: dados.id || uid('f'),
    nome: dados.nome || 'SP-01',
    x: num(dados.x, 0),
    y: num(dados.y, 0),
    cota: num(dados.cota, 0),
    na: num(dados.na, 0),
    profTotal: num(dados.profTotal, 0),
    camadas: (dados.camadas || []).map(novaCamada),
    spt: (dados.spt || []).map((s) => ({ prof: num(s.prof, 0), n: num(s.n, 0) })),
  };
}

export function novaCamada(c = {}) {
  const codigo = solo(c.codigo).code;
  return {
    de: num(c.de, 0),
    ate: num(c.ate, 0),
    codigo,
    origem: c.origem || '',
    cor: c.cor || solo(codigo).hex,
  };
}

export function novoProjeto(nome = 'Novo projeto') {
  return { version: VERSAO, projeto: { nome, crs: 'local', fusoUTM: '23S' }, furos: [], cortes: [] };
}

const cam = (de, ate, codigo, origem) => ({ de, ate, codigo, origem });
const sptLista = (obj) => Object.entries(obj).map(([p, n]) => ({ prof: +p, n }));

/** Projeto de exemplo (os mesmos 4 furos da versão 1, convertidos para metros). */
export function projetoExemplo() {
  const p = novoProjeto('Exemplo');
  p.furos = [
    novoFuro({ nome: 'SP-01', x: 40, y: 400, cota: 842.5, na: 3.2, profTotal: 15,
      camadas: [cam(0, 2, 'ARGS', 'ATR'), cam(2, 5.5, 'ARGA', 'RES'), cam(5.5, 9, 'AREA', 'RES'), cam(9, 14, 'SAR', 'RES'), cam(14, 15, 'SAG', 'RFR')],
      spt: sptLista({ 1: 3, 2: 4, 3: 5, 4: 6, 5: 8, 6: 9, 7: 11, 8: 15, 9: 18, 10: 22, 11: 28, 12: 35, 13: 42, 14: 50, 15: 50 }) }),
    novoFuro({ nome: 'SP-02', x: 115, y: 407.5, cota: 839.0, na: 2.8, profTotal: 12,
      camadas: [cam(0, 1.5, 'ARGS', 'ATR'), cam(1.5, 6, 'ARGA', 'RES'), cam(6, 12, 'ARS', 'RES')],
      spt: sptLista({ 1: 2, 2: 3, 3: 4, 4: 5, 5: 7, 6: 10, 7: 14, 8: 20, 9: 26, 10: 34, 11: 40, 12: 48 }) }),
    novoFuro({ nome: 'SP-03', x: 195, y: 402.5, cota: 845.2, na: 4.5, profTotal: 20,
      camadas: [cam(0, 3, 'SAG', 'ATR'), cam(3, 8, 'SAR', 'RES'), cam(8, 18, 'ARE', 'RES'), cam(18, 20, 'ARGS', 'RSA')],
      spt: sptLista({ 1: 4, 2: 5, 3: 6, 4: 7, 5: 9, 6: 12, 7: 16, 8: 20, 9: 25, 10: 30, 11: 35, 12: 38, 13: 42, 14: 45, 15: 48, 16: 50, 17: 50, 18: 50, 19: 50, 20: 50 }) }),
    novoFuro({ nome: 'SP-04', x: 105, y: 345, cota: 840.0, na: 3.0, profTotal: 10,
      camadas: [cam(0, 2, 'ARGS', 'ATR'), cam(2, 7, 'SAG', 'RES'), cam(7, 10, 'ARE', 'RES')],
      spt: sptLista({ 1: 3, 2: 4, 3: 6, 4: 8, 5: 10, 6: 13, 7: 18, 8: 24, 9: 32, 10: 40 }) }),
  ];
  return p;
}

export function num(v, padrao = 0) {
  if (v === null || v === undefined || v === '') return padrao;
  const n = typeof v === 'number' ? v : parseFloat(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : padrao;
}

/** Profundidade máxima: base da última camada, ou profundidade total informada. */
export const profMax = (f) => (f.camadas.length ? Math.max(...f.camadas.map((c) => c.ate)) : f.profTotal || 0);

/** N-SPT indexado por metro inteiro: { 1: 3, 2: 4, ... }. */
export function sptPorMetro(f) {
  const m = {};
  f.spt.forEach((s) => { m[Math.round(s.prof)] = s.n; });
  return m;
}

export function setSpt(f, prof, n) {
  f.spt = f.spt.filter((s) => Math.round(s.prof) !== prof);
  if (n !== null && n !== undefined && Number.isFinite(n)) f.spt.push({ prof, n: Math.max(0, Math.min(Math.round(n), 50)) });
  f.spt.sort((a, b) => a.prof - b.prof);
}

/** Próximo nome livre no padrão SP-NN. */
export function proximoNome(furos) {
  let n = 1;
  const nomes = new Set(furos.map((f) => f.nome));
  while (nomes.has('SP-' + String(n).padStart(2, '0'))) n++;
  return 'SP-' + String(n).padStart(2, '0');
}

/**
 * Forma "resolvida" usada pelos desenhos de perfil e DXF: camadas com o
 * objeto de solo do catálogo e SPT por metro.
 */
export function resolverFuro(f) {
  return {
    id: f.id, name: f.nome, x: f.x, y: f.y, cota: f.cota, na: f.na,
    layers: f.camadas.map((c) => ({ de: c.de, ate: c.ate, solo: solo(c.codigo), sec: c.origem, cor: c.cor })),
    spt: sptPorMetro(f),
  };
}

export { SOLO_PADRAO };
