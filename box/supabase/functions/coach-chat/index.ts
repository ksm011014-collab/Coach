import { createClient } from "npm:@supabase/supabase-js@2";
import { coachHandler } from "./handler.mjs";

export default { fetch: coachHandler({ createClient, env: (name: string) => Deno.env.get(name) }) };
