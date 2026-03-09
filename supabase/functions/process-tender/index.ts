import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractText, getDocumentProxy } from "unpdf";
import { unzipSync } from "fflate";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OPENAI_MODEL = "gpt-4o";
const MAX_EXTRACTION_CHARS = 60000;
const OPENAI_TIMEOUT_MS = 90000;

interface ExtractedRequirement {
  category: string;
  text: string;
  mandatory: boolean;
}

interface ExtractedDeadline {
  deadline_type: string;
  due_at: string;
  description: string;
}

interface ExtractedRisk {
  title: string;
  risk_type: string;
  severity: string;
  description: string;
}

interface TenderMetadata {
  title: string | null;
  issuer: string | null;
  description: string | null;
  submission_deadline: string | null;
}

interface ExtractionResult {
  tender_metadata: TenderMetadata;
  requirements: ExtractedRequirement[];
  deadlines: ExtractedDeadline[];
  risks: ExtractedRisk[];
}

async function extractWithOpenAI(
  combinedText: string,
  tenderTitle: string,
  outputLanguage?: string,
): Promise<ExtractionResult> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY secret is not configured");
  }

  const langMap: Record<string, string> = { de: "German", en: "English", fr: "French", it: "Italian" };
  const outputLang = langMap[outputLanguage || ""] || "German";

  const systemPrompt = `You are an expert procurement analyst specializing in public and private tender documents (especially Swiss public procurement / Ausschreibungen). Your task is to extract structured data from tender document text.

The tender documents may be written in any language. CRITICAL: You MUST write ALL text fields (titles, descriptions, requirement texts) in ${outputLang}. Even if the document is in a different language, translate and write your output in ${outputLang}.

Extract the following:

## Tender Metadata
Extract basic information about the tender:
- "title": The official title or name of the tender/project (null if not found)
- "issuer": The organization issuing the tender / Auftraggeber (null if not found)
- "description": A brief summary of what the tender is about, 1-3 sentences in ${outputLang} (null if not found)
- "submission_deadline": The submission deadline as ISO 8601 datetime (null if not found). Use the FINAL submission/Eingabefrist date, not question deadlines.

## Requirements
Identify ALL requirements the bidder must fulfill. Be thorough — extract EVERY requirement mentioned, including eligibility criteria (Eignungskriterien), technical specifications, and administrative requirements. For each:
- "category": One of "technical", "commercial", "eligibility", "administrative", "legal"
  - technical: technical specifications, service descriptions, implementation requirements, SLAs, quality standards, architecture, infrastructure
  - commercial: pricing format, payment terms, financial conditions, insurance requirements
  - eligibility: bidder qualifications, company requirements, certifications needed, reference projects required, financial standing, team qualifications, Eignungskriterien, sustainability requirements
  - administrative: forms to fill, documents to submit, formatting requirements, project methodology, project management
  - legal: legal compliance, NDAs, contract terms, regulatory requirements, data protection, privacy
- "text": The requirement described clearly and concisely in ${outputLang} (one sentence, max 250 characters). Each requirement should be a DISTINCT item — do not merge multiple requirements into one.
- "mandatory": true if the document uses words like "must", "shall", "required", "mandatory", "muss", "zwingend", "obligatoire", "obbligatorio", or similar. false if optional/recommended ("soll", "should", "empfohlen").

IMPORTANT: Extract EVERY individual requirement. If a document has 30 requirements, return 30 items. Do NOT summarize or merge requirements. Include eligibility criteria (Eignungskriterien) as separate requirement items with category "eligibility".

## Deadlines
Identify all dates and deadlines mentioned. For each:
- "deadline_type": One of "submission", "clarification", "site_visit", "q_and_a", "award", "contract_start", "other"
- "due_at": ISO 8601 datetime string (e.g. "2025-06-15T17:00:00Z"). If only a date is given with no time, use T23:59:00Z. If the year is missing, assume the current or next upcoming year.
- "description": Brief description of what this deadline is for, in ${outputLang}.

## Risks
Identify potential risks or concerns a bidder should be aware of. For each:
- "title": A short, specific, human-readable title (max 60 chars) describing THIS particular risk in ${outputLang}. Be specific, e.g. "Einreichungsfrist nur 10 Arbeitstage" or "Konventionalstrafe von 5% bei Verzug" — NOT generic labels.
- "risk_type": One of "missing_information", "tight_deadline", "unusual_requirement", "high_penalty", "scope_ambiguity", "resource_intensive", "legal_risk", "financial_risk"
- "severity": One of "low", "medium", "high", "critical"
- "description": A clear, actionable description of the risk and what the bidder should consider, in ${outputLang} (2-3 sentences).

Return ONLY a valid JSON object with this exact structure (no markdown, no explanation, no wrapping):
{
  "tender_metadata": {"title": "...", "issuer": "...", "description": "...", "submission_deadline": "..."},
  "requirements": [...],
  "deadlines": [...],
  "risks": [...]
}

If you cannot find any items for a category, return an empty array for that category. Do not fabricate data that is not supported by the document text.`;

  const userPrompt = `Tender title: "${tenderTitle}"\n\nDocument text:\n${combinedText}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 12000,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${errorBody}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("OpenAI returned empty content");
    }

    console.log("OpenAI raw response length:", content.length);

    const parsed = JSON.parse(content) as ExtractionResult;

    if (!parsed.tender_metadata) parsed.tender_metadata = { title: null, issuer: null, description: null, submission_deadline: null };
    if (!Array.isArray(parsed.requirements)) parsed.requirements = [];
    if (!Array.isArray(parsed.deadlines)) parsed.deadlines = [];
    if (!Array.isArray(parsed.risks)) parsed.risks = [];

    // Validate category values
    const validCategories = new Set(["technical", "commercial", "eligibility", "administrative", "legal"]);
    parsed.requirements = parsed.requirements.map((r) => ({
      ...r,
      category: validCategories.has(r.category) ? r.category : "technical",
    }));

    parsed.deadlines = parsed.deadlines.filter((d) => {
      try {
        const date = new Date(d.due_at);
        return !isNaN(date.getTime());
      } catch {
        console.warn("Dropping deadline with invalid date:", d.due_at);
        return false;
      }
    });

    const validSeverities = new Set(["low", "medium", "high", "critical"]);
    parsed.risks = parsed.risks.map((r) => ({
      ...r,
      severity: validSeverities.has(r.severity) ? r.severity : "medium",
    }));

    return parsed;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("OpenAI API request timed out after " + OPENAI_TIMEOUT_MS + "ms");
    }
    throw err;
  }
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function truncate(input: string, max = 50000): string {
  return input.length > max ? input.slice(0, max) : input;
}

function getExtension(path: string): string {
  const parts = path.toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() || "" : "";
}

async function readPdf(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const result = await extractText(pdf, { mergePages: true });
  const text = typeof result.text === "string" ? result.text : result.text.join("\n");
  console.log("PDF parsed:", result.totalPages, "pages,", text.length, "chars");
  return text;
}

/** Extract text content from XML tags, handling nested tags and XML entities */
function extractXmlText(xml: string): string {
  return xml
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function readDocx(bytes: Uint8Array): string {
  const unzipped = unzipSync(bytes);
  const docXml = unzipped["word/document.xml"];
  if (!docXml) {
    throw new Error("Invalid DOCX: word/document.xml not found");
  }
  const xmlString = new TextDecoder().decode(docXml);
  const paragraphs: string[] = [];
  // Match <w:p ...>...</w:p> paragraphs (handles both w:p and default namespace)
  const pRegex = /<w:p[\s>][\s\S]*?<\/w:p>/g;
  let pMatch;
  while ((pMatch = pRegex.exec(xmlString)) !== null) {
    // Extract all <w:t> text within this paragraph
    const tRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
    const paraText: string[] = [];
    let tMatch;
    while ((tMatch = tRegex.exec(pMatch[0])) !== null) {
      const text = extractXmlText(tMatch[1]);
      if (text) paraText.push(text);
    }
    if (paraText.length > 0) {
      paragraphs.push(paraText.join(""));
    }
  }
  const text = paragraphs.join("\n");
  console.log("DOCX parsed:", paragraphs.length, "paragraphs,", text.length, "chars");
  return text;
}

function readXlsx(bytes: Uint8Array): string {
  const unzipped = unzipSync(bytes);

  // Parse shared strings using regex
  const sharedStrings: string[] = [];
  const ssFile = unzipped["xl/sharedStrings.xml"];
  if (ssFile) {
    const ssXml = new TextDecoder().decode(ssFile);
    const siRegex = /<si[\s>][\s\S]*?<\/si>/g;
    let siMatch;
    while ((siMatch = siRegex.exec(ssXml)) !== null) {
      const tRegex = /<t[^>]*>([\s\S]*?)<\/t>/g;
      const parts: string[] = [];
      let tMatch;
      while ((tMatch = tRegex.exec(siMatch[0])) !== null) {
        parts.push(extractXmlText(tMatch[1]));
      }
      sharedStrings.push(parts.join(""));
    }
  }

  // Parse each worksheet
  const allRows: string[] = [];
  let sheetIndex = 1;
  while (true) {
    const sheetFile = unzipped[`xl/worksheets/sheet${sheetIndex}.xml`];
    if (!sheetFile) break;

    const sheetXml = new TextDecoder().decode(sheetFile);
    if (sheetIndex > 1) allRows.push(`\n--- Sheet ${sheetIndex} ---`);

    const rowRegex = /<row[\s>][\s\S]*?<\/row>/g;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
      const cellRegex = /<c\s[^>]*>[\s\S]*?<\/c>|<c\s[^>]*\/>/g;
      const cellValues: string[] = [];
      let cellMatch;
      while ((cellMatch = cellRegex.exec(rowMatch[0])) !== null) {
        const cellXml = cellMatch[0];
        const typeMatch = cellXml.match(/\bt="([^"]*)"/);
        const cellType = typeMatch ? typeMatch[1] : "";
        // Check for inline string
        const isMatch = cellXml.match(/<is[\s>][\s\S]*?<\/is>/);
        if (isMatch) {
          const tRegex2 = /<t[^>]*>([\s\S]*?)<\/t>/g;
          const parts: string[] = [];
          let tM;
          while ((tM = tRegex2.exec(isMatch[0])) !== null) {
            parts.push(extractXmlText(tM[1]));
          }
          if (parts.length > 0) cellValues.push(parts.join(""));
        } else {
          const vMatch = cellXml.match(/<v[^>]*>([\s\S]*?)<\/v>/);
          if (vMatch) {
            const raw = extractXmlText(vMatch[1]);
            if (cellType === "s") {
              const idx = parseInt(raw, 10);
              cellValues.push(sharedStrings[idx] || raw);
            } else {
              cellValues.push(raw);
            }
          }
        }
      }
      if (cellValues.length > 0) {
        allRows.push(cellValues.join("\t"));
      }
    }
    sheetIndex++;
  }

  const text = allRows.join("\n");
  console.log("XLSX parsed:", sheetIndex - 1, "sheets,", text.length, "chars");
  return text;
}

async function readTextFromFile(
  bytes: Uint8Array,
  extension: string,
): Promise<{ text: string | null; error: string | null }> {
  try {
    if (extension === "pdf") {
      const text = await readPdf(bytes);
      if (!text || text.trim().length === 0) {
        return { text: null, error: "PDF contains no extractable text (may be scanned/image-based)" };
      }
      return { text: truncate(text), error: null };
    }

    if (extension === "docx") {
      const text = readDocx(bytes);
      if (!text || text.trim().length === 0) {
        return { text: null, error: "DOCX contains no extractable text" };
      }
      return { text: truncate(text), error: null };
    }

    if (extension === "xlsx" || extension === "xls") {
      const text = readXlsx(bytes);
      if (!text || text.trim().length === 0) {
        return { text: null, error: "Excel file contains no extractable text" };
      }
      return { text: truncate(text), error: null };
    }

    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);

    if (["txt", "md", "csv", "json", "xml", "yaml", "yml"].includes(extension)) {
      return { text: truncate(decoded), error: null };
    }

    if (["html", "htm"].includes(extension)) {
      return { text: truncate(stripHtml(decoded)), error: null };
    }

    return {
      text: null,
      error: `Unsupported file type for current parser: .${extension}`,
    };
  } catch (err) {
    return {
      text: null,
      error: `Failed to parse .${extension} file: ${String(err)}`,
    };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    console.log("process-tender invoked");

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
    console.log("process-tender payload:", { tender_id });

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
      .select("id, organization_id, title, status, language")
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

    console.log("Tender loaded:", tender);

    await adminClient
      .from("tenders")
      .update({ status: "analyzing" })
      .eq("id", tender_id);

    console.log("Loading tender documents");

    const { data: documents, error: docsError } = await adminClient
      .from("tender_documents")
      .select("id, file_name, storage_path, parse_status")
      .eq("tender_id", tender_id);

    if (docsError) {
      console.error("Could not load tender documents", docsError);
      return new Response(
        JSON.stringify({ error: "Could not load tender documents", details: docsError }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    console.log("Found documents:", documents?.length ?? 0, documents);

    if (!documents || documents.length === 0) {
      console.log("No documents found, marking tender ready_for_review");

      await adminClient
        .from("tenders")
        .update({ status: "ready_for_review" })
        .eq("id", tender_id);

      return new Response(
        JSON.stringify({
          success: true,
          message: "No documents found for this tender",
          tender_id,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const documentIds = documents.map((doc) => doc.id);

    console.log("Marking documents as processing", documentIds);
    await adminClient
      .from("tender_documents")
      .update({ parse_status: "processing" })
      .in("id", documentIds);

    console.log("Parsing tender documents");
    for (const doc of documents) {
      console.log("Processing document:", doc.id, doc.file_name, doc.storage_path);

      if (!doc.storage_path) {
        console.error("No storage_path for document", doc.id);
        await adminClient
          .from("tender_documents")
          .update({
            parse_status: "failed",
            parse_error: "No storage_path found on document",
          })
          .eq("id", doc.id);
        continue;
      }

      const { data: fileData, error: downloadError } = await adminClient
        .storage
        .from("tender-files")
        .download(doc.storage_path);

      if (downloadError || !fileData) {
        console.error("Storage download failed for", doc.file_name, downloadError);
        await adminClient
          .from("tender_documents")
          .update({
            parse_status: "failed",
            parse_error: `Storage download failed: ${downloadError?.message || "unknown error"}`,
          })
          .eq("id", doc.id);
        continue;
      }

      const bytes = new Uint8Array(await fileData.arrayBuffer());
      const extension = getExtension(doc.storage_path);
      console.log("Extracting text from", doc.file_name, "extension:", extension);

      const { text, error: parseError } = await readTextFromFile(bytes, extension);

      if (!text) {
        console.error("Parse failed for", doc.file_name, parseError);
        await adminClient
          .from("tender_documents")
          .update({
            parse_status: "failed",
            parse_error: parseError,
          })
          .eq("id", doc.id);
        continue;
      }

      console.log("Document parsed:", doc.file_name, text.length, "chars");
      await adminClient
        .from("tender_documents")
        .update({
          parse_status: "parsed",
          parsed_text: text,
          parse_error: null,
        })
        .eq("id", doc.id);
    }

    // --- AI Extraction Phase ---
    console.log("Gathering parsed text for AI extraction");

    const { data: parsedDocs } = await adminClient
      .from("tender_documents")
      .select("id, file_name, parsed_text")
      .eq("tender_id", tender_id)
      .eq("parse_status", "parsed")
      .not("parsed_text", "is", null);

    const textParts: string[] = [];
    if (parsedDocs) {
      for (const doc of parsedDocs) {
        if (doc.parsed_text) {
          textParts.push(`--- Document: ${doc.file_name} ---\n${doc.parsed_text}`);
        }
      }
    }

    const combined = textParts.join("\n\n");
    const combinedText = combined.length > MAX_EXTRACTION_CHARS
      ? combined.slice(0, MAX_EXTRACTION_CHARS) + "\n[... text truncated ...]"
      : combined;

    if (!combinedText || combinedText.trim().length === 0) {
      console.log("No parsed text available for extraction, skipping AI step");
    } else {
      console.log("Combined text for extraction:", combinedText.length, "chars");

      // Delete existing data to support reprocessing (requirement_matches cascades via FK)
      console.log("Deleting existing requirements, deadlines, and risks for reprocessing");
      await adminClient.from("requirements").delete().eq("tender_id", tender_id);
      await adminClient.from("deadlines").delete().eq("tender_id", tender_id);
      await adminClient.from("risks").delete().eq("tender_id", tender_id);

      try {
        console.log("Calling OpenAI for extraction");
        const extraction = await extractWithOpenAI(combinedText, tender.title || "Untitled Tender", tender.language || "de");

        console.log("Extraction results:", {
          requirements: extraction.requirements.length,
          deadlines: extraction.deadlines.length,
          risks: extraction.risks.length,
        });

        if (extraction.requirements.length > 0) {
          const reqRows = extraction.requirements.map((r) => ({
            tender_id,
            organization_id: tender.organization_id,
            category: r.category,
            text: r.text,
            mandatory: r.mandatory,
          }));
          const { error: reqError } = await adminClient.from("requirements").insert(reqRows);
          if (reqError) console.error("Failed to insert requirements:", reqError);
          else console.log("Inserted", reqRows.length, "requirements");
        }

        if (extraction.deadlines.length > 0) {
          const dlRows = extraction.deadlines.map((d) => ({
            tender_id,
            organization_id: tender.organization_id,
            deadline_type: d.deadline_type,
            due_at: d.due_at,
            description: d.description,
          }));
          const { error: dlError } = await adminClient.from("deadlines").insert(dlRows);
          if (dlError) console.error("Failed to insert deadlines:", dlError);
          else console.log("Inserted", dlRows.length, "deadlines");
        }

        if (extraction.risks.length > 0) {
          const riskRows = extraction.risks.map((r) => ({
            tender_id,
            organization_id: tender.organization_id,
            title: r.title || null,
            risk_type: r.risk_type,
            severity: r.severity,
            description: r.description,
          }));
          const { error: riskError } = await adminClient.from("risks").insert(riskRows);
          if (riskError) console.error("Failed to insert risks:", riskError);
          else console.log("Inserted", riskRows.length, "risks");
        }

        // Auto-fill tender metadata from extraction
        const meta = extraction.tender_metadata;
        if (meta) {
          const updates: Record<string, unknown> = {};
          // Always update title from AI extraction — AI-detected title is more accurate
          if (meta.title) {
            updates.title = meta.title;
          }
          if (meta.issuer) {
            // Always update issuer since it's typically null
            updates.issuer = meta.issuer;
          }
          if (meta.description) {
            updates.description = meta.description;
          }
          if (meta.submission_deadline) {
            try {
              const dl = new Date(meta.submission_deadline);
              if (!isNaN(dl.getTime())) {
                updates.deadline = dl.toISOString();
              }
            } catch {
              console.warn("Invalid submission_deadline from extraction:", meta.submission_deadline);
            }
          }
          if (Object.keys(updates).length > 0) {
            console.log("Auto-filling tender metadata:", updates);
            const { error: metaError } = await adminClient
              .from("tenders")
              .update(updates)
              .eq("id", tender_id);
            if (metaError) console.error("Failed to update tender metadata:", metaError);
            else console.log("Tender metadata updated successfully");
          }
        }
      } catch (aiError) {
        console.error("AI extraction failed, continuing without extraction:", aiError);
      }
    }

    console.log("Marking tender ready_for_review");
    await adminClient
      .from("tenders")
      .update({ status: "ready_for_review" })
      .eq("id", tender_id);

    console.log("Tender processed successfully", {
      tender_id,
      processed_documents: documents.length,
    });

    return new Response(
      JSON.stringify({
        success: true,
        tender_id,
        processed_documents: documents.length,
        message: "Tender processed successfully",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("process-tender error:", error);

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