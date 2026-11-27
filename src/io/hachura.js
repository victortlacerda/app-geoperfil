// Hachuras vetoriais (segmentos) por tipo de solo, usadas no DXF e no PDF.
// Coordenadas genéricas: o retângulo [x0,y0]–[x1,y1] e um fator de escala do espaçamento.

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

/** Linhas paralelas com ângulo e espaçamento, recortadas ao retângulo. */
export function linhasHachura(x0, y0, x1, y1, anguloGraus, espacamento) {
  const segs = [];
  const w = x1 - x0, h = y1 - y0, diag = Math.sqrt(w * w + h * h);
  const rad = (anguloGraus * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const passos = Math.ceil(diag / espacamento) + 2;
  for (let k = -passos; k <= passos; k++) {
    const ox = k * espacamento * cos, oy = k * espacamento * sin;
    const cl = clipLR(ox - sin * diag * 2 + x0, oy + cos * diag * 2 + y0, ox + sin * diag * 2 + x0, oy - cos * diag * 2 + y0, x0, y0, x1, y1);
    if (cl) segs.push(cl);
  }
  return segs;
}

function pontos(x0, y0, x1, y1, sp) {
  const p = [];
  for (let x = x0 + sp / 2; x < x1; x += sp) for (let y = y0 + sp / 2; y < y1; y += sp) p.push([x, y]);
  return p;
}

/**
 * Hachura de uma zona: { linhas: [[x1,y1,x2,y2]], pontos: [[x,y]] }.
 * `esc` multiplica os espaçamentos (1 = metros no DXF).
 */
export function hachuraZona(x0, y0, x1, y1, solo, sec, esc = 1) {
  const L = [], P = [];
  // ângulo 0 = linhas horizontais (como na tela)
  const lin = (ang, sp) => L.push(...linhasHachura(x0, y0, x1, y1, ang + 90, sp * esc));
  if (solo.hatch === 'argila') lin(0, 1.0);
  else if (solo.hatch === 'silte') lin(45, 1.0);
  else if (solo.hatch === 'areia') P.push(...pontos(x0, y0, x1, y1, 1.2 * esc));
  else if (solo.hatch === 'pedregulho') { lin(0, 1.3); lin(90, 1.3); }
  if (sec === 'ATR') lin(90, 1.8);
  else if (sec === 'RES') lin(135, 2.0);
  else if (sec === 'RFR') { lin(45, 1.2); lin(135, 1.2); }
  else if (sec === 'RSA') lin(0, 0.4);
  else if (sec === 'COL') lin(60, 1.6);
  else if (sec === 'RAL') { lin(30, 1.4); }
  return { linhas: L, pontos: P };
}

/** Ponto dentro de polígono (regra par-ímpar). */
export function dentro(x, y, pts) {
  let r = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) r = !r;
  }
  return r;
}

/** Recorta um segmento a um polígono qualquer: lista de trechos internos. */
export function recortarSegmento([x1, y1, x2, y2], pts) {
  const dx = x2 - x1, dy = y2 - y1, ss = [0, 1];
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, ay] = pts[j], [bx, by] = pts[i];
    const ex = bx - ax, ey = by - ay, den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const s = ((ax - x1) * ey - (ay - y1) * ex) / den, u = ((ax - x1) * dy - (ay - y1) * dx) / den;
    if (s > 0 && s < 1 && u >= 0 && u <= 1) ss.push(s);
  }
  ss.sort((a, b) => a - b);
  const out = [];
  for (let k = 0; k < ss.length - 1; k++) {
    const a = ss[k], b = ss[k + 1];
    if (b - a < 1e-9) continue;
    const m = (a + b) / 2;
    if (dentro(x1 + dx * m, y1 + dy * m, pts)) out.push([x1 + dx * a, y1 + dy * a, x1 + dx * b, y1 + dy * b]);
  }
  return out;
}

/** Hachura de um polígono: { linhas, pontos } já recortados. */
export function hachuraPoligono(pts, solo, sec, esc = 1) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (!(x1 - x0 > 1e-9 && y1 - y0 > 1e-9)) return { linhas: [], pontos: [] };
  const { linhas, pontos } = hachuraZona(x0, y0, x1, y1, solo, sec, esc);
  return {
    linhas: linhas.flatMap((seg) => recortarSegmento(seg, pts)),
    pontos: pontos.filter(([x, y]) => dentro(x, y, pts)),
  };
}

/**
 * Abre buracos na hachura: tira das linhas os trechos dentro dos retângulos
 * [x0, y0, x1, y1] e descarta os pontos que caem neles. No DXF não existe
 * fundo branco atrás do texto, então o texto ganha um vão na hachura.
 */
export function furarHachura({ linhas, pontos }, rets) {
  if (!rets.length) return { linhas, pontos };
  const dentroRet = (x, y, [a, b, c, d]) => x >= a && x <= c && y >= b && y <= d;
  let segs = linhas;
  rets.forEach((r) => {
    const out = [];
    segs.forEach(([x1, y1, x2, y2]) => {
      // intervalo [t0, t1] do segmento dentro do retângulo (Liang–Barsky)
      const dx = x2 - x1, dy = y2 - y1;
      let t0 = 0, t1 = 1, fora = false;
      [[-dx, x1 - r[0]], [dx, r[2] - x1], [-dy, y1 - r[1]], [dy, r[3] - y1]].forEach(([p, q]) => {
        if (fora) return;
        if (Math.abs(p) < 1e-12) { if (q < 0) fora = true; return; }
        const t = q / p;
        if (p < 0) { if (t > t1) fora = true; else if (t > t0) t0 = t; } else { if (t < t0) fora = true; else if (t < t1) t1 = t; }
      });
      if (fora || t1 - t0 < 1e-9) { out.push([x1, y1, x2, y2]); return; }
      if (t0 > 1e-9) out.push([x1, y1, x1 + dx * t0, y1 + dy * t0]);
      if (t1 < 1 - 1e-9) out.push([x1 + dx * t1, y1 + dy * t1, x2, y2]);
    });
    segs = out;
  });
  return { linhas: segs, pontos: pontos.filter(([x, y]) => !rets.some((r) => dentroRet(x, y, r))) };
}
