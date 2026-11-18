// Planta de locação: coordenadas reais em metros, com pan e zoom.
import { ajustarCanvas } from './hatch.js';
import { ACCENT, ACCENT_RGB, OK, ALERTA, corFuro } from '../styles/tema.js';
import { niceStep } from '../geo/zonas.js';
import { sideOfLine, projectPoint, furosNoCorte, proximoNomeCorte } from '../geo/corte.js';
import { uid } from '../model/projeto.js';

const HIT_PX = 13;

export function criarPlanta(app) {
  const wrap = document.getElementById('plantaWrap');
  const canvas = document.getElementById('plantaCanvas');
  const v = app.ui.planta; // { k (px/m), cx, cy (centro em metros) }
  let W = 0, H = 0;
  // estado transitório da ferramenta de corte e do arraste
  let corte = { step: 0, p1: null, p2: null, preview: null };
  let drag = null; // { tipo: 'pan'|'furo', ... }
  let espaco = false;
  let acabouDeArrastar = false;

  const toS = (x, y) => [W / 2 + (x - v.cx) * v.k, H / 2 - (y - v.cy) * v.k];
  const toW = (sx, sy) => [v.cx + (sx - W / 2) / v.k, v.cy - (sy - H / 2) / v.k];
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  function furoEm(sx, sy) {
    const furos = app.store.doc.furos;
    for (let i = furos.length - 1; i >= 0; i--) {
      const [fx, fy] = toS(furos[i].x, furos[i].y);
      if (Math.hypot(sx - fx, sy - fy) <= HIT_PX) return furos[i];
    }
    return null;
  }

  function ajustar() {
    const { furos, cortes } = app.store.doc;
    const pts = [...furos.map((f) => [f.x, f.y]), ...cortes.flatMap((c) => [c.p1, c.p2])];
    W = wrap.clientWidth || W; H = wrap.clientHeight || H;
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
    // barra de escala
    const barM = niceStep(90 / v.k), barPx = barM * v.k;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(20, H - 20); ctx.lineTo(20 + barPx, H - 20);
    ctx.moveTo(20, H - 16); ctx.lineTo(20, H - 24); ctx.moveTo(20 + barPx, H - 16); ctx.lineTo(20 + barPx, H - 24); ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.textAlign = 'center';
    ctx.fillText(`${barM} m`, 20 + barPx / 2, H - 26);
    // norte
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

  /** Linha de corte em coordenadas de tela, com marcas nas pontas, rótulos e setas. */
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
    ctx.fillStyle = cor; ctx.font = larg > 1.5 ? '500 12px sans-serif' : '11px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(nomes[0], a[0] - nx * 22, a[1] - ny * 22);
    ctx.fillText(nomes[1], b[0] + nx * 22, b[1] + ny * 22);
    ctx.restore();
  }

  function drawFaixa(ctx, p1, p2, faixa) {
    if (faixa === null || faixa === undefined) return;
    const dx = p2[0] - p1[0], dy = p2[1] - p1[1], len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    const ux = dx / len, uy = dy / len, px = -uy * faixa, py = ux * faixa;
    const e = faixa; // tolerância nas pontas
    const cantos = [
      [p1[0] - ux * e + px, p1[1] - uy * e + py], [p2[0] + ux * e + px, p2[1] + uy * e + py],
      [p2[0] + ux * e - px, p2[1] + uy * e - py], [p1[0] - ux * e - px, p1[1] - uy * e - py],
    ].map(([x, y]) => toS(x, y));
    ctx.save(); ctx.beginPath();
    cantos.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = `rgba(${ACCENT_RGB},0.07)`; ctx.fill();
    ctx.strokeStyle = `rgba(${ACCENT_RGB},0.3)`; ctx.lineWidth = 0.6; ctx.setLineDash([5, 4]); ctx.stroke();
    ctx.restore();
  }

  function draw() {
    if (app.ui.view !== 'planta') return;
    const r = ajustarCanvas(canvas, wrap);
    const ctx = r.ctx; W = r.w; H = r.h;
    ctx.clearRect(0, 0, W, H);
    drawGrid(ctx);
    const { furos, cortes } = app.store.doc;
    const ativo = app.corteAtivo();

    // faixa do corte ativo (ou do corte em construção)
    if (corte.step > 0 && corte.p1) {
      const fim = corte.p2 || corte.preview;
      if (fim) drawFaixa(ctx, corte.p1, fim, app.ui.faixa);
    } else if (ativo) drawFaixa(ctx, ativo.p1, ativo.p2, ativo.faixa);

    cortes.forEach((c) => {
      const isA = ativo && c.id === ativo.id;
      const [n1, n2] = c.nome.split('–');
      drawLinhaCorte(ctx, toS(...c.p1), toS(...c.p2), {
        cor: isA ? ACCENT : `rgba(${ACCENT_RGB},0.45)`, larg: isA ? 2 : 1.2, tracejado: !isA,
        nomes: [n1 || 'A', n2 || "A'"], ladoTela: -c.lado,
      });
    });

    // corte em construção
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

    // furos incluídos no corte ativo
    const incl = new Set(ativo && corte.step === 0 ? furosNoCorte(ativo, furos).map((f) => f.id) : []);
    if (ativo && corte.step === 0) {
      const [ax, ay] = ativo.p1, [bx, by] = ativo.p2;
      furos.filter((f) => incl.has(f.id)).forEach((f) => {
        const pr = projectPoint(f.x, f.y, ax, ay, bx, by);
        const [sx, sy] = toS(f.x, f.y), [qx, qy] = toS(pr.px, pr.py);
        ctx.save(); ctx.strokeStyle = OK; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.globalAlpha = 0.5;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(qx, qy); ctx.stroke(); ctx.restore();
      });
    }

    const selId = app.ui.furoId;
    furos.forEach((f, i) => {
      const [x, y] = toS(f.x, f.y);
      const isSel = f.id === selId && app.ui.tool !== 'corte';
      const isIncl = incl.size > 0 && incl.has(f.id);
      const isExcl = ativo && corte.step === 0 && !incl.has(f.id);
      ctx.save();
      if (isExcl) ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.fillStyle = isSel ? '#FAEEDA' : isIncl ? '#EAF3DE' : '#E6EFFB'; ctx.fill();
      ctx.strokeStyle = isSel ? ALERTA : isIncl ? OK : corFuro(i);
      ctx.lineWidth = isSel || isIncl ? 2 : 1.5;
      if (isExcl) ctx.setLineDash([3, 2]);
      ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = isSel ? '#633806' : isIncl ? '#27500A' : '#111';
      ctx.font = '500 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(f.nome.replace(/^SP-/, ''), x, y);
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.font = '10px sans-serif'; ctx.textBaseline = 'top';
      ctx.fillText(f.nome, x, y + 14);
      ctx.fillStyle = 'rgba(0,0,0,0.42)'; ctx.font = '9px sans-serif';
      ctx.fillText(`(${fmtCoord(f.x)}; ${fmtCoord(f.y)})`, x, y + 25);
      ctx.restore();
    });

    document.getElementById('ps-furos').textContent = `${furos.length} furos`;
    document.getElementById('ps-corte').textContent = ativo
      ? `${ativo.nome}: ${furosNoCorte(ativo, furos).length} furo(s) · faixa ${ativo.faixa === null ? 'sem limite' : ativo.faixa + ' m'}`
      : 'Nenhum corte';
  }

  function drawEscolhaLado(ctx, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    if (len < 2) return;
    const nx = dx / len, ny = dy / len, mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    [1, -1].forEach((s) => {
      const px = -ny * s, py = nx * s, hx = mx + px * 38, hy = my + py * 38, ang = Math.atan2(py, px);
      ctx.save();
      ctx.beginPath(); ctx.arc(hx, hy, 16, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${ACCENT_RGB},0.15)`; ctx.fill();
      ctx.strokeStyle = `rgba(${ACCENT_RGB},0.5)`; ctx.lineWidth = 1; ctx.stroke();
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

  function setTool(t) {
    app.ui.tool = t;
    resetCorte();
    ['furo', 'corte', 'move'].forEach((n) => document.getElementById('tb-' + n).classList.toggle('active', n === t));
    if (t === 'corte') app.setStatus('Clique no ponto A do corte', 'corte');
    if (t === 'furo') app.setStatus('Clique para lançar furo', '');
    if (t === 'move') app.setStatus('Clique em um furo para selecionar; arraste para mover', '');
    atualizarCursor();
    draw();
  }

  function atualizarCursor() {
    wrap.style.cursor = drag?.tipo === 'pan' ? 'grabbing' : espaco ? 'grab' : app.ui.tool === 'move' ? 'default' : 'crosshair';
  }

  canvas.addEventListener('mousedown', (e) => {
    const [sx, sy] = pos(e);
    if (e.button === 1 || espaco || (e.button === 0 && app.ui.tool === 'move' && !furoEm(sx, sy))) {
      drag = { tipo: 'pan', sx, sy, cx: v.cx, cy: v.cy, moveu: false };
      atualizarCursor(); e.preventDefault(); return;
    }
    if (e.button === 0 && app.ui.tool === 'move') {
      const f = furoEm(sx, sy);
      if (f) {
        app.selecionarFuro(f.id);
        drag = { tipo: 'furo', id: f.id, sx, sy, x0: f.x, y0: f.y, moveu: false };
      }
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const [sx, sy] = pos(e);
    if (Math.hypot(sx - drag.sx, sy - drag.sy) > 3) drag.moveu = true;
    if (drag.tipo === 'pan') {
      v.cx = drag.cx - (sx - drag.sx) / v.k; v.cy = drag.cy + (sy - drag.sy) / v.k; draw();
    } else if (drag.tipo === 'furo' && drag.moveu) {
      const nx = +(drag.x0 + (sx - drag.sx) / v.k).toFixed(2), ny = +(drag.y0 - (sy - drag.sy) / v.k).toFixed(2);
      app.store.commit((d) => { const f = d.furos.find((q) => q.id === drag.id); if (f) { f.x = nx; f.y = ny; } }, { agrupar: 'mover:' + drag.id + ':' + drag.sx });
    }
  });

  window.addEventListener('mouseup', () => {
    if (!drag) return;
    const era = drag; drag = null; atualizarCursor();
    acabouDeArrastar = era.moveu;
    if (era.tipo === 'furo' && era.moveu) app.setStatus('Furo movido (Ctrl+Z desfaz)', 'ok');
  });

  canvas.addEventListener('mousemove', (e) => {
    const [sx, sy] = pos(e), [x, y] = toW(sx, sy);
    document.getElementById('ps-coords').textContent = `X: ${x.toFixed(2)} m  Y: ${y.toFixed(2)} m`;
    if (app.ui.tool === 'corte' && corte.step === 1) { corte.preview = [x, y]; draw(); }
  });
  canvas.addEventListener('mouseleave', () => { corte.preview = null; document.getElementById('ps-coords').textContent = ''; draw(); });

  canvas.addEventListener('click', (e) => {
    if (espaco || acabouDeArrastar) { acabouDeArrastar = false; return; }
    const [sx, sy] = pos(e), [x, y] = toW(sx, sy);
    const t = app.ui.tool;
    if (t === 'furo') {
      const f = furoEm(sx, sy);
      if (f) { app.selecionarFuro(f.id); return; }
      app.abrirModalFuro({ x: +x.toFixed(2), y: +y.toFixed(2) });
      return;
    }
    if (t === 'move') {
      if (!furoEm(sx, sy)) {
        // um clique simples no vazio (sem arrastar) tira a seleção
        app.selecionarFuro(null);
      }
      return;
    }
    if (t === 'corte') {
      if (corte.step === 0) { corte = { step: 1, p1: [x, y], p2: null, preview: null }; app.setStatus("Clique no ponto A' do corte", 'corte'); draw(); return; }
      if (corte.step === 1) {
        const [ax, ay] = toS(...corte.p1);
        if (Math.hypot(sx - ax, sy - ay) < 20) return;
        corte.p2 = [x, y]; corte.preview = null; corte.step = 2;
        app.setStatus('Clique de um lado da linha para indicar o sentido de vista', 'corte'); draw(); return;
      }
      if (corte.step === 2) {
        const s = sideOfLine(x, y, corte.p1[0], corte.p1[1], corte.p2[0], corte.p2[1]);
        if (!s) return;
        const novo = {
          id: uid('c'), nome: proximoNomeCorte(app.store.doc.cortes),
          p1: corte.p1.map((n) => +n.toFixed(2)), p2: corte.p2.map((n) => +n.toFixed(2)),
          lado: s, faixa: app.ui.faixa,
        };
        app.store.commit((d) => { d.cortes.push(novo); });
        app.ui.corteId = novo.id;
        const n = furosNoCorte(novo, app.store.doc.furos).length;
        resetCorte();
        setTool('move');
        app.setStatus(`Corte ${novo.nome} criado com ${n} furo(s)`, 'ok');
        app.render();
      }
    }
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [sx, sy] = pos(e), [x, y] = toW(sx, sy);
    const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    v.k = Math.max(0.01, Math.min(500, v.k * f));
    // mantém o ponto sob o cursor parado
    v.cx = x - (sx - W / 2) / v.k; v.cy = y + (sy - H / 2) / v.k;
    draw();
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && app.ui.view === 'planta' && !ehCampo(e.target)) { espaco = true; atualizarCursor(); e.preventDefault(); }
    if (e.key === 'Escape' && corte.step > 0) { resetCorte(); setTool('corte'); }
  });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') { espaco = false; atualizarCursor(); } });

  return { draw, ajustar, setTool, cancelarCorte: () => { resetCorte(); draw(); } };
}

const ehCampo = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA');

function fmtCoord(v) {
  const a = Math.abs(v);
  return a >= 1000 ? v.toFixed(0) : a >= 10 ? (+v.toFixed(1)).toString() : (+v.toFixed(2)).toString();
}
