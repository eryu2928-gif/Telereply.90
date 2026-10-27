export interface TelegramAuthState {
  phoneNumber: string;
  phoneCodeHash: string;
  isCodeSent: boolean;
  is2faRequired: boolean;
  isAuthenticated: boolean;
  userId?: string;
  username?: string;
  firstName?: string;
  sessionString?: string;
  error?: string;
}

export interface PersonalRule {
  id: number;
  triggerKeyword: string;
  responseText: string;
  isExactMatch: boolean;
  isCaseSensitive: boolean;
  isEnabled: boolean;
  cooldownSeconds: number;
  allowedChatScope: string;
}

export interface Product {
  id: number;
  productId: string;
  title: string;
  sku: string;
  description: string;
  categoryName: string;
  brand: string;
  currentPrice: number;
  originalPrice: number;
  discountAmount: number;
  discountPercent: number;
  currency: string;
  imageUrls: string[];
  colors: string[];
  sizes: string[];
  materials: string;
  specifications: string;
  stockQuantity: number;
  isAvailable: boolean;
  searchKeywords: string;
  alternativeNames: string;
}

export interface FaqItem {
  question: string;
  answer: string;
  keywords: string;
  priority: number;
}

export interface BusinessProfile {
  shopName: string;
  category: string;
  description: string;
  productsServices: string;
  supportLanguage: string;
  location: string;
  supportHours: string;
  deliveryRegions: string;
  deliveryCharges: string;
  estimatedDeliveryTimes: string;
  acceptedPaymentMethods: string;
  returnPolicy: string;
  exchangePolicy: string;
  warrantyPolicy: string;
  contactDetails: string;
  customInstructions: string;
}

export interface AutomationLog {
  id: string;
  timestamp: number;
  senderName: string;
  senderChatId: string;
  incomingMessage: string;
  replyMessage: string;
  mode: 'PERSONAL' | 'BUSINESS';
  status: 'SENT' | 'FAILED' | 'SKIPPED' | 'COOLDOWN';
  details: string;
}
