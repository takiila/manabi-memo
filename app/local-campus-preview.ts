export function localCampusPreviewEnabled(
  nodeEnv = process.env.NODE_ENV,
  flag = process.env.NEXT_PUBLIC_CAMPUS_LOCAL_PREVIEW,
) {
  return nodeEnv !== "production" && flag === "true";
}
