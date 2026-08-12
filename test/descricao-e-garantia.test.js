'use strict';
/*
 * Descrição e garantia editáveis pela Análise (12/08/2026).
 *
 * Pedido do Lucas (11/08): "colocarmos as opções de adicionar a descrição do anúncio e a
 * garantia". Até aqui o Checklist só dizia "Não preenchida" e "Não informada".
 *
 * O que estes testes protegem:
 *  - garantia sai em `sale_terms`, nunca em `attributes` (em attributes o PUT passa e a
 *    garantia não aparece no anúncio)
 *  - descrição herdada do catálogo/MLBU NÃO é a mesma coisa que descrição própria: o botão
 *    muda de "Editar" para "Escrever a sua", e o texto herdado vira ponto de partida
 *  - depois de salvar, o checklist e a nota acompanham — um "❌" que sobrevive ao próprio
 *    salvamento faz o vendedor salvar de novo
 *  - a recusa do proxy chega com o texto limpo e vira um clique, em vez de mandar o
 *    vendedor caçar o emoji no meio do texto
 *  - em anúncio de família a tela diz que vale só para ele (decisão do Lucas, 12/08)
 *
 * Rodar: node test/descricao-e-garantia.test.js
 */
const { carregar } = require('./harness-analyzer');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  - ' + name); }
  else { fail++; console.error('  FAIL- ' + name + (detail ? ' | ' + detail : '')); }
}

const detailBase = {
  id: 'MLB123456789', title: 'Camiseta básica de algodão masculina', price: 59.9,
  category_id: 'MLB1051', attributes: [{ id: 'BRAND', name: 'Marca', value_name: 'Acme' }],
  pictures: [{ id: '1' }, { id: '2' }, { id: '3' }], tags: [], sale_terms: [],
};

/**
 * Campo do editor. Vai pelo document (e não pelo `reg` direto) porque o harness só
 * materializa o elemento quando alguém o pede por id — como o navegador faria.
 */
function campo(ctx, id) {
  return ctx.sandbox.document.getElementById(id);
}

/** A linha do checklist que fala de um assunto, pra ler ✅/❌ sem depender de distância no HTML. */
function linhaChecklist(html, rotulo) {
  return String(html)
    .split('<div style="display:flex; align-items:center; gap:10px;')
    .find((p) => p.includes(rotulo)) || '';
}

/** Monta um ambiente com a análise já "carregada" e o fetch sob controle. */
function ambiente({ detail = detailBase, descriptionData = null, resposta = null } = {}) {
  const ctx = carregar();
  const { get, sandbox, reg } = ctx;
  ctx.chamadas = [];
  sandbox.fetch = async (url, opts = {}) => {
    ctx.chamadas.push({ url: String(url), method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    const r = resposta || { ok: true, status: 200, dados: {} };
    return { ok: r.ok, status: r.status, json: async () => r.dados };
  };
  sandbox.confirm = () => true;
  sandbox.currentAnalysisState = {
    detail: JSON.parse(JSON.stringify(detail)), descriptionData, containerIdSuffix: '',
    accessToken: 'TOKEN', categoryAttributes: [], usedFallback: false, userId: '1x2',
  };
  get('exibirChecklistRapido')(sandbox.currentAnalysisState.detail, descriptionData, 'quickChecklist');
  return ctx;
}

// Tudo dentro de main(): o arquivo é CommonJS (require), então await de topo não vale.
async function main() {
console.log('descricao-e-garantia.test.js');

console.log('\n== o checklist oferece o caminho, não só o diagnóstico ==');
{
  const { reg } = ambiente();
  const html = reg['quickChecklist'].innerHTML;
  check('sem descrição → "Escrever descrição"', html.includes('Escrever descrição'), html.slice(0, 400));
  check('sem garantia → "Informar garantia"', html.includes('Informar garantia'), html.slice(0, 400));
  check('imagens não ganham botão (têm tela própria)',
    !/mf-editor-imagens/.test(html), html.slice(0, 600));
}
{
  const { reg } = ambiente({ descriptionData: { plain_text: 'Descrição própria do anúncio.' } });
  const html = reg['quickChecklist'].innerHTML;
  check('com descrição própria → "Editar"', /mfAbrirEditorConteudo\('descricao'\)">Editar</.test(html), html.slice(0, 400));
}
{
  // `source` só vem quando o ITEM não tem descrição: o que aparece é herdada.
  const { reg } = ambiente({ descriptionData: { plain_text: 'Texto do catálogo', source: 'catalog' } });
  const html = reg['quickChecklist'].innerHTML;
  check('descrição herdada → "Escrever a sua"', html.includes('Escrever a sua'), html.slice(0, 500));
}
{
  const comGarantia = Object.assign({}, detailBase, {
    sale_terms: [{ id: 'WARRANTY_TYPE', value_name: 'Garantia do vendedor' }, { id: 'WARRANTY_TIME', value_name: '3 meses' }],
  });
  const { reg } = ambiente({ detail: comGarantia });
  const html = reg['quickChecklist'].innerHTML;
  check('com garantia → "Alterar"', html.includes('Alterar'), html.slice(0, 500));
  check('e mostra o que está gravado', html.includes('3 meses'), html.slice(0, 500));
}

console.log('\n== editor de descrição ==');
{
  const { get, reg } = ambiente({ descriptionData: { plain_text: 'Texto do catálogo', source: 'catalog' } });
  get('mfAbrirEditorConteudo')('descricao');
  const html = reg['mf-editor-descricao'].innerHTML;
  check('abre com textarea', html.includes('mf-desc-input'), html.slice(0, 300));
  check('traz o texto herdado como ponto de partida', html.includes('Texto do catálogo'), html.slice(0, 600));
  check('avisa de onde o texto veio', /veio da ficha do catálogo/.test(html), html.slice(0, 600));
  check('tem o botão de IA', html.includes('Sugerir com IA'), html.slice(0, 800));
}
{
  const familia = Object.assign({}, detailBase, { family_id: '123', user_product_id: 'MLBU999' });
  const { get, reg } = ambiente({ detail: familia });
  get('mfAbrirEditorConteudo')('descricao');
  const texto = reg['mf-editor-descricao'].textContent;
  check('anúncio de família avisa que vale só pra ele', /Vale só para este anúncio/.test(texto), texto.slice(0, 300));

  get('mfAbrirEditorConteudo')('garantia');
  const t2 = reg['mf-editor-garantia'].textContent;
  check('o mesmo aviso no editor de garantia', /Vale só para este anúncio/.test(t2), t2.slice(0, 300));
}
{
  const { get, reg } = ambiente();
  get('mfAbrirEditorConteudo')('descricao');
  check('editor aberto marca o estado', get('MF_editorAberto') === 'descricao');
  get('mfAbrirEditorConteudo')('descricao');
  check('clicar de novo fecha', get('MF_editorAberto') === null);
  check('e limpa o conteúdo', reg['mf-editor-descricao'].innerHTML === '');
}

console.log('\n== salvar descrição ==');
{
  const ctx = ambiente({ resposta: { ok: true, status: 200, dados: { ok: true, modo: 'criada', plain_text: 'Camiseta de algodão penteado.' } } });
  ctx.get('mfAbrirEditorConteudo')('descricao');
  campo(ctx, 'mf-desc-input').value = 'Camiseta de algodão penteado.';
  await ctx.get('mfSalvarDescricao')();

  const c = ctx.chamadas[0];
  check('chama a rota de descrição', c && /\/api\/description\?item_id=MLB123456789/.test(c.url), JSON.stringify(c && c.url));
  check('com PUT', c && c.method === 'PUT', JSON.stringify(c && c.method));
  check('mandando plain_text', c && c.body.plain_text === 'Camiseta de algodão penteado.', JSON.stringify(c && c.body));
  check('o estado passa a ter descrição própria (sem source)',
    ctx.sandbox.currentAnalysisState.descriptionData.plain_text === 'Camiseta de algodão penteado.'
    && !ctx.sandbox.currentAnalysisState.descriptionData.source,
    JSON.stringify(ctx.sandbox.currentAnalysisState.descriptionData));
  check('o editor fecha', ctx.get('MF_editorAberto') === null);
  // O checklist é redesenhado pelo reRenderAnalysisView: sem isso, o ❌ fica na tela.
  const linhaDesc = linhaChecklist(ctx.reg['quickChecklist'].innerHTML, 'Descrição em texto');
  check('o checklist volta com ✅ na descrição', linhaDesc.includes('✅') && !linhaDesc.includes('Não preenchida'), linhaDesc.slice(0, 300));
  check('e o botão agora é "Editar"', />Editar</.test(linhaDesc), linhaDesc.slice(0, 300));
}
{
  const ctx = ambiente();
  ctx.get('mfAbrirEditorConteudo')('descricao');
  campo(ctx, 'mf-desc-input').value = '   ';
  await ctx.get('mfSalvarDescricao')();
  check('campo em branco não vira chamada', ctx.chamadas.length === 0, JSON.stringify(ctx.chamadas));
  check('e explica o que fazer', /Escreva a descrição/.test(campo(ctx, 'mf-desc-erro').innerHTML), campo(ctx, 'mf-desc-erro').innerHTML);
}
{
  // Recusa do proxy com sugestão de texto limpo.
  const ctx = ambiente({ resposta: { ok: false, status: 400, dados: {
    error: 'O Mercado Livre não aceita emoji na descrição — tire o 😀 para salvar.',
    code: 'descricao_com_emoji', texto_limpo: 'Produto novo lacrado',
  } } });
  ctx.get('mfAbrirEditorConteudo')('descricao');
  campo(ctx, 'mf-desc-input').value = 'Produto novo 😀 lacrado';
  await ctx.get('mfSalvarDescricao')();
  const erro = campo(ctx, 'mf-desc-erro').innerHTML;
  check('mostra a frase do proxy', /não aceita emoji/.test(erro), erro);
  check('oferece resolver em um clique', /mfAplicarTextoLimpo/.test(erro), erro);

  ctx.get('mfAplicarTextoLimpo')();
  check('aplicar troca o texto do campo', campo(ctx, 'mf-desc-input').value === 'Produto novo lacrado', campo(ctx, 'mf-desc-input').value);
  check('e nada foi salvo sozinho', ctx.chamadas.length === 1, String(ctx.chamadas.length));
}

console.log('\n== sugestão com IA ==');
{
  const ctx = ambiente({ resposta: { ok: true, status: 200, dados: { ok: true, plain_text: 'Camiseta de algodão, gola redonda. Acompanha embalagem.' } } });
  ctx.get('mfAbrirEditorConteudo')('descricao');
  await ctx.get('mfSugerirDescricao')();

  const c = ctx.chamadas[0];
  check('chama a rota de IA', c && /\/api\/gpt-descricao$/.test(c.url), JSON.stringify(c && c.url));
  check('manda os fatos do anúncio, não o prompt', c && c.body.titulo === detailBase.title && Array.isArray(c.body.atributos),
    JSON.stringify(c && c.body));
  check('a sugestão cai no campo', campo(ctx, 'mf-desc-input').value.includes('gola redonda'), campo(ctx, 'mf-desc-input').value);
  // Regra da casa: nada vai pro ML sem o vendedor mandar.
  check('só houve a chamada da IA — nada foi salvo', ctx.chamadas.length === 1, JSON.stringify(ctx.chamadas.map((x) => x.url)));
  check('e a tela diz isso', /nada foi enviado ainda/.test(campo(ctx, 'mf-desc-erro').innerHTML), campo(ctx, 'mf-desc-erro').innerHTML);
}

console.log('\n== salvar garantia ==');
{
  const ctx = ambiente({ resposta: { ok: true, status: 200, dados: {
    ok: true, sale_terms: [{ id: 'WARRANTY_TYPE', value_name: 'Garantia do vendedor' }, { id: 'WARRANTY_TIME', value_name: '6 meses' }],
  } } });
  ctx.get('mfAbrirEditorConteudo')('garantia');
  campo(ctx, 'mf-gar-tipo').value = 'vendedor';
  campo(ctx, 'mf-gar-tempo').value = '6';
  campo(ctx, 'mf-gar-unidade').value = 'meses';
  await ctx.get('mfSalvarGarantia')();

  const chamadaPut = ctx.chamadas.find((x) => x.method === 'PUT');
  check('chama a rota de garantia', chamadaPut && /\/api\/warranty\?item_id=MLB123456789/.test(chamadaPut.url), JSON.stringify(chamadaPut && chamadaPut.url));
  check('manda tipo, tempo e unidade', chamadaPut && chamadaPut.body.tipo === 'vendedor' && chamadaPut.body.tempo === 6 && chamadaPut.body.unidade === 'meses',
    JSON.stringify(chamadaPut && chamadaPut.body));
  check('NÃO manda attributes', chamadaPut && !chamadaPut.body.attributes, JSON.stringify(chamadaPut && chamadaPut.body));
  const st = ctx.sandbox.currentAnalysisState.detail.sale_terms;
  check('o estado guarda em sale_terms', Array.isArray(st) && st.some((t) => t.id === 'WARRANTY_TIME' && t.value_name === '6 meses'), JSON.stringify(st));
  const linhaGar = linhaChecklist(ctx.reg['quickChecklist'].innerHTML, 'Garantia');
  check('o checklist volta com ✅ na garantia', linhaGar.includes('✅') && !linhaGar.includes('Não informada'), linhaGar.slice(0, 300));
  check('e mostra o prazo salvo', linhaGar.includes('6 meses'), linhaGar.slice(0, 300));
}
{
  // Anúncio com o campo LEGADO preenchido: getWarrantyText prefere ele, então salvar a
  // garantia nova mostraria a velha na tela e o vendedor salvaria de novo.
  const comLegado = Object.assign({}, detailBase, { warranty: 'Garantia do vendedor: 12 meses' });
  const ctx = ambiente({
    detail: comLegado,
    resposta: { ok: true, status: 200, dados: { ok: true, sale_terms: [
      { id: 'WARRANTY_TYPE', value_name: 'Garantia do vendedor' }, { id: 'WARRANTY_TIME', value_name: '6 meses' },
    ] } },
  });
  check('antes de salvar, a tela mostra o campo legado',
    ctx.reg['quickChecklist'].innerHTML.includes('12 meses'), ctx.reg['quickChecklist'].innerHTML.slice(0, 400));

  ctx.get('mfAbrirEditorConteudo')('garantia');
  campo(ctx, 'mf-gar-tipo').value = 'vendedor';
  campo(ctx, 'mf-gar-tempo').value = '6';
  campo(ctx, 'mf-gar-unidade').value = 'meses';
  await ctx.get('mfSalvarGarantia')();

  const linha = linhaChecklist(ctx.reg['quickChecklist'].innerHTML, 'Garantia');
  check('depois de salvar, mostra a garantia NOVA', linha.includes('6 meses'), linha.slice(0, 300));
  check('e não a legada', !linha.includes('12 meses'), linha.slice(0, 300));
}
{
  const ctx = ambiente({ resposta: { ok: false, status: 400, dados: { error: 'Informe por quanto tempo vale a garantia.', code: 'garantia_sem_prazo' } } });
  ctx.get('mfAbrirEditorConteudo')('garantia');
  campo(ctx, 'mf-gar-tipo').value = 'vendedor';
  campo(ctx, 'mf-gar-tempo').value = '';
  await ctx.get('mfSalvarGarantia')();
  check('a recusa do proxy aparece na tela', /Informe por quanto tempo/.test(campo(ctx, 'mf-gar-erro').innerHTML), campo(ctx, 'mf-gar-erro').innerHTML);
}
{
  // Reabrir com garantia gravada volta nos valores certos, em vez de zerar a escolha.
  const { get } = ambiente();
  const lido = get('MF_garantiaAtual')({ sale_terms: [
    { id: 'WARRANTY_TYPE', value_name: 'Garantia de fábrica' }, { id: 'WARRANTY_TIME', value_name: '1 ano' },
  ] });
  check('lê tipo de fábrica', lido.tipo === 'fabrica', JSON.stringify(lido));
  check('lê "1 ano" como 1 + anos', lido.tempo === '1' && lido.unidade === 'anos', JSON.stringify(lido));

  const semNada = get('MF_garantiaAtual')({});
  check('sem sale_terms não inventa tipo', semNada.tipo === '', JSON.stringify(semNada));

  const mes = get('MF_garantiaAtual')({ sale_terms: [
    { id: 'WARRANTY_TYPE', value_name: 'Garantia do vendedor' }, { id: 'WARRANTY_TIME', value_name: '1 mês' },
  ] });
  check('"1 mês" com acento é entendido', mes.tempo === '1' && mes.unidade === 'meses', JSON.stringify(mes));
}

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
