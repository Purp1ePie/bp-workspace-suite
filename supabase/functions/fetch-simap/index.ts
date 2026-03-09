import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SIMAP_API_BASE = "https://www.simap.ch/api";

interface Translation {
  de?: string;
  fr?: string;
  it?: string;
  en?: string;
  [key: string]: string | undefined;
}

function pickTranslation(t: Translation | string | undefined, preferredLang = "de"): string {
  if (!t) return "";
  if (typeof t === "string") return t;
  return t[preferredLang] || t.de || t.fr || t.en || t.it || Object.values(t).find(Boolean) || "";
}

function extractProjectId(simapUrl: string): string | null {
  try {
    const url = new URL(simapUrl);
    // Try query param: ?projectId=...
    const fromParam = url.searchParams.get("projectId") || url.searchParams.get("project");
    if (fromParam) return fromParam;
    // Try path: /publications/project/{id} or /project/{id}
    const match = url.pathname.match(/\/project[s]?\/([a-zA-Z0-9-]+)/);
    if (match) return match[1];
    return null;
  } catch {
    // If not a URL, assume it's the project ID itself
    return simapUrl.trim() || null;
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { simap_url, simap_project_id } = await req.json();

    // Determine project ID
    let projectId = simap_project_id;
    if (!projectId && simap_url) {
      projectId = extractProjectId(simap_url);
    }
    if (!projectId) {
      return new Response(
        JSON.stringify({ error: "simap_url or simap_project_id is required" }),
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

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Try direct project header endpoint first, then search
    const headers = {
      "Accept": "application/json",
      "Content-Type": "application/json",
    };

    const endpoints = [
      `${SIMAP_API_BASE}/publications/v2/project/${projectId}/project-header`,
      `${SIMAP_API_BASE}/projects/v1/${projectId}`,
      `${SIMAP_API_BASE}/publications/v2/project/project-search?search=${encodeURIComponent(projectId)}`,
      `${SIMAP_API_BASE}/projects/v1/search?search=${encodeURIComponent(projectId)}`,
    ];

    let simapResp: Response | null = null;
    let lastErr = "";

    for (const url of endpoints) {
      console.log(`[fetch-simap] Trying: ${url}`);
      const resp = await fetch(url, { headers });
      console.log(`[fetch-simap] ${url} → ${resp.status}`);

      if (resp.ok) {
        simapResp = resp;
        break;
      }

      const errText = await resp.text();
      console.error(`[fetch-simap] ${resp.status}: ${errText.substring(0, 500)}`);
      lastErr = `${resp.status}: ${errText.substring(0, 200)}`;
    }

    if (!simapResp) {
      return new Response(
        JSON.stringify({ error: `SIMAP API error: ${lastErr}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await simapResp.json();
    console.log(`[fetch-simap] Response keys:`, Object.keys(data));

    // Data could be a single project (from project-header) or a search result
    let projects: any[];
    if (Array.isArray(data.projects)) {
      projects = data.projects;
    } else if (Array.isArray(data.results)) {
      projects = data.results;
    } else if (data.id || data.projectId || data.title) {
      // Single project response from project-header endpoint
      projects = [data];
    } else {
      projects = [];
    }

    // Find the exact project match
    let project = projects.find((p: any) => (p.id || p.projectId) === projectId);
    if (!project && projects.length > 0) {
      project = projects[0];
    }

    if (!project) {
      return new Response(
        JSON.stringify({ error: "Project not found on SIMAP" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`[fetch-simap] Project keys:`, Object.keys(project));

    const title = pickTranslation(project.title);
    const issuer = pickTranslation(project.procOfficeName) || pickTranslation(project.orderAddress?.name);
    const resolvedId = project.id || project.projectId || projectId;

    // Try to find deadline from lots
    let deadline: string | null = null;
    if (project.lots && Array.isArray(project.lots) && project.lots.length > 0) {
      deadline = project.lots[0]?.offerDeadline || project.lots[0]?.deadline || null;
    }

    // Detect language from title Translation object
    let language = "de";
    if (project.title && typeof project.title === "object") {
      if (project.title.fr && !project.title.de) language = "fr";
      else if (project.title.it && !project.title.de) language = "it";
      else if (project.title.en && !project.title.de) language = "en";
    }

    const tenderType = project.projectType === "PUBLIC" || project.processType?.includes("OPEN")
      ? "public"
      : "public"; // SIMAP is public procurement by default

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          title,
          issuer,
          deadline,
          language,
          tender_type: tenderType,
          simap_project_id: resolvedId,
          simap_url: simap_url || `https://www.simap.ch/publications/project/${resolvedId}`,
          raw_data: project,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[fetch-simap] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
