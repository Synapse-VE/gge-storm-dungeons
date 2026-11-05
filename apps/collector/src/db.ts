import { createClient } from '@supabase/supabase-js';
import { env } from './env';

export const supabase = createClient(env.supabaseUrl, env.supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export async function recordRun<T>(
  job: string,
  action: () => Promise<T>,
): Promise<{ value: T | null; error: unknown }> {
  const startedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from('scrape_runs')
    .insert({ job, started_at: startedAt })
    .select('id')
    .single();

  try {
    const value = await action();
    if (!error && data?.id) {
      await supabase
        .from('scrape_runs')
        .update({ finished_at: new Date().toISOString(), ok: true, rows: typeof value === 'number' ? value : null })
        .eq('id', data.id);
    }
    return { value, error: null };
  } catch (actionError) {
    if (!error && data?.id) {
      await supabase
        .from('scrape_runs')
        .update({
          finished_at: new Date().toISOString(),
          ok: false,
          error: actionError instanceof Error ? actionError.message : String(actionError),
        })
        .eq('id', data.id);
    }
    return { value: null, error: actionError };
  }
}
