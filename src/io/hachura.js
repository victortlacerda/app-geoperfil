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
  return { linhas: L, pontos: P };
}
