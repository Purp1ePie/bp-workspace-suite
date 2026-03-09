import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const OPENAI_MODEL = "gpt-4o";
const OPENAI_TIMEOUT_MS = 55000;
const GOOD_MATCH_THRESHOLD = 20;

// ── Types ────────────────────────────────────────────────────────────

interface QuestionItem {
  question_text: string;
  rationale: string;
}

interface QuestionsResult {
  questions: QuestionItem[];
}

// ── OpenAI clarification generation ─────────────────────────────────

async function generateQuestions(
  gapContext: string,
  tenderTitle: string,
  issuer: string | null,
  language: string | null,
): Promise<QuestionsResult> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY secret is not configured");
  }

  const lang = language || "de";

  const systemPrompt = `You are a senior procurement specialist helping a Swiss IT services company prepare clarification questions (Klarstellungsfragen / questions de clarification) to send to the tender issuer before the Q&A deadline.

RULES:
- Write questions in ${lang === "de" ? "German" : lang === "fr" ? "French" : lang === "it" ? "Italian" : "English"} (matching the tender language)
- Each question must be specific, actionable, and reference the relevant section or requirement
- Provide a rationale for each question explaining WHY it needs clarification (the rationale is internal for the bid team, not sent to the issuer)
- Focus on: missing information, ambiguous scope, contradictory requirements, unclear evaluation criteria, missing deadlines, and undefined technical specifications
- Do NOT ask questions that can be answered from the provided context
- Prioritize questions about mandatory requirements with no coverage
- Be professional and precise — these go directly to the public tender issuer
- Generate between 3 and 15 questions depending on the number and severity of gaps found
- If very few gaps exist, generate fewer but higher-quality questions

OUTPUT FORMAT (JSON):
{
  "questions": [
    {
      "question_text": "The clarification question to send to the issuer",
      "rationale": "Internal note explaining why this question is important for the bid team"
    }
  ]
}

If there are truly no gaps or ambiguities, return {"questions": []}`;

  const userPrompt = `TENDER: "${tenderTitle}"
ISSUER: "${issuer || "Unknown"}"
LANGUAGE: "${lang}"

${gapContext}

Based on the gaps and ambiguities above, generate clarification questions that the bid team should send to the tender issuer.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.3,
        max_tokens: 2048,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`OpenAI API error ${resp.status}: ${errText}`);
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Empty response from OpenAI");
    }

    const parsed = JSON.parse(content) as QuestionsResult;

    if (!parsed.questions || !Array.isArray(parsed.questions)) {
      parsed.questions = [];
    }

    // Filter out invalid entries
    parsed.questions = parsed.questions.filter(
      (q) => q.question_text && q.question_text.trim().length > 0,
    );

    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Main handler ────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { tender_id } = await req.json();
    if (!tender_id) {
      return new Response(
        JSON.stringify({ error: "tender_id is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    const orgId = profile.organization_id;

    // Load tender
    const { data: tender, error: tenderError } = await adminClient
      .from("tenders")
      .select("id, title, issuer, deadline, language, organization_id")
      .eq("id", tender_id)
      .eq("organization_id", orgId)
      .single();
    if (tenderError || !tender) {
      return new Response(
        JSON.stringify({ error: "Tender not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    console.log(
      `[generate-clarification-questions] Starting for tender: ${tender.title}`,
    );

    // ── Load data ─────────────────────────────────────────────────

    const { data: requirements } = await adminClient
      .from("requirements")
      .select("id, category, text, mandatory")
      .eq("tender_id", tender_id)
      .eq("organization_id", orgId);

    const { data: risks } = await adminClient
      .from("risks")
      .select("risk_type, severity, description")
      .eq("tender_id", tender_id)
      .eq("organization_id", orgId);

    const { data: deadlines } = await adminClient
      .from("deadlines")
      .select("deadline_type, due_at, description")
      .eq("tender_id", tender_id)
      .eq("organization_id", orgId);

    const { data: matches } = await adminClient
      .from("requirement_matches")
      .select("requirement_id, confidence_score")
      .eq("tender_id", tender_id)
      .eq("organization_id", orgId);

    // ── Compute gap signals ───────────────────────────────────────

    // Best match score per requirement
    const bestScoreByReq: Record<string, number> = {};
    for (const m of matches || []) {
      const score = Number(m.confidence_score);
      if (
        !bestScoreByReq[m.requirement_id] ||
        score > bestScoreByReq[m.requirement_id]
      ) {
        bestScoreByReq[m.requirement_id] = score;
      }
    }

    const matchedReqIds = new Set(
      Object.entries(bestScoreByReq)
        .filter(([, score]) => score >= GOOD_MATCH_THRESHOLD)
        .map(([id]) => id),
    );

    const allReqs = requirements || [];
    const uncoveredReqs = allReqs.filter((r) => !bestScoreByReq[r.id]);
    const weakReqs = allReqs.filter(
      (r) =>
        bestScoreByReq[r.id] !== undefined &&
        bestScoreByReq[r.id] < GOOD_MATCH_THRESHOLD,
    );

    const missingInfoRisks = (risks || []).filter(
      (r) => r.risk_type === "missing_information",
    );
    const ambiguityRisks = (risks || []).filter(
      (r) => r.risk_type === "scope_ambiguity",
    );
    const unclearDeadlines = (deadlines || []).filter(
      (d) => !d.description || d.description.trim() === "",
    );

    // ── Build gap context ─────────────────────────────────────────

    let gapContext = "";

    if (uncoveredReqs.length > 0) {
      gapContext += "=== UNCOVERED REQUIREMENTS (no matching company knowledge) ===\n";
      for (const r of uncoveredReqs) {
        gapContext += `- [${r.mandatory ? "MANDATORY" : "OPTIONAL"}] [${r.category}] ${r.text}\n`;
      }
      gapContext += "\n";
    }

    if (weakReqs.length > 0) {
      gapContext += "=== WEAKLY COVERED REQUIREMENTS (low confidence matches) ===\n";
      for (const r of weakReqs) {
        gapContext += `- [${r.category}] ${r.text} (best match: ${bestScoreByReq[r.id]}%)\n`;
      }
      gapContext += "\n";
    }

    if (missingInfoRisks.length > 0) {
      gapContext += "=== IDENTIFIED INFORMATION GAPS ===\n";
      for (const r of missingInfoRisks) {
        gapContext += `- [${r.severity}] ${r.description}\n`;
      }
      gapContext += "\n";
    }

    if (ambiguityRisks.length > 0) {
      gapContext += "=== SCOPE AMBIGUITIES ===\n";
      for (const r of ambiguityRisks) {
        gapContext += `- [${r.severity}] ${r.description}\n`;
      }
      gapContext += "\n";
    }

    if (unclearDeadlines.length > 0) {
      gapContext += "=== UNCLEAR DEADLINES ===\n";
      for (const d of unclearDeadlines) {
        gapContext += `- ${d.deadline_type}: due ${d.due_at}, no description provided\n`;
      }
      gapContext += "\n";
    }

    // All deadlines for context
    if ((deadlines || []).length > 0) {
      gapContext += "=== ALL DEADLINES (for context) ===\n";
      for (const d of deadlines || []) {
        gapContext += `- ${d.deadline_type}: ${d.description || "(no description)"} (${d.due_at})\n`;
      }
      gapContext += "\n";
    }

    // Risk summary
    const allRisks = risks || [];
    const highCritical = allRisks.filter(
      (r) => r.severity === "high" || r.severity === "critical",
    );
    gapContext += `=== OVERALL RISK PROFILE ===\n`;
    gapContext += `Total risks: ${allRisks.length}, High/Critical: ${highCritical.length}\n`;
    gapContext += `Total requirements: ${allReqs.length}, Covered: ${matchedReqIds.size}, Uncovered: ${uncoveredReqs.length}, Weak: ${weakReqs.length}\n`;

    if (gapContext.trim() === "") {
      gapContext = "No significant gaps or ambiguities were detected in the tender analysis.";
    }

    console.log(
      `[generate-clarification-questions] Gaps: ${uncoveredReqs.length} uncovered, ${weakReqs.length} weak, ${missingInfoRisks.length} missing info, ${ambiguityRisks.length} ambiguities`,
    );

    // ── Call OpenAI ───────────────────────────────────────────────

    const result = await generateQuestions(
      gapContext,
      tender.title,
      tender.issuer,
      tender.language,
    );

    console.log(
      `[generate-clarification-questions] Generated ${result.questions.length} questions`,
    );

    // ── Save to DB ────────────────────────────────────────────────

    // Delete existing clarification questions (regeneration support)
    await adminClient
      .from("clarification_questions")
      .delete()
      .eq("tender_id", tender_id)
      .eq("organization_id", orgId);

    // Insert new questions
    if (result.questions.length > 0) {
      const rows = result.questions.map((q) => ({
        tender_id,
        organization_id: orgId,
        question_text: q.question_text,
        rationale: q.rationale || null,
        status: "draft",
      }));

      const { error: insertError } = await adminClient
        .from("clarification_questions")
        .insert(rows);

      if (insertError) {
        console.error(
          "[generate-clarification-questions] Insert error:",
          insertError.message,
        );
        throw new Error(`Failed to save questions: ${insertError.message}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        tender_id,
        count: result.questions.length,
        gaps_analyzed: {
          uncovered_requirements: uncoveredReqs.length,
          weak_coverage: weakReqs.length,
          missing_information: missingInfoRisks.length,
          scope_ambiguities: ambiguityRisks.length,
          unclear_deadlines: unclearDeadlines.length,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("[generate-clarification-questions] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
