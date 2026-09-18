const SETTINGS_KEY = "boxing_settings";
const CENTER_KEY = "boxing_center_profile";
const CAMERA_SETUP_KEY = "boxing_camera_setup";
const navItems = [
  ["coach", "운동 세션"],
  ["dashboard", "대시보드"],
  ["center", "센터 정보"],
  ["members", "회원 관리"],
  ["staff", "직원"],
  ["memberships", "회원권"],
  ["attendance", "출석"],
  ["payments", "수납"],
  ["workouts", "운동 기록"],
  ["settings", "설정"],
];

const memberNavItems = [
  ["coach", "운동 세션"],
  ["memberHome", "내 이용 현황"],
  ["memberWorkouts", "운동 기록"],
  ["memberAttendance", "출석"],
  ["memberProfile", "정보 변경"],
  ["settings", "설정"],
];

const platformAdminNavItems = [
  ["platformOps", "중앙 관제"],
  ["coach", "운동 세션"],
  ["dashboard", "대시보드"],
  ["accounts", "계정 권한"],
  ["members", "전체 회원"],
  ["settings", "설정"],
];

const centerOwnerNavItems = [
  ["coach", "운동 세션"],
  ["dashboard", "대시보드"],
  ["center", "센터 정보"],
  ["members", "회원 관리"],
  ["accounts", "계정 권한"],
  ["memberships", "회원권"],
  ["attendance", "출석"],
  ["payments", "수납"],
  ["workouts", "운동 기록"],
  ["settings", "설정"],
];

const coachNavItems = [
  ["coach", "운동 세션"],
  ["dashboard", "대시보드"],
  ["members", "회원 관리"],
  ["memberships", "회원권"],
  ["attendance", "출석"],
  ["payments", "수납"],
  ["workouts", "운동 기록"],
  ["settings", "설정"],
];

function navigationForRole(role) {
  if (role === "PLATFORM_ADMIN") return platformAdminNavItems;
  if (role === "CENTER_OWNER") return centerOwnerNavItems;
  if (role === "COACH") return coachNavItems;
  if (role === "OWNER") return navItems;
  return memberNavItems;
}

function roleCanManageAccounts(role) {
  return role === "PLATFORM_ADMIN" || role === "CENTER_OWNER";
}

const navIcons = {
  platformOps: "home",
  coach: "video",
  dashboard: "chartPie",
  center: "home",
  members: "user",
  staff: "idCard",
  accounts: "idCard",
  attendance: "calendar",
  memberWorkouts: "activity",
  memberAttendance: "calendar",
  memberProfile: "user",
  settings: "settings",
};

const iconPaths = {
  activity: `<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>`,
  calendar: `<path d="M8 2v4"/><path d="M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/>`,
  chartPie: `<path d="M21 12c.6 0 1-.4.9-1a10 10 0 0 0-8.9-8.9c-.6-.1-1 .4-1 .9v8a1 1 0 0 0 1 1z"/><path d="M21.2 15.9A10 10 0 1 1 8 2.8"/>`,
  home: `<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10.5 12 3l9 7.5"/><path d="M5 10v11h14V10"/>`,
  idCard: `<path d="M16 10h2"/><path d="M16 14h2"/><path d="M6.17 15a3 3 0 0 1 5.66 0"/><circle cx="9" cy="11" r="2"/><rect x="3" y="4" width="18" height="16" rx="2"/>`,
  power: `<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>`,
  settings: `<path d="M9.7 3.4a1 1 0 0 1 1-.7h2.6a1 1 0 0 1 1 .7l.4 1.4a1 1 0 0 0 1.4.6l1.3-.6a1 1 0 0 1 1.2.2l1.8 1.8a1 1 0 0 1 .2 1.2l-.6 1.3a1 1 0 0 0 .6 1.4l1.4.4a1 1 0 0 1 .7 1v2.6a1 1 0 0 1-.7 1l-1.4.4a1 1 0 0 0-.6 1.4l.6 1.3a1 1 0 0 1-.2 1.2l-1.8 1.8a1 1 0 0 1-1.2.2l-1.3-.6a1 1 0 0 0-1.4.6l-.4 1.4a1 1 0 0 1-1 .7h-2.6a1 1 0 0 1-1-.7l-.4-1.4a1 1 0 0 0-1.4-.6l-1.3.6a1 1 0 0 1-1.2-.2l-1.8-1.8a1 1 0 0 1-.2-1.2l.6-1.3a1 1 0 0 0-.6-1.4l-1.4-.4a1 1 0 0 1-.7-1v-2.6a1 1 0 0 1 .7-1l1.4-.4a1 1 0 0 0 .6-1.4L3.4 8a1 1 0 0 1 .2-1.2L5.4 5a1 1 0 0 1 1.2-.2l1.3.6a1 1 0 0 0 1.4-.6z"/><circle cx="12" cy="12" r="3"/>`,
  user: `<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>`,
  video: `<path d="m16 13 5.2 3.5a.5.5 0 0 0 .8-.4V7.9a.5.5 0 0 0-.8-.4L16 11"/><rect x="2" y="6" width="14" height="12" rx="2"/>`,
};

function svgIcon(name, className = "nav-icon") {
  const paths = iconPaths[name] || iconPaths.activity;
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

const authDefaults = {
  owner: {
    button: "로그인",
    fields: [
      { name: "username", value: "", placeholder: "아이디를 입력하세요.", type: "text" },
      { name: "password", value: "", placeholder: "비밀번호를 입력하세요.", type: "password" },
    ],
  },
  member: {
    button: "로그인",
    fields: [
      { name: "username", value: "", placeholder: "아이디를 입력하세요.", type: "text" },
      { name: "password", value: "", placeholder: "비밀번호를 입력하세요.", type: "password" },
    ],
  },
  signup: {
    button: "가입하기",
    fields: [
      {
        name: "signup_role",
        value: "OWNER",
        placeholder: "가입 유형",
        type: "select",
        options: [
          ["OWNER", "관리자: 새 센터 생성"],
          ["MEMBER", "회원: 센터 코드로 가입"],
        ],
      },
      { name: "center_name", value: "", placeholder: "센터명", type: "text", signupRole: "OWNER" },
      { name: "center_code", value: "", placeholder: "센터 코드", type: "text", signupRole: "MEMBER" },
      { name: "username", value: "", placeholder: "아이디", type: "text", withCheck: true },
      { name: "name", value: "", placeholder: "관리자/회원 이름", type: "text" },
      { name: "email", value: "", placeholder: "이메일", type: "email" },
      { name: "password", value: "", placeholder: "비밀번호: 특수문자 포함 8자리 이상", type: "password" },
      { name: "password_confirm", value: "", placeholder: "비밀번호 확인", type: "password" },
      { name: "phone", value: "", placeholder: "전화번호", type: "tel" },
      { name: "birthdate", value: "", placeholder: "생년월일", type: "date" },
      {
        name: "gender",
        value: "",
        placeholder: "성별",
        type: "select",
        options: [
          ["", "성별 선택"],
          ["male", "남성"],
          ["female", "여성"],
          ["other", "기타"],
        ],
      },
    ],
  },
};

const $ = (selector) => document.querySelector(selector);
