import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const supabaseConfigured = Boolean(url && key && !url.includes('your-project'))

export const supabase = supabaseConfigured
  ? createClient(url!, key!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null

export type ClaimResult = {
  granted: boolean
  remaining: number
  claim_id?: string
  reason?: string
}

export async function claimDailyAccess(): Promise<ClaimResult> {
  if (!supabase) return { granted: true, remaining: 0, claim_id: 'demo-claim' }
  const { data, error } = await supabase.rpc('claim_daily_access')
  if (error) throw error
  return data as ClaimResult
}
