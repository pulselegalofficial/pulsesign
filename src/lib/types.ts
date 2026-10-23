export type DocStatus = 'draft' | 'sent' | 'opened' | 'completed' | 'declined' | 'cancelled' | 'expired';
export type SignerStatus = 'waiting' | 'sent' | 'opened' | 'signed' | 'declined';
export type FieldType = 'sig' | 'initial' | 'name' | 'date';
export const FIELD_TYPES: FieldType[] = ['sig', 'initial', 'name', 'date'];

export type EventType =
  | 'created' | 'sent' | 'opened' | 'otp_sent' | 'otp_verified' | 'otp_failed' | 'consent'
  | 'signed' | 'declined' | 'reminded' | 'cancelled' | 'expired' | 'completed';

export interface User {
  email: string;
  name: string;
}

export interface DocumentRow {
  id: string;
  owner_email: string;
  title: string;
  file_name: string;
  file_key: string;
  file_size: number;
  pages: number;
  lang: string;
  status: DocStatus;
  sequential: number;
  subject: string;
  message: string;
  expiry_days: number;
  hash_before: string;
  hash_final: string | null;
  final_key: string | null;
  final_token_hash: string | null;
  final_token_expires: number | null;
  created_at: number;
  updated_at: number;
  sent_at: number | null;
  expires_at: number | null;
  completed_at: number | null;
}

export interface SignerRow {
  id: string;
  doc_id: string;
  position: number;
  name: string;
  email: string;
  status: SignerStatus;
  token_hash: string | null;
  otp_hash: string | null;
  otp_expires_at: number | null;
  otp_attempts: number;
  otp_sent_count: number;
  otp_last_sent_at: number | null;
  session_hash: string | null;
  session_expires: number | null;
  otp_verified_at: number | null;
  consent_at: number | null;
  signed_at: number | null;
  declined_at: number | null;
  decline_reason: string | null;
  ip: string | null;
  user_agent: string | null;
}

export interface FieldRow {
  id: string;
  doc_id: string;
  signer_pos: number;
  type: FieldType;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  value: string | null;
  filled_at: number | null;
}

export interface EventRow {
  id: number;
  doc_id: string;
  at: number;
  type: EventType;
  actor_name: string;
  actor_email: string | null;
  detail: string | null;
  ip: string | null;
  user_agent: string | null;
}

/** Field geometry as the editor sends it. */
export interface FieldInput {
  signer: number;
  type: FieldType;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SignerInput {
  name: string;
  email: string;
}
