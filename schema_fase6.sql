-- Super Ajudante — Schema Fase 6
-- Enriquece produto_fornecedor com NCM e histórico de preço unitário.
-- Execute no SQL Editor do Supabase ANTES de usar "Reprocessar para Aprendizado".
-- Totalmente aditivo: não apaga nada, pode rodar várias vezes.

alter table produto_fornecedor
  add column if not exists ncm                  text    default '',
  add column if not exists ultimo_preco_unitario numeric default 0;
