// api/ia/sugerir.js
// POST { itens: [...] } -> usa o Gemini para sugerir nome/categoria/unidade/fator
// de produtos novos. Devolve { sugestoes: [...] } na mesma ordem dos itens enviados.

import { sugerirProdutos, temIA } from '../_lib/ia.js';
import { readRows } from '../_lib/db.js';
import { json, preflight, readBody } from '../_lib/util.js';

export default async function handler(req, res) {
  if (preflight(req, res)) return;
  if (req.method !== 'POST') return json(res, 405, { erro: 'Metodo nao permitido' });

  try {
    if (!temIA()) {
      return json(res, 503, { erro: 'IA nao configurada. Defina GEMINI_API_KEY nas variaveis de ambiente.' });
    }
    const body = await readBody(req);
    const itens = Array.isArray(body.itens) ? body.itens : [];
    if (!itens.length) return json(res, 400, { erro: 'Envie a lista de itens.' });

    const categorias = await readRows('Categorias');
    const sugestoes = await sugerirProdutos(itens, categorias);
    return json(res, 200, { sugestoes });
  } catch (e) {
    return json(res, 500, { erro: e.message });
  }
}
