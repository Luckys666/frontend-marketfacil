'use strict';
/*
 * Créditos na tela: o 429 de cota NÃO é "muita gente analisando", e o placar mostra as
 * análises do mês. Falha nunca vira zero: sem saldo lido, o contador some.
 *
 * Rodar: node test/ficha-ia-cota.test.js
 */
const { carregar } = require('./harness-ficha-ia');

let pass = 0, fail = 0;
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('  ok  - ' + label); }
  else { fail++; console.error('  FAIL- ' + label + (detail ? ' | ' + detail : '')); }
};
console.log('ficha-ia-cota.test.js');

const COTA_ESGOTADA = {
  error: 'Você usou as 50 análises de ficha deste mês. Renova em 01/10/2026.',
  code: 'cota_mensal',
  cota: { limite: 50, usadas: 50, restante: 0, renova_em: '2026-10-01' },
};
const PAYLOAD = { item_id: 'MLB1', campos: [], palavras_que_faltam: [] };

(async () => {
  console.log('\n== 429 com código de cota vira estado "cota" ==');
  {
    const { M } = carregar({ rotas: [[/gpt-ficha$/, () => ({ status: 429, body: COTA_ESGOTADA })]] });
    const r = await M.buscarSugestoes(PAYLOAD, 'user-1', 'tok', null);
    check('estado = cota', r.estado === 'cota', JSON.stringify(r));
    check('dados carregam o corpo do servidor (cota e mensagem)', r.dados && r.dados.cota && r.dados.cota.limite === 50 && /Renova/.test(r.dados.error));
  }
  {
    const { M } = carregar({ rotas: [[/gpt-ficha$/, () => ({ status: 429, body: { ...COTA_ESGOTADA, code: 'sem_creditos' } })]] });
    const r = await M.buscarSugestoes(PAYLOAD, 'user-1', 'tok', null);
    check('sem_creditos (Fase 2) cai no MESMO estado', r.estado === 'cota');
  }
  {
    const { M } = carregar({ rotas: [[/gpt-ficha$/, () => ({ status: 429, body: { error: 'A IA está ocupada agora.' } })]] });
    const r = await M.buscarSugestoes(PAYLOAD, 'user-1', 'tok', null);
    check('429 SEM código continua sendo "ocupado"', r.estado === 'ocupado' && r.dados === null, JSON.stringify(r));
  }

  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail ? 1 : 0);
})();
