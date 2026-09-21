export function getAdminErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The admin data could not be loaded. Try again.";
}
