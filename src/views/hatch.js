// Hachuras em canvas por tipo de solo (primária) e por origem (secundária).

function linhasH(ctx, x, y, w, h, passo) {
  for (let iy = y; iy < y + h + 6; iy += passo) {
    ctx.beginPath(); ctx.moveTo(x, iy); ctx.lineTo(x + w, iy); ctx.stroke();
  }
}

export const HATCH_FNS = {
  argila(ctx, x, y, w, h) {
    ctx.save(); ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 0.8;
    linhasH(ctx, x, y, w, h, 5); ctx.restore();
  },
  silte(ctx, x, y, w, h) {
    ctx.save(); ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 0.7; ctx.setLineDash([4, 3]);
    linhasH(ctx, x, y, w, h, 5); ctx.setLineDash([]); ctx.restore();
  },
  areia(ctx, x, y, w, h) {
    ctx.save(); ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let iy = y + 2; iy < y + h; iy += 5)
      for (let ix = x + 3; ix < x + w; ix += 6) { ctx.beginPath(); ctx.arc(ix, iy, 1, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  },
  pedregulho(ctx, x, y, w, h) {
    ctx.save(); ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 0.8;
    for (let iy = y + 4; iy < y + h; iy += 8)
      for (let ix = x + 4; ix < x + w; ix += 8) { ctx.beginPath(); ctx.arc(ix, iy, 2.2, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
  },
};

export const HATCH_SEC = {
  ATR(ctx, x, y, w, h) {
    ctx.save(); ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 0.7;
    for (let iy = y; iy < y + h + 4; iy += 6) { ctx.beginPath(); ctx.moveTo(x, iy); ctx.lineTo(x + w, iy); ctx.stroke(); }
    for (let ix = x; ix < x + w + 4; ix += 6) { ctx.beginPath(); ctx.moveTo(ix, y); ctx.lineTo(ix, y + h); ctx.stroke(); }
    ctx.restore();
  },
  RES(ctx, x, y, w, h) {
    ctx.save(); ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 0.8;
    for (let d = -h; d < w + h; d += 8) { ctx.beginPath(); ctx.moveTo(x + d, y); ctx.lineTo(x + d + h, y + h); ctx.stroke(); }
    ctx.restore();
  },
  RFR(ctx, x, y, w, h) {
    ctx.save(); ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 0.7;
    for (let d = -h; d < w + h; d += 7) {
      ctx.beginPath(); ctx.moveTo(x + d, y); ctx.lineTo(x + d + h, y + h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + d + h, y); ctx.lineTo(x + d, y + h); ctx.stroke();
    }
    ctx.restore();
  },
  RSA(ctx, x, y, w, h) {
    ctx.save(); ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(x, y, w, h); ctx.restore();
  },
};

export function hachurar(ctx, solo, sec, x, y, w, h) {
  const f = HATCH_FNS[solo.hatch];
  if (f) f(ctx, x, y, w, h);
  if (sec && HATCH_SEC[sec]) HATCH_SEC[sec](ctx, x, y, w, h);
}

/** Ajusta o canvas ao tamanho do contêiner, com nitidez em telas de alta densidade. */
export function ajustarCanvas(canvas, wrap) {
  const w = wrap.clientWidth, h = wrap.clientHeight, dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}
