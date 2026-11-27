// Perfil 2D ao longo do corte ativo, desenhado a partir da geometria de geo/perfil2d.js
// (contatos interpolados com acunhamento, em reta ou em curva no modo "suave", ou
// troca no meio do vão no modo "degrau"). O modo fica salvo em cada corte.
import { extensaoCotas } from '../geo/zonas.js';
import { geometriaPerfil } from '../geo/perfil2d.js';
import { perfilDoCorte } from '../geo/corte.js';
import { desenharPerfil, legendaPerfil } from '../geo/desenho.js';
import { estiloPadrao } from '../model/projeto.js';
import { ajustarCanvas } from './hatch.js';
import { renderCanvas } from './renderCanvas.js';
import { ACCENT } from '../styles/tema.js';

// margens da área do perfil (px) e px por milímetro de papel (tamanho de textos e símbolos)
const PML = 92, PMR = 280, PMT = 74, PMB = 62, MM = 3;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function criarPerfil(app) {
  const area = document.getElementById('canvasArea');
  const canvas = document.getElementById('profileCanvas');
  const o = app.ui.perfil; // { axis, showNA, showLab, showSPT, showHatch, zoom, panX }
  let W = 0, H = 0, bhs = [], ext = { minCota: 0, maxCota: 1 }, geo = null;
  let arrasteP = null; // alça de acunhamento sendo arrastada: { chave, vao, tipo, t }

  const ppW = () => W - PML - PMR, ppH = () => H - PMT - PMB;
  const maxDist = () => (bhs.length > 1 ? Math.max(...bhs.map((b) => b.dist)) : 100);
  // folga nas pontas: os furos extremos não ficam colados na moldura (como na prancha)
  const folga = () => Math.max(2, maxDist() * 0.05);
  const dIni = () => -folga(), span = () => (maxDist() || 1) + 2 * folga();
  const pwx = (d) => PML + ((d - dIni() - o.panX) / (span() / o.zoom)) * (ppW() || 1);
  const pwy = (c) => PMT + ((ext.maxCota - c) / (ext.maxCota - ext.minCota || 1)) * (ppH() || 1);
  const depthOf = (b) => (b.layers.length ? Math.max(...b.layers.map((l) => l.ate)) : 0);

  function clampPan() {
    if (!Number.isFinite(o.panX)) o.panX = 0;
    const vis = span() / o.zoom;
    o.panX = Math.max(0, Math.min(o.panX, span() - vis));
    if (o.zoom <= 1) o.panX = 0;
  }

  const estilo = () => estiloPadrao(app.store.doc.projeto.estilo || {});

  function atualizarDados() {
    const corte = app.corteAtivo();
    bhs = perfilDoCorte(corte, app.store.doc.furos, { porHorizonte: estilo().cor === 'horizonte' });
    ext = extensaoCotas(bhs);
    const ajustes = { ...(corte?.ajustes || {}) };
    if (arrasteP) ajustes[arrasteP.chave] = arrasteP.t;
    geo = geometriaPerfil(bhs, { ajustes, modo: corte?.modo || 'interpolado' });
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
    // o mesmo desenho do PDF, do DXF e da prancha (geo/desenho.js), na janela visível
    const cfg = app.store.doc.projeto, est = estilo(), vis = span() / o.zoom;
    const janela = { d0: dIni() + o.panX, d1: dIni() + o.panX + vis, c0: ext.minCota, c1: ext.maxCota };
    const visiveis = bhs.filter((b) => b.dist >= janela.d0 - vis * 0.02 && b.dist <= janela.d1 + vis * 0.02);
    const { itens } = desenharPerfil({
      bhs, furos: visiveis, geo, corte, estilo: est, axis: o.axis, X: pwx, Y: pwy, mm: MM, janela, cTopo: ext.maxCota,
      mostrar: { na: o.showNA, spt: o.showSPT, rotulos: est.rotulos, hachura: est.hachura },
      naProjeto: cfg.naProjeto, referencias: cfg.referencias || [],
    });
    renderCanvas(ctx, itens, MM, [PML, PMT, PML + ppW(), PMT + ppH()]);
    if (o.editar && app.corteAtivo()?.modo !== 'degrau') geo.pontas.forEach((pt) => {
      const x = pwx(pt.d), y = pwy(pt.c), mexida = Math.abs(pt.ponta - pt.padrao) > 1e-6, ativa = arrasteP?.chave === pt.chave;
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4);
      ctx.fillStyle = ativa || mexida ? ACCENT : '#fff'; ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.5;
      ctx.fillRect(-5, -5, 10, 10); ctx.strokeRect(-5, -5, 10, 10);
      ctx.restore();
    });
    document.getElementById('sb-dist').textContent = `Extensão: ${maxDist().toFixed(0)} m`;
    document.getElementById('sb-depth').textContent = `Prof. máx.: ${Math.max(...bhs.map(depthOf)).toFixed(0)} m`;
    buildLegend(); updateScrollbar();
  }

  function buildLegend() {
    const el = document.getElementById('legendPanel');
    if (bhs.length < 2 || !geo) { el.innerHTML = ''; return; }
    const cfg = app.store.doc.projeto;
    const itens = legendaPerfil(bhs, geo, { estilo: estilo(), naProjeto: cfg.naProjeto, referencias: cfg.referencias || [], mostrar: { na: o.showNA } });
    const amostra = (e) => {
      if (e.tipo === 'material') return `<div class="leg-sw" style="background:${e.fill}"></div>`;
      if (e.tipo === 'bloco') return `<div class="leg-sw" style="background:${e.fill};border-radius:40% 55% 45% 60%"></div>`;
      if (e.tipo === 'rocha') return `<div style="width:18px;height:6px;border-top:1.5px solid #333;background:repeating-linear-gradient(60deg,${e.cor} 0 1px,transparent 1px 4px);margin-right:0"></div>`;
      if (e.tipo === 'linha') return `<div style="width:18px;border-top:${Math.max(1.5, e.lw * 4)}px ${e.dash ? 'dashed' : 'solid'} ${e.cor}"></div>`;
      return `<div style="width:6px;height:12px;border:.5px solid #333;background:repeating-linear-gradient(45deg,#333 0 .6px,#fff .6px 2.5px);margin:0 6px"></div>`;
    };
    el.innerHTML = '<div class="leg-ttl">Legenda</div>' + itens.map((e) => `<div class="leg-row">${amostra(e)}<span>${esc(e.texto)}</span></div>`).join('');
  }

  // ── zoom, pan e barra de rolagem ──
  const thumb = document.getElementById('scrollThumb'), track = document.getElementById('scrollTrack');
  function updateScrollbar() {
    const tw = track.offsetWidth;
    if (o.zoom <= 1) { thumb.style.left = '0px'; thumb.style.width = tw + 'px'; return; }
    const w = Math.max(tw / o.zoom, 40), maxL = tw - w;
    thumb.style.width = w + 'px';
    const faixaPan = span() - span() / o.zoom || 1;
    thumb.style.left = Math.max(0, Math.min((o.panX / faixaPan) * maxL, maxL)) + 'px';
  }
  function setZoom(z, ancoraPx = null) {
    const w = ppW() || 1;
    const mx = ancoraPx ?? PML + w / 2;
    const wx = o.panX + ((mx - PML) / w) * (span() / o.zoom);
    o.zoom = Math.max(1, Math.min(8, z));
    o.panX = wx - ((mx - PML) / w) * (span() / o.zoom);
    clampPan();
    document.getElementById('zoomLabel').textContent = Math.round(o.zoom * 100) + '%';
    draw();
  }

  let tDrag = null, cDrag = null;
  thumb.addEventListener('mousedown', (e) => { tDrag = { x: e.clientX, p: o.panX }; thumb.classList.add('dragging'); e.preventDefault(); });
  function pontaEm(cx, cy) {
    if (!o.editar || app.corteAtivo()?.modo === 'degrau' || !geo) return null;
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
    const dist = dIni() + o.panX + ((cx - PML) / (ppW() || 1)) * (span() / o.zoom);
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
      o.panX = tDrag.p + ((e.clientX - tDrag.x) / maxL) * (span() - span() / o.zoom); clampPan(); draw();
    } else if (cDrag) {
      o.panX = cDrag.p - ((e.clientX - cDrag.x) / (ppW() || 1)) * (span() / o.zoom); clampPan(); draw();
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
    const dist = dIni() + o.panX + ((cx - PML) / (ppW() || 1)) * (span() / o.zoom);
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
