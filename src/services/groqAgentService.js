const Groq = require('groq-sdk');
const { executeTool } = require('../tools/agentTools');
const memoryService = require('./memoryService');
const { buildSystemPrompt } = require('../prompts');

/**
 * Open-AI / Groq Standard Tool Definitions for Function Calling
 */
const groqTools = [
  {
    type: 'function',
    function: {
      name: 'registrar_transacao',
      description: 'Registra uma nova transação financeira (despesa, receita, empréstimo), incluindo parcelamentos.',
      parameters: {
        type: 'object',
        properties: {
          descricao: { type: 'string', description: 'Descrição da transação (ex: Mercado, Salário, Aluguel).' },
          valor: { type: 'number', description: 'Valor numérico em Reais (ex: 45.90 ou 4500). OBRIGATÓRIO e maior que zero.' },
          tipo_transacao: {
            type: 'string',
            enum: ['despesa', 'receita', 'emprestimo_tomado', 'emprestimo_concedido'],
            description: 'Tipo de transação. ATENÇÃO: Salário, rendimento, pagamento recebido, vendas, PIX recebido DEVEM SER tipo "receita". Compras, contas, almoço, mercado DEVEM SER "despesa".'
          },
          metodo_pagamento: {
            type: 'string',
            enum: ['pix', 'dinheiro', 'cartao_credito', 'cartao_debito', 'outros'],
            description: 'Forma de pagamento utilizada.'
          },
          categoria_nome: { type: 'string', description: 'Nome da categoria (ex: Alimentação, Transporte, Moradia, Lazer, Salário).' },
          eh_parcelado: { type: 'boolean', description: 'Se true, indica que a compra é parcelada.' },
          total_parcelas: { type: 'integer', description: 'Quantidade total de parcelas (ex: 3, 10, 12).' },
          data_transacao: { type: 'string', description: 'Data da transação no formato ISO ou YYYY-MM-DD.' }
        },
        required: ['descricao', 'valor', 'tipo_transacao']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listar_transacoes',
      description: 'Lista e consulta as transações financeiras registradas.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'Quantidade máxima de registros (padrão: 10).' },
          tipo_transacao: { type: 'string', enum: ['despesa', 'receita', 'emprestimo_tomado', 'emprestimo_concedido'] },
          data_inicio: { type: 'string', description: 'Data inicial para filtro (YYYY-MM-DD).' },
          data_fim: { type: 'string', description: 'Data final para filtro (YYYY-MM-DD).' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'obter_resumo_financeiro',
      description: 'Obtém o resumo financeiro do mês (total de receitas, despesas, saldo líquido e limites).',
      parameters: {
        type: 'object',
        properties: {
          mes_ano: { type: 'string', description: 'Ano e mês no formato YYYY-MM (ex: 2026-08).' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'definir_limite_gasto',
      description: 'Define ou atualiza um teto/limite de gastos mensal para uma categoria.',
      parameters: {
        type: 'object',
        properties: {
          categoria_nome: { type: 'string', description: 'Nome da categoria (ex: Alimentação, Lazer).' },
          valor_limite: { type: 'number', description: 'Valor limite em Reais (ex: 500.00). OBRIGATÓRIO e maior que zero. NUNCA invente ou adivinhe este valor se o usuário não disser.' },
          mes_ano: { type: 'string', description: 'Mês e ano no formato YYYY-MM (ex: 2026-08).' }
        },
        required: ['categoria_nome', 'valor_limite']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listar_limites_gastos',
      description: 'Lista os limites de gastos configurados e o status do orçamento.',
      parameters: {
        type: 'object',
        properties: {
          mes_ano: { type: 'string', description: 'Mês e ano no formato YYYY-MM.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'deletar_transacao',
      description: 'Exclui uma transação pelo seu ID.',
      parameters: {
        type: 'object',
        properties: {
          transacao_id: { type: 'string', description: 'UUID da transação a ser deletada.' }
        },
        required: ['transacao_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'deletar_multiplas_transacoes',
      description: 'Exclui múltiplas transações fornecendo uma lista de IDs.',
      parameters: {
        type: 'object',
        properties: {
          transacao_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Lista de UUIDs para excluir.'
          }
        },
        required: ['transacao_ids']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'limpar_todas_transacoes',
      description: 'Exclui TODAS as transações cadastradas do usuário.',
      parameters: {
        type: 'object',
        properties: {
          confirmar: { type: 'boolean', description: 'Confirmar exclusão total.' }
        },
        required: ['confirmar']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'atualizar_transacao',
      description: 'Atualiza uma transação existente pelo seu ID.',
      parameters: {
        type: 'object',
        properties: {
          transacao_id: { type: 'string', description: 'UUID da transação.' },
          descricao: { type: 'string', description: 'Nova descrição.' },
          valor: { type: 'number', description: 'Novo valor.' },
          categoria_nome: { type: 'string', description: 'Novo nome da categoria.' },
          metodo_pagamento: { type: 'string', description: 'Novo método de pagamento.' },
          tipo_transacao: { type: 'string', enum: ['despesa', 'receita', 'emprestimo_tomado', 'emprestimo_concedido'] }
        },
        required: ['transacao_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listar_categorias',
      description: 'Lista todas as categorias cadastradas no sistema.',
      parameters: {
        type: 'object',
        properties: {
          tipo: { type: 'string', enum: ['receita', 'despesa'] }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'criar_categoria',
      description: 'Cria uma nova categoria.',
      parameters: {
        type: 'object',
        properties: {
          nome: { type: 'string', description: 'Nome da nova categoria.' },
          tipo: { type: 'string', enum: ['receita', 'despesa'] }
        },
        required: ['nome', 'tipo']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'deletar_categoria',
      description: 'Deleta uma categoria pelo ID.',
      parameters: {
        type: 'object',
        properties: {
          categoria_id: { type: 'string', description: 'UUID da categoria.' }
        },
        required: ['categoria_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'registrar_multiplas_transacoes',
      description: 'Registra um lote (lista) de múltiplas transações financeiras enviadas de uma só vez (relatórios, faturas, extratos).',
      parameters: {
        type: 'object',
        properties: {
          data_transacao: { type: 'string', description: 'Data padrão para todas as transações (opcional, YYYY-MM-DD).' },
          transacoes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                descricao: { type: 'string', description: 'Descrição da transação (ex: PicPay, Moto, Água).' },
                valor: { type: 'number', description: 'Valor numérico em Reais.' },
                tipo_transacao: { type: 'string', enum: ['despesa', 'receita', 'emprestimo_tomado', 'emprestimo_concedido'] },
                categoria_nome: { type: 'string', description: 'Nome da categoria (ex: Alimentação, Transporte, Moradia, Lazer, Salário).' },
                metodo_pagamento: { type: 'string', description: 'Forma de pagamento (ex: pix, cartao_credito, dinheiro).' }
              },
              required: ['descricao', 'valor', 'tipo_transacao']
            },
            description: 'Lista de transações a serem cadastradas em lote.'
          }
        },
        required: ['transacoes']
      }
    }
  }
];

class GroqAgentService {
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Processes a user message using Groq Cloud AI Models with multi-model fallback and multi-item tool execution.
   */
  async processUserMessage(userMessage, usuario) {
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) {
      throw new Error('GROQ_API_KEY environment variable is not defined.');
    }

    const groq = new Groq({ apiKey: groqKey });

    const candidateModels = [
      process.env.GROQ_MODEL || 'qwen/qwen3.6-27b',
      'openai/gpt-oss-120b',
      'openai/gpt-oss-20b'
    ];
    const uniqueModels = [...new Set(candidateModels)];

    const recentHistory = memoryService.getHistory(usuario.id);
    const hasHistory = recentHistory.length > 0;

    const systemPrompt = buildSystemPrompt({ usuario, hasHistory });

    let lastError = null;

    for (const modelId of uniqueModels) {
      let attempts = 0;
      const maxAttempts = 2;

      while (attempts < maxAttempts) {
        attempts++;
        try {
          console.log(`🚀 [GROQ AI] Processing message for ${usuario.nome} with model: ${modelId} (attempt ${attempts})`);

          const messages = [
            { role: 'system', content: systemPrompt },
            ...recentHistory,
            { role: 'user', content: userMessage }
          ];

          let iterations = 0;
          const executedToolSignatures = new Set();
          let finalReply = '';

          while (iterations < 5) {
            iterations++;

            const completion = await groq.chat.completions.create({
              messages,
              model: modelId,
              tools: groqTools,
              tool_choice: 'auto',
              temperature: 0.1
            });

            const responseMessage = completion.choices[0].message;
            messages.push(responseMessage);

            // Check if tool calls were returned
            if (!responseMessage.tool_calls || responseMessage.tool_calls.length === 0) {
              const rawContent = responseMessage.content || '';

              // Intercept pseudo function tags like <function=name>{...}</function> in text content
              const pseudoMatch = rawContent.match(/<function=(\w+)>(.*?)<\/function>/s) ||
                                  rawContent.match(/<function=(\w+)>(.*)/s);

              if (pseudoMatch) {
                const fnName = pseudoMatch[1];
                let fnArgs = {};
                try {
                  const rawJson = pseudoMatch[2].replace(/<\/function>.*/s, '').trim();
                  fnArgs = JSON.parse(rawJson);
                } catch (e) {}

                console.log(`⚡ [GROQ Pseudo Tool Intercept] Executing ${fnName} with args:`, fnArgs);
                try {
                  const toolResult = await executeTool(fnName, fnArgs, { usuario });
                  messages.push({
                    role: 'tool',
                    tool_call_id: `pseudo_${Date.now()}`,
                    content: JSON.stringify(toolResult)
                  });
                  continue; // Loop again to let AI construct final human response
                } catch (err) {
                  console.error(`❌ [GROQ Pseudo Tool Error] ${fnName}:`, err);
                }
              }

              // Clean any system code, think blocks, pseudo tags or raw function dumps from user-facing response
              finalReply = rawContent
                .replace(/<think>[\s\S]*?<\/think>/gs, '')
                .replace(/<function=.*?>.*?<\/function>/gs, '')
                .replace(/<function=.*?>/gs, '')
                .replace(/\d+\.\s+\w+:[\s\S]*/g, '')
                .replace(/Essas são as funções disponíveis[\s\S]*/gi, '')
                .trim();

              if (!finalReply) {
                finalReply = 'Operação realizada com sucesso.';
              }
              break;
            }

            // Execute tool calls
            for (const toolCall of responseMessage.tool_calls) {
              const functionName = toolCall.function.name;
              let args = {};

              try {
                args = typeof toolCall.function.arguments === 'string'
                  ? JSON.parse(toolCall.function.arguments)
                  : toolCall.function.arguments;
              } catch (e) {
                args = {};
              }

              // Deduplication signature per tool call parameters
              const signature = `${functionName}_${args.descricao || ''}_${args.valor || ''}_${args.categoria_nome || ''}`;
              if (executedToolSignatures.has(signature)) {
                console.log(`⚠️ Skipping exact duplicate tool execution: [${signature}]`);
                continue;
              }

              console.log(`⚡ [GROQ Tool Call] Executing ${functionName} with args:`, args);

              try {
                const toolResult = await executeTool(functionName, args, { usuario });
                executedToolSignatures.add(signature);

                messages.push({
                  role: 'tool',
                  tool_call_id: toolCall.id,
                  content: JSON.stringify(toolResult)
                });
              } catch (err) {
                console.error(`❌ [GROQ Tool Error] ${functionName}:`, err);
                messages.push({
                  role: 'tool',
                  tool_call_id: toolCall.id,
                  content: JSON.stringify({ status: 'erro', mensagem: err.message })
                });
              }
            }
          }

          if (!finalReply) {
            finalReply = 'Operação concluída com sucesso.';
          }

          // Save interaction to memory service
          memoryService.addUserMessage(usuario.id, userMessage);
          memoryService.addAssistantReply(usuario.id, finalReply);

          return finalReply;

        } catch (err) {
          lastError = err;
          const status = err.status || err.statusCode;
          console.warn(`⚠️ GROQ model ${modelId} failed on attempt ${attempts} (${status || err.message}).`);

          if ((status === 429 || (err.message && err.message.includes('429'))) && attempts < maxAttempts) {
            console.warn(`⏳ Rate limit (429) on GROQ ${modelId}. Waiting 2.5s before retry...`);
            await this.sleep(2500);
            continue;
          }
          break; // Move to next model if non-429 or max attempts reached for this model
        }
      }
    }

    console.error('❌ All GROQ models failed:', lastError?.message || lastError);
    return 'Desculpe, meu sistema de inteligência artificial está temporariamente sobrecarregado no momento. Por favor, envie sua mensagem novamente em alguns instantes!';
  }
}

module.exports = new GroqAgentService();
