# Documentação Técnica — Treinador de Notas: Super Ajudante Estoque
**Versão 3.0 — atualizada em 2026-06-05**

---

## 1. Visão Geral do Sistema

**Super Ajudante Estoque** é um sistema web/Android de gestão de estoque para o restaurante Araçá Grill. Recebe notas fiscais eletrônicas (NF-e) via chave de acesso ou upload de XML, faz o parser, identifica produtos pelo banco de dados interno e lança entradas de estoque com custo médio ponderado.

**Stack:**
- Frontend: SPA em `public/index.html` (JS vanilla + fetch)
- Backend: Vercel Serverless Functions (Node.js ESM)
- Banco: Supabase (PostgreSQL, acesso via `service_role` key — nunca exposta ao frontend)
- NF-e: API Meu Danfe v2 (adicionar chave + baixar XML)
- App nativo: Capacitor 5 (Android)

**Limite Vercel Hobby — 12 funções serverless.**
Novos endpoints NUNCA criam novos arquivos em `api/` — são multiplexados via `?recurso=` em `admin.js`.

---

## 2. Arquivos do Backend

```
api/
├── _lib/
│   ├── db.js              — CRUD Supabase (readRows, appendRow, updateRow, nextId, readConfig)
│   ├── meudanfe.js        — Cliente API Meu Danfe (addNfe, getXml, addXml)
│   ├── parser.js          — Parser XML NF-e + normalizarDesc() + descreverFormaPagamento()
│   ├── util.js            — Helpers HTTP + rate limiting por chave
│   ├── estoque.js         — Lógica de entrada de estoque (custo médio ponderado)
│   └── reconhecimento.js  — 5 estratégias de reconhecimento de produto
├── admin.js               — CRUD administrativo + rotas de treinamento (?recurso=)
├── estoque/
│   ├── saida.js           — Baixa de estoque
│   └── inventario.js      — Inventário (contagem vs. estoque atual)
├── nfe/
│   ├── conferir.js        — Baixa XML + parser + reconhecimento (NÃO grava)
│   ├── confirmar.js       — Grava estoque + contas a pagar
│   ├── add-xml.js         — Upload direto de XML (parse local + Meu Danfe, sem gravar)
│   └── buscar.js          — Busca/polling status NF-e no Meu Danfe
├── movimentacoes.js       — Histórico de movimentações
├── dashboard.js           — Estatísticas para o painel principal
├── produtos.js            — Listagem de produtos
├── fornecedores.js        — CRUD de fornecedores
├── contas.js              — CRUD de contas a pagar
└── teste.js               — Health check
```

---

## 3. Tabelas do Supabase

### Tabela `produtos`

| Coluna | Tipo | Descrição |
|---|---|---|
| `id_produto` | text PK | Ex: "PRD-0001" |
| `nome_interno` | text | Nome limpo usado no restaurante |
| `categoria_id` | text | FK → categorias.id_categoria |
| `subcategoria` | text | Segundo nível (ex: "Cervejas") |
| `variante` | text | Terceiro nível (ex: "Garrafa 600ml") |
| `unidade_estoque` | text | KG, UN, L, ML, G |
| `codigo_barras` | text | EAN da NF-e |
| `codigo_produto_nf` | text | Código cProd do fornecedor |
| `cnpj_fornecedor` | text | CNPJ principal (14 dígitos sem formatação) |
| `descricao_original_nf` | text | Descrição bruta da NF-e |
| `unidade_compra` | text | Unidade como vem na NF-e (CX, KG, DZ…) |
| `estoque_atual` | numeric | Quantidade em unidade_estoque |
| `estoque_minimo` | numeric | Alerta quando abaixo (0 = sem alerta) |
| `custo_medio` | numeric | Custo médio ponderado atual |
| `ultimo_custo_unitario` | numeric | Custo da última compra |
| `confirmado` | text | 'SIM' = curado pelo GPT; 'NAO' = pendente |
| `ativo` | text | 'SIM' / 'NAO' |
| `produto_teste` | text | 'SIM' = ignorado em relatórios e auditoria |
| `observacoes` | text | Anotações livres |
| `criado_em` | text | ISO 8601 |
| `atualizado_em` | text | ISO 8601 |

### Tabela `categorias`

| Coluna | Tipo | Descrição |
|---|---|---|
| `id_categoria` | text PK | Ex: "CAT-0001" |
| `nome_categoria` | text | Ex: "Bebidas" |
| `ativo` | text | 'SIM' / 'NAO' |

> **Subcategorias e variantes NÃO têm tabela própria** — são campos de texto em `produtos`. O ChatGPT cria subcategorias e variantes novas livremente dentro dos valores de texto.

### Tabela `embalagens`

| Coluna | Tipo | Descrição |
|---|---|---|
| `id_embalagem` | text PK | Ex: "EMB-0001" |
| `id_produto` | text | FK → produtos |
| `descricao` | text | Ex: "Caixa com 24 unidades" |
| `sigla` | text | Ex: "CX24" |
| `fator` | numeric | Multiplicador: 1 CX24 = 24 UN |
| `unidade_base` | text | Unidade base: "UN", "KG", "L", "ML" |
| `ativo` | text | 'SIM' / 'NAO' |
| `criado_em` / `atualizado_em` | text | ISO 8601 |

### Tabela `produto_fornecedor`

| Coluna | Tipo | Descrição |
|---|---|---|
| `id_pf` | text PK | Ex: "PF-0001" |
| `id_produto` | text | FK → produtos |
| `cnpj_fornecedor` | text | 14 dígitos sem formatação |
| `nome_fornecedor` | text | Razão social |
| `codigo_produto_nf` | text | cProd da NF-e |
| `ean` | text | EAN do item na NF-e |
| `descricao_normalizada` | text | normalizarDesc(descricao_original) |
| `ncm` | text | NCM extraído do XML (opcional) |
| `ultimo_preco_unitario` | numeric | Último preço unitário visto no XML |
| `vezes_utilizado` | integer | Contador de reconhecimentos bem-sucedidos |
| `confirmado_pelo_usuario` | text | 'SIM' / 'NAO' |
| `origem_confirmacao` | text | 'CHATGPT', 'NF-E', 'MANUAL' |
| `ativo` | text | 'SIM' / 'NAO' |

> **Importante:** esta tabela é a espinha dorsal do reconhecimento automático.
> Produtos confirmados sem entrada aqui ficam invisíveis para futuras NF-es.

### Tabela `aliases_produto`

| Coluna | Tipo | Descrição |
|---|---|---|
| `id_alias` | text PK | Ex: "AL-0001" |
| `id_produto` | text | FK → produtos |
| `alias` | text | Descrição normalizada alternativa |
| `ativo` | text | 'SIM' / 'NAO' |

### Tabelas da Esteira de Treinamento

| Tabela | Descrição |
|---|---|
| `treino_fila` | NF-es adicionadas à esteira aguardando treinamento |
| `treino_itens` | Itens desconhecidos extraídos das NF-es da fila |
| `treino_importacoes` | Log de importações via JSON do ChatGPT |

---

## 4. Hierarquia de Classificação de Produtos

O sistema usa **três níveis** de classificação, todos em campos de texto livre em `produtos`:

```
categoria_id (FK para categorias — obrigatória)
  └── subcategoria (obrigatória quando possível)
        └── variante (obrigatória para bebidas; recomendada nos demais)
```

### Exemplos práticos

```
Bebidas
  └── Cervejas
        ├── Garrafa 600ml  → Cerveja Heineken, Cerveja Brahma, Cerveja Skol
        ├── Garrafa 1L     → Cerveja Skol 1L, Cerveja Antartica 1L
        ├── Lata 350ml     → Cerveja Heineken Lata, Cerveja Brahma Lata
        └── Long Neck 355ml → Cerveja Heineken LN
  └── Refrigerantes
        ├── Garrafa 2L     → Coca-Cola 2L, Pepsi 2L
        └── Lata 350ml     → Coca-Cola Lata
  └── Águas
        ├── Garrafa 500ml sem gás
        ├── Garrafa 500ml com gás
        └── Galão 20L

Câmara fria
  └── Carnes bovinas
        ├── Peça inteira   → Contra-filé peça, Alcatra peça
        └── Porcionado     → Picanha fatiada

Secos / mercearia
  └── Arroz e grãos
        ├── Pacote 5kg     → Arroz Tio João Tipo 1 5kg
        └── Saco 25kg      → Arroz Tipo 1 Saco 25kg
```

### Regras de classificação

1. **Nunca deixar categoria em branco.** Se não tiver certeza, use a mais próxima com `confianca: "MEDIA"`.
2. **Subcategoria obrigatória** quando existirem 3 ou mais produtos na mesma categoria.
3. **Variante obrigatória para bebidas.** Para outros produtos, usar quando houver formatos físicos distintos.
4. **Não criar categoria nova** se uma existente servir.

---

## 5. Reconhecimento de Produtos (5 estratégias)

Executadas em ordem em `conferir.js` e `confirmar.js`. Para na primeira que encontrar match.

| Estratégia | Critério |
|---|---|
| 0 — id_produto direto | `id_produto` fornecido explicitamente |
| 1 — CNPJ+código ou EAN no produtos | Campo `cnpj_fornecedor` + `codigo_produto_nf` na tabela `produtos` |
| 2 — Mapeamento CNPJ+código | Tabela `produto_fornecedor`: CNPJ + código |
| 3 — Mapeamento EAN | Tabela `produto_fornecedor`: EAN |
| 4 — Mapeamento descrição | Tabela `produto_fornecedor`: CNPJ + normalizarDesc(descricao) |
| 5 — Alias | Tabela `aliases_produto`: normalizarDesc(alias) == normalizarDesc(descricao_item) |

**Fallback:** item retorna com `produto_novo: true`. Na tela de Conferência o usuário preenche antes de confirmar.

---

## 6. Função `normalizarDesc(s)`

```javascript
export function normalizarDesc(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
```

Exemplos:
- `"Cerveja Heineken 600ml"` → `"CERVEJA HEINEKEN 600ML"`
- `"ÓLEO DE SOJA 900ml"` → `"OLEO DE SOJA 900ML"`

---

## 7. Cálculo de Custo Médio Ponderado

```
novoEstoque    = estoqueAtual + qtdBase
novoCustoMedio = (estoqueAtual × custoMedioAnterior + qtdBase × custoUnitario) / novoEstoque
Se novoEstoque == 0: novoCustoMedio = custoUnitario
```

**Exemplo:**
```
Produto: Cerveja Heineken Garrafa 600ml
Estoque: 48 UN, custo médio: R$ 5,20/UN

NF-e nova: 2 CX24 (caixas com 24 UN), valor R$ 230,40
  fator: 24
  qtdBase = 2 × 24 = 48 UN
  custoUnit = 230,40 / 48 = R$ 4,80/UN

Resultado:
  novoEstoque = 48 + 48 = 96 UN
  novoCustoMedio = (48×5,20 + 48×4,80) / 96 = R$ 5,00/UN
```

---

## 8. Fluxo da Esteira de Treinamento

```
1. Usuário adiciona chave(s) de NF-e à Esteira  (Treinamento → Passo 1)
   OU faz upload de um ou vários arquivos .xml para aprendizado em lote
   ↓
2. Sistema baixa XML, identifica produtos novos, agrupa por CNPJ+código
   ↓
3. Usuário clica "📤 Compartilhar / Baixar pacote (.txt)"
   → No Android: abre menu nativo (WhatsApp, e-mail, Arquivos)
   → No browser: baixa arquivo .txt
   ↓
4. Usuário cola o conteúdo no GPT Treinador de Notas
   ↓
5. GPT retorna JSON schema_version 1.1
   ↓
6. Usuário cola o JSON no campo "Passo 3" do app e clica Importar
   ↓
7. Sistema importa: cria/atualiza produtos, embalagens, mapeamentos, aliases
```

**Importante:** o upload em lote (múltiplos XMLs) não entra no estoque — serve exclusivamente para enriquecer produto_fornecedor e aprender novos produtos sem movimentação.

---

## 9. Formato do Pacote enviado ao ChatGPT

O arquivo .txt gerado pelo app tem 13 seções numeradas. As seções dinâmicas mais importantes:

**[9] CATEGORIAS E SUBCATEGORIAS** — lista todas as categorias e subcategorias já cadastradas, em ordem alfabética, para que o GPT escolha dentro delas.

**[10] PRODUTOS JÁ CADASTRADOS** — amostra de até **200** produtos confirmados com categoria, subcategoria, variante e unidade, para referência de nomenclatura.

**[11] PRODUTOS DESCONHECIDOS** — os itens desta esteira que precisam ser identificados. Cada item inclui `cnpj_fornecedor`, `codigo_produto_nf`, `descricao_original_nfe` e preço.

---

## 10. Formato do JSON de Saída (schema_version 1.1)

**Este é o único formato aceito pelo importador.** O GPT deve produzir exatamente este JSON.

```json
{
  "schema_version": "1.1",
  "tipo": "catalogo_revisado_gpt",
  "origem": "chatgpt",
  "restaurante": "Araçá Grill",
  "gerado_em": "DD/MM/AAAA HH:mm",

  "produtos_confirmados": [
    {
      "nome_interno": "Cerveja Heineken Garrafa 600ml",
      "descricao_original_nfe": "CERV HEINEKEN PIL 0.600 GFA CX24",
      "categoria": "Bebidas",
      "subcategoria": "Cervejas",
      "variante": "Garrafa 600ml",
      "unidade_estoque": "UN",
      "cnpj_fornecedor": "07526557000100",
      "codigo_produto_nf": "01234",
      "ean": "7896045503852",
      "confianca": "ALTA",
      "confianca_motivo": "EAN confirmado + padrão CX24 explícito",
      "fonte_auxiliar": null
    }
  ],

  "embalagens_confirmadas": [
    {
      "nome_interno": "Cerveja Heineken Garrafa 600ml",
      "descricao": "Caixa 24 unidades",
      "sigla": "CX24",
      "fator": 24,
      "unidade_base": "UN",
      "confianca": "ALTA"
    }
  ],

  "mapeamentos_confirmados": [
    {
      "nome_interno": "Cerveja Heineken Garrafa 600ml",
      "cnpj_fornecedor": "07526557000100",
      "codigo_produto_nf": "01234"
    }
  ],

  "aliases_confirmados": [
    {
      "nome_interno": "Cerveja Heineken Garrafa 600ml",
      "alias": "CERV HEINEKEN PIL 0.600 GFA CX24"
    }
  ],

  "itens_com_duvida": [
    {
      "descricao_original_nfe": "CATCHUP SACHE 8CXC192UN",
      "sugestao_nome": "Sachê de Ketchup",
      "sugestao_categoria": "Secos / mercearia",
      "sugestao_subcategoria": "Sachês e temperos",
      "confianca": "BAIXA",
      "confianca_motivo": "Embalagem ambígua: 8CXC192UN. Confirmar fator com fornecedor."
    }
  ],

  "observacoes": [
    "Produto PRESUNTO CX 6,8KG pode ser peso total ou unitário — verificar com fornecedor."
  ]
}
```

### Campos obrigatórios em `produtos_confirmados`

| Campo | Obrigatório | Descrição |
|---|---|---|
| `nome_interno` | Sim | Nome limpo em português |
| `categoria` | **Sempre** | Nome da categoria — nunca deixar vazio |
| `subcategoria` | Quando possível | Obrigatório se categoria já tiver subcats |
| `variante` | Obrigatório p/ bebidas | Garrafa 600ml, Lata 350ml, etc. |
| `unidade_estoque` | Sim | KG, UN, L, ML, G |
| `cnpj_fornecedor` | **Sempre** | 14 dígitos — copiar dos dados de entrada |
| `codigo_produto_nf` | **Sempre** | cProd — copiar dos dados de entrada |
| `confianca` | Sim | ALTA, MEDIA ou BAIXA |
| `confianca_motivo` | Sim | Explicação curta |

> **Atenção:** `categoria` é o **nome** da categoria (ex: `"Bebidas"`), não o id.
> O importador resolve o id internamente por nome.

### Campos obrigatórios em `mapeamentos_confirmados`

| Campo | Obrigatório |
|---|---|
| `nome_interno` | Sim (mesmo valor de produtos_confirmados) |
| `cnpj_fornecedor` | Sim — copiar dos dados de entrada |
| `codigo_produto_nf` | Sim — copiar dos dados de entrada |

### Campos obrigatórios em `embalagens_confirmadas`

| Campo | Obrigatório |
|---|---|
| `nome_interno` | Sim (mesmo valor de produtos_confirmados) |
| `descricao` | Sim |
| `sigla` | Sim (ex: "CX24", "FD6", "PCT5KG") |
| `fator` | Sim — número > 0 |
| `unidade_base` | Sim — KG, UN, L, ML |
| `confianca` | Sim |

---

## 11. Níveis de Confiança

| Nível | Critério | Ação do sistema |
|---|---|---|
| **ALTA** | Nome claro + categoria certa + fator explícito na NF-e + sem ambiguidade | Importação automática |
| **MEDIA** | Nome claro MAS embalagem deduzida, ou categoria inferida, ou pesquisa web usada | Fila de revisão |
| **BAIXA** | Nome ambíguo, fator desconhecido, ou produto possivelmente composto | Bloqueado até revisão manual |

---

## 12. Regras de Nomenclatura

### Ordem de prioridade para `nome_interno`

1. Nome comercial + marca → `Azeite Gallo`
2. Tipo / apresentação → `Extra Virgem`
3. Volume ou peso unitário → `500ml`

**Resultado:** `Azeite Gallo Extra Virgem 500ml`

### Exemplos corretos

| Descrição NF-e | nome_interno correto |
|---|---|
| `AZTE OLIVA GALLO EVIRG 500ML` | Azeite Gallo Extra Virgem 500ml |
| `CERV HEINEKEN PIL 0.600 GFA` | Cerveja Heineken Garrafa 600ml |
| `ARROZ TIPO 1 TIÃO JOÃO 5KG` | Arroz Tio João Tipo 1 5kg |
| `KETCHUP SACHE 8CXC192UN` | Sachê de Ketchup [Marca] |
| `AGUA MIN S/GAS 500ML CX12` | Água Mineral sem Gás 500ml |
| `REFRIGERANTE COCA COLA 2L` | Coca-Cola Garrafa 2L |

### Proibições de nomenclatura

- ❌ Usar abreviações da NF-e no nome (CERV, PIL, GFA, REFRIG, AZT)
- ❌ Repetir fornecedor ou código no nome_interno
- ❌ Usar caixa alta no nome_interno
- ❌ Chamar o produto de "Dose", "Copo", "Porção" — são produtos de venda, não de estoque

---

## 13. Embalagens e Fatores

### Conceito importante

> **`qCom` na NF-e** = quantas embalagens o restaurante comprou — **NÃO é o fator**.
> **Fator** = quantas unidades há dentro de cada embalagem.
> Exemplo: comprou 2 CX → `qCom=2`, mas `fator=24` (24 garrafas por caixa).

### Hierarquia de evidências

| Nível | Origem da evidência | confianca |
|---|---|---|
| Fator explícito na descrição do NF-e | `CX24`, `6X5KG`, `DZ`… | **ALTA** |
| Confirmado em site de atacado/fabricante | Makro, Atacadão, iFood Shop, Open Food Facts | **MEDIA** |
| Padrão de mercado consolidado no Brasil | ver tabela abaixo | **MEDIA** |
| Desconhecido após pesquisa real | nenhuma evidência encontrada | **BAIXA** → `itens_com_duvida` |

### Padrões ALTA (explícito no NF-e)

| Padrão na NF-e | Interpretação | Fator | Base |
|---|---|---|---|
| `CX24`, `CX12`, `CX6` | Caixa com N unidades | N | UN |
| `6X5KG`, `4X1,8KG` | Fardo N×M | N×M | KG |
| `DZ` | Dúzia | 12 | UN |
| `GFA`, `UN`, `KG`, `L` | Unitário | 1 | respectiva |

### Padrões de mercado MEDIA (consolidados no Brasil)

| Produto | Embalagem padrão | Fator |
|---|---|---|
| Cerveja long neck 330–355ml | CX24 | 24 |
| Cerveja garrafa 600ml | CX12 | 12 |
| Cerveja lata 350ml | CX12 | 12 |
| Refrigerante lata 350ml | CX12 | 12 |
| Água mineral 500ml | CX12 ou CX24 | 12 ou 24 |
| Vinho garrafa 750ml | CX12 | 12 |
| Red Bull / energético 250ml | CX24 | 24 |
| Dose/miniatura ≤100ml | CX24 ou CX48 | 24 ou 48 |

### Protocolo de pesquisa para embalagem

Quando o fator não está explícito no NF-e, execute nesta ordem:
1. `"[marca] [produto] caixa unidades atacado"` no Google
2. EAN no Makro, Atacadão, iFood Shop ou Carrefour
3. Site oficial do fabricante → "embalagens" ou "apresentações"
4. Open Food Facts → campos `quantity` e `packaging`

Se encontrar: `confianca: "MEDIA"` + registrar fonte em `fonte_auxiliar`.
Se não encontrar: `confianca: "BAIXA"` → `itens_com_duvida` (especifique o que pesquisou).

### Padrões BAIXA → itens_com_duvida

| Padrão | Problema |
|---|---|
| `FD`/`FARDO` sem número + sem padrão de mercado | Fator desconhecido |
| `CX 6,8KG` | Peso total da caixa ou peso unitário? |
| `8CXC192UN` e combinações atípicas | Sem evidência |
| `~`, `aprox` | Peso variável — fator: null |

### Produtos por KG

```
"ARROZ TIPO 1 5KG"           → Pacote 5kg, fator 5, base KG         (ALTA)
"PIMENTA DO REINO 4X1,8KG"  → fardo 4×1,8kg = fator 7.2, base KG   (ALTA)
"QUEIJO MUSSARELA PEÇA ~3KG" → peso variável, fator null             (MEDIA)
"FRANGO INTEIRO CX 15KG"    → pesquise: 1 frango ou caixa?          (MEDIA ou BAIXA)
"OLEO SOJA 6X900ML"         → 6 garrafas × 900ml = 5400ml           (ALTA)
```

---

## 14. Pesquisa na Internet

Faça esforço real de pesquisa **antes** de colocar um item em `itens_com_duvida`.
Pesquise tanto para **nome** quanto para **embalagem**.

### Para nome do produto
- Nome da NF-e ambíguo ou muito abreviado
- EAN presente — confirme produto exato
- Apresentação desconhecida (lata? garrafa? sachê? pote?)

### Para embalagem e fator
- Fator não explícito na descrição do NF-e
- Produto com embalagem atípica ou desconhecida

### Fontes recomendadas
- EAN → Open Food Facts, Cosmos, Barcodelookup, Google
- Embalagem → Makro, Atacadão, iFood Shop, Carrefour, site do fabricante
- Produto → `"[fabricante] [descrição parcial] atacado"` no Google

### O que a pesquisa confirma / não confirma
✅ Nome comercial, marca, tipo, volume/peso, apresentação
✅ Embalagem padrão de mercado → `confianca: "MEDIA"`
❌ Fator customizado específico desta NF-e
❌ Preço de custo
❌ Código do produto no fornecedor

### Como registrar
```json
"fonte_auxiliar": "Makro — Cerveja Heineken CX12"
"fonte_auxiliar": "Open Food Facts — EAN 7896045503852"
```

---

## 15. O que NÃO fazer

- ❌ Inventar CNPJ, EAN, código do produto ou preço de custo
- ❌ Omitir `cnpj_fornecedor` ou `codigo_produto_nf` dos arrays de saída — copie-os exatamente dos dados de entrada
- ❌ Confirmar fator de embalagem sem nenhuma evidência (NF-e ou pesquisa online) — se não há evidência: BAIXA → `itens_com_duvida`
- ❌ Usar `itens_com_duvida` como atalho para evitar pesquisa — faça esforço real primeiro
- ❌ Deixar `categoria` em branco — sempre preencher com a mais próxima
- ❌ Usar `categoria_id` numérico — usar sempre o nome da categoria em texto
- ❌ Criar fichas técnicas ou insumos para pratos, porções ou lanches
- ❌ Vincular produto de estoque a produto de venda do cardápio
- ❌ Usar preço de venda para inferir custo ou quantidade
- ❌ Gerar JSON parcial — ou tem dados suficientes e gera completo, ou pergunta antes

---

## 16. Instruções do Sistema (System Prompt para o GPT Personalizado)

Cole este texto no campo **"Instruções"** do GPT personalizado no ChatGPT.
O arquivo completo e formatado está em `docs/treinador_gpt_systemprompt_v3.txt`.

```
Você é o GPT Treinador de Notas do sistema Super Ajudante Estoque do Araçá Grill.

Sua função: analisar produtos desconhecidos de NF-e e retornar um JSON
schema_version 1.1 válido para importação no sistema.

CLASSIFICAÇÃO — três níveis:
  categoria  → subcategoria  → variante
  Bebidas    → Cervejas      → Garrafa 600ml
  Bebidas    → Águas         → Garrafa 500ml sem gás
  Câmara fria → Carnes bovinas → Peça inteira

Para bebidas: variante é OBRIGATÓRIA (Garrafa 600ml, Lata 350ml, etc.)
Categoria NUNCA pode ficar em branco. Se não tiver certeza: confianca MEDIA.

NOMENCLATURA:
  1. Nome comercial + marca
  2. Tipo / apresentação
  3. Volume ou peso unitário
  Não use abreviações da NF-e. Não repita código ou fornecedor.

CNPJ E CÓDIGO DO PRODUTO:
  Os campos cnpj_fornecedor e codigo_produto_nf JÁ VÊM PREENCHIDOS nos dados
  de entrada. Copie-os EXATAMENTE em produtos_confirmados E mapeamentos_confirmados.
  NUNCA os omita — omitir causa perda de mapeamento no sistema.

EMBALAGENS:
  CX24→fator 24 UN | 6X5KG→fator 30 KG | DZ→fator 12 UN
  Peso variável (~): fator null, confianca MEDIA
  Embalagem duvidosa: itens_com_duvida

PESQUISA NA INTERNET:
  Pesquise EAN ou fabricante quando não reconhecer o produto.
  Confirma: nome, marca, volume, apresentação.
  Não confirma: fator de embalagem, preço de custo.
  Registre em fonte_auxiliar.

CONFIANÇA (obrigatório em todos):
  ALTA  = nome claro + categoria certa + fator explícito na NF-e
  MEDIA = alguma incerteza (embalagem deduzida, pesquisa web usada)
  BAIXA = nome ambíguo ou fator desconhecido → vai para itens_com_duvida

REGRAS CRÍTICAS:
  - Gere APENAS o JSON, sem texto antes ou depois
  - Todos os arrays em ordem alfabética por nome_interno
  - Nunca gere JSON parcial — pergunte tudo em lote antes se faltar dados
  - Produtos com mesmo CNPJ+código aparecem UMA ÚNICA VEZ

FORMATO: schema_version 1.1 conforme documentação enviada.
```

---

## 17. Exemplos Completos — NF-e → JSON 1.1

### Exemplo 1: Cerveja em caixa

```
NF-e:
  cProd: 01234
  xProd: CERV HEINEKEN PIL 0.600 GFA CX24
  CNPJ fornecedor: 07526557000100
  uCom: CX | qCom: 2 | vProd: 144,00
  EAN: 7896045503852
```

```json
{
  "schema_version": "1.1",
  "tipo": "catalogo_revisado_gpt",
  "origem": "chatgpt",
  "restaurante": "Araçá Grill",
  "gerado_em": "05/06/2026 14:00",
  "produtos_confirmados": [
    {
      "nome_interno": "Cerveja Heineken Garrafa 600ml",
      "descricao_original_nfe": "CERV HEINEKEN PIL 0.600 GFA CX24",
      "categoria": "Bebidas",
      "subcategoria": "Cervejas",
      "variante": "Garrafa 600ml",
      "unidade_estoque": "UN",
      "cnpj_fornecedor": "07526557000100",
      "codigo_produto_nf": "01234",
      "ean": "7896045503852",
      "confianca": "ALTA",
      "confianca_motivo": "EAN confirmado + padrão CX24 explícito",
      "fonte_auxiliar": null
    }
  ],
  "embalagens_confirmadas": [
    {
      "nome_interno": "Cerveja Heineken Garrafa 600ml",
      "descricao": "Caixa 24 garrafas",
      "sigla": "CX24",
      "fator": 24,
      "unidade_base": "UN",
      "confianca": "ALTA"
    }
  ],
  "mapeamentos_confirmados": [
    {
      "nome_interno": "Cerveja Heineken Garrafa 600ml",
      "cnpj_fornecedor": "07526557000100",
      "codigo_produto_nf": "01234"
    }
  ],
  "aliases_confirmados": [
    {
      "nome_interno": "Cerveja Heineken Garrafa 600ml",
      "alias": "CERV HEINEKEN PIL 0.600 GFA CX24"
    }
  ],
  "itens_com_duvida": [],
  "observacoes": []
}
```

### Exemplo 2: Arroz em fardo (produto por KG)

```
NF-e:
  cProd: 00567
  xProd: ARROZ TIPO 1 TIÃO JOÃO 5KG FD6
  CNPJ fornecedor: 12345678000195
  uCom: FD | qCom: 3 | vProd: 270,00
```

```json
{
  "produtos_confirmados": [
    {
      "nome_interno": "Arroz Tio João Tipo 1 5kg",
      "descricao_original_nfe": "ARROZ TIPO 1 TIÃO JOÃO 5KG FD6",
      "categoria": "Secos / mercearia",
      "subcategoria": "Arroz e grãos",
      "variante": "Pacote 5kg",
      "unidade_estoque": "KG",
      "cnpj_fornecedor": "12345678000195",
      "codigo_produto_nf": "00567",
      "ean": null,
      "confianca": "ALTA",
      "confianca_motivo": "Peso unitário 5kg explícito + FD6 indica fardo com 6 pacotes",
      "fonte_auxiliar": null
    }
  ],
  "embalagens_confirmadas": [
    {
      "nome_interno": "Arroz Tio João Tipo 1 5kg",
      "descricao": "Pacote 5kg",
      "sigla": "PCT5KG",
      "fator": 5,
      "unidade_base": "KG",
      "confianca": "ALTA"
    },
    {
      "nome_interno": "Arroz Tio João Tipo 1 5kg",
      "descricao": "Fardo 6 pacotes (30kg)",
      "sigla": "FD6",
      "fator": 30,
      "unidade_base": "KG",
      "confianca": "ALTA"
    }
  ],
  "mapeamentos_confirmados": [
    {
      "nome_interno": "Arroz Tio João Tipo 1 5kg",
      "cnpj_fornecedor": "12345678000195",
      "codigo_produto_nf": "00567"
    }
  ],
  "aliases_confirmados": [
    {
      "nome_interno": "Arroz Tio João Tipo 1 5kg",
      "alias": "ARROZ TIPO 1 TIAO JOAO 5KG FD6"
    }
  ],
  "itens_com_duvida": [],
  "observacoes": []
}
```

### Exemplo 3: Item com dúvida de embalagem

```
NF-e:
  cProd: 00890
  xProd: CATCHUP SACHE 8CXC192UN
  CNPJ: 11111111000100
  uCom: CX | qCom: 1
```

```json
{
  "produtos_confirmados": [],
  "embalagens_confirmadas": [],
  "mapeamentos_confirmados": [],
  "aliases_confirmados": [],
  "itens_com_duvida": [
    {
      "descricao_original_nfe": "CATCHUP SACHE 8CXC192UN",
      "sugestao_nome": "Sachê de Ketchup",
      "sugestao_categoria": "Secos / mercearia",
      "sugestao_subcategoria": "Sachês e temperos",
      "confianca": "BAIXA",
      "confianca_motivo": "8CXC192UN pode ser 8 caixas × 192 sachês = 1.536 un. Confirmar fator com fornecedor."
    }
  ],
  "observacoes": ["CATCHUP SACHE 8CXC192UN: aguardando confirmação do fator de embalagem"]
}
```

---

## 18. SQL — Colunas novas (executar no Supabase SQL Editor)

```sql
-- Fase 2: subcategoria e variante (idempotente)
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS subcategoria text DEFAULT '';
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS variante text DEFAULT '';

-- Fase 6: enrichment de produto_fornecedor (idempotente)
-- Execute ANTES de usar "Reprocessar para Aprendizado"
ALTER TABLE produto_fornecedor
  ADD COLUMN IF NOT EXISTS ncm                  text    DEFAULT '',
  ADD COLUMN IF NOT EXISTS ultimo_preco_unitario numeric DEFAULT 0;
```

---

## 19. Endpoints do Backend (resumo)

| Método | Endpoint | Função |
|---|---|---|
| POST | `/api/nfe/conferir` | Baixa XML + reconhece produtos (não grava) |
| POST | `/api/nfe/confirmar` | Grava estoque + movimentações |
| POST | `/api/nfe/add-xml` | Upload XML para conferência (parse local + Meu Danfe) |
| POST | `/api/nfe/buscar` | Polling status NF-e no Meu Danfe |
| GET | `/api/admin?recurso=treino-fila-listar` | Lista esteira com stats |
| POST | `/api/admin?recurso=treino-fila-add` | Adiciona NF-e à esteira (por chave) |
| GET | `/api/admin?recurso=treino-fila-pacote` | Gera pacote completo (.txt) para ChatGPT |
| POST | `/api/admin?recurso=treino-fila-limpar` | Limpa esteira após importação |
| POST | `/api/admin?recurso=treino-importar` | Importa JSON 1.1 do ChatGPT |
| POST | `/api/admin?recurso=treino-validar` | Valida JSON antes de importar |
| POST | `/api/admin?recurso=reprocessar-aprendizado` | Reprocessa XMLs armazenados para enriquecer produto_fornecedor |
| GET | `/api/admin?recurso=auditoria-cadastro` | Auditoria: sem categoria, sem mapeamento, duplicados, etc. |
| GET/POST | `/api/admin?recurso=categorias` | CRUD categorias |
| GET/POST | `/api/admin?recurso=embalagens` | CRUD embalagens |
| POST | `/api/admin?recurso=produto-editar` | Edita campos do produto |
| POST | `/api/admin?recurso=entrada` | Entrada manual de estoque |
| GET | `/api/admin?recurso=produto-historico` | Últimas 20 movimentações |
| POST | `/api/admin?recurso=produto-excluir` | Exclui ou inativa produto |

---

## 20. Variáveis de Ambiente (Vercel)

| Variável | Obrigatória | Descrição |
|---|---|---|
| `API_KEY_MEU_DANFE` | Sim | Chave API Meu Danfe v2 |
| `SUPABASE_URL` | Sim | URL do projeto Supabase |
| `SUPABASE_SERVICE_KEY` | Sim | Chave `service_role` — NUNCA exposta ao frontend |
| `NOME_RESTAURANTE` | Não | Default: "Araçá Grill" (tabela Configuracoes) |
| `CNPJ_RESTAURANTE` | Não | CNPJ do restaurante (14 dígitos, tabela Configuracoes) |

---

## 21. Auditoria de Cadastro

O botão **Auditoria de Cadastro** executa 8 verificações sobre todos os produtos ativos:

| Tipo de alerta | Critério |
|---|---|
| `sem_categoria` | Produto sem categoria válida |
| `sem_mapeamento` | Produto sem `cnpj_fornecedor` E sem entrada em `produto_fornecedor` |
| `sem_embalagem` | Produto sem nenhuma embalagem cadastrada |
| `cnpj_codigo_duplicado` | Mesmo CNPJ+código mapeado para dois produtos distintos |
| `alias_produto_invalido` | Alias apontando para produto inexistente ou inativo |
| `fornecedor_sem_cnpj` | Fornecedor cadastrado sem CNPJ |
| `unidade_suspeita` | Nome do produto indica unidade diferente da cadastrada |
| `possivel_duplicado` | Dois produtos com nomes similares na mesma categoria |

**"sem mapeamento" = produto não será reconhecido em NF-es futuras.**
Para corrigir: use "Reprocessar para Aprendizado" com os XMLs das notas originais.

---

## 22. O que NÃO está implementado (fase futura)

| Item | Status |
|---|---|
| Fila de revisão por confiança ALTA/MEDIA/BAIXA na tela de treinamento | Pendente |
| Vínculo produto de estoque ↔ produto de venda (bebidas prontas) | Pendente |
| Ficha técnica de pratos e porções | Pendente |
| CMV automático de pratos | Pendente |
| Tela de gestão de subcategorias (tabela própria) | Pendente |
| Pesquisa automática de EAN por API | Pendente |
| Importação do cardápio ChefWeb | Pendente |

---

*Documento atualizado em 2026-06-05 — Super Ajudante Estoque v3.0*
*Substitui completamente a versão anterior (v2.1, 2026-06-02)*
