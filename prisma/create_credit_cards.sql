-- Script SQL para criar a tabela de cartões de crédito e atualizar a tabela de transações

-- 1. Criação da tabela de cartões de crédito
CREATE TABLE IF NOT EXISTS cartoes_credito (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    nome VARCHAR NOT NULL,
    ultimos_digitos VARCHAR(4),
    limite DECIMAL DEFAULT 0,
    dia_fechamento INT NOT NULL,
    dia_vencimento INT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unq_usuario_cartao_nome UNIQUE (usuario_id, nome)
);

CREATE INDEX IF NOT EXISTS idx_cartoes_usuario ON cartoes_credito(usuario_id);

-- 2. Adição de colunas de cartão e fatura na tabela de transações (se ainda não existirem)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'transacoes' AND column_name = 'cartao_id'
    ) THEN
        ALTER TABLE transacoes ADD COLUMN cartao_id UUID REFERENCES cartoes_credito(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'transacoes' AND column_name = 'mes_fatura'
    ) THEN
        ALTER TABLE transacoes ADD COLUMN mes_fatura VARCHAR;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_transacoes_cartao ON transacoes(usuario_id, cartao_id);
CREATE INDEX IF NOT EXISTS idx_transacoes_fatura ON transacoes(usuario_id, mes_fatura);
