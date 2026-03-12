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
    // Try path: /project-detail/{id} or /publications/project/{id} or /project/{id}
    const match = url.pathname.match(/\/(?:project-detail|project[s]?)\/([a-zA-Z0-9-]+)/);
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
    const { simap_url, simap_project_id, publication_id } = await req.json();

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
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

    // Load SIMAP OAuth token if available
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const { data: profile } = await adminClient
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();

    let simapToken: string | null = null;
    if (profile?.organization_id) {
      const { data: conn } = await adminClient
        .from("simap_connections")
        .select("access_token, refresh_token, token_expires_at")
        .eq("organization_id", profile.organization_id)
        .single();

      if (conn) {
        if (new Date(conn.token_expires_at) < new Date() && conn.refresh_token) {
          try {
            const refreshResp = await fetch(
              "https://www.simap.ch/auth/realms/simap/protocol/openid-connect/token",
              {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                  grant_type: "refresh_token",
                  client_id: "bidpilot-tenders",
                  refresh_token: conn.refresh_token,
                }).toString(),
              },
            );
            if (refreshResp.ok) {
              const tokenData = await refreshResp.json();
              simapToken = tokenData.access_token;
              await adminClient.from("simap_connections").update({
                access_token: tokenData.access_token,
                refresh_token: tokenData.refresh_token || conn.refresh_token,
                token_expires_at: new Date(Date.now() + (tokenData.expires_in || 300) * 1000).toISOString(),
                updated_at: new Date().toISOString(),
              }).eq("organization_id", profile.organization_id);
              console.log("[fetch-simap] Token refreshed");
            }
          } catch (e) {
            console.log("[fetch-simap] Token refresh failed:", e);
          }
        } else if (new Date(conn.token_expires_at) >= new Date()) {
          simapToken = conn.access_token;
        }
      }
    }

    console.log(`[fetch-simap] Using ${simapToken ? "authenticated" : "unauthenticated"} mode`);

    // Try direct project header endpoint first, then search
    const headers: Record<string, string> = {
      "Accept": "application/json",
      "Content-Type": "application/json",
      ...(simapToken ? { "Authorization": `Bearer ${simapToken}` } : {}),
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

    // Try to get rich publication details (requires auth — will work once OAuth is set up)
    let pubDetail: any = null;
    const pubId = publication_id || project.publicationId || project.latestPublication?.id;
    if (pubId) {
      const pubDetailUrl = `${SIMAP_API_BASE}/publications/v1/project/${project.id || projectId}/publication-details/${pubId}`;
      console.log(`[fetch-simap] Trying publication-details: ${pubDetailUrl}`);
      try {
        const pubResp = await fetch(pubDetailUrl, { headers });
        console.log(`[fetch-simap] publication-details → ${pubResp.status}`);
        if (pubResp.ok) {
          pubDetail = await pubResp.json();
          console.log(`[fetch-simap] Got publication details, keys:`, Object.keys(pubDetail));
        }
      } catch (e) {
        console.log(`[fetch-simap] publication-details failed:`, e);
      }
    }

    const title = pickTranslation(project.title);
    const issuer = pickTranslation(project.procOfficeName) || pickTranslation(project.orderAddress?.name);
    const resolvedId = project.id || project.projectId || projectId;

    // Try to find deadline from lots
    let deadline: string | null = null;
    if (project.lots && Array.isArray(project.lots) && project.lots.length > 0) {
      deadline = project.lots[0]?.offerDeadline || project.lots[0]?.deadline || null;
    }

    // Extract canton
    const canton = project.orderAddress?.canton || project.orderAddress?.cantonId || null;

    // Extract CPV codes from lots
    const cpvCodes: string[] = [];
    if (project.lots && Array.isArray(project.lots)) {
      for (const lot of project.lots) {
        if (lot.cpvCodes && Array.isArray(lot.cpvCodes)) {
          cpvCodes.push(...lot.cpvCodes);
        }
      }
    }
    if (project.cpvCodes && Array.isArray(project.cpvCodes)) {
      cpvCodes.push(...project.cpvCodes);
    }

    // Detect language from title Translation object
    let language = "de";
    if (project.title && typeof project.title === "object") {
      if (project.title.fr && !project.title.de) language = "fr";
      else if (project.title.it && !project.title.de) language = "it";
      else if (project.title.en && !project.title.de) language = "en";
    }

    // Try to get real description from publication details (orderDescription)
    const realDescription = pubDetail
      ? pickTranslation(pubDetail.procurement?.orderDescription, language) ||
        (pubDetail.lots?.[0] ? pickTranslation(pubDetail.lots[0].orderDescription, language) : "")
      : "";

    // Build synthetic description from available metadata (fallback)
    const descParts: string[] = [];
    const projectType = project.projectType || null;
    const projectSubType = project.projectSubType || null;
    const processType = project.processType || null;
    const publicationNumber = project.publicationNumber || project.projectNumber || null;

    // Type info
    const typeLabels: Record<string, Record<string, string>> = {
      de: { tender: "Ausschreibung", award: "Zuschlag", cancel: "Abbruch", correction: "Berichtigung" },
      fr: { tender: "Appel d'offres", award: "Adjudication", cancel: "Interruption", correction: "Rectification" },
      en: { tender: "Tender", award: "Award", cancel: "Cancellation", correction: "Correction" },
    };
    const subTypeLabels: Record<string, Record<string, string>> = {
      de: { construction: "Bauleistung", supply: "Lieferung", service: "Dienstleistung" },
      fr: { construction: "Construction", supply: "Fourniture", service: "Service" },
      en: { construction: "Construction", supply: "Supply", service: "Service" },
    };
    const processLabels: Record<string, Record<string, string>> = {
      de: { open: "Offenes Verfahren", selective: "Selektives Verfahren", invitation: "Einladungsverfahren", free: "Freihändiges Verfahren" },
      fr: { open: "Procédure ouverte", selective: "Procédure sélective", invitation: "Procédure sur invitation", free: "Procédure de gré à gré" },
      en: { open: "Open procedure", selective: "Selective procedure", invitation: "Invitation procedure", free: "Direct award" },
    };

    const lang = language === "it" ? "de" : language; // fallback for IT
    if (projectType) {
      const label = typeLabels[lang]?.[projectType] || projectType;
      descParts.push(label);
    }
    if (projectSubType) {
      const label = subTypeLabels[lang]?.[projectSubType] || projectSubType;
      descParts.push(`(${label})`);
    }
    if (processType) {
      const label = processLabels[lang]?.[processType] || processType;
      descParts.push(`— ${label}`);
    }

    let description = descParts.join(" ");
    if (publicationNumber) {
      description += description ? ` | Nr. ${publicationNumber}` : `Nr. ${publicationNumber}`;
    }
    if (canton) {
      description += ` | ${canton}`;
    }
    if (cpvCodes.length > 0) {
      description += ` | CPV: ${cpvCodes.slice(0, 3).join(", ")}`;
    }

    // Extract lot titles for additional context
    if (project.lots && Array.isArray(project.lots) && project.lots.length > 0) {
      const lotTitles = project.lots
        .map((lot: any) => pickTranslation(lot.title))
        .filter(Boolean)
        .slice(0, 3);
      if (lotTitles.length > 0) {
        description += `\n${language === "de" ? "Lose" : language === "fr" ? "Lots" : "Lots"}: ${lotTitles.join("; ")}`;
      }
    }

    const tenderType = "public"; // SIMAP is public procurement

    // Extract contact info from orderAddress
    const addr = project.orderAddress || {};
    const pubAddr = pubDetail?.procurement?.orderAddress || pubDetail?.procurement?.procurementAddress || {};
    const contactInfo: Record<string, string> = {};
    const contactName = pickTranslation(addr.name) || pickTranslation(pubAddr.name) || "";
    if (contactName) contactInfo.name = contactName;
    const street = addr.street || pubAddr.street || "";
    if (street) contactInfo.street = street;
    const zip = addr.zip || addr.postalCode || pubAddr.zip || pubAddr.postalCode || "";
    if (zip) contactInfo.zip = zip;
    const city = pickTranslation(addr.city) || addr.town || pickTranslation(pubAddr.city) || pubAddr.town || "";
    if (city) contactInfo.city = city;
    const email = addr.email || pubAddr.email || "";
    if (email) contactInfo.email = email;
    const phone = addr.phone || addr.telephone || pubAddr.phone || pubAddr.telephone || "";
    if (phone) contactInfo.phone = phone;
    const url = addr.url || addr.website || pubAddr.url || pubAddr.website || "";
    if (url) contactInfo.url = url;
    console.log(`[fetch-simap] Contact info:`, contactInfo);

    // Prefer real description from publication-details, fall back to synthetic
    const finalDescription = realDescription || description || null;

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          title,
          issuer,
          description: finalDescription,
          deadline,
          language,
          canton,
          cpv_codes: [...new Set(cpvCodes)],
          project_type: projectType,
          process_type: processType,
          project_sub_type: projectSubType,
          publication_number: publicationNumber,
          tender_type: tenderType,
          simap_project_id: resolvedId,
          has_documents: project.hasProjectDocuments || false,
          simap_url: simap_url || `https://www.simap.ch/${language}/project-detail/${resolvedId}`,
          contact_info: Object.keys(contactInfo).length > 0 ? contactInfo : null,
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
