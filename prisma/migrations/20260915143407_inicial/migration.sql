-- CreateTable
CREATE TABLE "eventos_recebidos" (
    "id" SERIAL NOT NULL,
    "endpoint" TEXT NOT NULL,
    "payload_bruto" JSONB NOT NULL,
    "recebido_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "job_id" TEXT,
    "erro" TEXT,

    CONSTRAINT "eventos_recebidos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pacientes_correlacao" (
    "telefone_e164" TEXT NOT NULL,
    "medx_id_cliente" INTEGER NOT NULL,
    "clint_contact_id" TEXT,
    "match_confiavel" BOOLEAN NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pacientes_correlacao_pkey" PRIMARY KEY ("telefone_e164")
);

-- CreateTable
CREATE TABLE "agendamentos" (
    "deal_id" TEXT NOT NULL,
    "medx_id_agendamento" INTEGER,
    "medx_id_cliente" INTEGER NOT NULL,
    "medx_id_usuario" INTEGER NOT NULL,
    "inicio" TEXT NOT NULL,
    "duracao_minutos" INTEGER NOT NULL,
    "ultima_edicao" TEXT,
    "status" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agendamentos_pkey" PRIMARY KEY ("deal_id")
);

-- CreateIndex
CREATE INDEX "eventos_recebidos_recebido_em_idx" ON "eventos_recebidos"("recebido_em");

-- CreateIndex
CREATE INDEX "agendamentos_medx_id_agendamento_idx" ON "agendamentos"("medx_id_agendamento");
