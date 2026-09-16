export const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
export function audioCandidates(row, canPlayType) {
  const sources = [...(row.audioSources || [])];
  if (row.audio && !sources.some(source => source.src === row.audio)) {
    sources.push({src:row.audio, type:'audio/mp4; codecs="mp4a.40.2"'});
  }
  const supported = sources.filter(source => Boolean(canPlayType(source.type)));
  return supported.length ? supported : sources.filter(source => source.src === row.audio);
}
export function formatTime(value) {
  const total = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(total / 3600);
  return `${hours ? hours + ':' : ''}${hours ? String(Math.floor(total / 60) % 60).padStart(2, '0') : Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
export function nextNick(intervals, time) {
  let low = 0, high = intervals.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (intervals[middle][1] <= time) low = middle + 1;
    else high = middle;
  }
  return low < intervals.length ? Math.max(time, intervals[low][0]) : null;
}
export function nickRemaining(intervals, time) {
  return intervals.reduce((total, [a, b]) => total + Math.max(0, b - Math.max(a, time)), 0);
}
export function wordAt(words, time) {
  let low = 0, high = words.length - 1, found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (words[middle][0] <= time) { found = middle; low = middle + 1; }
    else high = middle - 1;
  }
  return found >= 0 && time < words[found][1] + .15 ? found : -1;
}
export function searchPassages(index, query, nickOnly) {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return [];
  return index.filter(row => (!nickOnly || row[2]) && row[3].toLocaleLowerCase().includes(q));
}
