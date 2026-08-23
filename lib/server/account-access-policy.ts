export function parseAllowedAccountEmails(value: string | undefined) {
  if (!value?.trim()) return [];
  return [...new Set(value
    .split(/[,;\n]/)
    .map((email) => email.trim().toLocaleLowerCase("en-US"))
    .filter(Boolean))];
}

export function accountEmailAllowed(email: string) {
  const allowed = parseAllowedAccountEmails(process.env.ALLOWED_ACCOUNT_EMAILS);
  return allowed.length === 0 || allowed.includes(email.trim().toLocaleLowerCase("en-US"));
}
