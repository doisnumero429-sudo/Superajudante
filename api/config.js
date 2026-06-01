// api/config.js
// GET  -> devolve as configuracoes editaveis pelo app.
// POST { chave, valor } -> salva (upsert) uma configuracao editavel.

import { readRows, updateRow, appendRow } from './_lib/db.js';
import { json, preflight, readBody } from './_lib/util.js';

// So expomos/permitimos editar estas chaves (evita mexer em internas por engano).
const EDITAVEIS = {
  CNPJ_RESTAURANTE: 'CNPJ do restaurante (valida o destinatario das notas)',
  MAX_TENTATIVAS_NFE: 'Maximo de tentativas por chave NF-e',
  INTERVALO_TENTATIVAS_MS: 'Intervalo minimo entre tentativas por chave (ms)',
  LIMITE_CONSULTAS_SEGUNDO: 'Maximo de consultas por segundo a API Meu Danfe',
};

export default async function handler(req, res) {
  if (preflight(req, res)) return;

  try {
    if (req.method === 'GET') {
      const rows = await readRows('Configuracoes');
      const mapa = Object.fromEntries(rows.map((r) => [r.chave, r.valor]));
      const lista = Object.entries(EDITAVEIS).map(([chave, descricao]) => ({
        chave, descricao, valor: mapa[chave] ?? '',
      }));
      return json(res, 200, { rows: lista });
    }

    if (req.method === 'POST') {
      const b = await readBody(req);
      const chave = String(b.chave || '');
      if (!Object.prototype.hasOwnProperty.call(EDITAVEIS, chave)) {
        return json(res, 400, { erro: 'Configuracao nao editavel.' });
      }
      const valor = String(b.valor ?? '');
      const rows = await readRows('Configuracoes');
      const existe = rows.find((r) => r.chave === chave);
      if (existe) await updateRow('Configuracoes', chave, { ...existe, valor });
      else await appendRow('Configuracoes', { chave, valor, descricao: EDITAVEIS[chave] });
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { erro: 'Metodo nao permitido' });
  } catch (e) {
    return json(res, 500, { erro: e.message });
  }
}
