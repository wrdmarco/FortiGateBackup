import { z } from "zod";
import cron from "node-cron";

export const tenantSchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/),
  active: z.boolean().default(true)
});

export const customerSchema = z.object({
  tenantId: z.string().min(1),
  name: z.string().trim().min(2).max(160),
  contact: z.string().trim().max(160).optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(10_000).optional(),
  itGlueOrganizationId: z.string().trim().max(160).optional(),
  autotaskCompanyId: z.string().trim().max(160).optional(),
  active: z.boolean().default(true)
});

const fortigateBaseSchema = z.object({
  customerId: z.string().min(1),
  managementUrl: z
    .string()
    .trim()
    .max(2048)
    .url()
    .refine((value) => new URL(value).protocol === "https:", "FortiGate management-URL moet HTTPS gebruiken."),
  httpsPort: z.coerce.number().int().min(1).max(65535).default(443),
  apiToken: z.string().min(8).max(4096),
  tlsVerify: z.boolean().refine((value) => value, "TLS-certificaatcontrole moet ingeschakeld zijn."),
  vdom: z.string().trim().max(160).optional(),
  scheduleType: z.enum(["MANUAL", "HOURLY", "DAILY", "WEEKLY", "MONTHLY", "CRON"]).default("DAILY"),
  cronExpression: z.string().trim().max(255).optional(),
  itGlueConfigurationId: z.string().trim().max(160).optional(),
  active: z.boolean().default(true)
});

type FortiGateScheduleInput = Pick<z.infer<typeof fortigateBaseSchema>, "scheduleType" | "cronExpression">;

function validateFortiGateSchedule(value: FortiGateScheduleInput, context: z.RefinementCtx) {
  const expression = value.cronExpression?.trim() ?? "";
  if (value.scheduleType !== "CRON") return;
  if (!expression) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["cronExpression"],
      message: "Vul een cronexpressie in wanneer het backupschema op Cron staat."
    });
    return;
  }
  if (expression.split(/\s+/).length !== 5 || !cron.validate(expression)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["cronExpression"],
      message: "Ongeldige cronexpressie. Gebruik vijf velden: minuut uur dag maand weekdag."
    });
  }
}

export const fortigateSchema = fortigateBaseSchema.superRefine(validateFortiGateSchedule);

export const fortigateUpdateSchema = fortigateBaseSchema
  .omit({ apiToken: true })
  .extend({ apiToken: z.string().min(8).max(4096).optional().or(z.literal("")) })
  .superRefine(validateFortiGateSchedule);
