# SubScout - Claude Instructions

This file contains project-specific context and instructions for Claude when working on this codebase.

## Project Overview

SubScout is a subscription and trial reminder service that:
- Monitors Gmail inboxes for subscription signups and trial activations
- Uses Claude AI (Anthropic API) to classify emails
- Creates Google Calendar reminders before renewal/expiration dates
- Provides a dashboard to view and manage tracked subscriptions

## Tech Stack

- **Framework**: Next.js 14 (App Router, React Server Components)
- **Language**: TypeScript
- **Database**: Vercel Postgres with Drizzle ORM
- **Authentication**: NextAuth.js v5 with Google OAuth
- **Styling**: Tailwind CSS v4 + shadcn/ui components
- **AI**: Claude API (Anthropic SDK) for email classification
- **External APIs**: Gmail API, Google Calendar API, Google Pub/Sub

## Key Architecture Decisions

### Authentication & OAuth
- Uses NextAuth v5 (beta) with Google OAuth provider
- Requests offline access to Gmail (readonly) and Calendar (events)
- Stores access/refresh tokens in database for background processing
- Tokens are used by services to access Gmail/Calendar on behalf of users

### Email Monitoring
- Gmail Push Notifications via Google Pub/Sub (not polling)
- Gmail watch expires after 7 days → daily cron job renews watches
- Webhook endpoint at `/api/webhooks/gmail` receives push notifications
- History API used to fetch only new messages since last notification

### Email Classification
- Claude Sonnet 4 analyzes email subject, sender, and body
- Returns structured JSON with service name, type (trial/subscription), duration, end date
- Only emails with confidence ≥ 0.7 are saved
- Processes first 4000 chars of email body to stay within token limits

### Database Schema
- `users` - Auth users with encrypted Google tokens + Gmail watch state
- `settings` - Per-user preferences (reminder days before, enabled/disabled)
- `subscriptions` - Detected subscriptions with calendar event IDs
- `processed_emails` - Deduplication to prevent reprocessing same email

## File Structure Reference

```
src/
├── app/
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts    # NextAuth handlers
│   │   ├── cron/renew-watches/route.ts    # Daily cron to renew Gmail watches
│   │   ├── settings/route.ts              # GET/PUT user settings
│   │   ├── subscriptions/[id]/route.ts    # DELETE/PATCH subscription
│   │   └── webhooks/gmail/route.ts        # Gmail push notification handler
│   ├── dashboard/page.tsx                 # Main dashboard (server component)
│   ├── settings/page.tsx                  # Settings page (server component)
│   ├── signin/page.tsx                    # Sign in page with Google button
│   └── page.tsx                           # Landing page
├── components/
│   ├── ui/                                # shadcn/ui components
│   ├── header.tsx                         # Client component with nav + user menu
│   ├── providers.tsx                      # SessionProvider wrapper
│   ├── settings-form.tsx                  # Client component for settings
│   ├── subscription-card.tsx              # Client component for subscription display
│   └── subscription-list.tsx              # Client component managing list
├── lib/
│   ├── db/
│   │   ├── schema.ts                      # Drizzle schema definitions
│   │   └── index.ts                       # Database client export
│   ├── services/
│   │   ├── gmail.ts                       # GmailService class
│   │   ├── claude.ts                      # ClaudeService class
│   │   └── calendar.ts                    # CalendarService class
│   ├── auth.ts                            # NextAuth configuration
│   └── utils.ts                           # cn() utility (shadcn)
├── middleware.ts                          # Auth middleware (protected routes)
└── types/index.ts                         # TypeScript types
```

## Important Patterns

### Server Components vs Client Components
- Pages (dashboard, settings) are Server Components - can directly query database
- Interactive UI (forms, lists with state) are Client Components - marked with "use client"
- Server Actions used for mutations (e.g., enabling Gmail watch)

### Error Handling
- Services catch errors and return default/null values rather than throwing
- API routes return appropriate HTTP status codes (401, 404, 500)
- Gmail watch renewal cron continues processing all users even if some fail

### Security Considerations
- OAuth tokens stored in database (should be encrypted at rest in production)
- Webhook endpoints verify Pub/Sub message signatures
- Cron endpoint requires `CRON_SECRET` in Authorization header
- User can only access their own subscriptions/settings (checked by user ID)

## Development Workflow

### Local Development
1. Copy `.env.example` to `.env.local`
2. Fill in real credentials (Google OAuth, Anthropic, Vercel Postgres)
3. Run `npm run db:push` to sync database schema
4. Run `npm run dev` to start dev server

### Database Changes
1. Modify `src/lib/db/schema.ts`
2. Run `npm run db:push` to apply changes (development)
3. Run `npm run db:generate` → `npm run db:migrate` for production migrations

### Adding New Features
- New API routes go in `src/app/api/`
- New pages go in `src/app/[route]/page.tsx`
- Reusable components go in `src/components/`
- Service classes go in `src/lib/services/`

## Environment Variables

See `.env.example` for full list. Critical ones:

- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` - OAuth credentials
- `ANTHROPIC_API_KEY` - Claude API key
- `AUTH_SECRET` - NextAuth session encryption
- `DATABASE_URL` - Postgres connection string
- `GCP_PROJECT_ID` - Google Cloud project for Pub/Sub
- `PUBSUB_VERIFICATION_TOKEN` - Webhook security token
- `CRON_SECRET` - Cron endpoint authorization

## Common Tasks

### Add a new shadcn/ui component
```bash
npx shadcn@latest add [component-name]
```

### View database in GUI
```bash
npm run db:studio
```

### Test email classification manually
Create a test file and import `ClaudeService`, call `classifyEmail()` with sample data.

### Debug Gmail webhook
Check Vercel logs for webhook endpoint, ensure Pub/Sub is configured correctly with push subscription.

## Known Limitations

- Gmail watch expires after 7 days (handled by cron)
- Claude API rate limits apply (no queueing implemented)
- No multi-tenancy isolation (each user has own data but single deployment)
- OAuth tokens not encrypted at rest (should use Vercel KV or similar in production)
- No email notifications when subscriptions are detected (future enhancement)

## Deployment Checklist

1. Push to GitHub
2. Import repo in Vercel
3. Add all environment variables from `.env.example`
4. Create Vercel Postgres database
5. Run `npm run db:push` in Vercel dashboard terminal
6. Set up Google Cloud Pub/Sub with deployed webhook URL
7. Verify cron job is scheduled in vercel.json

## Testing Strategy

Currently no automated tests. Manual testing:
1. Sign in with Google → verify OAuth flow works
2. Enable email monitoring → verify Gmail watch is set up
3. Send test subscription email to yourself → verify it's detected
4. Check dashboard → verify subscription appears
5. Check Google Calendar → verify reminder was created
6. Adjust settings → verify changes persist

## Future Enhancements (Out of Scope)

- Support for Outlook/other email providers
- Email notifications for new detections
- Browser extension for manual subscription tracking
- Price tracking and comparison
- Cancellation flow assistance
- Team/family shared subscription tracking
- Mobile app
