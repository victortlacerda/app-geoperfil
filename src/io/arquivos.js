// Download e leitura de arquivos no navegador.

export function baixar(conteudo, nome, tipo = 'application/octet-stream') {
  const blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: tipo });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const lerTexto = (file) => new Promise((ok, erro) => {
  const r = new FileReader();
  r.onload = () => ok(r.result);
  r.onerror = () => erro(r.error);
  r.readAsText(file);
});

/** Lê todas as abas de um .xlsx: [{ sheet, data: [[...], ...] }]. */
export async function lerXLSX(file) {
  const { default: lerExcel } = await import('read-excel-file/browser');
  const abas = await lerExcel(file);
  return abas.map((a) => ({ sheet: a.sheet, data: a.data.map((l) => l.map((v) => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v)))) }));
}

export async function escreverXLSX(abas, nome) {
  const { default: escreverExcel } = await import('write-excel-file/browser');
  const sheets = Object.entries(abas).map(([sheet, linhas]) => ({
    sheet,
    data: linhas.map((l, i) => l.map((v) => ({ value: v, ...(i === 0 ? { fontWeight: 'bold' } : {}) }))),
  }));
  await escreverExcel(sheets).toFile(nome);
}

export const nomeArquivo = (base, ext) =>
  `${String(base || 'geoperfil').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').replace(/^_|_$/g, '') || 'geoperfil'}.${ext}`;
