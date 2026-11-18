// Aba Boletim: lançamento metro a metro da classificação e do N-SPT de um furo.
import { SOLOS, SEC, PARADAS, solo, secLabel, resolverCodigo, resolverOrigem, corPadrao } from '../model/catalogo.js';
import {
  profMax, numLinhas, linhasEfetivas, camadasDoFuro, setCampoMetro, getMetro, sptPorMetro,
  textoSPTValido, num, LINHAS_PADRAO,
} from '../model/projeto.js';
import { ajustarCanvas, hachurar } from './hatch.js';
import { utmParaGeo, geoParaUtm, ehGeorreferenciado } from '../geo/coordenadas.js';
import { ACCENT, PERIGO, ALERTA, OK, corFuro } from '../styles/tema.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const corN = (n) => (n >= 50 ? PERIGO : n >= 35 ? ALERTA : n >= 15 ? ACCENT : OK);
const fmt = (v) => (+v.toFixed(2)).toString().replace('.', ',');

/** Colunas editáveis, na ordem em que aparecem (usadas para navegar e colar). */
export const colunasEditaveis = (modo) => ['codigo', 'origem', 'desc', ...(modo === 'golpes' ? ['g0', 'g1', 'g2'] : ['spt'])];

/**
 * Aplica um valor digitado em uma célula. Retorna mensagem de erro ou null.
 * Exportada para testes e para colar do Excel.
 */
export function aplicarCelula(f, m, col, texto) {
  const v = String(texto ?? '').trim();
  if (col === 'codigo') {
    const c = resolverCodigo(v);
    if (c === null) return `"${v}" não é uma classificação conhecida (${SOLOS.map((s) => s.code).join(', ')}).`;
    setCampoMetro(f, m, 'codigo', c);
  } else if (col === 'origem') {
    const o = resolverOrigem(v);
    if (o === null) return `"${v}" não é uma classificação secundária conhecida (Aterro, Solo residual, Rocha fraturada, Rocha sã ou "-").`;
    setCampoMetro(f, m, 'origem', o);
  } else if (col === 'desc') setCampoMetro(f, m, 'desc', v);
  else if (col === 'spt' || /^g[012]$/.test(col)) {
    const limpo = v.replace(/\s+/g, '');
    if (!textoSPTValido(limpo)) return `"${v}" não é um valor de SPT válido (use 12 ou 30/12).`;
    if (col === 'spt') { ['g0', 'g1', 'g2'].forEach((g) => setCampoMetro(f, m, g, '')); setCampoMetro(f, m, 'spt', limpo); }
    else { setCampoMetro(f, m, 'spt', ''); setCampoMetro(f, m, col, limpo); }
  }
  return null;
}

/** Cola um bloco de texto (linhas × colunas, separado por tab) a partir de uma célula. */
export function colarBloco(f, m0, col0, texto, modo) {
  const cols = colunasEditaveis(modo);
  const c0 = cols.indexOf(col0);
  const linhas = texto.replace(/\r/g, '').split('\n');
  while (linhas.length && linhas.at(-1).trim() === '') linhas.pop();
  const erros = [];
  linhas.forEach((linha, i) => linha.split('\t').forEach((cel, j) => {
    const col = cols[c0 + j];
    if (!col) return;
    const e = aplicarCelula(f, m0 + i, col, cel);
    if (e) erros.push(`${m0 + i} m: ${e}`);
  }));
  return { linhas: linhas.length, erros };
}

export function criarCamadas(app) {
  const body = document.getElementById('gridBody');
  const head = document.getElementById('gridHead');
  const gridWrap = document.getElementById('gridWrap');
  const colCanvas = document.getElementById('colCanvas'), colWrap = document.getElementById('colWrap');
  const chartCanvas = document.getElementById('sptChart'), chartWrap = document.getElementById('chartWrap');
  const modo = () => app.store.doc.projeto.modoSPT || 'metro';
  const minLinhas = () => app.ui.linhasMin[app.ui.furoId] || LINHAS_PADRAO;

  document.getElementById('dl-solos').innerHTML = SOLOS.map((s) => `<option value="${s.code}">${esc(s.label.split('—')[1].trim())}</option>`).join('');
  document.getElementById('dl-sec').innerHTML = SEC.filter((s) => s.value).map((s) => `<option value="${esc(s.label)}">${s.value}</option>`).join('') + '<option value="—">nenhuma</option>';
  document.getElementById('headParada').innerHTML = PARADAS.map((p) => `<option value="${p.value}">${esc(p.label)}</option>`).join('');

  const editarFuro = (fn) => {
    const id = app.ui.furoId;
    return app.store.commit((d) => { const f = d.furos.find((q) => q.id === id); return f ? fn(f) : null; });
  };

  // ── edição de células ──
  body.addEventListener('change', (e) => {
    const el = e.target, tr = el.closest('tr[data-m]');
    if (!tr || !el.dataset.col) return;
    const m = +tr.dataset.m;
    const erro = editarFuro((f) => aplicarCelula(f, m, el.dataset.col, el.value));
    if (erro) { app.toast(erro, 5000); app.store.desfazer(); }
  });

  body.addEventListener('focusin', (e) => {
    const tr = e.target.closest('tr[data-m]');
    if (tr && app.ui.metroSel !== +tr.dataset.m) { app.ui.metroSel = +tr.dataset.m; drawColumn(); }
    if (e.target.select) e.target.select();
  });

  // ── navegação: Enter e Tab descem para o próximo metro ──
  function focar(key) {
    const el = body.querySelector(`[data-key="${key}"]`);
    if (el) { el.focus(); el.select?.(); el.scrollIntoView({ block: 'nearest' }); }
    return !!el;
  }
  body.addEventListener('keydown', (e) => {
    const el = e.target, tr = el.closest('tr[data-m]');
    if (!tr || !el.dataset.col) return;
    const col = el.dataset.col, m = +tr.dataset.m;
    const vertical = col === 'spt' || col === 'desc' || col.startsWith('g');
    let alvo = null;
    if (e.key === 'Enter' || e.key === 'Tab') {
      const dir = e.shiftKey ? -1 : 1;
      if (e.key === 'Tab' && modo() === 'golpes' && col.startsWith('g')) {
        const i = +col[1] + dir;
        alvo = i >= 0 && i <= 2 ? `g${i}:${m}` : `g${dir > 0 ? 0 : 2}:${m + dir}`;
      } else alvo = `${col}:${m + dir}`;
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && vertical) alvo = `${col}:${m + (e.key === 'ArrowDown' ? 1 : -1)}`;
    else if (e.key === 'Escape') { el.blur(); return; }
    if (!alvo) return;
    e.preventDefault();
    const [, mAlvo] = alvo.split(':');
    el.blur(); // grava (evento change) e redesenha a grade
    if (!focar(alvo)) {
      const f = app.furoAtual();
      if (+mAlvo > 0 && f && !f.profTotal) { app.ui.linhasMin[f.id] = +mAlvo; render(); focar(alvo); }
      else focar(`${alvo.split(':')[0]}:${m}`);
    }
  });

  // ── apagar um metro (✕) ──
  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-limpar]');
    if (!b) return;
    const m = +b.dataset.limpar, f = app.furoAtual();
    if (!f) return;
    const total = numLinhas(f, { minimo: minLinhas() });
    if (getMetro(f, m)) {
      editarFuro((q) => { q.metros = q.metros.filter((r) => r.m !== m); });
      app.toast(`${m} m apagado (Ctrl+Z desfaz).`);
    } else if (m === total) menosMetro();
    else app.toast('Esse metro já está vazio.');
  });

  // ── colar do Excel ──
  body.addEventListener('paste', (e) => {
    const el = e.target, tr = el.closest('tr[data-m]');
    if (!tr || !el.dataset.col) return;
    const texto = e.clipboardData?.getData('text') || '';
    if (!/[\t\n]/.test(texto.trim())) return; // um valor só: comportamento normal
    e.preventDefault();
    const r = editarFuro((f) => colarBloco(f, +tr.dataset.m, el.dataset.col, texto, modo()));
    app.toast(`Colado: ${r.linhas} linha(s).${r.erros.length ? ' Ignorados: ' + r.erros.slice(0, 3).join(' ') : ''}`, r.erros.length ? 7000 : 2500);
  });

  // ── arrastar a classificação (alça ▪) ──
  let arraste = null;
  body.addEventListener('mousedown', (e) => {
    const h = e.target.closest('.fill-handle');
    if (!h) return;
    e.preventDefault();
    const m = +h.closest('tr').dataset.m;
    arraste = { col: h.dataset.handle, de: m, ate: m };
    marcarArraste();
  });
  window.addEventListener('mousemove', (e) => {
    if (!arraste) return;
    const tr = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('#gridBody tr[data-m]');
    if (tr && +tr.dataset.m !== arraste.ate) { arraste.ate = +tr.dataset.m; marcarArraste(); }
    const r = gridWrap.getBoundingClientRect();
    if (e.clientY > r.bottom - 20) gridWrap.scrollTop += 12; else if (e.clientY < r.top + 30) gridWrap.scrollTop -= 12;
  });
  window.addEventListener('mouseup', () => {
    if (!arraste) return;
    const a = arraste; arraste = null;
    marcarArraste();
    if (a.de === a.ate) return;
    const f = app.furoAtual();
    const fonte = linhasEfetivas(f, { minimo: minLinhas() }).find((l) => l.m === a.de);
    const valor = a.col === 'codigo' ? fonte.codigo : fonte.origem || '-';
    const [i, j] = [Math.min(a.de, a.ate), Math.max(a.de, a.ate)];
    editarFuro((q) => { for (let m = i; m <= j; m++) if (m !== a.de) setCampoMetro(q, m, a.col, valor); });
    app.toast(`${a.col === 'codigo' ? fonte.codigo || 'Sem classificação' : secLabel(fonte.origem) || 'Nenhuma'} copiado para ${i}–${j} m.`);
  });
  function marcarArraste() {
    body.querySelectorAll('tr[data-m]').forEach((tr) => {
      const m = +tr.dataset.m;
      tr.classList.toggle('fill-sel', !!arraste && m >= Math.min(arraste.de, arraste.ate) && m <= Math.max(arraste.de, arraste.ate));
    });
  }

  // ── cabeçalho do furo, dados e cores ──
  document.querySelectorAll('#furoHead [data-field], #rpInfo [data-field]').forEach((el) => {
    el.addEventListener('change', () => {
      const campo = el.dataset.field;
      if (campo === 'nome') {
        const nome = el.value.trim();
        if (!nome) { render(); return; }
        if (app.store.doc.furos.some((f) => f.nome === nome && f.id !== app.ui.furoId)) { app.toast(`Já existe um furo "${nome}".`); render(); return; }
        editarFuro((f) => { f.nome = nome; });
      } else if (campo === 'parada') editarFuro((f) => { f.parada = el.value; });
      else editarFuro((f) => { f[campo] = Math.max(campo === 'profTotal' ? 0 : -Infinity, num(el.value, campo === 'profTotal' ? 0 : f[campo])); });
    });
  });
  document.querySelectorAll('#infoGeo [data-geo]').forEach((el) => {
    el.addEventListener('change', () => {
      const lat = num(document.getElementById('infoLat').value, NaN), lon = num(document.getElementById('infoLon').value, NaN);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) { render(); return; }
      const u = geoParaUtm(lat, lon, app.store.doc.projeto.fusoUTM);
      editarFuro((f) => { f.x = +u.x.toFixed(3); f.y = +u.y.toFixed(3); });
    });
  });
  document.getElementById('listaCores').addEventListener('change', (e) => {
    const code = e.target.dataset.cor; if (!code) return;
    app.store.commit((d) => { d.cores = { ...(d.cores || {}), [code]: e.target.value }; });
  });
  document.getElementById('chartChecks').addEventListener('change', (e) => {
    const id = e.target.dataset.furo; if (!id) return;
    if (e.target.checked) app.ui.graficoOculto.delete(id); else app.ui.graficoOculto.add(id);
    drawChart();
  });

  // ── render ──
  function renderHead(f) {
    const set = (id, v) => { const el = document.getElementById(id); if (document.activeElement !== el) el.value = v; };
    set('headProf', f.profTotal || ''); set('headNA', f.na || ''); set('headCota', f.cota || ''); set('headParada', f.parada || '');
    document.getElementById('headProf').classList.toggle('vazio', !f.profTotal);
    const cams = camadasDoFuro(f), nN = Object.keys(sptPorMetro(f)).length;
    document.getElementById('headResumo').textContent = `${fmt(profMax(f))} m · ${cams.length} camada(s) · ${nN} N-SPT`;
    set('infoNome', f.nome); set('infoX', f.x); set('infoY', f.y);
    const geo = ehGeorreferenciado(app.store.doc);
    document.getElementById('infoGeo').hidden = !geo;
    if (geo) { const g = utmParaGeo(f.x, f.y, app.store.doc.projeto.fusoUTM); set('infoLat', g.lat.toFixed(7)); set('infoLon', g.lon.toFixed(7)); }
    document.getElementById('btn-modo-metro').classList.toggle('active', modo() === 'metro');
    document.getElementById('btn-modo-golpes').classList.toggle('active', modo() === 'golpes');
  }

  function renderGrade(f) {
    const golpes = modo() === 'golpes';
    head.innerHTML = `<tr><th>Prof.</th><th>Primária</th><th>Secundária</th><th>Descrição</th>${golpes
      ? '<th title="Golpes nos 1ºs 15 cm">1º 15</th><th title="Golpes nos 2ºs 15 cm">2º 15</th><th title="Golpes nos 3ºs 15 cm">3º 15</th><th>N</th>'
      : '<th>N-SPT</th>'}<th></th><th></th></tr>`;
    const cols = `<colgroup><col class="c-m"><col class="c-cls"><col class="c-sec"><col>${golpes ? '<col class="c-g"><col class="c-g"><col class="c-g"><col class="c-n">' : '<col class="c-n">'}<col class="c-bar"><col class="c-del"></colgroup>`;
    const old = document.querySelector('#grid colgroup'); if (old) old.remove();
    head.insertAdjacentHTML('beforebegin', cols);

    const linhas = linhasEfetivas(f, { minimo: minLinhas() });
    body.innerHTML = linhas.map((l, i) => {
      const r = l.registro, ant = linhas[i - 1];
      const ini = l.codigo && (!ant || ant.codigo !== l.codigo || ant.origem !== l.origem);
      const s = l.codigo ? solo(l.codigo) : null;
      const origemTxt = r.origem === '-' ? '—' : r.origem ? secLabel(r.origem) : '';
      const n = l.n;
      const sptCell = golpes
        ? [0, 1, 2].map((k) => `<td><input data-col="g${k}" data-key="g${k}:${l.m}" value="${esc(r.golpes?.[k] ?? '')}" inputmode="numeric"/></td>`).join('') +
          `<td class="n-calc" style="color:${n ? corN(n.valor) : ''}">${n ? esc(n.texto) : ''}</td>`
        : `<td><input data-col="spt" data-key="spt:${l.m}" value="${esc(r.spt ?? (r.golpes && n ? n.texto : ''))}" placeholder="—" inputmode="numeric"/></td>`;
      return `<tr data-m="${l.m}" class="${ini ? 'ini' : ''} ${l.alemDoLimite ? 'fora' : ''}">
        <td class="m-cell">${l.m} m<small>${fmt(l.de)}–${fmt(l.ate)}</small></td>
        <td class="cls-cell"><span class="sw" style="background:${s ? s.fill : 'transparent'};${s ? '' : 'border-style:dashed'}"></span><input data-col="codigo" data-key="codigo:${l.m}" list="dl-solos" value="${esc(r.codigo ?? '')}" placeholder="${l.codigoHerdado ? esc(l.codigo) : ''}" autocomplete="off"/><span class="fill-handle" data-handle="codigo" title="Arraste para copiar a classificação"></span></td>
        <td class="cls-cell sem-sw"><input data-col="origem" data-key="origem:${l.m}" list="dl-sec" value="${esc(origemTxt)}" placeholder="${l.origemHerdada ? esc(secLabel(l.origem)) : ''}" autocomplete="off"/><span class="fill-handle" data-handle="origem" title="Arraste para copiar"></span></td>
        <td><input data-col="desc" data-key="desc:${l.m}" value="${esc(r.desc ?? '')}"/></td>
        ${sptCell}
        <td class="bar-cell">${n ? `<div class="spt-bw"><div class="spt-b" style="width:${Math.min(n.valor / 50, 1) * 100}%;background:${corN(n.valor)}"></div></div>` : ''}</td>
        <td class="del-cell"><button class="del-btn-r" data-limpar="${l.m}" title="${r.m ? `Apagar o que foi digitado no ${l.m} m` : l.m === linhas.length ? `Remover a linha do ${l.m} m` : 'Metro vazio'}">✕</button></td>
      </tr>`;
    }).join('');
  }

  function drawColumn() {
    const f = app.furoAtual(); if (!f) return;
    const { ctx, w: W, h: H } = ajustarCanvas(colCanvas, colWrap);
    ctx.clearRect(0, 0, W, H);
    const depth = Math.max(numLinhas(f, { minimo: minLinhas() }), 1), mT = 18, mB = 18, pxM = (H - mT - mB) / depth;
    const colX = 28, colW = W - colX - 10, step = depth <= 12 ? 1 : depth <= 24 ? 2 : 5;
    ctx.font = '8px sans-serif'; ctx.textAlign = 'right';
    for (let d = 0; d <= depth; d += step) {
      const y = mT + d * pxM;
      ctx.fillStyle = 'rgba(80,80,80,0.8)'; ctx.fillText(d + 'm', colX - 3, y + 3);
      ctx.strokeStyle = 'rgba(128,128,128,0.2)'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(colX, y); ctx.lineTo(colX + colW, y); ctx.stroke();
    }
    camadasDoFuro(f).forEach((c) => {
      const s = solo(c.codigo), y = mT + c.de * pxM, h = (c.ate - c.de) * pxM;
      if (h <= 0) return;
      ctx.fillStyle = s.fill; ctx.fillRect(colX, y, colW, h);
      ctx.save(); ctx.beginPath(); ctx.rect(colX, y, colW, h); ctx.clip(); hachurar(ctx, s, c.origem, colX, y, colW, h); ctx.restore();
      ctx.strokeStyle = 'rgba(80,80,80,0.5)'; ctx.lineWidth = 0.6; ctx.strokeRect(colX, y, colW, h);
      if (h > 10) { ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.font = '500 8px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(s.code, colX + 2, y + h / 2 + (c.origem && h > 20 ? -3 : 3)); }
      if (c.origem && h > 20) { ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.font = '7px sans-serif'; ctx.fillText(secLabel(c.origem), colX + 2, y + h / 2 + 7); }
    });
    if (app.ui.metroSel && app.ui.metroSel <= depth) {
      const y = mT + (app.ui.metroSel - 1) * pxM;
      ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.5; ctx.strokeRect(colX - 1, y, colW + 2, pxM);
    }
    ctx.strokeStyle = 'rgba(128,128,128,0.55)'; ctx.lineWidth = 1; ctx.strokeRect(colX, mT, colW, depth * pxM);
    if (f.profTotal && f.profTotal < depth) {
      const y = mT + f.profTotal * pxM;
      ctx.strokeStyle = PERIGO; ctx.lineWidth = 1.2; ctx.setLineDash([3, 2]);
      ctx.beginPath(); ctx.moveTo(colX - 4, y); ctx.lineTo(colX + colW + 4, y); ctx.stroke(); ctx.setLineDash([]);
    }
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
    if (app.ui.rp !== 'chart' || app.ui.view !== 'camadas') return;
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

  function renderListaCamadas(f) {
    const cams = camadasDoFuro(f);
    document.getElementById('listaCamadas').innerHTML = cams.length ? cams.map((c) => {
      const s = solo(c.codigo);
      return `<div class="cam-item"><span class="sw" style="background:${s.fill}"></span><div><span class="prof">${fmt(c.de)}–${fmt(c.ate)} m</span> <b>${s.code}</b>${c.origem ? ' · ' + esc(secLabel(c.origem)) : ''}${c.descricao ? `<div class="desc">${esc(c.descricao)}</div>` : ''}</div></div>`;
    }).join('') : '<div class="hint">Digite a classificação em algum metro do boletim.</div>';
    const usados = [...new Set(app.store.doc.furos.flatMap((q) => camadasDoFuro(q).map((c) => c.codigo)))];
    document.getElementById('listaCores').innerHTML = usados.map((code) => {
      const s = solo(code);
      return `<label class="cor-item"><input type="color" data-cor="${code}" value="${s.fill}"/>${esc(s.label)}</label>`;
    }).join('') || '<div class="hint">Nenhuma classificação usada ainda.</div>';
  }

  function render() {
    if (app.ui.view !== 'camadas') return;
    const f = app.furoAtual();
    document.getElementById('tableTitle').textContent = f ? `Boletim — ${f.nome}` : 'Nenhum furo selecionado';
    if (!f) { body.innerHTML = ''; return; }
    preservandoFoco(() => { renderHead(f); renderGrade(f); });
    ['chart', 'camadas', 'info'].forEach((k) => {
      document.getElementById('rt-' + k).classList.toggle('active', k === app.ui.rp);
      document.getElementById('rp' + k[0].toUpperCase() + k.slice(1)).hidden = k !== app.ui.rp;
    });
    drawColumn();
    if (app.ui.rp === 'chart') { renderChecks(); drawChart(); }
    if (app.ui.rp === 'camadas') renderListaCamadas(f);
  }

  function maisMetro() {
    const f = app.furoAtual(); if (!f) return;
    const atual = f.profTotal || numLinhas(f, { minimo: minLinhas() });
    delete app.ui.linhasMin[f.id];
    editarFuro((q) => { q.profTotal = +(atual + 1).toFixed(2); });
    gridWrap.scrollTop = gridWrap.scrollHeight;
  }

  /** Remove a última linha do boletim (se estiver vazia), fixando a profundidade limite. */
  function menosMetro() {
    const f = app.furoAtual(); if (!f) return;
    const total = numLinhas(f, { minimo: minLinhas() });
    if (total <= 1) return;
    if (getMetro(f, total)) { app.toast(`O ${total} m tem dados. Apague com o ✕ da linha antes de remover.`, 5000); return; }
    delete app.ui.linhasMin[f.id];
    editarFuro((q) => { q.profTotal = total - 1; });
    app.toast(`Profundidade limite: ${total - 1} m.`);
  }

  function restaurarCores() { app.store.commit((d) => { d.cores = {}; }); }

  return { render, drawChart, maisMetro, menosMetro, restaurarCores };
}

/** Re-renderiza sem perder o campo em foco (identificado por data-key). */
function preservandoFoco(fn) {
  const a = document.activeElement, key = a?.dataset?.key;
  let sel = null;
  try { sel = key && a.selectionStart !== undefined ? [a.selectionStart, a.selectionEnd] : null; } catch { sel = null; }
  fn();
  if (!key) return;
  const n = document.querySelector(`[data-key="${key}"]`);
  if (n && n !== a) { n.focus(); try { if (sel) n.setSelectionRange(...sel); } catch { /* inputs numéricos */ } }
}

export { corPadrao, getMetro };
