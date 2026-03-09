import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const publishableKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const openaiKey = Deno.env.get("OPENAI_API_KEY")!;

    // Auth
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const authClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claimsData, error: claimsError } =
      await authClient.auth.getUser(token);
    if (claimsError || !claimsData?.user?.id) {
      return new Response(JSON.stringify({ error: "Invalid JWT" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.user.id;

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Get profile for org check
    const { data: profile } = await adminClient
      .from("profiles")
      .select("organization_id")
      .eq("id", userId)
      .single();
    if (!profile?.organization_id) {
      return new Response(
        JSON.stringify({ error: "No organization found" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { knowledge_asset_id, requirement_text, language } = await req.json();

    if (!knowledge_asset_id || !requirement_text) {
      return new Response(
        JSON.stringify({ error: "Missing knowledge_asset_id or requirement_text" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Load asset
    const { data: asset, error: assetErr } = await adminClient
      .from("knowledge_assets")
      .select("extracted_text, title, asset_type")
      .eq("id", knowledge_asset_id)
      .eq("organization_id", profile.organization_id)
      .single();

    if (assetErr || !asset?.extracted_text) {
      return new Response(
        JSON.stringify({ error: "Asset not found or no text" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Truncate to 6000 chars for summary
    const text = asset.extracted_text.slice(0, 6000);
    const lang = language === "de" ? "German" : "English";

    const systemPrompt = `You are a bid analyst. Given a tender requirement and a company knowledge document, write a concise summary (2-3 sentences, max 80 words) in ${lang} explaining how this document is relevant to the requirement. Focus on the specific content that matches. Be factual and specific.`;

    const userPrompt = `REQUIREMENT:\n${requirement_text}\n\nDOCUMENT TITLE: ${asset.title} (${asset.asset_type})\n\nDOCUMENT CONTENT:\n${text}`;

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.3,
        max_tokens: 200,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`OpenAI error: ${resp.status} ${errText}`);
    }

    const data = await resp.json();
    const summary = data.choices?.[0]?.message?.content?.trim() || "";

    return new Response(JSON.stringify({ summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
