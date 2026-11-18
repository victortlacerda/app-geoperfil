// Importação de sondagens a partir de CSV ou de planilhas (linhas já lidas).
// As colunas são reconhecidas pelo cabeçalho; a coluna "furo" é obrigatória.
import { novoFuro, novaCamada, setSpt, num } from '../model/projeto.js';
import { soloPorCodigo, secPorValor, SOLO_PADRAO } from '../model/catalogo.js';

const ALIASES = {
  furo: ['furo', 'sondagem', 'id', 'nome', 'sp', 'furo_id'],
  x: ['x', 'leste', 'e', 'este', 'coord_x', 'coordenada_x'],
  y: ['y', 'norte', 'coord_y', 'coordenada_y'],
  cota: ['cota', 'cota_boca', 'cota_da_boca', 'z'],
  na: ['na', 'nivel_dagua', 'nivel_d_agua', 'nivel_agua', 'n_a'],
  profTotal: ['prof_total', 'profundidade_total', 'limite', 'prof_max', 'profundidade_maxima'],
  de: ['de', 'topo', 'prof_de', 'de_m'],
  ate: ['ate', 'base', 'prof_ate', 'ate_m'],
  primario: ['primario', 'solo', 'codigo', 'classif_primaria', 'classificacao', 'classificacao_primaria'],
  secundario: ['secundario', 'origem', 'classif_secundaria', 'classificacao_secundaria'],
  prof: ['prof', 'profundidade', 'metro', 'cota_spt', 'prof_m'],
  nspt: ['nspt', 'n_spt', 'spt', 'n_golpes'],
};

export const normalizarCabecalho = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

export function detectarSeparador(texto) {
  const linha = texto.split(/\r?\n/).find((l) => l.trim()) || '';
  const cont = (c) => linha.split(c).length - 1;
  if (cont('\t') > 0) return '\t';
  if (cont(';') > 0) return ';';
  return ',';
}

/** Divide o texto CSV em linhas e células (aceita aspas). */
export function lerCSV(texto, sep = 'auto') {
  const s = sep === 'auto' ? detectarSeparador(texto) : sep;
  const linhas = [];
  let cel = '', linha = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { cel += '"'; i++; }
      else if (c === '"') aspas = false;
      else cel += c;
    } else if (c === '"') aspas = true;
    else if (c === s) { linha.push(cel.trim()); cel = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      linha.push(cel.trim()); linhas.push(linha); linha = []; cel = '';
    } else cel += c;
  }
  if (cel !== '' || linha.length) { linha.push(cel.trim()); linhas.push(linha); }
  return linhas.filter((l) => l.some((v) => v !== ''));
}

/** Transforma uma tabela (array de linhas) em registros { furo, x, de, ... }. */
export function interpretarTabela(linhas) {
  if (!linhas.length) return { registros: [], colunas: [] };
  const cab = linhas[0].map(normalizarCabecalho);
  const mapa = {};
  cab.forEach((h, i) => {
    for (const [campo, nomes] of Object.entries(ALIASES)) if (nomes.includes(h) && !(campo in mapa)) mapa[campo] = i;
  });
  if (!('furo' in mapa)) return { registros: [], colunas: [] };
  const registros = linhas.slice(1).map((l) => {
    const r = {};
    for (const [campo, i] of Object.entries(mapa)) {
      const v = l[i];
      if (v !== undefined && v !== null && String(v).trim() !== '') r[campo] = String(v).trim();
    }
    return r;
  }).filter((r) => r.furo);
  return { registros, colunas: Object.keys(mapa) };
}

/**
 * Aplica registros ao projeto (modifica `projeto`). Furos são casados pelo nome.
 * Retorna um resumo para mostrar ao usuário.
 */
export function aplicarImportacao(projeto, registros) {
  const res = { furosNovos: 0, furosAtualizados: new Set(), camadas: 0, spt: 0, avisos: [] };
  const codigosDesconhecidos = new Set(), semCoord = new Set(), ignoradas = [], semProf = [];
  const furoPorNome = new Map(projeto.furos.map((f) => [f.nome, f]));
  const coordInformada = new Set();
  const existentes = new Set(projeto.furos.map((f) => f.nome));

  registros.forEach((r, idx) => {
    const nome = r.furo;
    let f = furoPorNome.get(nome);
    if (!f) { f = novoFuro({ nome }); projeto.furos.push(f); furoPorNome.set(nome, f); res.furosNovos++; semCoord.add(nome); }
    else if (existentes.has(nome)) res.furosAtualizados.add(nome);

    for (const campo of ['x', 'y', 'cota', 'na', 'profTotal']) {
      if (r[campo] === undefined) continue;
      const v = num(r[campo], NaN);
      if (Number.isFinite(v)) { f[campo] = v; if (campo === 'x' || campo === 'y') { coordInformada.add(nome); semCoord.delete(nome); } }
    }

    const de = num(r.de, NaN), ate = num(r.ate, NaN);
    const temCamada = Number.isFinite(de) && Number.isFinite(ate);
    if (r.de !== undefined || r.ate !== undefined) {
      if (!temCamada || ate <= de) ignoradas.push(idx + 1);
    }
    if (temCamada && ate > de) {
      if (r.primario && !soloPorCodigo(r.primario)) codigosDesconhecidos.add(r.primario);
      const cam = novaCamada({ de, ate, codigo: r.primario || SOLO_PADRAO, origem: secPorValor(r.secundario) });
      const i = f.camadas.findIndex((c) => Math.abs(c.de - de) < 0.01 && Math.abs(c.ate - ate) < 0.01);
      if (i >= 0) f.camadas[i] = cam; else f.camadas.push(cam);
      f.camadas.sort((a, b) => a.de - b.de);
      res.camadas++;
    }

    const n = num(r.nspt, NaN);
    const prof = num(r.prof, NaN);
    if (Number.isFinite(n) && Number.isFinite(prof)) { setSpt(f, Math.round(prof), n); res.spt++; }
    else if (Number.isFinite(n)) semProf.push(idx + 1);
  });

  // furos novos sem coordenadas: espalha em linha ao lado dos existentes
  const semXY = projeto.furos.filter((f) => semCoord.has(f.nome) && !coordInformada.has(f.nome));
  if (semXY.length) {
    const comXY = projeto.furos.filter((f) => !semXY.includes(f));
    const x0 = comXY.length ? Math.max(...comXY.map((f) => f.x)) + 40 : 0;
    const y0 = comXY.length ? comXY.reduce((s, f) => s + f.y, 0) / comXY.length : 0;
    semXY.forEach((f, i) => { f.x = x0 + i * 40; f.y = y0; });
    res.avisos.push(`Sem coordenadas (posicionados em linha, ajuste depois): ${semXY.map((f) => f.nome).join(', ')}.`);
  }
  if (codigosDesconhecidos.size) res.avisos.push(`Códigos de solo desconhecidos, trocados por ${SOLO_PADRAO}: ${[...codigosDesconhecidos].join(', ')}.`);
  if (semProf.length) res.avisos.push(`N-SPT sem a coluna "prof" ignorado nas linhas: ${semProf.slice(0, 10).join(', ')}${semProf.length > 10 ? '…' : ''}.`);
  if (ignoradas.length) res.avisos.push(`Camadas ignoradas (de/até inválidos) nas linhas: ${ignoradas.slice(0, 10).join(', ')}${ignoradas.length > 10 ? '…' : ''}.`);
  res.furosAtualizados = res.furosAtualizados.size;
  return res;
}

export const MODELO_CSV = [
  'furo;x;y;cota;na;de;ate;primario;secundario;prof;nspt',
  'SP-01;333120.45;7394210.80;842.50;3.20;0;2;ARGS;ATR;1;3',
  'SP-01;;;;;2;5.5;ARGA;RES;2;4',
  'SP-01;;;;;5.5;9;AREA;RES;3;5',
  'SP-01;;;;;;;;;4;6',
  'SP-02;333195.10;7394218.30;839.00;2.80;0;1.5;ARGS;ATR;1;2',
  'SP-02;;;;;1.5;6;ARGA;RES;2;3',
].join('\n');

export const MODELO_XLSX = {
  furos: [['furo', 'x', 'y', 'cota', 'na', 'prof_total'], ['SP-01', 333120.45, 7394210.8, 842.5, 3.2, 15], ['SP-02', 333195.1, 7394218.3, 839, 2.8, 12]],
  camadas: [['furo', 'de', 'ate', 'primario', 'secundario'], ['SP-01', 0, 2, 'ARGS', 'ATR'], ['SP-01', 2, 5.5, 'ARGA', 'RES'], ['SP-02', 0, 1.5, 'ARGS', 'ATR']],
  spt: [['furo', 'prof', 'nspt'], ['SP-01', 1, 3], ['SP-01', 2, 4], ['SP-02', 1, 2]],
};
