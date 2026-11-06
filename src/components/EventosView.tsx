import React, { useEffect, useMemo, useState } from 'react';
import { Send } from 'lucide-react';
import * as api from '../services/api';
import { Meta } from '../types';
import { Area, Botao, Campo, Confirmacao, Secao, Selecao, Texto, Vazio } from './ui';
import { DateField } from './DateField';
import { NumberField } from './NumberField';
import { PainelRespostas, useOperacao } from './PainelRespostas';
import { formatarChave, formatarDataHora } from '../utils/formatters';

/**
 * Aba "Eventos": cancelamento, carta de correção, manifestação do destinatário
 * e os demais eventos do catálogo. Cancelar é irreversível, então passa pelo
 * diálogo de confirmação.
 */
export const EventosView: React.FC<{ meta: Meta | null }> = ({ meta }) => {
  const { retorno, erro, errosSchema, carregando, executar } = useOperacao();

  const [tipoEvento, setTipoEvento] = useState('110111');
  const [chave, setChave] = useState('');
  const [sequencia, setSequencia] = useState(1);
  const [protocolo, setProtocolo] = useState('');
  const [justificativa, setJustificativa] = useState('');
  const [correcao, setCorrecao] = useState('');
  // 112150 — Atualização da Data de Previsão de Entrega
  const [dataPrevisao, setDataPrevisao] = useState('');
  // 112140 — Fornecimento não realizado com pagamento antecipado (um item por envio)
  const [itemNF, setItemNF] = useState('1');
  const [valorIBSNF, setValorIBSNF] = useState('0.00');
  const [valorCBSNF, setValorCBSNF] = useState('0.00');
  const [qtdeNF, setQtdeNF] = useState('0.0000');
  const [unidadeNF, setUnidadeNF] = useState('UN');
  // 110300 — Vinculação da transação de pagamento (NT 2026.006)
  const [idTransacao, setIdTransacao] = useState('');
  const [meioPgto, setMeioPgto] = useState('');
  const [cnpjReceb, setCnpjReceb] = useState('');
  const [cnpjBasePSP, setCnpjBasePSP] = useState('');
  // 110001 — Cancelamento de evento: o protocolo do evento cancelado vai em `protocolo`
  const [eventoCancelado, setEventoCancelado] = useState('110300');
  const [confirmando, setConfirmando] = useState(false);
  const [historico, setHistorico] = useState<any[]>([]);

  const tipo = useMemo(
    () => meta?.tiposEvento.find((t) => t.codigo === tipoEvento),
    [meta, tipoEvento],
  );

  const carregarHistorico = () => api.listarEventos().then(setHistorico).catch(() => setHistorico([]));
  useEffect(() => { carregarHistorico(); }, []);

  const podeEnviar =
    chave.length === 44 &&
    (!(tipo?.exigeProtocolo || tipo?.cancelaEvento) || protocolo.length === 15) &&
    (!tipo?.exigeVinculoPagamento ||
      (idTransacao.trim().length >= 2 && meioPgto.length > 0 && cnpjReceb.length === 14 && cnpjBasePSP.length === 8)) &&
    (!tipo?.exigeJustificativa || justificativa.trim().length >= 15) &&
    (!tipo?.exigeCorrecao || correcao.trim().length >= 15) &&
    (!tipo?.exigeDataPrevisao || !!dataPrevisao) &&
    (!tipo?.exigeItemNaoFornecido || (Number(qtdeNF) > 0 && unidadeNF.trim().length > 0));

  const enviar = async () => {
    setConfirmando(false);
    await executar(() =>
      api.enviarEvento({
        chave, tipoEvento, sequencia, protocolo, justificativa, correcao,
        dataPrevisaoEntrega: tipo?.exigeDataPrevisao ? dataPrevisao : undefined,
        itensNaoFornecidos: tipo?.exigeItemNaoFornecido
          ? [{
              item: Number(itemNF) || 1,
              valorIBS: Number(valorIBSNF) || 0,
              valorCBS: Number(valorCBSNF) || 0,
              quantidade: Number(qtdeNF) || 0,
              unidade: unidadeNF.trim(),
            }]
          : undefined,
        vinculoPagamento: tipo?.exigeVinculoPagamento
          ? { idTransacao: idTransacao.trim(), meioPagamento: meioPgto, cnpjRecebedor: cnpjReceb, cnpjBasePSP }
          : undefined,
        eventoCancelado: tipo?.cancelaEvento ? eventoCancelado : undefined,
      }),
    );
    carregarHistorico();
  };

  return (
    <div className="flex flex-col">
      <Secao titulo="Enviar evento" descricao="Cancelamento, carta de correção e manifestação do destinatário">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          <Selecao
            rotulo="Tipo de evento"
            value={tipoEvento}
            onChange={(e) => setTipoEvento(e.target.value)}
            opcoes={(meta?.tiposEvento || []).map((t) => ({
              valor: t.codigo,
              rotulo: `${t.codigo} — ${t.descricao}`,
            }))}
            className="lg:col-span-6"
          />

          <Texto
            rotulo="Chave de acesso"
            required
            inputMode="numeric"
            placeholder="44 dígitos"
            value={chave}
            onChange={(e) => setChave(e.target.value.replace(/\D/g, '').slice(0, 44))}
            className="lg:col-span-4"
          />

          <Texto
            rotulo="Sequência"
            type="number"
            min={1}
            max={99}
            value={sequencia}
            onChange={(e) => setSequencia(Number(e.target.value) || 1)}
            className="lg:col-span-2"
          />

          {tipo?.cancelaEvento && (
            <Selecao
              rotulo="Evento a cancelar"
              value={eventoCancelado}
              onChange={(e) => setEventoCancelado(e.target.value)}
              opcoes={(meta?.tiposEvento || [])
                .filter((t) => ['110300', '112140', '112150'].includes(t.codigo))
                .map((t) => ({ valor: t.codigo, rotulo: `${t.codigo} — ${t.descricao}` }))}
              className="lg:col-span-6"
            />
          )}

          {(tipo?.exigeProtocolo || tipo?.cancelaEvento) && (
            <Texto
              rotulo={tipo?.cancelaEvento ? 'Protocolo do evento a cancelar' : 'Protocolo de autorização'}
              required
              inputMode="numeric"
              value={protocolo}
              onChange={(e) => setProtocolo(e.target.value.replace(/\D/g, '').slice(0, 15))}
              className="lg:col-span-4"
            />
          )}

          {tipo?.exigeVinculoPagamento && (
            <>
              <Texto
                rotulo="Identificador da transação"
                required
                maxLength={35}
                value={idTransacao}
                onChange={(e) => setIdTransacao(e.target.value)}
                dica="Como consta na transação: Pix (txid), boleto etc."
                className="lg:col-span-4"
              />
              <Texto
                rotulo="Meio de pagamento"
                required
                inputMode="numeric"
                value={meioPgto}
                onChange={(e) => setMeioPgto(e.target.value.replace(/\D/g, '').slice(0, 2))}
                dica="Código da Tabela Nacional de Meios de Pagamento (IT 2026.001)"
                className="lg:col-span-2"
              />
              <Texto
                rotulo="CNPJ do recebedor"
                required
                value={cnpjReceb}
                onChange={(e) => setCnpjReceb(e.target.value.replace(/[^0-9A-Za-z]/g, '').toUpperCase().slice(0, 14))}
                className="lg:col-span-3"
              />
              <Texto
                rotulo="CNPJ base da instituição de pagamento"
                required
                value={cnpjBasePSP}
                onChange={(e) => setCnpjBasePSP(e.target.value.replace(/[^0-9A-Za-z]/g, '').toUpperCase().slice(0, 8))}
                dica="8 primeiras posições do CNPJ do banco ou PSP"
                className="lg:col-span-3"
              />
            </>
          )}

          {tipo?.exigeCorrecao && (
            <Area
              rotulo="Texto da correção"
              required
              rows={3}
              maxLength={1000}
              value={correcao}
              onChange={(e) => setCorrecao(e.target.value)}
              dica={`${correcao.trim().length}/1000 — mínimo de 15 caracteres`}
              className="lg:col-span-12"
            />
          )}

          {tipo?.exigeDataPrevisao && (
            <Campo rotulo="Nova data de previsão de entrega" className="lg:col-span-3">
              <DateField value={dataPrevisao} onChange={setDataPrevisao} required />
            </Campo>
          )}

          {tipo?.exigeItemNaoFornecido && (
            <>
              <Texto
                rotulo="Nº do item na nota"
                inputMode="numeric"
                value={itemNF}
                onChange={(e) => setItemNF(e.target.value.replace(/\D/g, '').slice(0, 3))}
                className="lg:col-span-2"
              />
              <Campo rotulo="IBS não fornecido (R$)" className="lg:col-span-2">
                <NumberField value={valorIBSNF} onChange={setValorIBSNF} scale={2} />
              </Campo>
              <Campo rotulo="CBS não fornecida (R$)" className="lg:col-span-2">
                <NumberField value={valorCBSNF} onChange={setValorCBSNF} scale={2} />
              </Campo>
              <Campo rotulo="Quantidade não fornecida" className="lg:col-span-2">
                <NumberField value={qtdeNF} onChange={setQtdeNF} scale={4} />
              </Campo>
              <Texto
                rotulo="Unidade"
                value={unidadeNF}
                maxLength={6}
                onChange={(e) => setUnidadeNF(e.target.value.toUpperCase())}
                className="lg:col-span-2"
              />
            </>
          )}

          {tipo?.exigeJustificativa && !tipo?.exigeCorrecao && (
            <Area
              rotulo="Justificativa"
              required
              rows={3}
              maxLength={255}
              value={justificativa}
              onChange={(e) => setJustificativa(e.target.value)}
              dica={`${justificativa.trim().length}/255 — mínimo de 15 caracteres`}
              className="lg:col-span-12"
            />
          )}
        </div>

        <div className="flex justify-end pt-4">
          <Botao
            variante="primario"
            icone={<Send className="w-3.5 h-3.5" />}
            carregando={carregando}
            disabled={!podeEnviar}
            onClick={() => setConfirmando(true)}
          >
            Enviar Evento
          </Botao>
        </div>
      </Secao>

      <PainelRespostas
        retorno={retorno}
        erro={erro}
        errosSchema={errosSchema}
        carregando={carregando}
        resumo={[
          ['Evento', retorno?.dados?.descricao],
          ['Protocolo', retorno?.dados?.protocolo],
          ['Registrado em', retorno?.dados?.dataRegistro],
        ]}
      />

      <Secao titulo="Eventos enviados" descricao="Últimos 100 registros">
        {historico.length === 0 ? (
          <Vazio mensagem="Nenhum evento enviado até agora." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-stone-500 dark:text-stone-400 border-b border-stone-200 dark:border-stone-800">
                  <th className="text-left font-semibold py-2 pr-3">Chave</th>
                  <th className="text-left font-semibold py-2 pr-3">Evento</th>
                  <th className="text-center font-semibold py-2 pr-3">Seq.</th>
                  <th className="text-center font-semibold py-2 pr-3">Data</th>
                  <th className="text-left font-semibold py-2 pr-3">Protocolo</th>
                  <th className="text-left font-semibold py-2">Retorno</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {historico.map((e) => (
                  <tr key={e.id} className="hover:bg-stone-50 dark:hover:bg-stone-800/40">
                    <td className="py-2 pr-3 font-mono text-[10px]">{formatarChave(e.chave)}</td>
                    <td className="py-2 pr-3">{e.descricao}</td>
                    <td className="py-2 pr-3 text-center">{e.sequencia}</td>
                    <td className="py-2 pr-3 text-center">{formatarDataHora(e.data_evento)}</td>
                    <td className="py-2 pr-3 font-mono text-[10px]">{e.protocolo || '—'}</td>
                    <td className="py-2">{e.codigo_status} — {e.motivo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Secao>

      <Confirmacao
        aberto={confirmando}
        titulo={`Enviar ${tipo?.descricao || 'evento'}?`}
        mensagem={
          <>
            O evento será registrado na SEFAZ e não pode ser desfeito.
            <br />
            Chave: <span className="font-mono">{formatarChave(chave)}</span>
          </>
        }
        rotuloConfirmar="Enviar"
        perigo={tipoEvento === '110111'}
        onConfirmar={enviar}
        onCancelar={() => setConfirmando(false)}
      />
    </div>
  );
};
