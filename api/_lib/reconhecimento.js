// api/_lib/reconhecimento.js
// Lógica compartilhada de reconhecimento de produto para conferir.js e confirmar.js.
// Usa 5 estratégias em ordem de confiança.

import { normalizarDesc } from './parser.js';

const isAtivo = (p) =>
  String(p.ativo || 'SIM').toUpperCase() === 'SIM' &&
  String(p.produto_teste || 'NAO').toUpperCase() !== 'SIM';

const isMapeamentoAtivo = (x) => String(x.ativo || 'SIM').toUpperCase() === 'SIM';

/**
 * Encontra o produto correspondente a um item de NF-e.
 * @param {object} it - item do NF-e (codigo_produto_nf, codigo_barras, descricao_original, [id_produto])
 * @param {object} ctx - { produtos, pfRows, aliasRows, cnpjForn }
 * @returns {{ prod, metodo } | null}
 */
export function encontrarProduto(it, { produtos, pfRows = [], aliasRows = [], cnpjForn }) {
  const descNorm = normalizarDesc(it.descricao_original || '');
  const prodById = Object.fromEntries(produtos.map((p) => [p.id_produto, p]));

  // Estratégia 0: id_produto direto (vindo da conferência)
  if (it.id_produto) {
    const p = prodById[it.id_produto];
    if (p && isAtivo(p)) return { prod: p, metodo: 'id_produto' };
  }

  // Estratégia 1: Produtos — CNPJ+código ou EAN
  let p = produtos.find((x) => {
    if (!isAtivo(x)) return false;
    const mesmoForn = String(x.cnpj_fornecedor || '').replace(/\D/g, '') === cnpjForn;
    const porCodigo = mesmoForn && x.codigo_produto_nf && String(x.codigo_produto_nf) === String(it.codigo_produto_nf);
    const porEan = it.codigo_barras && x.codigo_barras && String(x.codigo_barras) === String(it.codigo_barras);
    return porCodigo || porEan;
  });
  if (p) return { prod: p, metodo: 'CNPJ+código' };

  // Estratégias 2-4: tabela Produto_Fornecedor
  if (pfRows.length) {
    // 2: CNPJ+código
    let pf = pfRows.find((x) =>
      isMapeamentoAtivo(x) &&
      String(x.cnpj_fornecedor || '').replace(/\D/g, '') === cnpjForn &&
      x.codigo_produto_nf && String(x.codigo_produto_nf) === String(it.codigo_produto_nf));
    if (pf && prodById[pf.id_produto] && isAtivo(prodById[pf.id_produto]))
      return { prod: prodById[pf.id_produto], metodo: 'Mapeamento CNPJ+código' };

    // 3: EAN
    if (it.codigo_barras) {
      pf = pfRows.find((x) =>
        isMapeamentoAtivo(x) && x.ean && String(x.ean) === String(it.codigo_barras));
      if (pf && prodById[pf.id_produto] && isAtivo(prodById[pf.id_produto]))
        return { prod: prodById[pf.id_produto], metodo: 'Mapeamento EAN' };
    }

    // 4: CNPJ+descrição normalizada
    if (descNorm) {
      pf = pfRows.find((x) =>
        isMapeamentoAtivo(x) &&
        String(x.cnpj_fornecedor || '').replace(/\D/g, '') === cnpjForn &&
        String(x.descricao_normalizada) === descNorm);
      if (pf && prodById[pf.id_produto] && isAtivo(prodById[pf.id_produto]))
        return { prod: prodById[pf.id_produto], metodo: 'Mapeamento descrição' };
    }
  }

  // Estratégia 5: Alias — descrição normalizada
  if (aliasRows.length && descNorm) {
    const al = aliasRows.find((a) =>
      String(a.ativo || 'SIM').toUpperCase() === 'SIM' &&
      normalizarDesc(a.alias) === descNorm);
    if (al && prodById[al.id_produto] && isAtivo(prodById[al.id_produto]))
      return { prod: prodById[al.id_produto], metodo: 'Alias' };
  }

  return null;
}
