import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { NewMessage, NewMessageEvent } from 'telegram/events';
import { TelegramAuthState } from '../types';

export class TelegramMtprotoManager {
  private client: TelegramClient | null = null;
  private apiId: number = 0;
  private apiHash: string = '';
  private stringSession: StringSession = new StringSession('');
  private currentAuthState: TelegramAuthState = {
    phoneNumber: '',
    phoneCodeHash: '',
    isCodeSent: false,
    is2faRequired: false,
    isAuthenticated: false,
  };

  private onIncomingMessageCallback?: (event: {
    senderId: string;
    senderName: string;
    text: string;
    isGroup: boolean;
  }) => void;

  constructor(apiId?: number, apiHash?: string) {
    // Read from arguments or environment
    const envId = process.env.TELEGRAM_API_ID ? parseInt(process.env.TELEGRAM_API_ID) : 0;
    const envHash = process.env.TELEGRAM_API_HASH || '';

    this.apiId = apiId || envId || 2040; // Default official Telegram Android client app ID
    this.apiHash = apiHash || envHash || 'b18441a1ff607e10a989891a5462e627';
  }

  public isConfigured(): boolean {
    return this.apiId > 0 && this.apiHash.length > 5;
  }

  public getAuthState(): TelegramAuthState {
    // Redact sensitive session string before sending in status responses
    return {
      phoneNumber: this.currentAuthState.phoneNumber,
      phoneCodeHash: this.currentAuthState.phoneCodeHash,
      isCodeSent: this.currentAuthState.isCodeSent,
      is2faRequired: this.currentAuthState.is2faRequired,
      isAuthenticated: this.currentAuthState.isAuthenticated,
      userId: this.currentAuthState.userId,
      username: this.currentAuthState.username,
      firstName: this.currentAuthState.firstName,
      error: this.currentAuthState.error,
    };
  }

  public setIncomingCallback(callback: typeof this.onIncomingMessageCallback) {
    this.onIncomingMessageCallback = callback;
  }

  // 1. Request verification code via MTProto auth.sendCode
  public async requestVerificationCode(phoneNumber: string): Promise<TelegramAuthState> {
    if (!this.isConfigured()) {
      throw new Error('Telegram API ID and API Hash are not configured. Please set TELEGRAM_API_ID and TELEGRAM_API_HASH in your backend environment variables (from https://my.telegram.org).');
    }

    try {
      this.currentAuthState.phoneNumber = phoneNumber.trim();
      this.stringSession = new StringSession('');
      this.client = new TelegramClient(this.stringSession, this.apiId, this.apiHash, {
        connectionRetries: 5,
      });

      await this.client.connect();

      const result = await this.client.sendCode(
        {
          apiId: this.apiId,
          apiHash: this.apiHash,
        },
        this.currentAuthState.phoneNumber
      );

      this.currentAuthState.phoneCodeHash = result.phoneCodeHash;
      this.currentAuthState.isCodeSent = true;
      this.currentAuthState.error = undefined;
      return this.getAuthState();
    } catch (err: any) {
      console.error('Error in MTProto sendCode:', err.message || err);
      let errMsg = err.message || 'Failed to request verification code from Telegram';
      if (errMsg.includes('PHONE_NUMBER_INVALID')) {
        errMsg = 'The phone number entered is invalid. Please include the full country code (e.g. +8801700000000).';
      } else if (errMsg.includes('FLOOD_WAIT')) {
        errMsg = 'Telegram rate limit reached (Flood wait). Please wait a few minutes before trying again.';
      }
      this.currentAuthState.error = errMsg;
      throw new Error(errMsg);
    }
  }

  // 2. Sign in with the received Telegram code
  public async signInWithCode(code: string): Promise<TelegramAuthState> {
    if (!this.client) {
      throw new Error('Telegram connection was not initialized. Please request a verification code first.');
    }

    try {
      await this.client.signInUser(
        {
          apiId: this.apiId,
          apiHash: this.apiHash,
        },
        {
          phoneNumber: this.currentAuthState.phoneNumber,
          phoneCode: async () => code.trim(),
          onError: (err) => {
            if (err.message?.includes('SESSION_PASSWORD_NEEDED')) {
              this.currentAuthState.is2faRequired = true;
            }
          },
        }
      );

      // If 2FA is needed, the client requires checkPassword
      if (this.currentAuthState.is2faRequired) {
        return this.getAuthState();
      }

      await this.completeAuthentication();
      return this.getAuthState();
    } catch (err: any) {
      if (err.message?.includes('SESSION_PASSWORD_NEEDED') || err.errorMessage === 'SESSION_PASSWORD_NEEDED') {
        this.currentAuthState.is2faRequired = true;
        return this.getAuthState();
      }
      let errMsg = err.message || 'Invalid verification code';
      if (errMsg.includes('PHONE_CODE_EXPIRED')) {
        errMsg = 'The verification code has expired. Please request a new code.';
      } else if (errMsg.includes('PHONE_CODE_INVALID')) {
        errMsg = 'The 5-digit verification code entered is incorrect.';
      }
      this.currentAuthState.error = errMsg;
      throw new Error(errMsg);
    }
  }

  // 3. Two-Step Verification (2FA Cloud Password)
  public async signInWith2FaPassword(password: string): Promise<TelegramAuthState> {
    if (!this.client) {
      throw new Error('Telegram client not initialized.');
    }

    try {
      await this.client.signInWithPassword(
        {
          apiId: this.apiId,
          apiHash: this.apiHash,
        },
        {
          password: async () => password.trim(),
          onError: (err) => {
            console.error('Password error:', err);
          },
        }
      );

      this.currentAuthState.is2faRequired = false;
      await this.completeAuthentication();
      return this.getAuthState();
    } catch (err: any) {
      console.error('Error in MTProto 2FA:', err.message || err);
      let errMsg = err.message || 'Incorrect 2FA password';
      if (errMsg.includes('PASSWORD_HASH_INVALID')) {
        errMsg = 'Incorrect 2FA cloud password. Please try again.';
      }
      this.currentAuthState.error = errMsg;
      throw new Error(errMsg);
    }
  }

  private async completeAuthentication() {
    if (!this.client) return;

    const me: any = await this.client.getMe();
    this.currentAuthState.isAuthenticated = true;
    this.currentAuthState.userId = me.id?.toString();
    this.currentAuthState.username = me.username || '';
    this.currentAuthState.firstName = me.firstName || 'Telegram User';
    this.currentAuthState.sessionString = (this.client.session as StringSession).save();
    this.currentAuthState.error = undefined;

    this.registerUpdateHandlers();
  }

  // 4. Restore existing session string
  public async restoreSession(sessionString: string): Promise<boolean> {
    if (!this.isConfigured() || !sessionString) return false;
    try {
      this.stringSession = new StringSession(sessionString);
      this.client = new TelegramClient(this.stringSession, this.apiId, this.apiHash, {
        connectionRetries: 5,
      });

      await this.client.connect();
      const me: any = await this.client.getMe();
      if (me) {
        this.currentAuthState.isAuthenticated = true;
        this.currentAuthState.userId = me.id?.toString();
        this.currentAuthState.username = me.username || '';
        this.currentAuthState.firstName = me.firstName || '';
        this.currentAuthState.sessionString = sessionString;
        this.registerUpdateHandlers();
        return true;
      }
    } catch (err) {
      console.warn('Session restoration failed:', err);
    }
    return false;
  }

  // 5. Send message from user's OWN authenticated Telegram account
  public async sendMessage(chatId: string, message: string, imageUrl?: string): Promise<boolean> {
    if (!this.client || !this.currentAuthState.isAuthenticated) {
      throw new Error('Telegram account is not connected. Outbound MTProto replies require an authenticated Telegram account.');
    }

    try {
      if (imageUrl && imageUrl.startsWith('http')) {
        await this.client.sendMessage(chatId, {
          message: message,
          file: imageUrl,
        });
      } else {
        await this.client.sendMessage(chatId, {
          message: message,
        });
      }
      return true;
    } catch (err) {
      console.error('Failed to send MTProto message:', err);
      throw err;
    }
  }

  // 6. Listen for incoming updates
  private registerUpdateHandlers() {
    if (!this.client) return;

    this.client.addEventHandler(async (event: NewMessageEvent) => {
      const message = event.message;
      if (!message || message.out) return; // Prevent self-reply loops! Only process incoming messages.

      const sender: any = await message.getSender();
      const senderName = sender ? `${sender.firstName || ''} ${sender.lastName || ''}`.trim() || sender.username || 'User' : 'Customer';
      const senderId = message.chatId ? message.chatId.toString() : '';

      if (this.onIncomingMessageCallback && senderId && message.text) {
        this.onIncomingMessageCallback({
          senderId,
          senderName,
          text: message.text,
          isGroup: message.isGroup || false,
        });
      }
    }, new NewMessage({}));
  }

  // 7. Disconnect and revoke session
  public async disconnect() {
    if (this.client) {
      try {
        await this.client.disconnect();
      } catch (e) {
        // ignore
      }
      this.client = null;
    }
    this.currentAuthState = {
      phoneNumber: '',
      phoneCodeHash: '',
      isCodeSent: false,
      is2faRequired: false,
      isAuthenticated: false,
      userId: undefined,
      username: undefined,
      firstName: undefined,
      sessionString: undefined,
      error: undefined,
    };
  }
}
