// Catálogo de solos e classificações secundárias.

export const SOLOS = [
  { code: 'ARGS', label: 'ARGS — Argila siltosa', fill: '#FAEEDA', hatch: 'argila', hex: '#BA7517' },
  { code: 'ARGA', label: 'ARGA — Argila arenosa', fill: '#FAC775', hatch: 'argila', hex: '#993C1D' },
  { code: 'SAG', label: 'SAG — Silte argiloso', fill: '#F5C4B3', hatch: 'silte', hex: '#D85A30' },
  { code: 'SAR', label: 'SAR — Silte arenoso', fill: '#E6F1FB', hatch: 'silte', hex: '#1566D1' },
  { code: 'AREA', label: 'AREA — Areia argilosa', fill: '#EAF3DE', hatch: 'areia', hex: '#3B6D11' },
  { code: 'ARS', label: 'ARS — Areia siltosa', fill: '#C0DD97', hatch: 'areia', hex: '#27500A' },
  { code: 'ARE', label: 'ARE — Areia', fill: '#97C459', hatch: 'areia', hex: '#173404' },
  { code: 'ARP', label: 'ARP — Areia c/ pedregulho', fill: '#EEEDFE', hatch: 'pedregulho', hex: '#534AB7' },
];

export const SEC = [
  { value: '', label: '—' },
  { value: 'ATR', label: 'Aterro' },
  { value: 'RES', label: 'Solo residual' },
  { value: 'RFR', label: 'Rocha fraturada' },
  { value: 'RSA', label: 'Rocha sã' },
];

export const SOLO_PADRAO = 'AREA';

export const soloPorCodigo = (code) =>
  SOLOS.find((s) => s.code === String(code || '').trim().toUpperCase()) || null;

export const solo = (code) => soloPorCodigo(code) || soloPorCodigo(SOLO_PADRAO);

export const secPorValor = (v) =>
  SEC.find((s) => s.value === String(v || '').trim().toUpperCase())?.value ?? '';

export const secLabel = (v) => SEC.find((s) => s.value === v)?.label || '';
