// Desenho do perfil como lista de elementos, comum à tela, ao PDF, ao DXF e à prancha.
//
// O perfil (polígonos das camadas, terreno, NA, furos) fica nas coordenadas da folha
// pelas funções X(d) e Y(c) (y cresce para baixo, como no papel). Textos, espessuras
// de linha e símbolos são dados em milímetros de papel e convertidos por `mm`
// (unidades da saída por mm). Cada saída só traduz a lista: o que aparece na tela é
// o que sai no PDF e no DXF.
//
// Elementos:
//   { t: 'poli', pts, fill, stroke, lw, hachura: { solo, sec } | null, camada, clip }
//   { t: 'linha', pts, cor, lw, dash, camada, clip }
//   { t: 'texto', x, y, txt, h, al: 'l'|'c'|'r', vb: 'base'|'meio', cor, bold, ang, fundo, camada, clip }
// h = corpo da letra em mm; lw em mm. `grupo` e `atrib` marcam o furo e seus valores
// (o DXF agrupa cada furo num bloco com atributos).
import { niceStep } from './zonas.js';
import { secLabel, rotuloCurto, ehHorizonte, ROCHA_SA, codigoHorizonte, solo as soloDe } from '../model/catalogo.js';

export const CORES = {
  tinta: '#1a1a1a', cinza: '#6e6e69', aviso: '#C25E00', grade: '#b8b8b2', contorno: '#2b2b2b',
  na: '#1566D1', naProjeto: '#00B4D8', vermelho: '#C62828', azul: '#1566D1', bloco: '#ABABAB',
};

const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '—');
const largura = (txt, h) => String(txt).length * h * 0.58; // estimativa (fonte sans)

/** Texto do N-SPT: '12' ou, com golpes/30 cm, '12/30' (penetração parcial fica como lançada). */
export function textoSPT(t, spt30) {
  if (t === undefined || t === null || t === '') return '';
  return spt30 && /^\d+$/.test(String(t)) ? `${t}/30` : String(t);
}

/** Gerador pseudoaleatório determinístico (forma dos blocos não muda a cada desenho). */
function aleatorio(semente) {
  let s = 0;
  for (const ch of String(semente)) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** Contorno irregular de um bloco (matacão) centrado em (cx, cy), semi-eixos rx, ry. */
export function formaBloco(cx, cy, rx, ry, semente) {
  const r = aleatorio(semente), n = 13, pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI + (r() - 0.5) * 0.35, f = 0.78 + r() * 0.3;
    pts.push([cx + Math.cos(a) * rx * f, cy + Math.sin(a) * ry * f]);
  }
  const trincas = [0, 1, 2].map(() => {
    const a = r() * 2 * Math.PI, f1 = 0.35 + r() * 0.2, f2 = 0.85;
    return [[cx + Math.cos(a) * rx * f1, cy + Math.sin(a) * ry * f1], [cx + Math.cos(a + 0.2) * rx * f2, cy + Math.sin(a + 0.2) * ry * f2]];
  });
  return { pts, trincas };
}

/** Marcas do topo rochoso: tracinhos inclinados ao longo da linha, para dentro da rocha. */
export function marcasTopoRochoso(linha, passo, comp) {
  const out = [];
  let resto = passo / 2;
  for (let i = 1; i < linha.length; i++) {
    const [x0, y0] = linha[i - 1], [x1, y1] = linha[i], L = Math.hypot(x1 - x0, y1 - y0);
    if (L < 1e-9) continue;
    const ux = (x1 - x0) / L, uy = (y1 - y0) / L;
    // normal para baixo (para dentro da rocha), inclinada 30° no sentido do traço
    let nx = -uy, ny = ux;
    if (ny < 0) { nx = -nx; ny = -ny; }
    const dx = nx * 0.87 + ux * 0.5, dy = ny * 0.87 + uy * 0.5;
    let s = resto;
    while (s <= L) {
      const px = x0 + ux * s, py = y0 + uy * s;
      out.push([[px, py], [px + dx * comp, py + dy * comp]]);
      s += passo;
    }
    resto = s - L;
  }
  return out;
}

/**
 * Monta o desenho de um perfil.
 * @param P {
 *   bhs, geo, corte, estilo: { cor, hachura, rotulos, spt30 }, axis: 'cota'|'prof',
 *   X(d), Y(c), mm, janela: { d0, d1, c0, c1 },
 *   mostrar: { na, spt, rotulos, hachura }, naProjeto, referencias, cTopo,
 *   titulo: { texto, sub } | null, regua: true (régua de distâncias em caixa)
 * }
 * @returns { itens, caixa: [x0, y0, x1, y1] (extensão de tudo, unidades da saída) }
 */
export function desenharPerfil(P) {
  const { bhs, geo, corte, estilo = {}, axis = 'cota', X, Y, mm, janela } = P;
  const mostrar = { na: true, spt: true, rotulos: estilo.rotulos !== false, hachura: estilo.hachura !== false, ...(P.mostrar || {}) };
  const itens = [];
  const add = (it) => { itens.push(it); return it; };
  const { d0, d1, c0, c1 } = janela;
  const fx0 = X(d0), fx1 = X(d1), fy0 = Y(c1), fy1 = Y(c0);
  const passoC = P.passoC || niceStep((c1 - c0) / 6 || 1);
  const passoD = P.passoD || niceStep((d1 - d0) / 6 || 1);
  const casasC = passoC < 1 ? 1 : 0;
  const cTopo = P.cTopo ?? c1;
  const totDist = geo?.totDist ?? 0;

  // ── grade, moldura e eixos de cota dos dois lados ──
  // a grade fica por cima das cores das camadas (cinza claro), como nas pranchas
  const grade = [];
  for (let c = Math.ceil(c0 / passoC - 1e-9) * passoC; c <= c1 + 1e-9; c += passoC) {
    grade.push({ t: 'linha', pts: [[fx0, Y(c)], [fx1, Y(c)]], cor: CORES.grade, lw: 0.12, camada: 'PERFIL-GRADE' });
  }
  for (let d = Math.ceil(d0 / passoD - 1e-9) * passoD; d <= d1 + 1e-9; d += passoD) {
    grade.push({ t: 'linha', pts: [[X(d), fy0], [X(d), fy1]], cor: CORES.grade, lw: 0.12, camada: 'PERFIL-GRADE' });
  }
  add({ t: 'poli', pts: [[fx0, fy0], [fx1, fy0], [fx1, fy1], [fx0, fy1]], fill: null, stroke: CORES.cinza, lw: 0.2, camada: 'PERFIL-GRADE' });
  const ex = 4 * mm;
  [[fx0 - ex, -1], [fx1 + ex, 1]].forEach(([xa, lado]) => {
    add({ t: 'linha', pts: [[xa, fy0], [xa, fy1]], cor: CORES.tinta, lw: 0.35, camada: 'PERFIL-EIXOS' });
    for (let c = Math.ceil(c0 / passoC - 1e-9) * passoC; c <= c1 + 1e-9; c += passoC) {
      add({ t: 'linha', pts: [[xa, Y(c)], [xa - lado * 2 * mm, Y(c)]], cor: CORES.tinta, lw: 0.25, camada: 'PERFIL-EIXOS' });
      const v = axis === 'cota' ? c : cTopo - c;
      add({ t: 'texto', x: xa + lado * 1.5 * mm, y: Y(c), txt: fmt(v, casasC), h: 3, al: lado < 0 ? 'r' : 'l', vb: 'meio', cor: CORES.tinta, camada: 'PERFIL-EIXOS' });
    }
  });
  add({ t: 'texto', x: fx0 - ex - 13 * mm, y: (fy0 + fy1) / 2, txt: axis === 'cota' ? 'Cota (m)' : 'Profundidade (m)', h: 2.6, al: 'c', vb: 'meio', cor: CORES.tinta, ang: 90, camada: 'PERFIL-EIXOS' });

  // régua de distâncias em caixa, abaixo da moldura
  if (P.regua !== false) {
    const ry0 = fy1 + 6 * mm, ry1 = ry0 + 7 * mm, rx0 = fx0 - ex - 2 * mm, rx1 = fx1 + ex + 2 * mm;
    add({ t: 'poli', pts: [[rx0, ry0], [rx1, ry0], [rx1, ry1], [rx0, ry1]], fill: null, stroke: CORES.tinta, lw: 0.35, camada: 'PERFIL-EIXOS' });
    const lw = largura('DISTÂNCIA (m)', 2.6) * mm + 4 * mm;
    add({ t: 'poli', pts: [[rx0, ry0 - 5 * mm], [rx0 + lw, ry0 - 5 * mm], [rx0 + lw, ry0], [rx0, ry0]], fill: '#ffffff', stroke: CORES.tinta, lw: 0.25, camada: 'PERFIL-EIXOS' });
    add({ t: 'texto', x: rx0 + 2 * mm, y: ry0 - 2.5 * mm, txt: 'DISTÂNCIA (m)', h: 2.6, al: 'l', vb: 'meio', cor: CORES.tinta, camada: 'PERFIL-EIXOS' });
    for (let d = Math.ceil(d0 / passoD - 1e-9) * passoD; d <= d1 + 1e-9; d += passoD) {
      if (d < -1e-9) continue; // a folga antes do primeiro furo não tem distância negativa
      add({ t: 'linha', pts: [[X(d), ry0], [X(d), ry0 + 1.5 * mm]], cor: CORES.tinta, lw: 0.25, camada: 'PERFIL-EIXOS' });
      add({ t: 'texto', x: X(d), y: ry0 + 4.6 * mm, txt: fmt(d, passoD < 1 ? 1 : 0), h: 3, al: 'c', vb: 'meio', cor: CORES.tinta, camada: 'PERFIL-EIXOS' });
    }
  }

  if (!geo || bhs.length < 2) { itens.push(...grade); return fechar(itens, P); }
  const tela = (pts) => pts.map(([d, c]) => [X(d), Y(c)]);

  // ── camadas ──
  geo.poligonos.forEach((p) => {
    add({ t: 'poli', pts: tela(p.pts), fill: p.solo.fill, stroke: null, hachura: mostrar.hachura ? { solo: p.solo, sec: p.sec } : null, camada: camadaMaterial(p.solo, p.sec), clip: true });
  });
  geo.poligonos.forEach((p) => add({ t: 'poli', pts: tela(p.pts), fill: null, stroke: CORES.contorno, lw: 0.18, camada: 'CONTATOS', clip: true }));
  itens.push(...grade);

  // topo rochoso: tracinhos vermelhos ao longo do topo das camadas de rocha sã
  geo.poligonos.filter((p) => p.sec === ROCHA_SA || p.solo.horizonte === ROCHA_SA).forEach((p) => {
    const topo = tela(p.pts.slice(0, p.nTopo || 2));
    marcasTopoRochoso(topo, 2.2 * mm, 1.5 * mm).forEach((seg) => add({ t: 'linha', pts: seg, cor: CORES.vermelho, lw: 0.2, camada: 'TOPO-ROCHOSO', clip: true }));
  });

  // blocos (pedregulho / matacões) em volta do furo
  (P.furos || bhs).forEach((b) => (b.blocos || []).forEach((bl, i) => {
    const cy = Y(b.cota - (bl.de + bl.ate) / 2), ry = Math.max(0.9 * mm, (Y(b.cota - bl.ate) - Y(b.cota - bl.de)) / 2 * 1.1);
    const rx = Math.max(ry * 1.7, 2.6 * mm), lado = i % 2 ? -1 : 1;
    const f = formaBloco(X(b.dist) + lado * rx * 0.25, cy, rx, ry, `${b.id}:${bl.de}`);
    add({ t: 'poli', pts: f.pts, fill: soloDe(codigoHorizonte('PED')).fill, stroke: CORES.contorno, lw: 0.18, camada: 'BLOCOS', clip: true });
    f.trincas.forEach((seg) => add({ t: 'linha', pts: seg, cor: CORES.contorno, lw: 0.12, camada: 'BLOCOS', clip: true }));
  }));

  // terreno
  add({ t: 'linha', pts: tela(geo.terreno), cor: CORES.tinta, lw: 0.5, camada: 'TERRENO', clip: true });

  // NA medido (interpolado entre os furos) e NA de projeto
  if (mostrar.na && geo.na.length > 1) add({ t: 'linha', pts: tela(geo.na), cor: CORES.na, lw: 0.3, dash: [2, 1], camada: 'NA', clip: true });
  if (Number.isFinite(P.naProjeto) && P.naProjeto !== null && P.naProjeto > c0 && P.naProjeto < c1) {
    const y = Y(P.naProjeto);
    add({ t: 'linha', pts: [[fx0 - ex, y], [fx1 + ex, y]], cor: CORES.naProjeto, lw: 0.35, camada: 'NA-PROJETO' });
    add({ t: 'texto', x: fx1 + ex + 11 * mm, y: y - 0.6 * mm, txt: `N.A.: ${fmt(P.naProjeto)}`, h: 3, al: 'l', vb: 'base', cor: CORES.tinta, camada: 'NA-PROJETO' });
  }

  // linhas de referência de projeto (fundo de escavação, cota de assentamento…)
  (P.referencias || []).forEach((r, i) => {
    if (!(r.cota > c0 && r.cota < c1)) return;
    const y = Y(r.cota), xa = X(0), xb = X(totDist);
    add({ t: 'linha', pts: [[xa, y], [xb, y]], cor: CORES.tinta, lw: 0.4, camada: 'REFERENCIAS', clip: true });
    const txt = `${String(r.nome).toUpperCase()} ${fmt(r.cota)}`, h = 2.6, w = largura(txt, h) * mm;
    // o rótulo vai no maior vão entre furos (longe dos textos de N-SPT e REC)
    const xs = bhs.map((b) => X(b.dist)).sort((p, q) => p - q), livre = 12 * mm;
    let g0 = xa, g1 = xb, melhor = -1;
    for (let k = 0; k + 1 < xs.length; k++) {
      const a0 = xs[k] + livre, a1 = xs[k + 1] - livre;
      if (a1 - a0 > melhor && a0 >= fx0 && a1 <= fx1) { melhor = a1 - a0; g0 = a0; g1 = a1; }
    }
    const tx = Math.max(g0, (g0 + g1) / 2 - w / 2 - 4 * mm), ty = y + (6 + i * 4.5) * mm;
    add({ t: 'texto', x: tx, y: ty, txt, h, al: 'l', vb: 'base', cor: CORES.tinta, fundo: true, camada: 'REFERENCIAS' });
    add({ t: 'linha', pts: [[tx, ty + 0.8 * mm], [tx + w, ty + 0.8 * mm], [Math.min(tx + w + 5 * mm, g1), y]], cor: CORES.tinta, lw: 0.2, camada: 'REFERENCIAS' });
  });

  // rótulos das camadas
  if (mostrar.rotulos) geo.poligonos.forEach((p) => {
    const h = Math.abs(Y(p.rotulo.c - p.rotulo.h / 2) - Y(p.rotulo.c + p.rotulo.h / 2)) / mm;
    if (h < 3.4) return;
    const x = X(p.rotulo.d), y = Y(p.rotulo.c), sec = ehHorizonte(p.solo.code) ? '' : secLabel(p.sec) + (p.inferida ? '*' : '');
    if (sec && h > 7.5) {
      add({ t: 'texto', x, y: y - 1.5 * mm, txt: rotuloCurto(p.solo), h: 2.6, al: 'c', vb: 'meio', cor: CORES.tinta, bold: true, fundo: '#ffffff', camada: 'ROTULOS', clip: true });
      add({ t: 'texto', x, y: y + 1.7 * mm, txt: sec, h: 2.2, al: 'c', vb: 'meio', cor: CORES.tinta, fundo: '#ffffff', camada: 'ROTULOS', clip: true });
    } else add({ t: 'texto', x, y, txt: rotuloCurto(p.solo), h: 2.6, al: 'c', vb: 'meio', cor: CORES.tinta, bold: true, fundo: '#ffffff', camada: 'ROTULOS', clip: true });
  });

  // origem não informada no boletim: tracejado ao lado da coluna do furo, no trecho da camada
  const marcados = new Set();
  geo.poligonos.forEach((p) => {
    const m = p.inferida; if (!m) return;
    const k = `${m.furo}|${m.topo.toFixed(3)}|${m.base.toFixed(3)}`; if (marcados.has(k)) return;
    marcados.add(k);
    const x = X(m.d) - 1.2 * mm - 1.1 * mm;
    add({ t: 'linha', pts: [[x, Y(m.topo) + 0.4 * mm], [x, Y(m.base) - 0.4 * mm]], cor: CORES.aviso, lw: 0.6, dash: [1.2, 0.8], camada: 'ORIGEM-NAO-INFORMADA' });
  });

  // ── furos ──
  (P.furos || bhs).forEach((b) => desenharFuro(add, b, { X, Y, mm, mostrar, estilo }));

  // letras do corte
  // (nome "A–A'" → A e A' nas pontas; nome livre, como "SM-03/SM-02", fica só no título)
  const nomeC = corte?.nome || "A–A'";
  if (nomeC.includes('–')) {
    const [n1, n2] = nomeC.split('–');
    add({ t: 'texto', x: fx0 - ex, y: fy0 - 3 * mm, txt: n1 || 'A', h: 4, al: 'c', vb: 'base', cor: CORES.azul, bold: true, camada: 'CORTE' });
    add({ t: 'texto', x: fx1 + ex, y: fy0 - 3 * mm, txt: n2 || "A'", h: 4, al: 'c', vb: 'base', cor: CORES.azul, bold: true, camada: 'CORTE' });
  }
  return fechar(itens, P);
}

/** Camada do DXF para o material: nome do horizonte ou código do solo (+ origem). */
export function camadaMaterial(s, sec) {
  if (ehHorizonte(s.code)) return s.label.toUpperCase().replace(/[^A-Z0-9ÁÂÃÉÊÍÓÔÕÚÇ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return sec ? `${s.code} ${secLabel(sec).toUpperCase()}` : s.code;
}

function desenharFuro(add, b, { X, Y, mm, mostrar, estilo }) {
  const x = X(b.dist), yT = Y(b.cota), prof = b.layers.length ? Math.max(...b.layers.map((l) => l.ate)) : 0;
  const grupo = `FURO:${b.name}`, rw = 1.2 * mm;
  const mista = b.mista || Object.keys(b.rec || {}).length > 0;
  // cabeçalho: nome numa caixa acima do terreno, ligado por uma linha ao topo do furo
  const hN = 3.2, wN = largura(b.name, hN) * mm + 2.4 * mm, yBox = yT - 9 * mm;
  add({ t: 'linha', pts: [[x, yT], [x, yBox]], cor: CORES.tinta, lw: 0.25, camada: 'SONDAGEM', grupo });
  add({ t: 'poli', pts: [[x, yBox - 5 * mm], [x + wN, yBox - 5 * mm], [x + wN, yBox], [x, yBox]], fill: '#ffffff', stroke: CORES.tinta, lw: 0.25, camada: 'SONDAGEM', grupo });
  add({ t: 'texto', x: x + 1.2 * mm, y: yBox - 2.5 * mm, txt: b.name, h: hN, al: 'l', vb: 'meio', cor: CORES.tinta, camada: 'SONDAGEM', grupo, atrib: 'NOME' });
  if (!prof) return;
  if (mostrar.spt) {
    add({ t: 'texto', x: mista ? x - rw - 0.6 * mm : x + rw + 0.6 * mm, y: yT - 1.2 * mm, txt: 'NSPT', h: 1.8, al: mista ? 'r' : 'l', vb: 'base', cor: CORES.tinta, bold: true, camada: 'SONDAGEM', grupo });
    if (mista) add({ t: 'texto', x: x + rw + 0.6 * mm, y: yT - 1.2 * mm, txt: 'REC(%)', h: 1.8, al: 'l', vb: 'base', cor: CORES.tinta, bold: true, camada: 'SONDAGEM', grupo });
  }
  const corEm = (prof) => (b.layers.find((l) => prof > l.de - 1e-9 && prof < l.ate + 1e-9) || b.layers.at(-1)).solo.fill;
  for (let m = 1; m <= Math.ceil(prof - 1e-9); m++) {
    const ya = Y(b.cota - (m - 1)), yb = Y(b.cota - Math.min(m, prof)), hm = yb - ya;
    add({ t: 'poli', pts: [[x - rw, ya], [x + rw, ya], [x + rw, yb], [x - rw, yb]], fill: corEm(m - 0.5), stroke: CORES.tinta, lw: 0.12, camada: 'SONDAGEM', grupo });
    if (m % 2) {
      // metros alternados hachurados (leitura metro a metro na régua)
      const e = 0.7 * mm;
      for (let s = -hm; s < 2 * rw; s += e) {
        const p0 = [x - rw + Math.max(0, s), yb - Math.max(0, -s)];
        const t = Math.min(2 * rw - Math.max(0, s), hm - Math.max(0, -s));
        if (t > 1e-6) add({ t: 'linha', pts: [p0, [p0[0] + t, p0[1] - t]], cor: CORES.tinta, lw: 0.08, camada: 'SONDAGEM', grupo });
      }
    }
    if (!mostrar.spt || hm < 1.6 * mm) continue;
    const h = Math.min(2.2, (hm / mm) * 0.75), yc = (ya + yb) / 2;
    const t = textoSPT(b.sptTexto?.[m], estilo.spt30);
    if (t) add({ t: 'texto', x: mista ? x - rw - 0.6 * mm : x + rw + 0.6 * mm, y: yc, txt: t, h, al: mista ? 'r' : 'l', vb: 'meio', cor: b.spt?.[m] >= 50 ? CORES.vermelho : CORES.tinta, bold: true, camada: 'SONDAGEM', grupo, atrib: `NSPT_${String(m).padStart(2, '0')}` });
    const rec = b.rec?.[m];
    if (mista && rec !== undefined && rec !== '') add({ t: 'texto', x: x + rw + 0.6 * mm, y: yc, txt: `${rec}%`, h, al: 'l', vb: 'meio', cor: CORES.tinta, bold: true, camada: 'SONDAGEM', grupo, atrib: `REC_${String(m).padStart(2, '0')}` });
  }
  if (mostrar.na && b.na > 0) {
    const y = Y(b.cota - b.na), xa = mista ? x + rw + 7 * mm : x - rw - 1 * mm;
    add({ t: 'poli', pts: [[xa - 2.2 * mm, y - 1.7 * mm], [xa, y - 1.7 * mm], [xa - 1.1 * mm, y]], fill: CORES.na, stroke: null, camada: 'NA', grupo });
  }
  if (b.imp) {
    const y = Y(b.cota - prof);
    for (let k = 0; k < 3; k++) add({ t: 'linha', pts: [[x - 2 * mm, y + (1 + k) * mm], [x + 2 * mm, y + (1 + k) * mm]], cor: CORES.vermelho, lw: 0.35, camada: 'SONDAGEM', grupo });
  }
}

/** Título acima do perfil e caixa que envolve tudo. */
function fechar(itens, P) {
  let caixa = caixaDe(itens, P.mm);
  if (P.titulo) {
    const { mm } = P, cx = (P.X(P.janela.d0) + P.X(P.janela.d1)) / 2, y = caixa[1] - 4 * mm;
    const h = 4.2, w = largura(P.titulo.texto, h) * mm;
    itens.push({ t: 'texto', x: cx, y: y - (P.titulo.sub ? 4.5 : 0) * mm, txt: P.titulo.texto, h, al: 'c', vb: 'base', cor: CORES.tinta, camada: 'TITULO' });
    itens.push({ t: 'linha', pts: [[cx - w / 2, y - (P.titulo.sub ? 4.5 : 0) * mm + 1 * mm], [cx + w / 2, y - (P.titulo.sub ? 4.5 : 0) * mm + 1 * mm]], cor: CORES.tinta, lw: 0.3, camada: 'TITULO' });
    if (P.titulo.sub) itens.push({ t: 'texto', x: cx, y, txt: P.titulo.sub, h: 2.4, al: 'c', vb: 'base', cor: CORES.tinta, camada: 'TITULO' });
    caixa = caixaDe(itens, P.mm);
  }
  return { itens, caixa };
}

/** Extensão aproximada dos elementos [x0, y0, x1, y1] (textos pela largura estimada). */
export function caixaDe(itens, mm) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const inc = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  itens.forEach((it) => {
    if (it.pts) it.pts.forEach(([x, y]) => inc(x, y));
    else if (it.t === 'texto') {
      const w = largura(it.txt, it.h) * mm, h = it.h * mm;
      if (it.ang === 90) { inc(it.x - h / 2, it.y - w / 2); inc(it.x + h / 2, it.y + w / 2); return; }
      const xa = it.al === 'r' ? it.x - w : it.al === 'c' ? it.x - w / 2 : it.x;
      inc(xa, it.y - h); inc(xa + w, it.y + h * 0.4);
    }
  });
  return [x0, y0, x1, y1];
}

/**
 * Itens da legenda do perfil: materiais (com cor e hachura) e símbolos usados.
 * @returns [{ tipo: 'material'|'linha'|'bloco'|'rocha'|'regua', fill, solo, sec, cor, dash, texto }]
 */
export function legendaPerfil(bhs, geo, { estilo = {}, naProjeto = null, referencias = [], mostrar = {} } = {}) {
  const vistos = new Map();
  (geo?.poligonos || []).forEach((p) => {
    const k = `${p.solo.code}|${ehHorizonte(p.solo.code) ? '' : p.sec}`;
    if (!vistos.has(k)) vistos.set(k, { tipo: 'material', fill: p.solo.fill, solo: p.solo, sec: ehHorizonte(p.solo.code) ? '' : p.sec, texto: ehHorizonte(p.solo.code) ? p.solo.label : `${p.solo.label}${p.sec ? ` — ${secLabel(p.sec)}` : ''}` });
  });
  const itens = [...vistos.values()];
  if (bhs.some((b) => (b.blocos || []).length)) itens.push({ tipo: 'bloco', fill: soloDe(codigoHorizonte('PED')).fill, texto: 'Pedregulho / blocos' });
  if ((geo?.poligonos || []).some((p) => p.sec === ROCHA_SA || p.solo.horizonte === ROCHA_SA)) itens.push({ tipo: 'rocha', cor: CORES.vermelho, texto: 'Topo rochoso' });
  const semOrigemEm = [...new Set((geo?.poligonos || []).filter((p) => p.inferida).map((p) => p.inferida.furo))];
  if (semOrigemEm.length) itens.push({ tipo: 'linha', cor: CORES.aviso, dash: [1, 0.8], lw: 0.45, texto: `* Sem origem no boletim (${semOrigemEm.join(', ')}): adotada a do furo vizinho` });
  itens.push({ tipo: 'linha', cor: CORES.tinta, lw: 0.5, texto: 'Terreno' });
  if (mostrar.na !== false && (geo?.na || []).length > 1) itens.push({ tipo: 'linha', cor: CORES.na, dash: [2, 1], lw: 0.3, texto: "Nível d'água medido" });
  if (naProjeto !== null && Number.isFinite(naProjeto)) itens.push({ tipo: 'linha', cor: CORES.naProjeto, lw: 0.35, texto: "Nível d'água de projeto" });
  if (referencias.length) itens.push({ tipo: 'linha', cor: CORES.tinta, lw: 0.4, texto: 'Linha de referência de projeto' });
  itens.push({ tipo: 'regua', texto: estilo.spt30 ? 'Sondagem: N-SPT em golpes/30 cm' : 'Sondagem: N-SPT por metro' });
  return itens;
}

/**
 * Legenda em elementos de desenho (mm, origem no canto superior esquerdo).
 * @param entradas itens de legendaPerfil
 * @returns { itens, altura }
 */
export function desenharLegenda(entradas, { x = 0, y = 0, largura = 200, mm = 1, titulo = 'LEGENDA', hachura = true } = {}) {
  const itens = [];
  itens.push({ t: 'texto', x, y: y + 3.2 * mm, txt: titulo, h: 3, al: 'l', vb: 'base', cor: CORES.tinta, bold: true, camada: 'LEGENDA' });
  let cx = x, cy = y + 6 * mm;
  const hT = 2.5, amW = 8 * mm, amH = 3.6 * mm;
  entradas.forEach((e) => {
    const w = amW + 2.5 * mm + largura_(e.texto, hT) * mm + 5 * mm;
    if (cx + w > x + largura && cx > x) { cx = x; cy += 5.6 * mm; }
    const a = cx, b = cy, caixa = [[a, b], [a + amW, b], [a + amW, b + amH], [a, b + amH]];
    if (e.tipo === 'material') itens.push({ t: 'poli', pts: caixa, fill: e.fill, stroke: CORES.cinza, lw: 0.15, hachura: hachura ? { solo: e.solo, sec: e.sec } : null, camada: camadaMaterial(e.solo, e.sec) });
    else if (e.tipo === 'bloco') {
      const f = formaBloco(a + amW / 2, b + amH / 2, amW * 0.42, amH * 0.48, 'legenda');
      itens.push({ t: 'poli', pts: f.pts, fill: e.fill, stroke: CORES.contorno, lw: 0.15, camada: 'LEGENDA' });
    } else if (e.tipo === 'rocha') {
      itens.push({ t: 'linha', pts: [[a, b + amH * 0.4], [a + amW, b + amH * 0.4]], cor: CORES.contorno, lw: 0.18, camada: 'LEGENDA' });
      marcasTopoRochoso([[a, b + amH * 0.4], [a + amW, b + amH * 0.4]], 2 * mm, 1.4 * mm).forEach((s) => itens.push({ t: 'linha', pts: s, cor: e.cor, lw: 0.2, camada: 'LEGENDA' }));
    } else if (e.tipo === 'linha') {
      itens.push({ t: 'linha', pts: [[a, b + amH / 2], [a + amW, b + amH / 2]], cor: e.cor, lw: e.lw || 0.3, dash: e.dash, camada: 'LEGENDA' });
    } else if (e.tipo === 'regua') {
      itens.push({ t: 'poli', pts: [[a + 3 * mm, b], [a + 5 * mm, b], [a + 5 * mm, b + amH], [a + 3 * mm, b + amH]], fill: '#ffffff', stroke: CORES.tinta, lw: 0.12, camada: 'LEGENDA' });
      for (let k = 0; k < 4; k++) itens.push({ t: 'linha', pts: [[a + 3 * mm, b + amH - k * 0.7 * mm], [a + 3 * mm + Math.min(2 * mm, k * 0.7 * mm + 0.7 * mm), b + amH - k * 0.7 * mm - Math.min(2 * mm, k * 0.7 * mm + 0.7 * mm)]], cor: CORES.tinta, lw: 0.08, camada: 'LEGENDA' });
    }
    itens.push({ t: 'texto', x: a + amW + 2.5 * mm, y: b + amH / 2, txt: e.texto, h: hT, al: 'l', vb: 'meio', cor: CORES.tinta, camada: 'LEGENDA' });
    cx += w;
  });
  return { itens, altura: cy + amH - y + 1 * mm };
}
const largura_ = (txt, h) => String(txt).length * h * 0.55;
