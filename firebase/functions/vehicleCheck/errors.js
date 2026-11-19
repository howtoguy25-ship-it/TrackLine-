// One error type for every provider, so the orchestration can tell "try again" from "this car
// isn't on the register" from "this provider isn't set up".
class ProviderError extends Error {
  /** kind: "down" | "not_found" | "not_configured" | "blocked" | "bad_response" */
  constructor(kind, message, details) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
    this.details = details;
  }
  get retryable() {
    return this.kind === "down" || this.kind === "bad_response";
  }
}

module.exports = { ProviderError };
