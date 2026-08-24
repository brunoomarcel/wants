const supabaseService = require('../services/supabaseService');
const whatsappService = require('../services/whatsappService');
const groqAgentService = require('../services/groqAgentService');

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

      const { senderPhone, messageText, pushName, instanceToken } = parsed;

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

      // Trigger WhatsApp "typing..." presence in background
      whatsappService.sendPresence(senderPhone, 'composing', instanceToken).catch(() => {});

      // 3. Process message exclusively using GROQ Cloud AI Engine (Llama 3.3 70B)
      const agentReply = await groqAgentService.processUserMessage(messageText, usuario);

      // 4. Send response back to user via WhatsApp (Evolution API Go)
      await whatsappService.sendMessage(senderPhone, agentReply, instanceToken);

    } catch (error) {
      console.error('❌ Error handling webhook:', error);
    }
  }
}

module.exports = new WebhookController();
