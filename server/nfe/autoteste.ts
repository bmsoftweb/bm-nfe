/**
 * Conferência rápida das partes que, se quebrarem, a SEFAZ rejeita tudo:
 * dígito da chave de acesso, validação de CNPJ/CPF, resolução das URLs no
 * ACBrNFeServicos.ini, montagem de XML e soma dos totais.
 *
 * Rode com:  npx tsx server/nfe/autoteste.ts
 */
import assert from 'assert';
import { chaveValida, cnpjValido, cpfValido, digitoChave, lerChave, montarChave } from './chave.js';
import { UFS, resolverDistribuicaoDFe, resolverServico, ufPorCodigo, urlsConsulta } from './servicos.js';
import { grupo, limparTexto, num, tag } from './xml.js';
import { somarTotais } from './gerarNFe.js';
import { anoMesChave, dataDoDocumento, dataHoraDFe } from './datas.js';
import { criarToken, lerToken } from '../auth.js';

function conferir(nome: string, fn: () => void) {
  fn();
  console.log(`  ok  ${nome}`);
}

console.log('Autoteste do núcleo NF-e\n');

// --- Chave de acesso ------------------------------------------------------
conferir('dígito verificador da chave confere com a tabela de pesos do ACBr', () => {
  // Mesma constante PESO do ACBrDFeUtil.GerarDigito, aplicada da esquerda para a
  // direita. A implementação do projeto gira os pesos 2..9 da direita para a
  // esquerda; os dois caminhos têm de chegar ao mesmo dígito.
  const PESO = '4329876543298765432987654329876543298765432';
  const referencia = (chave43: string) => {
    let soma = 0;
    for (let i = 0; i < 43; i++) soma += Number(chave43[i]) * Number(PESO[i]);
    return soma % 11 < 2 ? 0 : 11 - (soma % 11);
  };

  const amostras = [
    '3516070532113600016155001000000109110000109',
    '4319050764282300012855001000000011000000100',
    '3526090532113600016165001000000017112345678',
  ];

  for (const base of amostras) {
    const esperado = referencia(base);
    assert.strictEqual(digitoChave(base), esperado, `DV divergente em ${base}`);
    assert.ok(chaveValida(base + esperado));
    assert.ok(!chaveValida(base + ((esperado + 1) % 10)));
  }
});

conferir('montagem e releitura da chave', () => {
  const emissao = new Date(2026, 8, 20); // setembro/2026
  const { chave } = montarChave({
    uf: 'SP',
    emissao,
    cnpj: '05321136000161',
    modelo: '55',
    serie: 1,
    numero: 10,
    tipoEmissao: 1,
    codigoNumerico: 11000010,
  });

  assert.strictEqual(chave.length, 44);
  assert.ok(chaveValida(chave), 'a chave montada precisa passar na própria validação');

  const lida = lerChave(chave);
  assert.strictEqual(lida.cUF, 35);
  assert.strictEqual(lida.cnpj, '05321136000161');
  assert.strictEqual(lida.modelo, '55');
  assert.strictEqual(lida.serie, 1);
  assert.strictEqual(lida.numero, 10);
  assert.strictEqual(chave.slice(2, 6), anoMesChave(emissao));
});

conferir('cNF nunca sai igual ao nNF (rejeição 539)', () => {
  const { chave } = montarChave({
    uf: 'SP', emissao: new Date(2026, 0, 1), cnpj: '05321136000161',
    modelo: '55', serie: 1, numero: 777, tipoEmissao: 1, codigoNumerico: 777,
  });
  assert.notStrictEqual(lerChave(chave).codigoNumerico, '00000777');
});

// --- Documentos -----------------------------------------------------------
conferir('CNPJ e CPF', () => {
  assert.ok(cnpjValido('05.321.136/0001-17'));
  assert.ok(!cnpjValido('05321136000118'));
  assert.ok(!cnpjValido('11111111111111'));
  assert.ok(cpfValido('529.982.247-25'));
  assert.ok(!cpfValido('52998224726'));
});

// --- Webservices ----------------------------------------------------------
conferir('resolução das URLs no ACBrNFeServicos.ini', () => {
  const sp = resolverServico('NFe', 'SP', 2, 'NFeStatusServico');
  assert.ok(sp.url.startsWith('https://'), 'SP precisa devolver URL https');
  assert.ok(sp.soapAction.includes('nfeStatusServicoNF'));

  // AC não publica serviço próprio: o .ini redireciona com Usar=NFe_SVRS_H
  const ac = resolverServico('NFe', 'AC', 2, 'NFeStatusServico');
  assert.ok(ac.url.includes('svrs'), `esperava redirecionamento para o SVRS, veio ${ac.url}`);

  const dist = resolverDistribuicaoDFe(1);
  assert.ok(dist.url.includes('NFeDistribuicaoDFe'));
  assert.ok(dist.soapAction.endsWith('/nfeDistDFeInteresse'));

  assert.strictEqual(ufPorCodigo(35), 'SP');
});

conferir('URL de consulta sai na versão do QR-Code e cabe no urlChave', () => {
  // Em SP a chave sem sufixo ainda é a página .aspx antiga, com 95 caracteres:
  // só a _1.00 cabe no limite de 85 do urlChave (leiauteNFe_v4.00.xsd).
  const sp = urlsConsulta('NFCe', 'SP', 2);
  assert.ok(sp.consulta.endsWith('/consulta'), `esperava a URL curta de SP, veio ${sp.consulta}`);
  assert.ok(sp.qrCode.endsWith('/qrcode'), `esperava o QR-Code curto de SP, veio ${sp.qrCode}`);
  for (const uf of UFS) {
    for (const amb of [1, 2] as const) {
      const { consulta } = urlsConsulta('NFCe', uf, amb);
      assert.ok(consulta.length <= 85, `urlChave de ${uf}/${amb} tem ${consulta.length} caracteres: ${consulta}`);
    }
  }

  // SC publica a _2.00 e é ela que vale para o QR-Code versão 2
  const sc = urlsConsulta('NFCe', 'SC', 2);
  assert.ok(sc.consulta.includes('sat.sef.sc.gov.br'), sc.consulta);

  // Versão 1 não pode enxergar uma chave _2.00
  assert.ok(urlsConsulta('NFCe', 'SP', 2, 1).consulta.endsWith('/consulta'));
});

conferir('serviço inexistente falha com mensagem clara', () => {
  assert.throws(
    () => resolverServico('NFe', 'ZZ', 2, 'NFeStatusServico'),
    /Sessão "NFe_ZZ_H" não existe/,
  );
});

// --- XML ------------------------------------------------------------------
conferir('construtor de XML omite vazios e escapa o conteúdo', () => {
  assert.strictEqual(tag('xNome', 'Casa & Cia'), '<xNome>Casa &amp; Cia</xNome>');
  assert.strictEqual(tag('xCpl', ''), '');
  assert.strictEqual(tag('xCpl', undefined), '');
  assert.strictEqual(grupo('vol', '', ''), '', 'grupo sem filhos não deve ser gerado');
  assert.strictEqual(grupo('vol', tag('qVol', 2)), '<vol><qVol>2</qVol></vol>');
  assert.strictEqual(num(1.005, 2), '1.01');
  assert.strictEqual(num(undefined, 2), '0.00');
  assert.strictEqual(limparTexto('  Ação   com\nacento  '), 'Acao com acento');
});

conferir('data do formulário não muda de dia nem de mês, em qualquer fuso do servidor', () => {
  // new Date("2026-09-20") é meia-noite UTC: em São Paulo virava 21h do dia 19
  assert.ok(dataHoraDFe(dataDoDocumento('2026-09-20')).startsWith('2026-09-20T'), 'o dia foi alterado');
  // No dia 1º o erro ainda trocava o mês da chave de acesso
  assert.strictEqual(anoMesChave(dataDoDocumento('2026-10-01')), '2610');
  assert.strictEqual(dataHoraDFe(dataDoDocumento('2026-09-20T14:30')), '2026-09-20T14:30:00-03:00');
  assert.strictEqual(dataHoraDFe(dataDoDocumento('2026-09-20T17:30:00Z')), '2026-09-20T14:30:00-03:00');
  assert.strictEqual(dataHoraDFe(dataDoDocumento('2026-09-20T14:30:00-03:00')), '2026-09-20T14:30:00-03:00');
});

conferir('dhEmi sai no horário de Brasília, com offset explícito', () => {
  const texto = dataHoraDFe(new Date(2026, 8, 20, 22, 15, 30));
  assert.strictEqual(texto, '2026-09-20T22:15:30-03:00');
});

// --- Sessão ---------------------------------------------------------------
conferir('token de sessão: vale só inteiro, dentro do prazo e com o segredo certo', () => {
  const segredoOriginal = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'segredo-de-teste-com-mais-de-32-caracteres-0123456789';
  try {
    const agora = Date.now();
    const token = criarToken(7, 1, agora);
    assert.deepStrictEqual(lerToken(token, agora), { uid: 7, emp: 1 });

    // Trocar a empresa no corpo sem refazer a assinatura: era o ataque do x-empresa-id
    const [corpo, assinatura] = token.split('.');
    const dados = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'));
    const forjado = `${Buffer.from(JSON.stringify({ ...dados, emp: 2 })).toString('base64url')}.${assinatura}`;
    assert.strictEqual(lerToken(forjado, agora), null, 'token com empresa trocada não pode valer');

    assert.strictEqual(lerToken(`${corpo}.${assinatura.slice(0, -2)}xx`, agora), null, 'assinatura alterada');
    assert.strictEqual(lerToken('', agora), null);
    assert.strictEqual(lerToken('lixo', agora), null);

    // Vence em 12 horas
    assert.ok(lerToken(token, agora + 11 * 3_600_000), 'ainda devia valer em 11 h');
    assert.strictEqual(lerToken(token, agora + 13 * 3_600_000), null, 'não pode valer depois de 12 h');

    // Outro servidor, outro segredo: token de um não vale no outro
    process.env.SESSION_SECRET = 'outro-segredo-com-mais-de-32-caracteres-abcdefghij';
    assert.strictEqual(lerToken(token, agora), null, 'token assinado com outro segredo');

    // Segredo curto demais é recusado em vez de gerar token fraco
    process.env.SESSION_SECRET = 'curto';
    assert.throws(() => criarToken(7, 1), /SESSION_SECRET/);
  } finally {
    if (segredoOriginal === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = segredoOriginal;
  }
});

// --- Totais ---------------------------------------------------------------
conferir('soma dos totais da nota', () => {
  const totais = somarTotais([
    {
      codigo: '1', descricao: 'A', ncm: '84713012', cfop: '5102', unidade: 'UN',
      quantidade: 3, valorUnitario: 10.5, valorDesconto: 1.5,
      imposto: {
        origem: 0, cst: '00', baseCalculo: 30, aliquota: 18, valor: 5.4,
        pis: { cst: '01', valor: 0.52 }, cofins: { cst: '01', valor: 2.39 },
      },
    },
    {
      codigo: '2', descricao: 'B', ncm: '84713012', cfop: '5102', unidade: 'UN',
      quantidade: 1, valorUnitario: 100, valorFrete: 10,
      imposto: {
        origem: 0, cst: '40',
        pis: { cst: '07' }, cofins: { cst: '07' },
      },
    },
  ] as any);

  assert.strictEqual(totais.vProd, 131.5);
  assert.strictEqual(totais.vDesc, 1.5);
  assert.strictEqual(totais.vFrete, 10);
  assert.strictEqual(totais.vICMS, 5.4);
  // vNF = produtos - desconto + frete
  assert.strictEqual(totais.vNF, 140);
});

console.log('\nTudo certo.');
