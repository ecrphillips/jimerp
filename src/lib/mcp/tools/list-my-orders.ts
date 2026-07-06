import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

export default defineTool({
  name: "list_my_orders",
  title: "List my orders",
  description:
    "List recent orders visible to the signed-in user, filtered by RLS. Returns order number, status, work deadline, ship date, and totals. Ordered newest first.",
  inputSchema: {
    limit: z.number().int().min(1).max(100).default(25).describe("Max orders to return (1-100)."),
    status: z
      .enum(["DRAFT", "SUBMITTED", "CONFIRMED", "IN_PRODUCTION", "READY", "SHIPPED", "CANCELLED"])
      .optional()
      .describe("Filter by order status."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, status }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    let q = supabase
      .from("orders")
      .select(
        "id, order_number, status, work_deadline, requested_ship_date, actual_ship_date, subtotal, total, account_id, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(limit);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { orders: data ?? [] },
    };
  },
});
