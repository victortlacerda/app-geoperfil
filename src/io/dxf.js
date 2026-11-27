// Exportação DXF (AutoCAD 2007, AC1021): perfil do corte ativo no padrão de prancha
// + planta de locação.
//
// O perfil sai do mesmo desenho da tela e do PDF (geo/desenho.js), com:
// - uma camada (layer) por material, com HATCH sólido na cor do material;
// - contatos, terreno e NA em LWPOLYLINE (as curvas do modo Suave ficam lisas);
// - cada furo como BLOCO com atributos (NOME, NSPT_01…, REC_01…), editáveis no CAD;
// - textos no estilo ROMANS (romans.shx), acentos preservados (DXF 2007 é UTF-8).
//
// Unidades: X em metros reais; Y com o exagero vertical (1 m de cota = Eh/Ev
// unidades). Textos e símbolos dimensionados para plotar o modelo em 1:Eh.
import {
  DxfWriter, point3d, HatchBoundaryPaths, HatchPolylineBoundary, vertex, pattern, HatchPredefinedPatterns,
  Units, TextHorizontalAlignment, TextVerticalAlignment, aciHex,
} from '@tarikjabiri/dxf';
import { geometriaPerfil } from '../geo/perfil2d.js';
import { desenharPerfil, desenharLegenda, legendaPerfil, caixaDe, camadaMaterial } from '../geo/desenho.js';
import { estiloPadrao, resolverFuro } from '../model/projeto.js';
import { escalaPadrao, escalasPerfil, folgaPerfil } from './escalas.js';
import { hachuraPoligono } from './hachura.js';
import { deslocar } from '../geo/prancha.js';

export const ESTILO = 'ROMANS';
const fmt = (v, d = 2) => v.toFixed(d).replace('.', ',');

// ── cores ──
const rgb = (hex) => {
  const h = String(hex || '#000000').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const corVerdadeira = (hex) => { const [r, g, b] = rgb(hex); return (r << 16) | (g << 8) | b; };
const ACI = Array.from({ length: 255 }, (_, i) => [i + 1, rgb(aciHex(i + 1))]);
/** Cor ACI mais próxima (o layer leva a ACI e a cor verdadeira). */
export function aciProxima(hex) {
  const [r, g, b] = rgb(hex);
  if (Math.max(r, g, b) - Math.min(r, g, b) < 12 && r < 40) return 7; // preto/tinta → branco/preto do CAD
  let melhor = 7, dm = Infinity;
  ACI.forEach(([i, [R, G, B]]) => { if (i === 7) return; const d = (R - r) ** 2 + (G - g) ** 2 + (B - b) ** 2; if (d < dm) { dm = d; melhor = i; } });
  return melhor;
}

// camadas de desenho (não materiais): cor ACI padrão
const CAMADAS = {
  'PERFIL-GRADE': 8, 'PERFIL-EIXOS': 7, CONTATOS: 7, TERRENO: 7, NA: 5, 'NA-PROJETO': 4, REFERENCIAS: 7, 'TOPO-ROCHOSO': 1,
  BLOCOS: 8, ROTULOS: 7, SONDAGEM: 7, CORTE: 5, TITULO: 7, LEGENDA: 7, HACHURA: 8, PLANTA: 7, 'PLANTA-FUROS': 7, 'PLANTA-CORTES': 1,
  MOLDURA: 7, CARIMBO: 7, NOTAS: 7, 'ORIGEM-NAO-INFORMADA': 30,
};
const nomeCamada = (n) => String(n || '0').replace(/[<>/\\":;?*|=`,]/g, ' ').trim() || '0';

/**
 * Escreve itens de geo/desenho.js (y para baixo) num DxfWriter (y para cima).
 * Itens com `grupo` viram um bloco por grupo, inserido no ponto `base[grupo]`;
 * textos com `atrib` viram ATTDEF no bloco e ATTRIB no INSERT.
 */
export function emitir(w, itens, { mm, base = {}, camadasMat = new Set() }) {
  const camada = (nome, cor) => {
    const n = nomeCamada(nome);
    if (!w.layer(n)) {
      const ly = w.addLayer(n, cor ? aciProxima(cor) : (CAMADAS[n] ?? 7), 'CONTINUOUS');
      if (cor) ly.trueColor = corVerdadeira(cor);
    }
    return n;
  };
  const tc = (hex, ly) => {
    // a cor do item vai como cor verdadeira só quando difere da cor do layer
    if (!hex || camadasMat.has(ly)) return {};
    const [r, g, b] = rgb(hex);
    return r < 40 && g < 40 && b < 40 ? {} : { trueColor: String(corVerdadeira(hex)) };
  };
  const tipoLinha = (dash) => (dash ? 'TRACEJADA' : undefined);

  const desenhar = (alvo, it, dx, dy) => {
    const P = ([x, y]) => [x - dx, -(y - dy)];
    if (it.t === 'poli') {
      if (it.pts.length < 3) return;
      const pts = it.pts.map(P);
      if (it.fill && it.fill !== '#ffffff' && it.fill !== '#fff') {
        const ly = camada(it.camada, camadasMat.has(nomeCamada(it.camada)) ? it.fill : null);
        const bp = new HatchBoundaryPaths();
        bp.addPolylineBoundary(new HatchPolylineBoundary(pts.map(([x, y]) => vertex(x, y))));
        alvo.addHatch(bp, pattern({ name: HatchPredefinedPatterns.SOLID }), { layerName: ly, ...(camadasMat.has(ly) ? {} : { trueColor: String(corVerdadeira(it.fill)) }) });
      }
      if (it.hachura) {
        const { linhas, pontos } = hachuraPoligono(pts, it.hachura.solo, it.hachura.sec, 1.3 * mm);
        const ly = camada('HACHURA');
        linhas.forEach(([a, b, c, d]) => alvo.addLine(point3d(a, b), point3d(c, d), { layerName: ly }));
        pontos.forEach(([x, y]) => alvo.addCircle(point3d(x, y), 0.14 * mm, { layerName: ly }));
      }
      if (it.stroke || (it.fill === '#ffffff' || it.fill === '#fff')) {
        const ly = camada(it.camada === undefined ? '0' : (camadasMat.has(nomeCamada(it.camada)) ? 'CONTATOS' : it.camada));
        alvo.addLWPolyline(pts.map(([x, y]) => ({ point: { x, y } })), { layerName: ly, flags: 1, ...tc(it.stroke, ly) });
      }
    } else if (it.t === 'linha') {
      if (it.pts.length < 2) return;
      const ly = camada(it.camada);
      const pts = it.pts.map(P), lt = tipoLinha(it.dash);
      if (pts.length === 2) alvo.addLine(point3d(...pts[0]), point3d(...pts[1]), { layerName: ly, ...tc(it.cor, ly), ...(lt ? { lineType: lt } : {}) });
      else alvo.addLWPolyline(pts.map(([x, y]) => ({ point: { x, y } })), { layerName: ly, ...tc(it.cor, ly), ...(lt ? { lineType: lt } : {}) });
    }
  };
  const textoOpc = (it, ly, x, y) => ({
    layerName: ly, ...tc(it.cor, ly), rotation: it.ang || 0,
    horizontalAlignment: it.al === 'r' ? TextHorizontalAlignment.Right : it.al === 'c' ? TextHorizontalAlignment.Center : TextHorizontalAlignment.Left,
    verticalAlignment: it.vb === 'meio' ? TextVerticalAlignment.Middle : TextVerticalAlignment.BaseLine,
    secondAlignmentPoint: point3d(x, y),
  });
  const altura = (it) => it.h * 0.72 * mm; // corpo da letra (PDF) → altura das maiúsculas (CAD)

  // fora dos grupos: direto no model space
  itens.filter((it) => !it.grupo).forEach((it) => {
    if (it.t !== 'texto') return desenhar(w, it, 0, 0);
    const ly = camada(it.camada), x = it.x, y = -it.y;
    const t = w.addText(point3d(x, y), altura(it), it.txt, textoOpc(it, ly, x, y));
    t.textStyle = ESTILO;
  });

  // grupos (furos): bloco com atributos
  const grupos = new Map();
  itens.filter((it) => it.grupo).forEach((it) => { if (!grupos.has(it.grupo)) grupos.set(it.grupo, []); grupos.get(it.grupo).push(it); });
  grupos.forEach((lista, grupo) => {
    const [bx, by] = base[grupo] || [lista[0].x ?? lista[0].pts[0][0], lista[0].y ?? lista[0].pts[0][1]];
    const nome = nomeCamada(grupo.replace(/^FURO:/, '')).replace(/\s+/g, '_');
    const blk = w.addBlock(nome);
    const atribs = [];
    lista.forEach((it) => {
      if (it.t !== 'texto') return desenhar(blk, it, bx, by);
      const ly = camada(it.camada), x = it.x - bx, y = -(it.y - by);
      if (it.atrib) {
        const a = blk.addAttdef(point3d(x, y), altura(it), it.atrib, it.txt, textoOpc(it, ly, x, y));
        a.textStyle = ESTILO;
        atribs.push(it);
      } else { const t = blk.addText(point3d(x, y), altura(it), it.txt, textoOpc(it, ly, x, y)); t.textStyle = ESTILO; }
    });
    const ins = w.addInsert(blk.name, point3d(bx, -by), { layerName: camada('SONDAGEM') });
    atribs.forEach((it) => {
      const ly = camada(it.camada), x = it.x, y = -it.y;
      const a = w.addAttrib(point3d(x, y), altura(it), it.atrib, it.txt, ins, textoOpc(it, ly, x, y));
      a.textStyle = ESTILO;
    });
  });
}

/**
 * Gera o texto DXF.
 * @param projeto projeto v2
 * @param perfil { bhs, corte, geo } — do corte ativo, ou bhs vazio
 * @param axis 'cota' | 'prof'
 */
export function gerarDXF(projeto, perfil, axis = 'cota') {
  const w = new DxfWriter();
  w.setUnits(Units.Meters);
  const st = w.tables.addStyle(ESTILO); st.fontFileName = 'romans.shx';
  const { bhs = [], corte = null } = perfil || {};
  const temPerfil = bhs.length >= 2;
  const estilo = estiloPadrao(projeto.projeto?.estilo || {});
  let topoPerfil = 0, u = 0.1;

  if (temPerfil) {
    const geo = perfil.geo || geometriaPerfil(bhs, { ajustes: corte?.ajustes || {}, modo: corte?.modo || 'interpolado' });
    const { Eh, Ev, exagero, passoC, cTopo, cBase } = escalasPerfil(geo, bhs);
    u = Eh / 1000; // unidades do modelo por mm de papel
    const kv = Eh / Ev, fol = folgaPerfil(geo.totDist);
    w.addLType('TRACEJADA', '__ __ __', [3 * u, -1.5 * u]);
    const X = (d) => d, Y = (c) => (cTopo - c) * kv; // y para baixo, como no papel
    const cfg = projeto.projeto || {};
    const { itens } = desenharPerfil({
      bhs, geo, corte, estilo, axis, X, Y, mm: u, cTopo, passoC,
      janela: { d0: -fol, d1: geo.totDist + fol, c0: cBase, c1: cTopo },
      mostrar: { na: true, spt: true, rotulos: estilo.rotulos, hachura: estilo.hachura },
      naProjeto: cfg.naProjeto, referencias: cfg.referencias || [],
      titulo: { texto: `PERFIL ${corte?.nome || ''}`.trim(), sub: `ESC. H 1:${Eh} · V 1:${Ev}${exagero > 1 ? ` (exagero ${fmt(exagero, exagero % 1 ? 1 : 0)}×)` : ''} · plotar em 1:${Eh}` },
    });
    const caixa = caixaDe(itens, u);
    const entradas = legendaPerfil(bhs, geo, { estilo, naProjeto: cfg.naProjeto, referencias: cfg.referencias || [], mostrar: { na: true } });
    const leg = desenharLegenda(entradas, { x: caixa[0], y: caixa[3] + 8 * u, largura: Math.max(caixa[2] - caixa[0], 200 * u), mm: u, hachura: estilo.hachura });
    // um layer por material, com a cor do material (as amostras da legenda também)
    const camadasMat = new Set(geo.poligonos.map((p) => nomeCamada(camadaMaterial(p.solo, p.sec))));
    // ponto de inserção de cada furo: topo do furo
    const base = Object.fromEntries(bhs.map((b) => [`FURO:${b.name}`, [X(b.dist), Y(b.cota)]]));
    emitir(w, [...itens, ...leg.itens], { mm: u, base, camadasMat });
    topoPerfil = -caixa[1];
  }

  // ── PLANTA ── em metros reais, deslocada para ficar acima do perfil; o deslocamento vai anotado.
  const furos = projeto.furos.map(resolverFuro);
  if (furos.length) {
    const xs = [...furos.map((b) => b.x), ...projeto.cortes.flatMap((c) => [c.p1[0], c.p2[0]])];
    const ys = [...furos.map((b) => b.y), ...projeto.cortes.flatMap((c) => [c.p1[1], c.p2[1]])];
    const extP = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
    const up = escalaPadrao(extP * 1.2, 250) / 1000, pm = (v) => v * up;
    const dX = -Math.min(...xs), dY = (temPerfil ? topoPerfil + u * 30 : 0) + pm(12) - Math.min(...ys);
    const T = (x, y) => [x + dX, y + dY];
    const topo = Math.max(...ys) + dY;
    ['PLANTA', 'PLANTA-FUROS', 'PLANTA-CORTES'].forEach((n) => { if (!w.layer(n)) w.addLayer(n, CAMADAS[n], 'CONTINUOUS'); });
    const texto = (t, x, y, h, ly, al = 'l') => {
      const o = { layerName: ly, horizontalAlignment: al === 'c' ? TextHorizontalAlignment.Center : TextHorizontalAlignment.Left, verticalAlignment: al === 'c' ? TextVerticalAlignment.Middle : TextVerticalAlignment.BaseLine, secondAlignmentPoint: point3d(x, y) };
      w.addText(point3d(x, y), h, t, o).textStyle = ESTILO;
    };
    texto('PLANTA DE LOCAÇÃO', 0, topo + pm(14), pm(3.5), 'PLANTA');
    texto(`Coordenadas deslocadas: X real = X ${dX >= 0 ? '−' : '+'} ${Math.abs(dX).toFixed(3)} ; Y real = Y ${dY >= 0 ? '−' : '+'} ${Math.abs(dY).toFixed(3)}. Textos para plotar em 1:${Math.round(up * 1000)}.`, 0, topo + pm(9), pm(2), 'PLANTA');
    furos.forEach((b) => {
      const [x, y] = T(b.x, b.y);
      w.addCircle(point3d(x, y), pm(1.2), { layerName: 'PLANTA-FUROS' });
      texto(b.name, x + pm(2), y + pm(0.6), pm(2.2), 'PLANTA-FUROS');
      if (b.cota) texto(`${fmt(b.cota)} m`, x + pm(2), y - pm(2.6), pm(1.8), 'PLANTA-FUROS');
    });
    projeto.cortes.forEach((c) => {
      const [x1, y1] = T(...c.p1), [x2, y2] = T(...c.p2);
      w.addLine(point3d(x1, y1), point3d(x2, y2), { layerName: 'PLANTA-CORTES' });
      const [n1, n2] = c.nome.split('–');
      const len = Math.hypot(x2 - x1, y2 - y1) || 1, nx = (x2 - x1) / len, ny = (y2 - y1) / len;
      const px = -ny * c.lado, py = nx * c.lado;
      texto(n1 || 'A', x1 - nx * pm(4), y1 - ny * pm(4), pm(3), 'PLANTA-CORTES', 'c');
      texto(n2 || "A'", x2 + nx * pm(4), y2 + ny * pm(4), pm(3), 'PLANTA-CORTES', 'c');
      [[x1, y1], [x2, y2]].forEach(([x, y]) => w.addLine(point3d(x, y), point3d(x + px * pm(5), y + py * pm(5)), { layerName: 'PLANTA-CORTES' }));
    });
  }
  return seqendUnico(w.stringify());
}

/**
 * DXF da prancha (A0 a A3) em milímetros, 1:1: os itens de geo/prancha.js.
 * Cada perfil leva sua escala no título; um layer por material com hatch sólido.
 */
export function gerarPranchaDXF(prancha, materiais = []) {
  const w = new DxfWriter();
  w.setUnits(Units.Millimeters);
  const st = w.tables.addStyle(ESTILO); st.fontFileName = 'romans.shx';
  w.addLType('TRACEJADA', '__ __ __', [3, -1.5]);
  const camadasMat = new Set(materiais.map(nomeCamada));
  // origem no canto inferior esquerdo da folha
  emitir(w, deslocar(prancha.itens, 0, -prancha.formato[1]), { mm: 1, camadasMat });
  return seqendUnico(w.stringify());
}

/**
 * A biblioteca escreve um SEQEND depois de cada ATTRIB; o DXF pede um só, no fim
 * dos atributos do INSERT. Tira os SEQEND que têm outro ATTRIB logo depois.
 */
export function seqendUnico(txt) {
  const ls = txt.split('\n');
  const ents = []; // [início, fim) de cada objeto (grupo 0)
  for (let i = 0; i + 1 < ls.length; i += 2) if (ls[i].trim() === '0') ents.push(i);
  const fora = new Set();
  for (let k = 0; k + 1 < ents.length; k++) {
    if (ls[ents[k] + 1] === 'SEQEND' && ls[ents[k + 1] + 1] === 'ATTRIB' && k > 0 && ls[ents[k - 1] + 1] === 'ATTRIB') fora.add(k);
  }
  if (!fora.size) return txt;
  const out = [];
  ents.forEach((ini, k) => { if (!fora.has(k)) out.push(...ls.slice(ini, k + 1 < ents.length ? ents[k + 1] : ls.length)); });
  return ls.slice(0, ents[0]).concat(out).join('\n');
}
