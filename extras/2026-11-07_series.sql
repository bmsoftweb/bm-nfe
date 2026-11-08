-- =====================================================================
-- BMNFe — cadastro de séries
--
-- A emissão (tela Nova NF-e e o concentrador /api/emitir) só aceita série
-- cadastrada e ativa para o modelo. Cada série diz o formato do DANFE, que
-- vai no tpImp do XML:
--   1 = retrato, 2 = paisagem, 3 = DANFE simplificado (modelo 55)
--   4 = DANFE NFC-e (modelo 65)
--
-- Rode uma vez no banco do BMNFe. Instalações novas já recebem a tabela pelo
-- extras/bmnfe_schema.sql.
--
-- Reversão: DROP TABLE nfe_series;
-- =====================================================================

CREATE TABLE nfe_series (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id        INT UNSIGNED NOT NULL,
  modelo            CHAR(2)      NOT NULL,
  serie             INT          NOT NULL,
  descricao         VARCHAR(60)  NULL,
  formato_impressao TINYINT      NOT NULL DEFAULT 1,
  ativo             TINYINT(1)   NOT NULL DEFAULT 1,
  criado_em         DATETIME     NOT NULL,
  atualizado_em     DATETIME     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_nfe_series (empresa_id, modelo, serie),
  CONSTRAINT fk_nfe_series_empresa FOREIGN KEY (empresa_id) REFERENCES nfe_empresas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- As séries que já têm notas entram cadastradas (em retrato no modelo 55), para
-- a emissão não parar no dia da atualização. Confira o formato de cada uma na tela.
INSERT INTO nfe_series (empresa_id, modelo, serie, descricao, formato_impressao, criado_em)
SELECT DISTINCT empresa_id, modelo, serie, CONCAT('Série ', serie), IF(modelo = '65', 4, 1), NOW()
  FROM nfe_documentos
 WHERE modelo IS NOT NULL AND serie IS NOT NULL;
