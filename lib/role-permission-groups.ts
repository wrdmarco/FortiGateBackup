import { permissions } from "@/lib/rbac";

export type PermissionForDisplay = {
  key: string;
  category: string;
  description: string;
};

export function rolePermissionGroups(showPlatformPermissions: boolean): [string, PermissionForDisplay[]][] {
  const visible = permissions
    .filter((permission) => showPlatformPermissions || !permission.key.startsWith("platform."))
    .map((permission) => ({
      key: permission.key,
      category: permission.category,
      description: permission.description
    }));

  return Object.entries(
    visible.reduce<Record<string, PermissionForDisplay[]>>((groups, permission) => {
      groups[permission.category] = [...(groups[permission.category] ?? []), permission];
      return groups;
    }, {})
  );
}
