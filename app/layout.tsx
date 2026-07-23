import type { Metadata } from "next";
import { UpdateMaintenanceScreen, UpdateRuntimeObserver } from "@/components/update-maintenance-screen";
import { getUpdateRuntimeStatus } from "@/lib/app-update";
import { currentUser } from "@/lib/session";
import { NavigationProgress } from "@/components/navigation-progress";
import "./globals.css";

export const metadata: Metadata = {
  title: "Forti Backup Portal",
  description: "Productieportaal voor FortiGate configuratiebackups"
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [user, updateStatus] = await Promise.all([currentUser(), getUpdateRuntimeStatus()]);
  const showMaintenance = updateStatus.running;

  return (
    <html lang="nl" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("fgbp-theme");if(!t){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.classList.toggle("dark",t==="dark")}catch(e){}`
          }}
        />
      </head>
      <body className="min-h-screen antialiased">
        {showMaintenance ? (
          <UpdateMaintenanceScreen
            isStarter={Boolean(user && updateStatus.startedByUserId === user.id)}
            returnTo={updateStatus.returnTo}
            initialLog={user && updateStatus.startedByUserId === user.id ? updateStatus.lastLog : null}
            startedAt={updateStatus.startedAt}
            outcome={updateStatus.outcome}
            operation={updateStatus.operation}
          />
        ) : (
          <>
            <NavigationProgress />
            {children}
            {user ? <UpdateRuntimeObserver /> : null}
          </>
        )}
      </body>
    </html>
  );
}
