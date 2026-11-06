-- =====================================================================
-- nfeWeb — estrutura do banco
-- Rode este script no MySQL antes de subir o app. O aplicativo NUNCA cria
-- tabelas sozinho.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Emitente. Corresponde à aba "Emitente" das configurações do exemplo
-- Delphi (Frm_ACBrNFe) e é o tenant do sistema: tudo é isolado por ela.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nfe_empresas (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  cnpj           VARCHAR(14)  NOT NULL,
  inscricao_estadual VARCHAR(20) NULL,
  razao_social   VARCHAR(120) NOT NULL,
  nome_fantasia  VARCHAR(120) NULL,
  logradouro     VARCHAR(120) NULL,
  numero         VARCHAR(20)  NULL,
  complemento    VARCHAR(80)  NULL,
  bairro         VARCHAR(80)  NULL,
  codigo_municipio VARCHAR(7) NULL,
  municipio      VARCHAR(80)  NULL,
  uf             CHAR(2)      NULL,
  cep            VARCHAR(8)   NULL,
  fone           VARCHAR(20)  NULL,
  -- 1=Simples Nacional, 2=Simples com excesso de sublimite, 3=Regime Normal, 4=MEI
  crt            TINYINT      NOT NULL DEFAULT 3,
  ativo          TINYINT(1)   NOT NULL DEFAULT 1,
  criado_em      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_nfe_empresas_cnpj (cnpj)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS nfe_usuarios (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id    INT UNSIGNED NOT NULL,
  nome          VARCHAR(80)  NOT NULL,
  email         VARCHAR(120) NOT NULL,
  senha_hash    VARCHAR(255) NOT NULL,
  cargo         VARCHAR(60)  NULL,
  -- Preferências das grades (larguras, ordem das colunas, linhas da grade), em JSON
  config_listas TEXT         NULL,
  ativo         TINYINT(1)   NOT NULL DEFAULT 1,
  criado_em     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_nfe_usuarios_email (empresa_id, email),
  CONSTRAINT fk_nfe_usuarios_empresa FOREIGN KEY (empresa_id) REFERENCES nfe_empresas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Configurações (abas Certificado, Geral, WebService, Arquivos, Documento
-- Auxiliar e Email). Ficam em JSON: o conjunto de chaves acompanha o
-- ACBrNFe.ini do exemplo e muda com frequência, então uma coluna por opção
-- só geraria migração a cada ajuste.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nfe_config (
  empresa_id    INT UNSIGNED NOT NULL,
  dados         JSON         NOT NULL,
  atualizado_em DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (empresa_id),
  CONSTRAINT fk_nfe_config_empresa FOREIGN KEY (empresa_id) REFERENCES nfe_empresas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Certificado A1 (.pfx) do emitente. O arquivo fica no banco para que o
-- servidor não dependa de nada instalado na máquina.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nfe_certificados (
  empresa_id     INT UNSIGNED NOT NULL,
  nome_arquivo   VARCHAR(160) NOT NULL,
  arquivo        LONGBLOB     NOT NULL,
  senha          VARCHAR(255) NOT NULL,
  cnpj           VARCHAR(14)  NULL,
  razao_social   VARCHAR(160) NULL,
  numero_serie   VARCHAR(80)  NULL,
  emissor        VARCHAR(255) NULL,
  valido_de      DATETIME     NULL,
  valido_ate     DATETIME     NULL,
  atualizado_em  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (empresa_id),
  CONSTRAINT fk_nfe_certificados_empresa FOREIGN KEY (empresa_id) REFERENCES nfe_empresas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Documentos emitidos
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nfe_documentos (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id     INT UNSIGNED NOT NULL,
  -- referência do módulo de origem no concentrador (POST /api/emitir); nula nas notas da tela
  referencia     VARCHAR(80)  NULL,
  chave          VARCHAR(44)  NULL,
  modelo         CHAR(2)      NOT NULL DEFAULT '55',
  serie          INT          NOT NULL,
  numero         INT          NOT NULL,
  -- rascunho | assinada | processando | enviada | autorizada | rejeitada | cancelada | denegada
  situacao       VARCHAR(20)  NOT NULL DEFAULT 'rascunho',
  ambiente       TINYINT      NOT NULL DEFAULT 2,
  data_emissao   DATETIME     NULL,
  destinatario_documento VARCHAR(20) NULL,
  destinatario_nome VARCHAR(160) NULL,
  valor_total    DECIMAL(15,2) NOT NULL DEFAULT 0,
  recibo         VARCHAR(20)  NULL,
  protocolo      VARCHAR(20)  NULL,
  codigo_status  INT          NULL,
  motivo         VARCHAR(255) NULL,
  dados          JSON         NULL,
  xml            LONGTEXT     NULL,
  xml_protocolo  LONGTEXT     NULL,
  criado_em      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_nfe_documentos_chave (empresa_id, chave),
  UNIQUE KEY uq_nfe_documentos_numero (empresa_id, modelo, serie, ambiente, numero),
  UNIQUE KEY uq_nfe_documentos_referencia (empresa_id, referencia),
  KEY ix_nfe_documentos_situacao (empresa_id, situacao),
  CONSTRAINT fk_nfe_documentos_empresa FOREIGN KEY (empresa_id) REFERENCES nfe_empresas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Contador de numeração por série (doc/plano-concentrador.md, fase 1)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nfe_numeracao (
  empresa_id     INT UNSIGNED NOT NULL,
  modelo         CHAR(2)      NOT NULL,
  serie          INT          NOT NULL,
  ambiente       TINYINT      NOT NULL,
  ultimo_numero  INT          NOT NULL,
  atualizado_em  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (empresa_id, modelo, serie, ambiente),
  CONSTRAINT fk_nfe_numeracao_empresa FOREIGN KEY (empresa_id) REFERENCES nfe_empresas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Eventos (cancelamento, carta de correção, manifestação, EPEC, ...)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nfe_eventos (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id     INT UNSIGNED NOT NULL,
  chave          VARCHAR(44)  NOT NULL,
  tipo_evento    VARCHAR(6)   NOT NULL,
  descricao      VARCHAR(120) NULL,
  sequencia      INT          NOT NULL DEFAULT 1,
  ambiente       TINYINT      NOT NULL DEFAULT 2,
  data_evento    DATETIME     NULL,
  justificativa  VARCHAR(255) NULL,
  protocolo      VARCHAR(20)  NULL,
  codigo_status  INT          NULL,
  motivo         VARCHAR(255) NULL,
  xml            LONGTEXT     NULL,
  xml_retorno    LONGTEXT     NULL,
  criado_em      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_nfe_eventos_chave (empresa_id, chave, tipo_evento, sequencia),
  CONSTRAINT fk_nfe_eventos_empresa FOREIGN KEY (empresa_id) REFERENCES nfe_empresas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Inutilizações de numeração
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nfe_inutilizacoes (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id     INT UNSIGNED NOT NULL,
  ano            SMALLINT     NOT NULL,
  modelo         CHAR(2)      NOT NULL DEFAULT '55',
  serie          INT          NOT NULL,
  numero_inicial INT          NOT NULL,
  numero_final   INT          NOT NULL,
  justificativa  VARCHAR(255) NOT NULL,
  ambiente       TINYINT      NOT NULL DEFAULT 2,
  protocolo      VARCHAR(20)  NULL,
  codigo_status  INT          NULL,
  motivo         VARCHAR(255) NULL,
  xml            LONGTEXT     NULL,
  xml_retorno    LONGTEXT     NULL,
  criado_em      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_nfe_inutilizacoes (empresa_id, ano, modelo, serie),
  CONSTRAINT fk_nfe_inutilizacoes_empresa FOREIGN KEY (empresa_id) REFERENCES nfe_empresas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Distribuição DF-e: documentos baixados do Ambiente Nacional por NSU
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nfe_distribuicao (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id     INT UNSIGNED NOT NULL,
  nsu            VARCHAR(15)  NOT NULL,
  schema_doc     VARCHAR(60)  NULL,
  chave          VARCHAR(44)  NULL,
  tipo           VARCHAR(30)  NULL,
  emitente_nome  VARCHAR(160) NULL,
  valor          DECIMAL(15,2) NULL,
  data_documento DATETIME     NULL,
  xml            LONGTEXT     NULL,
  manifestado    TINYINT(1)   NOT NULL DEFAULT 0,
  criado_em      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_nfe_distribuicao_nsu (empresa_id, nsu),
  KEY ix_nfe_distribuicao_chave (empresa_id, chave),
  CONSTRAINT fk_nfe_distribuicao_empresa FOREIGN KEY (empresa_id) REFERENCES nfe_empresas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Log de comunicação com a SEFAZ (equivale ao memo "Log" do exemplo)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nfe_log (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id     INT UNSIGNED NOT NULL,
  operacao       VARCHAR(40)  NOT NULL,
  url            VARCHAR(255) NULL,
  chave          VARCHAR(44)  NULL,
  sucesso        TINYINT(1)   NOT NULL DEFAULT 0,
  codigo_status  INT          NULL,
  motivo         VARCHAR(255) NULL,
  duracao_ms     INT          NULL,
  envio          LONGTEXT     NULL,
  retorno        LONGTEXT     NULL,
  criado_em      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_nfe_log_empresa (empresa_id, criado_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
