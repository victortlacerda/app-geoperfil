// Escalas padrão do perfil, comuns ao PDF A3 e ao DXF.
import { niceStep } from '../geo/zonas.js';

export const ESCALAS = [50, 100, 125, 200, 250, 500, 750, 1000, 1250, 2000, 2500, 5000, 7500, 10000, 20000, 25000, 50000];

/** Menor escala padrão (1:E) em que `metros` cabem em `mm`. */
export function escalaPadrao(metros, mm) {
  const min = (metros * 1000) / mm;
  return ESCALAS.find((e) => e >= min) || Math.ceil(min / 10000) * 10000;
}

/**
 * Escalas do desenho: horizontal (Eh) e vertical (Ev), com Ev ≤ Eh
 * (exagero vertical ≥ 1). Retorna também o exagero.
 */
export function escolherEscalas(comprimento, altura, larguraMm, alturaMm) {
  const Eh = escalaPadrao(Math.max(comprimento, 1), larguraMm);
  let Ev = escalaPadrao(Math.max(altura, 1), alturaMm);
  if (Ev > Eh) Ev = Eh;
  return { Eh, Ev, exagero: Eh / Ev };
}

/**
 * Escalas e faixa de cotas do perfil para uma área de desenho (mm), com a
 * faixa arredondada à grade: a escala vertical sobe até tudo caber.
 * Usada pelo PDF A3 e pelo DXF, para os dois saírem iguais.
 */
export function escalasPerfil(geo, bhs, larguraMm = 366, alturaMm = 195) {
  const fundoCota = Math.min(...geo.fundo.map(([, c]) => c));
  const topoCota = Math.max(...bhs.map((b) => b.cota));
  const altura = Math.max(topoCota - fundoCota, 0.5);
  let { Eh, Ev } = escolherEscalas(geo.totDist, altura * 1.05, larguraMm, alturaMm - 8);
  let passoC, cTopo, cBase;
  for (;;) {
    passoC = niceStep((alturaMm * Ev) / 1000 / 8);
    cTopo = Math.ceil((topoCota + altura * 0.02) / passoC) * passoC;
    cBase = Math.floor((fundoCota - altura * 0.02) / passoC) * passoC;
    if (((cTopo - cBase) * 1000) / Ev <= alturaMm - 8) break;
    Ev = ESCALAS.find((e) => e > Ev) || Ev * 2;
  }
  if (Ev > Eh) Eh = Ev;
  return { Eh, Ev, exagero: Eh / Ev, passoC, cTopo, cBase };
}

