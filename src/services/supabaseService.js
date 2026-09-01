const prisma = require('../config/prisma');
const supabase = require('../config/supabase');
const CreditCardService = require('./creditCardService');

/**
 * Service to handle database operations for:
 * - usuarios
 * - categorias
 * - limites_gastos
 * - transacoes
 * 
 * Uses Prisma ORM as primary database layer, with fallback to Supabase SDK if DATABASE_URL is not set.
 */
class SupabaseService {
  /**
   * Normalizes phone number to digits only and ensures DDI 55 prefix.
   */
  static cleanPhone(phone) {
    if (!phone) return '';
    let digits = phone.replace(/\D/g, '');

    // Always prefix DDI 55 if missing for Brazilian numbers (10 or 11 digits)
    if (digits.length === 10 || digits.length === 11) {
      digits = `55${digits}`;
    }
    return digits;
  }

  // ==========================================
  // USUARIOS
  // ==========================================

  async findUserByPhone(phone) {
    const rawDigits = SupabaseService.cleanPhone(phone);
    if (!rawDigits) return null;

    const possiblePhones = [
      rawDigits,
      `+${rawDigits}`,
      rawDigits.replace(/^55/, ''),
      `+55${rawDigits.replace(/^55/, '')}`
    ];

    try {
      if (process.env.DATABASE_URL) {
        const user = await prisma.usuario.findFirst({
          where: {
            telefone: { in: possiblePhones }
          }
        });
        if (user) return user;
      }
    } catch (err) {
      console.warn('Prisma query error, attempting Supabase SDK fallback:', err.message);
    }

    // Fallback to Supabase SDK with filter
    try {
      const { data, error } = await supabase
        .from('usuarios')
        .select('*')
        .in('telefone', possiblePhones)
        .limit(1);

      if (!error && data && data.length > 0) {
        return data[0];
      }
    } catch (e) {}

    return null;
  }

  async listUsers() {
    try {
      if (process.env.DATABASE_URL) {
        return await prisma.usuario.findMany({
          orderBy: { createdAt: 'desc' }
        });
      }
    } catch (err) {
      console.warn('Prisma error:', err.message);
    }

    const { data, error } = await supabase.from('usuarios').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async findUserById(id) {
    if (!id) return null;
    try {
      if (process.env.DATABASE_URL) {
        return await prisma.usuario.findUnique({ where: { id } });
      }
    } catch (err) {
      console.warn('Prisma error:', err.message);
    }

    const { data, error } = await supabase.from('usuarios').select('*').eq('id', id).single();
    if (error || !data) return null;
    return data;
  }

  async createUser({ nome, telefone, senha = null, role = 'USER', ativo = true }) {
    const finalPhone = SupabaseService.cleanPhone(telefone);

    // Check if user with this phone number already exists
    const existing = await this.findUserByPhone(finalPhone);
    if (existing) {
      throw new Error(`Já existe um usuário cadastrado com o número ${finalPhone} (${existing.nome}).`);
    }

    let senhaHash = null;
    if (senha) {
      const bcrypt = require('bcryptjs');
      senhaHash = await bcrypt.hash(senha, 10);
    }

    try {
      if (process.env.DATABASE_URL) {
        return await prisma.usuario.create({
          data: { nome, telefone: finalPhone, senha: senhaHash, role, ativo }
        });
      }
    } catch (err) {
      console.warn('Prisma error:', err.message);
      if (err.code === 'P2002') {
        throw new Error('Já existe um usuário cadastrado com este número de telefone.');
      }
    }

    const { data, error } = await supabase
      .from('usuarios')
      .insert([{ nome, telefone: finalPhone, senha: senhaHash, role, ativo }])
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new Error('Já existe um usuário cadastrado com este número de telefone.');
      }
      throw error;
    }
    return data;
  }

  async setPassword(id, novaSenha) {
    const bcrypt = require('bcryptjs');
    const senhaHash = await bcrypt.hash(novaSenha, 10);
    return await this.updateUser(id, { senha: senhaHash });
  }

  async authenticateUser(telefone, senha) {
    const user = await this.findUserByPhone(telefone);
    if (!user) return { success: false, message: 'Usuário não encontrado com este telefone.' };
    if (!user.ativo) return { success: false, message: 'Usuário inativo. Fale com o administrador.' };

    // Se o usuário ainda não tiver senha gravada (ou coluna não populada), aceita a senha inicial '123456'
    if (!user.senha) {
      if (senha === '123456' || senha === 'admin') {
        // Tenta salvar a senha criada
        try { await this.setPassword(user.id, senha); } catch (e) {}
        return { success: true, user: { ...user, role: user.role || 'ADMIN' } };
      }
      return { success: false, message: 'Primeiro acesso: utilize a senha inicial 123456 ou fale com o Administrador.' };
    }

    const bcrypt = require('bcryptjs');
    const valid = await bcrypt.compare(senha, user.senha);
    if (!valid) {
      return { success: false, message: 'Senha incorreta.' };
    }

    return { success: true, user };
  }

  async updateUser(id, updates) {
    if (updates.telefone) {
      updates.telefone = SupabaseService.cleanPhone(updates.telefone);

      const existing = await this.findUserByPhone(updates.telefone);
      if (existing && existing.id !== id) {
        throw new Error(`Já existe um usuário registrado com este número de telefone (${existing.nome}).`);
      }
    }

    try {
      if (process.env.DATABASE_URL) {
        return await prisma.usuario.update({
          where: { id },
          data: updates
        });
      }
    } catch (err) {
      console.warn('Prisma error:', err.message);
    }

    const { data, error } = await supabase.from('usuarios').update(updates).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }

  async deleteUser(id) {
    try {
      if (process.env.DATABASE_URL) {
        return await prisma.usuario.delete({
          where: { id }
        });
      }
    } catch (err) {
      console.warn('Prisma error:', err.message);
    }

    const { data, error } = await supabase.from('usuarios').delete().eq('id', id).select();
    if (error) throw error;
    return data;
  }

  // ==========================================
  // CATEGORIAS
  // ==========================================

  async listCategories(tipo = null) {
    try {
      if (process.env.DATABASE_URL) {
        const where = tipo ? { tipo } : {};
        return await prisma.categoria.findMany({
          where,
          orderBy: { nome: 'asc' }
        });
      }
    } catch (err) {
      console.warn('Prisma error:', err.message);
    }

    let query = supabase.from('categorias').select('*').order('nome');
    if (tipo) query = query.eq('tipo', tipo);
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }

  async findCategoryByName(nome) {
    try {
      if (process.env.DATABASE_URL) {
        return await prisma.categoria.findFirst({
          where: {
            nome: {
              contains: nome.trim(),
              mode: 'insensitive'
            }
          }
        });
      }
    } catch (err) {
      console.warn('Prisma error:', err.message);
    }

    const { data } = await supabase.from('categorias').select('*').ilike('nome', `%${nome.trim()}%`).limit(1);
    return data && data.length > 0 ? data[0] : null;
  }

  async createCategory({ nome, tipo }) {
    if (!['receita', 'despesa'].includes(tipo)) {
      throw new Error('Tipo de categoria deve ser "receita" ou "despesa".');
    }

    try {
      if (process.env.DATABASE_URL) {
        return await prisma.categoria.create({
          data: { nome, tipo }
        });
      }
    } catch (err) {
      console.warn('Prisma error:', err.message);
    }

    const { data, error } = await supabase.from('categorias').insert([{ nome, tipo }]).select().single();
    if (error) throw error;
    return data;
  }

  async updateCategory(id, updates) {
    try {
      if (process.env.DATABASE_URL) {
        return await prisma.categoria.update({
          where: { id },
          data: updates
        });
      }
    } catch (err) {
      console.warn('Prisma error:', err.message);
    }

    const { data, error } = await supabase.from('categorias').update(updates).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }

  async deleteCategory(id) {
    try {
      if (process.env.DATABASE_URL) {
        return await prisma.categoria.delete({
          where: { id }
        });
      }
    } catch (err) {
      console.warn('Prisma error:', err.message);
    }

    const { data, error } = await supabase.from('categorias').delete().eq('id', id).select();
    if (error) throw error;
    return data;
  }

  // ==========================================
  // LIMITES DE GASTOS
  // ==========================================

  async listLimits(usuarioId, mesAno = null) {
    try {
      if (process.env.DATABASE_URL) {
        const where = { usuarioId };
        if (mesAno) where.mesAno = mesAno;
        const result = await prisma.limiteGasto.findMany({
          where,
          include: { categoria: true }
        });
        return result.map(l => ({
          ...l,
          usuario_id: l.usuarioId,
          categoria_id: l.categoriaId,
          valor_limite: parseFloat(l.valorLimite.toString()),
          mes_ano: l.mesAno
        }));
      }
    } catch (err) {
      console.warn('Prisma error:', err.message);
    }

    let query = supabase.from('limites_gastos').select('*, categoria:categorias(id, nome, tipo)').eq('usuario_id', usuarioId);
    if (mesAno) query = query.eq('mes_ano', mesAno);
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }

  async setLimit({ usuario_id, categoria_id, valor_limite, mes_ano }) {
    try {
      if (process.env.DATABASE_URL) {
        const result = await prisma.limiteGasto.upsert({
          where: {
            usuarioId_categoriaId_mesAno: {
              usuarioId: usuario_id,
              categoriaId: categoria_id,
              mesAno: mes_ano
            }
          },
          update: { valorLimite: valor_limite },
          create: {
            usuarioId: usuario_id,
            categoriaId: categoria_id,
            valorLimite: valor_limite,
            mesAno: mes_ano
          }
        });
        return {
          ...result,
          usuario_id: result.usuarioId,
          categoria_id: result.categoriaId,
          valor_limite: parseFloat(result.valorLimite.toString()),
          mes_ano: result.mesAno
        };
      }
    } catch (err) {
      console.warn('Prisma error:', err.message);
    }

    const { data: existing } = await supabase.from('limites_gastos').select('id').eq('usuario_id', usuario_id).eq('categoria_id', categoria_id).eq('mes_ano', mes_ano).single();
    if (existing) {
      const { data, error } = await supabase.from('limites_gastos').update({ valor_limite }).eq('id', existing.id).select().single();
      if (error) throw error;
      return data;
    } else {
      const { data, error } = await supabase.from('limites_gastos').insert([{ usuario_id, categoria_id, valor_limite, mes_ano }]).select().single();
      if (error) throw error;
      return data;
    }
  }

  async deleteLimit(id) {
    try {
      if (process.env.DATABASE_URL) {
        return await prisma.limiteGasto.delete({ where: { id } });
      }
    } catch (err) {
      console.warn('Prisma error:', err.message);
    }

    const { data, error } = await supabase.from('limites_gastos').delete().eq('id', id).select();
    if (error) throw error;
    return data;
  }

  // ==========================================
  // CARTÕES DE CRÉDITO
  // ==========================================

  async listCreditCards(usuarioId) {
    try {
      if (process.env.DATABASE_URL) {
        const cards = await prisma.cartaoCredito.findMany({
          where: { usuarioId },
          orderBy: { nome: 'asc' }
        });
        return cards.map(c => ({
          ...c,
          usuario_id: c.usuarioId,
          ultimos_digitos: c.ultimosDigitos,
          limite: c.limite ? parseFloat(c.limite.toString()) : 0,
          dia_fechamento: c.diaFechamento,
          dia_vencimento: c.diaVencimento
        }));
      }
    } catch (err) {
      console.warn('Prisma error in listCreditCards, falling back:', err.message);
    }

    const { data, error } = await supabase
      .from('cartoes_credito')
      .select('*')
      .eq('usuario_id', usuarioId)
      .order('nome');
    if (error) throw error;
    return data || [];
  }

  async findCreditCardByName(usuarioId, nome) {
    if (!nome) return null;
    const cleanName = String(nome).trim();

    try {
      if (process.env.DATABASE_URL) {
        const card = await prisma.cartaoCredito.findFirst({
          where: {
            usuarioId,
            OR: [
              { nome: { contains: cleanName, mode: 'insensitive' } },
              { ultimosDigitos: { contains: cleanName } }
            ]
          }
        });
        if (card) {
          return {
            ...card,
            usuario_id: card.usuarioId,
            ultimos_digitos: card.ultimosDigitos,
            limite: card.limite ? parseFloat(card.limite.toString()) : 0,
            dia_fechamento: card.diaFechamento,
            dia_vencimento: card.diaVencimento
          };
        }
      }
    } catch (err) {
      console.warn('Prisma error in findCreditCardByName:', err.message);
    }

    const { data } = await supabase
      .from('cartoes_credito')
      .select('*')
      .eq('usuario_id', usuarioId)
      .ilike('nome', `%${cleanName}%`)
      .limit(1);

    return data && data.length > 0 ? data[0] : null;
  }

  async createCreditCard({ usuario_id, nome, ultimos_digitos = null, limite = 0, dia_fechamento, dia_vencimento }) {
    const diaFechamentoNum = parseInt(dia_fechamento, 10);
    const diaVencimentoNum = parseInt(dia_vencimento, 10);
    const limiteNum = parseFloat(limite) || 0;

    if (isNaN(diaFechamentoNum) || diaFechamentoNum < 1 || diaFechamentoNum > 31) {
      throw new Error('Dia de fechamento inválido (deve ser entre 1 e 31).');
    }
    if (isNaN(diaVencimentoNum) || diaVencimentoNum < 1 || diaVencimentoNum > 31) {
      throw new Error('Dia de vencimento inválido (deve ser entre 1 e 31).');
    }

    try {
      if (process.env.DATABASE_URL) {
        const res = await prisma.cartaoCredito.create({
          data: {
            usuarioId: usuario_id,
            nome,
            ultimosDigitos: ultimos_digitos,
            limite: limiteNum,
            diaFechamento: diaFechamentoNum,
            diaVencimento: diaVencimentoNum
          }
        });
        return {
          ...res,
          usuario_id: res.usuarioId,
          ultimos_digitos: res.ultimosDigitos,
          limite: parseFloat(res.limite.toString()),
          dia_fechamento: res.diaFechamento,
          dia_vencimento: res.diaVencimento
        };
      }
    } catch (err) {
      console.warn('Prisma error in createCreditCard:', err.message);
    }

    const { data, error } = await supabase
      .from('cartoes_credito')
      .insert([{
        usuario_id,
        nome,
        ultimos_digitos,
        limite: limiteNum,
        dia_fechamento: diaFechamentoNum,
        dia_vencimento: diaVencimentoNum
      }])
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async updateCreditCard(id, updates) {
    const dataToUpdate = {};
    if (updates.nome) dataToUpdate.nome = updates.nome;
    if (updates.ultimos_digitos !== undefined) dataToUpdate.ultimosDigitos = updates.ultimos_digitos;
    if (updates.limite !== undefined) dataToUpdate.limite = parseFloat(updates.limite);
    if (updates.dia_fechamento !== undefined) dataToUpdate.diaFechamento = parseInt(updates.dia_fechamento, 10);
    if (updates.dia_vencimento !== undefined) dataToUpdate.diaVencimento = parseInt(updates.dia_vencimento, 10);

    try {
      if (process.env.DATABASE_URL) {
        const res = await prisma.cartaoCredito.update({
          where: { id },
          data: dataToUpdate
        });
        return {
          ...res,
          usuario_id: res.usuarioId,
          ultimos_digitos: res.ultimosDigitos,
          limite: parseFloat(res.limite.toString()),
          dia_fechamento: res.diaFechamento,
          dia_vencimento: res.diaVencimento
        };
      }
    } catch (err) {
      console.warn('Prisma error in updateCreditCard:', err.message);
    }

    const { data, error } = await supabase.from('cartoes_credito').update(updates).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }

  async deleteCreditCard(id) {
    try {
      if (process.env.DATABASE_URL) {
        return await prisma.cartaoCredito.delete({ where: { id } });
      }
    } catch (err) {
      console.warn('Prisma error in deleteCreditCard:', err.message);
    }

    const { data, error } = await supabase.from('cartoes_credito').delete().eq('id', id).select();
    if (error) throw error;
    return data;
  }

  async getInvoiceSummary(usuarioId, cartaoNome = null, mesFatura = null) {
    const now = new Date();
    const formattedMesFatura = mesFatura || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    let targetCard = null;
    if (cartaoNome) {
      targetCard = await this.findCreditCardByName(usuarioId, cartaoNome);
    }

    try {
      if (process.env.DATABASE_URL) {
        const where = {
          usuarioId,
          tipoTransacao: 'despesa',
          OR: [
            { mesFatura: formattedMesFatura },
            {
              mesFatura: null,
              metodoPagamento: 'cartao_credito'
            }
          ]
        };

        if (targetCard) {
          where.cartaoId = targetCard.id;
        }

        const transacoes = await prisma.transacao.findMany({
          where,
          include: { categoria: true, cartao: true },
          orderBy: { dataTransacao: 'asc' }
        });

        const totalFatura = transacoes.reduce((acc, t) => acc + parseFloat(t.valor.toString()), 0);

        return {
          mes_fatura: formattedMesFatura,
          cartao: targetCard ? targetCard.nome : 'Todos os Cartões',
          dia_fechamento: targetCard ? targetCard.diaFechamento : null,
          dia_vencimento: targetCard ? targetCard.diaVencimento : null,
          total_fatura: totalFatura,
          quantidade_itens: transacoes.length,
          itens: transacoes.map(t => ({
            id: t.id,
            descricao: t.descricao,
            valor: parseFloat(t.valor.toString()),
            categoria: t.categoria ? t.categoria.nome : 'Geral',
            cartao: t.cartao ? t.cartao.nome : 'Cartão',
            parcela: t.ehParcelado ? `${t.parcelaAtual}/${t.totalParcelas}` : 'À vista',
            data: t.dataTransacao.toISOString().split('T')[0]
          }))
        };
      }
    } catch (err) {
      console.warn('Prisma error in getInvoiceSummary, falling back:', err.message);
    }

    let query = supabase
      .from('transacoes')
      .select('*, categoria:categorias(id, nome), cartao:cartoes_credito(id, nome)')
      .eq('usuario_id', usuarioId)
      .eq('tipo_transacao', 'despesa')
      .eq('mes_fatura', formattedMesFatura);

    if (targetCard) {
      query = query.eq('cartao_id', targetCard.id);
    }

    const { data: transacoes, error } = await query;
    if (error) throw error;

    const list = transacoes || [];
    const totalFatura = list.reduce((acc, t) => acc + parseFloat(t.valor || 0), 0);

    return {
      mes_fatura: formattedMesFatura,
      cartao: targetCard ? targetCard.nome : 'Todos os Cartões',
      total_fatura: totalFatura,
      quantidade_itens: list.length,
      itens: list.map(t => ({
        id: t.id,
        descricao: t.descricao,
        valor: parseFloat(t.valor || 0),
        categoria: t.categoria ? t.categoria.nome : 'Geral',
        cartao: t.cartao ? t.cartao.nome : 'Cartão',
        parcela: t.eh_parcelado ? `${t.parcela_atual}/${t.total_parcelas}` : 'À vista',
        data: t.data_transacao ? t.data_transacao.split('T')[0] : null
      }))
    };
  }

  // ==========================================
  // TRANSAÇÕES
  // ==========================================

  async createTransaction({
    usuario_id,
    categoria_id = null,
    categoria_nome = null,
    cartao_id = null,
    cartao_nome = null,
    mes_fatura = null,
    descricao,
    valor,
    tipo_transacao = 'despesa',
    metodo_pagamento = 'pix',
    eh_parcelado = false,
    parcela_atual = 1,
    total_parcelas = 1,
    data_transacao = new Date().toISOString()
  }) {
    if (!categoria_id && categoria_nome) {
      const cat = await this.findCategoryByName(categoria_nome);
      if (cat) categoria_id = cat.id;
    }

    // Identifica se é cartão de crédito e busca o cartão correspondente
    let resolvedCard = null;
    if (cartao_nome || cartao_id || metodo_pagamento === 'cartao_credito') {
      metodo_pagamento = 'cartao_credito';
      if (cartao_nome) {
        resolvedCard = await this.findCreditCardByName(usuario_id, cartao_nome);
      } else if (cartao_id) {
        const cards = await this.listCreditCards(usuario_id);
        resolvedCard = cards.find(c => c.id === cartao_id);
      } else {
        const cards = await this.listCreditCards(usuario_id);
        if (cards && cards.length === 1) {
          resolvedCard = cards[0];
        }
      }
      if (resolvedCard) {
        cartao_id = resolvedCard.id;
      }
    }

    const totalParcelasNum = parseInt(total_parcelas, 10) || 1;
    const ehParceladoBool = eh_parcelado || totalParcelasNum > 1;
    const safeBaseDate = this.parseSafeDate(data_transacao);

    if (ehParceladoBool && totalParcelasNum > 1) {
      const valorParcela = parseFloat((parseFloat(valor) / totalParcelasNum).toFixed(2));
      const closingDay = resolvedCard ? (resolvedCard.diaFechamento || resolvedCard.dia_fechamento) : 31;
      const firstInvoiceMonth = mes_fatura || (resolvedCard ? CreditCardService.getInvoiceMonth(safeBaseDate, closingDay, 0) : null);

      if (process.env.DATABASE_URL) {
        try {
          const result = await prisma.$transaction(async (tx) => {
            const pai = await tx.transacao.create({
              data: {
                usuarioId: usuario_id,
                categoriaId: categoria_id,
                cartaoId: cartao_id,
                descricao: `${descricao} (1/${totalParcelasNum})`,
                valor: valorParcela,
                tipoTransacao: tipo_transacao,
                metodoPagamento: metodo_pagamento,
                ehParcelado: true,
                parcelaAtual: 1,
                totalParcelas: totalParcelasNum,
                mesFatura: firstInvoiceMonth,
                dataTransacao: safeBaseDate
              },
              include: { categoria: true, cartao: true }
            });

            const childrenData = [];
            for (let i = 2; i <= totalParcelasNum; i++) {
              const dataProxima = new Date(safeBaseDate);
              dataProxima.setMonth(safeBaseDate.getMonth() + (i - 1));
              const childInvoiceMonth = resolvedCard ? CreditCardService.getInvoiceMonth(safeBaseDate, closingDay, i - 1) : null;

              childrenData.push({
                usuarioId: usuario_id,
                categoriaId: categoria_id,
                cartaoId: cartao_id,
                descricao: `${descricao} (${i}/${totalParcelasNum})`,
                valor: valorParcela,
                tipoTransacao: tipo_transacao,
                metodoPagamento: metodo_pagamento,
                ehParcelado: true,
                parcelaAtual: i,
                totalParcelas: totalParcelasNum,
                transacaoPaiId: pai.id,
                mesFatura: childInvoiceMonth,
                dataTransacao: dataProxima
              });
            }

            if (childrenData.length > 0) {
              await tx.transacao.createMany({ data: childrenData });
            }

            return pai;
          });

          return {
            transacao: {
              ...result,
              usuario_id: result.usuarioId,
              categoria_id: result.categoriaId,
              cartao_id: result.cartaoId,
              cartao_nome: resolvedCard ? resolvedCard.nome : undefined,
              mes_fatura: firstInvoiceMonth,
              valor: parseFloat(result.valor.toString())
            },
            mensagem: `Transação parcelada em ${totalParcelasNum}x de R$ ${valorParcela.toFixed(2)} criada com sucesso!${firstInvoiceMonth ? ` (1ª parcela na fatura ${firstInvoiceMonth})` : ''}`,
            total_parcelas: totalParcelasNum
          };
        } catch (err) {
          console.warn('Prisma transaction error, falling back:', err.message);
        }
      }

      // Supabase fallback
      const paiTrans = await this._insertSingleTransaction({
        usuarioId: usuario_id,
        categoriaId: categoria_id,
        cartaoId: cartao_id,
        descricao: `${descricao} (1/${totalParcelasNum})`,
        valor: parseFloat(valorParcela),
        tipoTransacao: tipo_transacao,
        metodoPagamento: metodo_pagamento,
        ehParcelado: true,
        parcelaAtual: 1,
        totalParcelas: totalParcelasNum,
        mesFatura: firstInvoiceMonth,
        dataTransacao: safeBaseDate
      });

      const parcelasCriadas = [paiTrans];

      for (let i = 2; i <= totalParcelasNum; i++) {
        const dataProxima = new Date(safeBaseDate);
        dataProxima.setMonth(safeBaseDate.getMonth() + (i - 1));
        const childInvoiceMonth = resolvedCard ? CreditCardService.getInvoiceMonth(safeBaseDate, closingDay, i - 1) : null;

        const childTrans = await this._insertSingleTransaction({
          usuarioId: usuario_id,
          categoriaId: categoria_id,
          cartaoId: cartao_id,
          descricao: `${descricao} (${i}/${totalParcelasNum})`,
          valor: parseFloat(valorParcela),
          tipoTransacao: tipo_transacao,
          metodoPagamento: metodo_pagamento,
          ehParcelado: true,
          parcelaAtual: i,
          totalParcelas: totalParcelasNum,
          transacaoPaiId: paiTrans.id,
          mesFatura: childInvoiceMonth,
          dataTransacao: dataProxima
        });

        if (childTrans) parcelasCriadas.push(childTrans);
      }

      return {
        transacao: paiTrans,
        mensagem: `Transação parcelada em ${totalParcelasNum}x de R$ ${valorParcela} criada com sucesso!`,
        total_parcelas: totalParcelasNum,
        parcelas: parcelasCriadas
      };
    } else {
      const closingDay = resolvedCard ? (resolvedCard.diaFechamento || resolvedCard.dia_fechamento) : 31;
      const singleInvoiceMonth = mes_fatura || (resolvedCard ? CreditCardService.getInvoiceMonth(safeBaseDate, closingDay, 0) : null);

      return await this._insertSingleTransaction({
        usuarioId: usuario_id,
        categoriaId: categoria_id,
        cartaoId: cartao_id,
        descricao,
        valor: parseFloat(valor),
        tipoTransacao: tipo_transacao,
        metodoPagamento: metodo_pagamento,
        ehParcelado: false,
        parcelaAtual: 1,
        totalParcelas: 1,
        mesFatura: singleInvoiceMonth,
        dataTransacao: safeBaseDate
      });
    }
  }

  parseSafeDate(dateInput) {
    if (!dateInput) return new Date();
    if (dateInput instanceof Date && !isNaN(dateInput.getTime())) return dateInput;

    if (typeof dateInput === 'string') {
      const str = dateInput.trim();
      const brMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
      if (brMatch) {
        const [_, day, month, year] = brMatch;
        const d = new Date(Date.UTC(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10), 12, 0, 0));
        if (!isNaN(d.getTime())) return d;
      }
      const parsed = new Date(str);
      if (!isNaN(parsed.getTime())) return parsed;
    }

    return new Date();
  }

  async _insertSingleTransaction(data) {
    const safeDate = this.parseSafeDate(data.dataTransacao);
    const dataToInsert = {
      ...data,
      dataTransacao: safeDate
    };

    try {
      if (process.env.DATABASE_URL) {
        const res = await prisma.transacao.create({
          data: dataToInsert,
          include: { categoria: true, cartao: true }
        });
        return {
          ...res,
          usuario_id: res.usuarioId,
          categoria_id: res.categoriaId,
          cartao_id: res.cartaoId,
          cartao_nome: res.cartao ? res.cartao.nome : undefined,
          mes_fatura: res.mesFatura,
          tipo_transacao: res.tipoTransacao,
          metodo_pagamento: res.metodoPagamento,
          eh_parcelado: res.ehParcelado,
          parcela_atual: res.parcelaAtual,
          total_parcelas: res.totalParcelas,
          transacao_pai_id: res.transacaoPaiId,
          data_transacao: res.dataTransacao,
          valor: parseFloat(res.valor.toString())
        };
      }
    } catch (err) {
      console.warn('Prisma error:', err.message);
    }

    const { data: res, error } = await supabase
      .from('transacoes')
      .insert([{
        usuario_id: data.usuarioId,
        categoria_id: data.categoriaId,
        cartao_id: data.cartaoId,
        mes_fatura: data.mesFatura,
        descricao: data.descricao,
        valor: data.valor,
        tipo_transacao: data.tipoTransacao,
        metodo_pagamento: data.metodoPagamento,
        eh_parcelado: data.ehParcelado,
        parcela_atual: data.parcelaAtual,
        total_parcelas: data.totalParcelas,
        transacao_pai_id: data.transacaoPaiId,
        data_transacao: safeDate.toISOString()
      }])
      .select('*, categoria:categorias(id, nome, tipo), cartao:cartoes_credito(id, nome)')
      .single();

    if (error) throw error;
    return res;
  }

  async listTransactions(usuarioId, options = {}) {
    const { limit = 50, data_inicio, data_fim, tipo_transacao, categoria_id, cartao_id, mes_fatura } = options;

    try {
      if (process.env.DATABASE_URL) {
        const where = { usuarioId };
        if (tipo_transacao) where.tipoTransacao = tipo_transacao;
        if (categoria_id) where.categoriaId = categoria_id;
        if (cartao_id) where.cartaoId = cartao_id;
        if (mes_fatura) where.mesFatura = mes_fatura;
        if (data_inicio || data_fim) {
          where.dataTransacao = {};
          if (data_inicio) where.dataTransacao.gte = new Date(data_inicio);
          if (data_fim) where.dataTransacao.lte = new Date(data_fim);
        }

        const res = await prisma.transacao.findMany({
          where,
          take: limit ? parseInt(limit, 10) : 50,
          orderBy: { dataTransacao: 'desc' },
          include: { categoria: true, cartao: true }
        });

        return res.map(t => ({
          ...t,
          usuario_id: t.usuarioId,
          categoria_id: t.categoriaId,
          cartao_id: t.cartaoId,
          cartao_nome: t.cartao ? t.cartao.nome : undefined,
          mes_fatura: t.mesFatura,
          tipo_transacao: t.tipoTransacao,
          metodo_pagamento: t.metodoPagamento,
          eh_parcelado: t.ehParcelado,
          parcela_atual: t.parcelaAtual,
          total_parcelas: t.totalParcelas,
          transacao_pai_id: t.transacaoPaiId,
          data_transacao: t.dataTransacao,
          valor: parseFloat(t.valor.toString())
        }));
      }
    } catch (err) {
      console.warn('Prisma error:', err.message);
    }

    let query = supabase.from('transacoes').select('*, categoria:categorias(id, nome, tipo), cartao:cartoes_credito(id, nome)').eq('usuario_id', usuarioId).order('data_transacao', { ascending: false });
    if (limit) query = query.limit(limit);
    if (tipo_transacao) query = query.eq('tipo_transacao', tipo_transacao);
    if (categoria_id) query = query.eq('categoria_id', categoria_id);
    if (cartao_id) query = query.eq('cartao_id', cartao_id);
    if (mes_fatura) query = query.eq('mes_fatura', mes_fatura);
    if (data_inicio) query = query.gte('data_transacao', data_inicio);
    if (data_fim) query = query.lte('data_transacao', data_fim);

    const { data, error } = await query;
    if (error) throw error;
    return data;
  }

  async updateTransaction(id, updates) {
    const dataToUpdate = {};
    if (updates.descricao) dataToUpdate.descricao = updates.descricao;
    if (updates.valor) dataToUpdate.valor = updates.valor;
    if (updates.metodo_pagamento) dataToUpdate.metodoPagamento = updates.metodo_pagamento;
    if (updates.tipo_transacao) dataToUpdate.tipoTransacao = updates.tipo_transacao;
    if (updates.categoria_id) dataToUpdate.categoriaId = updates.categoria_id;

    try {
      if (process.env.DATABASE_URL) {
        const res = await prisma.transacao.update({
          where: { id },
          data: dataToUpdate,
          include: { categoria: true }
        });
        return {
          ...res,
          usuario_id: res.usuarioId,
          categoria_id: res.categoriaId,
          tipo_transacao: res.tipoTransacao,
          metodo_pagamento: res.metodoPagamento,
          valor: parseFloat(res.valor.toString())
        };
      }
    } catch (err) {
      console.warn('Prisma error:', err.message);
    }

    const { data, error } = await supabase.from('transacoes').update(updates).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }

  async deleteTransaction(id) {
    try {
      if (process.env.DATABASE_URL) {
        return await prisma.transacao.delete({ where: { id } });
      }
    } catch (err) {
      console.warn('Prisma error:', err.message);
    }

    const { data, error } = await supabase.from('transacoes').delete().eq('id', id).select();
    if (error) throw error;
    return data;
  }

  async deleteTransactions(idsArray) {
    if (!idsArray || idsArray.length === 0) return { count: 0 };

    try {
      if (process.env.DATABASE_URL) {
        const res = await prisma.transacao.deleteMany({
          where: { id: { in: idsArray } }
        });
        return { count: res.count };
      }
    } catch (err) {
      console.warn('Prisma error:', err.message);
    }

    const { data, error } = await supabase.from('transacoes').delete().in('id', idsArray).select();
    if (error) throw error;
    return { count: (data || []).length };
  }

  async deleteAllTransactions(usuarioId) {
    try {
      if (process.env.DATABASE_URL) {
        const res = await prisma.transacao.deleteMany({
          where: { usuarioId }
        });
        return { count: res.count };
      }
    } catch (err) {
      console.warn('Prisma error:', err.message);
    }

    const { data, error } = await supabase.from('transacoes').delete().eq('usuario_id', usuarioId).select();
    if (error) throw error;
    return { count: (data || []).length };
  }

  /**
   * Generates a monthly financial summary with timezone-safe month boundaries.
   */
  async getFinancialSummary(usuarioId, mesAno = null) {
    let year, month;
    if (mesAno && mesAno.includes('-')) {
      const parts = mesAno.split('-');
      year = parseInt(parts[0], 10);
      month = parseInt(parts[1], 10);
    } else {
      const now = new Date();
      year = now.getFullYear();
      month = now.getMonth() + 1;
    }

    const formattedMesAno = `${year}-${String(month).padStart(2, '0')}`;
    const startOfMonth = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const endOfMonth = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    try {
      if (process.env.DATABASE_URL) {
        // Native aggregations in PostgreSQL (high speed and no 500-item cutoff)
        const [totalsByType, expensesByCategory, categories, limites] = await Promise.all([
          prisma.transacao.groupBy({
            by: ['tipoTransacao'],
            where: {
              usuarioId,
              dataTransacao: { gte: startOfMonth, lte: endOfMonth }
            },
            _sum: { valor: true },
            _count: { id: true }
          }),
          prisma.transacao.groupBy({
            by: ['categoriaId'],
            where: {
              usuarioId,
              tipoTransacao: 'despesa',
              dataTransacao: { gte: startOfMonth, lte: endOfMonth }
            },
            _sum: { valor: true }
          }),
          prisma.categoria.findMany(),
          this.listLimits(usuarioId, formattedMesAno)
        ]);

        const catMap = new Map(categories.map(c => [c.id, c.nome]));
        const porCategoria = {};
        expensesByCategory.forEach(item => {
          const nome = catMap.get(item.categoriaId) || 'Sem Categoria';
          porCategoria[nome] = parseFloat(item._sum.valor ? item._sum.valor.toString() : 0);
        });

        let totalReceitas = 0;
        let totalDespesas = 0;
        let totalEmprestimosTomados = 0;
        let totalEmprestimosConcedidos = 0;
        let totalTransacoes = 0;

        totalsByType.forEach(t => {
          const sumVal = parseFloat(t._sum.valor ? t._sum.valor.toString() : 0);
          totalTransacoes += t._count.id;
          if (t.tipoTransacao === 'receita') totalReceitas = sumVal;
          else if (t.tipoTransacao === 'despesa') totalDespesas = sumVal;
          else if (t.tipoTransacao === 'emprestimo_tomado') totalEmprestimosTomados = sumVal;
          else if (t.tipoTransacao === 'emprestimo_concedido') totalEmprestimosConcedidos = sumVal;
        });

        const statusLimites = (limites || []).map(lim => {
          const catNome = lim.categoria ? lim.categoria.nome : 'Geral';
          const gastoAtual = porCategoria[catNome] || 0;
          const percentual = lim.valor_limite > 0 ? ((gastoAtual / lim.valor_limite) * 100).toFixed(1) : 0;
          return {
            categoria: catNome,
            valor_limite: lim.valor_limite,
            gasto_atual: gastoAtual,
            saldo_disponivel: lim.valor_limite - gastoAtual,
            percentual_usado: `${percentual}%`,
            excedido: gastoAtual > lim.valor_limite
          };
        });

        return {
          mes_ano: formattedMesAno,
          total_receitas: totalReceitas,
          total_despesas: totalDespesas,
          saldo_liquido: totalReceitas - totalDespesas,
          total_emprestimos_tomados: totalEmprestimosTomados,
          total_emprestimos_concedidos: totalEmprestimosConcedidos,
          gastos_por_categoria: porCategoria,
          status_limites: statusLimites,
          total_transacoes: totalTransacoes
        };
      }
    } catch (err) {
      console.warn('Prisma aggregation error, falling back:', err.message);
    }

    const startOfMonthISO = startOfMonth.toISOString();
    const endOfMonthISO = endOfMonth.toISOString();

    const transacoes = await this.listTransactions(usuarioId, {
      data_inicio: startOfMonthISO,
      data_fim: endOfMonthISO,
      limit: 500
    });

    const limites = await this.listLimits(usuarioId, formattedMesAno);

    let totalReceitas = 0;
    let totalDespesas = 0;
    let totalEmprestimosTomados = 0;
    let totalEmprestimosConcedidos = 0;
    const porCategoria = {};

    (transacoes || []).forEach(t => {
      const val = parseFloat(t.valor) || 0;
      const catNome = t.categoria ? t.categoria.nome : 'Sem Categoria';

      if (!porCategoria[catNome]) porCategoria[catNome] = 0;

      if (t.tipo_transacao === 'receita') {
        totalReceitas += val;
      } else if (t.tipo_transacao === 'despesa') {
        totalDespesas += val;
        porCategoria[catNome] += val;
      } else if (t.tipo_transacao === 'emprestimo_tomado') {
        totalEmprestimosTomados += val;
      } else if (t.tipo_transacao === 'emprestimo_concedido') {
        totalEmprestimosConcedidos += val;
      }
    });

    const statusLimites = limites.map(lim => {
      const catNome = lim.categoria ? lim.categoria.nome : 'Geral';
      const gastoAtual = porCategoria[catNome] || 0;
      const percentual = lim.valor_limite > 0 ? ((gastoAtual / lim.valor_limite) * 100).toFixed(1) : 0;
      return {
        categoria: catNome,
        valor_limite: lim.valor_limite,
        gasto_atual: gastoAtual,
        saldo_disponivel: lim.valor_limite - gastoAtual,
        percentual_usado: `${percentual}%`,
        excedido: gastoAtual > lim.valor_limite
      };
    });

    return {
      mes_ano: formattedMesAno,
      total_receitas: totalReceitas,
      total_despesas: totalDespesas,
      saldo_liquido: totalReceitas - totalDespesas,
      total_emprestimos_tomados: totalEmprestimosTomados,
      total_emprestimos_concedidos: totalEmprestimosConcedidos,
      gastos_por_categoria: porCategoria,
      status_limites: statusLimites,
      total_transacoes: (transacoes || []).length
    };
  }
}

module.exports = new SupabaseService();
