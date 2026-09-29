// Diarization already identifies anonymous speakers even when AI is disabled.
export function mergeMeetingSpeakers(meeting, inferred = meeting.speakers || []) {
  const prior = new Map((meeting.speakers || []).map(s => [s.label, s]));
  const merged = new Map(inferred.map(s => [s.label, prior.get(s.label) || s]));
  for (const s of prior.values()) if (!merged.has(s.label)) merged.set(s.label, s);
  for (const segment of meeting.transcriptSegments || []) {
    if (segment.speaker === undefined || segment.speaker === null || String(segment.speaker).trim() === '') continue;
    const label = segment.speakerLabel || '发言人 ' + segment.speaker;
    if (!merged.has(label)) merged.set(label, { label, assigneeId: '', ignored: false });
  }
  return [...merged.values()];
}
