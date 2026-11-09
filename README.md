# GymPilot

Gym management software built with Next.js and Neon PostgreSQL.

Modules: Members and plans, Enquiries (leads), Trainers and staff, Personal training, Biometric attendance, Shop and stock, Messages, Bills and payments (GST, UPI QR), Expenses, Salaries, Reports.

Logins: **Owner** sees everything. **Trainer** sees only their own clients, schedule and commission. To add a role, add one line to `PERMISSIONS` in `lib/api/session.ts`.

## First-time setup

1. Create a project at [neon.tech](https://neon.tech). Choose an India or Singapore region if offered.
2. In Neon, click **Connect** and copy the **pooled** connection string.
3. Open `.env` in this folder and paste it as `DATABASE_URL`.
4. Run:

   ```
   npm run db:setup
   npm run dev
   ```

5. Open http://localhost:3000 and create the owner account.

Optional sample data to explore with: `npm run db:seed`. To wipe everything and start clean: `npm run db:reset -- --yes`, then `npm run db:setup`.

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

Connect under **Messages → WhatsApp setup**. The page lists what to collect from Meta. Your token is stored encrypted using `JWT_SECRET`, so if you change that secret, connect again.

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

Reminders are created when the owner opens the app. To run them on a schedule, set `CRON_SECRET` and call `GET /api/cron/reminders` daily with header `Authorization: Bearer <CRON_SECRET>`.

## Notes

- All dates and times use India time (Asia/Kolkata).
- CGST and SGST are applied for in-state billing. IGST and e-invoicing are not included. Check the SAC code and GST rate with your accountant.
- PF, ESI and TDS are entered by hand as "Other deductions" on each salary.
