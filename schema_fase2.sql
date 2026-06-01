-- Super Ajudante — Fase 2 (sem IA por API)
-- Rode no SQL Editor do seu projeto Supabase.
-- Tudo aqui e ADITIVO e SEGURO: nao apaga tabelas, nao remove colunas,
-- nao quebra dados existentes. Pode rodar mais de uma vez sem problema.

-- 1) Marca quais produtos ja foram CONFIRMADOS pelo usuario.
--    Produtos vindos da NF-e sem curadoria ficam 'NAO' e aparecem como
--    "produtos desconhecidos" para exportar ao ChatGPT.
alter table produtos add column if not exists confirmado text default 'NAO';

-- 2) Embalagens: um produto pode ter VARIAS embalagens, cada uma com seu fator.
--    Ex.: Coca 2L -> Unidade (1), Caixa 6 UN (6). Long neck -> Caixa 24 UN (24).
create table if not exists embalagens (
  id_embalagem      text primary key,
  id_produto        text,
  descricao         text,          -- "Caixa 6 UN"
  sigla             text,          -- "CX6"
  fator             numeric default 1,   -- quantas unidades-base vem dentro
  unidade_base      text,          -- "UN", "L", "KG"...
  permite_entrada   text default 'SIM',
  permite_saida     text default 'SIM',
  permite_inventario text default 'SIM',
  padrao_entrada    text default 'NAO',
  padrao_saida      text default 'NAO',
  padrao_inventario text default 'NAO',
  ativo             text default 'SIM',
  criado_em         text,
  atualizado_em     text
);
create index if not exists idx_embalagens_produto on embalagens (id_produto);

-- 3) Produto x Fornecedor: varios codigos/CNPJs podem apontar para 1 produto interno.
--    Chave principal de reconhecimento: cnpj_fornecedor + codigo_produto_nf.
--    Fallback: cnpj_fornecedor + descricao_normalizada.
create table if not exists produto_fornecedor (
  id_pf                  text primary key,
  id_produto             text,
  cnpj_fornecedor        text,
  nome_fornecedor        text,
  codigo_produto_nf      text,
  ean                    text,
  descricao_original     text,
  descricao_normalizada  text,
  unidade_nf             text,
  confirmado_pelo_usuario text default 'NAO',
  origem_confirmacao     text,     -- 'NFE' | 'MANUAL' | 'CHATGPT'
  vezes_utilizado        numeric default 0,
  ultima_utilizacao      text,
  ativo                  text default 'SIM',
  criado_em              text,
  atualizado_em          text
);
create index if not exists idx_pf_chave on produto_fornecedor (cnpj_fornecedor, codigo_produto_nf);
create index if not exists idx_pf_produto on produto_fornecedor (id_produto);

-- 4) Aliases / apelidos: descricoes alternativas, nome de cardapio, variacoes de escrita.
create table if not exists aliases_produto (
  id_alias   text primary key,
  id_produto text,
  alias      text,
  origem     text,            -- 'NFE' | 'CARDAPIO' | 'MANUAL' | 'CHATGPT'
  ativo      text default 'SIM',
  criado_em  text
);
create index if not exists idx_alias_produto on aliases_produto (id_produto);

-- 5) Historico/auditoria das importacoes de JSON revisado pelo ChatGPT.
create table if not exists treino_importacoes (
  id_importacao      text primary key,
  criado_em          text,
  origem             text,
  resumo             text,
  json_original      text,
  status             text,
  produtos_criados   numeric default 0,
  mapeamentos_criados numeric default 0,
  embalagens_criadas numeric default 0,
  aliases_criados    numeric default 0,
  conflitos          numeric default 0,
  erros              text
);
