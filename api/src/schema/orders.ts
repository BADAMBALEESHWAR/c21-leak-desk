import { z } from 'zod';

// C21 fixture schema v3.2 plus labelled extensions (Blueprint §6.2).
// null means unknown, never zero. Nullable fields may also be missing; they are read as null.
export const SCHEMA_VERSION = 'v3.2';

export const REQUIRED_FIELDS = ['order_id', 'date', 'gross_inr', 'discount_inr', 'product_cost_inr', 'shipping_inr', 'returned'] as const;
export const NULLABLE_FIELDS = ['refund_inr', 'net_sales_inr', 'recovered_product_cost_inr', 'payment_fee_inr', 'return_cost_inr'] as const;
export const FIXTURE_FIELDS = [...REQUIRED_FIELDS, ...NULLABLE_FIELDS] as const;
export const EXTENSION_FIELDS = ['channel', 'product_id', 'ads_inr', 'handling_inr', 'refund_date', 'net_product_cost_inr', 'payment_type', 'customer_id', 'units', 'synthetic', 'note'] as const;
export const MONEY_FIELDS = [
  'gross_inr',
  'discount_inr',
  'refund_inr',
  'net_sales_inr',
  'product_cost_inr',
  'recovered_product_cost_inr',
  'shipping_inr',
  'payment_fee_inr',
  'return_cost_inr',
  'ads_inr',
  'handling_inr',
  'net_product_cost_inr',
] as const;

/** Column-alias table: header variants accepted on import, mapped to schema names. */
export const COLUMN_ALIASES: Record<string, string> = {
  orderid: 'order_id',
  'order id': 'order_id',
  order_date: 'date',
  'order date': 'date',
  gross: 'gross_inr',
  discount: 'discount_inr',
  refund: 'refund_inr',
  refund_amount: 'refund_inr',
  net_sales: 'net_sales_inr',
  'net sales': 'net_sales_inr',
  product_cost: 'product_cost_inr',
  cogs: 'product_cost_inr',
  recovered_product_cost: 'recovered_product_cost_inr',
  recovered_cost: 'recovered_product_cost_inr',
  shipping: 'shipping_inr',
  shipping_cost: 'shipping_inr',
  payment_fee: 'payment_fee_inr',
  gateway_fee: 'payment_fee_inr',
  return_cost: 'return_cost_inr',
  is_returned: 'returned',
  sku: 'product_id',
  product: 'product_id',
  ads: 'ads_inr',
  ad_spend: 'ads_inr',
  handling: 'handling_inr',
  payment_method: 'payment_type',
  payment_mode: 'payment_type',
  customer: 'customer_id',
  qty: 'units',
  quantity: 'units',
};

export const IsoDate = z
  .string({ invalid_type_error: 'must be an ISO date YYYY-MM-DD' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'must be a real calendar date');

const Inr = z
  .number({ invalid_type_error: 'must be a number in INR', required_error: 'is missing' })
  .finite()
  .nonnegative('must not be negative');

export const OrderRowSchema = z
  .object({
    order_id: z.string({ required_error: 'is missing', invalid_type_error: 'must be text' }).trim().min(1, 'is missing'),
    date: IsoDate,
    gross_inr: Inr,
    discount_inr: Inr,
    refund_inr: Inr.nullable(),
    net_sales_inr: Inr.nullable(),
    // Required unless the row supplies net_product_cost_inr (worked-order style); checked in validate.ts.
    product_cost_inr: Inr.nullable(),
    recovered_product_cost_inr: Inr.nullable(),
    shipping_inr: Inr,
    payment_fee_inr: Inr.nullable(),
    return_cost_inr: Inr.nullable(),
    returned: z.boolean({ invalid_type_error: 'must be true or false', required_error: 'is missing' }),
    channel: z.string().trim().min(1).optional(),
    product_id: z.string().trim().min(1).optional(),
    ads_inr: Inr.nullable().optional(),
    handling_inr: Inr.nullable().optional(),
    refund_date: IsoDate.nullable().optional(),
    net_product_cost_inr: Inr.nullable().optional(),
    // Optional owner-analytics columns (Pulse); they never change a contribution.
    payment_type: z.preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.enum(['cod', 'prepaid'])).nullable().optional(),
    customer_id: z.string().trim().min(1).nullable().optional(),
    units: z.number().int('must be a whole number').positive('must be at least 1').nullable().optional(),
    synthetic: z.boolean().optional(),
    note: z.string().optional(),
  })
  .strip();

export type OrderRow = z.infer<typeof OrderRowSchema>;

// The pack's worked_order: six lines, net product cost already after recovery.
export const WorkedOrderSchema = z.object({
  revenue_inr: Inr,
  refund_inr: Inr,
  net_product_cost_inr: Inr,
  shipping_inr: Inr,
  ads_inr: Inr,
  handling_inr: Inr,
  expected_contribution_inr: z.number().optional(),
});

export type WorkedOrder = z.infer<typeof WorkedOrderSchema>;

export const FixtureFileSchema = z
  .object({
    case_id: z.string().optional(),
    synthetic: z.boolean().optional(),
    data_version: z.string().optional(),
    records: z
      .object({
        // Row limit (10,000) is enforced in ingest.ts as 413.
        orders: z.array(z.unknown()).min(1, 'must contain at least one order'),
        worked_order: WorkedOrderSchema.optional(),
      })
      .passthrough(),
  })
  .passthrough();

export const SAMPLE_SOURCES = [
  'fixture',
  'extended',
  'duplicate_order',
  'late_refund',
  'null_refund',
  'missing_fee',
  'refund_over_gross',
  'recovery_400',
  'bad_schema',
  'demo_12m',
] as const;

export type SampleSource = (typeof SAMPLE_SOURCES)[number];

export const DatasetSourceRequestSchema = z.object({
  source: z.enum(SAMPLE_SOURCES),
  period_end: IsoDate.optional(),
});

export const AttributionSchema = z.enum(['allocate', 'channel']);

export const AnalysisRequestSchema = z.object({
  attribution: AttributionSchema.default('allocate'),
  period_end: IsoDate.optional(),
  config: z
    .object({
      handling_default_inr: Inr.optional(),
      /** Accepted alias of handling_default_inr. */
      handling_inr: Inr.optional(),
    })
    .default({}),
  /** Explicit channel spend; only valid in channel mode (R3). */
  channel_spend: z.record(z.string(), Inr).optional(),
});

export type AnalysisRequest = z.infer<typeof AnalysisRequestSchema>;

const Pct = z.number().finite().min(0, 'must be between 0 and 100').max(100, 'must be between 0 and 100');

export const OVERRIDE_KEYS = ['return_rate_pct', 'recovery_pct', 'shipping_inr', 'refund_policy', 'ads_per_order'] as const;
export type OverrideKey = (typeof OVERRIDE_KEYS)[number];

export const OverridesSchema = z
  .object({
    return_rate_pct: Pct.optional(),
    recovery_pct: Pct.optional(),
    shipping_inr: Inr.optional(),
    refund_policy: z.enum(['full', 'partial']).optional(),
    ads_per_order: Inr.optional(),
    assume_unknown_refund: z.boolean().optional(),
  })
  .strict();

export type ScenarioOverrides = z.infer<typeof OverridesSchema>;

export const ScenarioRequestSchema = z.object({ overrides: OverridesSchema });

export const DecisionRequestSchema = z.object({
  scenario_id: z.string().min(1).optional(),
  intervention: z.string().trim().min(1, 'choose an intervention'),
  expected_delta_inr: z.number().finite().nullable(),
  test_30d: z.string().trim().min(1, 'describe the 30-day test'),
  stop_rule: z.string().trim().min(1, 'add a stop rule'),
  owner: z.string().trim().min(1, 'name an owner'),
  notes: z.string().optional(),
  assumptions: z.record(z.string(), z.unknown()).optional(),
});

export type DecisionRequest = z.infer<typeof DecisionRequestSchema>;
