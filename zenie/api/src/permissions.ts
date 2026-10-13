// Perfis e permissões (decisão do usuário, docs/PAINEL.md seção 6):
//   atendente: ver, atualizar, Wi-Fi (SSID/senha/unificar)
//   noc:       + reboot, diagnósticos
//   admin:     tudo (usuários, auditoria, firmware, factory reset, configurações)

export const ROLES = ["atendente", "noc", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = {
  "device.view": ["atendente", "noc", "admin"],
  "device.refresh": ["atendente", "noc", "admin"],
  "wifi.edit": ["atendente", "noc", "admin"],
  "device.reboot": ["noc", "admin"],
  "diag.run": ["noc", "admin"],
  "device.firmware": ["admin"],
  "device.factoryReset": ["admin"],
  "users.manage": ["admin"],
  "audit.view": ["admin"],
  "settings.manage": ["admin"],
  "homologation.view": ["admin"],
  "device.remove": ["admin"],
  "homologation.manage": ["admin"],
  "acs.manage": ["admin"],
  "olt.view": ["noc", "admin"],
  "acslog.view": ["noc", "admin"],
  "olt.manage": ["admin"],
  "olt.tr069": ["admin"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export function permissionsOf(role: Role): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(role, p));
}
