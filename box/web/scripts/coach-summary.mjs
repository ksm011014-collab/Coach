export function coachingSummary(session) {
  let report;
  try { report = typeof session.feedback_report==='string'?JSON.parse(session.feedback_report):session.feedback_report; } catch (_) {}
  const summary = {duration_seconds:Math.max(0,Math.round(session.ended_at-session.started_at)),analysis_status:'unavailable'};
  if (report?.version===1 && Number.isFinite(report.duration_ms)) summary.duration_seconds=Math.max(0,Math.floor(report.duration_ms/1000));
  if (report?.version===1 && Number.isFinite(report.tracking?.total_ms)) summary.tracking_unavailable_seconds=report.tracking.total_ms/1000;
  if (report?.version!==1 || report.status!=='experimental') return summary;
  summary.analysis_status='experimental';
  summary.counts=Object.fromEntries(['jab','hook','uppercut','one_two'].map(label=>[label,Number.isInteger(report.counts?.[label]) && report.counts[label]>=0?report.counts[label]:null]));
  summary.total_points=Number.isFinite(report.total_points)?report.total_points:null;
  summary.mean_quality=Number.isFinite(report.mean_quality)?report.mean_quality:null;
  const guards=(Array.isArray(report.events)?report.events:[]).map(event=>event?.guard_ratio).filter(value=>Number.isFinite(value) && value>=0 && value<=1);
  summary.guard_observations={evaluated:guards.length,maintained:guards.filter(value=>value>=0.9).length,lowered:guards.filter(value=>value<0.5).length};
  return summary;
}
