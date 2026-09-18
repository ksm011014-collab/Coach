(function installAndroidOfflineApi() {
  if (!window.BoxingCoachAndroid) return;
  if (window.BoxingCoachAndroid.offlineMode?.() === false) return;

  const STORAGE_KEY = "boxing_android_database_v1";
  const originalFetch = window.fetch.bind(window);
  const nowSeconds = () => Date.now() / 1000;
  const newId = (prefix) => `${prefix}_${crypto.randomUUID()}`;
  const authTokens = new Map();
  let pendingApi = Promise.resolve();

  function initialDatabase() {
    return {
      gyms: [],
      users: [],
      profiles: [],
      sessions: [],
      labels: [],
    };
  }

  function memberProfile(id, userId, gymId, name, phone = "", birthdate = "", gender = "") {
    return {
      id,
      user_id: userId,
      gym_id: gymId,
      name,
      phone,
      birthdate,
      gender,
      height_cm: 170,
      weight_kg: 70,
      reach_cm: 172,
      stance: "orthodox",
      injury_note: "",
      training_level: 1,
    };
  }

  function loadDatabase() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const stored = JSON.parse(raw);
      if (["gyms", "users", "profiles", "sessions", "labels"].every(key => Array.isArray(stored?.[key]))) return stored;
      throw new Error("invalid local database; recovery is required");
    }
    const database = initialDatabase();
    saveDatabase(database);
    return database;
  }

  function saveDatabase(database) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(database));
  }

  function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  function errorResponse(message, status = 400) {
    return jsonResponse({ error: message }, status);
  }

  function normalizeUsername(value) {
    return String(value || "").trim().toLowerCase();
  }

  function normalizeCenterCode(value) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  }

  async function sha256(value) {
    const bytes = new TextEncoder().encode(String(value));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function passwordHash(value, salt = crypto.randomUUID()) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(value), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 120000 }, key, 256);
    return `pbkdf2:${salt}:${Array.from(new Uint8Array(bits), byte => byte.toString(16).padStart(2, "0")).join("")}`;
  }

  async function passwordMatches(password, stored) {
    if (typeof stored !== "string") return false;
    if (!stored.startsWith("pbkdf2:")) return /^[a-f0-9]{64}$/.test(stored) && stored === await sha256(password);
    const parts = stored.split(":");
    return parts.length === 3 && stored === await passwordHash(password, parts[1]);
  }

  function validAccountInput(username, password) {
    return /^[a-z0-9_]{4,20}$/.test(username) && typeof password === "string" && password.length >= 8 && password.length <= 256 && /[^A-Za-z0-9]/.test(password);
  }

  function issueToken(database, user) {
    const token = `android:${crypto.randomUUID()}`;
    authTokens.set(token, { userId: user.id, expires: nowSeconds() + 28800, version: user.token_version || 1 });
    return { token, expires_in: 28800, user: publicUser(database, user) };
  }

  function publicUser(database, user) {
    const gym = database.gyms.find((item) => item.id === user.gym_id);
    return {
      id: user.id,
      gym_id: user.gym_id,
      center_name: gym?.name || "",
      center_code: gym?.code || "",
      username: user.username,
      email: user.email,
      role: user.role,
      name: user.name,
    };
  }

  function memberPayload(database, profile) {
    const user = database.users.find((item) => item.id === profile.user_id);
    return user ? { ...profile, username: user.username, email: user.email, role: user.role } : { ...profile };
  }

  function authenticatedUser(database, options) {
    const header = new Headers(options.headers || {}).get("Authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const issued = authTokens.get(token);
    if (!issued || issued.expires <= nowSeconds()) { authTokens.delete(token); return null; }
    return database.users.find(item => item.id === issued.userId && (item.status || "ACTIVE") === "ACTIVE" && (item.token_version || 1) === issued.version) || null;
  }

  function accessibleProfile(database, user, profileId) {
    const profile = database.profiles.find((item) => item.id === profileId);
    if (!profile || profile.gym_id !== user.gym_id) return null;
    if (user.role !== "OWNER" && profile.user_id !== user.id) return null;
    return profile;
  }

  async function requestBody(options) {
    if (!options.body || typeof options.body !== "string") return {};
    try {
      const body = JSON.parse(options.body);
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("JSON object required");
      return body;
    } catch {
      throw new Error("invalid JSON body");
    }
  }

  async function routeApi(url, options) {
    const database = loadDatabase();
    const method = String(options.method || "GET").toUpperCase();
    const path = url.pathname.slice(4) || "/";
    let body = {};
    try {
      body = await requestBody(options);
    } catch (error) {
      return errorResponse(error.message);
    }

    if (method === "GET" && path === "/system/health") {
      return jsonResponse({ status: "ok", service: "boxing-coach-android-local", version: "0.3.0", public_center_signup: true,
        capabilities: { contract_version: 1, engine_version: "0.3.0", data_mode: "android-local",
          analysis: { available: false, status: "not_installed" }, camera: { owner: "device", capture: "browser" },
          recording_conversion: { owner: "local_worker", route_available: false } } });
    }
    if (method === "GET" && path === "/auth/check-username") {
      const username = normalizeUsername(url.searchParams.get("username"));
      return jsonResponse({ username, available: Boolean(username) && !database.users.some((user) => user.username === username) });
    }

    if (method === "POST" && path === "/auth/login") {
      const username = normalizeUsername(body.username || body.email);
      const user = database.users.find((item) => item.username === username);
      if (!user || !await passwordMatches(body.password || "", user.password_hash)) {
        return errorResponse("invalid username or password", 401);
      }
      if ((user.status || "ACTIVE") !== "ACTIVE") return errorResponse("account is suspended", 403);
      if (!user.password_hash.startsWith("pbkdf2:")) {
        user.password_hash = await passwordHash(body.password);
        saveDatabase(database);
      }
      return jsonResponse(issueToken(database, user));
    }

    if (method === "POST" && path === "/auth/signup") {
      const username = normalizeUsername(body.username);
      if (!validAccountInput(username, body.password)) return errorResponse("invalid username or password format");
      if (!username || database.users.some((item) => item.username === username)) {
        return errorResponse("username is already in use");
      }
      if (body.password !== body.password_confirm) return errorResponse("password confirmation does not match");
      const role = String(body.role || "MEMBER").toUpperCase();
      if (!["OWNER", "MEMBER"].includes(role)) return errorResponse("public signup role is not allowed", 403);
      let gym;
      if (role === "OWNER") {
        const code = normalizeCenterCode(body.center_code) || `center${Math.random().toString(16).slice(2, 6)}`;
        if (database.gyms.some((item) => item.code === code)) return errorResponse("center code is already in use");
        gym = { id: newId("gym"), name: String(body.center_name || "").trim(), code };
        if (!gym.name) return errorResponse("center name is required");
        database.gyms.push(gym);
      } else {
        gym = database.gyms.find((item) => item.code === normalizeCenterCode(body.center_code));
        if (!gym) return errorResponse("valid center code is required");
      }
      const user = {
        id: newId("user"),
        gym_id: gym.id,
        username,
        email: String(body.email || ""),
        password_hash: await passwordHash(body.password),
        role,
        name: String(body.name || username).trim(),
      };
      const profile = memberProfile(newId("profile"), user.id, gym.id, user.name, body.phone, body.birthdate, body.gender);
      database.users.push(user);
      database.profiles.push(profile);
      saveDatabase(database);
      return jsonResponse(issueToken(database, user), 201);
    }

    const user = authenticatedUser(database, options);
    if (!user) return errorResponse("authentication required", 401);

    if (method === "POST" && path === "/auth/logout") {
      authTokens.delete(new Headers(options.headers || {}).get("Authorization").slice(7));
      return jsonResponse({ logged_out: true });
    }

    if (method === "GET" && path === "/me") {
      const profile = database.profiles.find((item) => item.user_id === user.id) || null;
      return jsonResponse({ user: publicUser(database, user), profile });
    }

    if (method === "GET" && path === "/members") {
      const profiles = database.profiles.filter((profile) => profile.gym_id === user.gym_id && (user.role === "OWNER" || profile.user_id === user.id));
      return jsonResponse({ members: profiles.map((profile) => memberPayload(database, profile)) });
    }

    if (method === "POST" && path === "/members") {
      if (user.role !== "OWNER") return errorResponse("only administrators can create members", 403);
      const username = normalizeUsername(body.username);
      if (!validAccountInput(username, body.password)) return errorResponse("invalid username or password format");
      if (!username || database.users.some((item) => item.username === username)) return errorResponse("username is already in use");
      const member = {
        id: newId("user"), gym_id: user.gym_id, username, email: String(body.email || ""),
        password_hash: await passwordHash(body.password), role: "MEMBER", name: String(body.name || username).trim(),
      };
      const profile = memberProfile(newId("profile"), member.id, user.gym_id, member.name, body.phone, body.birthdate, body.gender);
      profile.training_level = Number(body.training_level || 1);
      database.users.push(member);
      database.profiles.push(profile);
      saveDatabase(database);
      return jsonResponse({ member: memberPayload(database, profile) }, 201);
    }


    const memberMatch = path.match(/^\/members\/([^/]+)$/);
    if (memberMatch) {
      const profile = accessibleProfile(database, user, memberMatch[1]);
      if (!profile) return errorResponse("member not found", 404);
      if (method === "GET") return jsonResponse({ member: memberPayload(database, profile) });
      if (method === "PATCH") {
        if (!["OWNER", "MEMBER"].includes(user.role) || (user.role === "MEMBER" && ("reach_cm" in body || "training_level" in body))) return errorResponse("profile fields are outside your mutation scope", 403);
        const allowed = ["phone", "birthdate", "gender", "height_cm", "weight_kg", "reach_cm", "stance", "injury_note", "name", "training_level"];
        if (Object.keys(body).some(key => !allowed.includes(key))) return errorResponse("unsupported profile fields", 400);
        const limits = { name: 100, phone: 40, gender: 40, injury_note: 2000 };
        const ranges = { height_cm: [100,250], weight_kg: [25,300], reach_cm: [0,300], training_level: [1,5] };
        for (const [key, value] of Object.entries(body)) {
          if (key in limits && (typeof value !== "string" || value.length > limits[key] || (key === "name" && !value.trim()))) return errorResponse(`invalid ${key}`, 400);
          if (key in ranges && (!Number.isInteger(value) || value < ranges[key][0] || value > ranges[key][1])) return errorResponse(`invalid ${key}`, 400);
          if (key === "stance" && !["orthodox", "southpaw"].includes(value)) return errorResponse("invalid stance", 400);
          if (key === "birthdate" && value != null && value !== "") {
            const date = new Date(`${value}T00:00:00Z`);
            if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0,4)) < 1 || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value) return errorResponse("invalid birthdate", 400);
          }
        }
        allowed.forEach((key) => { if (key in body) profile[key] = body[key]; });
        saveDatabase(database);
        return jsonResponse({ member: memberPayload(database, profile) });
      }
    }

    if (method === "GET" && path === "/sessions") {
      const sessions = database.sessions.filter((session) => session.gym_id === user.gym_id && (user.role === "OWNER" || session.user_id === user.id));
      return jsonResponse({ sessions: sessions.sort((first, second) => second.started_at - first.started_at) });
    }

    if (method === "POST" && path === "/sessions") {
      const targetUserId = String(body.user_id || user.id);
      const target = database.users.find((item) => item.id === targetUserId && item.gym_id === user.gym_id);
      if (!target || (target.status || "ACTIVE") !== "ACTIVE" || (user.role !== "OWNER" && target.id !== user.id)) return errorResponse("target user is outside your center", 403);
      if (body.request_id != null && (typeof body.request_id !== "string" || body.request_id.length < 1 || body.request_id.length > 128)) return errorResponse("invalid request_id", 400);
      if (body.focus != null && (typeof body.focus !== "string" || body.focus.length < 1 || body.focus.length > 100)) return errorResponse("invalid focus", 400);
      const session = {
        id: newId("session"), user_id: target.id, gym_id: user.gym_id, started_at: nowSeconds(), ended_at: null,
        camera_config: (Array.isArray(body.camera_config) ? body.camera_config : [{ camera_id: "tablet_camera" }])
          .slice(0, 3).filter(camera => camera && typeof camera === "object")
          .map(camera => ({ camera_id: String(camera.camera_id || "tablet_camera"), label: String(camera.label || ""), view_angle: String(camera.view_angle || "front"), device_id: String(camera.device_id || ""), enabled: camera.enabled !== false })),
        overall_score: 0, focus: String(body.focus || "free_training"), feedback_report: "",
        created_by: user.id, request_id: body.request_id ?? null,
      };
      const previous = session.request_id && database.sessions.find(item => item.created_by === user.id && item.request_id === session.request_id);
      if (previous) {
        if (previous.user_id !== session.user_id || previous.focus !== session.focus || JSON.stringify(previous.camera_config) !== JSON.stringify(session.camera_config)) return errorResponse("request_id already used for another request", 409);
        return jsonResponse({ session: previous });
      }
      database.sessions.unshift(session);
      saveDatabase(database);
      return jsonResponse({ session }, 201);
    }

    const endSessionMatch = path.match(/^\/sessions\/([^/]+)\/end$/);
    if (method === "PATCH" && endSessionMatch) {
      const session = database.sessions.find((item) => item.id === endSessionMatch[1]);
      if (!session || session.gym_id !== user.gym_id || (user.role !== "OWNER" && session.user_id !== user.id)) return errorResponse("session not found", 404);
      session.ended_at ||= nowSeconds();
      saveDatabase(database);
      return jsonResponse({ session });
    }

    const sessionMatch = path.match(/^\/sessions\/([^/]+)$/);
    if (sessionMatch) {
      const session = database.sessions.find((item) => item.id === sessionMatch[1]);
      if (!session || session.gym_id !== user.gym_id || (user.role !== "OWNER" && session.user_id !== user.id)) return errorResponse("session not found", 404);
      if (method === "GET") return jsonResponse({ session, labels: database.labels.filter((item) => item.session_id === session.id) });
      if (method === "DELETE") {
        database.sessions = database.sessions.filter((item) => item.id !== session.id);
        database.labels = database.labels.filter((item) => item.session_id !== session.id);
        saveDatabase(database);
        return jsonResponse({ deleted: true, session_id: session.id });
      }
    }


    if (method === "POST" && path === "/recordings/convert") {
      return errorResponse("MP4 conversion is unavailable on this device", 501);
    }

    return errorResponse("not found", 404);
  }

  window.fetch = function androidOfflineFetch(input, options = {}) {
    const url = new URL(typeof input === "string" ? input : input.url, window.location.origin);
    if (url.origin === window.location.origin && url.pathname.startsWith("/api/")) {
      const response = pendingApi.then(() => routeApi(url, options)).catch(() => errorResponse("로컬 데이터를 처리하지 못했습니다. 기존 데이터를 보존한 상태로 복구가 필요합니다.", 503));
      pendingApi = response.then(() => undefined);
      return response;
    }
    return originalFetch(input, options);
  };
})();
