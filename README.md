# Telereply Persistent MTProto Backend & AI Business Agent

This service handles the official Telegram MTProto user-account automation and the Gemini-powered AI Business Agent.

## Architecture

- **Personal MTProto Client**: Authenticates via Telegram MTProto (`telegram` GramJS package). Outbound replies are sent from the user's own Telegram account—**never a bot**.
- **Gemini AI Business Agent**: Grounded in the merchant's live catalog, policies, and FAQs with multilingual Bangla/English support.
- **REST & Live Event API**: Manages authentication, 2FA, session persistence, rule synchronization, and real-time logs.

## Setup Instructions

1. **Obtain Telegram API Credentials**:
   - Go to [https://my.telegram.org](https://my.telegram.org)
   - Log in with your personal phone number.
   - Go to "API development tools" and obtain your `api_id` and `api_hash`.
2. **Configure Environment Variables**:
   ```bash
   cp .env.example .env
   # Edit .env with your TELEGRAM_API_ID, TELEGRAM_API_HASH, and GEMINI_API_KEY
   ```
3. **Install Dependencies & Build**:
   ```bash
   npm install
   npm run build
   npm start
   ```
4. **Deploying to Cloud (e.g. Render, Railway, DigitalOcean, or Google Cloud Run)**:
   - Build using the provided `Dockerfile`.
   - Set environment variables in your hosting provider's dashboard.
   - Enter your public backend URL in the Telereply Android App Settings screen.
