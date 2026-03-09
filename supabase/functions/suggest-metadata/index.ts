import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractText, getDocumentProxy } from "unpdf";
import { unzipSync } from "fflate";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_TEXT_FOR_AI = 8000;

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function truncate(input: string, max = MAX_TEXT_FOR_AI): string {
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
  return text;
}

function readDocx(bytes: Uint8Array): string {
  const unzipped = unzipSync(bytes);
  const docXml = unzipped["word/document.xml"];
  if (!docXml) throw new Error("Invalid DOCX: word/document.xml not found");
  const xmlString = new TextDecoder().decode(docXml);
  const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const doc = new DOMParser().parseFromString(xmlString, "text/xml");
  const paragraphs: string[] = [];
  const pElements = doc.getElementsByTagNameNS(ns, "p");
  for (let i = 0; i < pElements.length; i++) {
    const tElements = pElements[i].getElementsByTagNameNS(ns, "t");
    const paraText: string[] = [];
    for (let j = 0; j < tElements.length; j++) {
      if (tElements[j].textContent) paraText.push(tElements[j].textContent!);
    }
    if (paraText.length > 0) paragraphs.push(paraText.join(""));
  }
  return paragraphs.join("\n");
}

function readXlsx(bytes: Uint8Array): string {
  const unzipped = unzipSync(bytes);
  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const sharedStrings: string[] = [];
  const ssFile = unzipped["xl/sharedStrings.xml"];
  if (ssFile) {
    const ssDoc = new DOMParser().parseFromString(new TextDecoder().decode(ssFile), "text/xml");
    const siElements = ssDoc.getElementsByTagNameNS(ns, "si");
    for (let i = 0; i < siElements.length; i++) {
      const tElements = siElements[i].getElementsByTagNameNS(ns, "t");
      const parts: string[] = [];
      for (let j = 0; j < tElements.length; j++) {
        if (tElements[j].textContent) parts.push(tElements[j].textContent!);
      }
      sharedStrings.push(parts.join(""));
    }
  }
  const allRows: string[] = [];
  let sheetIndex = 1;
  while (true) {
    const sheetFile = unzipped[`xl/worksheets/sheet${sheetIndex}.xml`];
    if (!sheetFile) break;
    const sheetDoc = new DOMParser().parseFromString(new TextDecoder().decode(sheetFile), "text/xml");
    if (sheetIndex > 1) allRows.push(`\n--- Sheet ${sheetIndex} ---`);
    const rowElements = sheetDoc.getElementsByTagNameNS(ns, "row");
    for (let r = 0; r < rowElements.length; r++) {
      const cells = rowElements[r].getElementsByTagNameNS(ns, "c");
      const cellValues: string[] = [];
      for (let c = 0; c < cells.length; c++) {
        const cellType = cells[c].getAttribute("t");
        const vElements = cells[c].getElementsByTagNameNS(ns, "v");
        if (vElements.length > 0 && vElements[0].textContent) {
          const raw = vElements[0].textContent!;
          cellValues.push(cellType === "s" ? (sharedStrings[parseInt(raw, 10)] || raw) : raw);
        }
      }
      if (cellValues.length > 0) allRows.push(cellValues.join("\t"));
    }
    sheetIndex++;
  }
  return allRows.join("\n");
}

async function readTextFromFile(
  bytes: Uint8Array,
  extension: string,
): Promise<{ text: string | null; error: string | null }> {
  try {
    if (extension === "pdf") {
      const text = await readPdf(bytes);
      if (!text || text.trim().length === 0) return { text: null, error: "PDF contains no extractable text" };
      return { text: truncate(text), error: null };
    }
    if (extension === "docx") {
      const text = readDocx(bytes);
      if (!text || text.trim().length === 0) return { text: null, error: "DOCX contains no extractable text" };
      return { text: truncate(text), error: null };
    }
    if (extension === "xlsx" || extension === "xls") {
      const text = readXlsx(bytes);
      if (!text || text.trim().length === 0) return { text: null, error: "Excel file contains no extractable text" };
      return { text: truncate(text), error: null };
    }
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    if (["txt", "md", "csv", "json", "xml", "yaml", "yml"].includes(extension)) {
      return { text: truncate(decoded), error: null };
    }
    if (["html", "htm"].includes(extension)) {
      return { text: truncate(stripHtml(decoded)), error: null };
    }
    return { text: null, error: `Unsupported file type: .${extension}` };
  } catch (err) {
    return { text: null, error: `Failed to parse .${extension}: ${String(err)}` };
  }
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function callOpenAI(systemPrompt: string, userContent: string): Promise<any> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("No content in OpenAI response");
  return JSON.parse(content);
}

const KNOWLEDGE_SYSTEM_PROMPT = `You analyze company knowledge documents and suggest metadata for categorization.
Given the extracted text from a document file (and its filename), return a JSON object with:
- "title": A concise, descriptive title for this document (max 80 chars, in the document's language). Do not just repeat the filename.
- "asset_type": Exactly one of: reference, certificate, cv, policy, service_description, template, past_answer, past_tender
  reference = project references, customer testimonials, case studies
  certificate = ISO certs, quality certifications, awards, accreditations
  cv = resumes, team member profiles, competency profiles
  policy = company policies, guidelines, processes, quality manuals
  service_description = service catalogs, capability descriptions, product sheets
  template = document templates, form templates, proposal templates
  past_answer = previous bid responses, past tender submissions
  past_tender = completed tenders, past RFPs, previous Ausschreibungen that were submitted
- "tags": Array of 3-6 relevant keywords in the document's language

Return ONLY valid JSON.`;

const TENDER_SYSTEM_PROMPT = `You analyze tender/procurement documents (Ausschreibungen) and suggest metadata.
Given extracted text from one or more tender document files, return a JSON object with:
- "title": A concise title for this tender/procurement (max 100 chars, in the document's language)
- "issuer": The contracting authority or organization name issuing the tender
- "deadline": The submission deadline in ISO 8601 format (e.g. "2026-04-15T17:00:00Z") if found, or null if not found
- "language": Primary language code: "de", "en", "fr", or "it"
- "tender_type": "public" or "private"

Return ONLY valid JSON.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    console.log("suggest-metadata invoked");

    // Auth
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

    const authClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: claimsData, error: claimsError } = await authClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Invalid JWT" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = String(claimsData.claims.sub);
    const { data: profile } = await authClient.from("profiles").select("organization_id").eq("id", userId).single();
    if (!profile?.organization_id) {
      return new Response(JSON.stringify({ error: "No organization" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { mode } = body;

    if (mode === "knowledge") {
      // Single file → knowledge asset metadata
      const { file_name, file_content_base64 } = body;
      if (!file_name || !file_content_base64) {
        return new Response(JSON.stringify({ error: "Missing file_name or file_content_base64" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const bytes = base64ToUint8Array(file_content_base64);
      const ext = getExtension(file_name);
      const { text, error: parseError } = await readTextFromFile(bytes, ext);

      if (!text) {
        return new Response(JSON.stringify({ success: false, error: parseError || "Could not extract text" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      console.log(`Knowledge mode: parsed ${file_name} (${ext}), ${text.length} chars`);

      const suggestions = await callOpenAI(
        KNOWLEDGE_SYSTEM_PROMPT,
        `Filename: ${file_name}\n\nExtracted text:\n${text}`,
      );

      // Validate and normalize
      const validTypes = ["reference", "certificate", "cv", "policy", "service_description", "template", "past_answer", "past_tender"];
      if (!validTypes.includes(suggestions.asset_type)) suggestions.asset_type = "reference";
      if (!Array.isArray(suggestions.tags)) suggestions.tags = [];
      if (!suggestions.title) suggestions.title = file_name.replace(/\.[^.]+$/, "");

      return new Response(JSON.stringify({ success: true, suggestions }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (mode === "tender") {
      // Multiple files → tender-level metadata
      const { files } = body;
      if (!Array.isArray(files) || files.length === 0) {
        return new Response(JSON.stringify({ error: "Missing files array" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Parse and combine text from all files (limit to first 3)
      const filesToProcess = files.slice(0, 3);
      const textParts: string[] = [];

      for (const f of filesToProcess) {
        if (!f.file_name || !f.file_content_base64) continue;
        const bytes = base64ToUint8Array(f.file_content_base64);
        const ext = getExtension(f.file_name);
        const { text } = await readTextFromFile(bytes, ext);
        if (text) {
          textParts.push(`--- File: ${f.file_name} ---\n${text}`);
        }
      }

      if (textParts.length === 0) {
        return new Response(JSON.stringify({ success: false, error: "Could not extract text from any file" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const combinedText = truncate(textParts.join("\n\n"), 12000);
      console.log(`Tender mode: parsed ${textParts.length} files, ${combinedText.length} chars combined`);

      const suggestions = await callOpenAI(TENDER_SYSTEM_PROMPT, combinedText);

      // Normalize
      if (!suggestions.title) suggestions.title = "";
      if (!suggestions.issuer) suggestions.issuer = "";
      if (!["de", "en", "fr", "it"].includes(suggestions.language)) suggestions.language = "de";
      if (!["public", "private"].includes(suggestions.tender_type)) suggestions.tender_type = "public";

      return new Response(JSON.stringify({ success: true, suggestions }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid mode. Use 'knowledge' or 'tender'" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("suggest-metadata error:", error);
    return new Response(JSON.stringify({ error: "Unexpected error", details: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
