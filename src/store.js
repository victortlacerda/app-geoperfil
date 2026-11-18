// Estado central: projeto (com desfazer/refazer e salvamento automático)
// e estado de interface (não entra no histórico).

const LIMITE_HISTORICO = 200;
const JANELA_AGRUPAR_MS = 1200;

export function criarStore(projetoInicial, { storage = null, chave = 'geoperfil:v2' } = {}) {
  let doc = projetoInicial;
  let passado = [];
  let futuro = [];
  let ultimoGrupo = null; // { chave, t }
  const ouvintes = new Set();
  let timerSalvar = null;

  const emitir = (motivo) => ouvintes.forEach((fn) => fn(motivo));

  function salvarAgora() {
    if (!storage) return;
    try { storage.setItem(chave, JSON.stringify(doc)); } catch { /* cota cheia ou modo privado */ }
  }
  function agendarSalvar() {
    if (!storage) return;
    clearTimeout(timerSalvar);
    timerSalvar = setTimeout(salvarAgora, 400);
  }

  return {
    get doc() { return doc; },
    get podeDesfazer() { return passado.length > 0; },
    get podeRefazer() { return futuro.length > 0; },

    /**
     * Aplica uma alteração. `fn` recebe uma cópia do projeto e a modifica.
     * `agrupar`: alterações seguidas com a mesma chave viram um único passo de desfazer.
     */
    commit(fn, { agrupar = null } = {}) {
      const agora = Date.now();
      const mesmoGrupo = agrupar && ultimoGrupo && ultimoGrupo.chave === agrupar && agora - ultimoGrupo.t < JANELA_AGRUPAR_MS;
      const novo = structuredClone(doc);
      const r = fn(novo);
      if (!mesmoGrupo) {
        passado.push(doc);
        if (passado.length > LIMITE_HISTORICO) passado.shift();
      }
      ultimoGrupo = agrupar ? { chave: agrupar, t: agora } : null;
      futuro = [];
      doc = novo;
      agendarSalvar();
      emitir('commit');
      return r;
    },

    desfazer() {
      if (!passado.length) return false;
      futuro.push(doc);
      doc = passado.pop();
      ultimoGrupo = null;
      agendarSalvar();
      emitir('desfazer');
      return true;
    },

    refazer() {
      if (!futuro.length) return false;
      passado.push(doc);
      doc = futuro.pop();
      ultimoGrupo = null;
      agendarSalvar();
      emitir('refazer');
      return true;
    },

    /** Troca o projeto inteiro (abrir arquivo, novo projeto). Pode ser desfeito. */
    substituir(novo) {
      passado.push(doc);
      futuro = [];
      ultimoGrupo = null;
      doc = novo;
      agendarSalvar();
      emitir('substituir');
    },

    assinar(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); },
    salvarAgora,
  };
}

export function lerAutosave(storage, chave = 'geoperfil:v2') {
  try {
    const s = storage?.getItem(chave);
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}
