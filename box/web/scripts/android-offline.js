(function installAndroidOfflineApi() {
  if (!window.BoxingCoachAndroid) return;
  if (window.BoxingCoachAndroid.offlineMode?.() === false) return;

  const STORAGE_KEY = "boxing_android_database_v1";
  const originalFetch = window.fetch.bind(window);
  const nowSeconds = () => Date.now() / 1000;
  const newId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;

  function initialDatabase() {
    return {
      gyms: [{ id: "gym_apex", name: "APEX Boxing Lab", code: "apex" }],
      users: [
        {
          id: "user_owner",
          gym_id: "gym_apex",
          username: "owner",
          email: "",
          password_hash: "82179db0ea3559b06b54e7ad39dbbe4b94c1e706fb68c56fc607519dd02e09f6",
          role: "OWNER",
          name: "김관리자",
        },
        {
          id: "user_member",
          gym_id: "gym_apex",
          username: "member",
          email: "",
          password_hash: "0f295625414e1df6a95ff5039db15f982cad1d768d5a001f6bfcf3fd9c6993fd",
          role: "MEMBER",
          name: "이회원",
        },
      ],
      profiles: [
        memberProfile("profile_owner", "user_owner", "gym_apex", "김관리자", "010-0000-0001", "1985-01-01", "male"),
        memberProfile("profile_member", "user_member", "gym_apex", "이회원", "010-0000-0002", "1995-01-01", "female"),
      ],
      sessions: [],
      calibrations: [],
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
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (stored?.users && stored?.profiles) return stored;
    } catch {
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
    const userId = token.startsWith("android:") ? token.slice(8) : "";
    return database.users.find((item) => item.id === userId) || null;
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
      return JSON.parse(options.body);
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

    if (method === "GET" && path === "/auth/check-username") {
      const username = normalizeUsername(url.searchParams.get("username"));
      return jsonResponse({ username, available: Boolean(username) && !database.users.some((user) => user.username === username) });
    }

    if (method === "POST" && path === "/auth/login") {
      const username = normalizeUsername(body.username || body.email);
      const user = database.users.find((item) => item.username === username);
      if (!user || user.password_hash !== await sha256(body.password || "")) {
        return errorResponse("invalid username or password", 403);
      }
      return jsonResponse({ token: `android:${user.id}`, user: publicUser(database, user) });
    }

    if (method === "POST" && path === "/auth/signup") {
      const username = normalizeUsername(body.username);
      if (!username || database.users.some((item) => item.username === username)) {
        return errorResponse("username is already in use");
      }
      if (body.password !== body.password_confirm) return errorResponse("password confirmation does not match");
      const role = String(body.role || "MEMBER").toUpperCase();
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
        password_hash: await sha256(body.password || ""),
        role,
        name: String(body.name || username).trim(),
      };
      const profile = memberProfile(newId("profile"), user.id, gym.id, user.name, body.phone, body.birthdate, body.gender);
      database.users.push(user);
      database.profiles.push(profile);
      saveDatabase(database);
      return jsonResponse({ token: `android:${user.id}`, user: publicUser(database, user) }, 201);
    }

    const user = authenticatedUser(database, options);
    if (!user) return errorResponse("authentication required", 401);

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
      if (!username || database.users.some((item) => item.username === username)) return errorResponse("username is already in use");
      const member = {
        id: newId("user"), gym_id: user.gym_id, username, email: String(body.email || ""),
        password_hash: await sha256(body.password || ""), role: "MEMBER", name: String(body.name || username).trim(),
      };
      const profile = memberProfile(newId("profile"), member.id, user.gym_id, member.name, body.phone, body.birthdate, body.gender);
      profile.training_level = Number(body.training_level || 1);
      database.users.push(member);
      database.profiles.push(profile);
      saveDatabase(database);
      return jsonResponse({ member: memberPayload(database, profile) }, 201);
    }

    const calibrationMatch = path.match(/^\/members\/([^/]+)\/calibration$/);
    if (calibrationMatch) {
      const profile = accessibleProfile(database, user, calibrationMatch[1]);
      if (!profile) return errorResponse("member not found", 404);
      if (method === "GET") {
        return jsonResponse({ calibration: database.calibrations.find((item) => item.profile_id === profile.id) || null });
      }
      if (method === "POST") {
        const calibration = body.calibration || body;
        if (!calibration.ready) return errorResponse("only ready calibrations can be saved");
        const record = {
          id: newId("calibration"), profile_id: profile.id, user_id: profile.user_id, gym_id: profile.gym_id,
          status: calibration.status || "calibrated", completed: true, completed_at: nowSeconds(),
          sample_count: Number(calibration.sample_count || 0), estimated_reach_cm: Number(calibration.body_scale?.estimated_reach_cm || 0),
          camera_config: calibration.cameras || [], body_scale: calibration.body_scale || {}, calibration,
        };
        database.calibrations = database.calibrations.filter((item) => item.profile_id !== profile.id);
        database.calibrations.push(record);
        if (record.estimated_reach_cm) profile.reach_cm = record.estimated_reach_cm;
        saveDatabase(database);
        return jsonResponse({ calibration: record, member: memberPayload(database, profile) });
      }
    }

    const memberMatch = path.match(/^\/members\/([^/]+)$/);
    if (memberMatch) {
      const profile = accessibleProfile(database, user, memberMatch[1]);
      if (!profile) return errorResponse("member not found", 404);
      if (method === "GET") return jsonResponse({ member: memberPayload(database, profile) });
      if (method === "PATCH") {
        const allowed = ["phone", "birthdate", "gender", "height_cm", "weight_kg", "reach_cm", "stance", "injury_note", "name"];
        if (user.role === "OWNER") allowed.push("training_level");
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
      if (!target || (user.role !== "OWNER" && target.id !== user.id)) return errorResponse("target user is outside your center", 403);
      const session = {
        id: newId("session"), user_id: target.id, gym_id: user.gym_id, started_at: nowSeconds(), ended_at: null,
        camera_config: body.camera_config || [{ camera_id: "tablet_camera", view_angle: "front", enabled: true }],
        overall_score: 0, focus: String(body.focus || "guard_and_strikes"), feedback_report: "",
      };
      database.sessions.unshift(session);
      saveDatabase(database);
      return jsonResponse({ session }, 201);
    }

    const endSessionMatch = path.match(/^\/sessions\/([^/]+)\/end$/);
    if (method === "PATCH" && endSessionMatch) {
      const session = database.sessions.find((item) => item.id === endSessionMatch[1]);
      if (!session || session.gym_id !== user.gym_id || (user.role !== "OWNER" && session.user_id !== user.id)) return errorResponse("session not found", 404);
      session.ended_at = nowSeconds();
      session.overall_score = Math.max(0, Math.min(100, Number(body.overall_score || 0)));
      session.feedback_report = String(body.feedback_report || "");
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

    if (method === "POST" && path === "/calibration/human") {
      const cameras = (body.camera_config || []).map((camera) => ({ ...camera, calibrated: true, calibration_status: "ready", calibrated_at: nowSeconds() }));
      const height = Number(body.body_profile?.height_cm || 0);
      const calibration = {
        status: "calibrated", ready: true, sample_count: Number(body.samples?.length || 0), camera_count: cameras.length,
        cameras, body_scale: height ? { height_cm: height, estimated_reach_cm: Math.round(height * 1.01), scale_source: "tablet_single_camera" } : {}, errors: [],
      };
      return jsonResponse({ calibration });
    }

    if (method === "POST" && path === "/pose/3d") {
      return jsonResponse({ pose: { session_id: body.session_id || "", status: "single_camera_2d", pose_space: "image_2d", keypoints_3d: [] } });
    }

    if (method === "GET" && path === "/system/pose3d") {
      return jsonResponse({ opencv: { available: false }, platform: "android", max_cameras: 1, pose_space: "image_2d" });
    }

    if (method === "POST" && path === "/recordings/convert") {
      return errorResponse("MP4 conversion is unavailable on this device", 501);
    }

    return errorResponse("not found", 404);
  }

  window.fetch = function androidOfflineFetch(input, options = {}) {
    const url = new URL(typeof input === "string" ? input : input.url, window.location.origin);
    if (url.origin === window.location.origin && url.pathname.startsWith("/api/")) {
      return routeApi(url, options);
    }
    return originalFetch(input, options);
  };
})();
