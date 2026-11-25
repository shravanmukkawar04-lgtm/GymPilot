/**
 * Which template each automatic-message switch in Settings sends. The keys are the built-in template keys
 * (see template-library.ts). "Membership ending" sends three: the reminder, the same-day notice and the expired notice.
 * The senders are in messaging.ts (runAutomations) and notify.ts.
 *
 * The owner can choose a different template for any of them in Settings. The choice is kept in
 * settings.auto_template_ids as { "<built-in key>": <template id> }; with no choice, the built-in template is used.
 */
export const AUTO_TEMPLATES: Record<string, string[]> = {
  auto_welcome: ['memberregistration'],
  auto_renewal: ['renewalenrollmentconfirmation'],
  auto_expiry: ['packageexpiryreminder', 'todaypackageexpirynotice', 'packageexpirednotification'],
  auto_freeze: ['membershipfreezenotification'],
  auto_birthday: ['happybirthday'],
  auto_dues: ['memberpaymentduereminder'],
  auto_receipt: ['memberpaymentreceipt'],
  auto_pos_sale: ['possellconfirmation'],
  auto_pos_receipt: ['pospaymentreceipt'],
  auto_pos_due: ['pospaymentduereminder'],
  auto_enquiry: ['enquiry'],
  auto_followup: ['followup'],
  auto_employee: ['employeeregistration'],
};

export const AUTO_KEYS = Object.values(AUTO_TEMPLATES).flat();

/** When one switch sends more than one message, the moment each is for. */
export const AUTO_LABELS: Record<string, string> = {
  packageexpiryreminder: '7, 3 and 1 days before',
  todaypackageexpirynotice: 'On the day',
  packageexpirednotification: 'The day after',
};

const BASE = ['name', 'gym_name', 'contact_phone', 'contact_email'];
/** Everything the app knows about a member (see memberVars in messaging.ts). */
const MEMBER = [...BASE, 'plan', 'package', 'expiry_date', 'start_date', 'days_left', 'due_date', 'total_fee', 'paid_amount', 'payment_method',
  'amount_due', 'due_amount', 'username', 'login_url'];

/** The blanks the app fills in for each automatic message. Any other blank in a chosen template is sent as a dash. */
export const AUTO_VARS_FOR: Record<string, string[]> = {
  memberregistration: MEMBER,
  packageexpiryreminder: MEMBER,
  todaypackageexpirynotice: MEMBER,
  packageexpirednotification: MEMBER,
  memberpaymentduereminder: MEMBER,
  happybirthday: MEMBER,
  renewalenrollmentconfirmation: [...BASE, 'package', 'total_fee', 'paid_amount', 'payment_method', 'amount_due', 'start_date', 'expiry_date'],
  membershipfreezenotification: [...BASE, 'package', 'resume_date', 'expiry_date'],
  memberpaymentreceipt: [...BASE, 'receipt_no', 'package', 'total_fee', 'previously_paid', 'payment_received', 'outstanding_balance', 'payment_date', 'payment_method'],
  possellconfirmation: [...BASE, 'bill_no', 'purchase_date', 'products', 'total_amount', 'discount', 'payable_amount', 'pos_paid_amount', 'pos_payment_method', 'remaining_amount'],
  pospaymentreceipt: [...BASE, 'bill_no', 'invoice_no', 'products', 'pos_paid_amount', 'payment_date', 'pos_payment_method'],
  pospaymentduereminder: [...BASE, 'bill_no', 'products', 'total_amount', 'outstanding_amount', 'purchase_date'],
  enquiry: [...BASE, 'package'],
  followup: [...BASE, 'package'],
  employeeregistration: [...BASE, 'employee_id', 'username', 'login_url', 'department', 'designation', 'joining_date'],
};

const BLANK = /\{\{\s*(\w+)\s*\}\}/g;
/** The blanks in a template that the automatic message cannot fill. */
export const unfilledBlanks = (key: string, t: { body?: string | null } | null) => {
  if (!t) return [];
  const known = AUTO_VARS_FOR[key] ?? [];
  const used = [...(t.body ?? '').matchAll(BLANK)].map((m) => m[1]);
  return [...new Set(used)].filter((v) => !known.includes(v));
};
