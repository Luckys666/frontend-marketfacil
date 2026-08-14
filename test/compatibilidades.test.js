'use strict';
/*
 * Card "Veículos compatíveis" (autopeças) — 13/08/2026.
 *
 * Contexto: hoje o app mostra a tag `incomplete_compatibilities` como string crua em
 * inglês, cinza, no meio das tags neutras — enquanto dois anúncios da conta medida (um
 * com 419 vendas) estão fora do ar há quase dois meses por causa dela. Este card lê o
 * veredito pronto de `GET /api/compatibilidades` (Task 2/4/5 do proxy) e só desenha.
 *
 * O que estes testes protegem:
 *  - a tela NUNCA escreve jargão: nada de incomplete_compatibilities, waiting_for_patch,
 *    under_review, WITHOUT_COMPATS ou "compatibilities" na cara do vendedor.
 *  - o botão de universal só existe quando o proxy disse que pode (`remedios[].pode`).
 *    Quem decide é lá — o front nunca inventa quando pode ou não.
 *  - falha de leitura NUNCA vira "está tudo certo" (feedback_falha_nunca_vira_zero).
 *  - `situacao: em_risco` nunca diz "fora do ar" — são coisas diferentes.
 *  - gravar com sucesso NUNCA diz "resolvido"/"reativado": a ML reprocessa quando quiser.
 *  - `placar_conta` não existe no veredito hoje: sem o campo, sem placar inventado.
 *  - `afeta_familia.itens` vem `null` na Fase 1: sem aviso de família, e sem número vago
 *    tipo "1 anúncio" no lugar.
 *  - sem NENHUM remédio disponível (`pode: true`), o card mostra só o texto do próprio ML
 *    — nunca um botão morto nem um link chutado (o remédio `gerenciador_ml` ainda não
 *    existe no veredito).
 *  - erro de categoria (`categoria_nao_aceita`) tem frase própria e o botão não continua
 *    sugerindo "tentar de novo" depois dele — tentar de novo dá o mesmo erro sempre.
 *
 * Rodar: node test/compatibilidades.test.js
 */
const { carregar } = require('./harness-analyzer');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  - ' + name); }
  else { fail++; console.error('  FAIL- ' + name + (detail ? ' | ' + detail : '')); }
}

// Veredito medido em produção em 13/08/2026 (MLB3869799637, terminais rotulares) — a
// fonte da verdade real: universal disponível, copiar não (sem candidatos), família com
// tamanho ainda não medido (`itens: null`), sem placar (o campo nem existe ainda).
const VEREDITO_REAL = {
  exige: true, situacao: 'fora_do_ar', certeza: 'moderacao', desde: '2026-06-18',
  ja_preenchido: { total: 0, do_vendedor: 0, do_catalogo: 0 },
  sugestoes_ml: { tem: false, quantas: null },
  remedios: [
    { id: 'universal', pode: true, porque: null },
    { id: 'copiar', pode: false, candidatos: null, porque: 'sem_candidatos' },
  ],
  afeta_familia: { user_product_id: 'MLBU1993802314', itens: null },
  texto_ml: {
    motivo: 'Não indica os veículos compatíveis.',
    como_resolver: 'Como reativar o anúncio?Acesse o módulo de Compatibilidade, selecione os veículos compatíveis com seu produto e salve a seleção. Se você não encontrar veículos compatíveis, também pode indicar essa informação.',
  },
};

/** Monta um ambiente com currentAnalysisState pronto e o fetch sob controle. */
function ambiente({ resposta = null } = {}) {
  const ctx = carregar();
  const { sandbox } = ctx;
  ctx.chamadas = [];
  sandbox.fetch = async (url, opts = {}) => {
    ctx.chamadas.push({ url: String(url), method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    const r = resposta || { ok: true, status: 200, dados: { ok: true } };
    return { ok: r.ok, status: r.status, json: async () => r.dados };
  };
  sandbox.currentAnalysisState = {
    detail: { id: 'MLB3869799637' }, accessToken: 'TOKEN', containerIdSuffix: '',
  };
  return ctx;
}

async function main() {
  console.log('compatibilidades.test.js');

  console.log('\n== veredito real de produção (fora do ar, certeza de moderação) ==');
  {
    const { get, reg } = carregar();
    get('exibirCompatibilidades')(VEREDITO_REAL, 'compat');
    const html = reg['compat'].innerHTML;
    check('diz que está fora do ar, em português', /fora do ar/i.test(html), html.slice(0, 200));
    check('mostra o motivo com as palavras da ML', html.includes('Não indica os veículos compatíveis.'), html.slice(0, 300));
    check('mostra o "como resolver" da ML', html.includes('Acesse o módulo de Compatibilidade'), html.slice(0, 600));
    check('sem jargão na tela',
      !/incomplete_compatibilities|waiting_for_patch|under_review|WITHOUT_COMPATS|compatibilities/i.test(html), html.slice(0, 300));
    check('oferece o botão de universal (proxy disse que pode)', /mfCompatUniversal/.test(html), html.slice(0, 400));
    check('NÃO oferece copiar (proxy disse que não pode)', !/mfCompatAbrirCandidatos/.test(html), html.slice(0, 400));
    check('sem placar_conta no veredito → sem placar desenhado',
      !/resolvidos|Nenhum anúncio parado/i.test(html), html.slice(0, 300));
    check('itens: null → sem aviso de família', !/deste grupo|vale para/i.test(html), html.slice(0, 500));
    check('e sem número vago tipo "1 anúncio" no lugar', !/\b1 an[úu]ncio\b/i.test(html), html.slice(0, 500));
  }

  console.log('\n== família com tamanho medido (itens > 1) ==');
  {
    const comFamilia = JSON.parse(JSON.stringify(VEREDITO_REAL));
    comFamilia.remedios[1] = { id: 'copiar', pode: true, candidatos: 12 };
    comFamilia.afeta_familia = { user_product_id: 'MLBU1993802314', itens: 3 };
    const { get, reg } = carregar();
    get('exibirCompatibilidades')(comFamilia, 'compat');
    const html = reg['compat'].innerHTML;
    check('avisa que vale pra família inteira', /3 an[úu]ncios/i.test(html), html.slice(0, 500));
    check('e também oferece copiar, agora que o proxy disse que pode', /mfCompatAbrirCandidatos/.test(html), html.slice(0, 500));
  }

  console.log('\n== já tem lista própria: universal some, mostra o que já foi preenchido ==');
  {
    const semUniversal = JSON.parse(JSON.stringify(VEREDITO_REAL));
    semUniversal.remedios[0] = { id: 'universal', pode: false, porque: 'ja_tem_lista' };
    semUniversal.ja_preenchido = { total: 40, do_vendedor: 40, do_catalogo: 0 };
    semUniversal.situacao = 'ok';
    semUniversal.certeza = 'tag';
    const { get, reg } = carregar();
    get('exibirCompatibilidades')(semUniversal, 'compat');
    const html = reg['compat'].innerHTML;
    check('proxy disse que não pode → botão de universal não existe', !/mfCompatUniversal/.test(html), html.slice(0, 300));
    check('e mostra quantos veículos já tem', /40/.test(html), html.slice(0, 300));
  }

  console.log('\n== nenhum remédio disponível: só o texto do ML, nada de botão morto ou link chutado ==');
  {
    const semRemedio = JSON.parse(JSON.stringify(VEREDITO_REAL));
    semRemedio.remedios = [
      { id: 'universal', pode: false, porque: 'ja_tem_lista' },
      { id: 'copiar', pode: false, porque: 'sem_candidatos' },
    ];
    const { get, reg } = carregar();
    get('exibirCompatibilidades')(semRemedio, 'compat');
    const html = reg['compat'].innerHTML;
    check('sem botão de universal', !/mfCompatUniversal/.test(html), html.slice(0, 400));
    check('sem botão de copiar', !/mfCompatAbrirCandidatos/.test(html), html.slice(0, 400));
    check('sem nenhum link (gerenciador_ml não existe no veredito ainda)', !/<a\s/i.test(html), html.slice(0, 400));
    check('mas o texto do próprio ML continua lá, como jeito de resolver',
      html.includes('Acesse o módulo de Compatibilidade'), html.slice(0, 600));
  }

  console.log('\n== veredito null: falha de leitura não vira "tudo certo" ==');
  {
    const { get, reg } = carregar();
    get('exibirCompatibilidades')(null, 'compat');
    const html = reg['compat'].innerHTML;
    check('não afirma que está tudo certo', !/tudo certo|nenhum|sem problema/i.test(html), html.slice(0, 200));
    check('e oferece tentar de novo', /tentar de novo/i.test(html), html.slice(0, 200));
  }

  console.log('\n== não exige compatibilidade: card nem aparece ==');
  {
    const { get, reg } = carregar();
    get('exibirCompatibilidades')({ exige: false }, 'compat');
    const html = reg['compat'].innerHTML;
    check('card vazio quando não exige', html === '', html);
  }

  console.log('\n== em risco não é fora do ar ==');
  {
    const emRisco = { ...VEREDITO_REAL, situacao: 'em_risco', certeza: 'tag', desde: null,
      texto_ml: { motivo: null, como_resolver: null } };
    const { get, reg } = carregar();
    get('exibirCompatibilidades')(emRisco, 'compat');
    const html = reg['compat'].innerHTML;
    check('em risco não diz que está fora do ar', !/fora do ar/i.test(html), html.slice(0, 200));
    check('e diz que pode sair do ar (é risco, não fato consumado)', /pode sair do ar/i.test(html), html.slice(0, 300));
  }

  console.log('\n== estado "ok": veredito diz quantos veículos, sem inventar frase de alerta ==');
  {
    const ok = { ...VEREDITO_REAL, situacao: 'ok', certeza: 'tag', desde: null,
      ja_preenchido: { total: 55, do_vendedor: 55, do_catalogo: 0 },
      remedios: [{ id: 'universal', pode: false, porque: 'ja_tem_lista' }, { id: 'copiar', pode: false, porque: 'sem_candidatos' }] };
    const { get, reg } = carregar();
    get('exibirCompatibilidades')(ok, 'compat');
    const html = reg['compat'].innerHTML;
    check('mostra quantos veículos foram indicados', /55 ve[íi]culos indicados/i.test(html), html.slice(0, 300));
  }

  console.log('\n== clicar em "Serve em qualquer veículo" ==');
  {
    const ctx = ambiente({ resposta: { ok: true, status: 200, dados: { ok: true, criadas: 1, afetou_familia: 1 } } });
    await ctx.get('mfCompatUniversal')();
    const c = ctx.chamadas[0];
    check('chama a rota de universal', c && /\/api\/compatibilidades\/universal$/.test(c.url), JSON.stringify(c && c.url));
    check('com POST', c && c.method === 'POST', JSON.stringify(c && c.method));
    check('mandando o item_id, corpo mínimo (o front não monta payload da ML)',
      c && c.body && c.body.item_id === 'MLB3869799637' && Object.keys(c.body).length === 1, JSON.stringify(c && c.body));

    const aviso = ctx.sandbox.document.getElementById('mf-rapido-erro-compat');
    check('avisa que foi ENVIADO, não que o anúncio foi reativado',
      /enviado/i.test(aviso.textContent) && !/reativado|resolvido/i.test(aviso.textContent), aviso.textContent);
    check('diz que o ML leva um tempo', /leva um tempo/i.test(aviso.textContent), aviso.textContent);
    check('usa a caixa de aviso (info), não a de erro (vermelha)', /mf-conteudo-info/.test(aviso.className), aviso.className);
    check('recarrega o veredito depois de gravar', ctx.chamadas.some((x) => /\/api\/compatibilidades\?item_id=/.test(x.url)), JSON.stringify(ctx.chamadas.map((x) => x.url)));
  }

  console.log('\n== erro comum (ja_tem_lista): mensagem certa, botão continua oferecendo tentar de novo ==');
  {
    const ctx = ambiente({ resposta: { ok: false, status: 400, dados: { code: 'ja_tem_lista' } } });
    await ctx.get('mfCompatUniversal')();
    const erro = ctx.sandbox.document.getElementById('mf-rapido-erro-compat');
    check('mostra a frase certa pro código', /já tem veículos indicados/i.test(erro.textContent), erro.textContent);
    const btn = ctx.sandbox.document.getElementById('mf-compat-universal');
    check('erro comum: botão não é escondido — vale tentar de novo', btn.style.display !== 'none' && btn.disabled === false, `display=${btn.style.display} disabled=${btn.disabled}`);
  }

  console.log('\n== erro de categoria (categoria_nao_aceita): frase própria, sem sugerir nova tentativa ==');
  {
    const ctx = ambiente({ resposta: { ok: false, status: 400, dados: { code: 'categoria_nao_aceita' } } });
    await ctx.get('mfCompatUniversal')();
    const erro = ctx.sandbox.document.getElementById('mf-rapido-erro-compat');
    check('diz que o ML não aceita "serve em qualquer veículo" nesta categoria',
      /não aceita.*serve em qualquer ve[íi]culo.*nesta categoria/i.test(erro.textContent), erro.textContent);
    check('sem jargão (WITHOUT_COMPATS, universal:true, etc.)',
      !/WITHOUT_COMPATS|universal:\s*true|categoria_nao_aceita/i.test(erro.textContent), erro.textContent);
    const btn = ctx.sandbox.document.getElementById('mf-compat-universal');
    check('o botão some — tentar de novo dá o mesmo erro sempre', btn.style.display === 'none', `display=${btn.style.display}`);
  }

  console.log('\n== falha de rede ao gravar não vira sucesso ==');
  {
    const ctx = ambiente();
    ctx.sandbox.fetch = async () => { throw new Error('offline'); };
    await ctx.get('mfCompatUniversal')();
    const erro = ctx.sandbox.document.getElementById('mf-rapido-erro-compat');
    check('mostra erro de rede, não fica em silêncio', /n[ãa]o deu para enviar/i.test(erro.textContent), erro.textContent);
  }

  console.log(`\n${pass} ok, ${fail} falhas`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
