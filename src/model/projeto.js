// Modelo de dados. Tudo em metros; x = Leste, y = Norte (Norte para cima).
//
// O furo guarda o boletim metro a metro em `metros`, só com o que foi digitado
// (lista esparsa). O metro m cobre a profundidade de (m − 1) a m.
//   { m, codigo, origem, desc, spt, golpes }
// - codigo: classificação primária. Vazio = herda a do metro de cima.
// - origem: classificação secundária. Vazio = herda enquanto a primária não muda;
//   '-' = nenhuma, explicitamente.
// - spt: N-SPT como digitado ("12" ou "30/12"). golpes: ["3","4","5"] por 15 cm (opcional).
// As camadas são derivadas: metros seguidos com a mesma classificação formam uma camada.
import { solo, soloPorCodigo, ehImpenetravel } from './catalogo.js';

export const VERSAO = 2;
export const LINHAS_PADRAO = 10;

let seq = 0;
export const uid = (p = 'id') => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function num(v, padrao = 0) {
  if (v === null || v === undefined || v === '') return padrao;
  const n = typeof v === 'number' ? v : parseFloat(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : padrao;
}

const CAMPOS_METRO = ['codigo', 'origem', 'desc', 'spt'];

function normalizarMetro(r) {
  const o = { m: Math.round(num(r.m, 0)) };
  for (const c of CAMPOS_METRO) if (r[c] !== undefined && r[c] !== null && String(r[c]).trim() !== '') o[c] = String(r[c]).trim();
  if (Array.isArray(r.golpes) && r.golpes.some((g) => String(g ?? '').trim() !== '')) o.golpes = [0, 1, 2].map((i) => String(r.golpes[i] ?? '').trim());
  return o;
}
const metroVazio = (r) => !CAMPOS_METRO.some((c) => r[c]) && !r.golpes;

export function novoFuro(d = {}) {
  const f = {
    id: d.id || uid('f'),
    nome: d.nome || 'SP-01',
    x: num(d.x, 0),
    y: num(d.y, 0),
    cota: num(d.cota, 0),
    na: num(d.na, 0),
    profTotal: num(d.profTotal, 0),
    parada: d.parada || '',
    metros: (d.metros || []).map(normalizarMetro).filter((r) => r.m >= 1 && !metroVazio(r)).sort((a, b) => a.m - b.m),
  };
  if (!d.metros && Array.isArray(d.camadas)) aplicarCamadas(f, d.camadas);
  if (!d.metros && Array.isArray(d.spt)) d.spt.forEach((s) => setCampoMetro(f, Math.round(num(s.prof)), 'spt', String(s.n)));
  return f;
}

export function novoProjeto(nome = 'Novo projeto') {
  return { version: VERSAO, projeto: { nome, crs: 'local', fusoUTM: '23S', fundo: 'mapa', modoSPT: 'metro' }, cores: {}, furos: [], cortes: [] };
}

// ── edição de metros ─────────────────────────────────────

export const getMetro = (f, m) => f.metros.find((r) => r.m === m);

/** Define (ou apaga, com valor vazio) um campo de um metro. campo: codigo|origem|desc|spt|g0|g1|g2. */
export function setCampoMetro(f, m, campo, valor) {
  if (!(m >= 1)) return;
  let r = getMetro(f, m);
  if (!r) { r = { m }; f.metros.push(r); f.metros.sort((a, b) => a.m - b.m); }
  const v = valor === null || valor === undefined ? '' : String(valor).trim();
  const g = /^g([012])$/.exec(campo);
  if (g) {
    const arr = r.golpes ? [...r.golpes] : ['', '', ''];
    arr[+g[1]] = v;
    if (arr.some((x) => x)) r.golpes = arr; else delete r.golpes;
  } else if (v) r[campo] = v;
  else delete r[campo];
  if (metroVazio(r)) f.metros = f.metros.filter((q) => q !== r);
}

/**
 * Converte camadas com profundidades quaisquer (ex.: importação) para o boletim metro a metro.
 * Cada metro recebe a camada que contém o seu meio; só as mudanças ficam gravadas.
 */
export function aplicarCamadas(f, camadas) {
  const fim = Math.max(0, ...camadas.map((c) => num(c.ate)));
  if (fim > (f.profTotal || 0)) f.profTotal = fim; // a sondagem vai pelo menos até a última camada
  let anterior = null;
  for (let m = 1; m <= Math.ceil(fim); m++) {
    const c = camadas.find((q) => m - 0.5 >= num(q.de) && m - 0.5 < num(q.ate));
    const codigo = c && soloPorCodigo(c.codigo) ? soloPorCodigo(c.codigo).code : '';
    const origem = codigo ? (c.origem || '-') : '';
    const chave = `${codigo}|${origem}`;
    if (chave !== anterior) {
      setCampoMetro(f, m, 'codigo', codigo || '');
      setCampoMetro(f, m, 'origem', codigo ? origem : '');
      if (c?.descricao || c?.desc) setCampoMetro(f, m, 'desc', c.descricao || c.desc);
    } else {
      // dentro da mesma camada: o metro herda (apaga o que houvesse digitado antes)
      setCampoMetro(f, m, 'codigo', '');
      setCampoMetro(f, m, 'origem', '');
    }
    anterior = chave;
  }
}

// ── leitura derivada ─────────────────────────────────────

/** Último metro com algum dado digitado. */
export const ultimoMetro = (f) => (f.metros.length ? f.metros.at(-1).m : 0);

/** Quantidade de linhas do boletim: até a profundidade limite (ou o último dado). */
export function numLinhas(f, { minimo = 0 } = {}) {
  const n = Math.max(Math.ceil(f.profTotal || 0), ultimoMetro(f));
  return f.profTotal ? n : Math.max(n, minimo);
}

/** Profundidade de fundo do furo, para desenho. */
export const profMax = (f) => f.profTotal || ultimoMetro(f);

/** Interpreta um registro de golpe: "4" → {g:4,p:15}; "30/12" → {g:30,p:12}. null se vazio; NaN se inválido. */
export function lerGolpe(s) {
  const t = String(s ?? '').trim();
  if (!t) return null;
  const m = /^(\d+)(?:\s*\/\s*(\d+))?$/.exec(t);
  if (!m) return NaN;
  return { g: +m[1], p: m[2] === undefined ? 15 : +m[2] };
}
export const textoSPTValido = (s) => { const g = lerGolpe(s); return g === null || (g && Number.isFinite(g.g)); };

/**
 * N-SPT de um registro: { texto, valor } ou null.
 * valor é o número usado nos gráficos (penetração incompleta conta como 50).
 */
export function nDoMetro(r) {
  if (!r) return null;
  if (r.golpes) {
    const gs = r.golpes.map(lerGolpe);
    const parcial = gs.findIndex((g) => g && g.p < 15);
    if (parcial >= 0 && gs.slice(0, parcial).every((g) => g)) {
      const g = gs[parcial];
      return { texto: `${g.g}/${g.p}`, valor: 50, parcial: true };
    }
    if (gs.every((g) => g && g.p >= 15)) { const n = gs[1].g + gs[2].g; return { texto: String(n), valor: n }; }
    return null;
  }
  const g = lerGolpe(r.spt);
  if (!g || !Number.isFinite(g.g)) return null;
  return g.p < 15 ? { texto: `${g.g}/${g.p}`, valor: 50, parcial: true } : { texto: String(g.g), valor: g.g };
}

/**
 * Linhas efetivas do boletim (metro 1 até numLinhas), com a classificação já herdada.
 * Regras: a primária herda a do metro de cima; a secundária herda só enquanto a
 * primária continua a mesma, e '-' a encerra. Nada é herdado abaixo do fim do furo
 * (profundidade limite ou, sem ela, o último metro preenchido).
 */
export function linhasEfetivas(f, opcoes) {
  const n = numLinhas(f, opcoes);
  const fim = f.profTotal || ultimoMetro(f);
  const linhas = [];
  let codigo = '', origem = '';
  for (let m = 1; m <= n; m++) {
    const r = getMetro(f, m) || {};
    const codigoAnterior = codigo;
    if (r.codigo) codigo = soloPorCodigo(r.codigo) ? soloPorCodigo(r.codigo).code : codigo;
    if (r.origem) origem = r.origem === '-' ? '' : r.origem;
    else if (codigo !== codigoAnterior) origem = '';
    if (m - 1 >= fim) { codigo = ''; origem = ''; }
    linhas.push({
      m, de: m - 1, ate: f.profTotal && f.profTotal < m && f.profTotal > m - 1 ? f.profTotal : m,
      codigo, origem, registro: r,
      codigoHerdado: !r.codigo && !!codigo, origemHerdada: !r.origem && !!origem,
      n: nDoMetro(r), alemDoLimite: !!f.profTotal && m - 1 >= f.profTotal,
    });
  }
  return linhas;
}

/** Camadas derivadas: metros seguidos com a mesma primária e secundária. */
export function camadasDoFuro(f) {
  const camadas = [];
  for (const l of linhasEfetivas(f)) {
    if (!l.codigo) continue;
    const ult = camadas.at(-1);
    if (ult && ult.codigo === l.codigo && ult.origem === l.origem && Math.abs(ult.ate - l.de) < 1e-9) {
      ult.ate = l.ate;
      if (!ult.descricao && l.registro.desc) ult.descricao = l.registro.desc;
    } else camadas.push({ de: l.de, ate: l.ate, codigo: l.codigo, origem: l.origem, descricao: l.registro.desc || '' });
  }
  return camadas;
}

/** N-SPT por metro: { m: valor } (só os metros com N). */
export function sptPorMetro(f) {
  const o = {};
  f.metros.forEach((r) => { const n = nDoMetro(r); if (n) o[r.m] = n.valor; });
  return o;
}
export function sptTextos(f) {
  const o = {};
  f.metros.forEach((r) => { const n = nDoMetro(r); if (n) o[r.m] = n.texto; });
  return o;
}

/** Próximo nome livre no padrão SP-NN. */
export function proximoNome(furos) {
  let n = 1;
  const nomes = new Set(furos.map((f) => f.nome));
  while (nomes.has('SP-' + String(n).padStart(2, '0'))) n++;
  return 'SP-' + String(n).padStart(2, '0');
}

/** Forma usada pelos desenhos de perfil e DXF. */
export function resolverFuro(f) {
  return {
    id: f.id, name: f.nome, x: f.x, y: f.y, cota: f.cota, na: f.na, profTotal: profMax(f),
    layers: camadasDoFuro(f).map((c) => ({ de: c.de, ate: c.ate, solo: solo(c.codigo), sec: c.origem, descricao: c.descricao })),
    spt: sptPorMetro(f), sptTexto: sptTextos(f),
    imp: ehImpenetravel(f.parada), parada: f.parada,
  };
}

// ── exemplo ──────────────────────────────────────────────

const cam = (de, ate, codigo, origem, descricao = '') => ({ de, ate, codigo, origem, descricao });
const sptLista = (obj) => Object.entries(obj).map(([p, n]) => ({ prof: +p, n }));

/** Projeto de exemplo com 4 furos, em UTM SIRGAS 2000 fuso 23S. */
export const EXEMPLO_E0 = 333000, EXEMPLO_N0 = 7393600;
export function projetoExemplo() {
  const p = novoProjeto('Exemplo');
  p.projeto.crs = 'utm';
  p.furos = [
    novoFuro({ nome: 'SP-01', x: EXEMPLO_E0 + 40, y: EXEMPLO_N0 + 400, cota: 842.5, na: 3.2, profTotal: 15, parada: 'imp_percussao',
      camadas: [cam(0, 2, 'ARGS', 'ATR', 'Argila siltosa marrom com entulho'), cam(2, 6, 'ARGA', 'RES', 'Argila arenosa vermelha, mole a média'), cam(6, 9, 'AREA', 'RES', 'Areia fina argilosa amarela, fofa'), cam(9, 14, 'SAR', 'RES', 'Silte arenoso variegado, compacto'), cam(14, 15, 'SAG', 'RFR', 'Silte argiloso com fragmentos de rocha')],
      spt: sptLista({ 1: 3, 2: 4, 3: 5, 4: 6, 5: 8, 6: 9, 7: 11, 8: 15, 9: 18, 10: 22, 11: 28, 12: 35, 13: 42, 14: 50, 15: '30/10' }) }),
    novoFuro({ nome: 'SP-02', x: EXEMPLO_E0 + 115, y: EXEMPLO_N0 + 407.5, cota: 839.0, na: 2.8, profTotal: 12, parada: 'projeto',
      camadas: [cam(0, 2, 'ARGS', 'ATR'), cam(2, 6, 'ARGA', 'RES'), cam(6, 12, 'ARS', 'RES')],
      spt: sptLista({ 1: 2, 2: 3, 3: 4, 4: 5, 5: 7, 6: 10, 7: 14, 8: 20, 9: 26, 10: 34, 11: 40, 12: 48 }) }),
    novoFuro({ nome: 'SP-03', x: EXEMPLO_E0 + 195, y: EXEMPLO_N0 + 402.5, cota: 845.2, na: 4.5, profTotal: 20, parada: 'imp_percussao',
      camadas: [cam(0, 3, 'SAG', 'ATR'), cam(3, 8, 'SAR', 'RES'), cam(8, 18, 'ARE', 'RES'), cam(18, 20, 'ARGS', 'RSA')],
      spt: sptLista({ 1: 4, 2: 5, 3: 6, 4: 7, 5: 9, 6: 12, 7: 16, 8: 20, 9: 25, 10: 30, 11: 35, 12: 38, 13: 42, 14: 45, 15: 48, 16: 50, 17: 50, 18: 50, 19: 50, 20: '30/5' }) }),
    novoFuro({ nome: 'SP-04', x: EXEMPLO_E0 + 105, y: EXEMPLO_N0 + 345, cota: 840.0, na: 3.0, profTotal: 10, parada: 'projeto',
      camadas: [cam(0, 2, 'ARGS', 'ATR'), cam(2, 7, 'SAG', 'RES'), cam(7, 10, 'ARE', 'RES')],
      spt: sptLista({ 1: 3, 2: 4, 3: 6, 4: 8, 5: 10, 6: 13, 7: 18, 8: 24, 9: 32, 10: 40 }) }),
  ];
  return p;
}
