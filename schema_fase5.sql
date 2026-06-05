-- Super Ajudante — Schema Fase 5
-- Configuração do limite semanal de compras para a Central da Cris.
-- Execute no SQL Editor do Supabase.

insert into configuracoes (chave, valor, descricao) values
  ('LIMITE_SEMANAL_COMPRAS', '30000', 'Limite semanal de compras em reais (ex: 30000)')
on conflict (chave) do nothing;
