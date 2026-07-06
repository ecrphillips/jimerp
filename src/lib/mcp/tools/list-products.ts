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
  name: "list_products",
  title: "List products",
  description:
    "List products visible to the signed-in user (RLS-scoped to their account). Returns SKU, name, format, bag size, and active status.",
  inputSchema: {
    limit: z.number().int().min(1).max(200).default(50).describe("Max products to return (1-200)."),
    active_only: z.boolean().default(true).describe("Only return active products."),
    search: z.string().optional().describe("Optional substring match on product name or SKU."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, active_only, search }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    let q = supabase
      .from("products")
      .select("id, sku, product_name, format, bag_size_g, is_active, account_id, roast_group")
      .order("product_name", { ascending: true })
      .limit(limit);
    if (active_only) q = q.eq("is_active", true);
    if (search && search.trim()) {
      const s = `%${search.trim()}%`;
      q = q.or(`product_name.ilike.${s},sku.ilike.${s}`);
    }
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { products: data ?? [] },
    };
  },
});
