// Aba Modelo 3D (three.js): furos em cilindros por camada, diagrama de cercas,
// superfícies do terreno, NA e fundo, seção do corte ativo e plano de corte.
// Carregado sob demanda (import dinâmico) para não pesar nas outras abas.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { triangulacao, cerca, secaoDoCorte, superficie, valores, extensao } from '../geo/modelo3d.js';
import { camadasDoFuro, sptPorMetro, sptTextos, profMax } from '../model/projeto.js';
import { solo, secLabel } from '../model/catalogo.js';
import { NA_COR } from '../styles/tema.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function criarModelo3D(app) {
  const wrap = document.getElementById('cena3d');
  const o = app.ui.m3d;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  } catch {
    wrap.innerHTML = '<div class="empty">Este navegador não conseguiu iniciar o WebGL, necessário para o modelo 3D.</div>';
    return { render() {}, capturar() {}, ajustar() {}, vista() {} };
  }
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.localClippingEnabled = true;
  renderer.setClearColor(0xf3f4f6);
  wrap.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100000);
  camera.up.set(0, 1, 0);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a80, 2.2));
  const sol = new THREE.DirectionalLight(0xffffff, 1.6);
  sol.position.set(0.6, 1, 0.4);
  scene.add(sol);

  const raiz = new THREE.Group(); // geometria em metros, com o eixo vertical exagerado
  const rotulos = new THREE.Group(); // textos (não sofrem o exagero)
  scene.add(raiz, rotulos);
  const plano = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
  const materiais = new Map(); // por classificação
  let ref = { cx: 0, cy: 0, c0: 0, diag: 100 };
  let secaoAtual = null;
  let precisaEnquadrar = true;
  let ativo = false, animando = false;

  // coordenadas reais → cena (x = Leste, y = cota, z = −Norte)
  const P = (x, y, c) => new THREE.Vector3(x - ref.cx, c - ref.c0, -(y - ref.cy));

  /** Material por classificação; tipo 's' = seção do corte (não é cortada pelo plano). */
  function material(code, tipo = 'm') {
    const k = `${code}|${tipo}`;
    if (!materiais.has(k)) {
      materiais.set(k, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.85, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
    }
    const m = materiais.get(k);
    m.color.set(solo(code).fill);
    const op = o.opacidade[code] ?? 1;
    m.opacity = op; m.transparent = op < 1; m.depthWrite = op >= 1;
    m.clippingPlanes = tipo === 'm' && o.cortar && secaoAtual ? [plano] : [];
    m.needsUpdate = true;
    return m;
  }

  function limpar(g) {
    g.traverse((obj) => {
      obj.geometry?.dispose();
      if (obj.material && ![...materiais.values()].includes(obj.material)) { obj.material.map?.dispose(); obj.material.dispose(); }
    });
    g.clear();
  }

  /** Painel plano (vertical) a partir de polígonos 2D (d, cota) e seus pontos 3D. */
  function painel(pol, grupo, contorno = 0x2a2a2a, tipo = 'm') {
    const contour = pol.pts2d.map(([d, c]) => new THREE.Vector2(d, c));
    if (contour.length < 3 || Math.abs(THREE.ShapeUtils.area(contour)) < 1e-6) return;
    const faces = THREE.ShapeUtils.triangulateShape(contour, []);
    const pos = new Float32Array(pol.pts3d.length * 3);
    pol.pts3d.forEach(([x, y, c], i) => { const v = P(x, y, c); pos.set([v.x, v.y, v.z], i * 3); });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(faces.flat());
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material(pol.solo.code, tipo));
    mesh.userData.code = pol.solo.code;
    mesh.visible = !o.ocultos.has(pol.solo.code);
    grupo.add(mesh);
    const lin = new THREE.LineLoop(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos.slice(), 3)), new THREE.LineBasicMaterial({ color: contorno, transparent: true, opacity: tipo === 's' ? 0.9 : 0.55, clippingPlanes: tipo === 'm' && o.cortar && secaoAtual ? [plano] : [] }));
    lin.userData.code = pol.solo.code;
    lin.visible = !o.ocultos.has(pol.solo.code);
    grupo.add(lin);
  }

  function tin(furos, tri, valor, cor, opac, aramado = false) {
    const s = superficie(furos, tri, valor);
    if (!s.triangulos.length) return null;
    const pos = new Float32Array(s.vertices.length * 3);
    s.vertices.forEach(([x, y, c], i) => { const v = P(x, y, Number.isFinite(c) ? c : ref.c0); pos.set([v.x, v.y, v.z], i * 3); });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(s.triangulos.flat());
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: cor, transparent: true, opacity: opac, side: THREE.DoubleSide, depthWrite: false, wireframe: aramado, clippingPlanes: o.cortar && secaoAtual ? [plano] : [] });
    return new THREE.Mesh(geo, mat);
  }

  function texto(msg, { tamanho = 1, cor = '#111', fundo = 'rgba(255,255,255,0.85)', negrito = true } = {}) {
    const c = document.createElement('canvas'), ctx = c.getContext('2d'), px = 48;
    ctx.font = `${negrito ? '700' : '500'} ${px}px system-ui, sans-serif`;
    const w = Math.ceil(ctx.measureText(msg).width) + 24;
    c.width = w; c.height = px + 20;
    ctx.font = `${negrito ? '700' : '500'} ${px}px system-ui, sans-serif`;
    ctx.fillStyle = fundo; ctx.fillRect(0, 0, w, c.height);
    ctx.fillStyle = cor; ctx.textBaseline = 'middle'; ctx.fillText(msg, 12, c.height / 2 + 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    const h = ref.diag * 0.028 * tamanho;
    sp.scale.set((h * w) / c.height, h, 1);
    sp.renderOrder = 10;
    return sp;
  }
  const rotulo = (sp, x, y, c) => { sp.userData.base = P(x, y, c); rotulos.add(sp); };

  function posicionarRotulos() {
    rotulos.children.forEach((sp) => { const b = sp.userData.base; sp.position.set(b.x, b.y * o.exagero, b.z); });
  }

  /** Reconstrói a cena a partir do projeto. */
  function construir() {
    limpar(raiz); limpar(rotulos);
    const doc = app.store.doc, furos = doc.furos.filter((f) => profMax(f) > 0 || f.metros.length);
    const corte = app.corteAtivo();
    if (!furos.length) { document.getElementById('m3dInfo').textContent = 'Lance furos para ver o modelo.'; return; }
    const ex = extensao(furos);
    ref = { cx: (ex.x0 + ex.x1) / 2, cy: (ex.y0 + ex.y1) / 2, c0: ex.c0, diag: Math.max(Math.hypot(ex.x1 - ex.x0, ex.y1 - ex.y0), (ex.c1 - ex.c0) * 2, 20) };
    raiz.scale.set(1, o.exagero, 1);
    const desl = document.getElementById('m3dDesl'), lim = Math.ceil(ref.diag / 2);
    if (+desl.max !== lim) { desl.min = -lim; desl.max = lim; }
    secaoAtual = secaoDoCorte(corte, furos, { modo: app.ui.perfil.modo });
    if (secaoAtual) {
      const [nx, ny] = secaoAtual.normal;
      const n = new THREE.Vector3(nx, 0, -ny).normalize();
      const p0 = P(secaoAtual.origem[0] + nx * o.deslocamento, secaoAtual.origem[1] + ny * o.deslocamento, ref.c0);
      plano.setFromNormalAndCoplanarPoint(n, p0);
    }
    const tri = triangulacao(furos);
    const raio = Math.max(0.35, ref.diag / 160);

    if (o.furos) furos.forEach((f) => {
      camadasDoFuro(f).forEach((c) => {
        const h = c.ate - c.de;
        if (h <= 0) return;
        const cil = new THREE.Mesh(new THREE.CylinderGeometry(raio, raio, h, 20), material(c.codigo));
        const meio = P(f.x, f.y, f.cota - (c.de + c.ate) / 2);
        cil.position.copy(meio);
        cil.userData.code = c.codigo;
        cil.visible = !o.ocultos.has(c.codigo);
        raiz.add(cil);
      });
      const fundoC = f.cota - profMax(f);
      const haste = new THREE.Line(new THREE.BufferGeometry().setFromPoints([P(f.x, f.y, f.cota + ref.diag * 0.012 / o.exagero), P(f.x, f.y, fundoC)]), new THREE.LineBasicMaterial({ color: 0x222222 }));
      raiz.add(haste);
      rotulo(texto(f.nome, { tamanho: 1 }), f.x, f.y, f.cota + (ref.diag * 0.035) / o.exagero);
      if (o.spt) {
        const n = sptPorMetro(f), t = sptTextos(f);
        Object.keys(t).forEach((m) => {
          const sp = texto(t[m], { tamanho: 0.5, cor: n[m] >= 50 ? '#A32D2D' : '#111', negrito: false });
          sp.center.set(-0.15, 0.5);
          rotulo(sp, f.x + raio * 1.4, f.y, f.cota - (+m - 0.5));
        });
      }
    });

    if (o.cercas) tri.arestas.forEach(([i, j]) => {
      const ajustes = Object.assign({}, ...doc.cortes.map((c) => c.ajustes || {}));
      const c = cerca(furos[i], furos[j], { ajustes, modo: app.ui.perfil.modo });
      c?.poligonos.forEach((pol) => painel(pol, raiz));
    });

    if (o.secao && secaoAtual) {
      const g = new THREE.Group();
      secaoAtual.poligonos.forEach((pol) => painel(pol, g, 0x0d4594, 's'));
      raiz.add(g);
      const [n1, n2] = corte.nome.split('–');
      const ini = secaoAtual.poligonos.flatMap((p) => p.pts3d);
      const dmin = Math.min(...secaoAtual.poligonos.flatMap((p) => p.pts2d.map(([d]) => d)));
      const dmax = Math.max(...secaoAtual.poligonos.flatMap((p) => p.pts2d.map(([d]) => d)));
      const topo = Math.max(...ini.map(([, , c]) => c));
      const pA = [secaoAtual.origem[0] + secaoAtual.dir[0] * dmin, secaoAtual.origem[1] + secaoAtual.dir[1] * dmin];
      const pB = [secaoAtual.origem[0] + secaoAtual.dir[0] * dmax, secaoAtual.origem[1] + secaoAtual.dir[1] * dmax];
      rotulo(texto(n1 || 'A', { cor: '#1566D1', tamanho: 1.3 }), pA[0], pA[1], topo + (ref.diag * 0.07) / o.exagero);
      rotulo(texto(n2 || "A'", { cor: '#1566D1', tamanho: 1.3 }), pB[0], pB[1], topo + (ref.diag * 0.07) / o.exagero);
    }

    if (o.terreno) { const m = tin(furos, tri, valores.terreno, 0x9c8f6a, 0.28); if (m) raiz.add(m); }
    if (o.na) { const m = tin(furos, tri, valores.na, NA_COR, 0.3); if (m) raiz.add(m); }
    if (o.fundo) { const m = tin(furos, tri, valores.fundo, 0x555555, 0.5, true); if (m) raiz.add(m); }

    posicionarRotulos();
    renderLegenda();
    document.getElementById('m3dInfo').textContent =
      `${furos.length} furo(s) · ${tri.arestas.length} painel(is) de cerca${secaoAtual ? ` · seção ${corte.nome}` : corte ? ` · corte ${corte.nome} sem 2 furos` : ''}`;
    if (precisaEnquadrar) { precisaEnquadrar = false; ajustar(); }
  }

  function renderLegenda() {
    const usados = [...new Map(app.store.doc.furos.flatMap((f) => camadasDoFuro(f)).map((c) => [c.codigo, solo(c.codigo)])).values()];
    document.getElementById('legenda3d').innerHTML = '<div class="leg-ttl">Camadas</div>' + usados.map((s) => `
      <div class="leg3d-row">
        <input type="checkbox" data-mostrar="${s.code}" ${o.ocultos.has(s.code) ? '' : 'checked'} title="Mostrar ou esconder"/>
        <span class="leg-sw" style="background:${s.fill}"></span><span class="leg3d-nome" title="${esc(s.label)}">${esc(s.code)}</span>
        <input type="range" min="0.1" max="1" step="0.05" value="${o.opacidade[s.code] ?? 1}" data-opac="${s.code}" title="Transparência"/>
      </div>`).join('');
  }
  document.getElementById('legenda3d').addEventListener('input', (e) => {
    const code = e.target.dataset.opac || e.target.dataset.mostrar;
    if (!code) return;
    if (e.target.dataset.opac) o.opacidade[code] = +e.target.value;
    else if (e.target.checked) o.ocultos.delete(code); else o.ocultos.add(code);
    material(code, 'm'); material(code, 's');
    raiz.traverse((obj) => { if (obj.userData.code === code) obj.visible = !o.ocultos.has(code); });
  });

  // ── câmera ──
  function caixa() {
    const b = new THREE.Box3().setFromObject(raiz);
    return b.isEmpty() ? new THREE.Box3(new THREE.Vector3(-50, 0, -50), new THREE.Vector3(50, 20, 50)) : b;
  }
  function ajustar(dir = new THREE.Vector3(0.9, 0.75, 1.1)) {
    const b = caixa(), centro = b.getCenter(new THREE.Vector3()), r = b.getSize(new THREE.Vector3()).length() / 2;
    const dist = r / Math.sin((camera.fov * Math.PI) / 360) * 1.05;
    camera.position.copy(centro).add(dir.clone().normalize().multiplyScalar(dist));
    camera.near = dist / 200; camera.far = dist * 20; camera.updateProjectionMatrix();
    controls.target.copy(centro); controls.update();
  }
  function vista(tipo) {
    if (tipo === 'cima') return ajustar(new THREE.Vector3(0.001, 1, 0.0001));
    if (tipo === 'corte' && secaoAtual) {
      const [nx, ny] = secaoAtual.normal;
      return ajustar(new THREE.Vector3(-nx, 0.12, ny)); // de frente para a seção, com A à esquerda
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
    raiz.scale.set(1, v, 1);
    posicionarRotulos();
  }

  function capturar() {
    renderer.render(scene, camera);
    return new Promise((ok) => renderer.domElement.toBlob(ok, 'image/png'));
  }

  return {
    render, capturar, definirExagero, vista,
    ajustar: () => ajustar(),
    reenquadrar: () => { precisaEnquadrar = true; },
    estado: () => ({ secao: secaoAtual, raiz, plano, camera, renderer, ref }),
  };
}
