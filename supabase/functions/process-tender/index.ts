import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { tender_id } = await req.json();

    if (!tender_id) {
      return new Response(
        JSON.stringify({ error: "Missing tender_id" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    // 1. Load tender
    const { data: tender, error: tenderError } = await supabase
      .from("tenders")
      .select("id, organization_id, title, status")
      .eq("id", tender_id)
      .single();

    if (tenderError || !tender) {
      return new Response(
        JSON.stringify({ error: "Tender not found", details: tenderError }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // 2. Mark tender as analyzing
    await supabase
      .from("tenders")
      .update({ status: "analyzing" })
      .eq("id", tender_id);

    // 3. Load tender documents
    const { data: documents, error: docsError } = await supabase
      .from("tender_documents")
      .select("id, file_name, parse_status")
      .eq("tender_id", tender_id);

    if (docsError) {
      return new Response(
        JSON.stringify({ error: "Could not load tender documents", details: docsError }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (!documents || documents.length === 0) {
      await supabase
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

    // 4. Mark docs as processing
    await supabase
      .from("tender_documents")
      .update({ parse_status: "processing" })
      .in("id", documentIds);

    // 5. Simulate parsing for now
    for (const doc of documents) {
      const placeholderText = `Parsed placeholder text for ${doc.file_name}. This is the first version of BidPilot document processing.`;

      await supabase
        .from("tender_documents")
        .update({
          parse_status: "parsed",
          parsed_text: placeholderText,
        })
        .eq("id", doc.id);
    }

    // 6. Avoid duplicate inserts
    const { count: existingRequirements } = await supabase
      .from("requirements")
      .select("*", { count: "exact", head: true })
      .eq("tender_id", tender_id);

    const { count: existingDeadlines } = await supabase
      .from("deadlines")
      .select("*", { count: "exact", head: true })
      .eq("tender_id", tender_id);

    const { count: existingRisks } = await supabase
      .from("risks")
      .select("*", { count: "exact", head: true })
      .eq("tender_id", tender_id);

    // 7. Insert sample requirements
    if (!existingRequirements || existingRequirements === 0) {
      await supabase.from("requirements").insert([
        {
          tender_id,
          organization_id: tender.organization_id,
          category: "technical",
          text: "Provide a detailed service description and implementation approach.",
          mandatory: true,
        },
        {
          tender_id,
          organization_id: tender.organization_id,
          category: "commercial",
          text: "Submit pricing in the requested format.",
          mandatory: true,
        },
        {
          tender_id,
          organization_id: tender.organization_id,
          category: "reference",
          text: "Include at least two relevant customer references.",
          mandatory: false,
        },
      ]);
    }

    // 8. Insert sample deadline
    if (!existingDeadlines || existingDeadlines === 0) {
      const dueAt = new Date();
      dueAt.setDate(dueAt.getDate() + 7);

      await supabase.from("deadlines").insert([
        {
          tender_id,
          organization_id: tender.organization_id,
          deadline_type: "submission",
          due_at: dueAt.toISOString(),
          description: "Sample extracted submission deadline",
        },
      ]);
    }

    // 9. Insert sample risk
    if (!existingRisks || existingRisks === 0) {
      await supabase.from("risks").insert([
        {
          tender_id,
          organization_id: tender.organization_id,
          risk_type: "missing_information",
          severity: "medium",
          description: "Tender may require additional clarification on scope and deliverables.",
        },
      ]);
    }

    // 10. Mark tender ready for review
    await supabase
      .from("tenders")
      .update({ status: "ready_for_review" })
      .eq("id", tender_id);

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