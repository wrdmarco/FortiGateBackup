import { z } from "zod";

export const tenantSchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/),
  active: z.boolean().default(true)
});

export const customerSchema = z.object({
  tenantId: z.string().min(1),
  name: z.string().min(2),
  contact: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  notes: z.string().optional(),
  itGlueOrganizationId: z.string().optional(),
  autotaskCompanyId: z.string().optional(),
  active: z.boolean().default(true)
});

export const fortigateSchema = z.object({
  customerId: z.string().min(1),
  managementUrl: z.string().url(),
  httpsPort: z.coerce.number().int().min(1).max(65535).default(443),
  apiToken: z.string().min(8),
  tlsVerify: z.boolean().default(false),
  vdom: z.string().optional(),
  scheduleType: z.enum(["HOURLY", "DAILY", "WEEKLY", "MONTHLY", "CRON"]).default("DAILY"),
  cronExpression: z.string().optional(),
  itGlueConfigurationId: z.string().optional()
});

export const fortigateUpdateSchema = fortigateSchema.omit({ apiToken: true }).extend({
  apiToken: z.string().min(8).optional().or(z.literal(""))
});
