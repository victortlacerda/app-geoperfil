import './styles/main.css';
import { criarStore, lerAutosave } from './store.js';
import { novoProjeto, projetoExemplo, novoFuro, proximoNome, profMax, num, camadasDoFuro, estiloPadrao } from './model/projeto.js';
import { carregarProjeto, serializar } from './model/arquivo.js';
import { furosNoCorte, perfilDoCorte } from './geo/corte.js';
import { pranchaPadrao } from './geo/prancha.js';
import { criarPlanta } from './views/planta.js';
import { criarCamadas } from './views/camadas.js';
import { criarPerfil } from './views/perfil.js';
import { lerCSV, interpretarTabela, aplicarImportacao, MODELO_CSV, MODELO_XLSX } from './io/csv.js';
import { baixar, lerTexto, lerXLSX, escreverXLSX, nomeArquivo } from './io/arquivos.js';
import { corFuro, OK, ACCENT } from './styles/tema.js';
import { definirCoresProjeto } from './model/catalogo.js';
import { FUSOS, epsgDoFuso, utmParaGeo, geoParaUtm, ehGeorreferenciado, utmPlausivel } from './geo/coordenadas.js';
import { exportarGeoJSON, exportarKML, lerGeoJSON, lerKML, aplicarPontos } from './io/geo.js';

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

// opções do modelo 3D ao abrir o app (o botão Redefinir volta a elas)
const M3D_PADRAO = () => ({ exagero: 3, furos: true, spt: false, na: true, grama: true, cortar: true, raiox: false, grade: true, deslocamento: 0, ocultos: new Set(), opacidade: {} });
const ui = {
  view: 'planta', furoId: null, corteId: null, metroSel: null, rp: 'chart', linhasMin: {},
  graficoOculto: new Set(), tool: 'furo', faixa: 50, incluir: 'lado',
  planta: { k: 2, cx: 0, cy: 0 },
  m3d: M3D_PADRAO(),
  perfil: { axis: 'cota', showNA: true, showLab: true, showSPT: true, showHatch: true, zoom: 1, panX: 0, editar: false },
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
  sincronizarCoordenadas();
  validarSelecao();
  renderSidebar();
  if (document.activeElement !== $('faixaInput')) sincronizarFaixa();
  ['planta', 'camadas', 'perfil', '3d'].forEach((n) => {
    $('view-' + n).hidden = n !== ui.view;
    $('nav-' + n).classList.toggle('active', n === ui.view);
  });
  if (ui.view === 'planta') planta.draw();
  if (ui.view === 'camadas') camadas.render();
  if (ui.view === 'perfil') { botoesModo(); botoesEstilo(); perfil.draw(); }
  if (ui.view === '3d') abrir3D();
  else modelo3d?.render();
}

store.assinar(() => render());

// ── modelo 3D (carregado sob demanda) ────────────────────
let modelo3d = null, carregando3d = null;
function abrir3D() {
  if (modelo3d) { modelo3d.render(); return; }
  if (carregando3d) return;
  $('m3dInfo').textContent = 'Carregando o modelo 3D…';
  carregando3d = import('./views/modelo3d.js').then(({ criarModelo3D }) => {
    modelo3d = criarModelo3D(app);
    window.geoperfil.modelo3d = modelo3d;
    modelo3d.render();
  }).catch((e) => { $('m3dInfo').textContent = 'Erro ao carregar o modelo 3D: ' + e.message; carregando3d = null; });
}
document.querySelectorAll('[data-m3d]').forEach((el) => el.addEventListener('change', () => {
  ui.m3d[el.dataset.m3d] = el.checked;
  if (el.dataset.m3d === 'cortar') modelo3d?.reenquadrar();
  modelo3d?.render();
}));
/** Botões e seleção de estilo do perfil refletem o projeto e a tela. */
function botoesEstilo() {
  const e = estiloPadrao(store.doc.projeto.estilo || {});
  $('btn-lab').classList.toggle('active', e.rotulos); $('btn-hatch').classList.toggle('active', e.hachura);
  $('btn-na').classList.toggle('active', ui.perfil.showNA); $('btn-spt').classList.toggle('active', ui.perfil.showSPT);
  $('selCor').value = e.cor;
}
$('selCor').addEventListener('change', () => {
  const cor = $('selCor').value;
  store.commit((d) => { d.projeto.estilo = { ...estiloPadrao(d.projeto.estilo || {}), cor }; });
});
function linhaReferencia(r = { nome: '', cota: '' }) {
  const div = document.createElement('div');
  div.className = 'mrow dref';
  div.innerHTML = `<div class="mfield"><input class="dRefNome" placeholder="ex.: Fundo de escavação" /></div><div class="mfield" style="max-width:120px"><input class="dRefCota" type="number" step="0.01" placeholder="cota" /></div><button type="button" class="t-btn" title="Remover">✕</button>`;
  div.querySelector('.dRefNome').value = r.nome; div.querySelector('.dRefCota').value = r.cota;
  div.querySelector('button').addEventListener('click', () => div.remove());
  $('dRefs').appendChild(div);
}
$('dAddRef').addEventListener('click', () => linhaReferencia());
$('desForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const na = $('dNA').value.trim() === '' ? null : num($('dNA').value);
  const refs = [...document.querySelectorAll('#dRefs .dref')].map((d) => ({ nome: d.querySelector('.dRefNome').value.trim() || 'Referência', cota: d.querySelector('.dRefCota').value }))
    .filter((r) => r.cota !== '' && Number.isFinite(+r.cota)).map((r) => ({ ...r, cota: +r.cota }));
  const spt30 = $('dSpt30').checked;
  store.commit((d) => { d.projeto.naProjeto = na; d.projeto.referencias = refs; d.projeto.estilo = { ...estiloPadrao(d.projeto.estilo || {}), spt30 }; });
  fecharModais();
});

function linhaRevisao(r = { rev: '', data: new Date().toLocaleDateString('pt-BR'), descricao: '', por: '' }) {
  const d = document.createElement('div');
  d.className = 'prrev';
  d.innerHTML = '<input class="rRev" placeholder="Rev." /><input class="rData" placeholder="Data" /><input class="rDesc" placeholder="Descrição" /><input class="rPor" placeholder="Por" /><button type="button" class="t-btn" title="Remover">✕</button>';
  d.querySelector('.rRev').value = r.rev ?? ''; d.querySelector('.rData').value = r.data ?? ''; d.querySelector('.rDesc').value = r.descricao ?? ''; d.querySelector('.rPor').value = r.por ?? '';
  d.querySelector('button').addEventListener('click', () => d.remove());
  $('prRevs').appendChild(d);
}
$('prAddRev').addEventListener('click', () => {
  const n = document.querySelectorAll('#prRevs .prrev').length;
  linhaRevisao({ rev: String(n).padStart(2, '0'), data: new Date().toLocaleDateString('pt-BR'), descricao: '', por: '' });
});
$('prForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const saida = e.submitter?.dataset.saida || 'pdf';
  const ids = [...document.querySelectorAll('#prCortes input:checked')].map((i) => i.value);
  if (!ids.length) { toast('Marque pelo menos um corte.'); return; }
  const prancha = {
    formato: $('prFormato').value, exagero: +$('prExagero').value, cortes: ids,
    cliente: $('prCliente').value.trim(), obra: $('prObra').value.trim(), local: $('prLocal').value.trim(), titulo: $('prTitulo').value.trim(),
    responsavel: $('prResp').value.trim(), registro: $('prReg').value.trim(), codigo: $('prCodigo').value.trim(), folha: $('prFolha').value.trim(),
    revisoes: [...document.querySelectorAll('#prRevs .prrev')].map((d) => ({ rev: d.querySelector('.rRev').value.trim(), data: d.querySelector('.rData').value.trim(), descricao: d.querySelector('.rDesc').value.trim(), por: d.querySelector('.rPor').value.trim() })).filter((r) => r.rev || r.descricao),
    notas: $('prNotas').value.split('\n').map((l) => l.trim()).filter(Boolean),
  };
  store.commit((d) => { d.projeto.prancha = prancha; });
  try {
    const doc = store.doc, estilo = estiloPadrao(doc.projeto.estilo || {});
    const perfis = ids.map((id) => doc.cortes.find((k) => k.id === id)).filter(Boolean)
      .map((corte) => ({ corte, bhs: perfilDoCorte(corte, doc.furos, { porHorizonte: estilo.cor === 'horizonte' }) }));
    const semFuros = perfis.filter((p) => p.bhs.length < 2).map((p) => p.corte.nome);
    if (semFuros.length === perfis.length) { toast('Nenhum dos cortes marcados tem 2 furos ou mais.'); return; }
    const { montarPrancha } = await import('./geo/prancha.js');
    const pr = montarPrancha(doc, perfis, { estilo });
    if (!pr.cabe) { toast(`Os cortes não cabem no ${pr.formato.join('×')}: escolha um formato maior ou menos cortes.`); return; }
    const nome = nomeArquivo(`prancha_${doc.projeto.nome}_${prancha.formato}`, saida);
    if (saida === 'dxf') {
      const { gerarPranchaDXF } = await import('./io/dxf.js');
      baixar(gerarPranchaDXF(pr, pr.materiais), nome, 'application/dxf');
    } else {
      const { gerarPranchaPDF } = await import('./io/perfilPDF.js');
      baixar(gerarPranchaPDF(pr).output('blob'), nome, 'application/pdf');
    }
    fecharModais();
    toast(`Prancha ${prancha.formato} em 1:${pr.escala}${semFuros.length ? ` (sem perfil: ${semFuros.join(', ')})` : ''}.`);
  } catch (err) { toast('Erro ao gerar a prancha: ' + err.message); console.error(err); }
});

/** Botões Interpolado / Suave / Degrau refletem o modo do corte ativo. */
function botoesModo() {
  const m = app.corteAtivo()?.modo || 'interpolado';
  $('btn-interp').classList.toggle('active', m === 'interpolado');
  $('btn-suave').classList.toggle('active', m === 'suave');
  $('btn-degrau').classList.toggle('active', m === 'degrau');
  $('btn-editar').disabled = m === 'degrau'; $('btn-restaurar').disabled = m === 'degrau';
}

/** Controles da barra do 3D refletem ui.m3d. */
function sincronizar3D() {
  document.querySelectorAll('[data-m3d]').forEach((el) => { el.checked = !!ui.m3d[el.dataset.m3d]; });
  $('m3dEx').value = ui.m3d.exagero; $('m3dExVal').textContent = `${ui.m3d.exagero}×`;
  $('m3dDesl').value = ui.m3d.deslocamento; $('m3dDeslVal').textContent = `${ui.m3d.deslocamento} m`;
}
$('m3dEx').addEventListener('input', () => { const v = +$('m3dEx').value; $('m3dExVal').textContent = `${v}×`; modelo3d?.definirExagero(v); });
$('m3dDesl').addEventListener('input', () => { ui.m3d.deslocamento = +$('m3dDesl').value; $('m3dDeslVal').textContent = `${ui.m3d.deslocamento} m`; modelo3d?.render(); });

// ── faixa do corte ───────────────────────────────────────
function sincronizarFaixa() {
  const c = app.corteAtivo();
  const faixa = c ? c.faixa : ui.faixa;
  $('faixaAmbos').checked = (c ? c.incluir : ui.incluir) === 'ambos';
  $('faixaTodos').checked = faixa === null;
  $('faixaInput').disabled = faixa === null;
  if (faixa !== null) $('faixaInput').value = faixa;
}
function aplicarFaixa() {
  const todos = $('faixaTodos').checked;
  const v = Math.max(1, num($('faixaInput').value, 50));
  const faixa = todos ? null : v;
  const incluir = $('faixaAmbos').checked ? 'ambos' : 'lado';
  $('faixaInput').disabled = todos;
  ui.faixa = faixa; ui.incluir = incluir;
  const c = app.corteAtivo();
  if (c && (c.faixa !== faixa || c.incluir !== incluir)) store.commit((d) => { Object.assign(d.cortes.find((q) => q.id === c.id), { faixa, incluir }); }, { agrupar: 'faixa:' + c.id });
  else render();
}
$('faixaInput').addEventListener('change', aplicarFaixa);
$('faixaTodos').addEventListener('change', aplicarFaixa);
$('faixaAmbos').addEventListener('change', aplicarFaixa);

// ── modal de furo ────────────────────────────────────────
// ── sistema de coordenadas ───────────────────────────────
$('fusoSelect').innerHTML = FUSOS.map((f) => `<option value="${f}">${f}</option>`).join('');
function sincronizarCoordenadas() {
  const p = store.doc.projeto, geo = ehGeorreferenciado(store.doc);
  $('crsSelect').value = geo ? 'utm' : 'local';
  $('fusoSelect').value = p.fusoUTM || '23S';
  $('fundoSelect').value = p.fundo || 'mapa';
  $('grupoUTM').hidden = !geo;
  $('epsgLabel').textContent = geo ? `EPSG:${epsgDoFuso(p.fusoUTM || '23S')}` : '';
}
function mudarCoordenadas() {
  const crs = $('crsSelect').value, fuso = $('fusoSelect').value, fundo = $('fundoSelect').value;
  const antes = store.doc.projeto;
  store.commit((d) => { Object.assign(d.projeto, { crs, fusoUTM: fuso, fundo }); });
  if (crs === 'utm' && (antes.crs !== 'utm' || antes.fusoUTM !== fuso)) {
    const estranhos = store.doc.furos.filter((f) => !utmPlausivel(f.x, f.y, fuso));
    if (estranhos.length) toast(`${estranhos.length} furo(s) têm coordenadas que não parecem UTM do fuso ${fuso} (ex.: ${estranhos[0].nome}: ${estranhos[0].x}; ${estranhos[0].y}). Confira as coordenadas.`, 8000);
  }
  planta.ajustar();
}
['crsSelect', 'fusoSelect', 'fundoSelect'].forEach((id) => $(id).addEventListener('change', mudarCoordenadas));

// ── modal de furo ────────────────────────────────────────
function rotulosModal() {
  const geoDig = ehGeorreferenciado(store.doc) && $('mSist').value === 'geo';
  $('mXLabel').textContent = geoDig ? 'Latitude (°)' : 'Coord. X — Leste (m)';
  $('mYLabel').textContent = geoDig ? 'Longitude (°)' : 'Coord. Y — Norte (m)';
}
$('mSist').addEventListener('change', () => {
  // converte o que já está digitado para o outro sistema
  const fz = store.doc.projeto.fusoUTM, a = num($('mX').value, NaN), b = num($('mY').value, NaN);
  if (Number.isFinite(a) && Number.isFinite(b)) {
    if ($('mSist').value === 'geo') { const g = utmParaGeo(a, b, fz); $('mX').value = g.lat.toFixed(7); $('mY').value = g.lon.toFixed(7); }
    else { const u = geoParaUtm(a, b, fz); $('mX').value = u.x.toFixed(2); $('mY').value = u.y.toFixed(2); }
  }
  rotulosModal();
});
function abrirModalFuro(pos = null) {
  const v = ui.planta, geo = ehGeorreferenciado(store.doc);
  $('mSistWrap').hidden = !geo;
  if (!geo) $('mSist').value = 'utm';
  rotulosModal();
  $('mId').value = proximoNome(store.doc.furos);
  const centro = geo && planta.mapa() ? (() => { const c = planta.mapa().getCenter(); return geoParaUtm(c.lat, c.lng, store.doc.projeto.fusoUTM); })() : { x: v.cx, y: v.cy };
  let px = pos ? pos.x : +centro.x.toFixed(2), py = pos ? pos.y : +centro.y.toFixed(2);
  if (geo && $('mSist').value === 'geo') { const g = utmParaGeo(px, py, store.doc.projeto.fusoUTM); px = g.lat.toFixed(7); py = g.lon.toFixed(7); }
  $('mX').value = px;
  $('mY').value = py;
  ['mCota', 'mLimite', 'mNA'].forEach((id) => { $(id).value = ''; });
  $('bhModal').classList.add('open');
  $('mId').focus(); $('mId').select();
}
$('bhForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const nome = $('mId').value.trim();
  if (store.doc.furos.some((f) => f.nome === nome)) { toast(`Já existe um furo "${nome}".`); $('mId').select(); return; }
  let x = num($('mX').value), y = num($('mY').value);
  if (ehGeorreferenciado(store.doc) && $('mSist').value === 'geo') {
    if (Math.abs(x) > 90 || Math.abs(y) > 180) { toast('Latitude deve estar entre −90 e 90 e longitude entre −180 e 180.'); return; }
    const u = geoParaUtm(x, y, store.doc.projeto.fusoUTM); x = +u.x.toFixed(3); y = +u.y.toFixed(3);
  }
  const f = novoFuro({ nome, x, y, cota: num($('mCota').value), profTotal: num($('mLimite').value), na: num($('mNA').value) });
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
    if (ext === 'kml' || ext === 'geojson' || (ext === 'json' && /"FeatureCollection"|"Feature"/.test(await lerTexto(file)))) {
      const texto = await lerTexto(file);
      const pontos = ext === 'kml' ? lerKML(texto) : lerGeoJSON(texto);
      if (!pontos.length) { toast('Nenhum ponto encontrado no arquivo.'); return; }
      const r = store.commit((d) => aplicarPontos(d, pontos));
      fecharModais(); planta.ajustar();
      toast([`Importado de ${file.name}: ${r.novos} furo(s) novo(s), ${r.atualizados} atualizado(s).`, ...r.avisos].join(' '), 8000);
      return;
    }
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
  mista() {
    const f = app.furoAtual(); if (!f) return;
    store.commit((d) => { const q = d.furos.find((x) => x.id === f.id); if (q.mista) delete q.mista; else q.mista = true; });
  },
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
    // rótulos e hachuras são do estilo do projeto (valem no PDF e no DXF); NA e SPT são só da tela
    const doEstilo = { showLab: 'rotulos', showHatch: 'hachura' }[k];
    if (doEstilo) { store.commit((d) => { const e = estiloPadrao(d.projeto.estilo || {}); e[doEstilo] = !e[doEstilo]; d.projeto.estilo = e; }); return; }
    ui.perfil[k] = !ui.perfil[k];
    botoesEstilo(); perfil.draw();
  },
  dialogoPrancha() {
    if (!store.doc.cortes.length) { toast('Defina pelo menos um corte na aba Planta.'); return; }
    const c = pranchaPadrao(store.doc.projeto.prancha || {});
    $('prFormato').value = c.formato; $('prExagero').value = String(c.exagero);
    const marcados = new Set(c.cortes || store.doc.cortes.map((k) => k.id));
    $('prCortes').innerHTML = store.doc.cortes.map((k) => `<label><input type="checkbox" value="${k.id}" ${marcados.has(k.id) ? 'checked' : ''}/> ${esc(k.nome)}</label>`).join('');
    [['prCliente', 'cliente'], ['prObra', 'obra'], ['prLocal', 'local'], ['prTitulo', 'titulo'], ['prResp', 'responsavel'], ['prReg', 'registro'], ['prCodigo', 'codigo'], ['prFolha', 'folha']].forEach(([id, k]) => { $(id).value = c[k] || ''; });
    if (!c.obra) $('prObra').value = store.doc.projeto.nome || '';
    $('prRevs').innerHTML = ''; c.revisoes.forEach((r) => linhaRevisao(r));
    $('prNotas').value = c.notas.join('\n');
    $('prModal').classList.add('open');
  },
  dialogoDesenho() {
    const p = store.doc.projeto;
    $('dNA').value = p.naProjeto ?? '';
    $('dSpt30').checked = !!p.estilo?.spt30;
    $('dRefs').innerHTML = '';
    (p.referencias || []).forEach((r) => linhaReferencia(r));
    $('desModal').classList.add('open');
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
  exportarGeoJSON() {
    try { baixar(exportarGeoJSON(store.doc), nomeArquivo(store.doc.projeto.nome, 'geojson'), 'application/geo+json'); }
    catch (e) { toast(e.message, 6000); }
  },
  exportarKML() {
    try { baixar(exportarKML(store.doc), nomeArquivo(store.doc.projeto.nome, 'kml'), 'application/vnd.google-earth.kml+xml'); }
    catch (e) { toast(e.message, 6000); }
  },
  confirmarCSV() { confirmarImportacao(); },
  modeloCSV() { baixar('﻿' + MODELO_CSV, 'modelo_geoperfil.csv', 'text/csv;charset=utf-8'); },
  async modeloXLSX() { try { await escreverXLSX(MODELO_XLSX, 'modelo_geoperfil.xlsx'); } catch (e) { toast('Erro ao gerar o modelo: ' + e.message); } },
  fecharModal() { fecharModais(); },
  async dxf() {
    if (!store.doc.furos.length) { toast('Nenhum furo lançado.'); return; }
    const { gerarDXF } = await import('./io/dxf.js'); // carregado só quando usado
    const d = perfil.dados();
    const corte = app.corteAtivo();
    baixar(gerarDXF(store.doc, { ...d, corte }, ui.perfil.axis), nomeArquivo(`${store.doc.projeto.nome}${corte ? '_' + corte.nome : ''}`, 'dxf'), 'application/dxf');
    if (d.bhs.length < 2) toast('DXF gerado só com a planta: o corte ativo precisa de pelo menos 2 furos para ter perfil.');
  },
  async pdf() {
    const corte = app.corteAtivo();
    if (!corte) { toast('Escolha um corte para gerar o PDF do perfil.'); return; }
    const d = perfil.dados();
    if (d.bhs.length < 2) { toast(`O corte ${corte.nome} precisa de pelo menos 2 furos.`); return; }
    try {
      const { gerarPerfilPDF } = await import('./io/perfilPDF.js');
      const pdf = gerarPerfilPDF(store.doc, { ...d, corte }, { axis: ui.perfil.axis });
      baixar(pdf.output('blob'), nomeArquivo(`perfil_${store.doc.projeto.nome}_${corte.nome}`, 'pdf'), 'application/pdf');
    } catch (e) { toast('Erro ao gerar o PDF: ' + e.message, 6000); }
  },
  vista3d(t) { modelo3d?.vista(t); },
  redefinir3d() {
    Object.assign(ui.m3d, M3D_PADRAO());
    sincronizar3D();
    modelo3d?.reenquadrar();
    modelo3d?.render();
  },
  async capturar3d() {
    if (!modelo3d) return;
    const blob = await modelo3d.capturar();
    baixar(blob, nomeArquivo(`modelo3d_${store.doc.projeto.nome}`, 'png'), 'image/png');
  },
  // o modo do desenho fica salvo no corte (vale no 2D, no PDF, no DXF e no 3D)
  modoPerfil(m) {
    const c = app.corteAtivo();
    if (!c) return;
    if ((c.modo || 'interpolado') !== m) store.commit((d) => { const q = d.cortes.find((x) => x.id === c.id); if (m === 'interpolado') delete q.modo; else q.modo = m; });
    botoesModo();
  },
  editarContatos() {
    ui.perfil.editar = !ui.perfil.editar;
    $('btn-editar').classList.toggle('active', ui.perfil.editar);
    if (ui.perfil.editar) toast('Alças ◆: arraste para os lados para mudar onde a camada acunha ou a transição. Passe o mouse num contato para ver a alça ●: arraste para cima ou para baixo para mudar a espessura entre os furos. Duplo clique volta ao padrão.', 7000);
    perfil.draw();
  },
  // atalhos entre o Perfil 2D e o Modelo 3D (os dois usam o mesmo perfil do corte)
  ver3d() {
    if (!app.corteAtivo()) { toast('Selecione ou trace um corte.'); return; }
    ui.m3d.cortar = true; ui.m3d.deslocamento = 0; ui.m3d.vistaPendente = 'corte';
    sincronizar3D();
    ui.view = '3d'; render();
  },
  editarNo2D() {
    if (!app.corteAtivo()) { toast('Trace um corte na planta para ajustar os contatos.'); return; }
    ui.view = 'perfil';
    if (app.corteAtivo().modo === 'degrau') acoes.modoPerfil('interpolado');
    if (!ui.perfil.editar) acoes.editarContatos();
    render();
  },
  restaurarContatos() {
    const c = app.corteAtivo();
    if (!c || !c.ajustes || !Object.keys(c.ajustes).length) { toast('Este corte já está na interpretação automática.'); return; }
    store.commit((d) => { delete d.cortes.find((q) => q.id === c.id).ajustes; });
    toast('Interpretação automática restaurada (Ctrl+Z desfaz).');
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
window.geoperfil = { store, ui, render, furosNoCorte, camadasDoFuro, planta, utmParaGeo, geoParaUtm, perfilDados: () => perfil.dados(), perfilXY: (d, c) => perfil.xy(d, c) };
