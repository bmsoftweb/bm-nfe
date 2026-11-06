import React from 'react';
import { ALTURA_CONTROLE, Campo, Selecao, Texto } from './ui';
import { Toggle } from './Toggle';
import { NumberField } from './NumberField';
import { DateField } from './DateField';

/**
 * Tributos de um item da Nova NF-e. Cada campo é descrito uma vez só, pelo
 * caminho dentro de `imposto` no documento enviado ao servidor: a mesma tabela
 * decide o que aparece na tela, o que vai para a API e o que se lê de volta na
 * edição e na cópia. Campo escondido não é enviado — assim a regra de "qual CST
 * leva o quê" fica só aqui, e o servidor calcula bases e valores.
 *
 * Caminhos com prefixo `item:` (DI, combustível) ficam no próprio item, fora do `imposto`.
 */

/** Valores do formulário, pelo caminho em `imposto` ("aliquota", "pis.cst"...). Sim/não = '1' ou '' */
export type Tributos = Record<string, string>;

/** O que muda os campos visíveis */
export interface Contexto {
  t: Tributos;
  simples: boolean;
  /** Interestadual para consumidor final não contribuinte */
  difal: boolean;
  cfop: string;
}

type Opcao = { valor: string; rotulo: string };

interface CampoTributo {
  k: string;
  rotulo: string;
  tipo: 'pct' | 'valor' | 'texto' | 'digitos' | 'sim' | 'opcoes' | 'data';
  opcoes?: Opcao[] | ((c: Contexto) => Opcao[]);
  /** Select ou texto que vai para a API como número */
  numero?: boolean;
  max?: number;
  col?: number;
  se?: (c: Contexto) => boolean;
}

interface Grupo {
  titulo: string;
  se?: (c: Contexto) => boolean;
  campos: CampoTributo[];
}

const lista = (pares: [string, string][]): Opcao[] => pares.map(([valor, r]) => ({ valor, rotulo: `${valor} — ${r}` }));

const servico = (c: Contexto) => c.t._servico === '1';
/** CST (regime normal) ou CSOSN (Simples) do item está entre os códigos */
const icmsEm = (...codigos: string[]) => (c: Contexto) =>
  !servico(c) && codigos.includes(c.simples ? c.t.csosn : c.t.cst);

const PIS_COFINS_TRIBUTADOS = ['01', '02', '49', '50', '51', '52', '53', '54', '55', '56', '60', '61', '62', '63', '64', '65', '66', '67', '70', '71', '72', '73', '74', '75', '98', '99'];
const IBSCBS_SEM_VALORES = ['400', '410'];

const MOTIVOS_DESONERACAO: Record<string, string> = {
  '1': 'Táxi', '3': 'Produtor agropecuário', '4': 'Frotista/locadora', '5': 'Diplomático/consular',
  '6': 'Utilitários e motos (Amazônia/ALC)', '7': 'SUFRAMA', '8': 'Venda a órgão público', '9': 'Outros',
  '10': 'Deficiente condutor', '11': 'Deficiente não condutor', '12': 'Fomento agropecuário',
  '16': 'Olimpíadas Rio 2016', '90': 'Solicitado pelo Fisco',
};
/** Motivos aceitos pelo schema em cada CST */
const MOTIVOS_POR_CST: Record<string, string[]> = {
  '20': ['3', '9', '10', '11', '12'],
  '30': ['6', '7', '9'],
  '40': ['1', '3', '4', '5', '6', '7', '8', '9', '10', '11', '16', '90'],
  '70': ['3', '9', '12'],
  '90': ['3', '9', '12'],
};

const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI',
  'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'].map((uf) => ({ valor: uf, rotulo: uf }));
/** Com a opção vazia, o select não mostra uma UF que não foi escolhida */
const UFS_OU_VAZIO = [{ valor: '', rotulo: '' }, ...UFS];

/** Monofasia de combustíveis no ICMS */
const monofasico = icmsEm('02', '15', '53', '61');
const ibscbsMono = (c: Contexto) => c.t['ibscbs.cst'] === '620';
const importacao = (c: Contexto) => !servico(c) && c.cfop.startsWith('3');
const porContaDeTerceiro = (c: Contexto) => ['2', '3'].includes(c.t['item:di.intermedio']);

const temST = icmsEm('10', '30', '70', '90', '201', '202', '203', '900');

export const GRUPOS: Grupo[] = [
  {
    titulo: 'ICMS',
    se: (c) => !servico(c),
    campos: [
      { k: 'origem', rotulo: 'Origem', tipo: 'opcoes', numero: true, col: 1,
        opcoes: ['0', '1', '2', '3', '4', '5', '6', '7', '8'].map((n) => ({ valor: n, rotulo: n })) },
      { k: 'cst', rotulo: 'CST ICMS', tipo: 'opcoes', col: 4, se: (c) => !c.simples,
        opcoes: lista([
          ['00', 'Tributada integralmente'], ['02', 'Monofásico próprio (combustíveis)'], ['10', 'Tributada com ST'],
          ['15', 'Monofásico próprio e com retenção'], ['20', 'Com redução de base'],
          ['30', 'Isenta/não tributada com ST'], ['40', 'Isenta'], ['41', 'Não tributada'], ['50', 'Suspensão'],
          ['51', 'Diferimento'], ['53', 'Monofásico com diferimento'], ['60', 'ST cobrada anteriormente'],
          ['61', 'Monofásico cobrado anteriormente'], ['70', 'Redução de base e ST'], ['90', 'Outras'],
        ]) },
      { k: 'csosn', rotulo: 'CSOSN', tipo: 'opcoes', col: 4, se: (c) => c.simples,
        opcoes: lista([
          ['101', 'Com permissão de crédito'], ['102', 'Sem permissão de crédito'], ['103', 'Isenção por faixa de receita'],
          ['201', 'Com crédito e com ST'], ['202', 'Sem crédito e com ST'], ['203', 'Isenção por faixa e com ST'],
          ['300', 'Imune'], ['400', 'Não tributada'], ['500', 'ST cobrada anteriormente'], ['900', 'Outros'],
        ]) },
      { k: 'aliquota', rotulo: 'Alíq. ICMS %', tipo: 'pct', se: icmsEm('00', '10', '20', '51', '70', '90', '900') },
      { k: 'aliquota', rotulo: 'Alíq. ICMS próprio %', tipo: 'pct', se: icmsEm('30', '201', '202', '203') },
      { k: 'reducaoBC', rotulo: 'Redução BC %', tipo: 'pct', se: icmsEm('20', '70', '90', '900') },
      { k: 'aliquotaFCP', rotulo: 'FCP %', tipo: 'pct', se: icmsEm('00', '10', '20', '51', '70', '90') },
      { k: 'percentualDiferimento', rotulo: 'Diferimento %', tipo: 'pct', se: icmsEm('51', '53', '90') },
      { k: 'adRemICMS', rotulo: 'Ad rem ICMS (R$/un)', tipo: 'pct', se: icmsEm('02', '15', '53') },
      { k: 'adRemICMSReten', rotulo: 'Ad rem retenção (R$/un)', tipo: 'pct', se: icmsEm('15') },
      { k: 'reducaoAdRem', rotulo: 'Redução ad rem %', tipo: 'valor', se: icmsEm('15') },
      { k: 'motivoReducaoAdRem', rotulo: 'Motivo da redução', tipo: 'opcoes', numero: true, col: 3, se: icmsEm('15'),
        opcoes: lista([['1', 'Transporte coletivo de passageiros'], ['9', 'Outros']]) },
      { k: 'adRemICMSRet', rotulo: 'Ad rem retida antes (R$/un)', tipo: 'pct', se: icmsEm('61') },
      { k: 'aliquotaCredito', rotulo: 'Crédito SN %', tipo: 'pct', se: icmsEm('101', '201', '900') },

      { k: 'modBCST', rotulo: 'Base da ST', tipo: 'opcoes', numero: true, col: 3, se: temST,
        opcoes: lista([
          ['0', 'Preço tabelado'], ['1', 'Lista negativa'], ['2', 'Lista positiva'], ['3', 'Lista neutra'],
          ['4', 'MVA'], ['5', 'Pauta'], ['6', 'Valor da operação'],
        ]) },
      { k: 'mvaST', rotulo: 'MVA ST %', tipo: 'pct', se: temST },
      { k: 'reducaoBCST', rotulo: 'Redução BC ST %', tipo: 'pct', se: temST },
      { k: 'aliquotaST', rotulo: 'Alíq. ICMS ST %', tipo: 'pct', se: temST },
      { k: 'aliquotaFCPST', rotulo: 'FCP ST %', tipo: 'pct', se: temST },

      { k: 'baseSTRetido', rotulo: 'BC ST retido', tipo: 'valor', se: icmsEm('60', '500') },
      { k: 'aliquotaSTRetido', rotulo: 'Alíq. ST retido %', tipo: 'pct', se: icmsEm('60', '500') },
      { k: 'valorSubstituto', rotulo: 'ICMS próprio do substituto', tipo: 'valor', se: icmsEm('60', '500') },
      { k: 'valorSTRetido', rotulo: 'ICMS ST retido', tipo: 'valor', se: icmsEm('60', '500') },

      { k: 'valorDesonerado', rotulo: 'ICMS desonerado', tipo: 'valor', se: icmsEm('20', '30', '40', '41', '50', '70', '90') },
      { k: 'motivoDesoneracao', rotulo: 'Motivo da desoneração', tipo: 'opcoes', numero: true, col: 3,
        se: icmsEm('20', '30', '40', '41', '50', '70', '90'),
        opcoes: (c) => lista(
          (MOTIVOS_POR_CST[['41', '50'].includes(c.t.cst) ? '40' : c.t.cst] || []).map((m) => [m, MOTIVOS_DESONERACAO[m]]),
        ) },
      { k: 'deduzDesoneracao', rotulo: 'Abate do total da nota', tipo: 'sim',
        se: icmsEm('20', '30', '40', '41', '50', '70', '90') },
    ],
  },
  {
    titulo: 'IPI',
    campos: [
      { k: 'ipi.cst', rotulo: 'CST IPI (vazio = sem IPI)', tipo: 'digitos', max: 2 },
      { k: 'ipi.codigoEnquadramento', rotulo: 'Enquadramento', tipo: 'digitos', max: 3, se: (c) => !!c.t['ipi.cst'] },
      { k: 'ipi.aliquota', rotulo: 'Alíq. IPI %', tipo: 'pct',
        se: (c) => ['00', '49', '50', '99'].includes(c.t['ipi.cst']) },
    ],
  },
  {
    titulo: 'PIS / COFINS',
    campos: [
      { k: 'pis.cst', rotulo: 'CST PIS', tipo: 'digitos', max: 2 },
      { k: 'pis.aliquota', rotulo: 'Alíq. PIS %', tipo: 'pct', se: (c) => PIS_COFINS_TRIBUTADOS.includes(c.t['pis.cst']) },
      { k: 'cofins.cst', rotulo: 'CST COFINS', tipo: 'digitos', max: 2 },
      { k: 'cofins.aliquota', rotulo: 'Alíq. COFINS %', tipo: 'pct', se: (c) => PIS_COFINS_TRIBUTADOS.includes(c.t['cofins.cst']) },
    ],
  },
  {
    titulo: 'Combustível (ANP)',
    se: (c) => monofasico(c) || ibscbsMono(c),
    campos: [
      { k: 'item:combustivel.codigoANP', rotulo: 'Código ANP', tipo: 'digitos', max: 9 },
      { k: 'item:combustivel.descricaoANP', rotulo: 'Descrição ANP', tipo: 'texto', max: 95, col: 4 },
      { k: 'item:combustivel.ufConsumo', rotulo: 'UF de consumo', tipo: 'opcoes',
        opcoes: [{ valor: '', rotulo: 'A do destinatário' }, ...UFS] },
      { k: 'item:combustivel.percentualBio', rotulo: 'Biocombustível %', tipo: 'pct' },
    ],
  },
  {
    titulo: 'Declaração de Importação (DI)',
    se: importacao,
    campos: [
      { k: 'item:di.numero', rotulo: 'Número da DI', tipo: 'texto', max: 15 },
      { k: 'item:di.data', rotulo: 'Data da DI', tipo: 'data' },
      { k: 'item:di.localDesembaraco', rotulo: 'Local do desembaraço', tipo: 'texto', max: 60, col: 3 },
      { k: 'item:di.ufDesembaraco', rotulo: 'UF', tipo: 'opcoes', col: 1, opcoes: UFS_OU_VAZIO },
      { k: 'item:di.dataDesembaraco', rotulo: 'Data do desembaraço', tipo: 'data' },
      { k: 'item:di.viaTransporte', rotulo: 'Via de transporte', tipo: 'opcoes', numero: true,
        opcoes: lista([
          ['1', 'Marítima'], ['2', 'Fluvial'], ['3', 'Lacustre'], ['4', 'Aérea'], ['5', 'Postal'], ['6', 'Ferroviária'],
          ['7', 'Rodoviária'], ['8', 'Conduto'], ['9', 'Meios próprios'], ['10', 'Entrada/saída ficta'],
          ['11', 'Courier'], ['12', 'Em mãos'], ['13', 'Por reboque'],
        ]) },
      { k: 'item:di.afrmm', rotulo: 'AFRMM', tipo: 'valor', se: (c) => c.t['item:di.viaTransporte'] === '1' },
      { k: 'item:di.intermedio', rotulo: 'Forma de importação', tipo: 'opcoes', numero: true, col: 3,
        opcoes: lista([['1', 'Por conta própria'], ['2', 'Por conta e ordem'], ['3', 'Por encomenda']]) },
      { k: 'item:di.cnpjAdquirente', rotulo: 'CNPJ adquirente/encomendante', tipo: 'digitos', max: 14, col: 3, se: porContaDeTerceiro },
      { k: 'item:di.ufTerceiro', rotulo: 'UF do terceiro', tipo: 'opcoes', col: 1, opcoes: UFS_OU_VAZIO, se: porContaDeTerceiro },
      { k: 'item:di.codigoExportador', rotulo: 'Código do exportador', tipo: 'texto', max: 60 },
      { k: 'item:di.adicoes.0.numero', rotulo: 'Nº da adição', tipo: 'digitos', numero: true, max: 3 },
      { k: 'item:di.adicoes.0.sequencia', rotulo: 'Seq. na adição', tipo: 'digitos', numero: true, max: 5 },
      { k: 'item:di.adicoes.0.fabricante', rotulo: 'Código do fabricante', tipo: 'texto', max: 60 },
    ],
  },
  {
    titulo: 'Importação (II)',
    se: importacao,
    campos: [
      { k: 'ii.base', rotulo: 'Base do II', tipo: 'valor' },
      { k: 'ii.despesasAduaneiras', rotulo: 'Despesas aduaneiras', tipo: 'valor' },
      { k: 'ii.valor', rotulo: 'Valor do II', tipo: 'valor' },
      { k: 'ii.iof', rotulo: 'IOF', tipo: 'valor' },
    ],
  },
  {
    titulo: 'DIFAL — UF de destino',
    se: (c) => !servico(c) && c.difal,
    campos: [
      { k: 'difal.aliquotaInterna', rotulo: 'Alíq. interna destino %', tipo: 'pct' },
      { k: 'difal.aliquotaFCP', rotulo: 'FCP destino %', tipo: 'pct' },
      { k: 'difal.aliquotaInterestadual', rotulo: 'Alíq. interestadual', tipo: 'opcoes', numero: true,
        opcoes: [{ valor: '', rotulo: 'A do ICMS' }, ...['4', '7', '12'].map((n) => ({ valor: n, rotulo: `${n}%` }))] },
    ],
  },
  {
    titulo: 'Serviço (ISSQN)',
    campos: [
      { k: '_servico', rotulo: 'Item de serviço', tipo: 'sim' },
      { k: 'issqn.codigoServico', rotulo: 'Serviço LC 116 (00.00)', tipo: 'texto', max: 5, se: servico },
      { k: 'issqn.aliquota', rotulo: 'Alíq. ISS %', tipo: 'pct', se: servico },
      { k: 'issqn.municipio', rotulo: 'Município IBGE (vazio = emitente)', tipo: 'digitos', max: 7, col: 3, se: servico },
      { k: 'issqn.exigibilidade', rotulo: 'Exigibilidade', tipo: 'opcoes', numero: true, col: 3, se: servico,
        opcoes: lista([
          ['1', 'Exigível'], ['2', 'Não incidência'], ['3', 'Isenção'], ['4', 'Exportação'], ['5', 'Imunidade'],
          ['6', 'Suspensa por decisão judicial'], ['7', 'Suspensa por processo administrativo'],
        ]) },
      { k: 'issqn.valorRetido', rotulo: 'ISS retido', tipo: 'valor', se: servico },
      { k: 'issqn.incentivo', rotulo: 'Incentivo fiscal', tipo: 'sim', se: servico },
    ],
  },
  {
    titulo: 'IBS / CBS (reforma tributária)',
    campos: [
      { k: 'ibscbs.cst', rotulo: 'CST IBS/CBS (vazio = sem)', tipo: 'digitos', max: 3 },
      { k: 'ibscbs.classificacao', rotulo: 'cClassTrib', tipo: 'digitos', max: 6, se: (c) => !!c.t['ibscbs.cst'] },
      ...([
        ['ibscbs.aliquotaIBSUF', 'IBS UF %'],
        ['ibscbs.aliquotaIBSMun', 'IBS Município %'],
        ['ibscbs.aliquotaCBS', 'CBS %'],
        ['ibscbs.reducao', 'Redução alíq. %'],
        ['ibscbs.diferimento', 'Diferimento %'],
      ] as [string, string][]).map(([k, rotulo]): CampoTributo => ({
        k, rotulo, tipo: 'pct',
        se: (c) => !!c.t['ibscbs.cst'] && !IBSCBS_SEM_VALORES.includes(c.t['ibscbs.cst']) && !ibscbsMono(c),
      })),
      ...([
        ['ibscbs.monofasia.adRemIBS', 'Ad rem IBS (R$/un)', 'pct'],
        ['ibscbs.monofasia.adRemCBS', 'Ad rem CBS (R$/un)', 'pct'],
        ['ibscbs.monofasia.adRemIBSReten', 'Ad rem IBS retenção', 'pct'],
        ['ibscbs.monofasia.adRemCBSReten', 'Ad rem CBS retenção', 'pct'],
        ['ibscbs.monofasia.valorIBSRetido', 'IBS retido antes', 'valor'],
        ['ibscbs.monofasia.valorCBSRetido', 'CBS retido antes', 'valor'],
      ] as [string, string, 'pct' | 'valor'][]).map(([k, rotulo, tipo]): CampoTributo => ({ k, rotulo, tipo, se: ibscbsMono })),
    ],
  },
  {
    titulo: 'Lei da Transparência',
    campos: [{ k: 'valorAproximadoTributos', rotulo: 'Tributos aprox. (R$)', tipo: 'valor' }],
  },
];

/** Item novo: ICMS 00, PIS/COFINS 07 e as alíquotas de teste do IBS/CBS de 2026 */
export const TRIBUTOS_PADRAO: Tributos = {
  origem: '0',
  cst: '00',
  csosn: '102',
  aliquota: '0.0000',
  modBCST: '4',
  motivoDesoneracao: '9',
  'pis.cst': '07',
  'cofins.cst': '07',
  'issqn.exigibilidade': '1',
  'ibscbs.cst': '000',
  'ibscbs.classificacao': '000001',
  'ibscbs.aliquotaIBSUF': '0.1000',
  'ibscbs.aliquotaIBSMun': '0.0000',
  'ibscbs.aliquotaCBS': '0.9000',
  'item:di.viaTransporte': '1',
  'item:di.intermedio': '1',
  'item:di.adicoes.0.numero': '1',
  'item:di.adicoes.0.sequencia': '1',
};

const visiveis = (c: Contexto) =>
  GRUPOS.filter((g) => !g.se || g.se(c)).map((g) => ({ ...g, campos: g.campos.filter((f) => !f.se || f.se(c)) }));

/** Caminho dentro do item: `item:di.numero` → di.numero; o resto fica em imposto */
const noItem = (k: string) => (k.startsWith('item:') ? k.slice(5) : `imposto.${k}`);

const ler = (o: any, caminho: string) => caminho.split('.').reduce((x, k) => x?.[k], o);

/** Grava pelo caminho; parte numérica ("adicoes.0") vira posição de lista */
function definir(o: any, caminho: string, valor: unknown) {
  const partes = caminho.split('.');
  let alvo = o;
  partes.slice(0, -1).forEach((k, n) => {
    alvo = alvo[k] ??= /^\d+$/.test(partes[n + 1]) ? [] : {};
  });
  alvo[partes[partes.length - 1]] = valor;
}

/** Campos do item que vêm dos tributos (`imposto`, `di`, `combustivel`), só os visíveis e preenchidos */
export function montarTributos(c: Contexto): { imposto: any; [k: string]: any } {
  const item: any = { imposto: {} };
  for (const g of visiveis(c)) {
    for (const f of g.campos) {
      const bruto = c.t[f.k] ?? '';
      if (f.k.startsWith('_')) continue;
      if (f.tipo === 'sim') {
        definir(item, noItem(f.k), bruto === '1');
        continue;
      }
      if (bruto === '') continue;
      definir(item, noItem(f.k), f.tipo === 'pct' || f.tipo === 'valor' || f.numero ? Number(bruto) : bruto);
    }
  }
  return item;
}

/** Valores do formulário a partir do item gravado; o que faltar vem do padrão */
export function lerTributos(item: any): Tributos {
  const t: Tributos = { ...TRIBUTOS_PADRAO };
  const imposto = item?.imposto;
  if (!imposto) return t;
  for (const g of GRUPOS) {
    for (const f of g.campos) {
      const v = ler(item, noItem(f.k));
      if (v === undefined || v === null) continue;
      t[f.k] =
        f.tipo === 'sim' ? (v ? '1' : '') :
        f.tipo === 'pct' ? Number(v).toFixed(4) :
        f.tipo === 'valor' ? Number(v).toFixed(2) :
        String(v);
    }
  }
  t._servico = imposto.issqn ? '1' : '';
  return t;
}

/** Literais para o Tailwind gerar as classes */
const COLUNAS: Record<number, string> = { 1: 'lg:col-span-1', 2: 'lg:col-span-2', 3: 'lg:col-span-3', 4: 'lg:col-span-4' };

const selecionar = (e: React.FocusEvent<HTMLInputElement>) => e.target.select();

export const TributosItem: React.FC<{
  contexto: Contexto;
  onAlterar: (k: string, valor: string) => void;
}> = ({ contexto, onAlterar }) => (
  <div className="lg:col-span-12 flex flex-col gap-2">
    {visiveis(contexto).map((g) => (
      <div key={g.titulo} className="grid grid-cols-2 lg:grid-cols-12 gap-3 items-end">
        <div className="col-span-2 lg:col-span-12 pt-2 border-t border-stone-100 dark:border-stone-800 text-[10px] font-semibold uppercase tracking-wide text-stone-400">
          {g.titulo}
        </div>
        {g.campos.map((f) => {
          const valor = contexto.t[f.k] ?? '';
          const classe = COLUNAS[f.col ?? 2];
          const chave = `${f.k}-${f.rotulo}`;

          if (f.tipo === 'pct' || f.tipo === 'valor') {
            return (
              <Campo key={chave} rotulo={f.rotulo} className={classe}>
                <NumberField value={valor} scale={f.tipo === 'pct' ? 4 : 2} onChange={(v) => onAlterar(f.k, v)} />
              </Campo>
            );
          }
          if (f.tipo === 'data') {
            return (
              <Campo key={chave} rotulo={f.rotulo} className={classe}>
                <DateField value={valor} onChange={(v) => onAlterar(f.k, v)} />
              </Campo>
            );
          }
          if (f.tipo === 'sim') {
            return (
              <Campo key={chave} rotulo={f.rotulo} className={classe}>
                <div className={`${ALTURA_CONTROLE} flex items-center`}>
                  <Toggle checked={valor === '1'} onChange={(v) => onAlterar(f.k, v ? '1' : '')} />
                </div>
              </Campo>
            );
          }
          if (f.tipo === 'opcoes') {
            const opcoes = typeof f.opcoes === 'function' ? f.opcoes(contexto) : f.opcoes || [];
            return (
              <Selecao key={chave} rotulo={f.rotulo} value={valor} opcoes={opcoes}
                onChange={(e) => onAlterar(f.k, e.target.value)} className={classe} />
            );
          }
          return (
            <Texto
              key={chave}
              rotulo={f.rotulo}
              value={valor}
              inputMode={f.tipo === 'digitos' ? 'numeric' : undefined}
              maxLength={f.max}
              onFocus={selecionar}
              onChange={(e) => onAlterar(f.k, f.tipo === 'digitos' ? e.target.value.replace(/\D/g, '') : e.target.value)}
              className={classe}
            />
          );
        })}
      </div>
    ))}
  </div>
);
