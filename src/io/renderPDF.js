// Desenha a lista de elementos de geo/desenho.js num PDF (jsPDF em mm, mm = 1).
import { hachuraPoligono } from './hachura.js';

const PT = 0.3528; // mm por ponto

function caminho(doc, pts, estilo, fechado) {
  if (pts.length < 2) return;
  const d = pts.slice(1).map(([x, y], i) => [x - pts[i][0], y - pts[i][1]]);
  doc.lines(d, pts[0][0], pts[0][1], [1, 1], estilo, fechado);
}

export function renderPDF(doc, itens) {
  itens.forEach((it) => {
    if (it.t === 'poli') {
      if (it.pts.length < 3) return;
      if (it.fill) { doc.setFillColor(it.fill); caminho(doc, it.pts, 'F', true); }
      if (it.hachura) {
        const { linhas, pontos } = hachuraPoligono(it.pts, it.hachura.solo, it.hachura.sec, 1.3);
        doc.setDrawColor(85, 85, 85); doc.setLineWidth(0.07);
        linhas.forEach(([a, b, c, d]) => doc.line(a, b, c, d));
        doc.setFillColor(85, 85, 85);
        pontos.forEach(([x, y]) => doc.circle(x, y, 0.14, 'F'));
      }
      if (it.stroke) { doc.setDrawColor(it.stroke); doc.setLineWidth(it.lw || 0.2); caminho(doc, it.pts, 'S', true); }
    } else if (it.t === 'linha') {
      doc.setDrawColor(it.cor || '#000000'); doc.setLineWidth(it.lw || 0.2);
      if (it.dash) doc.setLineDashPattern(it.dash, 0);
      caminho(doc, it.pts, 'S', false);
      if (it.dash) doc.setLineDashPattern([], 0);
    } else if (it.t === 'texto') {
      doc.setFont('helvetica', it.bold ? 'bold' : 'normal');
      doc.setFontSize(it.h / PT);
      const w = doc.getTextWidth(it.txt);
      const al = it.al === 'r' ? 'right' : it.al === 'c' ? 'center' : 'left';
      if (it.fundo) {
        const x0 = it.al === 'r' ? it.x - w : it.al === 'c' ? it.x - w / 2 : it.x, hh = it.h * 0.95;
        const yc = it.vb === 'meio' ? it.y : it.y - it.h * 0.35;
        doc.setFillColor(it.fundo === true ? '#ffffff' : it.fundo); doc.rect(x0 - 0.8, yc - hh / 2 - 0.2, w + 1.6, hh + 0.4, 'F');
      }
      doc.setTextColor(it.cor || '#000000');
      const opc = { align: al, baseline: it.vb === 'meio' ? 'middle' : 'alphabetic' };
      if (it.ang) doc.text(it.txt, it.x, it.y, { ...opc, angle: it.ang });
      else doc.text(it.txt, it.x, it.y, opc);
    }
  });
}
