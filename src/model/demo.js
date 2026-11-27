// Projeto de demonstração aberto na primeira visita (e pelo botão Exemplo):
// 10 furos numa encosta de gnaisse, dois deles mistos (SPT + rotativa), com
// matacões. Dados inventados; os mesmos da planilha geoperfil_investigacao_teste.xlsx.
// O projeto é montado pelo importador, como se a planilha tivesse sido importada.
import { novoProjeto } from './projeto.js';
import { aplicarImportacao } from '../io/csv.js';

const DESC = {
  'ARGS/ATR': 'Aterro de argila siltosa, marrom, com entulho',
  'ARGA/COL': 'Argila arenosa porosa, vermelha, colúvio',
  'SAG/RES': 'Silte argiloso, vermelho-amarelado, solo residual maduro',
  'SAR/RES': 'Silte arenoso micáceo, variegado, solo residual jovem (saprolito de gnaisse)',
  'ARS/RES': 'Areia siltosa micácea, cinza, saprolito',
  'ROC/PED': 'Matacão de gnaisse',
  'ROC/RAL': 'Gnaisse muito alterado, muito fraturado',
  'ROC/RFR': 'Gnaisse pouco alterado, fraturado',
  'ROC/RSA': 'Gnaisse são, pouco fraturado',
};

// nome: [x, y, cota, NA, prof. total, parada, camadas [de, até, 'primária/secundária'], N-SPT por metro, { metro: [REC, RQD] }]
const FUROS = {
  'SP-01': [610010, 7795030, 886.4, 2.6, 12.45, 'imp_percussao',
    [[0, 1.5, 'ARGS/ATR'], [1.5, 4, 'ARGA/COL'], [4, 8, 'SAG/RES'], [8, 12.45, 'SAR/RES']],
    [3, 2, 4, 5, 7, 9, 10, 12, 15, 19, 26, 38, '30/10']],
  'SP-02': [610070, 7795025, 887.9, 3.1, 13.3, 'imp_percussao',
    [[0, 1, 'ARGS/ATR'], [1, 4.5, 'ARGA/COL'], [4.5, 9, 'SAG/RES'], [9, 13.3, 'SAR/RES']],
    [4, 3, 4, 5, 6, 8, 9, 11, 13, 17, 22, 29, 41, '30/8']],
  'SP-03': [610130, 7795035, 889.6, 3.8, 11.2, 'imp_percussao',
    [[0, 3, 'ARGA/COL'], [3, 4, 'ROC/PED'], [4, 5, 'ARGA/COL'], [5, 8, 'SAG/RES'], [8, 11.2, 'SAR/RES']],
    [4, 5, 6, '30/6', 7, 9, 11, 14, 18, 27, 40, '30/5']],
  'SP-04': [610020, 7795100, 891.8, 4.2, 14.15, 'imp_percussao',
    [[0, 3.5, 'ARGA/COL'], [3.5, 9, 'SAG/RES'], [9, 14.15, 'SAR/RES']],
    [3, 4, 4, 6, 7, 8, 10, 11, 13, 16, 20, 25, 33, 45, '30/12']],
  'SM-02': [610075, 7795095, 893.6, 4.9, 20, 'projeto',
    [[0, 2, 'ARGA/COL'], [2, 3, 'ROC/PED'], [3, 4, 'ARGA/COL'], [4, 9, 'SAG/RES'], [9, 14, 'SAR/RES'], [14, 16, 'ROC/RAL'], [16, 18, 'ROC/RFR'], [18, 20, 'ROC/RSA']],
    [4, 5, '30/4', 6, 7, 8, 10, 12, 14, 17, 21, 26, 34, 47],
    { 15: [35, 0], 16: [48, 12], 17: [72, 38], 18: [81, 55], 19: [96, 82], 20: [100, 91] }],
  'SP-05': [610135, 7795105, 895, 5.6, 12.4, 'imp_percussao',
    [[0, 4, 'ARGA/COL'], [4, 7.5, 'SAG/RES'], [7.5, 12.4, 'SAR/RES']],
    [3, 4, 5, 5, 7, 9, 11, 15, 19, 25, 36, 44, '30/7']],
  'SP-06': [610010, 7795165, 897.3, 6.3, 15.25, 'imp_percussao',
    [[0, 2.5, 'ARGA/COL'], [2.5, 6, 'SAG/RES'], [6, 7, 'ROC/PED'], [7, 10, 'SAG/RES'], [10, 15.25, 'SAR/RES']],
    [4, 5, 6, 7, 9, 10, '30/3', 11, 12, 14, 17, 21, 26, 32, 42, '30/15']],
  'SM-01': [610080, 7795175, 901.2, 7.8, 22, 'projeto',
    [[0, 2, 'ARGA/COL'], [2, 8, 'SAG/RES'], [8, 13, 'SAR/RES'], [13, 15, 'ARS/RES'], [15, 17, 'ROC/RAL'], [17, 19, 'ROC/RFR'], [19, 22, 'ROC/RSA']],
    [5, 6, 7, 8, 9, 10, 11, 13, 15, 18, 22, 27, 33, 40, '30/9'],
    { 16: [30, 0], 17: [45, 10], 18: [66, 30], 19: [78, 47], 20: [94, 79], 21: [98, 88], 22: [100, 93] }],
  'SP-07': [610140, 7795170, 903.5, null, 10.25, 'imp_percussao',
    [[0, 2, 'ARGA/COL'], [2, 3, 'ROC/PED'], [3, 6, 'SAG/RES'], [6, 10.25, 'SAR/RES']],
    [6, 7, '30/2', 9, 12, 15, 19, 25, 34, 45, '30/6']],
  'SP-08': [610050, 7795235, 904.8, null, 11.35, 'imp_percussao',
    [[0, 1.5, 'ARGA/COL'], [1.5, 6, 'SAG/RES'], [6, 11.35, 'SAR/RES']],
    [5, 6, 8, 9, 11, 13, 16, 20, 26, 34, 44, '30/9']],
};

/** Registros no formato do importador (uma linha por informação). */
export function registrosDemo() {
  const reg = [];
  Object.entries(FUROS).forEach(([furo, [x, y, cota, na, prof, parada, camadas, spt, rot = {}]]) => {
    reg.push({ furo, x: String(x), y: String(y), cota: String(cota), ...(na ? { na: String(na) } : {}), profTotal: String(prof), parada });
    camadas.forEach(([de, ate, k]) => { const [primario, secundario] = k.split('/'); reg.push({ furo, de: String(de), ate: String(ate), primario, secundario, desc: DESC[k] }); });
    spt.forEach((n, i) => reg.push({ furo, prof: String(i + 1), nspt: String(n) }));
    Object.entries(rot).forEach(([m, [rec, rqd]]) => reg.push({ furo, prof: m, rec: String(rec), rqd: String(rqd) }));
  });
  return reg;
}

export function projetoDemo() {
  const p = novoProjeto('Encosta de gnaisse (exemplo)');
  p.projeto.fusoUTM = '23S';
  aplicarImportacao(p, registrosDemo());
  p.projeto.estilo = { ...(p.projeto.estilo || {}), cor: 'horizonte' };
  p.cortes = [
    { id: 'c_demo_a', nome: "A–A'", p1: [610000, 7795030], p2: [610150, 7795240], lado: 1, faixa: 25, incluir: 'ambos', modo: 'suave' },
    { id: 'c_demo_b', nome: "B–B'", p1: [610000, 7795100], p2: [610150, 7795100], lado: 1, faixa: 15, incluir: 'ambos', modo: 'suave' },
  ];
  return p;
}
