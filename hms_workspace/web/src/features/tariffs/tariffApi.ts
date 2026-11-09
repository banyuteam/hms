import { z } from 'zod';
import { ApiError, liveGet, seg } from '@/api/liveApi';

/**
 * Tariff book client (contract `hms_services/contracts/api/tariff-book-v1.openapi.yaml`, ADR-SVC-005): today's prices
 * from the legacy master price tables, read-only. Every answer is validated here. hms_services authorizes every request
 * (`tariff.read`); the permission check in the UI only decides what is offered.
 */
export const TARIFF_PERMISSION = 'tariff.read';

export const TARIFF_KINDS = [
  'outpatient_procedure',
  'inpatient_procedure',
  'surgery',
  'drug',
  'laboratory',
  'radiology',
] as const;
export type TariffKind = (typeof TARIFF_KINDS)[number];

export type TariffFilterName = 'payer' | 'class' | 'place';

/** Filters each kind has (mirrors the contract; the server refuses any other). */
export const TARIFF_FILTERS: Record<TariffKind, readonly TariffFilterName[]> = {
  outpatient_procedure: ['payer', 'place'],
  inpatient_procedure: ['payer', 'class', 'place'],
  surgery: ['payer', 'class'],
  drug: [],
  laboratory: ['payer', 'class'],
  radiology: ['payer', 'class'],
};

/** What `place` means for a kind. */
export const TARIFF_PLACE: Partial<Record<TariffKind, 'clinic' | 'ward'>> = {
  outpatient_procedure: 'clinic',
  inpatient_procedure: 'ward',
};

/** Legacy class values the server accepts (canonical domain values: never translated in requests). */
export const TARIFF_CLASSES = [
  '-',
  'Rawat Jalan',
  'Kelas 1',
  'Kelas 2',
  'Kelas 3',
  'Kelas Utama',
  'Kelas VIP',
  'Kelas VVIP',
  'ICU',
] as const;

export const TARIFF_STATUSES = ['active', 'inactive', 'all'] as const;
export type TariffStatus = (typeof TARIFF_STATUSES)[number];

const amount = z.object({ name: z.string(), amount: z.string() });
const coded = z.object({ code: z.string(), name: z.string().nullable() });

const itemSchema = z.object({
  code: z.string(),
  name: z.string().nullable(),
  category: coded.nullable(),
  payer: coded.nullable(),
  place: z
    .object({ type: z.enum(['clinic', 'ward']), code: z.string(), name: z.string().nullable() })
    .nullable(),
  class: z.string().nullable(),
  unit: z.string().nullable(),
  active: z.boolean(),
  components: z.array(amount),
  prices: z.array(amount),
});
export type TariffItem = z.infer<typeof itemSchema>;

const pageSchema = z.object({
  kind: z.enum(TARIFF_KINDS),
  items: z.array(itemSchema),
  next_after: z.string().optional(),
});
export type TariffPage = z.infer<typeof pageSchema>;

const labItemsSchema = z.object({
  code: z.string(),
  truncated: z.boolean(),
  items: z.array(
    z.object({
      template_id: z.number(),
      name: z.string().nullable(),
      unit: z.string().nullable(),
      components: z.array(amount),
      price: z.string(),
    }),
  ),
});
export type TariffLabItems = z.infer<typeof labItemsSchema>;

export interface TariffQuery {
  q: string;
  payer: string;
  class: string;
  place: string;
  status: TariffStatus;
}

export const TARIFF_PAGE_SIZE = 50;

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(502, 'BAD_SHAPE');
  return parsed.data;
}

/** One page of a kind; only the filters the kind has are sent. */
export async function listTariffs(
  kind: TariffKind,
  query: TariffQuery,
  after?: string,
): Promise<TariffPage> {
  const has = new Set(TARIFF_FILTERS[kind]);
  const body = await liveGet(`/tariffs/${kind}`, {
    q: query.q.trim() || undefined,
    payer: has.has('payer') && query.payer ? query.payer : undefined,
    class: has.has('class') && query.class ? query.class : undefined,
    place: has.has('place') && query.place ? query.place : undefined,
    status: query.status,
    after,
    limit: TARIFF_PAGE_SIZE,
  });
  return parse(pageSchema, body);
}

export async function getLabItems(code: string): Promise<TariffLabItems> {
  return parse(labItemsSchema, await liveGet(`/tariffs/laboratory/${seg(code)}/items`));
}
