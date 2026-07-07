import type { Metadata } from "next";
import { UpdateMaintenanceScreen } from "@/components/update-maintenance-screen";
import { getUpdateRuntimeStatus } from "@/lib/app-update";
import { currentUser } from "@/lib/session";
import "./globals.css";

export const metadata: Metadata = {
  title: "FortiGate Backup Portal",
  description: "Productieportaal voor FortiGate configuratiebackups"
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [user, updateStatus] = await Promise.all([currentUser(), getUpdateRuntimeStatus()]);
  const showMaintenance = updateStatus.running;

  return (
    <html lang="nl" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        {showMaintenance ? (
          <UpdateMaintenanceScreen
            isStarter={Boolean(user && updateStatus.startedByUserId === user.id)}
            returnTo={updateStatus.returnTo}
            initialLog={user && updateStatus.startedByUserId === user.id ? updateStatus.lastLog : null}
            startedAt={updateStatus.startedAt}
          />
        ) : (
          children
        )}
      </body>
    </html>
  );
}
