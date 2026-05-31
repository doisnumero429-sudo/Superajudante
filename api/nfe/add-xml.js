// api/nfe/add-xml.js
// POST { xml } (texto do XML) -> envia para a Meu Danfe (PUT /fd/add/xml, GRATIS),
// faz o parser localmente e devolve os dados de conferencia, sem gravar ainda.
// Importante (doc): reenviar o mesmo XML varias vezes BLOQUEIA a conta -> checamos
// duplicidade pela chave extraida do proprio XML antes de enviar.

import { addXml } from '../_lib/meudanfe.js';
import { parseNfe, descreverFormaPagamento } from '../_lib/parser.js';
import { readRows, readConfig } from '../_lib/db.js';
import { json, readBody } from '../_lib/util.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { erro: 'Metodo nao permitido' });
  try {
    const body = await readBody(req);
    const xml = body.xml;
    if (!xml || !String(xml).trim().startsWith('<')) {
      return json(res, 400, { erro: 'Envie o conteudo do XML no campo "xml".' });
    }

    // Parse local primeiro (pega a chave para checar duplicidade)
    const dados = parseNfe(xml);
    const chave = dados.nota.chave_nfe;
    if (!/^\d{44}$/.test(chave)) {
      return json(res, 400, { erro: 'Nao foi possivel extrair uma chave valida do XML.' });
    }

    // Duplicidade: se ja importada, NAO reenvia o XML (evita bloqueio da conta)
    const notas = await readRows('Notas_Fiscais');
    const existente = notas.find((n) => String(n.chave_nfe).replace(/\D/g, '') === chave);
    if (existente && ['CONFERIDA', 'LANCADA'].includes(String(existente.status_importacao))) {
      return json(res, 409, { erro: 'Esta NF-e ja foi importada.', duplicada: true, id_nota: existente.id_nota });
    }

    // Envia o XML para a Area do Cliente (gratis). Tolerante a falha de rede aqui:
    // o dado oficial e o proprio XML que ja temos.
    try { await addXml(xml); } catch (e) { /* segue com parser local */ }

    // Reconhecimento de produtos + parcelas (mesma logica do conferir.js)
    const cfg = await readConfig();
    const cnpjRest = String(cfg.CNPJ_RESTAURANTE || '').replace(/\D/g, '');
    const alertaDestinatario =
      cnpjRest && dados.destinatario.cnpj && dados.destinatario.cnpj !== cnpjRest
        ? `Atencao: nota destinada ao CNPJ ${dados.destinatario.cnpj}, diferente do restaurante (${cnpjRest}).`
        : null;

    const produtos = await readRows('Produtos');
    const cnpjForn = dados.fornecedor.cnpj;
    const itens = dados.itens.map((it) => {
      const match = produtos.find((p) => {
        const mesmoForn = String(p.cnpj_fornecedor).replace(/\D/g, '') === cnpjForn;
        const porCodigo = mesmoForn && String(p.codigo_produto_nf) === String(it.codigo_produto_nf);
        const porEan = it.codigo_barras && String(p.codigo_barras) === String(it.codigo_barras);
        return porCodigo || porEan;
      });
      if (match) {
        const fator = parseFloat(match.fator_conversao) || it.fator_conversao;
        const qe = it.quantidade_nf * fator;
        return {
          ...it, id_produto: match.id_produto, nome_interno: match.nome_interno,
          categoria_id: match.categoria_id, unidade_estoque: match.unidade_estoque,
          fator_conversao: fator, quantidade_estoque: qe,
          custo_unitario_estoque: qe > 0 ? Number((it.valor_total_nf / qe).toFixed(6)) : 0,
          produto_novo: false,
        };
      }
      return { ...it, id_produto: '', nome_interno: '', categoria_id: '', produto_novo: true };
    });

    let parcelas;
    if (dados.duplicatas.length > 0) {
      parcelas = dados.duplicatas.map((d, i) => ({
        numero_parcela: d.nDup || `${i + 1}/${dados.duplicatas.length}`,
        vencimento: d.vencimento, valor: d.valor,
        forma_pagamento: dados.formasPagamento[0] ? descreverFormaPagamento(dados.formasPagamento[0].tPag) : 'BOLETO',
        status: 'ABERTO',
      }));
    } else {
      parcelas = [{
        numero_parcela: '1/1', vencimento: '', valor: dados.nota.valor_total_nota,
        forma_pagamento: dados.formasPagamento[0] ? descreverFormaPagamento(dados.formasPagamento[0].tPag) : 'OUTRO',
        status: 'PENDENTE_INFO',
      }];
    }

    return json(res, 200, {
      chave, nota: dados.nota, fornecedor: dados.fornecedor, destinatario: dados.destinatario,
      totais: dados.totais, itens, parcelas, alertaDestinatario, xml,
    });
  } catch (e) {
    return json(res, 500, { erro: e.message });
  }
}
