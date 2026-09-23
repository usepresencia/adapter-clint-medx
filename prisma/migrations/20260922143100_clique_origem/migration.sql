-- CreateTable
CREATE TABLE "cliques_origem" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "fbclid" TEXT,
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "utm_campaign" TEXT,
    "utm_content" TEXT,
    "utm_term" TEXT,
    "telefone" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cliques_origem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cliques_origem_codigo_key" ON "cliques_origem"("codigo");

-- CreateIndex
CREATE INDEX "cliques_origem_telefone_idx" ON "cliques_origem"("telefone");

-- CreateIndex
CREATE INDEX "cliques_origem_criado_em_idx" ON "cliques_origem"("criado_em");
