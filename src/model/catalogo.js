// Catálogo de solos, classificações secundárias e critérios de parada.

export const SOLOS = [
  { code: 'ARGS', label: 'ARGS — Argila siltosa', fill: '#FAEEDA', hatch: 'argila', hex: '#BA7517' },
  { code: 'ARGA', label: 'ARGA — Argila arenosa', fill: '#FAC775', hatch: 'argila', hex: '#993C1D' },
  { code: 'SAG', label: 'SAG — Silte argiloso', fill: '#F5C4B3', hatch: 'silte', hex: '#D85A30' },
  { code: 'SAR', label: 'SAR — Silte arenoso', fill: '#E6F1FB', hatch: 'silte', hex: '#1566D1' },
  { code: 'AREA', label: 'AREA — Areia argilosa', fill: '#EAF3DE', hatch: 'areia', hex: '#3B6D11' },
  { code: 'ARS', label: 'ARS — Areia siltosa', fill: '#C0DD97', hatch: 'areia', hex: '#27500A' },
  { code: 'ARE', label: 'ARE — Areia', fill: '#97C459', hatch: 'areia', hex: '#173404' },
  { code: 'ARP', label: 'ARP — Areia c/ pedregulho', fill: '#EEEDFE', hatch: 'pedregulho', hex: '#534AB7' },
  // rocha (trechos de rotativa): a secundária diz o grau (alterada, fraturada, sã)
  { code: 'ROC', label: 'ROC — Rocha', fill: '#CDD2DA', hatch: '', hex: '#4A5568' },
];

// Classificação secundária = origem / horizonte geotécnico. Cada horizonte tem uma cor
// forte para o desenho "por horizonte" (como nas pranchas de perfis geológico-geotécnicos).
export const SEC = [
  { value: '', label: '—' },
  { value: 'ATR', label: 'Aterro', cor: '#D97000' },
  { value: 'COL', label: 'Colúvio / tálus', cor: '#E8231B' },
  { value: 'RES', label: 'Solo residual', cor: '#FFBF00' },
  { value: 'RAL', label: 'Rocha alterada', cor: '#7F9FFF' },
  { value: 'RFR', label: 'Rocha fraturada', cor: '#4FA7C4' },
  { value: 'RSA', label: 'Rocha sã', cor: '#7FEA7F' },
  { value: 'PED', label: 'Pedregulho / blocos', cor: '#ABABAB' },
];
/** Horizontes que são rocha (topo rochoso marcado no desenho). */
export const ROCHA_SA = 'RSA';
/** Pedregulho / blocos: desenhados como blocos em volta do furo, não como camada contínua. */
export const BLOCOS = 'PED';

export const PARADAS = [
  { value: '', label: '—' },
  { value: 'imp_percussao', label: 'Impenetrável à percussão' },
  { value: 'imp_trado', label: 'Impenetrável ao trado' },
  { value: 'projeto', label: 'Profundidade de projeto' },
];
export const paradaLabel = (v) => PARADAS.find((p) => p.value === v)?.label || '';
export const ehImpenetravel = (v) => String(v || '').startsWith('imp_');

export const SOLO_PADRAO = 'AREA';

// Cores do projeto: cada classificação tem uma cor só, que o usuário pode trocar.
let coresProjeto = {};
export const definirCoresProjeto = (cores) => { coresProjeto = cores || {}; };
export const corPadrao = (code) => (ehHorizonte(code) ? SEC.find((s) => s.value === code.slice(2))?.cor : soloPorCodigo(code)?.fill) || '#dddddd';

export const soloPorCodigo = (code) =>
  SOLOS.find((s) => s.code === String(code || '').trim().toUpperCase()) || null;

/** Código de desenho de um horizonte (cor por horizonte): 'H:RES'. */
export const codigoHorizonte = (sec) => `H:${sec}`;
export const ehHorizonte = (code) => String(code || '').startsWith('H:');

/** Solo do catálogo com a cor do projeto aplicada. Código desconhecido cai no padrão. */
export function solo(code) {
  if (ehHorizonte(code)) {
    const h = SEC.find((s) => s.value === code.slice(2)) || SEC[0];
    return { code, label: h.label, nome: h.label, fill: coresProjeto[code] || h.cor || '#dddddd', hatch: '', hex: '#333333', horizonte: h.value };
  }
  const s = soloPorCodigo(code) || soloPorCodigo(SOLO_PADRAO);
  return coresProjeto[s.code] ? { ...s, fill: coresProjeto[s.code] } : s;
}

export const secPorValor = (v) =>
  SEC.find((s) => s.value === String(v || '').trim().toUpperCase())?.value ?? '';

export const secLabel = (v) => SEC.find((s) => s.value === v)?.label || '';

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Interpreta o que o usuário digitou na classificação primária.
 * Aceita o código (AREA) ou o começo do nome (areia arg). '' = vazio; null = não reconhecido.
 */
export function resolverCodigo(texto) {
  const t = norm(texto);
  if (!t) return '';
  const porCodigo = SOLOS.find((s) => s.code.toLowerCase() === t);
  if (porCodigo) return porCodigo.code;
  const porNome = SOLOS.filter((s) => norm(s.label.split('—')[1]).startsWith(t) || norm(s.label).startsWith(t));
  return porNome.length === 1 ? porNome[0].code : null;
}

/** Classificação secundária: código, nome ou "-" (nenhuma). '' = herdar; null = não reconhecido. */
export function resolverOrigem(texto) {
  const t = norm(texto);
  if (!t) return '';
  if (t === '-' || t === '—' || t === 'nenhuma' || t === 'nenhum') return '-';
  const opcoes = SEC.filter((o) => o.value);
  const exato = opcoes.find((o) => o.value.toLowerCase() === t || norm(o.label) === t);
  if (exato) return exato.value;
  const parcial = opcoes.filter((o) => norm(o.label).includes(t));
  return parcial.length === 1 ? parcial[0].value : null;
}

/** Nome curto para rótulo no desenho: o código do solo ou o nome do horizonte. */
export const rotuloCurto = (s) => (ehHorizonte(s.code) ? s.label : s.code);
