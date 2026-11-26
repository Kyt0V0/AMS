export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message ?? "";
    const low = msg.toLowerCase();
    if (low.includes("load failed") || low.includes("failed to fetch") || low.includes("networkerror")) {
      return "Cannot reach backend server. Check that backend is running and Backend Server URL is correct (example: http://127.0.0.1:8000).";
    }
    return msg;
  }
  return String(err);
}
