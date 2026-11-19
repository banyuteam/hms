import { z } from 'zod';
import { ApiError, liveGet } from '@/api/liveApi';

/**
 * Accounting reports client (contract ADR-SVC-014): the financial statements of the accounting application
 * (akutansi-rsb2), read through hms_services. Read-only — writing would bypass the approval flow over there.
 *
 * One permission per report, the same split hms_services and the accounting application both use. The check in the
 * UI only decides what is offered; hms_services authorizes every request.
 */
export const ACCOUNTING_PERMISSIONS = {
  neraca: 'accounting.neraca.read',
  labaRugi: 'accounting.laba_rugi.read',
} as const;

const period = z.object({ tahun: z.number(), bulan: z.number() });

/**
 * One account on a report. `nilai` carries its sign: contra accounts arrive negative (accumulated depreciation on
 * the balance sheet, purchase discounts in cost of sales), and the sign is what makes the column add up. Never take
 * its absolute value here.
 */
const line = z.object({
  kode: z.string(),
  nama: z.string(),
  tipe: z.string(),
  saldo_normal: z.string().nullable(),
  depth: z.number(),
  is_header: z.boolean(),
  nilai: z.number(),
});
export type AccountingLine = z.infer<typeof line>;

const group = z.object({ baris: z.array(line), total: z.number() });
export type AccountingGroup = z.infer<typeof group>;

const balanceSheetSchema = z.object({
  periode: period,
  aset: group,
  kewajiban: group,
  ekuitas: group,
  laba_tahun_lalu: z.number(),
  laba_rugi_berjalan: z.number(),
  total_kewajiban_ekuitas: z.number(),
  selisih: z.number(),
});
export type BalanceSheet = z.infer<typeof balanceSheetSchema>;

const incomeStatementSchema = z.object({
  periode: period,
  pendapatan: z.array(line),
  hpp: z.array(line),
  beban: z.array(line),
  biaya_lain: z.array(line),
  pajak: z.array(line),
  total: z.object({
    pendapatan: z.number(),
    hpp: z.number(),
    beban: z.number(),
    biaya_lain: z.number(),
    pajak: z.number(),
    laba_kotor: z.number(),
    laba_operasi: z.number(),
    laba_rugi: z.number(),
  }),
});
export type IncomeStatement = z.infer<typeof incomeStatementSchema>;

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
    if (!parsed.success) throw new ApiError(502, 'BAD_SHAPE');
  return parsed.data;
}

export async function getBalanceSheet(year: number, month: number): Promise<BalanceSheet> {
  return parse(balanceSheetSchema, await liveGet('/accounting/neraca', { year, month }));
}

export async function getIncomeStatement(year: number, month: number): Promise<IncomeStatement> {
  return parse(incomeStatementSchema, await liveGet('/accounting/laba-rugi', { year, month }));
}