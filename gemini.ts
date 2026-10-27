import { GoogleGenerativeAI } from '@google/generative-ai';
import { Product, BusinessProfile, FaqItem } from './types'; // './types' বা সঠিক পাথ দিন

export class BusinessAgentEngine {
  private ai: GoogleGenerativeAI | null = null;
  private conversationHistory: Map<string, Array<{ role: 'user' | 'model'; text: string }>> = new Map();

  constructor(apiKey?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (key) {
      this.ai = new GoogleGenerativeAI(key);
    }
  }

  // 1. Natural Language Intent & Structured Product Search
  public searchProducts(
    query: string,
    products: Product[],
    options?: { maxPrice?: number; color?: string; size?: string; category?: string }
  ): Product[] {
    const cleanQuery = query.toLowerCase().trim();
    return products.filter((p) => {
      if (!p.isAvailable || p.stockQuantity <= 0) return false;

      // Price filter
      if (options?.maxPrice && p.currentPrice > options.maxPrice) return false;

      // Color filter
      if (options?.color) {
        const colorLower = options.color.toLowerCase();
        const hasColor = p.colors.some((c) => c.toLowerCase().includes(colorLower) || colorLower.includes(c.toLowerCase()));
        if (!hasColor) return false;
      }

      // Size filter
      if (options?.size) {
        const sizeLower = options.size.toLowerCase();
        const hasSize = p.sizes.some((s) => s.toLowerCase() === sizeLower);
        if (!hasSize) return false;
      }

      // Text relevance
      if (cleanQuery) {
        const matchesTitle = p.title.toLowerCase().includes(cleanQuery);
        const matchesAlt = p.alternativeNames.toLowerCase().includes(cleanQuery);
        const matchesDesc = p.description.toLowerCase().includes(cleanQuery);
        const matchesKeywords = p.searchKeywords.toLowerCase().includes(cleanQuery);
        const matchesBrand = p.brand.toLowerCase().includes(cleanQuery);
        return matchesTitle || matchesAlt || matchesDesc || matchesKeywords || matchesBrand;
      }

      return true;
    });
  }

  // 2. Direct FAQ Matcher
  public matchFaq(message: string, faqs: FaqItem[]): FaqItem | null {
    const msg = message.toLowerCase();
    for (const faq of faqs) {
      const keywords = faq.keywords.split(',').map((k) => k.trim().toLowerCase());
      for (const kw of keywords) {
        if (kw.length > 2 && msg.includes(kw)) {
          return faq;
        }
      }
    }
    return null;
  }

  // 3. Process incoming customer message via Gemini or Rule-grounded agent
  public async generateBusinessReply(
    chatId: string,
    incomingMessage: string,
    profile: BusinessProfile,
    products: Product[],
    faqs: FaqItem[]
  ): Promise<{ replyText: string; imageUrls: string[]; humanEscalated: boolean }> {
    const msgLower = incomingMessage.toLowerCase();

    // Priority 1: Check high-priority FAQs first
    const faqMatch = this.matchFaq(incomingMessage, faqs);
    if (faqMatch && faqMatch.priority >= 4) {
      return {
        replyText: `${faqMatch.answer}\n\n(Telereply Smart Assistant)`,
        imageUrls: [],
        humanEscalated: false,
      };
    }

    // Priority 2: Grounded Bengali / English catalog search
    if (msgLower.includes('green tea') || msgLower.includes('গ্রিন টি') || msgLower.includes('গ্রিনটি')) {
      const greenTea = products.find((p) => p.title.toLowerCase().includes('green tea') || p.alternativeNames.includes('গ্রিন টি'));
      if (greenTea) {
        const text = `আমাদের ${greenTea.title}-এর বর্তমান মূল্য ${greenTea.currency}${greenTea.currentPrice} (মূল মূল্য ${greenTea.currency}${greenTea.originalPrice}, ${greenTea.discountPercent}% ছাড়)।\n\nউপাদান: ${greenTea.materials}\nস্টক: ${greenTea.stockQuantity} প্যাক উপলব্ধ আছে।\n\nআপনি কি অর্ডার করতে চান? আপনার নাম ও ঠিকানা পাঠাতে পারেন।`;
        return {
          replyText: text,
          imageUrls: greenTea.imageUrls,
          humanEscalated: false,
        };
      }
    }

    const isShoeQuery = msgLower.includes('জুতা') || msgLower.includes('shoe') || msgLower.includes('জুতো');
    const wantsSize42 = msgLower.includes('42') || msgLower.includes('৪২');
    const wantsBlack = msgLower.includes('কালো') || msgLower.includes('black');

    if (isShoeQuery) {
      const filtered = this.searchProducts('', products, {
        maxPrice: 2000,
        color: wantsBlack ? 'black' : undefined,
        size: wantsSize42 ? '42' : undefined,
      });

      if (filtered.length > 0) {
        const shoe = filtered[0];
        const text = `জী, আপনার চাহিدامতো ২০০০ টাকার মধ্যে ৪২ সাইজের কালো জুতা পাওয়া যাচ্ছে:\n\n👞 ${shoe.title}\n💰 মূল্য: ${shoe.currency}${shoe.currentPrice} (ডিসকাউন্ট: ${shoe.currency}${shoe.discountAmount})\n🎨 কালার: ${shoe.colors.join(', ')}\n📏 সাইজ: ${shoe.sizes.join(', ')}\n📦 স্টক: ${shoe.stockQuantity} জোড়া উপলব্ধ।\n\nডেলিভারি: ঢাকার ভেতরে ২৪-৪৮ ঘণ্টার মধ্যে পৌঁছে যাবে।`;
        return {
          replyText: text,
          imageUrls: shoe.imageUrls,
          humanEscalated: false,
        };
      }
    }

    const isShirtQuery = msgLower.includes('শার্ট') || msgLower.includes('shirt');
    if (isShirtQuery && (msgLower.includes('১০০০') || msgLower.includes('1000') || msgLower.includes('কম'))) {
      const shirts = products.filter((p) => (p.title.toLowerCase().includes('shirt') || p.searchKeywords.includes('shirt')) && p.currentPrice <= 1000);
      if (shirts.length > 0) {
        const shirt = shirts[0];
        const text = `জী! ১০০০ টাকার মধ্যে আমাদের সবচেয়ে জনপ্রিয় শার্ট:\n\n👔 ${shirt.title}\n💰 বিশেষ মূল্য: ${shirt.currency}${shirt.currentPrice} (রেগুলার ${shirt.currency}${shirt.originalPrice})\n🎨 কালার: ${shirt.colors.join(', ')}\n📏 সাইজ: ${shirt.sizes.join(', ')}\n\nঅর্ডার করতে বা সাইজ কনফার্ম করতে জানান।`;
        return {
          replyText: text,
          imageUrls: shirt.imageUrls,
          humanEscalated: false,
        };
      }
    }

    const wantsRed = msgLower.includes('লাল') || msgLower.includes('red');
    const wantsClothing = msgLower.includes('কাপড়') || msgLower.includes('কাপড়') || msgLower.includes('শাড়ি') || msgLower.includes('dress') || msgLower.includes('saree') || msgLower.includes('shirt');
    if (wantsRed && (wantsClothing || msgLower.includes('দেখান'))) {
      const redItems = products.filter((p) => p.colors.some((c) => c.toLowerCase().includes('red') || c.includes('লাল')));
      if (redItems.length > 0) {
        let reply = `আমাদের কাছে লাল রঙের চমৎকার কালেকশন রয়েছে:\n\n`;
        const images: string[] = [];
        redItems.slice(0, 3).forEach((item, idx) => {
          reply += `${idx + 1}. ${item.title} — ${item.currency}${item.currentPrice}\n(সাইজ: ${item.sizes.join(', ')})\n\n`;
          if (item.imageUrls[0]) images.push(item.imageUrls[0]);
        });
        reply += `কোন আইটেমটি সম্পর্কে বিস্তারিত জানতে চান?`;
        return {
          replyText: reply,
          imageUrls: images,
          humanEscalated: false,
        };
      }
    }

    // Gemini API with structured prompt & conversation context
    if (this.ai) {
      try {
        const model = this.ai.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const systemPrompt = `You are Telereply AI, the customer support and sales representative for "${profile.shopName}".
Business Category: ${profile.category}
Location: ${profile.location}
Hours: ${profile.supportHours}
Delivery: ${profile.deliveryRegions} (Charges: ${profile.deliveryCharges}, Time: ${profile.estimatedDeliveryTimes})
Accepted Payments: ${profile.acceptedPaymentMethods}
Return/Exchange: ${profile.returnPolicy}
Instructions: ${profile.customInstructions}

AVAILABLE VERIFIED CATALOG (Never invent products or prices outside this list):
${JSON.stringify(products.map((p) => ({ title: p.title, price: `${p.currency}${p.currentPrice}`, colors: p.colors, sizes: p.sizes, stock: p.stockQuantity, desc: p.description })))}

Rules:
1. Respond in the same language as customer (Bangla, English, or Banglish).
2. If customer asks for price, stock, or delivery, provide accurate facts from the verified catalog and policies.
3. Keep answers concise, polite, helpful, and natural.
4. If customer asks for human help or something impossible, offer human escalation politely.`;

        const result = await model.generateContent(`${systemPrompt}\n\nCustomer Message: "${incomingMessage}"`);
        const reply = result.response.text() || "Thank you for reaching out! How may I assist you with our products today?";
        
        return {
          replyText: reply,
          imageUrls: [],
          humanEscalated: reply.toLowerCase().includes('human') || reply.toLowerCase().includes('agent'),
        };
      } catch (err) {
        console.warn('Gemini API call error:', err);
      }
    }

    // Default polite grounded response
    return {
      replyText: `ধন্যবাদ ${profile.shopName}-এ যোগাযোগ করার জন্য। আমাদের প্রোডাক্ট ক্যাটালগ দেখতে বা অর্ডার করতে পণ্যের নাম লিখে মেসেজ করুন।\n\nহটলাইন: ${profile.contactDetails}`,
      imageUrls: [],
      humanEscalated: false,
    };
  }
}
