# Documentação Técnica — Treinador de Notas: Super Ajudante Estoque
**Versão 2.1 — atualizada em 2026-06-02**

---

## 1. Visão Geral do Sistema

**Super Ajudante Estoque** é um sistema web/Android de gestão de estoque para o restaurante Araçá Grill. Recebe notas fiscais eletrônicas (NF-e) via chave de acesso, faz o parser do XML, identifica produtos pelo banco de dados interno e lança entradas de estoque com custo médio ponderado.

**Stack:**
- Frontend: SPA em `public/index.html` (JS vanilla + fetch)
- Backend: Vercel Serverless Functions (Node.js ESM)
- Banco: Supabase (PostgreSQL, acesso via `service_role` key)
- NF-e: API Meu Danfe v2 (adicionar chave + baixar XML)
- App nativo: Capacitor 5 (Android)

**Limite Vercel Hobby — 12 funções serverless.**
Novos endpoints NUNCA criam novos arquivos em `api/` — são multiplexados via `?recurso=` em `admin.js`.

---

## 2. Arquivos do Backend

```
api/
├── _lib/
│   ├── db.js            — CRUD Supabase (readRows, appendRow, updateRow, nextId, readConfig)
│   ├── meudanfe.js      — Cliente API Meu Danfe (addNfe, getXml, getStatus)
│   ├── parser.js        — Parser XML NF-e + normalizarDesc()
│   ├── util.js          — Helpers HTTP + rate limiting por chave
│   ├── estoque.js       — Lógica de entrada de estoque (custo médio ponderado)
│   └── reconhecimento.js — 5 estratégias de reconhecimento de produto
├── admin.js             — CRUD administrativo + rotas de treinamento (?recurso=)
├── estoque/
│   ├── saida.js         — Baixa de estoque
│   └── inventario.js    — Inventário (contagem vs. estoque atual)
├── nfe/
│   ├── conferir.js      — Baixa XML + parser + reconhecimento (NÃO grava)
│   ├── confirmar.js     — Grava estoque + contas a pagar
│   └── buscar.js        — Busca/polling status NF-e no Meu Danfe
├── movimentacoes.js     — Histórico de movimentações
├── dashboard.js         — Estatísticas para o painel principal
├── produtos.js          — Listagem de produtos
├── fornecedores.js      — CRUD de fornecedores
├── contas.js            — CRUD de contas a pagar
└── teste.js             — Health check
```

---

## 3. Tabelas do Supabase

### Tabela `produtos`

| Coluna | Tipo | Descrição |
|---|---|---|
| `id_produto` | text PK | Ex: "PRD001" |
| `nome_interno` | text | Nome limpo usado no restaurante |
| `categoria_id` | text | FK → categorias.id_categoria |
| `subcategoria` | text | Segundo nível (ex: "Cervejas garrafa") |
| `variante` | text | Terceiro nível (ex: "Garrafa 600ml") |
| `unidade_estoque` | text | KG, UN, L, ML, G |
| `codigo_barras_unitario` | text | EAN da unidade individual |
| `codigo_barras` | text | EAN da NF-e |
| `codigo_produto_nf` | text | Código cProd do fornecedor |
| `cnpj_fornecedor` | text | CNPJ principal (14 dígitos) |
| `descricao_original_nf` | text | Descrição bruta da NF-e |
| `unidade_compra` | text | Unidade como vem na NF-e (CX, KG, DZ…) |
| `estoque_atual` | numeric | Quantidade em unidade_estoque |
| `estoque_minimo` | numeric | Alerta quando abaixo |
| `custo_medio` | numeric | Custo médio ponderado atual |
| `ultimo_custo_unitario` | numeric | Custo da última compra |
| `preco_venda` | numeric | Informativo (não altera estoque) |
| `confirmado` | text | 'SIM' = curado; 'NAO' = importado sem revisão |
| `ativo` | text | 'SIM'/'NAO' |
| `observacoes` | text | Anotações livres |
| `criado_em` | text | ISO 8601 |
| `atualizado_em` | text | ISO 8601 |

### Tabela `categorias`

| Coluna | Tipo | Descrição |
|---|---|---|
| `id_categoria` | text PK | Ex: "CAT001" |
| `nome_categoria` | text | Ex: "Bebidas" |

> **Subcategorias e variantes NÃO têm tabela própria** — são campos de texto em `produtos`. Quando o ChatGPT sugere uma nova subcategoria ou variante, ela é criada automaticamente.

### Tabela `Embalagens`

| Coluna | Tipo | Descrição |
|---|---|---|
| `id_embalagem` | text PK | UUID |
| `id_produto` | text | FK → produtos |
| `descricao` | text | Ex: "Caixa com 24 unidades" |
| `sigla` | text | Ex: "CX24" |
| `fator` | numeric | Multiplicador: 1 CX24 = 24 UN |
| `unidade_base` | text | Unidade base: "UN", "KG", "L" |
| `ativo` | text | 'SIM'/'NAO' |
| `criado_em` / `atualizado_em` | text | ISO 8601 |

### Tabela `Produto_Fornecedor`

| Coluna | Tipo | Descrição |
|---|---|---|
| `id_pf` | text PK | UUID |
| `id_produto` | text | FK → produtos |
| `cnpj_fornecedor` | text | 14 dígitos sem formatação |
| `nome_fornecedor` | text | Razão social |
| `codigo_produto_nf` | text | cProd da NF-e |
| `ean` | text | EAN do item na NF-e |
| `descricao_normalizada` | text | normalizarDesc(descricao_original) |
| `ativo` | text | 'SIM'/'NAO' |

### Tabela `Aliases_Produto`

| Coluna | Tipo | Descrição |
|---|---|---|
| `id_alias` | text PK | UUID |
| `id_produto` | text | FK → produtos |
| `alias` | text | Nome alternativo normalizado |
| `ativo` | text | 'SIM'/'NAO' |

### Tabelas da Esteira de Treinamento

| Tabela | Descrição |
|---|---|
| `Treino_Fila` | NF-es adicionadas à esteira aguardando treinamento |
| `Treino_Itens` | Itens desconhecidos extraídos das NF-es da fila |

---

## 4. Hierarquia de Classificação de Produtos

O sistema usa **três níveis** de classificação, todos em campos de texto livre:

```
Categoria (obrigatória)
  └── Subcategoria (obrigatória quando possível)
        └── Variante (obrigatória para bebidas; recomendada nos demais)
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
        ├── Garrafa 1L     → Coca-Cola 1L
        └── Lata 350ml     → Coca-Cola Lata
  └── Águas
        ├── Garrafa 500ml sem gás
        ├── Garrafa 500ml com gás
        └── Galão 20L

Câmara fria
  └── Carnes bovinas
        ├── Peça inteira   → Contra-filé peça, Alcatra peça
        └── Porcionado     → Picanha fatiada
  └── Frios e embutidos
        └── (sem variante necessária se houver poucas opções)

Secos / mercearia
  └── Óleos e gorduras
        └── (variante vazia — marcas diferentes, mesmo formato)
  └── Arroz e grãos
        ├── Pacote 5kg     → Arroz Tio João Tipo 1 5kg
        └── Saco 25kg      → Arroz Tipo 1 Saco 25kg
```

### Regras de classificação

1. **Nunca deixar categoria em branco.** Se não tiver certeza, use a mais próxima com `confianca: "MEDIA"`.
2. **Subcategoria obrigatória** quando existirem 3 ou mais produtos na mesma categoria.
3. **Variante obrigatória para bebidas.** Para outros produtos, usar quando houver formatos físicos distintos (Pacote 5kg vs Saco 25kg).
4. **Não criar categoria nova** se uma existente servir. Só criar se nenhuma couber.

---

## 5. Reconhecimento de Produtos (5 estratégias)

Executadas em ordem em `conferir.js` e `confirmar.js`. Para na primeira que encontrar match.

| Estratégia | Critério |
|---|---|
| 0 — id_produto direto | `id_produto` fornecido explicitamente |
| 1 — CNPJ+código ou EAN | `cnpj_fornecedor` + `codigo_produto_nf` na tabela `produtos`, ou `codigo_barras_unitario` |
| 2 — Mapeamento CNPJ+código | Tabela `Produto_Fornecedor`: CNPJ + código |
| 3 — Mapeamento EAN | Tabela `Produto_Fornecedor`: EAN |
| 4 — Mapeamento descrição | Tabela `Produto_Fornecedor`: CNPJ + normalizarDesc(descricao) |
| 5 — Alias | Tabela `Aliases_Produto`: normalizarDesc(alias) == normalizarDesc(descricao_item) |

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
- `"Queijo Minas Frescal"` → `"QUEIJO MINAS FRESCAL"`

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

O workflow atual usa uma fila (Esteira) que acumula múltiplas NF-es antes de enviar ao ChatGPT.

```
1. Usuário adiciona chave(s) de NF-e à Esteira
   (aba Treinamento → Passo 1)
   ↓
2. Sistema baixa XML, identifica produtos novos, agrupa por CNPJ+código
   ↓
3. Usuário clica "📤 Compartilhar / Baixar pacote (.txt)"
   → No Android: abre menu nativo (WhatsApp, e-mail, Arquivos)
   → No browser: baixa arquivo .txt
   ↓
4. Usuário cola o conteúdo do arquivo no ChatGPT personalizado
   ↓
5. ChatGPT retorna JSON schema_version 1.1
   ↓
6. Usuário cola o JSON no campo "Passo 3" do app e clica Importar
   ↓
7. Sistema importa: cria/atualiza produtos, embalagens, mapeamentos, aliases
```

---

## 9. Formato do Pacote enviado ao ChatGPT

O arquivo gerado pelo app tem 13 seções numeradas. As seções dinâmicas mais importantes são:

**[9] CATEGORIAS E SUBCATEGORIAS DO SISTEMA** — lista todas as categorias e subcategorias já cadastradas, em ordem alfabética, para que o ChatGPT escolha dentro delas e só crie nova quando necessário.

**[10] PRODUTOS JÁ CADASTRADOS** — amostra de até 40 produtos confirmados com categoria, subcategoria, variante e unidade, para referência de nomenclatura.

**[11] PRODUTOS DESCONHECIDOS** — os itens desta esteira que precisam ser identificados.

---

## 10. Formato do JSON de Saída (schema_version 1.1)

**Este é o único formato aceito pelo importador.** O ChatGPT deve produzir exatamente este JSON.

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
      "cnpj_fornecedor": "00000000000000",
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
      "cnpj_fornecedor": "00000000000000",
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
      "confianca_motivo": "Embalagem ambígua: 8 caixas × 192 un = 1.536? Confirmar fator."
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
| `categoria` | **Sempre** | Nunca deixar vazio |
| `subcategoria` | Quando possível | Obrigatório se categoria já tiver subcats |
| `variante` | Obrigatório p/ bebidas | Garrafa 600ml, Lata 350ml, etc. |
| `unidade_estoque` | Sim | KG, UN, L, ML, G |
| `cnpj_fornecedor` | Sim | 14 dígitos sem formatação |
| `codigo_produto_nf` | Sim | cProd da NF-e |
| `confianca` | Sim | ALTA, MEDIA ou BAIXA |
| `confianca_motivo` | Sim | Explicação curta |

### Campos opcionais mas recomendados

| Campo | Quando usar |
|---|---|
| `ean` | Quando o EAN veio na NF-e ou foi confirmado online |
| `fonte_auxiliar` | Quando usou pesquisa na internet |
| `descricao_original_nfe` | Sempre que disponível |

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
| `FRANGO CONGELADO CX 20KG` | Frango Inteiro Congelado |
| `REFRIGERANTE COCA COLA 2L` | Coca-Cola Garrafa 2L |
| `AGUA MIN S/GAS 500ML CX12` | Água Mineral sem Gás 500ml |

### Proibições de nomenclatura

- ❌ Usar abreviações da NF-e no nome (CERV, PIL, GFA, REFRIG, AZT)
- ❌ Repetir fornecedor ou código no nome_interno
- ❌ Usar caixa alta (o sistema não exige, mas nomes mistos são mais legíveis)
- ❌ Chamar o produto de "Dose", "Copo", "Porção" — esses são produtos de venda, não de estoque

---

## 13. Embalagens e Fatores

### Padrões reconhecíveis automaticamente (confianca ALTA)

| Padrão na NF-e | Interpretação | Fator | Base |
|---|---|---|---|
| `CX24`, `CX12`, `CX6` | Caixa com N unidades | N | UN |
| `6X5KG`, `4X1,8KG` | Fardo N×M: fator = N×M | N×M | KG |
| `DZ` | Dúzia | 12 | UN |
| `GFA` | Garrafa unitária | 1 | UN |
| `L`, `KG`, `UN` | Unidade base | 1 | respectiva |

### Padrões que exigem dúvida (confianca MEDIA ou BAIXA)

| Padrão | Problema |
|---|---|
| `FD` ou `FARDO` sem número | Fator desconhecido |
| `PAC6`, `PCT6` | Pacote com 6 — mas de quantos kg cada? |
| `CX 6,8KG` | Peso total da caixa ou peso unitário? |
| `8CXC192UN` | 8 caixas × 192 un = 1.536? |
| `~`, `aprox` | Peso variável — fator: null |

### Produtos vendidos por KG — atenção especial

Quando `unidade_estoque` for KG, extraia o peso unitário da descrição:

```
"ARROZ TIPO 1 5KG"         → embalagem: Pacote 5kg, fator 5, base KG
"PIMENTA DO REINO 4X1,8KG" → fardo 4 potes × 1,8kg = fator 7.2, base KG
"QUEIJO MUSSARELA PEÇA ~3KG"→ peso variável: fator null, confianca MEDIA
"FRANGO INTEIRO CX 15KG"   → 1 frango de ~15kg OU caixa com vários? → dúvida
"OLEO SOJA 6X900ML"        → fardo 6 garrafas × 900ml = fator 5400, base ML
```

---

## 14. Pesquisa na Internet

### Quando pesquisar

- O nome da NF-e é ambíguo ou muito abreviado
- O EAN está presente e você quer confirmar o produto exato
- Não sabe a apresentação (lata? garrafa? sachê? pote?)

### Como pesquisar

- EAN → Open Food Facts, Cosmos, Barcodelookup, Google
- Produto → `"[fabricante] [descrição parcial]"` no Google
- Verificar site do fabricante ou grandes distribuidoras

### O que a pesquisa confirma

✅ Nome comercial, marca, tipo, volume/peso, apresentação

### O que a pesquisa NUNCA confirma

❌ Fator de embalagem específico da NF-e (pode ser embalagem customizada)
❌ Preço de custo
❌ Código do produto no fornecedor

### Como registrar

```json
"fonte_auxiliar": "Open Food Facts — EAN 7896045503852"
```

---

## 15. O que NÃO fazer

- ❌ Inventar CNPJ, EAN, código do produto ou preço de custo
- ❌ Inventar fator de embalagem sem evidência explícita na NF-e
- ❌ Deixar `categoria` em branco — sempre preencher com a mais próxima
- ❌ Criar fichas técnicas ou insumos para pratos, porções ou lanches
- ❌ Vincular produto de estoque a produto de venda do cardápio
- ❌ Usar preço de venda para inferir custo ou quantidade
- ❌ Gerar JSON parcial — ou tem dados suficientes e gera completo, ou pergunta antes
- ❌ Aceitar fator por internet sem evidência na NF-e

---

## 16. Instruções do Sistema (System Prompt para o GPT Personalizado)

Cole este texto no campo **"Instruções"** do GPT personalizado no ChatGPT:

```
Você é o Assistente de Catálogo do Super Ajudante Estoque do Araçá Grill.

Sua função: analisar produtos desconhecidos de NF-e e retornar um JSON
schema_version 1.1 válido para importação no sistema.

CLASSIFICAÇÃO — três níveis obrigatórios:
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

EMBALAGENS:
  CX24→fator 24 UN | 6X5KG→fator 30 KG | DZ→fator 12 UN
  Peso variável (~): fator null, confianca MEDIA
  Embalagem duvidosa (FD sem número, CX 6,8KG): itens_com_duvida

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
  - Produtos com mesmo CNPJ+código: aparecem UMA ÚNICA VEZ

FORMATO DE SAÍDA: schema_version 1.1 conforme documentação enviada.
```

---

## 17. Exemplos Completos — NF-e → JSON 1.1

### Exemplo 1: Cerveja em caixa

```
NF-e:
  cProd: 01234
  xProd: CERV HEINEKEN PIL 0.600 GFA CX24
  CNPJ fornecedor: 07526557000100
  uCom: CX
  qCom: 2
  vProd: 144,00
  EAN: 7896045503852
```

```json
{
  "schema_version": "1.1",
  "tipo": "catalogo_revisado_gpt",
  "origem": "chatgpt",
  "restaurante": "Araçá Grill",
  "gerado_em": "02/06/2026 14:00",
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
  uCom: FD
  qCom: 3
  vProd: 270,00
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
  uCom: CX
  qCom: 1
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
      "confianca_motivo": "Embalagem ambígua: 8CXC192UN pode ser 8 caixas × 192 sachês = 1.536 un, ou outra combinação. Confirmar fator com fornecedor."
    }
  ],
  "observacoes": ["CATCHUP SACHE 8CXC192UN: aguardando confirmação do fator de embalagem"]
}
```

---

## 18. SQL — Colunas novas (executar no Supabase SQL Editor)

```sql
-- Colunas adicionadas após Fase 2 (idempotente — seguro rodar novamente)
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS subcategoria text DEFAULT '';
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS variante text DEFAULT '';
```

---

## 19. Endpoints do Backend (resumo)

| Método | Endpoint | Função |
|---|---|---|
| POST | `/api/nfe/conferir` | Baixa XML + reconhece produtos (não grava) |
| POST | `/api/nfe/confirmar` | Grava estoque + movimentações |
| POST | `/api/nfe/buscar` | Polling status NF-e no Meu Danfe |
| GET | `/api/admin?recurso=treino-fila-listar` | Lista esteira com stats |
| POST | `/api/admin?recurso=treino-fila-add` | Adiciona NF-e à esteira |
| GET | `/api/admin?recurso=treino-fila-pacote` | Gera pacote completo para ChatGPT |
| POST | `/api/admin?recurso=treino-fila-limpar` | Limpa esteira após importação |
| POST | `/api/admin?recurso=treino-importar` | Importa JSON 1.1 do ChatGPT |
| POST | `/api/admin?recurso=treino-validar` | Valida JSON antes de importar |
| GET/POST | `/api/admin?recurso=categorias` | CRUD categorias |
| GET/POST | `/api/admin?recurso=embalagens` | CRUD embalagens |
| POST | `/api/admin?recurso=produto-editar` | Edita campos do produto |
| POST | `/api/admin?recurso=entrada` | Entrada manual de estoque |
| GET | `/api/admin?recurso=produto-historico` | Últimas 20 movimentações |

---

## 20. Variáveis de Ambiente (Vercel)

| Variável | Obrigatória | Descrição |
|---|---|---|
| `API_KEY_MEU_DANFE` | Sim | Chave API Meu Danfe v2 |
| `SUPABASE_URL` | Sim | URL do projeto Supabase |
| `SUPABASE_SERVICE_KEY` | Sim | Chave `service_role` |
| `NOME_RESTAURANTE` | Não | Default: "Araçá Grill" (tabela Configuracoes) |

---

## 21. O que NÃO está implementado (fase futura)

| Item | Status |
|---|---|
| Fila de revisão por confiança (ALTA/MEDIA/BAIXA) na tela de treinamento | Pendente |
| Importação do cardápio ChefWeb | Pendente |
| Vínculo produto de estoque ↔ produto de venda (bebidas prontas) | Pendente |
| Ficha técnica de pratos e porções | Pendente |
| CMV automático de pratos | Pendente |
| Tela de gestão de subcategorias (tabela própria) | Pendente |
| Auditoria de importações (log treino_importacoes) | Pendente |
| Pesquisa automática de EAN por API | Pendente |

---

*Documento atualizado em 2026-06-02 — Super Ajudante Estoque v2.1*
*Substitui completamente a versão anterior (Fase 2, 01/06/2026)*
