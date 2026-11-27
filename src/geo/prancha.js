// Prancha de perfis (A0 a A3): vários cortes numa folha, na mesma escala, com
// planta-chave, notas, legenda e carimbo com tabela de revisões.
//
// Tudo em milímetros de papel, y para baixo (os mesmos elementos de geo/desenho.js):
// o PDF desenha direto e o DXF sai em 1:1 (mm).
import { niceStep } from './zonas.js';
import { geometriaPerfil } from './perfil2d.js';
import { desenharPerfil, desenharLegenda, legendaPerfil, caixaDe, CORES, camadaMaterial } from './desenho.js';
import { ESCALAS, folgaPerfil } from '../io/escalas.js';

export const FORMATOS = { A0: [1189, 841], A1: [841, 594], A2: [594, 420], A3: [420, 297] };

export const NOTAS_PADRAO = [
  'Dimensões e elevações em metros, exceto onde indicado.',
  'Os contatos entre horizontes foram interpolados entre os furos de sondagem; os limites reais podem ser diferentes dos desenhados.',
  'Ao lado de cada sondagem: N-SPT (golpes nos 30 cm finais) e, nas sondagens mistas, recuperação da rotativa (REC %).',
  'Profundidades, cotas e níveis d\'água conforme os boletins de sondagem.',
];

/** Configuração da prancha guardada no projeto, com os valores padrão. */
export function pranchaPadrao(p = {}) {
  return {
    formato: FORMATOS[p.formato] ? p.formato : 'A1',
    cortes: Array.isArray(p.cortes) ? p.cortes : null, // null = todos
    exagero: [1, 2, 2.5, 4, 5, 10].includes(+p.exagero) ? +p.exagero : 1,
    titulo: p.titulo ?? 'PERFIS GEOLÓGICO-GEOTÉCNICOS',
    cliente: p.cliente ?? '', obra: p.obra ?? '', local: p.local ?? '',
    responsavel: p.responsavel ?? '', registro: p.registro ?? '', codigo: p.codigo ?? '', folha: p.folha ?? '01/01',
    notas: Array.isArray(p.notas) ? p.notas : [...NOTAS_PADRAO],
    revisoes: Array.isArray(p.revisoes) && p.revisoes.length ? p.revisoes : [{ rev: '00', data: '', descricao: 'Emissão inicial', por: '' }],
  };
}

const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '—');
const larg = (txt, h) => String(txt).length * h * 0.58;

/** Desloca uma lista de elementos (em mm). */
export function deslocar(itens, dx, dy) {
  return itens.map((it) => ({ ...it, ...(it.pts ? { pts: it.pts.map(([x, y]) => [x + dx, y + dy]) } : {}), ...(it.t === 'texto' ? { x: it.x + dx, y: it.y + dy } : {}) }));
}

/** Um perfil desenhado na origem para a escala 1:E (vertical 1:E/exagero). */
function perfilNaEscala({ corte, bhs, geo }, E, exagero, estilo, cfg) {
  const k = 1000 / E, kv = k * exagero, fol = folgaPerfil(geo.totDist);
  const fundo = Math.min(...geo.fundo.map(([, c]) => c)), topo = Math.max(...bhs.map((b) => b.cota));
  // grade com pelo menos ~8 mm (cota) e ~18 mm (distância) no papel
  const passoC = niceStep(Math.max((topo - fundo) / 6 || 1, (8 * E) / exagero / 1000));
  const passoD = niceStep(Math.max((geo.totDist + 2 * fol) / 6, (18 * E) / 1000));
  const cTopo = Math.ceil((topo + 0.02 * (topo - fundo)) / passoC) * passoC, cBase = Math.floor((fundo - 0.02 * (topo - fundo)) / passoC) * passoC;
  const Ev = E / exagero;
  const { itens, caixa } = desenharPerfil({
    bhs, geo, corte, estilo, axis: 'cota', X: (d) => (d + fol) * k, Y: (c) => (cTopo - c) * kv, mm: 1, cTopo, passoC, passoD,
    janela: { d0: -fol, d1: geo.totDist + fol, c0: cBase, c1: cTopo },
    mostrar: { na: true, spt: true, rotulos: estilo.rotulos, hachura: estilo.hachura },
    naProjeto: cfg.naProjeto, referencias: cfg.referencias || [],
    titulo: { texto: `PERFIL ${corte.nome}`, sub: exagero > 1 ? `ESC. H 1:${E} · V 1:${Ev}` : `ESC. 1:${E}` },
  });
  // nomes de bloco únicos: o mesmo furo pode aparecer em mais de um corte
  itens.forEach((it) => { if (it.grupo) it.grupo = `${it.grupo} ${corte.nome}`; });
  return { itens, caixa, w: caixa[2] - caixa[0], h: caixa[3] - caixa[1] };
}

/** Prateleiras: perfis da esquerda para a direita, quebrando linha quando não cabem. */
function empacotar(caixas, W, H, folga = 12) {
  const pos = [];
  let x = 0, y = 0, hLinha = 0;
  for (const c of caixas) {
    if (c.w > W) return null;
    if (x > 0 && x + c.w > W) { x = 0; y += hLinha + folga; hLinha = 0; }
    pos.push([x, y]); x += c.w + folga; hLinha = Math.max(hLinha, c.h);
  }
  return y + hLinha <= H ? { pos, altura: y + hLinha } : null;
}

/** Planta-chave: furos e cortes do projeto numa caixa (x, y, w, h). */
function plantaChave(projeto, cortesUsados, x, y, w, h) {
  const itens = [];
  const furos = projeto.furos.filter((f) => Number.isFinite(f.x) && Number.isFinite(f.y));
  const pts = [...furos.map((f) => [f.x, f.y]), ...cortesUsados.flatMap((c) => [c.p1, c.p2])];
  if (!pts.length) return itens;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const ext = Math.max(Math.max(...xs) - Math.min(...xs), (Math.max(...ys) - Math.min(...ys)) * (w / (h - 22)), 1);
  const E = ESCALAS.find((e) => (ext * 1.25 * 1000) / e <= w - 10) || ESCALAS.at(-1);
  const k = 1000 / E, cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const P = (px, py) => [x + w / 2 + (px - cx) * k, y + (h - 16) / 2 + 2 - (py - cy) * k];
  cortesUsados.forEach((c) => {
    const a = P(...c.p1), b = P(...c.p2);
    itens.push({ t: 'linha', pts: [a, b], cor: CORES.vermelho, lw: 0.35, dash: [3, 1.2], camada: 'PLANTA-CORTES' });
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
    const nome = String(c.nome);
    if (nome.includes('–')) {
      const [n1, n2] = nome.split('–');
      itens.push({ t: 'texto', x: a[0] - ux * 4, y: a[1] - uy * 4, txt: n1 || 'A', h: 3, al: 'c', vb: 'meio', cor: CORES.vermelho, bold: true, camada: 'PLANTA-CORTES' });
      itens.push({ t: 'texto', x: b[0] + ux * 4, y: b[1] + uy * 4, txt: n2 || "A'", h: 3, al: 'c', vb: 'meio', cor: CORES.vermelho, bold: true, camada: 'PLANTA-CORTES' });
    } else {
      // nome livre: escrito ao longo da linha, no fim do corte
      const ang = -Math.atan2(uy, ux) * 180 / Math.PI, angOk = ang > 90 ? ang - 180 : ang < -90 ? ang + 180 : ang;
      itens.push({ t: 'texto', x: b[0] + ux * 3, y: b[1] + uy * 3 - 1, txt: nome, h: 2.4, al: 'l', vb: 'base', cor: CORES.vermelho, bold: true, ang: Math.abs(angOk) < 1 ? 0 : angOk, camada: 'PLANTA-CORTES' });
    }
  });
  furos.forEach((f) => {
    const [px, py] = P(f.x, f.y), r = 1.1;
    itens.push({ t: 'poli', pts: Array.from({ length: 12 }, (_, i) => [px + r * Math.cos((i / 12) * 2 * Math.PI), py + r * Math.sin((i / 12) * 2 * Math.PI)]), fill: '#ffffff', stroke: CORES.tinta, lw: 0.25, camada: 'PLANTA-FUROS' });
    itens.push({ t: 'texto', x: px + 1.8, y: py - 1.2, txt: f.nome, h: 2.2, al: 'l', vb: 'base', cor: CORES.tinta, camada: 'PLANTA-FUROS' });
  });
  // norte
  const nx = x + w - 8, ny = y + 6;
  itens.push({ t: 'poli', pts: [[nx, ny], [nx + 2.2, ny + 7], [nx, ny + 5.4], [nx - 2.2, ny + 7]], fill: CORES.tinta, stroke: CORES.tinta, lw: 0.2, camada: 'PLANTA' });
  itens.push({ t: 'texto', x: nx, y: ny - 1.2, txt: 'N', h: 3, al: 'c', vb: 'base', cor: CORES.tinta, bold: true, camada: 'PLANTA' });
  // título
  const tY = y + h - 6, tw = larg('PLANTA CHAVE', 3.6);
  itens.push({ t: 'texto', x: x + w / 2, y: tY, txt: 'PLANTA CHAVE', h: 3.6, al: 'c', vb: 'base', cor: CORES.tinta, camada: 'TITULO' });
  itens.push({ t: 'linha', pts: [[x + w / 2 - tw / 2, tY + 1], [x + w / 2 + tw / 2, tY + 1]], cor: CORES.tinta, lw: 0.3, camada: 'TITULO' });
  itens.push({ t: 'texto', x: x + w / 2, y: tY + 4.2, txt: `ESC. 1:${E}`, h: 2.2, al: 'c', vb: 'base', cor: CORES.tinta, camada: 'TITULO' });
  return itens;
}

/** Quebra um texto em linhas que cabem em `w` mm com corpo `h`. */
export function quebrar(txt, w, h) {
  const max = Math.max(8, Math.floor(w / (h * 0.55))), linhas = [];
  let atual = '';
  String(txt).split(/\s+/).forEach((p) => {
    if ((atual + ' ' + p).trim().length > max && atual) { linhas.push(atual); atual = p; } else atual = (atual + ' ' + p).trim();
  });
  if (atual) linhas.push(atual);
  return linhas;
}

function notas(lista, x, y, w) {
  const itens = [{ t: 'texto', x, y, txt: 'NOTAS', h: 3, al: 'l', vb: 'base', cor: CORES.tinta, bold: true, camada: 'NOTAS' }];
  let cy = y + 6;
  lista.filter((n) => String(n).trim()).forEach((n, i) => {
    itens.push({ t: 'texto', x, y: cy, txt: `${i + 1}.`, h: 2.3, al: 'l', vb: 'base', cor: CORES.tinta, camada: 'NOTAS' });
    quebrar(n, w - 6, 2.3).forEach((l) => { itens.push({ t: 'texto', x: x + 5, y: cy, txt: l, h: 2.3, al: 'l', vb: 'base', cor: CORES.tinta, camada: 'NOTAS' }); cy += 3.6; });
    cy += 1.2;
  });
  return { itens, altura: cy - y };
}

/** Carimbo em coluna à direita: revisões em cima, identificação embaixo. */
function carimbo(cfg, projeto, { x, y, w, h, escala, formato, data }) {
  const itens = [];
  const L = (pts, lw = 0.25) => itens.push({ t: 'linha', pts, cor: CORES.tinta, lw, camada: 'CARIMBO' });
  const T = (tx, ty, txt, hh = 2.2, o = {}) => itens.push({ t: 'texto', x: tx, y: ty, txt: String(txt ?? ''), h: hh, al: 'l', vb: 'base', cor: CORES.tinta, camada: 'CARIMBO', ...o });
  const rot = (tx, ty, txt) => T(tx, ty, txt.toUpperCase(), 1.6, { cor: CORES.cinza });
  itens.push({ t: 'poli', pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], fill: null, stroke: CORES.tinta, lw: 0.5, camada: 'CARIMBO' });

  // bloco de identificação (embaixo)
  const campos = [
    ['Cliente', cfg.cliente], ['Obra', cfg.obra || projeto.projeto?.nome], ['Local', cfg.local],
    ['Título', cfg.titulo], ['Responsável técnico', cfg.responsavel], ['Registro (CREA)', cfg.registro],
  ];
  const linhaH = 10, idH = campos.length * linhaH + 34;
  let cy = y + h - idH;
  L([[x, cy], [x + w, cy]], 0.4);
  campos.forEach(([r, v]) => {
    rot(x + 2, cy + 3.2, r);
    quebrar(v || '—', w - 4, 2.6).slice(0, 2).forEach((l, i) => T(x + 2, cy + 7 + i * 3, l, 2.6, { bold: r === 'Título' }));
    cy += linhaH; L([[x, cy], [x + w, cy]]);
  });
  const meio = x + w / 2, terco = (w) / 3;
  const quadro = [['Escala', escala], ['Formato', formato], ['Data', data]];
  quadro.forEach(([r, v], i) => { rot(x + 2 + i * terco, cy + 3.2, r); T(x + 2 + i * terco, cy + 8, v, 2.8, { bold: true }); if (i) L([[x + i * terco, cy], [x + i * terco, cy + 11]]); });
  cy += 11; L([[x, cy], [x + w, cy]]);
  rot(x + 2, cy + 3.2, 'Desenho nº'); T(x + 2, cy + 9.5, cfg.codigo || '—', 3.4, { bold: true });
  rot(meio + 10, cy + 3.2, 'Folha'); T(meio + 10, cy + 9.5, cfg.folha, 3.4, { bold: true });
  const revAtual = cfg.revisoes.at(-1)?.rev ?? '00';
  rot(x + w - 22, cy + 3.2, 'Revisão'); T(x + w - 22, cy + 9.5, revAtual, 3.4, { bold: true });
  L([[meio + 8, cy], [meio + 8, cy + 12]]); L([[x + w - 24, cy], [x + w - 24, cy + 12]]);
  cy += 12; L([[x, cy], [x + w, cy]]);
  T(x + 2, cy + 6, 'GeoPerfil', 2.4, { cor: CORES.azul, bold: true });

  // tabela de revisões (logo acima da identificação)
  const nLin = Math.max(cfg.revisoes.length, 4), rh = 5.5, cols = [0, 12, 34, w - 22, w];
  const ty1 = y + h - idH, ty0 = ty1 - (nLin + 1) * rh;
  L([[x, ty0], [x + w, ty0]], 0.4);
  ['Rev.', 'Data', 'Descrição', 'Por'].forEach((c, i) => rot(x + cols[i] + 1.5, ty0 + rh - 1.6, c));
  for (let i = 1; i <= nLin; i++) L([[x, ty0 + i * rh], [x + w, ty0 + i * rh]], 0.15);
  cols.slice(1, -1).forEach((cx) => L([[x + cx, ty0], [x + cx, ty1]], 0.15));
  // a mais recente fica embaixo, junto do carimbo
  cfg.revisoes.slice(-nLin).forEach((r, i) => {
    const ly = ty0 + (nLin - Math.min(cfg.revisoes.length, nLin) + i + 1) * rh + rh - 1.6;
    T(x + cols[0] + 1.5, ly, r.rev, 2); T(x + cols[1] + 1.5, ly, r.data, 2);
    T(x + cols[2] + 1.5, ly, quebrar(r.descricao, cols[3] - cols[2] - 3, 2)[0] || '', 2); T(x + cols[3] + 1.5, ly, r.por, 2);
  });
  return itens;
}

/**
 * Monta a prancha.
 * @param projeto projeto v2
 * @param perfis [{ corte, bhs, geo? }] na ordem em que entram na folha
 * @param opcoes { estilo, data }
 * @returns { itens, formato: [W, H], escala, exagero, cabe }
 */
export function montarPrancha(projeto, perfis, { estilo, data = new Date() } = {}) {
  const cfg = pranchaPadrao(projeto.projeto?.prancha || {});
  const [W, H] = FORMATOS[cfg.formato];
  const M = 10, carW = cfg.formato === 'A3' ? 120 : 175;
  const area = { x: M + 10, y: M + 8, w: W - 2 * M - carW - 20, h: H - 2 * M - 16 };
  const bandaH = Math.min(150, area.h * (cfg.formato === 'A3' ? 0.34 : 0.3)); // planta-chave, notas e legenda
  const perfH = area.h - bandaH - 8;
  const usados = perfis.filter((p) => p.bhs.length >= 2).map((p) => ({ ...p, geo: p.geo || geometriaPerfil(p.bhs, { ajustes: p.corte.ajustes || {}, modo: p.corte.modo || 'interpolado' }) }));
  const cfgP = projeto.projeto || {};

  // a menor escala padrão em que todos os perfis cabem
  let escolha = null;
  for (const E of ESCALAS) {
    const desenhos = usados.map((p) => perfilNaEscala(p, E, cfg.exagero, estilo, cfgP));
    // na ordem escolhida; se não couber, do mais largo para o mais estreito
    let lay = empacotar(desenhos, area.w, perfH), ordem = desenhos;
    if (!lay) { ordem = [...desenhos].sort((a, b) => b.w - a.w); lay = empacotar(ordem, area.w, perfH); }
    if (lay) { escolha = { E, desenhos: ordem, lay }; break; }
  }
  const itens = [];
  // moldura
  itens.push({ t: 'poli', pts: [[M, M], [W - M, M], [W - M, H - M], [M, H - M]], fill: null, stroke: CORES.tinta, lw: 0.7, camada: 'MOLDURA' });
  if (escolha) {
    const { lay, desenhos } = escolha;
    // centraliza o conjunto na faixa dos perfis
    const largUsada = Math.max(...desenhos.map((d, i) => lay.pos[i][0] + d.w));
    const ox = area.x + (area.w - largUsada) / 2, oy = area.y + Math.max(0, (perfH - lay.altura) / 2);
    desenhos.forEach((d, i) => itens.push(...deslocar(d.itens, ox + lay.pos[i][0] - d.caixa[0], oy + lay.pos[i][1] - d.caixa[1])));
  }
  // banda de baixo: planta-chave | notas + legenda
  const by = area.y + area.h - bandaH, pw = Math.min(area.w * 0.42, bandaH * 1.6);
  itens.push({ t: 'linha', pts: [[area.x, by - 4], [area.x + area.w, by - 4]], cor: CORES.grade, lw: 0.2, camada: 'MOLDURA' });
  itens.push(...plantaChave(projeto, usados.map((p) => p.corte), area.x, by, pw, bandaH));
  const nx = area.x + pw + 14, nw = area.x + area.w - nx;
  const nt = notas(cfg.notas, nx, by + 6, Math.min(nw, 230));
  itens.push(...nt.itens);
  // legenda: união das legendas dos perfis (sem repetir)
  const vistas = new Set(), entradas = [];
  usados.forEach((p) => legendaPerfil(p.bhs, p.geo, { estilo, naProjeto: cfgP.naProjeto, referencias: cfgP.referencias || [], mostrar: { na: true } })
    .forEach((e) => { if (!vistas.has(e.texto)) { vistas.add(e.texto); entradas.push(e); } }));
  if (entradas.length) itens.push(...desenharLegenda(entradas, { x: nx, y: by + 6 + nt.altura + 4, largura: Math.min(nw, 230), mm: 1, hachura: estilo.hachura }).itens);

  const dataTxt = data.toLocaleDateString('pt-BR');
  const escTxt = escolha ? (cfg.exagero > 1 ? `H 1:${escolha.E} V 1:${escolha.E / cfg.exagero}` : `1:${escolha.E}`) : 'indicada';
  itens.push(...carimbo(cfg, projeto, { x: W - M - carW, y: M, w: carW, h: H - 2 * M, escala: escTxt, formato: cfg.formato, data: dataTxt }));
  return { itens, formato: [W, H], escala: escolha?.E ?? null, exagero: cfg.exagero, cabe: !!escolha || !usados.length, nPerfis: usados.length,
    materiais: [...new Set(usados.flatMap((p) => p.geo.poligonos.map((q) => camadaMaterial(q.solo, q.sec))))] };
}

export { fmt as _fmt, caixaDe };
