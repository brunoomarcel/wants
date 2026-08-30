const axios = require('axios');
const evolutionConfig = require('../config/evolution');

/**
 * Standardized WhatsApp Service for Evolution API Go
 */
class WhatsappService {
  /**
   * Cleans and normalizes phone number to digits only, always ensuring DDI 55 prefix.
   */
  formatPhoneNumber(phone) {
    if (!phone) return '';
    let digits = phone.replace(/\D/g, '');

    // Always prefix DDI 55 if missing for Brazilian numbers (10 or 11 digits)
    if (digits.length === 10 || digits.length === 11) {
      digits = `55${digits}`;
    }
    return digits;
  }

  /**
   * Fetches active instance information (connected phone number, status, direct WhatsApp Web link).
   */
  async getAgentInfo() {
    const { baseUrl, apiKey, instanceName } = evolutionConfig;
    let rawNumber = process.env.AGENT_PHONE || process.env.EVOLUTION_INSTANCE_NUMBER || '';
    let status = 'conectado';

    if (baseUrl && apiKey) {
      const cleanBaseUrl = baseUrl.replace(/\/$/, '');
      try {
        const response = await axios.get(`${cleanBaseUrl}/instance/fetchInstances`, {
          params: { instanceName },
          headers: { apikey: apiKey },
          timeout: 4000
        });

        const data = response.data;
        const instances = Array.isArray(data) ? data : [data?.instance || data];
        const inst = instances.find(i => i?.name === instanceName || i?.instanceName === instanceName) || instances[0];

        if (inst) {
          status = inst.connectionStatus || inst.state || inst.status || 'conectado';
          const ownerJid = inst.owner || inst.ownerJid || inst.number || inst.jid || inst.owner_jid || '';
          if (ownerJid) {
            const digits = ownerJid.replace(/\D/g, '');
            if (digits) rawNumber = digits;
          }
        }
      } catch (err) {
        console.warn('⚠️ Could not fetch instance status from Evolution API:', err.message);
      }
    }

    if (!rawNumber) {
      rawNumber = '557996018591'; // Fallback agent instance number
    }

    const formattedPhone = this.formatPhoneNumber(rawNumber);
    let displayNumber = formattedPhone;
    if (formattedPhone.length >= 12) {
      const ddi = formattedPhone.slice(0, 2);
      const ddd = formattedPhone.slice(2, 4);
      const part1 = formattedPhone.slice(4, 9);
      const part2 = formattedPhone.slice(9);
      displayNumber = `+${ddi} (${ddd}) ${part1}-${part2}`;
    }

    const defaultText = encodeURIComponent('Olá! Vim pelo Dashboard FinZap e gostaria de registrar minhas finanças.');
    const waLink = formattedPhone ? `https://wa.me/${formattedPhone}?text=${defaultText}` : '#';

    return {
      number: formattedPhone,
      displayNumber,
      waLink,
      status
    };
  }

  /**
   * Standardized method to send text messages via Evolution API Go.
   * Endpoint: POST /send/text
   * Body: { "number": "557996018591", "text": "Mensagem..." }
   * Header: apikey: <EVOLUTION_API_KEY or instanceToken>
   * 
   * @param {string} to - Recipient phone number
   * @param {string} message - Text message content
   * @param {string} instanceToken - Optional instance token from incoming webhook
   * @returns {Promise<boolean>} Success status
   */
  async sendMessage(to, message, instanceToken = null) {
    const { baseUrl, apiKey } = evolutionConfig;
    const activeKey = instanceToken || apiKey;

    if (!activeKey) {
      console.warn('⚠️ EVOLUTION_API_KEY is not defined in .env');
      return false;
    }

    const recipient = this.formatPhoneNumber(to);
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    const endpointUrl = `${cleanBaseUrl}/send/text`;

    try {
      console.log(`📱 [WhatsApp Outbound] Sending to ${recipient}...`);

      const response = await axios.post(
        endpointUrl,
        {
          number: recipient,
          text: message
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'apikey': activeKey
          },
          timeout: 10000
        }
      );

      if (response.status === 200 || response.data?.message === 'success') {
        console.log(`✅ [WhatsApp Outbound] Message successfully delivered to ${recipient}`);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`❌ [WhatsApp Outbound Error] Failed to send to ${recipient}:`, error.response?.data || error.message);
      return false;
    }
  }

  /**
   * Sends presence state (e.g. 'composing' / 'paused') via Evolution API Go
   */
  async sendPresence(to, presence = 'composing', instanceToken = null) {
    const { baseUrl, apiKey } = evolutionConfig;
    const activeKey = instanceToken || apiKey;
    if (!activeKey) return false;

    const recipient = this.formatPhoneNumber(to);
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    const endpointUrl = `${cleanBaseUrl}/message/presence`;

    try {
      console.log(`📱 [WhatsApp Presence] Setting state '${presence}' for ${recipient}...`);
      const response = await axios.post(
        endpointUrl,
        {
          number: recipient,
          state: presence
        },
        {
          headers: { 'Content-Type': 'application/json', 'apikey': activeKey },
          timeout: 4000
        }
      );

      if (response.status === 200 || response.data?.message === 'success') {
        console.log(`✅ [WhatsApp Presence OK] State '${presence}' set for ${recipient}`);
        return true;
      }
      return false;
    } catch (e) {
      console.warn(`⚠️ [WhatsApp Presence Error]:`, e.response?.data || e.message);
      return false;
    }
  }

  /**
   * Sends 'composing' (digitando...) presence state and pauses execution for specified duration (default 5000ms).
   */
  async sendTypingIndicator(to, durationMs = 5000, instanceToken = null) {
    await this.sendPresence(to, 'composing', instanceToken, durationMs);
    await new Promise((resolve) => setTimeout(resolve, durationMs));
  }

  /**
   * Standardized parser for incoming webhooks from Evolution API Go.
   * Extracts sender phone, text message, push name and instance token.
   * Strictly filters out fromMe messages.
   */
  parseWebhookPayload(body) {
    if (!body) return null;

    // 1. Strict check: Ignore messages sent by the instance itself (fromMe)
    const isFromMe =
      body.data?.key?.fromMe === true ||
      body.key?.fromMe === true ||
      body.data?.Info?.IsFromMe === true ||
      body.data?.Info?.fromMe === true ||
      body.fromMe === true;

    if (isFromMe) {
      console.log('🛑 [SECURITY] Ignored message sent by the instance itself (fromMe = true).');
      return null;
    }

    let senderPhone = null;
    let messageText = null;
    let pushName = 'Usuário';

    // Evolution API Go structure
    if (body.data) {
      const info = body.data.Info || {};
      const senderJid = info.Sender || info.Chat || '';
      senderPhone = senderJid.replace('@s.whatsapp.net', '').replace('@g.us', '').replace('@lid', '');
      pushName = info.PushName || 'Usuário';

      const msg = body.data.Message || {};
      messageText =
        msg.conversation ||
        msg.extendedTextMessage?.text ||
        msg.imageMessage?.caption ||
        msg.videoMessage?.caption ||
        msg.documentMessage?.caption ||
        null;
    }

    // Fallback standard structure
    if (!senderPhone) {
      const key = body.key || body.data?.key;
      if (key) {
        senderPhone = (key.remoteJid || '').replace('@s.whatsapp.net', '');
      }
      if (!senderPhone && body.sender) {
        senderPhone = body.sender.replace('@s.whatsapp.net', '');
      }

      pushName = body.pushName || body.data?.pushName || pushName;

      const msg = body.message || body.data?.message;
      if (msg) {
        messageText =
          msg.conversation ||
          msg.extendedTextMessage?.text ||
          msg.imageMessage?.caption ||
          msg.videoMessage?.caption ||
          null;
      }
    }

    if (!senderPhone || !messageText) {
      return null;
    }

    // Always format sender phone with DDI 55
    senderPhone = this.formatPhoneNumber(senderPhone);

    const messageId = body.data?.key?.id || body.key?.id || body.data?.Info?.ID || null;

    return {
      messageId,
      senderPhone,
      messageText,
      pushName,
      instanceName: body.instanceName || evolutionConfig.instanceName,
      instanceToken: body.instanceToken || null
    };
  }
}

module.exports = new WhatsappService();
