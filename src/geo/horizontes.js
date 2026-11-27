// Preparação das camadas de um furo para o desenho do perfil e do modelo 3D.
//
// - Pedregulho / blocos (origem PED) não formam camada contínua entre furos: o trecho
//   sai da sequência (a camada de cima o absorve; sem camada acima, a de baixo) e vira
//   um "bloco" desenhado em volta do furo.
// - Cor por horizonte: cada camada com origem passa a valer pelo horizonte (aterro,
//   colúvio, solo residual, rocha…), e camadas seguidas do mesmo horizonte se juntam.
//   Camadas sem origem continuam pela textura.
import { solo, codigoHorizonte, BLOCOS } from '../model/catalogo.js';

/**
 * @param layers [{ de, ate, solo, sec, descricao }] (resolverFuro)
 * @param opcoes { porHorizonte }
 * @returns { layers, blocos: [{ de, ate, solo, sec }] }
 */
export function camadasDesenho(layers, { porHorizonte = false } = {}) {
  const blocos = [], out = [];
  layers.forEach((l) => {
    if (l.sec === BLOCOS) { blocos.push({ de: l.de, ate: l.ate, solo: l.solo, sec: l.sec }); return; }
    out.push({ ...l });
  });
  // o trecho de cada bloco vai para a camada logo acima (ou, sem ela, a logo abaixo)
  blocos.forEach((b) => {
    const cima = out.find((l) => Math.abs(l.ate - b.de) < 1e-9);
    if (cima) { cima.ate = b.ate; return; }
    const baixo = out.find((l) => Math.abs(l.de - b.ate) < 1e-9);
    if (baixo) baixo.de = b.de;
  });
  out.sort((a, b) => a.de - b.de);
  for (let i = 1; i < out.length; i++) if (out[i].de > out[i - 1].ate + 1e-9) out[i - 1].ate = out[i].de;
  const pintadas = porHorizonte ? out.map((l) => (l.sec ? { ...l, solo: solo(codigoHorizonte(l.sec)) } : l)) : out;
  const juntas = [];
  pintadas.forEach((l) => {
    const u = juntas.at(-1);
    if (porHorizonte && u && u.solo.code === l.solo.code && u.sec === l.sec && Math.abs(u.ate - l.de) < 1e-9) u.ate = l.ate;
    else juntas.push({ ...l });
  });
  return { layers: juntas, blocos };
}
