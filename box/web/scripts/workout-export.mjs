import './i18n.js';
import {coachingCues} from './coach-conversation.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const dateTime = value => {
  if (value === null || value === undefined || value === '') return t('정보 없음');
  const date = new Date(typeof value === 'number' ? value * 1000 : value);
  if (!Number.isFinite(date.getTime())) return t('정보 없음');
  const pad = number => String(number).padStart(2, '0');
  return `${pad(date.getFullYear() % 100)}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

export function workoutReport(session, transcript, transcriptError = false) {
  let feedback;
  try { feedback = typeof session.feedback_report === 'string' ? JSON.parse(session.feedback_report) : session.feedback_report; } catch (_) {}
  const lines = ['JDC · ' + t('운동 결과 보고서'), '────────────────────────', '',
    `${t('시작')}: ${dateTime(session.started_at)}`, `${t('종료')}: ${session.ended_at == null ? t('진행 중') : dateTime(session.ended_at)}`];
  const duration = feedback?.version === 1 && Number.isFinite(feedback.duration_ms) ? feedback.duration_ms / 1000 : Number.isFinite(session.started_at) && Number.isFinite(session.ended_at) ? session.ended_at - session.started_at : null;
  if (duration !== null) {
    const seconds = Math.max(0, Math.round(duration));
    lines.push(`${t('운동 시간')}: ${t('{minutes}분 {seconds}초', {minutes:Math.floor(seconds / 60),seconds:seconds % 60})}`);
  }
  lines.push('', `[${t('저장된 라운드 결과')}]`);
  const measured = feedback && (Number.isFinite(feedback.total_points) || Number.isFinite(feedback.mean_quality) || Object.values(feedback.counts || {}).some(Number.isFinite));
  if (measured) {
    if (Number.isFinite(feedback.total_points)) lines.push(`${t('라운드 점수')}: ${feedback.total_points}`);
    if (Number.isFinite(feedback.mean_quality)) lines.push(`${t('평균 수행 품질')}: ${feedback.mean_quality} / 100`);
    for (const [key, label] of [['jab','잽'], ['hook','훅'], ['uppercut','어퍼컷'], ['one_two','원투']]) {
      if (Number.isFinite(feedback.counts?.[key])) lines.push(`${t(label)}: ${feedback.counts[key]}`);
    }
  } else lines.push(t('정보 없음'));
  if (feedback?.status === 'experimental') lines.push(t('동작 수와 점수는 시험 감지 결과이며 실제 타격 성공을 뜻하지 않습니다.'));
  lines.push('', `[${t('라운드 피드백')}]`);
  if (feedback?.version === 1) lines.push(...coachingCues(session).filter(cue => !cue.startsWith(t('라운드 시작 기준: {intervals}{suffix}', {intervals:'',suffix:''}))).map(cue => `• ${cue}`));
  else lines.push(t('정보 없음'));
  lines.push('', `[${t('운동에 연결된 대화')}]`);
  if (transcriptError) lines.push(t('대화를 조회하지 못했습니다. 결과는 다운로드할 수 있습니다.'));
  else if (!transcript?.turns?.length) lines.push(t('저장된 대화가 없습니다. 과거에 저장되지 않은 대화는 복원할 수 없습니다.'));
  else for (const turn of transcript.turns) {
    lines.push(`[${dateTime(turn.asked_at)}] ${t('사용자')}`, turn.question, `[${dateTime(turn.answered_at)}] ${t('AI 코치')}`, turn.answer, '');
  }
  const text = lines.join('\r\n');
  const html = `<!doctype html><html lang="${globalThis.BoxingI18n?.language === 'en' ? 'en' : 'ko'}"><meta charset="utf-8"><title>JDC · ${escape(t('운동 결과 보고서'))}</title><style>body{font:16px/1.7 system-ui,sans-serif;max-width:900px;margin:40px auto;padding:0 24px;color:#17212b}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}h1{border-bottom:3px solid #16809a;padding-bottom:16px}@media print{body{margin:0}}</style><h1>JDC · ${escape(t('운동 결과 보고서'))}</h1><pre>${escape(text)}</pre></html>`;
  return { text, html };
}

export async function downloadWorkoutReport(sessionId, format, api, download) {
  const response = await api('/sessions');
  const session = response.sessions?.find(row => row.id === sessionId);
  if (!session) throw new Error(t('운동 기록 접근 권한이 없거나 기록을 찾을 수 없습니다.'));
  let transcript, failed = false;
  try { transcript = await api(`/coach/transcript/${encodeURIComponent(sessionId)}`); } catch (_) { failed = true; }
  const report = workoutReport(session, transcript, failed);
  const html = format === 'html';
  download(new Blob([html ? report.html : '\uFEFF' + report.text], {type:html ? 'text/html;charset=utf-8' : 'text/plain;charset=utf-8'}), `JDC-${sessionId}.${html ? 'html' : 'txt'}`);
}
