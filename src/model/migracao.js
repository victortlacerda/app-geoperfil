// Leitura de arquivos de projeto: aceita v1 (app antigo) e v2.
import { VERSAO, novoFuro, novoProjeto, num, uid } from './projeto.js';
import { soloPorCodigo, secPorValor } from './catalogo.js';

/** Escala da planta da versão 1: 1 pixel = 0,5 m, eixo Y da tela para baixo. */
export const V1_PX_TO_M = 0.5;
export const V1_Y_REF = 500; // y_norte = V1_Y_REF − py × 0,5 (mantém coordenadas positivas)

export const v1ParaMetros = ({ x, y }) => ({
  x: +(num(x) * V1_PX_TO_M).toFixed(3),
  y: +(V1_Y_REF - num(y) * V1_PX_TO_M).toFixed(3),
});

/**
 * Converte um objeto lido de JSON em projeto v2.
 * Retorna { projeto, avisos }. Lança erro se não reconhecer o formato.
 */
export function carregarProjeto(dados) {
  if (!dados || typeof dados !== 'object') throw new Error('Arquivo inválido.');
  if (dados.version === 1 || (Array.isArray(dados.bhData) && !dados.furos)) return migrarV1(dados);
  if (dados.version === VERSAO) return { projeto: normalizarV2(dados), avisos: [] };
  throw new Error(`Versão de arquivo não suportada: ${dados.version}`);
}

export function migrarV1(d) {
  const avisos = ['Arquivo da versão 1 convertido para a versão 2.'];
  const p = novoProjeto('Projeto importado (v1)');
  const codigosDesconhecidos = new Set();

  p.furos = (d.bhData || []).map((b) => {
    const { x, y } = v1ParaMetros(b);
    const camadas = (b.layers || []).map((l) => {
      if (!soloPorCodigo(l.soloCode)) codigosDesconhecidos.add(l.soloCode);
      return { de: num(l.de), ate: num(l.ate), codigo: l.soloCode, origem: secPorValor(l.sec), cor: l.cor };
    });
    const spt = Object.entries(b.spt || {}).map(([prof, n]) => ({ prof: num(prof), n: num(n) }));
    return novoFuro({ nome: b.name, x, y, cota: b.cota, na: b.na, profTotal: b.limite, camadas, spt });
  });

  p.cortes = (d.cortes || []).filter((c) => c.pt1 && c.pt2).map((c) => {
    const a = v1ParaMetros(c.pt1), b = v1ParaMetros(c.pt2);
    return {
      id: uid('c'),
      nome: c.name,
      p1: [a.x, a.y],
      p2: [b.x, b.y],
      // O eixo Y foi invertido, então o lado (sinal) também inverte.
      lado: -(Math.sign(c.side) || 1),
      faixa: c.usaBanda ? num(c.bandaM, 50) : null,
    };
  });

  if (p.cortes.some((c) => c.faixa === null))
    avisos.push('Cortes sem faixa agora incluem furos dos dois lados da linha. Ajuste a faixa se o perfil mudar.');
  if (codigosDesconhecidos.size)
    avisos.push(`Códigos de solo desconhecidos trocados pelo padrão: ${[...codigosDesconhecidos].join(', ')}.`);
  avisos.push('Coordenadas convertidas da tela (pixels) para metros locais.');
  return { projeto: p, avisos };
}

function normalizarV2(d) {
  const p = novoProjeto(d.projeto?.nome || 'Projeto');
  p.projeto = { ...p.projeto, ...(d.projeto || {}) };
  p.furos = (d.furos || []).map((f) => novoFuro(f));
  p.cortes = (d.cortes || []).map((c) => ({
    id: c.id || uid('c'),
    nome: c.nome || 'A–A\'',
    p1: [num(c.p1?.[0]), num(c.p1?.[1])],
    p2: [num(c.p2?.[0]), num(c.p2?.[1])],
    lado: Math.sign(c.lado) || 1,
    faixa: c.faixa === null || c.faixa === undefined ? null : num(c.faixa, 50),
  }));
  return p;
}

export const serializar = (p) => JSON.stringify(p, null, 2);
