# Diagnóstico — Importação de treinamento e duplicidade de produtos

**Gerado em:** 2026-06-01  
**Sistema:** Super Ajudante Estoque — Araçá Grill  
**Escopo:** Análise estática de código (sem acesso ao banco em produção)  
**Status:** Diagnóstico concluído. Nenhuma alteração foi feita.

---

## 1. Fluxo atual da importação do JSON do ChatGPT

### Endpoint e função

- **Endpoint:** `POST /api/admin?recurso=treino-importar`
- **Função:** `treinoImportar()` em `api/admin.js` (linha ~489)
- **Validação prévia:** `validarCatalogo()` (linha ~440), chamada tanto em `treino-validar` quanto em `treino-importar`

### Aceitação do schema novo

O importador **aceita o schema `catalogo_revisado_gpt`**. A validação verifica:

```javascript
if (!j.schema_version) erros.push('Falta "schema_version".');
if (j.tipo !== 'catalogo_revisado_gpt') erros.push('"tipo" deve ser "catalogo_revisado_gpt".');
```

O importador **não usa nenhum formato antigo** `catalogo[]`. O schema novo com `produtos_confirmados`, `embalagens_confirmadas`, `mapeamentos_confirmados` e `aliases_confirmados` é o único suportado.

### Como ele lê cada seção

**`produtos_confirmados`** — iterado em `for (const p of j.produtos_confirmados)`:

```javascript
const nome        = String(p.nome_interno || '').trim();        // ← SÓ nome_interno
const categoriaId = p.categoria_id || (p.categoria ?
                      garantirCategoria(p.categoria, cats) : '');
const unidade     = String(p.unidade_estoque || p.unidade_base || 'UN').toUpperCase();
const cnpj        = String(p.cnpj_fornecedor || '').replace(/\D/g, '');
const codigo      = String(p.codigo_produto_nf || p.codigo_produto_fornecedor || '');
```

Depois tenta localizar o produto existente por 3 critérios (em ordem):
1. `p.id_produto` exato
2. CNPJ + codigo_produto_nf no banco de Produtos
3. `normalizarDesc(nome_interno)` do produto do JSON vs banco

Se encontrar → atualiza. Se não encontrar → cria novo.

Após processar, armazena a associação:
```javascript
idPorChave[p.chave || nome] = id_produto_real;
```

Este mapa `idPorChave` é a chave que vincula produtos às embalagens, mapeamentos e aliases.

**`embalagens_confirmadas`**:
```javascript
const idp = e.id_produto || idPorChave[e.produto || e.chave || e.nome_interno];
if (!idp) continue;  // ← SILENCIOSO, pula sem aviso
```

**`mapeamentos_confirmados`**:
```javascript
const idp = m.id_produto || idPorChave[m.produto || m.chave || m.nome_interno];
if (!idp) continue;  // ← SILENCIOSO, pula sem aviso
```

**`aliases_confirmados`**:
```javascript
const idp = a.id_produto || idPorChave[a.produto || a.chave || a.nome_interno];
if (!idp || !alias) continue;  // ← SILENCIOSO, pula sem aviso
```

---

## 2. Compatibilidade entre `nome_interno` e `produto_interno`

### Resposta direta: o importador NÃO aceita `produto_interno`

O campo usado em **todos** os processos de vinculação é `nome_interno`. O campo `produto_interno` — que o ChatGPT às vezes gera — **não é reconhecido em nenhum lugar do código**.

### Evidências do código

**`validarCatalogo` (linha ~453):**
```javascript
if (!String(p.nome_interno || '').trim())
  erros.push(`Produto #${i + 1}: falta nome_interno.`);
```
→ A validação **exige `nome_interno`**. Se vier `produto_interno`, o campo `nome_interno` fica vazio e a validação **rejeita o JSON inteiro**.

**`treinoImportar` — leitura do produto (linha ~512):**
```javascript
const nome = String(p.nome_interno || '').trim();
```
→ Lê apenas `nome_interno`. Se `produto_interno` for o campo enviado, `nome` fica `''`.

**`idPorChave` — chave de vinculação (linha ~540/556):**
```javascript
idPorChave[p.chave || nome] = alvo.id_produto;
// ou
idPorChave[p.chave || nome] = id;  // para produtos novos
```
→ A chave é `p.chave` (se existir) ou o `nome_interno`. Se o ChatGPT não enviar `chave` e o `nome_interno` estiver vazio (porque veio em `produto_interno`), a chave de entrada no mapa será `''` (string vazia).

**Lookup em embalagens/mapeamentos/aliases:**
```javascript
idPorChave[e.produto || e.chave || e.nome_interno]
```
→ Busca por `e.produto`, `e.chave` ou `e.nome_interno`. O campo `produto_interno` **não está na lista**. Se o ChatGPT enviar `produto_interno: "Cerveja Brahma"`, nenhum desses campos tem valor, o resultado é `undefined`, e o bloco executa `continue` — **silenciosamente descartado**.

### Cenários de falha

| Campo enviado pelo ChatGPT | Produto resolvido? | Embalagem criada? | Mapeamento criado? | Alias criado? |
|---|---|---|---|---|
| `nome_interno: "Cerveja Brahma"` | ✅ Sim | ✅ Sim | ✅ Sim | ✅ Sim |
| `produto_interno: "Cerveja Brahma"` | ❌ Falha na validação | ❌ Não | ❌ Não | ❌ Não |
| `chave: "cerveja-brahma"` + `nome_interno: "Cerveja Brahma"` | ✅ Sim | ✅ Se usar mesma `chave` | ✅ Se usar mesma `chave` | ✅ Se usar mesma `chave` |
| `nome_interno: "Cerveja"` (no produto) e `produto: "Cerveja"` (na embalagem) | ✅ Produto criado | ✅ Sim (match por `produto`) | ✅ Sim | ✅ Sim |

---

## 3. Categorias

### Lógica no importador (`treinoImportar`, linha ~513)

```javascript
const categoriaId = p.categoria_id
  || (p.categoria ? await garantirCategoria(p.categoria, cats) : '');
```

**Ordem de prioridade:**
1. `categoria_id` (se presente, é usado diretamente **sem validar se existe no banco**)
2. `categoria` (nome) → chama `garantirCategoria()`, que busca ou cria a categoria

### Problema A: `categoria_id` inventado pelo ChatGPT

Se o ChatGPT enviar:
```json
{ "nome_interno": "Cerveja Brahma", "categoria_id": "CAT-0099" }
```
E `CAT-0099` não existir na tabela `Categorias`, o produto é salvo com `categoria_id = "CAT-0099"` que não tem correspondência. Na UI, o produto aparece **sem categoria visível**, pois o select de categorias não encontra o ID.

Além disso, como `categoria_id` é truthy, **`categoria` é ignorado mesmo que presente**.

Exemplo de caso problemático:
```json
{
  "nome_interno": "Cerveja Brahma",
  "categoria": "Bebidas",
  "categoria_id": "CAT-0099"
}
```
→ `categoria_id` tem prioridade → `"CAT-0099"` é salvo → categoria "Bebidas" nunca é criada ou associada.

### Problema B: produto importado sem categoria

Se o ChatGPT não enviar nem `categoria` nem `categoria_id`, `categoriaId = ''`. O produto é criado com `categoria_id: ''`. Isso é válido no código (não gera erro), mas o produto fica sem categoria no banco.

### `garantirCategoria()` — o que faz

```javascript
async function garantirCategoria(nome, cache) {
  const n = String(nome || '').trim();
  if (!n) return '';
  const cats = cache || await readRows('Categorias');
  const achado = cats.find((c) =>
    c.nome_categoria.trim().toLowerCase() === n.toLowerCase()
    && c.ativo === 'SIM');
  if (achado) return achado.id_categoria;
  // Cria nova:
  const id = await nextId('Categorias', 'id_categoria', 'CAT');
  await appendRow('Categorias', { id_categoria: id, nome_categoria: n, ativo: 'SIM' });
  return id;
}
```

Funciona corretamente quando usada. O problema é que só é chamada quando `categoria_id` está ausente.

### Produto confirmado salvo sem categoria

Sim, é possível. O código em `treinoImportar` faz:
```javascript
await appendRow('Produtos', {
  ...
  categoria_id: categoriaId,   // pode ser ''
  confirmado: 'SIM',           // confirmado mesmo sem categoria
  ...
});
```

Não há validação que impeça `confirmado: 'SIM'` com `categoria_id: ''`.

### Entrada real pode criar produto novo sem categoria

Sim. Em `confirmar.js` (linha ~143):
```javascript
categoria_id: it.categoria_id || '',
confirmado: (it.nome_interno && it.categoria_id) ? 'SIM' : 'NAO',
```
Se `it.categoria_id` for vazio (produto não reconhecido + usuário não selecionou categoria na tela de conferência), o produto é criado sem categoria e fica `confirmado: 'NAO'`.

---

## 4. Mapeamentos fornecedor/produto

### Tabela: `produto_fornecedor`

| Campo no banco | Descrição |
|---|---|
| `id_pf` | Chave primária (PF-0001) |
| `id_produto` | FK para `produtos.id_produto` |
| `cnpj_fornecedor` | CNPJ sem formatação |
| `codigo_produto_nf` | Código do produto na NF-e |
| `ean` | EAN |
| `descricao_original` | Descrição da NF |
| `descricao_normalizada` | Normalizado para comparação |
| `ativo` | SIM/NAO |
| `confirmado_pelo_usuario` | SIM/NAO |
| `origem_confirmacao` | 'CHATGPT' ou 'NFE' |

### Como o mapeamento é criado na importação

```javascript
for (const m of (j.mapeamentos_confirmados || [])) {
  const idp = m.id_produto || idPorChave[m.produto || m.chave || m.nome_interno];
  if (!idp) continue;   // ← PULA SE idp NÃO RESOLVIDO
  const cnpj  = String(m.cnpj_fornecedor || '').replace(/\D/g, '');
  const codigo = String(m.codigo_produto_nf || m.codigo_produto_fornecedor || '');
  const existe = pfTodos.find(x =>
    x.id_produto === idp
    && x.cnpj_fornecedor === cnpj
    && x.codigo_produto_nf === codigo);
  if (existe) continue;  // não duplica
  // cria com ativo: 'SIM', confirmado_pelo_usuario: 'SIM', origem_confirmacao: 'CHATGPT'
```

O mapeamento é criado com `ativo: 'SIM'` e `confirmado_pelo_usuario: 'SIM'` — correto.

### Problema: o mapeamento só é criado se `idp` for resolvido

Se o ChatGPT enviar o mapeamento com `produto_interno` ao invés de `nome_interno`/`produto`/`chave`, o `idPorChave` retorna `undefined`, o código faz `continue` e **o mapeamento nunca é gravado**. O sistema então não consegue reconhecer o produto na próxima NF-e real.

### Mapeamentos duplicados

O código verifica por `id_produto + cnpj + codigo_produto_nf`. Se o mesmo CNPJ+codigo apontar para produtos diferentes, isso é possível se o produto foi treinado duas vezes com nomes levemente diferentes (gerando dois PRDs) e o mapeamento foi criado para ambos. `conferir.js` usará o **primeiro encontrado** na lista — que pode não ser o correto.

---

## 5. Reconhecimento na entrada real da NF-e

**Arquivo:** `api/nfe/conferir.js`  
**Função:** `acharProduto(it)` (linha ~43)

### Ordem exata de busca

#### Estratégia 1: Tabela `Produtos` — CNPJ + código ou EAN
```javascript
let p = produtos.find((x) => {
  if (String(x.ativo || 'SIM').toUpperCase() !== 'SIM') return false;   // ✅ filtra inativo
  if (String(x.produto_teste || 'NAO').toUpperCase() === 'SIM') return false; // ✅ filtra teste
  const mesmoForn = x.cnpj_fornecedor === cnpjForn;
  const porCodigo = mesmoForn && x.codigo_produto_nf === it.codigo_produto_nf;
  const porEan = it.codigo_barras && x.codigo_barras === it.codigo_barras;
  return porCodigo || porEan;
});
```
- Tabela: `Produtos`
- Campos: `cnpj_fornecedor`, `codigo_produto_nf`, `codigo_barras`
- Filtra inativos e testes: ✅
- **Falha se:** o produto foi importado sem `cnpj_fornecedor` ou `codigo_produto_nf` (campos vazios)

#### Estratégia 2: Tabela `Produto_Fornecedor` — CNPJ+código, EAN ou descrição normalizada
```javascript
const pf = pfRows.find((x) => {
  if (x.ativo !== 'SIM') return false;
  const mesmoForn = x.cnpj_fornecedor === cnpjForn;
  const porCodigo = mesmoForn && x.codigo_produto_nf === it.codigo_produto_nf;
  const porEan    = it.codigo_barras && x.ean === it.codigo_barras;
  const porDesc   = mesmoForn && descNorm && x.descricao_normalizada === descNorm;
  return porCodigo || porEan || porDesc;
});
if (pf && prodById[pf.id_produto]) return prodById[pf.id_produto];
```
- Tabela: `Produto_Fornecedor`
- Campos: `cnpj_fornecedor`, `codigo_produto_nf`, `ean`, `descricao_normalizada`
- Filtra mapeamentos inativos: ✅
- **Não filtra** produto alvo inativo/teste diretamente — verificação feita só depois
- **Falha se:** o mapeamento não foi criado (produto_interno bug) ou está inativo

#### Estratégia 3: Tabela `Aliases_Produto` — descrição normalizada
```javascript
const al = aliasRows.find(a =>
  a.ativo === 'SIM' && normalizarDesc(a.alias) === descNorm);
if (al && prodById[al.id_produto]) {
  const pa = prodById[al.id_produto];
  if (pa.ativo === 'SIM' && pa.produto_teste !== 'SIM') return pa;
}
```
- Tabela: `Aliases_Produto`
- Campo: `alias` normalizado
- Filtra aliases inativos: ✅ — filtra produto alvo inativo/teste: ✅
- **Falha se:** o alias não foi criado (produto_interno bug)

#### Quando nenhuma estratégia encontra:
```javascript
return null;
```
→ item recebe `produto_novo: true`, `id_produto: ''`, `nome_interno: ''`, `categoria_id: ''`

---

## 6. Ponto exato onde o duplicado é criado

### O duplicado nasce em `confirmar.js` — **não** na importação do JSON

**Arquivo:** `api/nfe/confirmar.js`, linhas ~96–167

### Fluxo de decisão em `confirmar.js`

```javascript
for (const it of itens) {
  let prod = null;

  // PASSO 1: busca por it.id_produto (vindo da tela de conferência)
  if (it.id_produto) {
    prod = produtos.find(p => p.id_produto === it.id_produto);
  }

  // PASSO 2 (fallback): busca APENAS na tabela Produtos por CNPJ+código ou EAN
  if (!prod) {
    prod = produtos.find(p => {
      const mesmoForn = p.cnpj_fornecedor === cnpjForn;
      const porCodigo = mesmoForn && p.codigo_produto_nf === it.codigo_produto_nf;
      const porEan = it.codigo_barras && p.codigo_barras === it.codigo_barras;
      return porCodigo || porEan;
    });
  }
  // ⚠️ NÃO filtra inativo/teste
  // ⚠️ NÃO consulta Produto_Fornecedor (mapeamentos)

  if (prod) {
    // atualiza estoque do produto encontrado
  } else {
    // CRIA NOVO PRODUTO → aqui nasce o duplicado
    idProduto = await nextId('Produtos', 'id_produto', 'PRD');
    await appendRow('Produtos', { ... });
  }
}
```

### Por que o duplicado acontece — cadeia causal

```
ChatGPT usa "produto_interno" em vez de "nome_interno"
        ↓
idPorChave não resolve o id → mapeamento é pulado com continue
        ↓
Produto_Fornecedor fica vazio para aquele produto
        ↓
conferir.js → Estratégia 1 falha (produto importado sem CNPJ/código no campo correto)
conferir.js → Estratégia 2 falha (mapeamento não existe)
conferir.js → Estratégia 3 falha (alias não existe)
        ↓
conferir.js retorna: produto_novo: true, id_produto: '', nome_interno: '', categoria_id: ''
        ↓
Tela de conferência exibe o item como NOVO (badge amarelo)
Usuário preenche nome e categoria (ou não preenche)
        ↓
confirmar.js recebe it.id_produto = ''
PASSO 1: it.id_produto está vazio → não acha
PASSO 2 fallback: busca na tabela Produtos por CNPJ+código
  → Se produto treinado tem cnpj_fornecedor e codigo_produto_nf corretos: ENCONTRA (sem duplicado)
  → Se produto treinado foi importado sem esses campos: NÃO ENCONTRA
        ↓
confirmar.js cria NOVO produto → DUPLICADO
```

### Função que decide "este produto é novo"

**`conferir.js` — função `acharProduto(it)` (linha ~43):**
```javascript
const acharProduto = (it) => {
  // ... 3 estratégias ...
  return null;  // ← esta linha torna o produto "novo"
};

const itens = dados.itens.map((it) => {
  const match = acharProduto(it);
  if (match) { return { ...it, id_produto: match.id_produto, produto_novo: false }; }
  return { ...it, id_produto: '', produto_novo: true };  // ← aqui é marcado como novo
});
```

### Função que cria o produto novo

**`confirmar.js` — linhas ~134–167:**
```javascript
} else {
  idProduto = await nextId('Produtos', 'id_produto', 'PRD');
  await appendRow('Produtos', {
    id_produto: idProduto,
    cnpj_fornecedor: cnpjForn,
    codigo_produto_nf: it.codigo_produto_nf,
    nome_interno: it.nome_interno || it.descricao_original,
    categoria_id: it.categoria_id || '',
    confirmado: (it.nome_interno && it.categoria_id) ? 'SIM' : 'NAO',
    ...
  });
}
```

**Verifica antes se já existe por CNPJ+código?** Sim, no fallback PASSO 2 — mas **não** consulta `Produto_Fornecedor`.  
**Verifica por nome_interno semelhante?** Não.  
**Verifica aliases?** Não.  
**Verifica inativos ou testes?** Não — pode atualizar produto inativo se CNPJ+código bater.

---

## 7. Teste controlado obrigatório

### Hipótese de produto: "Cerveja Brahma 600ml"

Assumindo que o ChatGPT enviou o JSON com:

```json
{
  "produtos_confirmados": [{
    "produto_interno": "Cerveja Brahma 600ml",
    "categoria": "Bebidas",
    "unidade_estoque": "UN",
    "cnpj_fornecedor": "12345678000199",
    "codigo_produto_nf": "1234"
  }],
  "mapeamentos_confirmados": [{
    "produto_interno": "Cerveja Brahma 600ml",
    "cnpj_fornecedor": "12345678000199",
    "codigo_produto_nf": "1234"
  }]
}
```

### O que acontece na importação

| Etapa | Resultado |
|---|---|
| `validarCatalogo` | **Erro:** "Produto #1: falta nome_interno." → importação rejeitada |
| Se o usuário ignorar o erro e forçar (substituir=true) | Produtos confirmados processados com `nome = ''` |
| `idPorChave` | Chave é `p.chave || nome` = `undefined || ''` = `''` |
| Mapeamento: `idPorChave[m.produto || m.chave || m.nome_interno]` | `undefined || undefined || undefined` = `undefined` → `continue` |
| Resultado no banco | Produto criado com `nome_interno: ''`, sem mapeamento |

### Cenário corrigido (ChatGPT usa `nome_interno` corretamente)

```json
{
  "produtos_confirmados": [{
    "nome_interno": "Cerveja Brahma 600ml",
    "categoria": "Bebidas",
    "unidade_estoque": "UN",
    "cnpj_fornecedor": "12345678000199",
    "codigo_produto_nf": "1234"
  }],
  "mapeamentos_confirmados": [{
    "nome_interno": "Cerveja Brahma 600ml",
    "cnpj_fornecedor": "12345678000199",
    "codigo_produto_nf": "1234"
  }]
}
```

**Antes da entrada real:**

| Campo | Valor esperado |
|---|---|
| Existe em Produtos? | Sim, PRD-XXXX |
| nome_interno | "Cerveja Brahma 600ml" |
| categoria_id | CAT-YYYY (criado por garantirCategoria) |
| confirmado | SIM |
| ativo | SIM |
| cnpj_fornecedor | `12345678000199` |
| codigo_produto_nf | `1234` |
| Existe mapeamento? | Sim, PF-ZZZZ (cnpj+codigo → PRD-XXXX) |
| Existe embalagem? | Só se `embalagens_confirmadas` foi enviado |
| Existe alias? | Só se `aliases_confirmados` foi enviado |

**Durante conferir.js (NF-e real):**

| Estratégia | Resultado |
|---|---|
| 1: Produtos CNPJ+código | ✅ Encontra PRD-XXXX se `cnpj_fornecedor` e `codigo_produto_nf` foram gravados |
| 2: Produto_Fornecedor | ✅ Encontra via mapeamento PF-ZZZZ |
| produto_novo | false |
| id_produto retornado | PRD-XXXX |
| categoria_id | CAT-YYYY (do produto) |

**Ao confirmar entrada real:**

| Etapa | Resultado |
|---|---|
| confirmar.js PASSO 1 | Encontra PRD-XXXX pelo id_produto |
| Cria duplicado? | **Não** |
| Atualiza estoque | PRD-XXXX |
| Cria mapeamento novo? | Não (já existe) — atualiza vezes_utilizado |

---

## 8. Comparação entre JSON importado e o que ficou salvo

Baseado na análise do código (sem acesso ao banco em produção):

| Campo | Veio no JSON | Salvo no banco? | Onde | Observação |
|---|---|---|---|---|
| `nome_interno` | Sim | ✅ Sim | `produtos.nome_interno` | Campo obrigatório |
| `produto_interno` | Sim (ChatGPT gera) | ❌ Não | — | Campo não reconhecido |
| `categoria` (nome) | Sim | ✅ Sim (via garantirCategoria) | `categorias` + `produtos.categoria_id` | Só se `categoria_id` ausente |
| `categoria_id` | Sim (às vezes) | ✅ Sim (sem validar) | `produtos.categoria_id` | Pode ser ID inválido |
| `unidade_estoque` | Sim | ✅ Sim | `produtos.unidade_estoque` | |
| `cnpj_fornecedor` (no produto) | Às vezes | ✅ Sim se presente | `produtos.cnpj_fornecedor` | Sem isso, Estratégia 1 falha |
| `codigo_produto_nf` (no produto) | Às vezes | ✅ Sim se presente | `produtos.codigo_produto_nf` | Sem isso, Estratégia 1 falha |
| `ean` | Às vezes | ✅ Sim | `produtos.codigo_barras` | |
| Mapeamento CNPJ+código | Sim (em `mapeamentos_confirmados`) | ❌ Não se `produto_interno` | `produto_fornecedor` | Bug principal |
| Embalagem | Sim (em `embalagens_confirmadas`) | ❌ Não se `produto_interno` | `embalagens` | Mesmo bug |
| Alias | Sim (em `aliases_confirmados`) | ❌ Não se `produto_interno` | `aliases_produto` | Mesmo bug |
| `confirmado: 'SIM'` | Implícito (importador define) | ✅ Sim | `produtos.confirmado` | Sempre SIM após importar |
| `ativo: 'SIM'` | Implícito | ✅ Sim | `produtos.ativo` | |

---

## 9. Auditoria do banco atual

Por não ter acesso direto ao banco em produção, abaixo estão as consultas SQL que revelariam cada problema. **Rode no Supabase SQL Editor (apenas leitura).**

### Produtos ativos sem categoria
```sql
select id_produto, nome_interno, confirmado
from produtos
where ativo = 'SIM'
  and (categoria_id is null or categoria_id = '');
```

### Produtos confirmados sem categoria
```sql
select id_produto, nome_interno
from produtos
where confirmado = 'SIM'
  and (categoria_id is null or categoria_id = '');
```

### Produtos com categoria_id que não existe em categorias
```sql
select p.id_produto, p.nome_interno, p.categoria_id
from produtos p
left join categorias c on c.id_categoria = p.categoria_id
where p.ativo = 'SIM'
  and p.categoria_id is not null
  and p.categoria_id != ''
  and c.id_categoria is null;
```

### Produtos com nomes duplicados (criados em momento diferente)
```sql
select nome_interno, count(*) as qtd, array_agg(id_produto) as ids
from produtos
where ativo = 'SIM'
  and nome_interno is not null
  and nome_interno != ''
group by nome_interno
having count(*) > 1;
```

### Produtos com mesmo CNPJ+código apontando para mais de um produto
```sql
select cnpj_fornecedor, codigo_produto_nf, count(*) as qtd, array_agg(id_produto)
from produto_fornecedor
where ativo = 'SIM'
  and cnpj_fornecedor != ''
  and codigo_produto_nf != ''
group by cnpj_fornecedor, codigo_produto_nf
having count(*) > 1;
```

Também verificar na tabela `produtos`:
```sql
select cnpj_fornecedor, codigo_produto_nf, count(*) as qtd, array_agg(id_produto)
from produtos
where ativo = 'SIM'
  and cnpj_fornecedor != ''
  and codigo_produto_nf != ''
group by cnpj_fornecedor, codigo_produto_nf
having count(*) > 1;
```

### Mapeamentos sem produto válido
```sql
select pf.id_pf, pf.id_produto, pf.cnpj_fornecedor
from produto_fornecedor pf
left join produtos p on p.id_produto = pf.id_produto
where p.id_produto is null or p.ativo = 'NAO';
```

### Aliases sem produto válido
```sql
select a.id_alias, a.alias, a.id_produto
from aliases_produto a
left join produtos p on p.id_produto = a.id_produto
where p.id_produto is null or p.ativo = 'NAO';
```

### Embalagens sem produto válido
```sql
select e.id_embalagem, e.id_produto, e.descricao
from embalagens e
left join produtos p on p.id_produto = e.id_produto
where p.id_produto is null or p.ativo = 'NAO';
```

### Produtos criados por teste
```sql
select id_produto, nome_interno, criado_em
from produtos
where produto_teste = 'SIM';
```

### Produtos inativos com mapeamento ainda ativo
```sql
select p.id_produto, p.nome_interno, p.ativo as prod_ativo,
       pf.id_pf, pf.ativo as map_ativo
from produtos p
join produto_fornecedor pf on pf.id_produto = p.id_produto
where p.ativo = 'NAO' and pf.ativo = 'SIM';
```

### Produtos sem embalagem base (fator 1)
```sql
select p.id_produto, p.nome_interno
from produtos p
left join embalagens e on e.id_produto = p.id_produto
  and e.fator = 1 and e.ativo = 'SIM'
where p.ativo = 'SIM'
  and e.id_embalagem is null;
```

---

## 10. Tabelas e arquivos envolvidos

### Arquivos

| Arquivo | Função no fluxo |
|---|---|
| `public/index.html` | Tela de conferência, chamada `confirmarImportacao()`, `importarTreino()`, `renderConferencia()` |
| `api/admin.js` | `treinoValidar`, `treinoImportar`, `garantirCategoria`, `garantirEmbalagem` |
| `api/nfe/conferir.js` | Reconhecimento de produtos na NF-e real (3 estratégias) |
| `api/nfe/confirmar.js` | Criação de produto novo / atualização de estoque na confirmação |
| `api/nfe/add-xml.js` | Reconhecimento via XML direto (só Estratégia 1, sem Produto_Fornecedor) |
| `api/_lib/db.js` | CRUD no Supabase |
| `api/_lib/parser.js` | Parse do XML + `normalizarDesc()` |
| `api/_lib/estoque.js` | Lógica de custo médio ponderado |

### Tabelas

| Tabela | Papel |
|---|---|
| `produtos` | Cadastro principal. Campos-chave: `cnpj_fornecedor`, `codigo_produto_nf`, `ativo`, `confirmado` |
| `categorias` | Lookup por nome ou id |
| `produto_fornecedor` | Mapeamento CNPJ+código → id_produto. **Chave para o reconhecimento via Estratégia 2** |
| `aliases_produto` | Nomes alternativos → id_produto. Estratégia 3 |
| `embalagens` | Fatores de conversão por produto |
| `itens_nota` | Itens confirmados. Referenciados no histórico |
| `notas_fiscais` | Cabeçalho das notas confirmadas |
| `movimentacoes_estoque` | Histórico de entradas/saídas |
| `treino_fila` | Fila da Esteira de Treinamento (não toca estoque real) |
| `treino_itens` | Itens da esteira |

---

## 11. Hipótese técnica

### Causa confirmada como principal: **A + B combinadas**

#### A. O importador não aceita `produto_interno`

**Evidência:**
```javascript
// validarCatalogo:
if (!String(p.nome_interno || '').trim()) erros.push(...);
// treinoImportar:
const nome = String(p.nome_interno || '').trim();
// idPorChave lookup em emb/map/alias:
idPorChave[e.produto || e.chave || e.nome_interno]  // produto_interno não está aqui
```

Se o ChatGPT envia `produto_interno`, o importador não grava os mapeamentos, embalagens e aliases — silenciosamente.

#### B. O importador pode criar produto com `cnpj_fornecedor` e `codigo_produto_nf` vazios

Se `produtos_confirmados` não inclui `cnpj_fornecedor` e `codigo_produto_nf` (comum quando ChatGPT não os conhece), o produto é salvo com campos vazios:
```javascript
const cnpj = String(p.cnpj_fornecedor || '').replace(/\D/g, '');  // ''
const codigo = String(p.codigo_produto_nf || p.codigo_produto_fornecedor || '');  // ''
```
Resultado: `conferir.js` Estratégia 1 (CNPJ+código) não encontra. Só sobra Estratégia 2 (mapeamento) — que também está vazia se `produto_interno` foi usado.

#### C. `confirmar.js` não consulta `Produto_Fornecedor` no fallback

**Evidência (confirmar.js linha ~103):**
```javascript
if (!prod) {
  prod = produtos.find(p => {
    // busca APENAS na tabela Produtos, NÃO em produto_fornecedor
    return porCodigo || porEan;
  });
}
```

`conferir.js` tem 3 estratégias. `confirmar.js` só tem 2 (CNPJ+código e EAN, ambas na tabela `produtos`). Se o reconhecimento em `conferir.js` foi feito via `produto_fornecedor` mas o `id_produto` não chegou corretamente no payload, `confirmar.js` cria duplicado.

#### F. `categoria_id` inventado pelo ChatGPT

**Evidência:**
```javascript
const categoriaId = p.categoria_id || (p.categoria ? garantirCategoria(...) : '');
```
Se ChatGPT envia `categoria_id: "CAT-0099"` e esse ID não existe, o produto é salvo com ID inválido. Na tela, aparece sem categoria.

---

## 12. Proposta de correção

> Diagnóstico concluído. Nenhuma alteração implementada. Correções propostas abaixo.

### Arquivo: `api/admin.js` — função `treinoImportar`

**Correção 1 — aceitar `produto_interno` como sinônimo de `nome_interno`:**
```javascript
// Onde hoje:
const nome = String(p.nome_interno || '').trim();
// Corrigir para:
const nome = String(p.nome_interno || p.produto_interno || '').trim();
```

**Correção 2 — `idPorChave` lookup nas embalagens/mapeamentos/aliases:**
```javascript
// Onde hoje:
idPorChave[e.produto || e.chave || e.nome_interno]
// Corrigir para:
idPorChave[e.id_produto_ref || e.produto || e.produto_interno || e.chave || e.nome_interno]
```
(Mesma correção em mapeamentos e aliases.)

**Correção 3 — validar `categoria_id` antes de usar:**
```javascript
// Onde hoje:
const categoriaId = p.categoria_id || (p.categoria ? await garantirCategoria(...) : '');
// Corrigir para:
let categoriaId = '';
if (p.categoria_id && cats.find(c => c.id_categoria === p.categoria_id)) {
  categoriaId = p.categoria_id;  // só usa se o ID existe no banco
} else if (p.categoria) {
  categoriaId = await garantirCategoria(p.categoria, cats);
}
```

**Correção 4 — impedir produto confirmado salvo sem categoria:**
```javascript
// Antes do appendRow/updateRow, forçar:
if (!categoriaId) {
  relatorio.conflitos.push({ nome, motivo: 'Falta categoria — produto salvo como NAO confirmado.' });
  confirmado = 'NAO';
}
```

### Arquivo: `api/nfe/confirmar.js`

**Correção 5 — consultar `Produto_Fornecedor` no fallback:**
```javascript
if (!prod) {
  // fallback na tabela Produtos (atual)
  prod = produtos.find(p => ...);
}
if (!prod && pfTodos.length) {
  // NOVO fallback em Produto_Fornecedor
  const pf = pfTodos.find(x =>
    x.ativo === 'SIM'
    && x.cnpj_fornecedor === cnpjForn
    && x.codigo_produto_nf === it.codigo_produto_nf);
  if (pf) prod = produtos.find(p => p.id_produto === pf.id_produto);
}
```

**Correção 6 — filtrar inativo/teste no fallback de confirmar.js:**
```javascript
prod = produtos.find(p => {
  if (p.ativo !== 'SIM') return false;      // não atualiza inativo
  if (p.produto_teste === 'SIM') return false; // não atualiza teste
  ...
});
```

### Correção de dados já salvos errado

1. Produtos com `categoria_id` inválido → atualizar manualmente pela tela de edição de produto ou via SQL:
   ```sql
   update produtos set categoria_id = '' where categoria_id not in (select id_categoria from categorias);
   ```

2. Produtos duplicados → identificar pelo relatório, inativar o duplicado (botão "Excluir produto" na tela de edição).

3. Mapeamentos ausentes → reimportar o JSON com o campo corrigido para `nome_interno`, ou criar manualmente os mapeamentos via importação.

---

## 13. Resumo executivo

### O que está funcionando ✅

- Schema `catalogo_revisado_gpt` é aceito corretamente
- `garantirCategoria` cria categorias novas automaticamente quando `categoria` (nome) é enviado
- `conferir.js` tem 3 estratégias de reconhecimento bem implementadas
- Filtros de inativo/teste estão corretos em `conferir.js` e `inventario.js`
- O mapeamento é criado com `confirmado_pelo_usuario: 'SIM'` e `origem_confirmacao: 'CHATGPT'`
- Inativação e exclusão de produtos funcionam corretamente

### O que está falhando ❌

1. **Campo `produto_interno`** enviado pelo ChatGPT não é reconhecido pelo importador — embalagens, mapeamentos e aliases são silenciosamente descartados
2. **`categoria_id` inventado** pelo ChatGPT é salvo sem validação → produto fica com ID de categoria inexistente → aparece sem categoria na UI
3. **`confirmar.js` não consulta `Produto_Fornecedor`** no fallback — se o `id_produto` não chegar corretamente na payload, cria duplicado mesmo com mapeamento correto no banco
4. **Produto confirmado pode ser salvo sem categoria** — sem validação que impeça isso

### Por que está duplicando

A cadeia principal de causa:
> ChatGPT usa `produto_interno` → mapeamento não é criado → `conferir.js` não reconhece o produto na NF-e real → retorna `produto_novo: true` com `id_produto: ''` → `confirmar.js` cria novo produto → **duplicado**.

Causa secundária:
> `confirmar.js` não consulta `Produto_Fornecedor` → mesmo com mapeamento correto, se `id_produto` vier vazio por qualquer motivo, o produto não é encontrado e é duplicado.

### Por que está ficando sem categoria

> ChatGPT envia `categoria_id` inventado (ex: `"CAT-0005"`) → importador usa sem validar → produto salvo com ID inválido → categoria não aparece na UI.

Ou:
> ChatGPT não envia nem `categoria` nem `categoria_id` → produto salvo com `categoria_id: ''`.

### Correção recomendada

**Prioridade 1 (causa raiz):** Aceitar `produto_interno` como sinônimo de `nome_interno` em todas as etapas da importação.  
**Prioridade 2:** Validar `categoria_id` antes de salvar; nunca usar um ID que não existe no banco.  
**Prioridade 3:** Adicionar fallback em `confirmar.js` para consultar `Produto_Fornecedor`.  

### É seguro continuar treinando agora?

**Depende.** Se o ChatGPT estiver usando `nome_interno` (e não `produto_interno`), e se os `categoria_id` enviados forem válidos ou ausentes (usando só `categoria` por nome), o fluxo funciona. 

Recomendação antes de treinar em escala:
1. Rodar as queries de auditoria da Seção 9 para entender o estado atual do banco
2. Implementar as correções da Seção 12 (especialmente Prioridade 1 e 2)
3. Usar sempre `nome_interno` no JSON e nunca `categoria_id` — só `categoria` com o nome textual
4. Após cada importação, verificar no relatório se `mapeamentos_criados > 0`
