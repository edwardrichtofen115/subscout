# SubScout

A subscription and trial reminder service that monitors your Gmail inbox, uses AI to detect subscription signups, and creates Google Calendar reminders before renewal dates.

## Quick Start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

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
