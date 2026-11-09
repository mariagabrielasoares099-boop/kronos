-- Contador do protocolo ADM-AAAA-NNNNNN por tenant e ano.
-- Nao da para usar max(protocolo): o RLS por empresa esconde chamados de outras empresas do mesmo tenant
-- e geraria protocolos repetidos. O contador e atualizado de forma atomica (INSERT ... ON CONFLICT DO UPDATE).
-- Tabela nova, sem dados: nao exige lock_timeout. Reversao (so antes de haver dados): DROP TABLE protocol_counters;

CREATE TABLE "protocol_counters" (
    "tenant_id" UUID NOT NULL,
    "ano" INTEGER NOT NULL,
    "ultimo" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "protocol_counters_pkey" PRIMARY KEY ("tenant_id", "ano")
);

ALTER TABLE "protocol_counters" ADD CONSTRAINT "protocol_counters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE protocol_counters ADD CONSTRAINT protocol_counters_ultimo_check CHECK (ultimo >= 0 AND ultimo <= 999999);
ALTER TABLE protocol_counters ADD CONSTRAINT protocol_counters_ano_check CHECK (ano BETWEEN 2000 AND 2999);

-- So isolamento por tenant: o contador nao e dado pessoal.
ALTER TABLE protocol_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE protocol_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON protocol_counters
  USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE ON protocol_counters TO kronos_app;
