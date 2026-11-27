// Aba Modelo 3D (three.js): bloco geológico sólido interpolado a partir dos furos,
// com superfície do terreno, camadas empilhadas, paredes de solo nas bordas, NA,
// furos e um corte vertical no alinhamento do corte ativo (deslocável).
// Carregado sob demanda (import dinâmico) para não pesar nas outras abas.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { modeloBloco, linhaNoDominio } from '../geo/bloco3d.js';
import { niceStep } from '../geo/zonas.js';
import { sptPorMetro, sptTextos, profMax, resolverFuro } from '../model/projeto.js';
import { camadasDesenho } from '../geo/horizontes.js';
import { solo, secLabel } from '../model/catalogo.js';
import { NA_COR } from '../styles/tema.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (v, d = 1) => v.toFixed(d).replace('.', ',');
/**
 * Cor da classificação no 3D: a mesma cor do projeto, mais saturada e um pouco
 * mais escura. As cores claras (ARGS, SAR, AREA…) ficariam todas cinza com a luz.
 */
export function cor3D(code) {
  const c = new THREE.Color(solo(code).fill), hsl = {};
  c.getHSL(hsl);
  const l = hsl.l > 0.45 ? 0.45 + (hsl.l - 0.45) * 0.62 : hsl.l;
  return c.setHSL(hsl.h, Math.min(1, hsl.s * 1.1 + 0.08), l);
}
const GRAMA = 0x8fa66b, BASE = 0x8a8278, LINHA = 0x2b2b2b, AZUL = 0x1566d1;

export function criarModelo3D(app) {
  const porHorizonte = () => app.store.doc.projeto.estilo?.cor === 'horizonte';
  const wrap = document.getElementById('cena3d');
  const o = app.ui.m3d;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  } catch {
    wrap.innerHTML = '<div class="empty">Este navegador não conseguiu iniciar o WebGL, necessário para o modelo 3D.</div>';
    return { render() {}, capturar() {}, ajustar() {}, vista() {}, definirExagero() {}, reenquadrar() {}, estado: () => ({}) };
  }
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.localClippingEnabled = true;
  renderer.setClearColor(0xeef2f6);
  wrap.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  // como num CAD: botão esquerdo move (pan), botão do meio (rodinha pressionada) gira, rodinha dá zoom
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.screenSpacePanning = true;
  controls.zoomToCursor = true; // o zoom vai na direção do cursor
  // evita a rolagem automática do navegador ao apertar a rodinha
  renderer.domElement.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
  scene.add(new THREE.HemisphereLight(0xf2f6fb, 0x7d6f5c, 1.7));
  const sol = new THREE.DirectionalLight(0xffffff, 1.9);
  sol.position.set(0.55, 1, 0.35);
  scene.add(sol);
  const contraluz = new THREE.DirectionalLight(0xffffff, 0.5);
  contraluz.position.set(-0.6, 0.3, -0.8);
  scene.add(contraluz);

  const raiz = new THREE.Group(); // geometria em metros, com o eixo vertical exagerado
  const rotulos = new THREE.Group(); // textos (não sofrem o exagero)
  scene.add(raiz, rotulos);
  const plano = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
  const materiais = new Map();
  let ref = { cx: 0, cy: 0, c0: 0, diag: 100 };
  let modelo = null, docModelo = null, corteInfo = null;
  let precisaEnquadrar = true;
  let ativo = false, animando = false;

  // coordenadas reais → cena (x = Leste, y = cota, z = −Norte)
  const P = (x, y, c) => new THREE.Vector3(x - ref.cx, c - ref.c0, -(y - ref.cy));
  const cortando = () => o.cortar && corteInfo;
  const clip = (tipo) => (tipo === 'm' && cortando() ? [plano] : []);

  /** Material por classificação; tipo 'm' = bloco (cortado pelo plano), 's' = face do corte. */
  function material(code, tipo = 'm') {
    const k = `${code}|${tipo}`;
    if (!materiais.has(k)) {
      const grama = code === '_grama';
      materiais.set(k, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.92, metalness: 0, polygonOffset: grama, polygonOffsetFactor: grama ? -2 : 0, polygonOffsetUnits: grama ? -2 : 0 }));
    }
    const m = materiais.get(k);
    m.color.set(code === '_grama' ? GRAMA : code === '_base' ? BASE : cor3D(code));
    m.emissive.set(code === '_base' ? 0x2e2a26 : 0x000000);
    const op = code === '_base' ? 1 : (code === '_grama' ? 1 : o.opacidade[code] ?? 1) * (o.raiox && tipo === 'm' ? 0.28 : 1);
    m.opacity = op; m.transparent = op < 1; m.depthWrite = op >= 1;
    m.clippingPlanes = clip(tipo);
    m.needsUpdate = true;
    return m;
  }
  const atualizarMateriais = () => materiais.forEach((m, k) => { const [code, tipo] = k.split('|'); material(code, tipo); });

  function limpar(g) {
    g.traverse((obj) => {
      obj.geometry?.dispose();
      if (obj.material && ![...materiais.values()].includes(obj.material)) { obj.material.map?.dispose(); obj.material.dispose(); }
    });
    g.clear();
  }

  function malha(pos, idx, mat, info, suave = true) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (idx) g.setIndex(idx);
    if (suave) g.computeVertexNormals();
    else { const n = g.toNonIndexed(); n.computeVertexNormals(); g.dispose(); return comInfo(new THREE.Mesh(n, mat), info); }
    return comInfo(new THREE.Mesh(g, mat), info);
  }
  function comInfo(mesh, info) { Object.assign(mesh.userData, info); if (info?.code) mesh.visible = !o.ocultos.has(info.code); return mesh; }
  function linha(pts, cor, tipo = 'm', opac = 0.75) {
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    return new THREE.Line(g, new THREE.LineBasicMaterial({ color: cor, transparent: opac < 1, opacity: opac, clippingPlanes: clip(tipo) }));
  }

  function texto(msg, { tamanho = 1, cor = '#111', fundo = 'rgba(255,255,255,0.88)', negrito = true } = {}) {
    const c = document.createElement('canvas'), ctx = c.getContext('2d'), px = 48;
    ctx.font = `${negrito ? '700' : '500'} ${px}px system-ui, sans-serif`;
    const w = Math.ceil(ctx.measureText(msg).width) + 24;
    c.width = w; c.height = px + 20;
    ctx.font = `${negrito ? '700' : '500'} ${px}px system-ui, sans-serif`;
    if (fundo) { ctx.fillStyle = fundo; ctx.beginPath(); ctx.roundRect(0, 0, w, c.height, 14); ctx.fill(); }
    ctx.fillStyle = cor; ctx.textBaseline = 'middle'; ctx.fillText(msg, 12, c.height / 2 + 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    const h = ref.diag * 0.022 * tamanho;
    sp.scale.set((h * w) / c.height, h, 1);
    sp.renderOrder = 10;
    return sp;
  }
  const rotulo = (sp, x, y, c, acima = 0) => { sp.userData.base = P(x, y, c); sp.userData.acima = acima; rotulos.add(sp); return sp; };
  function posicionarRotulos() {
    rotulos.children.forEach((sp) => { const b = sp.userData.base; sp.position.set(b.x, b.y * o.exagero + (sp.userData.acima || 0), b.z); });
  }

  // ── bloco ──
  function construirBloco(m) {
    const { nx, ny, xs, ys, contatos, unidades } = m;
    const nU = unidades.length, N1 = nx + 1, k = (i, j) => j * N1 + i;
    const eps = 1e-3;
    const posGrade = (sup) => {
      const pos = new Float32Array(N1 * (ny + 1) * 3);
      for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) { const v = P(xs[i], ys[j], sup[k(i, j)]); pos.set([v.x, v.y, v.z], k(i, j) * 3); }
      return pos;
    };
    // contorno do retângulo, no sentido anti-horário visto de cima
    const borda = [];
    for (let i = 0; i <= nx; i++) borda.push([i, 0]);
    for (let j = 1; j <= ny; j++) borda.push([nx, j]);
    for (let i = nx - 1; i >= 0; i--) borda.push([i, ny]);
    for (let j = ny - 1; j >= 0; j--) borda.push([0, j]);

    unidades.forEach((u, n) => {
      const topo = contatos[n], base = contatos[n + 1], esp = (q) => topo[q] - base[q];
      const info = { code: u.codigo, origem: u.origem };
      // superfície de topo da unidade (onde ela tem espessura)
      const idx = [];
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const a = k(i, j), b = k(i + 1, j), c = k(i, j + 1), d = k(i + 1, j + 1);
        if (Math.max(esp(a), esp(b), esp(c)) > eps) idx.push(a, c, b);
        if (Math.max(esp(b), esp(c), esp(d)) > eps) idx.push(b, c, d);
      }
      if (idx.length) raiz.add(malha(posGrade(topo), idx, material(u.codigo), info));
      // paredes nas bordas do bloco
      const pos = [];
      for (let s = 0; s < borda.length - 1; s++) {
        const [ia, ja] = borda[s], [ib, jb] = borda[s + 1], qa = k(ia, ja), qb = k(ib, jb);
        if (esp(qa) <= eps && esp(qb) <= eps) continue;
        const A1 = P(xs[ia], ys[ja], topo[qa]), A2 = P(xs[ia], ys[ja], base[qa]), B1 = P(xs[ib], ys[jb], topo[qb]), B2 = P(xs[ib], ys[jb], base[qb]);
        pos.push(...A1.toArray(), ...A2.toArray(), ...B1.toArray(), ...B1.toArray(), ...A2.toArray(), ...B2.toArray());
      }
      if (pos.length) raiz.add(malha(pos, null, material(u.codigo), info, false));
      // linha do contato inferior nas paredes
      raiz.add(linha(borda.map(([i, j]) => P(xs[i], ys[j], base[k(i, j)])), LINHA, 'm', 0.45));
    });
    raiz.add(linha(borda.map(([i, j]) => P(xs[i], ys[j], contatos[0][k(i, j)])), LINHA, 'm', 0.6));
    // grama: cobre o terreno todo (some quando alguma camada é escondida, para ver as de baixo)
    if (o.grama && !o.ocultos.size) {
      const idx = [];
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) idx.push(k(i, j), k(i, j + 1), k(i + 1, j), k(i + 1, j), k(i, j + 1), k(i + 1, j + 1));
      raiz.add(malha(posGrade(contatos[0]), idx, material('_grama'), { grama: true }));
    }
    // fundo do modelo
    const fundoIdx = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) fundoIdx.push(k(i, j), k(i + 1, j), k(i, j + 1), k(i + 1, j), k(i + 1, j + 1), k(i, j + 1));
    raiz.add(malha(posGrade(contatos[nU]), fundoIdx, material('_base'), { base: true }));

    // nível d'água: superfície translúcida e linha nas paredes
    if (o.na && m.na) {
      const idx = [];
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const a = k(i, j), b = k(i + 1, j), c = k(i, j + 1), d = k(i + 1, j + 1);
        const seco = (q) => m.na[q] >= contatos[0][q] - 1e-3 || m.na[q] <= contatos[nU][q];
        if (!(seco(a) && seco(b) && seco(c))) idx.push(a, c, b);
        if (!(seco(b) && seco(c) && seco(d))) idx.push(b, c, d);
      }
      const mat = new THREE.MeshStandardMaterial({ color: NA_COR, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false, clippingPlanes: clip('m') });
      raiz.add(malha(posGrade(m.na), idx, mat, { na: true }));
      raiz.add(linha(borda.map(([i, j]) => P(xs[i], ys[j], m.na[k(i, j)])), AZUL, 'm', 0.95));
    }

    // níveis de projeto (os mesmos do Perfil 2D): NA de projeto e linhas de referência,
    // como planos horizontais dentro do solo, com a linha nas paredes e o nome no canto
    niveisProjeto().forEach((nv) => {
      const dentro = (q) => nv.cota <= contatos[0][q] + 1e-6 && nv.cota >= contatos[nU][q] - 1e-6;
      const idx = [];
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const a = k(i, j), b = k(i + 1, j), c = k(i, j + 1), d = k(i + 1, j + 1);
        if (dentro(a) || dentro(b) || dentro(c)) idx.push(a, c, b);
        if (dentro(b) || dentro(c) || dentro(d)) idx.push(b, c, d);
      }
      if (!idx.length) return;
      const plano = new Float32Array(N1 * (ny + 1)).fill(nv.cota);
      const mat = new THREE.MeshStandardMaterial({ color: nv.cor, transparent: true, opacity: nv.opac, side: THREE.DoubleSide, depthWrite: false, clippingPlanes: clip('m') });
      raiz.add(malha(posGrade(plano), idx, mat, { nivel: nv.nome }));
      // linha nas paredes, só onde o nível corta o solo
      let trecho = [];
      const fecha = () => { if (trecho.length > 1) raiz.add(linha(trecho, nv.cor, 'm', 1)); trecho = []; };
      borda.forEach(([i, j]) => { if (dentro(k(i, j))) trecho.push(P(xs[i], ys[j], nv.cota)); else fecha(); });
      fecha();
      const q0 = borda.find(([i, j]) => dentro(k(i, j)));
      if (q0) rotulo(texto(nv.rotulo, { tamanho: 0.75, cor: nv.corTexto }), xs[q0[0]], ys[q0[1]], nv.cota, 0.6);
    });
  }

  /** NA de projeto e linhas de referência do projeto (janela Desenho…). */
  function niveisProjeto() {
    const p = app.store.doc.projeto, lista = [];
    const f2 = (v) => v.toFixed(2).replace('.', ',');
    if (o.na && Number.isFinite(p.naProjeto)) lista.push({ nome: 'NA de projeto', cota: p.naProjeto, cor: '#00B4D8', corTexto: '#00799A', opac: 0.22, rotulo: `NA de projeto ${f2(p.naProjeto)}` });
    (p.referencias || []).forEach((rf) => { if (Number.isFinite(rf.cota)) lista.push({ nome: rf.nome, cota: rf.cota, cor: '#3a3a3a', corTexto: '#1a1a1a', opac: 0.12, rotulo: `${rf.nome} ${f2(rf.cota)}` }); });
    return lista;
  }

  // ── face do corte ──
  function construirFace(m, seg, corteId) {
    const [[xa, ya], [xb, yb]] = seg, L = Math.hypot(xb - xa, yb - ya);
    const n = Math.max(2, Math.round(L / (Math.max(m.dominio.x1 - m.dominio.x0, m.dominio.y1 - m.dominio.y0) / 240)));
    const ts = Array.from({ length: n + 1 }, (_, i) => i / n);
    // na linha do próprio corte: também nas colunas do perfil 2D, avaliado de forma
    // exata, para a face ser o perfil 2D (pontas de acunhamento, transições)
    if (corteId) m.colunas.filter((q) => q.corte === corteId).forEach((q) => ts.push(((q.x - xa) * (xb - xa) + (q.y - ya) * (yb - ya)) / (L * L)));
    ts.sort((a, b) => a - b);
    const am = ts.filter((t, i) => t >= 0 && t <= 1 && (i === 0 || t - ts[i - 1] > 1e-6)).map((t) => {
      const x = xa + (xb - xa) * t, y = ya + (yb - ya) * t;
      return { x, y, ...(corteId ? m.pontual(x, y) : m.naMalha(x, y)) };
    });
    const nA = am.length - 1;
    m.unidades.forEach((u, q) => {
      const pos = [];
      for (let i = 0; i < nA; i++) {
        const a = am[i], b = am[i + 1];
        if (a.contatos[q] - a.contatos[q + 1] <= 1e-3 && b.contatos[q] - b.contatos[q + 1] <= 1e-3) continue;
        const A1 = P(a.x, a.y, a.contatos[q]), A2 = P(a.x, a.y, a.contatos[q + 1]), B1 = P(b.x, b.y, b.contatos[q]), B2 = P(b.x, b.y, b.contatos[q + 1]);
        pos.push(...A1.toArray(), ...A2.toArray(), ...B1.toArray(), ...B1.toArray(), ...A2.toArray(), ...B2.toArray());
      }
      if (pos.length) raiz.add(malha(pos, null, material(u.codigo, 's'), { code: u.codigo, origem: u.origem, face: true }, false));
      raiz.add(linha(am.map((p) => P(p.x, p.y, p.contatos[q + 1])), LINHA, 's', 0.55));
    });
    raiz.add(linha(am.map((p) => P(p.x, p.y, p.contatos[0])), LINHA, 's', 0.9));
    if (o.na && m.na) raiz.add(linha(am.map((p) => P(p.x, p.y, p.na)), AZUL, 's', 1));
    // níveis de projeto também na face do corte, só dentro do solo
    niveisProjeto().forEach((nv) => {
      let trecho = [];
      const fecha = () => { if (trecho.length > 1) raiz.add(linha(trecho, nv.cor, 's', 1)); trecho = []; };
      am.forEach((p) => { if (nv.cota <= p.contatos[0] && nv.cota >= p.contatos.at(-1)) trecho.push(P(p.x, p.y, nv.cota)); else fecha(); });
      fecha();
    });
    return am;
  }

  /** Furo em cilindros por camada; `s` = desenhado na face do corte (não é cortado). */
  function colunaFuro(f, x, y, tipo, raio) {
    // as mesmas camadas do Perfil 2D (horizontes, blocos absorvidos)
    const des = camadasDesenho(resolverFuro(f).layers, { porHorizonte: porHorizonte() });
    // pedregulho / blocos: matacão cinza em volta do furo, como no 2D
    des.blocos.forEach((b) => {
      const h = b.ate - b.de; if (h <= 0) return;
      const pedra = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), material('H:PED', tipo));
      pedra.scale.set(Math.max(raio * 3.2, h * 0.8), h / 2, Math.max(raio * 2.6, h * 0.7));
      pedra.rotation.y = (f.nome.length * 0.7) % Math.PI;
      pedra.position.copy(P(x, y, f.cota - (b.de + b.ate) / 2));
      comInfo(pedra, { code: 'H:PED', origem: 'PED', furo: f.nome });
      raiz.add(pedra);
    });
    des.layers.forEach((c) => {
      const h = c.ate - c.de;
      if (h <= 0) return;
      const cil = new THREE.Mesh(new THREE.CylinderGeometry(raio, raio, h, 18), material(c.solo.code, tipo));
      cil.position.copy(P(x, y, f.cota - (c.de + c.ate) / 2));
      comInfo(cil, { code: c.solo.code, origem: c.sec, furo: f.nome });
      raiz.add(cil);
      raiz.add(linha([P(x, y, f.cota - c.ate), P(x, y, f.cota - c.ate)].map((v, i) => v.add(new THREE.Vector3(i ? raio * 1.6 : -raio * 1.6, 0, 0))), LINHA, tipo, 0.8));
    });
    // N-SPT só onde a régua está à vista: na face do corte ou com o bloco transparente
    if (o.spt && (tipo === 's' || o.raiox)) {
      const nn = sptPorMetro(f), t = sptTextos(f);
      Object.keys(t).forEach((m) => {
        const sp = texto(t[m], { tamanho: 0.45, cor: nn[m] >= 50 ? '#A32D2D' : '#111', negrito: false });
        sp.center.set(-0.2, 0.5);
        rotulo(sp, x, y, f.cota - (+m - 0.5));
      });
    }
  }

  function construir() {
    limpar(raiz); limpar(rotulos);
    const doc = app.store.doc, corte = app.corteAtivo();
    // o modelo usa os furos e o Perfil 2D de cada corte (com os contatos ajustados);
    // só é recalculado quando os dados mudam
    if (doc !== docModelo) { modelo = modeloBloco(doc.furos, { cortes: doc.cortes, porHorizonte: porHorizonte() }); docModelo = doc; }
    const info = document.getElementById('m3dInfo');
    if (!modelo) { corteInfo = null; info.textContent = 'Lance furos com camadas para ver o modelo.'; renderLegenda(); return; }
    const dom = modelo.dominio, nU = modelo.unidades.length;
    const cMin = Math.min(...modelo.contatos[nU]), cMax = Math.max(...modelo.contatos[0]);
    ref = { cx: (dom.x0 + dom.x1) / 2, cy: (dom.y0 + dom.y1) / 2, c0: cMin, diag: Math.hypot(dom.x1 - dom.x0, dom.y1 - dom.y0) };
    raiz.scale.set(1, o.exagero, 1);

    // corte: plano vertical na linha do corte, deslocado; fica o lado escolhido na planta
    corteInfo = null;
    const desl = document.getElementById('m3dDesl'), lim = Math.ceil(ref.diag / 2);
    if (+desl.max !== lim) { desl.min = -lim; desl.max = lim; }
    if (corte) {
      const [ax, ay] = corte.p1, [bx, by] = corte.p2, Lc = Math.hypot(bx - ax, by - ay) || 1;
      const u = [(bx - ax) / Lc, (by - ay) / Lc], lado = corte.lado || 1;
      // fica a metade do lado escolhido na planta (onde estão os furos do corte)
      const nrm = [-u[1] * lado, u[0] * lado];
      const d = o.deslocamento;
      const seg = linhaNoDominio([ax + nrm[0] * d, ay + nrm[1] * d], [bx + nrm[0] * d, by + nrm[1] * d], dom);
      if (seg) corteInfo = { corte, seg, u, nrm, d };
    }
    if (corteInfo) {
      const { seg, nrm } = corteInfo;
      plano.setFromNormalAndCoplanarPoint(new THREE.Vector3(nrm[0], 0, -nrm[1]).normalize(), P(seg[0][0], seg[0][1], ref.c0));
    }

    construirBloco(modelo);
    const raio = Math.max(0.3, ref.diag / 220);
    const dist = (f) => (corteInfo ? (f.x - corteInfo.seg[0][0]) * corteInfo.nrm[0] + (f.y - corteInfo.seg[0][1]) * corteInfo.nrm[1] : 0);

    // face do corte e furos projetados nela
    const naFace = new Set();
    if (corteInfo) {
      const { corte: c, seg, nrm, u, d } = corteInfo;
      if (cortando()) {
        construirFace(modelo, seg, d === 0 ? c.id : null);
        // no plano do corte: os furos do corte na posição projetada, como no Perfil 2D
        // (o modelo passa pelo perfil ali); com o plano deslocado, só os furos sobre ele
        const tol = Math.max(1, ref.diag * 0.01);
        const noPerfil = new Set(modelo.colunas.filter((q) => q.corte === c.id && q.furo).map((q) => q.furo));
        const projetar = d === 0 ? modelo.furos.filter((f) => noPerfil.has(f.id)) : modelo.furos.filter((f) => Math.abs(dist(f)) <= tol);
        if (o.furos) projetar.forEach((f) => {
          const t = (f.x - seg[0][0]) * u[0] + (f.y - seg[0][1]) * u[1];
          const x = seg[0][0] + u[0] * t - nrm[0] * raio * 1.1, y = seg[0][1] + u[1] * t - nrm[1] * raio * 1.1;
          naFace.add(f.id);
          colunaFuro(f, x, y, 's', raio);
          rotulo(texto(f.nome, { tamanho: 0.9 }), x, y, f.cota, ref.diag * 0.03);
          raiz.add(linha([P(x, y, f.cota), P(x, y, f.cota + (ref.diag * 0.025) / o.exagero)], LINHA, 's', 0.9));
        });
      } else {
        // sem cortar: a linha do corte desenhada sobre o terreno
        const n = 120, pts = [];
        for (let i = 0; i <= n; i++) {
          const x = seg[0][0] + ((seg[1][0] - seg[0][0]) * i) / n, y = seg[0][1] + ((seg[1][1] - seg[0][1]) * i) / n;
          pts.push(P(x, y, modelo.pontual(x, y).contatos[0] + (ref.diag * 0.002) / o.exagero));
        }
        raiz.add(linha(pts, AZUL, 's', 1));
      }
      const [n1, n2] = (c.nome || "A–A'").split('–');
      const ini = modelo.pontual(...seg[0]).contatos[0], fim = modelo.pontual(...seg[1]).contatos[0];
      rotulo(texto(n1 || 'A', { cor: '#1566D1', tamanho: 1.3 }), seg[0][0], seg[0][1], ini, ref.diag * 0.04);
      rotulo(texto(n2 || "A'", { cor: '#1566D1', tamanho: 1.3 }), seg[1][0], seg[1][1], fim, ref.diag * 0.04);
    }

    // furos no bloco (visíveis com transparência) e a haste com o nome acima do terreno
    if (o.furos) modelo.furos.forEach((f) => {
      if (naFace.has(f.id)) return;
      if (cortando() && dist(f) < 0) return; // do lado removido
      colunaFuro(f, f.x, f.y, 'm', raio);
      raiz.add(linha([P(f.x, f.y, f.cota), P(f.x, f.y, f.cota + (ref.diag * 0.025) / o.exagero)], LINHA, 'm', 0.9));
      rotulo(texto(f.nome, { tamanho: 0.9 }), f.x, f.y, f.cota, ref.diag * 0.03);
    });

    if (o.grade) referencias(modelo, cMin, cMax, cortando() ? corteInfo : null);
    posicionarRotulos();
    renderLegenda();
    const W = dom.x1 - dom.x0, D = dom.y1 - dom.y0;
    info.textContent = `${modelo.furos.length} furo(s) · bloco ${fmt(W, 0)} × ${fmt(D, 0)} m · ${nU} camada(s) correlacionada(s)` +
      (corte ? (corteInfo ? ` · corte ${corte.nome}` : ` · corte ${corte.nome} fora do bloco`) : '');
    if (o.vistaPendente) { const v = o.vistaPendente; o.vistaPendente = null; precisaEnquadrar = false; vista(v); }
    else if (precisaEnquadrar) { precisaEnquadrar = false; ajustar(); }
  }

  /** Régua de cotas num canto, coordenadas nos cantos e seta do norte. */
  function referencias(m, cMin, cMax, ci) {
    const { x1, y1 } = m.dominio, passo = niceStep((cMax - cMin) / 5 || 1);
    const ini = Math.floor(cMin / passo) * passo, fim = Math.ceil(cMax / passo) * passo;
    const tk = ref.diag * 0.012;
    // régua no canto do bloco (ou na ponta A da face do corte)
    const [x0, y0] = ci ? ci.seg[0] : [m.dominio.x0, m.dominio.y0];
    raiz.add(linha([P(x0, y0, ini), P(x0, y0, fim)], LINHA, 's', 0.8));
    for (let c = ini; c <= fim + 1e-9; c += passo) {
      raiz.add(linha([P(x0, y0, c), P(x0 - tk, y0 - tk, c)], LINHA, 's', 0.8));
      const sp = texto(fmt(c, passo < 1 ? 1 : 0), { tamanho: 0.7, negrito: false, fundo: null, cor: '#333' });
      sp.center.set(1.1, 0.5);
      rotulo(sp, x0 - tk, y0 - tk, c);
    }
    const sp = texto('Cota (m)', { tamanho: 0.7, fundo: null, cor: '#333' });
    sp.center.set(1.05, -0.4);
    rotulo(sp, x0 - tk, y0 - tk, fim);
    [[m.dominio.x0, m.dominio.y0], [x1, y1]].filter(([x, y]) => !ci || (x - ci.seg[0][0]) * ci.nrm[0] + (y - ci.seg[0][1]) * ci.nrm[1] >= -1e-6).forEach(([x, y]) => {
      const t = texto(`E ${fmt(x, 0)}  N ${fmt(y, 0)}`, { tamanho: 0.65, negrito: false, fundo: 'rgba(255,255,255,0.75)', cor: '#333' });
      rotulo(t, x, y, ini, -ref.diag * 0.02);
    });
    // seta do norte sobre o terreno, num ponto que fica à vista
    const [nxp, nyp] = ci ? [ci.seg[1][0] + ci.nrm[0] * ref.diag * 0.06 - ci.u[0] * ref.diag * 0.06, ci.seg[1][1] + ci.nrm[1] * ref.diag * 0.06 - ci.u[1] * ref.diag * 0.06] : [x1 - ref.diag * 0.04, m.dominio.y0 + ref.diag * 0.04];
    const cTer = m.pontual(nxp, nyp).contatos[0];
    const base = P(nxp, nyp, cTer);
    const seta = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), base, ref.diag * 0.07, 0x222222, ref.diag * 0.025, ref.diag * 0.014);
    seta.position.y = base.y + 0.5;
    raiz.add(seta);
    rotulo(texto('N', { tamanho: 0.8, fundo: null }), nxp, nyp + ref.diag * 0.09, cTer);
  }

  function renderLegenda() {
    const usados = modelo ? [...new Map(modelo.unidades.map((u) => [u.codigo, solo(u.codigo)])).values()] : [];
    document.getElementById('legenda3d').innerHTML = usados.length ? '<div class="leg-ttl">Camadas</div>' + usados.map((s) => `
      <div class="leg3d-row">
        <input type="checkbox" data-mostrar="${s.code}" ${o.ocultos.has(s.code) ? '' : 'checked'} title="Mostrar ou esconder"/>
        <span class="leg-sw" style="background:#${cor3D(s.code).getHexString()}"></span><span class="leg3d-nome" title="${esc(s.label)}">${esc(s.horizonte ? s.label : s.code)}</span>
        <input type="range" min="0.1" max="1" step="0.05" value="${o.opacidade[s.code] ?? 1}" data-opac="${s.code}" title="Transparência"/>
      </div>`).join('') : '';
  }
  document.getElementById('legenda3d').addEventListener('input', (e) => {
    const code = e.target.dataset.opac || e.target.dataset.mostrar;
    if (!code) return;
    if (e.target.dataset.opac) o.opacidade[code] = +e.target.value;
    else if (e.target.checked) o.ocultos.delete(code); else o.ocultos.add(code);
    atualizarMateriais();
    raiz.traverse((obj) => { if (obj.userData.code === code) obj.visible = !o.ocultos.has(code); });
  });

  // ── o que está sob o cursor ──
  const raio = new THREE.Raycaster(), mouse = new THREE.Vector2();
  const dica = document.getElementById('m3dDica');
  let pendente = false;
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (pendente || !dica) return;
    pendente = true;
    requestAnimationFrame(() => {
      pendente = false;
      const r = renderer.domElement.getBoundingClientRect();
      mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raio.setFromCamera(mouse, camera);
      const alvos = [];
      raiz.traverse((obj) => { if (obj.isMesh && obj.visible && (obj.userData.code || obj.userData.base)) alvos.push(obj); });
      const hit = raio.intersectObjects(alvos, false).find((h) => !cortando() || h.object.material.clippingPlanes.length === 0 || plano.distanceToPoint(h.point) >= -1e-6);
      if (!hit) { dica.textContent = ''; return; }
      const cota = hit.point.y / o.exagero + ref.c0;
      const d = hit.object.userData;
      if (d.base) { dica.textContent = `Base do modelo · cota ${fmt(cota, 2)} m`; return; }
      const s = solo(d.code), sec = d.origem ? secLabel(d.origem) : '';
      dica.textContent = `${s.horizonte ? s.label : `${s.code} — ${s.label.split('—').pop().trim()}${sec ? ` (${sec})` : ''}`}${d.furo ? ` · ${d.furo}` : ''} · cota ${fmt(cota, 2)} m`;
    });
  });

  // ── câmera ──
  function caixa() {
    const b = new THREE.Box3().setFromObject(raiz);
    return b.isEmpty() ? new THREE.Box3(new THREE.Vector3(-50, 0, -50), new THREE.Vector3(50, 20, 50)) : b;
  }
  function direcaoPadrao() {
    if (!cortando()) return new THREE.Vector3(0.75, 0.62, 1.15);
    const { nrm, u } = corteInfo;
    return new THREE.Vector3(-nrm[0] + 0.55 * u[0], 0.75, nrm[1] - 0.55 * u[1]);
  }
  function ajustar(dir = direcaoPadrao()) {
    const b = caixa(), centro = b.getCenter(new THREE.Vector3()), r = b.getSize(new THREE.Vector3()).length() / 2;
    const dist = (r / Math.sin((camera.fov * Math.PI) / 360)) * 0.95;
    camera.position.copy(centro).add(dir.clone().normalize().multiplyScalar(dist));
    camera.near = dist / 200; camera.far = dist * 20; camera.updateProjectionMatrix();
    controls.target.copy(centro); controls.update();
  }
  function vista(tipo) {
    if (tipo === 'cima') return ajustar(new THREE.Vector3(0.001, 1, 0.0001));
    if (tipo === 'corte' && corteInfo) {
      const [nx, ny] = corteInfo.nrm;
      return ajustar(new THREE.Vector3(-nx, 0.28, ny)); // do lado removido, de frente para a face
    }
    return ajustar();
  }

  // ── ciclo de desenho ──
  function tamanho() {
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px';
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(tamanho).observe(wrap);
  function laco() {
    if (!ativo) { animando = false; return; }
    animando = true;
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(laco);
  }

  function render() {
    ativo = app.ui.view === '3d';
    if (!ativo) return;
    tamanho();
    construir();
    if (!animando) laco();
  }

  function definirExagero(v) {
    o.exagero = v;
    render();
  }

  function capturar() {
    renderer.render(scene, camera);
    return new Promise((ok) => renderer.domElement.toBlob(ok, 'image/png'));
  }

  return {
    render, capturar, definirExagero, vista,
    ajustar: () => ajustar(),
    reenquadrar: () => { precisaEnquadrar = true; },
    estado: () => ({ modelo, corte: corteInfo, raiz, plano, camera, renderer, ref }),
  };
}
