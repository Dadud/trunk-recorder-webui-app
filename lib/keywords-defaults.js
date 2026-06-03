// Default keyword list for the notable events channel.
// Curated for central Wisconsin (Wood/Clark/Jackson) fire/EMS/sheriff dispatch.
// All entries are case-insensitive substring matches.
// Frequency guard: only fires if transcript is > 5 chars.
// Talkgroup-name guard: doesn't fire if the keyword already appears in the
// talkgroup tag (avoids "fire" pinging on the fire dispatch channel).

export const DEFAULT_KEYWORDS = [
  { pattern: 'structure fire', description: 'Structure fire confirmed' },
  { pattern: 'working fire',    description: 'Working fire' },
  { pattern: 'second alarm',    description: 'Second alarm escalation' },
  { pattern: 'shots fired',     description: 'Shots fired report' },
  { pattern: 'officer down',    description: 'Officer down' },
  { pattern: 'stabb',           description: 'Stabbing' },
  { pattern: 'cardiac arrest',  description: 'Working cardiac arrest' },
  { pattern: 'rollover',        description: 'Vehicle rollover' },
  { pattern: 'pin in',          description: 'Vehicle extrication, person trapped' },
  { pattern: 'hazmat',          description: 'Hazmat incident' },
];

// Returns true if a keyword match should fire a notable alert.
// `talkgroupTag` is the talkgroup alpha tag (e.g. "Wood Fire").
// `transcript` is the full transcript text.
export function shouldPageKeyword(pattern, talkgroupTag, transcript) {
  if (!transcript || transcript.length < 5) return false;
  const lower = transcript.toLowerCase();
  if (!lower.includes(pattern.toLowerCase())) return false;
  // Talkgroup-name guard: don't page if the keyword is already in the talkgroup name
  // (e.g. "fire" pinging on Wood Fire dispatch is noise, not notable).
  if (talkgroupTag && talkgroupTag.toLowerCase().includes(pattern.toLowerCase())) {
    return false;
  }
  return true;
}
