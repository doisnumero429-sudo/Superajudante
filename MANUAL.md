# Manual do Super Ajudante

**Para quem é este documento:**
Este manual serve tanto para um usuário humano que vai operar o app no dia a dia, quanto para uma IA que precisa entender como o sistema funciona para dar suporte, criar melhorias ou responder dúvidas.

---

## O que é o Super Ajudante

É um app para restaurantes controlarem o estoque a partir das **notas fiscais de entrada** (NF-e). Em vez de digitar produto por produto, o usuário aponta a câmera para o QR code da nota — ou cola a chave / o XML — e o app faz quase todo o trabalho automaticamente.

O app roda no Android (via Capacitor) e tem um backend serverless na Vercel com banco de dados no Supabase.

---

## A inteligência por trás do sistema

O sistema é dividido em **o que a máquina faz sozinha** e **o que precisa de um humano**.

### O que a máquina faz sozinha

| Tarefa | Como faz |
|---|---|
| Lê a nota fiscal | Baixa o XML via API externa (Meu Danfe) |
| Entende cada produto da nota | Parser extrai código, descrição, quantidade, valor |
| Reconhece produtos já cadastrados | Usa 5 estratégias em cascata (ver abaixo) |
| Calcula quanto entra no estoque | Detecta o fator de embalagem na descrição: "CX24" → fator 24 |
| Calcula custo médio ponderado | A cada entrada, recalcula: `(estoque_antigo × custo_antigo + qtd_nova × custo_novo) / estoque_novo` |
| Cria embalagem base para novos produtos | Sempre que cria um produto novo, cria também a embalagem mínima (fator 1) |
| Manda produto novo para a fila do GPT | Produto novo entra automaticamente na esteira para o ChatGPT pesquisar |
| Aprende com cada importação | Grava que CNPJ X + código Y = produto Z (nunca vai precisar perguntar de novo) |
| Bloqueia duplicidade | Não deixa importar a mesma nota duas vezes |

### As 5 estratégias de reconhecimento de produto

Quando chega um item na nota, o sistema tenta identificá-lo nesta ordem:

```
1. id_produto direto         → se a nota já veio com id preenchido (100% confiança)
2. CNPJ + código na nota     → busca direto na tabela Produtos (99% confiança)
3. Mapeamento CNPJ + código  → tabela Produto_Fornecedor (95% confiança)
4. Mapeamento por EAN        → código de barras → produto (90% confiança)
5. Mapeamento por descrição  → descrição normalizada → produto (70% confiança)
6. Alias                     → apelidos cadastrados → produto (60% confiança)
```

**Descrição normalizada** = sem acento, sem pontuação, maiúsculo, espaços simples.
Exemplo: `"Cerveja HEINEKEN® 600ml."` → `"CERVEJA HEINEKEN 600ML"`

Se nenhuma estratégia reconhecer o produto, ele é marcado como **produto novo** e o usuário precisa preencher os dados na tela de conferência.

---

## Fluxo completo de uma Entrada de Nota Fiscal

```
USUÁRIO                          APP                          BANCO DE DADOS
   │                               │                                │
   │── digita chave ou XML ──────▶│                                │
   │                               │── valida 44 dígitos ─────────▶│
   │                               │── checa se já foi importada ──▶│
   │                               │── chama API Meu Danfe ─────────▶(externa)
   │                               │                                │
   │◀── aguardando... ─────────────│                                │
   │                               │── quando XML chega:            │
   │                               │   - faz o parse da nota        │
   │                               │   - tenta reconhecer produtos  │
   │                               │   (5 estratégias)              │
   │                               │                                │
   │◀── tela de conferência ───────│                                │
   │                               │                                │
   │ (HUMANO REVISA)               │                                │
   │ • produtos verdes = OK        │                                │
   │ • produtos em destaque =      │                                │
   │   NOVO (precisa preencher)    │                                │
   │                               │                                │
   │── confirma ─────────────────▶│                                │
   │                               │── grava fornecedor ──────────▶│
   │                               │── grava nota fiscal ─────────▶│
   │                               │── para cada produto:           │
   │                               │   atualiza estoque            │
   │                               │   calcula custo médio          │
   │                               │   grava movimentação           │
   │                               │   aprende mapeamento           │
   │                               │── grava contas a pagar ───────▶│
   │                               │── cria embalagem base ────────▶│
   │                               │── enfileira no GPT ───────────▶│
   │                               │                                │
   │◀── "Nota importada com sucesso"│                               │
```

---

## Fase 1 — Entrada

O usuário informa a nota de três formas:
- **Chave de 44 dígitos** (digita ou escaneia o QR Code com a câmera)
- **Upload do arquivo .xml** (recebido por e-mail do fornecedor)
- **Cola o conteúdo XML** diretamente

O sistema valida a chave, checa se já foi importada e busca o XML na API Meu Danfe. Enquanto espera (pode levar alguns segundos), exibe "Aguardando...".

---

## Fase 2 — Conferência (onde o humano atua)

Esta é a tela mais importante. O sistema já preencheu tudo que conseguiu; agora o usuário revisa.

### O que o sistema já preencheu automaticamente:
- Nome do fornecedor
- Data de emissão, número da nota, valor total
- Para cada produto reconhecido: nome interno, categoria, quantidade, custo
- Parcelas a pagar (vencimento, valor, forma de pagamento)

### O que o usuário precisa preencher (somente para produtos novos):

| Campo | Obrigatório | Dica |
|---|---|---|
| **Nome interno** | Sim | Como o produto será chamado no restaurante. Ex.: "Cerveja Heineken Long Neck" |
| **Categoria** | Sim | Sem isso o sistema bloqueia a confirmação |
| **Unidade de estoque** | Sim | O sistema detecta, mas revise: UN, KG, L, etc. |
| **Fator de conversão** | Sim | Se a nota diz "10 CX de 24 UN", o fator é 24. O sistema tenta detectar pela descrição. |

> **Regra de ouro:** Se a categoria estiver em branco, o sistema não deixa confirmar. Isso é intencional — evita produto sem classificação no estoque.

### Revisar mesmo quando está verde:
Produtos reconhecidos aparecem prontos, mas vale conferir visualmente se o **fator de conversão** está certo. Uma caixa de 24 cervejas com fator errado (1 em vez de 24) vai entrar 240 unidades a menos no estoque.

---

## Fase 3 — Confirmação (o que acontece nos bastidores)

Ao confirmar, o sistema executa tudo isso em sequência:

1. **Valida** que todos os produtos novos têm categoria
2. **Bloqueia duplicidade** — verifica novamente se a nota já foi importada
3. **Cria o fornecedor** no cadastro (se for a primeira nota dele)
4. **Para cada produto da nota:**
   - Se já existe: atualiza estoque e recalcula custo médio ponderado
   - Se é novo: cadastra o produto com os dados da conferência
   - Grava o item vinculado à nota
   - Grava a movimentação de entrada (rastreabilidade)
   - Aprende o mapeamento: CNPJ do fornecedor + código do produto = este produto interno
   - Se é novo: cria embalagem base (fator 1) automaticamente
   - Se é novo: enfileira na esteira do GPT para pesquisa posterior
5. **Cria as contas a pagar** (uma linha por parcela)

Depois da confirmação, o estoque já está atualizado.

---

## O ciclo GPT — como o sistema fica mais inteligente

Produtos novos entram com embalagem básica (fator 1). Para corrigir isso — e criar mapeamentos mais completos — existe o ciclo GPT:

```
1. Acesse "Esteira de Treinamento"
         ↓
2. Veja os produtos novos enfileirados
   (automaticamente adicionados na confirmação da NF-e)
         ↓
3. Exporte o "Pacote para GPT"
   (JSON com contexto do restaurante + produtos desconhecidos)
         ↓
4. Cole no ChatGPT com o prompt do sistema
   (o GPT pesquisa: embalagem correta, mapeamentos, aliases)
         ↓
5. Copie o JSON de resposta do GPT
         ↓
6. Importe na tela "Importar resposta do GPT"
         ↓
7. Sistema atualiza:
   - Embalagens com fator correto (ex.: CX = 24)
   - Mapeamentos CNPJ+código
   - Aliases (apelidos alternativos)
   - Confirma produtos como "catalogados"
```

**Depois de passar pelo ciclo GPT uma vez, o produto é reconhecido automaticamente nas próximas notas.** O sistema nunca mais vai perguntar sobre ele.

---

## Como o aprendizado funciona na prática

| Situação | O que o sistema aprende |
|---|---|
| Produto novo confirmado na NF-e | CNPJ + código → id_produto (mapeamento direto) |
| Resposta GPT importada | Mapeamentos adicionais, embalagens, aliases |
| Produto reconhecido em nova nota | Incrementa contador "vezes utilizado" no mapeamento |
| Alias criado | Descrição alternativa → mesmo produto |

**Resultado prático:** No início, muitos produtos aparecem como "novos". Após 2 ou 3 ciclos GPT, a maioria das notas é importada sem precisar de nenhuma interação humana.

---

## Bloqueios que existem de propósito

Estes erros não são bugs — são proteções:

| Mensagem | O que significa | O que fazer |
|---|---|---|
| "NF-e já importada" | Nota com essa chave já está no banco | Nada — ela já entrou |
| "Há itens novos sem categoria" | Produto novo sem classificação | Preencher a categoria na tela de conferência |
| "Aguarde X segundos" | Rate limit da API Meu Danfe | Aguardar e tentar de novo |
| "Chave inválida (44 dígitos)" | Chave digitada errada | Redigitar ou escanear o QR Code |
| "Dados incompletos" | Faltou nota, fornecedor ou itens | Verificar o XML |

---

## Pontos onde o erro humano pode acontecer

| Risco | Onde | Como evitar |
|---|---|---|
| Fator de conversão errado | Tela de conferência | Verificar sempre: se a nota diz "CX", o fator deve ser 12 ou 24, nunca 1 |
| Nome interno confuso | Tela de conferência | Usar nome completo e padronizado. Ex.: "Cerveja Heineken 600ml Long Neck" |
| Categoria errada | Tela de conferência | Criar categorias claras antes de começar a importar |
| Confirmar sem revisar | Tela de conferência | Sempre olhar os itens em destaque (novos) antes de confirmar |
| Embalagem errada pós-GPT | Importação GPT | Validar o JSON do GPT antes de importar; conferir fatores de caixas de bebida |

---

## Estrutura das tabelas (referência técnica)

| Tabela | O que guarda |
|---|---|
| `produtos` | Catálogo interno. Um produto = uma linha. |
| `fornecedores` | Cadastro de fornecedores (CNPJ, nome, endereço) |
| `notas_fiscais` | Cada NF-e importada (chave, número, valor, XML) |
| `itens_nota` | Cada linha de cada nota (produto × nota) |
| `movimentacoes_estoque` | Todo movimento de estoque: entrada, saída, ajuste |
| `contas_pagar` | Parcelas a pagar por nota |
| `produto_fornecedor` | Mapeamento: CNPJ + código → id_produto |
| `aliases_produto` | Apelidos alternativos de um produto |
| `embalagens` | Embalagens disponíveis por produto (UN, CX, FD...) e seus fatores |
| `categorias` | Classificação dos produtos |
| `treino_fila` | NF-es na esteira de treinamento GPT |
| `treino_itens` | Itens individuais na esteira |
| `configuracoes` | Parâmetros do sistema (CNPJ do restaurante, limites de API) |

---

## Glossário

| Termo | Significado |
|---|---|
| **Chave NF-e** | Número de 44 dígitos que identifica uma nota fiscal no Brasil |
| **Fator de conversão** | Quantas unidades de estoque tem uma unidade da nota. CX de 24 garrafas → fator 24 |
| **Custo médio ponderado** | Média do custo considerando quantidade: se tinha 10 UN a R$1 e entrou mais 10 UN a R$2, custo médio = R$1,50 |
| **Mapeamento** | Registro que liga CNPJ do fornecedor + código do produto → produto interno |
| **Alias** | Apelido alternativo de um produto. Permite que nomes diferentes refiram ao mesmo item |
| **Embalagem base** | Embalagem mínima criada automaticamente (fator=1). Suficiente para operar, mas pode ser refinada pelo GPT |
| **Esteira GPT** | Fila de produtos novos que aguardam pesquisa pelo ChatGPT para completar dados |
| **Produto confirmado** | Produto com nome interno e categoria preenchidos (não está mais pendente) |
| **Produto pendente** | Produto importado mas sem nome/categoria definidos — precisa de curadoria |
| **Normalização** | Processo de remover acentos, pontuação e deixar tudo maiúsculo para comparar descrições diferentes do mesmo produto |
| **Curadoria** | Processo de revisar e confirmar os dados de um produto (nome, categoria, embalagem) |

---

## Resumo para uma frase

> O Super Ajudante lê a nota fiscal, reconhece automaticamente os produtos já cadastrados, pede ao usuário que nomeie apenas os produtos novos, grava tudo no estoque e aprende com cada importação — ficando mais autônomo ao longo do tempo graças ao ciclo GPT.
