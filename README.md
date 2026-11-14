# GymPilot

Gym management software built with Next.js and Neon PostgreSQL. One website serves many gyms, and each gym can have several branches.

Modules: Members and plans, Enquiries (leads), Trainers and staff, Personal training, Biometric attendance, Shop and stock, Messages, Bills and payments (GST, UPI QR), Expenses, Salaries, Reports.

Logins: **Owner** sees every branch of their gym and switches between them at the top of the screen. **Branch manager** runs one branch (no gym settings or salaries). **Trainer** sees only their own clients, schedule and commission. To add a role, add one line to `PERMISSIONS` in `lib/api/session.ts`.

## Many gyms on one site

Each gym only ever sees its own data. This is enforced by the database itself (row-level security), not just by the screens: every request runs as the `gympilot_tenant` role with its gym and branch set, so a mistake in one screen cannot show one gym's members to another.

Gym accounts are created by you, not by a public sign-up:

1. Set `SUPERADMIN_KEY` (24+ random characters) in `.env` and in Vercel.
2. Open `/superadmin` (it is not linked anywhere) and enter the key.
3. Click **New gym**: gym name and photo, first branch, owner name, photo, email and password. Share the login with the owner.

From the same page you can pause a gym (its people are logged out and its machines and reminders stop; nothing is deleted), resume it, reset an owner's password or add another owner.

## Branches

Owners add branches and branch manager logins in **Settings → Branches**. Members, plans, time slots, staff, bills, expenses, stock, attendance, enquiries and salaries belong to a branch. Gym details, GST settings, message templates and the WhatsApp number are shared by all branches.

In **All branches** view the owner can see everything together, for example on the dashboard and reports. New records need a branch, so the app asks to choose one first. Payments, renewals and other records that belong to a member follow that member's branch automatically.

## Moving members from another system

- **Add member → Existing member** keeps their old member ID, original join date and current plan dates. Enter only the amount they still owe; money already paid in the old system is not counted as new income.
- **Members → Import from Excel** adds everyone at once from a CSV file (in Excel: File → Save As → CSV). Download the template on that screen. Members whose phone number is already in the branch are skipped, so running the same file twice is safe.

## First-time setup

1. Create a project at [neon.tech](https://neon.tech). Choose an India or Singapore region if offered.
2. In Neon, click **Connect** and copy the **pooled** connection string.
3. Open `.env` in this folder and paste it as `DATABASE_URL`.
4. Run:

   ```
   npm run db:setup
   npm run dev
   ```

5. Set `SUPERADMIN_KEY`, open http://localhost:3000/superadmin and create your first gym. Then log in at http://localhost:3000 with the owner email and password.

Optional sample data to explore with: `npm run db:seed` creates a demo gym (login `demo@gympilot.test` / `demo12345`). To wipe everything and start clean: `npm run db:reset -- --yes`, then `npm run db:setup`.

For production: `npm run build`, then `npm start`.

## Fingerprint machine

Works with machines that support **ZKTeco ADMS / PUSH** (often labelled Cloud Server or ADMS).

1. In the app go to **Attendance → Machines** and add the machine using its serial number.
2. On the machine, under **Comm → Cloud Server**, enter this server's address and port.
3. Enter each person's machine user number as their **Fingerprint number** in their profile.

Once connected, the app also talks back to the machine. **Register finger** on a member's profile (or **Register a finger** on the Machines tab) gives the person a number, adds them to the machine and starts fingerprint capture. **Send people** pushes everyone who has a number. Some models cannot start capture remotely, in which case register the finger on the machine using the number shown.

The machine needs to reach the server over the network. Many machines only speak plain HTTP, and hosts such as Vercel force HTTPS. If yours is HTTP-only, run GymPilot on a PC at the gym or on a small VPS instead.

Other brands can send scans to `POST /api/biometric/punch` with header `x-device-key` (shown on the Machines tab) and body `{ "user_id": "101", "time": "2026-11-09 07:15:00" }`. The response includes `allowed`, which a turnstile can use.

## Messages

Reminders for expiring plans, dues and birthdays are prepared daily in **Messages**. Without any setup, WhatsApp opens with the text typed in, and you press send.

### WhatsApp Business

Each gym connects its own number under **Messages → WhatsApp setup** (owner only). The page lists what to collect from Meta. All gyms share one webhook address; each event is matched to its gym by the phone number it was sent to, and checked with that gym's App Secret. Your token is stored encrypted using `JWT_SECRET`, so if you change that secret, connect again.

1. **Messages → Templates**: create a template, or use the built-in holiday ones, and click **Send for approval**.
2. Click **Check approval** until it shows Approved. Meta usually takes minutes to a day.
3. **Messages → New message**: choose who, choose the template, fill in details such as the holiday date, and send.

Any `{{word}}` other than `name`, `plan`, `expiry_date`, `due_amount` and `gym_name` becomes a box to fill in when sending. A word ending in `_date` shows a date picker and `_time` a time picker.

WhatsApp only permits bulk sending with approved templates, to people who agreed to hear from you. Meta bills per message and limits how many people a new number can reach each day. Members who reply STOP are left out of bulk messages. This and the Delivered/Read counts need the webhook, which needs a public HTTPS address.

### SMS and email

| Channel | Settings in `.env` |
| --- | --- |
| SMS | `SMS_GATEWAY_URL`, with `{phone}` and `{message}` in the URL. Indian SMS also needs DLT registration with your provider. |
| Email | `SMTP_URL`, `EMAIL_FROM` |

Reminders are created when the owner opens the app. To run them on a schedule, set `CRON_SECRET` and call `GET /api/cron/reminders` daily with header `Authorization: Bearer <CRON_SECRET>`. It runs every active gym.

New members get a WhatsApp welcome message (the **Welcome** template; get it approved in Messages → Templates for automatic sending). Turn it off in Settings, or untick it while adding a member.

## Notes

- All dates and times use India time (Asia/Kolkata).
- CGST and SGST are applied for in-state billing. IGST and e-invoicing are not included. Check the SAC code and GST rate with your accountant.
- PF, ESI and TDS are entered by hand as "Other deductions" on each salary.
