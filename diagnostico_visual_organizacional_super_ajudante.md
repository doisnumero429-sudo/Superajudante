# Diagnóstico Visual e Organizacional — Super Ajudante
**Data:** 2026-06-01  
**Versão analisada:** branch `claude/web-app-inventory-scanner-HT3bc`  
**Tipo:** Documento de leitura. Nenhum arquivo foi alterado, criado ou commitado.

---

## 1. Resumo Executivo

O Super Ajudante é um sistema de controle de estoque para restaurante (Araçá Grill), implementado como **Progressive Web App + APK Android via Capacitor**. Toda a lógica fica em dois lugares:

| Camada | Tecnologia | Local |
|--------|-----------|-------|
| Frontend | HTML/CSS/JS vanilla (SPA) | `public/index.html` (~2090 linhas) |
| Backend | Serverless Functions Node.js | `api/**/*.js` (Vercel Hobby) |
| Banco | Supabase (PostgreSQL) | Tabelas via `api/_lib/db.js` |

O app já está em produção em `https://superajudante.vercel.app`. O APK Android carrega essa URL via `server.url` do Capacitor, sem necessidade de rebuild para mudanças de código.

O sistema cobre o ciclo completo: **entrada de mercadoria (NF-e)** → **conferência de itens** → **saída/consumo** → **inventário** → **contas a pagar** → **dashboard financeiro**. O diferencial é a esteira de treinamento com ChatGPT para aprendizado de produtos desconhecidos.

---

## 2. Estrutura do Frontend

### Arquivo único
Todo o frontend está em `public/index.html`. Não há frameworks, bundler ou build step. O arquivo contém:

- **CSS inline** (linhas 11–100): variáveis CSS, estilos de componentes
- **HTML das telas** (linhas 103–660): todas as `<section class="view">` dentro de `<div class="app">`
- **HTML do modal de pagamento** (linhas 2066–2090)
- **JavaScript** (linhas 661–2064): todas as funções JS globais, `loadDash()` chamado no final

### Sistema de navegação
```javascript
function nav(id) { /* mostra/esconde .view sections */ }
```
Não há router. A navegação é feita via `nav('dash')`, `nav('nfe')`, etc. O menu inferior (`<nav>`) tem 5 botões.

### Padrão de API
```javascript
async function api(url, opts) {
  // Faz fetch, lê JSON, lança erro com .status e .data se não 2xx
}
```

### Notificações
```javascript
function toast(msg, tipo) { /* 'ok' | 'err' | '' */ }
```
Toast fixo no rodapé, visível 3s.

### Cache local (em memória, dura enquanto a página está aberta)
| Variável | Conteúdo |
|----------|----------|
| `estoqueCache` | Array de produtos (tabela Produtos completa) |
| `catCache` | Array de categorias |
| `embCache` | Objeto: `id_produto → array de embalagens` |
| `treinoFilaCache` | Fila de NF-es de treinamento + stats |
| `invContagem` | Contagem atual de inventário |

---

## 3. Mapa de Telas

O app tem **8 telas principais** mais o modal de pagamento:

| ID (`nav(id)`) | Nome exibido | Ativação |
|----------------|-------------|---------|
| `dash` | Dashboard | `loadDash()` na entrada |
| `nfe` | Entrada NF-e | botão nav |
| `conferencia` | Conferência de NF-e | chamado após `buscarNfe()` → `conferirNfe()` |
| `estoque` | Estoque | botão nav |
| `produto` | Detalhe do produto | `abrirProduto(id)` a partir de Estoque |
| `saida` | Saída | botão "Saída" |
| `entrada` | Entrada Manual | botão "Entrada" |
| `inventario` | Inventário | botão nav |
| `contas` | Contas a Pagar | botão nav / `navContas(filtro)` |
| `config` | Configurações | botão nav |
| `treino` | Esteira de Treinamento | botão em Configurações |
| `auditoria` | Auditoria do Cadastro | botão em Configurações |

### Fluxo de navegação principal
```
Dashboard
  ├─ Estoque → Produto (detalhe) → Saída / Entrada
  ├─ Entrada NF-e → Conferência → (confirma) → Dashboard
  ├─ Inventário (scan EAN → ajustar)
  ├─ Contas a Pagar (vencidas / 7 dias / todas)
  └─ Configurações → Treinamento / Auditoria
```

---

## 4. Componentes Visuais (CSS)

### Paleta de cores
| Variável | Valor | Uso |
|----------|-------|-----|
| `--bg` | `#0f1413` | fundo geral |
| `--surface` | `#161d1c` | cards |
| `--surface2` | `#1e2726` | inputs, itens |
| `--accent` | `#48c78e` | verde primário, botões principais |
| `--danger` | `#ef6f6f` | erros, alertas críticos |
| `--warn` | `#e6b450` | avisos amarelos |
| `--info` | `#5aa9e6` | informações azuis |

### Componentes reutilizáveis
| Classe CSS | Descrição |
|------------|-----------|
| `.card` | Container branco-escuro com borda e sombra |
| `.stat` | Card de estatística (número grande + label pequeno) |
| `.stat.alert` | Stat com borda vermelha (ex.: produtos zerados) |
| `.stat.warn` | Stat com número amarelo |
| `.stat.good` | Stat com número verde |
| `.list-row` | Linha de lista com borda inferior |
| `.badge` | Pill inline (`.b-ok`, `.b-err`, `.b-wait`, `.b-info`, `.b-new`) |
| `.btn` | Botão primário verde |
| `.btn-2` | Botão secundário cinza |
| `.btn-sm` | Modificador de tamanho pequeno |
| `.alertbar` | Bloco de alerta vermelho (erros de operação) |
| `.prev` | Preview de ação (fundo verde escuro) |
| `.spinner` | Anel giratório de carregamento |
| `.chips` | Container de seleções tipo chip |
| `.chip.on` | Chip selecionado (verde) |
| `.empty` | Texto centralizado em cinza (estado vazio) |
| `.scanner-wrap` | Container do scanner de câmera |

### Tipografia
- Corpo: **Spline Sans** (Google Fonts)
- Títulos e números: **Fraunces** (serif serifado)

---

## 5. Endpoints da API

### Arquitetura Vercel Hobby (limite de 12 funções)
Para contornar o limite, recursos administrativos são multiplexados via `?recurso=` em um único endpoint.

### Funções registradas
| Arquivo | URL | Métodos |
|---------|-----|---------|
| `api/admin.js` | `/api/admin?recurso=...` | GET / POST |
| `api/dashboard.js` | `/api/dashboard` | GET |
| `api/listar.js` | `/api/listar?aba=...` | GET |
| `api/nfe/buscar.js` | `/api/nfe/buscar` | POST |
| `api/nfe/conferir.js` | `/api/nfe/conferir` | POST |
| `api/nfe/confirmar.js` | `/api/nfe/confirmar` | POST |
| `api/nfe/danfe.js` | `/api/nfe/danfe` | GET/POST |
| `api/nfe/add-xml.js` | `/api/nfe/add-xml` | POST |
| `api/estoque/saida.js` | `/api/estoque/saida` | POST |
| `api/estoque/inventario.js` | `/api/estoque/inventario` | GET / POST |
| `api/contas/pagar.js` | `/api/contas/pagar` | POST |
| `api/teste.js` | `/api/teste` | GET |

### Recursos do `/api/admin`
| `recurso=` | Método | Descrição |
|------------|--------|-----------|
| `categorias` | GET | Lista categorias |
| `categorias` | POST `{acao}` | Criar / renomear / ativar / desativar |
| `config` | GET | Lista configurações editáveis |
| `config` | POST `{chave, valor}` | Salva configuração |
| `embalagens` | GET `?id_produto=` | Lista embalagens de um produto |
| `embalagens` | POST `{acao}` | Criar / editar / remover embalagem |
| `entrada` | POST | Entrada manual (produto existente ou novo) |
| `produto-editar` | POST | Edita campos do produto (sem estoque) |
| `produto-inativar` | POST `{id_produto}` | Inativa produto |
| `produto-reativar` | POST `{id_produto}` | Reativa produto |
| `produto-excluir` | POST `{id_produto}` | Exclui definitivamente (se sem histórico) |
| `produto-verificar-historico` | GET `?id_produto=` | Checa se produto tem movimentações |
| `treino-contexto` | GET | Contexto completo para ChatGPT (produtos, cats, etc.) |
| `treino-desconhecidos` | GET | Produtos não reconhecidos agrupados |
| `treino-validar` | POST `{json}` | Valida JSON do ChatGPT antes de importar |
| `treino-importar` | POST `{json, substituir}` | Importa catálogo revisado pelo ChatGPT |
| `treino-fila-add` | POST `{chave, nota, fornecedor, itens}` | Adiciona NF-e na esteira |
| `treino-fila-listar` | GET | Lista fila com stats |
| `treino-fila-limpar` | POST | Limpa a esteira (não apaga estoque) |
| `treino-fila-pacote` | GET | Contexto + desconhecidos da esteira |
| `treino-resetar-tudo` | POST | **NUCLEAR**: apaga 12 tabelas, preserva Categorias e Configuracoes |
| `auditoria-cadastro` | GET | Detecta inconsistências no cadastro |

---

## 6. Tabelas no Banco de Dados

Definidas em `api/_lib/db.js`:

| Nome lógico | Tabela Supabase | Chave primária |
|-------------|----------------|----------------|
| `Produtos` | `produtos` | `id_produto` (PRD-XXXX) |
| `Fornecedores` | `fornecedores` | `id_fornecedor` (FOR-XXXX) |
| `Categorias` | `categorias` | `id_categoria` (CAT-XXXX) |
| `Notas_Fiscais` | `notas_fiscais` | `id_nota` (NF-XXXX) |
| `Itens_Nota` | `itens_nota` | `id_item` (ITM-XXXX) |
| `Movimentacoes_Estoque` | `movimentacoes_estoque` | `id_movimentacao` (MOV-XXXX) |
| `Contas_Pagar` | `contas_pagar` | `id_conta` (CP-XXXX) |
| `Configuracoes` | `configuracoes` | `chave` (texto) |
| `Embalagens` | `embalagens` | `id_embalagem` (EMB-XXXX) |
| `Produto_Fornecedor` | `produto_fornecedor` | `id_pf` (PF-XXXX) |
| `Aliases_Produto` | `aliases_produto` | `id_alias` (ALS-XXXX) |
| `Treino_Importacoes` | `treino_importacoes` | `id_importacao` |
| `Treino_Fila` | `treino_fila` | `id_fila` |
| `Treino_Itens` | `treino_itens` | `id_item_fila` |

### Geração de IDs
Todos os IDs são sequenciais no formato `PREFIXO-NNNN` (ex.: `PRD-0001`). A função `nextId()` busca o maior ID existente e incrementa.

### Tabelas opcionais (fase 2)
`Produto_Fornecedor` e `Aliases_Produto` são carregadas dentro de `try/catch` — se não existirem no Supabase, o sistema funciona sem elas (degradado).

---

## 7. Tela: Produtos e Categorias

### Estoque (`v-estoque`)
**Endpoint:** `/api/listar?aba=Produtos`  
**Filtros no frontend:**
- Campo de busca por nome (`filtrarEstoque()`)
- Chips: Todos / Com estoque / Zerados / Inativos

**Campos exibidos por produto:**
- Nome interno (`nome_interno`)
- Estoque atual + unidade de estoque
- Badge "inativo" se `ativo !== 'SIM'`
- Badge "baixo" se `estoque_atual <= estoque_minimo`

**Ordenação:** Alfabética (`.sort((a,b)=>a.nome_interno.localeCompare(b.nome_interno))`)

### Detalhe do produto (`v-produto`)
**Campos exibidos:**
- Nome interno, descrição original da NF
- Categoria
- Estoque atual, estoque mínimo, unidade
- Custo médio e último custo unitário (em R$)
- Código de barras (EAN)
- Banner "PRODUTO INATIVO" se aplicável

**Ações disponíveis:**
- Editar nome interno, categoria, unidade, estoque mínimo
- Inativar produto (com confirmação)
- Reativar produto (se inativo)
- Ver embalagens cadastradas

### Categorias (`v-config`)
**Endpoint:** `/api/admin?recurso=categorias`  
Gerenciadas na tela de Configurações:
- Criar categoria (nome)
- Renomear (via `pedirTexto()` overlay)
- Ativar / Desativar

---

## 8. Tela: Entrada NF-e e Conferência

### Fluxo completo
```
Digitar/Escanear chave da NF-e (44 dígitos)
    ↓
POST /api/nfe/buscar (polling até status OK)
    ↓
POST /api/nfe/conferir → retorna itens com reconhecimento
    ↓
Tela v-conferencia: usuário revisa itens
    ↓
POST /api/nfe/confirmar → grava estoque
```

### Scanner de QR code
Três caminhos de fallback, nesta ordem:
1. **Capacitor nativo (Android)**: `@capacitor-mlkit/barcode-scanning` — scanner MLKit full-screen
2. **BarcodeDetector nativo (Chrome/Android)**: API nativa do browser
3. **Quagga2**: biblioteca JS carregada dinamicamente de CDN

### Reconhecimento de produtos (`api/_lib/reconhecimento.js`)
Função `encontrarProduto()` com **5 estratégias em ordem de confiança**:

| Estratégia | Critério | Metodo retornado |
|-----------|---------|-----------------|
| 0 | `id_produto` direto (vem da conferência) | `'id_produto'` |
| 1 | Tabela Produtos: CNPJ+código OU EAN | `'CNPJ+código'` |
| 2 | Produto_Fornecedor: CNPJ+código | `'Mapeamento CNPJ+código'` |
| 3 | Produto_Fornecedor: EAN | `'Mapeamento EAN'` |
| 4 | Produto_Fornecedor: CNPJ+descrição normalizada | `'Mapeamento descrição'` |
| 5 | Aliases_Produto: descrição normalizada | `'Alias'` |

O campo `metodo_reconhecimento` é exibido na UI como label pequeno ao lado de "cadastrado".

### Conferência (`v-conferencia`)
**Para cada item da NF-e:**
- Nome do produto (reconhecido ou "NOVO")
- Badge verde "cadastrado" com método de reconhecimento, ou badge laranja "NOVO"
- Quantidade, unidade, valor unitário, valor total
- Para produtos novos: campos de nome interno, categoria, unidade de estoque, fator de conversão

**Validações antes de confirmar:**
- Produto novo sem `categoria_id` → bloqueado com erro

### Confirmar (`api/nfe/confirmar.js`)
Grava em sequência:
1. `Fornecedores` (cria se CNPJ novo)
2. `Notas_Fiscais` (cabecalho)
3. `Produtos` (cria se novo, ou atualiza custo médio ponderado)
4. `Itens_Nota` (por item)
5. `Movimentacoes_Estoque` tipo `ENTRADA`, origem `NFE`
6. `Produto_Fornecedor` (mapeamento aprendido)
7. `Contas_Pagar` (parcelas das duplicatas)

---

## 9. Tela: Saída de Estoque (`v-saida`)

**Endpoint:** `POST /api/estoque/saida`

**Campos do formulário:**
- Produto (select, filtrado: ativo + não-teste)
- Embalagem (select: avulsa + embalagens cadastradas)
- Quantidade
- Data (padrão: hoje)
- Observação

**Preview:** "Isso vai baixar X unidades do estoque" (calculado no frontend)

**Payload enviado:**
```json
{
  "id_produto": "PRD-0001",
  "quantidade": 2,
  "fator": 6,
  "embalagem": "Caixa 6 UN",
  "data": "2026-06-01",
  "observacao": ""
}
```

**Resultado:** toast com quantidade baixada + estoque atual, com alerta se ficar negativo.

**O que é gravado:**
- `Movimentacoes_Estoque`: tipo `SAIDA`, origem `MANUAL`
- Campos: `id_movimentacao`, `data`, `id_produto`, `tipo`, `quantidade`, `custo_unitario`, `valor_total`, `origem`, `id_nota` (vazio), `motivo`, `usuario`, `observacao`
- `Produtos.estoque_atual` atualizado

---

## 10. Tela: Entrada Manual (`v-entrada`)

**Endpoint:** `POST /api/admin?recurso=entrada`

**Dois modos** (chips "Produto existente" / "Produto novo"):

### Modo: Produto existente
- Select de produto
- Embalagem (avulsa / cadastradas / "nova embalagem…")
- Quantidade
- Valor total ou custo unitário (opcional)
- Data, observação

### Modo: Produto novo
- Nome interno (obrigatório)
- Categoria (select de cats ativas)
- Unidade de estoque
- Fornecedor (opcional)
- Mesmos campos de embalagem/quantidade/valor

**Ao criar nova embalagem:** abre campos inline (descrição + fator). A embalagem é criada e vinculada ao produto automaticamente.

**Preview:** "Isso vira no estoque: X unidades"

**O que é gravado:**
- `Movimentacoes_Estoque`: tipo `ENTRADA`, origem `MANUAL`
- `Produtos.estoque_atual` atualizado (custo médio ponderado se valor informado)
- Opcionalmente: cria novo produto + cria nova embalagem

---

## 11. Tela: Inventário (`v-inventario`)

**Endpoints:**
- `GET /api/estoque/inventario?codigo_barras=EAN` → busca produto por EAN
- `POST /api/estoque/inventario` → confirma contagem

**Fluxo:**
1. Digitar EAN ou usar scanner (Quagga2 / BarcodeDetector / Capacitor)
2. Sistema exibe estoque atual no sistema
3. Usuário preenche contagem por embalagem (avulsa + cada embalagem cadastrada)
4. Frontend soma tudo em unidades base
5. Confirmar → POST com quantidade total contada

**O que é gravado:**
- `Movimentacoes_Estoque`: tipo `AJUSTE`
- `observacao`: `"Inventario: contado X, sistema Y"`
- `Produtos.estoque_atual` atualizado para o valor contado

**Limitação atual:** O inventário só funciona por EAN. Não há busca por nome. Se o produto não tem EAN cadastrado, não é possível inventariar por scanner.

---

## 12. Tela: Treinamento com ChatGPT (`v-treino`)

### Objetivo
Ensinar o sistema a reconhecer produtos desconhecidos das NF-es, usando o ChatGPT como curador.

### Fluxo da esteira
```
1. Escanear/digitar chave de NF-e
      ↓
2. POST /api/nfe/buscar (polling)
      ↓
3. POST /api/nfe/conferir (reconhecimento)
      ↓
4. POST /api/admin?recurso=treino-fila-add (salva na esteira)
      ↓
5. Acumular N notas com produtos desconhecidos
      ↓
6. "Copiar/Baixar pacote completo" → GET treino-fila-pacote
      ↓
7. Colar no ChatGPT com o comando embutido
      ↓
8. ChatGPT retorna JSON
      ↓
9. Colar JSON → Validar → Importar
      ↓
10. Limpar esteira (opcional)
```

### Pacote enviado ao ChatGPT
O pacote contém:
- **Comando de sistema** (embutido no texto): instrui o ChatGPT sobre regras, formato, campos obrigatórios
- **Contexto**: produtos internos existentes (`nome_interno`, `id_produto`, categorias, fornecedores, embalagens)
- **Produtos desconhecidos**: itens da esteira que não foram reconhecidos

### Regras embutidas no comando (versão atual)
1. Usar CNPJ do fornecedor + código do produto como chave principal
2. Não inventar CNPJ, código, EAN, preço ou embalagem
3. Usar SEMPRE `nome_interno` (nunca `produto_interno`)
4. Em `categoria_id`: usar APENAS IDs do contexto, ou usar campo `categoria` com nome texto
5. Se produto já existir no contexto, usar `id_produto` e `nome_interno` exatos

### Formato JSON de importação
```json
{
  "schema_version": "1.0",
  "tipo": "catalogo_revisado_gpt",
  "origem": "chatgpt",
  "produtos_confirmados": [{ "nome_interno", "categoria", "unidade_estoque", "cnpj_fornecedor", "codigo_produto_nf" }],
  "embalagens_confirmadas": [{ "nome_interno", "descricao", "sigla", "fator", "unidade_base" }],
  "mapeamentos_confirmados": [{ "nome_interno", "cnpj_fornecedor", "codigo_produto_nf" }],
  "aliases_confirmados": [{ "nome_interno", "alias" }],
  "itens_com_duvida": [],
  "observacoes": []
}
```

### Importação (`treino-importar`)
- Valida `categoria_id` contra categorias reais (descarta IDs inventados)
- Cria categorias automaticamente pelo nome se `categoria_id` inválido mas `categoria` informado
- Auto-cria embalagem base (fator 1) para produtos novos
- Detecta conflitos CNPJ+código em `Produto_Fornecedor` antes de criar produto novo
- Registra múltiplos nomes (chave, nome_interno, produto_interno) no mapa para resolução

### Botões disponíveis na tela de treinamento
| Botão | Ação |
|-------|------|
| Escanear QR code da NF-e | Scanner para adicionar à esteira |
| Adicionar chave | Adicionar NF-e por texto |
| Copiar pacote completo | Copia contexto+desconhecidos para clipboard |
| Baixar pacote completo | Baixa como `.txt` + tenta copiar |
| Validar JSON | Valida estrutura do JSON antes de importar |
| Importar | Importa catálogo do ChatGPT |
| Limpar esteira | Remove NF-es da fila (não apaga estoque) |
| ☢️ Apagar TUDO | Nuclear: apaga 12 tabelas, preserva categorias e config |

---

## 13. Tela: Contas a Pagar (`v-contas`)

**Endpoint:** `GET /api/listar?aba=Contas_Pagar`

**Exibe apenas contas abertas** (`status = 'ABERTO'` ou `'PENDENTE_INFO'`)

**Classificação de vencimento:**
| Badge | Critério |
|-------|---------|
| "sem vencimento" | status = PENDENTE_INFO |
| "vencida" | vencimento < hoje |
| "vence hoje" | vencimento = hoje |
| "7 dias" | vencimento nos próximos 7 dias |
| (sem badge) | vencimento > 7 dias |

**Filtros do dashboard:** `navContas('vencidas')` ou `navContas('7dias')`

**Modal de pagamento:**
- Forma de pagamento (chips): Dinheiro, Pix, Cartão Débito, Cartão Crédito, TED, Boleto
- Data: "Hoje" ou data customizada
- Confirmar → `POST /api/contas/pagar` → atualiza `status = 'PAGO'`

---

## 14. Tela: Dashboard (`v-dash`)

**Endpoint:** `GET /api/dashboard`

**Blocos exibidos:**

### Stats (cards 2x2)
- Total de produtos ativos
- Itens com estoque baixo
- Contas vencidas (clicável → navContas('vencidas'))
- Contas a vencer em 7 dias (clicável → navContas('7dias'))

### Estoque baixo
Lista de produtos onde `estoque_atual <= estoque_minimo`

### Mais consumidos (30 dias)
Produtos com maior `SUM(quantidade)` de movimentações tipo `SAIDA` nos últimos 30 dias

### Últimas movimentações
10 movimentações mais recentes (qualquer tipo: ENTRADA, SAIDA, AJUSTE)  
Exibe: tipo + motivo + data + quantidade  
**Não tem botão de detalhe** — não é possível clicar para ver mais informações

---

## 15. Tela: Configurações (`v-config`)

Dividida em seções:

### Categorias
- Lista de categorias com botões Renomear / Ativar-Desativar
- Campo para criar nova categoria

### Regras do sistema
Configurações editáveis (`Configuracoes` table):
- `CNPJ_RESTAURANTE`
- `NOME_RESTAURANTE`
- `MAX_TENTATIVAS_NFE`
- `INTERVALO_TENTATIVAS_MS`
- `LIMITE_CONSULTAS_SEGUNDO`

### Diagnóstico
- Botão "Rodar diagnóstico" → testa variáveis de ambiente, Supabase, Meu Danfe
- Botão "Auditoria do Cadastro" → navega para `v-auditoria`

### Treinamento
- Link para tela de treinamento (`v-treino`)

---

## 16. Tela: Auditoria do Cadastro (`v-auditoria`)

**Endpoint:** `GET /api/admin?recurso=auditoria-cadastro`

**Stats exibidos:**
| Stat | Descrição |
|------|-----------|
| `sem_categoria` | Produtos ativos sem categoria definida |
| `sem_mapeamento` | Produtos sem nenhuma entrada em Produto_Fornecedor |
| `sem_embalagem` | Produtos sem nenhuma embalagem |
| `cnpj_codigo_duplicado` | Conflitos em Produto_Fornecedor (mesmo CNPJ+código → dois produtos) |
| `alias_produto_invalido` | Aliases que apontam para produto inexistente |

**Lista de alertas:**
- Badge colorido com tipo de inconsistência
- Nome do produto afetado
- Detalhe do problema

---

## 17. Dados Exibidos vs. Dados Disponíveis

### O que está disponível no banco mas não é exibido no frontend

| Dado disponível | Onde está | Por que não aparece |
|----------------|-----------|---------------------|
| `confirmado` do produto | tabela `Produtos` | Só usado internamente para filtrar desconhecidos no ChatGPT |
| `produto_teste` | tabela `Produtos` | Filtra na saída/entrada, mas não há UI para marcá-lo |
| `descricao_original_nf` | tabela `Produtos` | Aparece apenas no detalhe, não na listagem |
| `codigo_produto_nf` por fornecedor | `Produto_Fornecedor` | Não há tela de "mapeamentos" |
| Histórico de movimentações por produto | `Movimentacoes_Estoque` | Não há detalhe de histórico na tela de produto |
| CNPJ, razão social, endereço do fornecedor | `Fornecedores` | Não há tela de fornecedores |
| Contas pagas (`status = 'PAGO'`) | `Contas_Pagar` | Não há filtro ou histórico de pagamentos |
| `alias` cadastrados | `Aliases_Produto` | Não há UI para visualizar ou editar aliases |
| `vezes_utilizado`, `ultima_utilizacao` | `Produto_Fornecedor` | Não exibido |
| `ncm`, `cfop`, `unidade_tributavel` | `Itens_Nota` | Dados fiscais não exibidos no frontend |
| `valor_frete`, `valor_desconto` por nota | `Notas_Fiscais` | Não há tela de histórico de notas |

### O que o frontend exibe mas não persiste/rastreia
- O `metodo_reconhecimento` é exibido na conferência mas não salvo no banco (campo calculado em tempo real)
- O `usuario` das movimentações manuais está sempre vazio (não há autenticação)

---

## 18. Pontos Confusos ou Ambíguos

### 1. Dois fluxos de importação do ChatGPT
Existem **dois caminhos** diferentes para colar o JSON do ChatGPT:

**Caminho antigo (v-config / botões individuais):**
- Exportar contexto (baixa JSON)
- Exportar desconhecidos (baixa JSON)
- Copiar comando manual
- Colar JSON → Validar → Importar

**Caminho novo (v-treino / pacote único):**
- Adicionar NF-es na esteira
- Copiar/baixar pacote completo (contexto + desconhecidos + comando = tudo junto)
- Colar no ChatGPT, receber JSON
- Colar JSON → Validar → Importar na esteira

Os dois caminhos levam ao mesmo endpoint (`treino-importar`). O fluxo antigo ainda existe (funções `exportarContexto`, `exportarDesconhecidos`, `copiarComandoGPT` ainda estão no JS), mas os botões foram removidos de `v-config`. O usuário pode ficar confuso sobre qual caminho usar.

### 2. Inventário só por EAN
A tela de inventário só localiza produto via `codigo_barras`. Produto sem EAN cadastrado não pode ser inventariado via scanner — só seria possível digitar o EAN manualmente (se souber), o que é impraticável.

### 3. Contas pagas somem da tela
Após pagar uma conta, ela some da lista (só mostra `ABERTO` e `PENDENTE_INFO`). Não há histórico de pagamentos visível.

### 4. Estoque negativo permitido
A saída de estoque exibe `alerta_negativo` no toast, mas **não bloqueia** a operação. O estoque pode ficar negativo.

### 5. Sem autenticação
Qualquer pessoa com a URL pode acessar e modificar tudo. O campo `usuario` em movimentações está sempre vazio.

### 6. Fator de conversão: dois campos com propósito similar
- `fator_conversao` na tabela `Produtos` (fator global do produto)
- `fator` na tabela `Embalagens` (fator por embalagem)

Na conferência de NF-e, o usuário pode editar o fator de conversão. Não está claro se esse fator substitui ou coexiste com as embalagens cadastradas.

### 7. Produto "confirmado: NAO" vs pendente
Um produto é criado com `confirmado: NAO` quando não tem `nome_interno` curado e `categoria_id`. Esses produtos aparecem no contexto do ChatGPT como "pendentes". Mas não há UI para ver ou filtrar esses produtos especificamente.

---

## 19. Oportunidades de Melhoria (UX)

### Alta prioridade (afeta fluxo principal)

1. **Histórico de movimentações por produto**  
   Na tela de detalhe do produto, mostrar as últimas N movimentações (entradas, saídas, ajustes). Hoje não existe.

2. **Busca por nome no inventário**  
   Permitir buscar produto por nome além de EAN, para itens sem código de barras.

3. **Tela de Fornecedores**  
   Ver e editar fornecedores. Hoje são criados automaticamente e nunca visíveis para o usuário.

4. **Histórico de notas fiscais**  
   Lista de NF-es importadas, com valor total e data. Permite rastrear de onde veio cada entrada.

5. **Tela de Mapeamentos / Aliases**  
   Listar e editar os mapeamentos Produto_Fornecedor e Aliases_Produto. Hoje são "caixas pretas" — o usuário não vê o que foi aprendido.

### Média prioridade

6. **Filtro de contas pagas**  
   Aba ou toggle para ver histórico de pagamentos realizados.

7. **Bloquear saída com estoque negativo**  
   Ou ao menos exigir confirmação explícita.

8. **Indicador de "produto pendente de treinamento"**  
   No estoque, badge ou filtro para ver produtos com `confirmado: NAO`.

9. **Edição de embalagem inline**  
   Na tela de produto, poder editar o fator e descrição de uma embalagem sem sair da tela.

10. **Atalho da esteira no menu principal**  
    Hoje o acesso à esteira de treinamento é: Config → Treinamento → tela de treino. São 2 cliques desde qualquer tela.

### Baixa prioridade

11. **Exportar relatório de estoque em CSV**  
    Para análise externa ou backup.

12. **Visualizar PDF da NF-e**  
    O endpoint `api/nfe/danfe.js` existe, mas não há botão na UI para acessá-lo após a importação.

13. **Desfazer última saída**  
    Permitir cancelar a movimentação mais recente dentro de um janela de tempo.

---

## 20. Ideias Futuras

1. **Autenticação básica** (PIN ou senha simples) para proteger operações destrutivas
2. **Modo offline** com service worker + sync quando voltar a ter conexão
3. **Notificações push** para contas vencendo e estoque baixo
4. **Relatório de CMV** (Custo de Mercadoria Vendida) — hoje `SAIDA` é registrado mas não consolidado
5. **Multi-restaurante** — o sistema usa `CNPJ_RESTAURANTE` como constante; com ajuste mínimo poderia servir múltiplas unidades
6. **Reconhecimento automático por descrição semântica** (embeddings) para produtos sem código
7. **Compra sugerida** — baseada em consumo médio dos últimos 30 dias vs estoque mínimo

---

## 21. Perguntas Pendentes / Decisões em Aberto

1. **O botão ☢️ Apagar TUDO deve ser removido** após os testes? O usuário pediu para retirá-lo depois. Hoje está visível na tela de treinamento.

2. **A tela de Auditoria do Cadastro** foi criada nesta sessão. Foi testada em produção com dados reais?

3. **Duas versões do comando ChatGPT** ainda coexistem no JS (`copiarComandoGPT` antigo e `montarTextoPacote` novo). O antigo deve ser removido?

4. **O campo `produto_teste`** existe na tabela Produtos mas não há UI para marcá-lo. Como produtos são marcados como teste hoje?

5. **A tela de Diagnóstico** testa conexão com "API Meu Danfe" e "Inteligência (Gemini)". O Gemini está em uso em algum endpoint? Não foi encontrado no código analisado.

6. **O arquivo `api/_lib/sheets.js`** ainda existe (resquício da implementação Google Sheets). Deve ser removido para limpar o projeto?

7. **`api/nfe/add-xml.js` e `api/nfe/danfe.js`** existem mas não foram analisados neste diagnóstico. Quais telas os utilizam?

8. **Sem paginação no estoque**: a tabela `Produtos` é carregada inteira (`readRows` sem filtros). Em volume alto isso pode ser lento. Quando é o momento de paginar?

---

## Apêndice: Estrutura de Arquivos

```
Superajudante/
├── public/
│   └── index.html              # SPA completo (~2090 linhas)
├── api/
│   ├── admin.js                # Endpoint multiplexado (22 recursos)
│   ├── dashboard.js            # GET stats do dashboard
│   ├── listar.js               # GET genérico de qualquer tabela
│   ├── teste.js                # GET diagnóstico de variáveis/conexões
│   ├── _lib/
│   │   ├── db.js               # Supabase CRUD helpers
│   │   ├── util.js             # CORS, json(), readBody(), rate-limit
│   │   ├── parser.js           # Parse XML NF-e, detectarFator, normalizarDesc
│   │   ├── reconhecimento.js   # encontrarProduto() — 5 estratégias
│   │   ├── meudanfe.js         # Cliente API Meu Danfe
│   │   ├── estoque.js          # entradaEstoque() shared helper
│   │   └── sheets.js           # (legado Google Sheets — não mais usado)
│   ├── nfe/
│   │   ├── buscar.js           # POST — dispara/consulta Meu Danfe (polling)
│   │   ├── conferir.js         # POST — parse XML + reconhecimento (sem gravar)
│   │   ├── confirmar.js        # POST — grava estoque, notas, contas
│   │   ├── danfe.js            # GET/POST — PDF da NF-e
│   │   └── add-xml.js          # POST — adiciona XML diretamente
│   ├── estoque/
│   │   ├── saida.js            # POST — saída manual de estoque
│   │   └── inventario.js       # GET busca EAN / POST ajuste inventário
│   └── contas/
│       └── pagar.js            # POST — marcar conta como PAGO
├── capacitor.config.json       # Android: server.url = Vercel (APK permanente)
├── vercel.json                 # maxDuration 30s, rewrite / → index.html
└── package.json
```

---

*Documento gerado em modo somente-leitura. Nenhum arquivo foi criado, editado ou commitado.*
