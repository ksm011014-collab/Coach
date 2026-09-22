/* Frontend development adapter. This namespace never reads or writes application data.
   Construct explicitly; URL activation and UI integration live in operations-shell.js. */
(function (root) {
  "use strict";
  const KEY = "boxingcoach.dev.operations.v1";
  const CENTER = "preview-center";
  const clone = value => JSON.parse(JSON.stringify(value));
  const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
  const date = value => {
    const parsed = new Date(`${value}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "") || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      fail("VALIDATION", "올바른 날짜를 입력하세요.");
    }
    return value;
  };
  const text = (value, label, max = 120) => {
    if (typeof value !== "string" || !value.trim() || value.length > max) fail("VALIDATION", `${label}을(를) 확인하세요. (최대 ${max}자)`);
    return value.trim();
  };
  const integer = (value, label, min = 0) => {
    if (!Number.isSafeInteger(value) || value < min) fail("VALIDATION", `${label}은(는) ${min} 이상의 정수여야 합니다.`);
    return value;
  };
  const choice = (value, values) => values.includes(value) ? value : fail("VALIDATION", "허용되지 않은 상태입니다.");
  const timestamp = day => `${day}T12:00:00+09:00`;

  function seed() {
    return {
      version: 1, sequence: 20, referenceDate: "2026-09-18", requests: {},
      members: [
        { id: "preview-member-1", name: "샘플 김하나", phone: "010-0000-0001", account_status: "ACTIVE", joined_on: "2026-08-01" },
        { id: "preview-member-2", name: "샘플 이두리", phone: "010-0000-0002", account_status: "ACTIVE", joined_on: "2026-09-01" },
        { id: "preview-member-3", name: "샘플 박세나", phone: "010-0000-0003", account_status: "SUSPENDED", joined_on: "2026-07-01" },
      ].map(row => ({ ...row, center_id: CENTER })),
      products: [
        { id: "preview-product-1", name: "기본 기간권", kind: "PERIOD", days: 30, count: 0, price: 150000 },
        { id: "preview-product-2", name: "미트 10회", kind: "COUNT", days: 90, count: 10, price: 200000 },
        { id: "preview-product-3", name: "체험 1회", kind: "TRIAL", days: 7, count: 1, price: 10000 },
      ].map(row => ({ ...row, center_id: CENTER })),
      passes: [
        { id: "preview-pass-1", member_id: "preview-member-1", product_id: "preview-product-1", start_on: "2026-09-01", end_on: "2026-09-30", remaining: null, status: "ACTIVE", history: [] },
        { id: "preview-pass-2", member_id: "preview-member-2", product_id: "preview-product-2", start_on: "2026-07-01", end_on: "2026-09-23", remaining: 3, status: "ACTIVE", history: [] },
      ].map(row => ({ ...row, center_id: CENTER })),
      attendance: [
        { id: "preview-visit-1", member_id: "preview-member-1", visited_on: "2026-09-18", status: "PRESENT", reason: "샘플 방문", created_at: timestamp("2026-09-18") },
        { id: "preview-visit-2", member_id: "preview-member-2", visited_on: "2026-08-10", status: "PRESENT", reason: "샘플 방문", created_at: timestamp("2026-08-10") },
      ].map(row => ({ ...row, center_id: CENTER })),
      payments: [
        { id: "preview-payment-1", member_id: "preview-member-1", product_id: "preview-product-1", amount: 150000, method: "CARD", paid_on: "2026-09-01", status: "PAID", adjustments: [] },
        { id: "preview-payment-2", member_id: "preview-member-2", product_id: "preview-product-2", amount: 200000, method: "TRANSFER", paid_on: null, status: "UNPAID", adjustments: [] },
      ].map(row => ({ ...row, center_id: CENTER })),
      center: { id: CENTER, name: "합성 APEX 센터", phone: "010-0000-0000", address: "개발용 가상 주소", hours: "평일 09:00–22:00" },
      profiles: [
        { id: "preview-owner", center_id: CENTER, name: "샘플 관리자", phone: "010-0000-0020" },
        { id: "preview-coach", center_id: CENTER, name: "샘플 코치", phone: "010-0000-0010" },
      ],
      notes: [], workouts: [
        { id: "preview-workout-1", center_id: CENTER, member_id: "preview-member-1", started_at: "2026-09-18T10:00:00+09:00", ended_at: "2026-09-18T10:30:00+09:00", has_recording: false },
        { id: "preview-workout-2", center_id: CENTER, member_id: "preview-member-2", started_at: "2026-09-17T11:00:00+09:00", ended_at: null, has_recording: false },
        { id: "preview-workout-3", center_id: CENTER, member_id: "preview-member-1", started_at: "2026-08-20T11:00:00+09:00", ended_at: "2026-08-20T11:20:00+09:00", has_recording: false },
      ], staff: [
        { id: "preview-staff-1", center_id: CENTER, name: "샘플 코치", phone: "010-0000-0010", job: "코치", status: "ACTIVE" },
      ], activities: [],
    };
  }

  function create({ enabled = false, storage, actor = () => ({ role: "CENTER_OWNER", id: "preview-owner", name: "샘플 관리자" }) } = {}) {
    let queue = Promise.resolve();
    let injectedFailure = null;
    function requirePreview() {
      if (!enabled) fail("NOT_CONNECTED", "백엔드 연결 준비 중입니다. 운영 데이터는 저장하지 않습니다.");
    }
    function read() {
      requirePreview();
      const raw = storage.getItem(KEY);
      if (raw === null) return seed();
      let data;
      try { data = JSON.parse(raw); } catch { fail("STORAGE", "개발용 데이터가 손상되었습니다. 개발용 데이터 초기화를 사용하세요."); }
      if (data?.version !== 1 || !["members", "products", "passes", "attendance", "payments", "notes", "workouts", "staff", "activities"].every(key => Array.isArray(data[key]))) {
        fail("STORAGE", "개발용 데이터 형식이 다릅니다. 초기화가 필요합니다.");
      }
      data.center ||= seed().center;
      data.profiles ||= seed().profiles;
      return data;
    }
    function activeActor() {
      const user = actor();
      if (!user || !["OWNER", "CENTER_OWNER", "COACH", "MEMBER"].includes(user.role)) fail("FORBIDDEN", "이 화면에 접근할 권한이 없습니다.");
      return user;
    }
    function writer(ownerOnly = false) {
      const user = activeActor();
      if (user.role === "MEMBER" || (ownerOnly && user.role === "COACH")) fail("FORBIDDEN", "변경 권한이 없습니다.");
      return user;
    }
    function find(data, collection, id) {
      return data[collection].find(row => row.id === id && row.center_id === CENTER) || fail("NOT_FOUND", "항목을 찾을 수 없습니다.");
    }
    function mutate(operation, input, requestId, apply, ownerOnly = false, selfService = false) {
      const run = queue.then(async () => {
        requirePreview();
        const user = selfService ? activeActor() : writer(ownerOnly);
        text(requestId, "요청 ID", 128);
        if (injectedFailure) { const error = injectedFailure; injectedFailure = null; throw error; }
        const data = read();
        const signature = JSON.stringify({ operation, input, actor: user.id });
        if (data.requests[requestId]) {
          if (data.requests[requestId].signature !== signature) fail("CONFLICT", "동일 요청 ID에 다른 입력이 전달되었습니다.");
          return clone(data.requests[requestId].result);
        }
        const context = { user, now: timestamp(data.referenceDate), id: () => `preview-${++data.sequence}` };
        const result = apply(data, context);
        data.activities.unshift({ id: context.id(), center_id: CENTER, operation, member_id: result.member_id || (operation.startsWith("member.") ? result.id : null), actor: user.name, created_at: context.now });
        data.requests[requestId] = { signature, result: clone(result) };
        // Commit once after all validation. Quota failures leave the old store intact.
        storage.setItem(KEY, JSON.stringify(data));
        return clone(result);
      });
      queue = run.catch(() => {});
      return run;
    }
    const service = {
      enabled, key: KEY,
      async snapshot() {
        await queue;
        const user = activeActor();
        if (injectedFailure) { const error = injectedFailure; injectedFailure = null; throw error; }
        const data = read();
        delete data.requests;
        data.profile = clone((user.role === "MEMBER" ? data.members : data.profiles).find(row => row.id === user.id) || { id: user.id, name: user.name, phone: "" });
        delete data.profiles;
        if (user.role === "MEMBER") {
          data.members = data.members.filter(row => row.id === user.id);
          for (const key of ["passes", "attendance", "payments", "workouts"]) data[key] = data[key].filter(row => row.member_id === user.id);
          data.notes = []; data.staff = []; data.activities = [];
        }
        return clone(data);
      },
      async reset() { requirePreview(); await queue; storage.removeItem(KEY); },
      async setReferenceDate(value) {
        requirePreview(); date(value); await queue;
        const data = read(); data.referenceDate = value; storage.setItem(KEY, JSON.stringify(data));
      },
      // Development-only fault injection: no production API or auth interception.
      failNext(message = "개발용 장애 재현") { requirePreview(); injectedFailure = Object.assign(new Error(message), { code: "UNAVAILABLE" }); },
      saveCenter(input, requestId) {
        return mutate("center.save", input, requestId, data => {
          Object.assign(data.center, { name: text(input.name, "센터명"), phone: text(input.phone, "연락처", 30), address: text(input.address, "주소", 300), hours: text(input.hours, "운영 시간", 200) });
          return data.center;
        }, true);
      },
      saveStaff(input, requestId) {
        return mutate("staff.save", input, requestId, (data, ctx) => {
          const row = input.id ? find(data, "staff", input.id) : { id: ctx.id(), center_id: CENTER };
          Object.assign(row, { name: text(input.name, "이름", 100), phone: text(input.phone, "연락처", 30), job: text(input.job, "직무", 100), status: choice(input.status, ["ACTIVE", "INACTIVE"]) });
          if (!input.id) data.staff.push(row);
          return row;
        }, true);
      },
      saveProfile(input, requestId) {
        return mutate("profile.save", input, requestId, (data, ctx) => {
          const row = find(data, ctx.user.role === "MEMBER" ? "members" : "profiles", ctx.user.id);
          Object.assign(row, { name: text(input.name, "이름", 100), phone: text(input.phone, "연락처", 30) });
          return row;
        }, false, true);
      },
      deleteWorkout(input, requestId) {
        return mutate("workout.delete", input, requestId, (data, ctx) => {
          const row = find(data, "workouts", input.id);
          if (ctx.user.role === "MEMBER" && row.member_id !== ctx.user.id) fail("FORBIDDEN", "본인의 운동 기록만 삭제할 수 있습니다.");
          data.workouts = data.workouts.filter(item => item.id !== row.id);
          return row;
        }, false, true);
      },
      saveMember(input, requestId) {
        return mutate("member.save", input, requestId, (data, ctx) => {
          if (!input.id) writer(true);
          const row = input.id ? find(data, "members", input.id) : { id: ctx.id(), center_id: CENTER, joined_on: data.referenceDate, account_status: "UNCONNECTED" };
          row.name = text(input.name, "이름", 100); row.phone = text(input.phone, "연락처", 30);
          if (row.deleted_on) fail("CONFLICT", "삭제된 회원은 수정할 수 없습니다.");
          for (const [key, minimum, maximum] of [["height_cm", 100, 250], ["weight_kg", 25, 300], ["training_level", 1, 5]]) {
            if (input[key] !== undefined && input[key] !== "") {
              const value = integer(Number(input[key]), key, minimum);
              if (value > maximum) fail("VALIDATION", "입력 범위를 확인하세요.");
              row[key] = value;
            }
          }
          if (input.stance) row.stance = choice(input.stance, ["orthodox", "southpaw"]);
          for (const key of ["birthdate", "gender", "injury_note"]) {
            if (input[key] !== undefined) row[key] = input[key];
          }
          if (input.id && input.pass_id) {
            const pass = find(data, "passes", input.pass_id);
            if (pass.member_id !== row.id) fail("FORBIDDEN", "해당 회원의 이용권이 아닙니다.");
            if (pass.status === "CANCELLED") fail("CONFLICT", "해지된 이용권입니다.");
            const endOn = date(input.end_on);
            if (endOn < pass.start_on) fail("VALIDATION", "만료일은 시작일 이후여야 합니다.");
            if (endOn !== pass.end_on) {
              pass.history.push({ action: "SET_END", reason: text(input.reason, "만료일 변경 사유", 500), at: ctx.now, author: ctx.user.name, previous_end_on: pass.end_on, end_on: endOn });
              pass.end_on = endOn;
            }
          } else if (input.id && input.end_on) fail("VALIDATION", "만료일을 변경할 이용권을 선택하세요.");
          if (input.joined_on) {
            date(input.joined_on);
            if (input.joined_on > data.referenceDate) fail("VALIDATION", "등록일은 미래일 수 없습니다.");
            if (input.id && input.joined_on !== row.joined_on) {
              text(input.reason, "등록일 변경 사유", 500);
              if (data.attendance.some(visit => visit.member_id === row.id && visit.visited_on < input.joined_on)) fail("CONFLICT", "기존 출석보다 늦은 등록일로 변경할 수 없습니다.");
            }
            row.joined_on = input.joined_on;
          }
          if (!input.id && input.product_id) {
            const product = find(data, "products", input.product_id);
            const start = date(input.start_on || row.joined_on);
            const end = new Date(`${start}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + product.days - 1);
            const endOn = date(input.end_on || end.toISOString().slice(0, 10));
            if (endOn < start) fail("VALIDATION", "만료일은 시작일 이후여야 합니다.");
            data.passes.push({ id: ctx.id(), center_id: CENTER, member_id: row.id, product_id: product.id, start_on: start, end_on: endOn, remaining: product.kind === "PERIOD" ? null : product.count, status: "ACTIVE", history: [{ action: "ASSIGN", reason: "회원 등록 시 이용권 부여", at: ctx.now, author: ctx.user.name }] });
          }
          if (!input.id) data.members.push(row);
          return row;
        });
      },
      deleteMember(input, requestId) {
        return mutate("member.delete", input, requestId, (data, ctx) => {
          const row = find(data, "members", input.id);
          if (row.deleted_on) fail("CONFLICT", "이미 삭제된 회원입니다.");
          text(input.reason, "삭제 사유", 500);
          row.deleted_on = data.referenceDate;
          row.account_status = "SUSPENDED";
          return row;
        }, true);
      },
      saveProduct(input, requestId) {
        return mutate("product.save", input, requestId, (data, ctx) => {
          const row = input.id ? find(data, "products", input.id) : { id: ctx.id(), center_id: CENTER };
          Object.assign(row, { name: text(input.name, "상품명"), kind: choice(input.kind, ["PERIOD", "COUNT", "TRIAL"]), days: integer(input.days, "유효 일수", 1), count: integer(input.count, "횟수"), price: integer(input.price, "금액") });
          if (row.kind !== "PERIOD" && row.count < 1) fail("VALIDATION", "횟수권·체험권의 횟수를 입력하세요.");
          if (!input.id) data.products.push(row);
          return row;
        }, true);
      },
      assignPass(input, requestId) {
        return mutate("pass.assign", input, requestId, (data, ctx) => {
          if (find(data, "members", input.member_id).deleted_on) fail("CONFLICT", "삭제된 회원입니다.");
          const product = find(data, "products", input.product_id);
          date(input.start_on); date(input.end_on);
          if (input.end_on < input.start_on) fail("VALIDATION", "만료일은 시작일 이후여야 합니다.");
          const row = { id: ctx.id(), center_id: CENTER, member_id: input.member_id, product_id: product.id, start_on: input.start_on, end_on: input.end_on, remaining: product.kind === "PERIOD" ? null : product.count, status: "ACTIVE", history: [{ action: "ASSIGN", reason: text(input.reason, "사유", 500), at: ctx.now, author: ctx.user.name }] };
          data.passes.push(row); return row;
        });
      },
      changePass(input, requestId) {
        return mutate("pass.change", input, requestId, (data, ctx) => {
          const row = find(data, "passes", input.id);
          if (find(data, "members", row.member_id).deleted_on) fail("CONFLICT", "삭제된 회원입니다.");
          const action = choice(input.action, ["PAUSE", "RESUME", "EXTEND", "CANCEL"]);
          const reason = text(input.reason, "사유", 500);
          if (row.status === "CANCELLED" || (action === "PAUSE" && row.status !== "ACTIVE") || (action === "RESUME" && row.status !== "PAUSED")) fail("CONFLICT", "현재 회원권 상태에서 처리할 수 없습니다.");
          const previousEnd = row.end_on;
          if (action === "EXTEND") {
            date(input.end_on);
            if (input.end_on <= row.end_on) fail("VALIDATION", "새 만료일은 기존 만료일 이후여야 합니다.");
            row.end_on = input.end_on;
          } else row.status = { PAUSE: "PAUSED", RESUME: "ACTIVE", CANCEL: "CANCELLED" }[action];
          row.history.push({ action, reason, at: ctx.now, author: ctx.user.name, previous_end_on: previousEnd, end_on: row.end_on });
          return row;
        });
      },
      markAttendance(input, requestId) {
        return mutate("attendance.mark", input, requestId, (data, ctx) => {
          const member = find(data, "members", input.member_id); date(input.visited_on);
          if (input.visited_on > data.referenceDate || !member.joined_on || member.joined_on > input.visited_on || (member.deleted_on && member.deleted_on <= input.visited_on)) fail("VALIDATION", "해당 날짜의 등록 회원만 출석 처리할 수 있습니다.");
          if (data.attendance.some(row => row.member_id === input.member_id && row.visited_on === input.visited_on && row.status === "PRESENT")) fail("CONFLICT", "이미 출석 처리된 회원입니다.");
          const row = { id: ctx.id(), center_id: CENTER, member_id: input.member_id, visited_on: input.visited_on, status: "PRESENT", reason: text(input.reason, "사유", 500), created_at: ctx.now };
          data.attendance.push(row); return row;
        });
      },
      cancelAttendance(input, requestId) {
        return mutate("attendance.cancel", input, requestId, (data, ctx) => {
          const row = find(data, "attendance", input.id);
          if (row.status !== "PRESENT") fail("CONFLICT", "이미 취소된 출석입니다.");
          row.reason = text(input.reason, "취소 사유", 500); row.status = "CANCELLED"; row.cancelled_at = ctx.now;
          return row;
        });
      },
      registerPayment(input, requestId) {
        return mutate("payment.register", input, requestId, (data, ctx) => {
          if (find(data, "members", input.member_id).deleted_on) fail("CONFLICT", "삭제된 회원입니다.");
          find(data, "products", input.product_id);
          const status = choice(input.status, ["PAID", "UNPAID"]);
          const row = { id: ctx.id(), center_id: CENTER, member_id: input.member_id, product_id: input.product_id, amount: integer(input.amount, "금액", 1), method: choice(input.method, ["CARD", "CASH", "TRANSFER", "KAKAOPAY", "EASY_PAY"]), paid_on: status === "PAID" ? date(input.paid_on) : null, status, adjustments: [] };
          data.payments.push(row); return row;
        }, true);
      },
      adjustPayment(input, requestId) {
        return mutate("payment.adjust", input, requestId, (data, ctx) => {
          const row = find(data, "payments", input.id);
          const action = choice(input.action, ["CANCEL", "REFUND"]);
          if (row.status === "CANCELLED" || row.status === "REFUNDED") fail("CONFLICT", "이미 종료된 수납 내역입니다.");
          const amount = action === "REFUND" ? integer(input.amount, "환불 기록 금액", 1) : 0;
          const refunded = row.adjustments.reduce((sum, item) => sum + item.amount, 0);
          if (action === "REFUND" && (!["PAID", "PARTIAL_REFUND"].includes(row.status) || amount > row.amount - refunded)) fail("VALIDATION", "기록 가능한 수납 잔액을 확인하세요.");
          if (action === "CANCEL" && refunded > 0) fail("CONFLICT", "부분 환불 내역은 남은 금액을 환불 기록으로 처리하세요.");
          row.adjustments.push({ action, amount, reason: text(input.reason, "사유", 500), on: date(input.on), author: ctx.user.name, at: ctx.now });
          row.status = action === "CANCEL" ? "CANCELLED" : (refunded + amount === row.amount ? "REFUNDED" : "PARTIAL_REFUND");
          return row;
        }, true);
      },
      addNote(input, requestId) {
        return mutate("note.add", input, requestId, (data, ctx) => {
          if (find(data, "members", input.member_id).deleted_on) fail("CONFLICT", "삭제된 회원입니다.");
          const row = { id: ctx.id(), center_id: CENTER, member_id: input.member_id, content: text(input.content, "메모", 2000), author_id: ctx.user.id, author_name: ctx.user.name, created_at: ctx.now };
          data.notes.push(row); return row;
        });
      },
    };
    return Object.freeze(service);
  }
  root.BoxingOperations = Object.freeze({ create, storageKey: KEY });
})(typeof window === "undefined" ? globalThis : window);
