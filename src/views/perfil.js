// Perfil 2D ao longo do corte ativo, desenhado a partir da geometria de geo/perfil2d.js
// (contatos interpolados com acunhamento, ou troca no meio do vão no modo "degrau").
import { niceStep, extensaoCotas } from '../geo/zonas.js';
import { geometriaPerfil } from '../geo/perfil2d.js';
import { perfilDoCorte } from '../geo/corte.js';
import { secLabel } from '../model/catalogo.js';
import { ajustarCanvas, hachurar } from './hatch.js';
import { NA_COR, PERIGO, ACCENT } from '../styles/tema.js';

const PML = 68, PMR = 160, PMT = 44, PMB = 44, RULER_W = 8, SPT_TXT = 4;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function criarPerfil(app) {
  const area = document.getElementById('canvasArea');
  const canvas = document.getElementById('profileCanvas');
  const o = app.ui.perfil; // { axis, showNA, showLab, showSPT, showHatch, zoom, panX }
  let W = 0, H = 0, bhs = [], ext = { minCota: 0, maxCota: 1 }, geo = null;
  let arrasteP = null; // alça de acunhamento sendo arrastada: { chave, vao, tipo, t }

  const ppW = () => W - PML - PMR, ppH = () => H - PMT - PMB;
  const maxDist = () => (bhs.length > 1 ? Math.max(...bhs.map((b) => b.dist)) : 100);
  const pwx = (d) => PML + ((d - o.panX) / ((maxDist() || 1) / o.zoom)) * (ppW() || 1);
  const pwy = (c) => PMT + ((ext.maxCota - c) / (ext.maxCota - ext.minCota || 1)) * (ppH() || 1);
  const depthOf = (b) => (b.layers.length ? Math.max(...b.layers.map((l) => l.ate)) : 0);

  function clampPan() {
    if (!Number.isFinite(o.panX)) o.panX = 0;
    const vis = maxDist() / o.zoom;
    o.panX = Math.max(0, Math.min(o.panX, maxDist() - vis));
    if (o.zoom <= 1) o.panX = 0;
  }

  function drawZonePoly(ctx, pts, solo, sec) {
    ctx.save(); ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath(); ctx.fillStyle = solo.fill; ctx.fill();
    if (o.showHatch) {
      ctx.clip();
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const bx = Math.min(...xs), by = Math.min(...ys);
      hachurar(ctx, solo, sec, bx, by, Math.max(...xs) - bx, Math.max(...ys) - by);
    }
    ctx.restore();
  }

  function drawTextBg(ctx, text, x, y, font, col) {
    ctx.save(); ctx.font = font;
    const tw = ctx.measureText(text).width, fs = parseInt(font.match(/(\d+)px/)?.[1] || 10), th = fs + 2;
    ctx.fillStyle = 'rgba(255,255,255,0.88)'; ctx.fillRect(x - tw / 2 - 3, y - th / 2 - 1, tw + 6, th + 2);
    ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y);
    ctx.restore();
  }

  function drawSPTRuler(ctx, b) {
    if (!b.layers.length) return;
    const td = depthOf(b), cx = pwx(b.dist);
    for (let m = 1; m <= Math.ceil(td); m++) {
      const yT = pwy(b.cota - (m - 1)), yB = pwy(b.cota - m), h = yB - yT;
      if (h <= 0) continue;
      ctx.fillStyle = m % 2 ? '#1a1a1a' : '#fff'; ctx.fillRect(cx - RULER_W, yT, RULER_W * 2, h);
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.5; ctx.strokeRect(cx - RULER_W, yT, RULER_W * 2, h);
      const n = b.spt[m], t = b.sptTexto[m];
      if (t !== undefined && h > 7) {
        ctx.save(); ctx.fillStyle = n >= 50 ? PERIGO : '#111'; ctx.font = h > 10 ? '500 9px sans-serif' : '8px sans-serif';
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(t, cx + RULER_W + SPT_TXT, yT + h / 2); ctx.restore();
      }
    }
  }

  function drawImpSymbol(ctx, b) {
    const depth = depthOf(b);
    if (!depth || !b.imp) return;
    const cx = pwx(b.dist), yBase = pwy(b.cota - depth);
    ctx.save(); ctx.strokeStyle = PERIGO; ctx.lineWidth = 2; ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) { const y2 = yBase + 5 + i * 6; ctx.beginPath(); ctx.moveTo(cx - 10, y2); ctx.lineTo(cx + 10, y2); ctx.stroke(); }
    ctx.font = '500 9px sans-serif';
    const tx = cx + 14, ty = yBase + 12, tw = ctx.measureText('Imp.').width;
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(tx - 1, ty - 8, tw + 2, 11);
    ctx.fillStyle = PERIGO; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText('Imp.', tx, ty - 2);
    ctx.restore();
  }

  function atualizarDados() {
    const corte = app.corteAtivo();
    bhs = perfilDoCorte(corte, app.store.doc.furos);
    ext = extensaoCotas(bhs);
    const ajustes = { ...(corte?.ajustes || {}) };
    if (arrasteP) ajustes[arrasteP.chave] = arrasteP.t;
    geo = geometriaPerfil(bhs, { ajustes, modo: o.modo });
    clampPan();
  }

  function draw() {
    if (app.ui.view !== 'perfil') return;
    atualizarDados();
    const r = ajustarCanvas(canvas, area); const ctx = r.ctx; W = r.w; H = r.h;
    ctx.clearRect(0, 0, W, H);
    const corte = app.corteAtivo();
    const nome = corte ? corte.nome : '—';
    document.getElementById('sb-furos').textContent = `Corte ${nome} · ${bhs.length} furo(s)`;
    if (bhs.length < 2) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(!app.store.doc.cortes.length ? 'Defina um corte na aba Planta.' : !corte ? 'Selecione um corte.'
        : bhs.length === 0 ? `Corte ${nome}: nenhum furo dentro da faixa.` : `Corte ${nome}: são necessários pelo menos 2 furos na faixa.`, W / 2, H / 2);
      buildLegend(); document.getElementById('sb-dist').textContent = '—'; document.getElementById('sb-depth').textContent = '—';
      return;
    }
    const { minCota, maxCota } = ext;
    // grade e eixos
    const yStep = niceStep((maxCota - minCota) / 6);
    ctx.save(); ctx.strokeStyle = 'rgba(128,128,128,0.12)'; ctx.lineWidth = 0.5;
    for (let c = Math.floor(minCota / yStep) * yStep; c <= maxCota + yStep; c += yStep) {
      const y = pwy(c); if (y < PMT || y > PMT + ppH()) continue;
      ctx.beginPath(); ctx.moveTo(PML, y); ctx.lineTo(PML + ppW(), y); ctx.stroke();
    }
    for (let c = Math.floor(minCota), mc = Math.ceil(maxCota); c <= mc; c++) {
      const y = pwy(c); if (y < PMT - 1 || y > PMT + ppH() + 1) continue;
      const isMaj = c % yStep === 0;
      ctx.strokeStyle = 'rgba(80,80,80,0.55)'; ctx.lineWidth = isMaj ? 0.8 : 0.4;
      ctx.beginPath(); ctx.moveTo(PML - (isMaj ? 5 : 2), y); ctx.lineTo(PML, y); ctx.stroke();
      if (isMaj || ppH() / (maxCota - minCota) > 14) {
        ctx.fillStyle = isMaj ? 'rgba(50,50,50,0.9)' : 'rgba(80,80,80,0.6)'; ctx.font = isMaj ? '500 9px sans-serif' : '8px sans-serif';
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText(o.axis === 'cota' ? c + 'm' : Math.round(maxCota - c) + 'm', PML - 6, y);
      }
    }
    const vis = maxDist() / o.zoom, dStep = niceStep(vis / 5);
    ctx.strokeStyle = 'rgba(128,128,128,0.12)';
    for (let d = Math.ceil(o.panX / dStep) * dStep; d <= o.panX + vis + dStep; d += dStep) {
      const x = pwx(d); if (x < PML || x > PML + ppW()) continue;
      ctx.beginPath(); ctx.moveTo(x, PMT); ctx.lineTo(x, PMT + ppH()); ctx.stroke();
      ctx.fillStyle = 'rgba(80,80,80,0.8)'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(d.toFixed(0) + 'm', x, PMT + ppH() + 13);
    }
    ctx.restore();
    ctx.save(); ctx.fillStyle = 'rgba(80,80,80,0.9)'; ctx.font = '500 9px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Distância (m)', PML + ppW() / 2, H - 6);
    ctx.translate(12, PMT + ppH() / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(o.axis === 'cota' ? 'Cota (m)' : 'Profundidade (m)', 0, 0);
    ctx.restore();

    // camadas (polígonos da geometria do perfil)
    ctx.save(); ctx.beginPath(); ctx.rect(PML, PMT, ppW(), ppH()); ctx.clip();
    const tela = (pts) => pts.map(([d, c]) => [pwx(d), pwy(c)]);
    geo.poligonos.forEach((p) => drawZonePoly(ctx, tela(p.pts), p.solo, p.sec));
    ctx.save(); ctx.strokeStyle = 'rgba(30,30,30,0.6)'; ctx.lineWidth = 0.9; ctx.lineJoin = 'round';
    geo.poligonos.forEach((p) => {
      ctx.beginPath(); tela(p.pts).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke();
    });
    ctx.restore();
    if (o.showLab) geo.poligonos.forEach((p) => {
      const { d, c, h: hm } = p.rotulo, x = pwx(d), y = pwy(c), h = pwy(c - hm / 2) - pwy(c + hm / 2);
      if (h < 10) return;
      const sec = secLabel(p.sec);
      if (h >= 26) { drawTextBg(ctx, p.solo.code, x, y - 7, '600 11px sans-serif', '#111'); if (sec) drawTextBg(ctx, sec, x, y + 6, '500 10px sans-serif', '#222'); }
      else if (h >= 16) { drawTextBg(ctx, p.solo.code, x, y - 5, '600 10px sans-serif', '#111'); if (sec) drawTextBg(ctx, sec, x, y + 5, '500 9px sans-serif', '#222'); }
      else drawTextBg(ctx, p.solo.code, x, y, '600 9px sans-serif', '#111');
    });
    // terreno
    ctx.strokeStyle = '#1a1a0a'; ctx.lineWidth = 2.5; ctx.beginPath();
    bhs.forEach((b, i) => (i ? ctx.lineTo(pwx(b.dist), pwy(b.cota)) : ctx.moveTo(pwx(b.dist), pwy(b.cota)))); ctx.stroke();
    // NA
    if (o.showNA) {
      ctx.save(); ctx.strokeStyle = NA_COR; ctx.lineWidth = 1.5; ctx.setLineDash([6, 3]); ctx.globalAlpha = 0.75; ctx.beginPath();
      bhs.forEach((b, i) => (i ? ctx.lineTo(pwx(b.dist), pwy(b.cota - b.na)) : ctx.moveTo(pwx(b.dist), pwy(b.cota - b.na)))); ctx.stroke(); ctx.restore();
      bhs.forEach((b) => {
        const x = pwx(b.dist), y = pwy(b.cota - b.na);
        ctx.save(); ctx.strokeStyle = NA_COR; ctx.lineWidth = 1.5;
        [-4, 0, 4].forEach((dy, k) => { const hw = 7 - k * 2; ctx.beginPath(); ctx.moveTo(x - hw, y + dy); ctx.lineTo(x + hw, y + dy); ctx.stroke(); });
        ctx.restore();
      });
    }
    ctx.restore();
    if (o.showSPT) { bhs.forEach((b) => drawSPTRuler(ctx, b)); bhs.forEach((b) => drawImpSymbol(ctx, b)); }
    // rótulos dos furos
    bhs.forEach((b) => {
      const x = pwx(b.dist); if (x < PML - 20 || x > PML + ppW() + 20) return;
      ctx.save(); ctx.strokeStyle = 'rgba(60,60,60,0.4)'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(x, pwy(b.cota)); ctx.lineTo(x, PMT - 4); ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.font = '500 11px sans-serif'; ctx.fillStyle = '#111'; ctx.fillText(b.name, x, PMT - 18);
      ctx.font = '9px sans-serif'; ctx.fillStyle = '#444';
      ctx.fillText(b.cota ? b.cota.toFixed(1) + 'm' : '', x, PMT - 7);
      ctx.fillText('d=' + b.dist.toFixed(0) + 'm', x, PMT + ppH() + 26);
      ctx.restore();
    });
    if (o.editar && o.modo !== 'degrau') geo.pontas.forEach((pt) => {
      const x = pwx(pt.d), y = pwy(pt.c), mexida = Math.abs(pt.ponta - pt.padrao) > 1e-6, ativa = arrasteP?.chave === pt.chave;
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4);
      ctx.fillStyle = ativa || mexida ? ACCENT : '#fff'; ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.5;
      ctx.fillRect(-5, -5, 10, 10); ctx.strokeRect(-5, -5, 10, 10);
      ctx.restore();
    });
    const [n1, n2] = (corte?.nome || "A–A'").split('–');
    ctx.save(); ctx.strokeStyle = 'rgba(100,100,100,0.4)'; ctx.lineWidth = 1; ctx.strokeRect(PML, PMT, ppW(), ppH());
    ctx.fillStyle = '#444'; ctx.font = '500 10px sans-serif'; ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left'; ctx.fillText(n1 || 'A', PML - 16, PMT + 5);
    ctx.textAlign = 'right'; ctx.fillText(n2 || "A'", PML + ppW() + 16, PMT + 5);
    ctx.restore();
    document.getElementById('sb-dist').textContent = `Extensão: ${maxDist().toFixed(0)} m`;
    document.getElementById('sb-depth').textContent = `Prof. máx.: ${Math.max(...bhs.map(depthOf)).toFixed(0)} m`;
    buildLegend(); updateScrollbar();
  }

  function buildLegend() {
    const el = document.getElementById('legendPanel');
    const seen = new Map();
    if (bhs.length >= 2) bhs.forEach((b) => b.layers.forEach((l) => seen.set(l.solo.code, l.solo)));
    if (!seen.size) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="leg-ttl">Legenda</div>' + [...seen.values()].map((s) =>
      `<div class="leg-row"><div class="leg-sw" style="background:${s.fill};border-color:${s.hex}55"></div><span>${esc(s.code)} — ${esc(s.label.split('—')[1]?.trim() || s.label)}</span></div>`).join('') +
      `<div class="leg-row" style="margin-top:6px"><div style="width:18px;border-top:2.5px solid #1a1a0a;margin-right:6px"></div>Terreno</div>
       <div class="leg-row"><div style="display:flex;flex-direction:column;gap:1px;margin-right:6px"><div style="width:14px;height:5px;background:#1a1a1a"></div><div style="width:14px;height:5px;background:#fff;border:.5px solid #aaa"></div></div>Régua SPT</div>
       <div class="leg-row"><div style="width:18px;border-top:1.5px dashed ${NA_COR};margin-right:6px"></div>Nível d'água</div>`;
  }

  // ── zoom, pan e barra de rolagem ──
  const thumb = document.getElementById('scrollThumb'), track = document.getElementById('scrollTrack');
  function updateScrollbar() {
    const tw = track.offsetWidth;
    if (o.zoom <= 1) { thumb.style.left = '0px'; thumb.style.width = tw + 'px'; return; }
    const w = Math.max(tw / o.zoom, 40), maxL = tw - w;
    thumb.style.width = w + 'px';
    const faixaPan = maxDist() - maxDist() / o.zoom || 1;
    thumb.style.left = Math.max(0, Math.min((o.panX / faixaPan) * maxL, maxL)) + 'px';
  }
  function setZoom(z, ancoraPx = null) {
    const w = ppW() || 1;
    const mx = ancoraPx ?? PML + w / 2;
    const wx = o.panX + ((mx - PML) / w) * (maxDist() / o.zoom);
    o.zoom = Math.max(1, Math.min(8, z));
    o.panX = wx - ((mx - PML) / w) * (maxDist() / o.zoom);
    clampPan();
    document.getElementById('zoomLabel').textContent = Math.round(o.zoom * 100) + '%';
    draw();
  }

  let tDrag = null, cDrag = null;
  thumb.addEventListener('mousedown', (e) => { tDrag = { x: e.clientX, p: o.panX }; thumb.classList.add('dragging'); e.preventDefault(); });
  function pontaEm(cx, cy) {
    if (!o.editar || o.modo === 'degrau' || !geo) return null;
    return geo.pontas.find((pt) => Math.hypot(pwx(pt.d) - cx, pwy(pt.c) - cy) <= 9) || null;
  }
  const xyCanvas = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('mousedown', (e) => {
    const [cx, cy] = xyCanvas(e);
    const pt = pontaEm(cx, cy);
    if (pt) { arrasteP = { chave: pt.chave, vao: pt.vao, tipo: pt.tipo, t: pt.ponta, padrao: pt.padrao }; e.preventDefault(); return; }
    if (o.zoom > 1) { cDrag = { x: e.clientX, p: o.panX }; canvas.style.cursor = 'grabbing'; }
  });
  canvas.addEventListener('dblclick', (e) => {
    const [cx, cy] = xyCanvas(e);
    const pt = pontaEm(cx, cy), corte = app.corteAtivo();
    if (!pt || !corte) return;
    app.store.commit((d) => { const c = d.cortes.find((q) => q.id === corte.id); if (c.ajustes) delete c.ajustes[pt.chave]; });
    app.toast('Acunhamento voltou ao padrão.');
  });
  window.addEventListener('mousemove', (e) => {
    if (!arrasteP) return;
    const [cx] = xyCanvas(e);
    const dist = o.panX + ((cx - PML) / (ppW() || 1)) * (maxDist() / o.zoom);
    const [dA, dB] = arrasteP.vao;
    let t = (dist - dA) / (dB - dA || 1);
    t = arrasteP.tipo === 'A' ? Math.min(1, Math.max(0.05, t)) : Math.min(0.95, Math.max(0, t));
    arrasteP.t = +t.toFixed(3);
    draw();
  });
  window.addEventListener('mouseup', () => {
    if (!arrasteP) return;
    const a = arrasteP, corte = app.corteAtivo();
    arrasteP = null;
    if (!corte) return;
    app.store.commit((d) => {
      const c = d.cortes.find((q) => q.id === corte.id);
      c.ajustes = { ...(c.ajustes || {}) };
      if (Math.abs(a.t - a.padrao) < 0.01) delete c.ajustes[a.chave]; else c.ajustes[a.chave] = a.t;
    });
  });
  window.addEventListener('mousemove', (e) => {
    if (tDrag) {
      const tw = track.offsetWidth, w = Math.max(tw / o.zoom, 40), maxL = tw - w || 1;
      o.panX = tDrag.p + ((e.clientX - tDrag.x) / maxL) * (maxDist() - maxDist() / o.zoom); clampPan(); draw();
    } else if (cDrag) {
      o.panX = cDrag.p - ((e.clientX - cDrag.x) / (ppW() || 1)) * (maxDist() / o.zoom); clampPan(); draw();
    }
  });
  window.addEventListener('mouseup', () => { tDrag = null; cDrag = null; thumb.classList.remove('dragging'); canvas.style.cursor = o.zoom > 1 ? 'grab' : 'default'; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const mx = e.clientX - canvas.getBoundingClientRect().left;
    setZoom(o.zoom + (e.deltaY < 0 ? 0.25 : -0.25), mx);
  }, { passive: false });
  canvas.addEventListener('mousemove', (e) => {
    if (cDrag) return;
    const r = canvas.getBoundingClientRect(), cx = e.clientX - r.left, cy = e.clientY - r.top;
    canvas.style.cursor = pontaEm(cx, cy) || arrasteP ? 'ew-resize' : o.zoom > 1 ? 'grab' : 'default';
    const out = document.getElementById('sb-cursor');
    if (bhs.length < 2 || cx < PML || cx > PML + ppW() || cy < PMT || cy > PMT + ppH()) { out.textContent = ''; return; }
    const dist = o.panX + ((cx - PML) / (ppW() || 1)) * (maxDist() / o.zoom);
    const cota = ext.maxCota - ((cy - PMT) / (ppH() || 1)) * (ext.maxCota - ext.minCota);
    out.textContent = `d=${dist.toFixed(1)} m | ${o.axis === 'cota' ? 'cota=' + cota.toFixed(1) : 'prof=' + (ext.maxCota - cota).toFixed(1)} m`;
  });
  canvas.addEventListener('mouseleave', () => { document.getElementById('sb-cursor').textContent = ''; });

  return {
    draw,
    zoomDelta: (d) => setZoom(o.zoom + d),
    zoomFit: () => { o.zoom = 1; o.panX = 0; document.getElementById('zoomLabel').textContent = '100%'; draw(); },
    dados: () => { atualizarDados(); return { bhs, ext, maxDist: maxDist(), geo }; },
    xy: (d, c) => [pwx(d), pwy(c)],
  };
}
