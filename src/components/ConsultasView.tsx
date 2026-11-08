import React, { useState } from 'react';
import { Activity, FileSearch, IdCard, Receipt } from 'lucide-react';
import * as api from '../services/api';
import { Meta } from '../types';
import { Abas, Botao, Secao, Texto, Selecao } from './ui';
import { PainelRespostas, useOperacao } from './PainelRespostas';
import { formatarChave } from '../utils/formatters';

/** Aba "Consultas" do exemplo: status do serviço, chave, recibo e cadastro */
export const ConsultasView: React.FC<{ meta: Meta | null; ufPadrao: string }> = ({ meta, ufPadrao }) => {
  const [aba, setAba] = useState('status');
  const { retorno, erro, errosSchema, carregando, executar, fecharErro } = useOperacao();

  const [chave, setChave] = useState('');
  const [recibo, setRecibo] = useState('');
  const [uf, setUf] = useState(ufPadrao);
  const [documento, setDocumento] = useState('');
  const [tipoDocumento, setTipoDocumento] = useState<'cnpj' | 'cpf' | 'ie'>('cnpj');

  const resumo: [string, any][] =
    aba === 'status'
      ? [
          ['UF', retorno?.dados?.uf],
          ['Ambiente', retorno?.dados?.ambiente === 1 ? 'Produção' : 'Homologação'],
          ['Versão da aplicação', retorno?.dados?.versaoAplicacao],
          ['Tempo médio de resposta', retorno?.dados?.tempoMedioResposta && `${retorno.dados.tempoMedioResposta}s`],
          ['Observação', retorno?.dados?.observacao],
        ]
      : aba === 'chave'
      ? [
          ['Chave', retorno?.dados?.chave && formatarChave(retorno.dados.chave)],
          ['Protocolo', retorno?.dados?.protocolo],
          ['Autorizada em', retorno?.dados?.dataAutorizacao],
        ]
      : aba === 'recibo'
      ? [
          ['Recibo', retorno?.dados?.recibo],
          ['Em processamento', retorno?.dados?.emProcessamento ? 'Sim, consulte novamente' : 'Não'],
          ['Chave', retorno?.dados?.chave && formatarChave(retorno.dados.chave)],
          ['Protocolo', retorno?.dados?.protocolo],
          ['Situação da nota', retorno?.dados?.cStatNota && `${retorno.dados.cStatNota} — ${retorno.dados.motivoNota}`],
        ]
      : [];

  return (
    <div className="flex flex-col">
      {/* Abas no topo da tela, como no b2b admin */}
      <Abas
        ativa={aba}
        onTrocar={setAba}
        abas={[
          { id: 'status', rotulo: 'Status do Serviço', icone: <Activity className="w-3.5 h-3.5" /> },
          { id: 'chave', rotulo: 'Consultar pela Chave', icone: <FileSearch className="w-3.5 h-3.5" /> },
          { id: 'recibo', rotulo: 'Recibo do Lote', icone: <Receipt className="w-3.5 h-3.5" /> },
          { id: 'cadastro', rotulo: 'Consulta Cadastro', icone: <IdCard className="w-3.5 h-3.5" /> },
        ]}
      />

      <Secao titulo="Serviços de consulta da SEFAZ">
        <div>
          {aba === 'status' && (
            <div className="flex flex-wrap items-end gap-3">
              <p className="text-xs text-stone-500 dark:text-stone-400 flex-1 min-w-[220px]">
                Consulta o status do serviço na UF e no ambiente definidos em Configurações › WebService.
              </p>
              <Botao variante="primario" carregando={carregando} onClick={() => executar(api.statusServico)}>
                Consultar Status
              </Botao>
            </div>
          )}

          {aba === 'chave' && (
            <div className="flex flex-wrap items-end gap-3">
              <Texto
                rotulo="Chave de acesso"
                required
                inputMode="numeric"
                placeholder="44 dígitos"
                value={chave}
                onChange={(e) => setChave(e.target.value.replace(/\D/g, '').slice(0, 44))}
                className="flex-1 min-w-[320px]"
              />
              <Botao
                variante="primario"
                carregando={carregando}
                disabled={chave.length !== 44}
                onClick={() => executar(() => api.consultarChave(chave))}
              >
                Consultar
              </Botao>
            </div>
          )}

          {aba === 'recibo' && (
            <div className="flex flex-wrap items-end gap-3">
              <Texto
                rotulo="Número do recibo"
                required
                inputMode="numeric"
                value={recibo}
                onChange={(e) => setRecibo(e.target.value.replace(/\D/g, '').slice(0, 15))}
                className="flex-1 min-w-[240px]"
              />
              <Botao
                variante="primario"
                carregando={carregando}
                disabled={!recibo}
                onClick={() => executar(() => api.consultarRecibo(recibo))}
              >
                Consultar Recibo
              </Botao>
            </div>
          )}

          {aba === 'cadastro' && (
            <div className="flex flex-wrap items-end gap-3">
              <Selecao
                rotulo="UF"
                value={uf}
                onChange={(e) => setUf(e.target.value)}
                opcoes={(meta?.ufs || []).map((u) => ({ valor: u, rotulo: u }))}
                className="w-24"
              />
              <Selecao
                rotulo="Consultar por"
                value={tipoDocumento}
                onChange={(e) => setTipoDocumento(e.target.value as any)}
                opcoes={[
                  { valor: 'cnpj', rotulo: 'CNPJ' },
                  { valor: 'cpf', rotulo: 'CPF' },
                  { valor: 'ie', rotulo: 'Inscrição Estadual' },
                ]}
                className="w-48"
              />
              <Texto
                rotulo="Número"
                required
                inputMode="numeric"
                value={documento}
                onChange={(e) => setDocumento(e.target.value.replace(/\D/g, ''))}
                className="flex-1 min-w-[220px]"
              />
              <Botao
                variante="primario"
                carregando={carregando}
                disabled={!documento}
                onClick={() => executar(() => api.consultarCadastro({ uf, [tipoDocumento]: documento }))}
              >
                Consultar Cadastro
              </Botao>
            </div>
          )}
        </div>
      </Secao>

      <PainelRespostas retorno={retorno} erro={erro} onFecharErro={fecharErro} errosSchema={errosSchema} carregando={carregando} resumo={resumo} />
    </div>
  );
};
