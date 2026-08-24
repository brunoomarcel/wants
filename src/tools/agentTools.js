const supabaseService = require('../services/supabaseService');

/**
 * Tool Definitions and Executors for Agent Function Calling
 */

const toolDeclarations = [];

/**
 * Handles execution of tool calls triggered by AI Models.
 */
async function executeTool(toolName, args, context) {
  const user = context.usuario;
  if (!user || !user.id) {
    throw new Error('Usuário não autenticado ou não encontrado no sistema.');
  }

  const userId = user.id;

  switch (toolName) {
    case 'registrar_transacao': {
      const valNum = parseFloat(args.valor);
      if (isNaN(valNum) || valNum <= 0) {
        return {
          status: 'erro',
          mensagem: 'O valor da transação deve ser um número maior que zero. Pergunte ao usuário qual é o valor em Reais antes de registrar.'
        };
      }

      // Automatic Safeguard: Detect income keywords in description or category and force 'receita'
      const descLower = (args.descricao || '').toLowerCase();
      const catLower = (args.categoria_nome || '').toLowerCase();
      const incomeKeywords = ['salário', 'salario', 'rendimento', 'venda', 'freelance', 'pro-labore', 'prolabore', 'comissão', 'comissao', 'cashback', 'reembolso', 'pagamento recebido'];

      let tipoFinal = args.tipo_transacao || 'despesa';
      if (incomeKeywords.some(kw => descLower.includes(kw) || catLower.includes(kw))) {
        tipoFinal = 'receita';
      }

      const res = await supabaseService.createTransaction({
        usuario_id: userId,
        descricao: args.descricao,
        valor: valNum,
        tipo_transacao: tipoFinal,
        metodo_pagamento: args.metodo_pagamento || 'pix',
        categoria_nome: args.categoria_nome || (tipoFinal === 'receita' ? 'Salário' : 'Outros'),
        eh_parcelado: args.eh_parcelado || false,
        total_parcelas: args.total_parcelas || 1,
        data_transacao: args.data_transacao || new Date().toISOString()
      });

      let alertaLimite = null;
      if (args.categoria_nome && tipoFinal === 'despesa') {
        const cat = await supabaseService.findCategoryByName(args.categoria_nome);
        if (cat) {
          const now = new Date();
          const mesAno = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
          const limites = await supabaseService.listLimits(userId, mesAno);
          const limiteCat = limites.find(l => l.categoria_id === cat.id);
          if (limiteCat) {
            const summary = await supabaseService.getFinancialSummary(userId, mesAno);
            const gastoCat = summary.gastos_por_categoria[cat.nome] || 0;
            if (gastoCat > limiteCat.valor_limite) {
              alertaLimite = `🚨 *ALERTA DE LIMITE*: Você ultrapassou o limite de R$ ${limiteCat.valor_limite.toFixed(2)} para ${cat.nome}! Total atual: R$ ${gastoCat.toFixed(2)}`;
            } else if (gastoCat >= limiteCat.valor_limite * 0.8) {
              alertaLimite = `⚠️ *AVISO*: Você já atingiu ${(gastoCat/limiteCat.valor_limite * 100).toFixed(0)}% do seu limite de ${cat.nome} (R$ ${gastoCat.toFixed(2)} de R$ ${limiteCat.valor_limite.toFixed(2)}).`;
            }
          }
        }
      }

      return {
        status: 'sucesso',
        dados: res,
        alerta_limite: alertaLimite
      };
    }

    case 'registrar_multiplas_transacoes': {
      const list = Array.isArray(args.transacoes) ? args.transacoes : [];
      if (list.length === 0) {
        return { status: 'erro', mensagem: 'Nenhuma transação enviada na lista.' };
      }

      const resultados = [];
      const incomeKeywords = ['salário', 'salario', 'rendimento', 'venda', 'freelance', 'pro-labore', 'prolabore', 'comissão', 'comissao', 'cashback', 'reembolso', 'pagamento recebido'];

      for (const item of list) {
        const valNum = parseFloat(item.valor);
        if (isNaN(valNum) || valNum <= 0) continue;

        const descLower = (item.descricao || '').toLowerCase();
        const catLower = (item.categoria_nome || '').toLowerCase();
        let tipoFinal = item.tipo_transacao || 'despesa';

        if (incomeKeywords.some(kw => descLower.includes(kw) || catLower.includes(kw))) {
          tipoFinal = 'receita';
        }

        try {
          const res = await supabaseService.createTransaction({
            usuario_id: userId,
            descricao: item.descricao || 'Item em lote',
            valor: valNum,
            tipo_transacao: tipoFinal,
            metodo_pagamento: item.metodo_pagamento || 'pix',
            categoria_nome: item.categoria_nome || (tipoFinal === 'receita' ? 'Salário' : 'Outros'),
            eh_parcelado: item.eh_parcelado || false,
            total_parcelas: item.total_parcelas || 1,
            data_transacao: item.data_transacao || args.data_transacao || new Date().toISOString()
          });
          resultados.push(res);
        } catch (e) {
          console.warn('⚠️ Erro ao registrar item em lote:', e.message);
        }
      }

      return {
        status: 'sucesso',
        total_registradas: resultados.length,
        transacoes: resultados,
        mensagem: `${resultados.length} transações cadastradas em lote com sucesso!`
      };
    }

    case 'listar_transacoes': {
      const trans = await supabaseService.listTransactions(userId, args);
      const sanitizadas = (trans || []).map(t => ({
        id: t.id,
        data: t.data_transacao ? new Date(t.data_transacao).toISOString().split('T')[0] : undefined,
        descricao: t.descricao,
        valor: t.valor,
        tipo: t.tipo_transacao,
        categoria: t.categoria ? t.categoria.nome : 'Sem categoria',
        metodo: t.metodo_pagamento,
        parcela: t.eh_parcelado ? `${t.parcela_atual}/${t.total_parcelas}` : undefined
      }));
      return {
        status: 'sucesso',
        total: sanitizadas.length,
        transacoes: sanitizadas
      };
    }

    case 'obter_resumo_financeiro': {
      const summary = await supabaseService.getFinancialSummary(userId, args.mes_ano);
      return {
        status: 'sucesso',
        resumo: summary
      };
    }

    case 'definir_limite_gasto': {
      const valLim = parseFloat(args.valor_limite);
      if (isNaN(valLim) || valLim <= 0) {
        return {
          status: 'erro',
          mensagem: 'O valor limite em Reais é obrigatório e deve ser maior que zero. Pergunte ao usuário qual é o valor limite em Reais antes de salvar.'
        };
      }

      let cat = await supabaseService.findCategoryByName(args.categoria_nome);
      if (!cat) {
        cat = await supabaseService.createCategory({
          nome: args.categoria_nome,
          tipo: 'despesa'
        });
      }

      const now = new Date();
      const mesAno = args.mes_ano || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      const res = await supabaseService.setLimit({
        usuario_id: userId,
        categoria_id: cat.id,
        valor_limite: args.valor_limite,
        mes_ano: mesAno
      });

      return {
        status: 'sucesso',
        mensagem: `Limite de R$ ${args.valor_limite.toFixed(2)} definido para a categoria ${cat.nome} no mês ${mesAno}.`,
        limite: res
      };
    }

    case 'listar_limites_gastos': {
      const now = new Date();
      const mesAno = args.mes_ano || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const summary = await supabaseService.getFinancialSummary(userId, mesAno);
      return {
        status: 'sucesso',
        mes_ano: mesAno,
        limites: summary.status_limites
      };
    }

    case 'deletar_transacao': {
      const res = await supabaseService.deleteTransaction(args.transacao_id);
      return {
        status: 'sucesso',
        mensagem: 'Transação excluída com sucesso.',
        resultado: res
      };
    }

    case 'deletar_multiplas_transacoes': {
      const res = await supabaseService.deleteTransactions(args.transacao_ids);
      return {
        status: 'sucesso',
        mensagem: `${res.count} transações foram excluídas com sucesso.`
      };
    }

    case 'limpar_todas_transacoes': {
      if (args.confirmar) {
        const res = await supabaseService.deleteAllTransactions(userId);
        return {
          status: 'sucesso',
          mensagem: `Todas as ${res.count} transações do usuário foram excluídas com sucesso.`
        };
      }
      return { status: 'cancelado', mensagem: 'Operação cancelada (requer confirmação).' };
    }

    case 'atualizar_transacao': {
      const updates = {};
      if (args.descricao) updates.descricao = args.descricao;
      if (args.valor) updates.valor = parseFloat(args.valor);
      if (args.metodo_pagamento) updates.metodo_pagamento = args.metodo_pagamento;
      if (args.tipo_transacao) updates.tipo_transacao = args.tipo_transacao;
      if (args.categoria_nome) {
        const cat = await supabaseService.findCategoryByName(args.categoria_nome);
        if (cat) updates.categoria_id = cat.id;
      }

      const res = await supabaseService.updateTransaction(args.transacao_id, updates);
      return {
        status: 'sucesso',
        mensagem: 'Transação atualizada com sucesso.',
        transacao: res
      };
    }

    case 'listar_categorias': {
      const cats = await supabaseService.listCategories(args.tipo);
      return {
        status: 'sucesso',
        total: cats.length,
        categorias: cats
      };
    }

    case 'criar_categoria': {
      const cat = await supabaseService.createCategory({
        nome: args.nome,
        tipo: args.tipo
      });
      return {
        status: 'sucesso',
        categoria: cat
      };
    }

    case 'deletar_categoria': {
      const res = await supabaseService.deleteCategory(args.categoria_id);
      return {
        status: 'sucesso',
        mensagem: 'Categoria excluída com sucesso.',
        resultado: res
      };
    }

    default:
      throw new Error(`Ferramenta '${toolName}' não reconhecida.`);
  }
}

module.exports = {
  toolDeclarations,
  executeTool
};
