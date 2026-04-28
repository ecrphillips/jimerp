import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ValidationRequest {
  client_id: string;
  line_items: Array<{
    product_id: string;
    quantity_units: number;
  }>;
  bypass_constraints?: boolean; // For admin/ops override
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    // Get auth header to check user role
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ valid: false, errors: ["Unauthorized"] }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey);
    
    // Verify the user's token and get their role
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ valid: false, errors: ["Invalid authentication"] }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get user's role and (for CLIENTs) their bound client_id
    const { data: roleData } = await supabaseClient
      .from("user_roles")
      .select("role, client_id")
      .eq("user_id", user.id)
      .single();

    const userRole = roleData?.role;
    const isAdminOrOps = userRole === "ADMIN" || userRole === "OPS";

    const body: ValidationRequest = await req.json();
    const { client_id, line_items, bypass_constraints = false } = body;

    // CLIENT users can only validate orders for their own client
    if (!isAdminOrOps) {
      if (userRole !== "CLIENT" || !roleData?.client_id || roleData.client_id !== client_id) {
        return new Response(
          JSON.stringify({ valid: false, errors: ["Forbidden: client_id does not match calling user"] }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Admin/Ops can bypass constraints if requested
    if (isAdminOrOps && bypass_constraints) {
      return new Response(
        JSON.stringify({ valid: true, errors: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const errors: string[] = [];

    // Fetch client constraints
    const { data: clientData, error: clientError } = await supabaseClient
      .from("clients")
      .select("case_only, case_size")
      .eq("id", client_id)
      .single();

    if (clientError) {
      return new Response(
        JSON.stringify({ valid: false, errors: ["Client not found"] }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { case_only, case_size } = clientData;

    // Validate case quantities (only for non-admin/ops users or when not bypassing)
    if (case_only && case_size && !isAdminOrOps) {
      for (const item of line_items) {
        if (item.quantity_units % case_size !== 0) {
          // Get product name for error message
          const { data: product } = await supabaseClient
            .from("products")
            .select("product_name")
            .eq("id", item.product_id)
            .single();

          const productName = product?.product_name || "Unknown product";
          errors.push(
            `"${productName}" quantity (${item.quantity_units}) must be a multiple of ${case_size} (case size)`
          );
        }
      }
    }

    // Validate allowed products
    const { data: allowedProducts } = await supabaseClient
      .from("client_allowed_products")
      .select("product_id")
      .eq("client_id", client_id);

    // Only enforce if there are restrictions set
    if (allowedProducts && allowedProducts.length > 0 && !isAdminOrOps) {
      const allowedIds = new Set(allowedProducts.map((p) => p.product_id));

      for (const item of line_items) {
        if (!allowedIds.has(item.product_id)) {
          const { data: product } = await supabaseClient
            .from("products")
            .select("product_name")
            .eq("id", item.product_id)
            .single();

          const productName = product?.product_name || "Unknown product";
          errors.push(`"${productName}" is not available for this account`);
        }
      }
    }

    const result: ValidationResult = {
      valid: errors.length === 0,
      errors,
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Validation error:", error);
    return new Response(
      JSON.stringify({ valid: false, errors: ["Server error during validation"] }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
