import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Config ─────────────────────────────────────────────────────────

const EMBEDDING_MODEL = "text-embedding-3-large";
const LLM_MODEL = "gpt-4o-mini";
const MAX_ASSET_TEXT_FOR_EMBEDDING = 2000;
const MAX_ASSET_TEXT_FOR_LLM = 800;
const EMBEDDING_PRE_FILTER = 0.30; // loose pre-filter — let candidates through
const MAX_CANDIDATES_PER_REQ = 5;  // top N from embeddings → LLM
const LLM_MIN_SCORE = 50;          // LLM must score >= 50 to be a real match
const MAX_MATCHES_PER_REQ = 3;     // final top N per requirement

// ── Embedding helpers ──────────────────────────────────────────────

async function getEmbeddings(texts: string[], apiKey: string): Promise<number[][]> {
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
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch }),
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Embeddings API error ${resp.status}: ${errText}`);
    }

    const data = await resp.json();
    const sorted = data.data.sort((a: any, b: any) => a.index - b.index);
    for (const item of sorted) {
      allEmbeddings.push(item.embedding);
    }
  }
  return allEmbeddings;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// ── LLM verification ──────────────────────────────────────────────

interface LLMCandidate {
  assetId: string;
  assetTitle: string;
  assetType: string;
  textSnippet: string;
  embeddingSimilarity: number;
}

interface LLMScore {
  asset_id: string;
  score: number;
  reason: string;
}

async function verifyMatchesWithLLM(
  requirementText: string,
  requirementCategory: string | null,
  candidates: LLMCandidate[],
  apiKey: string,
  outputLanguage: string,
): Promise<LLMScore[]> {
  if (candidates.length === 0) return [];

  const docsBlock = candidates.map((c, i) =>
    `${i + 1}. [ID: ${c.assetId}] "${c.assetTitle}" (${c.assetType.replace(/_/g, " ")})\n   Content: ${c.textSnippet}`
  ).join("\n\n");

  const systemPrompt = `You are a bid analyst evaluating whether company knowledge documents are relevant to a specific tender requirement.

CRITICAL: Only score a document as relevant (50+) if the document's DOMAIN, SUBJECT MATTER, and CONTENT directly apply to the tender requirement.

Superficial similarities do NOT count:
- Both being "proposals" or "offers" is NOT enough
- Both mentioning "project management" is NOT enough
- The document must contain information that could actually help answer or fulfill the requirement

Scoring:
- 0-20: Completely irrelevant (different domain/industry)
- 21-49: Superficially similar but not applicable
- 50-69: Partially relevant (same domain, some applicable content)
- 70-85: Highly relevant (directly applicable knowledge)
- 86-100: Perfect match (directly addresses the requirement)

IMPORTANT: Write the "reason" field in ${outputLanguage}. Keep it to one clear sentence.

Return ONLY a valid JSON object: {"scores": [{"asset_id": "...", "score": N, "reason": "one sentence explanation in ${outputLanguage}"}]}`;

  const userPrompt = `TENDER REQUIREMENT (${requirementCategory || "general"}):\n"${requirementText}"\n\nCANDIDATE DOCUMENTS:\n${docsBlock}\n\nRate each document's relevance to this specific requirement.`;

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      temperature: 0.1,
      max_tokens: 500,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!resp.ok) {
    console.error("LLM verification failed:", resp.status);
    // Fallback: return embedding scores as-is
    return candidates.map(c => ({
      asset_id: c.assetId,
      score: Math.round(c.embeddingSimilarity * 80),
      reason: "LLM verification failed, using embedding score",
    }));
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) return [];

  try {
    const parsed = JSON.parse(content);
    return parsed.scores || [];
  } catch {
    console.error("Failed to parse LLM response:", content);
    return [];
  }
}

// ── Main handler ───────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    console.log("match-knowledge-assets invoked (hybrid v3: embeddings + LLM)");

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
      .select("id, organization_id, language")
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

    // Determine output language for LLM reasons
    const langMap: Record<string, string> = { de: "German", en: "English", fr: "French", it: "Italian" };
    const outputLanguage = langMap[tender.language || "de"] || "German";

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

    // ── Phase 1: Embeddings — fast pre-filter ─────────────────────

    console.log("Phase 1: Generating embeddings...");

    const reqTexts = requirements.map((r) => r.text);
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

    const allTexts = [...reqTexts, ...assetTexts];
    const allEmbeddings = await getEmbeddings(allTexts, openaiKey);
    const reqEmbeddings = allEmbeddings.slice(0, reqTexts.length);
    const assetEmbeddings = allEmbeddings.slice(reqTexts.length);

    console.log("Embeddings done. Phase 2: LLM verification...");

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

    // ── Phase 2: LLM verification — accurate scoring ─────────────

    const rowsToInsert: Array<{
      organization_id: string;
      tender_id: string;
      requirement_id: string;
      knowledge_asset_id: string;
      confidence_score: number;
      match_reason: string;
      status: "suggested";
    }> = [];

    // Process requirements in parallel batches of 5 for speed
    const batchSize = 5;
    for (let batchStart = 0; batchStart < requirements.length; batchStart += batchSize) {
      const batch = requirements.slice(batchStart, batchStart + batchSize);

      const batchPromises = batch.map(async (req, batchIdx) => {
        const ri = batchStart + batchIdx;
        const reqEmb = reqEmbeddings[ri];

        // Score all assets with embeddings
        const embeddingScores = assets.map((asset, ai) => ({
          asset,
          similarity: cosineSimilarity(reqEmb, assetEmbeddings[ai]),
        }));

        // Pre-filter: top N candidates above threshold
        const candidates = embeddingScores
          .filter((m) => m.similarity >= EMBEDDING_PRE_FILTER)
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, MAX_CANDIDATES_PER_REQ);

        if (candidates.length === 0) return;

        // Build LLM candidates
        const llmCandidates: LLMCandidate[] = candidates.map((c) => ({
          assetId: c.asset.id,
          assetTitle: c.asset.title || "Untitled",
          assetType: c.asset.asset_type || "unknown",
          textSnippet: (c.asset.extracted_text || "").slice(0, MAX_ASSET_TEXT_FOR_LLM).trim() || "(no text)",
          embeddingSimilarity: c.similarity,
        }));

        // LLM verification
        const llmScores = await verifyMatchesWithLLM(
          req.text,
          req.category,
          llmCandidates,
          openaiKey,
          outputLanguage,
        );

        // Merge: use LLM score as confidence, filter by LLM_MIN_SCORE
        const verified = llmScores
          .filter((s) => s.score >= LLM_MIN_SCORE)
          .sort((a, b) => b.score - a.score)
          .slice(0, MAX_MATCHES_PER_REQ);

        if (verified.length > 0) {
          console.log(
            "Req:", req.text.slice(0, 50), "→",
            verified.map((v) => `${v.asset_id.slice(0, 8)}(${v.score}%)`).join(", ")
          );
        }

        for (const v of verified) {
          const embCandidate = candidates.find(c => c.asset.id === v.asset_id);
          const embSim = embCandidate ? Math.round(embCandidate.similarity * 100) : 0;

          rowsToInsert.push({
            organization_id: profile.organization_id,
            tender_id,
            requirement_id: req.id,
            knowledge_asset_id: v.asset_id,
            confidence_score: v.score,
            match_reason: `ai_score=${v.score}%, semantic=${embSim}%, reason=${v.reason}`,
            status: "suggested",
          });
        }
      });

      await Promise.all(batchPromises);
    }

    console.log("Total verified matches:", rowsToInsert.length);

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
