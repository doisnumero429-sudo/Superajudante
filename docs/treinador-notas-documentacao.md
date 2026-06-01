# Documentação Técnica — Treinador de Notas: Super Ajudante Estoque

---

## 1. Visão Geral do Sistema

**Super Ajudante Estoque** é um sistema web/Android de gestão de estoque para restaurantes. Recebe notas fiscais eletrônicas (NF-e) via chave de acesso, faz o parser do XML, identifica os produtos pelo banco de dados interno e lança entradas de estoque com custo médio ponderado.

**Stack:**
- Frontend: SPA em `public/index.html` (JS vanilla + fetch)
- Backend: Vercel Serverless Functions (Node.js ESM, `type: module`)
- Banco: Supabase (PostgreSQL, acesso via `service_role` key)
- NF-e: API Meu Danfe v2 (adicionar chave + baixar XML)
- App nativo: Capacitor 5 (Android), geração de APK via GitHub Actions

**Plano Vercel Hobby — limite de 12 funções serverless:**
Arquivos em `api/` (exceto `api/_lib/`) contam como funções. O projeto usa exatamente 12/12. Novos endpoints NUNCA devem criar novos arquivos em `api/` — devem ser multiplexados via `?recurso=` em arquivos existentes.

---

## 2. Arquivos do Backend

```
api/
├── _lib/
│   ├── db.js          — CRUD Supabase (readRows, writeRow, updateRow, deleteRow, readConfig)
│   ├── meudanfe.js    — Cliente API Meu Danfe (addNfe, getXml, getStatus)
│   ├── parser.js      — Parser XML NF-e + normalizarDesc() + descreverFormaPagamento()
│   ├── util.js        — Helpers HTTP (json, preflight, validarChave, readBody)
│   └── estoque.js     — Lógica compartilhada de entrada de estoque (custo médio)
├── admin.js           — CRUD administrativo + 5 rotas de treinamento (recurso=)
├── estoque/
│   ├── saida.js       — Baixa de estoque (saída)
│   └── inventario.js  — Inventário híbrido (contagem vs. estoque atual)
├── nfe/
│   ├── conferir.js    — Baixa XML + parser + reconhecimento de produtos (NÃO grava)
│   └── confirmar.js   — Grava estoque + contas a pagar + produto_fornecedor
├── movimentacoes.js   — Histórico de movimentações com filtros
├── produtos.js        — CRUD de produtos
├── fornecedores.js    — CRUD de fornecedores
├── contas.js          — CRUD de contas a pagar
└── teste.js           — Health check (env vars, Supabase, Meu Danfe)
```

---

## 3. Tabelas do Supabase

### Tabelas originais (Fase 1)

| Tabela | PK | Descrição |
|---|---|---|
| `Produtos` | `id_produto` | Catálogo interno de ingredientes/itens |
| `Categorias` | `id_categoria` | Categorias de produto (Laticínios, Carnes, etc.) |
| `Movimentacoes` | `id_mov` | Histórico completo de movimentações |
| `Contas_Pagar` | `id_conta` | Parcelas/contas geradas a partir de NF-e |
| `Configuracoes` | `chave` | Par chave/valor (CNPJ_RESTAURANTE, etc.) |
| `Fornecedores` | `id_fornecedor` | Cadastro de fornecedores |
| `Notas_Fiscais` | `id_nf` | Cabeçalho de NF-e confirmadas |

### Tabelas novas — Fase 2 (schema_fase2.sql)

#### `embalagens`
Múltiplas embalagens por produto (UN, CX6, CX12, CX24, etc.)

| Coluna | Tipo | Descrição |
|---|---|---|
| `id_embalagem` | text PK | UUID gerado pelo backend |
| `id_produto` | text | FK → Produtos.id_produto |
| `descricao` | text | Ex: "Caixa com 12 unidades" |
| `sigla` | text | Ex: "CX12" |
| `fator` | numeric | Multiplicador: 1 CX12 = 12 UN |
| `unidade_base` | text | Unidade do estoque: "UN", "KG", "L" |
| `permite_entrada` | text | 'SIM'/'NAO' |
| `permite_saida` | text | 'SIM'/'NAO' |
| `permite_inventario` | text | 'SIM'/'NAO' |
| `padrao_entrada` | text | 'SIM'/'NAO' — pré-selecionado no form |
| `padrao_saida` | text | 'SIM'/'NAO' |
| `padrao_inventario` | text | 'SIM'/'NAO' |
| `ativo` | text | 'SIM'/'NAO' |
| `criado_em` | text | ISO 8601 |
| `atualizado_em` | text | ISO 8601 |

#### `produto_fornecedor`
Mapeamento produto interno ↔ código/descrição do fornecedor na NF-e

| Coluna | Tipo | Descrição |
|---|---|---|
| `id_pf` | text PK | UUID |
| `id_produto` | text | FK → Produtos |
| `cnpj_fornecedor` | text | Apenas dígitos (14 chars) |
| `nome_fornecedor` | text | Nome da empresa emitente |
| `codigo_produto_nf` | text | Código cProd da NF-e |
| `ean` | text | Código EAN/GTIN |
| `descricao_original` | text | Descrição literal da NF-e |
| `descricao_normalizada` | text | normalizarDesc(descricao_original) |
| `unidade_nf` | text | Unidade da NF-e (CX, UN, KG…) |
| `confirmado_pelo_usuario` | text | 'SIM'/'NAO' |
| `origem_confirmacao` | text | 'nfe', 'treino', 'manual' |
| `vezes_utilizado` | numeric | Incrementado em cada NF-e confirmada |
| `ultima_utilizacao` | text | ISO 8601 da última confirmação |
| `ativo` | text | 'SIM'/'NAO' |
| `criado_em` | text | ISO 8601 |
| `atualizado_em` | text | ISO 8601 |

#### `aliases_produto`
Nomes alternativos/cardápio para reconhecimento por descrição

| Coluna | Tipo | Descrição |
|---|---|---|
| `id_alias` | text PK | UUID |
| `id_produto` | text | FK → Produtos |
| `alias` | text | Nome alternativo (ex: "OVOS BRANCOS GRANDES") |
| `origem` | text | 'manual', 'treino', 'nfe' |
| `ativo` | text | 'SIM'/'NAO' |
| `criado_em` | text | ISO 8601 |

#### `treino_importacoes`
Log de cada importação de JSON treinado

| Coluna | Tipo | Descrição |
|---|---|---|
| `id_importacao` | text PK | UUID |
| `criado_em` | text | ISO 8601 |
| `origem` | text | 'chatgpt', 'manual' |
| `resumo` | text | Texto livre descrevendo a importação |
| `json_original` | text | JSON completo importado (para auditoria) |
| `status` | text | 'ok', 'parcial', 'erro' |
| `produtos_criados` | numeric | Contagem |
| `mapeamentos_criados` | numeric | Contagem (produto_fornecedor) |
| `embalagens_criadas` | numeric | Contagem |
| `aliases_criados` | numeric | Contagem |
| `conflitos` | numeric | Produtos que já existiam confirmados |
| `erros` | text | JSON com lista de erros por item |

### Coluna adicionada a `Produtos`

| Coluna | Tipo | Default | Descrição |
|---|---|---|---|
| `confirmado` | text | 'NAO' | 'SIM' = curado pelo usuário; 'NAO' = importado automaticamente sem revisão |

---

## 4. Reconhecimento de Produtos (3 estratégias)

Executadas em ordem em `conferir.js` e `confirmar.js`. Para na primeira que encontrar match.

### Estratégia 1 — Direto em `Produtos`
```
CNPJ do fornecedor + codigo_produto_nf  →  produtos.cnpj_fornecedor + produtos.codigo_produto_nf
OU
EAN do item  →  produtos.codigo_barras
```

### Estratégia 2 — Tabela `produto_fornecedor`
```
(ativo='SIM') AND (
  CNPJ + codigo_produto_nf
  OR EAN
  OR CNPJ + normalizarDesc(descricao) == descricao_normalizada
)
→ retorna id_produto → busca em Produtos
```

### Estratégia 3 — Tabela `aliases_produto`
```
(ativo='SIM') AND normalizarDesc(alias) == normalizarDesc(descricao_item)
→ retorna id_produto → busca em Produtos
```

**Fallback:** item retorna com `produto_novo: true`, `id_produto: ''`. O usuário preenche na tela de Conferência antes de confirmar.

**Graceful degradation:** leituras de `Produto_Fornecedor` e `Aliases_Produto` em `conferir.js` são envolvidas em `try/catch`. Se as tabelas não existirem (SQL da Fase 2 não executado), o fluxo continua normalmente.

---

## 5. Função `normalizarDesc(s)`

```javascript
// api/_lib/parser.js
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

**Exemplos:**
- `"Leite Integral UHT 1L"` → `"LEITE INTEGRAL UHT 1L"`
- `"ÓLEO DE SOJA 900ml"` → `"OLEO DE SOJA 900ML"`
- `"Frango Congelado (kg)"` → `"FRANGO CONGELADO KG"`
- `"Queijo Minas Frescal"` → `"QUEIJO MINAS FRESCAL"`

---

## 6. Cálculo de Custo Médio Ponderado

Implementado em `api/_lib/estoque.js`, reutilizado por `confirmar.js` e `admin.js` (entrada manual).

```
novoEstoque    = estoqueAtual + qtdBase
novoCustoMedio = (estoqueAtual × custoMedioAnterior + qtdBase × custoUnitario) / novoEstoque

Se novoEstoque == 0: novoCustoMedio = custoUnitario
```

**Exemplo prático:**
```
Produto: Leite Integral
Estoque atual: 24 L
Custo médio atual: R$ 4,20/L

NF-e nova:
  Quantidade NF: 2 CX (caixas com 12L cada)
  Valor total NF: R$ 96,00
  Fator conversão: 12 (1 CX = 12L)
  qtdBase = 2 × 12 = 24L
  custoUnit = 96 / 24 = R$ 4,00/L

Cálculo:
  novoEstoque = 24 + 24 = 48L
  novoCustoMedio = (24 × 4,20 + 24 × 4,00) / 48
                 = (100,80 + 96,00) / 48
                 = 196,80 / 48
                 = R$ 4,10/L
```

---

## 7. Endpoints do Backend

### `POST /api/nfe/conferir`

**Request:**
```json
{ "chave": "35240312345678000195550010000001231000000121" }
```

**Response 200:**
```json
{
  "chave": "...",
  "nota": { "numero": "123", "serie": "1", "data_emissao": "2024-03-15", "valor_total_nota": 1250.00 },
  "fornecedor": { "cnpj": "12345678000195", "nome": "Distribuidora X" },
  "destinatario": { "cnpj": "98765432000111", "nome": "Restaurante Y" },
  "totais": { "produtos": 1200.00, "icms": 50.00 },
  "itens": [
    {
      "descricao_original": "LEITE INTEGRAL UHT 1L CX12",
      "codigo_produto_nf": "001",
      "codigo_barras": "7891234567890",
      "unidade_nf": "CX",
      "quantidade_nf": 2,
      "valor_unitario_nf": 48.00,
      "valor_total_nf": 96.00,
      "fator_conversao": 12,
      "unidade_estoque": "L",
      "quantidade_estoque": 24,
      "custo_unitario_estoque": 4.00,
      "id_produto": "uuid-leite",
      "nome_interno": "Leite Integral",
      "categoria_id": "uuid-latic",
      "produto_novo": false
    }
  ],
  "parcelas": [ { "numero_parcela": "1/2", "vencimento": "2024-04-15", "valor": 625.00, "forma_pagamento": "BOLETO", "status": "ABERTO" } ],
  "alertaDestinatario": null,
  "xml": "<nfeProc>...</nfeProc>"
}
```

---

### `POST /api/nfe/confirmar`

**Request:**
```json
{
  "chave": "35240312345678000195550010000001231000000121",
  "xml": "<nfeProc>...</nfeProc>",
  "itens": [],
  "parcelas": [],
  "nota": {},
  "fornecedor": {}
}
```

**Itens já reconhecidos** (`produto_novo: false`): grava estoque + movimentação + produto_fornecedor.

**Itens novos** (`produto_novo: true`, usuário preencheu `nome_interno` e `categoria_id`): cria produto em `Produtos` com `confirmado='NAO'`, grava estoque + produto_fornecedor.

**Itens sem `id_produto`**: ignorados (pula silenciosamente).

**Response 200:**
```json
{
  "ok": true,
  "nota_id": "uuid",
  "produtos_atualizados": 5,
  "produtos_criados": 1,
  "parcelas_geradas": 2
}
```

---

### `POST /api/admin?recurso=entrada` — Entrada Manual

**Request:**
```json
{
  "id_produto": "uuid-produto",
  "quantidade": 2,
  "embalagem": "CX12",
  "fator": 12,
  "custo_unitario": 4.00,
  "data": "2024-03-15",
  "observacao": "Compra avulsa",
  "usuario": "Chef João"
}
```

- `quantidade` em unidades da embalagem selecionada
- `fator` converte para unidade base: `qtdBase = quantidade × fator`
- `custo_unitario` em R$ por unidade BASE do estoque
- Se `embalagem` não fornecida, usa `fator: 1` (quantidade já está na unidade base)

**Response 200:**
```json
{
  "ok": true,
  "produto": "Leite Integral",
  "quantidade_base": 24,
  "unidade": "L",
  "estoque_anterior": 24,
  "estoque_atual": 48,
  "custo_medio": 4.10
}
```

---

### `POST /api/estoque/saida`

**Request:**
```json
{
  "id_produto": "uuid-produto",
  "quantidade": 1,
  "embalagem": "CX6",
  "fator": 6,
  "data": "2024-03-15",
  "observacao": "Uso na produção",
  "usuario": "Chef João"
}
```

**Response 200:**
```json
{
  "ok": true,
  "quantidade_baixada": 6,
  "estoque_anterior": 48,
  "estoque_atual": 42,
  "alerta_negativo": false
}
```

---

### `GET /api/admin?recurso=treino-contexto` — Exportar Contexto

Retorna o JSON completo do sistema para o ChatGPT treinar:

```json
{
  "exportado_em": "2024-03-15T10:30:00.000Z",
  "versao": "2.0",
  "instrucoes": "...",
  "produtos": [
    {
      "id_produto": "uuid",
      "nome_interno": "Leite Integral",
      "categoria": "Laticínios",
      "unidade_estoque": "L",
      "embalagens": [
        { "sigla": "L", "fator": 1, "padrao_entrada": "NAO", "padrao_saida": "SIM" },
        { "sigla": "CX12", "fator": 12, "padrao_entrada": "SIM" }
      ],
      "mapeamentos": [
        {
          "cnpj_fornecedor": "12345678000195",
          "nome_fornecedor": "Laticínios X",
          "codigo_produto_nf": "001",
          "descricao_original": "LEITE INTEGRAL UHT 1L CX12",
          "unidade_nf": "CX"
        }
      ],
      "aliases": ["LEITE UHT INTEGRAL", "LEITE LONGA VIDA 1L"],
      "estoque_atual": 48,
      "custo_medio": 4.10
    }
  ],
  "categorias": [ { "id_categoria": "uuid", "nome": "Laticínios" } ],
  "total_produtos": 42,
  "total_categorias": 8
}
```

---

### `GET /api/admin?recurso=treino-desconhecidos` — Exportar Desconhecidos

Retorna apenas produtos ainda não confirmados:

```json
{
  "exportado_em": "2024-03-15T10:30:00.000Z",
  "instrucoes": "Para cada item, forneça: nome_interno, categoria, unidade_estoque, fator_conversao, e o produto_id se já existir no catálogo.",
  "produtos_pendentes": [
    {
      "id_produto": "uuid-pendente",
      "nome_interno": "",
      "descricao_nf": "QUEIJO MUSSARELA FATIADO KG",
      "cnpj_fornecedor": "12345678000195",
      "nome_fornecedor": "Laticínios X",
      "codigo_produto_nf": "045",
      "unidade_nf": "KG",
      "quantidade_nf": 5,
      "valor_unitario_nf": 35.00,
      "confirmado": "NAO"
    }
  ],
  "total": 7
}
```

---

### `POST /api/admin?recurso=treino-validar` — Validar JSON

**Request:** JSON de catálogo revisado pelo ChatGPT.

**Response 200:**
```json
{
  "valido": true,
  "total_itens": 12,
  "erros": [],
  "avisos": [ "Produto 'Leite Integral' já existe confirmado — será ignorado na importação padrão" ]
}
```

---

### `POST /api/admin?recurso=treino-importar` — Importar JSON Revisado

**Request:**
```json
{
  "origem": "chatgpt",
  "resumo": "Revisão de 12 produtos da NF-e 003 — Distribuidora X",
  "substituir": false,
  "catalogo": [
    {
      "id_produto": null,
      "nome_interno": "Queijo Muçarela",
      "categoria": "Laticínios",
      "unidade_estoque": "KG",
      "embalagens": [
        { "sigla": "KG", "fator": 1, "padrao_entrada": "NAO", "padrao_saida": "SIM", "padrao_inventario": "SIM" },
        { "sigla": "BARRA5KG", "fator": 5, "padrao_entrada": "SIM" }
      ],
      "mapeamentos": [
        {
          "cnpj_fornecedor": "12345678000195",
          "nome_fornecedor": "Laticínios X",
          "codigo_produto_nf": "045",
          "ean": "",
          "descricao_original": "QUEIJO MUSSARELA FATIADO KG",
          "unidade_nf": "KG"
        }
      ],
      "aliases": ["MUÇARELA", "QUEIJO MUSSARELA"]
    }
  ]
}
```

**Comportamento com `substituir: false` (padrão):**
- Produtos com `confirmado='SIM'` existentes: **não alterados**, contados em `conflitos`
- Produtos com `confirmado='NAO'` existentes: **completados**
- Produtos com `id_produto` nulo: **criados** novos
- Mapeamentos e aliases: **criados** se não existirem

**Comportamento com `substituir: true`:**
- Todos os produtos são sobrescritos, inclusive `confirmado='SIM'`

**Response 200:**
```json
{
  "ok": true,
  "produtos_criados": 3,
  "produtos_atualizados": 2,
  "mapeamentos_criados": 5,
  "embalagens_criadas": 8,
  "aliases_criados": 6,
  "conflitos": 1,
  "conflitos_detalhe": [ { "nome_interno": "Leite Integral", "motivo": "já confirmado" } ],
  "id_importacao": "uuid-log"
}
```

---

### `GET/POST /api/admin?recurso=embalagens`

**GET** `?recurso=embalagens&id_produto=uuid` — lista embalagens do produto.

**POST** `?recurso=embalagens`:
```json
{
  "acao": "criar",
  "id_produto": "uuid",
  "sigla": "CX12",
  "descricao": "Caixa com 12 unidades",
  "fator": 12,
  "unidade_base": "UN",
  "padrao_entrada": "SIM",
  "padrao_saida": "NAO",
  "padrao_inventario": "NAO",
  "permite_entrada": "SIM",
  "permite_saida": "SIM",
  "permite_inventario": "SIM"
}
```

`acao`: `"criar"` | `"editar"` | `"remover"`

---

## 8. Formato Completo do JSON de Catálogo (para ChatGPT)

Este é o **formato exato e obrigatório** que o ChatGPT deve produzir. O sistema valida
`schema_version`, `tipo` e a presença dos quatro arrays antes de aceitar a importação.

```json
{
  "schema_version": "1.0",
  "tipo": "catalogo_revisado_gpt",
  "origem": "chatgpt",
  "produtos_confirmados": [
    {
      "nome_interno": "Queijo Muçarela",
      "categoria": "Laticínios",
      "unidade_estoque": "KG",
      "cnpj_fornecedor": "12345678000195",
      "codigo_produto_nf": "045",
      "ean": "",
      "descricao_original_nfe": "QUEIJO MUSSARELA FATIADO KG",
      "unidade_nfe": "KG"
    }
  ],
  "embalagens_confirmadas": [
    {
      "nome_interno": "Queijo Muçarela",
      "descricao": "Quilograma",
      "sigla": "KG",
      "fator": 1,
      "unidade_base": "KG"
    },
    {
      "nome_interno": "Queijo Muçarela",
      "descricao": "Barra de 5 kg",
      "sigla": "BARRA5KG",
      "fator": 5,
      "unidade_base": "KG"
    }
  ],
  "mapeamentos_confirmados": [
    {
      "nome_interno": "Queijo Muçarela",
      "cnpj_fornecedor": "12345678000195",
      "codigo_produto_nf": "045",
      "ean": "",
      "descricao_original": "QUEIJO MUSSARELA FATIADO KG",
      "unidade_nf": "KG",
      "nome_fornecedor": "Laticínios X"
    }
  ],
  "aliases_confirmados": [
    { "nome_interno": "Queijo Muçarela", "alias": "MUCАРELA" },
    { "nome_interno": "Queijo Muçarela", "alias": "QUEIJO MUSSARELA" },
    { "nome_interno": "Queijo Muçarela", "alias": "MUSSARELA FATIADA" }
  ],
  "itens_com_duvida": []
}
```

**Como o sistema vincula os arrays:**
O campo `nome_interno` é a chave de ligação entre os quatro arrays. O sistema busca o produto pelo `nome_interno` e associa as embalagens, mapeamentos e aliases que tenham o mesmo valor.

**Regras críticas para o ChatGPT ao preencher:**

1. `schema_version` deve ser `"1.0"` e `tipo` deve ser `"catalogo_revisado_gpt"` — obrigatórios para passar na validação.
2. `nome_interno`: nome curto, como o restaurante usa (não a descrição bruta da NF-e).
3. `unidade_estoque`: sempre a menor unidade de controle (KG para carnes, L para líquidos, UN para itens unitários). Nunca "CX", "SC", "PCT" — essas são embalagens.
4. `embalagens_confirmadas`: inclua sempre pelo menos 1 com `fator: 1` (unidade base pura). Inclua embalagens de compra com o fator correto.
5. `fator`: quantas unidades base cabem em 1 unidade dessa embalagem.
6. `mapeamentos_confirmados.cnpj_fornecedor`: apenas dígitos, sem pontos, barras ou traços.
7. `aliases_confirmados`: variações do nome em maiúsculas e sem acentos.
8. `itens_com_duvida`: pode ser vazio `[]`; use para listar produtos que o ChatGPT não conseguiu identificar com segurança.

---

## 9. Fluxo Completo de uma NF-e

```
1. Usuário digita ou escaneia a chave da NF-e
   ↓
2. POST /api/nfe/conferir
   - Meu Danfe: adiciona chave (se necessário) e baixa XML
   - Parser XML → extrai itens, fornecedor, totais, duplicatas
   - Para cada item: tenta reconhecer pelo banco (3 estratégias)
   - Retorna itens com id_produto preenchido (ou produto_novo: true)
   ↓
3. Tela de Conferência
   - Usuário revisa itens reconhecidos (pode corrigir fator, quantidade)
   - Para produto_novo: usuário preenche nome_interno + categoria
   - Usuário revisa parcelas/vencimentos
   ↓
4. POST /api/nfe/confirmar
   - Para cada item com id_produto:
     * Aplica custo médio ponderado
     * Grava/atualiza em Produtos (estoque_atual, custo_medio)
     * Cria Movimentacao (tipo: 'ENTRADA_NF')
     * Cria/atualiza registro em produto_fornecedor
   - Para cada parcela: cria Contas_Pagar
   - Grava cabeçalho em Notas_Fiscais
   ↓
5. Produtos passam a ser reconhecidos automaticamente em NF-e futuras
```

---

## 10. Workflow de Treinamento com ChatGPT (100 NF-e)

### Passo 1 — Exportar contexto atual

Na aba **Configurações → Treinamento com ChatGPT**, clicar em **"Exportar contexto do sistema"**.

Isso faz um `GET /api/admin?recurso=treino-contexto` e baixa `contexto_superajudante.json`.

### Passo 2 — Exportar desconhecidos

Clicar em **"Exportar produtos desconhecidos"**.

Isso faz `GET /api/admin?recurso=treino-desconhecidos` e baixa `desconhecidos_superajudante.json`.

### Passo 3 — Enviar para o ChatGPT

Mensagem para o ChatGPT:
```
Você é o Treinador de Notas do Super Ajudante Estoque.

Contexto do sistema (catálogo atual):
[COLAR CONTEÚDO DE contexto_superajudante.json]

Produtos desconhecidos para identificar:
[COLAR CONTEÚDO DE desconhecidos_superajudante.json]

Para cada produto desconhecido:
1. Identifique o nome interno correto para um restaurante
2. Atribua a categoria mais adequada
3. Defina unidade_estoque (menor unidade de controle)
4. Crie embalagens com fatores corretos
5. Confirme o mapeamento do fornecedor
6. Adicione aliases para variações do nome

Responda com o JSON no formato exato do catálogo (schema fornecido no contexto).
```

### Passo 4 — Validar e Importar

1. Copiar o JSON da resposta do ChatGPT
2. Colar no campo de texto na aba Configurações
3. Clicar em **"Validar"** — sistema verifica o formato
4. Se válido, clicar em **"Importar"**
5. Sistema exibe resumo: criados / atualizados / conflitos

### Frequência recomendada

- **Durante setup inicial** (primeiras 20 NF-e): Exportar desconhecidos após cada NF-e
- **Fase de crescimento** (NF-e 21–100): Exportar a cada 5–10 NF-e
- **Manutenção**: Exportar mensalmente ou quando novos fornecedores aparecerem

---

## 11. Tela de Entrada Manual (sem NF-e)

Acesso: aba **Entrada** no menu principal.

**Campos:**
- Produto (busca por nome, autocompletar)
- Embalagem (carregada dinamicamente — apenas `permite_entrada='SIM'`)
- Quantidade (unidades da embalagem selecionada)
- Custo unitário (por unidade BASE — sistema converte automaticamente)
- Data (padrão: hoje)
- Observação (opcional)

**Preview em tempo real:** mostra quantidade em unidade base e custo total antes de confirmar.

**Endpoint:** `POST /api/admin?recurso=entrada`

---

## 12. Tela de Saída de Estoque

Acesso: aba **Saída** no menu principal.

**Campos:**
- Produto (busca por nome)
- Embalagem (apenas `permite_saida='SIM'`)
- Quantidade
- Data (padrão: hoje)
- Observação (opcional — não obrigatória)

**Sem campo "motivo"** — a razão é registrada apenas em observação se o usuário quiser.

**Endpoint:** `POST /api/estoque/saida`

---

## 13. Inventário Híbrido

O sistema usa uma contagem incremental, não substitutiva.

**Fluxo:**
1. Usuário escaneia EAN ou seleciona produto
2. Informa quantidade contada (na embalagem padrão_inventario)
3. Sistema acumula: pode escanear o mesmo produto várias vezes (soma)
4. Ao finalizar, sistema calcula `diferenca = contagem - estoque_atual`
5. Grava movimentação de `AJUSTE_INVENTARIO` com a diferença

---

## 14. Categorias e Configurações

### `GET/POST /api/admin?recurso=categorias`
CRUD padrão. `acao: "criar" | "editar" | "remover"`.

### `GET/POST /api/admin?recurso=config`
Chaves suportadas:
- `CNPJ_RESTAURANTE` — usado para validar destinatário na NF-e
- `NOME_RESTAURANTE` — exibido no cabeçalho do app
- Outros pares chave/valor livremente definidos

---

## 15. Prompt do GPT Personalizado

**Nome:** Treinador de Notas — Super Ajudante Estoque

**Descrição:**
> Especialista em identificar produtos de notas fiscais eletrônicas (NF-e) brasileiras para o sistema Super Ajudante Estoque de restaurantes. Converte descrições brutas de NF-e em registros limpos e estruturados para o banco de dados.

**Instruções do sistema (System Prompt):**

```
Você é o Treinador de Notas do Super Ajudante Estoque, sistema de gestão de estoque para restaurantes brasileiros.

Sua função: analisar produtos desconhecidos de notas fiscais eletrônicas (NF-e) e produzir um JSON estruturado para importação no sistema.

CONTEXTO DO SISTEMA:
- Produtos são controlados por nome interno (como o restaurante chama o item)
- Cada produto tem uma unidade_estoque (menor unidade: KG, L, UN, G, ML)
- Embalagens representam como o produto é comprado/vendido/contado
- Mapeamentos ligam o código do fornecedor ao produto interno
- Aliases permitem reconhecimento por descrições alternativas

REGRAS OBRIGATÓRIAS:
1. nome_interno: nome curto, limpo, como um cozinheiro chamaria. Ex: "Leite Integral", não "LEITE INTEGRAL UHT LONGA VIDA 1L CX12"
2. unidade_estoque: sempre a MENOR unidade de controle. Nunca "CX" — use o que está dentro da caixa.
3. fator: quantas unidades_base estão em 1 unidade da embalagem. CX12 de litros → fator 12.
4. Sempre inclua embalagem com fator 1 (unidade base pura).
5. padrao_entrada: "SIM" apenas para a embalagem de COMPRA (como vem na NF-e).
6. padrao_saida: "SIM" apenas para a embalagem de BAIXA de estoque (como sai da despensa).
7. cnpj_fornecedor: apenas dígitos, sem pontos, barras ou traços.
8. aliases: variações do nome em português, maiúsculas, sem acentos.
9. Se um produto já existir no catálogo enviado, use o id_produto existente e não crie duplicata.
10. Categorias comuns: Laticínios, Carnes, Hortifrutigranjeiros, Bebidas, Grãos e Farinhas, Óleos e Condimentos, Limpeza, Embalagens, Outros.

FORMATO DE SAÍDA OBRIGATÓRIO:
Responda APENAS com JSON válido. Nunca use markdown, bloco de código ou texto fora do JSON.
O JSON deve ter EXATAMENTE esta estrutura (sem variações):
{
  "schema_version": "1.0",
  "tipo": "catalogo_revisado_gpt",
  "origem": "chatgpt",
  "produtos_confirmados": [...],
  "embalagens_confirmadas": [...],
  "mapeamentos_confirmados": [...],
  "aliases_confirmados": [...],
  "itens_com_duvida": []
}
Vincule embalagens, mapeamentos e aliases ao produto pelo campo "nome_interno" (deve ser idêntico).

ERROS COMUNS A EVITAR:
- Não use unidade_estoque "CX", "SC", "PCT" — são embalagens, não unidades base.
- Não crie produtos duplicados se o nome já existir no catálogo enviado.
- Não invente códigos de produto — use os valores da NF-e exatamente como fornecidos.
- Não omita "embalagens_confirmadas" — deve ter pelo menos 1 item por produto.
- Não omita "mapeamentos_confirmados" — deve ter pelo menos 1 item por produto.
- Não altere "schema_version" nem "tipo" — o sistema rejeita qualquer outro valor.
```

**Arquivo de conhecimento (Knowledge File):** `contexto_superajudante.json` (exportado pelo sistema, atualizado a cada sessão de treinamento)

---

## 16. Comandos de Uso no ChatGPT

### Comando padrão (identificar desconhecidos):
```
Aqui estão os produtos não identificados da nota fiscal de hoje.
Contexto do sistema já enviado anteriormente.

[COLAR JSON desconhecidos_superajudante.json]

Produza o JSON de catálogo para importação no formato obrigatório:
schema_version "1.0", tipo "catalogo_revisado_gpt",
arrays: produtos_confirmados, embalagens_confirmadas, mapeamentos_confirmados, aliases_confirmados.
```

### Comando para produto único:
```
Identifique este produto da NF-e:
- Descrição: OLEO DE SOJA TIPO 1 900ML CX6
- Código: 0234
- Unidade NF-e: CX
- CNPJ fornecedor: 12345678000195
- Valor unitário: R$ 18,50 por CX

Responda com o JSON do catálogo para 1 produto.
```

### Comando para revisar categorias:
```
Revise as categorias dos produtos no contexto enviado.
Sugira reagrupamentos para melhorar a organização do estoque de um restaurante.
```

### Comando para conferir fator:
```
Na NF-e, o produto LEITE INTEGRAL UHT 1L foi comprado em "CX" com quantidade 2 e valor R$ 96,00.
No catálogo, ele existe com unidade_estoque "L" e embalagem CX12 (fator 12).
O fator está correto? Calcule o custo por litro.
```

---

## 17. Exemplos de Mapeamento NF-e → Catálogo

### Exemplo 1: Leite em caixa
```
NF-e:
  cProd: 001
  xProd: LEITE INTEGRAL UHT 1L CX12
  uCom: CX
  qCom: 2
  vProd: 96.00

Catálogo correto:
  nome_interno: "Leite Integral"
  unidade_estoque: "L"
  embalagens:
    - sigla: L, fator: 1, padrao_saida: SIM, padrao_inventario: SIM
    - sigla: CX12, fator: 12, padrao_entrada: SIM
  qtdBase = 2 × 12 = 24 L
  custoUnit = 96 / 24 = R$ 4,00/L
```

### Exemplo 2: Queijo em barra
```
NF-e:
  cProd: 045
  xProd: QUEIJO MUSSARELA BARRA 5KG
  uCom: KG
  qCom: 15
  vProd: 525.00

Catálogo correto:
  nome_interno: "Queijo Muçarela"
  unidade_estoque: "KG"
  embalagens:
    - sigla: KG, fator: 1, padrao_saida: SIM, padrao_inventario: SIM
    - sigla: BARRA5KG, fator: 5, padrao_entrada: SIM (opcional)
  qtdBase = 15 × 1 = 15 KG (unidade NF já é KG)
  custoUnit = 525 / 15 = R$ 35,00/KG
```

### Exemplo 3: Frango em caixa com unidade já convertida
```
NF-e:
  cProd: 098
  xProd: FRANGO CONGELADO CX 20KG
  uCom: CX
  qCom: 1
  vProd: 180.00

Catálogo correto:
  nome_interno: "Frango Inteiro Congelado"
  unidade_estoque: "KG"
  embalagens:
    - sigla: KG, fator: 1, padrao_saida: SIM
    - sigla: CX20KG, fator: 20, padrao_entrada: SIM
  qtdBase = 1 × 20 = 20 KG
  custoUnit = 180 / 20 = R$ 9,00/KG
```

### Exemplo 4: Ovos em dúzia
```
NF-e:
  cProd: 112
  xProd: OVOS BRANCOS TIPO A DZ
  uCom: DZ
  qCom: 10
  vProd: 85.00

Catálogo correto:
  nome_interno: "Ovos Brancos Tipo A"
  unidade_estoque: "UN"
  embalagens:
    - sigla: UN, fator: 1, padrao_inventario: SIM
    - sigla: DZ, fator: 12, padrao_entrada: SIM, padrao_saida: SIM
  qtdBase = 10 × 12 = 120 UN
  custoUnit = 85 / 120 = R$ 0,7083/UN
```

---

## 18. Variáveis de Ambiente (Vercel)

| Variável | Obrigatória | Descrição |
|---|---|---|
| `API_KEY_MEU_DANFE` | Sim | Chave da API Meu Danfe v2 |
| `BASE_URL_API` | Não | Default: `https://api.meudanfe.com.br/v2` |
| `SUPABASE_URL` | Sim | URL do projeto Supabase |
| `SUPABASE_SERVICE_KEY` | Sim | Chave `service_role` (ignora RLS) |

**Validação:** `GET /api/teste` verifica todas as variáveis, testa conexão Supabase e valida a Api-Key do Meu Danfe.

---

## 19. SQL — schema_fase2.sql

Idempotente: seguro para executar múltiplas vezes. Nunca apaga dados.

```sql
-- Executar no Supabase: Dashboard → SQL Editor → New Query

alter table "Produtos" add column if not exists confirmado text default 'NAO';

create table if not exists embalagens (
  id_embalagem         text primary key,
  id_produto           text,
  descricao            text,
  sigla                text,
  fator                numeric default 1,
  unidade_base         text,
  permite_entrada      text default 'SIM',
  permite_saida        text default 'SIM',
  permite_inventario   text default 'SIM',
  padrao_entrada       text default 'NAO',
  padrao_saida         text default 'NAO',
  padrao_inventario    text default 'NAO',
  ativo                text default 'SIM',
  criado_em            text,
  atualizado_em        text
);
create index if not exists idx_embalagens_produto on embalagens (id_produto);

create table if not exists produto_fornecedor (
  id_pf                    text primary key,
  id_produto               text,
  cnpj_fornecedor          text,
  nome_fornecedor          text,
  codigo_produto_nf        text,
  ean                      text,
  descricao_original       text,
  descricao_normalizada    text,
  unidade_nf               text,
  confirmado_pelo_usuario  text default 'NAO',
  origem_confirmacao       text,
  vezes_utilizado          numeric default 0,
  ultima_utilizacao        text,
  ativo                    text default 'SIM',
  criado_em                text,
  atualizado_em            text
);
create index if not exists idx_pf_chave   on produto_fornecedor (cnpj_fornecedor, codigo_produto_nf);
create index if not exists idx_pf_produto on produto_fornecedor (id_produto);

create table if not exists aliases_produto (
  id_alias    text primary key,
  id_produto  text,
  alias       text,
  origem      text,
  ativo       text default 'SIM',
  criado_em   text
);
create index if not exists idx_alias_produto on aliases_produto (id_produto);

create table if not exists treino_importacoes (
  id_importacao        text primary key,
  criado_em            text,
  origem               text,
  resumo               text,
  json_original        text,
  status               text,
  produtos_criados     numeric default 0,
  mapeamentos_criados  numeric default 0,
  embalagens_criadas   numeric default 0,
  aliases_criados      numeric default 0,
  conflitos            numeric default 0,
  erros                text
);
```

---

## 20. Limitações e Itens Não Implementados (Fase Futura)

| Item | Status | Motivo do adiamento |
|---|---|---|
| Tela de gerenciamento de Aliases | Pendente | Tabela existe, sem UI por ora |
| Tela de histórico de `treino_importacoes` | Pendente | Tabela existe, sem UI |
| Cardápio como suporte a reconhecimento | Pendente | Tabela não criada |
| Áreas de estoque / transferências | Pendente | Requeriria nova tabela + múltiplos endpoints |
| Devoluções de NF-e | Excluído pelo usuário | Fora do escopo |
| Controle de validade / lotes | Excluído pelo usuário | Fora do escopo |
| Múltiplos usuários com permissões | Excluído pelo usuário | Fora do escopo |
| Unificar `confirmar.js` com `_lib/estoque.js` | Pendente | Funcional, refatoração opcional |

---

*Documento gerado em 01/06/2026 — Super Ajudante Estoque Fase 2.*
