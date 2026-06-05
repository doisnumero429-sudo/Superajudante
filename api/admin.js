// api/admin.js
// Endpoint unico para recursos administrativos (economiza Serverless Functions
// no plano Hobby da Vercel, que limita a 12). O recurso vem em ?recurso=...
//   recurso=categorias          GET lista | POST { acao: criar|renomear|ativar|desativar }
//   recurso=config              GET lista | POST { chave, valor }
//   recurso=embalagens          GET ?id_produto= | POST { acao: criar|editar|remover }
//   recurso=entrada             POST -> entrada manual de produto (com/sem cadastro)
//   recurso=produto-editar      POST { id_produto, ...campos } -> edita campos do produto (sem estoque)
//   recurso=treino-contexto     GET  -> JSON com todo o contexto para o ChatGPT
//   recurso=treino-desconhecidos GET -> JSON com produtos pendentes agrupados
//   recurso=treino-validar      POST { json } -> valida o catalogo revisado
//   recurso=treino-importar     POST { json, substituir? } -> importa (aditivo)
//   recurso=treino-fila-add       POST { chave, nota, fornecedor, itens } -> adiciona NF-e à esteira
//   recurso=treino-fila-listar    GET  -> lista fila com stats e desconhecidos agrupados
//   recurso=treino-fila-limpar    POST -> limpa Treino_Fila e Treino_Itens (sem tocar estoque)
//   recurso=treino-resetar-tudo   POST -> apaga esteira + mapeamentos + aliases + embalagens + produtos sem estoque/histórico
//   recurso=treino-fila-pacote    GET  -> retorna contexto + desconhecidos da esteira para ChatGPT
//   recurso=produto-verificar-historico GET ?id_produto -> verifica se produto tem historico
//   recurso=produto-excluir       POST { id_produto } -> exclui definitivamente ou inativa
//   recurso=produto-inativar      POST { id_produto } -> inativa produto
//   recurso=produto-reativar      POST { id_produto } -> reativa produto inativo
//   recurso=auditoria-cadastro    GET  -> detecta inconsistencias (sem categoria, duplicados, sem embalagem)

import { readRows, appendRow, updateRow, nextId, readConfig, deleteAllRows, deleteRow, deleteRowsWhere } from './_lib/db.js';
import { normalizarDesc, parseNfe } from './_lib/parser.js';
import { entradaEstoque } from './_lib/estoque.js';
import { encontrarProduto } from './_lib/reconhecimento.js';
import { json, preflight, readBody, nowStr } from './_lib/util.js';

const CONFIG_EDITAVEL = {
  CNPJ_RESTAURANTE: 'CNPJ do restaurante (valida o destinatario das notas)',
  NOME_RESTAURANTE: 'Nome do restaurante (aparece nos arquivos do ChatGPT)',
  MAX_TENTATIVAS_NFE: 'Maximo de tentativas por chave NF-e',
  INTERVALO_TENTATIVAS_MS: 'Intervalo minimo entre tentativas por chave (ms)',
  LIMITE_CONSULTAS_SEGUNDO: 'Maximo de consultas por segundo a API Meu Danfe',
};

export default async function handler(req, res) {
  if (preflight(req, res)) return;

  const recurso = (req.query?.recurso) || new URL(req.url, 'http://x').searchParams.get('recurso');

  try {
    if (recurso === 'categorias') return await categorias(req, res);
    if (recurso === 'config') return await config(req, res);
    if (recurso === 'embalagens') return await embalagens(req, res);
    if (recurso === 'entrada') return await entrada(req, res);
    if (recurso === 'produto-editar') return await produtoEditar(req, res);
    if (recurso === 'treino-contexto') return await treinoContexto(req, res);
    if (recurso === 'treino-desconhecidos') return await treinoDesconhecidos(req, res);
    if (recurso === 'treino-validar') return await treinoValidar(req, res);
    if (recurso === 'treino-importar') return await treinoImportar(req, res);
    if (recurso === 'treino-fila-add') return await treinoFilaAdd(req, res);
    if (recurso === 'treino-fila-listar') return await treinoFilaListar(req, res);
    if (recurso === 'treino-fila-limpar') return await treinoFilaLimpar(req, res);
    if (recurso === 'treino-resetar-tudo') return await treinoResetarTudo(req, res);
    if (recurso === 'treino-fila-pacote') return await treinoFilaPacote(req, res);
    if (recurso === 'produto-verificar-historico') return await produtoVerificarHistorico(req, res);
    if (recurso === 'produto-excluir') return await produtoExcluir(req, res);
    if (recurso === 'produto-inativar') return await produtoInativar(req, res);
    if (recurso === 'produto-reativar') return await produtoReativar(req, res);
    if (recurso === 'auditoria-cadastro') return await auditoriaCadastro(req, res);
    if (recurso === 'reprocessar-aprendizado') return await reprocessarAprendizado(req, res);
    if (recurso === 'produto-historico') return await produtoHistorico(req, res);
    if (recurso === 'movimentacao-detalhe') return await movimentacaoDetalhe(req, res);
    return json(res, 400, { erro: 'Recurso invalido.' });
  } catch (e) {
    return json(res, 500, { erro: e.message });
  }
}

// ---------- helpers ----------
// Acha uma categoria por nome (ou cria) e devolve o id.
async function garantirCategoria(nome, cache) {
  const n = String(nome || '').trim();
  if (!n) return '';
  const cats = cache || await readRows('Categorias');
  const achado = cats.find((c) =>
    String(c.nome_categoria || '').trim().toLowerCase() === n.toLowerCase()
    && String(c.ativo || 'SIM').toUpperCase() === 'SIM');
  if (achado) return achado.id_categoria;
  const id = await nextId('Categorias', 'id_categoria', 'CAT');
  await appendRow('Categorias', { id_categoria: id, nome_categoria: n, descricao: '', ativo: 'SIM' });
  if (cache) cache.push({ id_categoria: id, nome_categoria: n, ativo: 'SIM' });
  return id;
}

// Retorna o nome de referência do objeto (aceita nome_interno ou produto_interno)
function getNomeRef(obj) {
  return String(obj.nome_interno || obj.produto_interno || obj.nome || obj.produto || obj.chave || '').trim();
}

// Valida categoria_id contra cats reais; se invalido/ausente, tenta resolver pelo nome
async function resolverCategoria(p, cats) {
  if (p.categoria_id) {
    const catExiste = cats.find((c) => c.id_categoria === p.categoria_id && String(c.ativo || 'SIM').toUpperCase() === 'SIM');
    if (catExiste) return p.categoria_id;
  }
  if (p.categoria) return await garantirCategoria(p.categoria, cats);
  return '';
}

// Registra múltiplas chaves no mapa id_produto
function registrarIdPorChave(map, obj, id) {
  const keys = [obj.chave, obj.nome_interno, obj.produto_interno, obj.nome, obj.produto, getNomeRef(obj)];
  for (const k of keys) { if (k) map[String(k)] = id; }
}

// Resolve id_produto a partir de múltiplos campos possíveis
function resolverIdProduto(obj, map) {
  return obj.id_produto
    || map[String(obj.chave || '')]
    || map[String(obj.nome_interno || '')]
    || map[String(obj.produto_interno || '')]
    || map[String(obj.nome || '')]
    || map[String(obj.produto || '')]
    || map[getNomeRef(obj)]
    || null;
}

// ---------- CATEGORIAS ----------
async function categorias(req, res) {
  if (req.method === 'GET') {
    const rows = await readRows('Categorias');
    return json(res, 200, { rows });
  }
  if (req.method !== 'POST') return json(res, 405, { erro: 'Metodo nao permitido' });

  const b = await readBody(req);
  const acao = b.acao || 'criar';
  const cats = await readRows('Categorias');

  if (acao === 'criar') {
    const nome = String(b.nome_categoria || '').trim();
    if (!nome) return json(res, 400, { erro: 'Informe o nome da categoria.' });
    const existe = cats.find((c) =>
      String(c.nome_categoria || '').trim().toLowerCase() === nome.toLowerCase()
      && String(c.ativo || 'SIM').toUpperCase() === 'SIM');
    if (existe) return json(res, 200, { ok: true, id_categoria: existe.id_categoria, nome_categoria: existe.nome_categoria, ja_existia: true });
    const id = await nextId('Categorias', 'id_categoria', 'CAT');
    await appendRow('Categorias', { id_categoria: id, nome_categoria: nome, descricao: b.descricao || '', ativo: 'SIM' });
    return json(res, 200, { ok: true, id_categoria: id, nome_categoria: nome });
  }

  const c = cats.find((x) => x.id_categoria === b.id_categoria);
  if (!c) return json(res, 404, { erro: 'Categoria nao encontrada.' });

  if (acao === 'renomear') {
    const nome = String(b.nome_categoria || '').trim();
    if (!nome) return json(res, 400, { erro: 'Informe o novo nome.' });
    await updateRow('Categorias', c.id_categoria, { ...c, nome_categoria: nome });
    return json(res, 200, { ok: true });
  }
  if (acao === 'ativar' || acao === 'desativar') {
    await updateRow('Categorias', c.id_categoria, { ...c, ativo: acao === 'ativar' ? 'SIM' : 'NAO' });
    return json(res, 200, { ok: true });
  }
  return json(res, 400, { erro: 'Acao invalida.' });
}

// ---------- CONFIG ----------
async function config(req, res) {
  if (req.method === 'GET') {
    const rows = await readRows('Configuracoes');
    const mapa = Object.fromEntries(rows.map((r) => [r.chave, r.valor]));
    const lista = Object.entries(CONFIG_EDITAVEL).map(([chave, descricao]) => ({
      chave, descricao, valor: mapa[chave] ?? '',
    }));
    return json(res, 200, { rows: lista });
  }
  if (req.method !== 'POST') return json(res, 405, { erro: 'Metodo nao permitido' });

  const b = await readBody(req);
  const chave = String(b.chave || '');
  if (!Object.prototype.hasOwnProperty.call(CONFIG_EDITAVEL, chave)) {
    return json(res, 400, { erro: 'Configuracao nao editavel.' });
  }
  const valor = String(b.valor ?? '');
  const rows = await readRows('Configuracoes');
  const existe = rows.find((r) => r.chave === chave);
  if (existe) await updateRow('Configuracoes', chave, { ...existe, valor });
  else await appendRow('Configuracoes', { chave, valor, descricao: CONFIG_EDITAVEL[chave] });
  return json(res, 200, { ok: true });
}

// ---------- EMBALAGENS ----------
// Garante que exista uma embalagem para o produto; cria se necessario. Devolve a linha.
async function garantirEmbalagem(idProduto, dados, todas) {
  const fator = parseFloat(dados.fator) || 1;
  const desc = String(dados.descricao || '').trim() || `${dados.sigla || 'EMB'} x${fator}`;
  const lista = todas || await readRows('Embalagens');
  const achado = lista.find((e) => e.id_produto === idProduto
    && String(e.descricao || '').trim().toLowerCase() === desc.toLowerCase()
    && String(e.ativo || 'SIM').toUpperCase() === 'SIM');
  if (achado) return achado;
  const agora = nowStr();
  const id = await nextId('Embalagens', 'id_embalagem', 'EMB');
  const nova = {
    id_embalagem: id,
    id_produto: idProduto,
    descricao: desc,
    sigla: String(dados.sigla || '').trim().toUpperCase(),
    fator,
    unidade_base: String(dados.unidade_base || 'UN').trim().toUpperCase(),
    permite_entrada: 'SIM', permite_saida: 'SIM', permite_inventario: 'SIM',
    padrao_entrada: 'NAO', padrao_saida: 'NAO', padrao_inventario: 'NAO',
    ativo: 'SIM', criado_em: agora, atualizado_em: agora,
  };
  await appendRow('Embalagens', nova);
  if (todas) todas.push(nova);
  return nova;
}

async function embalagens(req, res) {
  if (req.method === 'GET') {
    const idp = (req.query?.id_produto) || new URL(req.url, 'http://x').searchParams.get('id_produto');
    let rows = await readRows('Embalagens');
    rows = rows.filter((e) => String(e.ativo || 'SIM').toUpperCase() === 'SIM');
    if (idp) rows = rows.filter((e) => e.id_produto === idp);
    return json(res, 200, { rows });
  }
  if (req.method !== 'POST') return json(res, 405, { erro: 'Metodo nao permitido' });

  const b = await readBody(req);
  const acao = b.acao || 'criar';

  if (acao === 'criar') {
    if (!b.id_produto) return json(res, 400, { erro: 'Informe o id_produto.' });
    const emb = await garantirEmbalagem(b.id_produto, b);
    return json(res, 200, { ok: true, embalagem: emb });
  }
  const todas = await readRows('Embalagens');
  const e = todas.find((x) => x.id_embalagem === b.id_embalagem);
  if (!e) return json(res, 404, { erro: 'Embalagem nao encontrada.' });

  if (acao === 'editar') {
    const patch = { ...e, atualizado_em: nowStr() };
    ['descricao', 'sigla', 'fator', 'unidade_base'].forEach((k) => {
      if (b[k] !== undefined) patch[k] = k === 'fator' ? (parseFloat(b[k]) || 1) : b[k];
    });
    await updateRow('Embalagens', e.id_embalagem, patch);
    return json(res, 200, { ok: true });
  }
  if (acao === 'remover') {
    await updateRow('Embalagens', e.id_embalagem, { ...e, ativo: 'NAO', atualizado_em: nowStr() });
    return json(res, 200, { ok: true });
  }
  return json(res, 400, { erro: 'Acao invalida.' });
}

// ---------- ENTRADA MANUAL ----------
async function entrada(req, res) {
  if (req.method !== 'POST') return json(res, 405, { erro: 'Metodo nao permitido' });
  const b = await readBody(req);

  const quantidade = parseFloat(b.quantidade);
  if (!quantidade || quantidade <= 0) return json(res, 400, { erro: 'Informe a quantidade (> 0).' });

  const agora = b.data ? `${b.data} ${nowStr().slice(11)}` : nowStr();
  const produtos = await readRows('Produtos');
  let prod = null;

  // 1) Produto: existente ou novo
  if (b.id_produto) {
    prod = produtos.find((p) => p.id_produto === b.id_produto);
    if (!prod) return json(res, 404, { erro: 'Produto nao encontrado.' });
  } else {
    const nome = String(b.nome_interno || '').trim();
    if (!nome) return json(res, 400, { erro: 'Informe o nome do produto.' });
    const cats = await readRows('Categorias');
    const categoriaId = b.categoria_id || (b.categoria ? await garantirCategoria(b.categoria, cats) : '');
    const idProduto = await nextId('Produtos', 'id_produto', 'PRD');
    prod = {
      id_produto: idProduto,
      cnpj_fornecedor: String(b.fornecedor_cnpj || '').replace(/\D/g, ''),
      codigo_produto_nf: b.codigo_produto_nf || '',
      codigo_barras: b.codigo_barras || '',
      descricao_original_nf: nome,
      nome_interno: nome,
      categoria_id: categoriaId,
      fornecedor_principal_id: '',
      unidade_compra: b.unidade_estoque || 'UN',
      unidade_estoque: String(b.unidade_estoque || 'UN').toUpperCase(),
      quantidade_por_embalagem: parseFloat(b.fator) || 1,
      fator_conversao: parseFloat(b.fator) || 1,
      estoque_minimo: parseFloat(b.estoque_minimo) || 0,
      estoque_atual: 0,
      ultimo_custo_unitario: 0,
      custo_medio: 0,
      ativo: 'SIM',
      confirmado: 'SIM',
      observacoes: '',
      criado_em: agora,
      atualizado_em: agora,
    };
    await appendRow('Produtos', prod);
  }

  // 2) Embalagem -> fator
  let fator = 1; let embDesc = prod.unidade_estoque || 'UN';
  if (b.id_embalagem) {
    const embs = await readRows('Embalagens');
    const emb = embs.find((e) => e.id_embalagem === b.id_embalagem);
    if (emb) { fator = parseFloat(emb.fator) || 1; embDesc = emb.descricao; }
  } else if (b.embalagem && (b.embalagem.descricao || b.embalagem.fator)) {
    const emb = await garantirEmbalagem(prod.id_produto, {
      ...b.embalagem, unidade_base: b.embalagem.unidade_base || prod.unidade_estoque,
    });
    fator = parseFloat(emb.fator) || 1; embDesc = emb.descricao;
  } else if (b.fator) {
    fator = parseFloat(b.fator) || 1;
  }

  // 3) Quantidade convertida para unidade base
  const qtdBase = quantidade * fator;

  // 4) Custo unitario base (aceita total, por embalagem ou por unidade)
  let custoUnit = 0;
  if (b.valor_total !== undefined && b.valor_total !== '' && qtdBase > 0) {
    custoUnit = parseFloat(b.valor_total) / qtdBase;
  } else if (b.valor_embalagem !== undefined && b.valor_embalagem !== '' && fator > 0) {
    custoUnit = parseFloat(b.valor_embalagem) / fator;
  } else if (b.custo_unitario !== undefined && b.custo_unitario !== '') {
    custoUnit = parseFloat(b.custo_unitario) || 0;
  }

  // 5) Aplica entrada (mesma regra de custo medio da NF-e)
  const r = await entradaEstoque(prod, qtdBase, custoUnit, {
    data: agora, origem: 'MANUAL', motivo: 'entrada manual',
    usuario: b.usuario || 'manual',
    observacao: `${embDesc} x${quantidade}${b.observacao ? ' - ' + b.observacao : ''}`,
  });

  return json(res, 200, {
    ok: true,
    id_produto: prod.id_produto,
    nome_interno: prod.nome_interno,
    embalagem: embDesc,
    fator,
    quantidade_embalagens: quantidade,
    quantidade_base: Number(qtdBase.toFixed(3)),
    unidade_base: prod.unidade_estoque,
    custo_unitario: r.custo_unitario,
    custo_medio: r.custo_medio,
    estoque_atual: r.estoque_atual,
  });
}

// ---------- PRODUTO EDITAR ----------
// Campos editáveis: nome, categoria, unidade, ean unitário, preço venda, estoque mínimo, obs.
// NÃO altera: estoque_atual, custo_medio, ultimo_custo_unitario (apenas por entradas/saídas).
const CAMPOS_EDITAVEIS = [
  'nome_interno', 'categoria_id', 'subcategoria', 'unidade_estoque',
  'codigo_barras_unitario', 'preco_venda', 'estoque_minimo', 'observacoes',
];

async function produtoEditar(req, res) {
  if (req.method !== 'POST') return json(res, 405, { erro: 'Metodo nao permitido' });
  const b = await readBody(req);
  if (!b.id_produto) return json(res, 400, { erro: 'Informe o id_produto.' });

  const produtos = await readRows('Produtos');
  const prod = produtos.find((p) => p.id_produto === b.id_produto);
  if (!prod) return json(res, 404, { erro: 'Produto nao encontrado.' });

  const patch = { ...prod, atualizado_em: nowStr() };
  for (const k of CAMPOS_EDITAVEIS) {
    if (b[k] !== undefined) patch[k] = b[k];
  }

  // Marca confirmado se os três campos obrigatórios estiverem preenchidos
  if (patch.nome_interno && patch.categoria_id && patch.unidade_estoque) {
    patch.confirmado = 'SIM';
  }

  await updateRow('Produtos', prod.id_produto, patch);
  return json(res, 200, { ok: true, id_produto: prod.id_produto, confirmado: patch.confirmado });
}

// ---------- TREINAMENTO: CONTEXTO ----------
async function treinoContexto(req, res) {
  const [produtos, cats, fornecedores, pf, embs, aliases, cfg] = await Promise.all([
    readRows('Produtos'), readRows('Categorias'), readRows('Fornecedores'),
    readRows('Produto_Fornecedor'), readRows('Embalagens'), readRows('Aliases_Produto'),
    readConfig(),
  ]);
  const ativos = produtos.filter((p) => String(p.ativo || 'SIM').toUpperCase() === 'SIM' && String(p.produto_teste || 'NAO').toUpperCase() !== 'SIM');
  const pendentes = ativos.filter((p) => String(p.confirmado || 'NAO').toUpperCase() !== 'SIM');

  return json(res, 200, {
    schema_version: '1.0',
    tipo: 'contexto_super_ajudante',
    sistema: 'Super Ajudante Estoque',
    restaurante: cfg.NOME_RESTAURANTE || '',
    gerado_em: nowStr(),
    produtos_internos: ativos.map((p) => ({
      id_produto: p.id_produto, nome_interno: p.nome_interno,
      categoria_id: p.categoria_id, unidade_estoque: p.unidade_estoque,
      fator_conversao: p.fator_conversao, confirmado: p.confirmado || 'NAO',
    })),
    categorias: cats.map((c) => ({ id_categoria: c.id_categoria, nome_categoria: c.nome_categoria })),
    fornecedores: fornecedores.map((f) => ({ cnpj: f.cnpj, razao_social: f.razao_social, nome_fantasia: f.nome_fantasia })),
    mapeamentos_fornecedor_produto: pf,
    embalagens: embs.filter((e) => String(e.ativo || 'SIM').toUpperCase() === 'SIM'),
    aliases: aliases.filter((a) => String(a.ativo || 'SIM').toUpperCase() === 'SIM'),
    regras_internas: Object.entries(cfg).map(([chave, valor]) => ({ chave, valor })),
    produtos_pendentes: pendentes.map((p) => ({
      id_produto: p.id_produto, descricao_original_nf: p.descricao_original_nf,
      cnpj_fornecedor: p.cnpj_fornecedor, codigo_produto_nf: p.codigo_produto_nf,
    })),
  });
}

// ---------- TREINAMENTO: PRODUTOS DESCONHECIDOS (agrupados) ----------
async function treinoDesconhecidos(req, res) {
  const [produtos, itens, notas, fornecedores, cfg] = await Promise.all([
    readRows('Produtos'), readRows('Itens_Nota'), readRows('Notas_Fiscais'),
    readRows('Fornecedores'), readConfig(),
  ]);
  const ativos = produtos.filter((p) => String(p.ativo || 'SIM').toUpperCase() === 'SIM' && String(p.produto_teste || 'NAO').toUpperCase() !== 'SIM');
  const pendentes = ativos.filter((p) => String(p.confirmado || 'NAO').toUpperCase() !== 'SIM');
  const conhecidos = ativos.length - pendentes.length;

  const notaById = Object.fromEntries(notas.map((n) => [n.id_nota, n]));
  const fornByCnpj = Object.fromEntries(fornecedores.map((f) => [String(f.cnpj).replace(/\D/g, ''), f]));

  // Agrupa ocorrencias dos itens por produto pendente.
  const porProduto = {};
  for (const it of itens) {
    if (!it.id_produto) continue;
    (porProduto[it.id_produto] = porProduto[it.id_produto] || []).push(it);
  }

  const lista = pendentes.map((p) => {
    const ocorr = porProduto[p.id_produto] || [];
    const ult = ocorr[ocorr.length - 1] || {};
    const notasIds = [...new Set(ocorr.map((o) => o.id_nota).filter(Boolean))];
    const chaves = notasIds.map((id) => notaById[id]?.chave_nfe).filter(Boolean);
    const cnpj = String(p.cnpj_fornecedor || '').replace(/\D/g, '');
    return {
      item_id: ult.id_item || '',
      produto_id: p.id_produto,
      cnpj_fornecedor: cnpj,
      nome_fornecedor: fornByCnpj[cnpj]?.razao_social || '',
      codigo_produto_fornecedor: p.codigo_produto_nf || '',
      ean: p.codigo_barras || '',
      descricao_original_nfe: p.descricao_original_nf || '',
      descricao_normalizada: normalizarDesc(p.descricao_original_nf),
      unidade_nfe: ult.unidade_nf || p.unidade_compra || '',
      quantidade_nfe: ult.quantidade_nf || '',
      valor_total: ult.valor_total_nf || '',
      valor_unitario_nfe: ult.valor_unitario_nf || '',
      data_emissao: notaById[ult.id_nota]?.data_emissao || '',
      ocorrencias: ocorr.length,
      notas_em_que_apareceu: chaves,
      campos_pendentes: ['nome_interno', 'categoria'].filter((k) => {
        if (k === 'categoria') return !p.categoria_id;
        return !p.nome_interno || p.nome_interno === p.descricao_original_nf;
      }),
    };
  });

  return json(res, 200, {
    schema_version: '1.0',
    tipo: 'produtos_desconhecidos_para_gpt',
    sistema: 'Super Ajudante Estoque',
    restaurante: cfg.NOME_RESTAURANTE || '',
    gerado_em: nowStr(),
    resumo: {
      notas_analisadas: notas.length,
      itens_totais: itens.length,
      produtos_unicos: ativos.length,
      produtos_ja_conhecidos: conhecidos,
      produtos_desconhecidos: pendentes.length,
    },
    itens: lista,
  });
}

// ---------- TREINAMENTO: VALIDAR ----------
function validarCatalogo(j) {
  const erros = [];
  if (!j || typeof j !== 'object') { erros.push('JSON invalido.'); return { erros }; }
  if (!j.schema_version) erros.push('Falta "schema_version".');
  if (j.tipo !== 'catalogo_revisado_gpt') erros.push('"tipo" deve ser "catalogo_revisado_gpt".');
  const arr = (k) => (Array.isArray(j[k]) ? j[k] : null);
  const produtos = arr('produtos_confirmados');
  const mapeamentos = arr('mapeamentos_confirmados');
  const embs = arr('embalagens_confirmadas');
  if (produtos === null) erros.push('"produtos_confirmados" deve ser um array.');
  if (mapeamentos === null) erros.push('"mapeamentos_confirmados" deve ser um array.');
  if (embs === null) erros.push('"embalagens_confirmadas" deve ser um array.');

  (produtos || []).forEach((p, i) => {
    if (!String(p.nome_interno || p.produto_interno || '').trim()) erros.push(`Produto #${i + 1}: falta nome_interno (ou produto_interno).`);
    if (!String(p.categoria || p.categoria_id || '').trim()) erros.push(`Produto #${i + 1}: falta categoria.`);
    if (!String(p.unidade_estoque || p.unidade_base || '').trim()) erros.push(`Produto #${i + 1}: falta unidade base.`);
  });
  (embs || []).forEach((e, i) => {
    if (!(parseFloat(e.fator) > 0)) erros.push(`Embalagem #${i + 1}: fator deve ser maior que zero.`);
  });
  (mapeamentos || []).forEach((m, i) => {
    if (!String(m.cnpj_fornecedor || '').replace(/\D/g, '')) erros.push(`Mapeamento #${i + 1}: falta CNPJ do fornecedor.`);
  });

  return {
    erros,
    resumo: {
      produtos: (produtos || []).length,
      mapeamentos: (mapeamentos || []).length,
      embalagens: (embs || []).length,
      aliases: (arr('aliases_confirmados') || []).length,
      duvidas: (arr('itens_com_duvida') || []).length,
    },
  };
}

async function treinoValidar(req, res) {
  if (req.method !== 'POST') return json(res, 405, { erro: 'Metodo nao permitido' });
  const b = await readBody(req);
  let j = b.json;
  if (typeof j === 'string') {
    try { j = JSON.parse(j); } catch { return json(res, 200, { ok: false, erros: ['O texto colado nao e um JSON valido.'] }); }
  }
  const { erros, resumo } = validarCatalogo(j);
  return json(res, 200, { ok: erros.length === 0, erros, resumo });
}

// ---------- TREINAMENTO: IMPORTAR (aditivo) ----------
async function treinoImportar(req, res) {
  if (req.method !== 'POST') return json(res, 405, { erro: 'Metodo nao permitido' });
  const b = await readBody(req);
  let j = b.json;
  if (typeof j === 'string') {
    try { j = JSON.parse(j); } catch { return json(res, 400, { erro: 'JSON invalido.' }); }
  }
  const { erros } = validarCatalogo(j);
  if (erros.length) return json(res, 400, { erro: 'O arquivo tem informacoes faltando. Corrija antes de importar.', erros });

  const substituir = b.substituir === true;
  const agora = nowStr();
  const relatorio = {
    produtos_criados: 0, produtos_atualizados: 0, conflitos: [],
    mapeamentos_criados: 0, mapeamentos_conflito: 0,
    embalagens_criadas: 0,
    aliases_criados: 0, aliases_sem_produto: [],
    categoria_id_invalida: [],
  };

  const produtos = await readRows('Produtos');
  const cats = await readRows('Categorias');
  const pfTodos = await readRows('Produto_Fornecedor');
  const embsTodas = await readRows('Embalagens');

  // mapa "chave/nome do produto no JSON" -> id_produto real (multiplas chaves por produto)
  const idPorChave = {};

  for (const p of (j.produtos_confirmados || [])) {
    const nome = getNomeRef(p);
    if (!nome) {
      relatorio.conflitos.push({ nome_interno: '?', motivo: 'nome_interno ausente no JSON.' });
      continue;
    }
    const categoriaId = await resolverCategoria(p, cats);
    if (p.categoria_id && !categoriaId) {
      relatorio.categoria_id_invalida.push({ nome_interno: nome, categoria_id_recebida: p.categoria_id });
    }
    const confirmado = (nome && categoriaId) ? 'SIM' : 'NAO';
    const unidade = String(p.unidade_estoque || p.unidade_base || 'UN').toUpperCase();
    const cnpj = String(p.cnpj_fornecedor || '').replace(/\D/g, '');
    const codigo = String(p.codigo_produto_nf || p.codigo_produto_fornecedor || '');

    let alvo = null;
    if (p.id_produto) alvo = produtos.find((x) => x.id_produto === p.id_produto);
    if (!alvo && cnpj && codigo) {
      alvo = produtos.find((x) => String(x.cnpj_fornecedor).replace(/\D/g, '') === cnpj && String(x.codigo_produto_nf) === codigo);
    }
    if (!alvo) alvo = produtos.find((x) => normalizarDesc(x.nome_interno) === normalizarDesc(nome));

    if (alvo) {
      const jaConfirmado = String(alvo.confirmado || 'NAO').toUpperCase() === 'SIM';
      if (jaConfirmado && !substituir) {
        relatorio.conflitos.push({ id_produto: alvo.id_produto, nome_interno: alvo.nome_interno, motivo: 'Produto ja confirmado.' });
        registrarIdPorChave(idPorChave, p, alvo.id_produto);
        continue;
      }
      await updateRow('Produtos', alvo.id_produto, {
        ...alvo, nome_interno: nome || alvo.nome_interno,
        categoria_id: categoriaId || alvo.categoria_id,
        subcategoria: p.subcategoria || alvo.subcategoria || '',
        unidade_estoque: unidade || alvo.unidade_estoque,
        // Preenche cnpj_fornecedor e codigo_produto_nf somente se ainda estiverem vazios
        cnpj_fornecedor: String(alvo.cnpj_fornecedor || '').replace(/\D/g, '') || cnpj || '',
        codigo_produto_nf: alvo.codigo_produto_nf || codigo || '',
        confirmado, atualizado_em: agora,
      });
      relatorio.produtos_atualizados += 1;
      registrarIdPorChave(idPorChave, p, alvo.id_produto);
    } else {
      const id = await nextId('Produtos', 'id_produto', 'PRD');
      const novo = {
        id_produto: id, cnpj_fornecedor: cnpj, codigo_produto_nf: codigo,
        codigo_barras: p.ean || '', descricao_original_nf: p.descricao_original_nfe || nome,
        nome_interno: nome, categoria_id: categoriaId,
        subcategoria: p.subcategoria || '',
        fornecedor_principal_id: '',
        unidade_compra: p.unidade_nfe || unidade, unidade_estoque: unidade,
        quantidade_por_embalagem: 1, fator_conversao: 1,
        estoque_minimo: parseFloat(p.estoque_minimo) || 0, estoque_atual: 0,
        ultimo_custo_unitario: 0, custo_medio: 0, ativo: 'SIM', confirmado,
        observacoes: '', criado_em: agora, atualizado_em: agora,
      };
      await appendRow('Produtos', novo);
      produtos.push(novo);
      relatorio.produtos_criados += 1;
      registrarIdPorChave(idPorChave, p, id);

      // Auto-cria embalagem base (fator 1) para o produto novo se ainda nao houver
      const jaTemEmb = embsTodas.some((e) => e.id_produto === id && String(e.ativo || 'SIM').toUpperCase() === 'SIM');
      if (!jaTemEmb) {
        await garantirEmbalagem(id, { fator: 1, sigla: unidade, unidade_base: unidade, descricao: `${unidade} x1` }, embsTodas);
        relatorio.embalagens_criadas += 1;
      }
    }
  }

  // embalagens (vindas do JSON do ChatGPT)
  for (const e of (j.embalagens_confirmadas || [])) {
    const idp = resolverIdProduto(e, idPorChave);
    if (!idp) continue;
    const antes = embsTodas.length;
    await garantirEmbalagem(idp, e, embsTodas);
    if (embsTodas.length > antes) relatorio.embalagens_criadas += 1;
  }

  // mapeamentos fornecedor/produto
  for (const m of (j.mapeamentos_confirmados || [])) {
    const idp = resolverIdProduto(m, idPorChave);
    if (!idp) {
      relatorio.conflitos.push({ nome: getNomeRef(m) || '?', motivo: 'Mapeamento: produto nao localizado pelo nome/chave.' });
      continue;
    }
    const cnpj = String(m.cnpj_fornecedor || '').replace(/\D/g, '');
    const codigo = String(m.codigo_produto_nf || m.codigo_produto_fornecedor || '');

    // Detecta conflito: mesmo CNPJ+codigo ja mapeado para produto DIFERENTE
    const conflito = pfTodos.find((x) =>
      String(x.cnpj_fornecedor).replace(/\D/g, '') === cnpj && String(x.codigo_produto_nf) === codigo
      && x.id_produto !== idp && String(x.ativo || 'SIM').toUpperCase() === 'SIM');
    if (conflito) {
      relatorio.mapeamentos_conflito += 1;
      relatorio.conflitos.push({ nome: getNomeRef(m), cnpj, codigo, motivo: `CNPJ+codigo ja mapeado para produto ${conflito.id_produto}.` });
      continue;
    }

    const existe = pfTodos.find((x) => x.id_produto === idp
      && String(x.cnpj_fornecedor).replace(/\D/g, '') === cnpj && String(x.codigo_produto_nf) === codigo);
    if (existe) continue;
    const id = await nextId('Produto_Fornecedor', 'id_pf', 'PF');
    const nova = {
      id_pf: id, id_produto: idp, cnpj_fornecedor: cnpj, nome_fornecedor: m.nome_fornecedor || '',
      codigo_produto_nf: codigo, ean: m.ean || '', descricao_original: m.descricao_original || '',
      descricao_normalizada: normalizarDesc(m.descricao_original || m.descricao_normalizada || ''),
      unidade_nf: m.unidade_nf || '', confirmado_pelo_usuario: 'SIM', origem_confirmacao: 'CHATGPT',
      vezes_utilizado: 0, ultima_utilizacao: '', ativo: 'SIM', criado_em: agora, atualizado_em: agora,
    };
    await appendRow('Produto_Fornecedor', nova);
    pfTodos.push(nova);
    relatorio.mapeamentos_criados += 1;
  }

  // aliases
  for (const a of (j.aliases_confirmados || [])) {
    const idp = resolverIdProduto(a, idPorChave);
    const alias = String(a.alias || '').trim();
    if (!idp) {
      relatorio.aliases_sem_produto.push({ alias: alias || '?', motivo: 'Produto nao encontrado pelo nome/chave.' });
      continue;
    }
    if (!alias) {
      relatorio.aliases_sem_produto.push({ alias: '?', id_produto: idp, motivo: 'Campo alias vazio.' });
      continue;
    }
    const id = await nextId('Aliases_Produto', 'id_alias', 'AL');
    await appendRow('Aliases_Produto', {
      id_alias: id, id_produto: idp, alias, origem: a.origem || 'CHATGPT', ativo: 'SIM', criado_em: agora,
    });
    relatorio.aliases_criados += 1;
  }

  // auditoria (best-effort)
  try {
    const idImp = await nextId('Treino_Importacoes', 'id_importacao', 'TI');
    await appendRow('Treino_Importacoes', {
      id_importacao: idImp, criado_em: agora, origem: j.origem || 'chatgpt',
      resumo: `prod+${relatorio.produtos_criados}/upd${relatorio.produtos_atualizados} map+${relatorio.mapeamentos_criados} emb+${relatorio.embalagens_criadas} ali+${relatorio.aliases_criados} conf=${relatorio.conflitos.length}`,
      json_original: JSON.stringify(j).slice(0, 45000),
      status: relatorio.conflitos.length ? 'COM_CONFLITOS' : 'OK',
      produtos_criados: relatorio.produtos_criados, mapeamentos_criados: relatorio.mapeamentos_criados,
      embalagens_criadas: relatorio.embalagens_criadas, aliases_criados: relatorio.aliases_criados,
      conflitos: relatorio.conflitos.length, erros: '',
    });
  } catch { /* tabela de auditoria opcional */ }

  return json(res, 200, { ok: true, relatorio });
}

// ---------- AUDITORIA DO CADASTRO ----------
async function auditoriaCadastro(req, res) {
  const [produtos, cats, pfTodos, embs, aliases, fornecedores, itensNota] = await Promise.all([
    readRows('Produtos'), readRows('Categorias'),
    readRows('Produto_Fornecedor'), readRows('Embalagens'), readRows('Aliases_Produto'),
    readRows('Fornecedores').catch(() => []),
    readRows('Itens_Nota').catch(() => []),
  ]);

  const catIds = new Set(cats.filter((c) => String(c.ativo || 'SIM').toUpperCase() === 'SIM').map((c) => c.id_categoria));
  const prodById = Object.fromEntries(produtos.map((p) => [p.id_produto, p]));
  const ativos = produtos.filter((p) =>
    String(p.ativo || 'SIM').toUpperCase() === 'SIM' &&
    String(p.produto_teste || 'NAO').toUpperCase() !== 'SIM');

  const alertas = [];

  // 1. Produtos ativos sem categoria válida
  for (const p of ativos) {
    if (!p.categoria_id || !catIds.has(p.categoria_id))
      alertas.push({ tipo: 'sem_categoria', id_produto: p.id_produto, nome_interno: p.nome_interno, detalhe: p.categoria_id || '' });
  }

  // 2. Produtos ativos sem mapeamento fornecedor
  for (const p of ativos) {
    const temCnpjDireto = !!String(p.cnpj_fornecedor || '').replace(/\D/g, '');
    const temPf = pfTodos.some((pf) => pf.id_produto === p.id_produto && String(pf.ativo || 'SIM').toUpperCase() === 'SIM');
    if (!temCnpjDireto && !temPf)
      alertas.push({ tipo: 'sem_mapeamento', id_produto: p.id_produto, nome_interno: p.nome_interno });
  }

  // 3. Conflito: mesmo CNPJ+código mapeado para dois produtos diferentes
  const chaveParaProd = {};
  for (const pf of pfTodos) {
    if (String(pf.ativo || 'SIM').toUpperCase() !== 'SIM') continue;
    const cnpj = String(pf.cnpj_fornecedor || '').replace(/\D/g, '');
    const codigo = String(pf.codigo_produto_nf || '');
    if (!cnpj || !codigo) continue;
    const chave = `${cnpj}|${codigo}`;
    if (chaveParaProd[chave] && chaveParaProd[chave] !== pf.id_produto) {
      alertas.push({
        tipo: 'cnpj_codigo_duplicado', chave_duplicada: chave,
        produto_a: chaveParaProd[chave], produto_b: pf.id_produto,
        nome_a: prodById[chaveParaProd[chave]]?.nome_interno || '',
        nome_b: prodById[pf.id_produto]?.nome_interno || '',
      });
    } else { chaveParaProd[chave] = pf.id_produto; }
  }

  // 4. Produtos ativos sem embalagem
  for (const p of ativos) {
    if (!embs.some((e) => e.id_produto === p.id_produto && String(e.ativo || 'SIM').toUpperCase() === 'SIM'))
      alertas.push({ tipo: 'sem_embalagem', id_produto: p.id_produto, nome_interno: p.nome_interno });
  }

  // 5. Aliases apontando para produto inexistente ou inativo
  for (const a of aliases) {
    if (String(a.ativo || 'SIM').toUpperCase() !== 'SIM') continue;
    const prod = prodById[a.id_produto];
    if (!prod || String(prod.ativo || 'SIM').toUpperCase() !== 'SIM')
      alertas.push({ tipo: 'alias_produto_invalido', id_alias: a.id_alias, alias: a.alias, id_produto: a.id_produto });
  }

  // 6. Fornecedores sem CNPJ
  for (const f of fornecedores) {
    if (String(f.ativo || 'SIM').toUpperCase() !== 'SIM') continue;
    if (!String(f.cnpj || '').replace(/\D/g, ''))
      alertas.push({ tipo: 'fornecedor_sem_cnpj', id_produto: f.id_fornecedor, nome_interno: f.razao_social || f.nome_fantasia || '—' });
  }

  // 7. Unidade suspeita (nome indica unidade diferente da cadastrada)
  for (const p of ativos) {
    const nome = normalizarDesc(p.nome_interno || p.descricao_original_nf || '');
    const u = String(p.unidade_estoque || '').toUpperCase().replace(/\./g, '');
    let motivo = null;
    if (/\b(KILO|QUILOS?|KGS?)\b/.test(nome) && !['KG', 'G', 'GR'].includes(u))
      motivo = `nome indica peso mas unidade é "${p.unidade_estoque}"`;
    else if (/\b(LITROS?|LTS?)\b/.test(nome) && !['L', 'LT', 'ML'].includes(u))
      motivo = `nome indica litro mas unidade é "${p.unidade_estoque}"`;
    else if (/\b(ALFACE|RUCULA|COUVE|ESPINAFRE|REPOLHO|BROCOLIS|AGRIAO)\b/.test(nome) && u === 'UN')
      motivo = 'hortifruti tipicamente controlado em KG';
    else if (/\b(GARRAFA|FRASCO)\b/.test(nome) && ['KG', 'G', 'GR'].includes(u))
      motivo = `embalagem líquida com unidade de peso "${p.unidade_estoque}"`;
    if (motivo) alertas.push({ tipo: 'unidade_suspeita', id_produto: p.id_produto, nome_interno: p.nome_interno, detalhe: motivo });
  }

  // 8. Possíveis duplicados (nomes muito similares na mesma categoria)
  const normGrupos = {};
  for (const p of ativos) {
    if (!p.nome_interno) continue;
    const k = `${p.categoria_id || '__'}|${normalizarDesc(p.nome_interno).slice(0, 20)}`;
    if (!normGrupos[k]) normGrupos[k] = [];
    normGrupos[k].push(p);
  }
  for (const grupo of Object.values(normGrupos)) {
    if (grupo.length < 2) continue;
    alertas.push({
      tipo: 'possivel_duplicado',
      id_produto: grupo[0].id_produto, nome_interno: grupo[0].nome_interno,
      nome_b: grupo.slice(1).map((p) => p.nome_interno).join(', '),
      detalhe: `${grupo.length} produtos com nome muito similar`,
    });
  }

  // 9. Itens de nota sem produto reconhecido (conta apenas)
  const itensOrfaos = itensNota.filter((it) => !it.id_produto || String(it.id_produto).trim() === '').length;

  const stats = {
    total_produtos_ativos: ativos.length,
    sem_categoria: alertas.filter((a) => a.tipo === 'sem_categoria').length,
    sem_mapeamento: alertas.filter((a) => a.tipo === 'sem_mapeamento').length,
    sem_embalagem: alertas.filter((a) => a.tipo === 'sem_embalagem').length,
    cnpj_codigo_duplicado: alertas.filter((a) => a.tipo === 'cnpj_codigo_duplicado').length,
    alias_produto_invalido: alertas.filter((a) => a.tipo === 'alias_produto_invalido').length,
    fornecedor_sem_cnpj: alertas.filter((a) => a.tipo === 'fornecedor_sem_cnpj').length,
    unidade_suspeita: alertas.filter((a) => a.tipo === 'unidade_suspeita').length,
    possivel_duplicado: alertas.filter((a) => a.tipo === 'possivel_duplicado').length,
    itens_nota_sem_produto: itensOrfaos,
  };

  return json(res, 200, { ok: true, stats, alertas, itens_nota_sem_produto: itensOrfaos });
}

// ---------- ESTEIRA DE TREINAMENTO: ADICIONAR NF-E ----------
async function treinoFilaAdd(req, res) {
  if (req.method !== 'POST') return json(res, 405, { erro: 'POST only' });
  const b = await readBody(req);
  const { chave, nota, fornecedor, itens = [] } = b;
  if (!chave || !nota || !fornecedor) return json(res, 400, { erro: 'Dados incompletos.' });

  const agora = nowStr();
  const cnpjForn = String(fornecedor.cnpj || '').replace(/\D/g, '');

  // Verifica duplicata na fila e carrega fornecedores existentes em paralelo
  let fila = [], fornecedoresDB = [];
  try {
    [fila, fornecedoresDB] = await Promise.all([
      readRows('Treino_Fila').catch(() => []),
      readRows('Fornecedores').catch(() => []),
    ]);
  } catch { /* ok */ }
  const jaExiste = fila.find((f) => String(f.chave_nfe).replace(/\D/g, '') === chave);
  if (jaExiste) return json(res, 409, { erro: 'Esta NF-e já está na esteira.', id_fila: jaExiste.id_fila });

  // Garantir fornecedor no cadastro
  if (cnpjForn && !fornecedoresDB.find((f) => String(f.cnpj).replace(/\D/g, '') === cnpjForn)) {
    const fornId = await nextId('Fornecedores', 'id_fornecedor', 'FOR');
    await appendRow('Fornecedores', {
      id_fornecedor: fornId, razao_social: fornecedor.razao_social || '',
      nome_fantasia: fornecedor.nome_fantasia || '', cnpj: cnpjForn,
      inscricao_estadual: fornecedor.inscricao_estadual || '',
      telefone: fornecedor.telefone || '', email: '',
      endereco: fornecedor.endereco || '', numero: fornecedor.numero || '',
      bairro: fornecedor.bairro || '', cidade: fornecedor.cidade || '',
      estado: fornecedor.estado || '', cep: fornecedor.cep || '',
      contato: '', observacoes: '', ativo: 'SIM',
    });
  }

  const totalRec = itens.filter((it) => !it.produto_novo).length;
  const totalDesc = itens.filter((it) => it.produto_novo).length;

  const idFila = await nextId('Treino_Fila', 'id_fila', 'TF');
  await appendRow('Treino_Fila', {
    id_fila: idFila,
    chave_nfe: chave,
    numero_nota: nota.numero_nota || '',
    data_emissao: nota.data_emissao || '',
    cnpj_fornecedor: cnpjForn,
    nome_fornecedor: fornecedor.razao_social || '',
    status: 'OK',
    criado_em: agora,
    processado_em: agora,
    total_itens: itens.length,
    total_reconhecidos: totalRec,
    total_desconhecidos: totalDesc,
    total_duvidas: 0,
    erro: '',
  });

  for (const it of itens) {
    const idItem = await nextId('Treino_Itens', 'id_item_fila', 'TI');
    await appendRow('Treino_Itens', {
      id_item_fila: idItem,
      id_fila: idFila,
      chave_nfe: chave,
      cnpj_fornecedor: cnpjForn,
      nome_fornecedor: fornecedor.razao_social || '',
      codigo_produto_nf: it.codigo_produto_nf || '',
      ean: it.codigo_barras || '',
      descricao_original_nfe: it.descricao_original || '',
      descricao_normalizada: normalizarDesc(it.descricao_original || ''),
      unidade_nfe: it.unidade_nf || '',
      quantidade_nfe: it.quantidade_nf || 0,
      valor_total: it.valor_total_nf || 0,
      valor_unitario_nfe: it.valor_unitario_nf || 0,
      data_emissao: nota.data_emissao || '',
      produto_reconhecido: !it.produto_novo,
      id_produto_reconhecido: it.id_produto || '',
      nome_interno_sugerido: it.nome_interno || '',
      produto_novo: !!it.produto_novo,
      campos_pendentes: it.produto_novo ? JSON.stringify(['nome_interno', 'categoria']) : '[]',
      status_revisao: 'PENDENTE',
    });
  }

  // Criar vínculo produto_fornecedor para itens reconhecidos
  const itensCom = itens.filter((it) => !it.produto_novo && it.id_produto && cnpjForn);
  if (itensCom.length) {
    let pfTodos = [];
    try { pfTodos = await readRows('Produto_Fornecedor'); } catch { /* ok */ }
    const pfSet = new Set(pfTodos.map((pf) =>
      `${pf.id_produto}|${String(pf.cnpj_fornecedor).replace(/\D/g, '')}|${pf.codigo_produto_nf}`));
    for (const it of itensCom) {
      const codigo = String(it.codigo_produto_nf || '');
      const chavePf = `${it.id_produto}|${cnpjForn}|${codigo}`;
      if (pfSet.has(chavePf)) {
        const ex = pfTodos.find((pf) =>
          pf.id_produto === it.id_produto &&
          String(pf.cnpj_fornecedor).replace(/\D/g, '') === cnpjForn &&
          String(pf.codigo_produto_nf) === codigo);
        if (ex) await updateRow('Produto_Fornecedor', ex.id_pf, {
          ...ex, vezes_utilizado: (parseInt(ex.vezes_utilizado) || 0) + 1,
          ultima_utilizacao: agora, atualizado_em: agora,
        });
      } else {
        const id = await nextId('Produto_Fornecedor', 'id_pf', 'PF');
        await appendRow('Produto_Fornecedor', {
          id_pf: id, id_produto: it.id_produto, cnpj_fornecedor: cnpjForn,
          nome_fornecedor: fornecedor.razao_social || '', codigo_produto_nf: codigo,
          ean: it.codigo_barras || '', descricao_original: it.descricao_original || '',
          descricao_normalizada: normalizarDesc(it.descricao_original || ''),
          unidade_nf: it.unidade_nf || '', confirmado_pelo_usuario: 'SIM',
          origem_confirmacao: 'ESTEIRA', vezes_utilizado: 1,
          ultima_utilizacao: agora, ativo: 'SIM', criado_em: agora, atualizado_em: agora,
        });
        pfSet.add(chavePf);
      }
    }
  }

  return json(res, 200, {
    ok: true, id_fila: idFila,
    total_itens: itens.length, total_reconhecidos: totalRec, total_desconhecidos: totalDesc,
  });
}

// ---------- ESTEIRA: LISTAR ----------
async function treinoFilaListar(req, res) {
  let fila = [], itens = [];
  try { fila = await readRows('Treino_Fila'); } catch { /* ok */ }
  try { itens = await readRows('Treino_Itens'); } catch { /* ok */ }

  const totalRec = itens.filter((it) => !it.produto_novo).length;
  const totalDesc = itens.filter((it) => !!it.produto_novo).length;

  // Agrupa desconhecidos por CNPJ+codigo (ou CNPJ+descricao normalizada)
  const grupos = {};
  for (const it of itens) {
    if (!it.produto_novo) continue;
    const temCodigo = String(it.codigo_produto_nf || '').trim() !== '';
    const chaveAgrup = `${it.cnpj_fornecedor || ''}|${temCodigo ? it.codigo_produto_nf : it.descricao_normalizada}`;
    if (!grupos[chaveAgrup]) {
      grupos[chaveAgrup] = {
        cnpj_fornecedor: it.cnpj_fornecedor,
        nome_fornecedor: it.nome_fornecedor,
        codigo_produto_nf: it.codigo_produto_nf,
        ean: it.ean,
        descricao_original_nfe: it.descricao_original_nfe,
        descricao_normalizada: it.descricao_normalizada,
        unidade_nfe: it.unidade_nfe,
        quantidade_nfe: it.quantidade_nfe,
        valor_total: it.valor_total,
        valor_unitario_nfe: it.valor_unitario_nfe,
        data_emissao: it.data_emissao,
        ocorrencias: 0,
        notas_em_que_apareceu: [],
        observacao: temCodigo ? null : 'Código do produto não veio na NF-e. Chave baseada em CNPJ+descrição normalizada.',
      };
    }
    grupos[chaveAgrup].ocorrencias += 1;
    if (!grupos[chaveAgrup].notas_em_que_apareceu.includes(it.chave_nfe)) {
      grupos[chaveAgrup].notas_em_que_apareceu.push(it.chave_nfe);
    }
  }

  return json(res, 200, {
    fila,
    stats: {
      total_notas: fila.length,
      total_itens: itens.length,
      total_reconhecidos: totalRec,
      total_desconhecidos: totalDesc,
      produtos_agrupados: Object.keys(grupos).length,
    },
    desconhecidos_agrupados: Object.values(grupos),
  });
}

/// ---------- REPROCESSAR NF-E PARA APRENDIZADO ----------
// Relê XML de notas já importadas: garante fornecedor no cadastro, cria/reforça
// vínculos produto_fornecedor e lista itens sem reconhecimento.
// NÃO altera estoque, contas, custo médio ou nota fiscal.
// Requer schema_fase6.sql executado no Supabase.
async function reprocessarAprendizado(req, res) {
  if (req.method !== 'POST') return json(res, 405, { erro: 'POST only' });
  const b = await readBody(req);
  const chaveReq = b.chave ? String(b.chave).replace(/\D/g, '') : null;
  const xmlDireto = b.xml ? String(b.xml) : null;
  const agora = nowStr();

  let notasParaProcessar;
  if (xmlDireto) {
    // XML enviado diretamente (arquivo local), sem precisar estar no banco
    notasParaProcessar = [{ xml_original: xmlDireto, numero_nota: 'upload', chave_nfe: '' }];
  } else {
    const notasFiscais = await readRows('Notas_Fiscais');
    notasParaProcessar = chaveReq
      ? notasFiscais.filter((n) => String(n.chave_nfe).replace(/\D/g, '') === chaveReq)
      : notasFiscais.filter((n) => String(n.xml_original || '').length > 100);
    if (!notasParaProcessar.length) {
      return json(res, 404, { erro: chaveReq ? 'NF-e não encontrada ou sem XML.' : 'Nenhuma nota com XML armazenado.' });
    }
  }

  const [produtos, pfTodos, aliasRows, fornecedoresDB] = await Promise.all([
    readRows('Produtos'), readRows('Produto_Fornecedor'),
    readRows('Aliases_Produto'), readRows('Fornecedores').catch(() => []),
  ]);

  const fornPorCnpj = Object.fromEntries(fornecedoresDB.map((f) => [String(f.cnpj).replace(/\D/g, ''), f]));
  const pfSet = new Set(pfTodos.map((pf) =>
    `${pf.id_produto}|${String(pf.cnpj_fornecedor).replace(/\D/g, '')}|${pf.codigo_produto_nf}`));

  const rel = {
    notas_processadas: 0, notas_sem_xml: 0, notas_com_erro: [],
    fornecedores_criados: 0, mapeamentos_criados: 0, mapeamentos_reforcados: 0,
    itens_pendentes_raw: [],
  };

  for (const nota of notasParaProcessar) {
    if (!nota.xml_original || nota.xml_original.length < 100) { rel.notas_sem_xml++; continue; }
    let parsed;
    try { parsed = parseNfe(nota.xml_original); } catch (e) {
      rel.notas_com_erro.push({ numero: nota.numero_nota, erro: e.message }); continue;
    }

    const cnpjForn = parsed.fornecedor.cnpj;

    // Garantir fornecedor
    if (cnpjForn && !fornPorCnpj[cnpjForn]) {
      const fornId = await nextId('Fornecedores', 'id_fornecedor', 'FOR');
      await appendRow('Fornecedores', {
        id_fornecedor: fornId, razao_social: parsed.fornecedor.razao_social,
        nome_fantasia: parsed.fornecedor.nome_fantasia, cnpj: cnpjForn,
        inscricao_estadual: parsed.fornecedor.inscricao_estadual,
        telefone: parsed.fornecedor.telefone, email: '',
        endereco: parsed.fornecedor.endereco, numero: parsed.fornecedor.numero,
        bairro: parsed.fornecedor.bairro, cidade: parsed.fornecedor.cidade,
        estado: parsed.fornecedor.estado, cep: parsed.fornecedor.cep,
        contato: '', observacoes: '', ativo: 'SIM',
      });
      fornPorCnpj[cnpjForn] = { cnpj: cnpjForn, razao_social: parsed.fornecedor.razao_social };
      rel.fornecedores_criados++;
    }

    // Processar itens
    for (const it of parsed.itens) {
      const result = encontrarProduto(it, { produtos, pfRows: pfTodos, aliasRows, cnpjForn });
      if (!result) {
        rel.itens_pendentes_raw.push({
          nota_numero: nota.numero_nota, descricao: it.descricao_original,
          codigo_produto_nf: it.codigo_produto_nf, ean: it.codigo_barras,
          ncm: it.ncm, cnpj_fornecedor: cnpjForn,
          fornecedor: parsed.fornecedor.razao_social,
        });
        continue;
      }

      const codigo = String(it.codigo_produto_nf || '');
      const chavePf = `${result.prod.id_produto}|${cnpjForn}|${codigo}`;

      if (pfSet.has(chavePf)) {
        const ex = pfTodos.find((pf) =>
          pf.id_produto === result.prod.id_produto &&
          String(pf.cnpj_fornecedor).replace(/\D/g, '') === cnpjForn &&
          String(pf.codigo_produto_nf) === codigo);
        if (ex) {
          await updateRow('Produto_Fornecedor', ex.id_pf, {
            ...ex,
            vezes_utilizado: (parseInt(ex.vezes_utilizado) || 0) + 1,
            ultima_utilizacao: agora,
            ultimo_preco_unitario: it.custo_unitario_estoque || ex.ultimo_preco_unitario || 0,
            ncm: it.ncm || ex.ncm || '',
            atualizado_em: agora,
          });
          rel.mapeamentos_reforcados++;
        }
      } else {
        const id = await nextId('Produto_Fornecedor', 'id_pf', 'PF');
        const novo = {
          id_pf: id, id_produto: result.prod.id_produto, cnpj_fornecedor: cnpjForn,
          nome_fornecedor: parsed.fornecedor.razao_social, codigo_produto_nf: codigo,
          ean: it.codigo_barras || '', descricao_original: it.descricao_original || '',
          descricao_normalizada: normalizarDesc(it.descricao_original || ''),
          unidade_nf: it.unidade_nf || '', ncm: it.ncm || '',
          ultimo_preco_unitario: it.custo_unitario_estoque || 0,
          confirmado_pelo_usuario: 'SIM', origem_confirmacao: 'REPROCESSAMENTO',
          vezes_utilizado: 1, ultima_utilizacao: agora, ativo: 'SIM',
          criado_em: agora, atualizado_em: agora,
        };
        await appendRow('Produto_Fornecedor', novo);
        pfTodos.push(novo);
        pfSet.add(chavePf);
        rel.mapeamentos_criados++;
      }
    }

    rel.notas_processadas++;
  }

  // Agrupa pendentes por fornecedor+código
  const pendentesMap = {};
  for (const it of rel.itens_pendentes_raw) {
    const k = `${it.cnpj_fornecedor}|${it.codigo_produto_nf || it.descricao}`;
    if (!pendentesMap[k]) pendentesMap[k] = { ...it, ocorrencias: 0 };
    pendentesMap[k].ocorrencias++;
  }

  return json(res, 200, {
    ok: true,
    relatorio: {
      notas_processadas: rel.notas_processadas,
      notas_sem_xml: rel.notas_sem_xml,
      notas_com_erro: rel.notas_com_erro,
      fornecedores_criados: rel.fornecedores_criados,
      mapeamentos_criados: rel.mapeamentos_criados,
      mapeamentos_reforcados: rel.mapeamentos_reforcados,
      itens_pendentes: Object.values(pendentesMap).sort((a, b) => b.ocorrencias - a.ocorrencias),
    },
  });
}

// ---------- ESTEIRA: LIMPAR ----------
async function treinoFilaLimpar(req, res) {
  if (req.method !== 'POST') return json(res, 405, { erro: 'POST only' });
  try { await deleteAllRows('Treino_Itens'); } catch { /* ok se vazia */ }
  try { await deleteAllRows('Treino_Fila'); } catch { /* ok se vazia */ }
  return json(res, 200, { ok: true });
}

// ---------- ESTEIRA: RESETAR TUDO (para testes) ----------
async function treinoResetarTudo(req, res) {
  if (req.method !== 'POST') return json(res, 405, { erro: 'POST only' });

  // Apaga tudo que foi importado/treinado.
  // MANTÉM: Categorias e Configuracoes (regras do sistema).
  const tabelas = [
    'Treino_Itens', 'Treino_Fila', 'Treino_Importacoes',
    'Aliases_Produto', 'Produto_Fornecedor', 'Embalagens',
    'Contas_Pagar', 'Movimentacoes_Estoque', 'Itens_Nota',
    'Notas_Fiscais', 'Fornecedores', 'Produtos',
  ];

  const resultado = {};
  for (const t of tabelas) {
    try {
      await deleteAllRows(t);
      resultado[t] = 'ok';
    } catch (e) {
      resultado[t] = `erro: ${e.message}`;
    }
  }

  return json(res, 200, { ok: true, resultado });
}

// ---------- ESTEIRA: PACOTE COMPLETO PARA CHATGPT ----------
async function treinoFilaPacote(req, res) {
  // Contexto completo do sistema
  const [produtos, cats, fornecedores, pf, embs, aliases, cfg] = await Promise.all([
    readRows('Produtos'), readRows('Categorias'), readRows('Fornecedores'),
    readRows('Produto_Fornecedor'), readRows('Embalagens'), readRows('Aliases_Produto'),
    readConfig(),
  ]);
  const ativos = produtos.filter((p) => String(p.ativo || 'SIM').toUpperCase() === 'SIM' && String(p.produto_teste || 'NAO').toUpperCase() !== 'SIM');

  // Subcategorias agrupadas por categoria (para incluir no pacote do ChatGPT)
  const subcatsPorCat = {};
  ativos.forEach((p) => {
    if (p.subcategoria) {
      const k = p.categoria_id || '__';
      if (!subcatsPorCat[k]) subcatsPorCat[k] = new Set();
      subcatsPorCat[k].add(p.subcategoria);
    }
  });

  const contexto = {
    schema_version: '1.1', tipo: 'contexto_super_ajudante',
    sistema: 'Super Ajudante Estoque', restaurante: cfg.NOME_RESTAURANTE || 'Araçá Grill',
    gerado_em: nowStr(),
    categorias: cats
      .sort((a, b) => (a.nome_categoria || '').localeCompare(b.nome_categoria || '', 'pt-BR'))
      .map((c) => ({
        id_categoria: c.id_categoria,
        nome_categoria: c.nome_categoria,
        subcategorias: [...(subcatsPorCat[c.id_categoria] || [])].sort((a, b) => a.localeCompare(b, 'pt-BR')),
      })),
    produtos_confirmados_amostra: ativos
      .filter((p) => String(p.confirmado || 'NAO').toUpperCase() === 'SIM')
      .sort((a, b) => (a.nome_interno || '').localeCompare(b.nome_interno || '', 'pt-BR'))
      .slice(0, 200)
      .map((p) => ({ nome_interno: p.nome_interno, categoria_id: p.categoria_id, subcategoria: p.subcategoria || '', unidade_estoque: p.unidade_estoque, custo_medio: parseFloat(p.custo_medio || 0) })),
    fornecedores: fornecedores
      .sort((a, b) => (a.razao_social || '').localeCompare(b.razao_social || '', 'pt-BR'))
      .map((f) => ({ cnpj: f.cnpj, razao_social: f.razao_social })),
    mapeamentos_fornecedor_produto: pf,
    embalagens: embs.filter((e) => String(e.ativo || 'SIM').toUpperCase() === 'SIM'),
    aliases: aliases.filter((a) => String(a.ativo || 'SIM').toUpperCase() === 'SIM'),
  };

  // Desconhecidos da esteira
  let filaRows = [], itensRows = [];
  try { filaRows = await readRows('Treino_Fila'); } catch { /* ok */ }
  try { itensRows = await readRows('Treino_Itens'); } catch { /* ok */ }

  const temEsteira = filaRows.length > 0;
  let desconhecidos;

  if (temEsteira) {
    const grupos = {};
    for (const it of itensRows) {
      if (!it.produto_novo) continue;
      const temCodigo = String(it.codigo_produto_nf || '').trim() !== '';
      const chaveAgrup = `${it.cnpj_fornecedor || ''}|${temCodigo ? it.codigo_produto_nf : it.descricao_normalizada}`;
      if (!grupos[chaveAgrup]) {
        grupos[chaveAgrup] = {
          cnpj_fornecedor: it.cnpj_fornecedor, nome_fornecedor: it.nome_fornecedor,
          codigo_produto_nf: it.codigo_produto_nf, ean: it.ean,
          descricao_original_nfe: it.descricao_original_nfe,
          descricao_normalizada: it.descricao_normalizada,
          unidade_nfe: it.unidade_nfe, quantidade_nfe: it.quantidade_nfe,
          valor_total: it.valor_total, valor_unitario_nfe: it.valor_unitario_nfe,
          data_emissao: it.data_emissao, ocorrencias: 0, notas_em_que_apareceu: [],
          observacao: !String(it.codigo_produto_nf || '').trim()
            ? 'Código do produto não veio na NF-e. Chave baseada em CNPJ+descrição normalizada.' : null,
        };
      }
      grupos[chaveAgrup].ocorrencias += 1;
      if (!grupos[chaveAgrup].notas_em_que_apareceu.includes(it.chave_nfe)) {
        grupos[chaveAgrup].notas_em_que_apareceu.push(it.chave_nfe);
      }
    }
    desconhecidos = {
      schema_version: '1.0', tipo: 'produtos_desconhecidos_para_gpt',
      fonte: 'esteira_treinamento', restaurante: cfg.NOME_RESTAURANTE || 'Araçá Grill',
      gerado_em: nowStr(),
      resumo: {
        notas_na_esteira: filaRows.length,
        total_itens: itensRows.length,
        produtos_desconhecidos: Object.keys(grupos).length,
      },
      itens: Object.values(grupos),
    };
  } else {
    // fallback: produtos pendentes do banco
    const pendentes = ativos.filter((p) => String(p.confirmado || 'NAO').toUpperCase() !== 'SIM');
    desconhecidos = {
      schema_version: '1.0', tipo: 'produtos_desconhecidos_para_gpt',
      fonte: 'banco_pendentes',
      aviso: 'Esteira vazia. Usando produtos pendentes já existentes no cadastro.',
      restaurante: cfg.NOME_RESTAURANTE || 'Araçá Grill',
      gerado_em: nowStr(),
      resumo: { produtos_desconhecidos: pendentes.length },
      itens: pendentes.map((p) => ({
        produto_id: p.id_produto, cnpj_fornecedor: p.cnpj_fornecedor,
        codigo_produto_nf: p.codigo_produto_nf,
        descricao_original_nfe: p.descricao_original_nf,
        descricao_normalizada: normalizarDesc(p.descricao_original_nf || ''),
        unidade_nfe: p.unidade_compra || '',
      })),
    };
  }

  return json(res, 200, { tem_esteira: temEsteira, contexto, desconhecidos });
}

// ---------- PRODUTO: VERIFICAR HISTÓRICO ----------
async function produtoVerificarHistorico(req, res) {
  const id = (req.query?.id_produto) || new URL(req.url, 'http://x').searchParams.get('id_produto');
  if (!id) return json(res, 400, { erro: 'Informe o id_produto.' });

  const produtos = await readRows('Produtos');
  const prod = produtos.find((p) => p.id_produto === id);
  if (!prod) return json(res, 404, { erro: 'Produto nao encontrado.' });

  let movs = [], itens = [];
  try { movs = await readRows('Movimentacoes_Estoque'); } catch { /* ok */ }
  try { itens = await readRows('Itens_Nota'); } catch { /* ok */ }

  const temMovimentacao = movs.some((m) => m.id_produto === id);
  const temItensNota = itens.some((i) => i.id_produto === id);
  const temEstoqueAtual = parseFloat(prod.estoque_atual || 0) !== 0;
  const temHistorico = temMovimentacao || temItensNota || temEstoqueAtual;

  return json(res, 200, { tem_historico: temHistorico, tem_estoque: temEstoqueAtual, tem_movimentacao: temMovimentacao, tem_itens_nota: temItensNota });
}

// ---------- PRODUTO: EXCLUIR / INATIVAR / REATIVAR ----------
async function produtoExcluir(req, res) {
  if (req.method !== 'POST') return json(res, 405, { erro: 'Metodo nao permitido' });
  const b = await readBody(req);
  const id = b.id_produto;
  if (!id) return json(res, 400, { erro: 'Informe o id_produto.' });

  const produtos = await readRows('Produtos');
  const prod = produtos.find((p) => p.id_produto === id);
  if (!prod) return json(res, 404, { erro: 'Produto nao encontrado.' });

  let movs = [], itens = [];
  try { movs = await readRows('Movimentacoes_Estoque'); } catch { /* ok */ }
  try { itens = await readRows('Itens_Nota'); } catch { /* ok */ }

  const temMovimentacao = movs.some((m) => m.id_produto === id);
  const temItensNota = itens.some((i) => i.id_produto === id);
  const temEstoqueAtual = parseFloat(prod.estoque_atual || 0) !== 0;

  if (temMovimentacao || temItensNota || temEstoqueAtual) {
    await updateRow('Produtos', id, { ...prod, ativo: 'NAO', atualizado_em: nowStr() });
    return json(res, 200, { ok: true, acao: 'inativado', motivo: temEstoqueAtual ? 'estoque' : 'historico' });
  }

  try { await deleteRowsWhere('Aliases_Produto', 'id_produto', id); } catch { /* ok se vazia */ }
  try { await deleteRowsWhere('Embalagens', 'id_produto', id); } catch { /* ok se vazia */ }
  try { await deleteRowsWhere('Produto_Fornecedor', 'id_produto', id); } catch { /* ok se vazia */ }
  await deleteRow('Produtos', id);
  return json(res, 200, { ok: true, acao: 'excluido' });
}

async function produtoInativar(req, res) {
  if (req.method !== 'POST') return json(res, 405, { erro: 'Metodo nao permitido' });
  const b = await readBody(req);
  const id = b.id_produto;
  if (!id) return json(res, 400, { erro: 'Informe o id_produto.' });

  const produtos = await readRows('Produtos');
  const prod = produtos.find((p) => p.id_produto === id);
  if (!prod) return json(res, 404, { erro: 'Produto nao encontrado.' });

  await updateRow('Produtos', id, { ...prod, ativo: 'NAO', atualizado_em: nowStr() });
  return json(res, 200, { ok: true, acao: 'inativado' });
}

async function produtoReativar(req, res) {
  if (req.method !== 'POST') return json(res, 405, { erro: 'Metodo nao permitido' });
  const b = await readBody(req);
  const id = b.id_produto;
  if (!id) return json(res, 400, { erro: 'Informe o id_produto.' });

  const produtos = await readRows('Produtos');
  const prod = produtos.find((p) => p.id_produto === id);
  if (!prod) return json(res, 404, { erro: 'Produto nao encontrado.' });

  await updateRow('Produtos', id, { ...prod, ativo: 'SIM', atualizado_em: nowStr() });
  return json(res, 200, { ok: true, acao: 'reativado' });
}

// ---------- PRODUTO: HISTORICO ----------
async function produtoHistorico(req, res) {
  const idp = (req.query?.id_produto) || new URL(req.url, 'http://x').searchParams.get('id_produto');
  if (!idp) return json(res, 400, { erro: 'Informe id_produto.' });
  const [movs, notas, fornecedores] = await Promise.all([
    readRows('Movimentacoes_Estoque'),
    readRows('Notas_Fiscais').catch(() => []),
    readRows('Fornecedores').catch(() => []),
  ]);
  const notaById = Object.fromEntries(notas.map((n) => [n.id_nota, n]));
  const fornById = Object.fromEntries(fornecedores.map((f) => [f.id_fornecedor, f]));
  const lista = movs
    .filter((m) => m.id_produto === idp)
    .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')))
    .slice(0, 20)
    .map((m) => {
      const nota = m.id_nota ? notaById[m.id_nota] : null;
      const forn = nota ? fornById[nota.fornecedor_id] : null;
      return {
        id_movimentacao: m.id_movimentacao,
        data: m.data,
        tipo: m.tipo,
        quantidade: m.quantidade,
        custo_unitario: m.custo_unitario,
        valor_total: m.valor_total,
        origem: m.origem,
        motivo: m.motivo,
        observacao: m.observacao,
        numero_nota: nota?.numero_nota || '',
        nome_fornecedor: forn?.razao_social || nota?.cnpj_fornecedor || '',
      };
    });
  return json(res, 200, { rows: lista });
}

// ---------- MOVIMENTACAO: DETALHE ----------
async function movimentacaoDetalhe(req, res) {
  const idm = (req.query?.id_movimentacao) || new URL(req.url, 'http://x').searchParams.get('id_movimentacao');
  if (!idm) return json(res, 400, { erro: 'Informe id_movimentacao.' });
  const movs = await readRows('Movimentacoes_Estoque');
  const m = movs.find((x) => x.id_movimentacao === idm);
  if (!m) return json(res, 404, { erro: 'Movimentacao nao encontrada.' });
  const [prods, notas, fornecedores] = await Promise.all([
    readRows('Produtos').catch(() => []),
    readRows('Notas_Fiscais').catch(() => []),
    readRows('Fornecedores').catch(() => []),
  ]);
  const produto = prods.find((p) => p.id_produto === m.id_produto);
  const nota = m.id_nota ? notas.find((n) => n.id_nota === m.id_nota) : null;
  const fornecedor = nota ? fornecedores.find((f) => f.id_fornecedor === nota.fornecedor_id) : null;
  return json(res, 200, {
    movimentacao: m,
    produto: produto ? { nome_interno: produto.nome_interno, unidade_estoque: produto.unidade_estoque, id_produto: produto.id_produto } : null,
    nota: nota ? { numero_nota: nota.numero_nota, data_emissao: nota.data_emissao, valor_total_nota: nota.valor_total_nota, chave_nfe: nota.chave_nfe } : null,
    fornecedor: fornecedor ? { razao_social: fornecedor.razao_social, cnpj: fornecedor.cnpj } : null,
  });
}
