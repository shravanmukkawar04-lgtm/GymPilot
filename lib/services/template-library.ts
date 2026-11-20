/**
 * The WhatsApp template library: 19 service (Meta) templates and 2 broadcast templates, taken from the
 * "WhatsApp Meta Template & Broadcast Guide".
 *
 * - `key` is the exact Meta template name. It must not change, and the variables keep their positions
 *   (the first {{blank}} is {{1}}, the next {{2}}, and so on). The wording around them may be changed.
 * - Blanks are written with names here. Some are filled in by the app for each member (see AUTO_VARS in messaging.ts);
 *   the rest are asked for when the message is sent.
 * - WhatsApp bold is a single *star*; the guide shows some headings with two, which WhatsApp would show as stars.
 */
import type { Db } from '../db';

export type LibraryTemplate = { key: string; name: string; subject: string; category: 'UTILITY' | 'MARKETING'; body: string };

const NOTE = '*This is a service notification. Please do not reply to this message.*';
const contact = (what: string) => `For any questions regarding ${what}, please contact us at {{contact_phone}} or {{contact_email}}.`;
const lines = (...l: string[]) => l.join('\n');

export const TEMPLATE_LIBRARY: LibraryTemplate[] = [
  {
    key: 'memberpaymentduereminder', name: 'Member payment due reminder', subject: 'Payment due reminder', category: 'UTILITY',
    body: lines('*Payment Due Reminder*', '', 'Dear {{name}},', '', 'This is a reminder that a payment is due for your enrolled package.', '',
      '*Payment Details*', '• Package: {{package}}', '• Total Fee: {{total_fee}}', '• Amount Due: {{amount_due}}', '• Due Date: {{due_date}}', '',
      'If you have already completed this payment, please disregard this message.', '', contact('your payment'), '', 'Regards,', '{{gym_name}}', '', NOTE),
  },
  {
    key: 'memberpaymentreceipt', name: 'Member payment receipt', subject: 'Payment receipt', category: 'UTILITY',
    body: lines('*Payment Receipt*', '', 'Dear {{name}},', '', 'Your payment has been received successfully.', '',
      '*Payment Details*', '• Receipt No.: {{receipt_no}}', '• Package: {{package}}', '• Total Fee: {{total_fee}}', '• Previously Paid: {{previously_paid}}',
      '• Payment Received: {{payment_received}}', '• Outstanding Balance: {{outstanding_balance}}', '• Payment Date: {{payment_date}}', '• Payment Method: {{payment_method}}', '',
      'If you have any questions regarding this payment, please contact us at {{contact_phone}} or {{contact_email}}.', '', 'Regards,', '{{gym_name}}', '', NOTE),
  },
  {
    key: 'packageexpiryreminder', name: 'Package expiry reminder', subject: 'Package expiry reminder', category: 'UTILITY',
    body: lines('*Package Expiry Reminder*', '', 'Dear {{name}},', '', 'This is a reminder that your enrolled package is scheduled to expire in *{{days_left}}* day(s).', '',
      '*Expiry Details*', '• Package: {{package}}', '• Expiry Date: {{expiry_date}}', '',
      'To continue using your package/service without interruption, please renew your enrollment before the expiry date.', '',
      'If you have any questions regarding your package enrollment, please contact us at {{contact_phone}} or {{contact_email}}.', '', 'Regards,', '{{gym_name}}', '', NOTE),
  },
  {
    key: 'possellconfirmation', name: 'POS sell confirmation', subject: 'Purchase confirmation', category: 'UTILITY',
    body: lines('*Purchase Confirmation*', '', 'Dear {{name}},', '', 'Your purchase has been completed successfully.', '',
      '*Purchase Details*', '• Bill No.: {{bill_no}}', '• Purchase Date: {{purchase_date}}', '• Products: {{products}}', '• Total Amount: {{total_amount}}', '• Discount: {{discount}}',
      '• Payable Amount: {{payable_amount}}', '• Paid Amount: {{pos_paid_amount}}', '• Payment Method: {{pos_payment_method}}', '• Remaining Amount: {{remaining_amount}}', '',
      'If you have any questions regarding this purchase, please contact us at {{contact_phone}} or {{contact_email}}.', '', 'Regards,', '{{gym_name}}', '', NOTE),
  },
  {
    key: 'renewalenrollmentconfirmation', name: 'Renewal enrollment confirmation', subject: 'Package renewal confirmation', category: 'UTILITY',
    body: lines('*Package Renewal Confirmation*', '', 'Dear {{name}},', '', 'Renewal Details', '',
      '*Enrollment Details*', '• Package: {{package}}', '• Total Fee: {{total_fee}}', '• Paid Amount: {{paid_amount}}', '• Payment Method: {{payment_method}}', '• Due Amount: {{amount_due}}',
      '• Start Date: {{start_date}}', '• Expiry Date: {{expiry_date}}', '',
      'To avoid any interruption in your enrolled services, please renew your package before the expiry date.', '',
      'If you have any questions regarding your renewal, please contact us at {{contact_phone}} or {{contact_email}}.', '', 'Regards,', '{{gym_name}}', '', NOTE),
  },
  {
    key: 'memberregistration', name: 'Member registration', subject: 'Member registration confirmation', category: 'UTILITY',
    body: lines('*Member Registration Confirmation*', '', 'Dear {{name}},', '', 'Your registration has been completed successfully.', '',
      '*Account Details*', '• Username: {{username}}', '• Login URL: {{login_url}}', '',
      '*Enrollment Details*', '• Package: {{package}}', '• Total Fee: {{total_fee}}', '• Paid Amount: {{paid_amount}}', '• Payment Method: {{payment_method}}', '• Due Amount: {{amount_due}}',
      '• Start Date: {{start_date}}', '• Expiry Date: {{expiry_date}}', '',
      'If you need assistance accessing your account or have any questions regarding your registration, please contact us at {{contact_phone}} or {{contact_email}}.', '', 'Regards,', '{{gym_name}}', '', NOTE),
  },
  {
    key: 'happybirthday', name: 'Happy birthday', subject: 'Happy birthday!', category: 'MARKETING',
    body: lines('*Happy Birthday! 🎉*', '', 'Dear {{name}},', '', 'We wish you a very Happy Birthday!', '',
      'We hope your special day is filled with happiness, good health, and wonderful memories. Thank you for being a valued member of our community.', '',
      'Have a fantastic celebration, and may the year ahead bring you continued success and joy.', '', 'Best wishes,', 'Customer Support Team', '',
      '*This message was sent by {{gym_name}}. Please do not reply to this message.*'),
  },
  {
    key: 'addonenrollmentconfirmation', name: 'Add-on enrollment confirmation', subject: 'Add-on enrollment confirmation', category: 'UTILITY',
    body: lines('*Add-On Enrollment Confirmation*', '', 'Dear {{name}},', '', 'Your add-on enrollment has been completed successfully.', '',
      '*Enrollment Details*', '• Package: {{addon_package}}', '• Total Fee: {{addon_total_fee}}', '• Paid Amount: {{addon_paid_amount}}', '• Payment Method: {{addon_payment_method}}',
      '• Due Amount: {{addon_amount_due}}', '• Start Date: {{addon_start_date}}', '• Expiry Date: {{addon_expiry_date}}', '',
      'If you have any questions regarding your enrollment, please contact us at {{contact_phone}} or {{contact_email}}.', '', 'Regards,', '{{gym_name}}', '', NOTE),
  },
  {
    key: 'addonpackageexpiryreminder', name: 'Add-on package expiry reminder', subject: 'Add-on package expiry reminder', category: 'UTILITY',
    body: lines('*Add-On Package Expiry Reminder*', '', 'Dear {{name}},', '', 'This is a reminder that your enrolled add-on package is scheduled to expire in *{{addon_days_left}}* day(s).', '',
      '*Expiry Details*', '• Add-On Package: {{addon_package}}', '• Expiry Date: {{addon_expiry_date}}', '',
      'To continue using your add-on service without interruption, please renew your enrollment before the expiry date.', '',
      'If you have any questions regarding your add-on enrollment, please contact us at {{contact_phone}} or {{contact_email}}.', '', 'Regards,', '{{gym_name}}', '', NOTE),
  },
  {
    key: 'todaypackageexpirynotice', name: 'Package expires today', subject: 'Package expiry notice', category: 'UTILITY',
    body: lines('*Package Expiry Notice*', '', 'Dear {{name}},', '', 'This is a reminder that your enrolled package expires today.', '',
      '*Package Details*', '• Package: {{package}}', '• Expiry Date: {{expiry_date}}', '',
      'To avoid interruption to your enrolled service, please renew your package today if you wish to continue using it.', '',
      'If you have any questions regarding your enrollment, please contact us at {{contact_phone}} or {{contact_email}}.', '', 'Regards,', '{{gym_name}}', '', NOTE),
  },
  {
    key: 'todayaddonpackageexpiry', name: 'Add-on package expires today', subject: 'Add-on package expiry notice', category: 'UTILITY',
    body: lines('*Add-On Package Expiry Notice*', '', 'Dear {{name}},', '', 'This is a reminder that your enrolled add-on package expires today.', '',
      '*Package Details*', '• Add-On Package: {{addon_package}}', '• Expiry Date: {{addon_expiry_date}}', '',
      'To avoid interruption to your enrolled add-on service, please renew your enrollment today if you wish to continue using it.', '',
      'If you have any questions regarding your add-on enrollment, please contact us at {{contact_phone}} or {{contact_email}}.', '', 'Regards,', '{{gym_name}}', '', NOTE),
  },
  {
    key: 'membershipfreezenotification', name: 'Membership freeze notification', subject: 'Membership freeze notification', category: 'UTILITY',
    body: lines('*Membership Freeze Notification*', '', 'Dear {{name}},', '', 'Your membership has been temporarily frozen.', '',
      '*Membership Details*', '• Package: {{package}}', '• Resume Date: {{resume_date}}', '• Expiry Date: {{expiry_date}}', '',
      'If you have any questions regarding your membership, please contact us at {{contact_phone}} or {{contact_email}}.', '', 'Regards,', '{{gym_name}}', '', NOTE),
  },
  {
    key: 'employeeregistration', name: 'Employee registration', subject: 'Employee registration confirmation', category: 'UTILITY',
    body: lines('*Employee Registration Confirmation*', '', 'Dear {{name}},', '', 'Your employee account has been created successfully.', '',
      '*Account Details*', '• Employee ID: {{employee_id}}', '• Username: {{username}}', '• Login URL: {{login_url}}', '',
      '*Employment Details*', '• Department: {{department}}', '• Designation: {{designation}}', '• Joining Date: {{joining_date}}', '',
      'If you need assistance accessing your account or have any questions regarding your employee registration, please contact us at {{contact_phone}} or {{contact_email}}.', '',
      'Regards,', '{{gym_name}}', '', NOTE),
  },
  {
    key: 'pospaymentreceipt', name: 'POS payment receipt', subject: 'Payment receipt', category: 'UTILITY',
    body: lines('*Payment Receipt*', '', 'Dear {{name}},', '', 'Your payment has been received successfully.', '',
      '*Receipt Details*', '• Bill No.: {{bill_no}}', '• Invoice No.: {{invoice_no}}', '• Products: {{products}}', '• Paid Amount: {{pos_paid_amount}}', '• Payment Date: {{payment_date}}',
      '• Payment Method: {{pos_payment_method}}', '',
      'If you have any questions regarding this payment, please contact us at {{contact_phone}} or {{contact_email}}.', '', 'Regards,', '{{gym_name}}', '', NOTE),
  },
  {
    key: 'packageexpirednotification', name: 'Package expired notification', subject: 'Package expiry notification', category: 'UTILITY',
    body: lines('*Package Expiry Notification*', '', 'Dear {{name}},', '', 'This is to inform you that your enrolled package has expired.', '',
      '*Package Details*', '• Package: {{package}}', '• Expiry Date: {{expiry_date}}', '',
      'If you wish to continue using your enrolled service, please renew your package.', '', contact('your package'), '', 'Regards,', '{{gym_name}}', '', NOTE),
  },
  {
    key: 'pospaymentduereminder', name: 'POS payment due reminder', subject: 'Payment due reminder', category: 'UTILITY',
    body: lines('*Payment Due Reminder*', '', 'Dear {{name}},', '', 'This is a reminder that payment is pending for your purchase.', '',
      '*Bill Details*', '• Bill No.: {{bill_no}}', '• Product(s): {{products}}', '• Total Amount: {{total_amount}}', '• Outstanding Amount: {{outstanding_amount}}', '• Purchase Date: {{purchase_date}}', '',
      'If you have already completed this payment, please disregard this message.', '',
      'If you have any questions regarding this payment, please contact us at {{contact_phone}} or {{contact_email}}.', '', 'Regards,', '{{gym_name}}', '', NOTE),
  },
  {
    key: 'expirysoon', name: 'Expiry soon', subject: 'Package expiry reminder', category: 'UTILITY',
    body: lines('*Package Expiry Reminder*', '', 'Dear {{name}},', '',
      'This is a reminder that your *{{package}}* package is scheduled to expire in *{{days_left}}* day(s) on *{{expiry_date}}*.', '',
      'To continue using your enrolled services without interruption, please renew your package before the expiry date.', '',
      'If you need any assistance, please contact us at *{{contact_phone}}* or *{{contact_email}}*.', '', 'Regards,', '{{gym_name}}', '', NOTE),
  },
  {
    key: 'followup', name: 'Enquiry follow-up', subject: 'Enquiry follow-up', category: 'MARKETING',
    body: lines('*Enquiry Follow-Up*', '', 'Dear {{name}},', '', 'We are following up on your enquiry regarding the *{{package}}* package.', '',
      'If you have any questions or need further information, our team is available to assist you. Please contact us at *{{contact_phone}}* or *{{contact_email}}*.', '',
      'Thank you for your enquiry.', '', 'Regards,', '{{gym_name}}', '', NOTE),
  },
  {
    key: 'enquiry', name: 'Enquiry received', subject: 'Enquiry received', category: 'UTILITY',
    body: lines('*Enquiry Received*', '', 'Dear {{name}},', '', 'We have received your enquiry regarding the *{{package}}* package.', '',
      'Our team will review your request and contact you shortly. If you need immediate assistance, please contact us at *{{contact_phone}}* or *{{contact_email}}*.', '',
      'Thank you for choosing {{gym_name}}.', '', NOTE),
  },

  /* ---------- Broadcast templates: separate from the 19 above, and their names must start with "broadcast_" ---------- */
  {
    key: 'broadcast_gym_holiday_notification', name: 'Broadcast: gym holiday notification', subject: 'Gym holiday notice', category: 'MARKETING',
    // The guide's example names its own gym here; this says "our gym" so it suits any gym.
    body: lines('*GYM HOLIDAY NOTICE*', '', 'Dear Member,', '', 'Please be informed that *our gym will remain closed tomorrow due to a holiday.*', '',
      '🏋 *Gym Status:* Closed Tomorrow', '⏰ *Regular sessions will resume the following day as per normal timings.*', '',
      'We appreciate your understanding and continued support.', '', '💪 *Stay Fit • Stay Strong • Stay Healthy*', '━━━━━━━━━━━━━━', NOTE),
  },
  {
    key: 'broadcast_gym_holiday_notification_variable', name: 'Broadcast: gym holiday notification (with gym name)', subject: 'Gym holiday announcement', category: 'MARKETING',
    body: lines('📢 *GYM HOLIDAY ANNOUNCEMENT*', '', 'Dear Members,', '', 'Please be informed that our *Gym will remain CLOSED tomorrow* due to a holiday.', '',
      '🗓 *Tomorrow: HOLIDAY*', '🏋 Regular gym sessions will resume from the following day as per normal timings.', '',
      'Thank you for your understanding and continued support. ❤', '', '*Stay Fit • Stay Strong • Stay Healthy* 💪', '', 'Regards', '{{gym_name}}', '', NOTE),
  },
];

/** Adds any library template a gym does not have yet. Never changes one that is already there. Returns how many were added. */
export async function installTemplateLibrary(db: Db, gymId: number) {
  let added = 0;
  for (const t of TEMPLATE_LIBRARY) {
    const r = await db.query(
      `INSERT INTO message_templates (gym_id, key, name, subject, body, category, language) VALUES ($1,$2,$3,$4,$5,$6,'en') ON CONFLICT (gym_id, key) DO NOTHING`,
      [gymId, t.key, t.name, t.subject, t.body, t.category]);
    added += r.rowCount ?? 0;
  }
  return added;
}
