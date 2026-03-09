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

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { query, cantons, lastItem } = await req.json();
    if (!query || typeof query !== "string") {
      return new Response(
        JSON.stringify({ error: "query is required" }),
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

    // Build SIMAP search URL
    const params = new URLSearchParams();
    params.set("search", query);
    if (cantons && Array.isArray(cantons)) {
      cantons.forEach((c: string) => params.append("orderAddressCantons", c));
    }
    if (lastItem) {
      params.set("lastItem", lastItem);
    }

    const url = `${SIMAP_API_BASE}/public/v1/projects/search?${params.toString()}`;
    console.log(`[search-simap] Fetching: ${url}`);

    const simapResp = await fetch(url, {
      headers: { "Accept": "application/json" },
    });

    if (!simapResp.ok) {
      const errText = await simapResp.text();
      console.error(`[search-simap] SIMAP API error ${simapResp.status}: ${errText}`);
      return new Response(
        JSON.stringify({ error: `SIMAP API error: ${simapResp.status}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await simapResp.json();
    console.log(`[search-simap] Response keys:`, Object.keys(data));

    const projects = data.projects || data.results || [];
    if (projects.length > 0) {
      console.log(`[search-simap] First project keys:`, Object.keys(projects[0]));
    }

    const results = projects.map((p: any) => {
      const title = pickTranslation(p.title);
      const issuer = pickTranslation(p.procOfficeName) || pickTranslation(p.orderAddress?.name);
      const projectId = p.id || p.projectId;

      // Try to find deadline from lots
      let deadline: string | null = null;
      if (p.lots && Array.isArray(p.lots) && p.lots.length > 0) {
        deadline = p.lots[0]?.offerDeadline || p.lots[0]?.deadline || null;
      }

      return {
        project_id: projectId,
        title,
        issuer,
        publication_date: p.publicationDate || null,
        deadline,
        project_type: p.projectType || null,
        process_type: p.processType || null,
        simap_url: `https://www.simap.ch/publications/project/${projectId}`,
      };
    });

    return new Response(
      JSON.stringify({
        success: true,
        results,
        pagination: data.pagination || null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[search-simap] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
