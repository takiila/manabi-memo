export function normalizeSessionNumber(value: string) {
  return value.match(/\d+/)?.[0] ?? (value.trim().replace(/^第|回$/g, "") || "1");
}

export function isValidSessionNumber(value: string) {
  return /^\d+$/.test(value.trim()) && Number(value) >= 1;
}
