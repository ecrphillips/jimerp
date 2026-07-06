import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";

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
  name: "get_account_info",
  title: "Get account info",
  description:
    "Return the signed-in user's Home Island account details (name, programs, co-roast tier, certification, join date, billing contact). Uses the caller's identity — no input needed.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const userId = ctx.getUserId();

    const { data: au, error: auErr } = await supabase
      .from("account_users")
      .select("account_id, is_owner, can_place_orders, can_book_roaster")
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();
    if (auErr) return { content: [{ type: "text", text: auErr.message }], isError: true };
    if (!au?.account_id) {
      return {
        content: [{ type: "text", text: "No account linked to this user." }],
        structuredContent: { account: null },
      };
    }

    const { data: account, error: accErr } = await supabase
      .from("accounts")
      .select(
        "id, account_name, programs, coroast_tier, coroast_certified, coroast_joined_date, billing_contact_name, billing_email, billing_phone",
      )
      .eq("id", au.account_id)
      .maybeSingle();
    if (accErr) return { content: [{ type: "text", text: accErr.message }], isError: true };

    const payload = { account, membership: au };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  },
});
