'use strict';
/*
 * A página do Agente fala de anúncio, não de API.
 *
 * Por que existe: em 02/09, lendo a tela em conta real, achei "Limite de análises GPT
 * atingido", "Não foi possível obter suas credenciais", "Não foi possível montar a URL do
 * produto", "Cruzando dados de indexação" e "Muitas requisições". O teste que já proibia
 * "GPT" (agente-fluxo-antigo) varre `>texto<` e atribuições de textContent/innerHTML, e
 * essas frases saem por `showError(...)` e `updateLoadingStep(...)`, que nenhum dos dois
 * padrões alcança. A porta ficou aberta justamente por onde ninguém olhava.
 *
 * O que ele protege:
 *   1. nenhuma palavra de programador na frase que o vendedor lê;
 *   2. nenhum travessão (o passe de 31/08 e o de 02/09; ver fichaTexto.js no proxy);
 *   3. a mensagem de erro diz o que fazer, não só que deu errado.
 *
 * ⚠️ Escopo de propósito: só as funções que FALAM com o vendedor. Nome de função interna
 * (`fetchUserIdForScraping`), nome de classe CSS (`fia-chars`) e comentário continuam
 * livres. Varrer o arquivo inteiro reprovaria código que não é desta feature, e teste que
 * reprova o inocente vira teste que alguém desliga.
 *
 * Rodar: node test/copy-do-agente.test.js
 */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const check = (nome, cond, detalhe) => {
  if (cond) { pass++; console.log('  ok  - ' + nome); }
  else { fail++; console.error('  FAIL- ' + nome + (detalhe ? ' | ' + detalhe : '')); }
};

console.log('copy-do-agente.test.js');

const ler = (f) => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
const AGENTE = ler('keyword-agent.js');
const FICHA = ler('ficha-ia.js');

// class="fia-chars", id, data-* e nome de variável CSS não são texto: quem lê a tela lê o
// que está ENTRE as tags. Sem tirar isso, o teste acusa a classe e ignora a frase.
function semAtributos(f) {
  return f
    .replace(/\s(?:class|id|style|href|src|for|type|role|aria-[\w-]+|data-[\w-]+)\s*=\s*"[^"]*"/g, ' ')
    .replace(/\s(?:class|id|style|href|src|for|type|role)\s*=\s*'[^']*'/g, ' ');
}

/**
 * As frases que chegam ao vendedor: as que passam pelas funções de mensagem e as que estão
 * dentro do HTML montado. Comentário nunca entra (o `//` e o ` * ` saem antes).
 */
function frasesVisiveis(fonte) {
  const semComentario = fonte
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');

  const frases = [];
  const porFuncao = /(?:showError|updateLoadingStep|blocoErro|showToast|alert)\s*\(([^;]{0,400}?)\)\s*;/g;
  let m;
  while ((m = porFuncao.exec(semComentario))) {
    (m[1].match(/(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g) || []).forEach((s) => frases.push(s.slice(1, -1)));
  }
  (semComentario.match(/>[^<>{}]{4,}</g) || []).forEach((s) => frases.push(s.slice(1, -1)));
  (semComentario.match(/return\s+`[^`]{10,}`/g) || []).forEach((s) => frases.push(s.slice(8, -1)));
  (semComentario.match(/return\s+'[^']{10,}'/g) || []).forEach((s) => frases.push(s.slice(8, -1)));

  return frases.map(semAtributos).filter((f) => /[a-záéíóúâêôãõç]{4,}/i.test(f));
}

const VISIVEIS = { 'keyword-agent.js': frasesVisiveis(AGENTE), 'ficha-ia.js': frasesVisiveis(FICHA) };

console.log('\n== a tela não fala como programador ==');
// Cada uma foi vista na tela em 02/09, menos "scraping"/"decodo", que são a regra antiga.
const JARGAO = [
  [/\bGPT\b/i, 'GPT'],
  [/\bOpenAI\b/i, 'OpenAI'],
  [/scraping/i, 'scraping'],
  [/decodo/i, 'decodo'],
  [/requisi[çc]/i, 'requisição'],
  [/credenciais/i, 'credenciais'],
  [/\bURL\b/, 'URL'],
  [/\bchars\b/i, 'chars'],
  [/\b(endpoint|payload|token|servidor)\b/i, 'endpoint/payload/token/servidor'],
  [/\bJSON\b/i, 'JSON'],
];
Object.keys(VISIVEIS).forEach((arq) => {
  JARGAO.forEach(([re, nome]) => {
    const achou = VISIVEIS[arq].filter((f) => re.test(f));
    check(arq + ' não diz "' + nome + '"', achou.length === 0, achou.slice(0, 2).join(' | ').slice(0, 160));
  });
});

console.log('\n== nenhum travessão no que o vendedor lê ==');
Object.keys(VISIVEIS).forEach((arq) => {
  const comRisco = VISIVEIS[arq].filter((f) => /[—–―]/.test(f));
  check(arq + ' sem travessão', comRisco.length === 0, comRisco.slice(0, 3).join(' | ').slice(0, 200));
});

console.log('\n== o erro diz o que fazer, não só que deu errado ==');
{
  // Pergunta ao módulo, em vez de reler a fonte: é a saída real que o vendedor lê.
  const { carregar } = require('./harness-ficha-ia.js');
  const { M } = carregar();
  const campo = { id: 'MATERIAL', name: 'Material' };
  const casos = [
    ['lista fechada', { cause: [{ code: 'value_not_in_allowed_values' }] }],
    ['obrigatório', { cause: [{ code: 'item.attributes.required' }] }],
    ['tamanho', { cause: [{ code: 'invalid_length' }] }],
    ['formato', { cause: [{ code: 'invalid_format' }] }],
    ['sem código conhecido', { cause: [{ code: 'coisa_que_ninguem_previu' }] }],
    ['sem nada', null],
  ];
  casos.forEach(([nome, err]) => {
    const msg = M.traduzirErro(err, campo);
    check('erro "' + nome + '" vira frase em português', /[a-záéíóúâêôãõç]{4,}\s/i.test(msg) && !/_/.test(msg), msg);
    check('erro "' + nome + '" sem travessão', !/[—–―]/.test(msg), msg);
  });
  check('lista fechada manda escolher da lista',
    /escolha/i.test(M.traduzirErro({ cause: [{ code: 'value_not_in_allowed_values' }] }, campo)));
}

console.log('\n== o passo de carregamento conta o que está acontecendo ==');
{
  // Passo de loading é a única coisa na tela enquanto ela espera. Se ele fala de credencial
  // e de servidor, o vendedor lê "deu problema" onde está tudo indo bem.
  const passos = (AGENTE.match(/updateLoadingStep\(\s*['"`]([^'"`]{4,})['"`]/g) || [])
    .map((s) => s.replace(/^updateLoadingStep\(\s*['"`]/, ''));
  check('há passos de carregamento para conferir', passos.length >= 3, String(passos.length));
  passos.forEach((p) => {
    check('passo "' + p.slice(0, 42) + '" fala de anúncio',
      !/credenci|URL|requisi|GPT|servidor/i.test(p), p);
  });
}

console.log(`\n  ${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
