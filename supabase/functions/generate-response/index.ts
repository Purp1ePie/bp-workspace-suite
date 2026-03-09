import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const OPENAI_MODEL = "gpt-4o";
const OPENAI_TIMEOUT_MS = 90000;
const MAX_CONTEXT_CHARS = 50000;
const GOOD_MATCH_THRESHOLD = 20;

// ── Types ────────────────────────────────────────────────────────────

interface DraftSection {
  section_title: string;
  draft_text: string;
}

interface GapItem {
  requirement_text: string;
  category: string;
  gap_reason: string;
}

interface DraftResult {
  sections: DraftSection[];
  gaps: GapItem[];
  executive_summary: string;
}

// ── OpenAI response drafting ─────────────────────────────────────────

async function draftWithOpenAI(
  requirementsByCategory: Record<
    string,
    Array<{
      text: string;
      mandatory: boolean;
      knowledgeContext: string[];
    }>
  >,
  tenderTitle: string,
  risksText: string,
  deadlinesText: string,
): Promise<DraftResult> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY secret is not configured");
  }

  const systemPrompt = `You are a senior bid writer and compliance expert for a Swiss IT services company. Your task is to draft professional, factually accurate bid response sections based EXCLUSIVELY on the company's knowledge assets provided below.

CRITICAL RULES — STRICT FACTUAL ACCURACY:
1. NEVER invent, fabricate, or assume information that is not present in the provided knowledge context
2. ONLY use facts, figures, project names, certifications, capabilities, and references that appear in the matched knowledge documents
3. If a requirement has NO matching knowledge context, do NOT draft a speculative answer — instead add it to the "gaps" array with a clear explanation of what evidence is missing
4. If a requirement has PARTIAL knowledge context (some relevant info but not enough to fully answer), draft only the parts you can substantiate and explicitly mark the rest as "[MANUELLE EINGABE ERFORDERLICH]" in the text, AND add it to gaps
5. Write in the SAME language as the requirements (German, English, French, or Italian)
6. Use a professional, confident but honest tone — it is better to acknowledge a gap than to fabricate an answer
7. Reference specific knowledge assets by name (project names, certifications, document titles) — this builds credibility
8. Keep each section focused and well-structured with bullet points or numbered lists where appropriate
9. Be specific and concrete — cite actual numbers, dates, project names, and capabilities from the knowledge assets
10. For mandatory requirements without coverage, clearly flag them as critical gaps

QUALITY STANDARDS:
- Every claim in the response must be traceable to a provided knowledge document
- Prefer quoting specific evidence over making general statements
- If multiple knowledge assets support a requirement, synthesize them coherently
- Do not use generic filler text like "We have extensive experience in..." unless backed by specific evidence

OUTPUT FORMAT (JSON):
{
  "executive_summary": "A 2-3 paragraph executive summary based ONLY on substantiated strengths from the knowledge assets. Highlight key differentiators with concrete evidence.",
  "sections": [
    {
      "section_title": "Category Name",
      "draft_text": "Drafted response text addressing requirements in this category, using only facts from knowledge assets. Mark any gaps with [MANUELLE EINGABE ERFORDERLICH]."
    }
  ],
  "gaps": [
    {
      "requirement_text": "The requirement that lacks coverage",
      "category": "technical",
      "gap_reason": "Specific explanation: what evidence/document/certification is needed to answer this requirement"
    }
  ]
}

SECTION GUIDELINES:
- Create one section per requirement category provided
- Within each section, address each requirement individually
- When knowledge context is provided, weave it naturally into the response with specific references
- When NO knowledge context exists: do NOT draft a response — add it to gaps with actionable gap_reason
- When PARTIAL knowledge exists: draft what you can substantiate, mark the rest with [MANUELLE EINGABE ERFORDERLICH], and add to gaps
- Every gap entry must have an actionable gap_reason explaining exactly what document/evidence the team needs to provide`;

  // Build the user prompt with all requirements and context
  let userPrompt = `TENDER: "${tenderTitle}"\n\n`;

  if (deadlinesText) {
    userPrompt += `KEY DEADLINES:\n${deadlinesText}\n\n`;
  }
  if (risksText) {
    userPrompt += `IDENTIFIED RISKS:\n${risksText}\n\n`;
  }

  userPrompt += `REQUIREMENTS BY CATEGORY (with matched knowledge context where available):\n\n`;

  for (const [category, reqs] of Object.entries(requirementsByCategory)) {
    userPrompt += `=== ${category.toUpperCase()} ===\n`;
    for (let i = 0; i < reqs.length; i++) {
      const r = reqs[i];
      userPrompt += `\nRequirement ${i + 1}${r.mandatory ? " [MANDATORY]" : ""}:\n${r.text}\n`;
      if (r.knowledgeContext.length > 0) {
        userPrompt += `\nMatched knowledge context:\n`;
        for (const ctx of r.knowledgeContext) {
          userPrompt += `---\n${ctx}\n---\n`;
        }
      } else {
        userPrompt += `[NO KNOWLEDGE ASSETS FOUND — Do NOT draft a response. Add this requirement to the gaps array.]\n`;
      }
    }
    userPrompt += "\n";
  }

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
        temperature: 0.15,
        max_tokens: 8000,
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

    const parsed = JSON.parse(content) as DraftResult;

    // Validate structure
    if (!parsed.sections || !Array.isArray(parsed.sections)) {
      parsed.sections = [];
    }
    if (!parsed.gaps || !Array.isArray(parsed.gaps)) {
      parsed.gaps = [];
    }
    if (!parsed.executive_summary) {
      parsed.executive_summary = "";
    }

    // Filter out invalid sections
    parsed.sections = parsed.sections.filter(
      (s) => s.section_title && s.draft_text,
    );

    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Main handler ─────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { tender_id } = await req.json();
    if (!tender_id) {
      return new Response(
        JSON.stringify({ error: "tender_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Auth
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
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Get user profile for org_id
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

    // Load tender
    const { data: tender, error: tenderError } = await adminClient
      .from("tenders")
      .select("id, title, organization_id, status")
      .eq("id", tender_id)
      .eq("organization_id", orgId)
      .single();
    if (tenderError || !tender) {
      return new Response(
        JSON.stringify({ error: "Tender not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`[generate-response] Starting for tender: ${tender.title} (${tender_id})`);

    // ── Load all data ──────────────────────────────────────────────

    // Requirements
    const { data: requirements } = await adminClient
      .from("requirements")
      .select("id, category, text, mandatory")
      .eq("tender_id", tender_id)
      .eq("organization_id", orgId)
      .order("category");

    if (!requirements || requirements.length === 0) {
      return new Response(
        JSON.stringify({
          error: "No requirements found. Process the tender first.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Requirement matches with knowledge asset text
    const { data: matches } = await adminClient
      .from("requirement_matches")
      .select(
        "requirement_id, confidence_score, knowledge_asset_id",
      )
      .eq("tender_id", tender_id)
      .eq("organization_id", orgId)
      .order("confidence_score", { ascending: false });

    // Load knowledge assets for matched IDs
    const matchedAssetIds = [
      ...new Set((matches || []).map((m) => m.knowledge_asset_id)),
    ];
    let knowledgeAssets: Record<string, { title: string; extracted_text: string | null; asset_type: string }> = {};
    if (matchedAssetIds.length > 0) {
      const { data: assets } = await adminClient
        .from("knowledge_assets")
        .select("id, title, extracted_text, asset_type")
        .in("id", matchedAssetIds);
      if (assets) {
        for (const a of assets) {
          knowledgeAssets[a.id] = {
            title: a.title,
            extracted_text: a.extracted_text,
            asset_type: a.asset_type,
          };
        }
      }
    }

    // Deadlines
    const { data: deadlines } = await adminClient
      .from("deadlines")
      .select("deadline_type, due_at, description")
      .eq("tender_id", tender_id)
      .eq("organization_id", orgId)
      .order("due_at");

    // Risks
    const { data: risks } = await adminClient
      .from("risks")
      .select("risk_type, severity, description")
      .eq("tender_id", tender_id)
      .eq("organization_id", orgId)
      .order("severity");

    // ── Compute fit score ──────────────────────────────────────────

    const matchesByReq: Record<string, number> = {};
    for (const m of matches || []) {
      if (
        !matchesByReq[m.requirement_id] ||
        Number(m.confidence_score) > matchesByReq[m.requirement_id]
      ) {
        matchesByReq[m.requirement_id] = Number(m.confidence_score);
      }
    }

    let totalMatchedScore = 0;
    let coveredCount = 0;
    for (const req of requirements) {
      const bestScore = matchesByReq[req.id] || 0;
      if (bestScore >= GOOD_MATCH_THRESHOLD) {
        totalMatchedScore += bestScore;
        coveredCount++;
      }
    }
    // Fit score = average quality of matched requirements (not penalized by unmatched ones)
    // Coverage percent separately shows how many requirements have matches
    const fitScore = coveredCount > 0 ? Math.round(totalMatchedScore / coveredCount) : 0;
    const coveragePercent = Math.round(
      (coveredCount / requirements.length) * 100,
    );

    console.log(
      `[generate-response] Fit score: ${fitScore}, Coverage: ${coveragePercent}% (${coveredCount}/${requirements.length})`,
    );

    // ── Build requirement context for AI ───────────────────────────

    const requirementsByCategory: Record<
      string,
      Array<{
        text: string;
        mandatory: boolean;
        knowledgeContext: string[];
      }>
    > = {};

    let totalContextChars = 0;

    for (const req of requirements) {
      const cat = req.category || "general";
      if (!requirementsByCategory[cat]) {
        requirementsByCategory[cat] = [];
      }

      // Get matched knowledge text for this requirement
      const reqMatches = (matches || [])
        .filter((m) => m.requirement_id === req.id)
        .sort((a, b) => Number(b.confidence_score) - Number(a.confidence_score));

      const knowledgeContext: string[] = [];
      for (const rm of reqMatches) {
        const asset = knowledgeAssets[rm.knowledge_asset_id];
        if (asset) {
          let ctx = `[${asset.asset_type}] ${asset.title}`;
          if (asset.extracted_text) {
            const remaining = MAX_CONTEXT_CHARS - totalContextChars;
            if (remaining > 200) {
              const snippet = asset.extracted_text.slice(
                0,
                Math.min(3000, remaining),
              );
              ctx += `\n${snippet}`;
              totalContextChars += snippet.length;
            }
          }
          knowledgeContext.push(ctx);
        }
      }

      requirementsByCategory[cat].push({
        text: req.text,
        mandatory: req.mandatory,
        knowledgeContext,
      });
    }

    // Build deadline/risk text summaries
    const deadlinesText = (deadlines || [])
      .map(
        (d) =>
          `- ${d.deadline_type}: ${d.description || ""} (${new Date(d.due_at).toLocaleDateString("de-CH")})`,
      )
      .join("\n");

    const risksText = (risks || [])
      .map((r) => `- [${r.severity?.toUpperCase()}] ${r.risk_type}: ${r.description}`)
      .join("\n");

    // ── Call OpenAI for response drafting ───────────────────────────

    let draftResult: DraftResult = {
      sections: [],
      gaps: [],
      executive_summary: "",
    };

    try {
      console.log(
        `[generate-response] Calling OpenAI for ${requirements.length} requirements across ${Object.keys(requirementsByCategory).length} categories`,
      );
      draftResult = await draftWithOpenAI(
        requirementsByCategory,
        tender.title,
        risksText,
        deadlinesText,
      );
      console.log(
        `[generate-response] OpenAI returned ${draftResult.sections.length} sections, ${draftResult.gaps.length} gaps`,
      );
    } catch (aiError) {
      console.error(`[generate-response] OpenAI error: ${aiError}`);
      // Non-fatal: continue with empty drafts, still compute fit score and checklist
    }

    // ── Delete existing data for reprocessing ──────────────────────

    await adminClient
      .from("response_sections")
      .delete()
      .eq("tender_id", tender_id)
      .eq("organization_id", orgId);

    await adminClient
      .from("checklist_items")
      .delete()
      .eq("tender_id", tender_id)
      .eq("organization_id", orgId);

    // ── Insert response sections ───────────────────────────────────

    const sectionsToInsert: Array<{
      tender_id: string;
      organization_id: string;
      section_title: string;
      draft_text: string | null;
      review_status: string;
    }> = [];

    // Executive Summary first
    if (draftResult.executive_summary) {
      sectionsToInsert.push({
        tender_id,
        organization_id: orgId,
        section_title: "Executive Summary",
        draft_text: draftResult.executive_summary,
        review_status: "draft",
      });
    }

    // Category sections
    for (const section of draftResult.sections) {
      sectionsToInsert.push({
        tender_id,
        organization_id: orgId,
        section_title: section.section_title,
        draft_text: section.draft_text,
        review_status: "draft",
      });
    }

    // Gap report section (if any gaps)
    if (draftResult.gaps.length > 0) {
      const gapReport = draftResult.gaps
        .map(
          (g) =>
            `**${g.category}**: ${g.requirement_text}\n  → ${g.gap_reason}`,
        )
        .join("\n\n");

      sectionsToInsert.push({
        tender_id,
        organization_id: orgId,
        section_title: "Coverage Gaps",
        draft_text: `The following requirements lack sufficient knowledge asset coverage and need manual attention:\n\n${gapReport}`,
        review_status: "draft",
      });
    }

    if (sectionsToInsert.length > 0) {
      const { error: insertError } = await adminClient
        .from("response_sections")
        .insert(sectionsToInsert);
      if (insertError) {
        console.error(
          `[generate-response] Error inserting sections: ${insertError.message}`,
        );
      }
    }

    // ── Generate checklist items ───────────────────────────────────

    const checklistItems: Array<{
      tender_id: string;
      organization_id: string;
      title: string;
      due_at: string | null;
      status: string;
    }> = [];

    // From deadlines
    for (const d of deadlines || []) {
      checklistItems.push({
        tender_id,
        organization_id: orgId,
        title: `${d.deadline_type === "submission" ? "Submit bid" : d.deadline_type}: ${d.description || "Deadline"}`,
        due_at: d.due_at,
        status: "open",
      });
    }

    // From requirement categories - one checklist per category
    const categories = Object.keys(requirementsByCategory);
    for (const cat of categories) {
      const reqs = requirementsByCategory[cat];
      const mandatoryCount = reqs.filter((r) => r.mandatory).length;
      checklistItems.push({
        tender_id,
        organization_id: orgId,
        title: `Draft ${cat} responses (${reqs.length} requirements, ${mandatoryCount} mandatory)`,
        due_at: null,
        status: draftResult.sections.length > 0 ? "done" : "open",
      });
    }

    // Review and finalize
    checklistItems.push({
      tender_id,
      organization_id: orgId,
      title: "Review all drafted response sections",
      due_at: null,
      status: "open",
    });

    // From gaps
    for (const gap of draftResult.gaps) {
      checklistItems.push({
        tender_id,
        organization_id: orgId,
        title: `Fill gap: ${gap.gap_reason.slice(0, 120)}`,
        due_at: null,
        status: "open",
      });
    }

    // From high/critical risks
    for (const r of risks || []) {
      if (r.severity === "high" || r.severity === "critical") {
        checklistItems.push({
          tender_id,
          organization_id: orgId,
          title: `Address ${r.severity} risk: ${(r.description || "").slice(0, 100)}`,
          due_at: null,
          status: "open",
        });
      }
    }

    // Final submission checklist item
    const submissionDeadline = (deadlines || []).find(
      (d) => d.deadline_type === "submission",
    );
    checklistItems.push({
      tender_id,
      organization_id: orgId,
      title: "Final review and approval before submission",
      due_at: submissionDeadline?.due_at || null,
      status: "open",
    });

    if (checklistItems.length > 0) {
      const { error: checklistError } = await adminClient
        .from("checklist_items")
        .insert(checklistItems);
      if (checklistError) {
        console.error(
          `[generate-response] Error inserting checklist: ${checklistError.message}`,
        );
      }
    }

    // ── Update tender fit_score ─────────────────────────────────────

    const { error: updateError } = await adminClient
      .from("tenders")
      .update({ fit_score: fitScore, updated_at: new Date().toISOString() })
      .eq("id", tender_id);

    if (updateError) {
      console.error(
        `[generate-response] Error updating fit_score: ${updateError.message}`,
      );
    }

    // ── Response ────────────────────────────────────────────────────

    const result = {
      success: true,
      tender_id,
      fit_score: fitScore,
      coverage_percent: coveragePercent,
      requirements_total: requirements.length,
      requirements_covered: coveredCount,
      sections_generated: sectionsToInsert.length,
      gaps_found: draftResult.gaps.length,
      checklist_items_created: checklistItems.length,
      risks_count: (risks || []).length,
      high_risks: (risks || []).filter(
        (r) => r.severity === "high" || r.severity === "critical",
      ).length,
    };

    console.log(`[generate-response] Complete:`, JSON.stringify(result));

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(`[generate-response] Fatal error: ${error}`);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
