-- schema_fase3.sql
-- Adiciona campos de código de barras unitário e preço de venda nos Produtos.
-- Idempotente: seguro para rodar múltiplas vezes.
-- Rodar no Supabase: Dashboard → SQL Editor → New Query

alter table produtos add column if not exists codigo_barras_unitario text;
alter table produtos add column if not exists preco_venda numeric default 0;
