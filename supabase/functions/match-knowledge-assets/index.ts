import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9äöüàéèêëîïôùûç\s]/gi, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function overlapScore(a: string, b: string): number {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  let overlap = 0;

  for (const token of aTokens) {
    if (bTokens.has(token)) overlap++;
  }

  return overlap;
}

function assetTypeBonus(requirementText: string, assetType: string): number {
  const text = requirementText.toLowerCase();

  if (text.includes("reference") && assetType === "reference") return 15;
  if ((text.includes("zert") || text.includes("certif")) && assetType === "certificate") return 15;
  if ((text.includes("security") || text.includes("sicherheit") || text.includes("policy")) && assetType === "policy") return 15;
  if ((text.includes("service") || text.includes("leistung") || text.includes("implementation")) && assetType === "service_description") return 15;

  return 0;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const publishableKey = Deno.env.get("SB_PUBLISHABLE_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: claimsData, error: claimsError } = await authClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Invalid JWT", details: claimsError }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = String(claimsData.claims.sub);

    const { data: profile, error: profileError } = await authClient
      .from("profiles")
      .select("id, organization_id")
      .eq("id", userId)
      .single();

    if (profileError || !profile?.organization_id) {
      return new Response(JSON.stringify({ error: "Profile not found or no organization", details: profileError }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { tender_id } = await req.json();
    if (!tender_id) {
      return new Response(JSON.stringify({ error: "Missing tender_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: tender, error: tenderError } = await adminClient
      .from("tenders")
      .select("id, organization_id")
      .eq("id", tender_id)
      .single();

    if (tenderError || !tender) {
      return new Response(JSON.stringify({ error: "Tender not found", details: tenderError }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (tender.organization_id !== profile.organization_id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: requirements, error: requirementsError } = await adminClient
      .from("requirements")
      .select("id, text, category, mandatory")
      .eq("tender_id", tender_id);

    if (requirementsError) {
      return new Response(JSON.stringify({ error: "Failed to load requirements", details: requirementsError }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: assets, error: assetsError } = await adminClient
      .from("knowledge_assets")
      .select("id, title, asset_type, extracted_text")
      .eq("organization_id", profile.organization_id);

    if (assetsError) {
      return new Response(JSON.stringify({ error: "Failed to load knowledge assets", details: assetsError }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!requirements?.length || !assets?.length) {
      return new Response(JSON.stringify({
        success: true,
        message: "No requirements or no knowledge assets available for matching",
        tender_id,
        inserted_matches: 0,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await adminClient
      .from("requirement_matches")
      .delete()
      .eq("tender_id", tender_id);

    const rowsToInsert: Array<{
      organization_id: string;
      tender_id: string;
      requirement_id: string;
      knowledge_asset_id: string;
      confidence_score: number;
      match_reason: string;
      status: "suggested";
    }> = [];

    for (const requirement of requirements) {
      const scored = assets.map((asset) => {
        const titleOverlap = overlapScore(requirement.text, asset.title || "");
        const textOverlap = overlapScore(requirement.text, asset.extracted_text || "");
        const bonus = assetTypeBonus(requirement.text, asset.asset_type);

        const score = Math.min(100, titleOverlap * 10 + textOverlap * 4 + bonus);

        return {
          asset,
          score,
          reason: `title_overlap=${titleOverlap}, text_overlap=${textOverlap}, asset_type_bonus=${bonus}`,
        };
      });

      const topMatches = scored
        .filter((m) => m.score >= 30)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      for (const match of topMatches) {
        rowsToInsert.push({
          organization_id: profile.organization_id,
          tender_id,
          requirement_id: requirement.id,
          knowledge_asset_id: match.asset.id,
          confidence_score: match.score,
          match_reason: match.reason,
          status: "suggested",
        });
      }
    }

    if (rowsToInsert.length > 0) {
      const { error: insertError } = await adminClient
        .from("requirement_matches")
        .insert(rowsToInsert);

      if (insertError) {
        return new Response(JSON.stringify({ error: "Failed to insert requirement matches", details: insertError }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      tender_id,
      inserted_matches: rowsToInsert.length,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("match-knowledge-assets error:", error);

    return new Response(JSON.stringify({
      error: "Unexpected error",
      details: String(error),
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});