// Leitura e gravação do arquivo de projeto (.json).
import { VERSAO, novoFuro, novoProjeto, num, uid } from './projeto.js';

/** Valida e normaliza um projeto lido de JSON. Lança erro se o formato não for reconhecido. */
export function carregarProjeto(dados) {
  if (!dados || typeof dados !== 'object') throw new Error('Arquivo inválido.');
  if (dados.version !== VERSAO) throw new Error(`Versão de arquivo não suportada: ${dados.version ?? 'desconhecida'}`);
  const p = novoProjeto(dados.projeto?.nome || 'Projeto');
  p.projeto = { ...p.projeto, ...(dados.projeto || {}) };
  if (p.projeto.modoSPT !== 'golpes') p.projeto.modoSPT = 'metro';
  p.cores = Object.fromEntries(Object.entries(dados.cores || {}).filter(([, v]) => /^#[0-9a-f]{6}$/i.test(String(v))));
  p.furos = (dados.furos || []).map((f) => novoFuro(f));
  p.cortes = (dados.cortes || []).map((c) => ({
    id: c.id || uid('c'),
    nome: c.nome || "A–A'",
    p1: [num(c.p1?.[0]), num(c.p1?.[1])],
    p2: [num(c.p2?.[0]), num(c.p2?.[1])],
    lado: Math.sign(c.lado) || 1,
    faixa: c.faixa === null || c.faixa === undefined ? null : num(c.faixa, 50),
  }));
  return p;
}

export const serializar = (p) => JSON.stringify(p, null, 2);
