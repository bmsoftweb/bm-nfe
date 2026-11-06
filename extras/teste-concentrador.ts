/**
 * Teste do concentrador contra o app rodando (doc/plano-concentrador.md, passo 4).
 *
 * Usa como modelo os dados da última NF-e autorizada da empresa e, só em
 * homologação, confere as duas garantias das fases 1 e 2:
 *   1. 10 POST /api/emitir simultâneos, com referências diferentes → 10 números distintos;
 *   2. 5 simultâneos com a MESMA referência → uma nota só (os outros recebem 409 ou a mesma nota).
 *
 * Uso (o usuário e a senha ficam só no ambiente, nunca no repositório):
 *   TESTE_CNPJ=... TESTE_USUARIO=... TESTE_SENHA=... npx tsx extras/teste-concentrador.ts [http://localhost:3000]
 */
const URL_BASE = process.argv[2] || 'http://localhost:3000';

async function chamar(caminho: string, token?: string, corpo?: unknown) {
  try {
    const r = await fetch(URL_BASE + caminho, {
      method: corpo === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    return { status: r.status, corpo: await r.json().catch(() => ({})) as any };
  } catch (err: any) {
    // "fetch failed" sozinho não diz nada: a causa (conexão recusada, timeout...) vem em err.cause
    return { status: 0, corpo: { error: `${err?.message}: ${err?.cause?.code || err?.cause?.message || ''}` } as any };
  }
}

async function principal() {
  const { TESTE_CNPJ, TESTE_USUARIO, TESTE_SENHA } = process.env;
  if (!TESTE_CNPJ || !TESTE_USUARIO || !TESTE_SENHA) throw new Error('Defina TESTE_CNPJ, TESTE_USUARIO e TESTE_SENHA.');

  const login = await chamar('/api/login', undefined, { cnpj: TESTE_CNPJ, usuario: TESTE_USUARIO, senha: TESTE_SENHA });
  const token = login.corpo.token;
  if (!token) throw new Error(`Login recusado: ${login.corpo.error || login.status}`);

  const config = await chamar('/api/config', token);
  if (Number(config.corpo?.config?.webservice?.ambiente) !== 2) throw new Error('Este teste só roda em homologação (ambiente 2).');

  const lista = await chamar('/api/documentos?busca=autorizada&porPagina=50', token);
  const modelo = (lista.corpo.data || []).find((d: any) => d.situacao === 'autorizada' && d.copiavel);
  if (!modelo) throw new Error('Nenhuma NF-e autorizada com dados para servir de modelo. Emita uma pela tela antes.');
  const doc = await chamar(`/api/documentos/${modelo.chave}`, token);
  const dados = typeof doc.corpo.dados === 'string' ? JSON.parse(doc.corpo.dados) : doc.corpo.dados;
  const documento = { ...dados, ide: { ...dados.ide, numero: undefined, dataEmissao: undefined, codigoNumerico: undefined } };
  console.log(`Modelo: NF-e ${modelo.numero} série ${modelo.serie}`);

  const prefixo = `TESTE-${Date.now()}`;

  // 1) Referências diferentes ao mesmo tempo: nenhum número pode repetir
  const varias = await Promise.all(
    Array.from({ length: 10 }, (_, i) => chamar('/api/emitir', token, { referencia: `${prefixo}-${i}`, documento })),
  );
  const numeros = varias.map((r) => r.corpo.numero);
  console.log('Números:', numeros.join(', '));
  console.log('Situações:', varias.map((r) => `${r.status}/${r.corpo.situacao}`).join(', '));
  for (const r of varias) if (r.corpo.error) console.log('  erro:', r.corpo.error);
  const distintos = new Set(numeros).size === numeros.length && numeros.every((n) => Number.isInteger(n));
  console.log(distintos ? 'ok  10 números distintos' : 'FALHOU  número repetido ou ausente');

  // 2) A mesma referência ao mesmo tempo: uma nota só
  const ref = `${prefixo}-UNICA`;
  const iguais = await Promise.all(Array.from({ length: 5 }, () => chamar('/api/emitir', token, { referencia: ref, documento })));
  console.log('Respostas:', iguais.map((r) => `${r.status}/${r.corpo.situacao}/${r.corpo.numero}`).join(', '));
  const final = await chamar(`/api/emitir/${encodeURIComponent(ref)}`, token);
  const transmitiram = iguais.filter((r) => r.corpo.repetida === false).length;
  const umaNota = transmitiram === 1 && iguais.every((r) => !r.corpo.numero || r.corpo.numero === final.corpo.numero);
  console.log(`Final: ${final.corpo.situacao}, nota ${final.corpo.numero}, chave ${final.corpo.chave}`);
  console.log(umaNota ? 'ok  uma nota só para a mesma referência' : `FALHOU  ${transmitiram} chamadas transmitiram`);

  // 3) Repetir depois de resolvida devolve a mesma nota, sem transmitir
  const repetida = await chamar('/api/emitir', token, { referencia: ref, documento });
  const ok3 = repetida.corpo.repetida === true && repetida.corpo.chave === final.corpo.chave;
  console.log(ok3 ? 'ok  reenvio devolve a mesma nota' : `FALHOU  reenvio: ${JSON.stringify(repetida.corpo).slice(0, 200)}`);

  process.exitCode = distintos && umaNota && ok3 ? 0 : 1;
}

principal().catch((err) => {
  console.error(err?.message || err);
  process.exitCode = 1;
});
