import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STOP_WORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "had",
  "her", "was", "one", "our", "out", "has", "his", "how", "its", "may",
  "new", "now", "old", "see", "way", "who", "did", "get", "let", "say",
  "she", "too", "use", "mit", "und", "der", "die", "das", "ein", "eine",
  "den", "dem", "des", "ist", "sind", "von", "fur", "auf", "bei", "nach",
  "uber", "aus", "als", "auch", "oder", "wie", "dass", "wird", "werden",
  "soll", "muss", "kann", "alle", "sich", "noch", "nur", "zum", "zur",
]);

function stemSimple(word: string): string {
  if (word.length <= 4) return word;
  return word
    .replace(/ies$/, "y")
    .replace(/tion$/, "t")
    .replace(/(ing|ment|ness|able|ible|ment)$/, "")
    .replace(/s$/, "")
    .replace(/ed$/, "")
    .replace(/er$/, "")
    .replace(/en$/, "");
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function stemmedTokens(text: string): Set<string> {
  return new Set(tokenize(text).map(stemSimple));
}

function overlapScore(a: string, b: string): number {
  const aTokens = stemmedTokens(a);
  const bTokens = stemmedTokens(b);
  let overlap = 0;

  for (const token of aTokens) {
    if (bTokens.has(token)) overlap++;
  }

  return overlap;
}

function categoryBonus(category: string | null, assetType: string): number {
  if (!category) return 0;
  if (category === "reference" && assetType === "reference") return 15;
  if (category === "technical" && (assetType === "service_description" || assetType === "past_answer" || assetType === "past_tender")) return 10;
  if (category === "commercial" && assetType === "template") return 10;
  // Past tenders are broadly useful — give a baseline bonus for any category
  if (assetType === "past_tender") return 8;
  return 0;
}

function assetTypeBonus(requirementText: string, assetType: string): number {
  const text = requirementText.toLowerCase();

  if (text.includes("reference") && assetType === "reference") return 15;
  if ((text.includes("zert") || text.includes("certif")) && assetType === "certificate") return 15;
  if ((text.includes("security") || text.includes("sicherheit") || text.includes("policy")) && assetType === "policy") return 15;
  if ((text.includes("service") || text.includes("leistung") || text.includes("implementation")) && assetType === "service_description") return 15;
  if ((text.includes("cv") || text.includes("lebenslauf") || text.includes("team") || text.includes("qualification")) && assetType === "cv") return 15;
  if ((text.includes("tender") || text.includes("ausschreibung") || text.includes("rfp") || text.includes("bid") || text.includes("angebot")) && assetType === "past_tender") return 15;

  return 0;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    console.log("match-knowledge-assets invoked");

    const authHeader = req.headers.get("Authorization");
    console.log("Authorization header present:", !!authHeader);

    if (!authHeader) {
      console.error("Missing Authorization header");
      return new Response(
        JSON.stringify({ error: "Missing Authorization header" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const token = authHeader.replace("Bearer ", "");
    console.log("Token extracted:", !!token);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const publishableKey = Deno.env.get("SB_PUBLISHABLE_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authClient = createClient(supabaseUrl, publishableKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: claimsData, error: claimsError } = await authClient.auth.getClaims(token);

    if (claimsError || !claimsData?.claims?.sub) {
      console.error("Invalid JWT", claimsError);
      return new Response(
        JSON.stringify({ error: "Invalid JWT", details: claimsError }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const userId = String(claimsData.claims.sub);
    console.log("Authenticated user:", userId);

    const { tender_id } = await req.json();
    console.log("match-knowledge-assets payload:", { tender_id });

    if (!tender_id) {
      console.error("Missing tender_id");
      return new Response(
        JSON.stringify({ error: "Missing tender_id" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const { data: profile, error: profileError } = await authClient
      .from("profiles")
      .select("id, organization_id")
      .eq("id", userId)
      .single();

    if (profileError || !profile?.organization_id) {
      console.error("Profile not found or no organization", profileError);
      return new Response(
        JSON.stringify({ error: "Profile not found or no organization", details: profileError }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    console.log("Caller organization:", profile.organization_id);

    const { data: tender, error: tenderError } = await adminClient
      .from("tenders")
      .select("id, organization_id")
      .eq("id", tender_id)
      .single();

    if (tenderError || !tender) {
      console.error("Tender not found", tenderError);
      return new Response(
        JSON.stringify({ error: "Tender not found", details: tenderError }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (tender.organization_id !== profile.organization_id) {
      console.error("Forbidden: tender belongs to different organization");
      return new Response(
        JSON.stringify({ error: "Forbidden" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const { data: requirements, error: requirementsError } = await adminClient
      .from("requirements")
      .select("id, text, category, mandatory")
      .eq("tender_id", tender_id);

    if (requirementsError) {
      console.error("Failed to load requirements", requirementsError);
      return new Response(
        JSON.stringify({ error: "Failed to load requirements", details: requirementsError }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const { data: assets, error: assetsError } = await adminClient
      .from("knowledge_assets")
      .select("id, title, asset_type, extracted_text")
      .eq("organization_id", profile.organization_id);

    if (assetsError) {
      console.error("Failed to load knowledge assets", assetsError);
      return new Response(
        JSON.stringify({ error: "Failed to load knowledge assets", details: assetsError }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    console.log("Requirements loaded:", requirements?.length ?? 0);
    console.log("Knowledge assets loaded:", assets?.length ?? 0);

    if (!requirements?.length || !assets?.length) {
      console.log("No requirements or no assets available for matching");
      return new Response(
        JSON.stringify({
          success: true,
          message: "No requirements or no knowledge assets available for matching",
          tender_id,
          inserted_matches: 0,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    console.log("Deleting old matches for tender", tender_id);
    const { error: deleteError } = await adminClient
      .from("requirement_matches")
      .delete()
      .eq("tender_id", tender_id);

    if (deleteError) {
      console.error("Failed to delete previous matches", deleteError);
      return new Response(
        JSON.stringify({ error: "Failed to delete previous matches", details: deleteError }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

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
        const typeBonus = assetTypeBonus(requirement.text, asset.asset_type);
        const catBonus = categoryBonus(requirement.category, asset.asset_type);
        const hasExtractedText = asset.extracted_text && asset.extracted_text.length > 0;

        const score = Math.min(100,
          titleOverlap * 12 +
          textOverlap * 6 +
          Math.max(typeBonus, catBonus) +
          (hasExtractedText ? 5 : 0)
        );

        return {
          asset,
          score,
          reason: `title=${titleOverlap}, text=${textOverlap}, type_bonus=${typeBonus}, cat_bonus=${catBonus}, has_text=${hasExtractedText}`,
        };
      });

      console.log("Scores for requirement:", requirement.text.slice(0, 60), scored.map((s) => ({ title: s.asset.title, score: s.score, reason: s.reason })));

      const topMatches = scored
        .filter((m) => m.score >= 15)
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

    console.log("Prepared matches to insert:", rowsToInsert.length);

    if (rowsToInsert.length > 0) {
      const { error: insertError } = await adminClient
        .from("requirement_matches")
        .insert(rowsToInsert);

      if (insertError) {
        console.error("Failed to insert requirement matches", insertError);
        return new Response(
          JSON.stringify({ error: "Failed to insert requirement matches", details: insertError }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    console.log("match-knowledge-assets completed", {
      tender_id,
      inserted_matches: rowsToInsert.length,
    });

    return new Response(
      JSON.stringify({
        success: true,
        tender_id,
        inserted_matches: rowsToInsert.length,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("match-knowledge-assets error:", error);

    return new Response(
      JSON.stringify({
        error: "Unexpected error",
        details: String(error),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});