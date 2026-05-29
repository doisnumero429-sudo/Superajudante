// api/contas/pagar.js
// POST { id_conta, data_pagamento?, forma_pagamento? } -> marca como PAGO.
import { readRows, updateRow } from '../_lib/sheets.js';
import { json, readBody, nowStr } from '../_lib/util.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { erro: 'Metodo nao permitido' });
  try {
    const b = await readBody(req);
    if (!b.id_conta) return json(res, 400, { erro: 'Informe id_conta.' });
    const contas = await readRows('Contas_Pagar');
    const c = contas.find((x) => x.id_conta === b.id_conta);
    if (!c) return json(res, 404, { erro: 'Conta nao encontrada.' });

    const o = { ...c }; delete o._row;
    await updateRow('Contas_Pagar', c._row, {
      ...o,
      status: 'PAGO',
      data_pagamento: b.data_pagamento || nowStr().slice(0, 10),
      forma_pagamento: b.forma_pagamento || c.forma_pagamento,
      atualizado_em: nowStr(),
    });
    return json(res, 200, { ok: true, id_conta: b.id_conta, status: 'PAGO' });
  } catch (e) {
    return json(res, 500, { erro: e.message });
  }
}
