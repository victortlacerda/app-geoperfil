# GeoPerfil

App web para montar perfis geotécnicos a partir de sondagens SPT: lançamento de furos em planta, camadas e N-SPT por furo, cortes com faixa de inclusão, perfil 2D com hachuras e exportação DXF/PDF.

> Versão 2 em desenvolvimento: reestruturação completa do app.

## Funcionalidades

- **Planta** em coordenadas reais (metros, Norte para cima), com zoom pela roda do mouse, pan (botão do meio ou espaço + arrastar) e furos arrastáveis.
- **Cortes** com faixa simétrica: entram os furos a até *N* metros da linha, dos dois lados (ou todos os furos). A seta indica o sentido de vista.
- **Camadas** por furo com classificação primária e secundária, coluna estratigráfica, N-SPT por metro (Enter avança para o próximo metro) e gráfico N-SPT × profundidade.
- **Perfil 2D** com hachuras, régua de SPT, NA, impenetrável, eixo em cota ou profundidade e zoom.
- **Exportação**: DXF R12 (planta + perfil, layers por solo), PDF pela impressão do navegador e projeto em JSON.
- **Importação** de CSV/XLSX pelo cabeçalho (`furo, x, y, cota, na, prof_total, de, ate, primario, secundario, prof, nspt`), inclusive planilhas com abas separadas.
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

Tudo em metros. `x` = Leste, `y` = Norte.

```json
{
  "version": 2,
  "projeto": { "nome": "Obra X", "crs": "local", "fusoUTM": "23S" },
  "furos": [{ "id": "…", "nome": "SP-01", "x": 40, "y": 400, "cota": 842.5, "na": 3.2, "profTotal": 15,
              "camadas": [{ "de": 0, "ate": 2, "codigo": "ARGS", "origem": "ATR", "cor": "#BA7517" }],
              "spt": [{ "prof": 1, "n": 3 }] }],
  "cortes": [{ "id": "…", "nome": "A–A'", "p1": [20, 395], "p2": [230, 395], "lado": -1, "faixa": 40 }]
}
```

## Roadmap

- [x] Fase 0 — Fundação (Vite, módulos, store, desfazer/refazer, testes, deploy)
- [x] Fase 1 — Correções e modelo de dados v2
- [ ] Fase 2 — Lançamento de SPT conforme NBR 6484
- [ ] Fase 3 — Planta georreferenciada (Leaflet, UTM SIRGAS 2000)
- [ ] Fase 4 — Perfil 2D v2 (contatos interpolados)
- [ ] Fase 5 — Modelo 3D com three.js
- [ ] Fase 6 — Integrações e portfólio
