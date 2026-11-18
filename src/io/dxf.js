// Exportação DXF R12 (AC1009): planta de locação + perfil do corte ativo.
import { buildZones, cotasContato, niceStep } from '../geo/zonas.js';
import { SEC } from '../model/catalogo.js';
import { resolverFuro } from '../model/projeto.js';

// DXF R12 é ASCII: sem quebras de linha, sem acentos e sem travessão.
const limpa = (t) => String(t).replace(/[\r\n]+/g, ' ').replace(/[–—]/g, '-')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, '?');

export const D = {
  line: (x1, y1, x2, y2, ly) => `0\nLINE\n8\n${ly}\n10\n${x1.toFixed(4)}\n20\n${y1.toFixed(4)}\n30\n0.0\n11\n${x2.toFixed(4)}\n21\n${y2.toFixed(4)}\n31\n0.0\n`,
  circle: (x, y, r, ly) => `0\nCIRCLE\n8\n${ly}\n10\n${x.toFixed(4)}\n20\n${y.toFixed(4)}\n30\n0.0\n40\n${r.toFixed(4)}\n`,
  text: (t, x, y, h, ly, a = 0) => `0\nTEXT\n8\n${ly}\n10\n${x.toFixed(4)}\n20\n${y.toFixed(4)}\n30\n0.0\n40\n${h.toFixed(4)}\n1\n${limpa(t)}\n50\n${a.toFixed(1)}\n72\n1\n11\n${x.toFixed(4)}\n21\n${y.toFixed(4)}\n`,
  poly: (pts, ly, closed = true) => {
    let s = `0\nPOLYLINE\n8\n${ly}\n66\n1\n70\n${closed ? 1 : 0}\n`;
    pts.forEach(([x, y]) => { s += `0\nVERTEX\n8\n${ly}\n10\n${x.toFixed(4)}\n20\n${y.toFixed(4)}\n30\n0.0\n`; });
    return s + `0\nSEQEND\n8\n${ly}\n`;
  },
};

/** Recorte de segmento a um retângulo (Cohen–Sutherland). */
export function clipLR(x1, y1, x2, y2, xmn, ymn, xmx, ymx) {
  const c = (p) => { let v = 0; if (p[0] < xmn) v |= 1; else if (p[0] > xmx) v |= 2; if (p[1] < ymn) v |= 4; else if (p[1] > ymx) v |= 8; return v; };
  let a = [x1, y1], b = [x2, y2], ca = c(a), cb = c(b);
  for (let i = 0; i < 8; i++) {
    if (!(ca | cb)) return [a[0], a[1], b[0], b[1]];
    if (ca & cb) return null;
    const oc = ca || cb;
    let x, y;
    if (oc & 8) { x = a[0] + ((b[0] - a[0]) * (ymx - a[1])) / (b[1] - a[1]) || a[0]; y = ymx; }
    else if (oc & 4) { x = a[0] + ((b[0] - a[0]) * (ymn - a[1])) / (b[1] - a[1]) || a[0]; y = ymn; }
    else if (oc & 2) { y = a[1] + ((b[1] - a[1]) * (xmx - a[0])) / (b[0] - a[0]) || a[1]; x = xmx; }
    else { y = a[1] + ((b[1] - a[1]) * (xmn - a[0])) / (b[0] - a[0]) || a[1]; x = xmn; }
    if (oc === ca) { a = [x, y]; ca = c(a); } else { b = [x, y]; cb = c(b); }
  }
  return null;
}

function hatchLines(x0, y0, x1, y1, ly, angleDeg, spacing) {
  let s = '';
  const w = x1 - x0, h = y1 - y0, diag = Math.sqrt(w * w + h * h);
  const rad = (angleDeg * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const steps = Math.ceil(diag / spacing) + 2;
  for (let k = -steps; k <= steps; k++) {
    const ox = k * spacing * cos, oy = k * spacing * sin;
    const cl = clipLR(ox - sin * diag * 2 + x0, oy + cos * diag * 2 + y0, ox + sin * diag * 2 + x0, oy - cos * diag * 2 + y0, x0, y0, x1, y1);
    if (cl) s += D.line(cl[0], cl[1], cl[2], cl[3], ly);
  }
  return s;
}
function hatchDots(x0, y0, x1, y1, ly, sp = 1.5) {
  let s = '';
  const r = sp * 0.08;
  for (let x = x0 + sp / 2; x < x1; x += sp)
    for (let y = y0 + sp / 2; y < y1; y += sp) { s += D.line(x - r, y, x + r, y, ly); s += D.line(x, y - r, x, y + r, ly); }
  return s;
}
function hatchZone(x0, y0, x1, y1, solo, sec, hl) {
  let s = '';
  if (solo.hatch === 'argila') s += hatchLines(x0, y0, x1, y1, hl, 0, 1.0);
  else if (solo.hatch === 'silte') s += hatchLines(x0, y0, x1, y1, hl, 45, 1.0);
  else if (solo.hatch === 'areia') s += hatchDots(x0, y0, x1, y1, hl, 1.2);
  else if (solo.hatch === 'pedregulho') { s += hatchLines(x0, y0, x1, y1, hl, 0, 1.3); s += hatchLines(x0, y0, x1, y1, hl, 90, 1.3); }
  if (sec === 'ATR') s += hatchLines(x0, y0, x1, y1, hl, 90, 1.8);
  else if (sec === 'RES') s += hatchLines(x0, y0, x1, y1, hl, 135, 2.0);
  else if (sec === 'RFR') { s += hatchLines(x0, y0, x1, y1, hl, 45, 1.2); s += hatchLines(x0, y0, x1, y1, hl, 135, 1.2); }
  else if (sec === 'RSA') s += hatchLines(x0, y0, x1, y1, hl, 0, 0.4);
  return s;
}
const soloLy = (solo, sec) => (solo.code + (sec ? '_' + sec : '')).replace(/[^A-Z0-9_]/gi, '').substring(0, 20);

/**
 * Gera o texto DXF.
 * @param projeto projeto v2
 * @param perfil { bhs, ext: {minCota, maxCota}, maxDist, corte } — do corte ativo, ou bhs vazio
 * @param axis 'cota' | 'prof'
 */
export function gerarDXF(projeto, perfil, axis = 'cota') {
  const furos = projeto.furos.map(resolverFuro);
  const LY = new Map([['TERRENO', 7], ['FRONTEIRAS', 8], ['SPT', 7], ['SPT_HATCH', 8], ['SPT_TEXTO', 7], ['NA', 5], ['COTAS_Y', 8], ['COTAS_X', 8], ['FUROS', 5], ['FUROS_NOME', 7], ['CORTES', 1], ['IMP', 1], ['BORDA', 7], ['LEGENDA', 7]]);
  furos.forEach((b) => b.layers.forEach((l) => {
    const n = soloLy(l.solo, l.sec);
    if (!LY.has(n)) LY.set(n, 252);
    if (!LY.has(n + '_H')) LY.set(n + '_H', 253);
    const n0 = soloLy(l.solo, '');
    if (!LY.has(n0)) LY.set(n0, 252);
    if (!LY.has(n0 + '_H')) LY.set(n0 + '_H', 253);
  }));

  let dxf = '0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n9\n$INSUNITS\n70\n6\n0\nENDSEC\n';
  dxf += '0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n' + LY.size + '\n';
  LY.forEach((color, name) => { dxf += `0\nLAYER\n2\n${name}\n70\n0\n62\n${color}\n6\nCONTINUOUS\n`; });
  dxf += '0\nENDTAB\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n';
  let ent = '';

  const { bhs = [], ext = { minCota: 0, maxCota: 0 }, maxDist: totDist = 0, corte = null } = perfil || {};
  const temPerfil = bhs.length >= 2;

  // ── PLANTA ── deslocada para ficar acima do perfil; o deslocamento vai anotado.
  if (furos.length) {
    const xs = [...furos.map((b) => b.x), ...projeto.cortes.flatMap((c) => [c.p1[0], c.p2[0]])];
    const ys = [...furos.map((b) => b.y), ...projeto.cortes.flatMap((c) => [c.p1[1], c.p2[1]])];
    const dX = -Math.min(...xs), dY = (temPerfil ? ext.maxCota + 30 : 0) - Math.min(...ys);
    const T = (x, y) => [x + dX, y + dY];
    const topo = Math.max(...ys) + dY;
    ent += D.text('PLANTA DE LOCACAO', 0, topo + 10, 3, 'LEGENDA');
    ent += D.text(`Coordenadas deslocadas: X real = X ${dX >= 0 ? '-' : '+'} ${Math.abs(dX).toFixed(3)} ; Y real = Y ${dY >= 0 ? '-' : '+'} ${Math.abs(dY).toFixed(3)}`, 0, topo + 6, 1.2, 'LEGENDA');
    furos.forEach((b) => {
      const [x, y] = T(b.x, b.y);
      ent += D.circle(x, y, 2.5, 'FUROS');
      ent += D.text(b.name, x, y + 3.5, 1.8, 'FUROS_NOME');
      if (b.cota) ent += D.text(b.cota.toFixed(2) + 'm', x, y - 4.5, 1.1, 'COTAS_Y');
    });
    projeto.cortes.forEach((c) => {
      const [x1, y1] = T(...c.p1), [x2, y2] = T(...c.p2);
      ent += D.line(x1, y1, x2, y2, 'CORTES');
      const [n1, n2] = c.nome.split('–');
      ent += D.text(n1 || 'A', x1 - 4, y1, 2.5, 'CORTES');
      ent += D.text(n2 || "A'", x2 + 4, y2, 2.5, 'CORTES');
      const len = Math.hypot(x2 - x1, y2 - y1) || 1, nx = (x2 - x1) / len, ny = (y2 - y1) / len;
      const px = -ny * c.lado, py = nx * c.lado;
      [[x1, y1], [x2, y2]].forEach(([x, y]) => { ent += D.line(x, y, x + px * 6, y + py * 6, 'CORTES'); });
    });
  }

  // ── PERFIL ──
  if (temPerfil) {
    const { minCota, maxCota } = ext;
    ent += D.text('PERFIL GEOLOGICO - CORTE ' + (corte?.nome || ''), 0, maxCota + 7, 2.5, 'LEGENDA');
    ent += D.poly([[0, minCota], [totDist, minCota], [totDist, maxCota], [0, maxCota]], 'BORDA', true);

    for (let i = 0; i < bhs.length - 1; i++) {
      const A = bhs[i], B = bhs[i + 1];
      if (!A.layers.length || !B.layers.length) continue;
      const xA = A.dist, xB = B.dist, xM = (xA + xB) / 2;
      buildZones(A, B).forEach((z) => {
        const yT = z.cTop, yB = z.cBot;
        const drawZ = (x0, x1, solo, sec) => {
          const ln = soloLy(solo, sec);
          ent += D.poly([[x0, yB], [x1, yB], [x1, yT], [x0, yT]], ln, true);
          ent += hatchZone(x0, yB, x1, yT, solo, sec, ln + '_H');
          const cx = (x0 + x1) / 2, cy = (yT + yB) / 2, h = yT - yB, fs = Math.min(1.2, h * 0.22);
          if (h > 1 && fs > 0.3) {
            ent += D.text(solo.code, cx, cy + (h > 2 ? 0.5 : 0), fs, 'SPT_TEXTO');
            const sl = SEC.find((s) => s.value === sec);
            if (sl && sec && h > 2) ent += D.text(sl.label, cx, cy - 0.5, fs * 0.75, 'SPT_TEXTO');
          }
        };
        if (z.sameP && z.sameS) drawZ(xA, xB, z.lA.solo, z.lA.sec);
        else {
          if (z.lA) drawZ(xA, xM, z.lA.solo, z.lA.sec);
          if (z.lB) drawZ(xM, xB, z.lB.solo, z.lB.sec);
          ent += D.line(xM, yT, xM, yB, 'FRONTEIRAS');
        }
      });
      cotasContato(A, B).forEach((c) => {
        const isA = A.layers.some((l) => Math.abs(A.cota - l.ate - c) < 0.001), isB = B.layers.some((l) => Math.abs(B.cota - l.ate - c) < 0.001);
        if (isA || isB) ent += D.line(isA ? xA : xM, c, isB ? xB : xM, c, 'FRONTEIRAS');
      });
    }
    bhs.forEach((b, i) => { if (i) { const p = bhs[i - 1]; ent += D.line(p.dist, p.cota, b.dist, b.cota, 'TERRENO'); } });
    for (let i = 0; i < bhs.length - 1; i++) {
      const a = bhs[i], b = bhs[i + 1];
      ent += D.line(a.dist, a.cota - a.na, b.dist, b.cota - b.na, 'NA');
    }
    bhs.forEach((b) => {
      const y = b.cota - b.na;
      for (let k = 0; k < 3; k++) ent += D.line(b.dist - (2 - k * 0.5), y - k * 0.6, b.dist + (2 - k * 0.5), y - k * 0.6, 'NA');
    });
    bhs.forEach((b) => {
      if (!b.layers.length) return;
      const td = Math.max(...b.layers.map((l) => l.ate)), rx = b.dist, RW = 0.5;
      for (let m = 1; m <= Math.ceil(td); m++) {
        const yT = b.cota - (m - 1), yB = b.cota - m;
        ent += D.poly([[rx - RW, yB], [rx + RW, yB], [rx + RW, yT], [rx - RW, yT]], 'SPT', true);
        if (m % 2 === 1) ent += hatchLines(rx - RW, yB, rx + RW, yT, 'SPT_HATCH', 90, 0.12);
        const n = b.spt[m];
        if (n !== undefined) ent += D.text(n >= 50 ? 'IMP' : String(n), rx + RW + 0.3, (yT + yB) / 2 - 0.15, 0.5, n >= 50 ? 'IMP' : 'SPT_TEXTO');
      }
      const lastM = Math.ceil(td);
      if (b.spt[lastM] >= 50 || b.spt[lastM - 1] >= 50) {
        const yBase = b.cota - td;
        for (let k = 0; k < 3; k++) ent += D.line(rx - 0.8, yBase - 0.5 - k * 0.5, rx + 0.8, yBase - 0.5 - k * 0.5, 'IMP');
        ent += D.text('IMP', rx + 1, yBase - 0.8, 0.7, 'IMP');
      }
    });
    const yStep = niceStep((maxCota - minCota) / 8);
    for (let c = Math.ceil(minCota); c <= Math.floor(maxCota); c++) {
      const isMaj = c % yStep === 0;
      ent += D.line(isMaj ? -1.5 : -0.5, c, 0, c, 'COTAS_Y');
      const lbl = axis === 'cota' ? c + 'm' : Math.round(maxCota - c) + 'm';
      ent += isMaj ? D.text(lbl, -2.5, c - 0.2, 0.9, 'COTAS_Y') : D.text(lbl, -1.2, c - 0.15, 0.5, 'COTAS_Y');
    }
    ent += D.text(axis === 'cota' ? 'Cota (m)' : 'Profundidade (m)', -9, (minCota + maxCota) / 2, 1.1, 'COTAS_Y', 90);
    const xStep = niceStep(totDist / 8);
    for (let d = 0; d <= totDist + 0.1; d += xStep) {
      ent += D.line(d, minCota - 0.5, d, minCota, 'COTAS_X');
      ent += D.text(d.toFixed(0) + 'm', d, minCota - 1.8, 0.85, 'COTAS_X');
    }
    ent += D.text('Distancia (m)', totDist / 2, minCota - 3.5, 1.1, 'COTAS_X');
    bhs.forEach((b) => {
      ent += D.line(b.dist, b.cota, b.dist, maxCota + 2, 'FUROS_NOME');
      ent += D.text(b.name, b.dist, maxCota + 2.5, 1.6, 'FUROS_NOME');
      if (b.cota) ent += D.text(b.cota.toFixed(1) + 'm', b.dist, maxCota + 0.8, 1.0, 'COTAS_Y');
      ent += D.text('d=' + b.dist.toFixed(0) + 'm', b.dist, minCota - 5, 0.85, 'COTAS_X');
    });
    const [n1, n2] = (corte?.nome || "A–A'").split('–');
    ent += D.text(n1 || 'A', 0, maxCota + 4.5, 2.5, 'BORDA');
    ent += D.text(n2 || "A'", totDist, maxCota + 4.5, 2.5, 'BORDA');
    // legenda
    const seen = new Map();
    bhs.forEach((b) => b.layers.forEach((l) => seen.set(l.solo.code, l.solo)));
    const legX = totDist + 8;
    let legY = maxCota + 2;
    ent += D.text('LEGENDA', legX + 2, legY, 2, 'LEGENDA');
    legY -= 3;
    [...seen.values()].forEach((s) => {
      ent += D.poly([[legX, legY - 2.5], [legX + 5, legY - 2.5], [legX + 5, legY], [legX, legY]], soloLy(s, ''), true);
      ent += hatchZone(legX, legY - 2.5, legX + 5, legY, s, '', soloLy(s, '') + '_H');
      ent += D.text((s.code + ' - ' + (s.label.split('—')[1]?.trim() || s.label)).substring(0, 30), legX + 6, legY - 1.6, 1.0, 'LEGENDA');
      legY -= 3.5;
    });
  }

  dxf += ent + '0\nENDSEC\n0\nEOF\n';
  return dxf;
}
