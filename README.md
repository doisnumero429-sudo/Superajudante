# Super Ajudante

App de gestão para restaurante. **Super Ajudante** deixa você colar a chave da NF-e, busca pela **API Meu Danfe**, baixa o XML,
importa produtos (convertendo packs em unidades reais), controla estoque, inventário por
código de barras e contas a pagar. **Google Sheets é o banco de dados.**

Roda 100% na **Vercel**: frontend estático em `public/` + Serverless Functions em `api/`.
A `Api-Key` fica só no backend — nunca no navegador.

---

## 1. Pré-requisitos

- Conta na Vercel
- A planilha `Gestao_NFe_Estoque.xlsx` importada no **Google Sheets**
- Uma chave da **API Meu Danfe v2**

## 2. Criar a Service Account do Google (acesso à planilha)

1. Acesse https://console.cloud.google.com → crie um projeto.
2. **APIs & Services → Library** → ative a **Google Sheets API**.
3. **APIs & Services → Credentials → Create Credentials → Service Account**.
4. Criada a conta, abra-a → aba **Keys → Add Key → JSON**. Baixe o arquivo.
5. No JSON você verá `client_email` e `private_key`. São esses dois valores que vão pra Vercel.
6. **Compartilhe a planilha** com o `client_email` (botão Compartilhar no Sheets), como **Editor**.
7. O `GOOGLE_SHEET_ID` é o trecho da URL da planilha entre `/d/` e `/edit`.

## 3. Variáveis de ambiente na Vercel

Em **Settings → Environment Variables**, adicione (para Production, Preview e Development):

| Variável | Valor |
|---|---|
| `API_KEY_MEU_DANFE` | sua chave da Meu Danfe |
| `BASE_URL_API` | `https://api.meudanfe.com.br/v2` |
| `GOOGLE_SHEET_ID` | id da planilha |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `client_email` do JSON |
| `GOOGLE_PRIVATE_KEY` | `private_key` do JSON (com `\n`, entre aspas) |

> Depois de adicionar/alterar variáveis, **faça redeploy** — a Vercel só injeta as
> variáveis em novos deployments.

## 4. Deploy

**Pela interface:** suba a pasta para um repositório no GitHub e clique em *Import Project* na Vercel.

**Pela CLI:**
```bash
npm i -g vercel
vercel        # preview
vercel --prod # produção
```

## 5. Configurações no app (aba Configuracoes da planilha)

- `CNPJ_RESTAURANTE` — para validar o destinatário das notas
- `LIMITE_CONSULTAS_SEGUNDO` — começa em `2` (máx `10`)
- `MAX_TENTATIVAS_NFE` — tentativas por chave (ex.: `5`)
- `INTERVALO_TENTATIVAS_MS` — intervalo mínimo entre consultas da mesma chave (`1000`)

---

## Endpoints

| Método | Rota | Função |
|---|---|---|
| POST | `/api/nfe/buscar` | valida chave, checa duplicidade, consulta status (PUT add) |
| POST | `/api/nfe/conferir` | baixa XML, faz parser, devolve dados pra conferência |
| POST | `/api/nfe/add-xml` | importa a partir de um XML colado (envio manual, grátis) |
| POST | `/api/nfe/confirmar` | grava nota, fornecedor, produtos, estoque e contas |
| GET | `/api/nfe/danfe?chave=` | DANFE em PDF (base64) |
| GET | `/api/dashboard` | indicadores do painel |
| GET | `/api/listar?aba=` | lista qualquer aba |
| POST | `/api/produto/atualizar` | edita produto (nome, código de barras, unidade, mínimo, categoria) |
| POST | `/api/estoque/saida` | saída manual de estoque |
| GET/POST | `/api/estoque/inventario` | busca por EAN / ajuste por contagem |
| POST | `/api/contas/pagar` | marca conta como paga |
| GET | `/api/teste` | diagnóstico: verifica env, Google Sheets e Meu Danfe (use `?chave=` para teste real opcional) |

## Como o fluxo respeita os limites da Meu Danfe

O endpoint `buscar` **não** fica preso esperando a nota processar (isso estouraria o
timeout da Vercel). Cada chamada consulta uma vez e devolve o status; se for
`WAITING`/`SEARCHING`, o frontend reconsulta após o intervalo mínimo. Um controle por
chave em memória impede repetir a mesma chave em menos de 1s e limita as tentativas.

## Regra de conversão de unidades

A descrição é analisada para detectar o fator (`24UN`, `C/12`, `6X`, `CX20`…).
Exemplo: `CERV HEINEKEN ... 24UN`, quantidade 6 → **144 unidades** em estoque,
custo unitário = total da linha ÷ 144. O fator é editável na conferência e fica
**aprendido** por `CNPJ do fornecedor + código do produto + EAN` para as próximas notas.
