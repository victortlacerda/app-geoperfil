// Desenha a lista de elementos de geo/desenho.js num canvas 2D (unidades em px).
import { hachuraPoligono } from '../io/hachura.js';

function caminho(ctx, pts, fechado) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  if (fechado) ctx.closePath();
}

/**
 * @param ctx contexto 2D
 * @param itens elementos do desenho (coordenadas em px)
 * @param mm px por milímetro de papel
 * @param recorte [x0, y0, x1, y1]: área onde os elementos com clip ficam
 */
export function renderCanvas(ctx, itens, mm, recorte) {
  const desenhar = (it) => {
    if (it.t === 'poli') {
      if (it.pts.length < 3) return;
      if (it.fill) { ctx.fillStyle = it.fill; caminho(ctx, it.pts, true); ctx.fill(); }
      if (it.hachura) {
        const { linhas, pontos } = hachuraPoligono(it.pts, it.hachura.solo, it.hachura.sec, 1.3 * mm);
        ctx.strokeStyle = 'rgba(60,60,60,0.55)'; ctx.lineWidth = 0.6; ctx.beginPath();
        linhas.forEach(([a, b, c, d]) => { ctx.moveTo(a, b); ctx.lineTo(c, d); });
        ctx.stroke();
        ctx.fillStyle = 'rgba(60,60,60,0.6)';
        pontos.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 0.8, 0, 2 * Math.PI); ctx.fill(); });
      }
      if (it.stroke) { ctx.strokeStyle = it.stroke; ctx.lineWidth = Math.max(0.5, (it.lw || 0.2) * mm); ctx.lineJoin = 'round'; caminho(ctx, it.pts, true); ctx.stroke(); }
    } else if (it.t === 'linha') {
      ctx.strokeStyle = it.cor || '#000'; ctx.lineWidth = Math.max(0.5, (it.lw || 0.2) * mm); ctx.lineJoin = 'round';
      ctx.setLineDash(it.dash ? it.dash.map((v) => v * mm) : []);
      caminho(ctx, it.pts, false); ctx.stroke();
      ctx.setLineDash([]);
    } else if (it.t === 'texto') {
      const fs = it.h * mm;
      ctx.font = `${it.bold ? '700' : '400'} ${fs.toFixed(1)}px Helvetica, Arial, sans-serif`;
      ctx.textAlign = it.al === 'r' ? 'right' : it.al === 'c' ? 'center' : 'left';
      ctx.textBaseline = it.vb === 'meio' ? 'middle' : 'alphabetic';
      ctx.save(); ctx.translate(it.x, it.y);
      if (it.ang) ctx.rotate((-it.ang * Math.PI) / 180);
      if (it.fundo) {
        const w = ctx.measureText(it.txt).width, x0 = it.al === 'r' ? -w : it.al === 'c' ? -w / 2 : 0;
        const yc = it.vb === 'meio' ? 0 : -fs * 0.35;
        ctx.fillStyle = it.fundo; ctx.globalAlpha = 0.9; ctx.fillRect(x0 - 3, yc - fs * 0.55, w + 6, fs * 1.1); ctx.globalAlpha = 1;
      }
      ctx.fillStyle = it.cor || '#000'; ctx.fillText(it.txt, 0, 0);
      ctx.restore();
    }
  };
  itens.forEach((it) => {
    if (!it.clip || !recorte) return desenhar(it);
    ctx.save(); ctx.beginPath(); ctx.rect(recorte[0], recorte[1], recorte[2] - recorte[0], recorte[3] - recorte[1]); ctx.clip();
    desenhar(it); ctx.restore();
  });
}
