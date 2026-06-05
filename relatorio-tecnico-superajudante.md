# RELATÓRIO TÉCNICO — SUPER AJUDANTE
*Gerado para análise no ChatGPT — sem modificações no código*

---

## RESUMO GERAL DO APLICATIVO

**Super Ajudante** é um sistema de gestão de estoque para restaurantes que:
- Lê chaves de NF-e (Nota Fiscal Eletrônica) via câmera/QR code ou digitação manual
- Consulta e baixa os dados da nota via API externa (Meu Danfe)
- Reconhece os produtos da nota e dá entrada automática no estoque
- Rastreia custo médio ponderado, vencimentos e contas a pagar
- Possui um sistema de "treinamento" via ChatGPT para aprender novos produtos

**Stack técnica resumida:**
- Frontend: HTML/CSS/JavaScript puro (SPA — Single Page Application)
- Backend: Node.js (ES Modules) em funções serverless na Vercel
- Banco de dados: Supabase (PostgreSQL na nuvem)
- Mobile: Capacitor 5 empacotando o frontend como app Android nativo
- Scanner: `@capacitor-mlkit/barcode-scanning` (ML Kit do Google)
- NF-e: Integração com a API do Meu Danfe v2

---

## ESTRUTURA DE PASTAS E ARQUIVOS IMPORTANTES

```
Superajudante/
│
├── android/                          ← Projeto Android (gerado pelo Capacitor)
│   ├── app/
│   │   └── src/main/
│   │       ├── AndroidManifest.xml   ← Permissões, câmera, FileProvider
│   │       ├── java/br/com/superajudante/
│   │       │   └── MainActivity.java ← Apenas abre o WebView do Capacitor
│   │       └── res/                  ← Ícones, splash screens
│   ├── build.gradle                  ← Versões do Android SDK
│   └── variables.gradle              ← Versões das libs Capacitor
│
├── api/                              ← Funções serverless (backend na Vercel)
│   ├── _lib/
│   │   ├── db.js                     ← Conexão com Supabase + CRUD genérico
│   │   ├── meudanfe.js               ← Cliente HTTP para a API do Meu Danfe
│   │   ├── parser.js                 ← Leitura/interpretação do XML da NF-e
│   │   ├── reconhecimento.js         ← 5 estratégias para identificar produtos
│   │   ├── estoque.js                ← Cálculo do custo médio ponderado
│   │   └── util.js                   ← CORS, validação, rate limiting
│   │
│   ├── nfe/
│   │   ├── buscar.js                 ← Consulta status da NF-e
│   │   ├── conferir.js               ← Baixa e parseia XML (pré-visualização)
│   │   ├── confirmar.js              ← Confirma e grava tudo no banco
│   │   ├── add-xml.js                ← Importação direta de XML
│   │   └── danfe.js                  ← Obtém o PDF da DANFE
│   │
│   ├── estoque/
│   │   ├── saida.js                  ← Saída de estoque
│   │   └── inventario.js             ← Contagem física / inventário
│   │
│   ├── contas/
│   │   └── pagar.js                  ← Marca conta como paga
│   │
│   ├── admin.js                      ← 18 funcionalidades admin (via ?recurso=X)
│   ├── dashboard.js                  ← KPIs: estoque baixo, consumo, vencimentos
│   ├── listar.js                     ← Leitura genérica de tabelas
│   └── teste.js                      ← Diagnóstico de conexões e variáveis
│
├── public/
│   └── index.html                    ← SPA completa (~500 linhas: HTML + CSS + JS)
│
├── schema.sql                        ← Fase 1: 8 tabelas principais
├── schema_fase2.sql                  ← Fase 2: embalagens, mapeamentos, aliases
├── schema_fase3.sql                  ← Fase 3: código de barras unitário, preço
├── schema_fase4.sql                  ← Fase 4: fila de treinamento
│
├── capacitor.config.json             ← Config do Capacitor (app ID, server URL)
├── package.json                      ← Dependências NPM e scripts
├── vercel.json                       ← Config de deploy (timeout 30s, rewrite /)
├── .env.example                      ← Template das variáveis de ambiente (SEM segredos)
│
└── docs/
    └── treinador-notas-documentacao.md  ← Documentação técnica detalhada (~300 linhas)
```

---

## FLUXO ATUAL DO APP — PASSO A PASSO (para leigo)

### Como funciona hoje:

**1. O restaurante recebe uma mercadoria com nota fiscal**
O usuário abre o app no celular.

**2. Leitura da nota fiscal**
O usuário pode:
- Apontar a câmera para o QR Code da DANFE (nota impressa)
- Digitar manualmente a chave de 44 dígitos da NF-e
- Colar o XML da nota diretamente

**3. Consulta à API**
O app envia a chave para o servidor (Vercel), que consulta a API do Meu Danfe. Se a nota ainda está sendo processada, o app exibe "aguardando" e tenta novamente automaticamente.

**4. Conferência dos itens**
O servidor baixa o XML completo da nota, lê cada produto e tenta reconhecê-lo automaticamente na base de dados. O usuário vê uma lista dos produtos da nota com:
- Produtos já conhecidos: aparecem com nome e categoria
- Produtos novos: precisam ser categorizados pelo usuário

**5. Confirmação**
O usuário revisa e confirma. Nesse momento o sistema:
- Cria os produtos novos no cadastro
- Dá entrada no estoque com as quantidades
- Recalcula o custo médio de cada produto
- Gera as contas a pagar com os vencimentos das duplicatas da nota

**6. Gestão de estoque**
Na tela de estoque o usuário pode:
- Ver o nível atual de cada produto
- Registrar saídas (consumo da cozinha)
- Fazer inventário físico

**7. Dashboard**
Mostra alertas de estoque baixo, contas a vencer, ranking de consumo dos últimos 30 dias.

**8. Treinamento via ChatGPT**
Quando o sistema não consegue reconhecer automaticamente muitos produtos novos de um fornecedor, o usuário pode exportar um contexto, colar no ChatGPT, e importar a resposta para ensinar o sistema sobre esses produtos.

---

## INTEGRAÇÕES E APIs ENCONTRADAS

| Integração | Função | Onde fica |
|---|---|---|
| **Meu Danfe API v2** | Consultar e baixar NF-e/XML/DANFE PDF | `api/_lib/meudanfe.js` |
| **Supabase** | Banco de dados PostgreSQL na nuvem | `api/_lib/db.js` |
| **Vercel** | Hospedagem do backend e frontend | `vercel.json` |
| **ML Kit (Google)** | Leitura de QR Code via câmera | `@capacitor-mlkit/barcode-scanning` |
| **ChatGPT** | Treinamento de reconhecimento (manual) | `api/admin.js` (treino-*) |
| **Google Sheets** | Integração legada (em desuso) | `api/_lib/sheets.js` |

**Variáveis de ambiente necessárias (sem expor segredos):**
```
API_KEY_MEU_DANFE     → Chave de acesso à API do Meu Danfe
BASE_URL_API          → URL base da API do Meu Danfe
SUPABASE_URL          → URL do projeto no Supabase
SUPABASE_SERVICE_KEY  → Chave de serviço do Supabase (nunca exposta no frontend)
```

---

## BANCO DE DADOS E PERSISTÊNCIA

**Banco remoto:** Supabase (PostgreSQL), acessado apenas pelo servidor Vercel.
**Banco local:** Nenhum — toda persistência é na nuvem.

**14 tabelas divididas em 4 fases de implementação:**

| Fase | Tabelas | Propósito |
|---|---|---|
| 1 (core) | `produtos`, `fornecedores`, `categorias`, `notas_fiscais`, `itens_nota`, `movimentacoes_estoque`, `contas_pagar`, `configuracoes` | Base do sistema |
| 2 | `embalagens`, `produto_fornecedor`, `aliases_produto`, `treino_importacoes` | Reconhecimento avançado |
| 3 | (colunas em `produtos`) | Código de barras unitário, preço de venda |
| 4 | `treino_fila`, `treino_itens` | Fila de treinamento para o ChatGPT |

**Padrões de design do banco:**
- IDs com prefixo: `PRD-0001`, `FOR-0001`, etc.
- Datas em ISO 8601: `YYYY-MM-DD HH:MM`
- Campos de status: texto (`SIM/NAO`, `ABERTO/PAGO`, `OK/ERROR`)
- Exclusão suave: campo `ativo = 'NAO'` (sem deletar fisicamente)
- Histórico de movimentações sempre preservado

---

## PONTOS QUE PARECEM FUNCIONANDO

- Leitura de QR Code via câmera integrada (ML Kit)
- Consulta de NF-e via API do Meu Danfe com rate limiting
- Parser completo de XML da NF-e
- 5 estratégias de reconhecimento automático de produto
- Entrada de estoque com cálculo de custo médio ponderado
- Geração automática de contas a pagar com vencimentos
- Dashboard com alertas de estoque baixo e contas vencendo
- Sistema de treinamento via ChatGPT (exportar contexto → importar JSON)
- Diagnóstico de conexões e variáveis via `/api/teste`
- Deploy automático na Vercel com configuração de timeout de 30s

---

## PONTOS QUE PRECISAM DE REVISÃO

1. **Google Sheets legado** — O arquivo `api/_lib/sheets.js` existe mas está em desuso. Pode causar confusão e deve ser removido ou documentado como depreciado.

2. **Rate limiting volátil** — O controle de chamadas à API fica na memória do processo Node.js. Quando a Vercel reinicia a função (escala para zero), o histórico de tentativas some. Funciona para uso leve, mas pode falhar em picos.

3. **XML truncado no banco** — Existe um limite herdado de ~45.000 caracteres por campo de texto para armazenar o XML completo. XMLs maiores podem ser cortados.

4. **Sem sincronização em tempo real** — Não há WebSocket. Se duas pessoas usarem o app ao mesmo tempo, podem ver dados desatualizados até recarregar manualmente.

5. **Sem autenticação de usuários** — O sistema não tem login. Qualquer pessoa com o link pode acessar o app e os dados.

6. **Tela de conferência de itens** — A UX de atribuir categorias a produtos novos pode ser trabalhosa se uma nota tiver muitos produtos inéditos.

7. **Limite de funções na Vercel (Hobby: 12)** — O limite já foi atingido e uma gambiarra (`?recurso=X`) foi usada no `admin.js` para adicionar mais funcionalidades. Qualquer novo endpoint top-level vai exigir upgrade do plano ou mais multiplexação.

8. **Sem testes automatizados** — Nenhum arquivo de teste encontrado no projeto.

---

## RISCOS TÉCNICOS

| Risco | Gravidade | Descrição |
|---|---|---|
| Sem login/autenticação | **Alta** | Qualquer um com o URL acessa tudo |
| Banco somente na nuvem | **Média** | Sem internet, o app não funciona |
| Dependência do Meu Danfe | **Média** | Se a API sair do ar, não dá entrada de nota |
| XML truncado | **Média** | Notas muito grandes podem perder dados |
| Rate limiting frágil | **Baixa** | Fácil de burlar ou perder entre restarts |
| Supabase Service Key no servidor | **Baixa** | Bem protegida, mas dá acesso total ao banco |
| Limite de funções Vercel | **Baixa** | Atingido, expansão limitada sem upgrade |

---

## PRÓXIMOS PASSOS RECOMENDADOS (por prioridade)

| # | O que fazer | Por quê |
|---|---|---|
| 1 | **Adicionar autenticação simples** (pin/senha ou Supabase Auth) | Sem isso, os dados do restaurante estão expostos |
| 2 | **Remover ou isolar o código do Google Sheets** (`sheets.js`) | Reduz confusão e dívida técnica |
| 3 | **Melhorar a UX de conferência de itens novos** | Ponto mais trabalhoso para o usuário hoje |
| 4 | **Adicionar persistência local básica** (cache/offline) | O app para completamente sem internet |
| 5 | **Resolver o limite do XML** (armazenar em Storage separado) | Notas grandes podem perder dados silenciosamente |
| 6 | **Implementar saída de estoque por receita** | Para fechar o ciclo de controle do restaurante |
| 7 | **Migrar para plano pago da Vercel** ou reestruturar funções | Limite de 12 funções já atingido |
| 8 | **Adicionar testes automatizados** para parser e reconhecimento | Evita regressões ao adicionar novos fornecedores |
| 9 | **Alertas proativos** (push notification de vencimentos) | Melhora utilidade operacional |
| 10 | **Suporte a múltiplos usuários** (por restaurante) | Necessário para escalar ou vender o produto |

---

## ARQUIVOS MAIS IMPORTANTES PARA MOSTRAR AO CHATGPT PRIMEIRO

Mostre nesta ordem para o ChatGPT entender o projeto do geral para o específico:

### 1. Visão geral e configuração
```
package.json
vercel.json
capacitor.config.json
.env.example
```

### 2. Banco de dados (entender a estrutura de dados)
```
schema.sql
schema_fase2.sql
```

### 3. O coração do sistema (lógica principal)
```
api/_lib/reconhecimento.js   ← Como identifica produtos
api/_lib/parser.js           ← Como lê o XML da nota
api/_lib/estoque.js          ← Como calcula custo médio
api/_lib/db.js               ← Como acessa o banco
```

### 4. Fluxo da nota fiscal (funcionalidade principal)
```
api/nfe/buscar.js
api/nfe/conferir.js
api/nfe/confirmar.js
```

### 5. Interface do usuário
```
public/index.html            ← A tela inteira do app
```

### 6. Documentação técnica
```
docs/treinador-notas-documentacao.md
```

### 7. Android (se quiser mexer no app nativo)
```
android/AndroidManifest.xml
android/app/build.gradle
android/variables.gradle
```

---

## EXPLICAÇÃO DO FLUXO PARA PESSOA NÃO PROGRAMADORA

> Imagine que o restaurante recebe um caminhão de mercadorias. Junto vem uma nota fiscal. Antigamente, alguém teria que digitar cada produto, quantidade e preço em uma planilha. Com o Super Ajudante:
>
> 1. O funcionário abre o celular e aponta a câmera para o QR code da nota (igual a ler um Pix).
> 2. O app consulta automaticamente os dados da nota no governo.
> 3. O sistema já conhece a maioria dos produtos (aprendeu com notas anteriores) e mostra uma lista pronta.
> 4. Para produtos novos, o funcionário escolhe a categoria (bebida, hortifruti, carne, etc.).
> 5. Com um botão "confirmar", tudo entra automaticamente: estoque atualizado, custo calculado, conta a pagar gerada com a data de vencimento.
> 6. O gestor abre o dashboard e vê quais produtos estão acabando, quais contas vencem essa semana e quanto cada produto está custando.

---

*Relatório gerado por análise estática do código — nenhum arquivo foi modificado.*
