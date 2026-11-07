-- Documentos do candidato (metadados; o arquivo fica no storage).
-- Tabela nova, sem dados: nao exige lock_timeout, NOT VALID nem CONCURRENTLY.
-- Reversao (so antes de haver dados): DROP TABLE documents;

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "motivo" TEXT,
    "chave_storage" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "tamanho_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "enviado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revisado_por" UUID,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "documents_chave_storage_key" ON "documents"("chave_storage");
CREATE UNIQUE INDEX "documents_tenant_id_id_key" ON "documents"("tenant_id", "id");
CREATE INDEX "documents_tenant_id_ticket_id_idx" ON "documents"("tenant_id", "ticket_id");

-- AddForeignKey (composta: referencia entre tenants e recusada pelo banco)
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_ticket_id_fkey" FOREIGN KEY ("tenant_id", "ticket_id") REFERENCES "tickets"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Constraints de dominio (texto + CHECK, como no resto do schema)
ALTER TABLE documents ADD CONSTRAINT documents_tipo_check
  CHECK (tipo IN ('RG','CPF','COMPROVANTE_RESIDENCIA','CTPS','FOTO_3X4','OUTRO'));
ALTER TABLE documents ADD CONSTRAINT documents_status_check
  CHECK (status IN ('PENDENTE','APROVADO','RECUSADO'));
ALTER TABLE documents ADD CONSTRAINT documents_mime_check
  CHECK (mime IN ('image/jpeg','image/png','application/pdf'));
ALTER TABLE documents ADD CONSTRAINT documents_tamanho_check
  CHECK (tamanho_bytes > 0 AND tamanho_bytes <= 5242880);
ALTER TABLE documents ADD CONSTRAINT documents_sha256_check CHECK (sha256 ~ '^[0-9a-f]{64}$');
-- Recusado exige motivo.
ALTER TABLE documents ADD CONSTRAINT documents_motivo_check
  CHECK (status <> 'RECUSADO' OR (motivo IS NOT NULL AND length(btrim(motivo)) > 0));

-- Row Level Security (mesmo padrao das demais tabelas)
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON documents;
CREATE POLICY tenant_isolation ON documents
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- A API envia e le; so a decisao do RH e atualizavel. DELETE fica para a rotina de
-- anonimizacao (LGPD, M2), que pede o grant na propria migration.
GRANT SELECT, INSERT ON documents TO kronos_app;
GRANT UPDATE (status, motivo, revisado_por) ON documents TO kronos_app;
