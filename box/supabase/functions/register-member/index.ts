import { createClient } from "npm:@supabase/supabase-js@2";
import { registrationHandler } from "./handler.mjs";

export default { fetch: registrationHandler({ createClient, env: (name: string) => Deno.env.get(name) }) };
