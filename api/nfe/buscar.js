// api/nfe/buscar.js
// POST { chave } -> valida, checa duplicidade, dispara/consulta a API Meu Danfe.
// NAO faz polling longo dentro da funcao: cada chamada retorna o status atual e o
// frontend reconsulta respeitando o intervalo. Assim respeita 1 req/s por chave
// e nao estoura o timeout da Vercel.

import { addNfe } from '../_lib/meudanfe.js';
import { readRows, readConfig } from '../_lib/sheets.js';
import { json, validarChave, readBody, podeConsultar, registrarConsulta, resetarTentativas } from '../_lib/util.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { erro: 'Metodo nao permitido' });

  try {
    const body = await readBody(req);
    const chave = validarChave(body.chave);
    if (!chave) {
      return json(res, 400, { erro: 'Chave invalida. Informe exatamente 44 digitos numericos.' });
    }

    // 1) Checa duplicidade na aba Notas_Fiscais
    const notas = await readRows('Notas_Fiscais');
    const existente = notas.find((n) => String(n.chave_nfe).replace(/\D/g, '') === chave);
    if (existente && ['CONFERIDA', 'LANCADA'].includes(String(existente.status_importacao))) {
      return json(res, 409, {
        erro: 'Esta NF-e ja foi importada.',
        duplicada: true,
        status_importacao: existente.status_importacao,
        id_nota: existente.id_nota,
      });
    }

    // 2) Config de seguranca
    const cfg = await readConfig();
    const intervaloMs = parseInt(cfg.INTERVALO_TENTATIVAS_MS || '1000', 10);
    const maxTent = parseInt(cfg.MAX_TENTATIVAS_NFE || '5', 10);

    // 3) Rate limit por chave (em memoria)
    const gate = podeConsultar(chave, intervaloMs, maxTent);
    if (!gate.ok) {
      if (gate.motivo === 'INTERVALO') {
        return json(res, 429, {
          status: 'WAITING',
          aguardar_ms: gate.espera,
          mensagem: 'Aguardando intervalo minimo entre consultas.',
        });
      }
      return json(res, 429, {
        status: 'ERROR',
        mensagem: 'Limite de tentativas atingido para esta chave. Tente novamente mais tarde.',
      });
    }

    // 4) Dispara/consulta a API Meu Danfe
    registrarConsulta(chave);
    const r = await addNfe(chave);
    const status = (r.status || 'ERROR').toUpperCase();

    // status OK -> pronto para baixar XML; zera o contador
    if (status === 'OK') resetarTentativas(chave);
    // erros de conta/credito/chave invalida: nao adianta reconsultar, encerra
    if (r.fatal || status === 'NOT_FOUND') resetarTentativas(chave);

    return json(res, 200, {
      chave,
      status,                       // WAITING | SEARCHING | NOT_FOUND | OK | ERROR
      mensagem: r.statusMessage || '',
      tipo: r.type || '',
      fatal: !!r.fatal,             // true => frontend para de reconsultar
      // dica de polling pro frontend respeitar o intervalo
      reconsultar_em_ms: (['WAITING', 'SEARCHING'].includes(status) && !r.fatal)
        ? Math.max(intervaloMs, 1000) : null,
    });
  } catch (e) {
    return json(res, 500, { erro: e.message });
  }
}
