import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Header,
  Footer,
  PageNumber,
  NumberFormat,
  AlignmentType,
  PageBreak,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
} from "docx";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Multilingual labels ─────────────────────────────────────────────

interface Labels {
  bidResponse: string;
  issuer: string;
  deadline: string;
  generatedOn: string;
  confidential: string;
  page: string;
}

const LABELS: Record<string, Labels> = {
  de: {
    bidResponse: "Angebotsantwort",
    issuer: "Auftraggeber",
    deadline: "Eingabefrist",
    generatedOn: "Erstellt am",
    confidential: "Vertraulich",
    page: "Seite",
  },
  en: {
    bidResponse: "Bid Response",
    issuer: "Issuer",
    deadline: "Submission Deadline",
    generatedOn: "Generated on",
    confidential: "Confidential",
    page: "Page",
  },
  fr: {
    bidResponse: "Réponse à l'appel d'offres",
    issuer: "Mandant",
    deadline: "Délai de soumission",
    generatedOn: "Généré le",
    confidential: "Confidentiel",
    page: "Page",
  },
  it: {
    bidResponse: "Risposta all'offerta",
    issuer: "Committente",
    deadline: "Termine di presentazione",
    generatedOn: "Generato il",
    confidential: "Riservato",
    page: "Pagina",
  },
};

// ── Helpers ──────────────────────────────────────────────────────────

const NOBORDER = {
  top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
};

function makeMetaRow(label: string, value: string): TableRow {
  return new TableRow({
    children: [
      new TableCell({
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: label + ":",
                bold: true,
                font: "Arial",
                size: 22,
              }),
            ],
          }),
        ],
        width: { size: 30, type: WidthType.PERCENTAGE },
        borders: NOBORDER,
      }),
      new TableCell({
        children: [
          new Paragraph({
            children: [
              new TextRun({ text: value, font: "Arial", size: 22 }),
            ],
          }),
        ],
        width: { size: 70, type: WidthType.PERCENTAGE },
        borders: NOBORDER,
      }),
    ],
  });
}

/** Parse **bold** markers into TextRun array */
function parseInlineFormatting(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      runs.push(
        new TextRun({
          text: text.slice(lastIndex, match.index),
          font: "Arial",
          size: 22,
        }),
      );
    }
    runs.push(
      new TextRun({
        text: match[1],
        bold: true,
        font: "Arial",
        size: 22,
      }),
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    runs.push(
      new TextRun({
        text: text.slice(lastIndex),
        font: "Arial",
        size: 22,
      }),
    );
  }

  if (runs.length === 0) {
    runs.push(new TextRun({ text, font: "Arial", size: 22 }));
  }

  return runs;
}

function formatDate(dateStr: string, lang: string): string {
  try {
    const locale =
      lang === "de"
        ? "de-CH"
        : lang === "fr"
          ? "fr-CH"
          : lang === "it"
            ? "it-CH"
            : "en-GB";
    return new Date(dateStr).toLocaleDateString(locale);
  } catch {
    return dateStr;
  }
}

// ── Document builder ────────────────────────────────────────────────

function buildDocument(
  tender: {
    title: string;
    issuer: string | null;
    deadline: string | null;
    language: string | null;
  },
  sections: Array<{
    section_title: string;
    draft_text: string | null;
  }>,
): Document {
  const lang = tender.language || "de";
  const l = LABELS[lang] || LABELS["de"];
  const children: (Paragraph | Table)[] = [];

  // ── Cover page ──────────────────────────────────────────────────
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: tender.title,
          bold: true,
          size: 56,
          font: "Arial",
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 4000, after: 400 },
    }),
  );

  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: l.bidResponse,
          size: 36,
          font: "Arial",
          color: "444444",
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 800 },
    }),
  );

  // Metadata table
  const metaRows: TableRow[] = [];
  if (tender.issuer) {
    metaRows.push(makeMetaRow(l.issuer, tender.issuer));
  }
  if (tender.deadline) {
    metaRows.push(
      makeMetaRow(
        l.deadline,
        formatDate(tender.deadline, lang),
      ),
    );
  }
  metaRows.push(
    makeMetaRow(l.generatedOn, formatDate(new Date().toISOString(), lang)),
  );

  children.push(
    new Table({
      rows: metaRows,
      width: { size: 50, type: WidthType.PERCENTAGE },
    }),
  );

  // Page break after cover
  children.push(new Paragraph({ children: [new PageBreak()] }));

  // ── Response sections ───────────────────────────────────────────
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];

    // Section heading
    children.push(
      new Paragraph({
        text: section.section_title,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 },
      }),
    );

    // Section body — parse markdown-style formatting
    const bodyLines = (section.draft_text || "").split("\n");
    for (const line of bodyLines) {
      if (line.trim() === "") {
        children.push(new Paragraph({ spacing: { after: 100 } }));
        continue;
      }

      // Sub-headings
      if (line.startsWith("### ")) {
        children.push(
          new Paragraph({
            text: line.replace("### ", ""),
            heading: HeadingLevel.HEADING_3,
            spacing: { before: 200, after: 100 },
          }),
        );
      } else if (line.startsWith("## ")) {
        children.push(
          new Paragraph({
            text: line.replace("## ", ""),
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 300, after: 100 },
          }),
        );
      }
      // Bullet points
      else if (/^\s*[-*]\s+/.test(line)) {
        const text = line.replace(/^\s*[-*]\s+/, "");
        children.push(
          new Paragraph({
            children: parseInlineFormatting(text),
            bullet: { level: 0 },
            spacing: { after: 60 },
          }),
        );
      }
      // Numbered lists
      else if (/^\s*\d+\.\s+/.test(line)) {
        const text = line.replace(/^\s*\d+\.\s+/, "");
        children.push(
          new Paragraph({
            children: parseInlineFormatting(text),
            numbering: { reference: "default-numbering", level: 0 },
            spacing: { after: 60 },
          }),
        );
      }
      // Regular paragraph
      else {
        children.push(
          new Paragraph({
            children: parseInlineFormatting(line),
            spacing: { after: 100 },
          }),
        );
      }
    }

    // Spacing between sections
    if (i < sections.length - 1) {
      children.push(new Paragraph({ spacing: { after: 300 } }));
    }
  }

  return new Document({
    styles: {
      default: {
        document: {
          run: { font: "Arial", size: 22 },
        },
        heading1: {
          run: { font: "Arial", size: 32, bold: true, color: "1a1a2e" },
        },
        heading2: {
          run: { font: "Arial", size: 28, bold: true, color: "333333" },
        },
        heading3: {
          run: { font: "Arial", size: 24, bold: true, color: "555555" },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: "default-numbering",
          levels: [
            {
              level: 0,
              format: NumberFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.START,
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440,
              bottom: 1440,
              left: 1440,
              right: 1440,
            },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: l.confidential,
                    italics: true,
                    size: 16,
                    color: "999999",
                    font: "Arial",
                  }),
                ],
                alignment: AlignmentType.RIGHT,
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: `${l.page} `,
                    size: 16,
                    font: "Arial",
                  }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    size: 16,
                    font: "Arial",
                  }),
                ],
                alignment: AlignmentType.CENTER,
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
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
      .select(
        "id, title, issuer, deadline, language, organization_id",
      )
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

    // Load response sections with drafted text
    const { data: sections, error: sectionsError } = await adminClient
      .from("response_sections")
      .select("section_title, draft_text, review_status")
      .eq("tender_id", tender_id)
      .not("draft_text", "is", null)
      .order("created_at", { ascending: true });

    if (sectionsError) {
      return new Response(
        JSON.stringify({ error: "Failed to load response sections" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

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
      `[export-response-doc] Generating DOCX for tender: ${tender.title} (${sections.length} sections)`,
    );

    // Build and pack DOCX
    const doc = buildDocument(tender, sections);
    const buffer = await Packer.toBuffer(doc);

    const safeTitle = (tender.title || "Response")
      .replace(/[^a-zA-Z0-9\u00C0-\u024F\s_-]/g, "")
      .replace(/\s+/g, "_")
      .slice(0, 80);
    const fileName = `${safeTitle}_Response.docx`;

    console.log(
      `[export-response-doc] Generated ${buffer.byteLength} bytes: ${fileName}`,
    );

    return new Response(buffer, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (err) {
    console.error("[export-response-doc] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
