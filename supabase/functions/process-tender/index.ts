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
    console.log("process-tender invoked");

    const authHeader = req.headers.get("Authorization");
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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const publishableKey = Deno.env.get("SB_PUBLISHABLE_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Client used only to validate the caller and apply RLS
    const authClient = createClient(supabaseUrl, publishableKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    // Admin client used only after authorization succeeds
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Validate JWT
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
      return new Response(
        JSON.stringify({ error: "Missing tender_id" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Read the user's profile through RLS-aware client
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

    // Load tender through admin client
    const { data: tender, error: tenderError } = await adminClient
      .from("tenders")
      .select("id, organization_id, title, status")
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

    // Enforce same-organization access
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

    const { data: documents, error: docsError } = await adminClient
      .from("tender_documents")
      .select("id, file_name, parse_status")
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

    console.log("Found documents:", documents?.length ?? 0);

    if (!documents || documents.length === 0) {
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

    await adminClient
      .from("tender_documents")
      .update({ parse_status: "processing" })
      .in("id", documentIds);

    for (const doc of documents) {
      const placeholderText = `Parsed placeholder text for ${doc.file_name}. This is the first version of BidPilot document processing.`;

      await adminClient
        .from("tender_documents")
        .update({
          parse_status: "parsed",
          parsed_text: placeholderText,
        })
        .eq("id", doc.id);
    }

    const { count: existingRequirements } = await adminClient
      .from("requirements")
      .select("*", { count: "exact", head: true })
      .eq("tender_id", tender_id);

    const { count: existingDeadlines } = await adminClient
      .from("deadlines")
      .select("*", { count: "exact", head: true })
      .eq("tender_id", tender_id);

    const { count: existingRisks } = await adminClient
      .from("risks")
      .select("*", { count: "exact", head: true })
      .eq("tender_id", tender_id);

    if (!existingRequirements || existingRequirements === 0) {
      await adminClient.from("requirements").insert([
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

    if (!existingDeadlines || existingDeadlines === 0) {
      const dueAt = new Date();
      dueAt.setDate(dueAt.getDate() + 7);

      await adminClient.from("deadlines").insert([
        {
          tender_id,
          organization_id: tender.organization_id,
          deadline_type: "submission",
          due_at: dueAt.toISOString(),
          description: "Sample extracted submission deadline",
        },
      ]);
    }

    if (!existingRisks || existingRisks === 0) {
      await adminClient.from("risks").insert([
        {
          tender_id,
          organization_id: tender.organization_id,
          risk_type: "missing_information",
          severity: "medium",
          description: "Tender may require additional clarification on scope and deliverables.",
        },
      ]);
    }

    await adminClient
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