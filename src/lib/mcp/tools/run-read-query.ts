import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|create|truncate)\b/i;

function serviceClient() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export default defineTool({
  name: "run_read_query",
  title: "Run read-only SQL query",
  description:
    "Execute a single read-only SQL SELECT (or WITH ... SELECT) query against the project's database and return the resulting rows. Runs with elevated permission and bypasses row-level security — intended for a trusted internal agent only. Any statement that writes or changes structure is rejected.",
  inputSchema: {
    query: z
      .string()
      .min(1)
      .describe("A single SQL SELECT statement. No semicolons except optional trailing. No writes or DDL."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false, destructiveHint: false },
  handler: async ({ query }, _ctx: ToolContext) => {
    const trimmed = query.trim().replace(/;+\s*$/, "");
    if (trimmed.includes(";")) {
      return { content: [{ type: "text", text: "Error: multiple statements are not allowed." }], isError: true };
    }
    const lowered = trimmed.toLowerCase();
    if (!lowered.startsWith("select") && !lowered.startsWith("with")) {
      return { content: [{ type: "text", text: "Error: only SELECT (or WITH ... SELECT) queries are allowed." }], isError: true };
    }
    if (FORBIDDEN.test(lowered)) {
      return { content: [{ type: "text", text: "Error: query contains a forbidden keyword." }], isError: true };
    }

    const supabase = serviceClient();
    const { data, error } = await supabase.rpc("mcp_run_read_sql", { query_text: trimmed });
    if (error) {
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    }
    const rows = Array.isArray(data) ? data : [];
    return {
      content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
      structuredContent: { rows, row_count: rows.length },
    };
  },
});
