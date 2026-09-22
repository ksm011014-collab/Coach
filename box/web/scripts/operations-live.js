/* Existing API adapter. Unconnected operational services fail before making requests. */
function createLiveOperations() {
  const pendingRecordingDeletes = new Set();
  let currentData;
  const write = async (operation, input, requestId, collection) => {
    const row = input.id && currentData?.[collection]?.find(item => item.id === input.id);
    const values = { ...input };
    if (row && values.version === undefined) values.version = row.version;
    return (await api("/operations", { method: "POST", body: JSON.stringify({ operation, input: values, request_id: requestId }) })).result;
  };
  return {
    async snapshot(selectedDate) {
      const userId = state.user.id;
      const [members, sessions, operations] = await Promise.all([api("/members"), api("/sessions"), state.user.role === "PLATFORM_ADMIN" ? Promise.resolve(null) : api(`/operations${selectedDate ? `?date=${encodeURIComponent(selectedDate)}` : ""}`)]);
      if (state.user?.id !== userId) throw new Error("로그인 상태가 변경되었습니다.");
      state.members = members.members;
      state.sessions = sessions.sessions;
      const profiles = [...state.members];
      if (state.user.role === "MEMBER" && state.profile && !profiles.some(row => row.user_id === userId)) profiles.push(state.profile);
      const iso = value => value ? new Date(value * 1000).toISOString() : null;
      const result = {
        referenceDate: new Date().toLocaleDateString("en-CA"),
        members: profiles.map(row => ({ ...row, id: row.user_id, profile_id: row.id, center_id: row.gym_id || row.center_id, joined_on: row.created_at ? iso(row.created_at)?.slice(0, 10) : "알 수 없음", account_status: state.accounts.find(account => account.id === row.user_id)?.status || (row.user_id === userId ? state.user.status : "UNKNOWN") })),
        workouts: state.sessions.map(row => ({ ...row, member_id: row.user_id, started_at: iso(row.started_at), ended_at: iso(row.ended_at), has_recording: Boolean(state.localRecordings[row.id]) })),
        products: [], passes: [], attendance: [], payments: [], notes: [], staff: [], activities: [],
      };
      if (operations) Object.assign(result, operations, { operationsConnected: true });
      currentData = result;
      return result;
    },
    async saveMember(input, requestId) {
      if (!["OWNER", "CENTER_OWNER", "COACH"].includes(state.user.role)) throw new Error("회원 프로필 관리 권한이 없습니다.");
      const { id, ...fields } = input;
      for (const key of ["height_cm", "weight_kg", "training_level"]) {
        if (fields[key] === "") delete fields[key];
        else if (fields[key] !== undefined) fields[key] = Number(fields[key]);
      }
      if (!id) {
        if (fields.password !== fields.password_confirm) throw new Error("비밀번호 확인이 일치하지 않습니다.");
        if (!isValidPassword(fields.password)) throw new Error("비밀번호는 특수문자를 포함해 8자 이상이어야 합니다.");
        return write("member.create", fields, requestId);
      }
      return write("member.update", { ...fields, id }, requestId, "members");
    },
    async deleteWorkout({ id }) {
      const row = state.sessions.find(session => session.id === id);
      if (state.user.role === "PLATFORM_ADMIN" || (!pendingRecordingDeletes.has(id) && (!row || (state.user.role === "MEMBER" && row.user_id !== state.user.id)))) throw new Error("운동 기록 삭제 권한이 없습니다.");
      if (state.activeSessionId === id) throw new Error("현재 운동을 종료한 뒤 삭제하세요.");
      if (!pendingRecordingDeletes.has(id)) {
        await api(`/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
        pendingRecordingDeletes.add(id);
        state.sessions = state.sessions.filter(session => session.id !== id);
      }
      try { await deleteRecording(id); delete state.localRecordings[id]; pendingRecordingDeletes.delete(id); }
      catch { throw new Error("운동 기록은 삭제됐지만 장치 녹화 삭제에 실패했습니다. 이 창에서 다시 시도하면 녹화 삭제만 재시도합니다."); }
    },
    saveProduct: (input, key) => write("product.save", input, key, "products"),
    assignPass: (input, key) => write("pass.assign", input, key),
    changePass: (input, key) => write("pass.change", input, key, "passes"),
    markAttendance: (input, key) => write("attendance.mark", input, key),
    cancelAttendance: (input, key) => write("attendance.cancel", input, key, "attendance"),
    registerPayment: (input, key) => write("payment.register", input, key),
    adjustPayment: (input, key) => write("payment.adjust", input, key, "payments"),
    addNote: (input, key) => write("note.add", input, key),
    deleteMember: (input, key) => write("member.delete", input, key, "members"),
  };
}

function renderOperationalView(view) {
  const container = document.createElement("div");
  $("#viewContent").replaceChildren(container);
  mountOperations({
    host: container, adapter: createLiveOperations(), user: state.user, initialView: view,
    onNavigate: key => { state.activeView = state.user.role === "MEMBER" && key === "workouts" ? "memberWorkouts" : key; renderNav(); $("#viewTitle").textContent = ({ members: "회원 관리", workouts: "운동 기록", memberships: "회원권", attendance: "출석", payments: "수납" })[key] || "운영"; },
    onRecording: playRecording,
    onDownload: downloadRecording,
  });
}
