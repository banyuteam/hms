import { z } from 'zod';
import { NotFoundError } from './errors';
import { ApiError, liveGet, seg } from './liveApi';
import type {
  Address,
  BloodType,
  Education,
  MaritalStatus,
  MaskedText,
  PatientCore,
  Relationship,
} from './types';

/**
 * Live adapter for `GET /api/v1/patients/{mrn}` (hms_services clinical-read-v1, ADR-SVC-003) -> the `PatientCore` the
 * identity strip and the Profile window read. The server already cleans legacy values ("-" = not recorded) and masks
 * sensitive identifiers; a full value is fetched only when the person asks to reveal it (`reveal`), which the server
 * authorizes (patient.identifiers.reveal) and records in the audit trail before answering. Nothing is invented here.
 * Known gap: the region names (village/district/city/province) are only codes in the legacy HMS, so they are not shown.
 */
const masked = z.object({ masked: z.string() });

export const apiPatientSchema = z.object({
  mrn: z.string(),
  name: z.string(),
  sex: z.enum(['male', 'female', 'unknown']),
  birth_date: z.string().nullable(),
  birth_place: z.string(),
  mother_name: z.string(),
  blood_type: z.enum(['A', 'B', 'O', 'AB', 'unknown']),
  marital_status: z.enum(['single', 'married', 'widowed_divorced']).nullable(),
  religion: z.string(),
  education: z.string(),
  occupation: z.string(),
  first_registered_on: z.string().nullable(),
  nik: masked,
  phone: masked,
  email: masked,
  address: masked,
  responsible_person: z.object({
    name: z.string(),
    relationship: z.string(),
    occupation: z.string(),
    address: masked,
  }),
});
export type ApiPatient = z.infer<typeof apiPatientSchema>;

/** Identifier kinds the server reveals one at a time (clinical-read-v1). */
export type IdentifierKind =
  | 'nik'
  | 'phone'
  | 'email'
  | 'address'
  | 'membership_number'
  | 'responsible_address';

const EDUCATION: readonly Education[] = [
  'TS',
  'TK',
  'SD',
  'SMP',
  'SMA',
  'SLTA',
  'D1',
  'D2',
  'D3',
  'D4',
  'S1',
  'S2',
  'S3',
];
const RELATIONSHIP: readonly Relationship[] = [
  'father',
  'mother',
  'wife',
  'husband',
  'sibling',
  'child',
];
const MARITAL: Record<NonNullable<ApiPatient['marital_status']>, MaritalStatus> = {
  single: 'single',
  married: 'married',
  widowed_divorced: 'widowedDivorced',
};

/** One identifier, revealed by the server (audited there first). */
export async function revealIdentifier(mrn: string, kind: IdentifierKind): Promise<string> {
  const res = await liveGet<{ value?: unknown }>(`/patients/${seg(mrn)}/identifiers/${kind}`);
  if (typeof res.value !== 'string') throw new ApiError(502, 'BAD_SHAPE');
  return res.value;
}

/** A masked value with a server-side reveal; a value that is not recorded has no mask and nothing to reveal. */
function maskedText(m: { masked: string }, mrn: string, kind: IdentifierKind): MaskedText {
  return m.masked
    ? { value: '', masked: m.masked, reveal: () => revealIdentifier(mrn, kind) }
    : { value: '', masked: '' };
}

function address(m: { masked: string }, mrn: string, kind: IdentifierKind): Address {
  return {
    line: maskedText(m, mrn, kind),
    namesAvailable: false,
    village: '',
    district: '',
    city: '',
    province: '',
  };
}

/**
 * A real calendar date from a stored `YYYY-MM-DD`, else `null`. The server already drops the legacy `0000-00-00`; this
 * guards the age calculation against anything unexpected.
 */
export function validStoredDate(value: string | null | undefined): string | null {
  const m = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  const real =
    y >= 1800 && t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
  return real ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Whole years on `today` (local date) from a stored `YYYY-MM-DD`; `null` when the date is missing, invalid or in the future. */
export function ageInYears(birthDate: string | null, today: Date = new Date()): number | null {
  const ok = validStoredDate(birthDate);
  if (!ok) return null;
  const [y, mo, d] = ok.split('-').map(Number) as [number, number, number];
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < mo || (today.getMonth() + 1 === mo && today.getDate() < d)) age -= 1;
  return age >= 0 ? age : null;
}

export function mapPatient(api: ApiPatient, today: Date = new Date()): PatientCore {
  const birthDate = validStoredDate(api.birth_date);
  const mrn = api.mrn;
  const blood: BloodType = api.blood_type;
  return {
    mrn,
    name: api.name,
    sex: api.sex,
    birthDate,
    ageYears: ageInYears(birthDate, today),
    nik: maskedText(api.nik, mrn, 'nik'),
    motherName: api.mother_name,
    birthPlace: api.birth_place,
    bloodType: blood,
    maritalStatus: api.marital_status ? MARITAL[api.marital_status] : null,
    religion: api.religion,
    education: EDUCATION.find((e) => e === api.education) ?? 'none',
    occupation: api.occupation,
    firstRegistered: validStoredDate(api.first_registered_on),
    address: address(api.address, mrn, 'address'),
    phone: maskedText(api.phone, mrn, 'phone'),
    email: maskedText(api.email, mrn, 'email'),
    responsiblePerson: {
      name: api.responsible_person.name,
      relationship:
        RELATIONSHIP.find((r) => r === api.responsible_person.relationship) ?? 'unknown',
      occupation: api.responsible_person.occupation,
      address: address(api.responsible_person.address, mrn, 'responsible_address'),
    },
  };
}

export async function liveGetPatientProfile(mrn: string): Promise<PatientCore> {
  let body: unknown;
  try {
    body = await liveGet(`/patients/${seg(mrn)}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) throw new NotFoundError();
    throw e;
  }
  const parsed = apiPatientSchema.safeParse(body);
  // A proxy page or a changed contract must fail visibly, never render a half-empty profile.
  if (!parsed.success) throw new ApiError(502, 'BAD_SHAPE');
  return mapPatient(parsed.data);
}
