// api/_lib/sheets.js
// Camada de acesso ao Google Sheets usado como banco de dados.
// Autentica via Service Account (credenciais em variaveis de ambiente da Vercel).

import { google } from 'googleapis';

let _sheetsClient = null;

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let key = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !key) {
    throw new Error(
      'Credenciais do Google ausentes. Defina GOOGLE_SERVICE_ACCOUNT_EMAIL e GOOGLE_PRIVATE_KEY nas Environment Variables da Vercel.'
    );
  }
  // A chave privada vem com \n escapados quando colada na Vercel.
  key = key.replace(/\\n/g, '\n');
  return new google.auth.JWT({
    email,
    key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

function client() {
  if (_sheetsClient) return _sheetsClient;
  const auth = getAuth();
  _sheetsClient = google.sheets({ version: 'v4', auth });
  return _sheetsClient;
}

function spreadsheetId() {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error('GOOGLE_SHEET_ID nao definido nas Environment Variables.');
  return id;
}

// Cabecalhos esperados de cada aba (devem bater com a planilha entregue).
export const SHEETS = {
  Produtos: [
    'id_produto', 'cnpj_fornecedor', 'codigo_produto_nf', 'codigo_barras', 'descricao_original_nf',
    'nome_interno', 'categoria_id', 'fornecedor_principal_id', 'unidade_compra', 'unidade_estoque',
    'quantidade_por_embalagem', 'fator_conversao', 'estoque_minimo', 'estoque_atual', 'ultimo_custo_unitario',
    'custo_medio', 'ativo', 'observacoes', 'criado_em', 'atualizado_em',
  ],
  Fornecedores: [
    'id_fornecedor', 'razao_social', 'nome_fantasia', 'cnpj', 'inscricao_estadual', 'telefone', 'email',
    'endereco', 'numero', 'bairro', 'cidade', 'estado', 'cep', 'contato', 'observacoes', 'ativo',
  ],
  Categorias: ['id_categoria', 'nome_categoria', 'descricao', 'ativo'],
  Notas_Fiscais: [
    'id_nota', 'chave_nfe', 'numero_nota', 'serie', 'modelo', 'fornecedor_id', 'cnpj_fornecedor',
    'data_emissao', 'data_entrada', 'natureza_operacao', 'valor_produtos', 'valor_frete', 'valor_desconto',
    'valor_outras_despesas', 'valor_total_nota', 'status_api_meu_danfe', 'status_importacao',
    'xml_original', 'pdf_base64', 'observacoes', 'criado_em',
  ],
  Itens_Nota: [
    'id_item', 'id_nota', 'numero_item', 'id_produto', 'cnpj_fornecedor', 'codigo_produto_nf', 'codigo_barras',
    'descricao_original', 'ncm', 'cfop', 'unidade_nf', 'quantidade_nf', 'valor_unitario_nf', 'valor_total_nf',
    'unidade_tributavel', 'quantidade_tributavel', 'valor_unitario_tributavel', 'fator_conversao',
    'quantidade_estoque', 'custo_unitario_estoque', 'categoria_id', 'status_conferencia',
  ],
  Movimentacoes_Estoque: [
    'id_movimentacao', 'data', 'id_produto', 'tipo', 'quantidade', 'custo_unitario', 'valor_total',
    'origem', 'id_nota', 'motivo', 'usuario', 'observacao',
  ],
  Contas_Pagar: [
    'id_conta', 'id_nota', 'fornecedor_id', 'numero_parcela', 'descricao', 'valor', 'data_emissao', 'vencimento',
    'forma_pagamento', 'status', 'data_pagamento', 'observacao', 'criado_em', 'atualizado_em',
  ],
  Configuracoes: ['chave', 'valor', 'descricao'],
};

function colLetter(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Le todas as linhas de uma aba e retorna array de objetos { coluna: valor }.
export async function readRows(sheetName) {
  const headers = SHEETS[sheetName];
  if (!headers) throw new Error(`Aba desconhecida: ${sheetName}`);
  const lastCol = colLetter(headers.length);
  const res = await client().spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${sheetName}!A2:${lastCol}`,
  });
  const values = res.data.values || [];
  return values.map((row, i) => {
    const obj = { _row: i + 2 }; // numero real da linha na planilha
    headers.forEach((h, c) => { obj[h] = row[c] !== undefined ? row[c] : ''; });
    return obj;
  });
}

// Adiciona uma linha (objeto) ao final da aba.
export async function appendRow(sheetName, obj) {
  const headers = SHEETS[sheetName];
  if (!headers) throw new Error(`Aba desconhecida: ${sheetName}`);
  const row = headers.map((h) => (obj[h] !== undefined && obj[h] !== null ? obj[h] : ''));
  await client().spreadsheets.values.append({
    spreadsheetId: spreadsheetId(),
    range: `${sheetName}!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}

// Atualiza uma linha existente (precisa do _row).
export async function updateRow(sheetName, rowNumber, obj) {
  const headers = SHEETS[sheetName];
  if (!headers) throw new Error(`Aba desconhecida: ${sheetName}`);
  const lastCol = colLetter(headers.length);
  const row = headers.map((h) => (obj[h] !== undefined && obj[h] !== null ? obj[h] : ''));
  await client().spreadsheets.values.update({
    spreadsheetId: spreadsheetId(),
    range: `${sheetName}!A${rowNumber}:${lastCol}${rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });
}

// Gera o proximo id sequencial tipo PREFIXO-0001 a partir das linhas existentes.
export async function nextId(sheetName, idField, prefix) {
  const rows = await readRows(sheetName);
  let max = 0;
  for (const r of rows) {
    const v = String(r[idField] || '');
    const m = v.match(/(\d+)\s*$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}

// Le a aba Configuracoes como objeto chave->valor.
export async function readConfig() {
  const rows = await readRows('Configuracoes');
  const cfg = {};
  for (const r of rows) if (r.chave) cfg[r.chave] = r.valor;
  return cfg;
}
