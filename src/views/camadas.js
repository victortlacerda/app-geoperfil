// Aba Camadas: tabela de camadas, coluna estratigráfica, N-SPT, gráfico e dados do furo.
import { SOLOS, SEC, solo, secLabel } from '../model/catalogo.js';
import { profMax, sptPorMetro, setSpt, novaCamada, num } from '../model/projeto.js';
import { ajustarCanvas, hachurar } from './hatch.js';
import { ACCENT, PERIGO, ALERTA, OK, corFuro } from '../styles/tema.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const corN = (n) => (n >= 50 ? PERIGO : n >= 35 ? ALERTA : n >= 15 ? ACCENT : OK);

/** Problemas de consistência em uma camada (índice i) do furo. */
export function problemasCamada(camadas, i) {
  const c = camadas[i], p = [];
  if (!(c.ate > c.de)) p.push('"Até" deve ser maior que "De"');
  camadas.forEach((o, j) => { if (j !== i && c.de < o.ate - 1e-9 && o.de < c.ate - 1e-9) p.push(`sobrepõe a camada ${j + 1}`); });
  return p;
}

export function criarCamadas(app) {
  const body = document.getElementById('layerBody');
  const colCanvas = document.getElementById('colCanvas'), colWrap = document.getElementById('colWrap');
  const chartCanvas = document.getElementById('sptChart'), chartWrap = document.getElementById('chartWrap');

  const editarFuro = (fn, agrupar) => {
    const id = app.ui.furoId;
    app.store.commit((d) => { const f = d.furos.find((q) => q.id === id); if (f) fn(f); }, { agrupar });
  };

  // ── eventos (delegados) ──
  body.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    const tr = e.target.closest('tr[data-i]');
    if (del) { const i = +del.dataset.del; editarFuro((f) => f.camadas.splice(i, 1)); if (app.ui.camadaSel >= i) app.ui.camadaSel = null; return; }
    if (tr && !e.target.closest('input,select')) { app.ui.camadaSel = +tr.dataset.i; render(); }
  });
  body.addEventListener('change', (e) => {
    const el = e.target, tr = el.closest('tr[data-i]');
    if (!tr || !el.dataset.campo) return;
    const i = +tr.dataset.i, campo = el.dataset.campo;
    editarFuro((f) => {
      const c = f.camadas[i];
      if (campo === 'de' || campo === 'ate') c[campo] = num(el.value, c[campo]);
      else if (campo === 'codigo') { c.codigo = el.value; c.cor = solo(el.value).hex; }
      else c[campo] = el.value;
    });
  });
  body.addEventListener('focusin', (e) => { const tr = e.target.closest('tr[data-i]'); if (tr && app.ui.camadaSel !== +tr.dataset.i) { app.ui.camadaSel = +tr.dataset.i; marcarSelecao(); drawColumn(); } });

  const sptRows = document.getElementById('sptRows');
  sptRows.addEventListener('change', (e) => {
    const el = e.target; if (!el.dataset.metro) return;
    const m = +el.dataset.metro, v = el.value.trim();
    editarFuro((f) => setSpt(f, m, v === '' ? null : num(v, NaN)));
  });
  sptRows.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.dataset.metro) return;
    e.preventDefault();
    const alvo = +e.target.dataset.metro + (e.shiftKey ? -1 : 1);
    e.target.blur(); // dispara change, que redesenha a lista
    const prox = sptRows.querySelector(`[data-metro="${alvo}"]`);
    prox?.focus(); prox?.select();
  });

  document.querySelectorAll('#rpSpt [data-field], #rpInfo [data-field]').forEach((el) => {
    el.addEventListener('change', () => {
      const campo = el.dataset.field;
      if (campo === 'nome') {
        const nome = el.value.trim();
        if (!nome) { render(); return; }
        if (app.store.doc.furos.some((f) => f.nome === nome && f.id !== app.ui.furoId)) { app.toast(`Já existe um furo "${nome}".`); render(); return; }
        editarFuro((f) => { f.nome = nome; });
      } else editarFuro((f) => { f[campo] = num(el.value, f[campo]); });
    });
  });

  document.getElementById('chartChecks').addEventListener('change', (e) => {
    const id = e.target.dataset.furo; if (!id) return;
    if (e.target.checked) app.ui.graficoOculto.delete(id); else app.ui.graficoOculto.add(id);
    drawChart();
  });

  // ── render ──
  function renderTabela(f) {
    const sel = app.ui.camadaSel;
    body.innerHTML = f.camadas.map((c, i) => {
      const s = solo(c.codigo), prob = problemasCamada(f.camadas, i);
      return `<tr data-i="${i}" class="${sel === i ? 'sel' : ''} ${prob.length ? 'warn' : ''}" title="${esc(prob.join('; '))}">
        <td class="sw-cell"><div class="sw" style="background:${s.fill};border-color:${s.hex}88"></div></td>
        <td><input type="number" step="0.01" value="${c.de.toFixed(2)}" data-campo="de" data-key="c${i}de"/></td>
        <td><input type="number" step="0.01" value="${c.ate.toFixed(2)}" data-campo="ate" data-key="c${i}ate"/></td>
        <td><select data-campo="codigo" data-key="c${i}cod">${SOLOS.map((o) => `<option value="${o.code}"${o.code === s.code ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></td>
        <td><select data-campo="origem" data-key="c${i}org">${SEC.map((o) => `<option value="${o.value}"${c.origem === o.value ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></td>
        <td><input type="color" value="${esc(c.cor)}" data-campo="cor"/></td>
        <td class="del-cell"><button class="del-btn-r" data-del="${i}" title="Remover camada">✕</button></td>
      </tr>`;
    }).join('');
    document.getElementById('layerEmpty').hidden = f.camadas.length > 0;
  }
  function marcarSelecao() {
    body.querySelectorAll('tr[data-i]').forEach((tr) => tr.classList.toggle('sel', +tr.dataset.i === app.ui.camadaSel));
  }

  function renderSPT(f) {
    const depth = Math.max(profMax(f), 1), spt = sptPorMetro(f);
    let html = '';
    for (let d = 1; d <= Math.ceil(depth); d++) {
      const v = spt[d] !== undefined ? spt[d] : '', n = parseInt(v) || 0, imp = n >= 50, col = corN(n);
      html += `<div class="spt-row"><span class="spt-d">${d}m</span><input class="spt-inp" type="number" min="0" max="50" value="${v}" placeholder="—" data-metro="${d}" data-key="spt${d}"/><div class="spt-bw"><div class="spt-b" style="width:${Math.min((n / 50) * 100, 100)}%;background:${col}"></div></div><span class="spt-tag" style="color:${col}">${imp ? 'IMP' : v === '' ? '' : n}</span></div>`;
    }
    sptRows.innerHTML = html;
  }

  function drawColumn() {
    const f = app.furoAtual(); if (!f) return;
    const { ctx, w: W, h: H } = ajustarCanvas(colCanvas, colWrap);
    ctx.clearRect(0, 0, W, H);
    const depth = Math.max(profMax(f), 1), mT = 18, mB = 18, pxM = (H - mT - mB) / depth;
    const colX = 28, colW = W - colX - 10, step = depth <= 10 ? 1 : depth <= 20 ? 2 : 5;
    ctx.font = '8px sans-serif'; ctx.textAlign = 'right';
    for (let d = 0; d <= depth; d += step) {
      const y = mT + d * pxM;
      ctx.fillStyle = 'rgba(80,80,80,0.8)'; ctx.fillText(d + 'm', colX - 3, y + 3);
      ctx.strokeStyle = 'rgba(128,128,128,0.2)'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(colX, y); ctx.lineTo(colX + colW, y); ctx.stroke();
    }
    f.camadas.forEach((c, i) => {
      const s = solo(c.codigo), y = mT + c.de * pxM, h = (c.ate - c.de) * pxM;
      if (h <= 0) return;
      ctx.fillStyle = s.fill; ctx.fillRect(colX, y, colW, h);
      ctx.save(); ctx.beginPath(); ctx.rect(colX, y, colW, h); ctx.clip(); hachurar(ctx, s, c.origem, colX, y, colW, h); ctx.restore();
      ctx.strokeStyle = app.ui.camadaSel === i ? ACCENT : 'rgba(128,128,128,0.35)';
      ctx.lineWidth = app.ui.camadaSel === i ? 1.5 : 0.5; ctx.strokeRect(colX, y, colW, h);
      if (h > 10) { ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.font = '500 8px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(s.code, colX + 2, y + h / 2 + (c.origem ? -3 : 3)); }
      if (c.origem && h > 20) { ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.font = '7px sans-serif'; ctx.fillText(secLabel(c.origem), colX + 2, y + h / 2 + 7); }
    });
    ctx.strokeStyle = 'rgba(128,128,128,0.55)'; ctx.lineWidth = 1; ctx.strokeRect(colX, mT, colW, depth * pxM);
    ctx.fillStyle = 'rgba(128,128,128,0.35)'; ctx.fillRect(colX - 2, mT - 4, colW + 4, 4);
    if (f.na > 0 && f.na <= depth) {
      const ny = mT + f.na * pxM;
      ctx.save(); ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(colX - 4, ny); ctx.lineTo(colX + colW + 4, ny); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = ACCENT; ctx.beginPath(); ctx.moveTo(colX - 4, ny - 4); ctx.lineTo(colX - 4, ny + 4); ctx.lineTo(colX - 12, ny); ctx.closePath(); ctx.fill();
      ctx.font = '7px sans-serif'; ctx.textAlign = 'right'; ctx.fillText('NA', colX - 14, ny + 3); ctx.restore();
    }
  }

  function renderChecks() {
    document.getElementById('chartChecks').innerHTML = app.store.doc.furos.map((f, i) =>
      `<label class="bh-check"><input type="checkbox" data-furo="${f.id}" ${app.ui.graficoOculto.has(f.id) ? '' : 'checked'}/><span class="dot" style="background:${corFuro(i)}"></span>${esc(f.nome)}</label>`).join('');
  }

  function drawChart() {
    if (app.ui.rp !== 'chart') return;
    const { ctx, w: W, h: H } = ajustarCanvas(chartCanvas, chartWrap);
    ctx.clearRect(0, 0, W, H);
    const ml = 34, mr = 10, mt = 22, mb = 20, pw = W - ml - mr, ph = H - mt - mb;
    const furos = app.store.doc.furos.map((f, i) => ({ f, i })).filter(({ f }) => !app.ui.graficoOculto.has(f.id));
    const maxD = Math.max(1, ...furos.map(({ f }) => profMax(f)));
    ctx.strokeStyle = 'rgba(128,128,128,0.18)'; ctx.lineWidth = 0.5; ctx.font = '8px sans-serif';
    for (let n = 0; n <= 50; n += 10) {
      const x = ml + (n / 50) * pw;
      ctx.beginPath(); ctx.moveTo(x, mt); ctx.lineTo(x, mt + ph); ctx.stroke();
      ctx.fillStyle = 'rgba(80,80,80,0.7)'; ctx.textAlign = 'center'; ctx.fillText(n === 50 ? '≥50' : n, x, mt + ph + 11);
    }
    const dstep = maxD <= 10 ? 1 : maxD <= 20 ? 2 : 5;
    for (let d = 0; d <= maxD; d += dstep) {
      const y = mt + (d / maxD) * ph;
      ctx.beginPath(); ctx.moveTo(ml, y); ctx.lineTo(ml + pw, y); ctx.stroke();
      ctx.fillStyle = 'rgba(80,80,80,0.7)'; ctx.textAlign = 'right'; ctx.fillText(d + 'm', ml - 3, y + 3);
    }
    ctx.fillStyle = 'rgba(80,80,80,0.8)'; ctx.font = '500 9px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('N-SPT', ml + pw / 2, mt - 10);
    ctx.save(); ctx.translate(10, mt + ph / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('Profundidade (m)', 0, 0); ctx.restore();
    ctx.save(); ctx.strokeStyle = 'rgba(163,45,45,0.35)'; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(ml + pw, mt); ctx.lineTo(ml + pw, mt + ph); ctx.stroke(); ctx.restore();
    furos.forEach(({ f, i }) => {
      const col = corFuro(i), spt = sptPorMetro(f);
      if (f.na > 0 && f.na <= maxD) {
        const y = mt + (f.na / maxD) * ph;
        ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 0.8; ctx.setLineDash([2, 3]); ctx.globalAlpha = 0.4;
        ctx.beginPath(); ctx.moveTo(ml, y); ctx.lineTo(ml + pw, y); ctx.stroke(); ctx.restore();
      }
      const pts = Object.keys(spt).map(Number).sort((a, b) => a - b).filter((d) => d <= maxD)
        .map((d) => ({ x: ml + (Math.min(spt[d], 50) / 50) * pw, y: mt + (d / maxD) * ph, n: spt[d] }));
      if (pts.length > 1) {
        ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.55; ctx.beginPath();
        pts.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke(); ctx.restore();
      }
      pts.forEach((p) => { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fillStyle = p.n >= 50 ? PERIGO : col; ctx.fill(); });
      if (pts.length) { const l = pts.at(-1); ctx.fillStyle = col; ctx.font = '500 8px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(f.nome, l.x + 5 > ml + pw - 20 ? l.x - 30 : l.x + 5, l.y + 3); }
    });
    ctx.strokeStyle = 'rgba(100,100,100,0.4)'; ctx.lineWidth = 1; ctx.strokeRect(ml, mt, pw, ph);
  }

  function renderInfo(f) {
    const set = (id, v) => { const el = document.getElementById(id); if (document.activeElement !== el) el.value = v; };
    set('infoNome', f.nome); set('infoCota', f.cota || ''); set('infoProf', f.profTotal || ''); set('infoNA', f.na || '');
    set('infoX', f.x); set('infoY', f.y); set('naInput', f.na || '');
  }

  function render() {
    if (app.ui.view !== 'camadas') return;
    const f = app.furoAtual();
    document.getElementById('tableTitle').textContent = f ? `Camadas — ${f.nome}` : 'Nenhum furo selecionado';
    if (!f) { body.innerHTML = ''; sptRows.innerHTML = ''; return; }
    preservandoFoco(() => { renderTabela(f); renderSPT(f); renderInfo(f); });
    ['spt', 'chart', 'info'].forEach((k) => {
      document.getElementById('rt-' + k).classList.toggle('active', k === app.ui.rp);
      document.getElementById('rp' + k[0].toUpperCase() + k.slice(1)).hidden = k !== app.ui.rp;
    });
    drawColumn();
    if (app.ui.rp === 'chart') { renderChecks(); drawChart(); }
  }

  function addCamada() {
    const f = app.furoAtual(); if (!f) { app.toast('Selecione ou crie um furo primeiro.'); return; }
    const last = f.camadas.length ? f.camadas.at(-1).ate : 0;
    editarFuro((q) => q.camadas.push(novaCamada({ de: last, ate: last + 2, codigo: 'AREA' })));
    app.ui.camadaSel = f.camadas.length;
    render();
    body.querySelector(`tr[data-i="${app.ui.camadaSel}"] input`)?.focus();
  }

  return { render, addCamada, drawChart };
}

/** Re-renderiza sem perder o campo em foco (identificado por data-key). */
function preservandoFoco(fn) {
  const a = document.activeElement, key = a?.dataset?.key;
  let sel = null;
  try { sel = key && a.selectionStart !== undefined ? [a.selectionStart, a.selectionEnd] : null; } catch { sel = null; }
  fn();
  if (!key) return;
  const n = document.querySelector(`[data-key="${key}"]`);
  if (n && n !== a) { n.focus(); try { if (sel) n.setSelectionRange(...sel); } catch { /* number inputs */ } }
}
