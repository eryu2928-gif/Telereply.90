import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { TelegramMtprotoManager } from './mtproto';
import { BusinessAgentEngine } from './gemini';
import { PersonalRule, Product, FaqItem, BusinessProfile, AutomationLog } from './types';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;
const telegramManager = new TelegramMtprotoManager();
const aiEngine = new BusinessAgentEngine(process.env.GEMINI_API_KEY);

// State in-memory cache for fast worker matching
let appMode: 'PERSONAL' | 'BUSINESS' = 'PERSONAL';
let isAutomationEnabled: boolean = true;
let isAutomationPaused: boolean = false;
let cooldownSeconds: number = 30;

let personalRules: PersonalRule[] = [];
let businessProfile: BusinessProfile = {
  shopName: 'Telereply Store BD',
  category: 'Retail & Fashion',
  description: 'Premium store offering fashion, footwear, and teas.',
  productsServices: 'Apparel, Shoes, Green Tea',
  supportLanguage: 'Bangla & English',
  location: 'Dhaka, Bangladesh',
  supportHours: '10 AM - 10 PM',
  deliveryRegions: 'Inside & Outside Dhaka',
  deliveryCharges: '৳60 inside Dhaka, ৳120 outside Dhaka',
  estimatedDeliveryTimes: '1-3 days',
  acceptedPaymentMethods: 'bKash, Nagad, COD',
  returnPolicy: '7 days return',
  exchangePolicy: '3 days exchange',
  warrantyPolicy: 'Genuine guarantee',
  contactDetails: '+8801700000000',
  customInstructions: 'Be polite and helpful in Bangla or English.',
};
let productsCatalog: Product[] = [];
let faqsList: FaqItem[] = [];

// Cooldown tracker: map of `${chatId}_${ruleId}` -> timestamp
const lastReplyTimestamps = new Map<string, number>();
const activityLogs: AutomationLog[] = [];

// Setup incoming MTProto event listener
telegramManager.setIncomingCallback(async (event) => {
  if (!isAutomationEnabled || isAutomationPaused) {
    return;
  }

  const now = Date.now();
  const { senderId, senderName, text, isGroup } = event;

  // Rate-limiting / loop prevention check per chat
  const lastChatReply = lastReplyTimestamps.get(senderId) || 0;
  if (now - lastChatReply < cooldownSeconds * 1000) {
    console.log(`[Cooldown] Suppressed response to ${senderId} (${(now - lastChatReply) / 1000}s ago)`);
    return;
  }

  try {
    if (appMode === 'PERSONAL') {
      // Find matching personal rule
      for (const rule of personalRules) {
        if (!rule.isEnabled) continue;
        if (rule.allowedChatScope === 'PRIVATE_ONLY' && isGroup) continue;
        if (rule.allowedChatScope === 'GROUPS_ONLY' && !isGroup) continue;

        let isMatch = false;
        if (rule.isExactMatch) {
          isMatch = rule.isCaseSensitive
            ? text.trim() === rule.triggerKeyword.trim()
            : text.trim().toLowerCase() === rule.triggerKeyword.trim().toLowerCase();
        } else {
          isMatch = rule.isCaseSensitive
            ? text.includes(rule.triggerKeyword)
            : text.toLowerCase().includes(rule.triggerKeyword.toLowerCase());
        }

        if (isMatch) {
          await telegramManager.sendMessage(senderId, rule.responseText);
          lastReplyTimestamps.set(senderId, now);

          const log: AutomationLog = {
            id: `log_${Date.now()}`,
            timestamp: now,
            senderName,
            senderChatId: senderId,
            incomingMessage: text,
            replyMessage: rule.responseText,
            mode: 'PERSONAL',
            status: 'SENT',
            details: `Matched keyword: "${rule.triggerKeyword}"`,
          };
          activityLogs.unshift(log);
          if (activityLogs.length > 200) activityLogs.pop();
          break;
        }
      }
    } else {
      // BUSINESS MODE: AI Agent + Catalog Grounded
      const agentResult = await aiEngine.generateBusinessReply(
        senderId,
        text,
        businessProfile,
        productsCatalog,
        faqsList
      );

      const firstImage = agentResult.imageUrls[0];
      await telegramManager.sendMessage(senderId, agentResult.replyText, firstImage);
      lastReplyTimestamps.set(senderId, now);

      const log: AutomationLog = {
        id: `log_${Date.now()}`,
        timestamp: now,
        senderName,
        senderChatId: senderId,
        incomingMessage: text,
        replyMessage: agentResult.replyText,
        mode: 'BUSINESS',
        status: 'SENT',
        details: agentResult.humanEscalated ? 'Escalated to human' : 'AI generated reply',
      };
      activityLogs.unshift(log);
      if (activityLogs.length > 200) activityLogs.pop();
    }
  } catch (err: any) {
    console.error('Error handling incoming MTProto message:', err);
    activityLogs.unshift({
      id: `log_${Date.now()}`,
      timestamp: now,
      senderName,
      senderChatId: senderId,
      incomingMessage: text,
      replyMessage: '',
      mode: appMode,
      status: 'FAILED',
      details: err.message || 'Delivery error',
    });
  }
});

// --- REST API ENDPOINTS ---

// Health & Status
app.get(['/health', '/'], (req: Request, res: Response) => {
  const isConfigured = telegramManager.isConfigured();
  res.json({
    status: 'ok',
    service: 'Telereply MTProto Automation Server',
    telegramApiConfigured: isConfigured,
    timestamp: Date.now()
  });
});

app.get('/api/status', (req: Request, res: Response) => {
  const isConfigured = telegramManager.isConfigured();
  res.json({
    status: 'ok',
    telegramApiConfigured: isConfigured,
    configMessage: isConfigured
      ? 'Telegram MTProto API configured.'
      : 'TELEGRAM_API_ID and TELEGRAM_API_HASH are missing. Please configure them in your backend environment variables from https://my.telegram.org.',
    appMode,
    isAutomationEnabled,
    isAutomationPaused,
    cooldownSeconds,
    telegramAuth: telegramManager.getAuthState(),
    rulesCount: personalRules.length,
    productsCount: productsCatalog.length,
    faqsCount: faqsList.length,
  });
});

// Telegram MTProto Auth: Request Code
app.post('/api/auth/send-code', async (req: Request, res: Response) => {
  const { phoneNumber } = req.body;
  if (!phoneNumber) {
    return res.status(400).json({ error: 'Phone number is required' });
  }

  try {
    const authState = await telegramManager.requestVerificationCode(phoneNumber);
    res.json(authState);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to send code' });
  }
});

// Telegram MTProto Auth: Sign In with Code
app.post('/api/auth/sign-in', async (req: Request, res: Response) => {
  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ error: 'Code is required' });
  }

  try {
    const authState = await telegramManager.signInWithCode(code);
    res.json(authState);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Sign in failed' });
  }
});

// Telegram MTProto Auth: 2FA Password
app.post('/api/auth/2fa', async (req: Request, res: Response) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ error: 'Password is required' });
  }

  try {
    const authState = await telegramManager.signInWith2FaPassword(password);
    res.json(authState);
  } catch (err: any) {
    res.status(400).json({ error: err.message || '2FA authentication failed' });
  }
});

// Disconnect
app.post('/api/auth/disconnect', async (req: Request, res: Response) => {
  await telegramManager.disconnect();
  res.json({ success: true, message: 'Disconnected successfully' });
});

// Sync Rules from Android Client
app.post('/api/automation/sync-rules', (req: Request, res: Response) => {
  const { rules } = req.body;
  if (Array.isArray(rules)) {
    personalRules = rules;
  }
  res.json({ success: true, count: personalRules.length });
});

// Sync Business Catalog & FAQs from Android Client
app.post('/api/automation/sync-business', (req: Request, res: Response) => {
  const { profile, products, faqs } = req.body;
  if (profile) businessProfile = profile;
  if (Array.isArray(products)) productsCatalog = products;
  if (Array.isArray(faqs)) faqsList = faqs;
  res.json({ success: true, productsCount: productsCatalog.length, faqsCount: faqsList.length });
});

// Toggle Automation Mode / State
app.post('/api/automation/config', (req: Request, res: Response) => {
  const { mode, enabled, paused, cooldown } = req.body;
  if (mode === 'PERSONAL' || mode === 'BUSINESS') appMode = mode;
  if (typeof enabled === 'boolean') isAutomationEnabled = enabled;
  if (typeof paused === 'boolean') isAutomationPaused = paused;
  if (typeof cooldown === 'number') cooldownSeconds = cooldown;
  res.json({ appMode, isAutomationEnabled, isAutomationPaused, cooldownSeconds });
});

// Activity Logs
app.get('/api/logs', (req: Request, res: Response) => {
  res.json(activityLogs);
});

// Direct test simulator endpoint (for verifying query processing)
app.post('/api/test-message', async (req: Request, res: Response) => {
  const { message, senderName = 'Test User' } = req.body;
  if (!message) return res.status(400).json({ error: 'Message is required' });

  if (appMode === 'PERSONAL') {
    for (const rule of personalRules) {
      if (!rule.isEnabled) continue;
      const isMatch = rule.isExactMatch
        ? rule.isCaseSensitive
          ? message.trim() === rule.triggerKeyword.trim()
          : message.trim().toLowerCase() === rule.triggerKeyword.trim().toLowerCase()
        : rule.isCaseSensitive
        ? message.includes(rule.triggerKeyword)
        : message.toLowerCase().includes(rule.triggerKeyword.toLowerCase());

      if (isMatch) {
        return res.json({
          reply: rule.responseText,
          matchedRule: rule.triggerKeyword,
          mode: 'PERSONAL',
        });
      }
    }
    return res.json({ reply: null, reason: 'No matching personal rule found', mode: 'PERSONAL' });
  } else {
    const result = await aiEngine.generateBusinessReply('test_chat', message, businessProfile, productsCatalog, faqsList);
    return res.json({
      reply: result.replyText,
      imageUrls: result.imageUrls,
      humanEscalated: result.humanEscalated,
      mode: 'BUSINESS',
    });
  }
});

app.listen(PORT, () => {
  console.log(`Telereply MTProto Automation Server running on port ${PORT}`);
});
