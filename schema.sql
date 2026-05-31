-- Super Ajudante — Schema Supabase
-- Execute no SQL Editor do seu projeto Supabase.

create table if not exists categorias (
  id_categoria   text primary key,
  nome_categoria text,
  descricao      text,
  ativo          text default 'SIM'
);

create table if not exists fornecedores (
  id_fornecedor      text primary key,
  razao_social       text,
  nome_fantasia      text,
  cnpj               text unique,
  inscricao_estadual text,
  telefone           text,
  email              text,
  endereco           text,
  numero             text,
  bairro             text,
  cidade             text,
  estado             text,
  cep                text,
  contato            text,
  observacoes        text,
  ativo              text default 'SIM'
);

create table if not exists produtos (
  id_produto              text primary key,
  cnpj_fornecedor         text,
  codigo_produto_nf       text,
  codigo_barras           text,
  descricao_original_nf   text,
  nome_interno            text,
  categoria_id            text,
  fornecedor_principal_id text,
  unidade_compra          text,
  unidade_estoque         text,
  quantidade_por_embalagem numeric,
  fator_conversao         numeric default 1,
  estoque_minimo          numeric default 0,
  estoque_atual           numeric default 0,
  ultimo_custo_unitario   numeric default 0,
  custo_medio             numeric default 0,
  ativo                   text default 'SIM',
  observacoes             text,
  criado_em               text,
  atualizado_em           text
);

create table if not exists notas_fiscais (
  id_nota               text primary key,
  chave_nfe             text unique,
  numero_nota           text,
  serie                 text,
  modelo                text,
  fornecedor_id         text,
  cnpj_fornecedor       text,
  data_emissao          text,
  data_entrada          text,
  natureza_operacao     text,
  valor_produtos        numeric,
  valor_frete           numeric,
  valor_desconto        numeric,
  valor_outras_despesas numeric,
  valor_total_nota      numeric,
  status_api_meu_danfe  text,
  status_importacao     text,
  xml_original          text,
  pdf_base64            text,
  observacoes           text,
  criado_em             text
);

create table if not exists itens_nota (
  id_item                   text primary key,
  id_nota                   text,
  numero_item               text,
  id_produto                text,
  cnpj_fornecedor           text,
  codigo_produto_nf         text,
  codigo_barras             text,
  descricao_original        text,
  ncm                       text,
  cfop                      text,
  unidade_nf                text,
  quantidade_nf             numeric,
  valor_unitario_nf         numeric,
  valor_total_nf            numeric,
  unidade_tributavel        text,
  quantidade_tributavel     numeric,
  valor_unitario_tributavel numeric,
  fator_conversao           numeric,
  quantidade_estoque        numeric,
  custo_unitario_estoque    numeric,
  categoria_id              text,
  status_conferencia        text
);

create table if not exists movimentacoes_estoque (
  id_movimentacao text primary key,
  data            text,
  id_produto      text,
  tipo            text,
  quantidade      numeric,
  custo_unitario  numeric,
  valor_total     numeric,
  origem          text,
  id_nota         text,
  motivo          text,
  usuario         text,
  observacao      text
);

create table if not exists contas_pagar (
  id_conta        text primary key,
  id_nota         text,
  fornecedor_id   text,
  numero_parcela  text,
  descricao       text,
  valor           numeric,
  data_emissao    text,
  vencimento      text,
  forma_pagamento text,
  status          text default 'ABERTO',
  data_pagamento  text,
  observacao      text,
  criado_em       text,
  atualizado_em   text
);

create table if not exists configuracoes (
  chave    text primary key,
  valor    text,
  descricao text
);

insert into configuracoes (chave, valor, descricao) values
  ('CNPJ_RESTAURANTE',         '',     'CNPJ do restaurante para validacao das notas'),
  ('LIMITE_CONSULTAS_SEGUNDO',  '2',    'Maximo de consultas por segundo a API Meu Danfe'),
  ('MAX_TENTATIVAS_NFE',        '5',    'Maximo de tentativas por chave NF-e'),
  ('INTERVALO_TENTATIVAS_MS',   '1000', 'Intervalo minimo entre tentativas por chave (ms)')
on conflict (chave) do nothing;
