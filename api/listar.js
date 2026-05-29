// api/listar.js
// GET /api/listar?aba=Produtos -> retorna as linhas da aba.
import { readRows, SHEETS } from './_lib/sheets.js';
import { json } from './_lib/util.js';

export default async function handler(req, res) {
  try {
    const aba = req.query?.aba || new URL(req.url, 'http://x').searchParams.get('aba');
    if (!aba || !SHEETS[aba]) {
      return json(res, 400, { erro: 'Parametro "aba" invalido.', abas: Object.keys(SHEETS) });
    }
    const rows = await readRows(aba);
    return json(res, 200, { aba, total: rows.length, rows });
  } catch (e) {
    return json(res, 500, { erro: e.message });
  }
}
