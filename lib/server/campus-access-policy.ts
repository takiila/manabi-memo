export type CampusAccessMode = "invite" | "authenticated";

export function parseCampusAccessMode(value: string | undefined): CampusAccessMode {
  return value?.trim().toLowerCase() === "authenticated" ? "authenticated" : "invite";
}

export function campusAccessMode(): CampusAccessMode {
  return parseCampusAccessMode(process.env.CAMPUS_ACCESS_MODE);
}

export function campusAccessForAuthenticatedUsers() {
  return campusAccessMode() === "authenticated";
}
