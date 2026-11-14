import { photoUrl } from '@/lib/client';
import type { Field } from './ui';

export const memberFieldsShared: Field[] = [
  { name: 'photo', label: 'Photo', type: 'photo', current: (v) => (v.id ? photoUrl('member', v.id, v.photo_v) : null) },
  { name: 'name', label: 'Full name', required: true },
  { name: 'phone', label: 'Phone number', type: 'tel', required: true, help: 'Used for WhatsApp messages' },
  { name: 'gender', label: 'Gender', type: 'select', options: ['Male', 'Female', 'Other'].map((x) => ({ value: x, label: x })) },
  { name: 'dob', label: 'Date of birth', type: 'date', help: 'For birthday wishes' },
  { name: 'occupation', label: 'Occupation', placeholder: 'Student, engineer, business…' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'biometric_id', label: 'Fingerprint number', help: 'The user number on your fingerprint machine' },
  { name: 'goal', label: 'Fitness goal', placeholder: 'Weight loss, muscle gain…' },
  { name: 'address', label: 'Address', full: true },
  { name: 'emergency_name', label: 'Emergency contact name' },
  { name: 'emergency_phone', label: 'Emergency contact phone', type: 'tel' },
  { name: 'health_notes', label: 'Health conditions or injuries', type: 'textarea' },
  { name: 'whatsapp_opt_out', label: 'Do not include in bulk WhatsApp messages', type: 'checkbox', help: 'Set automatically if the member replies STOP.' },
];
