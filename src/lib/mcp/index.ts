import { auth, defineMcp } from "@lovable.dev/mcp-js";
import getAccountInfoTool from "./tools/get-account-info";
import listMyOrdersTool from "./tools/list-my-orders";
import listProductsTool from "./tools/list-products";
import runReadQueryTool from "./tools/run-read-query";


const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "home-island-mcp",
  title: "Home Island Coffee Partners",
  version: "0.1.0",
  instructions:
    "Tools for the Home Island Coffee Partners platform. Read-only access to the signed-in user's account details, orders, and products. All data is scoped to the caller by row-level security.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [getAccountInfoTool, listMyOrdersTool, listProductsTool],
});
