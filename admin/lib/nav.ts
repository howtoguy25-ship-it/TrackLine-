// Which sections each role sees in the sidebar. Hiding is only convenience: the server checks
// every operation (firebase/functions/admin/roles.js).
export type Role = "owner" | "admin" | "support" | "moderator" | "viewer";

export const NAV: { href: string; label: string; roles: Role[] }[] = [
  { href: "/", label: "Overview", roles: ["owner", "admin", "support", "moderator", "viewer"] },
  { href: "/users/", label: "Users", roles: ["owner", "admin", "support", "moderator", "viewer"] },
  { href: "/messages/", label: "Messages", roles: ["owner", "admin", "viewer"] },
  { href: "/config/", label: "App control", roles: ["owner", "admin", "viewer"] },
  { href: "/moderation/", label: "Moderation", roles: ["owner", "admin", "moderator", "viewer"] },
  { href: "/support/", label: "Support", roles: ["owner", "admin", "support", "viewer"] },
  { href: "/money/", label: "Money + providers", roles: ["owner", "admin", "viewer"] },
  { href: "/health/", label: "System health", roles: ["owner", "admin", "viewer"] },
  { href: "/privacy/", label: "Privacy & legal", roles: ["owner", "admin", "support", "viewer"] },
  { href: "/staff/", label: "Staff roles", roles: ["owner", "admin"] },
  { href: "/audit/", label: "Audit log", roles: ["owner", "admin"] },
];

export function navFor(role: Role | null): typeof NAV {
  return role ? NAV.filter((n) => n.roles.includes(role)) : [];
}

/** Whether the role may do an action -- mirrors roles.js for showing/hiding buttons. */
const ACT: Record<string, Role[]> = {
  "users.reveal": ["owner", "admin", "support"],
  "users.act": ["owner", "admin", "support"],
  "users.moderate": ["owner", "admin", "support", "moderator"],
  "users.billing": ["owner", "admin"],
  "users.delete": ["owner", "admin"],
  "messages.send": ["owner", "admin"],
  "config.write": ["owner", "admin"],
  "moderation.act": ["owner", "admin", "moderator"],
  "support.act": ["owner", "admin", "support"],
  "health.run": ["owner"],
  "privacy.act": ["owner", "admin"],
  "legal.write": ["owner"],
  "roles.grant": ["owner"],
};
export function canDo(role: Role | null, action: keyof typeof ACT | string): boolean {
  return !!role && (ACT[action] ?? []).includes(role);
}
