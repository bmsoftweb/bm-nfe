import React, { useEffect, useState } from 'react';
import { ArrowLeft, Plus, Save, Send, Trash2 } from 'lucide-react';
import * as api from '../services/api';
import { Emitente, Meta } from '../types';
import { ALTURA_CONTROLE, Area, Botao, Campo, Confirmacao, Faixa, Secao, Selecao, Texto, Vazio } from './ui';
import { Toggle } from './Toggle';
import { NumberField } from './NumberField';
import { DateField } from './DateField';
import { PainelRespostas, useOperacao } from './PainelRespostas';
import { formatarChave, formatarMoeda } from '../utils/formatters';
import { TRIBUTOS_PADRAO, Tributos, TributosItem, lerTributos, montarTributos } from './TributosItem';

/**
 * "Criar e Enviar" do exemplo Delphi: monta a nota, gera e assina o XML e, se
 * o usuário confirmar, transmite. Cobre o caso comum de venda — os grupos mais
 * raros do layout (exportação, comércio exterior, combustíveis) ficam de fora.
 */

interface ItemForm {
  codigo: string;
  descricao: string;
  ncm: string;
  cfop: string;
  unidade: string;
  quantidade: string;
  valorUnitario: string;
  /** Tributos pelo caminho em `imposto` (ver TributosItem) */
  trib: Tributos;
}

const novoItem = (): ItemForm => ({
  codigo: '',
  descricao: '',
  ncm: '',
  cfop: '5102',
  unidade: 'UN',
  quantidade: '1.0000',
  valorUnitario: '0.00',
  trib: { ...TRIBUTOS_PADRAO },
});

const hoje = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Nota de origem do "Novo (copiar)": o número dela e os dados do formulário que a geraram */
export interface CopiaNFe {
  numero: number;
  dados: any;
}

/** Nota aberta para correção ("Editar"): só assinada ou rejeitada, e regrava o mesmo registro */
export interface EdicaoNFe {
  id: number;
  numero: number;
  dados: any;
  /** Retorno da SEFAZ que a rejeitou, mostrado no topo para orientar a correção */
  rejeicao?: string;
}

/** Texto para o NumberField, que trabalha com o valor canônico ("1.0000") */
const decimal = (valor: any, casas: number, padrao: string) =>
  valor === undefined || valor === null || valor === '' ? padrao : Number(valor).toFixed(casas);

/**
 * Valores iniciais do formulário. Sem origem, os padrões de uma nota nova; com
 * origem (cópia ou edição), tudo o que ela tinha. Número e data ficam a cargo de
 * quem chama: a cópia recomeça, a edição mantém.
 */
function valoresIniciais(dados?: any) {
  const d = dados || {};
  const ide = d.ide || {};
  const dest = d.destinatario || {};
  const end = dest.endereco || {};
  const texto = (v: any, padrao = '') => (v === undefined || v === null ? padrao : String(v));

  return {
    naturezaOperacao: texto(ide.naturezaOperacao, 'VENDA DE MERCADORIA'),
    serie: texto(ide.serie, '1'),
    tipoDocumento: texto(ide.tipoDocumento, '1'),
    finalidade: texto(ide.finalidade, '1'),
    consumidorFinal: Number(ide.consumidorFinal) === 1,
    presencial: texto(ide.presencial, '1'),

    destDocumento: texto(dest.cnpj || dest.cpf),
    destNome: texto(dest.nome),
    destIE: texto(dest.inscricaoEstadual),
    destIndIE: texto(dest.indIEDest, '9'),
    destEmail: texto(dest.email),
    destLogradouro: texto(end.logradouro),
    destNumero: texto(end.numero),
    destBairro: texto(end.bairro),
    destCodMunicipio: texto(end.codigoMunicipio),
    destMunicipio: texto(end.municipio),
    destUf: texto(end.uf, 'SP'),
    destCep: texto(end.cep),

    itens: Array.isArray(d.itens) && d.itens.length
      ? d.itens.map((i: any): ItemForm => ({
          codigo: texto(i.codigo),
          descricao: texto(i.descricao),
          ncm: texto(i.ncm),
          cfop: texto(i.cfop, '5102'),
          unidade: texto(i.unidade, 'UN'),
          quantidade: decimal(i.quantidade, 4, '1.0000'),
          valorUnitario: decimal(i.valorUnitario, 2, '0.00'),
          trib: lerTributos(i),
        }))
      : [novoItem()],

    modalidadeFrete: texto(d.transporte?.modalidadeFrete, '9'),
    formaPagamento: texto(d.pagamentos?.[0]?.forma, '01'),
    observacoes: texto(d.informacoesAdicionais?.contribuinte),
  };
}

export const NovaNFeView: React.FC<{
  meta: Meta | null;
  /** Regime (CRT) e UF do emitente decidem os campos de tributo */
  emitente: Emitente | null;
  /** Nota de origem quando a tela foi aberta pelo "Novo (copiar)" */
  copiaDe?: CopiaNFe | null;
  /** Nota sendo corrigida, quando a tela foi aberta pelo "Editar" */
  edicao?: EdicaoNFe | null;
  onCancelar: () => void;
  onEmitida: () => void;
}> = ({ meta, emitente, copiaDe, edicao, onCancelar, onEmitida }) => {
  const { retorno, erro, errosSchema, carregando, executar, setErro, falhar } = useOperacao();

  // Calculado uma vez: a tela nasce preenchida e dali em diante o usuário edita
  const [inicial] = useState(() => valoresIniciais(edicao?.dados || copiaDe?.dados));

  const [naturezaOperacao, setNaturezaOperacao] = useState(inicial.naturezaOperacao);
  const [serie, setSerie] = useState(inicial.serie);
  // Na edição, número e data são os da própria nota; na cópia e na nota nova, recomeçam
  const [numero, setNumero] = useState(() => (edicao ? String(edicao.dados?.ide?.numero ?? edicao.numero) : ''));
  const [dataPrevisaoEntrega, setDataPrevisaoEntrega] = useState<string>(
    () => edicao?.dados?.ide?.dataPrevisaoEntrega || '',
  );
  const [dataEmissao, setDataEmissao] = useState(() => {
    const original = edicao?.dados?.ide?.dataEmissao;
    return typeof original === 'string' && /^\d{4}-\d{2}-\d{2}/.test(original) ? original.slice(0, 10) : hoje();
  });
  const [tipoDocumento, setTipoDocumento] = useState(inicial.tipoDocumento);
  const [finalidade, setFinalidade] = useState(inicial.finalidade);
  const [consumidorFinal, setConsumidorFinal] = useState(inicial.consumidorFinal);
  const [presencial, setPresencial] = useState(inicial.presencial);

  const [destDocumento, setDestDocumento] = useState(inicial.destDocumento);
  const [destNome, setDestNome] = useState(inicial.destNome);
  const [destIE, setDestIE] = useState(inicial.destIE);
  const [destIndIE, setDestIndIE] = useState(inicial.destIndIE);
  const [destEmail, setDestEmail] = useState(inicial.destEmail);
  const [destLogradouro, setDestLogradouro] = useState(inicial.destLogradouro);
  const [destNumero, setDestNumero] = useState(inicial.destNumero);
  const [destBairro, setDestBairro] = useState(inicial.destBairro);
  const [destCodMunicipio, setDestCodMunicipio] = useState(inicial.destCodMunicipio);
  const [destMunicipio, setDestMunicipio] = useState(inicial.destMunicipio);
  const [destUf, setDestUf] = useState(inicial.destUf);
  const [destCep, setDestCep] = useState(inicial.destCep);

  const [itens, setItens] = useState<ItemForm[]>(inicial.itens);
  const [modalidadeFrete, setModalidadeFrete] = useState(inicial.modalidadeFrete);
  const [formaPagamento, setFormaPagamento] = useState(inicial.formaPagamento);
  const [observacoes, setObservacoes] = useState(inicial.observacoes);

  // Nota nova ou cópia: sugere o próximo número da série (o usuário pode trocar)
  useEffect(() => {
    if (edicao || numero) return;
    api.proximoNumero(serie).then((r) => setNumero((atual) => atual || String(r.numero))).catch(() => {});
  }, [serie]);

  const [chaveGerada, setChaveGerada] = useState('');
  // Linha gravada pelo primeiro "Gerar" desta tela; os seguintes regravam a mesma
  const [idGerado, setIdGerado] = useState<number | undefined>();
  const [totalNota, setTotalNota] = useState<number | null>(null);
  const [removendoItem, setRemovendoItem] = useState<number | null>(null);
  const [confirmandoEnvio, setConfirmandoEnvio] = useState(false);

  // Não contribuinte é sempre consumidor final (rejeição 696): o toggle trava em Sim.
  // O servidor confere a mesma regra, para valer também para quem chama a API direto.
  const naoContribuinte = destIndIE === '9';
  const consumidorFinalEfetivo = naoContribuinte || consumidorFinal;

  // CRT 1 e 4 usam CSOSN; o 2 (excesso de sublimite) usa CST
  const simples = [1, 4].includes(Number(emitente?.crt));
  // Mesma regra do servidor: outra UF + consumidor final + não contribuinte = DIFAL
  const difal = !!destDocumento && !!destLogradouro && !!emitente?.uf &&
    destUf !== emitente.uf && destUf !== 'EX' && consumidorFinalEfetivo && naoContribuinte;
  const contextoTributos = (i: ItemForm) => ({ t: i.trib, simples, difal, cfop: i.cfop });

  const total = itens.reduce(
    (acc, i) => acc + Number(i.quantidade || 0) * Number(i.valorUnitario || 0),
    0,
  );

  const alterarItem = (indice: number, campo: Exclude<keyof ItemForm, 'trib'>, valor: string) => {
    setItens((atual) => atual.map((i, n) => (n === indice ? { ...i, [campo]: valor } : i)));
  };

  const alterarTributo = (indice: number, k: string, valor: string) => {
    setItens((atual) => atual.map((i, n) => (n === indice ? { ...i, trib: { ...i.trib, [k]: valor } } : i)));
  };

  const montarDocumento = () => ({
    ide: {
      naturezaOperacao,
      serie: Number(serie),
      numero: Number(numero),
      dataEmissao,
      dataPrevisaoEntrega: dataPrevisaoEntrega || undefined,
      tipoDocumento: Number(tipoDocumento),
      finalidade: Number(finalidade),
      consumidorFinal: consumidorFinalEfetivo ? 1 : 0,
      presencial: Number(presencial),
    },
    destinatario: destDocumento
      ? {
          [destDocumento.replace(/\D/g, '').length === 11 ? 'cpf' : 'cnpj']: destDocumento.replace(/\D/g, ''),
          nome: destNome,
          inscricaoEstadual: destIE,
          indIEDest: Number(destIndIE),
          email: destEmail,
          endereco: destLogradouro
            ? {
                logradouro: destLogradouro,
                numero: destNumero,
                bairro: destBairro,
                codigoMunicipio: destCodMunicipio,
                municipio: destMunicipio,
                uf: destUf,
                cep: destCep,
              }
            : undefined,
        }
      : undefined,
    // Bases e valores dos tributos são calculados no servidor
    itens: itens.map((i) => ({
      codigo: i.codigo,
      descricao: i.descricao,
      ncm: i.ncm,
      cfop: i.cfop,
      unidade: i.unidade,
      quantidade: Number(i.quantidade || 0),
      valorUnitario: Number(i.valorUnitario || 0),
      // imposto, e também DI e combustível quando o item tiver
      ...montarTributos(contextoTributos(i)),
    })),
    transporte: { modalidadeFrete: Number(modalidadeFrete) },
    // Sem valor: o servidor usa o total da nota, que já inclui IPI, ST etc.
    pagamentos: [{ forma: formaPagamento }],
    informacoesAdicionais: { contribuinte: observacoes },
  });

  const gerar = async () => {
    setErro(null);
    try {
      // Na edição, e a partir do segundo "Gerar" de uma nota nova, o servidor regrava a
      // mesma linha: o número é único por série e não pode virar uma segunda nota
      const resposta = await api.gerarNFe(montarDocumento(), edicao?.id ?? idGerado);
      setIdGerado(resposta.documentoId);
      setChaveGerada(resposta.chave);
      setTotalNota(resposta.totais?.vNF ?? null);
    } catch (err: any) {
      // Sem chave, o "Transmitir" volta a ficar bloqueado até gerar um XML válido
      setChaveGerada('');
      setTotalNota(null);
      falhar(err);
    }
  };

  const transmitir = async () => {
    setConfirmandoEnvio(false);
    await executar(() => api.enviarNFe({ chave: chaveGerada }));
    onEmitida();
  };

  const valido = numero && naturezaOperacao && itens.every((i) => i.descricao && i.ncm && i.cfop);

  return (
    <div className="flex flex-col">
      {/* Barra de ferramentas encostada no topo, como no b2b admin */}
      <div className="px-4 py-2.5 border-b border-stone-200 dark:border-stone-800 flex items-center gap-3">
        <Botao icone={<ArrowLeft className="w-3.5 h-3.5" />} onClick={onCancelar}>
          Voltar
        </Botao>
        <h2 className="text-sm font-bold text-stone-800 dark:text-stone-100">
          {edicao ? `Editar NF-e nº ${edicao.numero}` : 'Nova NF-e'}
          {copiaDe && !edicao && (
            <span className="ml-2 font-medium text-stone-500 dark:text-stone-400">
              — cópia da nº {copiaDe.numero}
            </span>
          )}
        </h2>
      </div>

      {edicao && (
        <Faixa tom="alerta">
          {edicao.rejeicao ? (
            <div className="flex flex-col gap-1">
              <span className="font-semibold">Rejeitada pela SEFAZ: {edicao.rejeicao}</span>
              <span>Corrija o que for preciso, gere o XML de novo e transmita. A nota continua sendo a mesma na lista.</span>
            </div>
          ) : (
            <span>Nota assinada e ainda não enviada. Ao gerar de novo, o XML anterior é substituído.</span>
          )}
        </Faixa>
      )}

      <Secao titulo="Identificação">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          <Texto
            rotulo="Natureza da operação"
            required
            maxLength={60}
            value={naturezaOperacao}
            onChange={(e) => setNaturezaOperacao(e.target.value)}
            className="lg:col-span-5"
          />
          <Texto
            rotulo="Série"
            required
            inputMode="numeric"
            value={serie}
            onChange={(e) => setSerie(e.target.value.replace(/\D/g, ''))}
            className="lg:col-span-1"
          />
          <Texto
            rotulo="Número"
            required
            inputMode="numeric"
            value={numero}
            onChange={(e) => setNumero(e.target.value.replace(/\D/g, ''))}
            dica={copiaDe ? `A copiada era a nº ${copiaDe.numero}` : undefined}
            className="lg:col-span-2"
          />
          <Campo rotulo="Data de emissão" className="lg:col-span-2">
            <DateField value={dataEmissao} onChange={setDataEmissao} required />
          </Campo>
          <Campo rotulo="Previsão de entrega" className="lg:col-span-2">
            <DateField value={dataPrevisaoEntrega} onChange={setDataPrevisaoEntrega} />
          </Campo>
          <Selecao
            rotulo="Tipo"
            value={tipoDocumento}
            onChange={(e) => setTipoDocumento(e.target.value)}
            opcoes={[
              { valor: '1', rotulo: 'Saída' },
              { valor: '0', rotulo: 'Entrada' },
            ]}
            className="lg:col-span-2"
          />

          <Selecao
            rotulo="Finalidade"
            value={finalidade}
            onChange={(e) => setFinalidade(e.target.value)}
            opcoes={[
              { valor: '1', rotulo: 'Normal' },
              { valor: '2', rotulo: 'Complementar' },
              { valor: '3', rotulo: 'Ajuste' },
              { valor: '4', rotulo: 'Devolução' },
            ]}
            className="lg:col-span-3"
          />
          <Campo
            rotulo="Consumidor final"
            dica={naoContribuinte ? 'Obrigatório para destinatário não contribuinte (rejeição 696)' : undefined}
            className="lg:col-span-3"
          >
            {/* Mesma altura dos selects vizinhos, para a linha ficar alinhada */}
            <div className={`${ALTURA_CONTROLE} flex items-center`}>
              <Toggle
                checked={consumidorFinalEfetivo}
                onChange={setConsumidorFinal}
                disabled={naoContribuinte}
                title={naoContribuinte ? 'Travado em Sim: o destinatário é não contribuinte' : undefined}
              />
            </div>
          </Campo>
          <Selecao
            rotulo="Presença do comprador"
            value={presencial}
            onChange={(e) => setPresencial(e.target.value)}
            opcoes={[
              { valor: '0', rotulo: 'Não se aplica' },
              { valor: '1', rotulo: 'Presencial' },
              { valor: '2', rotulo: 'Internet' },
              { valor: '3', rotulo: 'Teleatendimento' },
              { valor: '4', rotulo: 'Entrega a domicílio' },
              { valor: '9', rotulo: 'Outros' },
            ]}
            className="lg:col-span-3"
          />
          <Selecao
            rotulo="Modalidade do frete"
            value={modalidadeFrete}
            onChange={(e) => setModalidadeFrete(e.target.value)}
            opcoes={[
              { valor: '0', rotulo: '0 — Por conta do emitente' },
              { valor: '1', rotulo: '1 — Por conta do destinatário' },
              { valor: '2', rotulo: '2 — Por conta de terceiros' },
              { valor: '3', rotulo: '3 — Próprio (remetente)' },
              { valor: '4', rotulo: '4 — Próprio (destinatário)' },
              { valor: '9', rotulo: '9 — Sem frete' },
            ]}
            className="lg:col-span-3"
          />
        </div>
      </Secao>

      <Secao titulo="Destinatário" descricao="Em homologação a razão social é substituída pela frase exigida pela SEFAZ">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          <Texto
            rotulo="CNPJ / CPF"
            inputMode="numeric"
            value={destDocumento}
            onChange={(e) => setDestDocumento(e.target.value.replace(/\D/g, '').slice(0, 14))}
            className="lg:col-span-3"
          />
          <Texto
            rotulo="Nome / Razão social"
            maxLength={60}
            value={destNome}
            onChange={(e) => setDestNome(e.target.value)}
            className="lg:col-span-6"
          />
          <Selecao
            rotulo="Indicador de IE"
            value={destIndIE}
            onChange={(e) => setDestIndIE(e.target.value)}
            opcoes={[
              { valor: '1', rotulo: '1 — Contribuinte' },
              { valor: '2', rotulo: '2 — Isento' },
              { valor: '9', rotulo: '9 — Não contribuinte' },
            ]}
            className="lg:col-span-3"
          />

          {destIndIE === '1' && (
            <Texto
              rotulo="Inscrição Estadual"
              inputMode="numeric"
              value={destIE}
              onChange={(e) => setDestIE(e.target.value.replace(/\D/g, ''))}
              className="lg:col-span-3"
            />
          )}
          <Texto
            rotulo="E-mail"
            type="email"
            value={destEmail}
            onChange={(e) => setDestEmail(e.target.value)}
            className="lg:col-span-4"
          />

          <Texto
            rotulo="Logradouro"
            value={destLogradouro}
            onChange={(e) => setDestLogradouro(e.target.value)}
            className="lg:col-span-5"
          />
          <Texto
            rotulo="Número"
            value={destNumero}
            onChange={(e) => setDestNumero(e.target.value)}
            className="lg:col-span-2"
          />
          <Texto
            rotulo="Bairro"
            value={destBairro}
            onChange={(e) => setDestBairro(e.target.value)}
            className="lg:col-span-5"
          />
          <Texto
            rotulo="Código IBGE do município"
            inputMode="numeric"
            value={destCodMunicipio}
            onChange={(e) => setDestCodMunicipio(e.target.value.replace(/\D/g, '').slice(0, 7))}
            className="lg:col-span-3"
          />
          <Texto
            rotulo="Município"
            value={destMunicipio}
            onChange={(e) => setDestMunicipio(e.target.value)}
            className="lg:col-span-4"
          />
          <Selecao
            rotulo="UF"
            value={destUf}
            onChange={(e) => setDestUf(e.target.value)}
            opcoes={(meta?.ufs || []).map((u) => ({ valor: u, rotulo: u }))}
            className="lg:col-span-2"
          />
          <Texto
            rotulo="CEP"
            inputMode="numeric"
            value={destCep}
            onChange={(e) => setDestCep(e.target.value.replace(/\D/g, '').slice(0, 8))}
            className="lg:col-span-3"
          />
        </div>
      </Secao>

      <Secao
        titulo="Itens"
        descricao={`${itens.length} item(ns) • total ${formatarMoeda(total)}`}
        acoes={
          <Botao icone={<Plus className="w-3.5 h-3.5" />} onClick={() => setItens((a) => [...a, novoItem()])}>
            Adicionar item
          </Botao>
        }
      >
        {itens.length === 0 ? (
          <Vazio mensagem="Acrescente ao menos um item." />
        ) : (
          <div className="flex flex-col gap-3">
            {itens.map((item, indice) => (
              <div
                key={indice}
                className="border border-stone-200 dark:border-stone-800 p-3 grid grid-cols-1 lg:grid-cols-12 gap-3"
              >
                <Texto
                  rotulo="Código"
                  value={item.codigo}
                  onChange={(e) => alterarItem(indice, 'codigo', e.target.value)}
                  className="lg:col-span-2"
                />
                <Texto
                  rotulo="Descrição"
                  required
                  value={item.descricao}
                  onChange={(e) => alterarItem(indice, 'descricao', e.target.value)}
                  className="lg:col-span-5"
                />
                <Texto
                  rotulo="NCM"
                  required
                  inputMode="numeric"
                  value={item.ncm}
                  onChange={(e) => alterarItem(indice, 'ncm', e.target.value.replace(/\D/g, '').slice(0, 8))}
                  className="lg:col-span-2"
                />
                <Texto
                  rotulo="CFOP"
                  required
                  inputMode="numeric"
                  value={item.cfop}
                  onChange={(e) => alterarItem(indice, 'cfop', e.target.value.replace(/\D/g, '').slice(0, 4))}
                  className="lg:col-span-1"
                />
                <Texto
                  rotulo="Un."
                  value={item.unidade}
                  onChange={(e) => alterarItem(indice, 'unidade', e.target.value.slice(0, 6))}
                  className="lg:col-span-1"
                />
                <div className="lg:col-span-1 flex items-end justify-end">
                  <Botao
                    variante="perigo"
                    icone={<Trash2 className="w-3.5 h-3.5" />}
                    title="Remover item"
                    onClick={() => setRemovendoItem(indice)}
                  />
                </div>

                <Campo rotulo="Quantidade" className="lg:col-span-2">
                  <NumberField
                    value={item.quantidade}
                    scale={4}
                    onChange={(v) => alterarItem(indice, 'quantidade', v)}
                  />
                </Campo>
                <Campo rotulo="Valor unitário" className="lg:col-span-2">
                  <NumberField
                    value={item.valorUnitario}
                    scale={2}
                    onChange={(v) => alterarItem(indice, 'valorUnitario', v)}
                  />
                </Campo>
                <Campo rotulo="Total do item" className="lg:col-span-2">
                  <div className="text-xs font-semibold text-stone-800 dark:text-stone-100 h-[34px] flex items-center justify-end px-3 bg-stone-50 dark:bg-stone-800/60">
                    {formatarMoeda(Number(item.quantidade || 0) * Number(item.valorUnitario || 0))}
                  </div>
                </Campo>
                <TributosItem contexto={contextoTributos(item)} onAlterar={(k, v) => alterarTributo(indice, k, v)} />
              </div>
            ))}
          </div>
        )}
      </Secao>

      <Secao titulo="Pagamento e observações">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          <Selecao
            rotulo="Forma de pagamento"
            value={formaPagamento}
            onChange={(e) => setFormaPagamento(e.target.value)}
            opcoes={[
              { valor: '01', rotulo: '01 — Dinheiro' },
              { valor: '02', rotulo: '02 — Cheque' },
              { valor: '03', rotulo: '03 — Cartão de crédito' },
              { valor: '04', rotulo: '04 — Cartão de débito' },
              { valor: '05', rotulo: '05 — Crédito da loja' },
              { valor: '15', rotulo: '15 — Boleto bancário' },
              { valor: '17', rotulo: '17 — PIX' },
              { valor: '90', rotulo: '90 — Sem pagamento' },
              { valor: '99', rotulo: '99 — Outros' },
            ]}
            className="lg:col-span-4"
          />
          <Area
            rotulo="Informações complementares"
            rows={2}
            maxLength={5000}
            value={observacoes}
            onChange={(e) => setObservacoes(e.target.value)}
            className="lg:col-span-8"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-stone-200 dark:border-stone-800 mt-4">
          <div className="text-xs text-stone-500 dark:text-stone-400">
            {chaveGerada ? (
              <>
                Chave gerada: <span className="font-mono text-stone-800 dark:text-stone-100">{formatarChave(chaveGerada)}</span>
                {totalNota !== null && <> • total da nota {formatarMoeda(totalNota)}</>}
              </>
            ) : (
              'Gere o XML antes de transmitir.'
            )}
          </div>
          <div className="flex gap-2">
            <Botao icone={<Save className="w-3.5 h-3.5" />} disabled={!valido} onClick={gerar}>
              Gerar e Assinar
            </Botao>
            <Botao
              variante="primario"
              icone={<Send className="w-3.5 h-3.5" />}
              carregando={carregando}
              disabled={!chaveGerada}
              onClick={() => setConfirmandoEnvio(true)}
            >
              Transmitir
            </Botao>
          </div>
        </div>
      </Secao>

      <PainelRespostas
        retorno={retorno}
        erro={erro}
        errosSchema={errosSchema}
        carregando={carregando}
        resumo={[
          ['Recibo do lote', retorno?.dados?.recibo],
          ['Protocolo', retorno?.dados?.protocolo],
          ['Situação da nota', retorno?.dados?.cStatNota && `${retorno.dados.cStatNota} — ${retorno.dados.motivoNota}`],
        ]}
      />

      <Confirmacao
        aberto={removendoItem !== null}
        titulo="Remover este item?"
        mensagem={`O item ${removendoItem !== null ? removendoItem + 1 : ''} sai da nota.`}
        rotuloConfirmar="Remover"
        onConfirmar={() => {
          setItens((a) => a.filter((_, n) => n !== removendoItem));
          setRemovendoItem(null);
        }}
        onCancelar={() => setRemovendoItem(null)}
      />

      <Confirmacao
        aberto={confirmandoEnvio}
        titulo="Transmitir esta NF-e?"
        mensagem="A nota será enviada à SEFAZ para autorização."
        rotuloConfirmar="Transmitir"
        perigo={false}
        onConfirmar={transmitir}
        onCancelar={() => setConfirmandoEnvio(false)}
      />
    </div>
  );
};
