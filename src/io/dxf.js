// Exportação DXF R12 (AC1009): planta de locação + perfil do corte ativo.
import { niceStep } from '../geo/zonas.js';
import { geometriaPerfil } from '../geo/perfil2d.js';
import { secLabel } from '../model/catalogo.js';
import { escalaPadrao, escalasPerfil } from './escalas.js';
import { resolverFuro } from '../model/projeto.js';
import { hachuraPoligono, furarHachura, dentro } from './hachura.js';

// DXF R12 é ASCII: sem quebras de linha, sem acentos e sem travessão.
const limpa = (t) => String(t).replace(/[\r\n]+/g, ' ').replace(/[–—]/g, '-')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, '?');

// alinhamento do TEXT: grupo 72 (0 esq, 1 centro, 2 dir) e 73 (0 base, 2 meio)
const ALINHA = { l: [0, 0], c: [1, 0], r: [2, 0], m: [1, 2], ml: [0, 2], mr: [2, 2] };
export const ESTILO = 'GEOPERFIL';

export const D = {
  line: (x1, y1, x2, y2, ly) => `0\nLINE\n8\n${ly}\n10\n${x1.toFixed(4)}\n20\n${y1.toFixed(4)}\n30\n0.0\n11\n${x2.toFixed(4)}\n21\n${y2.toFixed(4)}\n31\n0.0\n`,
  circle: (x, y, r, ly) => `0\nCIRCLE\n8\n${ly}\n10\n${x.toFixed(4)}\n20\n${y.toFixed(4)}\n30\n0.0\n40\n${r.toFixed(4)}\n`,
  text: (t, x, y, h, ly, a = 0, al = 'c') => {
    const [h72, v73] = ALINHA[al] || ALINHA.c;
    const p = `10\n${x.toFixed(4)}\n20\n${y.toFixed(4)}\n30\n0.0\n`;
    return `0\nTEXT\n8\n${ly}\n${p}40\n${h.toFixed(4)}\n1\n${limpa(t)}\n50\n${a.toFixed(1)}\n7\n${ESTILO}\n` +
      (h72 || v73 ? `72\n${h72}\n11\n${x.toFixed(4)}\n21\n${y.toFixed(4)}\n31\n0.0\n73\n${v73}\n` : '');
  },
  poly: (pts, ly, closed = true, ltype = null) => {
    let s = `0\nPOLYLINE\n8\n${ly}\n${ltype ? `6\n${ltype}\n` : ''}66\n1\n70\n${closed ? 1 : 0}\n`;
    pts.forEach(([x, y]) => { s += `0\nVERTEX\n8\n${ly}\n10\n${x.toFixed(4)}\n20\n${y.toFixed(4)}\n30\n0.0\n`; });
    return s + `0\nSEQEND\n8\n${ly}\n`;
  },
  // preenchimento sólido: retângulo (x0,y0)-(x1,y1) ou triângulo
  solido: (pts, ly) => {
    const [a, b, c, d = pts[2]] = pts.length === 4 ? [pts[0], pts[1], pts[3], pts[2]] : pts;
    return `0\nSOLID\n8\n${ly}\n` + [a, b, c, d].map(([x, y], i) => `1${i}\n${x.toFixed(4)}\n2${i}\n${y.toFixed(4)}\n3${i}\n0.0\n`).join('');
  },
};

/** Largura aproximada de um texto em Arial (unidades do desenho). */
export const larguraTexto = (t, h) => String(t).length * h * 0.66;

const soloLy = (solo, sec) => (solo.code + (sec ? '_' + sec : '')).replace(/[^A-Z0-9_]/gi, '').substring(0, 20);

const fmt = (v, d = 2) => v.toFixed(d).replace('.', ',');

/**
 * Gera o texto DXF.
 *
 * O perfil sai no mesmo layout e nas mesmas escalas do PDF A3: X em metros
 * reais, Y com o exagero vertical (1 m de cota = Eh/Ev unidades) e os textos
 * dimensionados para plotar o modelo em 1:Eh. A hachura ganha um vão atrás
 * dos rótulos e da régua de SPT, que no DXF não têm fundo branco.
 *
 * @param projeto projeto v2
 * @param perfil { bhs, ext, maxDist, corte, geo } — do corte ativo, ou bhs vazio
 * @param axis 'cota' | 'prof'
 */
export function gerarDXF(projeto, perfil, axis = 'cota') {
  const furos = projeto.furos.map(resolverFuro);
  const LY = new Map([['TERRENO', 7], ['FRONTEIRAS', 8], ['SPT', 7], ['SPT_TEXTO', 7], ['NA', 5], ['COTAS_Y', 8], ['COTAS_X', 8], ['FUROS', 8], ['FUROS_NOME', 7], ['CORTES', 1], ['IMP', 1], ['ROTULOS', 7], ['LEGENDA', 7]]);
  const camada = (solo, sec) => {
    const n = soloLy(solo, sec);
    if (!LY.has(n)) LY.set(n, 252);
    if (!LY.has(n + '_H')) LY.set(n + '_H', 253);
    return n;
  };

  const { bhs = [], corte = null } = perfil || {};
  const temPerfil = bhs.length >= 2;
  let ent = '';
  let topoPerfil = 0, uPerfil = 0;

  // ── PERFIL ──
  if (temPerfil) {
    const geo = perfil.geo || geometriaPerfil(bhs, { ajustes: corte?.ajustes || {}, modo: corte?.modo || 'interpolado' });
    const { Eh, Ev, exagero, passoC, cTopo, cBase } = escalasPerfil(geo, bhs);
    const u = Eh / 1000, kv = Eh / Ev, mm = (v) => v * u, mmV = 1000 / Ev; // mm de papel por metro de cota
    const X = (d) => d, Y = (c) => (c - cBase) * kv;
    const L = geo.totDist, yTop = Y(cTopo);
    uPerfil = u; topoPerfil = yTop;
    const casas = passoC < 1 ? 1 : 0;

    // régua de SPT de cada furo e a faixa que ela ocupa (sem hachura por baixo)
    const rw = mm(0.9), hSPT = mm(Math.min(2.2, mmV * 0.8)), mostraSPT = mmV >= 1.6;
    const faixas = bhs.map((b) => {
      const prof = b.layers.length ? Math.max(...b.layers.map((l) => l.ate)) : 0;
      const textos = mostraSPT ? Object.values(b.sptTexto || {}) : [];
      const wt = textos.length ? Math.max(...textos.map((t) => larguraTexto(t, hSPT))) + mm(1.2) : mm(0.4);
      return { b, prof, ret: [X(b.dist) - rw - mm(0.4), Y(b.cota - prof) - mm(0.4), X(b.dist) + rw + mm(0.4) + wt, Y(b.cota) + mm(0.4)] };
    });
    const cruza = (r, q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1];

    // posição dos rótulos: dentro do polígono e fora das réguas de SPT
    const hCod = mm(2.5), hSec = mm(2), rotulos = [];
    geo.poligonos.forEach((p, i) => {
      if (p.rotulo.h * mmV < 3.2) return;
      const pts = p.pts.map(([d, c]) => [X(d), Y(c)]);
      const sec = p.sec ? secLabel(p.sec) : '';
      const opcoes = [[p.solo.code, ...(sec && p.rotulo.h * mmV > 7 ? [sec] : [])], [p.solo.code]];
      const cy = Y(p.rotulo.c);
      for (const linhas of opcoes) {
        const W = Math.max(larguraTexto(linhas[0], hCod), linhas[1] ? larguraTexto(linhas[1], hSec) : 0) + mm(2);
        const H = mm(linhas.length * 3 + 1);
        const ok = (cx) => {
          const r = [cx - W / 2, cy - H / 2, cx + W / 2, cy + H / 2], f = mm(0.8);
          const cantos = [[r[0] - f, r[1] - f], [r[2] + f, r[1] - f], [r[2] + f, r[3] + f], [r[0] - f, r[3] + f]];
          return cantos.every(([x, y]) => dentro(x, y, pts)) && !faixas.some((f) => cruza(r, f.ret)) && !rotulos.some((o) => cruza(r, o.ret)) ? r : null;
        };
        const passo = Math.max(W / 4, 0.5);
        for (let k = 0; k <= 16; k++) {
          const cx = X(p.rotulo.d) + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * passo;
          const r = ok(cx);
          if (r) { rotulos.push({ i, linhas, cx, cy, ret: r }); return; }
        }
      }
    });

    // grade e eixo de cotas
    for (let c = cBase; c <= cTopo + 1e-9; c += passoC) {
      ent += D.line(X(0) - mm(4), Y(c), X(0) - mm(2), Y(c), 'COTAS_Y');
      ent += D.text(fmt(axis === 'cota' ? c : cTopo - c, casas), X(0) - mm(5), Y(c), mm(2.2), 'COTAS_Y', 0, 'mr');
    }
    ent += D.line(X(0) - mm(2), Y(cBase), X(0) - mm(2), Y(cTopo), 'COTAS_Y');
    ent += D.text(axis === 'cota' ? 'Cota (m)' : 'Profundidade (m)', X(0) - mm(16), (yTop) / 2, mm(2.5), 'COTAS_Y', 90, 'm');

    // camadas, hachura com vãos e contornos
    const vaos = [...faixas.map((f) => f.ret), ...rotulos.map((r) => r.ret)];
    geo.poligonos.forEach((p) => {
      const ln = camada(p.solo, p.sec);
      const pts = p.pts.map(([d, c]) => [X(d), Y(c)]);
      const { linhas, pontos } = furarHachura(hachuraPoligono(pts, p.solo, p.sec, 1.3 * u), vaos);
      ent += linhas.map(([x1, y1, x2, y2]) => D.line(x1, y1, x2, y2, ln + '_H')).join('');
      ent += pontos.map(([x, y]) => D.circle(x, y, mm(0.15), ln + '_H')).join('');
      ent += D.poly(pts, 'FRONTEIRAS', true);
    });
    rotulos.forEach(({ linhas, cx, cy }) => {
      if (linhas.length === 1) ent += D.text(linhas[0], cx, cy, hCod, 'ROTULOS', 0, 'm');
      else {
        ent += D.text(linhas[0], cx, cy + mm(1.5), hCod, 'ROTULOS', 0, 'm');
        ent += D.text(linhas[1], cx, cy - mm(1.6), hSec, 'ROTULOS', 0, 'm');
      }
    });

    // terreno e NA
    ent += D.poly(geo.terreno.map(([d, c]) => [X(d), Y(c)]), 'TERRENO', false);
    if (geo.na.length > 1) ent += D.poly(geo.na.map(([d, c]) => [X(d), Y(c)]), 'NA', false, 'TRACEJADA');

    // nome/cota no topo e "d =" embaixo: furos próximos vão para outra linha
    const escalonar = (larg, folga) => {
      const fins = [], linha = new Map();
      [...bhs].sort((p, q) => p.dist - q.dist).forEach((b) => {
        const w = larg(b), x0 = X(b.dist) - w / 2;
        let k = fins.findIndex((f) => x0 > f + folga);
        if (k < 0) k = fins.length;
        fins[k] = X(b.dist) + w / 2; linha.set(b, k);
      });
      return linha;
    };
    const cab = escalonar((b) => Math.max(larguraTexto(b.name, mm(3)), larguraTexto(`${fmt(b.cota)} m`, mm(2.2))), mm(2));
    const dd = escalonar((b) => larguraTexto(`d = ${fmt(b.dist, 1)} m`, mm(2.2)), mm(2));
    const linhaCab = (b) => cab.get(b), linhaD = (b) => dd.get(b);
    const sobe = mm(8.5 * Math.max(...cab.values())), desce = mm(3.5 * Math.max(...dd.values()));
    topoPerfil = yTop + sobe;

    // furos: linha de chamada, régua de SPT, N, NA, impenetrável, nome e cota
    faixas.forEach(({ b, prof }) => {
      const x = X(b.dist);
      ent += D.line(x, Y(b.cota), x, yTop + mm(3), 'FUROS');
      for (let m = 1; m <= Math.ceil(prof); m++) {
        const ya = Y(b.cota - (m - 1)), yb = Y(b.cota - Math.min(m, prof));
        const ret = [[x - rw, yb], [x + rw, yb], [x + rw, ya], [x - rw, ya]];
        ent += D.poly(ret, 'SPT', true);
        if (m % 2) ent += D.solido(ret, 'SPT');
        const t = b.sptTexto?.[m];
        if (t !== undefined && mostraSPT) ent += D.text(t, x + rw + mm(0.8), (ya + yb) / 2, hSPT, b.spt[m] >= 50 ? 'IMP' : 'SPT_TEXTO', 0, 'ml');
      }
      if (b.na > 0) {
        const y = Y(b.cota - b.na);
        ent += D.solido([[x - mm(3.4), y + mm(1.7)], [x - mm(1.4), y + mm(1.7)], [x - mm(2.4), y]], 'NA');
      }
      if (b.imp) {
        const y = Y(b.cota - prof);
        for (let k = 0; k < 3; k++) ent += D.line(x - mm(2), y - mm(1 + k), x + mm(2), y - mm(1 + k), 'IMP');
      }
      const lc = linhaCab(b), ld = linhaD(b);
      ent += D.text(b.name, x, yTop + mm(8.5 + 8.5 * lc), mm(3), 'FUROS_NOME', 0, 'c');
      ent += D.text(`${fmt(b.cota)} m`, x, yTop + mm(4.5 + 8.5 * lc), mm(2.2), 'COTAS_Y', 0, 'c');
      ent += D.text(`d = ${fmt(b.dist, 1)} m`, x, -mm(8.5 + 3.5 * ld), mm(2.2), 'COTAS_X', 0, 'c');
    });

    // eixo de distâncias
    const passoD = niceStep(L / 8 || 1);
    ent += D.line(X(0), 0, X(L), 0, 'COTAS_X');
    for (let d = 0; d <= L + 1e-9; d += passoD) {
      ent += D.line(X(d), 0, X(d), -mm(1.5), 'COTAS_X');
      ent += D.text(fmt(d, 0), X(d), -mm(4.8), mm(2.2), 'COTAS_X', 0, 'c');
    }
    ent += D.text('Distancia (m)', X(L) / 2, -mm(13) - desce, mm(2.5), 'COTAS_X', 0, 'c');

    // título, corte e escalas
    const [n1, n2] = (corte?.nome || "A–A'").split('–');
    ent += D.text(n1 || 'A', X(0) - mm(3), yTop + sobe + mm(13), mm(4), 'CORTES', 0, 'r');
    ent += D.text(n2 || "A'", X(L) + mm(3), yTop + sobe + mm(13), mm(4), 'CORTES', 0, 'l');
    ent += D.text('PERFIL GEOLOGICO - CORTE ' + (corte?.nome || ''), X(0) - mm(20), yTop + sobe + mm(24), mm(4), 'LEGENDA', 0, 'l');
    ent += D.text(`Escala horizontal 1:${Eh} - vertical 1:${Ev} (exagero vertical ${fmt(exagero, exagero % 1 ? 1 : 0)}x). Plotar o modelo em 1:${Eh}.`,
      X(0) - mm(20), yTop + sobe + mm(19), mm(2.2), 'LEGENDA', 0, 'l');

    // legenda e escala gráfica, abaixo do perfil
    const solos = [...new Map(geo.poligonos.map((p) => [p.solo.code, p.solo])).values()];
    const secs = [...new Set(geo.poligonos.map((p) => p.sec).filter(Boolean))];
    const larg = Math.max(X(L), mm(200));
    let lx = X(0) - mm(20), ly = -mm(22) - desce;
    ent += D.text('LEGENDA', lx, ly, mm(2.8), 'LEGENDA', 0, 'l');
    ly -= mm(6);
    const item = (desenho, texto) => {
      const tw = larguraTexto(limpa(texto), mm(2)) + mm(14);
      if (lx + tw > X(0) - mm(20) + larg) { lx = X(0) - mm(20); ly -= mm(6); }
      desenho(lx, ly); ent += D.text(texto, lx + mm(10), ly + mm(1.8), mm(2), 'LEGENDA', 0, 'ml'); lx += tw + mm(3);
    };
    const amostra = (a, b) => [[a, b], [a + mm(8), b], [a + mm(8), b + mm(3.6)], [a, b + mm(3.6)]];
    solos.forEach((s) => item((a, b) => {
      const ln = camada(s, ''), pts = amostra(a, b);
      ent += D.poly(pts, 'LEGENDA', true);
      const { linhas, pontos } = hachuraPoligono(pts, s, '', 1.3 * u);
      ent += linhas.map(([x1, y1, x2, y2]) => D.line(x1, y1, x2, y2, ln + '_H')).join('');
      ent += pontos.map(([x, y]) => D.circle(x, y, mm(0.15), ln + '_H')).join('');
    }, s.label));
    secs.forEach((sec) => item((a, b) => {
      const ln = camada({ code: 'SEC' }, sec), pts = amostra(a, b);
      ent += D.poly(pts, 'LEGENDA', true);
      ent += hachuraPoligono(pts, { hatch: '' }, sec, 1.3 * u).linhas.map(([x1, y1, x2, y2]) => D.line(x1, y1, x2, y2, ln + '_H')).join('');
    }, secLabel(sec)));
    item((a, b) => { ent += D.line(a, b + mm(1.8), a + mm(8), b + mm(1.8), 'TERRENO'); }, 'Terreno');
    item((a, b) => { ent += D.poly([[a, b + mm(1.8)], [a + mm(8), b + mm(1.8)]], 'NA', false, 'TRACEJADA'); }, "Nivel d'agua");
    item((a, b) => {
      const r1 = [[a + mm(3), b + mm(1.8)], [a + mm(5), b + mm(1.8)], [a + mm(5), b + mm(3.6)], [a + mm(3), b + mm(3.6)]];
      ent += D.solido(r1, 'SPT') + D.poly([[a + mm(3), b], [a + mm(5), b], [a + mm(5), b + mm(3.6)], [a + mm(3), b + mm(3.6)]], 'SPT', true);
    }, 'Regua de SPT (N por metro)');
    item((a, b) => { for (let k = 0; k < 3; k++) ent += D.line(a + mm(2), b + mm(0.8 + k), a + mm(6), b + mm(0.8 + k), 'IMP'); }, 'Impenetravel');

    const em = niceStep((40 * Eh) / 1000), emm = mm((em * 1000) / Eh), ex = X(0) - mm(20), ey = ly - mm(10);
    for (let i = 0; i < 4; i++) {
      const r = [[ex + (i * emm) / 4, ey], [ex + ((i + 1) * emm) / 4, ey], [ex + ((i + 1) * emm) / 4, ey + mm(1.5)], [ex + (i * emm) / 4, ey + mm(1.5)]];
      ent += D.poly(r, 'LEGENDA', true);
      if (i % 2 === 0) ent += D.solido(r, 'LEGENDA');
    }
    ent += D.text('0', ex, ey + mm(2.5), mm(2), 'LEGENDA', 0, 'c');
    ent += D.text(`${fmt(em, em < 10 ? 1 : 0)} m`, ex + emm, ey + mm(2.5), mm(2), 'LEGENDA', 0, 'c');
    ent += D.text(`Escala horizontal 1:${Eh}`, ex + emm + mm(6), ey + mm(0.75), mm(2), 'LEGENDA', 0, 'ml');
  }

  // ── PLANTA ── em metros reais, deslocada para ficar acima do perfil; o deslocamento vai anotado.
  if (furos.length) {
    const xs = [...furos.map((b) => b.x), ...projeto.cortes.flatMap((c) => [c.p1[0], c.p2[0]])];
    const ys = [...furos.map((b) => b.y), ...projeto.cortes.flatMap((c) => [c.p1[1], c.p2[1]])];
    const extP = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
    const up = escalaPadrao(extP * 1.2, 250) / 1000, pm = (v) => v * up;
    const dX = -Math.min(...xs), dY = (temPerfil ? topoPerfil + uPerfil * 45 : 0) + pm(12) - Math.min(...ys);
    const T = (x, y) => [x + dX, y + dY];
    const topo = Math.max(...ys) + dY;
    ent += D.text('PLANTA DE LOCACAO', 0, topo + pm(14), pm(4), 'LEGENDA', 0, 'l');
    ent += D.text(`Coordenadas deslocadas: X real = X ${dX >= 0 ? '-' : '+'} ${Math.abs(dX).toFixed(3)} ; Y real = Y ${dY >= 0 ? '-' : '+'} ${Math.abs(dY).toFixed(3)}. Textos para plotar em 1:${Math.round(up * 1000)}.`, 0, topo + pm(9), pm(2.2), 'LEGENDA', 0, 'l');
    furos.forEach((b) => {
      const [x, y] = T(b.x, b.y);
      ent += D.circle(x, y, pm(1.2), 'FUROS');
      ent += D.text(b.name, x + pm(2), y + pm(0.6), pm(2.5), 'FUROS_NOME', 0, 'l');
      if (b.cota) ent += D.text(`${fmt(b.cota)} m`, x + pm(2), y - pm(2.6), pm(2), 'COTAS_Y', 0, 'l');
    });
    projeto.cortes.forEach((c) => {
      const [x1, y1] = T(...c.p1), [x2, y2] = T(...c.p2);
      ent += D.line(x1, y1, x2, y2, 'CORTES');
      const [n1, n2] = c.nome.split('–');
      const len = Math.hypot(x2 - x1, y2 - y1) || 1, nx = (x2 - x1) / len, ny = (y2 - y1) / len;
      const px = -ny * c.lado, py = nx * c.lado;
      ent += D.text(n1 || 'A', x1 - nx * pm(4), y1 - ny * pm(4), pm(3.5), 'CORTES', 0, 'm');
      ent += D.text(n2 || "A'", x2 + nx * pm(4), y2 + ny * pm(4), pm(3.5), 'CORTES', 0, 'm');
      [[x1, y1], [x2, y2]].forEach(([x, y]) => { ent += D.line(x, y, x + px * pm(5), y + py * pm(5), 'CORTES'); });
    });
  }

  let dxf = '0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n9\n$INSUNITS\n70\n6\n0\nENDSEC\n';
  dxf += '0\nSECTION\n2\nTABLES\n';
  const tr = uPerfil || 0.1;
  dxf += '0\nTABLE\n2\nLTYPE\n70\n2\n0\nLTYPE\n2\nCONTINUOUS\n70\n0\n3\nSolid line\n72\n65\n73\n0\n40\n0.0\n' +
    `0\nLTYPE\n2\nTRACEJADA\n70\n0\n3\n__ __ __\n72\n65\n73\n2\n40\n${(3 * tr).toFixed(4)}\n49\n${(2 * tr).toFixed(4)}\n49\n${(-1 * tr).toFixed(4)}\n0\nENDTAB\n`;
  dxf += '0\nTABLE\n2\nLAYER\n70\n' + LY.size + '\n';
  LY.forEach((color, name) => { dxf += `0\nLAYER\n2\n${name}\n70\n0\n62\n${color}\n6\nCONTINUOUS\n`; });
  dxf += '0\nENDTAB\n';
  dxf += `0\nTABLE\n2\nSTYLE\n70\n1\n0\nSTYLE\n2\n${ESTILO}\n70\n0\n40\n0.0\n41\n1.0\n50\n0.0\n71\n0\n42\n2.5\n3\narial.ttf\n4\n\n0\nENDTAB\n`;
  dxf += '0\nENDSEC\n0\nSECTION\n2\nENTITIES\n' + ent + '0\nENDSEC\n0\nEOF\n';
  return dxf;
}
