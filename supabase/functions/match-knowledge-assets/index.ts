import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Embedding helpers ──────────────────────────────────────────────

const EMBEDDING_MODEL = "text-embedding-3-large";
const MAX_ASSET_TEXT_FOR_EMBEDDING = 2000;

async function getEmbeddings(texts: string[], apiKey: string): Promise<number[][]> {
  // Batch up to 100 texts per API call (OpenAI limit is 2048)
  const allEmbeddings: number[][] = [];
  const batchSize = 100;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const resp = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: batch,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`OpenAI Embeddings API error ${resp.status}: ${errText}`);
    }

    const data = await resp.json();
    // Sort by index to preserve order
    const sorted = data.data.sort((a: any, b: any) => a.index - b.index);
    for (const item of sorted) {
      allEmbeddings.push(item.embedding);
    }
  }

  return allEmbeddings;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// ── Bonus helpers (keep type/category alignment) ───────────────────

function categoryBonus(category: string | null, assetType: string): number {
  if (!category) return 0;
  if (category === "reference" && assetType === "reference") return 10;
  if (category === "technical" && (assetType === "service_description" || assetType === "past_answer" || assetType === "past_tender")) return 8;
  if (category === "commercial" && assetType === "template") return 8;
  if (category === "administrative" && assetType === "certificate") return 8;
  if (category === "legal" && assetType === "policy") return 8;
  if (assetType === "past_tender") return 5;
  return 0;
}

// ── Main handler ───────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    console.log("match-knowledge-assets invoked (semantic v2)");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const publishableKey = Deno.env.get("SB_PUBLISHABLE_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiKey = Deno.env.get("OPENAI_API_KEY")!;

    const authClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Auth
    const { data: claimsData, error: claimsError } = await authClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims?.sub) {
      return new Response(
        JSON.stringify({ error: "Invalid JWT", details: claimsError }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const userId = String(claimsData.claims.sub);
    const { tender_id } = await req.json();

    if (!tender_id) {
      return new Response(
        JSON.stringify({ error: "Missing tender_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: profile } = await authClient
      .from("profiles")
      .select("id, organization_id")
      .eq("id", userId)
      .single();

    if (!profile?.organization_id) {
      return new Response(
        JSON.stringify({ error: "Profile not found or no organization" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: tender } = await adminClient
      .from("tenders")
      .select("id, organization_id")
      .eq("id", tender_id)
      .single();

    if (!tender) {
      return new Response(
        JSON.stringify({ error: "Tender not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (tender.organization_id !== profile.organization_id) {
      return new Response(
        JSON.stringify({ error: "Forbidden" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Load data
    const { data: requirements } = await adminClient
      .from("requirements")
      .select("id, text, category, mandatory")
      .eq("tender_id", tender_id);

    const { data: assets } = await adminClient
      .from("knowledge_assets")
      .select("id, title, asset_type, extracted_text, tags")
      .eq("organization_id", profile.organization_id);

    console.log("Requirements:", requirements?.length ?? 0, "Assets:", assets?.length ?? 0);

    if (!requirements?.length || !assets?.length) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No requirements or no knowledge assets available",
          tender_id,
          inserted_matches: 0,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Build text representations for embedding ──────────────────

    // Requirements: use the requirement text directly
    const reqTexts = requirements.map((r) => r.text);

    // Assets: combine title + tags + first N chars of extracted_text for richer context
    const assetTexts = assets.map((a) => {
      const parts: string[] = [];
      if (a.title) parts.push(a.title);
      if (a.asset_type) parts.push(`[${a.asset_type.replace(/_/g, " ")}]`);
      if (a.tags && Array.isArray(a.tags) && a.tags.length > 0) {
        parts.push(`Tags: ${a.tags.join(", ")}`);
      }
      if (a.extracted_text) {
        parts.push(a.extracted_text.slice(0, MAX_ASSET_TEXT_FOR_EMBEDDING));
      }
      return parts.join("\n");
    });

    // ── Generate embeddings ───────────────────────────────────────

    console.log("Generating embeddings for", reqTexts.length, "requirements and", assetTexts.length, "assets");

    // Combine all texts into one batch for efficiency
    const allTexts = [...reqTexts, ...assetTexts];
    const allEmbeddings = await getEmbeddings(allTexts, openaiKey);

    const reqEmbeddings = allEmbeddings.slice(0, reqTexts.length);
    const assetEmbeddings = allEmbeddings.slice(reqTexts.length);

    console.log("Embeddings generated:", reqEmbeddings.length, "+", assetEmbeddings.length);

    // ── Delete old matches ────────────────────────────────────────

    const { error: deleteError } = await adminClient
      .from("requirement_matches")
      .delete()
      .eq("tender_id", tender_id);

    if (deleteError) {
      console.error("Failed to delete old matches", deleteError);
      return new Response(
        JSON.stringify({ error: "Failed to delete previous matches", details: deleteError }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Score each requirement × asset pair ───────────────────────

    const rowsToInsert: Array<{
      organization_id: string;
      tender_id: string;
      requirement_id: string;
      knowledge_asset_id: string;
      confidence_score: number;
      match_reason: string;
      status: "suggested";
    }> = [];

    for (let ri = 0; ri < requirements.length; ri++) {
      const req = requirements[ri];
      const reqEmb = reqEmbeddings[ri];

      const scored = assets.map((asset, ai) => {
        const similarity = cosineSimilarity(reqEmb, assetEmbeddings[ai]);
        const catBonus = categoryBonus(req.category, asset.asset_type);
        const hasText = asset.extracted_text && asset.extracted_text.length > 0;

        // Semantic similarity is primary (0-1 range → 0-85 score)
        // Category bonus adds up to 10
        // Having extracted text adds 3 (richer context = more trustworthy)
        const semanticScore = Math.round(similarity * 85);
        const score = Math.min(100, semanticScore + catBonus + (hasText ? 3 : 0));

        return {
          asset,
          score,
          similarity: Math.round(similarity * 100) / 100,
          reason: `semantic=${Math.round(similarity * 100)}%, cat_bonus=${catBonus}, has_text=${!!hasText}`,
        };
      });

      // Filter: require at least 50% semantic similarity — strict threshold
      // to only show genuinely relevant matches, not superficial overlap
      const topMatches = scored
        .filter((m) => m.similarity >= 0.50 && m.score >= 45)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      if (topMatches.length > 0) {
        console.log(
          "Req:", req.text.slice(0, 50), "→",
          topMatches.map((m) => `${m.asset.title}(${m.score}%)`).join(", ")
        );
      }

      for (const match of topMatches) {
        rowsToInsert.push({
          organization_id: profile.organization_id,
          tender_id,
          requirement_id: req.id,
          knowledge_asset_id: match.asset.id,
          confidence_score: match.score,
          match_reason: match.reason,
          status: "suggested",
        });
      }
    }

    console.log("Total matches to insert:", rowsToInsert.length);

    if (rowsToInsert.length > 0) {
      const { error: insertError } = await adminClient
        .from("requirement_matches")
        .insert(rowsToInsert);

      if (insertError) {
        console.error("Failed to insert matches", insertError);
        return new Response(
          JSON.stringify({ error: "Failed to insert requirement matches", details: insertError }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        tender_id,
        inserted_matches: rowsToInsert.length,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("match-knowledge-assets error:", error);
    return new Response(
      JSON.stringify({ error: "Unexpected error", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
