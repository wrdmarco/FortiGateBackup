import { redirect } from "next/navigation";

export default async function LegacyNewRulePage({params}:{params:Promise<{rulesetId:string}>}){
  const {rulesetId}=await params;
  redirect(`/rulesets/${rulesetId}/rules/new`);
}
