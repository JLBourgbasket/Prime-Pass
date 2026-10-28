import { notify } from '../_shared/smtp.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.57.4'
import { createSubscriptionHandler } from '../_shared/subscription-handler.ts'
Deno.serve(createSubscriptionHandler(createClient,key=>Deno.env.get(key),notify))
