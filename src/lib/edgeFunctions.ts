import { supabase } from '@/integrations/supabase/client';

export async function getAccessToken(): Promise<string> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) throw new Error('No active session. Please sign in again.');
  return accessToken;
}

export async function callEdgeFunction(functionName: string, body: Record<string, unknown>): Promise<any> {
  const accessToken = await getAccessToken();
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${functionName}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify(body),
    }
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result?.error || `${functionName} failed: ${response.status}`);
  return result;
}
