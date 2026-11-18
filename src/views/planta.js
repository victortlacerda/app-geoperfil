// Planta de locação em metros (x = Leste, y = Norte).
// Projeto georreferenciado (UTM SIRGAS 2000): mapa Leaflet de fundo e o desenho
// por cima, posicionado ponto a ponto pela conversão UTM → lat/long → tela.
// Projeto local (ou "sem mapa"): grade em metros com zoom e pan próprios.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ajustarCanvas } from './hatch.js';
import { ACCENT, ACCENT_RGB, OK, ALERTA, corFuro } from '../styles/tema.js';
import { niceStep } from '../geo/zonas.js';
import { sideOfLine, projectPoint, furosNoCorte, proximoNomeCorte } from '../geo/corte.js';
import { utmParaGeo, geoParaUtm, ehGeorreferenciado, fmtGraus } from '../geo/coordenadas.js';
import { uid } from '../model/projeto.js';

const HIT_PX = 13;

export const FUNDOS = {
  mapa: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    opts: { maxNativeZoom: 19, maxZoom: 22, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
  },
  satelite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    opts: { maxNativeZoom: 19, maxZoom: 22, attribution: 'Imagens © Esri, Maxar, Earthstar Geographics' },
  },
};

export function criarPlanta(app) {
  const wrap = document.getElementById('plantaWrap');
  const canvas = document.getElementById('plantaCanvas');
  const v = app.ui.planta; // modo local: { k (px/m), cx, cy (centro em metros) }
  let W = 0, H = 0;
  let corte = { step: 0, p1: null, p2: null, preview: null };
  let medida = { pts: [], preview: null, fechada: false };
  let drag = null; // { tipo: 'pan'|'furo', ... }
  let espaco = false;
  let baixou = null; // posição do mousedown, para não tratar arraste como clique
  let avisouErroMapa = false;

  // ── mapa (criado quando o projeto é georreferenciado) ──
  let mapa = null, camada = null, fundoAtual = null;
  const mapaDiv = document.createElement('div');
  mapaDiv.className = 'planta-mapa';
  mapaDiv.hidden = true;
  wrap.insertBefore(mapaDiv, canvas);

  const doc = () => app.store.doc;
  const fuso = () => doc().projeto.fusoUTM || '23S';
  const fundo = () => doc().projeto.fundo || 'mapa';
  const usaMapa = () => ehGeorreferenciado(doc()) && fundo() !== 'nenhum';

  function garantirMapa() {
    if (mapa) return;
    mapa = L.map(mapaDiv, {
      zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false,
      maxZoom: 22, boxZoom: false, keyboard: false, attributionControl: true,
    }).setView([-15, -50], 4);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(mapa);
    mapa.on('move zoom resize viewreset', () => draw());
  }

  /** Liga/desliga o mapa conforme o projeto e troca a camada de fundo se mudou. */
  function configurarModo() {
    const comMapa = usaMapa();
    mapaDiv.hidden = !comMapa;
    canvas.style.pointerEvents = comMapa ? 'none' : 'auto';
    wrap.classList.toggle('com-mapa', comMapa);
    if (!comMapa) return false;
    const novo = !mapa;
    garantirMapa();
    if (fundoAtual !== fundo()) {
      if (camada) camada.remove();
      const f = FUNDOS[fundo()] || FUNDOS.mapa;
      camada = L.tileLayer(f.url, f.opts).addTo(mapa);
      camada.on('tileerror', () => {
        if (!avisouErroMapa) { avisouErroMapa = true; app.toast('Não foi possível carregar o mapa de fundo (sem internet?). O desenho continua funcionando.', 6000); }
      });
      fundoAtual = fundo();
    }
    if (mapaDiv.clientWidth && (mapa.getSize().x !== mapaDiv.clientWidth || mapa.getSize().y !== mapaDiv.clientHeight)) mapa.invalidateSize(false);
    if (novo) setTimeout(() => ajustar(), 0);
    return true;
  }

  // ── conversões tela ⇄ metros ──
  function toS(x, y) {
    if (usaMapa() && mapa) {
      const g = utmParaGeo(x, y, fuso());
      const p = mapa.latLngToContainerPoint([g.lat, g.lon]);
      return [p.x, p.y];
    }
    return [W / 2 + (x - v.cx) * v.k, H / 2 - (y - v.cy) * v.k];
  }
  function toW(sx, sy) {
    if (usaMapa() && mapa) {
      const ll = mapa.containerPointToLatLng([sx, sy]);
      const u = geoParaUtm(ll.lat, ll.lng, fuso());
      return [u.x, u.y];
    }
    return [v.cx + (sx - W / 2) / v.k, v.cy - (sy - H / 2) / v.k];
  }
  const pos = (e) => { const r = wrap.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  function furoEm(sx, sy) {
    const furos = doc().furos;
    for (let i = furos.length - 1; i >= 0; i--) {
      const [fx, fy] = toS(furos[i].x, furos[i].y);
      if (Math.hypot(sx - fx, sy - fy) <= HIT_PX) return furos[i];
    }
    return null;
  }

  function ajustar() {
    const { furos, cortes } = doc();
    const pts = [...furos.map((f) => [f.x, f.y]), ...cortes.flatMap((c) => [c.p1, c.p2])];
    W = wrap.clientWidth || W; H = wrap.clientHeight || H;
    if (configurarModo()) {
      if (!pts.length) { mapa.setView([-15, -50], 4); return; }
      const lls = pts.map(([x, y]) => { const g = utmParaGeo(x, y, fuso()); return [g.lat, g.lon]; });
      if (lls.length === 1) mapa.setView(lls[0], 18);
      else mapa.fitBounds(L.latLngBounds(lls), { padding: [70, 70], maxZoom: 19 });
      return;
    }
    if (!pts.length) { v.k = 2; v.cx = 0; v.cy = 0; return draw(); }
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const larg = Math.max(x1 - x0, 20), alt = Math.max(y1 - y0, 20);
    v.k = Math.min((W - 120) / larg, (H - 120) / alt);
    if (!Number.isFinite(v.k) || v.k <= 0) v.k = 2;
    v.cx = (x0 + x1) / 2; v.cy = (y0 + y1) / 2;
    draw();
  }

  // ── desenho ──────────────────────────────────────────────
  function drawGrid(ctx) {
    const passo = niceStep(70 / v.k);
    const [wx0, wy1] = toW(0, 0), [wx1, wy0] = toW(W, H);
    ctx.save();
    ctx.lineWidth = 0.5;
    ctx.font = '9px sans-serif'; ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let x = Math.ceil(wx0 / passo) * passo; x <= wx1; x += passo) {
      const [sx] = toS(x, 0);
      ctx.strokeStyle = 'rgba(0,0,0,0.07)'; ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); ctx.stroke();
      ctx.textAlign = 'center'; ctx.fillText(fmtCoord(x), sx, 11);
    }
    for (let y = Math.ceil(wy0 / passo) * passo; y <= wy1; y += passo) {
      const [, sy] = toS(0, y);
      ctx.strokeStyle = 'rgba(0,0,0,0.07)'; ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(W, sy); ctx.stroke();
      ctx.textAlign = 'left'; ctx.fillText(fmtCoord(y), 4, sy - 3);
    }
    const barM = niceStep(90 / v.k), barPx = barM * v.k;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(20, H - 20); ctx.lineTo(20 + barPx, H - 20);
    ctx.moveTo(20, H - 16); ctx.lineTo(20, H - 24); ctx.moveTo(20 + barPx, H - 16); ctx.lineTo(20 + barPx, H - 24); ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.textAlign = 'center';
    ctx.fillText(`${barM} m`, 20 + barPx / 2, H - 26);
    ctx.translate(W - 26, 34);
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(6, 6); ctx.lineTo(0, 2); ctx.lineTo(-6, 6); ctx.closePath(); ctx.fill();
    ctx.font = '600 10px sans-serif'; ctx.fillText('N', 0, -18);
    ctx.restore();
  }

  function drawArrowHead(ctx, x, y, nx, ny, side, col) {
    const px = -ny * side, py = nx * side, len = 22, ex = x + px * len, ey = y + py * len;
    ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
    const ang = Math.atan2(ey - y, ex - x);
    ctx.beginPath();
    ctx.moveTo(ex, ey); ctx.lineTo(ex - 9 * Math.cos(ang - 0.42), ey - 9 * Math.sin(ang - 0.42));
    ctx.moveTo(ex, ey); ctx.lineTo(ex - 9 * Math.cos(ang + 0.42), ey - 9 * Math.sin(ang + 0.42));
    ctx.stroke(); ctx.restore();
  }

  function drawLinhaCorte(ctx, a, b, { cor, larg, tracejado, nomes, ladoTela }) {
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    if (len < 2) return;
    const nx = dx / len, ny = dy / len;
    ctx.save(); ctx.strokeStyle = cor; ctx.lineWidth = larg;
    if (tracejado) ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(a[0] - nx * 10, a[1] - ny * 10); ctx.lineTo(b[0] + nx * 10, b[1] + ny * 10); ctx.stroke();
    ctx.setLineDash([]);
    [a, b].forEach(([cx, cy]) => { ctx.beginPath(); ctx.moveTo(cx - ny * 8, cy + nx * 8); ctx.lineTo(cx + ny * 8, cy - nx * 8); ctx.stroke(); });
    if (ladoTela) { drawArrowHead(ctx, a[0], a[1], nx, ny, ladoTela, cor); drawArrowHead(ctx, b[0], b[1], nx, ny, ladoTela, cor); }
    ctx.font = larg > 1.5 ? '600 12px sans-serif' : '11px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    halo(ctx, nomes[0], a[0] - nx * 22, a[1] - ny * 22, cor);
    halo(ctx, nomes[1], b[0] + nx * 22, b[1] + ny * 22, cor);
    ctx.restore();
  }

  /** Faixa de inclusão: dos dois lados, ou só do `lado` (+1 / −1) quando informado. */
  function drawFaixa(ctx, p1, p2, faixa, lado = null) {
    if (faixa === null || faixa === undefined) return;
    const dx = p2[0] - p1[0], dy = p2[1] - p1[1], len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    const ux = dx / len, uy = dy / len, px = -uy * faixa, py = ux * faixa;
    const e = faixa;
    const a = lado ? Math.max(lado, 0) : 1, b = lado ? Math.min(lado, 0) : -1;
    const cantos = [
      [p1[0] - ux * e + px * a, p1[1] - uy * e + py * a], [p2[0] + ux * e + px * a, p2[1] + uy * e + py * a],
      [p2[0] + ux * e + px * b, p2[1] + uy * e + py * b], [p1[0] - ux * e + px * b, p1[1] - uy * e + py * b],
    ].map(([x, y]) => toS(x, y));
    ctx.save(); ctx.beginPath();
    cantos.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = `rgba(${ACCENT_RGB},${usaMapa() ? 0.14 : 0.07})`; ctx.fill();
    ctx.strokeStyle = `rgba(${ACCENT_RGB},0.45)`; ctx.lineWidth = 0.8; ctx.setLineDash([5, 4]); ctx.stroke();
    ctx.restore();
  }

  function drawMedida(ctx) {
    const pts = [...medida.pts, ...(medida.preview && !medida.fechada ? [medida.preview] : [])];
    if (!pts.length) return;
    const s = pts.map(([x, y]) => toS(x, y));
    ctx.save();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 3.5; ctx.globalAlpha = 0.25;
    ctx.beginPath(); s.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    ctx.globalAlpha = 1; ctx.strokeStyle = ACCENT; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
    ctx.beginPath(); s.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); ctx.setLineDash([]);
    let total = 0;
    ctx.font = '600 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      total += d;
      if (pts.length > 2) halo(ctx, fmtDist(d), (s[i][0] + s[i - 1][0]) / 2, (s[i][1] + s[i - 1][1]) / 2 - 10, ACCENT);
    }
    s.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.5; ctx.stroke(); });
    if (pts.length > 1) {
      const [lx, ly] = s.at(-1);
      ctx.font = '700 12px sans-serif'; ctx.textAlign = 'left';
      halo(ctx, `${pts.length > 2 ? 'Total ' : ''}${fmtDist(total)}`, lx + 10, ly - 12, '#111');
    }
    ctx.restore();
    app.setStatus(pts.length > 1 ? `Distância: ${fmtDist(total)} (Esc limpa; duplo clique termina)` : 'Clique no próximo ponto', 'corte');
  }

  function draw() {
    if (app.ui.view !== 'planta') return;
    const comMapa = configurarModo();
    const r = ajustarCanvas(canvas, wrap);
    const ctx = r.ctx; W = r.w; H = r.h;
    ctx.clearRect(0, 0, W, H);
    if (!comMapa) drawGrid(ctx);
    const { furos, cortes } = doc();
    const ativo = app.corteAtivo();

    if (corte.step > 0 && corte.p1) {
      const fim = corte.p2 || corte.preview;
      if (fim) drawFaixa(ctx, corte.p1, fim, app.ui.faixa);
    } else if (ativo) drawFaixa(ctx, ativo.p1, ativo.p2, ativo.faixa, ativo.incluir === 'ambos' ? null : ativo.lado);

    cortes.forEach((c) => {
      const isA = ativo && c.id === ativo.id;
      const [n1, n2] = c.nome.split('–');
      drawLinhaCorte(ctx, toS(...c.p1), toS(...c.p2), {
        cor: isA ? ACCENT : `rgba(${ACCENT_RGB},0.6)`, larg: isA ? 2 : 1.2, tracejado: !isA,
        nomes: [n1 || 'A', n2 || "A'"], ladoTela: -c.lado,
      });
    });

    if (corte.step > 0 && corte.p1) {
      const fim = corte.p2 || corte.preview;
      const a = toS(...corte.p1);
      if (fim) {
        const b = toS(...fim);
        drawLinhaCorte(ctx, a, b, { cor: ACCENT, larg: 2, nomes: ['A', "A'"] });
        if (corte.step === 2) drawEscolhaLado(ctx, a, b);
      }
      ctx.save(); ctx.beginPath(); ctx.arc(a[0], a[1], 5, 0, Math.PI * 2); ctx.fillStyle = ACCENT; ctx.fill(); ctx.restore();
    }

    const incl = new Set(ativo && corte.step === 0 ? furosNoCorte(ativo, furos).map((f) => f.id) : []);
    if (ativo && corte.step === 0) {
      const [ax, ay] = ativo.p1, [bx, by] = ativo.p2;
      furos.filter((f) => incl.has(f.id)).forEach((f) => {
        const pr = projectPoint(f.x, f.y, ax, ay, bx, by);
        const [sx, sy] = toS(f.x, f.y), [qx, qy] = toS(pr.px, pr.py);
        ctx.save(); ctx.strokeStyle = OK; ctx.lineWidth = 1.2; ctx.setLineDash([4, 3]); ctx.globalAlpha = 0.7;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(qx, qy); ctx.stroke(); ctx.restore();
      });
    }

    const selId = app.ui.furoId;
    furos.forEach((f, i) => {
      const [x, y] = toS(f.x, f.y);
      if (x < -60 || y < -60 || x > W + 60 || y > H + 60) return;
      const isSel = f.id === selId && app.ui.tool !== 'corte';
      const isIncl = incl.size > 0 && incl.has(f.id);
      const isExcl = ativo && corte.step === 0 && !incl.has(f.id);
      ctx.save();
      if (isExcl) ctx.globalAlpha = comMapa ? 0.6 : 0.35;
      ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.fillStyle = isSel ? '#FAEEDA' : isIncl ? '#EAF3DE' : '#E6EFFB'; ctx.fill();
      ctx.strokeStyle = isSel ? ALERTA : isIncl ? OK : corFuro(i);
      ctx.lineWidth = isSel || isIncl ? 2.2 : 1.6;
      if (isExcl) ctx.setLineDash([3, 2]);
      ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = isSel ? '#633806' : isIncl ? '#27500A' : '#111';
      ctx.font = '600 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(f.nome.replace(/^SP-/, ''), x, y);
      ctx.textBaseline = 'top';
      ctx.font = '600 10px sans-serif'; halo(ctx, f.nome, x, y + 15, '#111');
      ctx.font = '9px sans-serif'; halo(ctx, `(${fmtCoord(f.x)}; ${fmtCoord(f.y)})`, x, y + 27, 'rgba(0,0,0,0.6)');
      ctx.restore();
    });

    if (app.ui.tool === 'medir') drawMedida(ctx);

    document.getElementById('ps-furos').textContent = `${furos.length} furos`;
    document.getElementById('ps-corte').textContent = ativo
      ? `${ativo.nome}: ${furosNoCorte(ativo, furos).length} furo(s) · ${ativo.incluir === 'ambos' ? 'dois lados' : 'um lado'} · faixa ${ativo.faixa === null ? 'sem limite' : ativo.faixa + ' m'}`
      : 'Nenhum corte';
    document.getElementById('ps-dica').textContent = comMapa
      ? 'Arraste para mover o mapa · roda do mouse: zoom'
      : 'Roda do mouse: zoom · arrastar com botão do meio ou espaço: mover';
  }

  function drawEscolhaLado(ctx, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    if (len < 2) return;
    const nx = dx / len, ny = dy / len, mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    [1, -1].forEach((s) => {
      const px = -ny * s, py = nx * s, hx = mx + px * 38, hy = my + py * 38, ang = Math.atan2(py, px);
      ctx.save();
      ctx.beginPath(); ctx.arc(hx, hy, 16, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fill();
      ctx.strokeStyle = `rgba(${ACCENT_RGB},0.7)`; ctx.lineWidth = 1.2; ctx.stroke();
      const ax = hx + Math.cos(ang) * 7, ay = hy + Math.sin(ang) * 7, bx = hx - Math.cos(ang) * 5, by = hy - Math.sin(ang) * 5;
      ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ax, ay); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax - Math.cos(ang - 0.5) * 6, ay - Math.sin(ang - 0.5) * 6);
      ctx.moveTo(ax, ay); ctx.lineTo(ax - Math.cos(ang + 0.5) * 6, ay - Math.sin(ang + 0.5) * 6); ctx.stroke();
      ctx.restore();
    });
  }

  // ── interação ────────────────────────────────────────────
  function resetCorte() { corte = { step: 0, p1: null, p2: null, preview: null }; }
  function resetMedida() { medida = { pts: [], preview: null, fechada: false }; }

  function setTool(t) {
    app.ui.tool = t;
    resetCorte(); resetMedida();
    ['furo', 'corte', 'move', 'medir'].forEach((n) => document.getElementById('tb-' + n)?.classList.toggle('active', n === t));
    if (t === 'corte') app.setStatus('Clique no ponto A do corte', 'corte');
    if (t === 'furo') app.setStatus('Clique para lançar furo', '');
    if (t === 'move') app.setStatus('Clique em um furo para selecionar; arraste para mover', '');
    if (t === 'medir') app.setStatus('Clique no primeiro ponto da medida', 'corte');
    if (mapa) { if (t === 'medir') mapa.doubleClickZoom.disable(); else mapa.doubleClickZoom.enable(); }
    atualizarCursor();
    draw();
  }

  function atualizarCursor() {
    const c = drag?.tipo === 'pan' ? 'grabbing' : espaco ? 'grab' : app.ui.tool === 'move' ? (usaMapa() ? '' : 'default') : 'crosshair';
    wrap.style.cursor = c;
    if (mapa) mapaDiv.style.cursor = c || '';
    mapaDiv.querySelector('.leaflet-container')?.style.setProperty('cursor', c || '');
    if (mapa) mapa.getContainer().style.cursor = c;
  }

  const ehControleMapa = (e) => !!e.target.closest?.('.leaflet-control-container');

  wrap.addEventListener('mousedown', (e) => {
    if (ehControleMapa(e)) return;
    const [sx, sy] = pos(e);
    baixou = [sx, sy];
    const comMapa = usaMapa();
    const f = e.button === 0 && app.ui.tool === 'move' ? furoEm(sx, sy) : null;
    if (f) {
      app.selecionarFuro(f.id);
      const [wx, wy] = toW(sx, sy);
      drag = { tipo: 'furo', id: f.id, sx, sy, dx: f.x - wx, dy: f.y - wy, moveu: false };
      if (comMapa) { mapa.dragging.disable(); e.stopPropagation(); }
      return;
    }
    if (comMapa) return; // o próprio mapa cuida do pan
    if (e.button === 1 || espaco || (e.button === 0 && app.ui.tool === 'move')) {
      drag = { tipo: 'pan', sx, sy, cx: v.cx, cy: v.cy, moveu: false };
      atualizarCursor(); e.preventDefault();
    }
  }, true);

  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const [sx, sy] = pos(e);
    if (Math.hypot(sx - drag.sx, sy - drag.sy) > 3) drag.moveu = true;
    if (drag.tipo === 'pan') {
      v.cx = drag.cx - (sx - drag.sx) / v.k; v.cy = drag.cy + (sy - drag.sy) / v.k; draw();
    } else if (drag.tipo === 'furo' && drag.moveu) {
      const [wx, wy] = toW(sx, sy);
      const nx = +(wx + drag.dx).toFixed(2), ny = +(wy + drag.dy).toFixed(2);
      app.store.commit((d) => { const q = d.furos.find((k) => k.id === drag.id); if (q) { q.x = nx; q.y = ny; } }, { agrupar: 'mover:' + drag.id + ':' + drag.sx });
    }
  });

  window.addEventListener('mouseup', () => {
    if (!drag) return;
    const era = drag; drag = null; atualizarCursor();
    if (mapa) mapa.dragging.enable();
    if (era.tipo === 'furo' && era.moveu) app.setStatus('Furo movido (Ctrl+Z desfaz)', 'ok');
  });

  wrap.addEventListener('mousemove', (e) => {
    const [sx, sy] = pos(e), [x, y] = toW(sx, sy);
    let txt = `E: ${x.toFixed(2)} m  N: ${y.toFixed(2)} m`;
    if (ehGeorreferenciado(doc())) { const g = utmParaGeo(x, y, fuso()); txt += `  ·  ${fmtGraus(g.lat)}, ${fmtGraus(g.lon)}`; }
    document.getElementById('ps-coords').textContent = txt;
    if (app.ui.tool === 'corte' && corte.step === 1) { corte.preview = [x, y]; draw(); }
    if (app.ui.tool === 'medir' && medida.pts.length && !medida.fechada) { medida.preview = [x, y]; draw(); }
  });
  wrap.addEventListener('mouseleave', () => { corte.preview = null; medida.preview = null; document.getElementById('ps-coords').textContent = ''; draw(); });

  wrap.addEventListener('click', (e) => {
    if (ehControleMapa(e) || espaco) return;
    const [sx, sy] = pos(e);
    if (baixou && Math.hypot(sx - baixou[0], sy - baixou[1]) > 4) return; // foi arraste, não clique
    const [x, y] = toW(sx, sy);
    const t = app.ui.tool;
    if (t === 'furo') {
      const f = furoEm(sx, sy);
      if (f) { app.selecionarFuro(f.id); return; }
      app.abrirModalFuro({ x: +x.toFixed(2), y: +y.toFixed(2) });
      return;
    }
    if (t === 'move') { if (!furoEm(sx, sy)) app.selecionarFuro(null); return; }
    if (t === 'medir') {
      if (medida.fechada) resetMedida();
      medida.pts.push([x, y]); draw(); return;
    }
    if (t === 'corte') {
      if (corte.step === 0) { corte = { step: 1, p1: [x, y], p2: null, preview: null }; app.setStatus("Clique no ponto A' do corte", 'corte'); draw(); return; }
      if (corte.step === 1) {
        const [ax, ay] = toS(...corte.p1);
        if (Math.hypot(sx - ax, sy - ay) < 20) return;
        corte.p2 = [x, y]; corte.preview = null; corte.step = 2;
        app.setStatus(app.ui.incluir === 'ambos' ? 'Clique de um lado da linha para indicar o sentido de vista' : 'Clique do lado dos furos que entram no corte', 'corte'); draw(); return;
      }
      if (corte.step === 2) {
        const s = sideOfLine(x, y, corte.p1[0], corte.p1[1], corte.p2[0], corte.p2[1]);
        if (!s) return;
        const novo = {
          id: uid('c'), nome: proximoNomeCorte(doc().cortes),
          p1: corte.p1.map((n) => +n.toFixed(2)), p2: corte.p2.map((n) => +n.toFixed(2)),
          lado: s, faixa: app.ui.faixa, incluir: app.ui.incluir,
        };
        app.store.commit((d) => { d.cortes.push(novo); });
        app.ui.corteId = novo.id;
        const n = furosNoCorte(novo, doc().furos).length;
        resetCorte();
        setTool('move');
        app.setStatus(`Corte ${novo.nome} criado com ${n} furo(s)`, 'ok');
        app.render();
      }
    }
  });

  wrap.addEventListener('dblclick', () => {
    if (app.ui.tool === 'medir' && medida.pts.length > 1) {
      // o duplo clique também gerou um clique: remove o ponto repetido
      const [a, b] = medida.pts.slice(-2);
      if (a && b && Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) medida.pts.pop();
      medida.fechada = true; medida.preview = null; draw();
    }
  });

  wrap.addEventListener('wheel', (e) => {
    if (usaMapa()) return; // o mapa cuida do zoom
    e.preventDefault();
    const [sx, sy] = pos(e), [x, y] = toW(sx, sy);
    const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    v.k = Math.max(0.01, Math.min(500, v.k * f));
    v.cx = x - (sx - W / 2) / v.k; v.cy = y + (sy - H / 2) / v.k;
    draw();
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && app.ui.view === 'planta' && !ehCampo(e.target) && !usaMapa()) { espaco = true; atualizarCursor(); e.preventDefault(); }
    if (e.key === 'Escape' && corte.step > 0) { resetCorte(); setTool('corte'); }
    if (e.key === 'Escape' && app.ui.tool === 'medir') { resetMedida(); setTool('medir'); }
  });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') { espaco = false; atualizarCursor(); } });

  return { draw, ajustar, setTool, toS, toW, cancelarCorte: () => { resetCorte(); draw(); }, mapa: () => mapa };
}

const ehCampo = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA');

/** Texto com contorno branco, legível sobre o mapa. */
function halo(ctx, texto, x, y, cor) {
  ctx.save();
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineJoin = 'round';
  ctx.strokeText(texto, x, y);
  ctx.fillStyle = cor; ctx.fillText(texto, x, y);
  ctx.restore();
}

const fmtDist = (d) => (d >= 1000 ? `${(d / 1000).toFixed(3).replace('.', ',')} km` : `${d.toFixed(2).replace('.', ',')} m`);

function fmtCoord(v) {
  const a = Math.abs(v);
  return a >= 1000 ? v.toFixed(a >= 100000 ? 1 : 0) : a >= 10 ? (+v.toFixed(1)).toString() : (+v.toFixed(2)).toString();
}
