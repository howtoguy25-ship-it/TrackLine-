# TrackLine owner dashboard

The dashboard is a separate website (code in `/admin`, Next.js) on its own Firebase Hosting
site. It shares the app's Firebase project. It holds no keys: every read and every action is a
call to a Cloud Function (`firebase/functions/admin/`) that checks your role on the server,
requires two-step sign-in, and writes an audit log entry that can't be edited or deleted.

## One-time setup (owner)

Do these once, in order. Nothing here is done for you automatically.

1. **Deploy the server.** GitHub > Actions > "Deploy Firebase" > Run workflow (functions,
   Firestore rules and indexes all ticked). The dashboard can't do anything until this has run.
2. **Turn on authenticator-app (TOTP) two-step sign-in for the project.** It needs Firebase
   Authentication with Identity Platform:
   Firebase console > Authentication > Settings > *Upgrade to Identity Platform* (free tier
   covers this), then turn on **TOTP** as a second factor for the project, following Firebase's
   guide "Add TOTP multi-factor authentication to your web app" (section *Enable TOTP MFA*).
   Also make sure **Email/Password** sign-in is enabled.
3. **Your staff account.** Sign up in the TrackLine app (or Firebase console > Authentication >
   Add user) with **howtoguy25@gmail.com** and verify the email. That verified address is the
   owner: no role needs granting for it.
4. **Web config for the dashboard build.** In Firebase console > Project settings > Your apps,
   add a Web app (or reuse the website's). Add these GitHub repository secrets
   (Settings > Secrets and variables > Actions):
   - `ADMIN_FIREBASE_API_KEY`, `ADMIN_FIREBASE_AUTH_DOMAIN`, `ADMIN_FIREBASE_APP_ID`
   - optional `ADMIN_RECAPTCHA_ENTERPRISE_KEY` (step 6)
5. **Deploy the dashboard.** Actions > "Deploy owner dashboard (admin site)" > Run. It creates
   the site `<project>-admin` and prints its address (`https://<project>-admin.web.app`).
   To use **admin.<your domain>**: Firebase console > Hosting > the admin site > *Add custom
   domain*, then add the DNS records it shows.
6. **App Check (recommended).** Google Cloud console > Security > reCAPTCHA Enterprise > create a
   *website* key for your admin domain; Firebase console > App Check > register the web app with
   it. Put the key in `ADMIN_RECAPTCHA_ENTERPRISE_KEY` and redeploy the dashboard. Then, to make
   the server refuse calls without App Check, add `ADMIN_ENFORCE_APP_CHECK=true` to
   `firebase/functions/.env` (create it; it's not secret) and redeploy functions.
7. **Optional keys** (GitHub secrets, then run "Deploy Firebase" with *Copy API keys* ticked):
   - `ANTHROPIC_API_KEY` — the Support page's AI assistant.
   - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` — SMS codes for account
     recovery and staff "send reset by SMS". Without them, SMS codes are queued in `smsOutbox`
     and not sent.
   - `SENTRY_AUTH_TOKEN` (and `SENTRY_ORG`, `SENTRY_PROJECT` in `firebase/functions/.env`) —
     crash-free sessions % on Overview and System health.
8. **Email delivery** for recovery codes, "your password was changed" and the 24 h
   contact-change notice: install the Firebase extension **Trigger Email from Firestore**
   (collection `mail`) with your SMTP provider. Password reset *links* don't need this: Firebase
   sends those itself (template: Authentication > Templates > Password reset).

## Signing in and 2FA

1. Open the dashboard address, enter your email and password.
2. First time only: *Set up authenticator app*. Add the key shown (or tap *Open in
   authenticator app* on your phone) in Google Authenticator / 1Password / Authy, type the
   6-digit code, then sign in again.
3. Every sign-in after that asks for the current 6-digit code.

You're signed out after **30 minutes** with no clicks or typing, and every 12 hours regardless.
The server refuses any call made without the second factor.

## Adding staff

Staff roles page (owner only): enter the person's TrackLine account email, pick a role, give a
reason, *Grant role*. They sign in (fresh), set up their authenticator app, and see only what
their role allows.

| Role | Can |
|---|---|
| owner | everything (you) |
| admin | everything except granting roles, legal text, system jobs |
| support | users and tickets (resets, sign-out, disable, export, messages, recovery review); no billing, no app config |
| moderator | reports, map edits, user content, report bans |
| viewer | read only |

To remove someone: *Remove* next to their name. It applies at their next sign-in (their current
session is signed out immediately).

## Common tasks

**Send an "update available" message.** Messages > template *New update available* > pick the
audience (e.g. Platform: iOS, App version to: 1.4.9) > check the live audience size > *Send now*
(or set a time). Users who turned off *News & updates* in Settings > Notifications don't get it.
Results (delivered / opened / clicked) appear in the list; a scheduled message can be cancelled.

**Force everyone onto a new version.** App control > Minimum app version > set *Force update
below* for iPhone/Android > *Publish changes*. Use *Soft prompt below* for a dismissible banner.

**Help a locked-out user.** Easiest: tell them Sign in > *Can't sign in?* in the app.
- If they still have their email/phone: they get a link (email) or 6-digit code (SMS) and set a
  new password themselves; every other device is signed out and they get a "password changed"
  notice.
- If they don't: they answer the in-app questions and verify a new email/phone with a code. A
  recovery ticket appears in Support with a risk score and the reasons. Open it, check the
  signals and AI summary, then *Approve* or *Deny* with a reason. Approval changes the contact
  **24 hours later**, after a notice (with a cancel code) is sent to the old email/phone; then a
  reset goes to the new contact.
- From a user's page you can also *Password reset (email)* or *(SMS code)*. Staff never see or
  set passwords.

**Ban a spammer.** Moderation > Spam (or the report's row) > open the user > *Ban reports 24h /
7d / permanent*, or *Disable account* for abuse. *Remove* takes a single report down.

**Turn a feature off.** App control > Feature switches > untick it (or set a % / countries) >
*Publish changes* with a reason. Phones pick it up within seconds. Every publish is versioned:
*Roll back to this* restores an earlier one.

**Privacy request.** Users > the user > *Export data* downloads everything stored about them
(logged as a data request). *Delete account* disables them now and deletes after 7 days (*Undo
deletion* until then). Privacy & legal lists every request; overdue ones (30 days) are red.

**Audit log.** Owner/admin: filter by action, user or staff member; *Export CSV*; *Check
integrity* verifies nothing was edited or removed outside the dashboard.

## What's where in the code

- Server: `firebase/functions/admin/` — `roles.js` (who can do what), `staff.js` (the wrapper
  every call goes through), `audit.js`, `users.js`, `recovery.js` + `otp.js`, `messages.js`,
  `appConfig.js`, `moderation.js`, `support.js` (AI assistant), `insights.js`, `governance.js`.
- Tests: `firebase/tests/admin.test.js` (every role and flow on the emulators),
  `__tests__/admin/appSide.test.tsx` (app screens), `admin/tests/` (dashboard).
- App: `src/screens/AccountRecoveryScreen.tsx`, `src/components/AppGates.tsx`,
  `src/remote/`, `src/guest/savePrompt.ts`, `src/screens/SupportRequestsScreen.tsx`.
