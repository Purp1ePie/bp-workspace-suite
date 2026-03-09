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
  clarificationQuestions: string;
  question: string;
  rationale: string;
  issuer: string;
  deadline: string;
  generatedOn: string;
  confidential: string;
  page: string;
}

const LABELS: Record<string, Labels> = {
  de: {
    clarificationQuestions: "Klarstellungsfragen",
    question: "Frage",
    rationale: "Begründung",
    issuer: "Auftraggeber",
    deadline: "Eingabefrist",
    generatedOn: "Erstellt am",
    confidential: "Vertraulich",
    page: "Seite",
  },
  en: {
    clarificationQuestions: "Clarification Questions",
    question: "Question",
    rationale: "Rationale",
    issuer: "Issuer",
    deadline: "Submission Deadline",
    generatedOn: "Generated on",
    confidential: "Confidential",
    page: "Page",
  },
  fr: {
    clarificationQuestions: "Questions de clarification",
    question: "Question",
    rationale: "Justification",
    issuer: "Mandant",
    deadline: "Délai de soumission",
    generatedOn: "Généré le",
    confidential: "Confidentiel",
    page: "Page",
  },
  it: {
    clarificationQuestions: "Domande di chiarimento",
    question: "Domanda",
    rationale: "Motivazione",
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
              new TextRun({ text: label + ":", bold: true, font: "Arial", size: 22 }),
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

function formatDate(dateStr: string, lang: string): string {
  try {
    const locale =
      lang === "de" ? "de-CH" : lang === "fr" ? "fr-CH" : lang === "it" ? "it-CH" : "en-GB";
    return new Date(dateStr).toLocaleDateString(locale);
  } catch {
    return dateStr;
  }
}

// ── Document builder ────────────────────────────────────────────────

function buildDocument(
  tender: { title: string; issuer: string | null; deadline: string | null; language: string | null },
  questions: Array<{ question_text: string; rationale: string | null }>,
): Document {
  const lang = tender.language || "de";
  const l = LABELS[lang] || LABELS["de"];
  const children: (Paragraph | Table)[] = [];

  // Cover page
  children.push(
    new Paragraph({
      children: [new TextRun({ text: tender.title, bold: true, size: 56, font: "Arial" })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 4000, after: 400 },
    }),
  );

  children.push(
    new Paragraph({
      children: [new TextRun({ text: l.clarificationQuestions, size: 36, font: "Arial", color: "444444" })],
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
    metaRows.push(makeMetaRow(l.deadline, formatDate(tender.deadline, lang)));
  }
  metaRows.push(makeMetaRow(l.generatedOn, formatDate(new Date().toISOString(), lang)));

  children.push(new Table({ rows: metaRows, width: { size: 50, type: WidthType.PERCENTAGE } }));
  children.push(new Paragraph({ children: [new PageBreak()] }));

  // Questions
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];

    children.push(
      new Paragraph({
        text: `${l.question} ${i + 1}`,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 },
      }),
    );

    children.push(
      new Paragraph({
        children: [new TextRun({ text: q.question_text, font: "Arial", size: 22 })],
        spacing: { after: 150 },
      }),
    );

    if (q.rationale) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${l.rationale}: `, bold: true, italics: true, font: "Arial", size: 20, color: "666666" }),
            new TextRun({ text: q.rationale, italics: true, font: "Arial", size: 20, color: "666666" }),
          ],
          spacing: { after: 300 },
        }),
      );
    }
  }

  return new Document({
    styles: {
      default: {
        document: { run: { font: "Arial", size: 22 } },
        heading1: { run: { font: "Arial", size: 32, bold: true, color: "1a1a2e" } },
      },
    },
    numbering: {
      config: [{
        reference: "default-numbering",
        levels: [{ level: 0, format: NumberFormat.DECIMAL, text: "%1.", alignment: AlignmentType.START }],
      }],
    },
    sections: [{
      properties: {
        page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } },
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              children: [new TextRun({ text: l.confidential, italics: true, size: 16, color: "999999", font: "Arial" })],
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
                new TextRun({ text: `${l.page} `, size: 16, font: "Arial" }),
                new TextRun({ children: [PageNumber.CURRENT], size: 16, font: "Arial" }),
              ],
              alignment: AlignmentType.CENTER,
            }),
          ],
        }),
      },
      children,
    }],
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
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

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
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data: profile } = await adminClient
      .from("profiles").select("organization_id").eq("id", user.id).single();
    if (!profile?.organization_id) {
      return new Response(
        JSON.stringify({ error: "User has no organization" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const orgId = profile.organization_id;

    const { data: tender, error: tenderError } = await adminClient
      .from("tenders")
      .select("id, title, issuer, deadline, language, organization_id")
      .eq("id", tender_id).eq("organization_id", orgId).single();
    if (tenderError || !tender) {
      return new Response(
        JSON.stringify({ error: "Tender not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: questions, error: qError } = await adminClient
      .from("clarification_questions")
      .select("question_text, rationale")
      .eq("tender_id", tender_id)
      .eq("organization_id", orgId)
      .order("created_at", { ascending: true });

    if (qError || !questions || questions.length === 0) {
      return new Response(
        JSON.stringify({ error: "No clarification questions found. Generate them first." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`[export-clarifications-doc] Generating DOCX: ${questions.length} questions`);

    const doc = buildDocument(tender, questions);
    const buffer = await Packer.toBuffer(doc);

    const safeTitle = (tender.title || "Clarifications")
      .replace(/[^a-zA-Z0-9\u00C0-\u024F\s_-]/g, "")
      .replace(/\s+/g, "_")
      .slice(0, 80);
    const fileName = `${safeTitle}_Clarifications.docx`;

    return new Response(buffer, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (err) {
    console.error("[export-clarifications-doc] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
