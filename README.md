# GeoPerfil

App web para montar perfis geotécnicos a partir de sondagens SPT: lançamento de furos em planta, camadas e N-SPT por furo, cortes com faixa de inclusão, perfil 2D com hachuras e exportação DXF/PDF.

> Versão 2 em desenvolvimento: reestruturação completa do app.

## Funcionalidades

- **Planta georreferenciada**: coordenadas UTM SIRGAS 2000 (fusos 18–25 S e 18–22 N) com mapa de fundo OpenStreetMap ou satélite, ou coordenadas locais sem mapa. Furos podem ser lançados em UTM ou em latitude/longitude, arrastados no mapa, e há uma ferramenta para medir distâncias.
- **Cortes**: o lado clicado define quais furos entram (ou os dois lados, como opção), dentro de uma faixa de distância à linha.
- **Boletim metro a metro** por furo: profundidade limite, critério de parada, NA e cota no topo; os metros já aparecem prontos para preencher.
  - Classificação sem valor padrão. Metro vazio repete a classificação de cima, então AREA no 1 m e AREA no 5 m formam uma camada só. Metros seguidos com a mesma classificação viram uma camada.
  - Enter ou Tab vão para o próximo metro; a alça ▪ arrasta a classificação para outros metros; dá para colar colunas do Excel.
  - N-SPT metro a metro (padrão) ou, como opção, golpes por 15 cm (N = 2º + 3º trechos). Penetração incompleta como `30/12`.
  - Cada classificação tem uma cor só no projeto inteiro (editável).
  - **Boletim em PDF** do furo: perfil com hachuras, classificação e descrição, N-SPT, gráfico, NA e fim da sondagem.
- **Perfil 2D com contatos interpolados**: as camadas de furos vizinhos são correlacionadas (mesma classificação, na mesma ordem) e ligadas em linha reta; camada sem par acunha no meio do vão; trecho sem correlação vira uma transição lateral. Terreno e fundo ficam sempre retos entre os furos. As pontas de acunhamento e as transições podem ser arrastadas ("Ajustar contatos"), e o ajuste fica salvo no corte. Opção "Degrau" para a troca simples no meio do vão.
- **Modelo 3D** (three.js): furos em cilindros coloridos por camada, diagrama de cercas (o perfil 2D entre cada par de furos vizinhos na triangulação de Delaunay), superfícies do terreno, do NA e do fundo, e a seção do corte ativo, idêntica ao perfil 2D. Tem plano de corte deslocável, exagero vertical, transparência e visibilidade por classificação, rótulos de N-SPT, vistas prontas e captura de imagem.
- **PDF do perfil em A3** com escalas padrão (horizontal e vertical), exagero vertical, escala gráfica, legenda e carimbo.
- **Exportação**: DXF R12 (planta + perfil com os mesmos contatos interpolados, layers por solo), PDF do perfil, projeto em JSON e furos/cortes em **GeoJSON** e **KML** (Google Earth).
- **Importação** de CSV/XLSX pelo cabeçalho (`furo, x, y, lat, lon, cota, na, prof_total, de, ate, primario, secundario, descricao, prof, nspt`), inclusive planilhas com abas separadas, e de pontos em GeoJSON/KML.
- **Desfazer/refazer** (Ctrl+Z / Ctrl+Y) e salvamento automático no navegador.

## Desenvolvimento

```bash
npm install
npm run dev      # servidor local
npm test         # testes (Vitest)
npm run build    # gera dist/
```

A cada push na `main`, o GitHub Actions roda os testes e publica `dist/` no GitHub Pages.

## Estrutura

```
src/
  main.js          ligação entre estado, vistas e ações
  store.js         estado do projeto, desfazer/refazer, salvamento automático
  model/           catálogo de solos, modelo de dados e arquivo de projeto
  geo/             geometria do corte e zonas do perfil
  views/           planta, camadas, perfil e hachuras (canvas)
  io/              CSV/XLSX, DXF, arquivos
  styles/
tests/             testes unitários
```

## Formato do projeto (v2)

Tudo em metros. `x` = Leste, `y` = Norte (UTM SIRGAS 2000 no fuso `fusoUTM` quando `crs` = `utm`; coordenadas locais quando `crs` = `local`). `metros` guarda só o que foi digitado; o metro *m* vai de *m − 1* a *m*. Classificação vazia repete a de cima, e as camadas são calculadas a partir disso.

```json
{
  "version": 2,
  "projeto": { "nome": "Obra X", "crs": "utm", "fusoUTM": "23S", "fundo": "mapa", "modoSPT": "metro" },
  "cores": { "ARE": "#97C459" },
  "furos": [{ "id": "…", "nome": "SP-01", "x": 40, "y": 400, "cota": 842.5, "na": 3.2,
              "profTotal": 15.45, "parada": "imp_percussao",
              "metros": [{ "m": 1, "codigo": "ARGS", "origem": "ATR", "desc": "Argila siltosa marrom", "spt": "3" },
                         { "m": 2, "spt": "4" },
                         { "m": 3, "codigo": "ARE", "golpes": ["5", "6", "7"] }] }],
  "cortes": [{ "id": "…", "nome": "A–A'", "p1": [20, 395], "p2": [230, 395], "lado": -1, "faixa": 40 }]
}
```

## Roadmap

- [x] Fase 0 — Fundação (Vite, módulos, store, desfazer/refazer, testes, deploy)
- [x] Fase 1 — Correções e modelo de dados v2
- [x] Fase 2 — Boletim metro a metro e boletim em PDF
- [x] Fase 3 — Planta georreferenciada (Leaflet, UTM SIRGAS 2000, GeoJSON/KML)
- [x] Fase 4 — Perfil 2D v2 (contatos interpolados, ajuste manual, PDF A3 com carimbo, DXF)
- [x] Fase 5 — Modelo 3D com three.js (cercas, superfícies, seção do corte, plano de corte)
- [ ] Fase 6 — Integrações e portfólio
