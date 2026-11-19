// PDF do perfil geotécnico (A3 paisagem): desenho em escala, carimbo e legenda.
import { jsPDF } from 'jspdf';
import { niceStep } from '../geo/zonas.js';
import { geometriaPerfil } from '../geo/perfil2d.js';
import { hachuraPoligono } from './hachura.js';
import { secLabel } from '../model/catalogo.js';
import { utmParaGeo, ehGeorreferenciado } from '../geo/coordenadas.js';
import { escalasPerfil } from './escalas.js';

export { escalaPadrao, escolherEscalas, escalasPerfil } from './escalas.js';

const AZUL = [21, 102, 209], CINZA = [110, 110, 105], TINTA = [26, 26, 26], VERMELHO = [163, 45, 45];
const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '—');

/**
 * Gera o PDF do perfil.
 * @param projeto projeto
 * @param perfil { bhs, ext, corte, geo? }
 * @param opcoes { axis: 'cota'|'prof', modo, data }
 */
export function gerarPerfilPDF(projeto, perfil, { axis = 'cota', modo = perfil.corte?.modo || 'interpolado', data = new Date() } = {}) {
  const { bhs, corte } = perfil;
  if (!bhs || bhs.length < 2) throw new Error('O corte precisa de pelo menos 2 furos para gerar o perfil.');
  const geo = perfil.geo || geometriaPerfil(bhs, { ajustes: corte?.ajustes || {}, modo });
  const doc = new jsPDF({ unit: 'mm', format: 'a3', orientation: 'landscape' });
  const PW = 420, PH = 297, M = 10;

  // área do desenho (acima do carimbo)
  const carH = 46, areaX0 = M + 20, areaX1 = PW - M - 14, areaY0 = M + 20, areaY1 = PH - M - carH - 16;
  const { Eh, Ev, passoC, cTopo, cBase } = escalasPerfil(geo, bhs, areaX1 - areaX0, areaY1 - areaY0);
  const exagero = Eh / Ev;
  const kx = 1000 / Eh, ky = 1000 / Ev; // mm por metro
  const larg = geo.totDist * kx, x0 = areaX0 + Math.max(0, (areaX1 - areaX0 - larg) / 2);
  const X = (d) => x0 + d * kx, Y = (c) => areaY0 + (cTopo - c) * ky;

  // moldura
  doc.setDrawColor(...TINTA); doc.setLineWidth(0.5); doc.rect(M, M, PW - 2 * M, PH - 2 * M);

  // grade e eixo de cotas
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
  for (let c = cBase; c <= cTopo + 1e-9; c += passoC) {
    doc.setDrawColor(225, 225, 220); doc.setLineWidth(0.1); doc.line(X(0) - 2, Y(c), X(geo.totDist) + 2, Y(c));
    doc.setDrawColor(...CINZA); doc.setLineWidth(0.2); doc.line(X(0) - 4, Y(c), X(0) - 2, Y(c));
    doc.setTextColor(...CINZA);
    doc.text(axis === 'cota' ? fmt(c, passoC < 1 ? 1 : 0) : fmt(cTopo - c, passoC < 1 ? 1 : 0), X(0) - 5, Y(c) + 1, { align: 'right' });
  }
  doc.setFontSize(7.5); doc.setTextColor(...TINTA);
  doc.text(axis === 'cota' ? 'Cota (m)' : 'Profundidade (m)', X(0) - 15, (Y(cTopo) + Y(cBase)) / 2, { angle: 90, align: 'center' });

  // camadas
  geo.poligonos.forEach((p) => {
    const pts = p.pts.map(([d, c]) => [X(d), Y(c)]);
    doc.setFillColor(p.solo.fill);
    desenharPoligono(doc, pts, 'F');
    const { linhas, pontos } = hachuraPoligono(pts, p.solo, p.sec, 1.3);
    doc.setDrawColor(95, 95, 95); doc.setLineWidth(0.07);
    linhas.forEach(([a, b, c, d]) => doc.line(a, b, c, d));
    doc.setFillColor(95, 95, 95);
    pontos.forEach(([x, y]) => doc.circle(x, y, 0.15, 'F'));
  });
  doc.setDrawColor(40, 40, 40); doc.setLineWidth(0.2);
  geo.poligonos.forEach((p) => desenharPoligono(doc, p.pts.map(([d, c]) => [X(d), Y(c)]), 'S'));
  // rótulos das camadas
  geo.poligonos.forEach((p) => {
    const h = p.rotulo.h * ky;
    if (h < 3.2) return;
    const x = X(p.rotulo.d), y = Y(p.rotulo.c), sec = secLabel(p.sec);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
    const linhas = [p.solo.code, ...(sec && h > 7 ? [sec] : [])];
    const w = Math.max(...linhas.map((t) => doc.getTextWidth(t))) + 2, hh = linhas.length * 3 + 1;
    doc.setFillColor(255, 255, 255); doc.rect(x - w / 2, y - hh / 2, w, hh, 'F');
    doc.setTextColor(...TINTA); doc.text(p.solo.code, x, y - hh / 2 + 3, { align: 'center' });
    if (linhas[1]) { doc.setFont('helvetica', 'normal'); doc.setFontSize(6.3); doc.text(sec, x, y - hh / 2 + 6, { align: 'center' }); }
  });

  // terreno e NA
  doc.setDrawColor(...TINTA); doc.setLineWidth(0.6);
  for (let i = 1; i < geo.terreno.length; i++) doc.line(X(geo.terreno[i - 1][0]), Y(geo.terreno[i - 1][1]), X(geo.terreno[i][0]), Y(geo.terreno[i][1]));
  if (geo.na.length > 1) {
    doc.setDrawColor(...AZUL); doc.setLineWidth(0.35); doc.setLineDashPattern([2, 1], 0);
    for (let i = 1; i < geo.na.length; i++) doc.line(X(geo.na[i - 1][0]), Y(geo.na[i - 1][1]), X(geo.na[i][0]), Y(geo.na[i][1]));
    doc.setLineDashPattern([], 0);
  }

  // furos: régua de SPT, N, nome, cota, NA, impenetrável
  bhs.forEach((b) => {
    const x = X(b.dist), prof = b.layers.length ? Math.max(...b.layers.map((l) => l.ate)) : 0, rw = 0.9;
    doc.setDrawColor(...CINZA); doc.setLineWidth(0.15); doc.line(x, Y(b.cota), x, areaY0 - 4);
    for (let m = 1; m <= Math.ceil(prof); m++) {
      const ya = Y(b.cota - (m - 1)), yb = Y(b.cota - Math.min(m, prof));
      doc.setFillColor(...(m % 2 ? [26, 26, 26] : [255, 255, 255])); doc.setDrawColor(...TINTA); doc.setLineWidth(0.1);
      doc.rect(x - rw, ya, 2 * rw, yb - ya, 'FD');
      const t = b.sptTexto?.[m];
      if (t !== undefined && yb - ya > 1.6) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(Math.min(6.5, (yb - ya) * 2.4));
        doc.setTextColor(...(b.spt[m] >= 50 ? VERMELHO : TINTA));
        doc.text(t, x + rw + 0.8, (ya + yb) / 2 + 0.9);
      }
    }
    if (b.na > 0) {
      const y = Y(b.cota - b.na);
      doc.setFillColor(...AZUL); doc.triangle(x - 3.2, y - 1.6, x - 1.2, y - 1.6, x - 2.2, y, 'F');
    }
    if (b.imp) {
      const y = Y(b.cota - prof);
      doc.setDrawColor(...VERMELHO); doc.setLineWidth(0.4);
      for (let k = 0; k < 3; k++) doc.line(x - 2, y + 1 + k * 1, x + 2, y + 1 + k * 1);
    }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...TINTA);
    doc.text(b.name, x, areaY0 - 9, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...CINZA);
    doc.text(`${fmt(b.cota)} m`, x, areaY0 - 5.5, { align: 'center' });
    doc.text(`d = ${fmt(b.dist, 1)} m`, x, Y(cBase) + 7, { align: 'center' });
  });

  // eixo de distâncias e escala gráfica
  const passoD = niceStep(geo.totDist / 8 || 1);
  doc.setDrawColor(...CINZA); doc.setLineWidth(0.2); doc.setFontSize(6.5); doc.setTextColor(...CINZA);
  doc.line(X(0), Y(cBase), X(geo.totDist), Y(cBase));
  for (let d = 0; d <= geo.totDist + 1e-9; d += passoD) { doc.line(X(d), Y(cBase), X(d), Y(cBase) + 1.5); doc.text(fmt(d, 0), X(d), Y(cBase) + 4, { align: 'center' }); }
  const [n1, n2] = (corte?.nome || "A–A'").split('–');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...AZUL);
  doc.text(n1 || 'A', X(0) - 3, areaY0 - 13, { align: 'right' });
  doc.text(n2 || "A'", X(geo.totDist) + 3, areaY0 - 13);
  escalaGrafica(doc, M + 4, PH - M - carH - 6, Eh);

  // legenda + carimbo
  legenda(doc, geo, M, PH - M - carH, 230, carH);
  carimbo(doc, projeto, perfil, { Eh, Ev, exagero, data, modo, x: PW - M - 170, y: PH - M - carH, w: 170, h: carH });
  return doc;
}

function desenharPoligono(doc, pts, estilo) {
  if (pts.length < 3) return;
  const linhas = pts.slice(1).map(([x, y], i) => [x - pts[i][0], y - pts[i][1]]);
  doc.lines(linhas, pts[0][0], pts[0][1], [1, 1], estilo, true);
}

function escalaGrafica(doc, x, y, Eh) {
  const m = niceStep((40 * Eh) / 1000); // ~40 mm
  const mm = (m * 1000) / Eh;
  doc.setLineWidth(0.2); doc.setDrawColor(...TINTA);
  for (let i = 0; i < 4; i++) {
    doc.setFillColor(...(i % 2 ? [255, 255, 255] : [26, 26, 26]));
    doc.rect(x + (i * mm) / 4, y, mm / 4, 1.5, 'FD');
  }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...TINTA);
  doc.text('0', x, y - 1, { align: 'center' }); doc.text(`${fmt(m, m < 10 ? 1 : 0)} m`, x + mm, y - 1, { align: 'center' });
  doc.text(`Escala horizontal 1:${Eh}`, x + mm + 6, y + 1.4);
}

function legenda(doc, geo, x, y, w, h) {
  doc.setDrawColor(...TINTA); doc.setLineWidth(0.3); doc.rect(x, y, w, h);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...TINTA);
  doc.text('LEGENDA', x + 3, y + 5);
  const solos = [...new Map(geo.poligonos.map((p) => [p.solo.code, p.solo])).values()];
  const secs = [...new Set(geo.poligonos.map((p) => p.sec).filter(Boolean))];
  let cx = x + 3, cy = y + 9;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
  const item = (desenho, texto) => {
    const tw = doc.getTextWidth(texto) + 14;
    if (cx + tw > x + w - 2) { cx = x + 3; cy += 6; }
    desenho(cx, cy); doc.setTextColor(...TINTA); doc.text(texto, cx + 10, cy + 2.6); cx += tw + 3;
  };
  solos.forEach((s) => item((a, b) => {
    doc.setFillColor(s.fill); doc.setDrawColor(...CINZA); doc.setLineWidth(0.15); doc.rect(a, b, 8, 3.6, 'FD');
    const { linhas, pontos } = hachuraPoligono([[a, b], [a + 8, b], [a + 8, b + 3.6], [a, b + 3.6]], s, '', 1.3);
    doc.setDrawColor(95, 95, 95); doc.setLineWidth(0.07); linhas.forEach(([p, q, r, t]) => doc.line(p, q, r, t));
    doc.setFillColor(95, 95, 95); pontos.forEach(([px, py]) => doc.circle(px, py, 0.15, 'F'));
  }, s.label));
  secs.forEach((sec) => item((a, b) => {
    doc.setFillColor(255, 255, 255); doc.setDrawColor(...CINZA); doc.rect(a, b, 8, 3.6, 'FD');
    const { linhas } = hachuraPoligono([[a, b], [a + 8, b], [a + 8, b + 3.6], [a, b + 3.6]], { hatch: '' }, sec, 1.3);
    doc.setDrawColor(95, 95, 95); doc.setLineWidth(0.07); linhas.forEach(([p, q, r, t]) => doc.line(p, q, r, t));
  }, secLabel(sec)));
  item((a, b) => { doc.setDrawColor(...TINTA); doc.setLineWidth(0.6); doc.line(a, b + 1.8, a + 8, b + 1.8); }, 'Terreno');
  item((a, b) => { doc.setDrawColor(...AZUL); doc.setLineWidth(0.35); doc.setLineDashPattern([2, 1], 0); doc.line(a, b + 1.8, a + 8, b + 1.8); doc.setLineDashPattern([], 0); }, "Nível d'água");
  item((a, b) => { doc.setFillColor(26, 26, 26); doc.rect(a + 3, b, 2, 1.8, 'F'); doc.setDrawColor(...TINTA); doc.rect(a + 3, b, 2, 3.6); }, 'Régua de SPT (N por metro)');
  item((a, b) => { doc.setDrawColor(...VERMELHO); doc.setLineWidth(0.4); for (let k = 0; k < 3; k++) doc.line(a + 2, b + 0.8 + k, a + 6, b + 0.8 + k); }, 'Impenetrável');
}

const INTERPRETACAO = { interpolado: 'contatos interpolados entre furos', suave: 'contatos interpolados em curva', degrau: 'troca de material no meio do vão' };

function carimbo(doc, projeto, perfil, { Eh, Ev, exagero, data, modo, x, y, w, h }) {
  const { bhs, corte } = perfil;
  doc.setDrawColor(...TINTA); doc.setLineWidth(0.3); doc.rect(x, y, w, h);
  const linha = (yy) => doc.line(x, yy, x + w, yy);
  doc.setLineWidth(0.15);
  linha(y + 13); linha(y + 22); linha(y + 31); linha(y + 39);
  doc.line(x + w / 2, y + 13, x + w / 2, y + 39);
  const campo = (rot, val, cx, cy, tam = 8.5) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(5.8); doc.setTextColor(...CINZA); doc.text(rot.toUpperCase(), cx, cy);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(tam); doc.setTextColor(...TINTA); doc.text(String(val), cx, cy + 4.2, { maxWidth: w / 2 - 4 });
  };
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...AZUL);
  doc.text(`PERFIL GEOTÉCNICO — CORTE ${corte?.nome || ''}`, x + 3, y + 6.5);
  doc.setFontSize(8.5); doc.setTextColor(...TINTA); doc.setFont('helvetica', 'normal');
  doc.text(projeto.projeto?.nome || '—', x + 3, y + 11);
  campo('Escala horizontal', `1:${Eh}`, x + 3, y + 16.5);
  campo('Escala vertical', `1:${Ev}`, x + w / 2 + 3, y + 16.5);
  campo('Exagero vertical', exagero === 1 ? 'nenhum (1×)' : `${fmt(exagero, exagero % 1 ? 1 : 0)}×`, x + 3, y + 25.5);
  campo('Furos', bhs.map((b) => b.name).join(', '), x + w / 2 + 3, y + 25.5, 7.5);
  let coord = 'coordenadas locais';
  if (ehGeorreferenciado(projeto) && corte) {
    const fz = projeto.projeto.fusoUTM;
    coord = `UTM ${fz}: A (${fmt(corte.p1[0], 0)}; ${fmt(corte.p1[1], 0)}) · A' (${fmt(corte.p2[0], 0)}; ${fmt(corte.p2[1], 0)})`;
    void utmParaGeo;
  }
  campo('Interpretação', INTERPRETACAO[modo] || INTERPRETACAO.interpolado, x + 3, y + 34, 7);
  campo('Data', data.toLocaleDateString('pt-BR'), x + w / 2 + 3, y + 34, 8);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.3); doc.setTextColor(...CINZA);
  doc.text(coord, x + 3, y + 43.2);
  doc.text('Responsável técnico: ______________________', x + w / 2 + 3, y + 43.2);
}
