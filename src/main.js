import './styles/main.css';
import { criarStore, lerAutosave } from './store.js';
import { novoProjeto, projetoExemplo, novoFuro, proximoNome, profMax, num, camadasDoFuro } from './model/projeto.js';
import { carregarProjeto, serializar } from './model/arquivo.js';
import { furosNoCorte } from './geo/corte.js';
import { criarPlanta } from './views/planta.js';
import { criarCamadas } from './views/camadas.js';
import { criarPerfil } from './views/perfil.js';
import { gerarDXF } from './io/dxf.js';
import { lerCSV, interpretarTabela, aplicarImportacao, MODELO_CSV, MODELO_XLSX } from './io/csv.js';
import { baixar, lerTexto, lerXLSX, escreverXLSX, nomeArquivo } from './io/arquivos.js';
import { corFuro, OK, ACCENT } from './styles/tema.js';
import { definirCoresProjeto } from './model/catalogo.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ── estado ───────────────────────────────────────────────
const storage = (() => { try { return window.localStorage; } catch { return null; } })();
const avisosIniciais = [];
let inicial = null;
const salvo = lerAutosave(storage);
if (salvo) {
  try { inicial = carregarProjeto(salvo); } catch { avisosIniciais.push('O projeto salvo automaticamente não pôde ser lido; abrindo o exemplo.'); }
}
const store = criarStore(inicial || projetoExemplo(), { storage });

const ui = {
  view: 'planta', furoId: null, corteId: null, metroSel: null, rp: 'chart', linhasMin: {},
  graficoOculto: new Set(), tool: 'furo', faixa: 50,
  planta: { k: 2, cx: 0, cy: 0 },
  perfil: { axis: 'cota', showNA: true, showLab: true, showSPT: true, showHatch: true, zoom: 1, panX: 0 },
};

const app = {
  store, ui,
  furoAtual: () => store.doc.furos.find((f) => f.id === ui.furoId),
  corteAtivo: () => store.doc.cortes.find((c) => c.id === ui.corteId) || null,
  selecionarFuro(id) { ui.furoId = id; ui.metroSel = null; render(); },
  selecionarCorte(id) { ui.corteId = id; ui.perfil.zoom = 1; ui.perfil.panX = 0; sincronizarFaixa(); render(); },
  render: () => render(),
  toast,
  setStatus(txt, tipo) { const el = $('plantaStatus'); el.textContent = txt; el.style.color = tipo === 'ok' ? OK : tipo === 'corte' ? ACCENT : ''; },
  abrirModalFuro,
};

const planta = criarPlanta(app);
const camadas = criarCamadas(app);
const perfil = criarPerfil(app);

// ── render ───────────────────────────────────────────────
function validarSelecao() {
  const { furos, cortes } = store.doc;
  if (!furos.some((f) => f.id === ui.furoId)) ui.furoId = furos[0]?.id ?? null;
  if (ui.corteId && !cortes.some((c) => c.id === ui.corteId)) ui.corteId = cortes.at(-1)?.id ?? null;
}

function renderSidebar() {
  const { furos, cortes } = store.doc;
  $('bhList').innerHTML = furos.map((f, i) => `
    <div class="bh-item${f.id === ui.furoId ? ' active' : ''}" data-action="furo" data-arg="${f.id}">
      <div class="bh-dot" style="background:${corFuro(i)}"></div>${esc(f.nome)}
      <span class="bh-depth">${profMax(f).toFixed(0)}m</span>
      <button class="bh-del" data-action="removerFuro" data-arg="${f.id}" title="Remover furo">✕</button>
    </div>`).join('') || '<div class="hint">Nenhum furo.</div>';
  $('cutHint').hidden = cortes.length > 0;
  $('cutList').innerHTML = cortes.map((c) => {
    const ativo = c.id === ui.corteId;
    return `<div class="cut-item${ativo ? ' active' : ''}" data-action="corte" data-arg="${c.id}">
      <svg width="12" height="12"><line x1="1" y1="6" x2="11" y2="6" stroke="${ativo ? ACCENT : '#888'}" stroke-width="1.5" stroke-dasharray="2 1.5"/></svg>
      ${esc(c.nome)}<span class="cut-n">${furosNoCorte(c, furos).length}f</span>
      <button class="bh-del" data-action="removerCorte" data-arg="${c.id}" title="Remover corte">✕</button>
    </div>`;
  }).join('');
  $('corteSelect').innerHTML = '<option value="">— nenhum —</option>' + cortes.map((c) =>
    `<option value="${c.id}"${c.id === ui.corteId ? ' selected' : ''}>${esc(c.nome)} (${furosNoCorte(c, furos).length} furos)</option>`).join('');
  $('btn-undo').disabled = !store.podeDesfazer;
  $('btn-redo').disabled = !store.podeRefazer;
}

function render() {
  definirCoresProjeto(store.doc.cores);
  validarSelecao();
  renderSidebar();
  if (document.activeElement !== $('faixaInput')) sincronizarFaixa();
  ['planta', 'camadas', 'perfil'].forEach((n) => {
    $('view-' + n).hidden = n !== ui.view;
    $('nav-' + n).classList.toggle('active', n === ui.view);
  });
  if (ui.view === 'planta') planta.draw();
  if (ui.view === 'camadas') camadas.render();
  if (ui.view === 'perfil') perfil.draw();
}

store.assinar(() => render());

// ── faixa do corte ───────────────────────────────────────
function sincronizarFaixa() {
  const c = app.corteAtivo();
  const faixa = c ? c.faixa : ui.faixa;
  $('faixaTodos').checked = faixa === null;
  $('faixaInput').disabled = faixa === null;
  if (faixa !== null) $('faixaInput').value = faixa;
}
function aplicarFaixa() {
  const todos = $('faixaTodos').checked;
  const v = Math.max(1, num($('faixaInput').value, 50));
  const faixa = todos ? null : v;
  $('faixaInput').disabled = todos;
  ui.faixa = faixa;
  const c = app.corteAtivo();
  if (c && c.faixa !== faixa) store.commit((d) => { d.cortes.find((q) => q.id === c.id).faixa = faixa; }, { agrupar: 'faixa:' + c.id });
  else render();
}
$('faixaInput').addEventListener('change', aplicarFaixa);
$('faixaTodos').addEventListener('change', aplicarFaixa);

// ── modal de furo ────────────────────────────────────────
function abrirModalFuro(pos = null) {
  const v = ui.planta;
  $('mId').value = proximoNome(store.doc.furos);
  $('mX').value = pos ? pos.x : +v.cx.toFixed(2);
  $('mY').value = pos ? pos.y : +v.cy.toFixed(2);
  ['mCota', 'mLimite', 'mNA'].forEach((id) => { $(id).value = ''; });
  $('bhModal').classList.add('open');
  setTimeout(() => $('mId').select(), 30);
}
$('bhForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const nome = $('mId').value.trim();
  if (store.doc.furos.some((f) => f.nome === nome)) { toast(`Já existe um furo "${nome}".`); $('mId').select(); return; }
  const f = novoFuro({ nome, x: num($('mX').value), y: num($('mY').value), cota: num($('mCota').value), profTotal: num($('mLimite').value), na: num($('mNA').value) });
  store.commit((d) => { d.furos.push(f); });
  ui.furoId = f.id;
  fecharModais();
  app.setStatus(`Furo ${nome} lançado em (${f.x}; ${f.y})`, 'ok');
  render();
});
function fecharModais() { document.querySelectorAll('.modal-bg.open').forEach((m) => m.classList.remove('open')); }
document.querySelectorAll('.modal-bg').forEach((m) => m.addEventListener('mousedown', (e) => { if (e.target === m) fecharModais(); }));

// ── importação CSV / XLSX ────────────────────────────────
let importacao = null; // { nome, texto?, tabelas: [{ aba, linhas }] }
async function carregarArquivoImportacao(file) {
  try {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'xlsx') importacao = { nome: file.name, tabelas: (await lerXLSX(file)).map((a) => ({ aba: a.sheet, linhas: a.data })) };
    else { const texto = await lerTexto(file); importacao = { nome: file.name, texto, tabelas: [{ aba: '', linhas: lerCSV(texto, $('csvSep').value) }] }; }
    mostrarPreviaImportacao();
  } catch (err) { toast('Não foi possível ler o arquivo: ' + err.message); }
}
function mostrarPreviaImportacao() {
  const el = $('csvPreview');
  const partes = importacao.tabelas.map(({ aba, linhas }) => {
    const { registros, colunas } = interpretarTabela(linhas);
    return `${aba ? `[${aba}] ` : ''}${registros.length} linha(s) · colunas: ${colunas.join(', ') || 'nenhuma reconhecida (falta a coluna "furo")'}\n` +
      linhas.slice(0, 6).map((l) => l.join(' | ')).join('\n');
  });
  el.textContent = `${importacao.nome}\n\n` + partes.join('\n\n');
  el.hidden = false;
  $('btnConfirmCSV').disabled = false;
}
$('csvSep').addEventListener('change', () => { if (importacao?.texto) { importacao.tabelas = [{ aba: '', linhas: lerCSV(importacao.texto, $('csvSep').value) }]; mostrarPreviaImportacao(); } });
$('fileCSV').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) { $('csvModal').classList.add('open'); carregarArquivoImportacao(f); } });

function confirmarImportacao() {
  if (!importacao) return;
  const registros = importacao.tabelas.flatMap(({ linhas }) => interpretarTabela(linhas).registros);
  if (!registros.length) { toast('Nenhuma linha com a coluna "furo" foi encontrada.'); return; }
  const res = store.commit((d) => aplicarImportacao(d, registros));
  importacao = null; $('csvPreview').hidden = true; $('btnConfirmCSV').disabled = true;
  fecharModais();
  planta.ajustar();
  toast([`Importado: ${res.furosNovos} furo(s) novo(s), ${res.furosAtualizados} atualizado(s), ${res.camadas} camada(s), ${res.spt} valor(es) de SPT.`, ...res.avisos].join(' '), 8000);
}

// ── ações ────────────────────────────────────────────────
const acoes = {
  view(v) { ui.view = v; render(); if (v === 'planta' && !ui.planta.inicializada) { ui.planta.inicializada = true; planta.ajustar(); } },
  tool(t) { planta.setTool(t); },
  desfazer() { if (store.desfazer()) toast('Desfeito'); },
  refazer() { if (store.refazer()) toast('Refeito'); },
  furo(id) { app.selecionarFuro(id); },
  removerFuro(id) {
    const f = store.doc.furos.find((q) => q.id === id); if (!f) return;
    store.commit((d) => { d.furos = d.furos.filter((q) => q.id !== id); });
    toast(`Furo ${f.nome} removido. Ctrl+Z desfaz.`);
  },
  corte(id) { app.selecionarCorte(id); },
  removerCorte(id) {
    const c = store.doc.cortes.find((q) => q.id === id); if (!c) return;
    store.commit((d) => { d.cortes = d.cortes.filter((q) => q.id !== id); });
    toast(`Corte ${c.nome} removido. Ctrl+Z desfaz.`);
  },
  novoFuro() { abrirModalFuro(); },
  modoSPT(m) { store.commit((d) => { d.projeto.modoSPT = m; }); },
  maisMetro() { camadas.maisMetro(); },
  menosMetro() { camadas.menosMetro(); },
  restaurarCores() { camadas.restaurarCores(); },
  async boletimPDF() {
    const f = app.furoAtual();
    if (!f) { toast('Selecione um furo.'); return; }
    try {
      const { gerarBoletimPDF } = await import('./io/boletim.js');
      definirCoresProjeto(store.doc.cores);
      const pdf = gerarBoletimPDF(store.doc, f);
      baixar(pdf.output('blob'), nomeArquivo(`boletim_${f.nome}`, 'pdf'), 'application/pdf');
    } catch (e) { toast('Erro ao gerar o boletim: ' + e.message); }
  },
  rp(t) { ui.rp = t; camadas.render(); },
  ajustar() { planta.ajustar(); },
  axis(m) { ui.perfil.axis = m; $('btn-cota').classList.toggle('active', m === 'cota'); $('btn-prof').classList.toggle('active', m === 'prof'); perfil.draw(); },
  opt(k) {
    ui.perfil[k] = !ui.perfil[k];
    const ids = { showNA: 'btn-na', showLab: 'btn-lab', showSPT: 'btn-spt', showHatch: 'btn-hatch' };
    $(ids[k]).classList.toggle('active', ui.perfil[k]); perfil.draw();
  },
  zoom(d) { perfil.zoomDelta(+d); },
  zoomFit() { perfil.zoomFit(); },
  novo() {
    if (!confirm('Começar um projeto vazio? (Ctrl+Z desfaz)')) return;
    store.substituir(novoProjeto()); ui.corteId = null; planta.ajustar();
  },
  abrir() { $('fileOpen').click(); },
  salvar() { store.salvarAgora(); baixar(serializar(store.doc), nomeArquivo(store.doc.projeto.nome, 'json'), 'application/json'); },
  importar() { $('csvModal').classList.add('open'); },
  escolherCSV() { $('fileCSV').click(); },
  confirmarCSV() { confirmarImportacao(); },
  modeloCSV() { baixar('﻿' + MODELO_CSV, 'modelo_geoperfil.csv', 'text/csv;charset=utf-8'); },
  async modeloXLSX() { try { await escreverXLSX(MODELO_XLSX, 'modelo_geoperfil.xlsx'); } catch (e) { toast('Erro ao gerar o modelo: ' + e.message); } },
  fecharModal() { fecharModais(); },
  dxf() {
    if (!store.doc.furos.length) { toast('Nenhum furo lançado.'); return; }
    const d = perfil.dados();
    const corte = app.corteAtivo();
    baixar(gerarDXF(store.doc, { ...d, corte }, ui.perfil.axis), nomeArquivo(`${store.doc.projeto.nome}${corte ? '_' + corte.nome : ''}`, 'dxf'), 'application/dxf');
    if (d.bhs.length < 2) toast('DXF gerado só com a planta: o corte ativo precisa de pelo menos 2 furos para ter perfil.');
  },
  pdf() {
    if (ui.view !== 'perfil') { ui.view = 'perfil'; render(); }
    setTimeout(() => window.print(), 120);
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = acoes[el.dataset.action];
  if (!fn) return;
  if (el.dataset.action === 'removerFuro' || el.dataset.action === 'removerCorte') e.stopPropagation();
  fn(el.dataset.arg);
});
$('corteSelect').addEventListener('change', (e) => app.selecionarCorte(e.target.value || null));
$('fileOpen').addEventListener('change', async (e) => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  try {
    const projeto = carregarProjeto(JSON.parse(await lerTexto(file)));
    store.substituir(projeto);
    ui.corteId = projeto.cortes.at(-1)?.id ?? null; ui.furoId = null;
    sincronizarFaixa(); planta.ajustar(); render();
    toast(`Carregado: ${projeto.furos.length} furos, ${projeto.cortes.length} cortes.`);
  } catch (err) { toast('Erro ao abrir: ' + err.message); }
});

// ── teclado ──────────────────────────────────────────────
const ehCampo = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA');
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') fecharModais();
  if (ehCampo(e.target)) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); acoes.desfazer(); }
  else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); acoes.refazer(); }
  else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); acoes.salvar(); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && ui.view === 'planta' && ui.tool === 'move' && ui.furoId) acoes.removerFuro(ui.furoId);
});

// ── mensagens ────────────────────────────────────────────
let timerToast;
function toast(msg, ms = 3500) {
  const el = $('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(timerToast); timerToast = setTimeout(() => el.classList.remove('show'), ms);
}

// ── início ───────────────────────────────────────────────
new ResizeObserver(() => render()).observe(document.querySelector('.center'));
window.addEventListener('beforeunload', () => store.salvarAgora());
ui.corteId = store.doc.cortes.at(-1)?.id ?? null;
sincronizarFaixa();
requestAnimationFrame(() => {
  render();
  ui.planta.inicializada = true;
  planta.ajustar();
  if (avisosIniciais.length) toast(avisosIniciais.join(' '));
});

// acesso para depuração e testes de ponta a ponta
window.geoperfil = { store, ui, render, furosNoCorte, camadasDoFuro };
