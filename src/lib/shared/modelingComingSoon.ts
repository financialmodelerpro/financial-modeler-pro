import { getServerClient } from './supabase';

export async function isModelingComingSoon(): Promise<boolean> {
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('training_settings')
      .select('value')
      .eq('key', 'modeling_hub_coming_soon')
      .single();
    return data?.value === 'true';
  } catch {
    return false;
  }
}
