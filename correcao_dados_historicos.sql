-- ============================================================
-- CORREÇÃO DE DADOS HISTÓRICOS — Super Ajudante
-- Execute no SQL Editor do Supabase, um bloco por vez.
-- ============================================================


-- ============================================================
-- BLOCO 1: Renomear "Camara fria" para "Câmara fria"
-- (sem acento é a entrada antiga; com acento é o padrão GPT)
-- ============================================================
UPDATE categorias
SET nome_categoria = 'Câmara fria'
WHERE LOWER(UNACCENT(nome_categoria)) = 'camara fria'
   OR nome_categoria = 'Camara fria';

-- Verificação:
SELECT id_categoria, nome_categoria, ativo FROM categorias ORDER BY nome_categoria;


-- ============================================================
-- BLOCO 2: Excluir mapeamentos vazios (sem CNPJ e sem código)
-- São os registros criados antes da validação existir
-- ============================================================
DELETE FROM produto_fornecedor
WHERE (cnpj_fornecedor IS NULL OR cnpj_fornecedor = '')
  AND (codigo_produto_nf IS NULL OR codigo_produto_nf = '');

-- Verificação:
SELECT COUNT(*) AS removidos FROM produto_fornecedor
WHERE (cnpj_fornecedor IS NULL OR cnpj_fornecedor = '')
  AND (codigo_produto_nf IS NULL OR codigo_produto_nf = '');
-- Deve retornar 0


-- ============================================================
-- BLOCO 3: Corrigir PRD-0188 (unidade ML → UN)
-- ============================================================
UPDATE produtos
SET unidade_estoque = 'UN',
    unidade_compra  = 'UN',
    atualizado_em   = TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI')
WHERE id_produto = 'PRD-0188';

-- Verificação:
SELECT id_produto, nome_interno, unidade_estoque, unidade_compra
FROM produtos WHERE id_produto = 'PRD-0188';


-- ============================================================
-- BLOCO 4: Criar embalagem base (fator=1) para todos os
-- produtos ativos que ainda não têm nenhuma embalagem ativa.
-- ============================================================
DO $$
DECLARE
  max_num  INT;
  counter  INT := 0;
  prod     RECORD;
  new_id   TEXT;
  unidade  TEXT;
  agora    TEXT;
BEGIN
  agora := TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI');

  -- Descobre o maior número EMB já existente
  SELECT COALESCE(MAX(
    CAST(REGEXP_REPLACE(id_embalagem, '[^0-9]', '', 'g') AS INT)
  ), 0)
  INTO max_num
  FROM embalagens;

  RAISE NOTICE 'Último EMB existente: EMB-%', LPAD(max_num::TEXT, 4, '0');

  FOR prod IN
    SELECT
      p.id_produto,
      UPPER(COALESCE(NULLIF(TRIM(p.unidade_estoque), ''), 'UN')) AS unidade
    FROM produtos p
    WHERE UPPER(COALESCE(p.ativo, 'SIM')) = 'SIM'
      AND UPPER(COALESCE(p.produto_teste, 'NAO')) <> 'SIM'
      AND NOT EXISTS (
        SELECT 1 FROM embalagens e
        WHERE e.id_produto = p.id_produto
          AND UPPER(COALESCE(e.ativo, 'SIM')) = 'SIM'
      )
    ORDER BY p.id_produto
  LOOP
    counter := counter + 1;
    new_id  := 'EMB-' || LPAD((max_num + counter)::TEXT, 4, '0');
    unidade := prod.unidade;

    INSERT INTO embalagens (
      id_embalagem, id_produto,
      descricao, sigla, fator, unidade_base,
      permite_entrada, permite_saida, permite_inventario,
      padrao_entrada,  padrao_saida,  padrao_inventario,
      ativo, criado_em, atualizado_em
    ) VALUES (
      new_id, prod.id_produto,
      unidade || ' x1', unidade, 1, unidade,
      'SIM', 'SIM', 'SIM',
      'NAO', 'NAO', 'NAO',
      'SIM', agora, agora
    );

    RAISE NOTICE 'Criado % para produto %', new_id, prod.id_produto;
  END LOOP;

  RAISE NOTICE '=== Total de embalagens criadas: % ===', counter;
END $$;

-- Verificação final — deve retornar 0 produtos sem embalagem:
SELECT COUNT(*) AS produtos_sem_embalagem
FROM produtos p
WHERE UPPER(COALESCE(p.ativo, 'SIM')) = 'SIM'
  AND NOT EXISTS (
    SELECT 1 FROM embalagens e
    WHERE e.id_produto = p.id_produto
      AND UPPER(COALESCE(e.ativo, 'SIM')) = 'SIM'
  );


-- ============================================================
-- BLOCO 5 (DIAGNÓSTICO): Cervejas com fator suspeito
-- Use o resultado para corrigir manualmente via tela de
-- Embalagens do app (criar embalagem CX com fator 12 ou 24).
-- ============================================================
SELECT
  p.id_produto,
  p.nome_interno,
  p.unidade_compra,
  p.unidade_estoque,
  p.fator_conversao AS fator_produto,
  e.id_embalagem,
  e.sigla,
  e.fator AS fator_embalagem,
  e.descricao
FROM produtos p
LEFT JOIN embalagens e ON e.id_produto = p.id_produto AND UPPER(COALESCE(e.ativo,'SIM')) = 'SIM'
WHERE UPPER(COALESCE(p.ativo,'SIM')) = 'SIM'
  AND (
    LOWER(p.nome_interno) LIKE '%cerveja%'
    OR LOWER(p.nome_interno) LIKE '%brahma%'
    OR LOWER(p.nome_interno) LIKE '%skol%'
    OR LOWER(p.nome_interno) LIKE '%antarctica%'
    OR LOWER(p.nome_interno) LIKE '%heineken%'
    OR LOWER(p.nome_interno) LIKE '%budweiser%'
    OR LOWER(p.nome_interno) LIKE '%stella%'
    OR LOWER(p.nome_interno) LIKE '%itaipava%'
    OR LOWER(p.nome_interno) LIKE '%cristal%'
  )
ORDER BY p.nome_interno;
-- Para cada linha onde fator_embalagem = 1 mas a cerveja vem em caixa,
-- crie uma nova embalagem via app: sigla=CX, fator=12 (ou 24 conforme a caixa).
