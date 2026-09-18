/* Existing API adapter. Unconnected operational services fail before making requests. */
function createLiveOperations() {
  const disconnected = async () => { throw Object.assign(new Error("백엔드 연결 준비 중입니다. 저장하지 않았습니다. 개발용 미리보기에서 흐름을 확인할 수 있습니다."), { code: "NOT_CONNECTED" }); };
  return {
    async snapshot() {
      const userId = state.user.id;
      const [members, sessions] = await Promise.all([api("/members"), api("/sessions")]);
      if (state.user?.id !== userId) throw new Error("로그인 상태가 변경되었습니다.");
      state.members = members.members;
      state.sessions = sessions.sessions;
      const profiles = [...state.members];
      if (state.user.role === "MEMBER" && state.profile && !profiles.some(row => row.user_id === userId)) profiles.push(state.profile);
      const iso = value => value ? new Date(value * 1000).toISOString() : null;
      return {
        referenceDate: new Date().toLocaleDateString("en-CA"),
        members: profiles.map(row => ({ ...row, id: row.user_id, profile_id: row.id, center_id: row.gym_id || row.center_id, joined_on: row.created_at ? iso(row.created_at)?.slice(0, 10) : "알 수 없음", account_status: state.accounts.find(account => account.id === row.user_id)?.status || (row.user_id === userId ? state.user.status : "UNKNOWN") })),
        workouts: state.sessions.map(row => ({ ...row, member_id: row.user_id, started_at: iso(row.started_at), ended_at: iso(row.ended_at), has_recording: Boolean(state.localRecordings[row.id]) })),
        products: [], passes: [], attendance: [], payments: [], notes: [], staff: [], activities: [],
      };
    },
    async saveMember(input) {
      if (state.user.role === "PLATFORM_ADMIN") throw new Error("플랫폼 관리자는 회원 운동 프로필을 변경할 수 없습니다.");
      const { id, ...fields } = input;
      for (const key of ["height_cm", "weight_kg", "training_level"]) {
        if (fields[key] === "") delete fields[key];
        else if (fields[key] !== undefined) fields[key] = Number(fields[key]);
      }
      if (!id) {
        if (fields.password !== fields.password_confirm) throw new Error("비밀번호 확인이 일치하지 않습니다.");
        if (!isValidPassword(fields.password)) throw new Error("비밀번호는 특수문자를 포함해 8자 이상이어야 합니다.");
        return (await api("/members", { method: "POST", body: JSON.stringify(fields) })).member;
      }
      const profile = state.members.find(row => row.user_id === id);
      if (!profile) throw new Error("회원 프로필을 찾을 수 없습니다. 목록을 새로고침하세요.");
      return (await api(`/members/${encodeURIComponent(profile.id)}`, { method: "PATCH", body: JSON.stringify(fields) })).member;
    },
    saveProduct: disconnected, assignPass: disconnected, changePass: disconnected,
    markAttendance: disconnected, cancelAttendance: disconnected,
    registerPayment: disconnected, adjustPayment: disconnected, addNote: disconnected,
  };
}

function renderOperationalView(view) {
  const container = document.createElement("div");
  $("#viewContent").replaceChildren(container);
  mountOperations({
    host: container, adapter: createLiveOperations(), user: state.user, initialView: view,
    onNavigate: key => { state.activeView = state.user.role === "MEMBER" && key === "workouts" ? "memberWorkouts" : key; renderNav(); $("#viewTitle").textContent = ({ members: "회원 관리", workouts: "운동 기록", memberships: "회원권", attendance: "출석", payments: "수납" })[key] || "운영"; },
    onRecording: playRecording,
  });
}
