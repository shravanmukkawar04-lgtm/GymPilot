/**
 * Which library template each automatic-message switch in Settings sends. The keys are the template keys
 * (see template-library.ts). "Membership ending" sends three: the reminder, the same-day notice and the expired notice.
 * The senders are in messaging.ts (runAutomations) and notify.ts.
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
