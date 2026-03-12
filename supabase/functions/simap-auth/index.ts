import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SIMAP_TOKEN_URL =
  "https://www.simap.ch/auth/realms/simap/protocol/openid-connect/token";
const SIMAP_CLIENT_ID = "bidpilot-tenders";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { action, code, code_verifier, redirect_uri } = await req.json();

    if (!action) {
      return new Response(
        JSON.stringify({ error: "action is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Auth ─────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data: profile } = await adminClient
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();

    if (!profile?.organization_id) {
      return new Response(
        JSON.stringify({ error: "User has no organization" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const orgId = profile.organization_id;

    // ── Actions ──────────────────────────────────────────────────────

    if (action === "status") {
      const { data: conn } = await adminClient
        .from("simap_connections")
        .select("id, token_expires_at, scopes, created_at, connected_by")
        .eq("organization_id", orgId)
        .single();

      if (!conn) {
        return new Response(
          JSON.stringify({ connected: false }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const expired = new Date(conn.token_expires_at) < new Date();

      return new Response(
        JSON.stringify({
          connected: true,
          expired,
          expires_at: conn.token_expires_at,
          scopes: conn.scopes,
          created_at: conn.created_at,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (action === "exchange") {
      if (!code || !code_verifier || !redirect_uri) {
        return new Response(
          JSON.stringify({ error: "code, code_verifier, and redirect_uri are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      console.log(`[simap-auth] Exchanging code for token (redirect_uri: ${redirect_uri})`);

      // Exchange authorization code for tokens
      const tokenResp = await fetch(SIMAP_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: SIMAP_CLIENT_ID,
          code,
          redirect_uri,
          code_verifier,
        }).toString(),
      });

      if (!tokenResp.ok) {
        const errText = await tokenResp.text();
        console.error(`[simap-auth] Token exchange failed: ${tokenResp.status} ${errText}`);
        return new Response(
          JSON.stringify({ error: `SIMAP token exchange failed: ${tokenResp.status}` }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const tokenData = await tokenResp.json();
      console.log(`[simap-auth] Token received, expires_in: ${tokenData.expires_in}s`);

      const expiresAt = new Date(Date.now() + (tokenData.expires_in || 300) * 1000).toISOString();

      // Upsert connection (one per org)
      const { error: upsertError } = await adminClient
        .from("simap_connections")
        .upsert(
          {
            organization_id: orgId,
            connected_by: user.id,
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token || null,
            token_expires_at: expiresAt,
            scopes: tokenData.scope || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "organization_id" },
        );

      if (upsertError) {
        console.error(`[simap-auth] Upsert error:`, upsertError);
        return new Response(
          JSON.stringify({ error: "Failed to store SIMAP connection" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      console.log(`[simap-auth] Connection stored for org ${orgId}`);

      return new Response(
        JSON.stringify({ success: true, expires_at: expiresAt }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (action === "refresh") {
      const { data: conn } = await adminClient
        .from("simap_connections")
        .select("refresh_token")
        .eq("organization_id", orgId)
        .single();

      if (!conn?.refresh_token) {
        return new Response(
          JSON.stringify({ error: "No refresh token available" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      console.log(`[simap-auth] Refreshing token for org ${orgId}`);

      const tokenResp = await fetch(SIMAP_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: SIMAP_CLIENT_ID,
          refresh_token: conn.refresh_token,
        }).toString(),
      });

      if (!tokenResp.ok) {
        const errText = await tokenResp.text();
        console.error(`[simap-auth] Refresh failed: ${tokenResp.status} ${errText}`);

        // If refresh fails, delete the connection (user needs to re-auth)
        await adminClient
          .from("simap_connections")
          .delete()
          .eq("organization_id", orgId);

        return new Response(
          JSON.stringify({ error: "Token refresh failed. Please reconnect to SIMAP.", reconnect: true }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const tokenData = await tokenResp.json();
      const expiresAt = new Date(Date.now() + (tokenData.expires_in || 300) * 1000).toISOString();

      await adminClient
        .from("simap_connections")
        .update({
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token || conn.refresh_token,
          token_expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("organization_id", orgId);

      console.log(`[simap-auth] Token refreshed for org ${orgId}`);

      return new Response(
        JSON.stringify({ success: true, expires_at: expiresAt }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (action === "disconnect") {
      const { error: deleteError } = await adminClient
        .from("simap_connections")
        .delete()
        .eq("organization_id", orgId);

      if (deleteError) {
        console.error(`[simap-auth] Disconnect error:`, deleteError);
        return new Response(
          JSON.stringify({ error: "Failed to disconnect" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      console.log(`[simap-auth] Disconnected org ${orgId} from SIMAP`);

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[simap-auth] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
