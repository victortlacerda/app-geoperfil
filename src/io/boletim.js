// Boletim individual de sondagem em PDF (A4 retrato), gerado com jsPDF.
import { jsPDF } from 'jspdf';
import { solo, secLabel, paradaLabel } from '../model/catalogo.js';
import { linhasEfetivas, camadasDoFuro, profMax, numLinhas } from '../model/projeto.js';
import { hachuraZona } from './hachura.js';

const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '—');
const AZUL = [21, 102, 209], CINZA = [110, 110, 105], TINTA = [26, 26, 26], VERMELHO = [163, 45, 45];

/**
 * Gera o boletim do furo `f` do `projeto`.
 * @returns {jsPDF}
 */
export function gerarBoletimPDF(projeto, f, { data = new Date() } = {}) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const golpes = projeto.projeto?.modoSPT === 'golpes';
  const M = 12, W = 210 - 2 * M;
  const prof = f.profTotal || profMax(f) || numLinhas(f) || 1;
  const L = prof; // o boletim termina na profundidade final

  // ── cabeçalho ──
  doc.setDrawColor(...CINZA); doc.setLineWidth(0.3);
  doc.rect(M, M, W, 30);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...TINTA);
  doc.text('BOLETIM DE SONDAGEM À PERCUSSÃO (SPT)', M + 3, M + 7);
  doc.setFontSize(16); doc.setTextColor(...AZUL);
  doc.text(f.nome, M + W - 3, M + 8, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...TINTA);
  const campos = [
    ['Projeto', projeto.projeto?.nome || '—'],
    ['Coordenadas (m)', `X ${fmt(f.x)}  ·  Y ${fmt(f.y)}`],
    ['Cota da boca', `${fmt(f.cota)} m`],
    ['Nível d\'água', f.na ? `${fmt(f.na)} m de profundidade` : 'não informado'],
    ['Profundidade final', `${fmt(prof)} m`],
    ['Critério de parada', paradaLabel(f.parada) || '—'],
  ];
  campos.forEach(([k, v], i) => {
    const col = i % 2, lin = Math.floor(i / 2), x = M + 3 + col * (W / 2), y = M + 14 + lin * 5.2;
    doc.setTextColor(...CINZA); doc.text(`${k}:`, x, y);
    doc.setTextColor(...TINTA); doc.text(String(v), x + 30, y, { maxWidth: W / 2 - 34 });
  });
  doc.setTextColor(...CINZA); doc.setFontSize(7);
  doc.text(`Emitido em ${data.toLocaleDateString('pt-BR')} · GeoPerfil`, M + W - 3, M + 28, { align: 'right' });

  // ── colunas ──
  const x = { prof: M, perfil: M + 12, cls: M + 30 };
  x.n = M + 108;
  const larN = golpes ? 36 : 14;
  x.graf = x.n + larN;
  x.fim = M + W;
  const y0 = M + 40, alturaCab = 9;
  const yT = y0 + alturaCab, alturaUtil = 297 - M - 26 - yT;
  const hm = Math.min(11, alturaUtil / L); // mm por metro
  const Y = (d) => yT + d * hm;
  const yB = Y(L);
  const linhasN = Math.ceil(L);

  doc.setFillColor(245, 245, 243); doc.rect(M, y0, W, alturaCab, 'F');
  doc.setDrawColor(...CINZA); doc.rect(M, y0, W, yB - y0);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...TINTA);
  const cab = (t, xa, xb) => doc.text(t, (xa + xb) / 2, y0 + 4.6, { align: 'center' });
  cab('Prof. (m)', x.prof, x.perfil); cab('Perfil', x.perfil, x.cls); cab('Classificação e descrição', x.cls, x.n);
  if (golpes) {
    const w = larN / 4;
    ['1º', '2º', '3º', 'N'].forEach((t, i) => cab(t, x.n + i * w, x.n + (i + 1) * w));
    doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5);
    doc.text('golpes / 15 cm', x.n + (3 * w) / 2, y0 + 7.8, { align: 'center' });
  } else cab('N-SPT', x.n, x.graf);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
  cab('N-SPT (golpes / 30 cm)', x.graf, x.fim);
  [x.perfil, x.cls, x.n, x.graf].forEach((xx) => doc.line(xx, y0, xx, yB));
  doc.line(M, yT, x.fim, yT);

  // linhas de metro, régua de profundidade (o número some onde há contato de camada)
  const contatos = camadasDoFuro(f).map((c) => c.ate);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5);
  for (let m = 0; m <= Math.floor(L); m++) {
    const perto = contatos.some((c) => Math.abs(c - m) * hm < 2.5);
    doc.setDrawColor(200, 200, 195); doc.setLineWidth(0.1);
    doc.line(x.prof, Y(m), x.prof + 3, Y(m));
    doc.line(x.n, Y(m), x.graf, Y(m));
    doc.setTextColor(...CINZA);
    if (!perto && (hm >= 3.2 || m % 2 === 0)) doc.text(String(m), x.prof + 10, Y(m) + 1, { align: 'right' });
  }

  // camadas: preenchimento, hachura, contatos e textos
  const camadas = camadasDoFuro(f);
  camadas.forEach((c) => {
    const s = solo(c.codigo), ya = Y(c.de), yb = Y(c.ate), h = yb - ya;
    doc.setFillColor(s.fill); doc.rect(x.perfil, ya, x.cls - x.perfil, h, 'F');
    const { linhas, pontos } = hachuraZona(x.perfil, ya, x.cls, yb, s, c.origem, 1.4);
    doc.setDrawColor(90, 90, 90); doc.setLineWidth(0.08);
    linhas.forEach(([a, b, cc, d]) => doc.line(a, b, cc, d));
    doc.setFillColor(90, 90, 90);
    pontos.forEach(([px, py]) => doc.circle(px, py, 0.18, 'F'));
    doc.setDrawColor(...CINZA); doc.setLineWidth(0.25);
    doc.line(x.perfil, yb, x.n, yb);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(...TINTA);
    doc.text(fmt(c.ate), x.prof + 10, yb + 1, { align: 'right' });
    // texto da camada
    const nome = s.label.split('—')[1]?.trim() || s.code;
    let titulo = `${s.code} — ${nome}${c.origem ? ` (${secLabel(c.origem)})` : ''}`;
    const larg = x.n - x.cls - 3;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
    const tituloLinhas = doc.splitTextToSize(titulo, larg);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.8);
    const descLinhas = c.descricao ? doc.splitTextToSize(c.descricao, larg) : [];
    const cabe = Math.max(1, Math.floor((h - 1.5) / 3));
    const tl = tituloLinhas.slice(0, cabe), dl = descLinhas.slice(0, Math.max(0, cabe - tl.length));
    let ty = ya + Math.max(3.2, (h - (tl.length + dl.length) * 3) / 2 + 2.4);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.text(tl, x.cls + 1.5, ty); ty += tl.length * 3;
    if (dl.length) { doc.setFont('helvetica', 'normal'); doc.setFontSize(6.8); doc.setTextColor(...CINZA); doc.text(dl, x.cls + 1.5, ty); }
  });

  // N-SPT por metro
  const linhas = linhasEfetivas(f).filter((l) => l.m <= linhasN);
  doc.setFontSize(7.5);
  linhas.forEach((l) => {
    const ym = (Y(l.m - 1) + Y(Math.min(l.m, L))) / 2 + 1.1;
    if (golpes) {
      const w = larN / 4;
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...TINTA);
      (l.registro.golpes || []).forEach((g, i) => { if (g) doc.text(g, x.n + (i + 0.5) * w, ym, { align: 'center' }); });
      if (l.n) { doc.setFont('helvetica', 'bold'); doc.setTextColor(...(l.n.parcial ? VERMELHO : TINTA)); doc.text(l.n.texto, x.n + 3.5 * w, ym, { align: 'center' }); }
    } else if (l.n) {
      doc.setFont('helvetica', 'bold'); doc.setTextColor(...(l.n.parcial ? VERMELHO : TINTA));
      doc.text(l.n.texto, (x.n + x.graf) / 2, ym, { align: 'center' });
    }
  });

  // gráfico N × profundidade
  const gx0 = x.graf + 4, gx1 = x.fim - 4, GX = (n) => gx0 + (Math.min(n, 50) / 50) * (gx1 - gx0);
  doc.setLineWidth(0.1); doc.setFontSize(6); doc.setFont('helvetica', 'normal');
  for (let n = 0; n <= 50; n += 10) {
    doc.setDrawColor(215, 215, 210); doc.line(GX(n), yT, GX(n), yB);
    doc.setTextColor(...CINZA); doc.text(n === 50 ? '50+' : String(n), GX(n), yB + 3, { align: 'center' });
  }
  const pts = linhas.filter((l) => l.n).map((l) => [GX(l.n.valor), (Y(l.m - 1) + Y(Math.min(l.m, L))) / 2, l.n.parcial]);
  doc.setDrawColor(...AZUL); doc.setLineWidth(0.45);
  for (let i = 1; i < pts.length; i++) doc.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
  pts.forEach(([px, py, parcial]) => { doc.setFillColor(...(parcial ? VERMELHO : AZUL)); doc.circle(px, py, 0.7, 'F'); });

  // nível d'água
  if (f.na > 0 && f.na <= L) {
    const ya = Y(f.na);
    doc.setDrawColor(...AZUL); doc.setLineWidth(0.35); doc.setLineDashPattern([1.2, 0.8], 0);
    doc.line(x.perfil, ya, x.n, ya); doc.setLineDashPattern([], 0);
    doc.setFillColor(...AZUL); doc.triangle(x.perfil + 0.2, ya - 1.6, x.perfil + 0.2, ya + 1.6, x.perfil + 2, ya, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(...AZUL);
    doc.text(`NA ${fmt(f.na)} m`, x.n - 1.5, ya - 0.8, { align: 'right' });
  }

  // fim da sondagem
  doc.setFontSize(7.5); doc.setFont('helvetica', 'bold');
  const yfim = Y(prof);
  doc.setDrawColor(...VERMELHO); doc.setLineWidth(0.4); doc.line(x.perfil, yfim, x.cls, yfim);
  doc.setTextColor(...VERMELHO);
  doc.text(`Fim da sondagem: ${fmt(prof)} m${f.parada ? ' — ' + paradaLabel(f.parada) : ''}`, M, Math.min(yB + 8, 297 - M - 16));

  // legenda
  const usados = [...new Map(camadas.map((c) => [c.codigo, solo(c.codigo)])).values()];
  let lx = M, ly = Math.min(yB + 13, 297 - M - 10);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.8); doc.setTextColor(...TINTA);
  usados.forEach((s) => {
    const t = s.label;
    const w = 7 + doc.getTextWidth(t) + 5;
    if (lx + w > M + W) { lx = M; ly += 5; }
    doc.setFillColor(s.fill); doc.setDrawColor(...CINZA); doc.setLineWidth(0.15); doc.rect(lx, ly - 2.6, 5, 3.2, 'FD');
    doc.text(t, lx + 6.5, ly); lx += w;
  });
  if (golpes) {
    doc.setTextColor(...CINZA); doc.setFontSize(6.3);
    doc.text('N = soma dos golpes do 2º e do 3º trechos de 15 cm. Em vermelho: penetração incompleta (golpes/cm).', M, Math.min(ly + 5, 297 - M));
  }
  return doc;
}
