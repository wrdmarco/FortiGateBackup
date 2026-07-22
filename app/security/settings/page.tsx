import { redirect } from "next/navigation";

export default function LegacyFoundrySettingsPage() {
  redirect("/settings?tab=foundry");
}
