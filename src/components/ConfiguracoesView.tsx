import React, { useEffect, useRef, useState } from 'react';
import {
  Building2, FileCog, FolderTree, Globe2, Mail, Printer, Save, ShieldCheck, Trash2, Upload,
} from 'lucide-react';
import * as api from '../services/api';
import { CertificadoInfo, ConfigNFe, Emitente, Meta } from '../types';
import { Abas, Area, Botao, Campo, Confirmacao, Faixa, Secao, Selecao, Texto } from './ui';
import { Toggle } from './Toggle';
import { formatarCnpj, formatarData } from '../utils/formatters';

/**
 * Reproduz a aba "Configurações" do formulário Delphi: Certificado, Geral,
 * WebService (com Proxy e Retorno de Envio), Emitente, Arquivos, Documento
 * Auxiliar e Email.
 */
export const ConfiguracoesView: React.FC<{
  meta: Meta | null;
  onSalvou: () => void;
}> = ({ meta, onSalvou }) => {
  const [aba, setAba] = useState('certificado');
  const [config, setConfig] = useState<ConfigNFe | null>(null);
  const [emitente, setEmitente] = useState<Emitente | null>(null);
  const [certificado, setCertificado] = useState<CertificadoInfo | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [removendoCert, setRemovendoCert] = useState(false);

  const [senhaCertificado, setSenhaCertificado] = useState('');
  const [arquivoCertificado, setArquivoCertificado] = useState<File | null>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);

  const recarregar = async () => {
    try {
      const dados = await api.buscarConfig();
      setConfig(dados.config);
      setEmitente(dados.emitente);
      setCertificado(dados.certificado);
    } catch (err: any) {
      setErro(err.message);
    }
  };

  useEffect(() => { recarregar(); }, []);

  const alterar = <G extends keyof ConfigNFe>(grupo: G, campo: keyof ConfigNFe[G], valor: any) => {
    setConfig((atual) => (atual ? { ...atual, [grupo]: { ...atual[grupo], [campo]: valor } } : atual));
  };

  const alterarEmitente = (campo: keyof Emitente, valor: any) => {
    setEmitente((atual) => (atual ? { ...atual, [campo]: valor } : atual));
  };

  const salvar = async () => {
    if (!config || !emitente) return;
    setSalvando(true);
    setErro(null);
    try {
      await api.gravarConfig(config);
      await api.gravarEmitente(emitente);
      setAviso('Configurações salvas.');
      setTimeout(() => setAviso(null), 3000);
      recarregar();
      onSalvou();
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setSalvando(false);
    }
  };

  const enviarCertificado = async () => {
    if (!arquivoCertificado) return;
    setErro(null);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const leitor = new FileReader();
        leitor.onload = () => resolve(String(leitor.result).split(',')[1]);
        leitor.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
        leitor.readAsDataURL(arquivoCertificado);
      });

      await api.enviarCertificado(base64, arquivoCertificado.name, senhaCertificado);
      setAviso('Certificado cadastrado.');
      setArquivoCertificado(null);
      setSenhaCertificado('');
      recarregar();
      onSalvou();
    } catch (err: any) {
      setErro(err.message);
    }
  };

  const removerCertificado = async () => {
    setRemovendoCert(false);
    try {
      await api.removerCertificado();
      recarregar();
      onSalvou();
    } catch (err: any) {
      setErro(err.message);
    }
  };

  const testarEmail = async () => {
    setErro(null);
    try {
      await api.gravarConfig(config!);
      await api.testarSmtp();
      setAviso('Conexão com o servidor de e-mail confirmada.');
    } catch (err: any) {
      setErro(err.message);
    }
  };

  if (!config || !emitente) {
    return <div className="py-16 text-center text-xs text-stone-500">Carregando as configurações…</div>;
  }

  return (
    <div className="flex flex-col">
      <Abas
        ativa={aba}
        onTrocar={setAba}
        abas={[
          { id: 'certificado', rotulo: 'Certificado', icone: <ShieldCheck className="w-3.5 h-3.5" /> },
          { id: 'geral', rotulo: 'Geral', icone: <FileCog className="w-3.5 h-3.5" /> },
          { id: 'webservice', rotulo: 'WebService', icone: <Globe2 className="w-3.5 h-3.5" /> },
          { id: 'emitente', rotulo: 'Emitente', icone: <Building2 className="w-3.5 h-3.5" /> },
          { id: 'arquivos', rotulo: 'Arquivos', icone: <FolderTree className="w-3.5 h-3.5" /> },
          { id: 'danfe', rotulo: 'Documento Auxiliar', icone: <Printer className="w-3.5 h-3.5" /> },
          { id: 'email', rotulo: 'Email', icone: <Mail className="w-3.5 h-3.5" /> },
        ]}
      />

      {aviso && <Faixa tom="sucesso">{aviso}</Faixa>}
      {erro && <Faixa tom="erro" onFechar={() => setErro(null)}>{erro}</Faixa>}

      {/* ---------------- Certificado ---------------- */}
      {aba === 'certificado' && (
        <Secao titulo="Certificado digital A1" descricao="Arquivo .pfx / .p12 usado para assinar e para conectar à SEFAZ">
          {certificado ? (
            <div className="mb-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2 text-xs">
              {[
                ['Titular', certificado.razao_social],
                ['CNPJ', formatarCnpj(certificado.cnpj)],
                ['Número de série', certificado.numero_serie],
                ['Emissor', certificado.emissor],
                ['Válido de', formatarData(certificado.valido_de)],
                ['Válido até', formatarData(certificado.valido_ate)],
              ].map(([rotulo, valor]) => (
                <div key={rotulo} className="flex flex-col">
                  <span className="text-[10px] font-semibold uppercase text-stone-400">{rotulo}</span>
                  <span className="text-stone-800 dark:text-stone-100 break-all">{valor || '—'}</span>
                </div>
              ))}

              <div className="sm:col-span-2 lg:col-span-3 flex items-center gap-3 pt-2">
                <span
                  className={`text-[11px] font-bold px-2 py-1 rounded-full ${
                    certificado.vencido
                      ? 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300'
                      : certificado.diasParaVencer <= 30
                      ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
                      : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                  }`}
                >
                  {certificado.vencido
                    ? 'Vencido'
                    : `Vence em ${certificado.diasParaVencer} dia(s)`}
                </span>
                <Botao variante="perigo" icone={<Trash2 className="w-3.5 h-3.5" />} onClick={() => setRemovendoCert(true)}>
                  Remover certificado
                </Botao>
              </div>
            </div>
          ) : (
            <p className="text-xs text-stone-500 dark:text-stone-400 mb-4">
              Nenhum certificado cadastrado. Sem ele, nenhuma operação com a SEFAZ funciona.
            </p>
          )}

          <div className="border-t border-stone-200 dark:border-stone-800 pt-4 grid grid-cols-1 lg:grid-cols-12 gap-3">
            <input
              ref={arquivoRef}
              type="file"
              accept=".pfx,.p12"
              className="hidden"
              onChange={(e) => setArquivoCertificado(e.target.files?.[0] || null)}
            />
            <Campo rotulo="Arquivo do certificado" className="lg:col-span-5">
              <div className="flex gap-2">
                <div className="flex-1 min-w-0 h-[34px] flex items-center px-3 bg-stone-50 dark:bg-stone-800/80 text-xs truncate border-l-2 border-amber-500">
                  {arquivoCertificado?.name || 'Nenhum arquivo escolhido'}
                </div>
                <Botao icone={<Upload className="w-3.5 h-3.5" />} onClick={() => arquivoRef.current?.click()}>
                  Escolher
                </Botao>
              </div>
            </Campo>
            <Texto
              rotulo="Senha do certificado"
              type="password"
              required
              value={senhaCertificado}
              onChange={(e) => setSenhaCertificado(e.target.value)}
              className="lg:col-span-4"
            />
            <div className="lg:col-span-3 flex items-end">
              <Botao
                variante="primario"
                disabled={!arquivoCertificado || !senhaCertificado}
                onClick={enviarCertificado}
                className="w-full"
              >
                Enviar certificado
              </Botao>
            </div>
          </div>
        </Secao>
      )}

      {/* ---------------- Geral ---------------- */}
      {aba === 'geral' && (
        <Secao titulo="Geral" descricao="Modelo do documento, forma de emissão e CSC da NFC-e">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            <Selecao
              rotulo="Modelo do documento fiscal"
              value={config.geral.modeloDF}
              onChange={(e) => alterar('geral', 'modeloDF', e.target.value)}
              opcoes={(meta?.modelos || []).map((m) => ({ valor: m.valor, rotulo: m.rotulo }))}
              className="lg:col-span-3"
            />
            <Selecao
              rotulo="Forma de emissão"
              value={config.geral.formaEmissao}
              onChange={(e) => alterar('geral', 'formaEmissao', Number(e.target.value))}
              opcoes={(meta?.formasEmissao || []).map((f) => ({ valor: f.valor, rotulo: f.rotulo }))}
              className="lg:col-span-3"
            />
            <Texto
              rotulo="Versão do layout"
              value={config.geral.versaoDF}
              disabled
              className="lg:col-span-2"
            />
            <Selecao
              rotulo="Formato do alerta"
              value={config.geral.formatoAlerta}
              onChange={(e) => alterar('geral', 'formatoAlerta', Number(e.target.value))}
              opcoes={[
                { valor: 0, rotulo: 'Nenhum' },
                { valor: 1, rotulo: 'Simples' },
                { valor: 2, rotulo: 'Detalhado' },
              ]}
              className="lg:col-span-2"
            />
            <Selecao
              rotulo="Versão do QR-Code"
              value={config.geral.versaoQRCode}
              onChange={(e) => alterar('geral', 'versaoQRCode', Number(e.target.value))}
              opcoes={[
                { valor: 2, rotulo: '2.00' },
                { valor: 3, rotulo: '3.00' },
              ]}
              className="lg:col-span-2"
            />

            <Texto
              rotulo="IdToken / IdCSC (NFC-e)"
              value={config.geral.idCSC}
              onChange={(e) => alterar('geral', 'idCSC', e.target.value)}
              className="lg:col-span-3"
            />
            <Texto
              rotulo="Token / CSC (NFC-e)"
              type="password"
              value={config.geral.csc}
              onChange={(e) => alterar('geral', 'csc', e.target.value)}
              className="lg:col-span-3"
            />
            <Texto
              rotulo="IdCSRT (SEFAZ-PR)"
              value={config.geral.idCSRT}
              onChange={(e) => alterar('geral', 'idCSRT', e.target.value)}
              className="lg:col-span-3"
            />
            <Texto
              rotulo="CSRT (SEFAZ-PR)"
              type="password"
              value={config.geral.csrt}
              onChange={(e) => alterar('geral', 'csrt', e.target.value)}
              className="lg:col-span-3"
            />

            <Texto
              rotulo="CNPJ do responsável técnico"
              value={config.geral.respTecCNPJ}
              onChange={(e) => alterar('geral', 'respTecCNPJ', e.target.value)}
              className="lg:col-span-3"
            />
            <Texto
              rotulo="Contato do responsável técnico"
              value={config.geral.respTecContato}
              onChange={(e) => alterar('geral', 'respTecContato', e.target.value)}
              className="lg:col-span-3"
            />
            <Texto
              rotulo="E-mail do responsável técnico"
              value={config.geral.respTecEmail}
              onChange={(e) => alterar('geral', 'respTecEmail', e.target.value)}
              className="lg:col-span-3"
            />
            <Texto
              rotulo="Telefone do responsável técnico"
              value={config.geral.respTecFone}
              onChange={(e) => alterar('geral', 'respTecFone', e.target.value)}
              className="lg:col-span-3"
            />

            <Texto
              rotulo="Inscrição municipal (itens de serviço)"
              value={config.geral.inscricaoMunicipal}
              onChange={(e) => alterar('geral', 'inscricaoMunicipal', e.target.value)}
              className="lg:col-span-3"
            />
            <Texto
              rotulo="CNAE fiscal"
              inputMode="numeric"
              value={config.geral.cnae}
              onChange={(e) => alterar('geral', 'cnae', e.target.value.replace(/\D/g, '').slice(0, 7))}
              className="lg:col-span-3"
            />

            <div className="lg:col-span-12 grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              <Toggle
                checked={config.geral.atualizarXML}
                onChange={(v) => alterar('geral', 'atualizarXML', v)}
                label="Atualizar XML com o protocolo"
              />
              <Toggle
                checked={config.geral.exibirErroSchema}
                onChange={(v) => alterar('geral', 'exibirErroSchema', v)}
                label="Exibir erro de schema"
              />
              <Toggle
                checked={config.geral.retirarAcentos}
                onChange={(v) => alterar('geral', 'retirarAcentos', v)}
                label="Retirar acentos dos XMLs"
              />
            </div>
          </div>
        </Secao>
      )}

      {/* ---------------- WebService ---------------- */}
      {aba === 'webservice' && (
        <div className="flex flex-col gap-4">
          <Secao titulo="WebService" descricao="UF de destino, ambiente e tempo de espera">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
              <Selecao
                rotulo="UF do emitente"
                value={config.webservice.uf}
                onChange={(e) => alterar('webservice', 'uf', e.target.value)}
                opcoes={(meta?.ufs || []).map((u) => ({ valor: u, rotulo: u }))}
                className="lg:col-span-2"
              />
              <Selecao
                rotulo="Ambiente de destino"
                value={config.webservice.ambiente}
                onChange={(e) => alterar('webservice', 'ambiente', Number(e.target.value))}
                opcoes={[
                  { valor: 2, rotulo: 'Homologação' },
                  { valor: 1, rotulo: 'Produção' },
                ]}
                className="lg:col-span-3"
              />
              <Texto
                rotulo="Timeout (segundos)"
                type="number"
                min={5}
                max={300}
                value={config.webservice.timeout}
                onChange={(e) => alterar('webservice', 'timeout', Number(e.target.value))}
                className="lg:col-span-2"
              />
              <Texto
                rotulo="Tentativas"
                type="number"
                min={1}
                max={20}
                value={config.webservice.tentativas}
                onChange={(e) => alterar('webservice', 'tentativas', Number(e.target.value))}
                className="lg:col-span-2"
              />
              <Texto
                rotulo="Intervalo (ms)"
                type="number"
                min={0}
                value={config.webservice.intervalo}
                onChange={(e) => alterar('webservice', 'intervalo', Number(e.target.value))}
                className="lg:col-span-3"
              />

              <div className="lg:col-span-12 flex flex-wrap gap-6 pt-2">
                <Toggle
                  checked={config.webservice.ajustarAguardar}
                  onChange={(v) => alterar('webservice', 'ajustarAguardar', v)}
                  label="Ajustar automaticamente o tempo de espera"
                />
                <Toggle
                  checked={config.webservice.salvarEnvelopeSoap}
                  onChange={(v) => alterar('webservice', 'salvarEnvelopeSoap', v)}
                  label="Guardar o envelope SOAP no log"
                />
              </div>
            </div>
          </Secao>

          <Secao titulo="Proxy" descricao="Deixe em branco quando a saída for direta">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
              <Texto
                rotulo="Host"
                value={config.webservice.proxyHost}
                onChange={(e) => alterar('webservice', 'proxyHost', e.target.value)}
                className="lg:col-span-4"
              />
              <Texto
                rotulo="Porta"
                inputMode="numeric"
                value={config.webservice.proxyPorta}
                onChange={(e) => alterar('webservice', 'proxyPorta', e.target.value.replace(/\D/g, ''))}
                className="lg:col-span-2"
              />
              <Texto
                rotulo="Usuário"
                value={config.webservice.proxyUsuario}
                onChange={(e) => alterar('webservice', 'proxyUsuario', e.target.value)}
                className="lg:col-span-3"
              />
              <Texto
                rotulo="Senha"
                type="password"
                value={config.webservice.proxySenha}
                onChange={(e) => alterar('webservice', 'proxySenha', e.target.value)}
                className="lg:col-span-3"
              />
            </div>
          </Secao>
        </div>
      )}

      {/* ---------------- Emitente ---------------- */}
      {aba === 'emitente' && (
        <Secao titulo="Emitente" descricao="Dados que vão no grupo <emit> da NF-e">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            <Texto
              rotulo="CNPJ"
              required
              inputMode="numeric"
              value={emitente.cnpj || ''}
              onChange={(e) => alterarEmitente('cnpj', e.target.value.replace(/\D/g, '').slice(0, 14))}
              className="lg:col-span-3"
            />
            <Texto
              rotulo="Inscrição Estadual"
              inputMode="numeric"
              value={emitente.inscricao_estadual || ''}
              onChange={(e) => alterarEmitente('inscricao_estadual', e.target.value)}
              dica="ISENTO para IE isenta. Vazio = contribuinte só de IBS/CBS: NF-e na SVRS, sem ICMS (NT 2026.007)"
              className="lg:col-span-3"
            />
            <Selecao
              rotulo="Regime tributário (CRT)"
              value={emitente.crt}
              onChange={(e) => alterarEmitente('crt', Number(e.target.value))}
              opcoes={[
                { valor: 1, rotulo: '1 — Simples Nacional' },
                { valor: 2, rotulo: '2 — Simples, excesso de sublimite' },
                { valor: 3, rotulo: '3 — Regime Normal' },
                { valor: 4, rotulo: '4 — MEI' },
              ]}
              className="lg:col-span-6"
            />

            <Texto
              rotulo="Razão social"
              required
              maxLength={60}
              value={emitente.razao_social || ''}
              onChange={(e) => alterarEmitente('razao_social', e.target.value)}
              className="lg:col-span-6"
            />
            <Texto
              rotulo="Nome fantasia"
              maxLength={60}
              value={emitente.nome_fantasia || ''}
              onChange={(e) => alterarEmitente('nome_fantasia', e.target.value)}
              className="lg:col-span-6"
            />

            <Texto
              rotulo="Logradouro"
              required
              value={emitente.logradouro || ''}
              onChange={(e) => alterarEmitente('logradouro', e.target.value)}
              className="lg:col-span-5"
            />
            <Texto
              rotulo="Número"
              required
              value={emitente.numero || ''}
              onChange={(e) => alterarEmitente('numero', e.target.value)}
              className="lg:col-span-2"
            />
            <Texto
              rotulo="Complemento"
              value={emitente.complemento || ''}
              onChange={(e) => alterarEmitente('complemento', e.target.value)}
              className="lg:col-span-5"
            />

            <Texto
              rotulo="Bairro"
              required
              value={emitente.bairro || ''}
              onChange={(e) => alterarEmitente('bairro', e.target.value)}
              className="lg:col-span-4"
            />
            <Texto
              rotulo="Código IBGE do município"
              required
              inputMode="numeric"
              value={emitente.codigo_municipio || ''}
              onChange={(e) => alterarEmitente('codigo_municipio', e.target.value.replace(/\D/g, '').slice(0, 7))}
              className="lg:col-span-3"
            />
            <Texto
              rotulo="Município"
              required
              value={emitente.municipio || ''}
              onChange={(e) => alterarEmitente('municipio', e.target.value)}
              className="lg:col-span-3"
            />
            <Selecao
              rotulo="UF"
              value={emitente.uf || ''}
              onChange={(e) => alterarEmitente('uf', e.target.value)}
              opcoes={(meta?.ufs || []).map((u) => ({ valor: u, rotulo: u }))}
              className="lg:col-span-2"
            />

            <Texto
              rotulo="CEP"
              inputMode="numeric"
              value={emitente.cep || ''}
              onChange={(e) => alterarEmitente('cep', e.target.value.replace(/\D/g, '').slice(0, 8))}
              className="lg:col-span-3"
            />
            <Texto
              rotulo="Telefone"
              inputMode="numeric"
              value={emitente.fone || ''}
              onChange={(e) => alterarEmitente('fone', e.target.value.replace(/\D/g, ''))}
              className="lg:col-span-3"
            />
          </div>
        </Secao>
      )}

      {/* ---------------- Arquivos ---------------- */}
      {aba === 'arquivos' && (
        <Secao titulo="Arquivos" descricao="Onde os XMLs e PDFs são gravados, além do banco">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            {([
              ['pastaNFe', 'Pasta de NF-e'],
              ['pastaInutilizacao', 'Pasta de inutilizações'],
              ['pastaEvento', 'Pasta de eventos'],
              ['pastaPDF', 'Pasta de PDFs'],
            ] as const).map(([campo, rotulo]) => (
              <Texto
                key={campo}
                rotulo={rotulo}
                value={config.arquivos[campo]}
                onChange={(e) => alterar('arquivos', campo, e.target.value)}
                className="lg:col-span-3"
              />
            ))}

            <div className="lg:col-span-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-2">
              {([
                ['salvarArquivos', 'Salvar arquivos em disco'],
                ['pastasMensais', 'Criar pastas mensalmente'],
                ['adicionarLiteral', 'Acrescentar literal no nome das pastas'],
                ['salvarPorDataEmissao', 'Gravar pela data de emissão'],
                ['salvarEventos', 'Salvar arquivos de eventos'],
                ['separarPorCNPJ', 'Separar por CNPJ do certificado'],
                ['separarPorModelo', 'Separar por modelo do documento'],
              ] as const).map(([campo, rotulo]) => (
                <Toggle
                  key={campo}
                  checked={config.arquivos[campo]}
                  onChange={(v) => alterar('arquivos', campo, v)}
                  label={rotulo}
                />
              ))}
            </div>
          </div>
        </Secao>
      )}

      {/* ---------------- Documento Auxiliar ---------------- */}
      {aba === 'danfe' && (
        <Secao titulo="Documento Auxiliar" descricao="Aparência do DANFE e do DANFE NFC-e">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            <Texto
              rotulo="Logomarca (URL ou caminho; PNG ou JPEG)"
              value={config.danfe.logoMarca}
              onChange={(e) => alterar('danfe', 'logoMarca', e.target.value)}
              className="lg:col-span-6"
            />
            <Selecao
              rotulo="DANFE (modelo 55)"
              value={config.danfe.tipoDanfe}
              onChange={(e) => alterar('danfe', 'tipoDanfe', Number(e.target.value))}
              opcoes={[
                { valor: 0, rotulo: 'Retrato' },
                { valor: 1, rotulo: 'Paisagem' },
              ]}
              className="lg:col-span-3"
            />
            <Selecao
              rotulo="DANFE NFC-e (modelo 65)"
              value={config.danfe.tipoDanfce}
              onChange={(e) => alterar('danfe', 'tipoDanfce', Number(e.target.value))}
              opcoes={[
                { valor: 0, rotulo: 'Bobina 80mm' },
                { valor: 1, rotulo: 'A4' },
              ]}
              className="lg:col-span-3"
            />
            <div className="lg:col-span-12 pt-2 flex flex-col gap-3">
              <Toggle
                checked={config.danfe.expandirLogo}
                onChange={(v) => alterar('danfe', 'expandirLogo', v)}
                label="Logomarca já tem o nome e o endereço: ocupa todo o quadro do emitente, sem imprimir os dados dele"
              />
              <Toggle
                checked={config.danfe.imprimirHomologacao}
                onChange={(v) => alterar('danfe', 'imprimirHomologacao', v)}
                label="Imprimir em homologação com a tarja SEM VALOR FISCAL"
              />
            </div>
          </div>
        </Secao>
      )}

      {/* ---------------- Email ---------------- */}
      {aba === 'email' && (
        <Secao
          titulo="Email"
          descricao="Servidor SMTP usado para mandar o XML e o DANFE ao destinatário"
          acoes={<Botao onClick={testarEmail}>Testar conexão</Botao>}
        >
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            <Texto
              rotulo="Servidor SMTP"
              value={config.email.host}
              onChange={(e) => alterar('email', 'host', e.target.value)}
              className="lg:col-span-5"
            />
            <Texto
              rotulo="Porta"
              inputMode="numeric"
              value={config.email.porta}
              onChange={(e) => alterar('email', 'porta', e.target.value.replace(/\D/g, ''))}
              className="lg:col-span-2"
            />
            <Texto
              rotulo="Remetente"
              type="email"
              value={config.email.remetente}
              onChange={(e) => alterar('email', 'remetente', e.target.value)}
              className="lg:col-span-5"
            />
            <Texto
              rotulo="Usuário"
              value={config.email.usuario}
              onChange={(e) => alterar('email', 'usuario', e.target.value)}
              className="lg:col-span-6"
            />
            <Texto
              rotulo="Senha"
              type="password"
              value={config.email.senha}
              onChange={(e) => alterar('email', 'senha', e.target.value)}
              className="lg:col-span-6"
            />

            <div className="lg:col-span-12 flex flex-wrap gap-6 py-1">
              <Toggle checked={config.email.ssl} onChange={(v) => alterar('email', 'ssl', v)} label="Conexão SSL (porta 465)" />
              <Toggle checked={config.email.tls} onChange={(v) => alterar('email', 'tls', v)} label="Exigir STARTTLS" />
            </div>

            <Texto
              rotulo="Assunto"
              value={config.email.assunto}
              onChange={(e) => alterar('email', 'assunto', e.target.value)}
              dica="Marcadores: {numero} {serie} {chave} {dataEmissao} {razaoSocial}"
              className="lg:col-span-12"
            />
            <Area
              rotulo="Mensagem"
              rows={4}
              value={config.email.mensagem}
              onChange={(e) => alterar('email', 'mensagem', e.target.value)}
              className="lg:col-span-12"
            />
          </div>
        </Secao>
      )}

      {/* Barra de ações no pé, como a do formulário do b2b admin */}
      <div className="px-4 py-3 border-b border-stone-200 dark:border-stone-800 flex items-center justify-end gap-2.5 bg-stone-50 dark:bg-stone-950/40">
        <Botao variante="primario" icone={<Save className="w-3.5 h-3.5" />} carregando={salvando} onClick={salvar}>
          Salvar Configurações
        </Botao>
      </div>

      <Confirmacao
        aberto={removendoCert}
        titulo="Remover o certificado?"
        mensagem="Sem certificado nenhuma operação com a SEFAZ funciona. Será necessário enviar o arquivo novamente."
        rotuloConfirmar="Remover"
        onConfirmar={removerCertificado}
        onCancelar={() => setRemovendoCert(false)}
      />
    </div>
  );
};
