import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SIMAP_API_BASE = "https://www.simap.ch/api";
const SIMAP_TOKEN_URL =
  "https://www.simap.ch/auth/realms/simap/protocol/openid-connect/token";
const SIMAP_CLIENT_ID = "bidpilot-tenders";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getSimapToken(
  adminClient: any,
  orgId: string,
): Promise<string | null> {
  const { data: conn } = await adminClient
    .from("simap_connections")
    .select("access_token, refresh_token, token_expires_at")
    .eq("organization_id", orgId)
    .single();

  if (!conn) return null;

  // Token still valid
  if (new Date(conn.token_expires_at) >= new Date()) {
    return conn.access_token;
  }

  // Try to refresh
  if (!conn.refresh_token) return null;

  try {
    const refreshResp = await fetch(SIMAP_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: SIMAP_CLIENT_ID,
        refresh_token: conn.refresh_token,
      }).toString(),
    });

    if (!refreshResp.ok) {
      console.error("[simap-documents] Token refresh failed:", refreshResp.status);
      return null;
    }

    const tokenData = await refreshResp.json();
    await adminClient.from("simap_connections").update({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || conn.refresh_token,
      token_expires_at: new Date(
        Date.now() + (tokenData.expires_in || 300) * 1000,
      ).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("organization_id", orgId);

    console.log("[simap-documents] Token refreshed");
    return tokenData.access_token;
  } catch (e) {
    console.error("[simap-documents] Token refresh error:", e);
    return null;
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, simap_project_id, tender_id, document_id, document_ids } = body;

    if (!action) return jsonResponse({ error: "action is required" }, 400);
    if (!simap_project_id) return jsonResponse({ error: "simap_project_id is required" }, 400);

    // ── Auth ──────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Missing authorization header" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return jsonResponse({ error: "Unauthorized" }, 401);

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data: profile } = await adminClient
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();

    if (!profile?.organization_id) {
      return jsonResponse({ error: "User has no organization" }, 400);
    }
    const orgId = profile.organization_id;

    // ── SIMAP Token (required for document operations) ────────────────
    const simapToken = await getSimapToken(adminClient, orgId);
    if (!simapToken) {
      return jsonResponse({
        error: "SIMAP not connected. Please connect your SIMAP account first.",
        reconnect: true,
      }, 403);
    }

    const simapHeaders: Record<string, string> = {
      "Accept": "application/json",
      "Authorization": `Bearer ${simapToken}`,
    };

    // ── LIST ──────────────────────────────────────────────────────────
    if (action === "list") {
      const docsUrl = `${SIMAP_API_BASE}/vendors/v1/my/projects/${simap_project_id}/documents`;
      console.log(`[simap-documents] Listing documents: ${docsUrl}`);

      const resp = await fetch(docsUrl, { headers: simapHeaders });
      console.log(`[simap-documents] List response: ${resp.status}`);

      if (!resp.ok) {
        const errText = await resp.text();
        console.error(`[simap-documents] List error: ${errText.substring(0, 500)}`);
        return jsonResponse({
          error: `SIMAP document listing failed: ${resp.status}`,
          detail: errText.substring(0, 200),
        }, resp.status === 401 || resp.status === 403 ? 403 : 502);
      }

      const data = await resp.json();
      console.log(`[simap-documents] Documents response keys:`, Object.keys(data));

      // The API returns an array of documents or an object with documents array
      const rawDocs = Array.isArray(data) ? data : (data.documents || data.projectDocuments || []);
      console.log(`[simap-documents] Found ${rawDocs.length} documents`);

      const documents = rawDocs.map((doc: any) => ({
        id: doc.id || doc.projectDocumentId,
        name: doc.name || doc.fileName || doc.title || "Unknown",
        size: doc.size || doc.fileSize || null,
        type: doc.contentType || doc.mimeType || null,
        lot_id: doc.lotId || null,
        lot_title: doc.lotTitle || null,
        category: doc.category || doc.documentCategory || null,
      }));

      return jsonResponse({ success: true, documents });
    }

    // ── DOWNLOAD (single document) ───────────────────────────────────
    if (action === "download") {
      if (!document_id) return jsonResponse({ error: "document_id is required" }, 400);
      if (!tender_id) return jsonResponse({ error: "tender_id is required" }, 400);

      console.log(`[simap-documents] Downloading document ${document_id} for tender ${tender_id}`);

      // Step 1: Get download token
      const tokenUrl = `${SIMAP_API_BASE}/project-documents/v1/docs/${document_id}/token`;
      console.log(`[simap-documents] Getting download token: ${tokenUrl}`);

      const tokenResp = await fetch(tokenUrl, { headers: simapHeaders });
      if (!tokenResp.ok) {
        const errText = await tokenResp.text();
        console.error(`[simap-documents] Token error: ${tokenResp.status} ${errText.substring(0, 200)}`);
        return jsonResponse({ error: `Failed to get download token: ${tokenResp.status}` }, 502);
      }

      const tokenData = await tokenResp.json();
      const downloadToken = tokenData.token || tokenData.downloadToken || tokenData;
      console.log(`[simap-documents] Got download token`);

      // Step 2: Download the file
      const downloadUrl = `${SIMAP_API_BASE}/project-documents/v1/docs/${document_id}?token=${encodeURIComponent(typeof downloadToken === "string" ? downloadToken : JSON.stringify(downloadToken))}`;
      console.log(`[simap-documents] Downloading file...`);

      const fileResp = await fetch(downloadUrl);
      if (!fileResp.ok) {
        const errText = await fileResp.text();
        console.error(`[simap-documents] Download error: ${fileResp.status} ${errText.substring(0, 200)}`);
        return jsonResponse({ error: `Failed to download document: ${fileResp.status}` }, 502);
      }

      // Get filename from Content-Disposition header or use document_id
      const contentDisposition = fileResp.headers.get("content-disposition") || "";
      let fileName = `document_${document_id}`;
      const cdMatch = contentDisposition.match(/filename[*]?=(?:UTF-8''|"?)([^";]+)/i);
      if (cdMatch) {
        fileName = decodeURIComponent(cdMatch[1].replace(/"/g, ""));
      }

      // Also try to get a nicer name from the list call (passed in body)
      const docName = body.document_name || fileName;
      const contentType = fileResp.headers.get("content-type") || "application/octet-stream";

      const fileBuffer = await fileResp.arrayBuffer();
      const fileBytes = new Uint8Array(fileBuffer);
      console.log(`[simap-documents] Downloaded ${fileBytes.length} bytes: ${docName}`);

      // Step 3: Upload to Supabase Storage
      const storagePath = `${orgId}/${tender_id}/${crypto.randomUUID()}_${docName}`;
      const { error: uploadErr } = await adminClient.storage
        .from("tender-files")
        .upload(storagePath, fileBytes, {
          contentType,
          upsert: false,
        });

      if (uploadErr) {
        console.error(`[simap-documents] Storage upload error:`, uploadErr);
        return jsonResponse({ error: `Failed to store document: ${uploadErr.message}` }, 500);
      }
      console.log(`[simap-documents] Uploaded to storage: ${storagePath}`);

      // Step 4: Create tender_documents row
      const { data: docRecord, error: insertErr } = await adminClient
        .from("tender_documents")
        .insert({
          tender_id,
          organization_id: orgId,
          file_name: docName,
          file_type: contentType,
          storage_path: storagePath,
          parse_status: "pending",
        })
        .select()
        .single();

      if (insertErr) {
        console.error(`[simap-documents] Insert error:`, insertErr);
        return jsonResponse({ error: `Failed to create document record: ${insertErr.message}` }, 500);
      }

      console.log(`[simap-documents] Created tender_document: ${docRecord.id}`);

      return jsonResponse({
        success: true,
        document: {
          id: docRecord.id,
          file_name: docName,
          storage_path: storagePath,
          parse_status: "pending",
        },
      });
    }

    // ── DOWNLOAD-ALL ─────────────────────────────────────────────────
    if (action === "download-all") {
      if (!tender_id) return jsonResponse({ error: "tender_id is required" }, 400);

      // First list available documents
      const docsUrl = `${SIMAP_API_BASE}/vendors/v1/my/projects/${simap_project_id}/documents`;
      console.log(`[simap-documents] Listing documents for download-all: ${docsUrl}`);

      const listResp = await fetch(docsUrl, { headers: simapHeaders });
      if (!listResp.ok) {
        return jsonResponse({ error: `Failed to list documents: ${listResp.status}` }, 502);
      }

      const listData = await listResp.json();
      const rawDocs = Array.isArray(listData) ? listData : (listData.documents || listData.projectDocuments || []);

      // Filter by document_ids if provided
      let docsToDownload = rawDocs;
      if (document_ids && Array.isArray(document_ids) && document_ids.length > 0) {
        docsToDownload = rawDocs.filter((d: any) =>
          document_ids.includes(d.id || d.projectDocumentId)
        );
      }

      console.log(`[simap-documents] Downloading ${docsToDownload.length} of ${rawDocs.length} documents`);

      const results: any[] = [];
      const errors: any[] = [];

      for (const doc of docsToDownload) {
        const docId = doc.id || doc.projectDocumentId;
        const docName = doc.name || doc.fileName || doc.title || `document_${docId}`;

        try {
          // Get download token
          const tokenUrl = `${SIMAP_API_BASE}/project-documents/v1/docs/${docId}/token`;
          const tokenResp = await fetch(tokenUrl, { headers: simapHeaders });

          if (!tokenResp.ok) {
            console.error(`[simap-documents] Token failed for ${docId}: ${tokenResp.status}`);
            errors.push({ id: docId, name: docName, error: `Token failed: ${tokenResp.status}` });
            continue;
          }

          const tokenData = await tokenResp.json();
          const downloadToken = tokenData.token || tokenData.downloadToken || tokenData;

          // Download file
          const downloadUrl = `${SIMAP_API_BASE}/project-documents/v1/docs/${docId}?token=${encodeURIComponent(typeof downloadToken === "string" ? downloadToken : JSON.stringify(downloadToken))}`;
          const fileResp = await fetch(downloadUrl);

          if (!fileResp.ok) {
            console.error(`[simap-documents] Download failed for ${docId}: ${fileResp.status}`);
            errors.push({ id: docId, name: docName, error: `Download failed: ${fileResp.status}` });
            continue;
          }

          const contentType = fileResp.headers.get("content-type") || "application/octet-stream";

          // Get filename from Content-Disposition if available
          const contentDisposition = fileResp.headers.get("content-disposition") || "";
          const cdMatch = contentDisposition.match(/filename[*]?=(?:UTF-8''|"?)([^";]+)/i);
          const finalName = cdMatch ? decodeURIComponent(cdMatch[1].replace(/"/g, "")) : docName;

          const fileBuffer = await fileResp.arrayBuffer();
          const fileBytes = new Uint8Array(fileBuffer);

          // Upload to storage
          const storagePath = `${orgId}/${tender_id}/${crypto.randomUUID()}_${finalName}`;
          const { error: uploadErr } = await adminClient.storage
            .from("tender-files")
            .upload(storagePath, fileBytes, { contentType, upsert: false });

          if (uploadErr) {
            console.error(`[simap-documents] Upload failed for ${docId}:`, uploadErr);
            errors.push({ id: docId, name: finalName, error: `Upload failed: ${uploadErr.message}` });
            continue;
          }

          // Create tender_documents row
          const { data: docRecord, error: insertErr } = await adminClient
            .from("tender_documents")
            .insert({
              tender_id,
              organization_id: orgId,
              file_name: finalName,
              file_type: contentType,
              storage_path: storagePath,
              parse_status: "pending",
            })
            .select()
            .single();

          if (insertErr) {
            errors.push({ id: docId, name: finalName, error: `DB insert failed: ${insertErr.message}` });
            continue;
          }

          results.push({
            id: docRecord.id,
            file_name: finalName,
            storage_path: storagePath,
            parse_status: "pending",
          });

          console.log(`[simap-documents] Downloaded: ${finalName}`);
        } catch (e: any) {
          console.error(`[simap-documents] Error downloading ${docId}:`, e);
          errors.push({ id: docId, name: docName, error: e.message });
        }
      }

      console.log(`[simap-documents] Download-all complete: ${results.length} success, ${errors.length} errors`);

      return jsonResponse({
        success: true,
        documents: results,
        errors: errors.length > 0 ? errors : undefined,
        total: docsToDownload.length,
      });
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, 400);
  } catch (err: any) {
    console.error("[simap-documents] Error:", err);
    return jsonResponse({ error: err.message }, 500);
  }
});
