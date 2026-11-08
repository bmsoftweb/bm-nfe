/**
 * Teste de ponta a ponta da emissão, sem tocar na SEFAZ: gera um certificado de
 * mentira, monta uma NF-e, assina, confere a assinatura e imprime o DANFE.
 *
 * É o caminho que mais quebra em silêncio — um XML fora de ordem ou uma
 * canonicalização errada só aparecem como rejeição 297 lá na SEFAZ.
 *
 * Rode com:  npx tsx server/nfe/autoteste-emissao.ts
 */
import assert from 'assert';
import forge from 'node-forge';
import { CertificadoCarregado } from './certificado.js';
import { Contexto } from './contexto.js';
import { assinar, conferirAssinatura } from './assinatura.js';
import { gerarNFe } from './gerarNFe.js';
import { gerarDanfe } from './danfe.js';
import { CONFIG_PADRAO } from '../config.js';
import { chaveValida } from './chave.js';
import { semDeclaracao } from './xml.js';
import { montarEvento, montarInutilizacao, PedidoEvento, ufDaNota } from './operacoes.js';
import { decidir, PRAZO_PROCESSANDO_S, situacaoPeloStatus, validarReferencia } from './concentrador.js';
import {
  FalhaSchema, ResultadoValidacao, exigirValido, validarEvento, validarInutilizacao, validarNFe, validarQualquer,
} from './validacao.js';

function conferir(nome: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn()).then(() => console.log(`  ok  ${nome}`));
}

/** Certificado autoassinado, só para exercitar a assinatura */
function certificadoDeTeste(): CertificadoCarregado {
  const par = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = par.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);

  const nome = [{ name: 'commonName', value: 'EMPRESA TESTE LTDA:05321136000117' }];
  cert.setSubject(nome);
  cert.setIssuer(nome);
  cert.sign(par.privateKey, forge.md.sha256.create());

  const certificadoPem = forge.pki.certificateToPem(cert);

  return {
    chavePrivadaPem: forge.pki.privateKeyToPem(par.privateKey),
    certificadoPem,
    certificadoBase64: certificadoPem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, ''),
    cadeiaPem: [],
    info: {
      razaoSocial: 'EMPRESA TESTE LTDA',
      cnpj: '05321136000117',
      numeroSerie: '01',
      emissor: 'TESTE',
      validoDe: cert.validity.notBefore,
      validoAte: cert.validity.notAfter,
      diasParaVencer: 365,
    },
  };
}

const contexto = (modelo: '55' | '65' = '55'): Contexto => ({
  empresaId: 1,
  config: {
    ...CONFIG_PADRAO,
    geral: { ...CONFIG_PADRAO.geral, modeloDF: modelo, idCSC: '1', csc: 'CSC-DE-TESTE' },
    webservice: { ...CONFIG_PADRAO.webservice, uf: 'SP', ambiente: 2 },
  },
  emitente: {
    id: 1,
    cnpj: '05321136000117',
    inscricao_estadual: '111111111111',
    razao_social: 'EMPRESA TESTE LTDA',
    nome_fantasia: 'TESTE',
    logradouro: 'RUA DAS FLORES',
    numero: '100',
    complemento: '',
    bairro: 'CENTRO',
    codigo_municipio: '3550308',
    municipio: 'SAO PAULO',
    uf: 'SP',
    cep: '01001000',
    fone: '1133334444',
    crt: 3,
  },
  certificado: certificadoDeTeste(),
  modelo: modelo === '65' ? 'NFCe' : 'NFe',
});

const documento = {
  ide: {
    naturezaOperacao: 'VENDA DE MERCADORIA',
    serie: 1,
    numero: 123,
    tipoDocumento: 1,
    finalidade: 1,
    consumidorFinal: 1,
    presencial: 1,
  },
  destinatario: {
    cnpj: '11222333000181',
    nome: 'CLIENTE EXEMPLO LTDA',
    indIEDest: 9,
    endereco: {
      logradouro: 'AVENIDA BRASIL',
      numero: '500',
      bairro: 'JARDIM',
      codigoMunicipio: '3550308',
      municipio: 'SAO PAULO',
      uf: 'SP',
      cep: '01310000',
    },
  },
  itens: [
    {
      codigo: 'P001',
      descricao: 'Produto de teste',
      ncm: '84713012',
      cfop: '5102',
      unidade: 'UN',
      quantidade: 2,
      valorUnitario: 50.25,
      imposto: {
        origem: 0,
        cst: '00',
        modBC: 3,
        baseCalculo: 100.5,
        aliquota: 18,
        valor: 18.09,
        pis: { cst: '01', base: 100.5, aliquota: 1.65, valor: 1.66 },
        cofins: { cst: '01', base: 100.5, aliquota: 7.6, valor: 7.64 },
      },
    },
  ],
  transporte: { modalidadeFrete: 9 },
  pagamentos: [{ forma: '01', valor: 100.5 }],
  informacoesAdicionais: { contribuinte: 'Documento gerado em teste automatizado.' },
};

async function principal() {
  console.log('Autoteste de emissão\n');

  const ctx = contexto('55');
  const gerada = gerarNFe(ctx, documento as any);

  await conferir('XML gerado com chave válida e totais fechados', () => {
    assert.ok(chaveValida(gerada.chave));
    assert.strictEqual(gerada.totais.vProd, 100.5);
    assert.strictEqual(gerada.totais.vNF, 100.5);
    assert.ok(gerada.xml.includes(`Id="NFe${gerada.chave}"`));
  });

  await conferir('ordem dos grupos obrigatórios segue o schema', () => {
    const ordem = ['<ide>', '<emit>', '<dest>', '<det nItem="1">', '<total>', '<transp>', '<pag>', '<infAdic>'];
    let posicao = -1;
    for (const marca of ordem) {
      const achado = gerada.xml.indexOf(marca);
      assert.ok(achado > 0, `grupo ausente no XML: ${marca}`);
      assert.ok(achado > posicao, `grupo fora de ordem: ${marca}`);
      posicao = achado;
    }
  });

  await conferir('não contribuinte sem consumidor final é barrado (rejeição 696)', () => {
    const errado = { ...documento, ide: { ...documento.ide, consumidorFinal: 0 } };
    assert.throws(() => gerarNFe(ctx, errado as any), /696/);
  });

  await conferir('operação com o exterior fica fora da regra 696', () => {
    const exterior = { ...documento, ide: { ...documento.ide, consumidorFinal: 0, idDestino: 3 } };
    assert.doesNotThrow(() => gerarNFe(ctx, exterior as any));
  });

  await conferir('IE informada sem indicador vira contribuinte e leva a tag <IE>', () => {
    const contribuinte = {
      ...documento,
      ide: { ...documento.ide, consumidorFinal: 0 },
      destinatario: { ...documento.destinatario, indIEDest: undefined, inscricaoEstadual: '123.456.789' },
    };
    const xml = gerarNFe(ctx, contribuinte as any).xml;
    assert.ok(xml.includes('<indIEDest>1</indIEDest>'), 'indicador devia ser 1');
    assert.ok(xml.includes('<IE>123456789</IE>'), 'a IE do destinatário não podia sumir');
  });

  await conferir('em homologação o nome do destinatário é substituído', () => {
    assert.ok(gerada.xml.includes('NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL'));
    assert.ok(!gerada.xml.includes('CLIENTE EXEMPLO LTDA'));
  });

  const assinado = assinar(semDeclaracao(gerada.xml), 'infNFe', `NFe${gerada.chave}`, ctx.certificado);

  await conferir('assinatura entra depois de infNFe e é verificável', () => {
    assert.ok(assinado.includes('<Signature'), 'faltou o elemento Signature');
    assert.ok(
      assinado.indexOf('</infNFe>') < assinado.indexOf('<Signature'),
      'a assinatura precisa vir depois de </infNFe>',
    );
    assert.ok(assinado.includes('xmldsig#rsa-sha1'), 'a NF-e exige RSA-SHA1');
    assert.ok(assinado.includes('REC-xml-c14n-20010315'), 'a NF-e exige C14N 1.0 inclusiva');
    assert.ok(assinado.includes(`URI="#NFe${gerada.chave}"`), 'a referência precisa apontar para o Id da infNFe');

    const conferencia = conferirAssinatura(assinado);
    assert.ok(conferencia.valida, `assinatura recusada: ${conferencia.erro}`);
  });

  await conferir('alterar o XML assinado invalida a assinatura', () => {
    const adulterado = assinado.replace('<vNF>100.50</vNF>', '<vNF>999.99</vNF>');
    assert.notStrictEqual(adulterado, assinado, 'o valor não foi encontrado para adulterar');
    assert.ok(!conferirAssinatura(adulterado).valida, 'o XML adulterado não podia passar');
  });

  await conferir('DANFE sai em PDF', async () => {
    const pdf = await gerarDanfe(`<?xml version="1.0" encoding="UTF-8"?>${assinado}`, { homologacao: true });
    assert.ok(pdf.length > 3000, `PDF pequeno demais (${pdf.length} bytes)`);
    assert.strictEqual(pdf.subarray(0, 4).toString(), '%PDF');
  });

  await conferir('formato da série vira o tpImp e escolhe o DANFE (paisagem, simplificado e reimpressão)', async () => {
    assert.ok(gerada.xml.includes('<tpImp>1</tpImp>'), 'sem formato, o padrão é retrato');
    const tamanhoDaPagina = async (formatoImpressao: number) => {
      const xml = gerarNFe(ctx, { ...documento, ide: { ...documento.ide, formatoImpressao } } as any).xml;
      assert.ok(xml.includes(`<tpImp>${formatoImpressao}</tpImp>`), `tpImp devia ser ${formatoImpressao}`);
      const pdf = (await gerarDanfe(xml)).toString('latin1');
      return pdf.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/)!.slice(1).map((n) => Math.round(Number(n)));
    };
    const [largPaisagem, altPaisagem] = await tamanhoDaPagina(2);
    assert.ok(largPaisagem > altPaisagem, 'paisagem devia ser A4 deitado');
    const [largSimplificado] = await tamanhoDaPagina(3);
    assert.strictEqual(largSimplificado, 227, 'o simplificado é a faixa de 80 mm');
    // Reimpressão: o formato atual da série vale mais que o tpImp 1 gravado na emissão
    const reimpressa = (await gerarDanfe(gerada.xml, { formato: 3 })).toString('latin1');
    assert.strictEqual(Math.round(Number(reimpressa.match(/\/MediaBox \[0 0 ([\d.]+)/)![1])), 227, 'formato da série devia valer na reimpressão');
    assert.ok(gerarNFe(contexto('65'), { ...documento, ide: { ...documento.ide, formatoImpressao: 3 } } as any).xml.includes('<tpImp>4</tpImp>'));
  });

  await conferir('NFC-e ganha o bloco suplementar com QR-Code', () => {
    const nfce = gerarNFe(contexto('65'), documento as any);
    assert.ok(nfce.xml.includes('<infNFeSupl>'));
    assert.ok(nfce.xml.includes('<qrCode>'));
    assert.ok(/\|2\|2\|/.test(nfce.xml), 'o QR-Code deve trazer versão 2 e ambiente 2');
  });

  // --- Schemas oficiais (recursos/Schemas) ---------------------------------

  const semErros = (r: ResultadoValidacao) =>
    `${r.schema}: ${r.erros.map((e) => `${e.campo ?? ''} ${e.mensagem}`).join(' | ')}`;

  await conferir('NF-e assinada passa no nfe_v4.00.xsd', async () => {
    const r = await validarNFe(assinado);
    assert.ok(r.valido, semErros(r));
    assert.strictEqual(r.schema, 'nfe_v4.00.xsd');
  });

  await conferir('NFC-e assinada passa no nfe_v4.00.xsd (com QR-Code)', async () => {
    const ctxNfce = contexto('65');
    const nfce = gerarNFe(ctxNfce, documento as any);
    const nfceAssinada = assinar(semDeclaracao(nfce.xml), 'infNFe', `NFe${nfce.chave}`, ctxNfce.certificado);
    const r = await validarNFe(nfceAssinada);
    assert.ok(r.valido, semErros(r));
  });

  await conferir('responsável técnico da configuração entra no XML e passa no schema', async () => {
    const ctxRt = contexto('55');
    ctxRt.config.geral = {
      ...ctxRt.config.geral,
      respTecCNPJ: '11.222.333/0001-81', respTecContato: 'SUPORTE', respTecEmail: 'suporte@teste.com.br',
      respTecFone: '(11) 3333-4444', idCSRT: '01', csrt: 'CSRT-DE-TESTE',
    };
    const nota = gerarNFe(ctxRt, documento as any);
    assert.ok(nota.xml.includes('<infRespTec><CNPJ>11222333000181</CNPJ>'), 'faltou o infRespTec');
    assert.ok(nota.xml.includes('<hashCSRT>'), 'faltou o hashCSRT');
    const r = await validarNFe(assinar(semDeclaracao(nota.xml), 'infNFe', `NFe${nota.chave}`, ctxRt.certificado));
    assert.ok(r.valido, semErros(r));
  });

  // --- Tributos: cada grupo novo tem de passar no XSD e fechar os totais -----

  const validarAssinando = async (c: Contexto, doc: any) => {
    const nota = gerarNFe(c, doc);
    const r = await validarNFe(assinar(semDeclaracao(nota.xml), 'infNFe', `NFe${nota.chave}`, c.certificado));
    assert.ok(r.valido, semErros(r));
    return nota;
  };
  const item = (imposto: any, extra: any = {}) => ({
    codigo: 'P1', descricao: 'Produto', ncm: '84713012', cfop: '5102', unidade: 'UN',
    quantidade: 1, valorUnitario: 100, ...extra,
    imposto: { origem: 0, pis: { cst: '07' }, cofins: { cst: '07' }, ...imposto },
  });
  const ibscbs = { cst: '000', classificacao: '000001', aliquotaIBSUF: 0.1, aliquotaIBSMun: 0, aliquotaCBS: 0.9 };

  await conferir('regime normal: FCP, ST, desoneração, diferimento, IPI, II, PIS/COFINS e IBS/CBS no XSD', async () => {
    const nota = await validarAssinando(ctx, {
      ...documento,
      ide: { ...documento.ide, consumidorFinal: 0 },
      destinatario: { ...documento.destinatario, indIEDest: 1, inscricaoEstadual: '111111111111' },
      itens: [
        item({ cst: '00', aliquota: 18, aliquotaFCP: 2, ipi: { cst: '50', aliquota: 10 },
          pis: { cst: '01', aliquota: 1.65 }, cofins: { cst: '01', aliquota: 7.6 }, ibscbs, valorAproximadoTributos: 30 }),
        item({ cst: '10', aliquota: 18, mvaST: 40, aliquotaST: 18, aliquotaFCPST: 2, ibscbs }),
        item({ cst: '20', aliquota: 18, reducaoBC: 10, valorDesonerado: 1.8, motivoDesoneracao: 9, deduzDesoneracao: true }),
        item({ cst: '30', aliquota: 12, mvaST: 30, aliquotaST: 18, valorDesonerado: 5, motivoDesoneracao: 9 }),
        item({ cst: '40', valorDesonerado: 18, motivoDesoneracao: 9 }),
        item({ cst: '51', aliquota: 18, percentualDiferimento: 33.33 }),
        item({ cst: '60', baseSTRetido: 100, aliquotaSTRetido: 18, valorSTRetido: 18 }),
        item({ cst: '70', aliquota: 18, reducaoBC: 20, mvaST: 40, aliquotaST: 18 }),
        item({ cst: '90', aliquota: 18, aliquotaST: 18, mvaST: 30 }),
        item({ cst: '00', aliquota: 18, ii: { base: 100, despesasAduaneiras: 5, valor: 10, iof: 0 } }, { cfop: '5102' }),
        item({ cst: '41', ibscbs: { ...ibscbs, cst: '200', reducao: 60 } }),
        item({ cst: '41', ibscbs: { ...ibscbs, cst: '510', diferimento: 100 } }),
        item({ cst: '41', ibscbs: { cst: '410', classificacao: '410001' } }),
      ],
    });
    const t = nota.totais;
    assert.strictEqual(t.vICMS, 114.6); // 18 + 18 + 16,20 + 12,00 (51 com 1/3 diferido) + 14,40 + 18 + 18
    assert.strictEqual(t.vIPI, 10);
    assert.strictEqual(t.vII, 10);
    assert.strictEqual(t.vFCP, 2);
    assert.strictEqual(t.vICMSDeson, 24.8);
    // vNF = produtos - desonerado deduzido + ST + FCP-ST + IPI + II
    assert.strictEqual(t.vNF, Number((1300 - 1.8 + t.vST + t.vFCPST + 10 + 10).toFixed(2)));
    assert.ok(nota.xml.includes('<IBSCBSTot>'), 'faltou o total do IBS/CBS');
    assert.ok(nota.xml.includes('<gRed><pRedAliq>60.0000</pRedAliq>'), 'faltou a redução do IBS/CBS');
    assert.ok(nota.xml.includes('<vTotTrib>30.00</vTotTrib>'));
  });

  await conferir('Simples Nacional: CSOSN 101, 201, 202, 500 e 900 no XSD', async () => {
    const ctxSN = contexto('55');
    ctxSN.emitente = { ...ctxSN.emitente, crt: 1 };
    const nota = await validarAssinando(ctxSN, {
      ...documento,
      itens: [
        item({ csosn: '101', aliquotaCredito: 2.5 }),
        item({ csosn: '201', aliquota: 18, mvaST: 40, aliquotaST: 18, aliquotaCredito: 2.5 }),
        item({ csosn: '202', aliquota: 18, mvaST: 40, aliquotaST: 18, aliquotaFCPST: 2 }),
        item({ csosn: '500', baseSTRetido: 100, aliquotaSTRetido: 18, valorSTRetido: 18 }),
        item({ csosn: '900', aliquota: 18, aliquotaST: 18, mvaST: 30, aliquotaCredito: 1 }),
      ],
    });
    assert.ok(nota.xml.includes('<ICMSSN201>'), 'o CSOSN 201 tem grupo próprio');
    assert.ok(nota.xml.includes('<ICMSSN202><orig>0</orig><CSOSN>202</CSOSN>'));
    // 201: ST = 140 x 18% - 18 = 7,20
    assert.ok(nota.xml.includes('<vBCST>140.00</vBCST><pICMSST>18.0000</pICMSST><vICMSST>7.20</vICMSST>'));
  });

  await conferir('DIFAL: interestadual a não contribuinte leva ICMSUFDest', async () => {
    const paraRJ = {
      ...documento,
      destinatario: { ...documento.destinatario, endereco: { ...documento.destinatario.endereco, uf: 'RJ', codigoMunicipio: '3304557' } },
    };
    assert.throws(() => gerarNFe(ctx, { ...paraRJ, itens: [item({ cst: '00', aliquota: 12 }, { cfop: '6102' })] } as any), /694/);
    const nota = await validarAssinando(ctx, {
      ...paraRJ,
      itens: [item({ cst: '00', aliquota: 12, difal: { aliquotaInterna: 20, aliquotaFCP: 2 } }, { cfop: '6102' })],
    });
    assert.ok(nota.xml.includes('<idDest>2</idDest>'), 'o destino devia sair da UF do destinatário');
    assert.strictEqual(nota.totais.vICMSUFDest, 8);
    assert.strictEqual(nota.totais.vFCPUFDest, 2);
  });

  await conferir('serviço: ISSQN no lugar do ICMS, ISSQNtot e inscrição municipal', async () => {
    const servico = { ...documento, itens: [item({ issqn: { aliquota: 5, codigoServico: '01.01' }, ibscbs })] };
    assert.throws(() => gerarNFe(ctx, servico as any), /inscrição municipal/);
    const ctxServ = contexto('55');
    ctxServ.config.geral = { ...ctxServ.config.geral, inscricaoMunicipal: '12345', cnae: '6201501' };
    const nota = await validarAssinando(ctxServ, servico);
    assert.ok(!nota.xml.includes('<ICMS>'), 'item de serviço não leva ICMS');
    assert.strictEqual(nota.totais.vServ, 100);
    assert.strictEqual(nota.totais.vProd, 0);
    assert.strictEqual(nota.totais.vNF, 100);
    assert.ok(nota.xml.includes('<vISS>5.00</vISS>'));
  });

  await conferir('importação: DI com adição no prod, junto do II', async () => {
    const di = {
      numero: '2412345678', data: '2026-09-01', localDesembaraco: 'PORTO DE SANTOS', ufDesembaraco: 'SP',
      dataDesembaraco: '2026-09-05', viaTransporte: 1, afrmm: 25, intermedio: 1, codigoExportador: 'EXP001',
      adicoes: [{ numero: 1, sequencia: 1, fabricante: 'FAB001' }],
    };
    const nota = await validarAssinando(ctx, {
      ...documento,
      ide: { ...documento.ide, tipoDocumento: 0, consumidorFinal: 0, idDestino: 3 },
      itens: [item({ cst: '00', aliquota: 18, ii: { base: 100, despesasAduaneiras: 5, valor: 10, iof: 0 } }, { cfop: '3102', di })],
    });
    assert.ok(nota.xml.includes('<indTot>1</indTot><DI><nDI>2412345678</nDI>'), 'o DI vem logo depois do indTot');
    assert.ok(nota.xml.includes('<adi><nAdicao>1</nAdicao><nSeqAdic>1</nSeqAdic><cFabricante>FAB001</cFabricante></adi>'));
  });

  await conferir('monofasia: ICMS 02, 15, 53 e 61 com combustível, e IBS/CBS 620', async () => {
    const comb = { combustivel: { codigoANP: '320102001', descricaoANP: 'GASOLINA C COMUM' }, quantidade: 100, valorUnitario: 6 };
    const mono = { cst: '620', classificacao: '620001', monofasia: { adRemIBS: 0.1, adRemCBS: 0.9, valorIBSRetido: 1 } };
    assert.throws(() => gerarNFe(ctx, { ...documento, itens: [item({ cst: '02', adRemICMS: 1.47 })] } as any), /ANP/);
    const nota = await validarAssinando(ctx, {
      ...documento,
      itens: [
        item({ cst: '02', adRemICMS: 1.47, ibscbs: mono }, comb),
        item({ cst: '15', adRemICMS: 1.47, adRemICMSReten: 0.5, reducaoAdRem: 10, motivoReducaoAdRem: 9 }, comb),
        item({ cst: '53', adRemICMS: 1.47, percentualDiferimento: 50 }, comb),
        item({ cst: '61', adRemICMSRet: 1.47, ibscbs: { ...mono, monofasia: { valorIBSRetido: 2, valorCBSRetido: 3 } } }, comb),
      ],
    });
    const t = nota.totais;
    assert.strictEqual(t.qBCMono, 300);
    assert.strictEqual(t.vICMSMono, 147 + 147 + 73.5);
    assert.strictEqual(t.vICMSMonoReten, 50);
    assert.strictEqual(t.vICMSMonoRet, 147);
    assert.strictEqual(t.vIBSMono, 10);
    assert.strictEqual(t.vCBSMono, 90);
    assert.strictEqual(t.vIBSMonoRet, 3);
    assert.ok(nota.xml.includes('<comb><cProdANP>320102001</cProdANP>'));
    assert.ok(nota.xml.includes('<gMono>'), 'faltou o total da monofasia do IBS/CBS');
    // o ICMS monofásico já está no preço: não soma no total da nota
    assert.strictEqual(t.vNF, 2400);
  });

  // --- Reforma tributária: grupos da NT 2025.002 ------------------------------

  await conferir('imposto seletivo: IS no item e ISTot no total, no XSD', async () => {
    const nota = await validarAssinando(ctx, {
      ...documento,
      itens: [item({ cst: '00', aliquota: 18, ibscbs,
        seletivo: { cst: '000', classificacao: '000001', aliquota: 10, adRem: 0.5 } })],
    });
    // vIS = 100 × 10% + 1 un × 0,50 (RV UB11-10 da NT 2025.002)
    assert.strictEqual(nota.totais.vIS, 10.5);
    assert.ok(nota.xml.includes('<CSTIS>000</CSTIS>'), 'faltou o CSTIS');
    assert.ok(nota.xml.includes('<ISTot><vIS>10.50</vIS></ISTot>'), 'faltou o ISTot');
  });

  await conferir('crédito presumido, estorno, devolução e tributação regular no XSD', async () => {
    const nota = await validarAssinando(ctx, {
      ...documento,
      itens: [
        item({ cst: '00', aliquota: 18, ibscbs: {
          ...ibscbs,
          devolucaoIBSUF: 50,
          tribRegular: { cst: '000', classificacao: '000001', aliquotaIBSUF: 0.1, aliquotaIBSMun: 0, aliquotaCBS: 0.9 },
          credPres: { codigo: '1', aliquotaIBS: 5, aliquotaCBS: 5 },
          estornoIBS: 0.05, estornoCBS: 0.45,
        } }),
        item({ cst: '00', aliquota: 18, ibscbs: {
          ...ibscbs,
          credPres: { codigo: '2', aliquotaIBS: 3, suspensivo: true },
        } }),
      ],
    });
    const t = nota.totais;
    assert.ok(nota.xml.includes('<gCredPresOper>'), 'faltou o gCredPresOper');
    assert.ok(nota.xml.includes('<gTribRegular>'), 'faltou o gTribRegular');
    assert.ok(nota.xml.includes('<gDevTrib>'), 'faltou o gDevTrib');
    // A base, quando não informada, é a mesma do IBS/CBS: a operação sem os
    // tributos que coexistem (100 − 18 de ICMS = 82)
    assert.strictEqual(t.vCredPresIBS, 4.1);        // 5% de 82, sem condição suspensiva
    assert.strictEqual(t.vCredPresCondSusIBS, 2.46); // 3% de 82, com condição suspensiva
    assert.strictEqual(t.vCredPresCBS, 4.1);
    assert.strictEqual(t.vIBSEstCred, 0.05);
    assert.strictEqual(t.vCBSEstCred, 0.45);
    // Devolução de 50% sobre o IBS UF do item (0,10% de 82 = 0,08 → 0,04)
    assert.strictEqual(t.vDevTribIBSUF, 0.04);
    assert.ok(nota.xml.includes('<gEstornoCred><vIBSEstCred>0.05</vIBSEstCred>'), 'faltou o estorno no total');
  });

  await conferir('CST 800 leva gTransfCred e sem os valores é barrado', async () => {
    await validarAssinando(ctx, {
      ...documento,
      itens: [item({ cst: '41', ibscbs: { cst: '800', classificacao: '800001', transferencia: { ibs: 10, cbs: 90 } } })],
    });
    assert.throws(
      () => gerarNFe(ctx, {
        ...documento,
        itens: [item({ cst: '41', ibscbs: { cst: '800', classificacao: '800001' } })],
      } as any),
      /CST 800/,
    );
  });

  await conferir('CST 810 leva gAjusteCompet e valida a competência', async () => {
    await validarAssinando(ctx, {
      ...documento,
      itens: [item({ cst: '41', ibscbs: { cst: '810', classificacao: '810001', ajuste: { competencia: '2026-10', ibs: 1, cbs: 9 } } })],
    });
    assert.throws(
      () => gerarNFe(ctx, {
        ...documento,
        itens: [item({ cst: '41', ibscbs: { cst: '810', classificacao: '810001', ajuste: { competencia: '10/2026', ibs: 1, cbs: 9 } } })],
      } as any),
      /AAAA-MM/,
    );
  });

  await conferir('monofasia ad valorem e diferença de biocombustível no XSD', async () => {
    const nota = await validarAssinando(ctx, {
      ...documento,
      itens: [item(
        { cst: '02', adRemICMS: 1.2, ibscbs: { cst: '620', classificacao: '620001', monofasia: {
          baseAdValorem: 100, aliquotaAdValoremIBSUF: 0.05, aliquotaAdValoremIBSMun: 0.05, aliquotaAdValoremCBS: 0.9,
          quantidadeBio: 27, valorIBSDiferenca: 0.02, valorCBSDiferenca: 0.18,
        } } },
        { combustivel: { codigoANP: '320102001', descricaoANP: 'GASOLINA C COMUM' } },
      )],
    });
    assert.ok(nota.xml.includes('<gIBSMonoAdValorem>'), 'faltou o ramo ad valorem do IBS');
    assert.ok(nota.xml.includes('<gCBSMonoAdValorem>'), 'faltou o ramo ad valorem da CBS');
    assert.ok(nota.xml.includes('<gpBioDiferenca>'), 'faltou o gpBioDiferenca');
    assert.strictEqual(nota.totais.vIBSMono, 0.1); // 0,05% UF + 0,05% Mun sobre 100
    assert.strictEqual(nota.totais.vCBSMono, 0.9);
  });

  await conferir('doação e previsão de entrega no XSD', async () => {
    const nota = await validarAssinando(ctx, {
      ...documento,
      ide: { ...documento.ide, dataPrevisaoEntrega: '2026-12-15' },
      itens: [item({ cst: '00', aliquota: 18, ibscbs: { ...ibscbs, indDoacao: true } })],
    });
    assert.ok(nota.xml.includes('<dPrevEntrega>2026-12-15</dPrevEntrega>'), 'faltou o dPrevEntrega');
    assert.ok(nota.xml.includes('<indDoacao>1</indDoacao>'), 'faltou o indDoacao');
  });

  await conferir('vinculação da transação de pagamento (gPgtoVinc) no XSD', async () => {
    const nota = await validarAssinando(ctx, {
      ...documento,
      itens: [item({ cst: '00', aliquota: 18, ibscbs })],
      pagamentos: [{ forma: '03' }],
      vinculosPagamento: [{
        numero: 1, idTransacao: 'ABC-123456', meioPagamento: '3',
        cnpjRecebedor: '05321136000117', cnpjBasePSP: '05321136',
      }],
    });
    assert.ok(/<gPgto nPag="1" idTransacao="ABC-123456">/.test(nota.xml), 'faltou o gPgto');
    assert.ok(nota.xml.includes('<tpMeioPgto>03</tpMeioPgto>'), 'faltou o tpMeioPgto');
  });

  // --- NT 2026.007: emitente sem IE (contribuinte exclusivo do IBS/CBS) ----------

  const semIE = (modelo: '55' | '65' = '55'): Contexto => {
    const c = contexto(modelo);
    return { ...c, emitente: { ...c.emitente, inscricao_estadual: '' } };
  };

  await conferir('emitente sem IE: NF-e sem a tag IE e sem ICMS, no XSD, autorizada na SVRS', async () => {
    const c = semIE();
    const nota = await validarAssinando(c, {
      ...documento,
      // O CST do ICMS vindo da tela é ignorado: a RV N01-10 proíbe o grupo
      itens: [item({ cst: '00', aliquota: 18, ibscbs })],
    });
    assert.ok(!/<emit>.*<IE>/.test(nota.xml), 'a IE do emitente não podia ir');
    assert.ok(!nota.xml.includes('<ICMS>'), 'o ICMS não podia ir');
    assert.strictEqual(nota.totais.vICMS, 0);
    assert.strictEqual(ufDaNota(c, nota.chave), 'SVRS');
    assert.strictEqual(ufDaNota(ctx, nota.chave), 'SP'); // com IE, a nota é da UF
  });

  await conferir('emitente sem IE: item sem IBS/CBS e NFC-e são barrados; ISENTO continua indo', async () => {
    assert.throws(() => gerarNFe(semIE(), { ...documento, itens: [item({ cst: '00', aliquota: 18 })] } as any), /rejeição 162/);
    assert.throws(() => gerarNFe(semIE('65'), documento as any), /NFC-e exige a Inscrição Estadual/);
    const c = contexto();
    const isento = gerarNFe({ ...c, emitente: { ...c.emitente, inscricao_estadual: 'ISENTO' } }, documento as any);
    assert.ok(isento.xml.includes('<IE>ISENTO</IE>'), 'ISENTO sumiu');
    assert.ok(isento.xml.includes('<ICMS>'), 'com ISENTO o ICMS continua');
  });

  await conferir('NCM inválido é barrado, apontando o campo', async () => {
    const r = await validarNFe(assinado.replace('<NCM>84713012</NCM>', '<NCM>8471301</NCM>'));
    assert.ok(!r.valido, 'NCM com 7 dígitos não podia passar');
    assert.ok(r.erros.some((e) => e.campo === 'NCM'), `o erro devia apontar NCM: ${semErros(r)}`);
    assert.ok(/não atende ao formato/.test(r.erros[0].mensagem), 'a mensagem devia sair em português');
  });

  await conferir('grupo fora de ordem é barrado', async () => {
    const trocado = assinado.replace(/(<ide>[\s\S]*?<\/ide>)(<emit>[\s\S]*?<\/emit>)/, '$2$1');
    const r = await validarNFe(trocado);
    assert.ok(!r.valido);
    assert.ok(r.erros.some((e) => /fora de ordem/.test(e.mensagem)), semErros(r));
  });

  await conferir('"Exibir erro de schema" desligado esconde o detalhe', async () => {
    const r = await validarNFe(assinado.replace('<NCM>84713012</NCM>', '<NCM>1</NCM>'));
    const capturar = (detalhar: boolean) => {
      try {
        exigirValido(r, 'Falha na validação dos dados da nota: 123', detalhar);
      } catch (e) {
        return e as FalhaSchema;
      }
      throw new Error('exigirValido devia ter barrado');
    };

    const comDetalhe = capturar(true);
    const semDetalhe = capturar(false);
    assert.ok(comDetalhe.message.includes('NCM'), 'com a opção ligada a mensagem traz o campo');
    assert.strictEqual(semDetalhe.message, 'Falha na validação dos dados da nota: 123');
    assert.strictEqual(semDetalhe.detalhar, false);
  });

  // Eventos: o lote contra envEvento_v1.00 e o detEvento contra e<código>_v1.00
  const eventos: [string, Partial<PedidoEvento>][] = [
    ['110111 cancelamento', { protocolo: '135260000000001', justificativa: 'Cancelamento por erro de digitacao no pedido' }],
    ['110110 carta de correção', { correcao: 'Correcao do endereco de entrega informado no pedido' }],
    ['210210 ciência da operação', {}],
    ['210240 operação não realizada', { justificativa: 'Mercadoria devolvida antes da entrega ao cliente' }],
  ];

  for (const [rotulo, extras] of eventos) {
    await conferir(`evento ${rotulo} passa nos dois schemas`, async () => {
      const { mensagem, tipo } = montarEvento(ctx, { chave: gerada.chave, tipoEvento: rotulo.slice(0, 6), ...extras });
      const r = await validarEvento(mensagem, tipo.codigo);
      assert.ok(r.valido, semErros(r));
    });
  }

  await conferir('evento 112140 fornecimento não realizado passa nos dois schemas', async () => {
    const m = montarEvento(ctx, {
      chave: gerada.chave,
      tipoEvento: '112140',
      itensNaoFornecidos: [{ item: 1, valorIBS: 0.1, valorCBS: 0.9, quantidade: 2, unidade: 'UN' }],
    });
    const r = await validarEvento(m.mensagem, '112140');
    assert.ok(r.valido, semErros(r));
    assert.ok(m.mensagem.includes('<gItemNaoFornecido nItem="1">'), 'faltou o gItemNaoFornecido');
  });

  await conferir('evento 112150 atualização da previsão de entrega passa nos dois schemas', async () => {
    const m = montarEvento(ctx, {
      chave: gerada.chave,
      tipoEvento: '112150',
      dataPrevisaoEntrega: '2026-12-20',
    });
    const r = await validarEvento(m.mensagem, '112150');
    assert.ok(r.valido, semErros(r));
    assert.ok(m.mensagem.includes('<dPrevEntrega>2026-12-20</dPrevEntrega>'), 'faltou o dPrevEntrega');

    assert.throws(
      () => montarEvento(ctx, { chave: gerada.chave, tipoEvento: '112150' }),
      /previsão de entrega/,
    );
  });

  await conferir('evento 110300 vinculação de pagamento passa nos dois schemas', async () => {
    const m = montarEvento(ctx, {
      chave: gerada.chave,
      tipoEvento: '110300',
      protocolo: '135260000000001',
      vinculoPagamento: {
        idTransacao: 'PIX-E2E-0001', meioPagamento: '3',
        cnpjRecebedor: '05321136000117', cnpjBasePSP: '00000000',
      },
    });
    const r = await validarEvento(m.mensagem, '110300');
    assert.ok(r.valido, semErros(r));
    assert.ok(m.mensagem.includes('<gPgto idTransacao="PIX-E2E-0001"><tpMeioPgto>03</tpMeioPgto>'), 'gPgto errado');
  });

  await conferir('evento 110001 cancela o 110300 e passa nos dois schemas', async () => {
    const m = montarEvento(ctx, {
      chave: gerada.chave,
      tipoEvento: '110001',
      eventoCancelado: '110300',
      protocolo: '135260000000002',
    });
    const r = await validarEvento(m.mensagem, '110001');
    assert.ok(r.valido, semErros(r));
    assert.ok(m.mensagem.includes('<tpEventoAut>110300</tpEventoAut><nProtEvento>135260000000002</nProtEvento>'));
    assert.throws(
      () => montarEvento(ctx, { chave: gerada.chave, tipoEvento: '110001', eventoCancelado: '110111', protocolo: '135260000000002' }),
      /evento a cancelar/,
    );
  });

  await conferir('protocolo curto no cancelamento é barrado pelo e110111', async () => {
    // nProt tem 15 dígitos no schema específico; o envEvento genérico não sabe disso
    const { mensagem } = montarEvento(ctx, {
      chave: gerada.chave,
      tipoEvento: '110111',
      protocolo: '123',
      justificativa: 'Cancelamento por erro de digitacao no pedido',
    });
    const r = await validarEvento(mensagem, '110111');
    assert.ok(!r.valido, 'protocolo de 3 dígitos não podia passar');
    assert.strictEqual(r.schema, 'e110111_v1.00.xsd', 'quem barra é o schema específico do evento');
  });

  await conferir('inutilização passa no inutNFe_v4.00.xsd', async () => {
    const { assinado: inut } = montarInutilizacao(ctx, {
      ano: 2026, modelo: '55', serie: 1, numeroInicial: 10, numeroFinal: 12,
      justificativa: 'Numeracao pulada por falha no sistema emissor',
    });
    const r = await validarInutilizacao(inut);
    assert.ok(r.valido, semErros(r));
  });

  // --- Concentrador: a decisão que, se errar, gera nota duplicada ------------

  await conferir('concentrador: cada situação da referência leva à ação certa', async () => {
    assert.strictEqual(decidir(undefined, 0), 'nova');
    for (const s of ['rascunho', 'assinada', 'rejeitada']) assert.strictEqual(decidir(s, 0), 'gerar', s);
    assert.strictEqual(decidir('processando', 5), 'ocupada');
    // Processo que caiu no meio: depois do prazo vira "enviada sem resposta", nunca "gerar"
    assert.strictEqual(decidir('processando', PRAZO_PROCESSANDO_S), 'verificar');
    assert.strictEqual(decidir('enviada', 0), 'verificar');
    assert.strictEqual(decidir('autorizada', 0), 'devolver');
    for (const s of ['cancelada', 'denegada']) assert.strictEqual(decidir(s, 0), 'usada', s);
  });

  await conferir('concentrador: cStat do protocolo e da consulta viram a situação certa', async () => {
    assert.strictEqual(situacaoPeloStatus(100), 'autorizada');
    assert.strictEqual(situacaoPeloStatus(150), 'autorizada');
    assert.strictEqual(situacaoPeloStatus(101), 'cancelada');
    assert.strictEqual(situacaoPeloStatus(110), 'denegada');
    assert.strictEqual(situacaoPeloStatus(302), 'denegada');
    assert.strictEqual(situacaoPeloStatus(539), 'rejeitada');
    assert.strictEqual(validarReferencia('  PDV-000123 '), 'PDV-000123');
    assert.throws(() => validarReferencia(''), /referência/);
    assert.throws(() => validarReferencia('x'.repeat(81)), /referência/);
  });

  await conferir('validarQualquer reconhece o tipo pela raiz', async () => {
    assert.strictEqual((await validarQualquer(assinado)).schema, 'nfe_v4.00.xsd');
    const { mensagem } = montarEvento(ctx, { chave: gerada.chave, tipoEvento: '210210' });
    assert.strictEqual((await validarQualquer(mensagem)).schema, 'e210210_v1.00.xsd');
  });

  console.log('\nTudo certo.');
}

principal().catch((err) => {
  console.error('\nFALHOU:', err.message);
  process.exit(1);
});
