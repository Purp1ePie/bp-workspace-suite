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
    if (!query || typeof query !== "string" || query.trim().length < 3) {
      return new Response(
        JSON.stringify({ error: "query must be at least 3 characters" }),
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

    // Build SIMAP search URL — try endpoint paths in order
    const params = new URLSearchParams();
    params.set("search", query);
    if (cantons && Array.isArray(cantons)) {
      cantons.forEach((c: string) => params.append("orderAddressCantons", c));
    }
    if (lastItem) {
      params.set("lastItem", lastItem);
    }

    const endpoints = [
      `${SIMAP_API_BASE}/publications/v2/project/project-search`,
      `${SIMAP_API_BASE}/projects/v1/search`,
    ];

    let simapResp: Response | null = null;
    let lastErr = "";

    for (const base of endpoints) {
      const url = `${base}?${params.toString()}`;
      console.log(`[search-simap] Trying: ${url}`);

      const resp = await fetch(url, {
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
      });

      console.log(`[search-simap] ${url} → ${resp.status}`);

      if (resp.ok) {
        simapResp = resp;
        break;
      }

      const errText = await resp.text();
      console.error(`[search-simap] ${resp.status}: ${errText.substring(0, 500)}`);
      lastErr = `${resp.status}: ${errText.substring(0, 200)}`;
    }

    if (!simapResp) {
      return new Response(
        JSON.stringify({ error: `SIMAP API error: ${lastErr}` }),
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
      const description = pickTranslation(p.description) || pickTranslation(p.shortDescription);
      const issuer = pickTranslation(p.procOfficeName) || pickTranslation(p.orderAddress?.name);
      const projectId = p.id || p.projectId;

      // Try to find deadline from lots
      let deadline: string | null = null;
      if (p.lots && Array.isArray(p.lots) && p.lots.length > 0) {
        deadline = p.lots[0]?.offerDeadline || p.lots[0]?.deadline || null;
      }

      // Extract canton from orderAddress (API uses cantonId)
      const canton = p.orderAddress?.cantonId || p.orderAddress?.canton || null;

      // Extract publication ID for later use with publication-details endpoint
      const publicationId = p.publicationId || null;

      // Extract CPV codes
      const cpvCodes = p.cpvCodes || p.lots?.[0]?.cpvCodes || [];

      // Detect language
      let language = "de";
      if (p.title && typeof p.title === "object") {
        if (p.title.fr && !p.title.de) language = "fr";
        else if (p.title.it && !p.title.de) language = "it";
        else if (p.title.en && !p.title.de) language = "en";
      }

      return {
        project_id: projectId,
        publication_id: publicationId,
        title,
        description,
        issuer,
        publication_date: p.publicationDate || null,
        publication_number: p.publicationNumber || null,
        pub_type: p.pubType || null,
        deadline,
        project_type: p.projectType || null,
        project_sub_type: p.projectSubType || null,
        process_type: p.processType || null,
        canton,
        cpv_codes: cpvCodes,
        language,
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
