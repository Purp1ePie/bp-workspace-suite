import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { unzipSync, zipSync } from "fflate";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const OPENAI_MODEL = "gpt-4o";
const OPENAI_TIMEOUT_MS = 90000;
const MAX_CELL_CONTEXT_CHARS = 80000;

// ── Types ────────────────────────────────────────────────────────────

interface CellInfo {
  ref: string; // e.g. "B5"
  value: string; // current cell content
  row: number;
}

interface SheetStructure {
  sheetName: string;
  sheetPath: string;
  cells: CellInfo[];
  maxCol: string; // highest column letter used (e.g. "F")
}

interface CellMapping {
  sheet: string;
  cell: string;
  value: string;
}

interface MappingResult {
  mappings: CellMapping[];
}

// ── XLSX helpers ─────────────────────────────────────────────────────

function getExtension(path: string): string {
  const parts = path.toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() || "" : "";
}

/** Column letter to 0-based index: A=0, B=1, ..., Z=25, AA=26, etc. */
function colToIndex(col: string): number {
  let index = 0;
  for (let i = 0; i < col.length; i++) {
    index = index * 26 + (col.charCodeAt(i) - 64);
  }
  return index - 1;
}

/** 0-based index to column letter: 0=A, 1=B, ..., 25=Z, 26=AA */
function indexToCol(index: number): string {
  let col = "";
  let n = index + 1;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    col = String.fromCharCode(65 + remainder) + col;
    n = Math.floor((n - 1) / 26);
  }
  return col;
}

/** Parse cell ref like "B5" into {col: "B", row: 5} */
function parseCellRef(ref: string): { col: string; row: number } {
  const match = ref.match(/^([A-Z]+)(\d+)$/);
  if (!match) return { col: "A", row: 1 };
  return { col: match[1], row: parseInt(match[2], 10) };
}

/** Extract text content, stripping XML tags and decoding entities */
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

/**
 * Parse worksheet XML to extract cell structure with references and values.
 * Uses regex-based parsing (DOMParser not available in Deno edge runtime).
 */
function parseWorksheetStructure(
  sheetXml: string,
  sharedStrings: string[],
): CellInfo[] {
  const cells: CellInfo[] = [];

  const rowRegex = /<row[\s>][\s\S]*?<\/row>/g;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
    const cellRegex = /<c\s[^>]*>[\s\S]*?<\/c>|<c\s[^>]*\/>/g;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowMatch[0])) !== null) {
      const cellXml = cellMatch[0];
      const refMatch = cellXml.match(/\br="([A-Z]+\d+)"/);
      const ref = refMatch ? refMatch[1] : "";
      const typeMatch = cellXml.match(/\bt="([^"]*)"/);
      const cellType = typeMatch ? typeMatch[1] : "";

      let value = "";

      // Check for inline string
      const isMatch = cellXml.match(/<is[\s>][\s\S]*?<\/is>/);
      if (isMatch) {
        const tRegex = /<t[^>]*>([\s\S]*?)<\/t>/g;
        const parts: string[] = [];
        let tMatch;
        while ((tMatch = tRegex.exec(isMatch[0])) !== null) {
          parts.push(extractXmlText(tMatch[1]));
        }
        value = parts.join("");
      } else {
        const vMatch = cellXml.match(/<v[^>]*>([\s\S]*?)<\/v>/);
        if (vMatch) {
          const raw = extractXmlText(vMatch[1]);
          if (cellType === "s") {
            const idx = parseInt(raw, 10);
            value = sharedStrings[idx] || raw;
          } else {
            value = raw;
          }
        }
      }

      if (ref) {
        const { row } = parseCellRef(ref);
        cells.push({ ref, value, row });
      }
    }
  }

  return cells;
}

/**
 * Parse shared strings from xl/sharedStrings.xml
 */
function parseSharedStrings(xmlBytes: Uint8Array): string[] {
  const ssXml = new TextDecoder().decode(xmlBytes);
  const strings: string[] = [];
  const siRegex = /<si[\s>][\s\S]*?<\/si>/g;
  let siMatch;
  while ((siMatch = siRegex.exec(ssXml)) !== null) {
    const tRegex = /<t[^>]*>([\s\S]*?)<\/t>/g;
    const parts: string[] = [];
    let tMatch;
    while ((tMatch = tRegex.exec(siMatch[0])) !== null) {
      parts.push(extractXmlText(tMatch[1]));
    }
    strings.push(parts.join(""));
  }
  return strings;
}

/**
 * Get sheet names from xl/workbook.xml
 */
function getSheetNames(xmlBytes: Uint8Array): string[] {
  const xml = new TextDecoder().decode(xmlBytes);
  const names: string[] = [];
  const sheetRegex = /<sheet\s[^>]*name="([^"]*)"[^>]*\/?>/g;
  let match;
  while ((match = sheetRegex.exec(xml)) !== null) {
    names.push(match[1]);
  }
  return names;
}

/**
 * Find the highest column letter used in a set of cells.
 */
function findMaxColumn(cells: CellInfo[]): string {
  let maxIdx = 0;
  for (const cell of cells) {
    const { col } = parseCellRef(cell.ref);
    const idx = colToIndex(col);
    if (idx > maxIdx) maxIdx = idx;
  }
  return indexToCol(maxIdx);
}

/**
 * Build a text representation of the sheet structure for GPT-4o.
 * Format: one line per cell, "SheetName!CellRef: value"
 */
function buildCellContext(sheets: SheetStructure[]): string {
  const lines: string[] = [];
  let totalChars = 0;

  for (const sheet of sheets) {
    lines.push(`\n=== Sheet: ${sheet.sheetName} (last data column: ${sheet.maxCol}, answer column: ${indexToCol(colToIndex(sheet.maxCol) + 1)}) ===`);

    // Group by row for readability
    const byRow = new Map<number, CellInfo[]>();
    for (const cell of sheet.cells) {
      if (!byRow.has(cell.row)) byRow.set(cell.row, []);
      byRow.get(cell.row)!.push(cell);
    }

    const sortedRows = [...byRow.keys()].sort((a, b) => a - b);
    for (const rowNum of sortedRows) {
      const rowCells = byRow.get(rowNum)!;
      // Sort cells by column
      rowCells.sort(
        (a, b) =>
          colToIndex(parseCellRef(a.ref).col) -
          colToIndex(parseCellRef(b.ref).col),
      );

      for (const cell of rowCells) {
        const line = `${sheet.sheetName}!${cell.ref}: ${cell.value}`;
        totalChars += line.length;
        if (totalChars > MAX_CELL_CONTEXT_CHARS) {
          lines.push("[... truncated ...]");
          return lines.join("\n");
        }
        lines.push(line);
      }
    }
  }

  return lines.join("\n");
}

// ── XML modification (regex-based) ───────────────────────────────────

/** Escape XML special characters */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Modify a worksheet XML to fill in cells with new values.
 * Uses inline strings (t="inlineStr") to avoid shared string table changes.
 *
 * Handles two cell formats:
 *   Self-closing: <c r="B3" s="3" t="n" />
 *   Full element: <c r="B3" s="3" t="s"><v>0</v></c>
 */
function modifyWorksheetXml(
  xml: string,
  mappings: CellMapping[],
  sheetName: string,
): string {
  let modified = xml;

  for (const mapping of mappings) {
    if (mapping.sheet !== sheetName) continue;

    const cellRef = mapping.cell;
    const escapedValue = escapeXml(mapping.value);
    const inlineContent = `<c r="${cellRef}" t="inlineStr"><is><t>${escapedValue}</t></is></c>`;

    // Match self-closing cell: <c r="B3" ... />
    const selfClosingRegex = new RegExp(
      `<c\\s[^>]*?r="${cellRef}"[^/]*/>`,
    );
    // Match full cell element: <c r="B3" ...>...</c>
    const fullElementRegex = new RegExp(
      `<c\\s[^>]*?r="${cellRef}"[^>]*>[\\s\\S]*?</c>`,
    );

    if (selfClosingRegex.test(modified)) {
      modified = modified.replace(selfClosingRegex, inlineContent);
    } else if (fullElementRegex.test(modified)) {
      modified = modified.replace(fullElementRegex, inlineContent);
    } else {
      // Cell doesn't exist — insert into the correct row
      const { row } = parseCellRef(cellRef);
      // Try matching row by r="N" attribute
      const rowOpenRegex = new RegExp(`(<row[^>]*?\\br="${row}"[^>]*>)`);
      if (rowOpenRegex.test(modified)) {
        modified = modified.replace(rowOpenRegex, `$1${inlineContent}`);
      } else {
        // Try matching by row number in spans attribute or just any row with the number
        const rowLooseRegex = new RegExp(`(<row\\s[^>]*>)`, "g");
        let found = false;
        const rowMatches = [...modified.matchAll(/<row[\s>][^]*?<\/row>/g)];
        for (const rm of rowMatches) {
          const rAttr = rm[0].match(/\br="(\d+)"/);
          if (rAttr && rAttr[1] === String(row)) {
            const rowOpen = rm[0].match(/<row[^>]*>/);
            if (rowOpen) {
              modified = modified.replace(rowOpen[0], rowOpen[0] + inlineContent);
              found = true;
              break;
            }
          }
        }
        if (!found) {
          // Row doesn't exist — add new row before </sheetData>
          const newRow = `<row r="${row}">${inlineContent}</row>`;
          modified = modified.replace("</sheetData>", `${newRow}</sheetData>`);
        }
      }
    }
  }

  return modified;
}

// ── Text matching helpers ────────────────────────────────────────────

/**
 * Normalize text for comparison: lowercase, remove punctuation, collapse spaces.
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s\u00e4\u00f6\u00fc\u00e0\u00e8\u00e9\u00e2\u00ea\u00ee\u00f4\u00fb]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Compute token overlap between two texts (Jaccard-like score 0..1).
 */
function textOverlap(a: string, b: string): number {
  const tokensA = new Set(normalizeText(a).split(" ").filter(t => t.length > 2));
  const tokensB = new Set(normalizeText(b).split(" ").filter(t => t.length > 2));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  return intersection / Math.min(tokensA.size, tokensB.size);
}

// ── OpenAI cell mapping ──────────────────────────────────────────────

async function mapResponsesToCells(
  cellContext: string,
  responseSections: Array<{ section_title: string; draft_text: string | null }>,
  requirements: Array<{ text: string; category: string }>,
  tenderTitle: string,
): Promise<MappingResult> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY secret is not configured");
  }

  const systemPrompt = `You are an expert at filling in RFP (Request for Proposal) Excel templates with bid response content. You specialize in Swiss public procurement (Ausschreibungen).

Given:
1. The cell structure of an Excel workbook (sheet!cell: value)
2. Drafted response sections for a bid
3. Individual requirement texts from the database

Your task is to map bid responses to the correct cells in the Excel template.

CRITICAL RULES — READ CAREFULLY:

1. FINDING ANSWER CELLS:
   - Look for empty cells, cells with "Bitte ausfuellen", "[enter here]", "TODO", placeholder text
   - Look for existing answer/response columns: "Antwort", "Response", "Bemerkung", "Kommentar"

2. IF NO ANSWER COLUMN EXISTS (very common in Swiss RFPs):
   - Each sheet header shows the "answer column" letter (e.g., "answer column: G")
   - Add a HEADER cell in the header row (usually row 2) of that column with value "Antwort des Anbieters"
   - Then fill answer cells in that same column for EACH requirement/data row
   - Skip section header rows (merged rows with category titles)
   - Skip title rows (row 1) and header rows (row 2 — except for adding the column header)

3. CONTENT MAPPING:
   - Match each Excel row to the most relevant response section by category and content
   - Write concise, specific answers (max 400 chars per cell) — not generic text
   - If a response mentions specific technologies, certifications, or experience, include those details
   - Use the same language as the template (German for German RFPs)
   - For price sheets (Preisblatt): DO NOT fill price columns — only fill description/approach cells if any exist
   - For eligibility criteria (Eignungskriterien): write how the bidder meets each criterion

4. BE THOROUGH:
   - Fill answers for EVERY requirement row that has a matching response
   - Do not skip rows — the user expects comprehensive filling
   - A partially filled Excel is better than an empty one

Return a JSON object:
{
  "mappings": [
    {"sheet": "SheetName", "cell": "G2", "value": "Antwort des Anbieters"},
    {"sheet": "SheetName", "cell": "G4", "value": "Answer for this requirement row"}
  ]
}`;

  let userPrompt = `TENDER: "${tenderTitle}"\n\n`;
  userPrompt += `EXCEL CELL STRUCTURE:\n${cellContext}\n\n`;
  userPrompt += `DRAFTED RESPONSE SECTIONS:\n\n`;

  for (const section of responseSections) {
    if (section.draft_text) {
      userPrompt += `=== ${section.section_title} ===\n${section.draft_text}\n\n`;
    }
  }

  if (requirements.length > 0) {
    userPrompt += `\nINDIVIDUAL REQUIREMENTS FROM DATABASE (${requirements.length} total):\n`;
    for (let i = 0; i < requirements.length; i++) {
      userPrompt += `${i + 1}. [${requirements[i].category}] ${requirements[i].text}\n`;
    }
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
        max_tokens: 12000,
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

    const parsed = JSON.parse(content) as MappingResult;

    if (!parsed.mappings || !Array.isArray(parsed.mappings)) {
      parsed.mappings = [];
    }

    // Validate mappings
    parsed.mappings = parsed.mappings.filter(
      (m) =>
        m.cell &&
        m.value &&
        m.sheet &&
        /^[A-Z]+\d+$/.test(m.cell),
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
    const { tender_id, document_id } = await req.json();
    if (!tender_id || !document_id) {
      return new Response(
        JSON.stringify({ error: "tender_id and document_id are required" }),
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
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
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
      .select("id, title, organization_id")
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

    // Load document record
    const { data: docRecord, error: docError } = await adminClient
      .from("tender_documents")
      .select("id, file_name, storage_path")
      .eq("id", document_id)
      .eq("tender_id", tender_id)
      .single();
    if (docError || !docRecord) {
      return new Response(
        JSON.stringify({ error: "Document not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const ext = getExtension(docRecord.storage_path || docRecord.file_name);
    if (ext !== "xlsx") {
      return new Response(
        JSON.stringify({ error: "Document is not an Excel file (.xlsx)" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    console.log(
      `[export-filled-excel] Starting for: ${docRecord.file_name} (tender: ${tender.title})`,
    );

    // ── Download original Excel file ─────────────────────────────────

    const { data: fileData, error: downloadError } = await adminClient.storage
      .from("tender-files")
      .download(docRecord.storage_path);

    if (downloadError || !fileData) {
      return new Response(
        JSON.stringify({
          error: `Failed to download file: ${downloadError?.message || "unknown"}`,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const bytes = new Uint8Array(await fileData.arrayBuffer());
    console.log(`[export-filled-excel] Downloaded ${bytes.length} bytes`);

    // ── Unzip and parse structure ────────────────────────────────────

    const unzipped = unzipSync(bytes);

    // Parse shared strings
    const sharedStrings = unzipped["xl/sharedStrings.xml"]
      ? parseSharedStrings(unzipped["xl/sharedStrings.xml"])
      : [];

    // Get sheet names
    const sheetNames = unzipped["xl/workbook.xml"]
      ? getSheetNames(unzipped["xl/workbook.xml"])
      : [];

    // Parse each worksheet
    const sheets: SheetStructure[] = [];
    let sheetIndex = 1;
    while (true) {
      const sheetPath = `xl/worksheets/sheet${sheetIndex}.xml`;
      const sheetFile = unzipped[sheetPath];
      if (!sheetFile) break;

      const sheetXml = new TextDecoder().decode(sheetFile);
      const sheetName = sheetNames[sheetIndex - 1] || `Sheet${sheetIndex}`;
      const cells = parseWorksheetStructure(sheetXml, sharedStrings);
      const maxCol = cells.length > 0 ? findMaxColumn(cells) : "A";

      sheets.push({ sheetName, sheetPath, cells, maxCol });
      sheetIndex++;
    }

    if (sheets.length === 0) {
      return new Response(
        JSON.stringify({ error: "No worksheets found in the Excel file" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    console.log(
      `[export-filled-excel] Parsed ${sheets.length} sheets, ${sheets.reduce((s, sh) => s + sh.cells.length, 0)} total cells`,
    );
    for (const sh of sheets) {
      console.log(`  Sheet "${sh.sheetName}": ${sh.cells.length} cells, maxCol=${sh.maxCol}, answerCol=${indexToCol(colToIndex(sh.maxCol) + 1)}`);
    }

    // ── Load response sections ───────────────────────────────────────

    const { data: sections } = await adminClient
      .from("response_sections")
      .select("section_title, draft_text")
      .eq("tender_id", tender_id)
      .eq("organization_id", orgId)
      .not("draft_text", "is", null);

    if (!sections || sections.length === 0) {
      return new Response(
        JSON.stringify({
          error:
            "No drafted response sections found. Generate a draft first.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    console.log(
      `[export-filled-excel] Loaded ${sections.length} response sections`,
    );

    // ── Load individual requirements ─────────────────────────────────

    const { data: requirements } = await adminClient
      .from("requirements")
      .select("id, text, category")
      .eq("tender_id", tender_id);

    console.log(
      `[export-filled-excel] Loaded ${requirements?.length || 0} requirements`,
    );

    // ── Call GPT-4o to map responses to cells ────────────────────────

    const cellContext = buildCellContext(sheets);
    console.log(`[export-filled-excel] Cell context: ${cellContext.length} chars`);

    const mappingResult = await mapResponsesToCells(
      cellContext,
      sections,
      (requirements || []).map(r => ({ text: r.text, category: r.category || "general" })),
      tender.title,
    );

    console.log(
      `[export-filled-excel] GPT-4o returned ${mappingResult.mappings.length} cell mappings`,
    );

    // Log mapping details
    for (const m of mappingResult.mappings.slice(0, 10)) {
      console.log(`  ${m.sheet}!${m.cell}: ${m.value.substring(0, 80)}...`);
    }

    if (mappingResult.mappings.length === 0) {
      return new Response(
        JSON.stringify({
          error:
            "Could not map any responses to Excel cells. The template structure may not match the response format.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // ── Validate mappings: never overwrite existing content ──────────

    const PLACEHOLDER_PATTERNS = ["bitte", "todo", "enter", "ausfüllen", "eingeben", "hier", "[", "..."];
    function isPlaceholder(val: string): boolean {
      const lower = val.toLowerCase().trim();
      return lower.length < 40 && PLACEHOLDER_PATTERNS.some(p => lower.includes(p));
    }

    // Build lookup of cells that already have content
    const existingContent = new Map<string, string>();
    for (const sheet of sheets) {
      for (const cell of sheet.cells) {
        if (cell.value && cell.value.trim().length > 0) {
          existingContent.set(`${sheet.sheetName}!${cell.ref}`, cell.value);
        }
      }
    }

    const originalCount = mappingResult.mappings.length;
    mappingResult.mappings = mappingResult.mappings.filter(m => {
      const key = `${m.sheet}!${m.cell}`;
      const existing = existingContent.get(key);
      if (existing && !isPlaceholder(existing)) {
        console.warn(`[export-filled-excel] BLOCKED overwrite of ${key} (existing: "${existing.substring(0, 60)}...")`);
        return false;
      }
      return true;
    });

    console.log(`[export-filled-excel] Validated mappings: ${mappingResult.mappings.length} safe / ${originalCount} total (${originalCount - mappingResult.mappings.length} blocked)`);

    if (mappingResult.mappings.length === 0) {
      return new Response(
        JSON.stringify({
          error: "All mapped cells already have content. Could not fill any new cells.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // ── Modify worksheet XML ─────────────────────────────────────────

    const modifiedFiles: Record<string, Uint8Array> = {};

    // Copy all original files
    for (const [path, data] of Object.entries(unzipped)) {
      modifiedFiles[path] = data as Uint8Array;
    }

    // Modify each affected sheet
    for (const sheet of sheets) {
      const sheetMappings = mappingResult.mappings.filter(
        (m) => m.sheet === sheet.sheetName,
      );
      if (sheetMappings.length === 0) continue;

      const originalXml = new TextDecoder().decode(
        unzipped[sheet.sheetPath],
      );
      const modifiedXml = modifyWorksheetXml(
        originalXml,
        mappingResult.mappings,
        sheet.sheetName,
      );
      modifiedFiles[sheet.sheetPath] = new TextEncoder().encode(modifiedXml);

      console.log(
        `[export-filled-excel] Modified ${sheet.sheetName}: ${sheetMappings.length} cells`,
      );
    }

    // ── Re-zip ───────────────────────────────────────────────────────

    const zipped = zipSync(modifiedFiles);
    console.log(
      `[export-filled-excel] Re-zipped: ${zipped.length} bytes`,
    );

    // ── Return binary response ───────────────────────────────────────

    const fileName = `FILLED_${docRecord.file_name}`;

    return new Response(zipped, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    console.error(`[export-filled-excel] Fatal error: ${error}`);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
