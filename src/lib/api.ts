import { supabase } from './supabase'
export async function api(action: string, data: Record<string, unknown> = {}) {
  if (!navigator.onLine) throw new Error('Connexion interrompue. Aucune modification confirmée.')
  const { data: auth } = await supabase!.auth.getSession()
  if (!auth.session) throw new Error('Reconnectez-vous pour continuer.')
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/prime-pass`, { method: 'POST', headers: { Authorization: `Bearer ${auth.session.access_token}`, 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY }, body: JSON.stringify({ action, data }) })
  let result
  try { result = await response.json() } catch { throw new Error('Le serveur Prime Pass est indisponible. Réessayez.') }
  if (!response.ok || result.error) throw new Error(result.error || 'Opération impossible')
  return result
}
