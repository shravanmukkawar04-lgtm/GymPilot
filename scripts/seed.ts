import { one, pool, q, tx } from '../lib/db';
import { sellMembership, createInvoice } from '../lib/services/billing';
import { processPunch, manualCheck } from '../lib/services/attendance';

/** Adds realistic sample data so you can explore the app. Refuses to run if members already exist. */

const FIRST = ['Rohan', 'Priya', 'Amit', 'Sneha', 'Vikram', 'Neha', 'Arjun', 'Kavya', 'Rahul', 'Pooja', 'Siddharth', 'Ananya', 'Karan', 'Meera', 'Aditya', 'Isha', 'Nikhil', 'Riya', 'Manish', 'Divya', 'Yash', 'Tanvi', 'Harsh', 'Shreya', 'Omkar', 'Gauri', 'Sagar', 'Aarti', 'Tejas', 'Nisha', 'Pranav', 'Sakshi', 'Akash', 'Komal', 'Varun', 'Swati'];
const LAST = ['Sharma', 'Patil', 'Deshmukh', 'Kulkarni', 'Joshi', 'Verma', 'Shinde', 'Nair', 'Gupta', 'Jadhav', 'Pawar', 'Iyer'];
const pick = <T,>(a: T[], i: number) => a[i % a.length];
const phone = (i: number) => `98${String(10000000 + i * 7919).slice(0, 8)}`;
const dayOffset = (n: number) => new Date(Date.now() + 5.5 * 3600e3 + n * 86400e3).toISOString().slice(0, 10);

async function main() {
  const { c } = (await one<{ c: number }>('SELECT count(*) c FROM members'))!;
  if (c > 0) { console.error('Members already exist, so sample data was not added.'); process.exit(1); }

  await q(`UPDATE settings SET address='12, MG Road, Pune 411001', phone='020 4000 1234', upi_id='demogym@upi', invoice_terms='Fees once paid are non-refundable.' WHERE id=1`);

  const plans = await Promise.all([['Monthly', 1, 1500], ['Quarterly', 3, 4000], ['Half Yearly', 6, 7000], ['Yearly', 12, 12000]].map(([n, m, p]) =>
    one<any>('INSERT INTO plans (name, duration_months, price) VALUES ($1,$2,$3) RETURNING *', [n, m, p])));
  const pkg = await one<any>(`INSERT INTO pt_packages (name, sessions, validity_days, price) VALUES ('12 sessions in 1 month',12,30,9000) RETURNING *`);
  await q(`INSERT INTO pt_packages (name, sessions, validity_days, price) VALUES ('24 sessions in 2 months',24,60,16000)`);

  const trainers = await Promise.all([['Sameer Khan', 'Strength', 25000, 40], ['Anjali Rao', 'Weight loss', 22000, 35]].map(([n, sp, sal, pct], i) =>
    one<any>(`INSERT INTO staff (name, phone, role_title, is_trainer, specialization, experience_years, base_salary, pt_commission_pct, joined_on) VALUES ($1,$2,'Trainer',true,$3,$4,$5,$6,$7) RETURNING *`, [n, phone(900 + i), sp, 5 + i, sal, pct, dayOffset(-300)])));
  const desk = await one<any>(`INSERT INTO staff (name, phone, role_title, is_trainer, base_salary, joined_on) VALUES ('Sunita More',$1,'Receptionist',false,15000,$2) RETURNING *`, [phone(950), dayOffset(-300)]);

  const device = (await one<any>(`INSERT INTO biometric_devices (name, serial_number, location) VALUES ('Main entrance','DEMO12345','Reception') RETURNING *`))!;

  const members: any[] = [];
  for (let i = 0; i < 36; i++) {
    const name = `${pick(FIRST, i)} ${pick(LAST, i * 5 + 1)}`;
    const age = 20 + (i % 25);
    const dob = i === 3 ? `${1995}-${dayOffset(0).slice(5)}` : `${2026 - age}-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`;
    const joined = dayOffset(-(5 + i * 9));
    members.push(await one('INSERT INTO members (name, phone, gender, dob, joined_on, goal) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [name, phone(i), i % 2 ? 'Female' : 'Male', dob, joined, pick(['Weight loss', 'Muscle gain', 'General fitness'], i)]));
    await q('INSERT INTO biometric_enrollments (device_user_id, member_id) VALUES ($1,$2)', [String(100 + i), members[i].id]);
  }

  await tx(async (db) => {
    for (let i = 0; i < members.length; i++) {
      const p = plans[i % 4]!;
      // Spread start dates so some plans are ending soon and some have expired.
      const startsAgo = i % 9 === 0 ? 27 : i % 7 === 0 ? 70 : i * 3;
      const planDays = p.duration_months * 30;
      const adjust = i % 7 === 0 && p.duration_months === 1 ? 70 : startsAgo % Math.max(planDays, 28);
      const start = dayOffset(-adjust);
      const partly = i % 6 === 2;
      const total = p.price;
      await sellMembership(db, {
        member_id: members[i].id, plan_id: p.id, start_date: start,
        payment: { amount: partly ? Math.round(total / 2) : total, method: pick(['cash', 'upi', 'upi', 'card'], i), paid_on: start > dayOffset(0) ? dayOffset(0) : start },
      });
    }

    // Past visits, so last-visit and inactive lists look real.
    await db.query(`
      INSERT INTO attendance (member_id, day, check_in, check_out, source)
      SELECT m.id, d::date,
        (d::date + time '06:30' + (m.id % 180) * interval '1 minute') AT TIME ZONE 'Asia/Kolkata',
        (d::date + time '07:40' + (m.id % 180) * interval '1 minute') AT TIME ZONE 'Asia/Kolkata', 'biometric'
      FROM members m CROSS JOIN generate_series(gym_today() - 20, gym_today() - 1, interval '1 day') d
      WHERE (m.id + extract(day from d)::int) % 3 <> 0 AND m.id % 11 <> 10`);
    await db.query(`
      INSERT INTO attendance (staff_id, day, check_in, check_out, source)
      SELECT s.id, d::date, (d::date + time '06:00') AT TIME ZONE 'Asia/Kolkata', (d::date + time '14:00') AT TIME ZONE 'Asia/Kolkata', 'biometric'
      FROM staff s CROSS JOIN generate_series(gym_today() - 20, gym_today() - 1, interval '1 day') d
      WHERE extract(dow from d) <> 0`);
    for (let i = 0; i < 14; i++) await manualCheck(db, { member_id: members[i].id, staff_id: null });
    for (const s of [trainers[0]!, trainers[1]!, desk!]) await manualCheck(db, { member_id: null, staff_id: s.id });
    await processPunch(db, { device_id: device.id, device_user_id: '999', localTime: `${dayOffset(0)} 07:10:00` });

    // Personal training
    for (let i = 0; i < 4; i++) {
      const t = trainers[i % 2]!;
      const sub = (await one<any>(
        `INSERT INTO pt_subscriptions (member_id, trainer_id, package_id, package_name, total_sessions, start_date, end_date, price, commission_pct)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [members[i].id, t.id, pkg!.id, pkg!.name, pkg!.sessions, dayOffset(-15), dayOffset(15), pkg!.price, t.pt_commission_pct], db))!;
      const inv = await createInvoice(db, { member_id: members[i].id, customer_name: members[i].name, customer_phone: members[i].phone, items: [{ description: `Personal training: ${pkg!.name}`, qty: 1, rate: pkg!.price, type: 'pt', ref_id: sub.id }], payment: { amount: pkg!.price, method: 'upi', paid_on: dayOffset(-15) } });
      await db.query('UPDATE pt_subscriptions SET invoice_id=$2 WHERE id=$1', [sub.id, inv.id]);
      for (let d = 0; d < 6; d++) {
        await db.query(`INSERT INTO pt_sessions (subscription_id, trainer_id, scheduled_at, status, completed_at) VALUES ($1,$2,($3::date + time '07:00') AT TIME ZONE 'Asia/Kolkata','completed',now())`, [sub.id, t.id, dayOffset(-(d * 2 + 1))]);
      }
      await db.query('UPDATE pt_subscriptions SET used_sessions=6 WHERE id=$1', [sub.id]);
      await db.query(`INSERT INTO pt_sessions (subscription_id, trainer_id, scheduled_at) VALUES ($1,$2,($3::date + make_interval(hours => $4)) AT TIME ZONE 'Asia/Kolkata')`, [sub.id, t.id, dayOffset(0), 9 + i * 2]);
    }
  });

  await Promise.all([
    ['Whey Protein 1kg', 'Supplements', 2200, 3000, 12, 5], ['Creatine 250g', 'Supplements', 800, 1200, 3, 5], ['Energy Drink', 'Drinks', 60, 110, 40, 10],
    ['Shaker Bottle', 'Accessories', 120, 300, 18, 5], ['Lifting Straps', 'Accessories', 250, 500, 0, 3],
  ].map(([n, cat, cost, sale, stock, re]) => q(`INSERT INTO products (name, category, cost_price, sale_price, stock, reorder_level, hsn) VALUES ($1,$2,$3,$4,$5,$6,'2106')`, [n, cat, cost, sale, stock, re])));

  for (let m = 0; m < 6; m++) {
    await q(`INSERT INTO expenses (expense_date, category, description, amount, method) VALUES ($1,'Rent','Monthly rent',45000,'bank'),($1,'Electricity','Power bill',$2,'upi'),($1,'Cleaning','Housekeeping',4000,'cash')`, [dayOffset(-(m * 30 + 2)), 9000 + m * 400]);
  }

  const leadNames = [['Tushar Bhosale', 'new', 'Instagram', 0], ['Nidhi Kapoor', 'contacted', 'Walk-in', 0], ['Rakesh Yadav', 'trial', 'Friend or member', 1], ['Simran Gill', 'follow_up', 'Google', -1], ['Deepak Naik', 'new', 'Facebook', 2], ['Payal Shah', 'trial', 'Walk-in', 3], ['Ajay Rane', 'won', 'Friend or member', null], ['Mona Das', 'lost', 'JustDial', null]] as const;
  for (let i = 0; i < leadNames.length; i++) {
    const [n, st, src, f] = leadNames[i];
    await q('INSERT INTO leads (name, phone, status, source, interest, assigned_to, next_followup, lost_reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [n, phone(500 + i), st, src, pick(['Weight loss', 'Yearly plan', 'Personal training'], i), desk!.id, f === null ? null : dayOffset(f), st === 'lost' ? 'Too expensive' : null]);
  }

  console.log('Sample data added.');
  await pool().end();
}

main().catch((e) => { console.error(e); process.exit(1); });
