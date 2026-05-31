// api/nfe/conferir.js
// POST { chave } -> baixa o XML (status deve estar OK), faz o parser e devolve os dados
// para a tela de Conferencia. Marca produtos novos x ja conhecidos. NAO grava estoque.

import { getXml } from '../_lib/meudanfe.js';
import { parseNfe, descreverFormaPagamento } from '../_lib/parser.js';
import { readRows, readConfig } from '../_lib/db.js';
import { json, validarChave, readBody } from '../_lib/util.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { erro: 'Metodo nao permitido' });

  try {
    const body = await readBody(req);
    const chave = validarChave(body.chave);
    if (!chave) return json(res, 400, { erro: 'Chave invalida (44 digitos).' });

    // Baixa XML (gratuito apos adicionada) e faz parser
    const xml = await getXml(chave);
    const dados = parseNfe(xml);

    // Validacao de destinatario (CNPJ do restaurante)
    const cfg = await readConfig();
    const cnpjRest = String(cfg.CNPJ_RESTAURANTE || '').replace(/\D/g, '');
    const alertaDestinatario =
      cnpjRest && dados.destinatario.cnpj && dados.destinatario.cnpj !== cnpjRest
        ? `Atencao: a nota e destinada ao CNPJ ${dados.destinatario.cnpj}, diferente do restaurante (${cnpjRest}).`
        : null;

    // Reconhecimento de produtos ja cadastrados (aprendizado por CNPJ + cProd / EAN)
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
        // Usa o fator ja aprendido (se houver) em vez do detectado
        const fatorSalvo = parseFloat(match.fator_conversao) || it.fator_conversao;
        const qtdEstoque = it.quantidade_nf * fatorSalvo;
        return {
          ...it,
          id_produto: match.id_produto,
          nome_interno: match.nome_interno,
          categoria_id: match.categoria_id,
          unidade_estoque: match.unidade_estoque,
          fator_conversao: fatorSalvo,
          quantidade_estoque: qtdEstoque,
          custo_unitario_estoque: qtdEstoque > 0 ? Number((it.valor_total_nf / qtdEstoque).toFixed(6)) : 0,
          produto_novo: false,
        };
      }
      return { ...it, id_produto: '', nome_interno: '', categoria_id: '', produto_novo: true };
    });

    // Parcelas / contas a pagar previstas
    let parcelas;
    if (dados.duplicatas.length > 0) {
      parcelas = dados.duplicatas.map((d, i) => ({
        numero_parcela: d.nDup || `${i + 1}/${dados.duplicatas.length}`,
        vencimento: d.vencimento,
        valor: d.valor,
        forma_pagamento: dados.formasPagamento[0]
          ? descreverFormaPagamento(dados.formasPagamento[0].tPag)
          : 'BOLETO',
        status: 'ABERTO',
      }));
    } else {
      parcelas = [{
        numero_parcela: '1/1',
        vencimento: '',
        valor: dados.nota.valor_total_nota,
        forma_pagamento: dados.formasPagamento[0]
          ? descreverFormaPagamento(dados.formasPagamento[0].tPag)
          : 'OUTRO',
        status: 'PENDENTE_INFO',
      }];
    }

    return json(res, 200, {
      chave,
      nota: dados.nota,
      fornecedor: dados.fornecedor,
      destinatario: dados.destinatario,
      totais: dados.totais,
      itens,
      parcelas,
      alertaDestinatario,
      xml, // devolvido para ser gravado no confirmar (evita segundo download)
    });
  } catch (e) {
    return json(res, 500, { erro: e.message });
  }
}
