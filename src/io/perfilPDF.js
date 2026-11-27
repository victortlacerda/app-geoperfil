// PDF do perfil geotécnico (A3 paisagem): desenho em escala, carimbo e legenda.
import { jsPDF } from 'jspdf';
import { niceStep } from '../geo/zonas.js';
import { geometriaPerfil } from '../geo/perfil2d.js';
import { renderPDF } from './renderPDF.js';
import { desenharPerfil, desenharLegenda, legendaPerfil } from '../geo/desenho.js';
import { utmParaGeo, ehGeorreferenciado } from '../geo/coordenadas.js';
import { escalasPerfil, folgaPerfil } from './escalas.js';

export { escalaPadrao, escolherEscalas, escalasPerfil } from './escalas.js';

const AZUL = [21, 102, 209], CINZA = [110, 110, 105], TINTA = [26, 26, 26];
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
  const cfg = projeto.projeto || {};
  const estilo = cfg.estilo || {};
  const doc = new jsPDF({ unit: 'mm', format: 'a3', orientation: 'landscape' });
  const PW = 420, PH = 297, M = 10;

  // área do desenho (acima do carimbo); reserva espaço para os eixos dos dois lados,
  // os cabeçalhos dos furos acima do terreno e a régua de distâncias embaixo
  const carH = 46, areaX0 = M + 6, areaX1 = PW - M - 6, areaY0 = M + 8, areaY1 = PH - M - carH - 6;
  const margE = 26, margD = 36, margC = 20, margB = 18;
  const { Eh, Ev, passoC, cTopo, cBase } = escalasPerfil(geo, bhs, areaX1 - areaX0 - margE - margD, areaY1 - areaY0 - margC - margB);
  const exagero = Eh / Ev;
  const kx = 1000 / Eh, ky = 1000 / Ev; // mm por metro
  const fol = folgaPerfil(geo.totDist);
  const larg = (geo.totDist + 2 * fol) * kx, livre = areaX1 - areaX0 - margE - margD;
  const alt = (cTopo - cBase) * ky, livreY = areaY1 - areaY0 - margC - margB;
  const x0 = areaX0 + margE + Math.max(0, (livre - larg) / 2) + fol * kx;
  const y0 = areaY0 + margC + Math.max(0, (livreY - alt) / 2); // centraliza na folha
  const X = (d) => x0 + d * kx, Y = (c) => y0 + (cTopo - c) * ky;

  doc.setDrawColor(...TINTA); doc.setLineWidth(0.5); doc.rect(M, M, PW - 2 * M, PH - 2 * M);
  const { itens } = desenharPerfil({
    bhs, geo, corte, estilo, axis, X, Y, mm: 1, cTopo,
    janela: { d0: -fol, d1: geo.totDist + fol, c0: cBase, c1: cTopo }, passoC,
    naProjeto: cfg.naProjeto, referencias: cfg.referencias || [],
  });
  renderPDF(doc, itens);
  escalaGrafica(doc, M + 4, PH - M - carH - 4, Eh);

  // legenda + carimbo
  doc.setDrawColor(...TINTA); doc.setLineWidth(0.3); doc.rect(M, PH - M - carH, 230, carH);
  const leg = desenharLegenda(legendaPerfil(bhs, geo, { estilo, naProjeto: cfg.naProjeto, referencias: cfg.referencias || [] }), { x: M + 3, y: PH - M - carH + 2, largura: 224, hachura: estilo.hachura !== false });
  renderPDF(doc, leg.itens);
  carimbo(doc, projeto, perfil, { Eh, Ev, exagero, data, modo, x: PW - M - 170, y: PH - M - carH, w: 170, h: carH });
  return doc;
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
