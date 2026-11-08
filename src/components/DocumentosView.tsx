import React, { useMemo, useRef, useState } from 'react';
import { CopyPlus, FileCheck2, FileInput, Mail, Pencil, Plus, Printer, Send, ShieldCheck, X } from 'lucide-react';
import * as api from '../services/api';
import { DocumentoLista, Emitente, Meta } from '../types';
import { Botao, Confirmacao, Etiqueta, Texto } from './ui';
import { AvisoErro, AvisoSucesso } from './AvisoErro';
import { AcaoGrade, ColunaGrade, Grade } from './Grade';
import { PainelRespostas, useOperacao } from './PainelRespostas';
import { CopiaNFe, EdicaoNFe, NovaNFeView } from './NovaNFeView';
import { AMBIENTES, SITUACOES, formatarChave, formatarDataHora, formatarMoeda } from '../utils/formatters';

/**
 * Aba "Envios": a lista dos documentos e as ações sobre eles — transmitir,
 * imprimir o DANFE, enviar por e-mail, validar a assinatura e importar XML.
 */
export const DocumentosView: React.FC<{
  meta: Meta | null;
  emitente: Emitente | null;
  onRecarregarPainel: () => void;
}> = ({
  meta,
  emitente,
  onRecarregarPainel,
}) => {
  const { retorno, erro, errosSchema, carregando, executar, setErro, falhar, fecharErro } = useOperacao();

  const [selecionado, setSelecionado] = useState<DocumentoLista | null>(null);
  /** Incrementado para a grade recarregar a página atual depois de uma ação */
  const [versao, setVersao] = useState(0);
  const [emitindo, setEmitindo] = useState(false);
  const [confirmandoEnvio, setConfirmandoEnvio] = useState<DocumentoLista | null>(null);
  const [emailPara, setEmailPara] = useState('');
  const [enviandoEmail, setEnviandoEmail] = useState<DocumentoLista | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [alerta, setAlerta] = useState<string | null>(null);
  const [copiaDe, setCopiaDe] = useState<CopiaNFe | null>(null);
  const [edicao, setEdicao] = useState<EdicaoNFe | null>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);

  const carregar = () => setVersao((v) => v + 1);

  const podeTransmitir = (d: DocumentoLista) => ['assinada', 'rejeitada'].includes(d.situacao);
  // Editar exige as mesmas situações e os dados do formulário (XML importado não tem)
  const podeEditar = (d: DocumentoLista) => podeTransmitir(d) && !!d.copiavel;

  const colunas = useMemo<ColunaGrade<DocumentoLista>[]>(
    () => [
      { nome: 'numero', rotulo: 'Número', tipo: 'numero', valor: (d) => d.numero },
      { nome: 'serie', rotulo: 'Série', tipo: 'numero', valor: (d) => d.serie },
      { nome: 'data_emissao', rotulo: 'Emissão', tipo: 'data', valor: (d) => formatarDataHora(d.data_emissao) },
      {
        nome: 'destinatario_nome',
        rotulo: 'Destinatário',
        valor: (d) => d.destinatario_nome || '—',
        dica: (d) => d.destinatario_nome,
      },
      { nome: 'valor_total', rotulo: 'Valor', tipo: 'numero', valor: (d) => formatarMoeda(d.valor_total) },
      {
        nome: 'situacao',
        rotulo: 'Situação',
        tipo: 'centro',
        valor: (d) => {
          const s = SITUACOES[d.situacao] || SITUACOES.rascunho;
          return <Etiqueta texto={s.rotulo} classe={s.classe} />;
        },
      },
      { nome: 'ambiente', rotulo: 'Ambiente', tipo: 'centro', valor: (d) => AMBIENTES[d.ambiente] },
      {
        nome: 'motivo',
        rotulo: 'Retorno da SEFAZ',
        valor: (d) => (d.codigo_status ? `${d.codigo_status} — ${d.motivo}` : '—'),
        dica: (d) => (d.codigo_status ? `${d.codigo_status} — ${d.motivo}` : undefined),
      },
    ],
    [],
  );

  const transmitir = async (doc: DocumentoLista) => {
    setConfirmandoEnvio(null);
    await executar(() => api.enviarNFe({ chave: doc.chave }));
    carregar();
    onRecarregarPainel();
  };

  const importar = async (arquivo: File) => {
    setErro(null);
    try {
      const xml = await arquivo.text();
      const { chave } = await api.importarXml(xml);
      setAviso(`XML importado: ${formatarChave(chave)}`);
      carregar();
    } catch (err: any) {
      setErro(err.message);
    }
  };

  const validarAssinatura = async (doc: DocumentoLista) => {
    setErro(null);
    try {
      const completo = await api.buscarDocumento(doc.chave);
      const r = await api.validarAssinatura(completo.xml_protocolo || completo.xml);
      if (r.valida) setAviso('Assinatura digital válida.');
      else setAlerta(`Assinatura inválida: ${r.erro}`);
    } catch (err: any) {
      setErro(err.message);
    }
  };

  /** "Novo (copiar)": abre a Nova NF-e já preenchida com a nota selecionada */
  const novoCopiando = async () => {
    if (!selecionado) return;
    setErro(null);
    try {
      const completo = await api.buscarDocumento(selecionado.chave);
      const dados = typeof completo.dados === 'string' ? JSON.parse(completo.dados) : completo.dados;
      if (!dados) {
        throw new Error('Esta nota veio de um XML importado: não há dados de formulário para copiar.');
      }
      setCopiaDe({ numero: selecionado.numero, dados });
      setEmitindo(true);
    } catch (err: any) {
      falhar(err);
    }
  };

  /** "Editar": abre a nota assinada ou rejeitada para corrigir e transmitir de novo */
  const editar = async (doc: DocumentoLista) => {
    setErro(null);
    try {
      const completo = await api.buscarDocumento(doc.chave);
      const dados = typeof completo.dados === 'string' ? JSON.parse(completo.dados) : completo.dados;
      if (!dados) {
        throw new Error('Esta nota veio de um XML importado: não há dados de formulário para editar.');
      }
      setCopiaDe(null);
      setEdicao({
        id: doc.id,
        numero: doc.numero,
        dados,
        rejeicao: doc.situacao === 'rejeitada' && doc.codigo_status ? `${doc.codigo_status} — ${doc.motivo}` : undefined,
      });
      setEmitindo(true);
    } catch (err: any) {
      falhar(err);
    }
  };

  const fecharEmissao = () => {
    setEmitindo(false);
    setCopiaDe(null);
    setEdicao(null);
  };

  /** "Validar XML" do exemplo: confere contra o XSD oficial sem enviar nada */
  const validarSchema = async (doc: DocumentoLista) => {
    setErro(null);
    try {
      const resultado = await api.validarXml({ chave: doc.chave });
      if (resultado.valido) {
        setAviso(`NF-e nº ${doc.numero}: XML válido contra ${resultado.schema}.`);
      } else {
        // O aviso vai para o canto e a lista dos problemas fica no painel de respostas
        const n = resultado.erros.length;
        falhar(Object.assign(new Error(`NF-e nº ${doc.numero}: o XML não passa no schema oficial (${n} problema${n === 1 ? '' : 's'}).`), { errosSchema: resultado.erros }));
      }
    } catch (err: any) {
      falhar(err);
    }
  };

  const imprimir = async (doc: DocumentoLista) => {
    setErro(null);
    try {
      await api.abrirDanfe(doc.chave);
    } catch (err: any) {
      setErro(err.message);
    }
  };

  const mandarEmail = async () => {
    if (!enviandoEmail) return;
    setErro(null);
    try {
      await api.enviarPorEmail({ chave: enviandoEmail.chave, para: emailPara });
      setAviso(`NF-e enviada para ${emailPara}.`);
      setEnviandoEmail(null);
      setEmailPara('');
    } catch (err: any) {
      setErro(err.message);
    }
  };

  if (emitindo) {
    return (
      <NovaNFeView
        meta={meta}
        emitente={emitente}
        copiaDe={copiaDe}
        edicao={edicao}
        onCancelar={fecharEmissao}
        onEmitida={() => {
          fecharEmissao();
          carregar();
          onRecarregarPainel();
        }}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {aviso && <AvisoSucesso mensagem={aviso} onFechar={() => setAviso(null)} />}
      {alerta && <AvisoErro tom="alerta" mensagem={alerta} onFechar={() => setAlerta(null)} />}

      {/* Lista no padrão das grades do b2b admin */}
      <input
        ref={arquivoRef}
        type="file"
        accept=".xml,text/xml,application/xml"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && importar(e.target.files[0])}
      />
      <Grade<DocumentoLista>
        recurso="documentos"
        colunas={colunas}
        carregarPagina={api.listarDocumentos}
        chave={(d) => d.id}
        ordemPadrao={{ campo: 'data_emissao', direcao: 'desc' }}
        recarregar={versao}
        rotuloVazio="Nenhum documento emitido"
        selecionada={selecionado}
        onSelecionar={setSelecionado}
        onDuploClique={(d) => podeEditar(d) && editar(d)}
        larguraAcoes={172}
        acoes={(d) => (
          <>
            <AcaoGrade
              titulo={
                podeEditar(d)
                  ? d.situacao === 'rejeitada'
                    ? `Editar: corrigir a rejeição ${d.codigo_status} e transmitir de novo`
                    : 'Editar antes de transmitir'
                  : 'Só nota assinada ou rejeitada pode ser editada'
              }
              icone={<Pencil className="w-3.5 h-3.5" />}
              onClick={() => editar(d)}
              desabilitado={!podeEditar(d)}
            />
            <AcaoGrade
              titulo={podeTransmitir(d) ? 'Transmitir para a SEFAZ' : 'Só nota assinada ou rejeitada pode ser transmitida'}
              icone={<Send className="w-3.5 h-3.5" />}
              tom="verde"
              onClick={() => setConfirmandoEnvio(d)}
              desabilitado={!podeTransmitir(d)}
            />
            <AcaoGrade titulo="Imprimir DANFE" icone={<Printer className="w-3.5 h-3.5" />} onClick={() => imprimir(d)} />
            <AcaoGrade
              titulo={d.situacao === 'autorizada' ? 'Enviar por e-mail' : 'Só nota autorizada pode ser enviada por e-mail'}
              icone={<Mail className="w-3.5 h-3.5" />}
              onClick={() => setEnviandoEmail(d)}
              desabilitado={d.situacao !== 'autorizada'}
            />
            <AcaoGrade titulo="Validar XML contra o schema" icone={<FileCheck2 className="w-3.5 h-3.5" />} onClick={() => validarSchema(d)} />
            <AcaoGrade titulo="Validar assinatura digital" icone={<ShieldCheck className="w-3.5 h-3.5" />} onClick={() => validarAssinatura(d)} />
          </>
        )}
        botoes={
          <>
            <Botao icone={<FileInput className="w-3.5 h-3.5" />} onClick={() => arquivoRef.current?.click()}>
              Importar XML
            </Botao>
            <Botao
              icone={<CopyPlus className="w-3.5 h-3.5" />}
              onClick={novoCopiando}
              disabled={!selecionado || !selecionado.copiavel}
              title={
                !selecionado
                  ? 'Selecione na lista a nota que servirá de modelo'
                  : !selecionado.copiavel
                  ? 'Nota importada de XML: não há dados de formulário para copiar'
                  : `Nova NF-e preenchida com os dados da nº ${selecionado.numero}`
              }
            >
              Novo (copiar)
            </Botao>
            <Botao
              variante="primario"
              icone={<Plus className="w-3.5 h-3.5" />}
              onClick={() => {
                setCopiaDe(null);
                setEmitindo(true);
              }}
            >
              Novo
            </Botao>
          </>
        }
      />

      {/* Mestre-detalhe: dados da nota selecionada, abaixo da grade */}
      {selecionado ? (
        <div className="border-t border-stone-200 dark:border-stone-800 shrink-0">
          <div className="px-4 py-2 flex items-center justify-between gap-3 bg-stone-50 dark:bg-stone-950/40 border-b border-stone-200 dark:border-stone-800">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">
              NF-e nº {selecionado.numero} • série {selecionado.serie}
            </span>
            <button
              type="button"
              onClick={() => setSelecionado(null)}
              title="Fechar o detalhe"
              className="p-1 rounded text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:text-rose-400 dark:hover:bg-rose-950/40 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <dl className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-[11px]">
            <div className="flex gap-2">
              <dt className="font-semibold text-stone-500 w-20 shrink-0">Chave</dt>
              <dd className="break-all">{formatarChave(selecionado.chave)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-semibold text-stone-500 w-20 shrink-0">Protocolo</dt>
              <dd>{selecionado.protocolo || '—'}</dd>
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <dt className="font-semibold text-stone-500 w-20 shrink-0">Retorno</dt>
              <dd>{selecionado.codigo_status ? `${selecionado.codigo_status} — ${selecionado.motivo}` : '—'}</dd>
            </div>
          </dl>
        </div>
      ) : (
        <div className="px-4 py-2 border-t border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950/40 text-[11px] text-stone-500 dark:text-stone-400 shrink-0">
          Clique numa nota para ver a chave, o protocolo e o retorno da SEFAZ aqui embaixo. Duplo clique abre a nota
          para edição, quando ela ainda pode ser corrigida.
        </div>
      )}

      <PainelRespostas
        retorno={retorno}
        erro={erro} onFecharErro={fecharErro}
        errosSchema={errosSchema}
        carregando={carregando}
        resumo={[
          ['Recibo do lote', retorno?.dados?.recibo],
          ['Protocolo', retorno?.dados?.protocolo],
          ['Situação da nota', retorno?.dados?.cStatNota && `${retorno.dados.cStatNota} — ${retorno.dados.motivoNota}`],
        ]}
      />

      <Confirmacao
        aberto={!!confirmandoEnvio}
        titulo="Transmitir para a SEFAZ?"
        mensagem={
          <>
            A NF-e nº <strong>{confirmandoEnvio?.numero}</strong> será enviada para autorização
            {confirmandoEnvio?.ambiente === 1 ? ' em PRODUÇÃO' : ' em homologação'}.
          </>
        }
        rotuloConfirmar="Transmitir"
        perigo={confirmandoEnvio?.ambiente === 1}
        onConfirmar={() => confirmandoEnvio && transmitir(confirmandoEnvio)}
        onCancelar={() => setConfirmandoEnvio(null)}
      />

      {enviandoEmail && (
        <div className="fixed inset-0 z-50 bg-stone-900/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl shadow-2xl w-full max-w-md p-5 flex flex-col gap-4">
            <h3 className="text-sm font-bold text-stone-800 dark:text-stone-100">
              Enviar NF-e nº {enviandoEmail.numero} por e-mail
            </h3>
            <Texto
              rotulo="Destinatário"
              type="email"
              required
              autoFocus
              placeholder="cliente@empresa.com.br"
              value={emailPara}
              onChange={(e) => setEmailPara(e.target.value)}
            />
            <p className="text-[11px] text-stone-500 dark:text-stone-400">
              Vão anexados o XML autorizado e o DANFE em PDF.
            </p>
            <div className="flex justify-end gap-2">
              <Botao onClick={() => setEnviandoEmail(null)}>Cancelar</Botao>
              <Botao variante="primario" disabled={!emailPara.includes('@')} onClick={mandarEmail}>
                Enviar
              </Botao>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
