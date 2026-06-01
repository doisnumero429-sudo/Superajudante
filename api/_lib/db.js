// api/_lib/db.js
// Camada de acesso ao Supabase — substitui o Google Sheets.
// Usa a service_role key (server-side only, nunca exposta ao frontend).

import { createClient } from '@supabase/supabase-js';

let _client = null;
function getClient() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL e SUPABASE_SERVICE_KEY devem estar definidos nas variaveis de ambiente.'
    );
  }
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

export const TABLES = {
  Produtos:              { table: 'produtos',               pk: 'id_produto' },
  Fornecedores:          { table: 'fornecedores',           pk: 'id_fornecedor' },
  Categorias:            { table: 'categorias',             pk: 'id_categoria' },
  Notas_Fiscais:         { table: 'notas_fiscais',          pk: 'id_nota' },
  Itens_Nota:            { table: 'itens_nota',             pk: 'id_item' },
  Movimentacoes_Estoque: { table: 'movimentacoes_estoque',  pk: 'id_movimentacao' },
  Contas_Pagar:          { table: 'contas_pagar',           pk: 'id_conta' },
  Configuracoes:         { table: 'configuracoes',          pk: 'chave' },
  Embalagens:            { table: 'embalagens',             pk: 'id_embalagem' },
  Produto_Fornecedor:    { table: 'produto_fornecedor',     pk: 'id_pf' },
  Aliases_Produto:       { table: 'aliases_produto',        pk: 'id_alias' },
  Treino_Importacoes:    { table: 'treino_importacoes',     pk: 'id_importacao' },
  Treino_Fila:           { table: 'treino_fila',           pk: 'id_fila' },
  Treino_Itens:          { table: 'treino_itens',          pk: 'id_item_fila' },
};

export async function readRows(sheetName) {
  const meta = TABLES[sheetName];
  if (!meta) throw new Error(`Tabela desconhecida: ${sheetName}`);
  const { data, error } = await getClient().from(meta.table).select('*');
  if (error) throw new Error(error.message);
  return data;
}

export async function appendRow(sheetName, obj) {
  const meta = TABLES[sheetName];
  if (!meta) throw new Error(`Tabela desconhecida: ${sheetName}`);
  const { error } = await getClient().from(meta.table).insert(obj);
  if (error) throw new Error(error.message);
}

// Recebe o valor do PK em vez do numero da linha (era _row no Sheets).
export async function updateRow(sheetName, pkValue, obj) {
  const meta = TABLES[sheetName];
  if (!meta) throw new Error(`Tabela desconhecida: ${sheetName}`);
  const { error } = await getClient().from(meta.table).update(obj).eq(meta.pk, pkValue);
  if (error) throw new Error(error.message);
}

// Gera o proximo id sequencial (ex: PRD-0001) buscando apenas o ultimo registro.
export async function nextId(sheetName, idField, prefix) {
  const meta = TABLES[sheetName];
  if (!meta) throw new Error(`Tabela desconhecida: ${sheetName}`);
  const { data, error } = await getClient()
    .from(meta.table)
    .select(idField)
    .like(idField, `${prefix}-%`)
    .order(idField, { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  let max = 0;
  if (data?.[0]?.[idField]) {
    const m = String(data[0][idField]).match(/(\d+)$/);
    if (m) max = parseInt(m[1], 10);
  }
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}

export async function readConfig() {
  const { data, error } = await getClient().from('configuracoes').select('chave, valor');
  if (error) throw new Error(error.message);
  return Object.fromEntries(data.map((r) => [r.chave, r.valor]));
}

export async function deleteAllRows(sheetName) {
  const meta = TABLES[sheetName];
  if (!meta) throw new Error(`Tabela desconhecida: ${sheetName}`);
  const { error } = await getClient().from(meta.table).delete().gte(meta.pk, '');
  if (error) throw new Error(error.message);
}
