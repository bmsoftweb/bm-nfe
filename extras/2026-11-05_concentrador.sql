-- =====================================================================
-- nfeWeb — concentrador de NF-e (doc/plano-concentrador.md, fases 1 e 2)
--
-- Fase 1: contador de numeração por empresa + modelo + série + ambiente, e
--         número único por série em nfe_documentos.
-- Fase 2: referência do módulo de origem, única por empresa.
--
-- Rode uma vez no banco do nfeWeb. Instalações novas já recebem tudo pelo
-- extras/nfeweb_schema.sql.
-- =====================================================================

-- 1) ANTES de tudo: o índice único falha se já houver número repetido.
--    Esta consulta tem de voltar vazia; se não voltar, resolva caso a caso
--    (normalmente apagando rascunhos/assinadas/rejeitadas antigas) e rode de novo.
SELECT empresa_id, modelo, serie, ambiente, numero, COUNT(*) AS vezes,
       GROUP_CONCAT(CONCAT(id, ':', situacao) ORDER BY id) AS notas
  FROM nfe_documentos
 GROUP BY empresa_id, modelo, serie, ambiente, numero
HAVING COUNT(*) > 1;

-- 2) Contador de numeração
CREATE TABLE nfe_numeracao (
  empresa_id     INT UNSIGNED NOT NULL,
  modelo         CHAR(2)      NOT NULL,
  serie          INT          NOT NULL,
  ambiente       TINYINT      NOT NULL,
  ultimo_numero  INT          NOT NULL,
  atualizado_em  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (empresa_id, modelo, serie, ambiente),
  CONSTRAINT fk_nfe_numeracao_empresa FOREIGN KEY (empresa_id) REFERENCES nfe_empresas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3) Número único por série e referência do módulo de origem
ALTER TABLE nfe_documentos
  ADD COLUMN referencia VARCHAR(80) NULL AFTER empresa_id,
  DROP INDEX ix_nfe_documentos_numero,
  ADD UNIQUE KEY uq_nfe_documentos_numero (empresa_id, modelo, serie, ambiente, numero),
  ADD UNIQUE KEY uq_nfe_documentos_referencia (empresa_id, referencia);

-- =====================================================================
-- Reversão (desfaz 2 e 3)
-- =====================================================================
-- ALTER TABLE nfe_documentos
--   DROP INDEX uq_nfe_documentos_referencia,
--   DROP INDEX uq_nfe_documentos_numero,
--   ADD KEY ix_nfe_documentos_numero (empresa_id, modelo, serie, numero),
--   DROP COLUMN referencia;
--
-- DROP TABLE nfe_numeracao;
