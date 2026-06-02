# Recomendação técnica — treinamento inteligente de produtos
**Super Ajudante Estoque — Araçá Grill**
Gerado em: 2026-06-02
Status: apenas diagnóstico e recomendação — nenhum código ou banco foi alterado.

---

## 1. Como normalmente esse tipo de sistema é estruturado?

Sistemas de controle de estoque para restaurantes bem desenhados separam pelo menos seis conceitos distintos. Misturá-los é a principal causa de problemas de duplicidade, embalagem errada e reconhecimento falso.

### Os seis conceitos fundamentais

| Conceito | Definição | Exemplo Araçá Grill |
|---|---|---|
| **Produto de estoque** | O que você guarda fisicamente e conta no inventário | Cerveja Heineken Garrafa 600ml |
| **Produto de venda / cardápio** | O que o cliente pede e você cobra | Cerveja Heineken 600ml |
| **Insumo** | Matéria-prima para compor um produto de venda | Queijo mussarela, Carne moída |
| **Embalagem de entrada (compra)** | Como o fornecedor entrega | Caixa com 24 unidades, Fardo 6×5kg |
| **Embalagem de saída (venda/uso)** | Como você usa ou vende | Garrafa unitária, Porção 200g |
| **Embalagem de inventário** | Unidade que você conta fisicamente | Garrafa, Kg, Pacote 5kg |

### Identidades que o sistema precisa gerenciar

**Código do produto na NF-e (`codigo_produto_nf`)**
É o código interno do fornecedor. Não é universal. A mesma Heineken 600ml pode ter código `01234` na Ambev e `HNK600` na distribuidora regional. É o identificador mais confiável *por fornecedor*, mas inútil sozinho.

**Código de barras unitário (`codigo_barras_unitario`)**
EAN-13 da unidade que você escaneia no estoque. Para cerveja: o código da garrafa individual. Este sim é universal e estável entre fornecedores.

**Código de barras da caixa/fardo/pacote**
EAN-14 ou DUN-14. Raramente aparece na NF-e (ela usa o código do produto). Útil para recebimento rápido, mas não é obrigatório para o Super Ajudante neste momento.

**Alias (apelido de descrição)**
Variação de nome que o fornecedor usa para o mesmo produto. Ex: `CERV HEINEKEN PIL 0.600 GFA CX24` e `HEINEKEN 600ML CX24` são o mesmo produto. O alias permite que o reconhecimento encontre o produto pela descrição normalizada sem precisar de mapeamento manual.

**Mapeamento fornecedor/produto (`Produto_Fornecedor`)**
Tabela que cruza CNPJ do fornecedor + código do produto NF-e com o `id_produto` interno. É a estratégia mais robusta porque não depende de nome. Uma vez feito, o reconhecimento nunca falha para aquele fornecedor.

**Categoria**
Agrupamento comercial para organização interna (Cervejas, Carnes, Limpeza...).

**Subcategoria**
Refinamento da categoria (Cervejas > Long Neck, Cervejas > Garrafa 600ml, Cervejas > Lata).

---

## 2. Produto de venda × produto de estoque

Esta é a distinção mais crítica para o Araçá Grill.

### Quando pode haver vínculo direto (1:1)

Existe vínculo direto quando o produto vendido é **idêntico** ao produto estocado, sem nenhuma transformação, divisão ou composição.

**Casos do Araçá onde o vínculo direto faz sentido:**
- Cerveja Heineken 600ml → estoque: Cerveja Heineken Garrafa 600ml
- Refrigerante Coca-Cola Lata 350ml → estoque: Coca-Cola Lata 350ml
- Água mineral 500ml → estoque: Água Mineral 500ml
- Dose de cachaça (servida da garrafa) → estoque: Cachaça [marca] 1L *(com fator de conversão: 1 garrafa = N doses)*

Nestes casos, vender 1 unidade consome exatamente 1 unidade do estoque (ou uma fração fixa e previsível).

### Quando NÃO pode haver vínculo direto

Quando o produto de venda envolve **transformação, preparo ou composição** com outros insumos.

**Casos do Araçá onde NÃO existe vínculo direto:**
- Porção de fritas → insumos: batata congelada, sal, óleo (precisa de ficha técnica)
- X-Burguer → insumos: pão, carne, queijo, alface, tomate, molho
- Suco de laranja natural → insumo: laranja (gramas por copo)
- Prato de arroz com feijão → insumos: arroz, feijão, óleo, alho, sal
- Drink preparado → insumos: destilado, suco, xarope, gelo

### Quando precisa de ficha técnica

Toda vez que um produto de venda é composto por **dois ou mais insumos**, ou quando um insumo passa por **transformação** (porcionamento, cozimento, preparo), é necessária uma ficha técnica que liste:
- Ingredientes e quantidades
- Fator de rendimento (ex: 1kg de frango limpo rende 780g após preparo)
- Fator de desperdício

**Regra prática para o Araçá:** se você consegue responder "vender 1 unidade consome X de qual produto de estoque?", o vínculo direto é possível. Se a resposta envolve mais de um produto, é ficha técnica.

### Como bebidas prontas devem ser tratadas

Bebidas prontas (lata, garrafa, long neck) são o caso mais simples:

```
Produto de venda: Cerveja Heineken 600ml (cardápio ChefWeb)
    ↕ vínculo direto 1:1
Produto de estoque: Cerveja Heineken Garrafa 600ml
    ↕ mapeamento CNPJ+código
NF-e: CERV HEINEKEN PIL 0.600 GFA CX24 (embalagem: caixa 24un)
```

O sistema já trata isso via embalagem de entrada (caixa 24) com fator 24 → estoque em unidades.

**Recomendação:** usar a lista do ChefWeb para nomear corretamente o produto de estoque de bebidas. O nome do estoque deve ser o nome comercial claro, não o nome da NF-e. O nome do cardápio pode ser simplificado (sem "Garrafa").

### Como pratos, porções, lanches, sucos, drinks e chopp devem ser tratados

**Por enquanto:** registrar estes produtos de venda somente como **referência futura**, sem criar vínculos com estoque. O objetivo agora é:
1. Saber que eles existem no cardápio.
2. Usá-los como dica de nomenclatura para bebidas prontas.
3. Não criar insumos automáticos para eles.

**Chopp:** merece atenção especial. Chopp é vendido em copas/pintas mas comprado em barril. O fator de conversão (litros por barril → copos servidos) depende de desperdício e temperatura. Recomendo controlar barril como produto de estoque em litros, e deixar o vínculo com venda para uma fase futura.

---

## 3. Categorias e subcategorias

### Diagnóstico do estado atual

As categorias atuais do Araçá (Câmara Fria, Cervejas, Grãos e Farinhas, Bebidas, Limpeza, Outros) são funcionais mas insuficientes à medida que o catálogo cresce. O principal problema é que "Bebidas" e "Cervejas" se sobrepõem.

### Melhor estrutura para restaurante: categoria + subcategoria

Para um restaurante do porte do Araçá Grill, a estrutura ideal é **dois níveis: categoria principal + subcategoria**. Tags e grupos adicionais criam complexidade desnecessária neste momento.

**Proposta de categorias e subcategorias para o Araçá:**

```
Bebidas
  ├── Cervejas garrafa
  ├── Cervejas lata
  ├── Long neck / premium
  ├── Refrigerantes
  ├── Águas
  ├── Sucos industrializados
  ├── Destilados
  ├── Vinhos
  └── Energéticos

Câmara fria
  ├── Carnes bovinas
  ├── Carnes suínas
  ├── Aves
  ├── Frutos do mar
  ├── Frios e embutidos
  └── Queijos e laticínios

Secos / mercearia
  ├── Arroz e grãos
  ├── Farinhas e massas
  ├── Óleos e gorduras
  ├── Molhos e condimentos
  ├── Conservas e enlatados
  ├── Sachês e temperos
  └── Açúcar e doces

Descartáveis e embalagens
  ├── Copos e pratos descartáveis
  ├── Embalagens para delivery
  ├── Palitos, canudos e guardanapos
  └── Papel alumínio e filme

Limpeza e higiene
  ├── Detergentes e desengordurantes
  ├── Desinfetantes e sanitizantes
  ├── Materiais de limpeza (panos, esponjas)
  └── Higiene pessoal (sabonete, papel)

Gás e combustível
  └── GLP (gás de cozinha)

Papelaria e escritório
  └── Material de escritório

Outros
  └── Sem categoria definida
```

### Quando criar nova categoria vs encaixar na existente

**Crie nova categoria quando:**
- Há 5 ou mais produtos que não se encaixam em nenhuma existente
- O grupo tem controle operacional distinto (gás tem pedido diferente de bebidas)
- A categoria ajuda na visualização rápida do Dashboard

**Encaixe na existente quando:**
- É um produto novo de um tipo já existente
- Há menos de 3 produtos daquele tipo
- A diferença é apenas de marca ou embalagem

**Regra prática:** se você está em dúvida entre criar ou encaixar, encaixe. Categorias demais prejudicam a usabilidade. Um catálogo com 200 produtos funciona bem com 8–12 categorias.

### Sobre os exemplos específicos

| Produto | Categoria recomendada | Subcategoria |
|---|---|---|
| Azeite de marcas diferentes | Secos / mercearia | Óleos e gorduras |
| Arroz | Secos / mercearia | Arroz e grãos |
| Molhos (shoyu, mostarda, etc.) | Secos / mercearia | Molhos e condimentos |
| Sachês | Secos / mercearia | Sachês e temperos |
| Conservas | Secos / mercearia | Conservas e enlatados |
| Carnes bovinas | Câmara fria | Carnes bovinas |
| Frios | Câmara fria | Frios e embutidos |
| Queijos | Câmara fria | Queijos e laticínios |
| Cervejas 600ml | Bebidas | Cervejas garrafa |
| Cervejas 1L | Bebidas | Cervejas garrafa |
| Refrigerantes | Bebidas | Refrigerantes |
| Limpeza | Limpeza e higiene | (subcategoria adequada) |
| Descartáveis | Descartáveis e embalagens | (subcategoria adequada) |
| Papelaria | Papelaria e escritório | Material de escritório |
| Gás | Gás e combustível | GLP |

---

## 4. Como o pacote enviado ao ChatGPT deve ser melhorado?

### Estado atual

O pacote atual tem três blocos:
1. Comando (instrução do que fazer)
2. Contexto do sistema (restaurante, data, regras gerais)
3. Produtos desconhecidos da NF-e (lista de itens não reconhecidos)

Isso é suficiente para o ChatGPT *adivinhar*, mas insuficiente para ele *acertar com consistência*. Sem saber o que já existe no sistema, o ChatGPT inventa categorias, duplica produtos com nomes diferentes e cria embalagens inconsistentes.

### Blocos recomendados para o pacote melhorado

#### Bloco 1 — Instruções (SISTEMA / `system`)
Regras fixas do que o ChatGPT pode e não pode fazer. Deve incluir:
- Formato obrigatório da resposta (JSON schema_version 1.1)
- O que fazer quando não tem certeza (marcar `confianca: "BAIXA"`)
- Proibições explícitas (não inventar ficha técnica, não inventar embalagem sem evidência)
- Regra de prioridade de nomes (cardápio > nome comercial > NF-e normalizada)

#### Bloco 2 — Contexto do restaurante
```json
{
  "restaurante": "Araçá Grill",
  "tipo": "restaurante a la carte com delivery",
  "regras_nomenclatura": [
    "Preferir nome comercial claro",
    "Cervejas: incluir marca, tipo (pilsen/IPA/etc) e volume",
    "Não abreviar volume: escrever 600ml, não 600",
    "Não usar nome da NF-e como nome_interno"
  ]
}
```

#### Bloco 3 — Categorias existentes (NOVO)
Lista completa das categorias e subcategorias do banco. Isso impede o ChatGPT de criar `Bebidas Alcoolicas` quando já existe `Bebidas > Cervejas garrafa`.

```json
{
  "categorias_existentes": [
    {"id": "CAT01", "nome": "Bebidas", "subcategorias": ["Cervejas garrafa", "Refrigerantes", ...]},
    ...
  ]
}
```

#### Bloco 4 — Produtos já confirmados (NOVO, resumido)
Não enviar todos os produtos — isso esgotaria o contexto. Enviar apenas os 50 mais recentes ou os da mesma categoria dos itens desconhecidos. O objetivo é dar exemplos de nomenclatura e evitar duplicação.

```json
{
  "produtos_confirmados_amostra": [
    {"nome_interno": "Cerveja Heineken Garrafa 600ml", "categoria": "Bebidas", "subcategoria": "Cervejas garrafa"},
    {"nome_interno": "Arroz tipo 1 Tio João 5kg", "categoria": "Secos / mercearia", "subcategoria": "Arroz e grãos"}
  ]
}
```

#### Bloco 5 — Produtos de venda do cardápio (NOVO, filtrado)
Enviar apenas os produtos de venda que têm correlação com os itens desconhecidos. Para uma NF-e de bebidas, enviar o cardápio de bebidas. Para uma NF-e de carnes, não enviar bebidas.

```json
{
  "cardapio_referencia": [
    {"nome_cardapio": "Cerveja Heineken 600ml", "grupo": "Bebidas", "preco_venda": 18.00},
    {"nome_cardapio": "Refrigerante Coca-Cola Lata", "grupo": "Bebidas", "preco_venda": 8.00}
  ],
  "instrucao": "Use o cardápio apenas para nomear bebidas prontas. Não crie ficha técnica para nenhum prato."
}
```

#### Bloco 6 — Itens desconhecidos da NF-e (atual, melhorado)
Manter o formato atual, mas adicionar: CNPJ do fornecedor, razão social do fornecedor, data da NF-e. Isso permite que o ChatGPT perceba padrões por fornecedor.

```json
{
  "fornecedor": {"cnpj": "00000000000000", "razao_social": "Ambev S/A"},
  "itens_desconhecidos": [
    {
      "descricao_original_nf": "CERV HEINEKEN PIL 0.600 GFA CX24",
      "codigo_produto_nf": "01234",
      "codigo_barras": "7896045503852",
      "quantidade_nf": 2,
      "unidade_nf": "CX",
      "valor_unitario": 72.00
    }
  ]
}
```

#### Bloco 7 — Aliases e mapeamentos existentes (NOVO, resumido)
Enviar apenas os aliases e mapeamentos do mesmo fornecedor. Isso evita que o ChatGPT crie um alias que já existe.

### Blocos que NÃO devem ser incluídos (agora)
- Embalagens completas de todos os produtos (muito volume, pouco ganho)
- Histórico de movimentações
- Preços de custo históricos
- Fichas técnicas (não existem ainda)

---

## 5. Como o ChatGPT deveria usar a lista de produtos vendidos?

### A lógica proposta está correta com um ajuste

Sua lógica está 95% correta. O único risco é a palavra "tentar seguir o nome do cardápio" — sem uma regra clara de quando seguir e quando não seguir, o ChatGPT pode usar o nome do cardápio de forma literal onde ele não cabe.

### Regras recomendadas para o ChatGPT (no bloco de instruções)

```
REGRAS PARA USO DO CARDÁPIO:

1. BEBIDAS PRONTAS (lata, garrafa, long neck, dose):
   - SE o item da NF-e corresponde a uma bebida do cardápio:
     → Use o nome do cardápio como base para nome_interno
     → Adicione o volume/apresentação se não estiver claro
     → Exemplo: cardápio "Cerveja Heineken 600ml" → nome_interno "Cerveja Heineken Garrafa 600ml"
   - O preço de venda do cardápio é informação auxiliar para futura análise de CMV
     → NÃO altere quantidades, embalagens ou valores de estoque com base nisso

2. PRATOS, PORÇÕES, LANCHES, SUCOS PREPARADOS, DRINKS:
   - NÃO crie produtos de estoque para estes
   - NÃO invente insumos (queijo, carne, etc.) com base no nome do prato
   - Se a NF-e trouxer insumos (queijo, carne), nomeie-os corretamente como insumo
   - NÃO tente vincular insumo ao prato

3. CHOPP:
   - Estoque controlado em litros (barril)
   - NÃO criar produto "Chopp 300ml" no estoque
   - O cardápio pode ter "Chopp 300ml" mas isso é produto de venda, não estoque

4. QUANDO O CARDÁPIO NÃO AJUDA:
   - Se o item da NF-e não tem equivalente no cardápio, nomeie pelo nome comercial do produto
   - Não force um nome de cardápio onde não existe correspondência clara
```

### Sobre preço de venda para CMV de bebidas

Faz sentido guardar o preço de venda junto com o vínculo produto de estoque ↔ produto de cardápio, **mas como campo informativo**, nunca como dado que alimenta o cálculo de estoque. O Super Ajudante hoje não calcula CMV — quando isso for implementado para bebidas, o preço já estará disponível.

---

## 6. Embalagens e fatores

### O problema central

Descrições de NF-e como `ARROZ 6X5KG` ou `CERVEJA CX24` combinam o produto com a embalagem de entrada numa mesma string. O sistema precisa separar:
- **O produto** (arroz tipo 1, marca X)
- **A embalagem de entrada** (fardo com 6 pacotes de 5kg)
- **A unidade de estoque** (kg)

### Tabela de decisão: quando confirmar, perguntar ou marcar dúvida

| Situação | Ação do sistema | Exemplo |
|---|---|---|
| Padrão numérico claro (`CX24`, `CX12`, `6X5KG`) | Confirmar fator automaticamente e marcar `confianca: "ALTA"` | CERVEJA CX24 → fator 24, unidade UN |
| Abreviatura comum (`DZ`) | Confirmar com aviso (`DZ = 12`) | CERVEJA DZ → fator 12 |
| Padrão ambíguo (`PAC6`) | Perguntar: "PAC6 = pacote com 6 unidades?" | REFRIGERANTE PAC6 |
| Embalagem mista (`8CXC192UN`) | Marcar dúvida, mostrar opções | CATCHUP SACHE 8CXC192UN |
| Peso total sem divisão clara (`CX 6,8KG`) | Marcar dúvida: unidade é kg ou caixa inteira? | PRESUNTO CX 6,8KG |
| Produto completamente desconhecido | Marcar `confianca: "BAIXA"`, não importar | Código sem descrição útil |

### Padrões que o sistema pode reconhecer automaticamente

```
CX(\d+)        → caixa com N unidades
(\d+)X(\d+)KG  → fardo com N pacotes de M kg cada
DZ             → dúzia (fator 12)
GFA            → garrafa (unidade = UN)
KG             → quilograma
LT ou L        → litro
UN ou PC       → unidade
FD             → fardo (perguntar quantas unidades)
```

### Como mostrar isso de forma simples para o usuário

Proposta de interface para confirmação de embalagem:

```
┌─────────────────────────────────────────────────┐
│ ARROZ TIÃO JOÃO 6X5KG                          │
│                                                  │
│ Produto identificado: Arroz Tio João 5kg        │
│ Embalagem de compra: Fardo 6 pacotes            │
│ Unidade de estoque: KG                           │
│ Fator: 1 fardo = 30 kg                          │
│                                                  │
│ Confiança: ● ALTA (padrão numérico claro)       │
│                                                  │
│ [✅ Confirmar]  [✏️ Ajustar]                     │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│ CATCHUP SACHE 8CXC192UN                         │
│                                                  │
│ Produto identificado: Sachê de Ketchup          │
│ ⚠️  Embalagem com dúvida:                       │
│     8 caixas × 192 unidades = 1.536 sachês?     │
│                                                  │
│ Confiança: ● BAIXA (padrão complexo)            │
│                                                  │
│ [Confirmar 1.536 un]  [Outro fator]  [Pular]   │
└─────────────────────────────────────────────────┘
```

### Exemplo completo: Arroz

```
Compra:      Fardo 6×5kg  → 1 embalagem de entrada = 30kg
Estoque:     Kg (unidade de inventário e de consumo)
Saída:       Pode ser por pacote 5kg (fator 5) ou solto em kg (fator 1)
Conversão:   Sistema guarda fator automaticamente na tabela Embalagens
Inventário:  Usuário conta em kg ou em pacotes — sistema converte
```

---

## 7. Pesquisa na internet

### Faz sentido? Sim, com limites muito claros.

A pesquisa na internet resolve um problema real: o ChatGPT às vezes não conhece uma marca regional ou um produto muito específico. A internet pode confirmar: "esse código de barras é qual produto?"

### O que pode ser pesquisado

- **EAN/código de barras** → consulta em bases como Open Food Facts, Cosmos, Barcodelookup
  - Retorna: nome do produto, marca, peso/volume, fabricante
  - Confiabilidade: alta para produtos industrializados
- **Nome do produto + marca** → Google/Bing para confirmar apresentação (garrafa, lata, etc.)
- **CNPJ do fornecedor** → confirmar razão social e ramo de atividade

### O que NÃO pode ser confirmado pela internet

- **Fator de embalagem específico de uma NF-e** → a NF-e pode ter uma embalagem customizada do fornecedor que não existe online
- **Preço de custo** → nunca usar preço de internet como custo de compra
- **Código do produto na NF-e** → é código interno do fornecedor, não existe na internet
- **Equivalência de insumos** → internet não sabe a receita do Araçá Grill

### Como evitar que invente embalagem/fator

Regra no prompt: **"Se pesquisou na internet e encontrou o produto mas não encontrou informação de embalagem, responda apenas com o que encontrou e marque fator como `null` e `confianca: "MEDIA"`"**.

Nunca aceitar fator inferido de pesquisa de internet sem validação do usuário.

### Como registrar a fonte auxiliar

No JSON, adicionar campo `fonte_auxiliar` no produto:
```json
{
  "nome_interno": "Cerveja Heineken Garrafa 600ml",
  "fonte_auxiliar": {
    "tipo": "internet",
    "url_referencia": "openfoodfacts.org/produto/...",
    "codigo_barras_confirmado": "7896045503852"
  },
  "confianca": "MEDIA"
}
```

### Como marcar confiança com base na fonte

| Fonte | Confiança máxima |
|---|---|
| Mapeamento CNPJ+código (já existia) | ALTA |
| EAN encontrado na NF-e + confirmado online | ALTA |
| Nome reconhecido + cardápio confirmou | ALTA |
| Nome reconhecido, embalagem deduzida do padrão | MEDIA |
| Nome reconhecido, embalagem confirmada via internet | MEDIA |
| Nome parcialmente reconhecido, sem confirmação | BAIXA |
| Produto completamente desconhecido | BAIXA |

---

## 8. Nível de confiança

### Por que implementar?

Hoje o sistema importa ou rejeita. Sem gradação, o usuário ou revisa tudo (trabalhoso) ou aceita tudo (arriscado). O nível de confiança permite:
- Importar automaticamente os ALTOS
- Fila de revisão para os MÉDIOS
- Bloqueio para os BAIXOS

### Definição de cada nível para o Super Ajudante

#### ALTA — importação automática permitida
Todos os critérios abaixo satisfeitos:
- Nome do produto claro e sem ambiguidade
- Categoria identificada com certeza
- Embalagem com fator numérico explícito na NF-e (`CX24`, `6X5KG`)
- EAN confirmado via código de barras ou mapeamento CNPJ+código existente
- Nenhum campo obrigatório em branco

**Ação:** importar e criar mapeamento automaticamente. Notificar o usuário na tela de auditoria.

#### MEDIA — revisão recomendada antes de importar
Pelo menos um critério com incerteza:
- Embalagem deduzida por padrão (não explícita)
- Categoria inferida (não confirmada)
- Produto reconhecido por alias ou descrição normalizada (não por código)
- Preço muito diferente do histórico (possível erro de digitação do fornecedor)

**Ação:** mostrar na fila de revisão com o que foi preenchido e o campo de dúvida destacado. Usuário confirma ou corrige. Não bloquear totalmente.

#### BAIXA — não importar sem revisão manual
Qualquer um dos critérios abaixo:
- Nome ambíguo (pode ser dois produtos diferentes)
- Embalagem desconhecida e não reconhecida por padrão
- Categoria não identificada
- EAN ausente e código do produto sem mapeamento
- Produto claramente composto (parece precisar de ficha técnica)

**Ação:** bloquear importação automática. Colocar na fila de revisão com campo de motivo. Usuário decide: criar produto, ignorar, ou enviar de volta ao ChatGPT com mais contexto.

### Como o sistema deve agir por nível

```
NF-e importada → reconhecimento roda
         │
         ├── Produto já reconhecido? → Lança movimento normalmente
         │
         └── Produto desconhecido? → Vai para esteira do ChatGPT
                    │
                    ├── ChatGPT retorna ALTA   → Importa + cria mapeamento
                    │                            Notifica na tela de auditoria
                    │
                    ├── ChatGPT retorna MEDIA  → Fila de revisão
                    │                            Usuário vê e confirma
                    │
                    └── ChatGPT retorna BAIXA  → Fila de bloqueados
                                                 Usuário decide o que fazer
```

---

## 9. JSON final — evolução para schema_version 1.1

### Recomendação: evoluir para 1.1 com compatibilidade retroativa

O schema 1.0 atual funciona, mas não suporta confiança, subcategoria, tipo de produto ou vínculo com cardápio. A evolução para 1.1 é segura se:
1. O importador verificar `schema_version` antes de processar
2. Campos novos forem todos opcionais (não quebram importação de 1.0)
3. O exportador do ChatGPT sempre gerar 1.1 daqui para frente

### Schema 1.1 proposto

```json
{
  "schema_version": "1.1",
  "tipo": "catalogo_revisado_gpt",
  "origem": "chatgpt",
  "restaurante": "Araçá Grill",
  "gerado_em": "2026-06-02T14:00:00",
  "fornecedor_cnpj": "00000000000000",

  "produtos_confirmados": [
    {
      "nome_interno": "Cerveja Heineken Garrafa 600ml",
      "descricao_original_nf": "CERV HEINEKEN PIL 0.600 GFA CX24",
      "codigo_produto_nf": "01234",
      "codigo_barras": "7896045503852",
      "categoria": "Bebidas",
      "subcategoria": "Cervejas garrafa",       // NOVO 1.1
      "tipo_produto": "bebida_pronta",           // NOVO 1.1 (bebida_pronta | insumo | descartavel | limpeza | outros)
      "unidade_estoque": "UN",
      "confianca": "ALTA",                       // NOVO 1.1 (ALTA | MEDIA | BAIXA)
      "confianca_motivo": "EAN confirmado + padrão CX24 explícito",  // NOVO 1.1
      "produto_venda_relacionado": "Cerveja Heineken 600ml",         // NOVO 1.1 (nome do cardápio)
      "preco_venda_referencia": 18.00,           // NOVO 1.1 (informativo, não altera estoque)
      "fonte_auxiliar": null                     // NOVO 1.1
    }
  ],

  "embalagens_confirmadas": [
    {
      "nome_interno": "Cerveja Heineken Garrafa 600ml",
      "descricao": "Caixa 24 unidades",
      "fator": 24,
      "tipo_embalagem": "entrada",               // NOVO 1.1 (entrada | saida | inventario)
      "confianca": "ALTA",                       // NOVO 1.1
      "confianca_motivo": "Padrão CX24 explícito na NF-e"
    }
  ],

  "mapeamentos_confirmados": [
    {
      "cnpj_fornecedor": "00000000000000",
      "codigo_produto_nf": "01234",
      "nome_interno": "Cerveja Heineken Garrafa 600ml",
      "confianca": "ALTA"                        // NOVO 1.1
    }
  ],

  "aliases_confirmados": [
    {
      "alias": "CERV HEINEKEN PIL 0.600 GFA CX24",
      "nome_interno": "Cerveja Heineken Garrafa 600ml"
    }
  ],

  "itens_com_duvida": [
    {
      "descricao_original_nf": "CATCHUP SACHE 8CXC192UN",
      "codigo_produto_nf": "05678",
      "motivo_duvida": "Embalagem 8CXC192UN é ambígua — pode ser 1.536 ou 192 unidades",
      "sugestao_nome": "Sachê de Ketchup",
      "sugestao_categoria": "Secos / mercearia",
      "sugestao_subcategoria": "Sachês e temperos",
      "confianca": "BAIXA"                       // NOVO 1.1
    }
  ],

  "observacoes": [
    "Produto PRESUNTO CX 6,8KG ignorado — pode ser peso total da caixa ou peso unitário. Revisar manualmente."
  ]
}
```

### Compatibilidade retroativa

O importador atual (schema 1.0) deve continuar funcionando. A regra é simples:

```javascript
if (json.schema_version === '1.0') {
  // processa como antes, ignora campos novos
}
if (json.schema_version === '1.1') {
  // processa com confiança, subcategoria, tipo_produto, etc.
}
```

Campos novos do 1.1 são todos opcionais. Um JSON 1.1 sem `subcategoria` importa normalmente.

---

## 10. O que deve mudar no aplicativo?

### Banco / tabelas

| Mudança | Prioridade | Complexidade |
|---|---|---|
| Adicionar coluna `subcategoria_id` em `Produtos` | Alta | Baixa |
| Criar tabela `Subcategorias` (id, nome, categoria_id) | Alta | Baixa |
| Adicionar coluna `tipo_produto` em `Produtos` | Alta | Baixa |
| Adicionar coluna `confianca` em `Produtos` | Média | Baixa |
| Adicionar tabela `Produtos_Venda` para cardápio ChefWeb | Média | Média |
| Adicionar coluna `id_produto_venda` em `Produtos` (vínculo) | Baixa | Média |
| Adicionar coluna `tipo_embalagem` em `Embalagens` | Média | Baixa |

### Importador de JSON

| Mudança | Prioridade |
|---|---|
| Verificar `schema_version` antes de processar | Alta |
| Importar `subcategoria` se informada | Alta |
| Importar `confianca` e salvar no produto | Alta |
| Importar `tipo_produto` | Alta |
| Itens com `confianca: "BAIXA"` → fila de revisão, não importar direto | Alta |
| Importar `tipo_embalagem` nas embalagens | Média |
| Importar `produto_venda_relacionado` para futuro vínculo | Baixa |

### Exportador do pacote para ChatGPT

| Mudança | Prioridade |
|---|---|
| Incluir categorias e subcategorias existentes | Alta |
| Incluir amostra de produtos confirmados (mesmo fornecedor ou mesma categoria) | Alta |
| Incluir cardápio filtrado por tipo (só bebidas quando NF-e for de bebidas) | Média |
| Incluir CNPJ e razão social do fornecedor | Alta |
| Instruir ChatGPT sobre schema 1.1 | Alta |

### Tela de produto

| Mudança | Prioridade |
|---|---|
| Adicionar campo `subcategoria` (select dependente de categoria) | Alta |
| Adicionar campo `tipo_produto` (select: insumo, bebida pronta, descartável...) | Alta |
| Exibir `confianca` como badge colorido | Média |
| Adicionar campo `produto_venda_relacionado` (busca no cardápio) | Baixa |

### Tela de categorias

| Mudança | Prioridade |
|---|---|
| Criar CRUD de subcategorias por categoria | Alta |
| Exibir contagem de produtos por subcategoria | Média |

### Tela de treinamento (esteira ChatGPT)

| Mudança | Prioridade |
|---|---|
| Mostrar nível de confiança de cada item retornado | Alta |
| Fila separada: ALTA (importa direto), MEDIA (revisão), BAIXA (bloqueados) | Alta |
| Botão "revisar" por item individual | Alta |
| Importar cardápio ChefWeb (CSV ou manual) | Média |

### Tela de auditoria

| Mudança | Prioridade |
|---|---|
| Criar tela/seção de auditoria para itens importados automaticamente (confiança ALTA) | Alta |
| Registrar quem importou, quando e com qual confiança | Média |

### Tela de inventário

| Mudança | Prioridade |
|---|---|
| Filtrar por subcategoria além de categoria | Média |
| Mostrar `tipo_produto` como informação auxiliar | Baixa |

### Tela de saída

Não requer mudanças prioritárias agora. Ficha técnica é fase futura.

---

## 11. Ordem ideal de implementação

Abaixo a sequência recomendada, priorizando o que já está gerando dor e evitando quebrar o que funciona.

### Fase 1 — Estabilidade (fazer primeiro, antes de qualquer expansão)

1. **Corrigir bugs conhecidos** (produto_teste, busca por código de barras no inventário) ✅ *já feito*
2. **Verificar `schema_version` no importador** — garante que futuras versões do JSON não quebrem a importação atual
3. **Corrigir possíveis duplicações** no reconhecimento — auditar se há produtos duplicados no banco

### Fase 2 — Subcategorias e tipo de produto

4. **Criar tabela `Subcategorias`** e coluna em `Produtos`
5. **Adicionar `tipo_produto`** em Produtos (simples: bebida_pronta, insumo, descartável, limpeza, outros)
6. **Criar CRUD de subcategorias** na tela de configuração/categorias
7. **Atualizar tela de produto** para incluir subcategoria e tipo

### Fase 3 — Melhoria do pacote ChatGPT e schema 1.1

8. **Incluir categorias e subcategorias no pacote** exportado
9. **Incluir amostra de produtos confirmados** no pacote
10. **Atualizar instrução do ChatGPT** para schema 1.1 e regras de confiança
11. **Atualizar importador** para processar `confianca` e `subcategoria`
12. **Implementar fila de confiança** na tela de treinamento (ALTA/MÉDIA/BAIXA)

### Fase 4 — Cardápio ChefWeb

13. **Importar cardápio ChefWeb** (upload CSV ou lançamento manual)
14. **Incluir cardápio filtrado** no pacote do ChatGPT
15. **Criar vínculos** produto de estoque ↔ produto de venda para bebidas prontas

### Fase 5 — Futuro (não implementar agora)

16. Ficha técnica de pratos e porções
17. CMV automático de pratos
18. Ficha técnica de drinks e coquetéis
19. Integração direta com ChefWeb/API
20. Pesquisa automática por EAN na internet

---

## 12. Riscos

### Risco 1 — Misturar produto de venda com produto de estoque
**Como acontece:** ChatGPT cria "Cerveja Heineken 600ml" (nome do cardápio) no estoque em vez de "Cerveja Heineken Garrafa 600ml" (nome do estoque). Ou pior: cria o prato como produto de estoque.
**Como evitar:** campo obrigatório `tipo_produto` no produto. Instrução explícita no prompt do ChatGPT: "nunca crie produto de estoque com nome de prato ou porção".

### Risco 2 — Inventar embalagem
**Como acontece:** NF-e traz `PRESUNTO CX 6,8KG` e o ChatGPT chuta fator 6 porque viu "CX".
**Como evitar:** qualquer fator não confirmado por padrão numérico explícito deve ter `confianca: "MEDIA"` ou `"BAIXA"`. Usuário sempre confirma o fator antes de importar embalagem MEDIA/BAIXA.

### Risco 3 — Usar categoria errada
**Como acontece:** sem lista de categorias no pacote, ChatGPT cria "Bebidas Alcoólicas" quando existe "Bebidas > Cervejas garrafa".
**Como evitar:** sempre incluir lista completa de categorias e subcategorias existentes no pacote.

### Risco 4 — Duplicar produto
**Como acontece:** "Arroz Tio João 5kg" e "ARROZ TJ 5KG" viram dois produtos diferentes.
**Como evitar:** (a) normalização de nome antes de criar; (b) busca por EAN antes de criar; (c) mostrar "produto similar encontrado" antes de criar novo.

### Risco 5 — Criar categorias demais
**Como acontece:** ChatGPT cria "Cervejas Premium", "Cervejas Artesanais", "Cervejas Importadas" separadamente quando todas poderiam ser subcategoria de "Bebidas".
**Como evitar:** somente o usuário cria categorias e subcategorias. O ChatGPT escolhe dentro das existentes. Se nenhuma encaixar, sugere uma nova e marca para aprovação.

### Risco 6 — Usar preço de venda errado no CMV
**Como acontece:** ChatGPT pega preço de venda do cardápio e usa como custo no estoque.
**Como evitar:** `preco_venda_referencia` é campo informativo, nunca alimenta `custo_unitario` ou `custo_medio`. O importador deve ignorá-lo para cálculos.

### Risco 7 — Internet inventar dados
**Como acontece:** ChatGPT pesquisa "CERVEJA XYZ" e encontra um produto diferente com nome similar, confirma EAN errado.
**Como evitar:** pesquisa por EAN é mais segura que por nome. Toda confirmação por internet deve ter `confianca: "MEDIA"` no mínimo. Nunca `"ALTA"` só por internet sem confirmação do EAN.

### Risco 8 — Importar produto com confiança baixa automaticamente
**Como acontece:** importador não verifica confiança e importa tudo.
**Como evitar:** regra rígida no código: `if (confianca === 'BAIXA') → não importar, adicionar à fila de revisão`. Sem exceções.

---

## 13. Conclusão

### Qual é a arquitetura ideal?

```
Cardápio ChefWeb (produtos de venda)
    │
    ↓ vínculo direto (só bebidas prontas)
Produtos de estoque                    ←── NF-e
    │       │                               │
    │       └── Embalagens de entrada       │
    │           (fator de compra)           │
    │                                       │
    ↓                                       ↓
Movimentações de estoque           Mapeamentos/aliases
    │
    ↓
Inventário (contagem periódica)
    │
    ↓
[Futuro] Fichas técnicas → CMV de pratos
```

### O que implementar primeiro

1. Subcategorias e tipo de produto (estrutura que tudo depende)
2. Melhoria do pacote do ChatGPT (categorias existentes + amostras confirmadas)
3. Fila de confiança na tela de treinamento (ALTA/MÉDIA/BAIXA)
4. Importação do cardápio ChefWeb para uso como referência de nomes

### O que NÃO implementar agora

- Ficha técnica de pratos (depende de definição operacional do restaurante)
- CMV automático de comida (depende de ficha técnica)
- Pesquisa automática na internet (ganho pequeno, risco médio)
- Integração direta com ChefWeb/API (manual por CSV é suficiente)
- Vínculo automático produto de venda ↔ insumo (é ficha técnica, fase futura)

### Como manter simples para o usuário do Araçá Grill

O usuário não precisa conhecer a arquitetura. Ele precisa ver:
- **"Produtos prontos para importar"** (confiança ALTA — só confirmar)
- **"Produtos para revisar"** (confiança MÉDIA — campo com dúvida destacado)
- **"Produtos bloqueados"** (confiança BAIXA — motivo explicado em linguagem simples)

Máximo de 3 cliques para qualquer ação. Nunca mostrar "schema_version", "tipo_produto" ou "confianca" como texto técnico — usar ícones e linguagem do restaurante.

### Como fazer o ChatGPT trabalhar melhor sem corrigir tudo manualmente

O ChatGPT erra menos quando:
1. **Tem contexto suficiente** — categorias existentes, produtos similares, nome do fornecedor
2. **Tem regras explícitas** — o que pode e não pode fazer (especialmente sobre fichas técnicas)
3. **Tem exemplos** — amostra de como os produtos foram nomeados no passado
4. **Tem permissão para expressar dúvida** — `confianca: "BAIXA"` é resposta válida, não é falha

A maior redução de trabalho manual vem de duas coisas simples: incluir as categorias existentes no pacote (elimina categoria errada) e incluir o cardápio de bebidas (melhora nome de cervejas, refrigerantes e doses). Essas duas mudanças sozinhas devem reduzir revisão manual em 60–70% para NF-es de bebidas.

---

*Documento gerado para leitura técnica. Nenhum código, banco ou configuração foi alterado.*
