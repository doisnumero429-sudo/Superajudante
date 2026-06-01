// api/nfe/danfe.js
// GET ?chave=... -> retorna o DANFE em PDF (base64).
import { getDanfe } from '../_lib/meudanfe.js';
import { json, preflight, validarChave } from '../_lib/util.js';

export default async function handler(req, res) {
  if (preflight(req, res)) return;
  try {
    const params = req.query || new URL(req.url, 'http://x').searchParams;
    const chave = validarChave(params.chave || params.get?.('chave'));
    if (!chave) return json(res, 400, { erro: 'Chave invalida (44 digitos).' });
    const base64 = await getDanfe(chave);
    return json(res, 200, { chave, pdf_base64: base64 });
  } catch (e) {
    return json(res, 500, { erro: e.message });
  }
}
