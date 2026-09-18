import { createClient } from "npm:@supabase/supabase-js@2";

type AppRole = "PLATFORM_ADMIN" | "CENTER_OWNER" | "COACH" | "MEMBER";

const jsonHeaders = { "Content-Type": "application/json; charset=utf-8" };

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return response({ error: "POST 요청만 허용됩니다." }, 405);
    }

    const authorization = request.headers.get("Authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) {
      return response({ error: "로그인이 필요합니다." }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const publishableKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
      return response({ error: "서버 계정 설정이 완료되지 않았습니다." }, 500);
    }

    const callerClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData.user) {
      return response({ error: "로그인 세션이 유효하지 않습니다." }, 401);
    }

    const { data: actor, error: actorError } = await adminClient
      .from("accounts")
      .select("id, center_id, role, status, token_version")
      .eq("id", userData.user.id)
      .single();
    if (actorError || !actor || actor.status !== "ACTIVE") {
      return response({ error: "사용할 수 없는 계정입니다." }, 403);
    }

    const { data: accessActive, error: accessError } = await callerClient.rpc("account_is_active");
    if (accessError || accessActive !== true) {
      return response({ error: "계정 또는 센터의 이용 권한이 중지되었습니다." }, 403);
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid body");
    } catch {
      return response({ error: "요청 형식이 올바르지 않습니다." }, 400);
    }

    const username = String(body.username ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const displayName = String(body.name ?? username).trim();
    const contactEmail = String(body.email ?? "").trim();
    const role = String(body.role ?? "MEMBER").toUpperCase() as AppRole;
    const requestedCenterId = body.center_id ? String(body.center_id) : actor.center_id;

    if (displayName.length < 1 || displayName.length > 100 || contactEmail.length > 254) {
      return response({ error: "이름 또는 이메일 길이가 올바르지 않습니다." }, 400);
    }

    if (!/^[a-z0-9_]{4,20}$/.test(username)) {
      return response({ error: "아이디는 영문 소문자, 숫자, _ 조합 4~20자리여야 합니다." }, 400);
    }
    if (password.length < 8 || password.length > 256 || !/[^A-Za-z0-9]/.test(password)) {
      return response({ error: "비밀번호는 특수문자를 포함한 8자리 이상이어야 합니다." }, 400);
    }
    if (!(["PLATFORM_ADMIN", "CENTER_OWNER", "COACH", "MEMBER"] as string[]).includes(role)) {
      return response({ error: "지원하지 않는 역할입니다." }, 400);
    }
    if (actor.role === "CENTER_OWNER" && (!(["COACH", "MEMBER"] as string[]).includes(role) || requestedCenterId !== actor.center_id)) {
      return response({ error: "센터 관리자는 자기 센터의 코치와 회원만 생성할 수 있습니다." }, 403);
    }
    if (actor.role !== "PLATFORM_ADMIN" && actor.role !== "CENTER_OWNER") {
      return response({ error: "계정 생성 권한이 없습니다." }, 403);
    }
    if (role !== "PLATFORM_ADMIN" && !requestedCenterId) {
      return response({ error: "센터 지정이 필요합니다." }, 400);
    }

    const { data: provision, error: provisionError } = await adminClient
      .from("account_provisioning")
      .insert({
        username,
        contact_email: contactEmail,
        display_name: displayName,
        role,
        center_id: role === "PLATFORM_ADMIN" ? null : requestedCenterId,
        created_by: actor.id,
        creator_token_version: actor.token_version,
      })
      .select("nonce")
      .single();
    if (provisionError || !provision) {
      return response({ error: duplicateMessage(provisionError?.message) }, 409);
    }

    const authEmailDomain = Deno.env.get("BOXING_COACH_AUTH_EMAIL_DOMAIN") || "accounts.boxingcoach.app";
    if (!/^[a-z0-9.-]+$/i.test(authEmailDomain)) {
      return response({ error: "서버 인증 도메인 설정이 올바르지 않습니다." }, 500);
    }
    const syntheticEmail = `${username}@${authEmailDomain}`;
    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email: syntheticEmail,
      password,
      email_confirm: true,
      user_metadata: {
        username,
        name: displayName,
        contact_email: contactEmail,
        provisioning_nonce: provision.nonce,
      },
    });
    if (createError || !created.user) {
      await adminClient.from("account_provisioning").delete().eq("nonce", provision.nonce);
      return response({ error: duplicateMessage(createError?.message) }, 409);
    }

    const { data: account, error: accountError } = await adminClient
      .from("accounts")
      .select("id, center_id, username, contact_email, display_name, role, status, token_version")
      .eq("id", created.user.id)
      .single();
    if (accountError || !account) {
      return response({ error: "계정은 생성되었지만 프로필을 불러오지 못했습니다." }, 500);
    }

    return response({ account }, 201);
  },
};

function duplicateMessage(message?: string): string {
  const normalized = String(message ?? "").toLowerCase();
  if (normalized.includes("already") || normalized.includes("duplicate") || normalized.includes("unique")) {
    return "이미 사용 중인 아이디입니다.";
  }
  return "계정을 생성하지 못했습니다.";
}

function response(payload: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(payload), { status, headers: jsonHeaders });
}
