# SubScout

A subscription and trial reminder service that monitors your Gmail inbox, uses AI to detect subscription signups, and creates Google Calendar reminders before renewal dates.

## Quick Start (View the App Locally)

```bash
cd /Users/sudhanshubaluja10/Desktop/side-projects/subscout
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

**Note:** Without environment variables configured, you'll see the landing page but won't be able to sign in.

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server at localhost:3000 |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run db:generate` | Generate database migrations |
| `npm run db:push` | Push schema changes to database |
| `npm run db:studio` | Open Drizzle Studio (database GUI) |

## Full Setup (Required for Sign-in to Work)

### Step 1: Set up environment file
```bash
cp .env.example .env.local
```

### Step 2: Google Cloud Console

Go to [console.cloud.google.com](https://console.cloud.google.com):

1. **Create a new project** named "SubScout"

2. **Enable APIs** (APIs & Services > Library):
   - Gmail API
   - Google Calendar API
   - Cloud Pub/Sub API

3. **Configure OAuth Consent Screen** (APIs & Services > OAuth consent screen):
   - User Type: External
   - App name: SubScout
   - Add scopes:
     - `.../auth/gmail.readonly`
     - `.../auth/calendar.events`
     - `.../auth/userinfo.email`
     - `.../auth/userinfo.profile`
   - Add your email as a test user

4. **Create OAuth Credentials** (APIs & Services > Credentials > Create Credentials > OAuth client ID):
   - Application type: Web application
   - Authorized redirect URIs:
     - `http://localhost:3000/api/auth/callback/google`
   - Copy **Client ID** and **Client Secret** to `.env.local`

5. **Set up Pub/Sub** (Pub/Sub > Create Topic):
   - Topic name: `subscout-gmail`
   - Create a push subscription pointing to `/api/webhooks/gmail?token=YOUR_TOKEN`
   - Grant `gmail-api-push@system.gserviceaccount.com` Publisher role

### Step 3: Vercel Postgres

1. Create account at [vercel.com](https://vercel.com)
2. Create a new project
3. Go to Storage > Create Database > Postgres
4. Copy connection strings to `.env.local`

### Step 4: Anthropic API

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create an API key
3. Add to `.env.local`

### Step 5: Generate secrets
```bash
# Generate AUTH_SECRET
openssl rand -base64 32

# Generate PUBSUB_VERIFICATION_TOKEN
openssl rand -hex 16

# Generate CRON_SECRET
openssl rand -hex 16
```

### Step 6: Push database schema
```bash
npm run db:push
```

### Step 7: Run the app
```bash
npm run dev
```

## Environment Variables Reference

```env
# Google OAuth
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxx

# Anthropic
ANTHROPIC_API_KEY=sk-ant-xxx

# NextAuth
AUTH_SECRET=random-32-char-string
AUTH_URL=http://localhost:3000

# Database
DATABASE_URL=postgres://...
POSTGRES_URL=postgres://...

# Pub/Sub
GCP_PROJECT_ID=your-project-id
PUBSUB_VERIFICATION_TOKEN=random-token

# Cron
CRON_SECRET=random-secret
```

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── auth/[...nextauth]/   # Google OAuth
│   │   ├── cron/renew-watches/   # Daily Gmail watch renewal
│   │   ├── settings/             # User settings API
│   │   ├── subscriptions/[id]/   # Subscription CRUD
│   │   └── webhooks/gmail/       # Gmail push notifications
│   ├── dashboard/                # Main dashboard
│   ├── settings/                 # Settings page
│   ├── signin/                   # Sign in page
│   └── page.tsx                  # Landing page
├── components/                   # React components
├── lib/
│   ├── db/                       # Database schema
│   └── services/                 # Gmail, Claude, Calendar services
└── types/                        # TypeScript types
```

## How It Works

1. User signs in with Google (grants Gmail + Calendar access)
2. App sets up Gmail push notifications for inbox
3. When new email arrives, Gmail sends notification to webhook
4. Webhook fetches email and sends to Claude for classification
5. If subscription/trial detected, creates Google Calendar reminder
6. User sees tracked subscriptions in dashboard

## Deployment

1. Push to GitHub
2. Import in Vercel
3. Add environment variables
4. Deploy

The cron job at `/api/cron/renew-watches` runs daily to keep Gmail monitoring active.
