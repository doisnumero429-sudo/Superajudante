# RELATÓRIO TÉCNICO — CENTRAL DA CRIS
## Análise de viabilidade e plano de evolução do Super Ajudante
*Análise estática — nenhum arquivo foi modificado*

---

## RESUMO EXECUTIVO

O Super Ajudante tem uma base técnica sólida e já salva a maioria dos dados necessários
para a Central da Cris. A boa notícia: **quase nada precisa ser reescrito**, só expandido.
O risco principal não é técnico, é de ordem. Se as funcionalidades forem implementadas
na ordem errada, o banco de dados pode ficar bagunçado e difícil de corrigir depois.
Este relatório explica o que já existe, o que falta e a ordem certa de fazer.

---

## 1. CENTRAL DA CRIS — TELA/PAINEL ESPECÍFICO

### O app hoje tem estrutura para isso?

**Sim, mas não existe ainda.** O app usa um sistema de "views" (telas) trocadas por
abas na parte de baixo da tela. Existe uma função `nav('v-dash')` que troca entre telas.
Basta criar uma nova tela chamada `v-cris` no mesmo arquivo `public/index.html`.

### Onde essa tela entraria no app?

Na barra de navegação inferior, como uma nova aba — possivelmente substituindo ou
complementando a aba de Dashboard atual. A Central da Cris seria uma visão
personalizada que agrega em um só lugar:

- Limite semanal de compras (quanto já gastou, quanto ainda pode gastar)
- Contas a pagar da semana (abertas e vencidas)
- Solicitações pendentes dos gerentes
- Últimas notas lançadas
- Atalhos rápidos: lançar nota, lançar pagamento avulso, consultar histórico

### Quais arquivos seriam afetados?

| Arquivo | O que mudaria |
|---|---|
| `public/index.html` | Nova tela `v-cris` + nova aba na navegação |
| `api/dashboard.js` | Novos dados: limite semanal, compras da semana |
| `api/admin.js` | Novos recursos para solicitações e pagamentos |

**Impacto: MÉDIO** — não quebra nada existente, só adiciona.

---

## 2. USUÁRIOS E PERMISSÕES

### O app hoje diferencia Cris, gerente e admin?

**Não.** O app não tem nenhum sistema de login ou controle de acesso.
O único registro de "usuário" no sistema é o campo `usuario` na tabela
`movimentacoes_estoque`, que é um texto livre — ou seja, qualquer pessoa
pode escrever qualquer nome lá. Não existe senha, sessão, nem perfil.

### Qual seria a forma mais simples e segura de criar isso?

**Opção recomendada: Login por PIN salvo no banco de dados.**

Criar uma tabela simples de usuários:

```
Tabela: usuarios
─────────────────────────────────────────────
id_usuario       → USR-0001, USR-0002...
nome             → "Cris", "Gerente João"
pin              → código numérico de 4 a 6 dígitos (ex: 1234)
perfil           → "admin", "gerente", "cris"
ativo            → SIM ou NAO
criado_em        → data/hora
```

**Como funciona na prática:**
1. Ao abrir o app, uma tela simples de PIN aparece
2. O usuário digita o PIN, o app consulta o servidor
3. O servidor valida o PIN e retorna nome + perfil
4. O app salva o perfil localmente (na memória da sessão)
5. Dependendo do perfil, certas abas ficam visíveis ou ocultas

**O que cada perfil pode ver:**

| Funcionalidade | Admin | Cris | Gerente |
|---|---|---|---|
| Lançar NF-e | ✅ | ✅ | ❌ |
| Central da Cris | ✅ | ✅ | ❌ |
| Contas a pagar | ✅ | ✅ | ver apenas |
| Retirada de estoque | ✅ | ✅ | ✅ |
| Abrir solicitação | ✅ | ✅ | ✅ |
| Responder solicitação | ✅ | ✅ | ❌ |
| Configurações | ✅ | ❌ | ❌ |
| Treinamento | ✅ | ✅ | ❌ |

**Cuidados importantes:**
- O PIN não deve ser comparado no app (frontend) — sempre no servidor
- O servidor deve retornar apenas `{ok, nome, perfil}` — nunca o PIN
- Para o app mobile com uso interno, PIN simples é suficiente e seguro
- Não é necessário usar JWT, cookies ou OAuth para esse caso

**Impacto: MÉDIO** — precisa de nova tabela + nova tela de login + lógica de perfil no frontend.
Mas como o app é interno, não precisa ser complexo.

---

## 3. SOLICITAÇÕES E CHAMADOS INTERNOS

### Situação atual

**Não existe nenhuma estrutura para isso.** O sistema hoje só conhece NF-e, estoque
e contas a pagar. Solicitações internas precisariam de tabelas e telas completamente novas,
mas **não mexem no estoque** — ficam completamente separadas.

### Tabelas novas necessárias

**Tabela 1: `solicitacoes`**
```
id_solicitacao        → SOL-0001, SOL-0002...
setor_solicitante     → "COZINHA", "SEGURANÇA", "ZELADOR", "ADMINISTRATIVO", outro texto livre
quem_pediu            → nome de quem abriu (vinculado a usuarios)
titulo                → resumo em uma linha
descricao             → texto livre do pedido
urgencia              → "BAIXA", "NORMAL", "ALTA", "URGENTE"
status                → "ABERTO", "EM_ANALISE", "APROVADO", "NEGADO", "RESOLVIDO", "CANCELADO"
criado_em             → data/hora automática
atualizado_em         → data/hora da última mudança
resolvido_em          → data/hora quando foi finalizado
```

**Tabela 2: `solicitacoes_mensagens`**
```
id_mensagem           → MSG-0001...
id_solicitacao        → referência à solicitação
autor                 → nome de quem enviou
perfil_autor          → "gerente", "cris", "admin"
texto                 → conteúdo da mensagem
criado_em             → data/hora
```

**Tabela 3: `respostas_rapidas`**
```
id_resposta           → RRP-0001...
texto                 → "Recebido, aguardando aprovação", "Produto não disponível", etc.
perfil                → para qual perfil aparece essa resposta rápida
ativo                 → SIM ou NAO
```

### Telas necessárias

**Para o gerente:**
- Tela "Nova Solicitação": formulário com setor, quem pediu, descrição, urgência
- Tela "Minhas Solicitações": lista com filtro por status, busca por texto

**Para a Cris:**
- Tela "Solicitações Recebidas": lista geral, filtro por urgência/status/setor
- Detalhe de cada solicitação: histórico de mensagens + botões de ação (aprovar, negar, resolver)
- Respostas rápidas: lista de textos pré-cadastrados para clicar e enviar

### Isso mexe no estoque?

**Não.** As solicitações são um módulo completamente independente. Uma solicitação
pode *pedir* algo do estoque, mas o estoque só muda se a Cris ou o sistema
processarem uma retirada separadamente. A solicitação em si é só um registro de comunicação.

### Risco de implementação

**Baixo.** Como não mexe em nada existente, o risco de quebrar algo é mínimo.
O único cuidado é garantir que a tela de solicitações use o sistema de usuários
(descrito no item 2) para saber quem está usando.

**Impacto: MÉDIO** — 3 novas tabelas + 2 a 3 novas telas, mas sem tocar no núcleo do sistema.

---

## 4. RETIRADA DE ESTOQUE PELO GERENTE

### A estrutura atual já suporta isso?

**Quase totalmente.** A tabela `movimentacoes_estoque` já tem os campos:

| Campo atual | Serve para |
|---|---|
| `id_produto` | qual produto foi retirado |
| `quantidade` | quanto foi retirado |
| `tipo = 'SAIDA'` | identifica que é uma saída |
| `data` | data e hora da retirada |
| `usuario` | quem retirou (campo texto) |
| `motivo` | motivo/observação |
| `observacao` | mais detalhes |

**O que está faltando:** o campo `setor_solicitante` (cozinha, segurança, zelador, etc.).
Hoje isso poderia ser colocado no campo `observacao`, mas seria misturado com
outras informações e difícil de filtrar depois.

**Solução recomendada:** adicionar uma coluna `setor` na tabela `movimentacoes_estoque`.
Isso é uma mudança pequena e segura.

### Precisa criar tela nova ou adaptar a existente?

A tela de **Saída de Estoque** já existe (`v-saida`). Precisaria apenas adicionar:
- Campo "Setor que pediu" (seleção: cozinha, segurança, zelador, administrativo, outro)
- Campo "Quem retirou" (preenchido automaticamente pelo login, se implementado)

### Isso afetaria o cálculo de estoque?

**Não afeta o cálculo.** O cálculo de estoque é `estoque_atual - quantidade_retirada`.
Independente de quem retirou ou qual setor pediu, a matemática é a mesma.
Os campos adicionais são apenas registro histórico.

### Cuidados necessários

1. Nunca deixar o campo `id_produto` vazio — a saída deve sempre estar vinculada a um produto existente
2. Se o gerente retirar mais do que o estoque disponível, o sistema já emite um alerta (`alerta_negativo`)
   — esse comportamento deve ser mantido e talvez reforçado para o gerente
3. A saída pelo gerente fora do horário deve ser identificada no relatório para a Cris revisar depois
4. Sugestão: criar um filtro na tela de movimentações que mostre "saídas registradas pelo gerente"

**Impacto: PEQUENO** — adicionar 1 coluna na tabela + pequena adaptação na tela existente.

---

## 5. COMPRAS E LIMITE SEMANAL

### O app hoje salva dados suficientes para calcular o limite?

**Sim.** A tabela `notas_fiscais` salva `valor_total_nota` e `data_entrada`
(data em que a nota foi lançada no sistema). Com isso, é possível calcular
quanto foi comprado em qualquer período.

### É melhor calcular por data da compra, pagamento ou lançamento?

**Recomendação: usar `data_entrada` da nota fiscal** (quando foi lançada no sistema).

Comparação das opções:

| Critério | Vantagem | Desvantagem |
|---|---|---|
| `data_emissao` (data da nota) | Reflete quando a compra aconteceu | Pode ser uma data passada/retroativa |
| `data_entrada` (quando foi lançado) | Está sob controle da Cris, fácil de auditar | Pode ser lançado com atraso |
| `data_pagamento` | Reflete saída real de caixa | Pagamento pode ser parcelado/futuro |

Para limite semanal de compras, `data_entrada` é o mais prático porque:
- A Cris controla quando lança
- Fica claro "lancei R$ X nessa semana"
- Não depende de pagamento acontecer para contar no limite

### O sistema diferencia compra, pagamento e lançamento?

**Parcialmente:**
- **Lançamento** = `notas_fiscais.criado_em` (timestamp de quando foi inserido no banco)
- **Data da compra/entrada** = `notas_fiscais.data_entrada` (preenchido durante importação)
- **Pagamento** = `contas_pagar.data_pagamento` (quando marcado como pago)

**O que falta:** o campo `LIMITE_SEMANAL_COMPRAS` na tabela `configuracoes`.
Atualmente a tabela de configurações é flexível (chave + valor), então basta
**inserir um novo registro** com chave `LIMITE_SEMANAL_COMPRAS` e valor `30000`.
Não precisa alterar a estrutura da tabela.

### O que o dashboard da Cris deve mostrar

```
┌─────────────────────────────────────────────┐
│  LIMITE SEMANAL                             │
│  R$ 12.450,00 de R$ 30.000,00              │
│  ██████████░░░░░░░░░░ 41,5%                │
│  R$ 17.550,00 disponível                   │
│  Semana: 02/06 a 08/06    [Trocar período] │
├─────────────────────────────────────────────┤
│  COMPRAS DA SEMANA (3 notas)               │
│  • Fornecedor X — R$ 5.230,00 — 03/06      │
│  • Fornecedor Y — R$ 4.100,00 — 04/06      │
│  • Fornecedor Z — R$ 3.120,00 — 04/06      │
├─────────────────────────────────────────────┤
│  PAGAMENTOS DA SEMANA                       │
│  • Conta #123 — R$ 2.800,00 — 03/06        │
└─────────────────────────────────────────────┘
```

**Impacto: PEQUENO** — dados já existem. Precisam de:
1. Nova configuração no banco: `LIMITE_SEMANAL_COMPRAS = 30000`
2. Nova consulta no `api/dashboard.js`
3. Nova seção na tela da Cris

---

## 6. PAGAMENTOS MANUAIS SEM NOTA FISCAL

### A tabela atual de contas a pagar suporta isso?

**Parcialmente, mas com problema.** A tabela `contas_pagar` foi desenhada
pensando em notas fiscais. Veja os campos que causam problema:

| Campo atual | Problema para lançamento manual |
|---|---|
| `id_nota` | Faz referência a uma nota fiscal — e se não tem nota? |
| `fornecedor_id` | Deve ser um fornecedor cadastrado — e se for pessoa física, prestador? |
| `numero_parcela` | Faz sentido para nota, mas estranha para gasto avulso |

### Precisa alterar ou criar nova tabela?

**Recomendação: alterar a tabela existente** (adicionar colunas, não criar nova).
Criar uma tabela separada dividiria o histórico de pagamentos em dois lugares,
dificultando relatórios depois.

**Colunas a adicionar em `contas_pagar`:**

```
tipo_origem         → "NFE" (veio de nota fiscal) ou "MANUAL" (lançamento avulso)
categoria_despesa   → "BOLETO", "SERVICO", "MANUTENCAO", "FRETE", "COMPRA_SEM_NOTA", "OUTRO"
nome_fornecedor_livre → texto livre para quando o fornecedor não está no cadastro
data_lancamento     → quando foi lançado no sistema (diferente de data_emissao)
entra_estoque       → SIM ou NAO (para futura integração com entrada sem nota)
forma_pgto_detalhe  → complemento da forma: "PIX Fulano", "Boleto Banco X"
```

**Colunas a tornar opcionais (nullable):**
```
id_nota             → pode ficar vazio para lançamentos manuais
fornecedor_id       → pode ficar vazio se usar nome_fornecedor_livre
numero_parcela      → pode ser 1 por padrão para lançamentos manuais
```

### Como não misturar pagamento com entrada de estoque?

A regra é: **o campo `entra_estoque = 'NAO'` por padrão para lançamentos manuais**.
Se a Cris lançar uma "compra sem nota que entrou no estoque", ela pode marcar `entra_estoque = 'SIM'`
e daí o sistema pode alertar que ela precisa dar a entrada manualmente na tela de Estoque.
Os dois processos (pagar e dar entrada) seguem separados — a conta a pagar registra o financeiro,
a movimentação de estoque registra o físico.

**Impacto: MÉDIO** — mudança na estrutura do banco + nova tela de lançamento manual.
Requer cuidado para não quebrar o fluxo de NF-e existente.

---

## 7. HISTÓRICO DE PREÇOS POR PRODUTO E FORNECEDOR

### O app hoje salva dados suficientes para isso?

**Sim, e está melhor do que parece.** As informações estão espalhadas em 3 tabelas
que podem ser cruzadas:

```
movimentacoes_estoque (tipo=ENTRADA)
        ↕
    itens_nota
        ↕
   notas_fiscais
        ↕
   fornecedores
```

**O que é salvo hoje e já serve para o histórico:**

| Dado | Onde está |
|---|---|
| Produto interno (nome, categoria) | `produtos` |
| Fornecedor (nome, CNPJ) | `fornecedores` |
| Data da compra | `notas_fiscais.data_entrada` |
| Valor unitário original da NF-e | `itens_nota.valor_unitario_nf` |
| Quantidade comprada | `itens_nota.quantidade_nf` |
| Custo convertido para estoque | `itens_nota.custo_unitario_estoque` |
| Ligação produto ↔ nota ↔ fornecedor | `itens_nota.id_produto` + `notas_fiscais.fornecedor_id` |

### O que está fraco?

1. **Não existe uma consulta pronta para isso.** Os dados estão lá mas nenhum
   endpoint atual retorna "histórico de preços do produto X por fornecedor".
   É uma questão de criar a consulta, não de dados faltantes.

2. **O custo registrado na movimentação já é o custo convertido** (após divisão
   pelo fator de embalagem). Para comparar preços com precisão, o ideal é
   usar o `valor_unitario_nf` direto da `itens_nota`, não o da movimentação.

3. **Lançamentos manuais (entrada sem nota) não têm fornecedor ligado.**
   O histórico de preços ficará incompleto para produtos comprados sem nota.

### O que falta para relatórios confiáveis?

**Nada no banco precisa mudar.** O que falta é:
- Um endpoint novo: `GET /api/admin?recurso=produto-historico-precos&id_produto=X`
  que retorna todos os `itens_nota` daquele produto com data + fornecedor + preço
- Uma tela na Central da Cris com pesquisa de produto e exibição do histórico

**Relatórios simples que poderiam vir antes de qualquer "inteligência":**
1. "Últimas 10 compras deste produto" (produto + data + fornecedor + preço unitário)
2. "Menor preço pago nos últimos 90 dias"
3. "Fornecedor mais frequente para este produto"
4. "Evolução do preço ao longo do tempo" (lista ou gráfico simples)

**Impacto: PEQUENO** — nenhuma mudança no banco. Só novos endpoints e nova tela.

---

## 8. CADASTRO DE FORNECEDORES COM WHATSAPP

### A tabela atual já suporta isso?

**Parcialmente.** Veja o que já existe e o que falta:

| Campo | Situação |
|---|---|
| nome (razao_social, nome_fantasia) | ✅ Já existe |
| cnpj | ✅ Já existe |
| telefone | ✅ Já existe (mas é campo genérico) |
| email | ✅ Já existe |
| observacoes | ✅ Já existe |
| ativo | ✅ Já existe |
| **vendedor** | ❌ Faltando |
| **whatsapp** | ❌ Faltando (poderia usar `telefone`, mas melhor separar) |
| **categoria_principal** | ❌ Faltando |
| **mensagem_padrao_whatsapp** | ❌ Faltando (opcional) |

### O que precisaria acrescentar?

Adicionar 3 colunas na tabela `fornecedores`:

```sql
ALTER TABLE fornecedores ADD COLUMN vendedor TEXT;
ALTER TABLE fornecedores ADD COLUMN whatsapp TEXT;
ALTER TABLE fornecedores ADD COLUMN categoria_principal TEXT;
```

**Como funciona o botão WhatsApp:**
O app monta um link no formato:
`https://wa.me/5511999999999?text=Ola%20Fulano%2C%20sou%20da%20Central%20da%20Cris`

Esse link, quando clicado no celular, abre o WhatsApp diretamente na conversa
com aquele número. É um recurso nativo do WhatsApp, não precisa de API paga.

**Impacto: PEQUENO** — 3 novas colunas + pequena adaptação na tela de fornecedores.

---

## 9. COMPARAÇÃO INTELIGENTE DE FORNECEDORES (FUTURO)

### A estrutura atual permite isso futuramente?

**Sim, mas com uma ressalva importante: a qualidade depende do cadastro.**

Se os produtos estiverem mal cadastrados (nomes diferentes para o mesmo item,
fornecedores sem CNPJ, produtos duplicados), a comparação vai dar resultados errados.

### Quais dados precisam ser salvos desde agora?

**Boas notícias: o sistema já salva quase tudo que será necessário:**

| Dado necessário | Status atual |
|---|---|
| Produto → fornecedor → preço → data | ✅ Já salvo (itens_nota + notas_fiscais) |
| Código do produto no fornecedor | ✅ Já salvo (produto_fornecedor.codigo_produto_nf) |
| Quantas vezes cada fornecedor forneceu | ✅ Já salvo (produto_fornecedor.vezes_utilizado) |
| Última compra de cada produto/fornecedor | ✅ Já salvo (produto_fornecedor.ultima_utilizacao) |
| Fator de conversão (embalagem → unidade) | ✅ Já salvo (itens_nota.fator_conversao) |
| **Preço por unidade base (após conversão)** | ✅ Já salvo (itens_nota.custo_unitario_estoque) |

### Relatórios simples que poderiam vir antes da comparação automática

1. **"Para este produto, quem vendeu mais barato nos últimos 6 meses?"**
2. **"Qual foi a variação de preço deste produto entre fornecedores?"**
3. **"Lista de compras: baseado no histórico, de quem você costuma comprar cada item?"**

### Riscos se os produtos estiverem mal cadastrados

- Um mesmo produto com dois nomes diferentes vai aparecer como dois produtos no histórico
- O sistema vai pensar que dois fornecedores vendem produtos diferentes quando na verdade vendem o mesmo
- A comparação vai ficar inútil ou enganosa

**Solução preventiva:** antes de implementar comparação, rodar a "auditoria de cadastro"
que já existe (`/api/admin?recurso=auditoria-cadastro`) e corrigir duplicatas e inconsistências.

**Impacto para o futuro: PEQUENO** — dados já estão sendo coletados. Quando chegar a hora,
é só criar as consultas e a tela de comparação.

---

## 10. O QUE O SISTEMA SALVA DE UMA NF-E HOJE

### Dados que SÃO salvos e são suficientes

**Da nota em si:**
- Chave da NF-e (44 dígitos) — identificador único
- Número, série e modelo da nota
- CNPJ do fornecedor
- Data de emissão (quando o fornecedor emitiu)
- Data de entrada (quando a Cris lançou no sistema)
- Natureza da operação (texto)
- Valor dos produtos, frete, desconto, despesas acessórias, valor total
- Status da importação

**Do fornecedor:**
- Nome, CNPJ — tudo o que a nota informa é salvo e vinculado

**De cada produto da nota:**
- Código do produto no fornecedor
- Código de barras (EAN)
- Descrição original da nota (como o fornecedor chama o produto)
- NCM (código fiscal do produto)
- CFOP (natureza da operação por item)
- Unidade de medida original da nota
- Quantidade comprada (na unidade da nota)
- Valor unitário original da nota
- Valor total do item
- Fator de conversão (embalagem para unidade de estoque)
- Quantidade convertida para estoque
- Custo unitário já convertido para estoque
- Produto interno reconhecido (vínculo com o cadastro do restaurante)

**Das parcelas/duplicatas:**
- Número da parcela
- Valor
- Data de vencimento
- Forma de pagamento (quando informada na nota)

**Ligação completa:**
A nota salva o vínculo `itens_nota.id_produto`, então é sempre possível saber
"este item da nota corresponde a este produto do estoque interno".

---

### Dados que SÃO salvos mas podem estar fracos

| Dado | Por que está fraco |
|---|---|
| XML completo da nota | Armazenado como texto no banco com limite de ~45.000 caracteres. Notas grandes podem ser cortadas no meio |
| PDF da DANFE | Armazenado como base64 dentro do banco. Ocupa muito espaço e pode degradar performance com o tempo |
| Forma de pagamento | Vem da NF-e quando informada, mas nem toda nota informa corretamente |

---

### Dados que NÃO são salvos e deveriam ser salvos

| Dado faltante | Por que importa |
|---|---|
| **Tipo de frete (FOB/CIF)** | FOB = frete por conta do comprador, CIF = incluído no preço. Afeta o custo real do produto |
| **Número do pedido de compra** | Quando existir, permite cruzar com futuras ordens de compra |
| **Transportadora/CNPJ do transporte** | Para rastrear atrasos e problemas de entrega |
| **Informações de impostos por item** (ICMS, PIS, COFINS) | Para relatórios fiscais mais detalhados no futuro |
| **Rateio do frete por item** | O frete total da nota deveria ser distribuído proporcionalmente entre os itens para calcular o custo real de cada produto |
| **Condição de pagamento original** (texto) | A nota tem um campo descritivo ("30/60/90 dias") que não é salvo, só as parcelas calculadas |

---

## 11. PLANO DE IMPLEMENTAÇÃO SEGURO

*Ordem recomendada para implementar sem quebrar o app atual*

---

### ETAPA 1 — LIMITE SEMANAL E DASHBOARD DA CRIS
**Impacto: PEQUENO**

**O que muda para o usuário:**
A Cris passa a ver, em uma tela dedicada, quanto já gastou na semana e quanto
ainda pode gastar, com as notas da semana listadas abaixo.

**O que muda no app:**
- Adicionar configuração `LIMITE_SEMANAL_COMPRAS = 30000` no banco
- Criar nova consulta no `api/dashboard.js` (soma de `valor_total_nota` por semana)
- Criar nova tela `v-cris` no `public/index.html`

**Arquivos afetados:** `api/dashboard.js`, `public/index.html`
**Tabelas afetadas:** `configuracoes` (só insere um novo registro), `notas_fiscais` (só leitura)
**Risco principal:** Nenhum — só leitura de dados existentes
**Fazer agora ou depois:** **AGORA** — é a base da Central da Cris e não corre nenhum risco

---

### ETAPA 2 — HISTÓRICO DE PREÇOS POR PRODUTO
**Impacto: PEQUENO**

**O que muda para o usuário:**
A Cris consegue pesquisar um produto e ver de quem comprou antes, por quanto
e quando, incluindo menor preço recente.

**O que muda no app:**
- Novo recurso no `api/admin.js`: `produto-historico-precos`
- Seção de histórico na tela de detalhes do produto (já existente: `v-produto`)

**Arquivos afetados:** `api/admin.js`, `public/index.html` (tela v-produto)
**Tabelas afetadas:** `itens_nota`, `notas_fiscais`, `fornecedores` (só leitura)
**Risco principal:** Nenhum — só consultas, sem alterar dados
**Fazer agora ou depois:** **AGORA** — não exige nenhuma mudança de banco

---

### ETAPA 3 — FORNECEDORES COM WHATSAPP E VENDEDOR
**Impacto: PEQUENO**

**O que muda para o usuário:**
Na tela de fornecedores, a Cris pode cadastrar o nome do vendedor, o número
do WhatsApp e clicar em um botão para abrir a conversa direto no WhatsApp.

**O que muda no app:**
- 3 novas colunas na tabela `fornecedores` (`vendedor`, `whatsapp`, `categoria_principal`)
- Tela de fornecedores atualizada (já existe na tela de configurações)

**Arquivos afetados:** `api/admin.js`, `public/index.html`
**Tabelas afetadas:** `fornecedores` (3 colunas novas, valores antigos não mudam)
**Risco principal:** Baixo. Adicionar colunas ao banco não quebra nenhuma função existente
**Fazer agora ou depois:** **AGORA** — é simples e prepara os dados para a comparação futura

---

### ETAPA 4 — RETIRADA DE ESTOQUE PELO GERENTE
**Impacto: PEQUENO**

**O que muda para o usuário:**
A tela de saída de estoque ganha um campo "Setor que pediu" e "Quem retirou".
O gerente consegue registrar retiradas fora do horário da Cris.

**O que muda no app:**
- 1 nova coluna na tabela `movimentacoes_estoque` (`setor`)
- Adaptação da tela de saída existente (`v-saida`)
- O endpoint `api/estoque/saida.js` recebe e salva o campo setor

**Arquivos afetados:** `api/estoque/saida.js`, `public/index.html`
**Tabelas afetadas:** `movimentacoes_estoque` (1 coluna nova)
**Risco principal:** Baixo. Adicionar coluna nullable não afeta os registros existentes
**Fazer agora ou depois:** **AGORA** — pequena mudança com alto valor operacional

---

### ETAPA 5 — PAGAMENTOS MANUAIS SEM NOTA FISCAL
**Impacto: MÉDIO**

**O que muda para o usuário:**
A Cris consegue lançar qualquer despesa no sistema, mesmo sem nota fiscal.
Boletos, serviços, manutenção, compras de mercado — tudo pode ser registrado
com categoria, fornecedor livre, data de vencimento e data de pagamento.

**O que muda no app:**
- Colunas novas na tabela `contas_pagar`:
  `tipo_origem`, `categoria_despesa`, `nome_fornecedor_livre`, `data_lancamento`, `entra_estoque`, `forma_pgto_detalhe`
- Colunas `id_nota` e `fornecedor_id` passam a ser opcionais (nullable)
- Nova tela ou novo formulário: "Lançar despesa manual"
- Endpoint novo no `api/admin.js` ou em `api/contas/`

**Arquivos afetados:** `api/contas/pagar.js`, `api/admin.js`, `public/index.html`
**Tabelas afetadas:** `contas_pagar` (várias colunas novas)
**Risco principal:** MÉDIO — é a tabela mais crítica do sistema depois de produtos.
Deve ser testado com cuidado para não quebrar a exibição de contas existentes
**Fazer agora ou depois:** **FAZER** — mas com atenção. Testar bem antes de colocar em produção

---

### ETAPA 6 — SISTEMA DE USUÁRIOS E PERFIS (LOGIN POR PIN)
**Impacto: MÉDIO**

**O que muda para o usuário:**
Ao abrir o app, aparece uma tela de PIN. Dependendo de quem entrar (Cris ou gerente),
as abas e funcionalidades disponíveis mudam.

**O que muda no app:**
- Nova tabela `usuarios` (nome, pin, perfil, ativo)
- Nova tela de login com teclado numérico
- Lógica de controle de perfil no frontend (quais abas/botões aparecem)
- Novo endpoint de autenticação em `api/admin.js` ou `api/auth.js`

**Arquivos afetados:** `public/index.html`, `api/admin.js` ou arquivo novo
**Tabelas afetadas:** Nova tabela `usuarios`
**Risco principal:** MÉDIO-ALTO — é uma mudança que afeta como o app inteiro funciona.
Se implementado com bugs, ninguém consegue entrar.
**Fazer agora ou depois:** **FAZER** — mas somente depois de ter a Central da Cris funcionando
sem login primeiro. Depois é só "trancar a porta" de algo que já funciona.

---

### ETAPA 7 — SOLICITAÇÕES E CHAMADOS INTERNOS
**Impacto: MÉDIO**

**O que muda para o usuário:**
O gerente consegue abrir chamados para a Cris. A Cris responde, aprova ou nega
diretamente pelo app, com histórico completo de conversas.

**O que muda no app:**
- 3 novas tabelas: `solicitacoes`, `solicitacoes_mensagens`, `respostas_rapidas`
- 2 a 3 novas telas no `public/index.html`
- 3 a 4 novos recursos no `api/admin.js`

**Arquivos afetados:** `api/admin.js`, `public/index.html`
**Tabelas afetadas:** Apenas novas tabelas — nada existente é modificado
**Risco principal:** BAIXO para o estoque e financeiro, MÉDIO para a experiência do usuário
(precisa ser fácil de usar, senão ninguém vai usar)
**Fazer agora ou depois:** **DEPOIS do login** — as solicitações precisam saber
quem é o gerente e quem é a Cris para fazer sentido

---

### ETAPA 8 — COMPARAÇÃO DE FORNECEDORES (FUTURO)
**Impacto: PEQUENO (quando chegar a hora)**

**O que muda para o usuário:**
A Cris monta uma lista de compras e o sistema sugere, com base no histórico,
de qual fornecedor cada item costuma sair mais barato.

**O que muda no app:**
- Novo endpoint de consulta (join entre itens_nota, notas_fiscais, fornecedores)
- Nova tela de "Lista de Compras Inteligente"

**Arquivos afetados:** `api/admin.js`, `public/index.html`
**Tabelas afetadas:** Apenas leitura de tabelas existentes
**Risco principal:** BAIXO tecnicamente, mas depende da qualidade do cadastro de produtos
**Fazer agora ou depois:** **DEPOIS** — os dados já estão sendo coletados agora.
Esta etapa pode esperar 2 a 3 meses sem perder nada

---

## RESUMO DO PLANO (CRONOGRAMA VISUAL)

```
FAZER AGORA (baixo risco, alto valor):
  ✅ Etapa 1 — Limite semanal + Dashboard da Cris
  ✅ Etapa 2 — Histórico de preços por produto
  ✅ Etapa 3 — Fornecedores com WhatsApp
  ✅ Etapa 4 — Retirada de estoque pelo gerente

FAZER COM ATENÇÃO (risco médio, mudanças no banco):
  ⚠️  Etapa 5 — Pagamentos manuais sem nota fiscal
  ⚠️  Etapa 6 — Sistema de login por PIN

FAZER DEPOIS (depende das etapas anteriores):
  🕐 Etapa 7 — Solicitações e chamados internos
  🕐 Etapa 8 — Comparação inteligente de fornecedores
```

---

## TABELA GERAL DE IMPACTO

| Funcionalidade | Banco muda? | Lógica muda? | Tela nova? | Risco | Impacto |
|---|---|---|---|---|---|
| Dashboard da Cris | Config nova | Nova consulta | Sim | Baixo | Pequeno |
| Histórico de preços | Não | Nova consulta | Não (adapta) | Baixo | Pequeno |
| WhatsApp no fornecedor | 3 colunas novas | Pequena | Não (adapta) | Baixo | Pequeno |
| Retirada por gerente | 1 coluna nova | Pequena | Não (adapta) | Baixo | Pequeno |
| Pagamento manual | Várias colunas | Média | Sim | Médio | Médio |
| Login por PIN | Tabela nova | Grande | Sim | Médio | Médio |
| Solicitações internas | 3 tabelas novas | Média | Sim (2-3) | Baixo | Médio |
| Comparação fornecedores | Não | Nova consulta | Sim | Baixo | Pequeno (futuro) |

---

## ARQUIVOS MAIS IMPORTANTES PARA MOSTRAR AO CHATGPT

Para o ChatGPT implementar a Central da Cris, mostre nesta ordem:

### 1. Estrutura do banco (entender o que existe)
```
schema.sql
schema_fase2.sql
```

### 2. Como o app funciona hoje (tela e backend)
```
public/index.html      ← toda a interface atual
api/dashboard.js       ← como os dados chegam na tela
api/admin.js           ← onde ficam os endpoints de apoio
```

### 3. Onde mexer para as etapas 1 a 4 (baixo risco)
```
api/dashboard.js       ← adicionar cálculo do limite semanal
api/admin.js           ← adicionar histórico de preços e WhatsApp
api/estoque/saida.js   ← adicionar campo setor
```

### 4. Onde mexer para as etapas 5 e 6 (médio risco)
```
api/contas/pagar.js    ← entender o fluxo atual de contas
api/nfe/confirmar.js   ← entender como as contas são criadas pela NF-e
```

---

*Relatório gerado por análise estática do código — nenhum arquivo foi modificado.*
