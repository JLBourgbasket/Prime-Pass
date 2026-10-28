import { notify } from '../_shared/smtp.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.57.4'
import { createHandler } from '../_shared/handler.ts'
Deno.serve(createHandler(createClient, key => Deno.env.get(key), notify))
