import React, { useState } from 'react';
import { CheckCircle2, Clipboard, Download, XCircle } from 'lucide-react';
import { ErroApi, ErroSchema, Retorno } from '../types';
import { Abas, Botao, Vazio } from './ui';
import { AvisoErro } from './AvisoErro';

/**
 * O painel inferior do formulário original (abas Respostas, XML Resposta, Log,
 * Retorno Completo WS e Dados), com o mesmo conteúdo.
 */

interface PainelRespostasProps {
  retorno: Retorno | null;
  /** Erro da operação: aparece no aviso do canto */
  erro?: string | null;
  onFecharErro?: () => void;
  /** Problemas apontados pelo XSD quando o envio foi barrado pela validação */
  errosSchema?: ErroSchema[] | null;
  carregando?: boolean;
  /** Linhas montadas pela tela, exibidas na aba "Respostas" */
  resumo?: [string, any][];
}

/** Lista dos problemas de schema, um por linha, com o campo em destaque */
const ListaErrosSchema: React.FC<{ erros: ErroSchema[] }> = ({ erros }) => (
  <div className="mt-2 flex flex-col gap-1.5">
    <ul className="flex flex-col divide-y divide-red-100 dark:divide-red-900/60 border border-red-100 dark:border-red-900/60">
      {erros.map((e, i) => (
        <li key={i} className="px-3 py-2 text-[11px] bg-red-50/60 dark:bg-red-950/30 flex flex-wrap gap-x-2">
          {e.campo && (
            <span className="font-mono font-bold text-red-800 dark:text-red-300">{e.campo}</span>
          )}
          <span className="text-stone-700 dark:text-stone-300">{e.mensagem}</span>
        </li>
      ))}
    </ul>
  </div>
);

function baixar(texto: string, nome: string) {
  const url = URL.createObjectURL(new Blob([texto], { type: 'application/xml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

const Bloco: React.FC<{ texto: string; nomeArquivo: string }> = ({ texto, nomeArquivo }) => {
  const [copiado, setCopiado] = useState(false);

  if (!texto) return <Vazio mensagem="Nada a exibir para esta operação." />;

  return (
    <div className="relative">
      <div className="absolute right-2 top-2 flex gap-1.5">
        <Botao
          icone={<Clipboard className="w-3.5 h-3.5" />}
          onClick={() => {
            navigator.clipboard.writeText(texto).then(() => {
              setCopiado(true);
              setTimeout(() => setCopiado(false), 2000);
            });
          }}
        >
          {copiado ? 'Copiado' : 'Copiar'}
        </Botao>
        <Botao icone={<Download className="w-3.5 h-3.5" />} onClick={() => baixar(texto, nomeArquivo)}>
          Baixar
        </Botao>
      </div>
      <pre className="text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-all max-h-[340px] overflow-auto
        bg-stone-50 dark:bg-stone-950/60 border border-stone-200 dark:border-stone-800 p-3 pt-11">
        {texto}
      </pre>
    </div>
  );
};

export const PainelRespostas: React.FC<PainelRespostasProps> = (props) => {
  const { erro, onFecharErro } = props;
  return (
    <>
      {erro && <AvisoErro mensagem={erro} onFechar={() => onFecharErro?.()} />}
      <Conteudo {...props} />
    </>
  );
};

/** O painel em si; o erro da operação fica no aviso do canto, só a lista do schema aparece aqui */
const Conteudo: React.FC<PainelRespostasProps> = ({ retorno, errosSchema, carregando, resumo }) => {
  const [aba, setAba] = useState('respostas');

  if (carregando) {
    return (
      <div className="border-b border-stone-200 dark:border-stone-800">
        <Vazio mensagem="Aguardando a resposta da SEFAZ…" />
      </div>
    );
  }

  if (errosSchema?.length) {
    return (
      <div className="border-b border-stone-200 dark:border-stone-800 px-4 py-3">
        <p className="text-[11px] font-semibold text-stone-600 dark:text-stone-300">
          O XML não passou no schema oficial, então nada foi enviado à SEFAZ. Corrija os campos abaixo:
        </p>
        <ListaErrosSchema erros={errosSchema} />
      </div>
    );
  }

  if (!retorno) {
    return (
      <div className="border-b border-stone-200 dark:border-stone-800">
        <Vazio mensagem="A resposta da SEFAZ aparece aqui depois da operação." />
      </div>
    );
  }

  const linhas: [string, any][] = [
    ['Status', `${retorno.cStat} — ${retorno.xMotivo}`],
    ...(resumo || []),
    ['Endereço do webservice', retorno.url],
    ['Tempo de resposta', `${retorno.duracaoMs} ms`],
  ];

  return (
    <div className="border-b border-stone-200 dark:border-stone-800">
      <div
        className={`px-4 py-2.5 flex items-center gap-2 text-xs font-semibold border-b ${
          retorno.sucesso
            ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900'
            : 'bg-red-50 text-red-800 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900'
        }`}
      >
        {retorno.sucesso ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
        <span>{retorno.cStat} — {retorno.xMotivo || 'Sem descrição'}</span>
      </div>

      <Abas
        ativa={aba}
        onTrocar={setAba}
        abas={[
          { id: 'respostas', rotulo: 'Respostas' },
          { id: 'xml', rotulo: 'XML Resposta' },
          { id: 'completo', rotulo: 'Retorno Completo WS' },
          { id: 'dados', rotulo: 'Dados Enviados' },
        ]}
      />

      <div className="px-4 py-3">
        {aba === 'respostas' && (
          <dl className="divide-y divide-stone-100 dark:divide-stone-800">
            {linhas
              .filter(([, valor]) => valor !== undefined && valor !== null && valor !== '')
              .map(([rotulo, valor]) => (
                <div key={rotulo} className="py-2 flex flex-wrap gap-x-4 gap-y-0.5">
                  <dt className="text-[11px] font-semibold text-stone-500 dark:text-stone-400 w-56 shrink-0">
                    {rotulo}
                  </dt>
                  <dd className="text-xs text-stone-800 dark:text-stone-100 break-all flex-1 min-w-0">
                    {String(valor)}
                  </dd>
                </div>
              ))}
          </dl>
        )}

        {aba === 'xml' && <Bloco texto={retorno.xml} nomeArquivo="retorno.xml" />}
        {aba === 'completo' && <Bloco texto={retorno.retornoCompleto} nomeArquivo="retorno-ws.xml" />}
        {aba === 'dados' && <Bloco texto={retorno.envio} nomeArquivo="envio.xml" />}
      </div>
    </div>
  );
};

/** Estado compartilhado por todas as telas que disparam uma operação */
export function useOperacao() {
  const [retorno, setRetorno] = useState<Retorno | null>(null);
  const [erro, setErroTexto] = useState<string | null>(null);
  const [errosSchema, setErrosSchema] = useState<ErroSchema[] | null>(null);
  const [carregando, setCarregando] = useState(false);

  /** Mensagem simples; limpa a lista de schema que tenha sobrado */
  const setErro = (texto: string | null) => {
    setErroTexto(texto);
    setErrosSchema(null);
  };

  /** Registra um erro da API, preservando a lista de problemas de schema */
  const falhar = (err: ErroApi) => {
    setErroTexto(err.message || String(err));
    setErrosSchema(err.errosSchema?.length ? err.errosSchema : null);
  };

  const executar = async (fn: () => Promise<Retorno>) => {
    setCarregando(true);
    setErro(null);
    setRetorno(null);
    try {
      setRetorno(await fn());
    } catch (err: any) {
      falhar(err);
    } finally {
      setCarregando(false);
    }
  };

  /** Fechar o aviso do canto: some só a mensagem, a lista do schema continua no painel */
  const fecharErro = () => setErroTexto(null);

  return { retorno, erro, errosSchema, carregando, executar, setErro, falhar, fecharErro };
}
