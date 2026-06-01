-- schema_fase4.sql
-- Esteira de Treinamento de NF-e
-- Idempotente. Rodar no Supabase: Dashboard → SQL Editor → New Query

create table if not exists treino_fila (
  id_fila text primary key,
  chave_nfe text not null,
  numero_nota text,
  data_emissao text,
  cnpj_fornecedor text,
  nome_fornecedor text,
  status text default 'OK',
  criado_em text,
  processado_em text,
  total_itens int default 0,
  total_reconhecidos int default 0,
  total_desconhecidos int default 0,
  total_duvidas int default 0,
  erro text
);

create table if not exists treino_itens (
  id_item_fila text primary key,
  id_fila text,
  chave_nfe text,
  cnpj_fornecedor text,
  nome_fornecedor text,
  codigo_produto_nf text,
  ean text,
  descricao_original_nfe text,
  descricao_normalizada text,
  unidade_nfe text,
  quantidade_nfe numeric,
  valor_total numeric,
  valor_unitario_nfe numeric,
  data_emissao text,
  produto_reconhecido boolean default false,
  id_produto_reconhecido text,
  nome_interno_sugerido text,
  produto_novo boolean default true,
  campos_pendentes text,
  status_revisao text default 'PENDENTE'
);
