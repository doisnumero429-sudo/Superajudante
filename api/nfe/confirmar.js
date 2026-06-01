// api/nfe/confirmar.js
// POST { chave, nota, fornecedor, itens, parcelas, xml, pdf_base64? }
// Grava tudo no Google Sheets: Notas_Fiscais, Fornecedores (se novo), Produtos (novos),
// Itens_Nota, Movimentacoes_Estoque (entrada) e Contas_Pagar. Atualiza estoque e custo medio.

import {
  readRows, appendRow, updateRow, nextId,
} from '../_lib/db.js';
import { normalizarDesc } from '../_lib/parser.js';
import { json, preflight, validarChave, readBody, nowStr } from '../_lib/util.js';

export default async function handler(req, res) {
  if (preflight(req, res)) return;
  if (req.method !== 'POST') return json(res, 405, { erro: 'Metodo nao permitido' });

  try {
    const body = await readBody(req);
    const chave = validarChave(body.chave);
    if (!chave) return json(res, 400, { erro: 'Chave invalida (44 digitos).' });
    const { nota, fornecedor, itens = [], parcelas = [] } = body;
    if (!nota || !fornecedor || itens.length === 0) {
      return json(res, 400, { erro: 'Dados incompletos para confirmacao.' });
    }

    const agora = nowStr();

    // Bloqueio final de duplicidade
    const notasExist = await readRows('Notas_Fiscais');
    if (notasExist.find((n) => String(n.chave_nfe).replace(/\D/g, '') === chave
        && ['CONFERIDA', 'LANCADA'].includes(String(n.status_importacao)))) {
      return json(res, 409, { erro: 'NF-e ja importada.', duplicada: true });
    }

    // 1) Fornecedor: cria se nao existir (por CNPJ)
    const fornecedores = await readRows('Fornecedores');
    const cnpjForn = String(fornecedor.cnpj).replace(/\D/g, '');
    let forn = fornecedores.find((f) => String(f.cnpj).replace(/\D/g, '') === cnpjForn);
    let fornecedorId;
    if (forn) {
      fornecedorId = forn.id_fornecedor;
    } else {
      fornecedorId = await nextId('Fornecedores', 'id_fornecedor', 'FOR');
      await appendRow('Fornecedores', {
        id_fornecedor: fornecedorId,
        razao_social: fornecedor.razao_social,
        nome_fantasia: fornecedor.nome_fantasia,
        cnpj: cnpjForn,
        inscricao_estadual: fornecedor.inscricao_estadual,
        telefone: fornecedor.telefone,
        email: '',
        endereco: fornecedor.endereco,
        numero: fornecedor.numero,
        bairro: fornecedor.bairro,
        cidade: fornecedor.cidade,
        estado: fornecedor.estado,
        cep: fornecedor.cep,
        contato: '',
        observacoes: '',
        ativo: 'SIM',
      });
    }

    // 2) Cabecalho da nota
    const idNota = await nextId('Notas_Fiscais', 'id_nota', 'NF');
    await appendRow('Notas_Fiscais', {
      id_nota: idNota,
      chave_nfe: chave,
      numero_nota: nota.numero_nota,
      serie: nota.serie,
      modelo: nota.modelo,
      fornecedor_id: fornecedorId,
      cnpj_fornecedor: cnpjForn,
      data_emissao: nota.data_emissao,
      data_entrada: nota.data_entrada || agora.slice(0, 10),
      natureza_operacao: nota.natureza_operacao,
      valor_produtos: nota.valor_produtos,
      valor_frete: nota.valor_frete,
      valor_desconto: nota.valor_desconto,
      valor_outras_despesas: nota.valor_outras_despesas,
      valor_total_nota: nota.valor_total_nota,
      status_api_meu_danfe: 'OK',
      status_importacao: 'LANCADA',
      xml_original: (body.xml || '').slice(0, 45000), // limite de celula do Sheets
      pdf_base64: body.pdf_base64 || '',
      observacoes: '',
      criado_em: agora,
    });

    // Recarrega produtos para cadastro/atualizacao
    let produtos = await readRows('Produtos');
    // Mapeamentos fornecedor/produto (tabela nova da fase 2; opcional).
    let pfTodos = [];
    try { pfTodos = await readRows('Produto_Fornecedor'); } catch { /* tabela opcional */ }

    // 3) Itens: cadastra produtos novos, lanca item, movimentacao e atualiza estoque
    for (const it of itens) {
      let prod = null;
      if (it.id_produto) {
        prod = produtos.find((p) => p.id_produto === it.id_produto);
      }
      if (!prod) {
        // tenta achar por cnpj+codigo ou EAN (caso o frontend nao tenha mandado id)
        prod = produtos.find((p) => {
          const mesmoForn = String(p.cnpj_fornecedor).replace(/\D/g, '') === cnpjForn;
          const porCodigo = mesmoForn && String(p.codigo_produto_nf) === String(it.codigo_produto_nf);
          const porEan = it.codigo_barras && String(p.codigo_barras) === String(it.codigo_barras);
          return porCodigo || porEan;
        });
      }

      const fator = parseFloat(it.fator_conversao) || 1;
      const qtdEstoque = parseFloat(it.quantidade_estoque) || (parseFloat(it.quantidade_nf) * fator);
      const custoUnit = qtdEstoque > 0 ? (parseFloat(it.valor_total_nf) / qtdEstoque) : 0;

      let idProduto;
      if (prod) {
        idProduto = prod.id_produto;
        // Atualiza estoque e custo medio ponderado
        const estoqueAtual = parseFloat(prod.estoque_atual) || 0;
        const custoMedioAnt = parseFloat(prod.custo_medio) || 0;
        const novoEstoque = estoqueAtual + qtdEstoque;
        const novoCustoMedio = novoEstoque > 0
          ? ((estoqueAtual * custoMedioAnt) + (qtdEstoque * custoUnit)) / novoEstoque
          : custoUnit;
        await updateRow('Produtos', prod.id_produto, {
          ...prod,
          estoque_atual: Number(novoEstoque.toFixed(3)),
          ultimo_custo_unitario: Number(custoUnit.toFixed(4)),
          custo_medio: Number(novoCustoMedio.toFixed(4)),
          fator_conversao: fator,
          atualizado_em: agora,
        });
      } else {
        // Produto novo: usa dados de cadastro vindos da tela de conferencia
        idProduto = await nextId('Produtos', 'id_produto', 'PRD');
        await appendRow('Produtos', {
          id_produto: idProduto,
          cnpj_fornecedor: cnpjForn,
          codigo_produto_nf: it.codigo_produto_nf,
          codigo_barras: it.codigo_barras,
          descricao_original_nf: it.descricao_original,
          nome_interno: it.nome_interno || it.descricao_original,
          categoria_id: it.categoria_id || '',
          fornecedor_principal_id: fornecedorId,
          unidade_compra: it.unidade_nf,
          unidade_estoque: it.unidade_estoque || 'UN',
          quantidade_por_embalagem: fator,
          fator_conversao: fator,
          estoque_minimo: it.estoque_minimo || 0,
          estoque_atual: Number(qtdEstoque.toFixed(3)),
          ultimo_custo_unitario: Number(custoUnit.toFixed(4)),
          custo_medio: Number(custoUnit.toFixed(4)),
          ativo: 'SIM',
          // Curado na tela de conferencia (nome + categoria) => confirmado.
          // Sem curadoria, fica pendente e aparece para exportar ao ChatGPT.
          confirmado: (it.nome_interno && it.categoria_id) ? 'SIM' : 'NAO',
          observacoes: '',
          criado_em: agora,
          atualizado_em: agora,
        });
        // adiciona ao cache local para os proximos itens da mesma nota
        produtos.push({
          id_produto: idProduto, cnpj_fornecedor: cnpjForn,
          codigo_produto_nf: it.codigo_produto_nf, codigo_barras: it.codigo_barras,
          estoque_atual: qtdEstoque, custo_medio: custoUnit,
        });
      }

      // Item da nota
      const idItem = await nextId('Itens_Nota', 'id_item', 'ITM');
      await appendRow('Itens_Nota', {
        id_item: idItem,
        id_nota: idNota,
        numero_item: it.numero_item,
        id_produto: idProduto,
        cnpj_fornecedor: cnpjForn,
        codigo_produto_nf: it.codigo_produto_nf,
        codigo_barras: it.codigo_barras,
        descricao_original: it.descricao_original,
        ncm: it.ncm,
        cfop: it.cfop,
        unidade_nf: it.unidade_nf,
        quantidade_nf: it.quantidade_nf,
        valor_unitario_nf: it.valor_unitario_nf,
        valor_total_nf: it.valor_total_nf,
        unidade_tributavel: it.unidade_tributavel,
        quantidade_tributavel: it.quantidade_tributavel,
        valor_unitario_tributavel: it.valor_unitario_tributavel,
        fator_conversao: fator,
        quantidade_estoque: Number(qtdEstoque.toFixed(3)),
        custo_unitario_estoque: Number(custoUnit.toFixed(4)),
        categoria_id: it.categoria_id || '',
        status_conferencia: 'CONFERIDO',
      });

      // Movimentacao de entrada
      const idMov = await nextId('Movimentacoes_Estoque', 'id_movimentacao', 'MOV');
      await appendRow('Movimentacoes_Estoque', {
        id_movimentacao: idMov,
        data: agora,
        id_produto: idProduto,
        tipo: 'ENTRADA',
        quantidade: Number(qtdEstoque.toFixed(3)),
        custo_unitario: Number(custoUnit.toFixed(4)),
        valor_total: Number(parseFloat(it.valor_total_nf).toFixed(2)),
        origem: 'NFE',
        id_nota: idNota,
        motivo: 'compra',
        usuario: body.usuario || 'sistema',
        observacao: '',
      });

      // Mapeamento fornecedor/produto (aprendizado): cnpj + codigo -> id_produto.
      // Permite que varios codigos/CNPJs apontem para o mesmo produto interno.
      // Best-effort: se a tabela ainda nao existir no Supabase, nao quebra a importacao.
      try {
        const jaMapeado = pfTodos.find((x) => x.id_produto === idProduto
          && String(x.cnpj_fornecedor).replace(/\D/g, '') === cnpjForn
          && String(x.codigo_produto_nf) === String(it.codigo_produto_nf));
        if (jaMapeado) {
          await updateRow('Produto_Fornecedor', jaMapeado.id_pf, {
            ...jaMapeado,
            vezes_utilizado: (parseFloat(jaMapeado.vezes_utilizado) || 0) + 1,
            ultima_utilizacao: agora, atualizado_em: agora,
          });
        } else {
          const idPf = await nextId('Produto_Fornecedor', 'id_pf', 'PF');
          const novoPf = {
            id_pf: idPf, id_produto: idProduto, cnpj_fornecedor: cnpjForn,
            nome_fornecedor: fornecedor.razao_social || '',
            codigo_produto_nf: it.codigo_produto_nf || '', ean: it.codigo_barras || '',
            descricao_original: it.descricao_original || '',
            descricao_normalizada: normalizarDesc(it.descricao_original),
            unidade_nf: it.unidade_nf || '',
            confirmado_pelo_usuario: (it.nome_interno && it.categoria_id) ? 'SIM' : 'NAO',
            origem_confirmacao: 'NFE', vezes_utilizado: 1, ultima_utilizacao: agora,
            ativo: 'SIM', criado_em: agora, atualizado_em: agora,
          };
          await appendRow('Produto_Fornecedor', novoPf);
          pfTodos.push(novoPf);
        }
      } catch { /* tabela produto_fornecedor opcional (fase 2) */ }
    }

    // 4) Contas a pagar
    for (const pc of parcelas) {
      const idConta = await nextId('Contas_Pagar', 'id_conta', 'CP');
      await appendRow('Contas_Pagar', {
        id_conta: idConta,
        id_nota: idNota,
        fornecedor_id: fornecedorId,
        numero_parcela: pc.numero_parcela,
        descricao: `NF ${nota.numero_nota} - ${fornecedor.razao_social}`,
        valor: pc.valor,
        data_emissao: nota.data_emissao,
        vencimento: pc.vencimento || '',
        forma_pagamento: pc.forma_pagamento || 'OUTRO',
        status: pc.vencimento ? 'ABERTO' : 'PENDENTE_INFO',
        data_pagamento: '',
        observacao: '',
        criado_em: agora,
        atualizado_em: agora,
      });
    }

    return json(res, 200, {
      ok: true,
      id_nota: idNota,
      fornecedor_id: fornecedorId,
      itens_lancados: itens.length,
      parcelas_criadas: parcelas.length,
    });
  } catch (e) {
    return json(res, 500, { erro: e.message });
  }
}

