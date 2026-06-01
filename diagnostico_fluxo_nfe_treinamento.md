# Diagnóstico do fluxo de NF-e e treinamento
**Super Ajudante Estoque — Araçá Grill**
Gerado em: 2026-06-01

---

## 1. Telas existentes

| ID da tela | Nome na navegação | Relacionada a |
|---|---|---|
| `v-import` | Importar (aba do menu) | Entrada de chave ou XML de NF-e |
| `v-conf` | Conferência (abre automaticamente) | Revisão de itens da nota antes de confirmar |
| `v-estoque` | Estoque | Listagem de produtos com filtros |
| `v-produto` | Produto (abre ao tocar num item) | Edição de cadastro do produto |
| `v-entrada` | Entrada manual | Entrada sem NF-e (produto avulso) |
| `v-saida` | Saída | Retirada de estoque |
| `v-inv` | Inventário | Contagem e ajuste de estoque |
| `v-contas` | Contas | Lista de contas a pagar |
| `v-config` | Config | Categorias, regras e painel de treinamento com ChatGPT |
| `v-dash` | Painel | Dashboard com alertas e resumo de estoque |

Não existe nenhuma tela chamada "Esteira de treinamento", "Fila de NF-es" ou similar.

---

## 2. Fluxo atual ao bipar ou colar uma chave de NF-e

### Passo a passo

```
1. Usuário cola ou escaneia a chave de 44 dígitos na tela v-import.

2. Frontend chama:
   POST /api/nfe/buscar { chave }
   → Verifica duplicidade na aba Notas_Fiscais.
   → Se já foi CONFERIDA ou LANCADA: retorna 409 (não prossegue).
   → Chama a API Meu Danfe para buscar/registrar a nota.
   → Retorna status: WAITING | SEARCHING | OK | NOT_FOUND | ERROR.
   → Frontend faz polling até status = OK.

3. Quando status = OK, o frontend chama:
   POST /api/nfe/conferir { chave }
   → Baixa o XML da nota no Meu Danfe (gratuito após registrada).
   → Parseia o XML localmente (fornecedor, itens, parcelas, EANs, NCM, etc.).
   → Para cada item, tenta reconhecer o produto já cadastrado via 3 estratégias:
       a) CNPJ do fornecedor + código_produto_nf
       b) EAN (codigo_barras)
       c) Mapeamento na tabela Produto_Fornecedor (cnpj + código, EAN ou descrição normalizada)
       d) Alias na tabela Aliases_Produto (descrição normalizada)
   → Produtos não reconhecidos ficam marcados como produto_novo: true.
   → Monta parcelas/contas a pagar previstas.
   → Retorna todos os dados para o frontend. NÃO grava nada no banco.

4. Frontend abre a tela v-conf.
   → Usuário vê os itens, ajusta fator de conversão, unidade de estoque,
     nome interno e categoria dos produtos novos.

5a. (Modo Treinar — novo comportamento desde commit 7c1511a)
    → Tela exibe painel de exportação para ChatGPT.
    → Nenhuma ação no banco é possível a partir daqui neste modo.

5b. (Modo Dar Entrada)
    → Usuário ajusta parcelas e clica em "Confirmar entrada no estoque".
    → Abre diálogo de confirmação. Se confirmar:
    → Frontend chama:
       POST /api/nfe/confirmar { chave, nota, fornecedor, itens, parcelas, xml }
    → Grava tudo no banco. Ver seção 3 para detalhes.
```

### Endpoints chamados em sequência

| Ordem | Endpoint | Método | Grava banco? |
|---|---|---|---|
| 1 | `/api/nfe/buscar` | POST | **Não** — só lê Notas_Fiscais para checar duplicata |
| 2 | `/api/nfe/conferir` | POST | **Não** — apenas lê e processa o XML |
| 3 | `/api/nfe/confirmar` | POST | **Sim** — grava tudo (ver seção 3) |

Alternativa (quando o usuário cola XML diretamente):

| Ordem | Endpoint | Método | Grava banco? |
|---|---|---|---|
| 1 | `/api/nfe/add-xml` | POST | **Não** — parse local, envia XML ao Meu Danfe, retorna conferência |
| 2 | `/api/nfe/confirmar` | POST | **Sim** — grava tudo |

---

## 3. Estoque

### Ler a NF-e já altera estoque?

**Não.** Nem `/api/nfe/buscar` nem `/api/nfe/conferir` nem `/api/nfe/add-xml` tocam nas tabelas de estoque.

### Estoque só muda depois de uma confirmação manual?

**Sim.** O único endpoint que altera `estoque_atual` e `custo_medio` é `/api/nfe/confirmar`.

Dentro do `confirmar.js` (linhas 119–132), para cada item da nota:

```javascript
const novoEstoque = estoqueAtual + qtdEstoque;
const novoCustoMedio = novoEstoque > 0
  ? ((estoqueAtual * custoMedioAnt) + (qtdEstoque * custoUnit)) / novoEstoque
  : custoUnit;
await updateRow('Produtos', prod.id_produto, {
  estoque_atual: novoEstoque,
  custo_medio: novoCustoMedio,
  ultimo_custo_unitario: custoUnit,
  ...
});
```

### Existe risco de uma nota usada só para treinamento entrar no estoque por engano?

**Antes do commit 7c1511a (30/05/2026): SIM, havia risco real.**
A tela de conferência mostrava um único botão "Confirmar e lançar no estoque" sem distinção de modo. Um clique acidental lançava a nota.

**Após o commit 7c1511a: o risco foi mitigado** pela separação de modos:
- Modo Treinar (padrão): o botão "Confirmar" não existe no DOM.
- Modo Dar Entrada: exige confirmação em diálogo adicional antes de chamar o endpoint.

**Porém há uma limitação estrutural** que cria risco indireto — descrita na seção 6.

---

## 4. Movimentações

As movimentações de estoque são criadas **exclusivamente** dentro de `/api/nfe/confirmar`, linhas 196–211:

```javascript
await appendRow('Movimentacoes_Estoque', {
  tipo: 'ENTRADA',
  origem: 'NFE',
  quantidade: qtdEstoque,
  custo_unitario: custoUnit,
  valor_total: valor_total_nf,
  motivo: 'compra',
  ...
});
```

| Tipo de movimentação | Quando é criada |
|---|---|
| `ENTRADA` com origem `NFE` | Apenas ao confirmar (`/api/nfe/confirmar`) |
| Entrada manual | `/api/admin?recurso=entrada` (tela de entrada manual) |
| Saída | `/api/estoque/saida` (tela de saída) |
| Ajuste de inventário | `/api/estoque/inventario` POST (tela de inventário) |

Ler, conferir ou treinar com uma NF-e **nunca cria movimentações**.

---

## 5. Contas a pagar

As contas a pagar são criadas **exclusivamente** dentro de `/api/nfe/confirmar`, linhas 246–264:

```javascript
for (const pc of parcelas) {
  await appendRow('Contas_Pagar', {
    id_nota: idNota,
    valor: pc.valor,
    vencimento: pc.vencimento,
    status: pc.vencimento ? 'ABERTO' : 'PENDENTE_INFO',
    ...
  });
}
```

**Ao ler ou conferir uma NF-e**, as parcelas são calculadas e exibidas na tela para o usuário ajustar as datas de vencimento — mas nenhuma linha é gravada no banco até a confirmação.

---

## 6. Esteira de treinamento

### Existe uma tela ou lógica para bipar várias NF-es em sequência, sem mexer no estoque?

**Não existe.**

Respostas diretas:

| Pergunta | Resposta |
|---|---|
| Existe esteira de treinamento? | **NÃO** |
| Ela acumula várias notas? | Não — só mostra uma nota por vez em `v-conf` |
| Ela agrupa produtos repetidos de várias notas? | Não |
| Ela mantém produtos desconhecidos de várias notas? | Não |
| Ela substitui os dados pela última nota lida? | Sim — `confData` é uma variável global sobrescrita a cada nova nota |

### Por que isso é um problema crítico

Para que o sistema acumule produtos desconhecidos (que aparecem em `treino-desconhecidos`), esses produtos precisam existir na tabela `Produtos` com `confirmado = 'NAO'`.

Eles só chegam lá de duas formas:
1. **Via `/api/nfe/confirmar`** — que também atualiza estoque, custo médio e cria contas a pagar. **Caminho errado para treinamento puro.**
2. **Via `/api/admin?recurso=treino-importar`** — que cria os produtos com `estoque_atual = 0`, sem lançar estoque. **Esse é o caminho correto, mas é o destino, não a origem.**

**Conclusão da seção 6:** Hoje, para acumular pendências para o ChatGPT, o usuário é forçado a confirmar as notas no estoque primeiro. Não existe um caminho para "ler várias notas, acumular os produtos desconhecidos e só depois treinar", sem antes lançar estoque.

---

## 7. Exportação para ChatGPT

Os três botões de exportação estão na tela `v-config` (seção "Treinamento com ChatGPT") e também foram adicionados na tela `v-conf` no modo Treinar.

### Exportar contexto (`/api/admin?recurso=treino-contexto`)

- Lê as tabelas: `Produtos`, `Categorias`, `Fornecedores`, `Produto_Fornecedor`, `Embalagens`, `Aliases_Produto`, configurações.
- **Exporta o catálogo completo do banco** — não é específico de nenhuma NF-e ou sessão.
- Inclui todos os produtos ativos, os confirmados e os pendentes.
- Útil para dar contexto ao ChatGPT sobre o que o sistema já conhece.

### Exportar produtos desconhecidos (`/api/admin?recurso=treino-desconhecidos`)

- Lê as tabelas: `Produtos`, `Itens_Nota`, `Notas_Fiscais`, `Fornecedores`.
- **Exporta apenas produtos com `confirmado = 'NAO'`** de todas as notas já confirmadas.
- Agrupa as ocorrências: se o mesmo produto desconhecido apareceu em 5 notas, lista `ocorrencias: 5`.
- Inclui em quais chaves de NF-e o produto apareceu.
- **Importante:** só enxerga produtos que já foram lançados no banco via `confirmar`. Produtos de notas lidas mas não confirmadas não aparecem aqui.

### Copiar comando para ChatGPT

- Gera um texto fixo em memória (hardcoded no frontend) com as instruções para o ChatGPT.
- Copia para a área de transferência.
- Não acessa nenhum endpoint de API.
- Não é específico de nenhuma nota — é um template genérico.

### Resumo: o que cada exportação cobre

| Exportação | Escopo |
|---|---|
| Contexto atual | **Banco inteiro** — todos os produtos, categorias, fornecedores |
| Produtos desconhecidos | **Banco inteiro** — todos os produtos pendentes de notas confirmadas |
| Comando GPT | Template fixo — sem dados de nenhuma nota |

Nenhuma das exportações é específica de uma única NF-e ou de uma sessão de leitura.

---

## 8. Importação do JSON do ChatGPT

Endpoint: `POST /api/admin?recurso=treino-importar { json, substituir? }`

### O que o sistema grava ao importar o JSON revisado

| O que | Grava? | Observações |
|---|---|---|
| **Produtos** | **Sim** | Atualiza nome_interno, categoria_id, unidade_estoque, confirmado='SIM'. Se não existe, cria com estoque_atual=0. |
| **Categorias** | **Sim** | Se o produto referencia uma categoria nova, o sistema cria a categoria automaticamente. |
| **Embalagens** | **Sim** | Cria embalagens (CX24, FD12, etc.) vinculadas ao produto. |
| **Aliases** | **Sim** | Vincula descrições alternativas ao produto para reconhecimento futuro. |
| **Mapeamentos fornecedor/produto** | **Sim** | Grava na tabela Produto_Fornecedor: CNPJ + código → id_produto. |
| **Códigos de barras** | Parcialmente | Apenas o campo `ean` do produto vindo no JSON. Não preenche `codigo_barras_unitario`. |
| **Estoque** | **NÃO** | Produtos novos criados com `estoque_atual = 0`. Não altera estoque existente. |
| **Movimentações** | **NÃO** | Nenhuma movimentação é criada. |
| **Contas a pagar** | **NÃO** | Nenhuma conta é criada. |

### Proteção contra sobrescrita acidental

Se um produto já tem `confirmado = 'SIM'` no banco, o importador **pula** esse produto e registra no relatório como conflito, a menos que o usuário clique em "Substituir" (flag `substituir: true`).

### Conclusão da seção 8

**A importação de treinamento é segura para o estoque.** Ela nunca altera `estoque_atual`, nunca cria `Movimentacoes_Estoque` e nunca cria `Contas_Pagar`. O único risco é sobrescrever nomes ou categorias já configurados manualmente — o que é protegido pelo mecanismo de conflito.

---

## 9. Arquivos envolvidos

| Arquivo | Função |
|---|---|
| `public/index.html` | Todo o frontend: telas, funções JS, lógica de navegação e chamadas de API |
| `api/nfe/buscar.js` | Registra a chave no Meu Danfe e retorna status de processamento (não grava banco) |
| `api/nfe/conferir.js` | Baixa e parseia o XML, reconhece produtos existentes, retorna dados para a tela (não grava banco) |
| `api/nfe/add-xml.js` | Alternativa ao buscar.js para quem tem o XML em mãos (não grava banco) |
| `api/nfe/confirmar.js` | **O único endpoint que grava:** Notas_Fiscais, Fornecedores, Produtos, Itens_Nota, Movimentacoes_Estoque, Contas_Pagar, Produto_Fornecedor |
| `api/admin.js` | Múltiplos recursos via `?recurso=`: categorias, embalagens, produto-editar, treino-contexto, treino-desconhecidos, treino-validar, treino-importar, entrada manual |
| `api/_lib/parser.js` | Lê XML de NF-e e extrai dados estruturados (fornecedor, itens, duplicatas, pagamentos) |
| `api/_lib/meudanfe.js` | Integração com a API externa Meu Danfe (buscar, baixar XML) |
| `api/_lib/db.js` | Leitura e escrita no Google Sheets (readRows, appendRow, updateRow, nextId) |
| `api/_lib/util.js` | Helpers: validarChave, json(), nowStr(), rate limiting, preflight CORS |
| `api/estoque/saida.js` | Grava saída de estoque (Movimentacoes_Estoque + Produtos.estoque_atual) |
| `api/estoque/inventario.js` | Ajuste de inventário (Movimentacoes_Estoque + Produtos.estoque_atual) |
| `api/dashboard.js` | Lê e agrega dados para o painel (somente leitura) |
| `api/listar.js` | Lê linhas de qualquer tabela (somente leitura) |
| `api/contas/pagar.js` | Marca conta como PAGO |

---

## 10. Comparação com o fluxo desejado

> "Quero bipar várias NF-es, uma atrás da outra, o sistema baixar e analisar todas, acumular produtos desconhecidos e pendências, sem dar entrada no estoque. Depois exporto tudo para o ChatGPT, recebo o JSON revisado e importo apenas o treinamento."

### Análise item a item

| Passo desejado | Situação atual |
|---|---|
| **1. Bipar/colar a chave** | ✅ Funciona. Campo de entrada disponível em v-import. |
| **2. Consultar o Meu Danfe** | ✅ Funciona. `/api/nfe/buscar` com polling. |
| **3. Baixar os dados da nota** | ✅ Funciona. `/api/nfe/conferir` parseia o XML e reconhece produtos. |
| **4. Analisar produtos da nota** | ✅ Funciona. Mostra reconhecidos e novos em v-conf. |
| **5. NÃO dar entrada no estoque** | ✅ Seguro desde commit 7c1511a. No modo Treinar o botão confirmar não existe. |
| **6. Guardar nota em fila de treinamento** | ❌ **NÃO EXISTE.** `confData` é sobrescrito pela próxima nota. Não há persistência. |
| **7. Campo pronto para próxima NF-e** | ❌ **NÃO.** A tela fica presa na conferência (`v-conf`). Para bipar outra nota é preciso clicar "← Voltar" manualmente. Ao voltar, a nota atual é perdida. |
| **8. Bipar outra nota** | ⚠️ Possível manualmente, mas a anterior é perdida. |
| **9. Repetir o processo** | ⚠️ Funciona individualmente, mas sem acumulação. |
| **10. Exportar pacote de treinamento** | ⚠️ Parcialmente. O botão "Exportar produtos desconhecidos" só enxerga produtos que já estão no banco (`confirmado='NAO'`). Sem confirmar as notas, os produtos novos não aparecem na exportação. |
| **11. Gerar contexto + desconhecidos + comando GPT** | ⚠️ Os três botões existem (em v-config e agora em v-conf), mas os desconhecidos acumulados dependem de notas já confirmadas. |
| **12–13. Levar ao ChatGPT e receber JSON** | ✅ Processo manual do usuário — fora do sistema. |
| **14. Colar JSON de volta** | ✅ Campo disponível em v-config e em v-conf no modo Treinar. |
| **15. Importar treinamento (produtos, cat., emb., aliases, mapeamentos)** | ✅ Funciona. `treino-importar` não grava estoque. |
| **16. Importação NÃO lança estoque** | ✅ Confirmado. `estoque_atual = 0` nos produtos criados, nenhuma movimentação. |

### O que falta

1. **Fila de NF-es para treinamento** — mecanismo para acumular os dados de várias notas na memória (ou banco temporário) sem confirmá-las.
2. **Produtos desconhecidos de notas não confirmadas** — hoje, para que os produtos novos apareçam na exportação de desconhecidos, as notas precisam ter sido confirmadas (lançadas no estoque). Isso contradiz o objetivo de "treinar sem lançar".
3. **Retorno automático ao campo de bipagem** — após processar uma nota no modo Treinar, o sistema deveria perguntar "Lida. Bipar próxima?" e limpar o campo automaticamente.

---

## 11. Conclusão

### Modelo que o sistema atual segue

O sistema atual segue uma mistura dos modelos:

---

**Modelo B** (parcialmente implementado):
> "Leio uma NF-e só para conferência, sem mexer no estoque."

Tecnicamente correto: ler e conferir não altera estoque. Mas é um fluxo de **uma nota por vez**, sem acumulação.

---

**Modelo D** (risco real antes de 30/05/2026, mitigado depois):
> "Existe uma mistura de fluxos e há risco de treinamento lançar estoque sem querer."

Antes do commit 7c1511a, a tela de conferência tinha apenas um botão "Confirmar e lançar no estoque", sem distinção entre treinar e dar entrada. Qualquer uso inadvertido da tela lançaria estoque.

Após 30/05/2026, o risco foi reduzido pela separação de modos.

---

**O que ainda falta para chegar ao Modelo C:**
> "Tenho uma esteira onde posso bipar várias NF-es, acumular pendências e exportar tudo para o ChatGPT."

O sistema **não implementa o Modelo C**. Faltam:

1. Uma fila em memória (ou no banco em tabela temporária/rascunho) que guarde os itens novos de várias notas sem confirmá-las.
2. A exportação de desconhecidos deve ler essa fila, não apenas o banco de notas confirmadas.
3. Ao ler uma nota no modo Treinar, os produtos novos devem ser adicionados à fila — e o campo de chave deve ser liberado imediatamente para a próxima nota.
4. Um contador visual: "X nota(s) na fila · Y produto(s) desconhecidos acumulados."

---

### Resumo executivo

| Capacidade | Status |
|---|---|
| Ler NF-e sem alterar estoque | ✅ Seguro |
| Mostrar produtos novos vs. conhecidos | ✅ Funciona |
| Importar JSON do ChatGPT sem lançar estoque | ✅ Funciona |
| Bipar várias notas em sequência | ⚠️ Possível mas perde dados da anterior |
| Acumular produtos desconhecidos de várias notas | ❌ Não existe |
| Exportar desconhecidos de notas não confirmadas | ❌ Não existe |
| Retorno automático para bipagem | ❌ Não existe |
| Proteção contra lançamento acidental de estoque | ✅ Implementado em 30/05/2026 |
