const supabaseService = require('../services/supabaseService');
const whatsappService = require('../services/whatsappService');
const groqAgentService = require('../services/groqAgentService');

const processedMessageIds = new Set();

class WebhookController {
  /**
   * Handles incoming webhooks from Evolution API Go.
   * Powered exclusively by GROQ Cloud AI (Llama 3.3 70B).
   */
  async handleEvolutionWebhook(req, res) {
    // Always return HTTP 200 immediately to prevent Evolution API timeout / retries
    res.status(200).json({ status: 'received' });

    try {
      // 1. Parse webhook payload and filter out fromMe messages (messages sent by the instance itself)
      const parsed = whatsappService.parseWebhookPayload(req.body);
      if (!parsed) {
        return;
      }

      const { messageId, senderPhone, messageText, pushName, instanceToken } = parsed;

      // Deduplication check: ignore if this exact message event was already processed
      if (messageId) {
        if (processedMessageIds.has(messageId)) {
          console.log(`🛑 [DUPLICATE] Ignored duplicate webhook event for messageId: ${messageId}`);
          return;
        }
        processedMessageIds.add(messageId);
        setTimeout(() => processedMessageIds.delete(messageId), 60000);
      }

      // 2. SECURITY CHECK: Verify if sender phone exists in Supabase 'usuarios' table BEFORE calling AI
      const usuario = await supabaseService.findUserByPhone(senderPhone);

      if (!usuario) {
        console.warn(`🛑 [SECURITY] Ignored message from unregistered number: ${senderPhone} (${pushName}). Message was NOT sent to AI.`);
        return;
      }

      if (!usuario.ativo) {
        console.warn(`🛑 [SECURITY] Ignored message from inactive user: ${usuario.nome} (${senderPhone}). Message was NOT sent to AI.`);
        return;
      }

      console.log(`✅ [AUTHORIZED USER] Processing request for registered user: ${usuario.nome} (Phone: ${senderPhone}, ID: ${usuario.id})`);

      // 3. Immediately trigger WhatsApp "digitando..." presence when message is received
      whatsappService.sendPresence(senderPhone, 'composing', instanceToken).catch(() => {});

      // 4. Process message using GROQ Cloud AI Engine (Llama 3.3 70B / Qwen)
      const agentReply = await groqAgentService.processUserMessage(messageText, usuario);

      // 5. Send response back to user via WhatsApp as soon as AI completes
      await whatsappService.sendMessage(senderPhone, agentReply, instanceToken);

    } catch (error) {
      console.error('❌ Error handling webhook:', error);
    }
  }
}

module.exports = new WebhookController();
